/**
 * PizzaMatrix — fase pianificata in arrivo / in ritardo (solo presentazione).
 * Le fasi non avanzano da sole: le registra l'utente. Qui si individua il prossimo
 * segmento pianificato e il testo con cui chiederglielo, per la banda in dashboard
 * e per la notifica locale. Nessuna formula del motore coinvolta.
 */
import type { PhaseSegment } from '../db/db';

const FRIDGE = new Set(['bulk_fridge', 'balled_fridge']);

/** Primo segmento pianificato (in ordine di inizio), se esiste e non è la cottura. */
export function nextPlannedSegment(timeline: PhaseSegment[] | undefined): PhaseSegment | null {
  const planned = (Array.isArray(timeline) ? timeline : [])
    .filter(s => !!s && s.status === 'planned' && s.phaseType !== 'baking')
    .sort((a, b) => a.startElapsedH - b.startElapsedH);
  return planned[0] ?? null;
}

/** Cosa deve fare l'utente per entrare in quel segmento, in parole da banco. */
export function phaseActionText(seg: PhaseSegment, timeline: PhaseSegment[] | undefined): string {
  const before = (Array.isArray(timeline) ? timeline : [])
    .filter(s => s && s.startElapsedH < seg.startElapsedH);
  const fromFridge = before.some(s => s.phaseType === 'balled_fridge');
  switch (seg.phaseType) {
    case 'balled_room':   return 'È ora dello staglio';
    case 'balled_fridge': return 'È ora di mettere i panetti in frigo';
    case 'proofing':      return fromFridge ? 'È ora di togliere i panetti dal frigo' : "Fine riposo: parte l'appretto";
    case 'bulk_fridge':   return "È ora di mettere l'impasto in frigo";
    default:              return FRIDGE.has(seg.phaseType) ? 'È ora di passare in frigo' : 'È ora della fase successiva';
  }
}
