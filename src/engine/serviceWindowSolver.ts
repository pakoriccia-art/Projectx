/**
 * PizzaMatrix — Service-Window Solver: re-export TS + tipi
 * Wrappa engine/serviceWindowSolver.js (JS puro) con types per React/TypeScript.
 */
import type { PhaseSegment } from '../db/db';

export * from '../../engine/serviceWindowSolver.js';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface SolveServiceWindowInput {
  serviceStart: Date;
  serviceDurationH: number;
  ambientTempC: number;
  fridgeTempC?: number;
  agentType: string;
  agentEaKj: number;
  agentMuMax: number;
  agentLambda: number;
  agentAsymptote?: number;
  agentDosePct?: number;
  W0?: number;
  hydration?: number;
  salt?: number;
  waterHardnessPpm?: number;
  initialPH?: number;
  totalFlourGrams?: number;
  numPanetti?: number;
  containerPreset?: string;
  prefermenti?: Array<{ flourFraction?: number }>;
  initialMaturationOffset?: number;
  targetMaturationPct?: number;
  bubbleThresholdPct?: number;
  thermalServiceTargetC?: number;
  puntataKickoffH?: number;
  staglioH?: number;
  doseRefPct?: number | null;
  doseMinPct?: number;
  doseMaxPct?: number;
  subStepH?: number;
}

export interface ServiceWindowSchedule {
  puntataH: number;
  staglioH: number;
  tcHours: number;
  temperingH: number;
  serviceDurationH: number;
}

export interface ServiceWindowInfeasibility {
  reason: 'cannot_temper' | 'maturation_overshoot' | 'w_collapse'
    | 'cannot_slow_enough' | 'window_too_short' | 'window_too_short_maturation';
  maxSafeServiceWindowH?: number;
  maturationAtMin?: number;
  maturationAtMax?: number;
  mitigations: string[];
}

export interface SolveServiceWindowResult {
  feasible: boolean;
  mixStart?: Date;
  mixStartIsNow?: boolean;
  recommendedFridgeTempC?: number | null;
  fridgeTempAdjusted?: boolean;
  schedule?: ServiceWindowSchedule;
  dose?: number;
  bubbleCapped?: boolean;
  atServiceStart?: { tempDough: number; maturationPct: number; leaveningPct: number };
  atServiceEnd?: {
    maturationPct: number;
    leaveningPct: number;
    W_current: number;
    structuralStatus: string;
    tempDough: number;
  };
  timeline?: PhaseSegment[];
  bakeTargetElapsedH?: number;
  maxSafeServiceWindowH?: number;
  puntataMaxH?: number;
  effectivePuntataH?: number;
  matWarning?: 'NEAR_CEILING';
  enzymaticMatAtServiceEnd?: number;
  resolvedTargetMaturationPct?: number;
  resolvedBubbleThresholdPct?: number;
  diagnostics?: Record<string, number | string | boolean>;
  infeasibility?: ServiceWindowInfeasibility;
}

/** Input per solveNowAnchoredWindow (mixStart fisso = now) */
export interface SolveNowAnchoredWindowInput extends SolveServiceWindowInput {
  now: Date;
  fridgeTempMin?: number;
  style?: 'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle';
  userTargetMaturationPct?: number;  // range [70, 100] — override manuale
  userBubbleThresholdPct?: number;   // range [75, 100] — override manuale
  overshootTolerance?: number;       // default 2.0
}

export interface SimulateTimelineSample {
  elapsedH: number;
  tempDough: number;
  ambientTempC: number;
  leavAdu: number;
  enzAdu: number;
  leaveningPct: number;
  enzymaticMatPct: number;
  W_current: number;
  wDamage: number;
}

export interface ServiceWindowDefaults {
  bubbleThresholdPct: number;
  thermalServiceTargetC: number;
  targetMaturationPct: number;
  puntataKickoffH: number;
  staglioH: number;
}

// Le funzioni runtime (solveServiceWindow, simulateTimeline, computeTemperingH,
// buildServiceWindowTimeline, computeMaxSafeServiceWindow, SERVICE_WINDOW_DEFAULTS)
// arrivano via `export *` dal modulo JS (non tipizzate, come le altre engine fn).
// Usa `(solveServiceWindow as Function)(...)` e tipizza il risultato con
// SolveServiceWindowResult al call-site, coerentemente con src/engine/index.ts.
