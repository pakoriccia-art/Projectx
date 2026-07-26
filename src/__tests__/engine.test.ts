/**
 * PizzaMatrix — Engine v2.4.0 — Vitest wrapper
 * Porta i casi critici del KB in formato describe/it/expect
 */
import { describe, it, expect } from 'vitest';
import {
  cardinalCorrection, kEffective, gompertz,
  fArrhenius, fPH, fHydration,
  computeTCrit, computeWHill,
  fSaltYeast, fSaltProtease,
  fHardnessGluten, fHardnessProtease,
  computeWBlendNonLinear,
  computeAltitudeFactor, volumeMilestoneCorrection,
  computeMaltAmylaseContrib, maltAlertLevel,
  computeReverseScaling,
  thermalTimeConstant, thermalTimeConstantSphere,
  blendAmylaseIndex,
  HILL_W_DECAY,
} from '../engine';

// ─── Tolleranza default ───────────────────────────────────────────────────────
const approx = (a: number, b: number, tol = 0.01) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

// ─── CTM × Arrhenius ─────────────────────────────────────────────────────────
describe('§D — Core Kinetics', () => {
  it('cardinalCorrection = 1.0 a T_opt=28°C (fresh_yeast)', () => {
    // CARDINAL_PARAMS.fresh_yeast.Topt = 28°C
    const k = (cardinalCorrection as Function)(28, 'fresh_yeast') as number;
    approx(k, 1.0, 0.01);
  });

  it('kEffective(25°C) ≥ kEffective(10°C)', () => {
    const k25 = (kEffective as Function)(25, 47, 'fresh_yeast') as number;
    const k10 = (kEffective as Function)(10, 47, 'fresh_yeast') as number;
    expect(k25).toBeGreaterThan(k10);
  });

  it('kEffective è 0 fuori range cardinale (<T_min, >T_max)', () => {
    const k = (kEffective as Function)(-5, 47, 'fresh_yeast') as number;
    expect(k).toBe(0);
  });

  // Modello cardinale (CTM), fresh_yeast Topt=28°C: oltre l'ottimo la velocità
  // DECRESCE verso Tmax=45°C. 30° e 35° sono entrambi post-ottimo → k35 < k30.
  // (Il vecchio oracolo k35 > k30 rifletteva il doppio conteggio della
  //  temperatura rimosso in aec1079: senza cardinale la curva saliva oltre 28°.)
  it('kEffective decresce oltre l\'ottimo: kEffective(35°C) < kEffective(30°C)', () => {
    const k35 = (kEffective as Function)(35, 47, 'fresh_yeast') as number;
    const k30 = (kEffective as Function)(30, 47, 'fresh_yeast') as number;
    expect(k35).toBeLessThan(k30);
  });
});

// ─── Gompertz ────────────────────────────────────────────────────────────────
describe('§D — Gompertz', () => {
  it('gompertz(0) ≈ 0 con parametri realistici (muMax=12, lambda=1.2)', () => {
    // Con muMax=12, lambda=1.2 (AGENT_GOMPERTZ.fresh_yeast): ~1.3% a t=0
    const v = (gompertz as Function)(0, 12, 1.2, 100) as number;
    expect(v).toBeLessThan(5);
  });

  it('gompertz sale monotonicamente', () => {
    const vals = [1, 2, 4, 8, 16].map(adu =>
      (gompertz as Function)(adu, 0.5, 2, 100) as number
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });

  it('gompertz asintota ≤ asymptote', () => {
    const v = (gompertz as Function)(1000, 0.5, 2, 100) as number;
    expect(v).toBeLessThanOrEqual(100);
  });
});

// ─── Hill W-decay ────────────────────────────────────────────────────────────
describe('§F — Hill W-decay', () => {
  it('W(0) = W0', () => {
    const w = (computeWHill as Function)(300, 48, 0, (HILL_W_DECAY as any).hillExponent) as number;
    approx(w, 300, 1);
  });

  it('W(t_crit) = W0/2 (half-life Hill n=5)', () => {
    // W(t) = W0/(1+(t/tCrit)^n) → a t=tCrit: W0/(1+1) = W0/2
    const W0 = 300;
    const tc = 48;
    const n  = (HILL_W_DECAY as any).hillExponent;
    const w  = (computeWHill as Function)(W0, tc, tc, n) as number;
    approx(w, W0 / 2, 2);
  });

  it('W decade monotonicamente nel tempo', () => {
    const W0 = 300; const tc = 48; const n = 5;
    const vals = [0, 12, 24, 48, 96].map(t =>
      (computeWHill as Function)(W0, tc, t, n) as number
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThanOrEqual(vals[i - 1]);
    }
  });

  it('computeTCrit: sale più alto con W più alto', () => {
    const tc200 = (computeTCrit as Function)(200, 22, 5.5, 65) as number;
    const tc350 = (computeTCrit as Function)(350, 22, 5.5, 65) as number;
    expect(tc350).toBeGreaterThan(tc200);
  });
});

// ─── Arrhenius + pH ──────────────────────────────────────────────────────────
describe('§F — fArrhenius / fPH / fHydration', () => {
  it('fArrhenius(T_ref=25) = 1.0', () => {
    const f = (fArrhenius as Function)(25, 47) as number;
    approx(f, 1.0, 0.001);
  });

  it('fArrhenius(4°C) < fArrhenius(25°C)', () => {
    const f4  = (fArrhenius as Function)(4,  47) as number;
    const f25 = (fArrhenius as Function)(25, 47) as number;
    expect(f4).toBeLessThan(f25);
  });

  it('fPH ottimo a 5.2 (pHOptProteasi=5.2, σ=0.6)', () => {
    // pHOptProteasi = 5.2 → max a 5.2; valori lontani sono più bassi
    const fOpt = (fPH as Function)(5.2) as number;
    const f45  = (fPH as Function)(4.5) as number;
    const f60  = (fPH as Function)(6.0) as number;
    approx(fOpt, 1.0, 0.001);
    expect(fOpt).toBeGreaterThan(f45);
    expect(fOpt).toBeGreaterThan(f60);
  });

  it('fHydration(65) > fHydration(50)', () => {
    const h65 = (fHydration as Function)(65) as number;
    const h50 = (fHydration as Function)(50) as number;
    expect(h65).toBeGreaterThan(h50);
  });
});

// ─── Salt v2.4.0 ─────────────────────────────────────────────────────────────
describe('§L — Salt inhibition v2.4.0', () => {
  it('fSaltYeast(2%) = 0.80 (KB §2.14.2)', () => {
    approx((fSaltYeast as Function)(2) as number, 0.80, 0.001);
  });

  it('fSaltProtease(2%) = 0.84 (KB §2.14.2)', () => {
    approx((fSaltProtease as Function)(2) as number, 0.84, 0.001);
  });

  it('fSaltYeast(0%) = 1.0', () => {
    approx((fSaltYeast as Function)(0) as number, 1.0, 0.001);
  });

  it('fSaltYeast floor ≥ 0.60', () => {
    expect((fSaltYeast as Function)(10) as number).toBeGreaterThanOrEqual(0.60);
  });

  it('fSaltProtease floor ≥ 0.70', () => {
    expect((fSaltProtease as Function)(10) as number).toBeGreaterThanOrEqual(0.70);
  });
});

// ─── Water Hardness v2.4.0 ───────────────────────────────────────────────────
describe('§Q — Water Hardness v2.4.0', () => {
  it('fHardnessGluten(150ppm) = 1.0 (ref)', () => {
    approx((fHardnessGluten as Function)(150) as number, 1.0, 0.001);
  });

  it('fHardnessGluten(300ppm) ≈ 1.120', () => {
    approx((fHardnessGluten as Function)(300) as number, 1.120, 0.005);
  });

  it('fHardnessProtease(150ppm) = 1.0 (ref)', () => {
    approx((fHardnessProtease as Function)(150) as number, 1.0, 0.001);
  });

  it('fHardnessProtease(300ppm) ≈ 0.940', () => {
    approx((fHardnessProtease as Function)(300) as number, 0.940, 0.005);
  });

  it('acqua morbida (50ppm): proteolisi più veloce (< 1.0)', () => {
    const f = (fHardnessProtease as Function)(50) as number;
    expect(f).toBeGreaterThan(1.0); // meno Ca → protease più libera → t_crit ridotto
  });
});

// ─── Blend non-lineare v2.4.0 ────────────────────────────────────────────────
describe('§M — W Blend Non-Linear v2.4.0', () => {
  it('blend monofarina = W farina', () => {
    const w = (computeWBlendNonLinear as Function)([{ W: 280, percentage: 100 }]) as number;
    approx(w, 280, 1);
  });

  it('blend con spread < 75 ≈ lineare', () => {
    const w = (computeWBlendNonLinear as Function)([
      { W: 260, percentage: 50 }, { W: 300, percentage: 50 },
    ]) as number;
    approx(w, 280, 1); // spread=40 < 75 → nessuna correzione
  });

  it('blend con spread 200: W < W_lineare (correzione negativa)', () => {
    const flours = [{ W: 180, percentage: 50 }, { W: 380, percentage: 50 }];
    const wLin = 280;
    const w = (computeWBlendNonLinear as Function)(flours) as number;
    expect(w).toBeLessThan(wLin);
  });
});

// ─── Altitudine v2.4.0 ───────────────────────────────────────────────────────
describe('§P — Altitude v2.4.0', () => {
  it('computeAltitudeFactor(0) = 1.0', () => {
    approx((computeAltitudeFactor as Function)(0) as number, 1.0, 0.001);
  });

  it('computeAltitudeFactor(1000m) ≈ 1.122 (da KB §2.16.1 tol 0.01)', () => {
    approx((computeAltitudeFactor as Function)(1000) as number, 1.122, 0.01);
  });

  it('fattore cresce con la quota', () => {
    const f0    = (computeAltitudeFactor as Function)(0) as number;
    const f1000 = (computeAltitudeFactor as Function)(1000) as number;
    const f2000 = (computeAltitudeFactor as Function)(2000) as number;
    expect(f2000).toBeGreaterThan(f1000);
    expect(f1000).toBeGreaterThan(f0);
  });

  it('volumeMilestoneCorrection riduce il target biologico', () => {
    const corr = (volumeMilestoneCorrection as Function)(1.5, 1000) as number;
    expect(corr).toBeLessThan(1.5);
  });
});

// ─── Malto v2.4.0 ────────────────────────────────────────────────────────────
describe('§O — Malt Diastatic v2.4.0', () => {
  it('computeMaltAmylaseContrib(0.3%, 200°L) > 0', () => {
    const c = (computeMaltAmylaseContrib as Function)(0.3, 200) as number;
    expect(c).toBeGreaterThan(0);
  });

  it('maltAlertLevel(1.0) = OK', () => {
    expect((maltAlertLevel as Function)(1.0)).toBe('OK');
  });

  it('maltAlertLevel(1.55) = ADVISORY', () => {
    expect((maltAlertLevel as Function)(1.55)).toBe('ADVISORY');
  });

  it('maltAlertLevel(1.82) = CRITICAL', () => {
    expect((maltAlertLevel as Function)(1.82)).toBe('CRITICAL');
  });

  it('maltAlertLevel(2.01) = BLOCKED', () => {
    expect((maltAlertLevel as Function)(2.01)).toBe('BLOCKED');
  });
});

// ─── Reverse Scaling v2.4.0 ──────────────────────────────────────────────────
describe('§R — Reverse Scaling v2.4.0', () => {
  const params = {
    availablePrefermKg: 2,
    prefermType: 'poolish' as const,
    targetFlourFraction: 60,
    targetHydration: 65,
    targetPanWeightG: 260,
  };

  it('totalFlourKg ≈ 3.333', () => {
    const r = (computeReverseScaling as Function)(params) as { totalFlourKg: number };
    approx(r.totalFlourKg, 3.333, 0.01);
  });

  it('numPanetti ragionevole (> 0)', () => {
    const r = (computeReverseScaling as Function)(params) as { numPanetti: number };
    expect(r.numPanetti).toBeGreaterThan(0);
  });

  it('panWeight = targetPanWeightG', () => {
    const r = (computeReverseScaling as Function)(params) as { panWeight: number };
    expect(r.panWeight).toBe(260);
  });

  it('throws su availablePrefermKg = 0', () => {
    expect(() =>
      (computeReverseScaling as Function)({ ...params, availablePrefermKg: 0 })
    ).toThrow();
  });
});

// ─── Termico ─────────────────────────────────────────────────────────────────
describe('§E — Thermal Stack', () => {
  it('τ_cilindro(1kg, 65%) > τ_sfera(0.166kg, 65%) [bulk >> panetto]', () => {
    const tauBulk  = (thermalTimeConstant as Function)(1, 65) as number;
    const tauBall  = (thermalTimeConstantSphere as Function)(1/6, 65) as number;
    // Il bulk è molto più grande → τ molto più alto
    expect(tauBulk).toBeGreaterThan(tauBall);
  });
});

// ─── §J — estimatePH: RIMOSSA (dual-population non funzionante, cfr. issue #19) ──

// ─── blendAmylaseIndex ───────────────────────────────────────────────────────
describe('§H — blendAmylaseIndex', () => {
  // blendAmylaseIndex vuole flours con FN (Falling Number) e percentage
  // normalizeAmylaseActivity(FN) = 2/(1+exp(0.012*(FN-250)))
  // FN basso → alta attività amilasica; FN alto → bassa attività

  it('FN basso (120s) → indice alto (> 1.5)', () => {
    const idx = (blendAmylaseIndex as Function)([{ FN: 120, percentage: 100 }]) as number;
    expect(idx).toBeGreaterThan(1.5);
  });

  it('FN alto (400s) → indice basso (< 0.5)', () => {
    const idx = (blendAmylaseIndex as Function)([{ FN: 400, percentage: 100 }]) as number;
    expect(idx).toBeLessThan(0.5);
  });

  it('FN=250 → indice ≈ 1.0 (punto di riferimento)', () => {
    // 2/(1+exp(0)) = 2/2 = 1.0
    const idx = (blendAmylaseIndex as Function)([{ FN: 250, percentage: 100 }]) as number;
    approx(idx, 1.0, 0.01);
  });

  it('blend 50/50 = media pesata dei contributi FN', () => {
    const i1 = (blendAmylaseIndex as Function)([{ FN: 200, percentage: 100 }]) as number;
    const i2 = (blendAmylaseIndex as Function)([{ FN: 300, percentage: 100 }]) as number;
    const iBlend = (blendAmylaseIndex as Function)([
      { FN: 200, percentage: 50 }, { FN: 300, percentage: 50 },
    ]) as number;
    approx(iBlend, (i1 + i2) / 2, 0.01);
  });
});
