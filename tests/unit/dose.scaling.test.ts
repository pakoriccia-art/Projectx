// tests/unit/dose.scaling.test.ts
// Scaling della dose sul muMax — issue #8.
//
// Il clamp era [0.1, 2]: con doseRef 0.25 confinava il lievito di birra a
// 0.025–0.5 %, mentre DOUGH_LIMITS dichiara 0.05–3.0 %. L'app contraddiceva sé
// stessa e la saturazione avveniva in silenzio.
import { describe, it, expect } from 'vitest';
import {
  scaleMuMaxByDose, doseFactorSaturated, DOSE_SCALING_LIMITS,
} from '../../engine/engine-v2.4.0.js';
import { DOUGH_LIMITS } from '../../src/constants/limits';

// (agente, doseRef, min dichiarato, max dichiarato)
const AGENTI: Array<[string, number, number, number]> = [
  ['fresh_yeast',       0.25, DOUGH_LIMITS.MIN_DOSE_LBF, DOUGH_LIMITS.MAX_DOSE_LBF],
  ['instant_dry_yeast', 0.10, DOUGH_LIMITS.MIN_DOSE_IDY, DOUGH_LIMITS.MAX_DOSE_IDY],
  ['sourdough_wheat',   20.0, DOUGH_LIMITS.MIN_DOSE_LM,  DOUGH_LIMITS.MAX_DOSE_LM],
];

describe('il dominio del modello copre quello dichiarato dall\'app (issue #8)', () => {
  it.each(AGENTI)('UT-DOSE-01 [%s]: nessuna saturazione dentro DOUGH_LIMITS', (_a, ref, lo, hi) => {
    expect(doseFactorSaturated(lo, ref)).toBe(false);
    expect(doseFactorSaturated(hi, ref)).toBe(false);
  });

  it.each(AGENTI)('UT-DOSE-02 [%s]: muMax è monotòno crescente nella dose', (_a, ref, lo, hi) => {
    const passi = [lo, (lo + hi) / 4, (lo + hi) / 2, hi];
    let prec = -Infinity;
    for (const d of passi) {
      const mu = scaleMuMaxByDose(12, d, ref);
      expect(mu).toBeGreaterThan(prec);
      prec = mu;
    }
  });

  it('UT-DOSE-03: il vecchio clamp avrebbe saturato dove ora non satura', () => {
    // Con [0.1, 2] la dose massima dichiarata per LBF (3 %) dava fattore 12 → tagliato a 2.
    const vecchioClamp = (d: number, ref: number) => 12 * Math.max(0.1, Math.min(2, d / ref));
    expect(scaleMuMaxByDose(12, 3.0, 0.25)).toBeGreaterThan(vecchioClamp(3.0, 0.25));
    // e a dose di riferimento i due coincidono: nessuna regressione nel caso normale
    expect(scaleMuMaxByDose(12, 0.25, 0.25)).toBeCloseTo(vecchioClamp(0.25, 0.25), 6);
  });
});

describe('la saturazione è rilevabile, non silenziosa', () => {
  it('UT-DOSE-04: sotto il minimo del dominio → saturato', () => {
    expect(doseFactorSaturated(0.001, 0.25)).toBe(true);
  });

  it('UT-DOSE-05: oltre il massimo del dominio → saturato', () => {
    expect(doseFactorSaturated(0.25 * DOSE_SCALING_LIMITS.factorMax * 2, 0.25)).toBe(true);
  });

  it('UT-DOSE-06: doseRef nullo (pasta madre senza scaling) → mai saturato, muMax invariato', () => {
    expect(doseFactorSaturated(999, null as never)).toBe(false);
    expect(scaleMuMaxByDose(7, 999, null as never)).toBe(7);
  });

  it('UT-DOSE-07: il clamp resta una guardia numerica: muMax finito anche a dose assurda', () => {
    const mu = scaleMuMaxByDose(12, 1e6, 0.25);
    expect(Number.isFinite(mu)).toBe(true);
    expect(mu).toBe(12 * DOSE_SCALING_LIMITS.factorMax);
  });
});
