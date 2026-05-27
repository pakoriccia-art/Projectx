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
