/**
 * PizzaMatrix — ProcessLog two-clock writer (v2.4.19)
 * Test del builder puro: mappatura two-clock dallo SimulationState,
 * anti-fabbricazione, offline-first (syncedAt:null).
 */
import { describe, it, expect } from 'vitest';
import { buildProcessLogEntry, PROCESS_LOG_INTERVAL_MIN } from '../services/processLog';
import type { TickState } from '../context/AppContext';
import type { Session } from '../db/db';

function makeSession(): Session {
  return { id: 7, style: 'contemporanea', hydration: 70, salt: 2.5 } as unknown as Session;
}

function makeTs(overrides: Partial<TickState> = {}): TickState {
  return {
    cumulativeAdu:   12.5,   // ADU lievitazione (leavAdu)
    maturationPct:   40,
    leaveningPct:    55,
    enzymaticAdu:    18.2,   // ADU enzimatico (enzAdu)
    enzymaticMatPct: 40,
    labAdu:          3.1,
    tempDough:       21.4,
    tempAmbient:     22,
    estimatedPH:     5.4,
    W_current:       265,
    elapsedH:        6,
    doughLocation:   'bulk_room',
    phase:           'bulk_room',
    lastTickAt:      Date.now(),
    wDamage:         0.12,
    ...overrides,
  } as TickState;
}

describe('buildProcessLogEntry — two-clock mapping', () => {
  it('mappa enzAdu/leavAdu/labAdu separati dallo SimulationState (mai ricombinati)', () => {
    const ts = makeTs();
    const e = buildProcessLogEntry({ session: makeSession(), ts });
    expect(e.enzAdu).toBe(ts.enzymaticAdu);   // 18.2
    expect(e.leavAdu).toBe(ts.cumulativeAdu); // 12.5
    expect(e.labAdu).toBe(ts.labAdu);         // 3.1
    // separati: enzAdu ≠ leavAdu
    expect(e.enzAdu).not.toBe(e.leavAdu);
  });

  it('maturationPct === enzymaticMatPct (orologio enzimatico); currentPH = pH end-of-tick', () => {
    const ts = makeTs();
    const e = buildProcessLogEntry({ session: makeSession(), ts });
    expect(e.maturationPct).toBe(ts.enzymaticMatPct);
    expect(e.enzymaticMatPct).toBe(ts.enzymaticMatPct);
    expect(e.currentPH).toBe(ts.estimatedPH);
    expect(e.estimatedPH).toBe(ts.estimatedPH);
  });

  it('offline-first: syncedAt è sempre null', () => {
    const e = buildProcessLogEntry({ session: makeSession(), ts: makeTs() });
    expect(e.syncedAt).toBeNull();
  });

  it('deltaAdu = cumulativeAdu(enz) − prevCumulativeAdu; cumulativeAdu = enzymaticAdu', () => {
    const ts = makeTs({ enzymaticAdu: 20 });
    const e = buildProcessLogEntry({ session: makeSession(), ts, prevCumulativeAdu: 15 });
    expect(e.cumulativeAdu).toBe(20);
    expect(e.deltaAdu).toBe(5);
  });

  it('anti-fabbricazione: labAdu assente nello state → undefined (non inventato)', () => {
    const ts = makeTs({ labAdu: undefined });
    const e = buildProcessLogEntry({ session: makeSession(), ts });
    expect(e.labAdu).toBeUndefined();
  });

  it('doughLocation deriva da ts.phase (inclusa baking)', () => {
    const e = buildProcessLogEntry({ session: makeSession(), ts: makeTs({ phase: 'baking' }) });
    expect(e.doughLocation).toBe('baking');
  });

  it('hlcTimestamp deterministico dato recordedAt', () => {
    const recordedAt = new Date('2026-06-10T08:00:00Z');
    const e = buildProcessLogEntry({ session: makeSession(), ts: makeTs(), recordedAt });
    expect(e.hlcTimestamp).toBe(`${recordedAt.getTime()}-0-0`);
    expect(e.recordedAt).toBe(recordedAt);
  });

  it('PROCESS_LOG_INTERVAL_MIN è 15', () => {
    expect(PROCESS_LOG_INTERVAL_MIN).toBe(15);
  });
});
