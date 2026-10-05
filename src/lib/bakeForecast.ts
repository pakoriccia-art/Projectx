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

/** "~09:46" oggi, "~09:46 domani", "~09:46 mer". */
export function fmtBakeClock(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - day0.getTime()) / 86_400_000);
  return days === 0 ? `~${t}` : days === 1 ? `~${t} domani` : `~${t} ${d.toLocaleDateString('it-IT', { weekday: 'short' })}`;
}
