// tests/unit/solver.tick.parity.test.ts
// Parità solver ↔ tick sul rate di lievitazione — issue #5.
//
// Il solver (simulateTimeline) e il tick loop (useTickEngine) devono integrare
// LA STESSA cinetica. Prima della issue #5 il tick applicava amylaseCorrectedRate
// e il solver no: con la farina di default (FN 340 → amylaseIndex 0.507) il
// monitor live correva il 21.5 % più lento del piano. Il solver prometteva il 90 %
// di lievitazione a serviceEnd e il tick ci arrivava sotto.
//
// Qui il tick è RIPRODOTTO, non importato: è un hook React e non si può eseguire
// fuori da un componente. La riproduzione ricalca useTickEngine.tick() riga per
// riga per la parte che calcola deltaAdu — se qualcuno cambia quella formula
// senza toccare il solver, questo test lo intercetta.
import { describe, it, expect } from 'vitest';
import {
  kEffective, amylaseCorrectedRate, computeCurrentPH, fSaltYeast, doughCoreTemp,
  thermalTimeConstantForPhase, AGENT_GOMPERTZ,
} from '../../engine/engine-v2.4.0.js';
import { simulateTimeline } from '../../engine/serviceWindowSolver.js';

const lbf = (AGENT_GOMPERTZ as any).fresh_yeast;

/** Riproduce l'accumulo di leavAdu di useTickEngine.tick() sulla stessa timeline. */
function tickLoop(opts: {
  segments: Array<{ phaseType: string; durationH: number; ambientTempC: number }>;
  tempDough0: number; amylaseIndex: number; salt: number;
  hydration: number; totalFlourGrams: number; numPanetti: number;
  containerPreset: string; initialPH: number; stepH: number;
}) {
  const { segments, amylaseIndex, salt, hydration, totalFlourGrams,
          numPanetti, containerPreset, initialPH, stepH } = opts;
  const kRef      = kEffective(25, lbf.Ea, 'fresh_yeast');
  const saltYeast = fSaltYeast(salt);
  const totalMassKg = (totalFlourGrams * (1 + hydration / 100 + salt / 100)) / 1000;
  const ballMassKg  = totalMassKg / Math.max(1, numPanetti);

  let tempDough = opts.tempDough0, leavAdu = 0, elapsedH = 0;
  for (const seg of segments) {
    const isBulk = seg.phaseType === 'bulk_room' || seg.phaseType === 'bulk_fridge';
    const tau    = thermalTimeConstantForPhase(
      seg.phaseType, isBulk ? totalMassKg : ballMassKg, hydration, containerPreset);
    const nSteps = Math.max(1, Math.round(seg.durationH / stepH));
    const h      = seg.durationH / nSteps;
    for (let i = 0; i < nSteps; i++) {
      tempDough = doughCoreTemp(tempDough, seg.ambientTempC, h * 3600, tau);
      // ── identico a useTickEngine.tick() ──
      const currentPH = computeCurrentPH(initialPH, leavAdu, 'fresh_yeast', 0);
      const baseRate  = kEffective(tempDough, lbf.Ea, 'fresh_yeast');
      const corrRate  = amylaseCorrectedRate(baseRate, amylaseIndex, elapsedH, currentPH);
      const kRatioVal = kRef > 1e-12 ? corrRate / kRef : 0;
      leavAdu += kRatioVal * saltYeast * h;
      elapsedH += h;
    }
  }
  return leavAdu;
}

const scenari = [
  { nome: 'solo TA',    segs: [{ phaseType: 'bulk_room', durationH: 6, ambientTempC: 22 }] },
  { nome: 'solo TC',    segs: [{ phaseType: 'balled_fridge', durationH: 24, ambientTempC: 4 }] },
  { nome: 'misto TA/TC', segs: [
      { phaseType: 'bulk_room',     durationH: 2,  ambientTempC: 23 },
      { phaseType: 'bulk_fridge',   durationH: 18, ambientTempC: 4 },
      { phaseType: 'proofing',      durationH: 4,  ambientTempC: 20 },
  ] },
];

// FN 340 (default del catalogo) → 0.507; FN 250 → 1.0; FN 200 → 1.29
const indici = [
  { nome: 'default catalogo (FN 340)', v: 0.507 },
  { nome: 'neutro',                    v: 1.0 },
  { nome: 'alta attività (FN 200)',    v: 1.29 },
];

describe('parità solver ↔ tick sul rate di lievitazione (issue #5)', () => {
  for (const sc of scenari) {
    for (const idx of indici) {
      it(`UT-PAR-${sc.nome}/${idx.nome}: leavAdu finale entro 0.5 %`, () => {
        const comune = {
          hydration: 65, salt: 2.5, totalFlourGrams: 1000, numPanetti: 6,
          containerPreset: 'closed_box', initialPH: 5.8, stepH: 0.05,
        };
        const sim = simulateTimeline(
          sc.segs,
          { tempDough: 24, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 },
          {
            agentEaKj: lbf.Ea, agentType: 'fresh_yeast',
            muMaxScaled: lbf.muMax, leavLambda: lbf.lambda, agentAsymptote: 100,
            W0: 280, waterHardnessPpm: undefined,
            amylaseIndex: idx.v, subStepH: comune.stepH, ...comune,
          },
        );
        const daTick = tickLoop({ segments: sc.segs, tempDough0: 24, amylaseIndex: idx.v, ...comune });

        expect(daTick).toBeGreaterThan(0);
        const scarto = Math.abs(sim.final.leavAdu - daTick) / daTick;
        expect(scarto).toBeLessThan(0.005);
      });
    }
  }

  it('UT-PAR-sensibilità: un amylaseIndex diverso cambia davvero il risultato del solver', () => {
    // Se il solver ignorasse il parametro (il bug di #5) questo test passerebbe
    // comunque per errore: qui si verifica che NON lo ignori.
    const segs = [{ phaseType: 'bulk_room', durationH: 8, ambientTempC: 24 }];
    const run = (amylaseIndex: number) => simulateTimeline(
      segs, { tempDough: 24, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 },
      {
        agentEaKj: lbf.Ea, agentType: 'fresh_yeast', muMaxScaled: lbf.muMax,
        leavLambda: lbf.lambda, W0: 280, hydration: 65, salt: 2.5, amylaseIndex,
      },
    ).final.leavAdu;

    expect(run(1.29)).toBeGreaterThan(run(0.507));
  });
});
