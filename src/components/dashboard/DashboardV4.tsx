/**
 * PizzaMatrix — Dashboard v4 (VIEW B — Monitor Fermentazione)
 * Layout mobile-first, dark theme, semaforo adattivo per stile.
 * Coesiste con DashboardView (v2.4) — riusa GompertzChart + QualityProfileCard.
 *
 * Adattata alle API reali del progetto:
 *  - dati live da state.tickState (two-clock) anziché da un hook che ritorna metriche
 *  - T_amb modificata via setTempAmbient() (aggiorna anche la ThermalTimeline)
 *  - W strutturale da computeDashboardEffectiveW (tRatio/tCritHours per la curva Hill)
 */
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useTickEngine } from '../../hooks/useTickEngine';
import {
  getStyleProfile, computeStyleAwareAlertLevel, computeDashboardEffectiveW,
  computeCurrentPH,
} from '../../engine';
import type { DashboardWResult, AlertLevelResult } from '../../engine';
import { simulateTimeline } from '../../engine/serviceWindowSolver';
import { makeLeavAduRateAt, computeCollapseETA, type CollapseETAResult } from '../../engine/collapse';
import { GompertzChart, QualityProfileCard } from './DashboardView';
import { MiniHillCurve } from '../shared/MiniHillCurve';
import { FermentationTimeline } from './FermentationTimeline';
import { SemaforoCard, SEMAFORO_COLORS, CollapseModal, type SemaforoState } from './SemaforoCard';
import { LiveHeader } from './LiveHeader';

// ─── Stato semaforo da alertLevel / tRatio ────────────────────────────────────
function matSemaforoFromLevel(level: string, matPct: number, threshold: number): SemaforoState {
  if (level === 'STRUCTURAL_COLLAPSED') return 'COLLAPSED';
  if (level === 'STRUCTURAL_CRITICAL')  return 'CRITICAL';
  if (level === 'SWEET_SPOT') return 'OK';
  const ratio = threshold > 0 ? matPct / threshold : 0;
  if (level === 'APPROACHING' || level === 'STRUCTURAL_WARNING') {
    if (level === 'APPROACHING' && ratio < 0.3) return 'TOO_EARLY';
    return 'WARNING';
  }
  return ratio < 0.3 ? 'TOO_EARLY' : 'OK';
}

function matStateIndependent(matPct: number, threshold: number): SemaforoState {
  const r = threshold > 0 ? matPct / threshold : 0;
  if (r < 0.3) return 'TOO_EARLY';
  if (matPct >= threshold) return 'OK';
  if (r >= 0.90) return 'WARNING';
  return 'OK';
}

function wStateFromRatio(tRatio: number): SemaforoState {
  if (tRatio < 0.30)  return 'TOO_EARLY';
  if (tRatio < 0.75)  return 'OK';
  if (tRatio < 0.85)  return 'WARNING';
  if (tRatio < 1.05)  return 'CRITICAL';
  return 'COLLAPSED';
}

const SEVERITY: Record<SemaforoState, number> = {
  TOO_EARLY: 0, OK: 1, WARNING: 2, CRITICAL: 3, COLLAPSED: 4,
};
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
function ChannelLabel({ idx, name, tick, right }: {
  idx: string; name: string; tick?: string; right?: React.ReactNode;
}) {
  return (
    <div className="pm4-chan">
      <span className="pm4-chan-idx">{idx}</span>
      <span className="pm4-chan-name">{name}</span>
      <span className="pm4-chan-rule" />
      {right ?? (tick ? <span className="pm4-chan-tick">{tick}</span> : null)}
    </div>
  );
}

function SecondaryRow({ pH, leaveningPct, W, matPct }: {
  pH?: number; leaveningPct?: number; W?: number; matPct?: number;
}) {
  const items: Array<{ label: string; value: React.ReactNode; color: string }> = [];
  if (matPct != null)       items.push({ label: 'MATUR.',  value: <>{matPct.toFixed(1)}<small>%</small></>,      color: 'var(--accent-brand)' });
  if (leaveningPct != null) items.push({ label: 'LIEVIT.', value: <>{leaveningPct.toFixed(1)}<small>%</small></>, color: 'var(--pm4-green)' });
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
      <div onClick={() => setOpen(o => !o)}
        style={{ padding: '13px 14px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', alignItems: 'center' }}>
        <span style={{ color: 'var(--pm4-tan)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{title}</span>
        <span style={{ color: 'var(--pm4-ember)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>
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
    label = 'sotto-proof · nessuna sbollatura prevista';
  } else if (info.collapseTime == null || info.marginH == null) {
    label = `picco oltre la finestra · stabile a ${ambientTempC.toFixed(0)}°C`;
    color = 'var(--pm4-green)';
  } else {
    const m = info.marginH;
    color = m < 1 ? '#ff7675' : m < 3 ? '#ffd166' : 'var(--pm4-tan)';
    label = `sbollatura +${m.toFixed(1)}h dopo il picco @ ${ambientTempC.toFixed(0)}°C`;
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

// ─── Component principale ──────────────────────────────────────────────────────
export function DashboardV4() {
  const { state, dispatch } = useApp();
  const { setTempAmbient, setPhase } = useTickEngine();
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Permette all'utente di ignorare il modal COLLAPSED e continuare a monitorare
  const [collapseAcknowledged, setCollapseAcknowledged] = useState(false);

  const session = state.activeSession;
  const ts = state.tickState;

  // R4: l'ack del collasso è persistito per-sessione (sessionStorage) così il
  // modal NON riappare dopo navigazione/remount per chi è già consapevole.
  useEffect(() => {
    if (!session) return;
    setCollapseAcknowledged(sessionStorage.getItem(`pm-collapseAck:${session.id}`) === '1');
  }, [session?.id]);
  const ackCollapse = () => {
    setCollapseAcknowledged(true);
    if (session) sessionStorage.setItem(`pm-collapseAck:${session.id}`, '1');
  };

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
      });
      return computeCollapseETA({
        trajectory: sim.samples, bubbleThresholdPct, leavAduRateAt,
      }) as CollapseETAResult;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  if (!session || !derived) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0a0a0a' }}>
        <span style={{ color: '#6b7280', fontFamily: 'monospace' }}>Nessuna sessione attiva</span>
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
  const remainingH = Math.max(0, (targetBake.getTime() - Date.now()) / 3_600_000);
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
      />

      {/* ── MODAL COLLASSO (non dismissibile — solo "Termina" o "Continua") ── */}
      {showCollapseModal && (
        <CollapseModal
          message={alertRes.message}
          onEnd={() => dispatch({ type: 'SESSION_END' })}
          onContinue={ackCollapse}
        />
      )}

      <div className="pm4-stack" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 0' }}>

        {/* ── ZONA 1 — SEMAFORO ── */}
        <ChannelLabel idx="01" name="Stato · 2-clock" />
        {primarySignal === 'maturation' && (
          <>
            <SemaforoCard label="MATURAZIONE ENZIMATICA" value={`${enzymaticMatPct.toFixed(1)}%`}
              state={matState} color={SEMAFORO_COLORS[matState]} progress={enzymaticMatPct} target={threshold} />
            <SecondaryRowCard><SecondaryRow pH={pH} leaveningPct={leaveningPct} W={W_current} /></SecondaryRowCard>
          </>
        )}
        {primarySignal === 'dual' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <SemaforoCard half label="MATURAZ." value={`${enzymaticMatPct.toFixed(1)}%`}
                state={matIndep} color={SEMAFORO_COLORS[matIndep]} progress={enzymaticMatPct} target={threshold} />
              <SemaforoCard half label="STRUTTURA W" value={`W ${Math.round(W_current)}`}
                state={wState} color={SEMAFORO_COLORS[wState]} progress={(1 - tRatio) * 100} target={75} />
            </div>
            <SecondaryRowCard><SecondaryRow pH={pH} leaveningPct={leaveningPct} /></SecondaryRowCard>
          </>
        )}
        {primarySignal === 'structural' && (
          <>
            <SemaforoCard label="STRUTTURA W" value={`W ${Math.round(W_current)}`}
              state={wState} color={SEMAFORO_COLORS[wState]} progress={(1 - tRatio) * 100} target={75} />
            <SecondaryRowCard><SecondaryRow matPct={enzymaticMatPct} pH={pH} leaveningPct={leaveningPct} /></SecondaryRowCard>
          </>
        )}

        {/* Sweet Spot */}
        <DarkCard>
          <ChannelLabel idx="·" name="Sweet spot" right={
            <span className="pm4-chan-tick" style={{ color: 'var(--pm4-green)', border: '1px solid rgba(61,220,151,0.4)', borderRadius: 5, padding: '2px 7px' }}>
              target {threshold}%
            </span>
          } />
          <div style={{ display: 'flex', gap: 28 }}>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>Al target cottura</div>
              <div className="pm4-glow-ember" style={{ color: 'var(--pm4-ember)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {remainingH.toFixed(1)}<span style={{ fontSize: 12, color: 'var(--pm4-umber)' }}>h</span>
              </div>
            </div>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>Maturazione target</div>
              <div style={{ color: 'var(--pm4-ember-lo)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {threshold}<span style={{ fontSize: 12, color: 'var(--pm4-umber)' }}>%</span>
              </div>
            </div>
          </div>
        </DarkCard>

        {/* ── ZONA 2 — STRUTTURA ── */}
        <DarkCard>
          <ChannelLabel idx="02" name="Struttura · decad. W" right={
            <span className="pm4-chan-tick" style={{ color: SEMAFORO_COLORS[wState], fontWeight: 700 }}>−{decayPct.toFixed(1)}%</span>
          } />
          <div style={{ display: 'flex', gap: 24, marginBottom: 6 }}>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>W₀ → W</div>
              <div style={{ color: 'var(--pm4-flour)', fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(W_initial)} <span style={{ color: 'var(--pm4-umber)' }}>→</span> {Math.round(W_current)}
              </div>
            </div>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>t / t_crit</div>
              <div style={{ color: SEMAFORO_COLORS[wState], fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, textShadow: `0 0 14px ${SEMAFORO_COLORS[wState]}55` }}>
                {(liveRatio * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          <div style={{ color: 'var(--pm4-umber)', fontSize: 9, marginBottom: 8, letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
            t/t_crit {(liveRatio * 100).toFixed(0)}% · t_crit {Math.round(tCritHours)}h · pH {pH.toFixed(2)}
          </div>
          <MiniHillCurve W0={W_initial} tCrit={tCritHours} currentT={elapsedH} sessionDurationH={sessionDurationH} width={358} height={92} />
          {/* ── Sovra-lievitazione: collasso post-picco (separato dal Hill proteolitico) ── */}
          <CollapseReadout info={collapseInfo} ambientTempC={ambientTempC} />
        </DarkCard>

        {/* Temperature + slider T_amb */}
        <DarkCard>
          <ChannelLabel idx="03" name="Termica · cuore impasto" tick="Newton τ" />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, margin: '2px 0 13px' }}>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>T impasto</div>
              <div className="pm4-glow-ember" style={{ color: 'var(--pm4-ember)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{T_dough.toFixed(1)}°</div>
            </div>
            <span style={{ color: 'var(--pm4-umber)', fontSize: 16, paddingBottom: 4 }}>→</span>
            <div>
              <div className="pm4-cell-k" style={{ textAlign: 'left' }}>T ambiente</div>
              <div style={{ color: 'var(--state-cold)', fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{ambientTempC.toFixed(1)}°</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--pm4-faint)', letterSpacing: '0.08em', marginBottom: 7, fontFamily: 'var(--font-mono)' }}>
            <span>16°</span><span>T ambiente di servizio</span><span>32°</span>
          </div>
          <input type="range" min={16} max={32} step={0.5} value={ambientTempC}
            onChange={e => setTempAmbient(Number(e.target.value))}
            aria-label="Temperatura ambiente di servizio"
            aria-valuetext={`${ambientTempC.toFixed(1)} gradi`}
            style={{ width: '100%', height: 22, borderRadius: 11, background: 'linear-gradient(90deg, var(--state-cold), var(--accent-brand))' }} />
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

        {/* ── ZONA 3 — GRAFICO + TIMELINE ── */}
        <DarkCard style={{ padding: '13px 12px 4px' }}>
          <ChannelLabel idx="04" name="Curve & cronologia" />
          <GompertzChart
            key={`chart-${session.id}-${session.thermalTimeline?.find((s: any) => s.status === 'current')?.startElapsedH ?? 0}`}
            session={session} ts={ts}
          />
          <FermentationTimeline session={session} currentSemaforoState={currentSemaforoState}
            onPhaseTransition={(p) => setPhase(p, { enforceForward: true })} />
        </DarkCard>

        {/* ── PROFILO IMPASTO (collassabile) ── */}
        <Collapsible title="PROFILO IMPASTO">
          <QualityProfileCard session={session} ts={ts} />
        </Collapsible>

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
        {confirmEnd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ color: '#ff9c9a', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              ⚠ Terminare la sessione? I dati NON saranno salvati.
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => dispatch({ type: 'SESSION_END' })}
                className="pm4-btn pm4-btn-warm" style={BTN_DANGER}>
                ■ Conferma
              </button>
              <button onClick={() => setConfirmEnd(false)}
                className="pm4-btn pm4-btn-ghost" style={BTN_GHOST}>
                ← Annulla
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
              className="pm4-btn pm4-btn-warm" style={BTN_DANGER}>
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
  border: '1px solid var(--pm4-line-strong)', borderRadius: 9, padding: 13,
  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', cursor: 'pointer',
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
