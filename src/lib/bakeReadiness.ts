/**
 * PizzaMatrix — "pronto" significa infornabile.
 * La maturazione può raggiungere il target in frigo, ma un impasto a 4°C (o
 * appena uscito e ancora freddo) non si inforna: niente verde né "ORA" finché
 * non è fuori dal frigo e il cuore non ha recuperato la temperatura minima.
 * Il freddo "dopo il frigo" vale solo se la sessione ha avuto una fase frigo:
 * una cucina fresca senza frigo non blocca il pronto (lì resta l'avviso a parte).
 */
import { CORE_TEMP_AT_BAKE_MIN_C } from '../engine/coreTempProjection';

const FRIDGE = new Set(['bulk_fridge', 'balled_fridge']);

export function isFridgePhase(phase: string | undefined): boolean {
  return !!phase && FRIDGE.has(phase);
}

export function canBakeNow(p: { phase?: string; tDoughC?: number; hadFridge?: boolean }): boolean {
  if (isFridgePhase(p.phase)) return false;
  if (p.hadFridge && p.tDoughC != null && p.tDoughC < CORE_TEMP_AT_BAKE_MIN_C) return false;
  return true;
}

/** Soglia di maturazione della sessione (planner/wizard), altrimenti quella dello stile. */
export function resolveThreshold(sessionThreshold: number | undefined, styleThreshold: number | undefined): number {
  const t = sessionThreshold ?? styleThreshold ?? 85;
  return Math.min(100, Math.max(50, t));
}
