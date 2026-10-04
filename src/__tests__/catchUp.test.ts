import { describe, it, expect } from 'vitest';
import { catchUpTimes, CATCH_UP_STEP_MS, CATCH_UP_MAX_MS } from '../lib/catchUp';

describe('catchUpTimes', () => {
  const H = 3_600_000;
  it('nessun passo intermedio per un buco sotto il passo', () => {
    expect(catchUpTimes(0, CATCH_UP_STEP_MS)).toEqual([]);
    expect(catchUpTimes(0, 10_000)).toEqual([]);
  });
  it('passi da 15 min, l’ultimo resta al tick normale', () => {
    const t = catchUpTimes(0, 1 * H);
    expect(t).toEqual([15, 30, 45].map(m => m * 60_000));
    expect(t.every(x => x < 1 * H)).toBe(true);
  });
  it('limita il recupero alle ultime 72 h', () => {
    const t = catchUpTimes(0, 100 * H);
    expect(t[0]).toBeGreaterThan(100 * H - CATCH_UP_MAX_MS);
    expect(t.length).toBe(Math.ceil(CATCH_UP_MAX_MS / CATCH_UP_STEP_MS) - 1);
  });
  it('input non validi → nessun passo', () => {
    expect(catchUpTimes(NaN, 5 * H)).toEqual([]);
    expect(catchUpTimes(5 * H, 0)).toEqual([]);
  });
});
