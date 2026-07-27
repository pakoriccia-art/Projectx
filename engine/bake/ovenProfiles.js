/**
 * PizzaMatrix — Oven Profiles (v2.4.18, §modulo cottura)
 * =============================================================
 * Data model hardware del forno. Modulo ADDITIVO, sola lettura
 * rispetto al motore di fermentazione: NON ricalcola la timeline,
 * NON tocca i due orologi (Two-Clock §2.0).
 *
 * ⚠ COSTANTI HARDWARE = IPOTESI DA CALIBRARE (pirometro/datasheet).
 *   Ogni valore termico è marcato `validationStatus: 'hypothesis'`
 *   e isolato per la futura calibration harness. Nessuna falsa
 *   autorità empirica nei numeri.
 * =============================================================
 */

'use strict';

// === ARCHETIPI FORNO — PROVVISORI, da calibrare ===
export const OVEN_ARCHETYPES = {
  domestico_std:       { tMaxC: 250, ramped: true,  dualZone: false, knobScale: null },
  elettrico_pizza:     { tMaxC: 450, ramped: false, dualZone: true,  knobScale: null },
  gas_portatile:       { tMaxC: 450, ramped: false, dualZone: false, knobScale: null },
  legna_prof:          { tMaxC: 485, ramped: false, dualZone: false, knobScale: null },
  fornetto_conchiglia: { tMaxC: 390, ramped: false, dualZone: false, knobScale: 5 },
};
export const OVEN_ARCHETYPES_VALIDATION = 'hypothesis'; // intero blocco da calibrare

// Effusività termica del piano: E = sqrt(k · rho · cp).
// Governa la velocità di trasferimento al fondo (doratura/bruciatura).
// idx = indice relativo normalizzato (acciaio=1.00). Valori PROVVISORI.
export const STONE_EFFUSIVITY = {
  acciaio:                { idx: 1.00 }, // altissima: spinge il fondo, rischio bruciatura su lunghe cotture
  cordierite_refrattaria: { idx: 0.45 }, // media
  biscotto:               { idx: 0.20 }, // bassa: calore dolce e progressivo (es. napoletana, biscotto di Sorrento)
};
export const STONE_EFFUSIVITY_VALIDATION = 'hypothesis';

// Mappatura manopola → °C equivalenti per fornetti a conchiglia (G3 Ferrari ecc.).
// PROVVISORIA. is_modded sblocca input manuale gradi via pirometro.
export const KNOB_TEMP_MAP_SCALE5 = { 1: 180, 2: 240, 3: 300, 4: 350, 5: 390 };
export const KNOB_TEMP_MAP_VALIDATION = 'hypothesis';

/**
 * Risolve la temperatura operativa del forno in °C.
 * Priorità: input manuale (is_modded/pirometro) > mapping manopola > tMax archetipo.
 */
export function resolveOvenTempC(ovenProfile) {
  if (ovenProfile.is_modded && typeof ovenProfile.measuredTmaxC === 'number') {
    return ovenProfile.measuredTmaxC;
  }
  if (ovenProfile.archetipo === 'fornetto_conchiglia' && ovenProfile.knobLevel != null) {
    return KNOB_TEMP_MAP_SCALE5[ovenProfile.knobLevel]
      ?? OVEN_ARCHETYPES[ovenProfile.archetipo].tMaxC;
  }
  if (typeof ovenProfile.targetTmaxC === 'number') return ovenProfile.targetTmaxC;
  return (OVEN_ARCHETYPES[ovenProfile.archetipo] ?? OVEN_ARCHETYPES.domestico_std).tMaxC;
}
