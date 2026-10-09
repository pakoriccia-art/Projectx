import { describe, it, expect } from 'vitest';
import { apprettoCorrectionH, fmtBakeClock, engineReadyH, suggestedApprettoH, bakeForecastFor } from '../lib/bakeForecast';

describe('apprettoCorrectionH', () => {
  it('nessuna correzione sotto la mezz\'ora', () => {
    expect(apprettoCorrectionH(12.5, 12.8, 4)).toBeNull();
    expect(apprettoCorrectionH(12.5, null, 4)).toBeNull();
  });
  it('allunga o accorcia l\'appretto al mezzo\'ora', () => {
    expect(apprettoCorrectionH(12.5, 15.6, 4)).toBe(3);      // 4 + 3.1 → 7
    expect(apprettoCorrectionH(12.5, 10, 4)).toBe(-2.5);     // 4 − 2.5 → 1.5
    expect(apprettoCorrectionH(12.5, 2, 4)).toBe(-3.5);      // mai sotto 0.5 h
  });
});

describe('fmtBakeClock', () => {
  it('oggi, domani, altro giorno', () => {
    const now = new Date('2026-10-05T10:00:00').getTime();
    expect(fmtBakeClock(new Date('2026-10-05T20:30:00').getTime(), now)).toBe('~20:30');
    expect(fmtBakeClock(new Date('2026-10-06T09:46:00').getTime(), now)).toBe('~09:46 domani');
    expect(fmtBakeClock(new Date('2026-10-07T09:46:00').getTime(), now)).toBe('~09:46 mer');
    expect(fmtBakeClock(new Date('2026-10-04T09:46:00').getTime(), now)).toBe('~09:46 ieri');
    expect(fmtBakeClock(new Date('2026-10-20T09:46:00').getTime(), now)).toBe('~09:46 20 ott');
  });
});

describe('engineReadyH', () => {
  it('solo per il protocollo tutto TA', () => {
    expect(engineReadyH({ apprettoProtocol: 'tc', style: 'napoletana' } as any)).toBeNull();
  });
  it('a temperatura più alta è pronto prima', () => {
    const base = { apprettoProtocol: 'ta', style: 'napoletana', alertThreshold: 85, initialMaturationOffset: 0 } as any;
    const h20 = engineReadyH({ ...base, tLaboratorio: 20 })!;
    const h26 = engineReadyH({ ...base, tLaboratorio: 26 })!;
    expect(h20).toBeGreaterThan(0);
    expect(h26).toBeLessThan(h20);
  });
});

describe('suggestedApprettoH', () => {
  it('pronto meno puntata e staglio, a mezz\'ore', () => {
    expect(suggestedApprettoH(14.9, 8, 0.5)).toBe(6.5);
  });
  it('tra 0,5 e 12 h', () => {
    expect(suggestedApprettoH(8, 8, 0.5)).toBe(0.5);
    expect(suggestedApprettoH(40, 8, 0.5)).toBe(12);
  });
  it('senza previsione: null', () => {
    expect(suggestedApprettoH(null, 8, 0.5)).toBeNull();
  });
});

describe('bakeForecastFor', () => {
  const H = 3_600_000;
  const now = new Date('2026-10-05T10:00:00').getTime();
  const seg = (phaseType: string, s: number, e: number, t: number, status: 'planned' | 'current' | 'completed') =>
    ({ id: phaseType, phaseType, startElapsedH: s, endElapsedH: e, ambientTempC: t, status });
  const ta = {
    apprettoProtocol: 'ta', style: 'napoletana', alertThreshold: 85, initialMaturationOffset: 0, tLaboratorio: 22,
    agentType: 'fresh_yeast', startedAt: new Date(now - 4 * H), targetBakeAt: new Date(now + 10 * H),
    thermalTimeline: [seg('bulk_room', 0, 8, 22, 'current'), seg('balled_room', 8, 8.5, 22, 'planned'), seg('proofing', 8.5, 14, 22, 'planned')],
  } as any;

  it('tutto TA a metà: comanda il motore', () => {
    const fc = bakeForecastFor(ta, { phase: 'bulk_room', tempAmbient: 22, tempDough: 22, maturationPct: 60, enzymaticAdu: 3, lastTickAt: now } as any, now);
    expect(fc.usePlan).toBe(false);
    expect(fc.readyAtMs).toBe(now + (fc.etaH ?? 0) * H);
  });

  it('in frigo e senza tick: comanda il piano', () => {
    const tc = { ...ta, apprettoProtocol: 'tc', style: 'contemporanea', outOfProtocolPhaseConfirmed: true,
      thermalTimeline: [seg('bulk_fridge', 0, 12, 4, 'current'), seg('balled_room', 12, 12.5, 22, 'planned'), seg('proofing', 12.5, 15, 22, 'planned')] };
    const fc = bakeForecastFor(tc, null, now);
    expect(fc.isColdPhase).toBe(true);
    expect(fc.usePlan).toBe(true);
    expect(fc.readyAtMs).toBe(fc.planBakeMs);
  });

  it('fuori dalla dashboard il tick è fermo: conta l\'ultimo tick, non adesso', () => {
    const ts = { phase: 'bulk_room', tempAmbient: 22, tempDough: 22, maturationPct: 60, enzymaticAdu: 3, lastTickAt: now - 2 * H } as any;
    const a = bakeForecastFor(ta, ts, now);
    const b = bakeForecastFor(ta, ts, now + 30 * 60_000);
    expect(a.usePlan).toBe(false);
    expect(b.readyAtMs).toBe(a.readyAtMs);
  });
});
