/**
 * PizzaMatrix — Vincoli per stile pizza (KB §7.x)
 *
 * Costanti centralizzate per ogni stile: range idratazione, DDT target,
 * massimo TC consigliato. Sostituisce le costanti hardcoded e i calcoli
 * dinamici disseminati nel wizard.
 */

export type PizzaStyle = 'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle';

export interface StyleConstraint {
  /** Etichetta italiana. */
  label:       string;
  /** Descrizione sintetica. */
  desc:        string;
  /** Idratazione default %. */
  hydDefault:  number;
  /** Idratazione minima %. */
  hydMin:      number;
  /** Idratazione massima %. */
  hydMax:      number;
  /** DDT target — temperatura impasto a fine impastamento [°C]. */
  ddtTarget:   number;
  /** Ore massime consigliate in TC (frigo). */
  maxTcHours:  number;
}

export const STYLE_CONSTRAINTS: Record<PizzaStyle, StyleConstraint> = {
  napoletana: {
    label:      'Napoletana',
    desc:       'Alta idratazione, cornicione pronunciato',
    hydDefault: 65,
    hydMin:     55,
    hydMax:     70,
    ddtTarget:  24,
    maxTcHours: 24,
  },
  contemporanea: {
    label:      'Contemporanea',
    desc:       'Leggera, alveolatura aperta',
    hydDefault: 72,
    hydMin:     65,
    hydMax:     80,
    ddtTarget:  25,
    maxTcHours: 72,
  },
  teglia: {
    label:      'Teglia',
    desc:       'Molto idratata, soffice',
    hydDefault: 80,
    hydMin:     70,
    hydMax:     90,
    ddtTarget:  27,
    maxTcHours: 48,
  },
  pala: {
    label:      'Pala',
    desc:       'Idratazione alta, croccante',
    hydDefault: 75,
    hydMin:     68,
    hydMax:     85,
    ddtTarget:  26,
    maxTcHours: 48,
  },
  nystyle: {
    label:      'NY Style',
    desc:       'Sottile, grande, robusta',
    hydDefault: 62,
    hydMin:     55,
    hydMax:     68,
    ddtTarget:  23,
    maxTcHours: 72,
  },
};

/** DDT target lookup (sostituisce DDT_BY_STYLE inline). */
export function ddtForStyle(style: string | undefined): number {
  return STYLE_CONSTRAINTS[(style ?? 'napoletana') as PizzaStyle]?.ddtTarget ?? 24;
}

/**
 * Range idratazione effettivo: intersezione tra vincoli di stile e capacità
 * della farina (W). maxSafeHydration_W = 75 + (W − 280) × 0.05.
 */
export function hydrationRangeForStyle(style: string | undefined, effectiveW: number | undefined): { min: number; max: number; default: number } {
  const s = STYLE_CONSTRAINTS[(style ?? 'napoletana') as PizzaStyle] ?? STYLE_CONSTRAINTS.napoletana;
  const wMax = effectiveW != null ? Math.round(75 + (effectiveW - 280) * 0.05) : 90;
  return {
    min:     s.hydMin,
    max:     Math.min(s.hydMax, wMax),
    default: s.hydDefault,
  };
}
