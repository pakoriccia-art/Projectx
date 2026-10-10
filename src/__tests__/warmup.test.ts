import { describe, it, expect } from 'vitest';
import { computeWarmupH, panMassKgOf, warmupHForSession } from '../lib/warmup';

describe('computeWarmupH', () => {
  it('0 se l\'ambiente non supera la soglia o il frigo è già sopra', () => {
    expect(computeWarmupH(0.28, 65, 4, 15)).toBe(0);
    expect(computeWarmupH(0.28, 65, 16, 22)).toBe(0);
  });
  it('cassetta chiusa più lenta del panetto scoperto', () => {
    expect(computeWarmupH(0.28, 65, 4, 22, 'closed_box')).toBeGreaterThan(computeWarmupH(0.28, 65, 4, 22, 'bare'));
  });
  // Riferimenti di letteratura (Heisler, Bi ≈ 0.8; Lehmann/PMQ per le cassette)
  it('250 g scoperto, 4 → 18 °C a 20 °C: ~3.2 h', () => {
    expect(computeWarmupH(0.25, 65, 4, 20, 'bare', 18)).toBeCloseTo(3.2, 0);
  });
  it('250 g in cassetta, 4 → 18 °C a 20 °C: 5–6.5 h; → 15 °C circa la metà', () => {
    const to18 = computeWarmupH(0.25, 65, 4, 20, 'closed_box', 18);
    const to15 = computeWarmupH(0.25, 65, 4, 20, 'closed_box');
    expect(to18).toBeGreaterThan(5);
    expect(to18).toBeLessThan(6.5);
    expect(to15).toBeGreaterThan(2.5);
    expect(to15).toBeLessThan(3.5);
  });
});

describe('warmupHForSession', () => {
  const dough = { totalFlourGrams: 1000, hydration: 65, salt: 2, numPanetti: 6, fridgeTempC: 4 };
  it('panetto da ~278 g', () => {
    expect(panMassKgOf(dough)).toBeCloseTo(0.278, 3);
  });
  it('arrotondato in su al quarto d\'ora', () => {
    const h = warmupHForSession({ ...dough, containerPreset: 'closed_box' }, 22);
    expect(h * 4).toBe(Math.round(h * 4));
    expect(h).toBeGreaterThanOrEqual(computeWarmupH(panMassKgOf(dough), 65, 4, 22, 'closed_box'));
  });
});
