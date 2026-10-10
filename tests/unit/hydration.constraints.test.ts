// tests/unit/hydration.constraints.test.ts
// Invarianti sulla sorgente unica di verità per l'idratazione — issue #20.
//
// Prima esistevano quattro risposte diverse alla stessa domanda e nessuna era
// autoritativa: STYLE_PROFILES.hydration_range, STYLE_CONSTRAINTS.hydMin/hydMax
// scritti a mano, maxSafeHydration() (rimossa in #19) e la formula inline
// 75 + (W−280)×0.05. Il default napoletana (65 %) cadeva fuori dalla finestra
// del proprio stile (55.5–62.5 %).
//
// Questi test non verificano numeri specifici — verificano la CATENA:
//   default ∈ finestra ottimale ⊆ banda di input ⊆ limiti fisici.
// Cambiare STYLE_PROFILES resta legittimo; romperne la coerenza no.
import { describe, it, expect } from 'vitest';
import {
  STYLE_CONSTRAINTS, hydrationRangeForStyle, maxHydrationForW,
  HYDRATION_INPUT_TOLERANCE_PP, type PizzaStyle,
} from '../../src/data/styleConstraints';
import { DOUGH_LIMITS } from '../../src/constants/limits';
import { STYLE_PROFILES } from '../../engine/engine-v2.4.0.js';

const STYLES = Object.keys(STYLE_CONSTRAINTS) as PizzaStyle[];

describe('idratazione — sorgente unica di verità (issue #20)', () => {
  it('UT-HYD-01: copre tutti e 5 gli stili', () => {
    expect(STYLES).toHaveLength(5);
  });

  it.each(STYLES)('UT-HYD-02 [%s]: hydOptimal riflette STYLE_PROFILES.hydration_range', (style) => {
    const profile = (STYLE_PROFILES as Record<string, any>)[style];
    expect(STYLE_CONSTRAINTS[style].hydOptimal).toEqual(profile.hydration_range);
  });

  it.each(STYLES)('UT-HYD-03 [%s]: il default è hydration_ott e cade DENTRO la finestra ottimale', (style) => {
    const c = STYLE_CONSTRAINTS[style];
    const profile = (STYLE_PROFILES as Record<string, any>)[style];
    expect(c.hydDefault).toBe(profile.hydration_ott);
    expect(c.hydDefault).toBeGreaterThanOrEqual(c.hydOptimal[0]);
    expect(c.hydDefault).toBeLessThanOrEqual(c.hydOptimal[1]);
  });

  it.each(STYLES)('UT-HYD-04 [%s]: la banda di input contiene la finestra ottimale', (style) => {
    const c = STYLE_CONSTRAINTS[style];
    expect(c.hydMin).toBeLessThanOrEqual(c.hydOptimal[0]);
    expect(c.hydMax).toBeGreaterThanOrEqual(c.hydOptimal[1]);
  });

  it.each(STYLES)('UT-HYD-05 [%s]: la banda di input sta dentro DOUGH_LIMITS', (style) => {
    const c = STYLE_CONSTRAINTS[style];
    expect(c.hydMin).toBeGreaterThanOrEqual(DOUGH_LIMITS.MIN_HYDRATION);
    expect(c.hydMax).toBeLessThanOrEqual(DOUGH_LIMITS.MAX_HYDRATION);
    expect(c.hydMin).toBeLessThan(c.hydMax);
  });

  it.each(STYLES)('UT-HYD-06 [%s]: la tolleranza applicata non supera mai HYDRATION_INPUT_TOLERANCE_PP', (style) => {
    const c = STYLE_CONSTRAINTS[style];
    expect(c.hydOptimal[0] - c.hydMin).toBeLessThanOrEqual(HYDRATION_INPUT_TOLERANCE_PP + 1e-9);
    expect(c.hydMax - c.hydOptimal[1]).toBeLessThanOrEqual(HYDRATION_INPUT_TOLERANCE_PP + 1e-9);
  });
});

describe('hydrationRangeForStyle — unico punto d\'ingresso', () => {
  it.each(STYLES)('UT-HYD-07 [%s]: senza W restituisce la banda piena dello stile', (style) => {
    const r = hydrationRangeForStyle(style, undefined);
    const c = STYLE_CONSTRAINTS[style];
    expect(r.min).toBe(c.hydMin);
    expect(r.max).toBe(c.hydMax);
    expect(r.default).toBe(c.hydDefault);
    expect(r.optimal).toEqual(c.hydOptimal);
  });

  it('UT-HYD-08: una farina più forte non restringe mai la banda rispetto a una più debole', () => {
    for (const style of STYLES) {
      const weak   = hydrationRangeForStyle(style, 180);
      const strong = hydrationRangeForStyle(style, 400);
      expect(strong.max).toBeGreaterThanOrEqual(weak.max);
    }
  });

  it('UT-HYD-09: una farina debolissima non produce un range invertito', () => {
    for (const style of STYLES) {
      const r = hydrationRangeForStyle(style, 80);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
  });

  it('UT-HYD-10: stile sconosciuto → fallback napoletana, non crash', () => {
    const r = hydrationRangeForStyle('stile-inesistente', 280);
    expect(r.default).toBe(STYLE_CONSTRAINTS.napoletana.hydDefault);
  });

  it('UT-HYD-11: maxHydrationForW è monotona crescente in W', () => {
    let prev = -Infinity;
    for (const W of [150, 200, 240, 280, 320, 360, 400]) {
      const h = maxHydrationForW(W);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
  });

  it('UT-HYD-12: maxHydrationForW(280) = 75 (punto di riferimento della formula)', () => {
    expect(maxHydrationForW(280)).toBeCloseTo(75, 6);
  });
});
