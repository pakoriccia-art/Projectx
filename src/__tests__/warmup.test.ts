import { describe, it, expect } from 'vitest';
import { computeWarmupH, panMassKgOf, warmupHForSession } from '../lib/warmup';

describe('computeWarmupH', () => {
  it('0 se l\'ambiente non supera i 18° o il frigo è già sopra', () => {
    expect(computeWarmupH(0.28, 65, 4, 18)).toBe(0);
    expect(computeWarmupH(0.28, 65, 19, 22)).toBe(0);
  });
  it('cresce con la resistenza del contenitore', () => {
    expect(computeWarmupH(0.28, 65, 4, 22, 2.5)).toBeGreaterThan(computeWarmupH(0.28, 65, 4, 22, 1));
  });
});

describe('warmupHForSession', () => {
  const dough = { totalFlourGrams: 1000, hydration: 65, salt: 2, numPanetti: 6, fridgeTempC: 4 };
  it('panetto da ~278 g', () => {
    expect(panMassKgOf(dough)).toBeCloseTo(0.278, 3);
  });
  it('cassetta chiusa più lenta del panetto scoperto', () => {
    expect(warmupHForSession({ ...dough, containerPreset: 'closed_box' }, 22))
      .toBeGreaterThan(warmupHForSession({ ...dough, containerPreset: 'bare' }, 22));
  });
  it('arrotondato in su al quarto d\'ora', () => {
    const h = warmupHForSession({ ...dough, containerPreset: 'closed_box' }, 22);
    expect(h * 4).toBe(Math.round(h * 4));
    expect(h).toBeGreaterThanOrEqual(computeWarmupH(panMassKgOf(dough), 65, 4, 22, 2.5));
  });
});
