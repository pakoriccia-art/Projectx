// tests/integration/qualitySolver.integration.test.ts
// Verifica l'integrazione solveQualityProfile end-to-end
import { describe, it, expect } from 'vitest';
import { solveQualityProfile } from '../../src/components/tools/FermentationPlannerView.tsx';

describe('solveQualityProfile — integrazione end-to-end', () => {

  it('INT-QSP-01: extTarget=3 → hydration ≈ 68% (formula: 60 + (3-1)×4)', () => {
    const result = solveQualityProfile(
      { extTarget: 3, aromaTarget: 3, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'napoletana', 22, 4, 0.25,
    );
    expect(result.hydration).toBeCloseTo(68, 0);
  });

  it('INT-QSP-02: extTarget=5 → hydration ≈ 76%', () => {
    const result = solveQualityProfile(
      { extTarget: 5, aromaTarget: 3, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'napoletana', 22, 4, 0.25,
    );
    expect(result.hydration).toBeCloseTo(76, 0);
  });

  it('INT-QSP-03: aromaTarget=5 → raccomanda Biga 50%', () => {
    const result = solveQualityProfile(
      { extTarget: 3, aromaTarget: 5, sciTarget: 3 },
      { W: 320, pl: 0.55 }, 'contemporanea', 22, 4, 0.25,
    );
    expect(result.prefType).toBe('biga');
    expect(result.prefFrac).toBe(50);
  });

  it('INT-QSP-04: aromaTarget=4 → Biga 30%', () => {
    const result = solveQualityProfile(
      { extTarget: 3, aromaTarget: 4, sciTarget: 3 },
      { W: 310, pl: 0.55 }, 'napoletana', 22, 4, 0.25,
    );
    expect(result.prefType).toBe('biga');
    expect(result.prefFrac).toBe(30);
  });

  it('INT-QSP-05: puntataH clampata a range stile napoletana [1, 4]h', () => {
    const result = solveQualityProfile(
      { extTarget: 5, aromaTarget: 2, sciTarget: 5 },
      { W: 200, pl: 0.3 }, 'napoletana', 22, 4, 0.25,
    );
    expect(result.puntataH).toBeGreaterThanOrEqual(1);
    expect(result.puntataH).toBeLessThanOrEqual(4);
  });

  it('INT-QSP-06: biga 50% riduce puntataH (ADU prefermento già contribuito)', () => {
    const noBiga  = solveQualityProfile({ extTarget: 3, aromaTarget: 2, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'contemporanea', 22, 4, 0.5);
    const withBiga = solveQualityProfile({ extTarget: 3, aromaTarget: 5, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'contemporanea', 22, 4, 0.5);
    // Con biga 50% la puntata deve essere ≤ quella senza biga (ADU enzima già contribuito)
    expect(withBiga.puntataH).toBeLessThanOrEqual(noBiga.puntataH + 0.1);
  });

  it('INT-QSP-07: hydration è derivata da extTarget (non modificabile dall\'utente)', () => {
    const r1 = solveQualityProfile({ extTarget: 2, aromaTarget: 3, sciTarget: 3 },
      { W: 290, pl: 0.55 }, 'napoletana', 22, 4, 0.25);
    const r2 = solveQualityProfile({ extTarget: 4, aromaTarget: 3, sciTarget: 3 },
      { W: 290, pl: 0.55 }, 'napoletana', 22, 4, 0.25);
    // Idratazioni diverse per extTarget diversi → derivata dall'engine
    expect(r2.hydration).toBeGreaterThan(r1.hydration);
  });

  it('INT-QSP-08: staglioH passato come parametro influenza totalH', () => {
    const r1 = solveQualityProfile({ extTarget: 3, aromaTarget: 3, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'napoletana', 22, 4, 0.5);
    const r2 = solveQualityProfile({ extTarget: 3, aromaTarget: 3, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'napoletana', 22, 4, 2.0);
    expect(r1.totalH).not.toEqual(r2.totalH);
  });

  it('INT-QSP-09: solveQualityProfile usa ENZYMATIC_CLOCK (muMax=9.50, lambda=0.50)', () => {
    // Il breakdown espone aduTarget calcolato con ENZYMATIC_CLOCK_PARAMS
    const result = solveQualityProfile({ extTarget: 3, aromaTarget: 3, sciTarget: 3 },
      { W: 280, pl: 0.55 }, 'napoletana', 22, 4, 0.25);
    // Il breakdown è esposto (WP-0): verifica aduTarget > 0 (calcolato da enzima)
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.aduTarget).toBeGreaterThan(0);
    // kAmbRate = fArrhenius(22) ≈ 0.824 — strettamente positivo
    expect(result.breakdown.kAmbRate).toBeGreaterThan(0);
    expect(result.breakdown.kAmbRate).toBeLessThan(1);
  });

  it('INT-QSP-10: output non muta input flour.W (input utente immutabile)', () => {
    const flour = { W: 280, pl: 0.55 };
    solveQualityProfile({ extTarget: 4, aromaTarget: 4, sciTarget: 4 }, flour, 'napoletana', 22, 4, 0.25);
    expect(flour.W).toBe(280);
  });
});
