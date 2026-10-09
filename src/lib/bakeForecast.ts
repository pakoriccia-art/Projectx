/**
 * PizzaMatrix — l'orario di cottura del wizard è lo stesso della dashboard.
 *
 * La dashboard, a temperatura ambiente, prevede il pronto con la lettura del
 * motore (sweetSpotMaturation: ore al picco di maturazione enzimatica alla T
 * ambiente). Qui la stessa lettura sulla sessione appena costruita, a t = 0:
 * così il passo 7 e il riepilogo non promettono un orario che la dashboard
 * smentisce al primo minuto. Con il frigo nel protocollo la dashboard segue il
 * piano delle fasi: quella è già la previsione e non serve altro.
 */
import { sweetSpotMaturation, findAduAt, ENZYMATIC_CLOCK_PARAMS, getStyleProfile } from '../engine';
import { fmtClockDay } from './fmtTime';
import { resolveThreshold } from './bakeReadiness';
import type { Session } from '../db/db';

/** Ore dall'avvio al pronto secondo il motore (solo protocollo tutto TA), o null. */
export function engineReadyH(session: Session): number | null {
  if ((session.apprettoProtocol ?? 'ta') !== 'ta') return null;
  try {
    const style = (getStyleProfile as (s: string) => { alertThreshold?: number })(session.style);
    const threshold = resolveThreshold(session.alertThreshold, style?.alertThreshold);
    const offsetPct = (session.initialMaturationOffset ?? 0) * 100;
    const enzAdu = offsetPct > 0
      ? (findAduAt as (a: number, b: number, c: number, d: number) => number)(
        ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, offsetPct)
      : 0;
    const spot = (sweetSpotMaturation as (s: unknown, a: number, t: number) => { status: string; hoursUntilPeak: number } | null)(
      { ...session, alertThreshold: threshold }, enzAdu, session.tLaboratorio ?? 22);
    if (!spot) return null;
    const h = spot.status === 'past_peak' ? 0 : spot.hoursUntilPeak;
    return Number.isFinite(h) && h <= 240 ? Math.max(0, h) : null;
  } catch {
    return null;
  }
}

/** Ore di appretto da aggiungere (o togliere) perché il piano coincida con la previsione. */
export function apprettoCorrectionH(planH: number, readyH: number | null, apprettoH: number): number | null {
  if (readyH == null) return null;
  const diff = readyH - planH;
  if (Math.abs(diff) <= 0.5) return null;
  const next = Math.max(0.5, Math.round((apprettoH + diff) * 2) / 2);
  return next === apprettoH ? null : next - apprettoH;
}

/**
 * Appretto che fa coincidere la fine del piano con il pronto del motore
 * (mezz'ore, tra 0,5 e 12 h); null senza previsione. Il pronto non dipende
 * dalle durate: nessuna circolarità.
 */
export function suggestedApprettoH(readyH: number | null, puntataH: number, staglioH: number): number | null {
  if (readyH == null || !Number.isFinite(readyH)) return null;
  return Math.min(12, Math.max(0.5, Math.round((readyH - puntataH - staglioH) * 2) / 2));
}

/** "~09:46" oggi, "~09:46 domani", "~09:46 mer", "~09:46 12 ott". */
export function fmtBakeClock(ms: number, now = Date.now()): string {
  return `~${fmtClockDay(ms, now)}`;
}
