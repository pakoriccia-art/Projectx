import { describe, it, expect } from 'vitest';
import { apprettoCorrectionH, fmtBakeClock, engineReadyH } from '../lib/bakeForecast';

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
