/**
 * PizzaMatrix — Canonical Phase Model (v2.4.20)
 *
 * Una sola derivazione, consumata da TUTTE le viste (chip header, strip orizzontale,
 * stringa header grafico): per OGNI stile e protocollo la fermentazione si racconta
 * SEMPRE con le quattro fasi canoniche
 *
 *     PUNTATA → STAGLIO → APPRETTO → COTTURA   (+ USCITA FRIGO condizionale)
 *
 * presenti anche quando il segmento corrispondente ha durata ~0 (marker puntuale).
 * Questo elimina sia la non-uniformità (la strip saltava le fasi senza segmento) sia
 * la divergenza chip-TA / strip-TC (viste con sorgenti diverse).
 *
 * `deriveCanonicalPhases` è una funzione PURA che mappa `PhaseSegment[]` (la timeline
 * EFFETTIVA, già riconciliata fuori-protocollo a monte) nelle fasi canoniche. Non muta
 * input, non legge `protocollo_preferito` né template: l'env TA/TC è derivato dagli
 * ambienti reali dei segmenti.
 *
 * NON tocca: Two-Clock, now-split v2.4.18 (lo `state` rispetta gli status dei segmenti
 * mantenuti dal tick loop), fisica dei segmenti, semantica della transizione di fase.
 */
import type { PhaseSegment } from '../db/db';

/** Fasi frigo (TC): l'ambiente è `fridgeTempC`. */
const FRIDGE_PHASES = new Set(['bulk_fridge', 'balled_fridge']);

/** Margine v2.4.16 (#94): solo fasi che iniziano oltre now+5min sono tappabili. */
const TAP_MARGIN_MS = 5 * 60 * 1000;

export type PhaseEnv   = 'TA' | 'TC' | null;
export type PhaseState = 'past' | 'current' | 'future';
export type CanonicalKey = 'puntata' | 'staglio' | 'appretto' | 'tempering' | 'cottura';

export interface CanonicalPhase {
  key:          CanonicalKey;
  label:        string;      // 'PUNTATA' | 'STAGLIO' | …
  env:          PhaseEnv;    // 'TA' | 'TC' | null (cottura)
  startMs:      number;
  endMs:        number;      // === startMs per i marker puntuali (staglio, cottura)
  state:        PhaseState;
  tappable:     boolean;
  transitionTo: string;      // phaseType passato a setPhase/CONFIRM_PHASE_TRANSITION
  isMarker:     boolean;     // marker puntuale vs span con durata
  isBake:       boolean;     // cottura (rombo ★)
}

/** Label da mostrare: "PUNTATA · TA", "APPRETTO · TC", "COTTURA". */
export function canonicalDisplayLabel(p: CanonicalPhase): string {
  return p.env ? `${p.label} · ${p.env}` : p.label;
}

/** Stato di una fase: gli status dei segmenti (mantenuti dal tick loop) hanno
 *  priorità sul tempo, così il now-split v2.4.18 non viene scavalcato. */
function deriveState(spanSegs: PhaseSegment[], startMs: number, endMs: number, nowMs: number): PhaseState {
  if (spanSegs.some(s => s.status === 'current')) return 'current';
  if (spanSegs.length > 0 && spanSegs.every(s => s.status === 'completed')) return 'past';
  if (spanSegs.length > 0 && spanSegs.every(s => s.status === 'planned'))   return 'future';
  // Fallback temporale (timeline senza status affidabili).
  if (nowMs >= endMs)   return 'past';
  if (nowMs >= startMs) return 'current';
  return 'future';
}

function tappableFrom(state: PhaseState, startMs: number, nowMs: number): boolean {
  return state === 'future' && startMs > nowMs + TAP_MARGIN_MS;
}

/**
 * Deriva le fasi canoniche dalla timeline effettiva.
 * @param timeline    PhaseSegment[] effettivo (già riconciliato fuori-protocollo).
 * @param startedAtMs epoch ms di inizio impasto (per convertire startElapsedH → ms).
 * @param nowMs       epoch ms "ora".
 * @param opts.temperingH  ore di tempering: TEMPERING è separato solo se > 0.
 */
export function deriveCanonicalPhases(
  timeline: PhaseSegment[] | undefined,
  startedAtMs: number,
  nowMs: number,
  opts: { temperingH?: number } = {},
): CanonicalPhase[] {
  const segs = (Array.isArray(timeline) ? timeline : [])
    .filter((s): s is PhaseSegment => !!s && typeof s.phaseType === 'string')
    .slice()
    .sort((a, b) => a.startElapsedH - b.startElapsedH);

  const toMs   = (h: number) => startedAtMs + h * 3_600_000;
  const segEnd = (s: PhaseSegment) => s.endElapsedH ?? s.startElapsedH;

  const timelineStartH = segs.length ? segs[0].startElapsedH : 0;
  const timelineEndH   = segs.length ? Math.max(...segs.map(segEnd)) : 0;

  const bulk         = segs.filter(s => s.phaseType === 'bulk_room' || s.phaseType === 'bulk_fridge');
  const balledRest   = segs.filter(s => s.phaseType === 'balled_room');
  const balledFridge = segs.filter(s => s.phaseType === 'balled_fridge');
  const proofing     = segs.filter(s => s.phaseType === 'proofing');

  // USCITA FRIGO = proofing TA finale dopo un appretto TC, SOLO se temperingH > 0.
  const hasTempering = (opts.temperingH ?? 0) > 0 && balledFridge.length > 0 && proofing.length > 0;
  const temperingSeg = hasTempering ? proofing[proofing.length - 1] : null;

  const phases: CanonicalPhase[] = [];

  // ── PUNTATA: span dei segmenti bulk ─────────────────────────────────────────
  const punStartH = bulk.length ? bulk[0].startElapsedH : timelineStartH;
  const punEndH   = bulk.length ? Math.max(...bulk.map(segEnd)) : timelineStartH;
  const punStartMs = toMs(punStartH);
  const punEndMs   = toMs(punEndH);
  const punState   = deriveState(bulk, punStartMs, punEndMs, nowMs);
  phases.push({
    key: 'puntata', label: 'PUNTATA',
    env: bulk.some(s => FRIDGE_PHASES.has(s.phaseType)) ? 'TC' : 'TA',
    startMs: punStartMs, endMs: punEndMs, state: punState,
    tappable: tappableFrom(punState, punStartMs, nowMs),
    transitionTo: bulk.length ? bulk[0].phaseType : 'bulk_room',
    isMarker: false, isBake: false,
  });

  // ── STAGLIO: marker al confine bulk→balled ──────────────────────────────────
  // env dall'ambiente della prima fase balled che segue.
  const afterBulk = segs.find(s => s.phaseType !== 'bulk_room' && s.phaseType !== 'bulk_fridge');
  const staglioH  = afterBulk ? afterBulk.startElapsedH : punEndH;
  const staglioMs = toMs(staglioH);
  const staglioState = deriveState(balledRest, staglioMs, staglioMs, nowMs);
  phases.push({
    key: 'staglio', label: 'STAGLIO',
    env: afterBulk && FRIDGE_PHASES.has(afterBulk.phaseType) ? 'TC' : 'TA',
    startMs: staglioMs, endMs: staglioMs, state: staglioState,
    tappable: tappableFrom(staglioState, staglioMs, nowMs),
    transitionTo: 'balled_room',
    isMarker: true, isBake: false,
  });

  // ── APPRETTO: span balled+proofing fino a cottura, escluso il tempering ──────
  const apprettoSegs = [...balledRest, ...balledFridge, ...proofing].filter(s => s !== temperingSeg);
  const isTcAppretto = balledFridge.length > 0;
  const appStartH = apprettoSegs.length ? Math.min(...apprettoSegs.map(s => s.startElapsedH)) : staglioH;
  const appEndH   = apprettoSegs.length ? Math.max(...apprettoSegs.map(segEnd))
                                        : (temperingSeg ? temperingSeg.startElapsedH : timelineEndH);
  const appStartMs = toMs(appStartH);
  const appEndMs   = toMs(appEndH);
  const appState   = deriveState(apprettoSegs, appStartMs, appEndMs, nowMs);
  phases.push({
    key: 'appretto', label: 'APPRETTO',
    env: isTcAppretto ? 'TC' : 'TA',
    startMs: appStartMs, endMs: appEndMs, state: appState,
    tappable: tappableFrom(appState, appStartMs, nowMs),
    transitionTo: isTcAppretto ? 'balled_fridge' : 'proofing',
    isMarker: false, isBake: false,
  });

  // ── USCITA FRIGO (condizionale): confine balled_fridge → proofing ────────────
  // Marker puntuale al momento in cui i panetti escono dal frigo per il tempering
  // (= fine appretto TC = cottura − temperingH). Esiste SOLO per appretto TC con
  // temperingH > 0; in TC puntata l'uscita frigo coincide con lo STAGLIO (nessun
  // doppione). Tappabile forward-only via la transizione 'proofing' esistente.
  if (temperingSeg) {
    const tStartMs = toMs(temperingSeg.startElapsedH);
    const tEndMs   = toMs(segEnd(temperingSeg));
    const tState   = deriveState([temperingSeg], tStartMs, tEndMs, nowMs);
    phases.push({
      key: 'tempering', label: 'USCITA FRIGO', env: 'TA',
      startMs: tStartMs, endMs: tStartMs, state: tState,
      tappable: tappableFrom(tState, tStartMs, nowMs),
      transitionTo: 'proofing',
      isMarker: true, isBake: false,
    });
  }

  // ── COTTURA: marker ★ a fine timeline, sempre presente, non tappabile ───────
  const cotturaMs = toMs(timelineEndH);
  phases.push({
    key: 'cottura', label: 'COTTURA', env: null,
    startMs: cotturaMs, endMs: cotturaMs,
    state: nowMs >= cotturaMs ? 'past' : 'future',
    tappable: false,
    transitionTo: 'baking',
    isMarker: true, isBake: true,
  });

  return phases;
}
