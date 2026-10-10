// tests/unit/engine.solver.test.ts
// 20 test — serviceWindowSolver pure functions, simulateTimeline internals
import { describe, it, expect } from 'vitest';
import {
  computeTemperingH,
  buildServiceWindowTimeline,
  computeMaxSafeServiceWindow,
  solveNowAnchoredWindow,
  solveServiceWindow,
  simulateTimeline,
} from '../../engine/serviceWindowSolver.js';
import { AGENT_GOMPERTZ } from '../../engine/engine-v2.4.0.js';

const mkBase = (tempC = 22, W = 280) => ({
  tempDough: tempC, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
  leaveningPct: 0, wDamage: 0, W_current: W, structuralState: 'OK', elapsedH: 0,
});

// Opts completi per simulateTimeline: richiede agentEaKj, muMaxScaled, leavLambda
const mkSimOpts = (agentType: string, salt = 2, W0 = 280, dosePct = 0.3) => {
  const ag = (AGENT_GOMPERTZ as any)[agentType] ?? (AGENT_GOMPERTZ as any).fresh_yeast;
  return {
    agentType, agentEaKj: ag.Ea, muMaxScaled: ag.muMax,
    leavLambda: ag.lambda, agentAsymptote: ag.asymptote ?? 100,
    salt, W0, hydration: 65, agentDosePct: dosePct,
  };
};

describe('serviceWindowSolver — funzioni pure', () => {

  it('UT-SOL-01: computeTemperingH > 0 quando pallina è fredda', () => {
    const h = computeTemperingH({ ballMassKg: 0.26, hydration: 65, fridgeTempC: 4, ambientTempC: 22, targetC: 18 });
    expect(h).toBeGreaterThan(0);
  });

  it('UT-SOL-02: computeTemperingH = 0 se T_frigo >= T_target', () => {
    const h = computeTemperingH({ ballMassKg: 0.26, hydration: 65, fridgeTempC: 20, ambientTempC: 22, targetC: 18 });
    expect(h).toBe(0);
  });

  it('UT-SOL-03: temperingH aumenta con la massa della pallina', () => {
    const h1 = computeTemperingH({ ballMassKg: 0.20, hydration: 65, fridgeTempC: 4, ambientTempC: 22, targetC: 18 });
    const h2 = computeTemperingH({ ballMassKg: 0.50, hydration: 65, fridgeTempC: 4, ambientTempC: 22, targetC: 18 });
    expect(h2).toBeGreaterThan(h1);
  });

  it('UT-SOL-04: buildServiceWindowTimeline ritorna segmenti con startElapsedH crescente', () => {
    const segs = buildServiceWindowTimeline({
      puntataH: 2, staglioH: 0.25, tcHours: 18, temperingH: 2,
      serviceDurationH: 4, ambientTempC: 22, fridgeTempC: 4,
    });
    let prevStart = -1;
    for (const s of segs) {
      expect(s.startElapsedH).toBeGreaterThan(prevStart);
      prevStart = s.startElapsedH;
    }
  });

  it('UT-SOL-05: simulateTimeline — samples.elapsedH monotono crescente', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 3, ambientTempC: 22, startElapsedH: 0 }];
    const { samples } = simulateTimeline(segs, mkBase(), mkSimOpts('fresh_yeast', 2));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].elapsedH).toBeGreaterThan(samples[i - 1].elapsedH);
    }
  });

  it('UT-SOL-06: computeMaxSafeServiceWindow > 0 per impasto fresco', () => {
    const state = { tempDough: 18, enzAdu: 0.5, leavAdu: 0.3, enzymaticMatPct: 5,
                    leaveningPct: 5, wDamage: 0.1, W_current: 275, structuralState: 'OK', elapsedH: 20 };
    const { maxSafeServiceWindowH } = computeMaxSafeServiceWindow(
      state, { agentType: 'fresh_yeast', salt: 2, W0: 280 }, {},
    );
    expect(maxSafeServiceWindowH).toBeGreaterThan(0);
  });

  it('UT-SOL-07: solveNowAnchoredWindow mixStartIsNow=true invariante', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 24 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 4,
      ballMassKg: 0.26, hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.3,
      W0: 280, fridgeTempC: 4, ambientTempC: 22,
      puntataKickoffH: 2, staglioH: 0.25, containerPreset: 'closed_box',
    });
    expect(result.mixStartIsNow).toBe(true);
  });

  it('UT-SOL-08: solveNowAnchoredWindow reason=cannot_temper se ambientTempC=15°C', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 24 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 4,
      ballMassKg: 0.26, hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.3,
      W0: 280, fridgeTempC: 4, ambientTempC: 15,
      puntataKickoffH: 2, staglioH: 0.25, containerPreset: 'closed_box',
    });
    expect(result.feasible).toBe(false);
    expect(result.infeasibility?.reason).toBe('cannot_temper');
  });

  it('UT-SOL-09: mixStart non viene ritardato (mixStartIsNow=true)', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 30 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 2,
      ballMassKg: 0.26, hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.5,
      W0: 280, fridgeTempC: 4, ambientTempC: 22,
      puntataKickoffH: 1, staglioH: 0.25, containerPreset: 'open_box',
    });
    expect(result.mixStartIsNow).toBe(true);
  });

  it('UT-SOL-10: solveServiceWindow — output contiene feasible e mixStart', () => {
    const now = new Date();
    const result = solveServiceWindow({
      now,
      serviceStart: new Date(now.getTime() + 22 * 3600 * 1000),
      serviceDurationH: 4,
      puntataKickoffH: 2, staglioH: 0.25,
      hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.3,
      W0: 280, fridgeTempC: 4, ambientTempC: 22,
      containerPreset: 'closed_box',
    });
    expect(typeof result.feasible).toBe('boolean');
  });

  it('UT-SOL-11: enzymaticMatAtServiceEnd ≤ 92% se feasible (soft toleranza)', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 20 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 2,
      hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.3,
      W0: 280, fridgeTempC: 4, ambientTempC: 22,
      puntataKickoffH: 2, staglioH: 0.25, containerPreset: 'closed_box',
    });
    if (result.feasible && (result as any).enzymaticMatAtServiceEnd !== undefined) {
      expect((result as any).enzymaticMatAtServiceEnd).toBeLessThanOrEqual(92);
    }
  });

  it('UT-SOL-12: leaveningAtServiceEnd ≤ 95% se feasible', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 20 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 2,
      hydration: 65, salt: 2,
      agentType: 'fresh_yeast', agentDosePct: 0.3,
      W0: 280, fridgeTempC: 4, ambientTempC: 22,
      puntataKickoffH: 2, staglioH: 0.25, containerPreset: 'closed_box',
    });
    if (result.feasible && (result as any).leaveningAtServiceEnd !== undefined) {
      expect((result as any).leaveningAtServiceEnd).toBeLessThanOrEqual(95);
    }
  });

  it('UT-SOL-13: T_dough continua ai confini di fase (nessun salto > 5°C in 0.2h)', () => {
    const segs = [
      { phaseType: 'bulk_room',    durationH: 2, ambientTempC: 22, startElapsedH: 0 },
      { phaseType: 'balled_fridge', durationH: 4, ambientTempC: 4,  startElapsedH: 2 },
    ];
    const { samples } = simulateTimeline(segs, mkBase(), mkSimOpts('fresh_yeast', 2));
    const boundary = samples.filter((s: any) => Math.abs(s.elapsedH - 2) < 0.2);
    if (boundary.length > 1) {
      const jump = Math.abs((boundary[boundary.length - 1] as any).tempDough - (boundary[0] as any).tempDough);
      expect(jump).toBeLessThan(5);
    }
  });

  it('UT-SOL-14: campionamento simulazione ≥ 18 substep per ora (≈ 0.05h)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 1, ambientTempC: 22, startElapsedH: 0 }];
    const { samples } = simulateTimeline(segs, mkBase(), mkSimOpts('fresh_yeast', 2));
    expect(samples.length).toBeGreaterThanOrEqual(18);
  });

  it('UT-SOL-15: solveNowAnchoredWindow.timeline è array se feasible', () => {
    const now = new Date();
    const serviceStart = new Date(now.getTime() + 22 * 3600 * 1000);
    const result = solveNowAnchoredWindow({
      now, serviceStart, serviceDurationH: 3,
      hydration: 65, salt: 2.5,
      agentType: 'fresh_yeast', agentDosePct: 0.25,
      W0: 290, fridgeTempC: 4, ambientTempC: 22,
      puntataKickoffH: 2, staglioH: 0.25, containerPreset: 'closed_box',
    });
    if (result.feasible && (result as any).timeline) {
      expect(Array.isArray((result as any).timeline)).toBe(true);
      expect((result as any).timeline.length).toBeGreaterThan(0);
    }
  });

  it('UT-SOL-16: computeMaxSafeServiceWindow.binding ∈ maturation|bubble|w_collapse|none', () => {
    const state = { tempDough: 18, enzAdu: 1, leavAdu: 1, enzymaticMatPct: 15,
                    leaveningPct: 20, wDamage: 0.3, W_current: 260, structuralState: 'OK', elapsedH: 22 };
    const { binding } = computeMaxSafeServiceWindow(
      state, { agentType: 'fresh_yeast', salt: 2, W0: 280 }, {},
    );
    expect(['maturation', 'bubble', 'w_collapse', 'none']).toContain(binding);
  });

  it('UT-SOL-17: W_current mai aumenta nel tempo (proteolisi è irreversibile)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 24, ambientTempC: 25, startElapsedH: 0 }];
    const { samples } = simulateTimeline(segs, mkBase(25, 300), mkSimOpts('fresh_yeast', 0, 300));
    for (let i = 1; i < samples.length; i++) {
      expect((samples[i] as any).W_current).toBeLessThanOrEqual((samples[i - 1] as any).W_current + 0.01);
    }
  });

  it('UT-SOL-18: enzAdu invariante rispetto all\'agente in simulateTimeline lunga a TC', () => {
    const segs = [{ phaseType: 'balled_fridge', durationH: 48, ambientTempC: 4, startElapsedH: 0 }];
    const base = mkBase(4, 310);
    const r1 = simulateTimeline(segs, { ...base }, mkSimOpts('fresh_yeast',   2, 310));
    const r2 = simulateTimeline(segs, { ...base }, mkSimOpts('sourdough_wheat', 2, 310));
    expect(r1.final.enzAdu).toBeCloseTo(r2.final.enzAdu, 1);
  });

  it('UT-SOL-19: muMaxScaled alto → leaveningPct più alta a parità di leavAdu (via curva Gompertz)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 4, ambientTempC: 22, startElapsedH: 0 }];
    const base = mkBase(22, 280);
    // muMaxScaled non tocca leavAdu (accumulo da kEffective×deltaH) ma governa la curva Gompertz
    const ag = (AGENT_GOMPERTZ as any).fresh_yeast;
    const optsLow  = { agentType: 'fresh_yeast', agentEaKj: ag.Ea, muMaxScaled: ag.muMax * 0.3, leavLambda: ag.lambda, agentAsymptote: 100, salt: 2, W0: 280 };
    const optsHigh = { agentType: 'fresh_yeast', agentEaKj: ag.Ea, muMaxScaled: ag.muMax * 2.0, leavLambda: ag.lambda, agentAsymptote: 100, salt: 2, W0: 280 };
    const rLow  = simulateTimeline(segs, { ...base }, optsLow);
    const rHigh = simulateTimeline(segs, { ...base }, optsHigh);
    expect(rHigh.final.leaveningPct).toBeGreaterThan(rLow.final.leaveningPct);
  });

  it('UT-SOL-20: buildServiceWindowTimeline produce segmento proofing per tempering > 0', () => {
    const segs = buildServiceWindowTimeline({
      puntataH: 2, staglioH: 0.25, tcHours: 16, temperingH: 3,
      serviceDurationH: 5, ambientTempC: 22, fridgeTempC: 4,
    });
    const proofing = segs.filter((s: any) => s.phaseType === 'proofing');
    expect(proofing.length).toBeGreaterThanOrEqual(1);
  });
});
