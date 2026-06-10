/**
 * PizzaMatrix Engine — Bake module (v2.4.18)
 * Wrappa engine/bake/*.js (pure JS) con i tipi TypeScript per l'app.
 * Modulo ADDITIVO/diagnostico: sola lettura rispetto al motore di
 * fermentazione (Two-Clock §2.0 invariato).
 */

// Re-export pure functions / costanti (hypothesis) dai file JS
export {
  OVEN_ARCHETYPES, OVEN_ARCHETYPES_VALIDATION,
  STONE_EFFUSIVITY, STONE_EFFUSIVITY_VALIDATION,
  KNOB_TEMP_MAP_SCALE5, KNOB_TEMP_MAP_VALIDATION,
  resolveOvenTempC,
} from '../../engine/bake/ovenProfiles.js';
export {
  BAKE_ARREST_C, PHASE_TRANSITION_C, computeBakeKineticArrest,
} from '../../engine/bake/bakeKinetics.js';
export {
  STYLE_BAKE_WINDOW_C, STYLE_BAKE_WINDOW_VALIDATION,
  BAKE_HEURISTICS_VALIDATION, validateBakeFeasibility,
} from '../../engine/bake/bakeValidator.js';

// ─── Tipi TypeScript ─────────────────────────────────────────────────────────

export type OvenArchetype =
  | 'domestico_std' | 'elettrico_pizza' | 'gas_portatile'
  | 'legna_prof' | 'fornetto_conchiglia';

export type StoneMaterial = 'acciaio' | 'cordierite_refrattaria' | 'biscotto';

export interface OvenProfile {
  archetipo: OvenArchetype;
  stone: StoneMaterial;
  dualZone: boolean;
  // input temperatura — in ordine di priorità
  is_modded?: boolean;
  measuredTmaxC?: number;   // da pirometro (modded)
  knobLevel?: number;       // 1..knobScale per conchiglia
  targetTmaxC?: number;     // input diretto °C
  bakeTimeS?: number;       // durata cottura prevista in secondi (energia evaporativa)
}

export type BakeReason =
  | 'temp_deficit_evaporative'   // forno troppo freddo per l'idratazione → vapore intrappolato
  | 'w_below_min_at_infornata'   // W al t_infornata < W_minimo_stesura → collasso al lancio
  | 'effusivity_burn_bottom'     // piano troppo "veloce" + cottura lunga → fondo bruciato
  | 'temp_excess_for_style';     // forno più caldo del range stile

export interface BakeKineticArrest {
  proteolysisArrestC: number;   // ~55
  betaAmylaseArrestC: number;   // ~70
  alphaAmylaseArrestC: number;  // ~85 (sopravvive oltre la gelatinizzazione)
  gelatinizationRangeC: [number, number]; // [58, 64]
  glutenSetRangeC: [number, number];      // [70, 80]
  W_at_infornata: number;
  W_minimo_stesura: number;
}

export interface BakeValidationResult {
  feasible: boolean;
  reason?: BakeReason;
  ovenTempC: number;
  advice: string[];                 // suggerimenti ADVISORY, mai applicati automaticamente
  dualZoneSuggestion?: { cieloC: number; plateaC: number };
  kineticArrest: BakeKineticArrest;
}
