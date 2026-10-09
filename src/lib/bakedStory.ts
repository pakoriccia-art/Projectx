/**
 * PizzaMatrix — l'infornata in parole, rispetto al pronto: la stessa frase in
 * dashboard (dopo "Ho infornato") e nello Storico.
 */
import { fmtHours } from './fmtTime';

export function bakedStoryText(
  s: { bakedAt?: Date | string; readyAt?: Date | string; predictedBakeAt?: Date | string },
  fmtClock: (d: Date) => string,
): string {
  if (!s.bakedAt) return '';
  const baked = new Date(s.bakedAt);
  if (s.readyAt) {
    const ready = new Date(s.readyAt);
    const diffMin = Math.round((baked.getTime() - ready.getTime()) / 60_000);
    return diffMin <= 1 ? 'al pronto' : `${fmtHours(diffMin / 60)} dopo il pronto (pronta dalle ${fmtClock(ready)})`;
  }
  // il confronto è con l'orario che la dashboard mostrava, non col piano delle fasi
  if (!s.predictedBakeAt) return 'prima del pronto previsto';
  const pred = new Date(s.predictedBakeAt);
  const early = Math.round((pred.getTime() - baked.getTime()) / 60_000);
  return early >= 15 ? `prima del pronto: previsto ${fmtClock(pred)} (−${fmtHours(early / 60)})` : 'al pronto previsto';
}
