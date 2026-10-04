import { describe, it, expect } from 'vitest';
import {
  splitRecipe, prefTempAtMix, placeOf, placeTempC, durationOptions, defaultDuration,
  elapsedPrefHours, fmtGrams, isPreparable,
} from '../lib/preferment';

const biga = { id: 'b', type: 'biga', flourFraction: 50, hydration: 48, yeastPct: 0.1, tempC: 16, durationH: 16 } as any;
const poolish = { id: 'p', type: 'poolish', flourFraction: 30, hydration: 100, yeastPct: 0.05, tempC: 20, durationH: 12 } as any;

describe('splitRecipe', () => {
  it('biga 50%: grammi della biga e dell\'impasto finale', () => {
    const r = splitRecipe({ totalFlourG: 1000, hydrationPct: 65, saltPct: 2.5, agentDosePct: 0.2, prefermenti: [biga] });
    expect(r.prefs[0].flourG).toBe(500);
    expect(r.prefs[0].waterG).toBe(240);
    expect(r.prefs[0].yeastG).toBeCloseTo(0.5);
    expect(r.final.flourG).toBe(500);
    expect(r.final.waterG).toBe(410);         // 650 − 240
    expect(r.final.saltG).toBe(25);
    expect(r.final.yeastG).toBeCloseTo(2);
    expect(r.minHydrationPct).toBeNull();
  });
  it('diretto: tutta l\'acqua nell\'impasto finale', () => {
    const r = splitRecipe({ totalFlourG: 800, hydrationPct: 70, saltPct: 2, agentDosePct: 0.3 });
    expect(r.prefs).toHaveLength(0);
    expect(r.final.flourG).toBe(800);
    expect(r.final.waterG).toBeCloseTo(560);
  });
  it('poolish troppo grande per l\'idratazione: segnala il minimo', () => {
    const big = { ...poolish, flourFraction: 70 };
    const r = splitRecipe({ totalFlourG: 1000, hydrationPct: 60, saltPct: 2, agentDosePct: 0.1, prefermenti: [big] });
    expect(r.final.waterG).toBe(0);
    expect(r.minHydrationPct).toBe(70);
  });
  it('autolisi e riporto: niente lievito nel prefermento', () => {
    const r = splitRecipe({ totalFlourG: 1000, hydrationPct: 65, saltPct: 2, agentDosePct: 0.2,
      prefermenti: [{ ...biga, type: 'autolysis', yeastPct: undefined, hydration: 65 }] });
    expect(r.prefs[0].yeastG).toBeNull();
  });
});

describe('prefTempAtMix', () => {
  it('media pesata sulla massa, autolisi esclusa', () => {
    const t = prefTempAtMix([{ ...biga, tempC: 4 }, { ...poolish, tempC: 20 }], 1000)!;
    // biga 500×1.48=740 g a 4°C, poolish 300×2=600 g a 20°C
    expect(t).toBeCloseTo((740 * 4 + 600 * 20) / 1340, 5);
    expect(prefTempAtMix([{ ...biga, type: 'autolysis' }], 1000)).toBeUndefined();
    expect(prefTempAtMix([], 1000)).toBeUndefined();
  });
});

describe('luogo e durate', () => {
  it('luogo dedotto dalla temperatura se manca', () => {
    expect(placeOf({ tempC: 4 })).toBe('frigo');
    expect(placeOf({ tempC: 18 })).toBe('fresco');
    expect(placeOf({ tempC: 20 })).toBe('stanza');
    expect(placeOf({ tempC: 20, place: 'frigo' })).toBe('frigo');
  });
  it('il frigo usa la temperatura della sessione', () => {
    expect(placeTempC('frigo', 5)).toBe(5);
    expect(placeTempC('fresco')).toBe(16);
  });
  it('la durata di default è tra le opzioni, in ordine crescente', () => {
    for (const type of ['biga', 'poolish']) for (const pl of ['fresco', 'stanza', 'frigo'] as const) {
      const opts = durationOptions(type, pl);
      expect(opts).toContain(defaultDuration(type, pl));
      expect([...opts].sort((a, b) => a - b)).toEqual(opts);
      expect(Math.max(...opts)).toBeLessThanOrEqual(72);
    }
  });
  it('si preparano solo biga e poolish', () => {
    expect(isPreparable(biga)).toBe(true);
    expect(isPreparable({ type: 'riporto' })).toBe(false);
    expect(isPreparable({ type: 'autolysis' })).toBe(false);
  });
});

describe('formati', () => {
  it('ore reali al quarto d\'ora, minimo mezz\'ora', () => {
    const t0 = new Date('2026-10-04T18:00:00');
    expect(elapsedPrefHours(t0, t0.getTime() + 16.1 * 3_600_000)).toBe(16);
    expect(elapsedPrefHours(t0, t0.getTime() + 10 * 60_000)).toBe(0.5);
  });
  it('grammi: un decimale sotto i 10 g', () => {
    expect(fmtGrams(0.5)).toBe('0,5 g');
    expect(fmtGrams(240.4)).toBe('240 g');
  });
});

import { recipeProblem, prefProgress, stageDurationH, equivalentTempC, waterAdvice, MIN_FINAL_FLOUR_PCT } from '../lib/preferment';
import { fArrhenius } from '../engine';

describe('recipeProblem', () => {
  it('ricetta valida: nessun problema', () => {
    expect(recipeProblem({ totalFlourGrams: 1000, hydration: 65, prefermenti: [biga] })).toBeNull();
    expect(recipeProblem({ totalFlourGrams: 1000, hydration: 65 })).toBeNull();
  });
  it('troppa farina nei prefermenti: riduce il più grande', () => {
    const pb = recipeProblem({ totalFlourGrams: 1000, hydration: 65, prefermenti: [biga, { ...poolish, flourFraction: 50 }] })!;
    expect(pb.kind).toBe('flour');
    expect(pb.fixValue).toBe(50 - (100 - (100 - MIN_FINAL_FLOUR_PCT)));   // 40
  });
  it('acqua dei prefermenti oltre il totale: idratazione minima', () => {
    const pb = recipeProblem({ totalFlourGrams: 1000, hydration: 55, prefermenti: [{ ...poolish, flourFraction: 70 }] })!;
    expect(pb.kind).toBe('water');
    expect(pb.fixValue).toBe(70);
  });
});

describe('stageDurationH', () => {
  it('il prefermento biologico più lungo; autolisi esclusa', () => {
    expect(stageDurationH([biga, poolish, { ...biga, id: 'a', type: 'autolysis', durationH: 30 }])).toBe(16);
    expect(stageDurationH([])).toBe(0);
  });
});

describe('prefProgress (tempo termico con fArrhenius)', () => {
  const t0 = new Date('2026-10-04T18:00:00').getTime();
  const st = { startedAt: new Date(t0), plannedH: 16, plannedTempC: 16 };
  it('a temperatura costante è lineare nel tempo', () => {
    expect(prefProgress(st, t0 + 8 * 3_600_000).pct).toBeCloseTo(50, 5);
    expect(prefProgress(st, t0 + 8 * 3_600_000).etaMs).toBeCloseTo(t0 + 16 * 3_600_000, -3);
  });
  it('in frigo rallenta secondo il rapporto fArrhenius', () => {
    const f = fArrhenius as (t: number) => number;
    const moved = { ...st, moves: [{ at: new Date(t0 + 8 * 3_600_000), place: 'frigo' as const, tempC: 4 }] };
    const at = t0 + 8 * 3_600_000;
    const { etaMs } = prefProgress(moved, at);
    const expectedH = 8 * f(16) / f(4);
    expect((etaMs - at) / 3_600_000).toBeCloseTo(expectedH, 3);
    expect(expectedH).toBeGreaterThan(8);
  });
  it('orario a una maturazione data (ritardo)', () => {
    expect(prefProgress(st, t0, 125).etaMs).toBeCloseTo(t0 + 20 * 3_600_000, -3);
  });
  it('preparazioni vecchie senza plannedH: durata da readyAt', () => {
    const old = { startedAt: new Date(t0), readyAt: new Date(t0 + 10 * 3_600_000), plannedTempC: 16 };
    expect(prefProgress(old, t0 + 5 * 3_600_000).pct).toBeCloseTo(50, 5);
  });
  it('temperatura equivalente: tra quella del piano e quella del frigo', () => {
    const moved = { ...st, moves: [{ at: new Date(t0 + 8 * 3_600_000), place: 'frigo' as const, tempC: 4 }] };
    const tEq = equivalentTempC(moved, t0 + 16 * 3_600_000);
    expect(tEq).toBeGreaterThan(4);
    expect(tEq).toBeLessThan(16);
    expect(equivalentTempC(st, t0 + 16 * 3_600_000)).toBe(16);
  });
});

describe('waterAdvice', () => {
  it('dà una riga leggibile o null', () => {
    const w = waterAdvice({ ddtTarget: 18, tempAmbient: 20, waterG: 240, massKg: 0.74, hydrationPct: 48, kneadDurationMin: 3 });
    expect(w).toMatch(/acqua|ghiaccio/);
    expect(waterAdvice({ ddtTarget: 18, tempAmbient: 20, waterG: 0, massKg: 0.5, hydrationPct: 48 })).toBeNull();
  });
});

describe('prefProgress oltre il 100%', () => {
  it("l'orario di pronto resta quello in cui è stato raggiunto", () => {
    const t0 = new Date('2026-10-04T18:00:00').getTime();
    const st = { startedAt: new Date(t0), plannedH: 16, plannedTempC: 16 };
    const r = prefProgress(st, t0 + 22 * 3_600_000);
    expect(r.pct).toBeCloseTo(137.5, 3);
    expect(r.etaMs).toBeCloseTo(t0 + 16 * 3_600_000, -3);
  });
});
