/**
 * PizzaMatrix Engine — Over-Leavening Collapse (v2.4.23)
 * Wrappa engine/structural/collapseModel.js (pure JS) con i tipi TS.
 * Two-Clock §2.0: accoppia SOLO leavAdu↔W_current; enzAdu mai letto/scritto.
 */

export {
  COLLAPSE_ANCHOR, COLLAPSE_W_REF, COLLAPSE_W_EXP, COLLAPSE_CRITICAL_FRAC,
  COLLAPSE_VALIDATION,
  makeLeavAduRateAt, computeCollapseOvershootAdu, collapseToleranceAdu,
  overLeaveningState, worstStructuralState, computeCollapseETA,
} from '../../engine/structural/collapseModel.js';

// ─── Tipi ──────────────────────────────────────────────────────────────────

/** Funzione rate di lievitazione: ADU/ora a una data temperatura. */
export type LeavAduRateAt = (tempC: number, peakState?: unknown) => number;

/** Stato di una sample della trajectory letto dal modello (sola lettura). */
export interface CollapseTrajectoryState {
  elapsedH: number;
  leavAdu: number;
  leaveningPct: number;
  W_current: number;
}

export type StructuralState = 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED';

export type CollapseETAResult =
  | { reachesPeak: false }
  | {
      reachesPeak: true;
      peakTime: number;
      collapseTime: number | null;
      marginH: number | null;
      overshootAduRef: number;
    };

// Le funzioni runtime arrivano dal re-export JS (non tipizzate, come bake.ts /
// serviceWindowSolver.ts). Annota il risultato con CollapseETAResult al call-site.
