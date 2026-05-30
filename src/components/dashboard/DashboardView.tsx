/**
 * PizzaMatrix — Dashboard v2.4.0
 * Monitoraggio real-time fermentazione: ADU, maturationPct, W_current, pH, T_dough
 * Gompertz chart + sweet spot + alert feed + phase stepper
 */
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { PhaseSegment } from '../../db/db';
import { useApp } from '../../context/AppContext';
import { useTickEngine } from '../../hooks/useTickEngine';
import {
  Card, Metric, Btn, ProgressBar, AlertBadge, S,
} from '../ui';
import { downsampleLTTB } from '../../lib/lttb';
import { ddtForStyle } from '../../data/styleConstraints';
import {
  gompertz, sweetSpotMaturation, structuralState,
  computeAltitudeFactor, volumeMilestoneCorrection,
  maltAlertLevel, kEffective, CONTAINER_THERMAL_PRESETS,
  computeWaterTempDDT, type KneadingMethod,
  fArrhenius, ENZYMATIC_CLOCK_PARAMS, findAduAt,
} from '../../engine';
import { WaterTempResultCard } from '../tools/WaterTempView';

// ─── Clock ───────────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ─── Phase labels ─────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  bulk_room:    { label: 'Puntata – TA',    color: 'var(--accent-brand)' },
  bulk_fridge:  { label: 'Puntata – TC',    color: 'var(--state-cold)'   },
  balled_room:  { label: 'Appretto – TA',   color: 'var(--accent-brand)' },
  balled_fridge:{ label: 'Appretto – TC',   color: 'var(--state-cold)'   },
  proofing:     { label: 'Lievitazione',    color: 'var(--state-optimal-lo)' },
  baking:       { label: 'Cottura',         color: 'var(--accent-warning)' },
};

const PHASE_ORDER = ['bulk_room','bulk_fridge','balled_room','balled_fridge','proofing','baking'] as const;

// ─── Fasi valide per protocollo ───────────────────────────────────────────────
const PROTOCOL_PHASES: Record<string, string[]> = {
  ta:         ['bulk_room',   'balled_room',   'proofing', 'baking'],
  tc:         ['bulk_fridge', 'balled_fridge', 'proofing', 'baking'],
  tc_puntata: ['bulk_fridge', 'balled_room',   'proofing', 'baking'],
  tc_appreto: ['bulk_room',   'balled_fridge', 'proofing', 'baking'],
};

// ─── Gompertz multi-segmento PIECEWISE (passato reale + futuro pianificato) ─────
// Ogni fase ha la propria temperatura (TA o frigo) → ADU accumula a ritmi diversi.
// v2.4.0: rampe esponenziali Newton (N=3 sub-seg) per OGNI transizione TA↔TC.
// v2.4.1 (fix proiezione): la curva NON viene più ri-baselinata a T costante quando
// si entra in una fase fredda. Due correzioni:
//   1) Le fasi calde (TA) usano `warmAmbient` (T del laboratorio, stabile), NON il
//      `tAmbient` live — che dopo setPhase(TC) diventa fridgeTempC=4°C e appiattiva
//      la salita calda della puntata già avvenuta.
//   2) La curva è ANCORATA allo stato integrato reale (ts.cumulativeAdu / enzymaticAdu)
//      al tempo `elapsedH`: il passato vi converge, il futuro riparte esattamente da lì
//      (giunzione continua, nessun reset a 0). Il process_log conserva solo il kickoff,
//      quindi il tickState è la fonte di verità dell'integrazione reale.
function buildMultiSegmentData(
  session: {
    apprettoProtocol: string;
    puntataH: number; staglioH: number; apprettoH: number;
    tcHours?: number; fridgeTempC?: number;
    agentEaKj: number; agentType: string;
    agentMuMax: number; agentLambda: number; agentAsymptote: number;
    initialMaturationOffset?: number;
    numPanetti?: number; hydration?: number; containerPreset?: string;
    totalFlourGrams?: number; salt?: number;
    prefermenti?: any[];
    tLaboratorio?: number;
  },
  tAmbient: number,
  currentPhase?: string,    // ts.phase — usato solo in assenza di timeline
  elapsedH?: number,        // ts.elapsedH — ore totali trascorse dall'avvio sessione
  liveAdu?: number,         // ts.cumulativeAdu — ADU lievito integrato reale (ancora)
  liveEnzAdu?: number,      // ts.enzymaticAdu — ADU enzimatico integrato reale (ancora)
  timeline?: PhaseSegment[], // ThermalTimeline persistente — fonte di verità temperature/durate
  targetBakeH?: number,      // ore da startedAt a targetBakeAt — estende il dominio del grafico se oltre maxH
): { points: { h: number; pct: number; matPct: number; tempC: number }[]; transitions: { h: number; label: string; color: string }[] } {
  const fridgeT = session.fridgeTempC ?? 4;
  const proto   = session.apprettoProtocol ?? 'ta';
  const tcH     = session.tcHours ?? 12;

  // ── Temperatura delle fasi CALDE (anti-rebaseline) ───────────────────────────
  // Quando la fase corrente è fredda, `tAmbient` live = fridgeTempC: usarlo per le
  // fasi TA (puntata/appretto a temperatura ambiente) cancellerebbe la salita calda
  // già avvenuta. Si usa invece la T del laboratorio (stabile). Nelle fasi calde
  // `warmAmbient === tAmbient` → nessun cambiamento di comportamento per i protocolli TA.
  const isColdNow   = currentPhase === 'bulk_fridge' || currentPhase === 'balled_fridge';
  const warmAmbient = isColdNow ? (session.tLaboratorio ?? 22) : tAmbient;

  // ── Proprietà termiche condivise ─────────────────────────────────────────────
  const h2      = Math.max(0.01, (session.hydration ?? 65) / 100);
  const cp2     = 4186 * h2 + 1840 * (1 - h2);                          // J/(kg·K)
  const totalDG = (session.totalFlourGrams ?? 1000) * (1 + h2 + (session.salt ?? 2) / 100);
  const tauMult = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[session.containerPreset ?? 'bare']?.tauMultiplier ?? 1.0;
  const numPan  = Math.max(1, session.numPanetti ?? 6);

  /**
   * τ in secondi per Newton's law di raffreddamento/riscaldamento.
   * isBulk=true → geometria cilindrica (puntata, tutta la massa in un contenitore piatto).
   * isBulk=false → geometria sferica (panetti post-staglio).
   * Formula: τ = m·cp / (H·A)  con H=8 W/(m²·K) (convezione naturale aria ferma).
   */
  const computeTauSec = (isBulk: boolean): number => {
    if (isBulk) {
      // Cilindro flat: h/r ≈ 0.3  →  A_lat = 2π·r·(0.3r) = 0.6π·r²
      const massKg = totalDG / 1000;
      const V      = massKg / 1050;
      const r      = Math.cbrt(V / (Math.PI * 0.3));
      const A_lat  = 2 * Math.PI * r * 0.3 * r;
      return (massKg * cp2) / (8 * A_lat) * tauMult;
    } else {
      // Sfera (panetti post-staglio): A = 4π·r²
      const panKg = totalDG / 1000 / numPan;
      const V     = panKg / 1050;
      const r     = Math.cbrt((3 * V) / (4 * Math.PI));
      const A     = 4 * Math.PI * r * r;
      return (panKg * cp2) / (8 * A) * tauMult;
    }
  };

  type Seg = { durationH: number; tempC: number; label: string; color: string; phase: string };

  // ── Segmenti base ─────────────────────────────────────────────────────────────
  // Se la ThermalTimeline è disponibile, le temperature e durate vengono da essa
  // (locked per i completed, pianificate per i planned). Questo impedisce il flatten
  // al cambio fase: le temperature dei segmenti completed non cambiano mai.
  // Fallback: logica classica dal protocollo (usata se la timeline non è ancora pronta).
  const baseSegs: Seg[] = timeline && timeline.length > 0
    ? timeline.map(seg => ({
        durationH: seg.endElapsedH != null
          ? Math.max(0.01, seg.endElapsedH - seg.startElapsedH)
          : Math.max(0.01, session.apprettoH ?? 4),
        tempC:  seg.ambientTempC,
        label:  PHASE_LABELS[seg.phaseType]?.label ?? seg.phaseType,
        color:  PHASE_LABELS[seg.phaseType]?.color ?? 'var(--text-muted)',
        phase:  seg.phaseType,
      }))
    : proto === 'ta' ? [
      { durationH: session.puntataH,  tempC: warmAmbient, label: 'Puntata TA',    color: 'var(--accent-brand)', phase: 'bulk_room'    },
      { durationH: session.staglioH,  tempC: warmAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
      { durationH: session.apprettoH, tempC: warmAmbient, label: 'Appretto TA',   color: 'var(--accent-brand)', phase: 'proofing'     },
    ]
    : proto === 'tc' ? [
      { durationH: tcH,               tempC: fridgeT,     label: 'Freddo totale', color: 'var(--state-cold)',   phase: 'bulk_fridge'  },
      { durationH: session.staglioH,  tempC: warmAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
    ]
    : proto === 'tc_puntata' ? [
      { durationH: tcH,               tempC: fridgeT,     label: 'Puntata TC',    color: 'var(--state-cold)',   phase: 'bulk_fridge'  },
      { durationH: session.staglioH,  tempC: warmAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
      { durationH: session.apprettoH, tempC: warmAmbient, label: 'Appretto TA',   color: 'var(--accent-brand)', phase: 'proofing'     },
    ]
    : /* tc_appreto */ [
      { durationH: session.puntataH,  tempC: warmAmbient, label: 'Puntata TA',  color: 'var(--accent-brand)', phase: 'bulk_room'     },
      { durationH: session.staglioH,  tempC: warmAmbient, label: 'Staglio',     color: 'var(--text-muted)',   phase: 'balled_room'   },
      { durationH: tcH,               tempC: fridgeT,     label: 'Appretto TC', color: 'var(--state-cold)',   phase: 'balled_fridge' },
      // Riscaldo TA: N=5 sub-seg con T(t)=warmAmb+(fridgeT−warmAmb)·exp(−t/τ)
      // Etichettati 'Riscaldo TA' → ramp-expansion pass li salta (già ramped).
      ...(session.apprettoH > 0 ? (() => {
        const tauSec2 = computeTauSec(false);  // sfera per panetti
        return Array.from({ length: 5 }, (_, i) => {
          const tMid = (i + 0.5) * (session.apprettoH / 5) * 3600;
          const T    = warmAmbient + (fridgeT - warmAmbient) * Math.exp(-tMid / tauSec2);
          return { durationH: session.apprettoH / 5, tempC: T,
            label: 'Riscaldo TA', color: 'var(--state-approaching)', phase: 'proofing' as const };
        });
      })() : []),
    ];

  // ── Scala i segmenti PRECEDENTI alla fase corrente (solo senza timeline) ──────
  // Con la timeline le durate sono già quelle reali (completed) o pianificate (planned).
  if (!timeline && currentPhase && elapsedH != null && elapsedH > 0) {
    const iCurr = baseSegs.findIndex(s => s.phase === currentPhase);
    if (iCurr > 0) {
      const plannedBefore = baseSegs.slice(0, iCurr).reduce((sum, s) => sum + s.durationH, 0);
      if (plannedBefore > 0.01) {
        const scale = Math.min(elapsedH, plannedBefore) / plannedBefore;
        for (let i = 0; i < iCurr; i++) {
          baseSegs[i] = { ...baseSegs[i], durationH: Math.max(0.01, baseSegs[i].durationH * scale) };
        }
      }
    }
  }

  // ── Transizioni (calcolate dai base-seg PRIMA dell'espansione) ────────────────
  // Le posizioni H restano invariate all'espansione: le rampe modificano la CURVA
  // ma non i confini di fase, che rimangono agli stessi istanti pianificati.
  const transitions: { h: number; label: string; color: string }[] = [];
  {
    let th = 0;
    for (let si = 0; si < baseSegs.length - 1; si++) {
      th += baseSegs[si].durationH;
      if (baseSegs[si].label !== 'Riscaldo TA') {
        transitions.push({ h: th, label: baseSegs[si].label, color: baseSegs[si].color });
      }
    }
  }

  // ── Ramp-expansion: rampe esponenziali Newton per ogni transizione TA↔TC ─────
  // Per ogni seg dove T_entry ≠ T_target: suddivide in N=3 sub-seg esponenziali
  // + steady-state. Salta i 'Riscaldo TA' (già ramped nel blocco tc_appreto).
  // Fisicamente: modella il raffreddamento/riscaldamento reale dell'impasto
  // anziché un gradino istantaneo — coerente con Fix 1 (setPhase auto-tAmbient).
  const RAMP_N = 3;
  const expandedSegs: Seg[] = [];
  let T_entry = warmAmbient;  // impasto sempre a T di laboratorio (caldo) all'avvio

  for (const seg of baseSegs) {
    const tempDiff    = Math.abs(seg.tempC - T_entry);
    const isPreRamped = seg.label === 'Riscaldo TA';

    if (tempDiff > 0.5 && !isPreRamped && seg.durationH >= 0.15) {
      // Geometria: bulk (cilindro) o panetti (sfera) in base alla fase
      const isBulk = seg.phase === 'bulk_room' || seg.phase === 'bulk_fridge';
      const tauSec  = computeTauSec(isBulk);
      // rampH = min(60% del segmento, ~3τ per 95% convergenza Newton)
      const rampH   = Math.min(seg.durationH * 0.6, (tauSec * 3) / 3600);
      const steadyH = seg.durationH - rampH;

      // Sub-segmenti di rampa: T(tMid) = T_target + (T_entry − T_target)·exp(−tMid/τ)
      for (let ri = 0; ri < RAMP_N; ri++) {
        const tMidSec = (ri + 0.5) * (rampH / RAMP_N) * 3600;
        const T = seg.tempC + (T_entry - seg.tempC) * Math.exp(-tMidSec / tauSec);
        expandedSegs.push({ ...seg, durationH: rampH / RAMP_N, tempC: T });
      }
      // Resto del segmento a temperatura stazionaria
      if (steadyH > 0.01) {
        expandedSegs.push({ ...seg, durationH: steadyH });
      }
    } else {
      expandedSegs.push(seg);
    }

    // T_entry per il prossimo segmento = target stazionario di quello corrente
    T_entry = seg.tempC;
  }

  // ── Loop di disegno sui segmenti espansi ──────────────────────────────────────
  const kRef   = (kEffective as Function)(25, session.agentEaKj, session.agentType) as number;
  const totalH = expandedSegs.reduce((s, seg) => s + seg.durationH, 0);
  // Estende il dominio fino al bake target (es. finestra servizio lontana nel futuro)
  const maxH   = Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
  const stepH  = maxH / 80;  // ~80 punti totali

  // Two-clock seeding: lievitazione parte da 0 (degassato), maturazione dall'offset biga.
  const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;
  const prefFrac     = Math.min(1, (session.prefermenti ?? [])
    .reduce((s: number, p: any) => s + (p.flourFraction ?? 0) / 100, 0));
  const leavLambda   = Math.max(0.3, session.agentLambda * (1 - 0.5 * prefFrac));
  const enzSeed      = matOffsetPct > 0
    ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
    : 0;
  // ── FASE 1: integrazione RAW dell'ADU pianificato (per-fase, temp corrette) ────
  // Si accumulano i punti grezzi (rawAdu lievito, rawEnz maturazione) integrando
  // ogni segmento alla sua T. Poi (fase 2) la curva viene ANCORATA allo stato reale.
  type RawPt = { h: number; rawAdu: number; rawEnz: number; tempC: number };
  const rawPts: RawPt[] = [];
  let cumulativeAdu = 0;
  let enzAdu = enzSeed;
  let segStartH = 0;

  const integrateSpan = (durationH: number, tempC: number, hOffset: number) => {
    const kT    = (kEffective as Function)(tempC, session.agentEaKj, session.agentType) as number;
    const ratio = kRef > 1e-12 ? kT / kRef : 1;
    const enzRate = (fArrhenius as Function)(tempC) as number;
    const nSteps   = Math.max(1, Math.round(durationH / stepH));
    const spanStepH = durationH / nSteps;
    for (let i = 1; i <= nSteps; i++) {
      cumulativeAdu += spanStepH * ratio;
      enzAdu        += spanStepH * enzRate;
      rawPts.push({ h: hOffset + i * spanStepH, rawAdu: cumulativeAdu, rawEnz: enzAdu, tempC });
    }
  };

  for (const seg of expandedSegs) {
    integrateSpan(seg.durationH, seg.tempC, segStartH);
    segStartH += seg.durationH;
  }
  // Estensione oltre totalH (plateau a tAmbient corrente — futuro oltre il target)
  const extraH = maxH - totalH;
  if (extraH > 0.1) integrateSpan(extraH, tAmbient, totalH);

  // ── FASE 2: ANCORAGGIO allo stato integrato reale (ts) al tempo elapsedH ───────
  // Il process_log conserva solo il kickoff → il tickState è la fonte di verità.
  // - PASSATO (h ≤ anchorH): scala la salita grezza così da centrare esattamente
  //   lo stato reale al confine (mantiene la FORMA caldo→freddo, niente flat a 0).
  // - FUTURO (h > anchorH): riparte dall'ancora reale e prosegue con gli incrementi
  //   pianificati. Giunzione continua: a h=anchorH passato e futuro coincidono.
  const anchorH = (elapsedH != null && elapsedH > 0) ? elapsedH : 0;
  const interpAt = (h: number, key: 'rawAdu' | 'rawEnz'): number => {
    if (rawPts.length === 0) return key === 'rawEnz' ? enzSeed : 0;
    if (h <= 0) return key === 'rawEnz' ? enzSeed : 0;
    if (h >= rawPts[rawPts.length - 1].h) return rawPts[rawPts.length - 1][key];
    for (let i = 0; i < rawPts.length; i++) {
      if (rawPts[i].h >= h) {
        const p1 = rawPts[i];
        const p0 = i > 0 ? rawPts[i - 1] : { h: 0, rawAdu: 0, rawEnz: enzSeed };
        const f  = (h - p0.h) / Math.max(1e-9, p1.h - p0.h);
        return p0[key] + f * (p1[key] - p0[key]);
      }
    }
    return rawPts[rawPts.length - 1][key];
  };

  const hasLive       = anchorH > 0 && liveAdu != null && liveEnzAdu != null;
  const rawAduAtAnchor = hasLive ? interpAt(anchorH, 'rawAdu') : 0;
  const rawEnzAtAnchor = hasLive ? interpAt(anchorH, 'rawEnz') : enzSeed;
  // Fattori di scala del passato (forma preservata, endpoint = stato reale)
  const aduScale = hasLive && rawAduAtAnchor > 1e-9 ? (liveAdu as number) / rawAduAtAnchor : 1;
  const enzAccumAnchor = rawEnzAtAnchor - enzSeed;
  const enzScale = hasLive && enzAccumAnchor > 1e-9
    ? ((liveEnzAdu as number) - enzSeed) / enzAccumAnchor : 1;
  // Ancore reali da cui prosegue il futuro
  const futureAduBase = hasLive ? (liveAdu as number)    : rawAduAtAnchor;
  const futureEnzBase = hasLive ? (liveEnzAdu as number) : rawEnzAtAnchor;

  const points: { h: number; pct: number; matPct: number; tempC: number }[] = [];
  for (const p of rawPts) {
    let adu: number, enz: number;
    if (p.h <= anchorH) {
      // Passato: riconciliato sullo stato reale (scala la salita pianificata)
      adu = p.rawAdu * aduScale;
      enz = enzSeed + (p.rawEnz - enzSeed) * enzScale;
    } else {
      // Futuro: prosegue dall'ancora reale con gli incrementi pianificati
      adu = futureAduBase + (p.rawAdu - rawAduAtAnchor);
      enz = futureEnzBase + (p.rawEnz - rawEnzAtAnchor);
    }
    const raw    = (gompertz as Function)(adu, session.agentMuMax, leavLambda, session.agentAsymptote) as number;
    const rawEnz = (gompertz as Function)(enz, ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100) as number;
    if (isNaN(raw) && import.meta.env.DEV) console.warn('[DashboardChart] gompertz→NaN: ADU=', adu, 'muMax=', session.agentMuMax, 'λ=', leavLambda);
    points.push({
      h: parseFloat(p.h.toFixed(2)),
      pct: isNaN(raw) ? 0 : parseFloat(raw.toFixed(1)),
      matPct: isNaN(rawEnz) ? 0 : parseFloat(rawEnz.toFixed(1)),
      tempC: parseFloat(p.tempC.toFixed(1)),
    });
  }

  return { points, transitions };
}

// ─── Sweet Spot Card ──────────────────────────────────────────────────────────
// ETA al target = picco di MATURAZIONE (orologio enzimatico two-clock), NON lievito.
// sweetSpotMaturation(session, currentEnzAdu, T) usa fArrhenius (Ea=47, no cardinale):
// a 4°C costante l'85% arriva in ~48h (validazione KB), non ~1330h (cinetica lievito).
// Usa tempAmbient (aggiornato subito dall'utente) non tempDough (inerzia termica).
// remainingH = ore al target cottura pianificato (countdown del clock).
function SweetSpotCard({ session, ts, remainingH }: { session: any; ts: any; remainingH: number }) {
  const tAmb = ts?.tempAmbient ?? 22;   // reagisce subito al cambio utente
  // Pre-tick fallback: la maturazione parte dall'offset prefermento (la biga ha già maturato)
  const enzSeedFallback = useMemo(() => {
    const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;
    return matOffsetPct > 0
      ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
      : 0;
  }, [session.initialMaturationOffset]);
  const spot = useMemo(() => {
    try {
      // Orologio MATURAZIONE: l'ADU enzimatico integrato reale guida l'ETA al picco.
      const enzAdu = ts?.enzymaticAdu ?? enzSeedFallback;
      const result = (sweetSpotMaturation as Function)(
        session,
        enzAdu,
        tAmb,                           // temperatura ambiente corrente (proiezione a T costante)
      ) as { status: string; hoursUntilPeak: number; peakPct: number } | null;
      return result;
    } catch { return null; }
  }, [session, ts?.enzymaticAdu, enzSeedFallback, tAmb]);

  if (!spot) return null;

  // Usa maturazione enzimatica (two-clock) come segnale primario past_peak
  const isPast = (ts?.maturationPct ?? 0) >= (session.alertThreshold ?? 85) || spot.status === 'past_peak';
  const hoursLeft = Math.max(0, spot.hoursUntilPeak ?? 0);
  // Quando l'impasto è in TC, la proiezione a temperatura costante è fuorviante (può dare
  // centinaia di ore). Se remainingH è disponibile e plausibile, è la fonte primaria.
  const hasSchedule     = remainingH > 0;
  const isColdPhase     = (ts?.phase === 'balled_fridge' || ts?.phase === 'bulk_fridge');
  // Divergenza significativa: proiezione a T costante distante > 2h dal piano
  const estimateDiverges = hasSchedule && Math.abs(hoursLeft - remainingH) > 2;
  const primaryH = hasSchedule ? remainingH : hoursLeft;

  return (
    <Card elevated>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={S.label}>Sweet Spot</span>
        <span style={{
          fontSize: '0.68rem', fontFamily: 'var(--font-mono)',
          background: isPast ? 'rgba(0,184,148,0.15)' : 'rgba(255,140,50,0.15)',
          color: isPast ? 'var(--state-optimal-hi)' : 'var(--accent-brand)',
          borderRadius: 4, padding: '2px 6px',
        }}>
          target {spot.peakPct ?? 85}%
        </span>
      </div>

      {isPast ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-optimal-hi)' }}>
          ✓ Zona ottimale raggiunta — inforna!
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Metric
            label={hasSchedule ? 'Al target cottura' : 'Ore al picco'}
            value={primaryH.toFixed(1)}
            unit="h"
            color="var(--accent-brand)"
          />
          <Metric label="Maturazione target" value={`${spot.peakPct ?? 85}`} unit="%" color="var(--state-optimal-lo)" />
        </div>
      )}

      {/* Nota proiezione a T costante — mostrata solo quando stima diverge dal piano */}
      {!isPast && estimateDiverges && isColdPhase && (
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          ❄ In TC · stima a {tAmb.toFixed(1)}°C costante: ~{hoursLeft.toFixed(1)}h
        </div>
      )}
      {!isPast && !estimateDiverges && hoursLeft > 0 && (
        <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          Stima: ~{primaryH.toFixed(1)}h al sweet spot a {tAmb.toFixed(1)}°C amb.
        </div>
      )}
    </Card>
  );
}

// ─── Quality Profile Card ─────────────────────────────────────────────────────
// Indici euristici: estensibilità, profilo aromatico, scioglievolezza
// Basati su parametri di sessione (P/L, W, idratazione, prefermenti, protocollo)
function QualityDot({ n, color }: { n: number; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i <= n ? color : 'rgba(255,255,255,0.10)',
        }} />
      ))}
    </div>
  );
}

function QualityProfileCard({ session, ts }: { session: any; ts: any }) {
  const pl   = session.effectivePl_initial ?? 0.65;
  const hyd  = session.hydration ?? 65;
  const W    = session.effectiveW_initial ?? 280;
  const prefs: any[] = session.prefermenti ?? [];
  const proto = session.apprettoProtocol ?? 'ta';
  const style = session.style ?? 'napoletana';

  // Maturazione realizzata (orologio enzimatico two-clock) [0, 1]
  const m = Math.max(0, Math.min(1, (ts?.maturationPct ?? 0) / 100));

  // ── Estensibilità: matPct gate forte + P/L + idratazione ─────────────────────
  // A matPct=55%: max 3/5 — a matPct=95%: 4/5 — a matPct=100%+flour soft: 5/5
  const matExtrib  = 3.0 * m;
  const plScore    = Math.max(0.5, Math.min(2.0, (1.2 - pl) / 0.35));
  const hydScore   = 0.5 + Math.max(0, Math.min(1.0, (hyd - 55) / 30));
  const flourContr = (plScore + hydScore) / 2;
  const ext = Math.max(1, Math.min(5, Math.round(matExtrib + flourContr)));

  // ── Aromi: matPct×tempo + prefermenti + freddo (continuo) + sourdough ─────────
  // coldContrib scala con tcHours (min(1.0, tcH/24)): 12h→0.5, 48h→1.0 clampato
  let prefContrib = 0;
  prefs.forEach((p: any) => {
    if (p.type === 'biga')          prefContrib += 1.2;
    else if (p.type === 'poolish')  prefContrib += 0.8;
    else if (p.type === 'riporto')  prefContrib += 0.9;
    else if (p.type === 'autolysis') prefContrib += 0.1;
  });
  const tcH         = session.tcHours ?? 0;
  const coldContrib = (proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto') && tcH > 8
    ? Math.min(1.0, tcH / 24) : 0;
  const sdContrib   = session.agentType === 'sourdough_wheat' ? 0.8 : 0;
  const aromaScore  = Math.max(1, Math.min(5,
    Math.round(1.0 + 2.0 * m + prefContrib + coldContrib + sdContrib),
  ));

  // ── Scioglievolezza: non-monotona (picco a 87%) + idratazione + amilasi ───────
  // Bell: 1 − (m − 0.87)² / 0.25  →  picco=1.0 a 87%, cala sia sotto che sopra
  const sciMat    = Math.max(0, Math.min(1, 1 - Math.pow(m - 0.87, 2) / 0.25));
  const hydBon    = Math.max(0, Math.min(0.8, (hyd - 55) / 50));
  const amylBon   = Math.min(0.4, Math.max(0, ((session.effectiveAmylaseIndex ?? 1.0) - 1.0) * 0.4));
  const styleSci: Record<string, number> = {
    napoletana: 0.3, contemporanea: 0.2, teglia: 0.0, pala: 0.1, nystyle: -0.2,
  };
  const W_sci     = session.effectiveW_current ?? W;
  const wBon      = Math.max(0, Math.min(0.3, (350 - W_sci) / 500));  // piccolo bonus W basso
  const sciScore  = Math.max(1, Math.min(5,
    Math.round(1 + 3.0 * sciMat + hydBon + amylBon + wBon + (styleSci[style] ?? 0)),
  ));

  return (
    <Card>
      <span style={{ ...S.label, display: 'block', marginBottom: 10 }}>Profilo impasto</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { label: 'Estensibilità', score: ext,       color: 'var(--pref-autolisi, #74b9ff)' },
          { label: 'Aromi',         score: aromaScore, color: 'var(--accent-warning)'         },
          { label: 'Scioglievolezza', score: sciScore, color: 'var(--state-approaching)'      },
        ].map(({ label, score, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {label}
            </span>
            <QualityDot n={score} color={color} />
          </div>
        ))}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Stima euristica · varia con protocollo, farine e prefermenti
      </div>
    </Card>
  );
}

// ─── Phase Stepper ────────────────────────────────────────────────────────────
// Mostra solo le fasi valide per il protocollo selezionato (+ proofing + baking sempre presenti)
function PhaseStepper({ currentPhase, onPhaseChange, protocol }: {
  currentPhase: string; onPhaseChange: (p: string) => void; protocol?: string;
}) {
  const allowedPhases = PROTOCOL_PHASES[protocol ?? 'ta'] ?? [...PHASE_ORDER];
  return (
    <Card>
      <span style={{ ...S.label, display: 'block', marginBottom: 10 }}>Fase corrente</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {allowedPhases.map(p => {
          const info = PHASE_LABELS[p];
          if (!info) return null;
          const active = currentPhase === p;
          return (
            <button key={p} onClick={() => onPhaseChange(p)} style={{
              background: active ? info.color : 'var(--bg-elevated)',
              color: active ? '#0a0806' : 'var(--text-secondary)',
              border: active ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              fontWeight: active ? 700 : 400,
              cursor: 'pointer',
            }}>
              {info.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Structural W Card ────────────────────────────────────────────────────────
function WStructureCard({ ts, session }: { ts: any; session: any }) {
  const W0 = session.effectiveW_initial ?? 280;
  const Wcurr = ts?.W_current ?? W0;
  const decay = ((W0 - Wcurr) / W0) * 100;
  // structuralState(W0, W_current) → 'OK'|'WARNING'|'CRITICAL'|'COLLAPSED'
  const state = (structuralState as Function)(W0, Wcurr) as string;

  const stateColor =
    state === 'COLLAPSED' ? 'var(--state-collapsed)' :
    state === 'CRITICAL'  ? 'var(--state-critical)' :
    state === 'WARNING'   ? 'var(--accent-warning)' :
    'var(--state-optimal-hi)';

  // KB §2.11, §6.5 — Sessione di sola autolisi: W non decade (atteso)
  const prefs = session.prefermenti ?? [];
  const onlyAutolysis = prefs.length > 0 && prefs.every((p: any) => p.type === 'autolysis');
  if (onlyAutolysis) {
    const plImprovement = prefs.reduce((acc: number, p: any) => {
      const before = p.flourGroup?.effectivePl ?? 0.55;
      const after  = p.state?.pl_modified ?? before;
      return acc + (before - after);
    }, 0);
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={S.label}>Struttura W (autolisi)</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-info)' }}>
            INVARIATO
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Metric label="W" value={W0.toFixed(0)} color="var(--text-secondary)" />
          <Metric label="ΔP/L" value={`-${plImprovement.toFixed(2)}`} color="var(--accent-info)" />
        </div>
        <div style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Autolisi pura: W invariato (atteso), estensibilità migliora via P/L
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={S.label}>Struttura W</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: stateColor }}>
          {state}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Metric label="W₀" value={W0.toFixed(0)} color="var(--text-muted)" />
        <Metric label="W corrente" value={Wcurr.toFixed(0)} color={stateColor} />
        <Metric label="Decadimento" value={`${decay.toFixed(1)}%`}
          color={decay > 35 ? 'var(--state-critical)' : decay > 20 ? 'var(--accent-warning)' : 'var(--text-secondary)'} />
      </div>
      <div style={{ marginTop: 10 }}>
        <ProgressBar pct={100 - decay} color={stateColor} />
      </div>
    </Card>
  );
}

// ─── Temperature Card ─────────────────────────────────────────────────────────
function TempCard({ ts, setTempAmbient }: { ts: any; setTempAmbient: (t: number) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [tmpT, setTmpT] = useState(ts?.tempAmbient ?? 22);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <span style={S.label}>Temperature</span>
        <button onClick={() => {
          if (!editMode) setTmpT(ts?.tempAmbient ?? 22);  // sync slider con valore live prima di aprire
          setEditMode(e => !e);
        }} style={{
          background: 'none', border: 'none', color: 'var(--accent-info)',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', cursor: 'pointer',
        }}>
          {editMode ? 'Salva' : 'Modifica T_amb'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Metric label="T impasto" value={(ts?.tempDough ?? 22).toFixed(1)} unit="°C" color="var(--accent-brand)" />
        <Metric label="T ambiente" value={(ts?.tempAmbient ?? 22).toFixed(1)} unit="°C" />
      </div>
      {editMode && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="range" min={-2} max={40} step={0.5}
            value={tmpT}
            onChange={e => setTmpT(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent-brand)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', minWidth: 40 }}>
            {tmpT}°C
          </span>
          <button onClick={() => { setTempAmbient(tmpT); setEditMode(false); }} style={{
            background: 'var(--accent-brand)', color: '#0a0806',
            border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px 12px', fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
          }}>OK</button>
        </div>
      )}
    </Card>
  );
}

// ─── Acqua impastamento (DDT live) ───────────────────────────────────────────

function ImpastoPreparazioneCard({ session, ts: _ts }: { session: any; ts: any }) {
  // Usa tLaboratorio della sessione (fisso al momento dell'impasto, non live)
  // ts non è usato qui: la raccomandazione T_acqua si riferisce al momento
  // dell'impasto (avvenuto all'avvio sessione), non alla T_amb corrente.
  const tAmb   = session.tLaboratorio ?? 20;
  const waterG = Math.round(session.totalFlourGrams * (session.hydration / 100));
  const tPref  = (session.prefermenti?.length ?? 0) > 0
    ? session.prefermenti.reduce((s: number, p: any) => s + (p.tempC ?? 16), 0) / session.prefermenti.length
    : undefined;
  const ddtDef = ddtForStyle(session.style);
  const result = (computeWaterTempDDT as Function)({
    ddtTarget:       ddtDef,
    tempAmbient:     tAmb,
    kneadingMethod:  (session.kneadingMethod ?? 'spiral') as KneadingMethod,
    waterTotalGrams: waterG,
    tempPreferment:  tPref,
  });
  return (
    <Card>
      <span style={S.label}>💧 Riferimento impasto</span>
      <WaterTempResultCard result={result} showFormula={false} />
    </Card>
  );
}

// ─── Altitude correction card ─────────────────────────────────────────────────
function AltitudeCard({ altitudeM }: { altitudeM: number }) {
  if (!altitudeM || altitudeM < 100) return null;
  const factor = (computeAltitudeFactor as Function)(altitudeM) as number;
  const corrected = (volumeMilestoneCorrection as Function)(1.5, altitudeM) as number;
  return (
    <Card style={{ padding: '10px 14px', background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}>
      <span style={{ ...S.label, color: 'var(--pref-poolish)' }}>Correzione altitudine {altitudeM}m</span>
      <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        Fattore P: ×{factor.toFixed(3)} · Milestone vol. ×1.5 → {(corrected * 100).toFixed(0)}% bio
      </div>
    </Card>
  );
}

// ─── Alert Feed ───────────────────────────────────────────────────────────────
function AlertFeed({ alerts, onClear }: { alerts: any[]; onClear: () => void }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>Alert ({alerts.length})</span>
        <button onClick={onClear} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', cursor: 'pointer',
        }}>Pulisci</button>
      </div>
      {[...(alerts ?? [])].reverse().slice(0, 5).map(a => (
        <AlertBadge key={a.id} level={a.level} message={a.message} />
      ))}
    </div>
  );
}

// ─── Gompertz Chart ───────────────────────────────────────────────────────────
// Curva multi-segmento: ogni fase al proprio T (TA o frigo).
// ReferenceLine verticali sulle transizioni di fase.
// Scrollabile orizzontalmente: ~13px/h, larghezza proporzionale a maxH.
const PX_PER_HOUR = 13;

function GompertzChart({ session, ts }: { session: any; ts: any }) {
  const proto = session.apprettoProtocol ?? 'ta';
  const tAmb  = ts?.tempAmbient ?? 22;  // tempAmbient risponde subito, tempDough ha inerzia

  const { points, transitions } = useMemo(() => {
    try {
      // Ancore: ADU integrato reale (tickState) → curva piecewise passato/futuro.
      // La ThermalTimeline è la fonte delle temperature per ogni segmento:
      // i segmenti completed hanno temperature bloccate → cambio fase NON appiattisce il passato.
      // ts?.phase è rimosso dalle deps: le transizioni di fase aggiornano session.thermalTimeline
      // (che è in deps tramite session), non solo ts.phase.
      const raw = buildMultiSegmentData(
        session, tAmb, ts?.phase, ts?.elapsedH,
        ts?.cumulativeAdu, ts?.enzymaticAdu,
        session.thermalTimeline,
        targetBakeH ?? undefined,
      );
      // KB §11.4 — LTTB downsampling sopra 200 punti (preserva primo/ultimo + forma curva)
      if (raw.points.length > 200) {
        const compressed = downsampleLTTB(
          raw.points.map(p => ({ x: p.h, y: p.pct, ...p })),
          200,
        ) as typeof raw.points;
        return { points: compressed, transitions: raw.transitions };
      }
      return raw;
    } catch { return { points: [], transitions: [] }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ts?.phase rimosso: phase changes aggiornano session.thermalTimeline (già in deps via session)
  }, [session, tAmb, ts?.elapsedH, ts?.cumulativeAdu, ts?.enzymaticAdu]);

  const elapsed = ts?.elapsedH ?? 0;
  const fridgeT = session.fridgeTempC ?? 4;

  // Linea verticale "target cottura" sul grafico: x = ore dalla sessione al targetBakeAt
  const targetBakeH = useMemo(() => {
    try {
      const t0   = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
      const tBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : (session.targetBakeAt ? new Date(session.targetBakeAt) : null);
      if (!tBake) return null;
      const h = (tBake.getTime() - t0.getTime()) / 3_600_000;
      return h > 0 ? parseFloat(h.toFixed(2)) : null;
    } catch { return null; }
  }, [session.startedAt, session.targetBakeAt]);

  // Calcola maxH per impostare la larghezza del grafico
  const totalH = proto === 'ta'
    ? (session.puntataH ?? 8) + (session.staglioH ?? 0.5) + (session.apprettoH ?? 4)
    : proto === 'tc'
    ? (session.tcHours ?? 12) + (session.staglioH ?? 0.5)
    : proto === 'tc_puntata'
    ? (session.tcHours ?? 12) + (session.staglioH ?? 0.5) + (session.apprettoH ?? 4)
    : (session.puntataH ?? 8) + (session.staglioH ?? 0.5) + (session.tcHours ?? 12) + (session.apprettoH ?? 0);
  // Estende l'asse fino al bake target: per sessioni finestra-servizio il target
  // può essere > totalH (es. 40h vs 18h calcolati dai soli campi sessione)
  const maxH     = Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
  const chartW   = Math.max(300, Math.round(maxH * PX_PER_HOUR));

  // Tick asse X: ogni 2h se maxH ≤ 12, ogni 4h se ≤ 24, ogni 6h oltre
  const xTickStep = maxH <= 12 ? 2 : maxH <= 24 ? 4 : 6;
  const xTicks = Array.from({ length: Math.floor(maxH / xTickStep) + 1 }, (_, i) => i * xTickStep);

  // Label protocollo leggibile
  const protoLabel: Record<string, string> = {
    ta: 'TA', tc: 'TC', tc_puntata: 'TC Puntata', tc_appreto: 'TC Appreto',
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={S.label}>Lievitazione · Maturazione</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {tAmb.toFixed(1)}°C TA · {fridgeT}°C TC · {protoLabel[proto] ?? proto}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent-brand)' }}>
          ╌╌ Lievitazione (lievito)
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#e6c84a' }}>
          —— Maturazione (enzimatica)
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--state-cold)' }}>
          ╌╌ T impasto
        </span>
      </div>
      {/* Scroll orizzontale quando il grafico è più largo dello schermo */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px', paddingBottom: 4 }}>
        <LineChart width={chartW} height={200} data={points} margin={{ top: 4, right: 40, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="h"
            type="number"
            domain={[0, maxH]}
            ticks={xTicks}
            tickFormatter={(v: number) => `${v}`}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-muted)' }}
            label={{ value: 'h', position: 'insideBottomRight', offset: -4, fill: 'var(--text-muted)', fontSize: 10 }}
          />
          {/* Asse sinistro: maturazione % */}
          <YAxis yAxisId="left"
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-muted)' }}
            domain={[0, 100]}
          />
          {/* Asse destro: T impasto °C */}
          <YAxis yAxisId="right" orientation="right"
            domain={[0, 50]}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--state-cold)' }}
            tickFormatter={(v: number) => `${v}°`}
            width={32}
          />
          <Tooltip
            contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
            formatter={(v: number, name: string) =>
              name === 'tempC'
                ? [`${(v as number).toFixed(1)}°C`, 'T impasto']
                : name === 'matPct'
                ? [`${(v as number).toFixed(1)}%`, 'Maturazione']
                : [`${(v as number).toFixed(1)}%`, 'Lievitazione']
            }
            labelFormatter={(l: number) => `t = ${l}h`}
          />
          {/* Posizione attuale */}
          <ReferenceLine yAxisId="left" x={elapsed} stroke="var(--accent-brand)" strokeDasharray="4 4"
            label={{ value: 'ora', position: 'top', fill: 'var(--accent-brand)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
          {/* Target cottura pianificato — allineato con il countdown in header */}
          {targetBakeH != null && (
            <ReferenceLine yAxisId="left" x={targetBakeH} stroke="var(--state-optimal-hi)" strokeWidth={1.5} strokeDasharray="6 2"
              label={{ value: '🍕', position: 'top', fill: 'var(--state-optimal-hi)', fontSize: 11 }} />
          )}
          {/* Soglie maturazione (asse sinistro) */}
          <ReferenceLine yAxisId="left" y={session.alertThreshold ?? 85} stroke="var(--state-optimal-hi)" strokeDasharray="4 4" />
          <ReferenceLine yAxisId="left" y={65} stroke="var(--state-optimal-lo)" strokeDasharray="3 3" />
          {/* Transizioni di fase */}
          {transitions.map(t => (
            <ReferenceLine yAxisId="left" key={t.h} x={t.h} stroke={t.color} strokeDasharray="3 3"
              label={{ value: t.label, position: 'top', fill: t.color, fontSize: 8, fontFamily: 'var(--font-mono)' }} />
          ))}
          {/* Lievitazione (orologio lievito, Gompertz yeast ADU) */}
          <Line yAxisId="left" type="monotone" dataKey="pct" name="pct" stroke="var(--accent-brand)" strokeWidth={2}
            strokeDasharray="5 3" dot={false} activeDot={{ r: 4, fill: 'var(--accent-brand)' }} />
          {/* Maturazione enzimatica (two-clock, fArrhenius Ea=47) */}
          <Line yAxisId="left" type="monotone" dataKey="matPct" name="matPct" stroke="#e6c84a" strokeWidth={2}
            dot={false} activeDot={{ r: 4, fill: '#e6c84a' }} />
          {/* T impasto pianificata (asse destro) */}
          <Line yAxisId="right" type="monotone" dataKey="tempC" name="tempC" stroke="var(--state-cold)" strokeWidth={1.5}
            strokeDasharray="4 2" dot={false} activeDot={{ r: 3, fill: 'var(--state-cold)' }} />
        </LineChart>
      </div>
    </Card>
  );
}

// ─── Malt Badge ───────────────────────────────────────────────────────────────
function MaltBadge({ session }: { session: any }) {
  if (!session.malt) return null;
  const idx = session.effectiveAmylaseIndex ?? 1.0;
  const level = (maltAlertLevel as Function)(idx) as string;
  if (level === 'OK') return null;
  const colors: Record<string, string> = {
    ADVISORY: 'var(--accent-warning)',
    CRITICAL: 'var(--state-critical)',
    BLOCKED:  '#d63031',
  };
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 'var(--radius-sm)',
      background: `${colors[level]}18`, border: `1px solid ${colors[level]}44`,
      fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: colors[level],
    }}>
      ⚗ Malto: idx={idx.toFixed(3)} — {
        level === 'ADVISORY' ? 'Rischio destrinizzazione' :
        level === 'CRITICAL' ? 'Destrinizzazione probabile' :
        'Fuori range modello'
      }
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function DashboardView() {
  const { state, dispatch } = useApp();
  const { setTempAmbient, setPhase } = useTickEngine();
  const now = useClock();

  const session = state.activeSession;
  const ts = state.tickState;

  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Nessuna sessione attiva</span>
      </div>
    );
  }

  const [confirmEnd, setConfirmEnd] = useState(false);

  // Lievitazione live (orologio lievito, Gompertz yeast ADU — reagisce subito ai cambio sessione)
  // Lievitazione: parte BASSA (impasto degassato). Nessun offset iniettato — la
  // biga accelera la cinetica (leavLambda ridotto), non il livello iniziale di gas.
  const heroPrefFrac = Math.min(1, (session.prefermenti ?? [])
    .reduce((s: number, p: any) => s + (p.flourFraction ?? 0) / 100, 0));
  const heroLeavLambda = Math.max(0.3, session.agentLambda * (1 - 0.5 * heroPrefFrac));
  const leaveningPct = (() => {
    const rawAdu = ts?.cumulativeAdu ?? 0;
    try {
      const pct = (gompertz as Function)(rawAdu, session.agentMuMax, heroLeavLambda, session.agentAsymptote) as number;
      return isNaN(pct) ? ((ts as any)?.leaveningPct ?? 0) : Math.min(100, Math.max(0, pct));
    } catch { return (ts as any)?.leaveningPct ?? 0; }
  })();
  // Maturazione enzimatica (two-clock, aggiornata ogni tick ~10s).
  // Fallback pre-tick: offset prefermento (la biga ha già maturato).
  const matPct = ts?.maturationPct ?? ((session.initialMaturationOffset ?? 0) * 100);
  const phase = ts?.phase ?? 'bulk_room';
  const phaseInfo = PHASE_LABELS[phase] ?? { label: phase, color: 'var(--text-secondary)' };

  const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedH = Math.max(0, elapsedMs / 3_600_000);  // guard clock skew
  const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date(session.targetBakeAt ?? Date.now() + 86400_000);
  const remainingH = Math.max(0, (targetBake.getTime() - now.getTime()) / 3_600_000);

  return (
    <div style={{ minHeight: '100dvh', padding: 'var(--padding-v) var(--padding-h)', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            PizzaMatrix
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {session.style?.toUpperCase()} · {session.totalFlourGrams}g
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: phaseInfo.color }}>{phaseInfo.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            +{elapsedH.toFixed(1)}h · {remainingH > 0 ? `${remainingH.toFixed(1)}h ⏳` : '🍕 cottura'}
          </div>
        </div>
      </div>

      {/* ── Hero Maturation ── */}
      <Card elevated>
        {/* Metrica principale full-width — orologio enzimatico (two-clock) */}
        <Metric
          label="Maturazione enzimatica"
          value={matPct.toFixed(1)}
          unit="%"
          color={
            matPct >= 85 ? 'var(--state-optimal-hi)' :
            matPct >= 65 ? 'var(--state-optimal-lo)' :
            matPct >= 30 ? 'var(--state-approaching)' :
            'var(--state-underfermented)'
          }
        />
        <ProgressBar pct={matPct} />
        {matPct >= 85 && (
          <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--state-optimal-hi)', fontFamily: 'var(--font-mono)' }}>
            ✓ Zona ottimale raggiunta
          </div>
        )}
        {/* Metriche secondarie in griglia compatta 3-col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          <Metric label="Lievitaz." value={leaveningPct.toFixed(1)} unit="%" color="var(--accent-brand)" />
          <Metric label="pH" value={(ts?.estimatedPH ?? 5.8).toFixed(2)} color="var(--accent-info)" />
          <Metric label="W att." value={(ts?.W_current ?? session.effectiveW_initial ?? 0).toFixed(0)} color="var(--text-secondary)" />
        </div>
      </Card>

      {/* ── Malt warning ── */}
      <MaltBadge session={session} />

      {/* ── Sweet Spot ── */}
      <SweetSpotCard session={session} ts={ts} remainingH={remainingH} />

      {/* ── Quality Profile ── */}
      <QualityProfileCard session={session} ts={ts} />

      {/* ── W Structure ── */}
      <WStructureCard ts={ts} session={session} />

      {/* ── Gompertz Chart ── */}
      <GompertzChart session={session} ts={ts} />

      {/* ── Temperature ── */}
      <TempCard ts={ts} setTempAmbient={setTempAmbient} />

      {/* ── Acqua impastamento (DDT live) ── */}
      <ImpastoPreparazioneCard session={session} ts={ts} />

      {/* ── Altitude ── */}
      <AltitudeCard altitudeM={session.altitudeM ?? 0} />

      {/* ── Phase Stepper ── */}
      <PhaseStepper currentPhase={phase} onPhaseChange={setPhase} protocol={session.apprettoProtocol} />

      {/* ── Alerts ── */}
      <AlertFeed alerts={state.alerts} onClear={() => dispatch({ type: 'ALERT_CLEAR' })} />

      {/* ── Actions ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: 'rotta' })}>
          🧭 Aggiusta Rotta
        </Btn>
        {confirmEnd ? (
          <>
            <div style={{
              background: 'rgba(214,48,49,0.12)', border: '1px solid rgba(214,48,49,0.35)',
              borderRadius: 'var(--radius-sm)', padding: '10px 14px',
              fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--state-critical)',
            }}>
              ⚠ Vuoi davvero terminare? I dati NON saranno salvati.
            </div>
            <Btn variant="danger" onClick={() => dispatch({ type: 'SESSION_END' })}>
              ■ Conferma Termina
            </Btn>
            <Btn variant="secondary" onClick={() => setConfirmEnd(false)}>
              ← Annulla
            </Btn>
          </>
        ) : (
          <Btn variant="danger" onClick={() => setConfirmEnd(true)}>
            ■ Termina sessione
          </Btn>
        )}
      </div>

    </div>
  );
}
