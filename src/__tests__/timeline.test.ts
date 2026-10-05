import { describe, it, expect } from 'vitest';
import { retimeTimeline, timelineEndH } from '../lib/timeline';
import type { PhaseSegment } from '../db/db';

const seg = (phaseType: string, s: number, e: number, status: PhaseSegment['status']): PhaseSegment =>
  ({ id: phaseType, phaseType, startElapsedH: s, endElapsedH: e, ambientTempC: 20, status });

// TC appretto: puntata fatta, staglio in corso, frigo e riscaldo pianificati
const tl = [
  seg('bulk_room', 0, 2, 'completed'),
  seg('balled_room', 2, 2.5, 'current'),
  seg('balled_fridge', 2.5, 14.5, 'planned'),
  seg('proofing', 14.5, 18.5, 'planned'),
];

describe('retimeTimeline', () => {
  it('senza cambi resta uguale', () => {
    expect(retimeTimeline(tl, {}, 2.2)).toEqual(tl);
  });
  it('i completati non si toccano, i pianificati si rimettono in fila', () => {
    const r = retimeTimeline(tl, { tcHours: 10 }, 2.2);
    expect(r[0]).toEqual(tl[0]);
    expect(r[2].endElapsedH).toBe(12.5);
    expect(r[3].startElapsedH).toBe(12.5);
    expect(timelineEndH(r)).toBe(16.5);
  });
  it('lo spostamento della cottura allunga il frigo', () => {
    const r = retimeTimeline(tl, {}, 2.2, 2);
    expect(r[2].endElapsedH! - r[2].startElapsedH).toBe(14);
    expect(r[3].endElapsedH! - r[3].startElapsedH).toBe(4);
    expect(timelineEndH(r)).toBe(20.5);
  });
  it('senza frigo allunga l\'ultima fase, mai sotto mezz\'ora', () => {
    const ta = [seg('bulk_room', 0, 8, 'current'), seg('balled_room', 8, 8.5, 'planned'), seg('proofing', 8.5, 12.5, 'planned')];
    expect(timelineEndH(retimeTimeline(ta, {}, 1, 2))).toBe(14.5);
    const r = retimeTimeline(ta, {}, 1, -10);
    expect(r[2].endElapsedH! - r[2].startElapsedH).toBe(0.5);
  });
  it('la fase in corso non finisce nel passato', () => {
    const r = retimeTimeline(tl, { staglioH: 0.1 }, 2.4);
    expect(r[1].endElapsedH).toBeCloseTo(2.5);
    expect(r[2].startElapsedH).toBeCloseTo(2.5);
  });
});
