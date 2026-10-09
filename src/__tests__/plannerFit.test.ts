import { describe, it, expect } from 'vitest';
import { planFit, fitShortfallH, suggestedBakeAtMs, toDateInputs, draftOverrunH, FIT_TOLERANCE_H } from '../lib/plannerFit';
import type { PhaseSegment } from '../db/db';

const H = 3_600_000;
const NOW = new Date(2026, 9, 5, 10, 7).getTime();

describe('planFit', () => {
  it('senza orario: ok', () => expect(planFit(66)).toBe('ok'));
  it('servono più ore di quelle disponibili: late', () => expect(planFit(66, 47)).toBe('late'));
  it('pronta molto prima: early', () => expect(planFit(10, 47)).toBe('early'));
  it('entro la tolleranza: ok', () => {
    expect(planFit(47 + FIT_TOLERANCE_H / 2, 47)).toBe('ok');
    expect(planFit(47 - FIT_TOLERANCE_H / 2, 47)).toBe('ok');
  });
  it('ore mancanti', () => {
    expect(fitShortfallH(66, 47)).toBe(19);
    expect(fitShortfallH(10, 47)).toBe(0);
  });
});

describe('suggestedBakeAtMs / toDateInputs', () => {
  it('in su al quarto d\'ora, mai prima della fine del piano', () => {
    const ms = suggestedBakeAtMs(NOW, 65.95);
    expect(ms % (15 * 60_000)).toBe(0);
    expect(ms).toBeGreaterThanOrEqual(NOW + 65.95 * H);
    expect(ms - (NOW + 65.95 * H)).toBeLessThan(15 * 60_000);
  });
  it('data e ora locali', () => {
    expect(toDateInputs(new Date(2026, 0, 3, 7, 5).getTime())).toEqual({ date: '2026-01-03', time: '07:05' });
  });
});

describe('draftOverrunH', () => {
  const tc = { apprettoProtocol: 'tc', tcHours: 63, staglioH: 0.5, temperingH: 2.5, protocol: 'direct' };
  it('senza orario: null', () => expect(draftOverrunH(tc, NOW)).toBeNull());
  it('TC da 66 h con il forno tra 47 h: ~19 h di troppo', () => {
    expect(draftOverrunH({ ...tc, targetBakeAt: new Date(NOW + 47 * H) }, NOW)).toBeCloseTo(19, 5);
  });
  it('ci sta: 0', () => {
    expect(draftOverrunH({ ...tc, targetBakeAt: new Date(NOW + 66 * H) }, NOW)).toBe(0);
  });
  it('timeline precomputata, meno la finestra di servizio', () => {
    const tl: PhaseSegment[] = [
      { id: 'a', phaseType: 'bulk_fridge', startElapsedH: 0, endElapsedH: 20, ambientTempC: 4, status: 'planned' },
      { id: 'b', phaseType: 'proofing', startElapsedH: 20, endElapsedH: 24, ambientTempC: 22, status: 'planned' },
    ];
    expect(draftOverrunH({ thermalTimeline: tl, serviceWindowH: 2, targetBakeAt: new Date(NOW + 22 * H) }, NOW)).toBe(0);
    expect(draftOverrunH({ thermalTimeline: tl, targetBakeAt: new Date(NOW + 22 * H) }, NOW)).toBeCloseTo(2, 5);
  });
});
