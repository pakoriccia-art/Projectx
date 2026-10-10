/**
 * PizzaMatrix — riscaldo dopo il frigo (frigo → cuore a 15 °C, il minimo per infornare).
 * La fisica è quella del motore (thermalTimeConstantSphere: τ al cuore con la
 * conduzione interna e la resistenza del contenitore): qui solo la massa del
 * panetto e il tempo, niente copie delle costanti.
 */
import { thermalTimeConstantSphere } from '../engine';
import { CORE_TEMP_AT_BAKE_MIN_C } from '../engine/coreTempProjection';

/** τ del panetto al cuore [s]. */
export function panetTauS(panMassKg: number, hydrationPct: number, containerPreset?: string): number {
  return (thermalTimeConstantSphere as (m: number, h: number, p?: string) => number)(
    panMassKg, hydrationPct, containerPreset ?? 'closed_box');
}

/**
 * Ore per portare il cuore da fridgeTempC a targetC (default: il minimo per
 * infornare) a tAmb. 0 se tAmb ≤ target (non ci arriva) o fridgeTempC ≥ target.
 */
export function computeWarmupH(
  panMassKg: number, hydrationPct: number, fridgeTempC: number, tAmb: number,
  containerPreset?: string, targetC = CORE_TEMP_AT_BAKE_MIN_C,
): number {
  if (tAmb <= targetC || fridgeTempC >= targetC) return 0;
  const ratio = (fridgeTempC - tAmb) / (targetC - tAmb);
  if (ratio <= 0) return 0;
  return Math.max(0, (panetTauS(panMassKg, hydrationPct, containerPreset) * Math.log(ratio)) / 3600);
}

interface DoughLike {
  totalFlourGrams?: number; hydration?: number; salt?: number; numPanetti?: number;
  containerPreset?: string; fridgeTempC?: number;
}

/** Massa di un panetto [kg]. */
export function panMassKgOf(s: DoughLike): number {
  const totalDoughG = (s.totalFlourGrams ?? 1000) * (1 + (s.hydration ?? 65) / 100 + (s.salt ?? 2) / 100);
  return totalDoughG / 1000 / Math.max(1, s.numPanetti ?? 6);
}

/**
 * Riscaldo consigliato per l'impasto della sessione (o del draft), arrotondato
 * in su al quarto d'ora: la timeline è discreta e per difetto il cuore
 * arriverebbe a cottura appena sotto la soglia.
 */
export function warmupHForSession(s: DoughLike, tAmb: number, targetC = CORE_TEMP_AT_BAKE_MIN_C): number {
  const h = computeWarmupH(panMassKgOf(s), s.hydration ?? 65, s.fridgeTempC ?? 4, tAmb, s.containerPreset, targetC);
  return Math.ceil(h * 4 - 1e-9) / 4;
}
