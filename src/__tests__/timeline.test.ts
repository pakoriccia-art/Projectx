import { describe, it, expect } from 'vitest';
import { currentSegment, retimeTimeline, seedPhase, timelineEndH } from '../lib/timeline';
import { buildInitialTimeline, type PhaseSegment, type Session } from '../db/db';

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

describe('currentSegment', () => {
  it('prende il segmento current', () => {
    expect(currentSegment(tl)).toEqual({ phase: 'balled_room', ambientTempC: 20 });
  });
  it('tutti pianificati: il primo per inizio', () => {
    const planned = [seg('balled_room', 12, 12.5, 'planned'), seg('bulk_fridge', 0, 12, 'planned')];
    expect(currentSegment(planned)?.phase).toBe('bulk_fridge');
  });
  it('timeline vuota o assente: null', () => {
    expect(currentSegment([])).toBeNull();
    expect(currentSegment(undefined)).toBeNull();
  });
});

describe('seedPhase', () => {
  const tcTl: PhaseSegment[] = [
    { id: 'f', phaseType: 'bulk_fridge', startElapsedH: 0, endElapsedH: 12, ambientTempC: 4, status: 'planned' },
    { id: 's', phaseType: 'balled_room', startElapsedH: 12, endElapsedH: 12.5, ambientTempC: 21, status: 'planned' },
  ];
  const tc = { style: 'contemporanea', apprettoProtocol: 'tc', tLaboratorio: 21, fridgeTempC: 4, thermalTimeline: tcTl } as unknown as Session;

  it('sessione TC appena avviata: frigo a 4°', () => {
    expect(seedPhase(tc)).toEqual({ phase: 'bulk_fridge', tempAmbient: 4 });
  });
  it('stessa fase calda del tick precedente: tiene la sua T', () => {
    const warm = { ...tc, thermalTimeline: [{ ...tcTl[1], status: 'current' }] } as Session;
    expect(seedPhase(warm, { phase: 'balled_room', tempAmbient: 26 })).toEqual({ phase: 'balled_room', tempAmbient: 26 });
  });
  it('tick salvato in TA ma la timeline è in frigo: frigo', () => {
    expect(seedPhase(tc, { phase: 'bulk_room', tempAmbient: 21 })).toEqual({ phase: 'bulk_fridge', tempAmbient: 4 });
  });
});

describe('buildInitialTimeline — TC tutto in frigo', () => {
  const base = { apprettoProtocol: 'tc', tcHours: 12, staglioH: 0.5, fridgeTempC: 4, tLaboratorio: 21, startedAt: new Date() };
  it('con il riscaldo: frigo, staglio, appretto a TA', () => {
    const tl = buildInitialTimeline({ ...base, temperingH: 2, apprettoH: 2 });
    expect(tl.map(s => s.phaseType)).toEqual(['bulk_fridge', 'balled_room', 'proofing']);
    expect(tl[2].startElapsedH).toBeCloseTo(12.5);
    expect(tl[2].endElapsedH).toBeCloseTo(14.5);
    expect(tl[2].ambientTempC).toBe(21);
  });
  it('sessioni salvate prima del riscaldo (apprettoH 4, temperingH 0): niente riscaldo', () => {
    const tl = buildInitialTimeline({ ...base, apprettoH: 4, temperingH: 0 });
    expect(tl.map(s => s.phaseType)).toEqual(['bulk_fridge', 'balled_room']);
  });
});
