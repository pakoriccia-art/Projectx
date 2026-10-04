/**
 * PizzaMatrix — prefermento in pratica: dove matura, quanto dura, quanti grammi.
 *
 * Aritmetica sugli input della ricetta: il motore riceve gli stessi campi di
 * sempre (tempC, durationH, flourFraction…), qui li si ricava da poche scelte e
 * si trasformano in grammi da pesare. La maturazione del prefermento in corso
 * usa solo fArrhenius del motore (chiamata, non modificata).
 */
import type { PrefermentoComponent, PrefermentStage } from '../db/db';
import {
  fArrhenius, computeWaterTempDDT, computeEffectiveMixHydration, type KneadingMethod, type WaterTempResult,
} from '../engine';
import { ddtForStyle } from '../data/styleConstraints';

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

/** Segno di troppo maturo, da evidenziare quando il ritardo è grande. */
export function overSign(type: string): string {
  return type === 'poolish'
    ? 'Cupola crollata, odore alcolico forte: è oltre'
    : 'Odore pungente, si strappa senza filamenti: è oltre';
}

/** Maturazione (%) oltre la quale il ritardo diventa un avviso. */
export function lateThresholdPct(type: string): number {
  return type === 'poolish' ? 115 : 125;
}

/** Sotto questa maturazione (%) l'impasto finale chiede conferma. */
export const EARLY_PCT = 75;

/** Minimo di farina che resta all'impasto finale (rinfresco), come nel motore. */
export const MIN_FINAL_FLOUR_PCT = 10;

/** Durata della fase: il prefermento biologico più lungo. */
export function stageDurationH(prefermenti: PrefermentoComponent[] | undefined): number {
  const prep = (prefermenti ?? []).filter(isPreparable);
  return prep.length ? Math.max(...prep.map(p => p.durationH ?? 12)) : 0;
}

export interface RecipeProblem {
  kind: 'flour' | 'water';
  message: string;
  /** Correzione proposta: idratazione minima o quota massima del prefermento più grande. */
  fixValue: number;
  /** Acqua: quota massima del prefermento più acquoso che rientra nell'idratazione attuale. */
  fixFraction?: { id: string; value: number };
}

/** Una ricetta che non si può impastare: null se va bene. */
export function recipeProblem(d: {
  totalFlourGrams?: number; hydration?: number; salt?: number; prefermenti?: PrefermentoComponent[];
}): RecipeProblem | null {
  const prefs = d.prefermenti ?? [];
  if (!prefs.length) return null;
  const totalFrac = prefs.reduce((s, p) => s + (p.flourFraction ?? 0), 0);
  if (totalFrac > 100 - MIN_FINAL_FLOUR_PCT) {
    const biggest = prefs.reduce((a, b) => ((b.flourFraction ?? 0) > (a.flourFraction ?? 0) ? b : a));
    const fixValue = Math.max(5, (biggest.flourFraction ?? 0) - (totalFrac - (100 - MIN_FINAL_FLOUR_PCT)));
    return {
      kind: 'flour', fixValue,
      message: `Prefermenti al ${totalFrac}% della farina: lascia almeno il ${MIN_FINAL_FLOUR_PCT}% per l'impasto finale.`,
    };
  }
  const split = splitRecipe({
    totalFlourG: d.totalFlourGrams ?? 1000, hydrationPct: d.hydration ?? 65,
    saltPct: d.salt ?? 2, agentDosePct: 0, prefermenti: prefs,
  });
  if (split.minHydrationPct != null) {
    // In alternativa all'idratazione: ridurre il prefermento che porta più acqua.
    const hyd = d.hydration ?? 65;
    const wettest = prefs.reduce((a, b) => ((b.flourFraction ?? 0) * (b.hydration ?? 0) > (a.flourFraction ?? 0) * (a.hydration ?? 0) ? b : a));
    const otherWaterPct = prefs.filter(p => p.id !== wettest.id)
      .reduce((acc, p) => acc + (p.flourFraction ?? 0) * (p.hydration ?? 0) / 100, 0);
    const maxFrac = Math.floor((hyd - otherWaterPct) * 100 / Math.max(1, wettest.hydration ?? 100));
    return {
      kind: 'water', fixValue: split.minHydrationPct,
      fixFraction: maxFrac >= 5 ? { id: wettest.id, value: maxFrac } : undefined,
      message: `L'acqua dei prefermenti supera quella della ricetta: l'idratazione deve essere almeno ${split.minHydrationPct}%.`,
    };
  }
  return null;
}

/** Durata prevista: plannedH, o per le fasi salvate prima readyAt − startedAt. */
export function plannedHOf(stage: { startedAt: Date | string; plannedH?: number; readyAt?: Date | string }): number {
  if (stage.plannedH != null) return Math.max(0.25, stage.plannedH);
  const h = stage.readyAt ? (new Date(stage.readyAt).getTime() - new Date(stage.startedAt).getTime()) / 3_600_000 : NaN;
  return Math.max(0.25, Number.isFinite(h) ? h : 12);
}

/**
 * Maturazione del prefermento in corso, come tempo termico: ∫fArrhenius(T)dt
 * rispetto a quello previsto (fArrhenius(T del piano) × durata del piano).
 * Gli spostamenti (frigo, stanza…) cambiano la velocità da quel momento.
 */
export function prefProgress(
  stage: Pick<PrefermentStage, 'startedAt' | 'plannedH' | 'plannedTempC' | 'moves'> & { readyAt?: Date | string },
  now = Date.now(),
  /** Maturazione (%) di cui stimare l'orario; 100 = pronto. */
  atPct = 100,
): { pct: number; etaMs: number } {
  const start = new Date(stage.startedAt).getTime();
  const plannedH = plannedHOf(stage);
  const target = (fArrhenius as (t: number) => number)(stage.plannedTempC ?? 16) * plannedH;
  const moves = [...(stage.moves ?? [])]
    .map(m => ({ at: new Date(m.at).getTime(), tempC: m.tempC }))
    .filter(m => Number.isFinite(m.at) && m.at >= start)
    .sort((a, b) => a.at - b.at);
  const goal = target * atPct / 100;
  let t = start, temp = stage.plannedTempC ?? 16, acc = 0;
  let crossedAt: number | null = null;   // istante in cui si è raggiunto atPct, se già passato
  const rate = (c: number) => (fArrhenius as (t: number) => number)(c);
  const advance = (until: number) => {
    const dh = Math.max(0, until - t) / 3_600_000;
    const add = rate(temp) * dh;
    if (crossedAt == null && acc + add >= goal && rate(temp) > 1e-9) {
      crossedAt = t + ((goal - acc) / rate(temp)) * 3_600_000;
    }
    acc += add; t = Math.max(t, until);
  };
  for (const m of moves) {
    if (m.at > now) break;
    advance(m.at);
    temp = m.tempC;
  }
  advance(now);
  const r = rate(temp);
  const remainingH = goal > acc && r > 1e-9 ? (goal - acc) / r : 0;
  if (crossedAt != null) return { pct: target > 0 ? (acc / target) * 100 : 0, etaMs: crossedAt };
  return { pct: target > 0 ? (acc / target) * 100 : 0, etaMs: now + remainingH * 3_600_000 };
}

/** Ore dal momento in cui il prefermento è stato impastato, arrotondate al quarto d'ora. */
export function elapsedPrefHours(startedAt: Date | string, now = Date.now()): number {
  const h = (now - new Date(startedAt).getTime()) / 3_600_000;
  return Math.max(0.5, Math.round(h * 4) / 4);
}

/** Luogo e temperatura dove si trova adesso il prefermento in corso. */
export function currentSpot(stage: Pick<PrefermentStage, 'plannedTempC' | 'moves'>, fallbackPlace: PrefPlace): { place: PrefPlace; tempC: number } {
  const last = [...(stage.moves ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).pop();
  return last ? { place: last.place, tempC: last.tempC } : { place: fallbackPlace, tempC: stage.plannedTempC ?? 16 };
}

/**
 * Temperatura costante equivalente a quella vissuta dal prefermento (stesso
 * tempo termico nelle stesse ore): è quella che entra nella ricetta del motore.
 */
export function equivalentTempC(stage: Pick<PrefermentStage, 'startedAt' | 'plannedH' | 'plannedTempC' | 'moves'> & { readyAt?: Date | string }, now = Date.now()): number {
  const base = stage.plannedTempC ?? 16;
  if (!(stage.moves ?? []).length) return base;
  const hours = Math.max(1e-6, (now - new Date(stage.startedAt).getTime()) / 3_600_000);
  const { pct } = prefProgress(stage, now);
  const plannedH = plannedHOf(stage);
  const f = fArrhenius as (t: number) => number;
  const goalRate = (pct / 100) * f(base) * plannedH / hours;   // fArrhenius medio
  let lo = 0, hi = 40;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < goalRate) lo = mid; else hi = mid; }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** Temperatura target dell'impasto del prefermento (biga più fresca del poolish). */
export function prefDdtC(type: string): number {
  return type === 'poolish' ? 20 : 18;
}

/** Acqua per un impasto (prefermento o finale): una riga leggibile, o null. */
export function waterAdvice(p: {
  ddtTarget: number; tempAmbient: number; waterG: number; massKg: number; hydrationPct: number;
  kneadingMethod?: KneadingMethod; kneadDurationMin?: number; tempPreferment?: number; tapWaterC?: number;
}): string | null {
  if (!(p.waterG > 0)) return null;
  let r: WaterTempResult;
  try {
    r = computeWaterTempDDT({
      ddtTarget: p.ddtTarget, tempAmbient: p.tempAmbient,
      kneadingMethod: p.kneadingMethod ?? 'spiral', waterTotalGrams: Math.round(p.waterG),
      tempPreferment: p.tempPreferment, kneadDurationMin: p.kneadDurationMin,
      hydrationEff: p.hydrationPct, doughMassKg: p.massKg, tapWaterC: p.tapWaterC,
    });
  } catch { return null; }
  if (r.mode === 'liquid' && r.tWaterLiquid != null) return `acqua a ${Math.round(r.tWaterLiquid)}°C`;
  if (r.mode === 'ice' && r.iceGrams != null && r.iceGrams < 1) {
    return `acqua fredda a ${Math.round(r.tWaterEffective ?? r.tWaterCalc)}°C`;
  }
  if (r.mode === 'ice' && r.iceGrams != null) {
    return `${fmtGrams(r.iceGrams)} di ghiaccio tritato + ${fmtGrams(r.liquidGrams ?? 0)} di acqua fredda`;
  }
  if (r.mode === 'unreachable') return 'acqua più fredda che puoi (con ghiaccio) e farina fredda';
  return null;
}

// ─── Fase in corso: un elemento per ogni prefermento da preparare ─────────────

export type PrefMove = { at: Date; place: PrefPlace; tempC: number };

export interface StageItem {
  id: string;
  type: string;
  /** Quando va impastato: il principale subito, gli altri in modo da finire insieme. */
  startAt: Date;
  /** Quando è stato impastato davvero ("Fatto"); da qui parte il suo orologio. */
  mixedAt?: Date;
  plannedH: number;
  plannedTempC: number;
  moves?: PrefMove[];
}

/** Orologio di un elemento nel formato di prefProgress. */
export function itemClock(it: StageItem) {
  return { startedAt: it.mixedAt ?? it.startAt, plannedH: it.plannedH, plannedTempC: it.plannedTempC, moves: it.moves };
}

/**
 * Elementi della fase: il prefermento più lungo parte subito ed è il principale,
 * gli altri partono più tardi così da essere pronti insieme a lui.
 */
export function buildStageItems(prefermenti: PrefermentoComponent[] | undefined, startedAt: Date): StageItem[] {
  const prep = (prefermenti ?? []).filter(isPreparable)
    .sort((a, b) => (b.durationH ?? 12) - (a.durationH ?? 12));
  if (!prep.length) return [];
  const mainH = prep[0].durationH ?? 12;
  return prep.map((p, i) => {
    const h = p.durationH ?? 12;
    const startAt = new Date(startedAt.getTime() + (mainH - h) * 3_600_000);
    return { id: p.id, type: p.type, startAt, mixedAt: i === 0 ? startedAt : undefined, plannedH: h, plannedTempC: p.tempC ?? 16 };
  });
}

/**
 * Fasi salvate da build precedenti (senza plannedH o senza elementi): si
 * ricostruiscono gli elementi come allora, tutti impastati all'avvio e con gli
 * spostamenti della fase.
 */
export function normalizeStage<T extends PrefermentStage>(stage: T): T {
  if (stage.items && stage.items.length && stage.plannedH != null) return stage;
  const prefs = ((stage.draft as { prefermenti?: PrefermentoComponent[] }).prefermenti ?? []).filter(isPreparable)
    .sort((a, b) => (b.durationH ?? 12) - (a.durationH ?? 12));
  const start = new Date(stage.startedAt);
  const mainH = plannedHOf(stage);
  const mainT = stage.plannedTempC ?? prefs[0]?.tempC ?? 16;
  const items: StageItem[] = stage.items && stage.items.length ? stage.items : prefs.map((p, i) => ({
    id: p.id, type: p.type, startAt: start, mixedAt: start,
    plannedH: i === 0 ? mainH : (p.durationH ?? 12),
    plannedTempC: i === 0 ? mainT : (p.tempC ?? 16),
    moves: stage.moves,
  }));
  return { ...stage, plannedH: mainH, plannedTempC: mainT, items };
}

/** Ora in cui tutti i prefermenti sono pronti. */
export function stageReadyAt(items: StageItem[], now = Date.now()): number {
  return Math.max(...items.map(it => prefProgress(itemClock(it), now, 100).etaMs));
}

/** Sopra questa maturazione (%) l'impasto chiede conferma: può venire acido e debole. */
export const VERY_LATE_PCT = 150;

export type LateLevel = 'growing' | 'ready' | 'late' | 'veryLate';

export function lateLevel(type: string, pct: number): LateLevel {
  if (pct >= VERY_LATE_PCT) return 'veryLate';
  if (pct >= lateThresholdPct(type)) return 'late';
  if (pct >= 100) return 'ready';
  return 'growing';
}

/** Da questa maturazione (%) si suggerisce il frigo, se non ci è già. */
export const FRIDGE_HINT_PCT = 85;

/**
 * Quanto regge restando dov'è e quanto in frigo da adesso: orario in cui si
 * supera la soglia di ritardo nei due casi.
 */
export function fridgeGain(it: StageItem, now: number, fridgeTempC: number): { lateAtStay: number; lateAtFridge: number; gainH: number } {
  const th = lateThresholdPct(it.type);
  const lateAtStay = prefProgress(itemClock(it), now, th).etaMs;
  const moved = { ...it, moves: [...(it.moves ?? []), { at: new Date(now), place: 'frigo' as const, tempC: fridgeTempC }] };
  const lateAtFridge = prefProgress(itemClock(moved), now, th).etaMs;
  return { lateAtStay, lateAtFridge, gainH: Math.max(0, (lateAtFridge - lateAtStay) / 3_600_000) };
}

/**
 * Acqua per l'impasto finale, con gli stessi input della card del riepilogo:
 * DDT dello stile, idratazione effettiva, massa, impastatrice, rubinetto.
 */
export function finalWaterAdvice(d: {
  style?: string; tLaboratorio?: number; totalFlourGrams?: number; hydration?: number; salt?: number;
  prefermenti?: PrefermentoComponent[]; kneadingMethod?: KneadingMethod; kneadDurationMin?: number; tapWaterC?: number;
}, prefTempC: number | undefined): string | null {
  const flour = d.totalFlourGrams ?? 1000, hyd = d.hydration ?? 65;
  const split = splitRecipe({ totalFlourG: flour, hydrationPct: hyd, saltPct: d.salt ?? 2, agentDosePct: 0, prefermenti: d.prefermenti });
  return waterAdvice({
    ddtTarget: ddtForStyle(d.style), tempAmbient: d.tLaboratorio ?? 20, waterG: split.final.waterG,
    massKg: flour * (1 + hyd / 100) / 1000,
    hydrationPct: (computeEffectiveMixHydration as (s: unknown) => number)({ hydration: hyd, prefermenti: d.prefermenti ?? [] }),
    kneadingMethod: d.kneadingMethod ?? 'spiral', kneadDurationMin: d.kneadDurationMin ?? 12,
    tempPreferment: prefTempC, tapWaterC: d.tapWaterC,
  });
}

/** Avanzamento di un elemento: fermo a 0 finché non è impastato. */
export function itemProgress(it: StageItem, now = Date.now()): { pct: number; etaMs: number; started: boolean } {
  if (!it.mixedAt) {
    const from = Math.max(now, new Date(it.startAt).getTime());
    return { pct: 0, etaMs: from + it.plannedH * 3_600_000, started: false };
  }
  return { ...prefProgress(itemClock(it), now, 100), started: true };
}

/** Quando un elemento impastato supera la soglia di ritardo (passato o futuro). */
export function itemLateAt(it: StageItem, now = Date.now()): number | null {
  return it.mixedAt ? prefProgress(itemClock(it), now, lateThresholdPct(it.type)).etaMs : null;
}

/** Stato di un prefermento della fase, con le sue scadenze. */
export interface ItemState {
  it: StageItem;
  pct: number;
  /** Pronto (100%): passato o futuro; per chi non è impastato, da quando lo sarà. */
  etaMs: number;
  started: boolean;
  level: LateLevel;
  /** Quando supera la soglia di ritardo (stimato anche per chi non è impastato). */
  lateAt: number;
  /** Non impastato e in ritardo sull'orario di avvio (ms), altrimenti 0. */
  overdueMs: number;
}

/** Oltre questo ritardo sull'orario di avvio, il secondo prefermento è "da impastare". */
export const START_GRACE_MS = 15 * 60_000;

export function itemState(it: StageItem, now = Date.now()): ItemState {
  const p = itemProgress(it, now);
  const th = lateThresholdPct(it.type);
  if (!p.started) {
    const from = Math.max(now, new Date(it.startAt).getTime());
    const overdue = now - new Date(it.startAt).getTime();
    return {
      it, pct: 0, etaMs: p.etaMs, started: false, level: 'growing',
      lateAt: from + it.plannedH * th / 100 * 3_600_000,
      overdueMs: overdue > START_GRACE_MS ? overdue : 0,
    };
  }
  return { it, pct: p.pct, etaMs: p.etaMs, started: true, level: lateLevel(it.type, p.pct), lateAt: itemLateAt(it, now)!, overdueMs: 0 };
}

export interface StageStatus {
  /** Il prefermento più urgente (scadenza più vicina): guida titolo, banner e avvisi. */
  focus: ItemState;
  all: ItemState[];
  type: string;
  level: LateLevel;
  pct: number;
  /** Tutti pronti. */
  readyAt: number;
  /** Primo che va oltre. */
  lateAt: number;
  /** Finestra per l'impasto finale: da quando sono tutti pronti a quando il primo va oltre. */
  window: { from: number; to: number };
  /** Un prefermento da impastare in ritardo sull'orario previsto. */
  overdue: ItemState | null;
}

/** Stato sintetico della fase, attribuito al prefermento giusto. */
export function stageStatus(stage: PrefermentStage, now = Date.now()): StageStatus {
  const st = normalizeStage(stage);
  const items = st.items ?? [];
  const all = items.map(it => itemState(it, now));
  const started = all.filter(x => x.started);
  const pool = started.length ? started : all;
  // Il più urgente è quello che va oltre per primo.
  const focus = pool.reduce((a, b) => (b.lateAt < a.lateAt ? b : a));
  const readyAt = Math.max(...all.map(x => x.etaMs));
  const lateAt = Math.min(...all.map(x => x.lateAt));
  const overdue = all.find(x => x.overdueMs > 0) ?? null;
  return {
    focus, all, type: focus.it.type, level: focus.level, pct: focus.pct,
    readyAt, lateAt, window: { from: readyAt, to: lateAt }, overdue,
  };
}

/** "3 h 05" / "40 min" */
export function fmtSpanH(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** "la biga e il poolish", oppure il solo nome. */
function namesOf(states: ItemState[]): { text: string; fem: boolean; plural: boolean } {
  if (states.length === 1) return { text: prefName(states[0].it.type), fem: prefIsFeminine(states[0].it.type), plural: false };
  return { text: states.map(x => prefName(x.it.type)).join(' e '), fem: states.every(x => prefIsFeminine(x.it.type)), plural: true };
}

export function readyWord(fem: boolean, plural = false): string {
  return plural ? (fem ? 'pronte' : 'pronti') : (fem ? 'pronta' : 'pronto');
}

export function fmtWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? `alle ${hm}` : `${d.toLocaleDateString('it-IT', { weekday: 'long' })} alle ${hm}`;
}

/** Testo breve per banner in home e riga in dashboard, col nome giusto. */
export function stageBannerText(s: StageStatus, now = Date.now()): { text: string; tone: 'normal' | 'ready' | 'late' } {
  const cap = (t: string) => t.replace(/^./, c => c.toUpperCase());
  if (s.focus.started && (s.level === 'late' || s.level === 'veryLate')) {
    return { text: `⚠ ${cap(prefName(s.type))} oltre da ${fmtSpanH(now - s.lateAt)}`, tone: 'late' };
  }
  if (s.overdue) {
    return { text: `⚠ ${cap(prefName(s.overdue.it.type))} da impastare (era ${fmtWhen(new Date(s.overdue.it.startAt).getTime(), now)})`, tone: 'late' };
  }
  const n = namesOf(s.all);
  if (s.all.every(x => x.started && x.pct >= 100)) {
    return { text: `🥣 ${cap(n.text)} ${readyWord(n.fem, n.plural)} · impasta entro ${fmtWhen(s.window.to, now).replace(/^alle /, 'le ')}`, tone: 'ready' };
  }
  return { text: `🥣 ${cap(n.text)} in corso · ${readyWord(n.fem, n.plural)} ${fmtWhen(s.readyAt, now)}`, tone: 'normal' };
}

/** "alla biga", "al poolish". */
export function prefAl(type: string): string {
  const n = prefName(type);
  return n === 'biga' ? 'alla biga' : n === 'autolisi' ? "all'autolisi" : `al ${n}`;
}

/** Il prefermento da preparare principale: il più lungo (quello che parte subito). */
export function mainPreparable<T extends { type: string; durationH?: number }>(prefs: T[] | undefined): T | undefined {
  return (prefs ?? []).filter(isPreparable).sort((a, b) => (b.durationH ?? 12) - (a.durationH ?? 12))[0];
}
