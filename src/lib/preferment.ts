/**
 * PizzaMatrix — prefermento in pratica: dove matura, quanto dura, quanti grammi.
 *
 * Solo aritmetica sugli input della ricetta (nessun modello di fermentazione):
 * il motore riceve gli stessi campi di sempre (tempC, durationH, flourFraction…),
 * qui li si ricava da poche scelte e si trasformano in grammi da pesare.
 */
import type { PrefermentoComponent } from '../db/db';

export type PrefPlace = 'fresco' | 'stanza' | 'frigo';
export type PrefTiming = 'now' | 'ready';

/** Temperatura tipica del luogo di maturazione (il frigo è quello della sessione). */
export function placeTempC(place: PrefPlace, fridgeTempC = 4): number {
  return place === 'frigo' ? fridgeTempC : place === 'stanza' ? 20 : 16;
}

/** Luogo dedotto da una temperatura (prefermenti creati prima, o dal Planner). */
export function placeOf(p: Pick<PrefermentoComponent, 'tempC'> & { place?: PrefPlace }): PrefPlace {
  if (p.place) return p.place;
  const t = p.tempC ?? 16;
  return t <= 8 ? 'frigo' : t <= 18 ? 'fresco' : 'stanza';
}

/** Durate proposte (ore) per tipo e luogo: la prima scelta è quella di default. */
const DURATIONS: Record<'biga' | 'poolish', Record<PrefPlace, [number, number, number]>> = {
  biga:    { fresco: [16, 18, 24], stanza: [12, 16, 18], frigo: [24, 36, 48] },
  poolish: { fresco: [12, 16, 18], stanza: [12, 8, 16],  frigo: [24, 16, 36] },
};

export function durationOptions(type: string, place: PrefPlace): number[] {
  const t = type === 'poolish' ? 'poolish' : 'biga';
  return [...DURATIONS[t][place]].sort((a, b) => a - b);
}

export function defaultDuration(type: string, place: PrefPlace): number {
  const t = type === 'poolish' ? 'poolish' : 'biga';
  return DURATIONS[t][place][0];
}

/** Quote di farina proposte (% sul totale; lo schema accetta 5–70). */
export function fractionOptions(type: string): number[] {
  return type === 'poolish' ? [20, 30, 50] : [30, 50, 70];
}

/** Biga e poolish si preparano: sono quelli che hanno una fase "in corso". */
export function isPreparable(p: { type: string }): boolean {
  return p.type === 'biga' || p.type === 'poolish';
}

export function prefName(type: string): string {
  return type === 'biga' ? 'biga' : type === 'poolish' ? 'poolish'
    : type === 'riporto' ? 'riporto' : type === 'autolysis' ? 'autolisi' : 'prefermento';
}

/** "la biga", "il poolish", "il riporto", "l'autolisi". */
export function prefWithArticle(type: string): string {
  const n = prefName(type);
  return n === 'biga' ? 'la biga' : n === 'autolisi' ? "l'autolisi" : `il ${n}`;
}

/** Femminile per gli aggettivi ("pronta"/"pronto"). */
export function prefIsFeminine(type: string): boolean {
  return type === 'biga' || type === 'autolysis';
}

/** Come riconoscere che è pronto: segni da guardare, non numeri. */
export function readySigns(type: string): string[] {
  if (type === 'poolish') return [
    'Superficie piena di bolle, anche grandi',
    'Al centro la cupola si è appena abbassata',
    'Profumo di yogurt, appena alcolico',
  ];
  return [
    'Volume aumentato, la massa si è gonfiata',
    'Spezzandola, dentro è filamentosa e piena di alveoli',
    'Profumo leggermente acidulo, non pungente',
  ];
}

export interface PrefGrams {
  id: string;
  type: PrefermentoComponent['type'];
  flourG: number;
  waterG: number;
  /** Lievito da sciogliere nel prefermento; null per autolisi e riporto. */
  yeastG: number | null;
  totalG: number;
}

export interface RecipeSplit {
  prefs: PrefGrams[];
  final: { flourG: number; waterG: number; saltG: number; fatG: number; yeastG: number };
  totalWaterG: number;
  /** Idratazione totale minima imposta dai prefermenti (se l'acqua non basta). */
  minHydrationPct: number | null;
}

/**
 * Divide la ricetta tra prefermenti e impasto finale. L'idratazione della ricetta
 * è quella totale; il lievito della ricetta va nell'impasto finale (dose sulla
 * farina totale), quello dei prefermenti si aggiunge a parte.
 */
export function splitRecipe(r: {
  totalFlourG: number; hydrationPct: number; saltPct: number; fatPct?: number;
  agentDosePct: number; prefermenti?: PrefermentoComponent[];
}): RecipeSplit {
  const prefs: PrefGrams[] = (r.prefermenti ?? []).map(p => {
    const flourG = r.totalFlourG * (p.flourFraction ?? 0) / 100;
    const waterG = flourG * (p.hydration ?? 0) / 100;
    const yeastG = p.yeastPct != null && (p.type === 'biga' || p.type === 'poolish')
      ? flourG * p.yeastPct / 100 : null;
    return { id: p.id, type: p.type, flourG, waterG, yeastG, totalG: flourG + waterG + (yeastG ?? 0) };
  });
  const totalWaterG = r.totalFlourG * r.hydrationPct / 100;
  const prefFlour = prefs.reduce((s, p) => s + p.flourG, 0);
  const prefWater = prefs.reduce((s, p) => s + p.waterG, 0);
  const finalWater = totalWaterG - prefWater;
  return {
    prefs,
    final: {
      flourG: Math.max(0, r.totalFlourG - prefFlour),
      waterG: Math.max(0, finalWater),
      saltG:  r.totalFlourG * r.saltPct / 100,
      fatG:   r.totalFlourG * (r.fatPct ?? 0) / 100,
      yeastG: r.totalFlourG * r.agentDosePct / 100,
    },
    totalWaterG,
    minHydrationPct: finalWater < -0.5 && r.totalFlourG > 0 ? Math.ceil(prefWater / r.totalFlourG * 100) : null,
  };
}

/**
 * Temperatura dei prefermenti quando entrano nell'impasto (4° fattore DDT):
 * media pesata sulla massa, non media semplice. Autolisi esclusa.
 */
export function prefTempAtMix(prefermenti: PrefermentoComponent[] | undefined, totalFlourG: number): number | undefined {
  let mass = 0, acc = 0;
  for (const p of prefermenti ?? []) {
    if (p.type === 'autolysis') continue;
    const m = totalFlourG * (p.flourFraction ?? 0) / 100 * (1 + (p.hydration ?? 0) / 100);
    mass += m; acc += m * (p.tempC ?? 16);
  }
  return mass > 0 ? acc / mass : undefined;
}

/** Grammi leggibili: sotto i 10 g un decimale (il lievito della biga è poco). */
export function fmtGrams(g: number): string {
  if (g < 10) return `${(Math.round(g * 10) / 10).toLocaleString('it-IT')} g`;
  return `${Math.round(g).toLocaleString('it-IT')} g`;
}

/** Ore dal momento in cui il prefermento è stato impastato, arrotondate al quarto d'ora. */
export function elapsedPrefHours(startedAt: Date | string, now = Date.now()): number {
  const h = (now - new Date(startedAt).getTime()) / 3_600_000;
  return Math.max(0.5, Math.round(h * 4) / 4);
}
