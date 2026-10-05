import { describe, it, expect } from 'vitest';
import { fmtDay, fmtClockDay, calendarDayDiff } from '../lib/fmtTime';

const now = new Date('2026-10-05T23:50:00');

describe('fmtDay', () => {
  it('oggi, domani, ieri anche a cavallo della mezzanotte', () => {
    expect(fmtDay(new Date('2026-10-05T00:10:00'), now)).toBe('');
    expect(fmtDay(new Date('2026-10-06T00:10:00'), now)).toBe('domani');
    expect(fmtDay(new Date('2026-10-04T23:59:00'), now)).toBe('ieri');
  });
  it('giorno corto entro sei giorni, poi la data', () => {
    expect(fmtDay(new Date('2026-10-07T09:00:00'), now)).toBe('mer');
    expect(fmtDay(new Date('2026-10-11T09:00:00'), now)).toBe('dom');
    expect(fmtDay(new Date('2026-10-12T09:00:00'), now)).toBe('12 ott');
    expect(fmtDay(new Date('2026-11-02T09:00:00'), now)).toBe('2 nov');
    expect(fmtDay(new Date('2026-09-20T09:00:00'), now)).toBe('20 set');
  });
  it('conta i giorni di calendario', () => {
    expect(calendarDayDiff(new Date('2026-10-06T00:00:00'), now)).toBe(1);
    expect(calendarDayDiff(new Date('2026-10-31T12:00:00'), new Date('2026-11-01T00:30:00'))).toBe(-1);
  });
});

describe('fmtClockDay', () => {
  it('orario prima, giorno come suffisso', () => {
    expect(fmtClockDay(new Date('2026-10-05T20:30:00'), now)).toBe('20:30');
    expect(fmtClockDay(new Date('2026-10-06T09:46:00'), now)).toBe('09:46 domani');
    expect(fmtClockDay(new Date('2026-10-08T09:46:00').getTime(), now.getTime())).toBe('09:46 gio');
  });
});
