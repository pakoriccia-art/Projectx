/**
 * PizzaMatrix — Over-Leavening Collapse Model (v2.4.23, §strutturale)
 * =============================================================
 * Modella il COLLASSO DA SOVRA-LIEVITAZIONE (sbollatura post-picco) che
 * la Gompertz da sola non rappresenta: la lievitazione asintotizza e non
 * crolla mai. Qui il cedimento si esprime come OVERSHOOT di lievitazione
 * in ADU oltre il picco, confrontato con una tolleranza dipendente da W.
 *
 * INVARIANTE TWO-CLOCK (§2.0):
 *  - Accoppia SOLO lievitazione (`leavAdu`) e struttura (`W_current`).
 *  - L'orologio enzimatico (`enzAdu` / `enzymaticMatPct`) NON viene letto
 *    né modificato. Il decadimento proteolitico Hill resta un segnale
 *    SEPARATO (pavimento di stesura a lungo termine).
 *  - Sola lettura sulla trajectory: legge gli stati, non li ricalcola.
 *
 * Nota fisica: il criterio "vero" è lo strain hardening in estensione
 * biassiale (Dobraszczyk-Roberts) — le pareti delle bolle reggono finché
 * incrudiscono, poi rompono. Richiede misura strumentale (inflation test)
 * → raffinamento futuro via calibration harness. La soglia ADU qui è
 * l'approssimazione calibrata sull'osservazione utente.
 *
 * Tutte le costanti sono `validationStatus:'hypothesis'`.
 * =============================================================
 */

'use strict';

import { kEffective, fSaltYeast, amylaseCorrectedRate, SALT_INHIBITION_PARAMS } from '../engine-v2.4.0.js';

// === COSTANTI — validationStatus:'hypothesis', per calibration harness ===
// Unica ancora empirica: contemporanea, ~24°C → collasso ~2h dopo il picco.
// L'overshoot-ADU di collasso NON è hardcodato: si calcola dalla cinetica di
// lievitazione reale (rate a 24°C × 2h), così la soglia in ADU si generalizza
// automaticamente in temperatura (meno ore al caldo, più ore in frigo).
export const COLLAPSE_ANCHOR = { hoursPastPeak: 2, tempC: 24 }; // osservazione contemporanea
export const COLLAPSE_W_REF = 266;   // W di riferimento per lo scaling (hypothesis)
export const COLLAPSE_W_EXP = 1;     // esponente scaling (1 = lineare; tarabile)
export const COLLAPSE_CRITICAL_FRAC = 0.70; // frazione di tolleranza oltre cui CRITICAL
export const COLLAPSE_VALIDATION = 'hypothesis';

/**
 * Factory del rate di lievitazione: RIUSA la cinetica reale del solver
 * (serviceWindowSolver: leavAdu += kRatio·saltYeast·stepH, kRatio = kEff(T)/kEff(25)).
 * Ritorna leavAduRateAt(tempC) = ADU di lievitazione per ora a tempC.
 * Il secondo argomento (peakState) è accettato per compat con la firma dello
 * spec e per futura calibrazione stato-dipendente; non usato nel modello base.
 */
export function makeLeavAduRateAt({ agentEaKj, agentType, salt = 0, amylaseIndex = 1.0, initialPH = 5.8, hydration = SALT_INHIBITION_PARAMS.hydrationRef }) {
  const kRef      = kEffective(25, agentEaKj, agentType);
  const saltYeast = fSaltYeast(salt, hydration);   // issue #11
  return function leavAduRateAt(tempC, _peakState) {
    // issue #5 — la correzione amilasica DEVE esserci anche qui. La tolleranza di
    // collasso e' rate(24 C) x 2h, mentre l'overshoot si legge dalla trajectory
    // prodotta da simulateTimeline: se solo una delle due include l'amilasi, le
    // si confronta con due righelli diversi e marginH sbaglia del fattore
    // amilasico. Includendola in entrambe, il fattore si semplifica e marginH
    // resta invariante — che e' il comportamento corretto.
    const kT     = amylaseCorrectedRate(
      kEffective(tempC, agentEaKj, agentType), amylaseIndex, 0, initialPH);
    const kRatio = kRef > 1e-6 ? Math.min(10, Math.max(0, kT / kRef)) : 0;
    return kRatio * saltYeast; // ADU/ora
  };
}

/**
 * Overshoot-ADU di collasso, ancorato a "hoursPastPeak ore a tempC" (24°C).
 * = rate di lievitazione a 24°C vicino al picco × 2h.
 */
export function computeCollapseOvershootAdu({ leavAduRateAt, peakState }) {
  const rate = leavAduRateAt(COLLAPSE_ANCHOR.tempC, peakState); // ADU/ora a 24°C
  return rate * COLLAPSE_ANCHOR.hoursPastPeak;
}

/**
 * Tolleranza di overshoot scalata per la struttura corrente: impasti più
 * deboli (W minore) collassano prima (tolleranza minore).
 */
export function collapseToleranceAdu(overshootAduRef, W_current) {
  return overshootAduRef * Math.pow(W_current / COLLAPSE_W_REF, COLLAPSE_W_EXP);
}

/**
 * Stato over-lievitazione sul tratto picco→collasso (additivo, separato dalla
 * proteolisi Hill). frac = overshoot / tolleranza.
 *   - OK         : non ancora oltre il picco (overshoot ≤ 0)
 *   - WARNING    : in over-proof (0 < frac < COLLAPSE_CRITICAL_FRAC)
 *   - CRITICAL   : frac ≥ COLLAPSE_CRITICAL_FRAC
 *   - COLLAPSED  : frac ≥ 1
 */
export function overLeaveningState(overshoot, toleranceAdu) {
  if (!(toleranceAdu > 0) || overshoot <= 0) return 'OK';
  const frac = overshoot / toleranceAdu;
  if (frac >= 1)                       return 'COLLAPSED';
  if (frac >= COLLAPSE_CRITICAL_FRAC)  return 'CRITICAL';
  return 'WARNING';
}

const _SEVERITY = { OK: 0, WARNING: 1, CRITICAL: 2, COLLAPSED: 3 };
/**
 * Combina lo stato strutturale da proteolisi (Hill) con quello da
 * sovra-lievitazione: vince il peggiore. Le due cause restano distinte a
 * monte (questo è solo per il semaforo aggregato).
 */
export function worstStructuralState(proteolysisState, overLeavState) {
  const a = _SEVERITY[proteolysisState] ?? 0;
  const b = _SEVERITY[overLeavState]    ?? 0;
  return a >= b ? proteolysisState : overLeavState;
}

/**
 * Trova picco e istante di collasso lungo la trajectory simulata.
 * Riceve la traiettoria già prodotta da simulateTimeline (array di stati con
 * leavAdu, leaveningPct, W_current, elapsedH). NON ricalcola la lievitazione:
 * la legge. Non tocca enzAdu.
 *
 * @returns
 *   { reachesPeak:false }                                  — sotto-proof: mai al picco
 *   { reachesPeak:true, peakTime, collapseTime, marginH }  — collasso entro la finestra
 *   { reachesPeak:true, peakTime, collapseTime:null, marginH:null } — collasso oltre la finestra
 */
export function computeCollapseETA({ trajectory, bubbleThresholdPct, leavAduRateAt }) {
  // 1. picco: primo stato con leaveningPct >= bubbleThresholdPct
  const peakIdx = trajectory.findIndex((s) => s.leaveningPct >= bubbleThresholdPct);
  if (peakIdx === -1) return { reachesPeak: false };

  const peakState = trajectory[peakIdx];
  const overshootAduRef = computeCollapseOvershootAdu({ leavAduRateAt, peakState });

  // 2. collasso: primo stato dopo il picco in cui overshoot >= tolleranza(W corrente)
  for (let i = peakIdx + 1; i < trajectory.length; i++) {
    const s = trajectory[i];
    const overshoot = s.leavAdu - peakState.leavAdu;
    if (overshoot >= collapseToleranceAdu(overshootAduRef, s.W_current)) {
      return {
        reachesPeak: true,
        peakTime: peakState.elapsedH,
        collapseTime: s.elapsedH,
        marginH: s.elapsedH - peakState.elapsedH, // ore picco→collasso a questa T
        overshootAduRef,
      };
    }
  }
  // picco raggiunto ma collasso oltre la finestra simulata
  return {
    reachesPeak: true,
    peakTime: peakState.elapsedH,
    collapseTime: null,
    marginH: null,
    overshootAduRef,
  };
}
