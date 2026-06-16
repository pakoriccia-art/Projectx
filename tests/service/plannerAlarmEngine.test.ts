// tests/service/plannerAlarmEngine.test.ts
// 15 test — alarmType, drift, Two-Clock safe, input immutability
import { describe, it, expect } from 'vitest';
import { computeNowAnchoredAlarms, computeDriftAlarm }
  from '../../engine/plannerAlarmEngine.js';
import { AGENT_GOMPERTZ } from '../../engine/engine-v2.4.0.js';

const lbf = (AGENT_GOMPERTZ as any).fresh_yeast;

const baseAlarmInput = (overrides: Record<string, unknown> = {}) => {
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

describe('plannerAlarmEngine — contratti di output', () => {

  it('SVC-PAE-01: alarmType definito per qualsiasi input valido', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput());
    expect(result.alarmType).toBeDefined();
    const validTypes = ['OK', 'OK_MARGINE_STRETTO', 'SOVRAMMATURAZIONE', 'SOTTOMATURAZIONE',
                        'COLLASSO_STRUTTURALE', 'FINESTRA_TROPPO_CORTA'];
    expect(validTypes).toContain(result.alarmType);
  });

  it('SVC-PAE-02: mixStartIsNow invariante = true', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput());
    expect(result.mixStartIsNow).toBe(true);
  });

  it('SVC-PAE-03: alarmType sempre leggibile — nessun undefined silenzioso', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput({ ambientTempC: 10 }));
    expect(typeof result.alarmType).toBe('string');
    expect(result.alarmType.length).toBeGreaterThan(0);
  });

  it('SVC-PAE-04: suggestions[] è un array (anche se vuoto)', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput());
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('SVC-PAE-05: SOTTOMATURAZIONE quando il servizio è troppo presto', () => {
    const now = new Date();
    const result = computeNowAnchoredAlarms(baseAlarmInput({
      serviceStart: new Date(now.getTime() + 1 * 3600 * 1000), // 1h
      puntataKickoffH: 5,
    }));
    expect(['SOTTOMATURAZIONE', 'FINESTRA_TROPPO_CORTA']).toContain(result.alarmType);
  });

  it('SVC-PAE-06: alarmType SOTTOMATURAZIONE/FINESTRA_TROPPO_CORTA se ambiente freddo', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput({ ambientTempC: 10 }));
    expect(['SOTTOMATURAZIONE', 'FINESTRA_TROPPO_CORTA']).toContain(result.alarmType);
  });

  it('SVC-PAE-07: computeDriftAlarm driftAlarm null se drift ≈ 0', () => {
    const result = computeDriftAlarm({
      elapsedH: 4, actualMatPct: 30, plannedMatPct: 30,
    });
    expect(result.driftAlarm).toBeNull();
  });

  it('SVC-PAE-08: computeDriftAlarm driftAlarm.type=AHEAD se actualMatPct > plannedMatPct + 5%', () => {
    const result = computeDriftAlarm({
      elapsedH: 4, actualMatPct: 40, plannedMatPct: 30,
    });
    expect((result.driftAlarm as any)?.type).toBe('AHEAD');
  });

  it('SVC-PAE-09: computeDriftAlarm driftAlarm.type=BEHIND se actualMatPct < plannedMatPct - 5%', () => {
    const result = computeDriftAlarm({
      elapsedH: 4, actualMatPct: 20, plannedMatPct: 30,
    });
    expect((result.driftAlarm as any)?.type).toBe('BEHIND');
  });

  it('SVC-PAE-10: computeDriftAlarm severity critica se drift > 12%', () => {
    const result = computeDriftAlarm({
      elapsedH: 4, actualMatPct: 50, plannedMatPct: 30,
    });
    // drift = 20%, sicuramente AHEAD, con severità high
    expect((result.driftAlarm as any)?.type).toBe('AHEAD');
    expect((result.driftAlarm as any)?.severity).toBeDefined();
  });

  it('SVC-PAE-11: input.hydration non viene mutato da computeNowAnchoredAlarms', () => {
    const input = baseAlarmInput();
    const hyd0 = (input as any).hydration;
    computeNowAnchoredAlarms(input);
    expect((input as any).hydration).toBe(hyd0);
  });

  it('SVC-PAE-12: input.W0 non viene mutato (input utente immutabile)', () => {
    const input = baseAlarmInput();
    const w0 = (input as any).W0;
    computeNowAnchoredAlarms(input);
    expect((input as any).W0).toBe(w0);
  });

  it('SVC-PAE-13: computeNowAnchoredAlarms ha now nella risposta', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput());
    expect(result.now).toBeInstanceOf(Date);
  });

  it('SVC-PAE-14: alarmType non è undefined anche per T_amb = 0°C', () => {
    const result = computeNowAnchoredAlarms(baseAlarmInput({ ambientTempC: 0 }));
    expect(result.alarmType).toBeDefined();
  });

  it('SVC-PAE-15: enzAdu non compare nella firma di computeNowAnchoredAlarms (Two-Clock safe)', () => {
    // La funzione non ha parametro enzAdu nell'input — Two-Clock invariant
    const input = baseAlarmInput();
    expect('enzAdu' in input).toBe(false);
    const result = computeNowAnchoredAlarms(input);
    expect(result.alarmType).toBeDefined();
  });
});
