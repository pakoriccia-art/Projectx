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
  solveNowAnchoredWindow, solveServiceWindow, computeMaxSafeServiceWindow, simulateTimeline,
  SERVICE_WINDOW_DEFAULTS, computeTemperingH, buildServiceWindowTimeline,
} from './serviceWindowSolver.js';
import { fArrhenius, findAduAt, ENZYMATIC_CLOCK_PARAMS } from './engine-v2.4.0.js';

const HOUR_MS = 3_600_000;

function formatDeltaH(absH) {
  const hh = Math.floor(absH);
  const mm = Math.round((absH - hh) * 60);
  if (hh === 0) return `${mm}min`;
  return mm > 0 ? `${hh}h ${mm}min` : `${hh}h`;
}

// ─── Tipi allarme ─────────────────────────────────────────────────────────────
export const ALARM_TYPE = Object.freeze({
  OK:                'OK',
  OK_MARGINE_STRETTO: 'OK_MARGINE_STRETTO',  // mantenuto per compat. (non più usato dal solver)
  SOVRAMMATURAZIONE: 'SOVRAMMATURAZIONE',
  SOTTOMATURAZIONE:  'SOTTOMATURAZIONE',
});

/**
 * Valuta la pianificazione con mixStart = NOW (fisso).
 *
 * Chiama `solveNowAnchoredWindow` che assorbe lo slack rallentando la
 * maturazione (T frigo ↓), non ritardando l'inizio. Se non si rallenta
 * abbastanza, emette SOVRAMMATURAZIONE con opzioni esplicite; se la finestra
 * è troppo corta emette SOTTOMATURAZIONE.
 *
 * @param input   Tutti i parametri di solveNowAnchoredWindow + `now: Date`
 * @returns       Risultato esteso con alarmType + suggestions
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
    style,
    userTargetMaturationPct, overshootTolerance,
    targetMaturationPct   = SERVICE_WINDOW_DEFAULTS.targetMaturationPct,
    bubbleThresholdPct    = SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct,
    thermalServiceTargetC = SERVICE_WINDOW_DEFAULTS.thermalServiceTargetC,
    puntataKickoffH       = SERVICE_WINDOW_DEFAULTS.puntataKickoffH,
    staglioH              = SERVICE_WINDOW_DEFAULTS.staglioH,
    doseRefPct, doseMinPct, doseMaxPct,
    fridgeTempMin = 2,
    subStepH = 0.05,
  } = input;

  const commonInput = {
    now, serviceStart, serviceDurationH,
    ambientTempC, fridgeTempC,
    agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote,
    agentDosePct, W0, hydration, salt, waterHardnessPpm, initialPH,
    totalFlourGrams, numPanetti, containerPreset,
    prefermenti, initialMaturationOffset,
    style, userTargetMaturationPct, overshootTolerance,
    targetMaturationPct, bubbleThresholdPct, thermalServiceTargetC,
    puntataKickoffH, staglioH,
    doseRefPct, doseMinPct, doseMaxPct,
    fridgeTempMin, subStepH,
  };

  // ── Solver now-anchored: mixStart = now ─────────────────────────────────────
  const result = solveNowAnchoredWindow(commonInput);
  const reason = result.infeasibility?.reason;
  const suggestions = [];

  // ── SOVRAMMATURAZIONE: non si riesce a rallentare abbastanza ────────────────
  if (!result.feasible && reason === 'cannot_slow_enough') {
    // Calcola il ritardo minimo necessario con il backward solver (ultima opzione)
    let delayH = null;
    try {
      const backward = solveServiceWindow({
        serviceStart, serviceDurationH, ambientTempC, fridgeTempC,
        agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote,
        agentDosePct, W0, hydration, salt, waterHardnessPpm, initialPH,
        totalFlourGrams, numPanetti, containerPreset,
        prefermenti, initialMaturationOffset,
        targetMaturationPct, bubbleThresholdPct, thermalServiceTargetC,
        puntataKickoffH, staglioH, doseRefPct, doseMinPct, doseMaxPct, subStepH,
      });
      if (backward.feasible && backward.mixStart) {
        const ms = backward.mixStart instanceof Date ? backward.mixStart : new Date(backward.mixStart);
        delayH = Math.max(0, (ms.getTime() - (now instanceof Date ? now.getTime() : now)) / HOUR_MS);
      }
    } catch { /* ignora */ }

    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    if (delayH != null && delayH > 0.25) {
      suggestions.push(`[Ultima opzione] Ritarda l'inizio di ${formatDeltaH(delayH)} (impasta alle ${new Date((now instanceof Date ? now.getTime() : now) + delayH * HOUR_MS).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })})`);
    }

    return { ...result, alarmType: ALARM_TYPE.SOVRAMMATURAZIONE, suggestions, now, delayH };
  }

  // ── SOTTOMATURAZIONE: finestra troppo corta per raggiungere il target ────────
  if (!result.feasible && (reason === 'window_too_short_maturation' || reason === 'window_too_short' || reason === 'cannot_temper')) {
    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    return { ...result, alarmType: ALARM_TYPE.SOTTOMATURAZIONE, suggestions, now };
  }

  // ── W collapse ───────────────────────────────────────────────────────────────
  if (!result.feasible) {
    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    return { ...result, alarmType: ALARM_TYPE.SOVRAMMATURAZIONE, suggestions, now };
  }

  // ── OK: piano realizzabile, mixStart = ADESSO ────────────────────────────────
  const s = result.schedule;
  if (result.fridgeTempAdjusted && result.recommendedFridgeTempC != null) {
    suggestions.push(`Frigo consigliato: ${result.recommendedFridgeTempC}°C (abbassato da ${fridgeTempC}°C per assorbire lo slack)`);
  }
  if (result.dose != null) {
    suggestions.push(`Dose lievito: ${result.dose.toFixed(3)}%`);
  }
  if (s) {
    suggestions.push(`Schedule: puntata ${s.puntataH.toFixed(1)}h · frigo ${s.tcHours.toFixed(1)}h · tempering ${s.temperingH.toFixed(1)}h`);
  }

  return { ...result, alarmType: ALARM_TYPE.OK, suggestions, now };
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
