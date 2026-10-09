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
import { buildEffectiveTimeline } from '../engine/outOfProtocol';
import { deriveCanonicalPhases } from '../engine/canonicalPhases';
import { fmtClockDay } from './fmtTime';
import { canBakeNow, isFridgePhase, resolveThreshold } from './bakeReadiness';
import { seedPhase } from './timeline';
import type { PhaseSegment, Session } from '../db/db';
import type { TickState } from '../context/AppContext';

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

export interface BakeForecast {
  /** Quando inforni: il piano (frigo, riscaldo, freddo) o la previsione del motore. */
  readyAtMs:  number;
  usePlan:    boolean;
  isColdPhase: boolean;
  fridgeAhead: boolean;
  etaH:       number | null;
  planBakeMs: number;
  bakeable:   boolean;
  hadFridge:  boolean;
  threshold:  number;
  enzymaticMatPct: number;
  phase:      string;
  effectiveTimeline: PhaseSegment[];
}

/**
 * Orario di cottura di una sessione in corso, lo stesso per dashboard e Home.
 * Fuori dalla dashboard il tick è fermo: la previsione del motore parte
 * dall'ultimo tick, non da adesso.
 */
export function bakeForecastFor(session: Session, ts: Partial<TickState> | null | undefined, now = Date.now()): BakeForecast {
  const style = (getStyleProfile as (s: string) => { alertThreshold?: number })(session.style);
  const threshold = resolveThreshold(session.alertThreshold, style?.alertThreshold);
  const seed = seedPhase(session, ts);
  const phase = ts?.phase ?? seed.phase;
  const ambientTempC = ts?.tempAmbient ?? seed.tempAmbient;
  const tDough = ts?.tempDough ?? ambientTempC;
  const enzymaticMatPct = ts?.maturationPct ?? (session.initialMaturationOffset ?? 0) * 100;

  const startedMs = new Date(session.startedAt ?? now).getTime();
  const targetMs  = session.targetBakeAt ? new Date(session.targetBakeAt).getTime() : now + 86_400_000;
  const effectiveTimeline = buildEffectiveTimeline(session, !!session.outOfProtocolPhaseConfirmed);
  const canonical = deriveCanonicalPhases(effectiveTimeline, startedMs, now, { temperingH: (session as { temperingH?: number }).temperingH });
  const bakeStart = canonical.find(p => p.isBake)?.startMs;
  const serviceMs = (session.serviceWindowH ?? 0) * 3_600_000;
  const planBakeMs = bakeStart != null && Number.isFinite(bakeStart) ? bakeStart - serviceMs : targetMs;

  const hadFridge = (session.thermalTimeline ?? []).some(sg => isFridgePhase(sg?.phaseType) && sg.status !== 'planned');
  const bakeable  = canBakeNow({ phase, tDoughC: tDough, hadFridge });
  const isColdPhase = isFridgePhase(phase);
  const enzAduNow = ts?.enzymaticAdu ?? (
    (session.initialMaturationOffset ?? 0) > 0
      ? (findAduAt as (a: number, b: number, c: number, d: number) => number)(
        ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, (session.initialMaturationOffset ?? 0) * 100)
      : 0);
  let etaH: number | null = null;
  try {
    const spot = (sweetSpotMaturation as (s: unknown, a: number, t: number) => { status: string; hoursUntilPeak: number } | null)(
      { ...session, alertThreshold: threshold }, enzAduNow, ambientTempC);
    etaH = spot ? (spot.status === 'past_peak' ? 0 : Math.max(0, spot.hoursUntilPeak)) : null;
  } catch { etaH = null; }
  // In frigo, in riscaldo o con un frigo ancora in programma la proiezione a T
  // costante non vale (presume tutto a temperatura ambiente): comanda il piano.
  const fridgeAhead = effectiveTimeline.some(sg => isFridgePhase(sg?.phaseType) && sg.status === 'planned');
  const usePlan = isColdPhase || !bakeable || fridgeAhead || etaH == null || etaH > 240;
  const readyAtMs = usePlan ? planBakeMs : (ts?.lastTickAt ?? now) + (etaH ?? 0) * 3_600_000;
  return {
    readyAtMs, usePlan, isColdPhase, fridgeAhead, etaH, planBakeMs, bakeable, hadFridge,
    threshold, enzymaticMatPct, phase, effectiveTimeline,
  };
}
