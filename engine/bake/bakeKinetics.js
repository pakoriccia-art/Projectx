/**
 * PizzaMatrix — Bake Kinetics (v2.4.18, §modulo cottura)
 * =============================================================
 * Step terminale DIAGNOSTICO valutato una sola volta al t_infornata,
 * sullo stato finale già prodotto da simulateTimeline. NON riapre la
 * simulazione, NON itera, NON scrive su `session`, NON crea un orologio
 * ADU "unico" combinato (Two-Clock §2.0): proteolisi ed enzimatico
 * restano grandezze separate con temperature d'arresto distinte.
 *
 * ⚠ Temperature d'arresto PROVVISORIE ma fisicamente fondate.
 * =============================================================
 */

'use strict';

// Temperature d'arresto sequenziale (denaturazione).
export const BAKE_ARREST_C = {
  proteolysis: 55,   // arresto Hill W-decay (proteasi)
  betaAmylase: 70,
  alphaAmylase: 85,  // alpha sopravvive oltre la gelatinizzazione (NON 65)
};

export const PHASE_TRANSITION_C = {
  gelatinization: [58, 64], // amido
  glutenSet:      [70, 80], // coagulazione glutine
};

/**
 * Diagnostico: fotografa lo stato strutturale al lancio in forno.
 * NON modifica alcun accumulatore. Mantiene proteolisi ed enzimatico
 * SEPARATI (Two-Clock §2.0).
 */
export function computeBakeKineticArrest({ W_at_infornata, W_minimo_stesura }) {
  return {
    proteolysisArrestC:   BAKE_ARREST_C.proteolysis,
    betaAmylaseArrestC:   BAKE_ARREST_C.betaAmylase,
    alphaAmylaseArrestC:  BAKE_ARREST_C.alphaAmylase,
    gelatinizationRangeC: PHASE_TRANSITION_C.gelatinization,
    glutenSetRangeC:      PHASE_TRANSITION_C.glutenSet,
    W_at_infornata,
    W_minimo_stesura,
  };
}
