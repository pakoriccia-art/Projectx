/**
 * PizzaMatrix — Planner Alarm Engine (v2.4.15)
 *
 * Valuta in real-time lo stato di una pianificazione finestra-di-servizio
 * rispetto all'orologio reale ("now"). Il solver `solveNowAnchoredWindow` calcola lo
 * schedule ottimale (mixStart a ritroso); questo modulo confronta mixStart con
 * `now` e classifica:
 *
 *   OK                  — mixStart > now + 30min: c'è tempo, inizia fra Xh
 *   OK_MARGINE_STRETTO  — mixStart ≈ now (±30min): inizia ADESSO
 *   SOVRAMMATURAZIONE   — solveServiceWindow non fattibile (maturation_overshoot)
 *   COLLASSO_STRUTTURALE — W decay / LM bolle non gestibile
 *   FINESTRA_TROPPO_CORTA — finestra non sufficiente per reason sconosciuta
 *
 * v2.4.15:
 *   Bug #87 — computeDriftAlarm ora supporta derivazione dinamica plannedMatPct
 *             da session.timeline corrente (computePlannedMatPctAt) eliminando
 *             la desincronizzazione post CONFIRM_PHASE_TRANSITION / Aggiusta Rotta.
 *             Backward-compatible: plannedMatPct statico ancora accettato (v3.1).
 *   Bug #88 — fallback !result.feasible ora usa switch esplicito su reason;
 *             w_collapse → COLLASSO_STRUTTURALE (non più SOVRAMMATURAZIONE);
 *             cause sconosciute → FINESTRA_TROPPO_CORTA.
 *   Bug #89 — now normalizzato a Date in apertura (gestisce Date | number | ISO string).
 *   Bug #90 — import ridotti ai soli usati; destrutturazione + re-pack sostituita
 *             con rest pattern { now: _d, ...commonInput }.
 */

import {
  solveNowAnchoredWindow,
  solveServiceWindow,
  computePlannedMatPctAt,
} from './serviceWindowSolver.js';

const HOUR_MS = 3_600_000;

function formatDeltaH(absH) {
  const hh = Math.floor(absH);
  const mm = Math.round((absH - hh) * 60);
  if (hh === 0) return `${mm}min`;
  return mm > 0 ? `${hh}h ${mm}min` : `${hh}h`;
}

// ─── Tipi allarme ─────────────────────────────────────────────────────────────
export const ALARM_TYPE = Object.freeze({
  OK:                   'OK',
  OK_MARGINE_STRETTO:   'OK_MARGINE_STRETTO',  // mantenuto per compat. (non più usato dal solver)
  SOVRAMMATURAZIONE:    'SOVRAMMATURAZIONE',
  SOTTOMATURAZIONE:     'SOTTOMATURAZIONE',
  COLLASSO_STRUTTURALE: 'COLLASSO_STRUTTURALE', // v2.4.14 — LM/W oltre soglia non gestibile
  FINESTRA_TROPPO_CORTA:'FINESTRA_TROPPO_CORTA',// v2.4.15 Bug #88 — fallback cause sconosciute
});

/**
 * Valuta la pianificazione con mixStart = NOW (fisso).
 *
 * v2.4.15 Bug #89: now normalizzato (Date | number | ISO string).
 * v2.4.15 Bug #90: rest pattern elimina destrutturazione ridondante.
 * v2.4.15 Bug #88: fallback !feasible usa switch su reason — mai SOVRAMMATURAZIONE
 *                  per cause strutturali (w_collapse → COLLASSO_STRUTTURALE).
 */
export function computeNowAnchoredAlarms(input) {
  // Bug #89: normalizza now indipendentemente dal tipo in ingresso (Date | number | ISO string)
  // Bug #10 (v2.4.17): se il parsing produce NaN (stringa ISO malformata), fallback a Date.now()
  const rawNowMs = input.now instanceof Date
    ? input.now.getTime()
    : typeof input.now === 'string'
      ? new Date(input.now).getTime()
      : (input.now ?? Date.now());
  const nowMs = Number.isFinite(rawNowMs) ? rawNowMs : Date.now();
  const now = new Date(nowMs);

  // Bug #90: rest pattern — zero ridondanza, zero rischio typo nel re-pack
  const { now: _discarded, ...commonInput } = input;

  // ── Solver now-anchored: mixStart = now ─────────────────────────────────────
  const result = solveNowAnchoredWindow({ ...commonInput, now });
  const reason = result.infeasibility?.reason;
  const suggestions = [];

  // ── SOVRAMMATURAZIONE: non si riesce a rallentare abbastanza ────────────────
  if (!result.feasible && reason === 'cannot_slow_enough') {
    let delayH = null;
    try {
      const backward = solveServiceWindow(commonInput);
      if (backward.feasible && backward.mixStart) {
        const ms = backward.mixStart instanceof Date ? backward.mixStart : new Date(backward.mixStart);
        delayH = Math.max(0, (ms.getTime() - nowMs) / HOUR_MS);
      }
    } catch { /* ignora */ }

    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    if (delayH != null && delayH > 0.25) {
      suggestions.push(`[Ultima opzione] Ritarda l'inizio di ${formatDeltaH(delayH)} (impasta alle ${new Date(nowMs + delayH * HOUR_MS).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })})`);
    }

    return { ...result, alarmType: ALARM_TYPE.SOVRAMMATURAZIONE, suggestions, now, delayH };
  }

  // ── SOTTOMATURAZIONE: finestra troppo corta per raggiungere il target ────────
  if (!result.feasible && (reason === 'window_too_short_maturation' || reason === 'window_too_short' || reason === 'cannot_temper')) {
    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    return { ...result, alarmType: ALARM_TYPE.SOTTOMATURAZIONE, suggestions, now };
  }

  // ── COLLASSO STRUTTURALE: LM oltre soglia bolle, dose non scalabile (Bug #82b) ─
  if (!result.feasible && reason === 'bubble_threshold_lm_unscalable') {
    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    return { ...result, alarmType: ALARM_TYPE.COLLASSO_STRUTTURALE, suggestions, now };
  }

  // ── Bug #88: fallback esplicito — mai SOVRAMMATURAZIONE per cause strutturali ─
  if (!result.feasible) {
    suggestions.push(...(result.infeasibility?.mitigations ?? []));
    if (reason === 'w_collapse') {
      return { ...result, alarmType: ALARM_TYPE.COLLASSO_STRUTTURALE, suggestions, now };
    }
    // Causa sconosciuta → FINESTRA_TROPPO_CORTA (non SOVRAMMATURAZIONE)
    return { ...result, alarmType: ALARM_TYPE.FINESTRA_TROPPO_CORTA, suggestions, now };
  }

  // ── OK: piano realizzabile, mixStart = ADESSO ────────────────────────────────
  const s = result.schedule;
  const fridgeTempC = commonInput.fridgeTempC ?? 4;
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
 * Drift report: confronta maturazione enzimatica REALE con quella PIANIFICATA.
 *
 * v2.4.15 Bug #87 — supporta derivazione dinamica da session.timeline corrente:
 *   - Se plannedMatPct è fornito: usato direttamente (backward-compat v3.1)
 *   - Se timeline + initialState + opts: computePlannedMatPctAt ricalcola dalla
 *     timeline aggiornata — si re-baseline automaticamente dopo ogni transizione
 *
 * Restituisce forma duale:
 *   { driftPct, driftAlarm }  ← v3.1 DashboardView (invariata)
 *   { plannedMatPct, actualMatPct, suggestion, requiresRebaseline }  ← v4 (additivi)
 *
 * @param params.elapsedH      - ore trascorse dall'avvio sessione
 * @param params.actualMatPct  - maturazione reale % dal tick loop
 * @param params.plannedMatPct - [v3.1] valore statico precomputato dal chiamante
 * @param params.timeline      - [v4]  session.timeline CORRENTE (PhaseSegment[])
 * @param params.initialState  - [v4]  stato iniziale simulazione
 * @param params.opts          - [v4]  opzioni simulateTimeline
 */
export function computeDriftAlarm({ elapsedH, actualMatPct, plannedMatPct, timeline, initialState, opts }) {
  if (actualMatPct == null || !isFinite(elapsedH) || elapsedH < 0.5) return null;

  // Bug #87: calcola plannedMatPct dinamicamente se timeline disponibile
  const planned = plannedMatPct != null
    ? plannedMatPct
    : (timeline ? computePlannedMatPctAt(timeline, initialState, elapsedH, opts) : null);

  if (planned == null) return null;

  const driftPct = parseFloat((actualMatPct - planned).toFixed(1));

  // Forma vecchia per compat. DashboardView v3.1 (driftPct, driftAlarm)
  if (Math.abs(driftPct) <= 5) {
    return {
      driftPct, driftAlarm: null,
      plannedMatPct: planned, actualMatPct, requiresRebaseline: false,
    };
  }

  const isFast = driftPct > 0;
  const severity = Math.abs(driftPct) > 12 ? 'critical' : 'warning';
  const requiresRebaseline = severity === 'critical';

  // Testo base — invariato per v3.1 compat (test PA6)
  const baseSuggestion = isFast
    ? 'Anticipa l\'uscita dal frigo o riduci la temperatura di servizio'
    : 'Posticipa l\'uscita dal frigo o porta le palline in un ambiente più caldo prima del servizio';

  // Suggestion top-level (v4 / Bug #87): CRITICAL → "Aggiusta Rotta"
  const suggestion = requiresRebaseline
    ? 'Drift critico — usa Aggiusta Rotta per ricalcolare la timeline'
    : baseSuggestion;

  // driftAlarm: forma v3.1 — usa baseSuggestion per non rompere DashboardView
  const driftAlarm = {
    type: isFast ? 'AHEAD' : 'BEHIND',
    severity,
    message: isFast
      ? `Maturazione +${driftPct.toFixed(1)}% avanti rispetto al piano (forse T_amb più alta del previsto)`
      : `Maturazione ${driftPct.toFixed(1)}% indietro rispetto al piano (forse T_amb più bassa del previsto)`,
    suggestion: baseSuggestion,
  };

  return {
    // Forma vecchia (v3.1 compat) — type/severity vivono in driftAlarm
    driftPct,
    driftAlarm,
    // Campi v4 aggiuntivi (Bug #87) — non duplicano driftPct/driftAlarm.type
    plannedMatPct:     planned,
    actualMatPct,
    suggestion,
    requiresRebaseline,
  };
}
