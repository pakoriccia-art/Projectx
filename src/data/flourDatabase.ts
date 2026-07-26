/**
 * PizzaMatrix — Catalogo farine validate — KB §7.2
 * 15 farine validate + voce custom.
 * Valori da schede tecniche pubblicate dai molini.
 */

export type FlourTipo = '00' | '0' | '1' | '2' | 'integrale';
export type FlourGroup = 'weak' | 'medium' | 'strong' | 'manitoba';

export interface FlourEntry {
  id:          string;
  name:        string;
  brand:       string;
  W:           number;       // forza alveografica
  pl:          number;       // rapporto P/L
  protein:     number;       // proteine %
  absorption:  number;       // assorbimento % (indicativo)
  ash?:        number;       // ceneri %; default 0.55
  FN?:         number;       // Falling Number [s]; default 340
  tipo?:       FlourTipo;
  group:       FlourGroup;
  note?:       string;
}

/** Catalogo 15 farine validate + custom — KB §7.2 */
export const FLOUR_DATABASE: FlourEntry[] = [
  // ── Caputo ───────────────────────────────────────────────────────────────────
  {
    id: 'caputo-nuvola',
    name: 'Nuvola',
    brand: 'Caputo',
    W: 260, pl: 0.50, protein: 11.0, absorption: 60,
    ash: 0.55, tipo: '0', group: 'medium',
  },
  {
    id: 'caputo-pizzeria',
    name: 'Pizzeria Blu',
    brand: 'Caputo',
    W: 280, pl: 0.55, protein: 12.5, absorption: 58,
    ash: 0.55, tipo: '00', group: 'strong',
  },
  {
    id: 'caputo-cuoco',
    name: 'Cuoco',
    brand: 'Caputo',
    W: 320, pl: 0.55, protein: 13.0, absorption: 60,
    ash: 0.55, tipo: '00', group: 'strong',
  },
  {
    id: 'caputo-manitoba',
    name: 'Manitoba Oro',
    brand: 'Caputo',
    W: 390, pl: 0.60, protein: 14.5, absorption: 65,
    ash: 0.60, tipo: '0', group: 'manitoba',
  },
  {
    id: 'caputo-nuvola-super',
    name: 'Nuvola Super',
    brand: 'Caputo',
    W: 270, pl: 0.50, protein: 11.5, absorption: 60,
    ash: 0.55, tipo: '0', group: 'medium',
  },
  // ── Molino Casillo ────────────────────────────────────────────────────────────
  {
    id: 'casillo-8plus',
    name: '8+',
    brand: 'Molino Casillo',
    W: 310, pl: 0.58, protein: 13.0, absorption: 62,
    ash: 0.55, tipo: '0', group: 'strong',
    note: 'VERIFICATO shop.molinocasillo.com',
  },
  {
    id: 'casillo-uniqua-rossa',
    name: 'Uniqua Rossa',
    brand: 'Molino Casillo',
    W: 330, pl: 0.55, protein: 13.5, absorption: 63,
    ash: 0.80, tipo: '1', group: 'strong',
  },
  // ── Agugiaro & Figna (5 Stagioni) ─────────────────────────────────────────────
  {
    id: '5stagioni-napoletana',
    name: 'Napoletana',
    brand: '5 Stagioni',
    W: 280, pl: 0.55, protein: 12.5, absorption: 58,
    ash: 0.55, tipo: '00', group: 'strong',
  },
  {
    id: '5stagioni-professional',
    name: 'Professional',
    brand: '5 Stagioni',
    W: 300, pl: 0.55, protein: 12.5, absorption: 59,
    ash: 0.55, tipo: '00', group: 'strong',
  },
  {
    id: '5stagioni-classica',
    name: 'Pizza Classica',
    brand: '5 Stagioni',
    W: 240, pl: 0.50, protein: 11.5, absorption: 57,
    ash: 0.55, tipo: '00', group: 'medium',
  },
  // ── Mulino Quaglia / Petra ─────────────────────────────────────────────────────
  {
    id: 'petra-5037',
    name: 'Petra 5037',
    brand: 'Petra',
    W: 330, pl: 0.55, protein: 13.5, absorption: 62,
    ash: 0.70, tipo: '1', group: 'strong',
  },
  {
    id: 'petra-3',
    name: 'Petra 3',
    brand: 'Petra',
    W: 200, pl: 0.50, protein: 10.5, absorption: 55,
    ash: 0.65, tipo: '1', group: 'weak',
  },
  // ── Pivetti ───────────────────────────────────────────────────────────────────
  {
    id: 'pivetti-manitoba',
    name: 'Manitoba',
    brand: 'Pivetti',
    W: 380, pl: 0.62, protein: 14.0, absorption: 65,
    ash: 0.60, tipo: '0', group: 'manitoba',
  },
  {
    id: 'pivetti-rinforzata',
    name: 'Rinforzata',
    brand: 'Pivetti',
    W: 300, pl: 0.55, protein: 12.5, absorption: 60,
    ash: 0.55, tipo: '0', group: 'strong',
  },
  // ── Lo Conte / Sforzini ────────────────────────────────────────────────────────
  {
    id: 'loconte-speciale',
    name: 'Speciale Pizza',
    brand: 'Lo Conte',
    W: 280, pl: 0.55, protein: 12.0, absorption: 58,
    ash: 0.55, tipo: '00', group: 'medium',
  },
  // ── Custom ────────────────────────────────────────────────────────────────────
  {
    id: 'custom',
    name: 'Personalizzata',
    brand: '',
    W: 260, pl: 0.55, protein: 12.0, absorption: 58,
    ash: 0.55, tipo: '00', group: 'medium',
  },
];

// ─── Falling Number: dato mancante, non dato implicito (issue #7) ────────────
//
// Nessuna farina del catalogo dichiara `FN`. Finora il motore cadeva in
// silenzio su DEFAULT_FN = 340 per tutte, con la conseguenza che
// normalizeAmylaseActivity restituiva sempre 0.507 e l'intero sottosistema
// amilasico (indice, denaturazione, alert malto) non discriminava mai fra
// farine: applicava solo un fattore costante a ogni impasto.
//
// I valori NON sono stati inventati. Le schede tecniche dei molini italiani
// spesso non pubblicano l'indice di caduta, e quelle reperite online sono
// scansioni senza layer testo: non verificabili su fonte primaria. Finché il
// dato non arriva da una scheda, resta assente — ma ora l'assenza è
// ESPLICITA e interrogabile, non un default silenzioso.

/** Falling Number [s] usato quando la farina non dichiara il dato. */
export const DEFAULT_FALLING_NUMBER = 340;

export interface ResolvedFallingNumber {
  /** Valore da usare nei calcoli [s]. */
  fn:       number;
  /** true se proviene dalla scheda tecnica; false se è DEFAULT_FALLING_NUMBER. */
  measured: boolean;
}

/**
 * Risolve il Falling Number di una farina distinguendo dato misurato da default.
 * Usare `measured` per segnalare in UI che il calcolo amilasico è su stima.
 */
export function resolveFallingNumber(
  flour: { FN?: number } | undefined,
): ResolvedFallingNumber {
  const fn = flour?.FN;
  return fn != null && Number.isFinite(fn)
    ? { fn, measured: true }
    : { fn: DEFAULT_FALLING_NUMBER, measured: false };
}

/**
 * Copertura del dato FN nel catalogo — per diagnostica e per il test che
 * impedisce di dichiarare "risolto" il problema senza aver inserito i dati.
 */
export function fallingNumberCoverage(): { measured: number; total: number } {
  const catalog = FLOUR_DATABASE.filter(f => f.id !== 'custom');
  return {
    measured: catalog.filter(f => f.FN != null).length,
    total:    catalog.length,
  };
}

/** Lookup veloce per ID */
export function getFlourById(id: string): FlourEntry | undefined {
  return FLOUR_DATABASE.find(f => f.id === id);
}

/** Lista brand unici nel DB */
export function getFlourBrands(): string[] {
  return [...new Set(FLOUR_DATABASE.filter(f => f.id !== 'custom').map(f => f.brand))];
}

/** Farine filtrate per brand */
export function getFloursByBrand(brand: string): FlourEntry[] {
  return FLOUR_DATABASE.filter(f => f.brand === brand);
}
