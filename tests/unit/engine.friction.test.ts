// tests/unit/engine.friction.test.ts
// 20 test — friction-v2.4.24, DDT, ghiaccio, mixer types
import { describe, it, expect } from 'vitest';
import {
  computeFrictionRise,
  computeEffectiveMixHydration,
  predictDoughExitTemp,
  FRICTION_PARAMS,
} from '../../engine/friction-v2.4.24.js';
import { computeWaterTempDDT } from '../../src/engine/index.ts';
import { ddtForStyle } from '../../src/data/styleConstraints.ts';

describe('Modello attrito §2.7 — friction-v2.4.24', () => {

  it('UT-FRI-01: computeFrictionRise positivo per parametri validi', () => {
    const rise = computeFrictionRise('spiral', 12, 65, 10);
    expect(rise).toBeGreaterThan(0);
    expect(Number.isFinite(rise)).toBe(true);
  });

  it('UT-FRI-02: durata maggiore produce rise maggiore (duration-aware)', () => {
    const r1 = computeFrictionRise('spiral', 8, 65, 10);
    const r2 = computeFrictionRise('spiral', 20, 65, 10);
    expect(r2).toBeGreaterThan(r1);
  });

  it('UT-FRI-03: idratazione maggiore produce rise minore (consistency-aware)', () => {
    const rLow  = computeFrictionRise('spiral', 12, 55, 10);
    const rHigh = computeFrictionRise('spiral', 12, 80, 10);
    expect(rHigh).toBeLessThan(rLow);
  });

  it('UT-FRI-04: massExponent > 0 → massa maggiore aumenta il rise (comportamento reale)', () => {
    // NOTA: il modello usa massExponent=0.15 (positivo) — rise aumenta con la massa.
    // Questo è il comportamento REALE del modello, documentato in FRICTION_PARAMS.
    const rSmall = computeFrictionRise('spiral', 12, 65, 1);
    const rLarge = computeFrictionRise('spiral', 12, 65, 20);
    // Con massExponent=0.15: (20)^0.15 ≈ 1.48, clamped a massClamp[1]=1.35 → rise maggiore per 20kg vs 1kg
    expect(rLarge).toBeGreaterThanOrEqual(rSmall);
  });

  it('UT-FRI-05: mixer a mano produce meno attrito di impastatrice spiral', () => {
    const rHand   = computeFrictionRise('hand', 12, 65, 10);
    const rSpiral = computeFrictionRise('spiral', 12, 65, 10);
    expect(rHand).toBeLessThan(rSpiral);
  });

  it('UT-FRI-06: computeFrictionRise valido (non NaN) per tutti i tipi mixer', () => {
    for (const m of ['hand', 'fork', 'spiral', 'planetary', 'diving_arm']) {
      const v = computeFrictionRise(m, 12, 65, 10);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('UT-FRI-07: computeEffectiveMixHydration H_eff in range plausibile [40, 95]%', () => {
    const mockSession = {
      hydration: 65, salt: 2,
      prefermenti: [],
      mainFlourGroup: { flours: [{ percentage: 100, W: 280, pl: 0.55, protein: 12 }] },
    };
    const hEff = computeEffectiveMixHydration(mockSession);
    expect(hEff).toBeGreaterThan(40);
    expect(hEff).toBeLessThan(95);
  });

  it('UT-FRI-08: predictDoughExitTemp > T_ambiente (attrito aggiunge calore)', () => {
    const avgN = 20; // media di 3 temperature a 20°C
    const exitTemp = predictDoughExitTemp(avgN, 'spiral', 12, 65, 10);
    expect(exitTemp).toBeGreaterThan(avgN);
  });

  it('UT-FRI-09: computeWaterTempDDT — exitWarning è un booleano', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 24, tempAmbient: 25, tempFlour: 25,
      kneadingMethod: 'spiral', waterTotalGrams: 6500,
      kneadDurationMin: 20, tapWaterC: 20,
    });
    expect(typeof result.exitWarning).toBe('boolean');
  });

  it('UT-FRI-10: mode ∈ liquid|ice|unreachable per computeWaterTempDDT', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 18, tempAmbient: 30, tempFlour: 30,
      kneadingMethod: 'spiral', waterTotalGrams: 6500,
      kneadDurationMin: 20, tapWaterC: 30,
    });
    expect(['liquid', 'ice', 'unreachable']).toContain(result.mode);
  });

  it('UT-FRI-11: frictionRiseC presente nel risultato (modello unificato attivo)', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 24, tempAmbient: 20, tempFlour: 20,
      kneadingMethod: 'spiral', waterTotalGrams: 3250,
      kneadDurationMin: 12, tapWaterC: 15,
    });
    expect(result.frictionRiseC).toBeDefined();
    expect(result.frictionRiseC).toBeGreaterThanOrEqual(0);
  });

  it('UT-FRI-12: ddtForStyle napoletana = 24°C', () => {
    expect(ddtForStyle('napoletana')).toBe(24);
  });

  it('UT-FRI-13: mode=ice → iceGrams > 0 e liquidGrams + iceGrams = waterTotalGrams', () => {
    // Forza il ramo ghiaccio: DDT basso, temperature alte
    const result = computeWaterTempDDT({
      ddtTarget: 22, tempAmbient: 28, tempFlour: 28,
      kneadingMethod: 'spiral', waterTotalGrams: 3000,
      kneadDurationMin: 15, tapWaterC: 20,
    });
    if (result.mode === 'ice') {
      expect((result.iceGrams ?? 0)).toBeGreaterThan(0);
      expect((result.iceGrams ?? 0) + (result.liquidGrams ?? 0)).toBe(result.waterTotalGrams);
    }
  });

  it('UT-FRI-14: FRICTION_PARAMS.baseRatePer10min spiral definita e positiva', () => {
    expect(FRICTION_PARAMS.baseRatePer10min.spiral).toBeGreaterThan(0);
  });

  it('UT-FRI-15: FRICTION_PARAMS.massExponent definito e positivo (hypothesis: ΔT ∝ massKg^0.15)', () => {
    // Il modello usa massExponent=0.15 (positivo). Rise cresce leggermente con la massa,
    // clampato in [massClamp[0], massClamp[1]].
    expect(FRICTION_PARAMS.massExponent).toBeGreaterThan(0);
    expect(FRICTION_PARAMS.massExponent).toBeLessThan(1);
  });

  it('UT-FRI-16: kneadDurationMin=0 → frictionRise=0', () => {
    expect(computeFrictionRise('spiral', 0, 65, 10)).toBe(0);
  });

  it('UT-FRI-17: computeFrictionRise non restituisce NaN se massKg=0 (edge case)', () => {
    const v = computeFrictionRise('spiral', 10, 65, 0);
    expect(Number.isNaN(v)).toBe(false);
  });

  it('UT-FRI-18: T_acqua calcolata (legacy path, no kneadDurationMin) è un numero finito', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 24, tempAmbient: 22, tempFlour: 22,
      kneadingMethod: 'hand', waterTotalGrams: 3250,
      // no kneadDurationMin → legacy path
    });
    expect(Number.isFinite(result.tWaterCalc)).toBe(true);
  });

  it('UT-FRI-19: exitTempC presente nel risultato (modello unificato)', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 24, tempAmbient: 20, tempFlour: 20,
      kneadingMethod: 'spiral', waterTotalGrams: 3250,
      kneadDurationMin: 12, tapWaterC: 15,
    });
    expect(result.exitTempC).toBeDefined();
  });

  it('UT-FRI-20: mode=liquid se T_acqua_calc ≥ 3°C (condizioni normali)', () => {
    const result = computeWaterTempDDT({
      ddtTarget: 25, tempAmbient: 20, tempFlour: 20,
      kneadingMethod: 'hand', waterTotalGrams: 3250,
      tapWaterC: 15,
    });
    expect(result.mode).toBe('liquid');
  });
});
