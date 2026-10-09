/**
 * PizzaMatrix — riscaldo dopo il frigo (frigo → 18 °C al cuore).
 * Newton con τ sferica (thermalTimeConstantSphere del motore) e la resistenza
 * del contenitore (tauMultiplier, come applyContainerResistance nel tick).
 */
import { CONTAINER_THERMAL_PRESETS } from '../engine';

export const TH_CP_WATER  = 4186;   // J/(kg·K) — calore specifico acqua
export const TH_CP_FLOUR  = 1840;   // J/(kg·K) — calore specifico farina
export const TH_RHO_DOUGH = 1050;   // kg/m³    — densità impasto
export const TH_H_AIR     = 8;      // W/(m²·K) — convezione naturale aria in ambiente chiuso

/** τ sferica del panetto [s]. */
export function panetTauS(panMassKg: number, hydrationPct: number, tauMultiplier = 1.0): number {
  const h   = Math.max(0.01, hydrationPct / 100);
  const cp  = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);
  const V   = panMassKg / TH_RHO_DOUGH;
  const r   = Math.cbrt((3 * V) / (4 * Math.PI));
  const A   = 4 * Math.PI * r * r;
  return (panMassKg * cp) / (TH_H_AIR * A) * tauMultiplier;
}

/**
 * Ore per portare il cuore da fridgeTempC a 18 °C a tAmb.
 * 0 se tAmb ≤ 18 (non ci arriva) o fridgeTempC ≥ 18 (già caldo).
 */
export function computeWarmupH(
  panMassKg: number, hydrationPct: number, fridgeTempC: number, tAmb: number,
  tauMultiplier = 1.0,
): number {
  const T_SERVICE = 18;
  if (tAmb <= T_SERVICE || fridgeTempC >= T_SERVICE) return 0;
  const ratio = (fridgeTempC - tAmb) / (T_SERVICE - tAmb);
  if (ratio <= 0) return 0;
  return Math.max(0, (panetTauS(panMassKg, hydrationPct, tauMultiplier) * Math.log(ratio)) / 3600);
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

export function tauMultiplierOf(containerPreset: string | undefined): number {
  return (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[containerPreset ?? 'closed_box']?.tauMultiplier ?? 1.0;
}

/**
 * Riscaldo consigliato per l'impasto della sessione (o del draft), arrotondato
 * in su al quarto d'ora: la timeline è discreta e per difetto il cuore
 * arriverebbe a cottura appena sotto i 18 °C.
 */
export function warmupHForSession(s: DoughLike, tAmb: number): number {
  const h = computeWarmupH(panMassKgOf(s), s.hydration ?? 65, s.fridgeTempC ?? 4, tAmb, tauMultiplierOf(s.containerPreset));
  return Math.ceil(h * 4 - 1e-9) / 4;
}
