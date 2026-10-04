/**
 * PizzaMatrix — Dashboard v4 (VIEW B — Monitor Fermentazione)
 * Layout mobile-first, dark theme, semaforo adattivo per stile.
 * Grafico: GompertzChartV4 (v2.4.18 BUG 1: now-split realized/projected, slider-safe).
 *
 * Adattata alle API reali del progetto:
 *  - dati live da state.tickState (two-clock) anziché da un hook che ritorna metriche
 *  - T_amb modificata via setTempAmbient() (aggiorna anche la ThermalTimeline)
 *  - W strutturale da computeDashboardEffectiveW (tRatio/tCritHours per la curva Hill)
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useTickEngine, type PhaseSnapshot } from '../../hooks/useTickEngine';
import {
  getStyleProfile, computeStyleAwareAlertLevel, computeDashboardEffectiveW,
  computeCurrentPH, sweetSpotMaturation, findAduAt, ENZYMATIC_CLOCK_PARAMS,
} from '../../engine';
import { applyPhaseTransition, buildInitialTimeline, type Session } from '../../db/db';
import type { DashboardWResult, AlertLevelResult } from '../../engine';
import { simulateTimeline } from '../../engine/serviceWindowSolver';
import { makeLeavAduRateAt, computeCollapseETA, type CollapseETAResult } from '../../engine/collapse';
import {
  detectOutOfProtocolPhase, buildEffectiveTimeline, effectiveTimelineDurationH,
} from '../../engine/outOfProtocol';
import { deriveCanonicalPhases, canonicalDisplayLabel } from '../../engine/canonicalPhases';
import { projectCoreTempAtBakeC, CORE_TEMP_AT_BAKE_MIN_C } from '../../engine/coreTempProjection';
import { QualityProfileCard } from './QualityProfileCard';
import { GompertzChartV4 } from './GompertzChartV4';
import { MiniHillCurve } from '../shared/MiniHillCurve';
import { FermentationTimeline } from './FermentationTimeline';
import { SemaforoCard, SEMAFORO_COLORS, CollapseModal, type SemaforoState } from './SemaforoCard';
import { OutOfProtocolModal } from './OutOfProtocolModal';
import { LiveHeader } from './LiveHeader';

const STYLE_LABELS: Record<string, string> = {
  napoletana: 'Napoletana', contemporanea: 'Contemporanea',
  teglia: 'Teglia', pala: 'Pala', nystyle: 'NY Style',
};

// ─── Stato semaforo da alertLevel / tRatio ────────────────────────────────────
// Presentazione: la maturazione ha tre stati propri (IN CORSO → QUASI → PRONTO);
// giallo/rosso restano riservati ai problemi strutturali della W.
export function matSemaforoFromLevel(level: string, _matPct: number, _threshold: number): SemaforoState {
  if (level === 'STRUCTURAL_COLLAPSED') return 'COLLAPSED';
  if (level === 'STRUCTURAL_CRITICAL')  return 'CRITICAL';
  if (level === 'STRUCTURAL_WARNING')   return 'WARNING';
  if (level === 'SWEET_SPOT')  return 'PRONTO';
  if (level === 'APPROACHING') return 'QUASI';
  return 'IN_CORSO';
}

export function matStateIndependent(matPct: number, threshold: number): SemaforoState {
  const r = threshold > 0 ? matPct / threshold : 0;
  if (matPct >= threshold) return 'PRONTO';
  if (r >= 0.90) return 'QUASI';
  return 'IN_CORSO';
}

function wStateFromRatio(tRatio: number): SemaforoState {
  if (tRatio < 0.30)  return 'TOO_EARLY';
  if (tRatio < 0.75)  return 'OK';
  if (tRatio < 0.85)  return 'WARNING';
  if (tRatio < 1.05)  return 'CRITICAL';
  return 'COLLAPSED';
}

const SEVERITY: Record<SemaforoState, number> = {
  TOO_EARLY: 0, IN_CORSO: 0, OK: 1, QUASI: 1, PRONTO: 1, WARNING: 2, CRITICAL: 3, COLLAPSED: 4,
};

// ─── Tempo leggibile da lontano: orari assoluti, non ore decimali ──────────────
function fmtClock(d: Date, now = new Date()): string {
  const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? t : `${d.toLocaleDateString('it-IT', { weekday: 'short' })} ${t}`;
}
function fmtDuration(h: number): string {
  if (h < 1 / 60) return 'ora';
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0) return `${mm} min`;
  return mm > 0 ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${hh}h`;
}

const OUTCOMES: Array<{ value: NonNullable<Session['outcomeRating']>; label: string }> = [
  { value: 'excellent', label: 'Ottima' },
  { value: 'good',      label: 'Buona' },
  { value: 'ok',        label: 'Ok' },
  { value: 'poor',      label: 'Da rivedere' },
];
function moreSevere(a: SemaforoState, b: SemaforoState): SemaforoState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// ─── Pannello strumento (milled, warm) — sostituisce le vecchie DarkCard grigie ──
function DarkCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="pm4-panel" style={{ padding: '13px 14px 14px', ...style }}>
      {children}
    </div>
  );
}

// Etichetta-canale incisa: "NN · NOME ————————— [right]"
function ChannelLabel({ idx, name, tick, right, help }: {
  idx: string; name: string; tick?: string; right?: React.ReactNode;
  /** Spiegazione breve, mostrata solo a richiesta (progressive disclosure). */
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pm4-chan">
        <span className="pm4-chan-idx">{idx}</span>
        <span className="pm4-chan-name">{name}</span>
        {help && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            aria-label={open ? `Nascondi spiegazione: ${name}` : `Cosa significa: ${name}`}
            style={{
              width: 44, height: 44, margin: '-14px -12px -14px -10px', flexShrink: 0,
              background: 'none', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}>
            <span aria-hidden="true" style={{
              width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center',
              border: `1px solid ${open ? 'var(--pm4-ember)' : 'var(--pm4-line-strong)'}`,
              color: open ? 'var(--pm4-ember)' : 'var(--pm4-tan)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
            }}>?</span>
          </button>
        )}
        <span className="pm4-chan-rule" />
        {right ?? (tick ? <span className="pm4-chan-tick">{tick}</span> : null)}
      </div>
      {help && open && (
        <p style={{ margin: '-4px 0 10px', color: 'var(--pm4-tan)', fontSize: 12, lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
          {help}
        </p>
      )}
    </>
  );
}

const HELP_STATO = 'Due orologi: la lievitazione (gas prodotto dal lievito) e la maturazione (enzimi che lavorano la farina) corrono a velocità diverse. Il semaforo segue la maturazione.';
const HELP_GLUTINE = 'Col tempo la W cala perché gli enzimi tagliano il glutine. Al 100% di usura la pasta non regge più la stesura.';
const HELP_TEMPERATURA = "Il cuore dell'impasto insegue lentamente la temperatura dell'ambiente: il contenitore fa da isolante.";

function SecondaryRow({ pH, leaveningPct, W, matPct }: {
  pH?: number; leaveningPct?: number; W?: number; matPct?: number;
}) {
  const items: Array<{ label: string; value: React.ReactNode; color: string }> = [];
  if (matPct != null)       items.push({ label: 'Maturazione',  value: <>{matPct.toFixed(1)}<small>%</small></>,      color: 'var(--accent-brand)' });
  if (leaveningPct != null) items.push({ label: 'Lievitazione', value: <>{leaveningPct.toFixed(1)}<small>%</small></>, color: 'var(--pm4-green)' });
  if (pH != null)           items.push({ label: 'pH',      value: pH.toFixed(2),                                   color: 'var(--accent-warning)' });
  if (W != null)            items.push({ label: 'W',       value: `${Math.round(W)}`,                              color: 'var(--pm4-flour)' });
  return (
    <div className="pm4-cells" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(it => (
        <div className="pm4-cell" key={it.label}>
          <div className="pm4-cell-k">{it.label}</div>
          <div className="pm4-cell-v" style={{ color: it.color }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Sezione collassabile (warm) ──────────────────────────────────────────────
function Collapsible({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pm4-panel" style={{ padding: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: '100%', minHeight: 44, padding: '13px 14px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', alignItems: 'center', background: 'none', border: 'none' }}>
        <span style={{ color: 'var(--pm4-tan)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{title}</span>
        <span aria-hidden="true" style={{ color: 'var(--pm4-ember)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

// ─── Readout collasso da sovra-lievitazione (v2.4.23) ─────────────────────────
// Segnale STRUTTURALE distinto dal decadimento Hill (proteolisi): mostra l'ETA
// di sbollatura post-picco proiettata alla temperatura corrente.
function CollapseReadout({ info, ambientTempC }: { info: CollapseETAResult | null; ambientTempC: number }) {
  let label: string;
  let color = 'var(--pm4-umber)';
  if (!info || info.reachesPeak === false) {
    label = 'non prevista: a questa T il lievito non arriva al picco';
  } else if (info.collapseTime == null || info.marginH == null) {
    label = `nessuna nelle prossime 48h a ${ambientTempC.toFixed(0)}°C`;
    color = 'var(--pm4-green)';
  } else {
    const m = info.marginH;
    color = m < 1 ? 'var(--state-critical)' : m < 3 ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)';
    label = `${fmtDuration(m)} dopo il picco di lievitazione, a ${ambientTempC.toFixed(0)}°C`;
  }
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span className="pm4-cell-k" style={{ textAlign: 'left' }}>sbollatura</span>
      <span style={{ color, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
        {label}
      </span>
    </div>
  );
}

// ─── Readout cuore impasto alla cottura (v2.4.21) ─────────────────────────────
// Avvisa se il cuore proiettato a cottura è sotto i 18°C (impasto freddo → crosta
// scottata / mollica gommosa). Advisory, mai bloccante.
function CoreTempAtBakeReadout({ coreTempAtBake }: { coreTempAtBake: number | null }) {
  if (coreTempAtBake == null) return null;
  const deficit = CORE_TEMP_AT_BAKE_MIN_C - coreTempAtBake;
  const warn    = deficit > 0;
  const color   = warn ? (deficit > 4 ? 'var(--state-critical)' : 'var(--pm4-ember-lo)') : 'var(--pm4-tan)';
  const label   = warn
    ? `${coreTempAtBake.toFixed(1)}° · ${deficit.toFixed(1)}° sotto il minimo di ${CORE_TEMP_AT_BAKE_MIN_C}°`
    : `${coreTempAtBake.toFixed(1)}° · ok (min ${CORE_TEMP_AT_BAKE_MIN_C}°)`;
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span className="pm4-cell-k" style={{ textAlign: 'left' }}>cuore a cottura</span>
      <span style={{ color, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
        {warn ? '⚠ ' : ''}{label}
      </span>
    </div>
  );
}

// ─── Component principale ──────────────────────────────────────────────────────
export function DashboardV4() {
  const { state, dispatch } = useApp();
  const { setTempAmbient, setPhase, snapshotPhase, restorePhase } = useTickEngine();
  const [confirmEnd, setConfirmEnd] = useState(false);
  // "Ho infornato": mini-esito prima di chiudere la sessione.
  const [askOutcome, setAskOutcome] = useState(false);
  // Cambio fase: richiesta da confermare + annulla temporaneo.
  const [pendingPhase, setPendingPhase] = useState<{ phaseType: string; label: string } | null>(null);
  const [undo, setUndo] = useState<{ snap: PhaseSnapshot; label: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTempEdit, setShowTempEdit] = useState(false);
  // Permette all'utente di ignorare il modal COLLAPSED e continuare a monitorare
  const [collapseAcknowledged, setCollapseAcknowledged] = useState(false);
  // R5: Monitor = Zona01 + sweet spot + timeline; Analisi = tutto. Persiste in localStorage.
  const [dashMode, setDashMode] = useState<'monitor' | 'analisi'>(() => {
    // Default Monitor: l'uso dominante è lo sguardo veloce accanto all'impasto.
    try { return (localStorage.getItem('pm-dashMode') ?? 'monitor') as 'monitor' | 'analisi'; }
    catch { return 'monitor'; }
  });
  // v2.4.19 PARTE A: l'utente ha già risposto all'advisory fuori-protocollo in questa
  // sessione? (per-sessione, sessionStorage) — evita che il modal riappaia ad ogni remount.
  const [oopAcknowledged, setOopAcknowledged] = useState(false);

  const session = state.activeSession;
  const ts = state.tickState;

  // R4: l'ack del collasso è persistito per-sessione (sessionStorage) così il
  // modal NON riappare dopo navigazione/remount per chi è già consapevole.
  useEffect(() => {
    if (!session) return;
    setCollapseAcknowledged(sessionStorage.getItem(`pm-collapseAck:${session.id}`) === '1');
    setOopAcknowledged(sessionStorage.getItem(`pm-oopAck:${session.id}`) === '1');
  }, [session?.id]);
  const ackCollapse = () => {
    setCollapseAcknowledged(true);
    if (session) sessionStorage.setItem(`pm-collapseAck:${session.id}`, '1');
  };
  // v2.4.19 PARTE A: risposta all'advisory fuori-protocollo. Entrambe le scelte
  // marcano l'ack di sessione; la scelta persiste su session.outOfProtocolPhaseConfirmed.
  const confirmOutOfProtocol = (confirmed: boolean) => {
    setOopAcknowledged(true);
    if (session) sessionStorage.setItem(`pm-oopAck:${session.id}`, '1');
    dispatch({ type: 'SESSION_UPDATE', patch: { outOfProtocolPhaseConfirmed: confirmed } });
  };

  // Schermo acceso mentre si monitora: niente sblocchi con le mani infarinate.
  // Silenzioso dove l'API manca; riacquisito al ritorno in primo piano.
  useEffect(() => {
    if (dashMode !== 'monitor' || !session) return;
    const nav = navigator as any;
    if (!nav.wakeLock?.request) return;
    let lock: any = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock.request('screen').then((l: any) => {
        if (cancelled) { l.release?.(); return; }
        lock = l;
      }).catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release?.().catch?.(() => {});
    };
  }, [dashMode, session?.id]);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // Dati derivati (memoizzati su tick) — hook chiamato sempre, anche senza sessione
  const derived = useMemo(() => {
    if (!session) return null;
    const styleProfile = getStyleProfile(session.style);
    const enzymaticMatPct = ts?.maturationPct ?? (session.initialMaturationOffset ?? 0) * 100;
    const leaveningPct = ts?.leaveningPct ?? 0;
    const ambientTempC = ts?.tempAmbient ?? session.tLaboratorio ?? 22;
    const T_dough = ts?.tempDough ?? ambientTempC;
    // pH da leavAdu (+ labAdu dual-pop per LM) — v2.4.11 §2.6.1 / v2.4.14 §2.6
    const pH = computeCurrentPH(
      session.initialPH ?? 5.8,
      ts?.cumulativeAdu ?? 0,
      session.agentType,
      (ts as any)?.labAdu ?? 0,
    ) as number;

    const wRes = computeDashboardEffectiveW(
      session as any, ts?.cumulativeAdu ?? 0, T_dough, pH as number,
    ) as DashboardWResult;

    const alertRes = computeStyleAwareAlertLevel(
      session as any, enzymaticMatPct, wRes.W_current, wRes.W_initial, leaveningPct,
    ) as AlertLevelResult;

    return { styleProfile, enzymaticMatPct, leaveningPct, ambientTempC, T_dough, pH, wRes, alertRes };
  }, [session, ts]);

  // ── Collasso da sovra-lievitazione (v2.4.23) — proiezione forward a T corrente ──
  // SEPARATO dal decadimento proteolitico Hill (pavimento di stesura): qui si
  // modella la sbollatura post-picco (overshoot leavAdu vs tolleranza-W). Legge
  // una trajectory simulata; non tocca enzAdu (Two-Clock §2.0).
  //
  // R1 (perf): la proiezione è una sim 48h pesante. NON deve girare a ogni tick.
  // Throttle su chiave a granularità grossa: ricalcola solo quando cambia fase,
  // leavAdu (±0.1 ADU) o T ambiente (±0.5°C) — invarianti su scala secondi.
  const collapseKey = (session && ts)
    ? `${session.id}|${ts.phase}|${Math.round((ts.cumulativeAdu ?? 0) * 10)}|${Math.round((ts.tempAmbient ?? 0) * 2)}`
    : null;
  const collapseInfo = useMemo<CollapseETAResult | null>(() => {
    if (!session || !ts) return null;
    try {
      const styleProfile = getStyleProfile(session.style);
      const bubbleThresholdPct =
        (session as any).bubbleThresholdPct ?? styleProfile.bubbleThresholdPct ?? 92;
      const ambientTempC = ts.tempAmbient ?? session.tLaboratorio ?? 22;
      const startedMs = (session.startedAt instanceof Date
        ? session.startedAt : new Date(session.startedAt ?? Date.now())).getTime();
      const curElapsedH = Math.max(0, (Date.now() - startedMs) / 3_600_000);

      const initial = {
        tempDough: ts.tempDough ?? ambientTempC,
        leavAdu:   ts.cumulativeAdu ?? 0,   // orologio lievitazione
        enzAdu:    ts.enzymaticAdu ?? 0,    // letto solo per continuità sim; non usato dal modello collasso
        wDamage:   ts.wDamage ?? 0,
        elapsedH:  curElapsedH,
      };
      const opts = {
        agentEaKj: session.agentEaKj, agentType: session.agentType,
        muMaxScaled: session.agentMuMax, leavLambda: session.agentLambda,
        agentAsymptote: session.agentAsymptote ?? 100,
        W0: session.effectiveW_initial ?? 280, hydration: session.hydration ?? 65,
        salt: session.salt ?? 2, totalFlourGrams: session.totalFlourGrams ?? 1000,
        numPanetti: session.numPanetti ?? 6, containerPreset: session.containerPreset ?? 'closed_box',
        initialPH: session.initialPH ?? 5.8,
        subStepH: 0.1,   // R1: passo più grosso per la proiezione advisory (≈480 step vs 960)
      };
      // Orizzonte "se mantieni a questa temperatura": cattura picco + collasso al caldo;
      // in frigo il collasso cade oltre la finestra → "stabile".
      const HORIZON_H = 48;
      const segments = [{ phaseType: 'proofing', durationH: HORIZON_H, ambientTempC }];
      const sim = (simulateTimeline as Function)(segments, initial, opts);
      const leavAduRateAt = makeLeavAduRateAt({
        agentEaKj: session.agentEaKj, agentType: session.agentType, salt: session.salt ?? 0,
        amylaseIndex: (session as any).effectiveAmylaseIndex ?? 1.0,  // issue #5
        initialPH: (session as any).initialPH ?? 5.8,
        hydration: session.hydration,                                 // issue #11
      });
      return computeCollapseETA({
        trajectory: sim.samples, bubbleThresholdPct, leavAduRateAt,
      }) as CollapseETAResult;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  // Timeline effettiva: hook chiamato SEMPRE (prima dell'early return, regole degli hook).
  const oopConfirmed = !!session?.outOfProtocolPhaseConfirmed;
  const effective = useMemo(() => {
    if (!session) return null;
    const tl = buildEffectiveTimeline(session, oopConfirmed);
    return { effectiveTimeline: tl, effectiveSession: { ...session, thermalTimeline: tl } };
  }, [session, oopConfirmed]);

  if (!session || !derived || !effective) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'var(--bg-primary)' }}>
        <span style={{ color: 'var(--pm4-umber)', fontFamily: 'var(--font-mono)' }}>Nessuna sessione attiva</span>
      </div>
    );
  }

  const { styleProfile, enzymaticMatPct, leaveningPct, ambientTempC, T_dough, pH, wRes, alertRes } = derived;
  const { W_current, W_initial, decayPct, tRatio, tCritHours } = wRes;
  const threshold = styleProfile.alertThreshold ?? 85;
  const primarySignal: string = styleProfile.primarySignal ?? 'maturation';

  // elapsedH computato da Date.now() — aggiornato ad ogni re-render (triggerd da tickState)
  const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date(session.targetBakeAt ?? Date.now() + 86_400_000);
  const elapsedH   = Math.max(0, (Date.now() - startedAt.getTime()) / 3_600_000);
  // Bug #95: durata pianificata totale per il range adattivo di MiniHillCurve
  const sessionDurationH = session.startedAt != null && session.targetBakeAt != null
    ? (targetBake.getTime() - startedAt.getTime()) / 3_600_000
    : null;
  // Ratio mostrato dal vivo (coincide con la posizione del dot Hill = elapsedH)
  const liveRatio  = tCritHours > 0 ? elapsedH / tCritHours : 0;

  const phase = ts?.phase ?? 'bulk_room';

  // Stati semaforo
  const matState = matSemaforoFromLevel(alertRes.level, enzymaticMatPct, threshold);
  const wState   = wStateFromRatio(tRatio);
  const matIndep = matStateIndependent(enzymaticMatPct, threshold);
  const currentSemaforoState: SemaforoState =
    primarySignal === 'structural' ? wState
    : primarySignal === 'dual'     ? moreSevere(matIndep, wState)
    : matState;

  const showCollapseModal = alertRes.level === 'STRUCTURAL_COLLAPSED' && !collapseAcknowledged;

  // ── v2.4.19 PARTE A — gate fuori-protocollo (single source of truth) ──────────
  // Le 3 viste (header, timeline orizzontale, curve) consumano la timeline EFFETTIVA.
  // Non confermato (default) + fase frigo in stile ta_only → all-TA, grafico accorciato.
  // Memoizzato su [session, oopConfirmed]: session è stabile tra i tick (TICK aggiorna
  // solo tickState), così il chart non ricalcola buildPiecewiseData ad ogni secondo.
  const outOfProtocolSeg = detectOutOfProtocolPhase(session.style, session.thermalTimeline);
  const { effectiveTimeline, effectiveSession } = effective;
  // A3: orizzonte accorciato quando riconciliato all-TA (fuori-protocollo non confermato).
  const isReconciledAllTA = !!outOfProtocolSeg && !oopConfirmed;
  const horizonH = isReconciledAllTA ? effectiveTimelineDurationH(effectiveTimeline) : null;
  // Advisory mostrato finché l'utente non sceglie (default = non confermato → all-TA).
  const showOutOfProtocolModal = !!outOfProtocolSeg && !oopConfirmed && !oopAcknowledged;

  // v2.4.20: chip header dalla fase CANONICA corrente (stessa sorgente della strip),
  // così non può più divergere (chip-TA vs strip-TC). Funzione pura → nessun hook.
  const canonicalPhases  = deriveCanonicalPhases(
    effectiveTimeline, startedAt.getTime(), Date.now(), { temperingH: (session as any).temperingH },
  );
  const canonicalCurrent = canonicalPhases.find(p => p.state === 'current');

  // v2.4.21: cuore impasto proiettato al momento della cottura. < 18°C → impasto
  // troppo freddo per infornare (advisory in 3 viste). Funzione pura → nessun hook.
  const bakeH = horizonH != null ? horizonH : (targetBake.getTime() - startedAt.getTime()) / 3_600_000;
  const coreTempAtBake = projectCoreTempAtBakeC({
    timeline: effectiveTimeline, nowElapsedH: elapsedH, bakeH,
    currentDoughTempC: T_dough, ambientTempC, session: session as any,
  });
  const coldAtBake = coreTempAtBake != null && coreTempAtBake < CORE_TEMP_AT_BAKE_MIN_C;
  const coldBakeMsg = coldAtBake
    ? `inforni a ~${coreTempAtBake!.toFixed(0)}° · ${(CORE_TEMP_AT_BAKE_MIN_C - coreTempAtBake!).toFixed(0)}° sotto i ${CORE_TEMP_AT_BAKE_MIN_C}° consigliati`
    : undefined;

  // ── "Quando inforno?" — ETA al picco di maturazione (orologio enzimatico) ──────
  // Lettura del motore (sweetSpotMaturation, proiezione a T costante), stessa soglia
  // del semaforo. In fase fredda la proiezione a T frigo è fuorviante: vale il piano.
  const isColdPhase = phase === 'bulk_fridge' || phase === 'balled_fridge';
  const enzAduNow = ts?.enzymaticAdu ?? (
    (session.initialMaturationOffset ?? 0) > 0
      ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, (session.initialMaturationOffset ?? 0) * 100) as number
      : 0);
  let etaH: number | null = null;
  try {
    const spot = (sweetSpotMaturation as Function)({ ...session, alertThreshold: threshold }, enzAduNow, ambientTempC) as
      { status: string; hoursUntilPeak: number } | null;
    etaH = spot ? (spot.status === 'past_peak' ? 0 : Math.max(0, spot.hoursUntilPeak)) : null;
  } catch { etaH = null; }
  const nowDate   = new Date();
  const isReady   = matState === 'PRONTO' || (etaH === 0 && enzymaticMatPct >= threshold);
  const usePlan   = isColdPhase || etaH == null || etaH > 240;
  const readyAt   = usePlan ? targetBake : new Date(nowDate.getTime() + (etaH ?? 0) * 3_600_000);
  const readyInH  = Math.max(0, (readyAt.getTime() - nowDate.getTime()) / 3_600_000);
  const planDiffH = Math.abs(readyAt.getTime() - targetBake.getTime()) / 3_600_000;
  // Finestra residua = istante di sbollatura (ore trascorse, stessa base della sim) − adesso.
  const collapseAtH = collapseInfo && collapseInfo.reachesPeak !== false ? collapseInfo.collapseTime : null;
  const windowLeftH = collapseAtH != null ? Math.max(0, collapseAtH - elapsedH) : null;
  const windowStr = windowLeftH == null ? 'finestra aperta'
    : windowLeftH < 1 / 60 ? 'sbollatura imminente · inforna subito'
    : `ancora ~${fmtDuration(windowLeftH)} prima della sbollatura`;
  const etaValue  = isReady ? 'ORA' : `~${fmtClock(readyAt, nowDate)}`;
  const etaSub    = isReady
    ? windowStr
    : usePlan
      ? `in frigo · secondo il piano · tra ${fmtDuration(readyInH)}`
      : `tra ${fmtDuration(readyInH)}${planDiffH > 0.5 ? ` · target ${fmtClock(targetBake, nowDate)}` : ''}`;
  const matFootnote = `maturazione ${enzymaticMatPct.toFixed(1)}% → target ${threshold}%`;
  const statusAnnouncement = matState === 'PRONTO' ? 'Pronto per infornare'
    : matState === 'QUASI' ? 'Quasi pronto' : '';

  // ── Cambio fase con conferma + annulla ──────────────────────────────────────
  const requestPhase = (phaseType: string, label: string) => setPendingPhase({ phaseType, label });
  const preview = (() => {
    if (!pendingPhase) return null;
    try {
      const startedMs = startedAt.getTime();
      const nowElapsed = (Date.now() - startedMs) / 3_600_000;
      const base = session.thermalTimeline ?? buildInitialTimeline(session as any);
      const isCold = pendingPhase.phaseType === 'bulk_fridge' || pendingPhase.phaseType === 'balled_fridge';
      const next = applyPhaseTransition(base, pendingPhase.phaseType as any, isCold ? (session.fridgeTempC ?? 4) : (session.tLaboratorio ?? 22), nowElapsed);
      // stessa regola di deriveCanonicalPhases: fine segmento = endElapsedH ?? start
      const endH = (tl: any[]) => Math.max(0, ...tl.map((sg: any) => sg.endElapsedH ?? sg.startElapsedH));
      const nextPlanned = base.filter((sg: any) => sg.status === 'planned').map((sg: any) => sg.startElapsedH);
      const cutH = nextPlanned.length ? Math.max(0, Math.min(...nextPlanned) - nowElapsed) : 0;
      return {
        cutH,
        curLabel: canonicalCurrent ? canonicalDisplayLabel(canonicalCurrent) : 'fase corrente',
        bakeBefore: new Date(startedMs + endH(base) * 3_600_000),
        bakeAfter:  new Date(startedMs + endH(next) * 3_600_000),
      };
    } catch { return null; }
  })();
  const confirmPhase = () => {
    if (!pendingPhase) return;
    const snap = snapshotPhase();
    setPhase(pendingPhase.phaseType, { enforceForward: true });
    if (snap) {
      setUndo({ snap, label: pendingPhase.label });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 10_000);
    }
    setPendingPhase(null);
  };
  const undoPhase = () => {
    if (!undo) return;
    restorePhase(undo.snap);
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  // ── Fine sessione: con esito (Ho infornato) o semplice ───────────────────────
  // SESSION_UPDATE e SESSION_END in due render distinti: la persistenza legge la
  // sessione *precedente* allo SESSION_END, che deve già contenere l'esito.
  const finishWithOutcome = (rating: NonNullable<Session['outcomeRating']>) => {
    dispatch({ type: 'SESSION_UPDATE', patch: { outcomeRating: rating } });
    setTimeout(() => dispatch({ type: 'SESSION_END' }), 0);
  };

  return (
    <div className="pm4-root" style={{ minHeight: '100dvh', maxWidth: 430, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>

      {/* ── HEADER FISSO con timer isolato (1s) ── */}
      <LiveHeader
        style={session.style ?? ''}
        totalFlourGrams={session.totalFlourGrams ?? 0}
        startedAt={startedAt}
        targetBakeAt={targetBake}
        currentPhase={phase}
        alertLevel={alertRes.level}
        alertMessage={alertRes.message}
        currentPhaseLabel={canonicalCurrent ? canonicalDisplayLabel(canonicalCurrent) : undefined}
        currentPhaseCold={canonicalCurrent ? canonicalCurrent.env === 'TC' : undefined}
        coldBakeWarning={coldBakeMsg}
        onAdjust={() => dispatch({ type: 'NAV', view: 'rotta' })}
        maturationMessage={
          alertRes.level === 'APPROACHING' ? `Quasi pronto · tra ~${fmtDuration(readyInH)}`
          : alertRes.level === 'SWEET_SPOT' ? `Pronto per infornare · ${windowStr}`
          : undefined}
      />

      {/* annuncio per screen reader dei cambi di stato che contano */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{statusAnnouncement}</div>

      {/* ── MODAL COLLASSO (non dismissibile — solo "Termina" o "Continua") ── */}
      {showCollapseModal && (
        <CollapseModal
          message={alertRes.message}
          onEnd={() => dispatch({ type: 'SESSION_END' })}
          onContinue={ackCollapse}
        />
      )}

      {/* ── MODAL FUORI-PROTOCOLLO (advisory + conferma — v2.4.19 A2) ── */}
      {showOutOfProtocolModal && (
        <OutOfProtocolModal
          styleLabel={STYLE_LABELS[session.style] ?? session.style}
          ambientTempC={ambientTempC}
          protocolLabel={String(styleProfile.protocollo_preferito ?? 'ta_only')}
          onConfirm={() => confirmOutOfProtocol(true)}
          onStayTA={() => confirmOutOfProtocol(false)}
        />
      )}

      <div className="pm4-stack" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 0' }}>

        {/* ── MODE TOGGLE — Monitor · Analisi (R5) ── */}
        <div role="group" aria-label="Modalità dashboard"
          style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--pm4-line-strong)' }}>
          {(['monitor', 'analisi'] as const).map((m) => (
            <button key={m}
              onClick={() => { setDashMode(m); try { localStorage.setItem('pm-dashMode', m); } catch {} }}
              aria-pressed={dashMode === m}
              style={{
                flex: 1, minHeight: 44, padding: '9px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase', fontFamily: 'var(--font-mono)', cursor: 'pointer',
                border: 'none', borderRight: m === 'monitor' ? '1px solid var(--pm4-line-strong)' : 'none',
                background: dashMode === m ? 'rgba(255,180,80,0.1)' : 'transparent',
                color: dashMode === m ? 'var(--pm4-ember-lo)' : 'var(--pm4-faint)',
              }}>
              {m === 'monitor' ? '◉ Monitor' : '⊞ Analisi'}
            </button>
          ))}
        </div>

        {/* ── ZONA 1 — SEMAFORO ── */}
        <ChannelLabel idx="01" name="Stato" help={HELP_STATO} />
        {primarySignal === 'maturation' && (
          <>
            <SemaforoCard label="Pronto per infornare" value={etaValue} sub={etaSub}
              state={matState} color={SEMAFORO_COLORS[matState]} progress={enzymaticMatPct / threshold * 100}
              footnote={matFootnote} />
            <SecondaryRowCard><SecondaryRow pH={pH} leaveningPct={leaveningPct} W={W_current} /></SecondaryRowCard>
          </>
        )}
        {primarySignal === 'dual' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <SemaforoCard half label="MATURAZ." value={`${enzymaticMatPct.toFixed(1)}%`}
                state={matIndep} color={SEMAFORO_COLORS[matIndep]} progress={enzymaticMatPct} target={threshold} caption="maturaz." />
              <SemaforoCard half label="STRUTTURA W" value={`W ${Math.round(W_current)}`}
                state={wState} color={SEMAFORO_COLORS[wState]} progress={(1 - tRatio) * 100} target={75} caption="glutine" />
            </div>
            <SecondaryRowCard><SecondaryRow pH={pH} leaveningPct={leaveningPct} /></SecondaryRowCard>
          </>
        )}
        {primarySignal === 'structural' && (
          <>
            <SemaforoCard label="STRUTTURA W" value={`W ${Math.round(W_current)}`}
              state={wState} color={SEMAFORO_COLORS[wState]} progress={(1 - tRatio) * 100} target={75} caption="forza glutinica" />
            <SecondaryRowCard><SecondaryRow matPct={enzymaticMatPct} pH={pH} leaveningPct={leaveningPct} /></SecondaryRowCard>
          </>
        )}

        {/* Quando inforno — per stili con segnale strutturale/duale l'eroe è la W */}
        {primarySignal !== 'maturation' && (
          <DarkCard>
            <div className="pm4-cell-k" style={{ textAlign: 'left' }}>Pronto per infornare</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <span style={{ color: isReady ? 'var(--pm4-green)' : 'var(--pm4-ember)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {etaValue}
              </span>
              <span style={{ color: 'var(--pm4-tan)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{etaSub}</span>
            </div>
          </DarkCard>
        )}

        {/* Cambio fase richiesto dalla timeline: conferma esplicita */}
        {pendingPhase && (
          <div className="pm4-panel" role="dialog" aria-label="Conferma cambio fase"
            style={{ padding: '13px 14px 14px', borderColor: 'rgba(255,140,50,0.45)' }}>
            <div style={{ color: 'var(--pm4-flour)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              Passi a {pendingPhase.label} ora?
            </div>
            {preview && (
              <div style={{ color: 'var(--pm4-tan)', fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.5, marginBottom: 12 }}>
                {preview.cutH > 0.05 && <>{preview.curLabel} accorciata di {fmtDuration(preview.cutH)}<br /></>}
                Cottura prevista {fmtClock(preview.bakeAfter)}
                {Math.abs(preview.bakeAfter.getTime() - preview.bakeBefore.getTime()) > 60_000 && <> invece di {fmtClock(preview.bakeBefore)}</>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => setPendingPhase(null)} className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>Annulla</button>
              <button onClick={confirmPhase} className="pm-btn-primary" style={BTN_PRIMARY}>Conferma</button>
            </div>
          </div>
        )}

        {dashMode === 'monitor' ? (
          /* Monitor: solo la timeline — no charts, no telemetria */
          <DarkCard style={{ padding: '13px 12px 8px' }}>
            <FermentationTimeline session={effectiveSession} currentSemaforoState={currentSemaforoState}
              onPhaseTransition={requestPhase} />
          </DarkCard>
        ) : (
          <>
            {/* ── ZONA 2 — STRUTTURA ── */}
            <DarkCard>
              <ChannelLabel idx="02" name="Forza del glutine (W)" help={HELP_GLUTINE} right={
                <span className="pm4-chan-tick" style={{ color: SEMAFORO_COLORS[wState], fontWeight: 700 }}>−{decayPct.toFixed(1)}%</span>
              } />
              <div style={{ display: 'flex', gap: 24, marginBottom: 6 }}>
                <div>
                  <div className="pm4-cell-k" style={{ textAlign: 'left' }}>W iniziale → ora</div>
                  <div style={{ color: 'var(--pm4-flour)', fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(W_initial)} <span style={{ color: 'var(--pm4-umber)' }}>→</span> {Math.round(W_current)}
                  </div>
                </div>
                <div>
                  <div className="pm4-cell-k" style={{ textAlign: 'left' }}>Usura glutine</div>
                  <div style={{ color: SEMAFORO_COLORS[wState], fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, textShadow: `0 0 14px ${SEMAFORO_COLORS[wState]}55` }}>
                    {(liveRatio * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <div style={{ color: 'var(--pm4-umber)', fontSize: 10, marginBottom: 8, letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
                {tCritHours - elapsedH > 0
                  ? `limite di stesura tra ~${fmtDuration(tCritHours - elapsedH)}`
                  : 'limite di stesura superato'} · pH {pH.toFixed(2)}
              </div>
              <MiniHillCurve W0={W_initial} tCrit={tCritHours} currentT={elapsedH} sessionDurationH={sessionDurationH} width={358} height={92} />
              {/* ── Sovra-lievitazione: collasso post-picco (separato dal Hill proteolitico) ── */}
              <CollapseReadout info={collapseInfo} ambientTempC={ambientTempC} />
            </DarkCard>

            {/* Temperature + slider T_amb */}
            <DarkCard>
              <ChannelLabel idx="03" name="Temperatura" help={HELP_TEMPERATURA} />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, margin: '2px 0 13px' }}>
                <div>
                  <div className="pm4-cell-k" style={{ textAlign: 'left' }}>T impasto</div>
                  <div style={{ color: 'var(--pm4-ember)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{T_dough.toFixed(1)}°</div>
                </div>
                <span style={{ color: 'var(--pm4-umber)', fontSize: 16, paddingBottom: 4 }}>→</span>
                <div>
                  <div className="pm4-cell-k" style={{ textAlign: 'left' }}>T ambiente</div>
                  <div style={{ color: 'var(--state-cold)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{ambientTempC.toFixed(1)}°</div>
                </div>
              </div>
              {/* Lo slider è un comando, non uno stato: nascosto finché non serve,
                  così uno scroll col pollice non cambia la temperatura. */}
              <button type="button" onClick={() => setShowTempEdit(v => !v)} aria-expanded={showTempEdit}
                className="pm4-btn pm4-btn-ghost" style={{ ...BTN_GHOST, flex: 'none', width: '100%', minHeight: 44, padding: '10px 13px', fontSize: 12, textAlign: 'left' }}>
                {showTempEdit ? '▾' : '▸'} Modifica T ambiente
              </button>
              {showTempEdit && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--pm4-faint)', letterSpacing: '0.08em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
                    <span>16°</span><span>T ambiente di servizio</span><span>32°</span>
                  </div>
                  <input type="range" min={16} max={32} step={0.5} value={ambientTempC}
                    onChange={e => setTempAmbient(Number(e.target.value))}
                    aria-label="Temperatura ambiente di servizio"
                    aria-valuetext={`${ambientTempC.toFixed(1)} gradi`}
                    style={{ width: '100%' }} />
                </div>
              )}
              <CoreTempAtBakeReadout coreTempAtBake={coreTempAtBake} />
            </DarkCard>

            {/* Prefermenti (condizionale) */}
            {session.prefermenti && session.prefermenti.length > 0 && (
              <Collapsible title={`PREFERMENTI · ${session.prefermenti.length}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {session.prefermenti.map((p: any, i: number) => (
                    <div key={p.id ?? i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      <span style={{ color: 'var(--pm4-ember-lo)', letterSpacing: '0.06em' }}>{(p.type ?? 'pref').toUpperCase()}</span>
                      <span style={{ color: 'var(--pm4-tan)' }}>
                        {p.flourFraction ?? 0}% farina · {p.hydration ?? '—'}% idr · {p.durationH ?? '—'}h
                      </span>
                    </div>
                  ))}
                </div>
              </Collapsible>
            )}

            {/* Container thermal (condizionale — fase fredda) */}
            {(phase === 'balled_fridge' || phase === 'bulk_fridge') && (
              <DarkCard>
                <ChannelLabel idx="·" name="Container · frigo" right={
                  <span className="pm4-chan-tick" style={{ color: 'var(--state-cold)', fontWeight: 700 }}>{(session.fridgeTempC ?? 4).toFixed(0)}°C</span>
                } />
                <div style={{ color: 'var(--pm4-tan)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  {(session.containerPreset ?? 'closed_box').replace(/_/g, ' ')} · inerzia termica attiva
                </div>
              </DarkCard>
            )}

            {/* ── ZONA 4 — GRAFICO + TIMELINE (tutte e 3 le viste da effectiveTimeline) ── */}
            <DarkCard style={{ padding: '13px 12px 4px' }}>
              <ChannelLabel idx="04" name="Andamento" />
              <GompertzChartV4
                key={`chart-${session.id}-${effectiveTimeline.find((s: any) => s.status === 'current')?.startElapsedH ?? 0}-${oopConfirmed ? 'tc' : 'ta'}`}
                session={effectiveSession} ts={ts} horizonH={horizonH}
              />
              <FermentationTimeline session={effectiveSession} currentSemaforoState={currentSemaforoState}
                onPhaseTransition={requestPhase} />
            </DarkCard>

            {/* ── PROFILO IMPASTO (collassabile) ── */}
            <Collapsible title="PROFILO IMPASTO">
              <QualityProfileCard session={session} ts={ts} />
            </Collapsible>
          </>
        )}

        <div style={{ height: 4 }} />
      </div>

      {/* ── FOOTER FISSO ── */}
      <footer style={{
        position: 'sticky', bottom: 0, zIndex: 20,
        background: 'linear-gradient(0deg, rgba(10,8,6,0.98), rgba(10,8,6,0.72))',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderTop: '1px solid var(--pm4-line)', padding: '13px 16px',
        paddingBottom: 'max(13px, env(safe-area-inset-bottom))',
      }}>
        {undo && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)' }}>
            <span style={{ flex: 1 }}>Fase cambiata: {undo.label}</span>
            <button onClick={undoPhase} className="pm4-btn pm4-btn-ghost" style={{ ...BTN_GHOST, flex: 'none', minHeight: 44, padding: '10px 14px', color: 'var(--pm4-ember-lo)' }}>
              ↶ Annulla
            </button>
          </div>
        )}
        {askOutcome ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ color: 'var(--pm4-flour)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              Com'è venuta? La sessione va nello Storico.
            </div>
            <div role="group" aria-label="Esito della cottura" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
              {OUTCOMES.map(o => (
                <button key={o.value} onClick={() => finishWithOutcome(o.value)}
                  className="pm4-btn pm4-btn-ghost" style={{ ...BTN_GHOST, minHeight: 44, padding: '10px 4px', fontSize: 12 }}>
                  {o.label}
                </button>
              ))}
            </div>
            <button onClick={() => setAskOutcome(false)} className="pm4-btn pm4-btn-ghost"
              style={{ ...BTN_GHOST, flex: 'none', minHeight: 44 }}>
              ← Non ancora
            </button>
          </div>
        ) : confirmEnd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ color: 'var(--pm4-flour)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Terminare la sessione? Verrà salvata nello Storico.
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => setConfirmEnd(false)}
                className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>
                ← Annulla
              </button>
              <button onClick={() => dispatch({ type: 'SESSION_END' })}
                className="pm4-btn pm4-btn-warm" style={BTN_DANGER}>
                ■ Termina
              </button>
            </div>
          </div>
        ) : isReady ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <button onClick={() => setAskOutcome(true)} className="pm-btn-primary" style={{ ...BTN_PRIMARY, minHeight: 52, fontSize: 15 }}>
              🍕 Ho infornato
            </button>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => dispatch({ type: 'NAV', view: 'forno' })}
                className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>
                Forno
              </button>
              <button onClick={() => setConfirmEnd(true)}
                className="pm4-btn pm4-btn-danger-quiet" style={BTN_DANGER_QUIET}>
                Termina
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={() => dispatch({ type: 'NAV', view: 'rotta' })}
              className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>
              ⚙ Aggiusta Rotta
            </button>
            <button onClick={() => dispatch({ type: 'NAV', view: 'forno' })}
              className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>
              Forno
            </button>
            <button onClick={() => setConfirmEnd(true)}
              className="pm4-btn pm4-btn-danger-quiet" style={BTN_DANGER_QUIET}>
              ■ Termina sessione
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

// Stili pulsanti footer (warm)
const BTN_GHOST: React.CSSProperties = {
  flex: 1, background: 'rgba(255,255,255,0.04)', color: 'var(--pm4-tan)',
  border: '1px solid var(--pm4-line-strong)', borderRadius: 9, padding: 13, minHeight: 44,
  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', cursor: 'pointer',
};
// L'uscita è distruttiva ma non è l'azione del momento: contorno rosato, il
// pieno caldo resta alla conferma.
const BTN_DANGER_QUIET: React.CSSProperties = {
  ...BTN_GHOST, color: 'var(--state-critical)', border: '1px solid rgba(255,118,117,0.35)',
};
const BTN_PRIMARY: React.CSSProperties = {
  flex: 1, background: 'var(--accent-brand)', color: 'var(--bg-primary)',
  border: 'none', borderRadius: 9, padding: 13, minHeight: 44,
  fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', cursor: 'pointer',
};
const BTN_DANGER: React.CSSProperties = {
  flex: 1, background: 'linear-gradient(180deg, #e0463f, #b3231d)', color: '#fff',
  border: 'none', borderRadius: 9, padding: 13,
  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', cursor: 'pointer',
  boxShadow: '0 6px 18px -8px rgba(214,48,49,0.6)',
};

// Wrapper pannello per la SecondaryRow (pannello strumento sottile)
function SecondaryRowCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="pm4-panel" style={{ padding: '9px 8px' }}>
      {children}
    </div>
  );
}
