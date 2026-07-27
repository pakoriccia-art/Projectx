/**
 * PizzaMatrix — Planner Alarm Engine: re-export TS + tipi
 */
export * from '../../engine/plannerAlarmEngine.js';

// ─── Tipi allarme ────────────────────────────────────────────────────────────

export type AlarmType =
  | 'OK'
  | 'OK_MARGINE_STRETTO'
  | 'SOVRAMMATURAZIONE'
  | 'SOTTOMATURAZIONE'
  | 'COLLASSO_STRUTTURALE'   // v2.4.14 — W decay / LM bolle
  | 'FINESTRA_TROPPO_CORTA'; // v2.4.15 Bug #88 — fallback cause sconosciute

export interface NowAnchoredAlarmResult {
  feasible: boolean;
  alarmType: AlarmType;
  suggestions: string[];
  now: Date;
  // Campi ereditati da SolveNowAnchoredWindowResult:
  mixStart?: Date;
  mixStartIsNow?: boolean;
  recommendedFridgeTempC?: number | null;
  fridgeTempAdjusted?: boolean;
  /** delayH: ore di ritardo minimo (solo SOVRAMMATURAZIONE, ultima opzione) */
  delayH?: number | null;
  schedule?: {
    puntataH: number;
    staglioH: number;
    tcHours: number;
    temperingH: number;
    serviceDurationH: number;
  };
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
  timeline?: import('../db/db').PhaseSegment[];
  bakeTargetElapsedH?: number;
  maxSafeServiceWindowH?: number;
  puntataMaxH?: number;
  effectivePuntataH?: number;
  matWarning?: 'NEAR_CEILING';
  enzymaticMatAtServiceEnd?: number;
  resolvedTargetMaturationPct?: number;
  resolvedBubbleThresholdPct?: number;
  infeasibility?: {
    reason: string;
    maxSafeServiceWindowH?: number;
    maturationAtMin?: number;
    maturationAtMax?: number;
    mitigations?: string[];
  };
}

export interface DriftAlarmResult {
  // ── Forma v3.1 (backward-compat DashboardView) ──────────────────────────────
  driftPct:   number;
  driftAlarm: {
    type:       'AHEAD' | 'BEHIND';
    severity:   'warning' | 'critical';
    message:    string;
    suggestion: string;
  } | null;
  // ── Campi v4 / Bug #87 (additivi; type/severity restano in driftAlarm) ──────
  plannedMatPct:     number;
  actualMatPct:      number;
  suggestion?:       string;
  requiresRebaseline: boolean; // true quando |drift| > 12% → suggerisce Aggiusta Rotta
}
