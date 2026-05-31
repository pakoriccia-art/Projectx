/**
 * PizzaMatrix — Planner Alarm Engine (v2.4.3)
 *
 * Valuta in real-time lo stato di una pianificazione finestra-di-servizio
 * rispetto all'orologio reale ("now"). Il solver `solveServiceWindow` calcola lo
 * schedule ottimale (mixStart a ritroso); questo modulo confronta mixStart con
 * `now` e classifica:
 *
 *   OK                  — mixStart > now + 30min: c'è tempo, inizia fra Xh
 *   OK_MARGINE_STRETTO  — mixStart ≈ now (±30min): inizia ADESSO
 *   SOTTOMATURAZIONE    — mixStart < now: si era in ritardo, meno tempo dell'ottimale
 *   SOVRAMMATURAZIONE   — solveServiceWindow non fattibile (maturation_overshoot)
 *
 * Fornisce suggerimenti quantificati (dose, T_frigo, sale, durata servizio) per
 * ogni allarme. Non modifica i parametri calibrati del motore.
 *
 * Leve disponibili (separazione garantita dal two-clock):
 *   - dose lievito      → scala SOLO muMax lievitazione (non tocca orologio enzimatico)
 *   - T_frigo           → rallenta/accelera entrambi gli orologi in frigo
 *   - % sale            → riduce kEffective (lievitazione) e allunga tCrit (W)
 *   - durata servizio   → riduce/aumenta la finestra a TA
 */

import {
  solveServiceWindow, computeMaxSafeServiceWindow, simulateTimeline,
  SERVICE_WINDOW_DEFAULTS, computeTemperingH, buildServiceWindowTimeline,
} from './serviceWindowSolver.js';
import { fArrhenius, findAduAt, ENZYMATIC_CLOCK_PARAMS } from './engine-v2.4.0.js';

const HOUR_MS = 3_600_000;

// ─── Tipi allarme ─────────────────────────────────────────────────────────────
export const ALARM_TYPE = Object.freeze({
  OK:                'OK',
  OK_MARGINE_STRETTO: 'OK_MARGINE_STRETTO',
  SOVRAMMATURAZIONE: 'SOVRAMMATURAZIONE',
  SOTTOMATURAZIONE:  'SOTTOMATURAZIONE',
});

// Soglie
const THRESHOLD_TIGHT_H    = 0.5;   // entro 30min → MARGINE_STRETTO
const THRESHOLD_LATE_H     = 0.5;   // oltre 30min in ritardo → SOTTOMATURAZIONE

function formatDeltaH(absH) {
  const hh = Math.floor(absH);
  const mm = Math.round((absH - hh) * 60);
  if (hh === 0) return `${mm}min`;
  return mm > 0 ? `${hh}h ${mm}min` : `${hh}h`;
}

// ─── Stima deficit maturazione per avvio in ritardo ──────────────────────────
// Approssimazione analitica: tempo mancante × rate enzimatico a T_amb → ΔADU
// → δ% = gompertz(ADU_opt − δADU) − gompertz(ADU_opt)  ≈ ΔADU × derivata
// Per semplicità: δ% ≈ ΔADU / (ADU_target * 0.1) * 5  (euristica calibrata)
function estimateMaturationDeficit(lateH, ambientTempC, targetMatPct) {
  const deltaAdu = fArrhenius(ambientTempC) * lateH;
  const aduTarget = findAduAt(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, targetMatPct);
  // Derivata Gompertz al target ≈ muMax*e/100 * (1−m/100) * m/100  (appross.)
  const m = targetMatPct / 100;
  const deriv = ENZYMATIC_CLOCK_PARAMS.muMax * Math.E / 100 * (1 - m) * m * 100;
  return Math.min(20, deltaAdu * deriv);
}

// ─── Suggerimento T_frigo per rallentare (nel caso SOVRAMMATURAZIONE) ─────────
// Bisect monotono: upstreamEnzAtT(fridgeT) = target; result ∈ [fridgeTempMin, fridgeTempC]
function suggestLowerFridgeTemp(opts, solverResult, fridgeTempMin = 2) {
  const { ambientTempC, fridgeTempC, salt = 0, W0 = 280, hydration = 65, agentEaKj, agentType, agentMuMax, agentLambda, agentAsymptote = 100, agentDosePct, totalFlourGrams = 1000, numPanetti = 1, containerPreset = 'bare', waterHardnessPpm, initialPH = 5.8, puntataKickoffH = SERVICE_WINDOW_DEFAULTS.puntataKickoffH, staglioH = SERVICE_WINDOW_DEFAULTS.staglioH, subStepH = 0.05 } = opts;
  const { schedule } = solverResult;
  if (!schedule) return null;
  const puntataH = schedule.puntataH;
  const tcH      = schedule.tcHours;
  if (tcH < 0.5) return null;  // troppo poco tempo in frigo per fare differenza

  const prefFrac = 0;
  const leavLambda = Math.max(0.3, agentLambda * (1 - 0.5 * prefFrac));
  const muMaxScaled = agentMuMax;  // dose-independent for this check

  const baseOpts = { agentEaKj, agentType, muMaxScaled, leavLambda, agentAsymptote, W0, hydration, salt, waterHardnessPpm, initialPH, totalFlourGrams, numPanetti, containerPreset, subStepH };

  const enzAtFridgeT = (tf) => {
    const segs = [
      { phaseType: 'bulk_room',     durationH: puntataH, ambientTempC },
      { phaseType: 'balled_room',   durationH: staglioH, ambientTempC },
      { phaseType: 'balled_fridge', durationH: tcH,      ambientTempC: tf },
    ];
    const sim = simulateTimeline(segs, { tempDough: ambientTempC, leavAdu: 0, enzAdu: 0, wDamage: 0 }, baseOpts);
    return sim.final.enzymaticMatPct;
  };

  // We want enzAtFridgeT(tf) = targetMatPct (SERVICE_WINDOW_DEFAULTS.targetMaturationPct = 90%)
  // At tf=fridgeTempC: result = solverResult.atServiceEnd.maturationPct ≈ 90% (already)
  // So lowering T_frigo makes it < 90% when totalUpstreamH is the SAME
  // This only makes sense if the OVERSHOOT is in the tail
  const target = SERVICE_WINDOW_DEFAULTS.targetMaturationPct;
  const atMin = enzAtFridgeT(fridgeTempMin);
  const atCur = enzAtFridgeT(fridgeTempC);
  if (atMin >= target) return null;  // even min fridge temp already exceeds target — no help
  if (atCur <= target) return null;  // already at or below target — no problem

  // Bisect
  let a = fridgeTempMin, b = fridgeTempC;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (enzAtFridgeT(m) < target) a = m; else b = m;
  }
  return parseFloat(((a + b) / 2).toFixed(1));
}

/**
 * Valuta lo stato della pianificazione rispetto a "now".
 * Chiama `solveServiceWindow` internamente e aggiunge alarmType + suggestions.
 *
 * @param input   Tutti i parametri di solveServiceWindow + `now: Date`
 * @returns       SolveServiceWindowResult esteso con alarmType + suggestions
 */
export function computeNowAnchoredAlarms(input) {
  const {
    now = new Date(),
    serviceStart, serviceDurationH,
    ambientTempC, fridgeTempC = 4,
    agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote = 100,
    agentDosePct = 0.3,
    W0 = 280, hydration = 65, salt = 0, waterHardnessPpm, initialPH = 5.8,
    totalFlourGrams = 1000, numPanetti = 1, containerPreset = 'bare',
    prefermenti = [], initialMaturationOffset = 0,
    targetMaturationPct   = SERVICE_WINDOW_DEFAULTS.targetMaturationPct,
    bubbleThresholdPct    = SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct,
    thermalServiceTargetC = SERVICE_WINDOW_DEFAULTS.thermalServiceTargetC,
    puntataKickoffH       = SERVICE_WINDOW_DEFAULTS.puntataKickoffH,
    staglioH              = SERVICE_WINDOW_DEFAULTS.staglioH,
    doseRefPct, doseMinPct, doseMaxPct,
    fridgeTempMin = 2,
    subStepH = 0.05,
  } = input;

  const solverInput = {
    serviceStart, serviceDurationH,
    ambientTempC, fridgeTempC,
    agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote,
    agentDosePct, W0, hydration, salt, waterHardnessPpm, initialPH,
    totalFlourGrams, numPanetti, containerPreset,
    prefermenti, initialMaturationOffset,
    targetMaturationPct, bubbleThresholdPct, thermalServiceTargetC,
    puntataKickoffH, staglioH,
    doseRefPct, doseMinPct, doseMaxPct,
    subStepH,
  };

  // ── Step 1: solver ottimale a ritroso ──────────────────────────────────────
  const optimal = solveServiceWindow(solverInput);

  if (!optimal.feasible) {
    const reason = optimal.infeasibility?.reason;
    const alarmType = ALARM_TYPE.SOVRAMMATURAZIONE;

    const suggestions = [...(optimal.infeasibility?.mitigations ?? [])];

    // Per maturation_overshoot: suggerisci T_frigo più bassa (non applicabile a tail TA,
    // ma utile se l'overshoot è dovuto a troppa maturazione in frigo)
    if (reason === 'maturation_overshoot') {
      // Closed-form: servizio più breve che sarebbe sostenibile
      const maxSafe = optimal.infeasibility?.maxSafeServiceWindowH;
      if (maxSafe != null && maxSafe > 0) {
        suggestions.unshift(`Riduci durata servizio a ≤ ${maxSafe.toFixed(1)}h per rientrare nel margine`);
      }
    }

    return { ...optimal, alarmType, suggestions, now };
  }

  // ── Step 2: confronta mixStart ottimale con now ────────────────────────────
  const mixStartOpt = optimal.mixStart instanceof Date ? optimal.mixStart : new Date(optimal.mixStart);
  const deltaH = (mixStartOpt.getTime() - now.getTime()) / HOUR_MS;
  // deltaH > 0: ancora tempo (start in futuro)
  // deltaH < 0: in ritardo rispetto all'ottimale

  const suggestions = [];

  // ── Case A: OK (start nel futuro, oltre soglia) ────────────────────────────
  if (deltaH >= THRESHOLD_TIGHT_H) {
    suggestions.push(`Inizia a impastare tra ${formatDeltaH(deltaH)}`);
    if (optimal.dose != null) suggestions.push(`Dose consigliata: ${optimal.dose.toFixed(3)}%`);
    const s = optimal.schedule;
    if (s) {
      const fridgeExitH = s.puntataH + s.staglioH + s.tcHours;
      const fridgeExitMs = mixStartOpt.getTime() + fridgeExitH * HOUR_MS;
      const fridgeExitFromNow = (fridgeExitMs - now.getTime()) / HOUR_MS;
      suggestions.push(`Esci dal frigo tra ${formatDeltaH(fridgeExitFromNow)} (dopo puntata+staglio+TC)`);
    }
    return { ...optimal, alarmType: ALARM_TYPE.OK, deltaH: parseFloat(deltaH.toFixed(2)), mixStartOptimal: mixStartOpt, suggestions, now };
  }

  // ── Case B: MARGINE_STRETTO (start ≈ now) ─────────────────────────────────
  if (deltaH >= -THRESHOLD_TIGHT_H) {
    const label = deltaH >= 0 ? `fra ${formatDeltaH(deltaH)}` : `${formatDeltaH(-deltaH)} fa (inizia subito)`;
    suggestions.push(`Momento ottimale: ${label} — inizia ORA`);
    if (optimal.dose != null) suggestions.push(`Dose: ${optimal.dose.toFixed(3)}%`);
    if (optimal.schedule) {
      const s = optimal.schedule;
      suggestions.push(`Schedule: puntata ${s.puntataH.toFixed(1)}h · TC ${s.tcHours.toFixed(1)}h · tempering ${s.temperingH.toFixed(1)}h`);
    }
    return { ...optimal, alarmType: ALARM_TYPE.OK_MARGINE_STRETTO, deltaH: parseFloat(deltaH.toFixed(2)), mixStartOptimal: mixStartOpt, suggestions, now };
  }

  // ── Case C: SOTTOMATURAZIONE (in ritardo) ─────────────────────────────────
  const lateH = -deltaH;  // ore in ritardo
  const deficitPct = estimateMaturationDeficit(lateH, ambientTempC, targetMaturationPct);
  const estimatedFinalMat = Math.max(60, targetMaturationPct - deficitPct);

  suggestions.push(`Avvio in ritardo di ${formatDeltaH(lateH)} rispetto all'ottimale`);
  suggestions.push(`Maturazione stimata a fine servizio: ~${estimatedFinalMat.toFixed(0)}% (target ${targetMaturationPct}%)`);

  // Mitigation A: riduci durata servizio per compensare (meno esposizione a TA)
  if (optimal.maxSafeServiceWindowH != null && optimal.maxSafeServiceWindowH < serviceDurationH) {
    suggestions.push(`Riduci la durata servizio a ${Math.max(0.5, (serviceDurationH - lateH * 0.5)).toFixed(1)}h per compensare il ritardo`);
  }

  // Mitigation B: dose ridotta (rallenta lievitazione, nessun effetto su maturazione)
  if (optimal.dose != null && optimal.dose > (doseMinPct ?? agentDosePct * 0.1)) {
    const suggestedDose = Math.max(doseMinPct ?? agentDosePct * 0.1, optimal.dose * 0.8);
    suggestions.push(`↓ dose a ${suggestedDose.toFixed(3)}% per rallentare la lievitazione durante il ritardo`);
  }

  // Mitigation C: sale per protezione W (rallenta proteolisi)
  const saltMax = 3.5;
  if (salt < saltMax) {
    const saltSugg = Math.min(saltMax, salt + 0.5);
    suggestions.push(`↑ sale a ${saltSugg.toFixed(1)}% (da ${salt.toFixed(1)}%) per rallentare la proteolisi e proteggere la struttura`);
  }

  // Per la card: usiamo il risultato ottimale ma con alarmType SOTTOMATURAZIONE
  return {
    ...optimal,
    alarmType: ALARM_TYPE.SOTTOMATURAZIONE,
    deltaH: parseFloat(deltaH.toFixed(2)),
    mixStartOptimal: mixStartOpt,
    estimatedFinalMat: parseFloat(estimatedFinalMat.toFixed(1)),
    suggestions,
    now,
  };
}

/**
 * Drift report: confronta la maturazione enzimatica REALE (dal tick engine)
 * con quella PIANIFICATA (simulazione della ThermalTimeline con T_pianificate).
 * Ritorna delta% e allarme se |drift| > 5%.
 *
 * @param elapsedH         ore trascorse dall'avvio sessione (ts.elapsedH)
 * @param actualMatPct     maturazione reale % (ts.enzymaticMatPct)
 * @param thermalTimeline  PhaseSegment[] (session.thermalTimeline)
 * @param plannedMatPct    maturazione pianificata al tempo elapsedH (precomputata dal chiamante)
 * @returns                { driftPct, driftAlarm } o null se dati insufficienti
 */
export function computeDriftAlarm({ elapsedH, actualMatPct, plannedMatPct }) {
  if (actualMatPct == null || plannedMatPct == null || !isFinite(elapsedH) || elapsedH < 0.5) return null;

  const driftPct = parseFloat((actualMatPct - plannedMatPct).toFixed(1));

  if (Math.abs(driftPct) <= 5) return { driftPct, driftAlarm: null };

  const isFast = driftPct > 0;
  const severity = Math.abs(driftPct) > 12 ? 'critical' : 'warning';

  const driftAlarm = {
    type: isFast ? 'AHEAD' : 'BEHIND',
    severity,
    message: isFast
      ? `Maturazione +${driftPct.toFixed(1)}% avanti rispetto al piano (forse T_amb più alta del previsto)`
      : `Maturazione ${driftPct.toFixed(1)}% indietro rispetto al piano (forse T_amb più bassa del previsto)`,
    suggestion: isFast
      ? 'Anticipa l\'uscita dal frigo o riduci la temperatura di servizio'
      : 'Posticipa l\'uscita dal frigo o porta le palline in un ambiente più caldo prima del servizio',
  };

  return { driftPct, driftAlarm };
}
