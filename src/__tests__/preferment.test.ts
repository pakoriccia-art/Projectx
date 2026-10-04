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
