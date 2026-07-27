/**
 * PizzaMatrix — Out-of-Protocol Phase Gate (v2.4.19 PARTE A)
 *
 * Una fase fuori dal `protocollo_preferito` dello stile (es. una fase frigo in uno
 * stile `ta_only`) non deve mai entrare in silenzio nella timeline. Questo modulo
 * fornisce funzioni PURE per:
 *   1. rilevare una fase fuori-protocollo nella thermalTimeline (detectOutOfProtocolPhase)
 *   2. derivare la timeline EFFETTIVA che le 3 viste consumano (buildEffectiveTimeline)
 *      — non distruttivo: session.thermalTimeline resta intatto; la conferma flippa
 *      solo `outOfProtocolPhaseConfirmed`.
 *   3. generare la stringa header dalle fasi reali (buildHeaderTempString)
 *
 * Principio non negoziabile: mai mutare silenziosamente input/protocollo utente.
 * L'inserimento di una fase fuori-protocollo è advisory + conferma, mai automatico.
 */
import type { PhaseSegment, Session } from '../db/db';
import { buildInitialTimeline } from '../db/db';
import { getStyleProfile } from '../engine';

/** Fasi frigo (TC) — l'ambiente è `fridgeTempC`. */
const FRIDGE_PHASES = new Set(['bulk_fridge', 'balled_fridge']);

/**
 * Fasi sancite per protocollo preferito dello stile.
 * - `ta_only`: nessuna fase frigo ammessa (napoletana, …).
 * - `misto_ta_tc` / `tc_only`: fasi frigo ammesse (contemporanea, teglia, pala, …).
 * Un protocollo sconosciuto è trattato come permissivo (no gate).
 */
export function fridgePhaseIsSanctioned(protocolloPreferito: unknown): boolean {
  return protocolloPreferito !== 'ta_only';
}

/**
 * Rileva la prima fase frigo NON sancita dal protocollo preferito dello stile.
 * Ritorna il segmento offendente, o null se la timeline è in-protocollo.
 */
export function detectOutOfProtocolPhase(
  style: string,
  timeline: PhaseSegment[] | undefined,
): PhaseSegment | null {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const profile = getStyleProfile(style);
  const pref = profile?.protocollo_preferito;
  if (fridgePhaseIsSanctioned(pref)) return null; // stile permette il frigo
  // ta_only: qualsiasi fase frigo è fuori-protocollo
  return timeline.find(
    (s): s is PhaseSegment => !!s && FRIDGE_PHASES.has(s.phaseType),
  ) ?? null;
}

/**
 * Timeline EFFETTIVA consumata da header, timeline orizzontale e curve.
 *
 * - In-protocollo, o conferma esplicita → ritorna `session.thermalTimeline` invariato
 *   (single source of truth onorata; con la fase frigo se confermata).
 * - Fuori-protocollo e NON confermato (default) → ricostruisce un piano all-TA dalle
 *   durate date (puntataH/staglioH/apprettoH), senza alcuna fase frigo. Non muta la
 *   sessione: è una derivazione di sola lettura.
 */
export function buildEffectiveTimeline(
  session: Session,
  confirmed: boolean,
): PhaseSegment[] {
  const raw = session.thermalTimeline;
  const offending = detectOutOfProtocolPhase(session.style, raw);

  // In-protocollo o confermato: onora la timeline persistente così com'è.
  if (!offending || confirmed) {
    return Array.isArray(raw) && raw.length > 0
      ? raw
      : buildInitialTimeline(session as any);
  }

  // Fuori-protocollo, non confermato → piano all-TA dalle durate utente.
  // buildInitialTimeline('ta') produce [bulk_room, balled_room, proofing] a tLaboratorio.
  return buildInitialTimeline({
    ...(session as any),
    apprettoProtocol: 'ta',
  });
}

/**
 * Durata totale pianificata della timeline effettiva [h] = Σ(durate segmenti).
 * Usata per accorciare l'orizzonte del grafico al piano reale quando all-TA.
 */
export function effectiveTimelineDurationH(timeline: PhaseSegment[]): number {
  return (Array.isArray(timeline) ? timeline : []).reduce((sum, s) => {
    if (!s || s.endElapsedH == null) return sum;
    return sum + Math.max(0, s.endElapsedH - s.startElapsedH);
  }, 0);
}

/**
 * Stringa header delle temperature generata ESCLUSIVAMENTE dalle fasi reali.
 * Forma: "{TA}°C TA · {TC}°C TC · {PROTO}" — la clausola "TC" appare SOLO se la
 * timeline contiene effettivamente un segmento frigo (niente TC fantasma).
 *
 * - taTemp = temperatura del primo segmento caldo (non frigo).
 * - tcTemp = temperatura del primo segmento frigo, se presente.
 * - protoLabel = derivata dalla composizione fasi (presenza frigo + ordine).
 */
export function buildHeaderTempString(
  timeline: PhaseSegment[],
  fallbackTaTempC: number,
): string {
  const segs = (Array.isArray(timeline) ? timeline : []).filter(
    (s): s is PhaseSegment => !!s && typeof s.phaseType === 'string',
  );
  const warmSeg   = segs.find(s => !FRIDGE_PHASES.has(s.phaseType));
  const fridgeSeg = segs.find(s => FRIDGE_PHASES.has(s.phaseType));

  const taTemp = warmSeg ? warmSeg.ambientTempC : fallbackTaTempC;
  const parts: string[] = [`${taTemp.toFixed(1)}°C TA`];
  if (fridgeSeg) parts.push(`${fridgeSeg.ambientTempC.toFixed(0)}°C TC`);

  // Label protocollo derivata dalle fasi reali (non da apprettoProtocol/profilo)
  parts.push(deriveProtoLabel(segs));
  return parts.join(' · ');
}

/** Etichetta protocollo derivata dalla sequenza fasi reali della timeline. */
export function deriveProtoLabel(timeline: PhaseSegment[]): string {
  const segs = Array.isArray(timeline) ? timeline : [];
  const hasBulkFridge   = segs.some(s => s?.phaseType === 'bulk_fridge');
  const hasBalledFridge = segs.some(s => s?.phaseType === 'balled_fridge');
  if (hasBulkFridge && hasBalledFridge) return 'TC';
  if (hasBulkFridge)   return 'TC Puntata';
  if (hasBalledFridge) return 'TC Appretto';
  return 'TA';
}
