import { describe, it, expect } from 'vitest';
import { nextPlannedSegment, phaseActionText } from '../lib/phaseDue';
import type { PhaseSegment } from '../db/db';

const seg = (phaseType: string, start: number, end: number, status: PhaseSegment['status']): PhaseSegment =>
  ({ id: `${phaseType}-${start}`, phaseType, startElapsedH: start, endElapsedH: end, ambientTempC: 22, status } as PhaseSegment);

describe('phaseDue', () => {
  const tcAppretto = [
    seg('bulk_room', 0, 2, 'completed'),
    seg('balled_room', 2, 2.5, 'current'),
    seg('balled_fridge', 2.5, 26.5, 'planned'),
    seg('proofing', 26.5, 30, 'planned'),
  ];

  it('restituisce il primo segmento pianificato in ordine di inizio', () => {
    expect(nextPlannedSegment(tcAppretto)?.phaseType).toBe('balled_fridge');
    expect(nextPlannedSegment([...tcAppretto].reverse())?.phaseType).toBe('balled_fridge');
  });

  it('nessun segmento pianificato → null', () => {
    expect(nextPlannedSegment([seg('proofing', 0, 4, 'current')])).toBeNull();
    expect(nextPlannedSegment(undefined)).toBeNull();
  });

  it('testo dell’azione in base alla fase', () => {
    expect(phaseActionText(seg('balled_room', 8, 8.5, 'planned'), [])).toBe('È ora dello staglio');
    expect(phaseActionText(tcAppretto[2], tcAppretto)).toBe('È ora di mettere i panetti in frigo');
    expect(phaseActionText(tcAppretto[3], tcAppretto)).toBe('È ora di togliere i panetti dal frigo');
    const ta = [seg('bulk_room', 0, 8, 'completed'), seg('balled_room', 8, 8.5, 'current'), seg('proofing', 8.5, 12, 'planned')];
    expect(phaseActionText(ta[2], ta)).toBe("Fine riposo: parte l'appretto");
  });
});
