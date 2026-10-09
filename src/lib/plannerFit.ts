/**
 * PizzaMatrix — il piano sta nell'orario di cottura scelto?
 * Un protocollo che ha bisogno di più ore di quelle disponibili non si
 * consiglia e non si avvia: si propone di spostare la cottura.
 */
import type { PhaseSegment, PrefermentoComponent } from '../db/db';
import { isPreparable, stageDurationH } from './preferment';
import { timelineEndH } from './timeline';

export type PlanFit = 'ok' | 'early' | 'late';

/** Scarto ammesso tra la durata del piano e le ore disponibili. */
export const FIT_TOLERANCE_H = 0.25;

/** ok = finisce all'orario; early = è pronta prima; late = non ci sta. Senza orario: ok. */
export function planFit(totalH: number, hoursUntilBake?: number): PlanFit {
  if (hoursUntilBake === undefined || !Number.isFinite(totalH)) return 'ok';
  if (totalH > hoursUntilBake + FIT_TOLERANCE_H) return 'late';
  if (totalH < hoursUntilBake - FIT_TOLERANCE_H) return 'early';
  return 'ok';
}

/** Ore che mancano per far stare il piano (0 se ci sta). */
export function fitShortfallH(totalH: number, hoursUntilBake?: number): number {
  return hoursUntilBake === undefined ? 0 : Math.max(0, totalH - hoursUntilBake);
}

/** Primo orario di cottura in cui il piano ci sta, arrotondato in su al quarto d'ora. */
export function suggestedBakeAtMs(nowMs: number, totalH: number): number {
  const q = 15 * 60_000;
  return Math.ceil((nowMs + totalH * 3_600_000) / q) * q;
}

/** Data e ora locali per gli input `date` e `time`. */
export function toDateInputs(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

interface DraftLike {
  apprettoProtocol?: string;
  puntataH?: number; staglioH?: number; apprettoH?: number; tcHours?: number; temperingH?: number;
  thermalTimeline?: PhaseSegment[];
  targetBakeAt?: Date | string;
  serviceWindowH?: number;
  protocol?: string;
  prefermentTiming?: string;
  prefermenti?: PrefermentoComponent[];
}

/**
 * Ore di cui il piano del draft supera l'orario di cottura: 0 se ci sta
 * (entro la tolleranza), null senza orario. Con un prefermento da preparare
 * l'impasto parte quando è pronto.
 */
export function draftOverrunH(draft: DraftLike, nowMs: number): number | null {
  if (!draft.targetBakeAt) return null;
  const tl = draft.thermalTimeline;
  const s = draft.staglioH ?? 0.5, tc = draft.tcHours ?? 0;
  const warm = draft.temperingH ?? draft.apprettoH ?? 0;
  const proto = draft.apprettoProtocol ?? 'ta';
  const planH = tl && tl.length > 0
    ? timelineEndH(tl) - (draft.serviceWindowH ?? 0)
    : proto === 'ta'         ? (draft.puntataH ?? 8) + s + (draft.apprettoH ?? 4)
    : proto === 'tc'         ? tc + s + warm
    : proto === 'tc_puntata' ? tc + s + (draft.apprettoH ?? 4)
    : /* tc_appreto */         (draft.puntataH ?? 8) + s + tc + warm;
  const prep = (draft.prefermentTiming ?? 'now') === 'now' && draft.protocol !== 'direct'
    && (draft.prefermenti ?? []).some(isPreparable);
  const t0 = nowMs + (prep ? stageDurationH(draft.prefermenti) * 3_600_000 : 0);
  const over = (t0 + planH * 3_600_000 - new Date(draft.targetBakeAt).getTime()) / 3_600_000;
  return over > FIT_TOLERANCE_H ? over : 0;
}
