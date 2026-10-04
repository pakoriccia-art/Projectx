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

/**
 * Scarto tra la previsione (maturazione) e il piano delle fasi, in parole.
 * Sotto i 30 minuti non si dice nulla: è rumore.
 */
export function planDeltaText(forecastMs: number, planMs: number): string | null {
  const devMin = Math.round((forecastMs - planMs) / 60_000);
  if (!Number.isFinite(devMin) || Math.abs(devMin) <= 30) return null;
  const abs = Math.abs(devMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = h === 0 ? `${m} min` : m >= 15 && h < 3 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  return devMin < 0 ? `~${amount} prima del piano` : `~${amount} dopo il piano`;
}
