/**
 * PizzaMatrix — Bake Recommendation (v2.4.21, §modulo cottura)
 * =============================================================
 * Da "valida" a "raccomanda": produce temperatura/tempo CONSIGLIATI
 * per la coppia (stile, hardware). L'EFFUSIVITÀ del piano qui è
 * ATTIVA: modula platea consigliata, tempo di cottura e la nota
 * strategica single-zone (fix bug v2.4.18 "materiale ininfluente").
 *
 * INVARIANTI:
 *  - Nessuna mutazione di session: input scalari, output puro.
 *  - Canale ADVISORY: non entra nella mappa allarmi del planner.
 *  - Tutti i coefficienti sono `validationStatus:'hypothesis'`,
 *    centralizzati per la calibration harness.
 * =============================================================
 */

'use strict';

import { STONE_EFFUSIVITY } from './ovenProfiles.js';

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ⚠ Finestre di FATTIBILITÀ cottura per stile — PROVVISORIE (hypothesis).
//   Centralizzate qui (v2.4.21); bakeValidator le ri-esporta per back-compat.
//   v2.4.22: timeMinS (al top della finestra, caldo) / timeMaxS (al fondo, freddo).
export const STYLE_BAKE_WINDOW_C = {
  napoletana:    { min: 430, max: 485, timeMinS: 60,  timeMaxS: 90  },
  contemporanea: { min: 380, max: 450, timeMinS: 90,  timeMaxS: 150 },
  teglia:        { min: 230, max: 300, timeMinS: 600, timeMaxS: 1200 },
  pala:          { min: 280, max: 340, timeMinS: 360, timeMaxS: 600 },
  nystyle:       { min: 280, max: 320, timeMinS: 480, timeMaxS: 900 },
};
export const STYLE_BAKE_WINDOW_VALIDATION = 'hypothesis';

// === COEFFICIENTI PROVVISORI — validationStatus:'hypothesis', centralizzati ===
export const REC_COEFF = {
  timeEffReduction: 0.35, // alta effusività → cottura più corta (fondo cuoce prima)
  plateaBaseDelta: 0.06,  // delta minimo cielo→platea
  plateaEffWeight: 0.18,  // peso effusività sul delta
  plateaHydrWeight: 0.10, // peso idratazione sul delta
};
export const REC_COEFF_VALIDATION = 'hypothesis';

/**
 * Produce la raccomandazione di cottura per la formulazione corrente e l'hardware.
 * @returns {{ targetTempC:number, bakeTimeS:number, cieloC?:number, plateaC?:number,
 *             stoneNote:string, validationStatus:'hypothesis' }}
 */
export function computeBakeRecommendation({ style, ovenTempC, hydration, stone, dualZone }) {
  const w = STYLE_BAKE_WINDOW_C[style] ?? STYLE_BAKE_WINDOW_C.napoletana;
  const eff = (STONE_EFFUSIVITY[stone] ?? STONE_EFFUSIVITY.cordierite_refrattaria).idx; // 0.20 biscotto … 1.00 acciaio

  // Target: il meglio che l'hardware consente dentro la finestra di stile.
  const targetTempC = Math.round(Math.min(ovenTempC, w.max));

  // v2.4.22 — Tempo dipendente dalla temperatura (più caldo → trasferimento
  // più rapido → cottura più corta), poi correzione effusività (secondaria).
  // frac: 0 al fondo finestra (freddo, tempo lungo) → 1 al top (caldo, tempo corto)
  const frac = clamp((targetTempC - w.min) / (w.max - w.min), 0, 1);
  // interpolazione monotòna: frac=1 → timeMinS, frac=0 → timeMaxS
  let bakeTimeS = w.timeMaxS + (w.timeMinS - w.timeMaxS) * frac;
  // correzione effusività (alta effusività → fondo cuoce prima → più corto)
  bakeTimeS = Math.round(bakeTimeS * (1 - REC_COEFF.timeEffReduction * eff));

  // Delta cielo→platea cresce con effusività e idratazione (acciaio+alta idro → platea molto più bassa).
  const hydrFactor = Math.max(0, hydration - 60) / 40; // ~0..0.3
  const deltaFrac = REC_COEFF.plateaBaseDelta
                  + REC_COEFF.plateaEffWeight * eff
                  + REC_COEFF.plateaHydrWeight * hydrFactor;

  const cieloC = targetTempC;
  const plateaC = Math.round(cieloC * (1 - deltaFrac));

  // Nota strategica single-zone, dipendente dal materiale.
  let stoneNote;
  if (eff >= 0.7) {
    stoneNote = `Piano ad alta effusività (${stone}): il fondo prende calore in fretta. Inforna in alto o riduci il contatto col piano a fine cottura; tempo più breve (~${Math.round(bakeTimeS)}s).`;
  } else if (eff >= 0.35) {
    stoneNote = `Piano a media effusività (${stone}): bilanciato. Tempo indicativo ~${Math.round(bakeTimeS)}s.`;
  } else {
    stoneNote = `Piano a bassa effusività (${stone}): calore dolce, fondo protetto. Si presta a cotture più lunghe; alza pure la platea verso il cielo (~${Math.round(bakeTimeS)}s).`;
  }

  return {
    targetTempC,
    bakeTimeS,
    cieloC: dualZone ? cieloC : undefined,
    plateaC: dualZone ? plateaC : undefined,
    stoneNote,
    validationStatus: 'hypothesis',
  };
}
