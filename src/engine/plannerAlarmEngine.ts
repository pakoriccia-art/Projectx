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
  /** Ore dal mixStart ottimale a now: >0 = futuro, <0 = ritardo */
  deltaH?: number;
  mixStartOptimal?: Date;
  /** Maturazione stimata a fine servizio nel caso SOTTOMATURAZIONE */
  estimatedFinalMat?: number;
  suggestions: string[];
  now: Date;
  // Campi ereditati da SolveServiceWindowResult:
  mixStart?: Date;
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
  infeasibility?: { reason: string; maxSafeServiceWindowH?: number; mitigations?: string[] };
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
