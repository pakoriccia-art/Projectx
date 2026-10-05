/**
 * PizzaMatrix — ritemporizzazione della timeline in corsa (Aggiusta rotta).
 * Stesso schema di applyPhaseTransition: i segmenti completati non si toccano,
 * quello in corso tiene il suo inizio, i pianificati si rimettono in fila.
 */
import type { PhaseSegment } from '../db/db';

/** Fase della timeline → durata del wizard che la governa. */
export type DurationKey = 'puntataH' | 'staglioH' | 'apprettoH' | 'tcHours';
export function durationKeyOf(phaseType: string): DurationKey | null {
  switch (phaseType) {
    case 'bulk_room':     return 'puntataH';
    case 'balled_room':   return 'staglioH';
    case 'proofing':      return 'apprettoH';
    case 'bulk_fridge':
    case 'balled_fridge': return 'tcHours';
    default:              return null;
  }
}

const segEnd = (s: PhaseSegment) => s.endElapsedH ?? s.startElapsedH;
export const timelineEndH = (tl: PhaseSegment[]) => tl.length ? Math.max(...tl.map(segEnd)) : 0;

/**
 * @param changes    solo le durate cambiate dall'utente: le altre fasi tengono
 *                   la durata che hanno nella timeline (es. quelle del Planner).
 * @param extendLastH allunga (o accorcia) il frigo non finito, o l'ultima fase: sposta la cottura.
 */
export function retimeTimeline(
  timeline: PhaseSegment[],
  changes: Partial<Record<DurationKey, number>>,
  nowElapsedH: number,
  extendLastH = 0,
): PhaseSegment[] {
  const segs = timeline.slice().sort((a, b) => a.startElapsedH - b.startElapsedH);
  // Per spostare la cottura si allunga il frigo ancora da finire (lì l'impasto
  // regge), altrimenti l'ultima fase non finita (l'appretto).
  const open = (pred: (s: PhaseSegment) => boolean) => segs.reduce((acc, s, i) => (s.status !== 'completed' && pred(s) ? i : acc), -1);
  const fridgeOpen = open(s => s.phaseType === 'bulk_fridge' || s.phaseType === 'balled_fridge');
  const lastOpen = fridgeOpen >= 0 ? fridgeOpen : open(() => true);
  let cursor: number | null = null;
  return segs.map((s, i) => {
    if (s.status === 'completed') return s;
    const key = durationKeyOf(s.phaseType);
    let dur = key && changes[key] != null ? changes[key]! : Math.max(0, segEnd(s) - s.startElapsedH);
    if (i === lastOpen) dur = Math.max(0.5, dur + extendLastH);
    const start = s.status === 'current' ? s.startElapsedH : (cursor ?? s.startElapsedH);
    let end = start + dur;
    // la fase in corso non può finire nel passato
    if (s.status === 'current') end = Math.max(end, nowElapsedH + 0.1);
    cursor = end;
    return { ...s, startElapsedH: start, endElapsedH: end };
  });
}
