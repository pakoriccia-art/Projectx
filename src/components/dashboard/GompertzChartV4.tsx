/**
 * PizzaMatrix — GompertzChartV4 (Dashboard v4 exclusive)
 *
 * BUG 1 fix (v2.4.18): now-split realized/projected.
 *   Realized  [0, now]  ← db.process_log  (frozen; slider-independent)
 *   Projected [now, end] ← piecewise sim from live tickState (slider-reactive)
 *
 * Moving the T_amb slider no longer rewrites the historical temperature curve.
 * buildPiecewiseData is a verbatim copy of DashboardView.buildMultiSegmentData
 * (v3.1 — that file must not be touched).
 */
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { PhaseSegment, ProcessLogEntry } from '../../db/db';
import { getSessionLog } from '../../services/processLog';
import { buildHeaderTempString } from '../../engine/outOfProtocol';
import { simulateTimeline } from '../../engine/serviceWindowSolver';
import { ddtForStyle } from '../../data/styleConstraints';
import { Card, S } from '../ui';
import { downsampleLTTB } from '../../lib/lttb';
import {
  gompertz, kEffective, CONTAINER_THERMAL_PRESETS,
  fArrhenius, ENZYMATIC_CLOCK_PARAMS, findAduAt,
} from '../../engine';

// ─── Constants ────────────────────────────────────────────────────────────────
const PX_PER_HOUR = 13;

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  bulk_room:     { label: 'Puntata – TA',  color: 'var(--accent-brand)'       },
  bulk_fridge:   { label: 'Puntata – TC',  color: 'var(--state-cold)'          },
  balled_room:   { label: 'Appretto – TA', color: 'var(--accent-brand)'       },
  balled_fridge: { label: 'Appretto – TC', color: 'var(--state-cold)'          },
  proofing:      { label: 'Lievitazione',  color: 'var(--state-optimal-lo)'   },
  baking:        { label: 'Cottura',       color: 'var(--accent-warning)'      },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type ChartPoint = { h: number; pct: number; matPct: number; tempC: number };
type Transition = { h: number; label: string; color: string };

// ─── buildPiecewiseData (exported for tests) ─────────────────────────────────
// Verbatim copy of DashboardView.buildMultiSegmentData (v3.1).
// Called ONLY for the projected [now, end] portion; the realized part comes
// from db.process_log. Do NOT merge this back into DashboardView.tsx.
export function buildPiecewiseData(
  session: {
    apprettoProtocol: string;
    puntataH: number; staglioH: number; apprettoH: number;
    tcHours?: number; fridgeTempC?: number;
    agentEaKj: number; agentType: string;
    agentMuMax: number; agentLambda: number; agentAsymptote: number;
    initialMaturationOffset?: number;
    numPanetti?: number; hydration?: number; containerPreset?: string;
    totalFlourGrams?: number; salt?: number; initialPH?: number;
    effectiveAmylaseIndex?: number;
    prefermenti?: any[];
    tLaboratorio?: number;
    style?: string;
  },
  tAmbient: number,
  currentPhase?: string,
  elapsedH?: number,
  liveAdu?: number,
  liveEnzAdu?: number,
  timeline?: PhaseSegment[],
  targetBakeH?: number,
  startDoughTempC?: number,
): { points: ChartPoint[]; transitions: Transition[] } {
  const fridgeT = session.fridgeTempC ?? 4;
  const proto   = session.apprettoProtocol ?? 'ta';
  const tcH     = session.tcHours ?? 12;

  const isColdNow   = currentPhase === 'bulk_fridge' || currentPhase === 'balled_fridge';
  const warmAmbient = isColdNow ? (session.tLaboratorio ?? 22) : tAmbient;

  const h2      = Math.max(0.01, (session.hydration ?? 65) / 100);
  const cp2     = 4186 * h2 + 1840 * (1 - h2);
  const totalDG = (session.totalFlourGrams ?? 1000) * (1 + h2 + (session.salt ?? 2) / 100);
  const tauMult = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[session.containerPreset ?? 'bare']?.tauMultiplier ?? 1.0;
  const numPan  = Math.max(1, session.numPanetti ?? 6);

  const computeTauSec = (isBulk: boolean): number => {
    if (isBulk) {
      const massKg = totalDG / 1000;
      const V      = massKg / 1050;
      const r      = Math.cbrt(V / (Math.PI * 0.3));
      const A_lat  = 2 * Math.PI * r * 0.3 * r;
      return (massKg * cp2) / (8 * A_lat) * tauMult;
    } else {
      const panKg = totalDG / 1000 / numPan;
      const V     = panKg / 1050;
      const r     = Math.cbrt((3 * V) / (4 * Math.PI));
      const A     = 4 * Math.PI * r * r;
      return (panKg * cp2) / (8 * A) * tauMult;
    }
  };

  type Seg = { durationH: number; tempC: number; label: string; color: string; phase: string };

  const baseSegs: Seg[] = timeline && timeline.length > 0
    ? timeline.map(seg => ({
        durationH: seg.endElapsedH != null
          ? Math.max(0.01, seg.endElapsedH - seg.startElapsedH)
          : Math.max(0.01, session.apprettoH ?? 4),
        tempC:  (seg.phaseType === 'bulk_fridge' || seg.phaseType === 'balled_fridge')
            ? seg.ambientTempC
            : tAmbient,
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
      ...(session.apprettoH > 0 ? (() => {
        const tauSec2 = computeTauSec(false);
        return Array.from({ length: 5 }, (_, i) => {
          const tMid = (i + 0.5) * (session.apprettoH / 5) * 3600;
          const T    = warmAmbient + (fridgeT - warmAmbient) * Math.exp(-tMid / tauSec2);
          return { durationH: session.apprettoH / 5, tempC: T,
            label: 'Riscaldo TA', color: 'var(--state-approaching)', phase: 'proofing' as const };
        });
      })() : []),
    ];

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

  const transitions: Transition[] = [];
  {
    let th = 0;
    for (let si = 0; si < baseSegs.length - 1; si++) {
      th += baseSegs[si].durationH;
      if (baseSegs[si].label !== 'Riscaldo TA') {
        transitions.push({ h: th, label: baseSegs[si].label, color: baseSegs[si].color });
      }
    }
  }

  const RAMP_N = 3;
  const expandedSegs: Seg[] = [];
  let T_entry = startDoughTempC != null ? startDoughTempC : warmAmbient;

  for (const seg of baseSegs) {
    const tempDiff    = Math.abs(seg.tempC - T_entry);
    const isPreRamped = seg.label === 'Riscaldo TA';

    if (tempDiff > 0.5 && !isPreRamped && seg.durationH >= 0.15) {
      const isBulk = seg.phase === 'bulk_room' || seg.phase === 'bulk_fridge';
      const tauSec  = computeTauSec(isBulk);
      const rampH   = Math.min(seg.durationH * 0.6, (tauSec * 3) / 3600);
      const steadyH = seg.durationH - rampH;

      for (let ri = 0; ri < RAMP_N; ri++) {
        const tMidSec = (ri + 0.5) * (rampH / RAMP_N) * 3600;
        const T = seg.tempC + (T_entry - seg.tempC) * Math.exp(-tMidSec / tauSec);
        expandedSegs.push({ ...seg, durationH: rampH / RAMP_N, tempC: T });
      }
      if (steadyH > 0.01) {
        expandedSegs.push({ ...seg, durationH: steadyH });
      }
    } else {
      expandedSegs.push(seg);
    }
    T_entry = seg.tempC;
  }

  const kRef   = (kEffective as Function)(25, session.agentEaKj, session.agentType) as number;
  const totalH = expandedSegs.reduce((s, seg) => s + seg.durationH, 0);
  const maxH   = Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
  const stepH  = maxH / 80;

  // ── T impasto (v2.4.21): traiettoria REALE del cuore da simulateTimeline ──────
  // Sostituisce la rampa Newton grossa: doughCoreTemp continuo, τ reale per fase.
  // Seed = cuore vivo all'anchor (startDoughTempC) o DDT a t=0 (nuove sessioni).
  // Simula SOLO il piano residuo da elapsedH → giunzione pulita con la serie
  // realizzata (continuità T5). muMaxScaled/leavLambda sono inerti per tempDough.
  const baseTotalH    = baseSegs.reduce((s, seg) => s + seg.durationH, 0);
  const anchorOffsetH = (elapsedH != null && elapsedH > 0) ? elapsedH : 0;
  const simSeed       = startDoughTempC != null ? startDoughTempC : ddtForStyle(session.style);

  const simSegs: Array<{ phaseType: string; durationH: number; ambientTempC: number }> = [];
  {
    let cum = 0;
    for (const seg of baseSegs) {
      const segStart = cum;
      const segEnd   = cum + seg.durationH;
      cum = segEnd;
      const lo = Math.max(segStart, anchorOffsetH);
      const hi = segEnd;
      if (hi - lo > 1e-6) simSegs.push({ phaseType: seg.phase, durationH: hi - lo, ambientTempC: seg.tempC });
    }
    // Coda oltre il piano: traccia l'ambiente vivo invece di clampare al target.
    const tailH = maxH - baseTotalH;
    if (tailH > 0.1) simSegs.push({ phaseType: 'proofing', durationH: tailH, ambientTempC: tAmbient });
  }

  let simSamples: Array<{ elapsedH: number; tempDough: number }> = [];
  try {
    const sim = (simulateTimeline as Function)(
      simSegs,
      { tempDough: simSeed, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 },
      {
        agentEaKj: session.agentEaKj, agentType: session.agentType,
        muMaxScaled: session.agentMuMax, leavLambda: session.agentLambda,
        agentAsymptote: session.agentAsymptote ?? 100,
        W0: 280, hydration: session.hydration ?? 65, salt: session.salt ?? 2,
        amylaseIndex: session.effectiveAmylaseIndex ?? 1.0,   // issue #5 — parita' col tick
        totalFlourGrams: session.totalFlourGrams ?? 1000,
        numPanetti: session.numPanetti ?? 6,
        containerPreset: session.containerPreset ?? 'bare',
        initialPH: session.initialPH ?? 5.8, subStepH: 0.1,
      },
    );
    simSamples = sim?.samples ?? [];
  } catch { simSamples = []; }

  // Cuore [°C] all'ora assoluta h (samples in frame relativo da anchorOffsetH).
  const tempDoughAt = (h: number): number => {
    if (simSamples.length === 0) return simSeed;
    const rel = h - anchorOffsetH;
    if (rel <= simSamples[0].elapsedH) return simSamples[0].tempDough;
    const last = simSamples[simSamples.length - 1];
    if (rel >= last.elapsedH) return last.tempDough;
    for (let i = 1; i < simSamples.length; i++) {
      if (simSamples[i].elapsedH >= rel) {
        const p0 = simSamples[i - 1], p1 = simSamples[i];
        const f  = (rel - p0.elapsedH) / Math.max(1e-9, p1.elapsedH - p0.elapsedH);
        return p0.tempDough + f * (p1.tempDough - p0.tempDough);
      }
    }
    return last.tempDough;
  };

  const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;
  const prefFrac     = Math.min(1, (session.prefermenti ?? [])
    .reduce((s: number, p: any) => s + (p.flourFraction ?? 0) / 100, 0));
  const leavLambda   = Math.max(0.3, session.agentLambda * (1 - 0.5 * prefFrac));
  const enzSeed      = matOffsetPct > 0
    ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
    : 0;

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
  const extraH = maxH - totalH;
  if (extraH > 0.1) integrateSpan(extraH, tAmbient, totalH);

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

  const hasLive        = anchorH > 0 && liveAdu != null && liveEnzAdu != null;
  const rawAduAtAnchor = hasLive ? interpAt(anchorH, 'rawAdu') : 0;
  const rawEnzAtAnchor = hasLive ? interpAt(anchorH, 'rawEnz') : enzSeed;
  const aduScale       = hasLive && rawAduAtAnchor > 1e-9 ? (liveAdu as number) / rawAduAtAnchor : 1;
  const enzAccumAnchor = rawEnzAtAnchor - enzSeed;
  const enzScale       = hasLive && enzAccumAnchor > 1e-9
    ? ((liveEnzAdu as number) - enzSeed) / enzAccumAnchor : 1;
  const futureAduBase  = hasLive ? (liveAdu as number)    : rawAduAtAnchor;
  const futureEnzBase  = hasLive ? (liveEnzAdu as number) : rawEnzAtAnchor;

  const points: ChartPoint[] = [];
  for (const p of rawPts) {
    let adu: number, enz: number;
    if (p.h <= anchorH) {
      adu = p.rawAdu * aduScale;
      enz = enzSeed + (p.rawEnz - enzSeed) * enzScale;
    } else {
      adu = futureAduBase + (p.rawAdu - rawAduAtAnchor);
      enz = futureEnzBase + (p.rawEnz - rawEnzAtAnchor);
    }
    const raw    = (gompertz as Function)(adu, session.agentMuMax, leavLambda, session.agentAsymptote) as number;
    const rawEnz = (gompertz as Function)(enz, ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100) as number;
    if (isNaN(raw) && import.meta.env.DEV) console.warn('[GompertzChartV4] gompertz→NaN: ADU=', adu, 'muMax=', session.agentMuMax, 'λ=', leavLambda);
    points.push({
      h:      parseFloat(p.h.toFixed(2)),
      pct:    isNaN(raw)    ? 0 : parseFloat(raw.toFixed(1)),
      matPct: isNaN(rawEnz) ? 0 : parseFloat(rawEnz.toFixed(1)),
      // v2.4.21: cuore REALE da simulateTimeline (non più il target di segmento).
      tempC:  parseFloat(tempDoughAt(p.h).toFixed(1)),
    });
  }

  return { points, transitions };
}

// ─── buildRealizedSeries (exported for tests) ────────────────────────────────
// Pure function: maps ProcessLog entries + live anchor to chart points.
// tAmb is intentionally NOT a parameter — realized series must be slider-independent.
export function buildRealizedSeries(
  log: ProcessLogEntry[],
  startedAtMs: number,
  elapsedH: number,
  anchorLeaveningPct: number,
  anchorEnzymaticMatPct: number,
  anchorTempDough: number,
): ChartPoint[] {
  const pts: ChartPoint[] = [];

  for (const entry of log) {
    const h = (new Date(entry.recordedAt).getTime() - startedAtMs) / 3_600_000;
    if (h < -0.05 || h > elapsedH + 0.1) continue;
    pts.push({
      h:      parseFloat(h.toFixed(2)),
      pct:    parseFloat((entry.leaveningPct ?? 0).toFixed(1)),
      matPct: parseFloat((entry.enzymaticMatPct ?? entry.maturationPct ?? 0).toFixed(1)),
      tempC:  parseFloat(entry.tempDough.toFixed(1)),
    });
  }

  // Live anchor at elapsedH: captures the most recent tick state and ensures
  // continuity with the projected series that begins at the same elapsedH.
  pts.push({
    h:      parseFloat(elapsedH.toFixed(2)),
    pct:    parseFloat(anchorLeaveningPct.toFixed(1)),
    matPct: parseFloat(anchorEnzymaticMatPct.toFixed(1)),
    tempC:  parseFloat(anchorTempDough.toFixed(1)),
  });

  return pts;
}

// ─── Component ────────────────────────────────────────────────────────────────
// `session.thermalTimeline` è la timeline EFFETTIVA (riconciliata fuori-protocollo):
// il chiamante (DashboardV4) passa già la versione che le 3 viste devono mostrare.
// `horizonH` (v2.4.19 A3): quando valorizzato, accorcia l'orizzonte del grafico al
// piano reale (Σ durate all-TA) invece di estenderlo — overshoot mostrato onestamente.
export function GompertzChartV4({ session, ts, horizonH = null }: {
  session: any; ts: any; horizonH?: number | null;
}) {
  const [log, setLog] = useState<ProcessLogEntry[]>([]);

  // Fetch ProcessLog on mount; refresh every 15 min so new entries appear.
  useEffect(() => {
    if (!session?.id) return;
    const fetch = () => getSessionLog(session.id as number).then(setLog).catch(() => {});
    fetch();
    const id = setInterval(fetch, 15 * 60_000);
    return () => clearInterval(id);
  }, [session?.id]);

  // BUG 2 diagnostic (DEV only): incoherent apprettoProtocol='ta' + balled_fridge in timeline.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (session?.apprettoProtocol !== 'ta' || !Array.isArray(session?.thermalTimeline)) return;
    if ((session.thermalTimeline as PhaseSegment[]).some(s => s.phaseType === 'balled_fridge')) {
      console.warn(
        '[PizzaMatrix BUG-2] apprettoProtocol="ta" ma thermalTimeline contiene balled_fridge. ' +
        'Configurazione incoerente — verificare buildInitialTimeline / apprettoProtocol. ' +
        'Non è un bug del motore: nessun fix automatico applicato.',
        { sessionId: session.id, protocol: session.apprettoProtocol },
      );
    }
  }, [session?.thermalTimeline, session?.apprettoProtocol]);

  const proto    = session.apprettoProtocol ?? 'ta';
  const tAmb     = ts?.tempAmbient ?? 22;
  const elapsedH = ts?.elapsedH ?? 0;

  const startedAt = useMemo(() => (
    session.startedAt instanceof Date
      ? session.startedAt
      : new Date(session.startedAt ?? Date.now())
  ), [session.startedAt]);

  const targetBakeH = useMemo(() => {
    try {
      const tBake = session.targetBakeAt instanceof Date
        ? session.targetBakeAt
        : (session.targetBakeAt ? new Date(session.targetBakeAt) : null);
      if (!tBake) return null;
      const h = (tBake.getTime() - startedAt.getTime()) / 3_600_000;
      return h > 0 ? parseFloat(h.toFixed(2)) : null;
    } catch { return null; }
  }, [session.targetBakeAt, startedAt]);

  // ── Realized series [0, elapsedH] — ProcessLog + live anchor ──────────────
  // tAmb intentionally NOT in deps: slider must not rewrite the realized past.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const realizedPoints = useMemo(
    () => buildRealizedSeries(
      log, startedAt.getTime(), elapsedH,
      ts?.leaveningPct ?? 0,
      ts?.enzymaticMatPct ?? 0,
      ts?.tempDough ?? tAmb,
    ),
    [log, startedAt, elapsedH, ts?.leaveningPct, ts?.enzymaticMatPct, ts?.tempDough],
  );

  // A3: orizzonte effettivo del bake — quando horizonH è dato (caso all-TA accorciato),
  // il target è il piano reale (Σ durate), non un eventuale targetBakeAt lontano.
  const effectiveTargetBakeH = horizonH != null ? horizonH : targetBakeH;

  // ── Projected series (elapsedH, maxH] — slider-reactive ─────────────────
  const { projectedPoints, transitions } = useMemo(() => {
    try {
      const raw = buildPiecewiseData(
        session, tAmb, ts?.phase, elapsedH,
        ts?.cumulativeAdu, ts?.enzymaticAdu,
        session.thermalTimeline, effectiveTargetBakeH ?? undefined,
        ts?.tempDough ?? tAmb,
      );
      return {
        projectedPoints: raw.points.filter(p => p.h > elapsedH),
        transitions: raw.transitions,
      };
    } catch {
      return { projectedPoints: [], transitions: [] };
    }
  }, [session, tAmb, elapsedH, ts?.cumulativeAdu, ts?.enzymaticAdu, ts?.phase, effectiveTargetBakeH]);

  // ── Merged chart data ─────────────────────────────────────────────────────
  const points = useMemo(() => {
    const merged = [...realizedPoints, ...projectedPoints];
    if (merged.length > 200) {
      return downsampleLTTB(
        merged.map(p => ({ x: p.h, y: p.pct, ...p })),
        200,
      ) as ChartPoint[];
    }
    return merged;
  }, [realizedPoints, projectedPoints]);

  // ── Chart dimensions ──────────────────────────────────────────────────────
  // A3: con horizonH (caso all-TA accorciato) l'asse termina a Σ(durate) senza
  // l'estensione 1.5× né l'allungamento al targetBakeAt — l'overshoot resta visibile.
  const totalH = proto === 'ta'
    ? (session.puntataH ?? 8) + (session.staglioH ?? 0.5) + (session.apprettoH ?? 4)
    : proto === 'tc'
    ? (session.tcHours ?? 12) + (session.staglioH ?? 0.5)
    : proto === 'tc_puntata'
    ? (session.tcHours ?? 12) + (session.staglioH ?? 0.5) + (session.apprettoH ?? 4)
    : (session.puntataH ?? 8) + (session.staglioH ?? 0.5) + (session.tcHours ?? 12) + (session.apprettoH ?? 0);
  const maxH     = horizonH != null
    ? Math.max(horizonH, 1)
    : Math.max(totalH * 1.5, 24, targetBakeH != null ? Math.ceil(targetBakeH * 1.1) : 0);
  const chartW   = Math.max(300, Math.round(maxH * PX_PER_HOUR));
  const xTickStep = maxH <= 12 ? 2 : maxH <= 24 ? 4 : 6;
  const xTicks   = Array.from({ length: Math.floor(maxH / xTickStep) + 1 }, (_, i) => i * xTickStep);

  // A1: stringa header generata ESCLUSIVAMENTE dalla timeline effettiva
  // (niente "TC" fantasma se non c'è un segmento frigo reale).
  const headerStr = buildHeaderTempString(session.thermalTimeline ?? [], tAmb);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={S.label}>Lievitazione · Maturazione</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: 'var(--text-muted)' }}>
          {headerStr}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: 'var(--accent-brand)' }}>
          ╌╌ Lievitazione (lievito)
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: '#e6c84a' }}>
          —— Maturazione (enzimatica)
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: 'var(--state-cold)' }}>
          ╌╌ T impasto
        </span>
        {elapsedH > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            · passato congelato · proiezione reattiva
          </span>
        )}
      </div>
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
          <YAxis yAxisId="left"
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-muted)' }}
            domain={[0, 100]}
          />
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
                ? [`${v.toFixed(1)}°C`, 'T impasto']
                : name === 'matPct'
                ? [`${v.toFixed(1)}%`, 'Maturazione']
                : [`${v.toFixed(1)}%`, 'Lievitazione']
            }
            labelFormatter={(l: number) => `t = ${l}h`}
          />
          {/* Linea "ora": separa il passato congelato dal futuro proiettato */}
          <ReferenceLine yAxisId="left" x={elapsedH} stroke="var(--accent-brand)" strokeDasharray="4 4"
            label={{ value: 'ora', position: 'top', fill: 'var(--accent-brand)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
          {effectiveTargetBakeH != null && (
            <ReferenceLine yAxisId="left" x={effectiveTargetBakeH} stroke="var(--state-optimal-hi)" strokeWidth={1.5} strokeDasharray="6 2"
              label={{ value: '🍕', position: 'top', fill: 'var(--state-optimal-hi)', fontSize: 11 }} />
          )}
          <ReferenceLine yAxisId="left" y={session.alertThreshold ?? 85} stroke="var(--state-optimal-hi)" strokeDasharray="4 4" />
          <ReferenceLine yAxisId="left" y={65} stroke="var(--state-optimal-lo)" strokeDasharray="3 3" />
          {transitions.map(t => (
            <ReferenceLine yAxisId="left" key={t.h} x={t.h} stroke={t.color} strokeDasharray="3 3"
              label={{ value: t.label, position: 'top', fill: t.color, fontSize: 8, fontFamily: 'var(--font-mono)' }} />
          ))}
          <Line yAxisId="left" type="monotone" dataKey="pct" name="pct" stroke="var(--accent-brand)" strokeWidth={2}
            strokeDasharray="5 3" dot={false} activeDot={{ r: 4, fill: 'var(--accent-brand)' }} />
          <Line yAxisId="left" type="monotone" dataKey="matPct" name="matPct" stroke="#e6c84a" strokeWidth={2}
            dot={false} activeDot={{ r: 4, fill: '#e6c84a' }} />
          <Line yAxisId="right" type="monotone" dataKey="tempC" name="tempC" stroke="var(--state-cold)" strokeWidth={1.5}
            strokeDasharray="4 2" dot={false} activeDot={{ r: 3, fill: 'var(--state-cold)' }} />
        </LineChart>
      </div>
    </Card>
  );
}
