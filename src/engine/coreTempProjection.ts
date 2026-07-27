/**
 * PizzaMatrix — Core-temp-at-bake projection (v2.4.21)
 *
 * Helper PURO condiviso da dashboard (readout + banner) e BakeView: proietta la
 * temperatura al CUORE dell'impasto al momento della cottura, usando il simulatore
 * fisico già validato `simulateTimeline` (Newton continuo, τ reale per fase).
 *
 * Segnale: se il cuore proiettato a cottura è < 18°C (= thermalServiceTargetC /
 * T_SERVICE), l'impasto è troppo freddo per stendere/infornare (rischio gommoso e
 * superficie scottata). Advisory, mai bloccante.
 *
 * NON modifica la fisica: chiama solo `simulateTimeline`. Semina al cuore VIVO
 * (`currentDoughTempC`) e simula il piano RESIDUO da `nowElapsedH` fino a `bakeH`.
 */
import { simulateTimeline } from './serviceWindowSolver';
import type { PhaseSegment } from '../db/db';

/** Soglia minima del cuore a cottura [°C] — allineata a thermalServiceTargetC. */
export const CORE_TEMP_AT_BAKE_MIN_C = 18;

const FRIDGE_PHASES = new Set(['bulk_fridge', 'balled_fridge']);

interface CoreTempSessionOpts {
  agentEaKj: number; agentType: string;
  agentMuMax: number; agentLambda: number; agentAsymptote?: number;
  effectiveW_initial?: number; hydration?: number; salt?: number;
  totalFlourGrams?: number; numPanetti?: number; containerPreset?: string;
  initialPH?: number;
  /** Indice amilasico della sessione — issue #5, parita' col tick loop. */
  amylaseIndex?: number;
}

/**
 * Cuore impasto [°C] proiettato al momento della cottura.
 * @returns °C al cuore a `bakeH`, oppure null se non calcolabile.
 */
export function projectCoreTempAtBakeC(args: {
  timeline: PhaseSegment[] | undefined;
  nowElapsedH: number;
  bakeH: number | null;
  currentDoughTempC: number;
  ambientTempC: number;
  session: CoreTempSessionOpts;
}): number | null {
  const { timeline, nowElapsedH, bakeH, currentDoughTempC, ambientTempC, session } = args;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  // Trim dei segmenti alla finestra [nowElapsedH, bakeH]. Ambiente: frigo usa la
  // temperatura bloccata del segmento; le fasi calde seguono l'ambiente vivo (slider).
  const segs: Array<{ phaseType: string; durationH: number; ambientTempC: number }> = [];
  for (const seg of timeline) {
    if (!seg || typeof seg.phaseType !== 'string') continue;
    const segStart = seg.startElapsedH ?? 0;
    const segEnd   = seg.endElapsedH ?? (bakeH ?? segStart);
    const lo = Math.max(segStart, nowElapsedH);
    const hi = bakeH != null ? Math.min(segEnd, bakeH) : segEnd;
    if (hi - lo > 1e-6) {
      const amb = FRIDGE_PHASES.has(seg.phaseType) ? seg.ambientTempC : ambientTempC;
      segs.push({ phaseType: seg.phaseType, durationH: hi - lo, ambientTempC: amb });
    }
  }
  // Nessun piano residuo (siamo già alla cottura) → il cuore è quello attuale.
  if (segs.length === 0) return currentDoughTempC;

  try {
    const sim = (simulateTimeline as Function)(
      segs,
      { tempDough: currentDoughTempC, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 },
      {
        agentEaKj: session.agentEaKj, agentType: session.agentType,
        muMaxScaled: session.agentMuMax, leavLambda: session.agentLambda,
        agentAsymptote: session.agentAsymptote ?? 100,
        W0: session.effectiveW_initial ?? 280, hydration: session.hydration ?? 65,
        amylaseIndex: session.amylaseIndex ?? 1.0,            // issue #5 — parita' col tick
        salt: session.salt ?? 2, totalFlourGrams: session.totalFlourGrams ?? 1000,
        numPanetti: session.numPanetti ?? 6,
        containerPreset: session.containerPreset ?? 'closed_box',
        initialPH: session.initialPH ?? 5.8, subStepH: 0.1,
      },
    );
    const t = sim?.final?.tempDough;
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}
