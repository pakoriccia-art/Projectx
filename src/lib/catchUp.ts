/**
 * PizzaMatrix — recupero del tempo a app chiusa.
 * Istanti intermedi (passo massimo stepMs) da `fromMs` a `toMs` escluso l'ultimo,
 * che è il tick normale. Le formule restano quelle del tick: cambia solo la
 * granularità, così un buco di ore non diventa un unico passo lineare.
 */
export const CATCH_UP_STEP_MS = 15 * 60_000;
export const CATCH_UP_MAX_MS  = 72 * 3_600_000;

export function catchUpTimes(fromMs: number, toMs: number, stepMs = CATCH_UP_STEP_MS): number[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs - fromMs <= stepMs) return [];
  const start = Math.max(fromMs, toMs - CATCH_UP_MAX_MS);
  const out: number[] = [];
  for (let t = start + stepMs; t < toMs; t += stepMs) out.push(t);
  return out;
}
