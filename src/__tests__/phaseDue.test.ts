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

import { planDeltaText } from '../lib/phaseDue';
import { vi } from 'vitest';

describe('planDeltaText', () => {
  const H = 3_600_000;
  it('tace sotto i 30 minuti', () => {
    expect(planDeltaText(0, 20 * 60_000)).toBeNull();
    expect(planDeltaText(30 * 60_000, 0)).toBeNull();
  });
  it('dice prima/dopo il piano', () => {
    expect(planDeltaText(0, 3 * H)).toBe('~3h prima del piano');
    expect(planDeltaText(45 * 60_000, 0)).toBe('~45 min dopo il piano');
    expect(planDeltaText(0, 1.5 * H)).toBe('~1h 30m prima del piano');
  });
});

describe('Fatto alle …: transizione registrata a un orario passato', () => {
  it('chiude il segmento corrente all’orario indicato e ci apre la fase', async () => {
    // il setup globale mocka db.ts (Dexie): qui serve la funzione pura reale
    const { applyPhaseTransition } = await vi.importActual<typeof import('../db/db')>('../db/db');
    const tl = [
      { id: 'a', phaseType: 'bulk_room', startElapsedH: 0, endElapsedH: 8, ambientTempC: 22, status: 'current' },
      { id: 'b', phaseType: 'balled_room', startElapsedH: 8, endElapsedH: 8.5, ambientTempC: 22, status: 'planned' },
      { id: 'c', phaseType: 'proofing', startElapsedH: 8.5, endElapsedH: 12.5, ambientTempC: 22, status: 'planned' },
    ] as any;
    const next = applyPhaseTransition(tl, 'balled_room', 22, 8);
    expect(next[0]).toMatchObject({ phaseType: 'bulk_room', status: 'completed', endElapsedH: 8 });
    expect(next[1]).toMatchObject({ phaseType: 'balled_room', status: 'current', startElapsedH: 8, endElapsedH: 8.5 });
    expect(next[2]).toMatchObject({ phaseType: 'proofing', status: 'planned', startElapsedH: 8.5 });
  });
});
