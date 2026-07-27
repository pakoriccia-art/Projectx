// tests/unit/salt.aqueous.test.ts
// Sale in concentrazione acquosa — issue #11.
//
// L'inibizione osmotica dipende da quanto sale c'è per unità d'acqua, non dalla
// dose in baker's %. A parità di 2.8 % sul farina, una napoletana a H55 espone i
// lieviti al 5.09 % di sale-in-acqua e una teglia a H80 al 3.50 %: il 45 % in meno.
// Il modello precedente assegnava a entrambe lo stesso fattore.
import { describe, it, expect } from 'vitest';
import {
  fSaltYeast, fSaltProtease, saltInWaterPct, SALT_INHIBITION_PARAMS,
} from '../../engine/engine-v2.4.0.js';
import { simulateTimeline } from '../../engine/serviceWindowSolver.js';

const H_REF = (SALT_INHIBITION_PARAMS as any).hydrationRef as number;

describe('saltInWaterPct', () => {
  it('UT-SAL-01: 2.8 % su farina a H65 → 4.31 % in acqua', () => {
    expect(saltInWaterPct(2.8, 65)).toBeCloseTo(2.8 / 0.65, 4);
  });

  it('UT-SAL-02: a parità di dose, meno acqua = più concentrato', () => {
    expect(saltInWaterPct(2.8, 55)).toBeGreaterThan(saltInWaterPct(2.8, 80));
  });

  it('UT-SAL-03: idratazione assente o implausibile → si ricade su hydrationRef', () => {
    const atteso = saltInWaterPct(2.8, H_REF);
    expect(saltInWaterPct(2.8, undefined as never)).toBeCloseTo(atteso, 6);
    expect(saltInWaterPct(2.8, 0)).toBeCloseTo(atteso, 6);
  });
});

// Il vincolo che rende la modifica sicura: a H_REF i numeri sono quelli di prima.
describe('non-regressione a idratazione di riferimento', () => {
  const attesiYeast: Array<[number, number]> = [[0, 1.000], [2, 0.800], [2.8, 0.720], [3, 0.700]];
  const attesiProt:  Array<[number, number]> = [[0, 1.000], [2, 0.840], [2.8, 0.776], [3, 0.760]];

  it.each(attesiYeast)('UT-SAL-04: fSaltYeast(%s, H65) = %s (identico al modello pre-#11)', (s, atteso) => {
    expect(fSaltYeast(s, H_REF)).toBeCloseTo(atteso, 4);
  });

  it.each(attesiProt)('UT-SAL-05: fSaltProtease(%s, H65) = %s (identico al modello pre-#11)', (s, atteso) => {
    expect(fSaltProtease(s, H_REF)).toBeCloseTo(atteso, 4);
  });

  it('UT-SAL-06: omettere l\'idratazione riproduce il comportamento precedente', () => {
    expect(fSaltYeast(2.8)).toBeCloseTo(fSaltYeast(2.8, H_REF), 6);
    expect(fSaltProtease(2.8)).toBeCloseTo(fSaltProtease(2.8, H_REF), 6);
  });
});

describe('l\'idratazione ora discrimina davvero', () => {
  it('UT-SAL-07: a parità di sale, H bassa inibisce di più', () => {
    expect(fSaltYeast(2.8, 55)).toBeLessThan(fSaltYeast(2.8, 80));
    expect(fSaltProtease(2.8, 55)).toBeLessThan(fSaltProtease(2.8, 80));
  });

  it('UT-SAL-08: napoletana vs teglia — scarto operativamente rilevante', () => {
    const napoletana = fSaltYeast(2.8, 55);   // H tipica dello stile
    const teglia     = fSaltYeast(2.8, 80);
    expect(teglia - napoletana).toBeGreaterThan(0.05);  // > 5 punti di fattore
  });

  it('UT-SAL-09: i floor restano invalicabili anche a idratazione bassa', () => {
    expect(fSaltYeast(12, 50)).toBeGreaterThanOrEqual(SALT_INHIBITION_PARAMS.yeastFloor);
    expect(fSaltProtease(12, 50)).toBeGreaterThanOrEqual(SALT_INHIBITION_PARAMS.proteaseFloor);
  });

  it('UT-SAL-10: la differenza arriva fino alla simulazione', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 8, ambientTempC: 24 }];
    const run = (hydration: number) => simulateTimeline(
      segs, { tempDough: 24, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 },
      {
        agentEaKj: 62, agentType: 'fresh_yeast', muMaxScaled: 12, leavLambda: 1.2,
        W0: 280, hydration, salt: 2.8,
      },
    ).final.leavAdu;
    // Più acqua → sale più diluito → lieviti meno inibiti → più ADU
    expect(run(80)).toBeGreaterThan(run(55));
  });
});
