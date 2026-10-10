import { describe, it, expect } from 'vitest';
import { computeAllProtocols, pickRecommended } from '../components/tools/FermentationPlannerView';
import { AGENT_GOMPERTZ } from '../engine';

const aParams = (AGENT_GOMPERTZ as any).fresh_yeast as { Ea: number; muMax: number; lambda: number };
const base = {
  W: 300, agentType: 'fresh_yeast', agentDosePct: 0.05, aParams, pref: null,
  tAmb: 21, fridgeT: 4, staglioH: 0.5, warmupH: 2.5, rampAdu: 0,
};

describe('Planner: piani che non stanno nell\'orario', () => {
  it('senza orario tutti ci stanno', () => {
    const rs = computeAllProtocols(base);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every(r => r.fit === 'ok')).toBe(true);
  });

  it('TC più lungo delle ore disponibili: niente stelle, in fondo, mai consigliato', () => {
    const tcFree = computeAllProtocols(base).find(r => r.protocol === 'tc')!;
    const targetTotalH = Math.max(5, tcFree.totalH - 10);
    const rs = computeAllProtocols({ ...base, targetTotalH });
    const tc = rs.find(r => r.protocol === 'tc')!;
    expect(tc.fit).toBe('late');
    expect(tc.stars).toBe(0);
    expect(tc.shortfallH).toBeCloseTo(tc.totalH - targetTotalH, 5);
    const lastFit = rs.filter(r => r.fit !== 'late').length;
    expect(rs.slice(lastFit).every(r => r.fit === 'late')).toBe(true);
    expect(pickRecommended(rs)?.fit).not.toBe('late');
  });

  it('TC con il riscaldo nel totale', () => {
    const tc = computeAllProtocols(base).find(r => r.protocol === 'tc')!;
    expect(tc.warmupH).toBe(2.5);
    expect(tc.totalH).toBeCloseTo((tc.tcHours ?? 0) + 0.5 + 2.5, 5);
  });
});
