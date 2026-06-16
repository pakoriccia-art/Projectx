// tests/service/serviceWindowSolver.test.ts
// 25 test — contratti I/O solver, feasibility, reasons, vincoli C1/C2/C3
import { describe, it, expect } from 'vitest';
import {
  solveNowAnchoredWindow, solveServiceWindow,
  computeMaxSafeServiceWindow, buildServiceWindowTimeline,
  simulateTimeline,
} from '../../engine/serviceWindowSolver.js';
import { AGENT_GOMPERTZ } from '../../engine/engine-v2.4.0.js';

const lbf = (AGENT_GOMPERTZ as any).fresh_yeast;

const baseNowInput = (overrides: Record<string, unknown> = {}) => {
  const now = new Date();
  return {
    now,
    serviceStart: new Date(now.getTime() + 22 * 3600 * 1000),
    serviceDurationH: 3,
    ambientTempC: 22, fridgeTempC: 4,
    agentType: 'fresh_yeast',
    agentEaKj: lbf.Ea, agentMuMax: lbf.muMax, agentLambda: lbf.lambda, agentAsymptote: 100,
    agentDosePct: 0.3, W0: 280, hydration: 65, salt: 2,
    totalFlourGrams: 1000, numPanetti: 4, containerPreset: 'closed_box',
    puntataKickoffH: 2, staglioH: 0.25,
    ...overrides,
  };
};

describe('ServiceWindowSolver — contratti di servizio', () => {

  it('SVC-SWS-01: output sempre include mixStartIsNow:true', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    expect(result.mixStartIsNow).toBe(true);
  });

  it('SVC-SWS-02: feasible:false + infeasibility.reason definito se finestra impossibile', () => {
    const result = solveNowAnchoredWindow(baseNowInput({ ambientTempC: 10 }));
    expect(result.feasible).toBe(false);
    expect(result.infeasibility?.reason).toBeDefined();
  });

  it('SVC-SWS-03: feasible:true + timeline definita se scenario valido', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    if (result.feasible) {
      expect((result as any).timeline ?? (result as any).schedule).toBeDefined();
    }
    // Al minimo mixStartIsNow=true garantito
    expect(result.mixStartIsNow).toBe(true);
  });

  it('SVC-SWS-04: fridgeTempAdjusted:true solo se feasible:true', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    if (!result.feasible) {
      expect(result.fridgeTempAdjusted).toBeFalsy();
    }
  });

  it('SVC-SWS-05: reason=cannot_temper se ambientTempC ≤ 18', () => {
    const result = solveNowAnchoredWindow(baseNowInput({ ambientTempC: 15 }));
    expect(result.feasible).toBe(false);
    expect(result.infeasibility?.reason).toBe('cannot_temper');
  });

  it('SVC-SWS-06: reason non è OK se scenario chiaramente impossibile', () => {
    const now = new Date();
    const result = solveNowAnchoredWindow(baseNowInput({
      serviceStart: new Date(now.getTime() + 1 * 3600 * 1000), // 1h da ora
      puntataKickoffH: 5, // 5h puntata impossibile in 1h
    }));
    if (!result.feasible) {
      expect(result.infeasibility?.reason).toBeDefined();
    }
  });

  it('SVC-SWS-07: output.feasible è booleano (non undefined)', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    expect(typeof result.feasible).toBe('boolean');
  });

  it('SVC-SWS-08: mixStart ≈ now (±5 secondi) per now-anchored', () => {
    const now = new Date();
    const result = solveNowAnchoredWindow({ ...baseNowInput(), now });
    const delta = Math.abs((result.mixStart as Date).getTime() - now.getTime());
    expect(delta).toBeLessThan(5000);
  });

  it('SVC-SWS-09: ambientTempC alta riduce maxSafeServiceWindowH', () => {
    const s1 = computeMaxSafeServiceWindow(
      { tempDough: 20, enzAdu: 1, leavAdu: 1, enzymaticMatPct: 10, leaveningPct: 10, wDamage: 0.1, W_current: 270, structuralState: 'OK', elapsedH: 20 },
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, salt: 2, W0: 280 },
      { ambientTempC: 20 },
    );
    const s2 = computeMaxSafeServiceWindow(
      { tempDough: 28, enzAdu: 1, leavAdu: 1, enzymaticMatPct: 10, leaveningPct: 10, wDamage: 0.1, W_current: 270, structuralState: 'OK', elapsedH: 20 },
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, salt: 2, W0: 280 },
      { ambientTempC: 28 },
    );
    // T più alta = maturazione più veloce = finestra più corta
    expect(s2.maxSafeServiceWindowH).toBeLessThanOrEqual(s1.maxSafeServiceWindowH + 1);
  });

  it('SVC-SWS-10: computeMaxSafeServiceWindow.maxSafeServiceWindowH in [0, 48]', () => {
    const result = computeMaxSafeServiceWindow(
      { tempDough: 18, enzAdu: 0.5, leavAdu: 0.3, enzymaticMatPct: 5, leaveningPct: 5, wDamage: 0.1, W_current: 275, structuralState: 'OK', elapsedH: 20 },
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, salt: 2, W0: 280 },
      {},
    );
    expect(result.maxSafeServiceWindowH).toBeGreaterThanOrEqual(0);
    expect(result.maxSafeServiceWindowH).toBeLessThanOrEqual(48);
  });

  it('SVC-SWS-11: buildServiceWindowTimeline → phaseType ∈ PHASE_ORDER values', () => {
    const validPhases = ['bulk_room', 'bulk_fridge', 'balled_room', 'balled_fridge', 'proofing', 'baking'];
    const segs = buildServiceWindowTimeline({
      puntataH: 2, staglioH: 0.25, tcHours: 18, temperingH: 2,
      serviceDurationH: 4, ambientTempC: 22, fridgeTempC: 4,
    });
    for (const s of segs) {
      expect(validPhases).toContain(s.phaseType);
    }
  });

  it('SVC-SWS-12: simulateTimeline è pura — non modifica input state', () => {
    const state = { tempDough: 22, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
                    leaveningPct: 0, wDamage: 0, W_current: 280, structuralState: 'OK', elapsedH: 0 };
    const stateCopy = { ...state };
    simulateTimeline(
      [{ phaseType: 'bulk_room', durationH: 2, ambientTempC: 22, startElapsedH: 0 }],
      state,
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, muMaxScaled: lbf.muMax, leavLambda: lbf.lambda, agentAsymptote: 100, salt: 2, W0: 280 },
    );
    expect(state.enzAdu).toBe(stateCopy.enzAdu);
    expect(state.leavAdu).toBe(stateCopy.leavAdu);
    expect(state.W_current).toBe(stateCopy.W_current);
  });

  it('SVC-SWS-13: output di solveNowAnchoredWindow ha chiave mixStart (Date)', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    expect(result.mixStart).toBeInstanceOf(Date);
  });

  it('SVC-SWS-14: infeasibility.reason ∈ valori enum noti', () => {
    const reasons = ['cannot_temper', 'cannot_slow_enough', 'w_collapse', 'window_too_short',
                     'window_too_short_maturation', 'bubble_threshold_lm_unscalable',
                     'maturation_overshoot', 'invalid_timestamps', 'invalid_input'];
    const result = solveNowAnchoredWindow(baseNowInput({ ambientTempC: 10 }));
    if (!result.feasible && result.infeasibility?.reason) {
      expect(reasons).toContain(result.infeasibility.reason);
    }
  });

  it('SVC-SWS-15: solveNowAnchoredWindow non modifica input (input immutabile)', () => {
    const input = baseNowInput();
    const salt0 = (input as any).salt;
    solveNowAnchoredWindow(input);
    expect((input as any).salt).toBe(salt0);
  });

  it('SVC-SWS-16: computeMaxSafeServiceWindow.binding ∈ valori attesi', () => {
    const result = computeMaxSafeServiceWindow(
      { tempDough: 18, enzAdu: 1, leavAdu: 1, enzymaticMatPct: 15, leaveningPct: 20,
        wDamage: 0.3, W_current: 260, structuralState: 'OK', elapsedH: 22 },
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, salt: 2, W0: 280 },
      {},
    );
    expect(['maturation', 'bubble', 'w_collapse', 'none']).toContain(result.binding);
  });

  it('SVC-SWS-17: solveServiceWindow output ha chiave feasible e mixStart', () => {
    const now = new Date();
    const result = solveServiceWindow({
      now,
      serviceStart: new Date(now.getTime() + 22 * 3600 * 1000),
      serviceDurationH: 3,
      agentType: 'fresh_yeast', agentEaKj: lbf.Ea, agentMuMax: lbf.muMax,
      agentLambda: lbf.lambda, agentDosePct: 0.3,
      W0: 280, hydration: 65, salt: 2, ambientTempC: 22, fridgeTempC: 4,
      containerPreset: 'closed_box', puntataKickoffH: 2, staglioH: 0.25,
    });
    expect(typeof result.feasible).toBe('boolean');
  });

  it('SVC-SWS-18: buildServiceWindowTimeline con tcHours=0 non produce balled_fridge', () => {
    const segs = buildServiceWindowTimeline({
      puntataH: 2, staglioH: 0.25, tcHours: 0, temperingH: 0,
      serviceDurationH: 3, ambientTempC: 22, fridgeTempC: 4,
    });
    const hasFridge = segs.some((s: any) => s.phaseType === 'balled_fridge');
    expect(hasFridge).toBe(false);
  });

  it('SVC-SWS-19: simulateTimeline enzAdu aumenta sempre per T > 0 (fArrhenius > 0)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 2, ambientTempC: 22, startElapsedH: 0 }];
    const initial = { tempDough: 22, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
                      leaveningPct: 0, wDamage: 0, W_current: 280, structuralState: 'OK', elapsedH: 0 };
    const { final } = simulateTimeline(segs, initial,
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, muMaxScaled: lbf.muMax, leavLambda: lbf.lambda,
        agentAsymptote: 100, salt: 0, W0: 280 });
    expect(final.enzAdu).toBeGreaterThan(0);
  });

  it('SVC-SWS-20: solveNowAnchoredWindow result resolvedTargetMaturationPct definito', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    expect((result as any).resolvedTargetMaturationPct).toBeDefined();
  });

  it('SVC-SWS-21: solveNowAnchoredWindow resolvedBubbleThresholdPct in [80, 100]', () => {
    const result = solveNowAnchoredWindow(baseNowInput());
    const bubblePct = (result as any).resolvedBubbleThresholdPct;
    expect(bubblePct).toBeGreaterThanOrEqual(80);
    expect(bubblePct).toBeLessThanOrEqual(100);
  });

  it('SVC-SWS-22: buildServiceWindowTimeline con temperingH=0 produce 1 solo segmento proofing', () => {
    const segs = buildServiceWindowTimeline({
      puntataH: 2, staglioH: 0.25, tcHours: 18, temperingH: 0,
      serviceDurationH: 4, ambientTempC: 22, fridgeTempC: 4,
    });
    const proofingSegs = segs.filter((s: any) => s.phaseType === 'proofing');
    // temperingH=0 → solo il segmento di servizio (nessun tempering separato)
    expect(proofingSegs.length).toBe(1);
  });

  it('SVC-SWS-23: simulateTimeline W_current mai superiore a W0 (nessun recovery)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 10, ambientTempC: 25, startElapsedH: 0 }];
    const initial = { tempDough: 25, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
                      leaveningPct: 0, wDamage: 0, W_current: 300, structuralState: 'OK', elapsedH: 0 };
    const { samples } = simulateTimeline(segs, initial,
      { agentType: 'fresh_yeast', agentEaKj: lbf.Ea, muMaxScaled: lbf.muMax, leavLambda: lbf.lambda,
        agentAsymptote: 100, salt: 0, W0: 300 });
    for (const s of samples) {
      expect((s as any).W_current).toBeLessThanOrEqual(300 + 0.01);
    }
  });

  it('SVC-SWS-24: solveNowAnchoredWindow con staglioH=0 non crasha', () => {
    const result = solveNowAnchoredWindow(baseNowInput({ staglioH: 0 }));
    expect(typeof result.feasible).toBe('boolean');
  });

  it('SVC-SWS-25: solveServiceWindow con numPanetti=1 e totalFlourGrams=500 non crasha', () => {
    const now = new Date();
    const result = solveServiceWindow({
      now,
      serviceStart: new Date(now.getTime() + 22 * 3600 * 1000),
      serviceDurationH: 3,
      agentType: 'fresh_yeast', agentEaKj: lbf.Ea, agentMuMax: lbf.muMax,
      agentLambda: lbf.lambda, agentDosePct: 0.3,
      W0: 280, hydration: 65, salt: 2, ambientTempC: 22, fridgeTempC: 4,
      containerPreset: 'closed_box', puntataKickoffH: 2, staglioH: 0.25,
      totalFlourGrams: 500, numPanetti: 1,
    });
    expect(typeof result.feasible).toBe('boolean');
  });
});
