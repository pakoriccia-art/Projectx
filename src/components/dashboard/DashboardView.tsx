/**
 * PizzaMatrix — Dashboard v2.4.0
 * Monitoraggio real-time fermentazione: ADU, maturationPct, W_current, pH, T_dough
 * Gompertz chart + sweet spot + alert feed + phase stepper
 */
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { useTickEngine } from '../../hooks/useTickEngine';
import {
  Card, Metric, Btn, ProgressBar, AlertBadge, S,
} from '../ui';
import {
  gompertz, sweetSpot, structuralState,
  computeAltitudeFactor, volumeMilestoneCorrection,
  maltAlertLevel, kEffective, CONTAINER_THERMAL_PRESETS,
} from '../../engine';

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

// ─── Gompertz multi-segmento (temperature-aware per fase) ─────────────────────
// Ogni fase ha la propria temperatura (TA o frigo) → ADU accumula a ritmi diversi.
// La curva si aggiorna quando cambia T_amb, fridgeTempC, o il protocollo.
function buildMultiSegmentData(
  session: {
    apprettoProtocol: string;
    puntataH: number; staglioH: number; apprettoH: number;
    tcHours?: number; fridgeTempC?: number;
    agentEaKj: number; agentType: string;
    agentMuMax: number; agentLambda: number; agentAsymptote: number;
    initialMaturationOffset?: number;
    // Extra fields per warmup progressivo (tc_appreto)
    numPanetti?: number; hydration?: number; containerPreset?: string;
    totalFlourGrams?: number; salt?: number;
  },
  tAmbient: number,
  currentPhase?: string,   // ts.phase — fase attuale (per riscalare segmenti passati)
  elapsedH?: number,       // ts.elapsedH — ore totali trascorse dall'avvio sessione
): { points: { h: number; pct: number }[]; transitions: { h: number; label: string; color: string }[] } {
  const fridgeT = session.fridgeTempC ?? 4;
  const proto   = session.apprettoProtocol ?? 'ta';
  const tcH     = session.tcHours ?? 12;

  type Seg = { durationH: number; tempC: number; label: string; color: string; phase: string };
  const segments: Seg[] =
    proto === 'ta' ? [
      { durationH: session.puntataH,  tempC: tAmbient, label: 'Puntata TA',    color: 'var(--accent-brand)', phase: 'bulk_room'    },
      { durationH: session.staglioH,  tempC: tAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
      { durationH: session.apprettoH, tempC: tAmbient, label: 'Appretto TA',   color: 'var(--accent-brand)', phase: 'proofing'     },
    ]
    : proto === 'tc' ? [
      { durationH: tcH,               tempC: fridgeT,  label: 'Freddo totale', color: 'var(--state-cold)',   phase: 'bulk_fridge'  },
      { durationH: session.staglioH,  tempC: tAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
    ]
    : proto === 'tc_puntata' ? [
      { durationH: tcH,               tempC: fridgeT,  label: 'Puntata TC',    color: 'var(--state-cold)',   phase: 'bulk_fridge'  },
      { durationH: session.staglioH,  tempC: tAmbient, label: 'Staglio',       color: 'var(--text-muted)',   phase: 'balled_room'  },
      { durationH: session.apprettoH, tempC: tAmbient, label: 'Appretto TA',   color: 'var(--accent-brand)', phase: 'proofing'     },
    ]
    : /* tc_appreto */ [
      { durationH: session.puntataH,   tempC: tAmbient, label: 'Puntata TA',  color: 'var(--accent-brand)',       phase: 'bulk_room'    },
      { durationH: session.staglioH,   tempC: tAmbient, label: 'Staglio',     color: 'var(--text-muted)',         phase: 'balled_room'  },
      { durationH: tcH,                tempC: fridgeT,  label: 'Appretto TC', color: 'var(--state-cold)',         phase: 'balled_fridge' },
      // Riscaldo TA: N=5 sub-segmenti con T(t)=tAmb+(fridgeT−tAmb)·exp(−t/τ)
      // per rispecchiare computeRampAdu e coerente con l'engine useTickEngine.
      ...(session.apprettoH > 0 ? (() => {
        const h2  = Math.max(0.01, (session.hydration ?? 65) / 100);
        const cp2 = 4186 * h2 + 1840 * (1 - h2);
        const totalDG2  = (session.totalFlourGrams ?? 1000) * (1 + h2 + (session.salt ?? 2) / 100);
        const panKg2    = totalDG2 / 1000 / Math.max(1, session.numPanetti ?? 6);
        const V2 = panKg2 / 1050;
        const r2 = Math.cbrt((3 * V2) / (4 * Math.PI));
        const A2 = 4 * Math.PI * r2 * r2;
        const tauMult2  = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[session.containerPreset ?? 'bare']?.tauMultiplier ?? 1.0;
        const tau2      = (panKg2 * cp2) / (8 * A2) * tauMult2;  // secondi
        return Array.from({ length: 5 }, (_, i) => {
          const tMid = (i + 0.5) * (session.apprettoH / 5) * 3600;  // s dall'inizio riscaldo
          const T    = tAmbient + (fridgeT - tAmbient) * Math.exp(-tMid / tau2);
          return { durationH: session.apprettoH / 5, tempC: T,
            label: 'Riscaldo TA', color: 'var(--state-approaching)', phase: 'proofing' as const };
        });
      })() : []),
    ];

  // Riscala i segmenti PRECEDENTI alla fase corrente in base al tempo effettivo trascorso.
  // Se l'utente ha avanzato PRIMA del previsto (elapsedH < plannedBefore): comprime i segmenti passati.
  // Se è in ritardo o in linea (elapsedH >= plannedBefore): i segmenti restano invariati.
  if (currentPhase && elapsedH != null && elapsedH > 0) {
    const iCurr = segments.findIndex(s => s.phase === currentPhase);
    if (iCurr > 0) {
      const plannedBefore = segments.slice(0, iCurr).reduce((sum, s) => sum + s.durationH, 0);
      if (plannedBefore > 0.01) {
        const actualBefore = Math.min(elapsedH, plannedBefore);
        const scale = actualBefore / plannedBefore;
        for (let i = 0; i < iCurr; i++) {
          segments[i] = { ...segments[i], durationH: Math.max(0.01, segments[i].durationH * scale) };
        }
      }
    }
  }

  const kRef    = (kEffective as Function)(25, session.agentEaKj, session.agentType) as number;
  const totalH  = segments.reduce((s, seg) => s + seg.durationH, 0);
  const maxH    = Math.max(totalH * 1.5, 24);
  const stepH   = maxH / 80;  // ~80 punti totali

  let cumulativeAdu = (session.initialMaturationOffset ?? 0) * 10;
  const points:      { h: number; pct: number; tempC: number }[] = [];
  const transitions: { h: number; label: string; color: string }[] = [];
  let segStartH = 0;

  for (let si = 0; si < segments.length; si++) {
    const seg  = segments[si];
    const kT   = (kEffective as Function)(seg.tempC, session.agentEaKj, session.agentType) as number;
    const ratio = kRef > 1e-12 ? kT / kRef : 1;
    const segEndH  = segStartH + seg.durationH;
    const nSteps   = Math.max(1, Math.round(seg.durationH / stepH));
    const segStepH = seg.durationH / nSteps;

    for (let i = 1; i <= nSteps; i++) {
      cumulativeAdu += segStepH * ratio;
      const h   = segStartH + i * segStepH;
      const raw = (gompertz as Function)(cumulativeAdu, session.agentMuMax, session.agentLambda, session.agentAsymptote) as number;
      if (isNaN(raw) && import.meta.env.DEV) console.warn('[DashboardChart] gompertz→NaN: ADU=', cumulativeAdu, 'muMax=', session.agentMuMax, 'λ=', session.agentLambda);
      points.push({ h: parseFloat(h.toFixed(2)), pct: isNaN(raw) ? 0 : parseFloat(raw.toFixed(1)), tempC: parseFloat(seg.tempC.toFixed(1)) });
    }

    if (si < segments.length - 1) {
      transitions.push({ h: segEndH, label: seg.label, color: seg.color });
    }
    segStartH = segEndH;
  }

  // Estensione oltre totalH a tAmbient per mostrare il plateau
  const extraH = maxH - totalH;
  if (extraH > 0.1) {
    const kT    = (kEffective as Function)(tAmbient, session.agentEaKj, session.agentType) as number;
    const ratio = kRef > 1e-12 ? kT / kRef : 1;
    const nSteps   = Math.max(1, Math.round(extraH / stepH));
    const extraStepH = extraH / nSteps;
    for (let i = 1; i <= nSteps; i++) {
      cumulativeAdu += extraStepH * ratio;
      const h   = totalH + i * extraStepH;
      const raw = (gompertz as Function)(cumulativeAdu, session.agentMuMax, session.agentLambda, session.agentAsymptote) as number;
      if (isNaN(raw) && import.meta.env.DEV) console.warn('[DashboardChart] gompertz→NaN (tail): ADU=', cumulativeAdu);
      points.push({ h: parseFloat(h.toFixed(2)), pct: isNaN(raw) ? 0 : parseFloat(raw.toFixed(1)), tempC: parseFloat(tAmbient.toFixed(1)) });
    }
  }

  return { points, transitions };
}

// ─── Sweet Spot Card ──────────────────────────────────────────────────────────
// Engine sweetSpot(session, currentAdu, currentTempC) → { status, hoursUntilPeak, peakPct }
// Usa tempAmbient (aggiornato immediatamente dall'utente) non tempDough (inerzia termica).
// remainingH = ore al target cottura pianificato (countdown del clock); usata per TC protocols
// dove la proiezione a temperatura costante darebbe un valore scorretto (impasto freddo).
function SweetSpotCard({ session, ts, remainingH }: { session: any; ts: any; remainingH: number }) {
  const tAmb = ts?.tempAmbient ?? 22;   // reagisce subito al cambio utente
  const spot = useMemo(() => {
    try {
      // Aggiunge offset ADU iniziale da biga/poolish per "ore al picco" corretto
      const effectiveAdu = (ts?.cumulativeAdu ?? 0) + (session.initialMaturationOffset ?? 0) * 10;
      const result = (sweetSpot as Function)(
        session,
        effectiveAdu,
        tAmb,                           // temperatura ambiente corrente
      ) as { status: string; hoursUntilPeak: number; peakPct: number } | null;
      return result;
    } catch { return null; }
  }, [session, ts?.cumulativeAdu, tAmb, session.initialMaturationOffset]);

  if (!spot) return null;

  const isPast    = spot.status === 'past_peak';
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

function QualityProfileCard({ session }: { session: any }) {
  const pl  = session.effectivePl_initial ?? 0.65;
  const hyd = session.hydration ?? 65;
  const W   = session.effectiveW_initial ?? 280;
  const prefs: any[] = session.prefermenti ?? [];
  const proto = session.apprettoProtocol ?? 'ta';
  const style = session.style ?? 'napoletana';

  // ── Estensibilità: bassa P/L + alta idratazione → più estensibile ──────────
  const plScore    = Math.max(0, Math.min(4, (1.2 - pl) / 0.15));
  const hydBonus   = (hyd - 55) / 30;
  const ext = Math.max(1, Math.min(5, Math.round(plScore + hydBonus)));

  // ── Profilo aromatico: dipende da prefermento, protocollo, lievito ──────────
  let aroma = 2.0;
  prefs.forEach((p: any) => {
    if (p.type === 'biga')     aroma += 1.5;
    else if (p.type === 'poolish')  aroma += 1.0;
    else if (p.type === 'riporto')  aroma += 1.2;
  });
  if (proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto') aroma += 0.5;
  if (session.agentType === 'sourdough_wheat') aroma += 0.8;
  const aromaScore = Math.max(1, Math.min(5, Math.round(aroma)));

  // ── Scioglievolezza: idratazione alta + W basso + stile fine ────────────────
  const styleBonus: Record<string, number> = {
    napoletana: 1.2, contemporanea: 0.8, teglia: 0.4, pala: 0.4, nystyle: -0.2,
  };
  const sci = 1 + (hyd - 55) / 30 * 1.5 + (350 - W) / 300 * 1.5 + (styleBonus[style] ?? 0);
  const sciScore = Math.max(1, Math.min(5, Math.round(sci)));

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
        <button onClick={() => setEditMode(e => !e)} style={{
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
    try { return buildMultiSegmentData(session, tAmb, ts?.phase, ts?.elapsedH); }
    catch { return { points: [], transitions: [] }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tAmb, ts?.phase, ts?.elapsedH]);

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
  const maxH     = Math.max(totalH * 1.5, 24);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={S.label}>Curva Gompertz</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {tAmb.toFixed(1)}°C TA · {fridgeT}°C TC · {protoLabel[proto] ?? proto}
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
                : [`${(v as number).toFixed(1)}%`, 'Maturazione']
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
          {/* Curva maturazione Gompertz (asse sinistro) */}
          <Line yAxisId="left" type="monotone" dataKey="pct" stroke="var(--accent-brand)" strokeWidth={2}
            dot={false} activeDot={{ r: 4, fill: 'var(--accent-brand)' }} />
          {/* T impasto pianificata (asse destro) */}
          <Line yAxisId="right" type="monotone" dataKey="tempC" stroke="var(--state-cold)" strokeWidth={1.5}
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

  // Calcola matPct live dal Gompertz: reagisce immediatamente a cambio sessione
  // (e.g. muMax, lambda aggiornati) senza attendere il prossimo ciclo tick (~10s).
  const matPct = (() => {
    const rawAdu = ts?.cumulativeAdu ?? 0;
    const adu = rawAdu + (session.initialMaturationOffset ?? 0) * 10;
    try {
      const pct = (gompertz as Function)(adu, session.agentMuMax, session.agentLambda, session.agentAsymptote) as number;
      return isNaN(pct) ? (ts?.maturationPct ?? 0) : Math.min(100, Math.max(0, pct));
    } catch { return ts?.maturationPct ?? 0; }
  })();
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
        {/* Metrica principale full-width */}
        <Metric
          label="Maturazione"
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
          <Metric label="ADU" value={((ts?.cumulativeAdu ?? 0) + (session.initialMaturationOffset ?? 0) * 10).toFixed(3)} color="var(--text-secondary)" />
          <Metric label="pH" value={(ts?.estimatedPH ?? 5.8).toFixed(2)} color="var(--accent-info)" />
          <Metric label="W att." value={(ts?.W_current ?? session.effectiveW_initial ?? 0).toFixed(0)} color="var(--text-secondary)" />
        </div>
      </Card>

      {/* ── Malt warning ── */}
      <MaltBadge session={session} />

      {/* ── Sweet Spot ── */}
      <SweetSpotCard session={session} ts={ts} remainingH={remainingH} />

      {/* ── Quality Profile ── */}
      <QualityProfileCard session={session} />

      {/* ── W Structure ── */}
      <WStructureCard ts={ts} session={session} />

      {/* ── Gompertz Chart ── */}
      <GompertzChart session={session} ts={ts} />

      {/* ── Temperature ── */}
      <TempCard ts={ts} setTempAmbient={setTempAmbient} />

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
