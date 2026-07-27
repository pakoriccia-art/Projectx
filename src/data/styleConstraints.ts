/**
 * PizzaMatrix — Vincoli per stile pizza (KB §7.x)
 *
 * Costanti centralizzate per ogni stile: range idratazione, DDT target,
 * massimo TC consigliato.
 *
 * ── SORGENTE UNICA DI VERITÀ SULL'IDRATAZIONE (issue #20) ────────────────────
 *
 * Prima di questo modulo esistevano quattro risposte diverse alla stessa
 * domanda "quanta acqua può reggere questo impasto?":
 *
 *   1. STYLE_PROFILES.<stile>.hydration_range   (engine)      napoletana 55.5–62.5
 *   2. STYLE_CONSTRAINTS.hydMin/hydMax          (qui, a mano) napoletana 55–70
 *   3. maxSafeHydration(W, pl, protein)         (engine)      W280 → 58.9 %
 *   4. hydrationRangeForStyle → 75 + (W−280)×0.05             W280 → 75 %
 *
 * Nessuna era dichiarata autoritativa, e la (2) proponeva come default per la
 * napoletana un 65 % fuori dalla finestra della (1). La (3) è stata rimossa
 * (issue #19: era codice morto e bocciava quel default).
 *
 * Ora la gerarchia è esplicita e i numeri vivono in un posto solo:
 *
 *   STYLE_PROFILES.hydration_range / hydration_ott   ← spec di dominio (engine)
 *        │  la finestra in cui lo stile è sé stesso
 *        ▼
 *   banda di input = finestra ± HYDRATION_INPUT_TOLERANCE_PP
 *        │  quanto lasciamo digitare prima di dire "questo non è più lo stile"
 *        ▼
 *   clamp su DOUGH_LIMITS.MIN/MAX_HYDRATION       ← limiti fisici dell'app
 *        │
 *        ▼
 *   cap dalla forza della farina (maxHydrationForW)
 *
 * Fuori dalla finestra ottimale l'input resta ammesso: l'app avvisa, non blocca.
 */

import { STYLE_PROFILES } from '../engine';
import { DOUGH_LIMITS } from '../constants/limits';

export type PizzaStyle = 'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle';

export interface StyleConstraint {
  /** Etichetta italiana. */
  label:       string;
  /** Descrizione sintetica. */
  desc:        string;
  /** Idratazione default % — = STYLE_PROFILES.hydration_ott. */
  hydDefault:  number;
  /** Idratazione minima ammessa in input %. */
  hydMin:      number;
  /** Idratazione massima ammessa in input %. */
  hydMax:      number;
  /** Finestra ottimale dello stile [min, max] % — = STYLE_PROFILES.hydration_range. */
  hydOptimal:  [number, number];
  /** DDT target — temperatura impasto a fine impastamento [°C]. */
  ddtTarget:   number;
  /** Ore massime consigliate in TC (frigo). */
  maxTcHours:  number;
}

/**
 * Tolleranza in punti percentuali concessa oltre la finestra ottimale prima che
 * l'input sia rifiutato. Non è un dato biologico: è una scelta di UX, dichiarata
 * qui una volta invece di essere sparsa in cinque coppie di numeri battute a mano.
 */
export const HYDRATION_INPUT_TOLERANCE_PP = 5;

/**
 * Cap di idratazione dalla forza della farina.
 *
 * ⚠ validationStatus: 'hypothesis'. La formula era inline in
 * hydrationRangeForStyle senza fonte né calibrazione; qui è solo stata nominata
 * e isolata, NON validata. Serve una serie di prove di assorbimento per farla
 * diventare un dato. Finché resta un'ipotesi, agisce solo come tetto morbido.
 */
export const HYDRATION_W_CAP = {
  /** Idratazione di riferimento [%] alla forza di riferimento. */
  refHydration: 75,
  /** Forza alveografica di riferimento. */
  refW:         280,
  /** Punti percentuali di idratazione per unità di W. */
  slope:        0.05,
  validationStatus: 'hypothesis' as const,
};

/** Idratazione massima sostenibile [%] per una farina di forza `W`. */
export function maxHydrationForW(W: number): number {
  const { refHydration, refW, slope } = HYDRATION_W_CAP;
  return refHydration + (W - refW) * slope;
}

/** Solo i campi NON derivabili da STYLE_PROFILES. */
const STYLE_META: Record<PizzaStyle, Pick<StyleConstraint, 'label' | 'desc' | 'ddtTarget' | 'maxTcHours'>> = {
  napoletana: {
    label: 'Napoletana',
    desc:  'Alta idratazione, cornicione pronunciato',
    ddtTarget: 24, maxTcHours: 24,
  },
  contemporanea: {
    label: 'Contemporanea',
    desc:  'Leggera, alveolatura aperta',
    ddtTarget: 25, maxTcHours: 72,
  },
  teglia: {
    label: 'Teglia',
    desc:  'Molto idratata, soffice',
    ddtTarget: 27, maxTcHours: 48,
  },
  pala: {
    label: 'Pala',
    desc:  'Idratazione alta, croccante',
    ddtTarget: 26, maxTcHours: 48,
  },
  nystyle: {
    label: 'NY Style',
    desc:  'Sottile, grande, robusta',
    ddtTarget: 23, maxTcHours: 72,
  },
};

const clampToLimits = (h: number): number =>
  Math.min(DOUGH_LIMITS.MAX_HYDRATION, Math.max(DOUGH_LIMITS.MIN_HYDRATION, h));

function buildConstraint(style: PizzaStyle): StyleConstraint {
  const profile = (STYLE_PROFILES as Record<string, any>)[style];
  const [optLo, optHi] = profile.hydration_range as [number, number];
  const t = HYDRATION_INPUT_TOLERANCE_PP;
  return {
    ...STYLE_META[style],
    hydDefault: profile.hydration_ott as number,
    hydMin:     clampToLimits(optLo - t),
    hydMax:     clampToLimits(optHi + t),
    hydOptimal: [optLo, optHi],
  };
}

export const STYLE_CONSTRAINTS: Record<PizzaStyle, StyleConstraint> = {
  napoletana:    buildConstraint('napoletana'),
  contemporanea: buildConstraint('contemporanea'),
  teglia:        buildConstraint('teglia'),
  pala:          buildConstraint('pala'),
  nystyle:       buildConstraint('nystyle'),
};

/** DDT target lookup (sostituisce DDT_BY_STYLE inline). */
export function ddtForStyle(style: string | undefined): number {
  return STYLE_CONSTRAINTS[(style ?? 'napoletana') as PizzaStyle]?.ddtTarget ?? 24;
}

export interface HydrationRange {
  /** Minimo ammesso in input %. */
  min:      number;
  /** Massimo ammesso in input %, già intersecato col cap della farina. */
  max:      number;
  /** Valore proposto %. */
  default:  number;
  /** Finestra ottimale dello stile [min, max] % — per avvisi, non per bloccare. */
  optimal:  [number, number];
}

/**
 * Range idratazione effettivo: banda di input dello stile ∩ cap dalla forza
 * della farina. Unico punto d'ingresso per la UI — non replicare la formula.
 *
 * `optimal` è la finestra in cui lo stile è sé stesso: usarla per segnalare
 * "fuori stile", mai per impedire l'input.
 */
export function hydrationRangeForStyle(
  style: string | undefined,
  effectiveW: number | undefined,
): HydrationRange {
  const s = STYLE_CONSTRAINTS[(style ?? 'napoletana') as PizzaStyle] ?? STYLE_CONSTRAINTS.napoletana;
  const wMax = effectiveW != null
    ? Math.round(maxHydrationForW(effectiveW))
    : DOUGH_LIMITS.MAX_HYDRATION;
  return {
    min:     s.hydMin,
    // Il cap della farina non può scendere sotto il minimo dello stile: una
    // farina debole restringe la banda, non la annulla.
    max:     Math.max(s.hydMin, Math.min(s.hydMax, wMax)),
    default: s.hydDefault,
    optimal: s.hydOptimal,
  };
}
