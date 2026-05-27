/**
 * PizzaMatrix Engine — TypeScript re-export + tipi
 * Wrappa engine-v2.4.0.js (pure JS) con types per l'app React/TypeScript
 */

// Re-export tutto dall'engine JS
export * from '../../engine/engine-v2.4.0.js';

// ─── Tipi TypeScript per le funzioni principali ──────────────────────────────

export type AgentType = 'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat';
export type ContainerPreset = 'bare' | 'film' | 'open_box' | 'glass_covered' | 'plastic_bag' | 'closed_box' | 'closed_box_double';
export type StructuralStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED';
export type MaltAlertLevel = 'OK' | 'ADVISORY' | 'CRITICAL' | 'BLOCKED';
export type DoughPhase = 'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking';
export type PrefermType = 'poolish' | 'biga' | 'autolysis';

export interface DashboardWResult {
  W_current:        number;
  W_initial:        number;
  decayPct:         number;
  tRatio:           number;
  tCritHours:       number;
  structuralStatus: StructuralStatus;
  breakdown: {
    prefermenti: Array<{
      id:        string;
      type:      PrefermType;
      fraction:  number;
      W_initial: number;
      label:     string;
    }>;
    rinfresco: {
      fraction:  number;
      W_initial: number;
    };
  };
}

export interface CombinedInitialState {
  effectiveW_initial:      number;
  effectivePl_initial:     number;
  effectiveProtein:        number;
  effectiveAsh:            number;
  effectiveAmylaseIndex:   number;
  initialMaturationOffset: number;
  initialPH:               number;
  rinfrescoFraction:       number;
  breakdown: {
    prefermenti: Array<{
      id:                  string;
      type:                PrefermType;
      fraction:            number;
      W_contrib:           number;
      pl_contrib:          number;
      protein_contrib:     number;
      ash_contrib:         number;
      amylase_contrib:     number;
      denaturation_factor: number;
      mat_contrib:         number;
      pH:                  number;
    }>;
    rinfresco: {
      fraction:        number;
      W_contrib:       number;
      pl_contrib:      number;
      protein_contrib: number;
      ash_contrib:     number;
      amylase_contrib: number;
      pH:              number;
    };
  };
}

export interface ReverseScalingResult {
  totalFlourKg:     number;
  rinfrescoFlourKg: number;
  rinfrescoWaterKg: number;
  totalDoughKg:     number;
  numPanetti:       number;
  panWeight:        number;
  prefermType:      PrefermType;
}

export interface SweetSpotResult {
  status:           'upcoming' | 'past_peak';
  hoursUntilPeak:   number;
  peakPct:          number;
}

// ─── Bilancio Termico Acqua di Impastamento (§2.7 DDT) ───────────────────────

/** Metodo di impastamento: determina il coefficiente di attrito C_attrito. */
export type KneadingMethod = 'hand' | 'spiral' | 'planetary' | 'diving_arm';

export interface KneadingMethodSpec {
  /** Etichetta italiana breve. */
  label:        string;
  /** Limite inferiore C_attrito [°C] — sessione leggera / bassa velocità. */
  cFrictionLo:  number;
  /** Limite superiore C_attrito [°C] — sessione intensa / alta velocità. */
  cFrictionHi:  number;
  /** Valore medio consigliato [°C]. */
  cFrictionMid: number;
  /** Note tecniche. */
  notes:        string;
}

/**
 * Coefficienti di attrito meccanico per categoria di impastatrice — §2.7
 *
 * C_attrito [°C] = aumento totale di temperatura dell'impasto per effetto
 * dell'energia meccanica, in una sessione tipica da pizzeria (10–15 min
 * a regime per 1–5 kg di farina).
 *
 * Fonte: consensus letteratura professionale italiana e internazionale:
 *   • Calvel R. (1994) "Le Goût du Pain" — formula DDT originale
 *   • Suas M. (2009) "Advanced Bread and Pastry" — valori per macchina
 *   • Giorilli P. "Il Grande Libro del Pane" — valori per macchina
 *   • Standard AVPN (Associazione Verace Pizza Napoletana)
 *   • SFBI (San Francisco Baking Institute) — reference table
 *
 * ┌──────────────────────┬──────────────────────────────┐
 * │ Metodo di Impasto    │ C_attrito medio [°C]         │
 * ├──────────────────────┼──────────────────────────────┤
 * │ A mano               │  1 –  2  (mid 1.5)           │
 * │ Spirale              │ 10 – 12  (mid 11)            │
 * │ Planetaria           │  8 – 10  (mid  9)            │
 * │ Bracci tuffanti      │  6 –  8  (mid  7)            │
 * └──────────────────────┴──────────────────────────────┘
 *
 * NOTA Spirale: 10–12°C calibrato su 2ª velocità (regime tipico pizzeria
 * napoletana). A 1ª velocità / uso domestico applicare 6–8°C.
 *
 * NOTA Pianetaria: valore per gancio (hook); con frusta a filo: +2°C.
 *
 * Verifica: i valori sono coerenti con le misure sperimentali pubblicate
 * da Calvel (±1°C) per sessioni standard. L'approccio a coefficiente fisso
 * è preferito all'interpolazione continua per la riproducibilità operativa.
 */
export const KNEADING_METHODS_FRICTION: Record<KneadingMethod, KneadingMethodSpec> = {
  hand: {
    label:        'A mano',
    cFrictionLo:  1,
    cFrictionHi:  2,
    cFrictionMid: 1.5,
    notes: 'Attrito trascurabile; solo per piccoli impasti (<500 g farina). Temperatura quasi ininfluente.',
  },
  spiral: {
    label:        'Spirale',
    cFrictionLo:  10,
    cFrictionHi:  12,
    cFrictionMid: 11,
    notes: 'Valore per 2ª velocità/regime pizzeria. A 1ª velocità o uso domestico: 6–8°C.',
  },
  planetary: {
    label:        'Planetaria',
    cFrictionLo:  8,
    cFrictionHi:  10,
    cFrictionMid: 9,
    notes: 'Gancio standard (hook). Con frusta a filo aggiungere 1–2°C. Attrito uniforme tra velocità.',
  },
  diving_arm: {
    label:        'Bracci tuffanti',
    cFrictionLo:  6,
    cFrictionHi:  8,
    cFrictionMid: 7,
    notes: 'Azione delicata; preserva strutture proteiche. Tempi di impasto più lunghi (20–30 min).',
  },
};

/** Threshold sotto cui si attiva la modalità ghiaccio [°C]. */
export const ICE_THRESHOLD_C = 3;

/** Input per il calcolo DDT — bilancio termico acqua di impastamento. */
export interface WaterTempInput {
  /** Temperatura Desiderata Finale (DDT) dell'impasto [°C]. Napoletana ~24°C. */
  ddtTarget:          number;
  /** Temperatura ambiente del laboratorio [°C]. */
  tempAmbient:        number;
  /** Temperatura della farina [°C]. Se omessa, si assume = tempAmbient. */
  tempFlour?:         number;
  /** Temperatura del pre-impasto [°C]. Richiesta per formula indiretta. */
  tempPreferment?:    number;
  /** Metodo di impastamento (seleziona C_attrito). */
  kneadingMethod:     KneadingMethod;
  /** Variante del C_attrito: 'lo' | 'mid' | 'hi'. Default 'mid'. */
  cFrictionVariant?:  'lo' | 'mid' | 'hi';
  /** Massa totale di acqua della ricetta [g]. Necessaria per il calcolo ghiaccio. */
  waterTotalGrams:    number;
  /** Temperatura dell'acqua corrente disponibile [°C]. Default ICE_THRESHOLD_C. */
  waterAvailableTempC?: number;
}

/** Risultato del calcolo DDT — bilancio termico acqua di impastamento. */
export interface WaterTempResult {
  /** Temperatura acqua calcolata per raggiungere DDT [°C] (può essere <0). */
  tWaterCalc:      number;
  /** 'liquid' → acqua normale; 'ice' → usa ghiaccio tritato. */
  mode:            'liquid' | 'ice';
  /** [mode=liquid] Temperatura consigliata acqua liquida [°C], clamped [1,35]. */
  tWaterLiquid?:   number;
  /** [mode=ice] Grammi di ghiaccio [g]. */
  iceGrams?:       number;
  /** [mode=ice] Grammi di acqua liquida residua [g]. */
  liquidGrams?:    number;
  /** [mode=ice] Temperatura fissa acqua liquida [°C]. */
  tWaterEffective?: number;
  /** C_attrito applicato [°C]. */
  cFriction:       number;
  /** Numero di fattori: 3 (diretto) | 4 (indiretto con pre-impasto). */
  factors:         3 | 4;
  /** Temperatura farina usata nel calcolo [°C] — per formula completa. */
  tempFlour:       number;
  /** Massa totale acqua della ricetta [g] — per mostrare le dosi. */
  waterTotalGrams: number;
}

// ─── KB §2.6 — pH per LBF/LM ─────────────────────────────────────────────────
// estimatePHForLBF — auto-exported via `export *` from engine JS.
// Signature: (initialPH: number | undefined, maturationPct: number) => number

// ─── KB §15.4 — Indice estensibilità ─────────────────────────────────────────

export interface ExtensibilityIndexInput {
  W:            number;   // forza alveografica [80–400]
  pl:           number;   // rapporto P/L [0.2–1.2]
  stability:    number;   // stabilità farinografica [min]
  maturationPct: number;  // avanzamento maturazione [0–100]
}

// computeExtensibilityIndex — auto-exported via `export *`. Returns [0,1].
// Pesi: W=30%, P/L=20%, stabilità=30%, maturazione=20%

// ─── KB §8 — Calcolo inverso dose lievito ─────────────────────────────────────

export interface InverseProgramInput {
  targetDurationH:  number;
  targetMatPct?:    number;   // default 85
  tempC:            number;
  agentType:        AgentType;
  eaKj:             number;
  muMaxRef:         number;
  lambdaRef:        number;
  refDosePct:       number;
  asymptote?:       number;   // default 100
}

export interface InverseProgramResult {
  dosePct:      number;
  muMaxScaled:  number;
  aduAvailable: number;
  feasible:     boolean;
}

// computeInverseProgram — auto-exported via `export *`. Scaling LINEARE (non sqrt).

/**
 * Calcola la temperatura ottimale dell'acqua per raggiungere la DDT — §2.7
 *
 * Formula diretto (senza pre-impasto, 3 fattori variabili):
 *   T_acqua = DDT × 3 − T_amb − T_farina − C_attrito
 *
 * Formula indiretto (con pre-impasto, 4 fattori variabili):
 *   T_acqua = DDT × 4 − T_amb − T_farina − T_preimpasto − C_attrito
 *
 * Se T_acqua < ICE_THRESHOLD_C (3°C): attiva sostituzione parziale con ghiaccio.
 *
 * Bilancio entalpico ghiaccio (calore latente = 80 cal/g a 0°C):
 *   M_ghiaccio = M_acqua × (T_disponibile − T_acqua_calc) / (80 + T_disponibile)
 *   M_liquida  = M_acqua − M_ghiaccio
 *
 * Derivazione: conservazione dell'energia tra acqua a T_disponibile che si
 * raffredda e ghiaccio a 0°C che fonde + si scalda fino a T_acqua_calc,
 * con calore specifico cp = 1 cal/(g·°C) per entrambe le fasi liquide.
 *
 * @see Suas M. (2009) "Advanced Bread and Pastry", ch. 3 — DDT formula
 */
export function computeWaterTempDDT(input: WaterTempInput): WaterTempResult {
  const {
    ddtTarget,
    tempAmbient,
    tempFlour         = tempAmbient,
    tempPreferment,
    kneadingMethod,
    cFrictionVariant  = 'mid',
    waterTotalGrams,
    waterAvailableTempC = ICE_THRESHOLD_C,
  } = input;

  const spec     = KNEADING_METHODS_FRICTION[kneadingMethod] ?? KNEADING_METHODS_FRICTION.spiral;
  const cFriction =
    cFrictionVariant === 'lo' ? spec.cFrictionLo :
    cFrictionVariant === 'hi' ? spec.cFrictionHi :
    spec.cFrictionMid;

  const factors: 3 | 4 = tempPreferment != null ? 4 : 3;

  // ── Calcolo temperatura acqua ─────────────────────────────────────────────
  const tWaterCalc = factors === 4
    ? ddtTarget * 4 - tempAmbient - tempFlour - tempPreferment! - cFriction
    : ddtTarget * 3 - tempAmbient - tempFlour - cFriction;

  // ── Acqua liquida ─────────────────────────────────────────────────────────
  if (tWaterCalc >= ICE_THRESHOLD_C) {
    return {
      tWaterCalc,
      mode:            'liquid',
      tWaterLiquid:    Math.min(35, Math.max(1, tWaterCalc)),
      cFriction,
      factors,
      tempFlour,
      waterTotalGrams,
    };
  }

  // ── Sostituzione ghiaccio ─────────────────────────────────────────────────
  // M_ghiaccio = M_acqua × (T_avail - T_calc) / (80 + T_avail)
  const tAvail    = Math.max(ICE_THRESHOLD_C, waterAvailableTempC);
  const iceGrams  = Math.min(
    waterTotalGrams,
    Math.max(0, waterTotalGrams * (tAvail - tWaterCalc) / (80 + tAvail)),
  );
  const liquidGrams = Math.max(0, waterTotalGrams - iceGrams);

  return {
    tWaterCalc,
    mode:            'ice',
    iceGrams:        Math.round(iceGrams),
    liquidGrams:     Math.round(liquidGrams),
    tWaterEffective: tAvail,
    cFriction,
    factors,
    tempFlour,
    waterTotalGrams,
  };
}
