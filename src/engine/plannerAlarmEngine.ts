/**
 * PizzaMatrix — Planner Alarm Engine: re-export TS + tipi
 */
export * from '../../engine/plannerAlarmEngine.js';

// ─── Tipi allarme ────────────────────────────────────────────────────────────

export type AlarmType =
  | 'OK'
  | 'OK_MARGINE_STRETTO'
  | 'SOVRAMMATURAZIONE'
  | 'SOTTOMATURAZIONE';

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
  infeasibility?: {
    reason: string;
    maxSafeServiceWindowH?: number;
    maturationAtMin?: number;
    maturationAtMax?: number;
    mitigations?: string[];
  };
}

export interface DriftAlarmResult {
  driftPct: number;
  driftAlarm: {
    type: 'AHEAD' | 'BEHIND';
    severity: 'warning' | 'critical';
    message: string;
    suggestion: string;
  } | null;
}
