/**
 * PizzaMatrix — Bake Validator (v2.4.18, §modulo cottura)
 * =============================================================
 * Validatore STILE-vs-HARDWARE. Replica il pattern feasible/reason
 * del solver di fermentazione, ma su un canale SEPARATO: NON entra
 * nella mappa allarmi del planner (computeNowAnchoredAlarms).
 *
 * INVARIANTI:
 *  - Sola lettura: NON muta mai session.hydration / W / style.
 *    Genera solo alert + suggerimenti ADVISORY (testo). Nessuna
 *    backpropagation che riscrive la sessione.
 *  - NON crea orologi ADU combinati; non scrive sugli accumulatori.
 *  - Tutte le soglie numeriche qui sotto sono `validationStatus:'hypothesis'`,
 *    centralizzate per la calibration harness.
 *
 * NB mappatura campi Session reali: `session.hydration` (%) e
 * `session.style` (5-style union). Lo stile espone W_minimo_stesura,
 * temp_forno_range, tempo_cottura_s via getStyleProfile (engine-v2.4.0).
 * =============================================================
 */

'use strict';

import { resolveOvenTempC, STONE_EFFUSIVITY } from './ovenProfiles.js';
import { computeBakeKineticArrest } from './bakeKinetics.js';
import { getStyleProfile } from '../engine-v2.4.0.js';

// ⚠ Range termici indicativi per stile — PROVVISORI (validationStatus:'hypothesis').
//   Finestra di FATTIBILITÀ cottura (più ampia del range ottimale temp_forno_range
//   dello style profile, che resta la fonte per i consigli fini).
export const STYLE_BAKE_WINDOW_C = {
  napoletana:    { min: 430, max: 485, timeMaxS: 90  },
  contemporanea: { min: 380, max: 450, timeMaxS: 120 },
  teglia:        { min: 230, max: 300, timeMaxS: 1200 },
  pala:          { min: 280, max: 340, timeMaxS: 600  },
  nystyle:       { min: 280, max: 320, timeMaxS: 900  },
};
export const STYLE_BAKE_WINDOW_VALIDATION = 'hypothesis';

// ⚠ Euristiche di soglia — PROVVISORIE (validationStatus:'hypothesis').
const HYDRATION_REF_PCT     = 72;   // sopra questa idratazione, il deficit evaporativo non penalizza
const HYDRATION_PENALTY_C   = 4;    // °C di soglia min aggiunti per ogni punto sotto HYDRATION_REF
const EFFUSIVITY_BURN_IDX   = 0.9;  // effusività piano oltre cui la cottura lunga brucia il fondo
const EFFUSIVITY_BURN_TIME_S = 240; // durata oltre cui scatta l'avviso bruciatura fondo
const DUALZONE_PLATEA_HIGH_HYD = 0.82; // platea/cielo per alta idratazione (asimmetrico)
const DUALZONE_PLATEA_STD       = 0.92; // platea/cielo standard
const HIGH_HYDRATION_PCT        = 70;
export const BAKE_HEURISTICS_VALIDATION = 'hypothesis';

/**
 * Valida la fattibilità della cottura per la coppia (stile, hardware).
 * @returns {BakeValidationResult} feasible/reason/ovenTempC/advice/dualZoneSuggestion/kineticArrest
 */
export function validateBakeFeasibility({ session, finalState, ovenProfile }) {
  const ovenTempC = resolveOvenTempC(ovenProfile);
  const style = getStyleProfile(session.style);
  const window = STYLE_BAKE_WINDOW_C[session.style] ?? STYLE_BAKE_WINDOW_C.napoletana;
  const advice = [];
  let feasible = true;
  let reason;

  // (a) Deficit evaporativo — alta idratazione + forno freddo → chewing-gum.
  // La soglia di temperatura minima cresce man mano che l'idratazione scende
  // sotto HYDRATION_REF_PCT (impasti più asciutti tollerano forni più freddi).
  const minTempForHydration =
    window.min - Math.max(0, (HYDRATION_REF_PCT - session.hydration)) * HYDRATION_PENALTY_C;
  if (ovenTempC < minTempForHydration) {
    feasible = false;
    reason = 'temp_deficit_evaporative';
    advice.push(
      `Forno a ${ovenTempC}°C insufficiente per ${session.hydration}% di idratazione su stile ${session.style}: ` +
      `rischio mollica gommosa (vapore saturo intrappolato).`,
      `Opzioni: (1) abbassa l'idratazione, (2) usa un forno più caldo, (3) cambia stile verso uno tollerante a forni domestici.`,
      // ADVISORY: NON applicare alcuna modifica a session.hydration
    );
  }

  // (b) W sotto soglia al lancio → collasso strutturale in forno.
  const W_at_infornata = finalState.W_current;
  if (W_at_infornata < style.W_minimo_stesura) {
    feasible = false;
    reason = reason ?? 'w_below_min_at_infornata';
    advice.push(
      `W residuo al t_infornata (${Math.round(W_at_infornata)}) sotto la soglia di stesura (${style.W_minimo_stesura}): ` +
      `le pareti alveolari cedono prima della coagulazione del glutine.`,
      `Opzioni: anticipa la cottura, sposta ore in frigo (TC) o usa un blend di farine più forte.`,
    );
  }

  // (c) Bruciatura del fondo — piano ad alta effusività + cottura lunga (avviso, non blocca).
  const eff = (STONE_EFFUSIVITY[ovenProfile.stone] ?? STONE_EFFUSIVITY.cordierite_refrattaria).idx;
  const bakeTimeS = ovenProfile.bakeTimeS ?? window.timeMaxS;
  if (eff >= EFFUSIVITY_BURN_IDX && bakeTimeS > EFFUSIVITY_BURN_TIME_S) {
    advice.push(
      `Piano in ${ovenProfile.stone} (effusività alta) con cottura > ${Math.round(EFFUSIVITY_BURN_TIME_S / 60)} min: ` +
      `rischio fondo bruciato. Valuta un piano a effusività più bassa (cordierite/biscotto) o riduci il contatto col fondo.`,
    );
  }

  // (d) Temperatura eccessiva per stili a cottura lunga (avviso).
  if (ovenTempC > window.max && window.timeMaxS > 300) {
    advice.push(`Forno (${ovenTempC}°C) sopra il range tipico per ${session.style}: rischio crosta bruciata, interno crudo.`);
  }

  // (e) Suggerimento ripartizione energetica dual-zone (cielo/platea).
  let dualZoneSuggestion;
  if (ovenProfile.dualZone) {
    const isHighHydration =
      session.hydration >= HIGH_HYDRATION_PCT || session.style === 'teglia' || session.style === 'pala';
    const plateaRatio = isHighHydration ? DUALZONE_PLATEA_HIGH_HYD : DUALZONE_PLATEA_STD;
    dualZoneSuggestion = { cieloC: ovenTempC, plateaC: Math.round(ovenTempC * plateaRatio) };
  }

  return {
    feasible, reason, ovenTempC, advice, dualZoneSuggestion,
    kineticArrest: computeBakeKineticArrest({
      W_at_infornata, W_minimo_stesura: style.W_minimo_stesura,
    }),
  };
}
