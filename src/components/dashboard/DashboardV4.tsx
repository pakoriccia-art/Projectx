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
import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTickEngine } from '../../hooks/useTickEngine';
import {
  getStyleProfile, computeStyleAwareAlertLevel, computeDashboardEffectiveW,
  computeCurrentPH,
} from '../../engine';
import { GompertzChart, QualityProfileCard } from './DashboardView';
import { MiniHillCurve } from '../shared/MiniHillCurve';
import { FermentationTimeline } from './FermentationTimeline';
import { SemaforoCard, SEMAFORO_COLORS, type SemaforoState } from './SemaforoCard';

// ─── Stato semaforo da alertLevel / tRatio ────────────────────────────────────
function matSemaforoFromLevel(level: string, matPct: number, threshold: number): SemaforoState {
  if (level === 'STRUCTURAL_CRITICAL' || level === 'STRUCTURAL_COLLAPSED') return 'CRITICAL';
  if (level === 'SWEET_SPOT') return 'OK';
  const ratio = threshold > 0 ? matPct / threshold : 0;
  if (level === 'APPROACHING' || level === 'STRUCTURAL_WARNING') {
    if (level === 'APPROACHING' && ratio < 0.3) return 'TOO_EARLY';
    return 'WARNING';
  }
  // level === 'OK'
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
  if (tRatio < 0.3)  return 'TOO_EARLY';
  if (tRatio < 0.65) return 'OK';
  if (tRatio < 0.85) return 'WARNING';
  return 'CRITICAL';
}

const SEVERITY: Record<SemaforoState, number> = { TOO_EARLY: 0, OK: 1, WARNING: 2, CRITICAL: 3 };
function moreSevere(a: SemaforoState, b: SemaforoState): SemaforoState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// ─── Banner alert (mappa livello → presentazione) ─────────────────────────────
const BANNER_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  COLLAPSE: { bg: '#450a0a', border: '#7f1d1d', color: '#fca5a5' },
  CRITICAL: { bg: '#1f0a0a', border: '#ef4444', color: '#ef4444' },
  ADVISORY: { bg: '#1c1605', border: '#eab308', color: '#eab308' },
  INFO:     { bg: '#06201c', border: '#14b8a6', color: '#5eead4' },
};

function bannerKindFor(level: string): keyof typeof BANNER_STYLE | null {
  switch (level) {
    case 'STRUCTURAL_COLLAPSED': return 'COLLAPSE';
    case 'STRUCTURAL_CRITICAL':  return 'CRITICAL';
    case 'STRUCTURAL_WARNING':   return 'ADVISORY';
    case 'SWEET_SPOT':           return 'INFO';
    default:                     return null;
  }
}

// ─── Card generica dark ───────────────────────────────────────────────────────
function DarkCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#111111', border: '1px solid #1f2937', borderRadius: 10, padding: '14px 16px', ...style }}>
      {children}
    </div>
  );
}

function SecondaryRow({ pH, leaveningPct, W, matPct }: {
  pH?: number; leaveningPct?: number; W?: number; matPct?: number;
}) {
  const items: Array<{ label: string; value: string; color: string }> = [];
  if (matPct != null)      items.push({ label: 'MATURAZ.', value: `${matPct.toFixed(1)}%`, color: '#eab308' });
  if (leaveningPct != null) items.push({ label: 'LIEVITAZ.', value: `${leaveningPct.toFixed(1)}%`, color: '#f97316' });
  if (pH != null)          items.push({ label: 'pH',       value: pH.toFixed(2),         color: '#60a5fa' });
  if (W != null)           items.push({ label: 'W',        value: `${Math.round(W)}`,    color: '#9ca3af' });
  return (
    <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ color: '#4b5563', fontSize: 9, letterSpacing: '0.08em' }}>{it.label}</div>
          <div style={{ color: it.color, fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Sezione collassabile ─────────────────────────────────────────────────────
function Collapsible({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: '#111111', border: '1px solid #1f2937', borderRadius: 10 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', alignItems: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>{title}</span>
        <span style={{ color: '#4b5563', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
}

// ─── Component principale ──────────────────────────────────────────────────────
export function DashboardV4() {
  const { state, dispatch } = useApp();
  const { setTempAmbient, setPhase } = useTickEngine();
  const [now, setNow] = useState(new Date());
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = state.activeSession;
  const ts = state.tickState;

  // Dati derivati (memoizzati su tick) — hook chiamato sempre, anche senza sessione
  const derived = useMemo(() => {
    if (!session) return null;
    const styleProfile = getStyleProfile(session.style);
    const enzymaticMatPct = ts?.maturationPct ?? (session.initialMaturationOffset ?? 0) * 100;
    const leaveningPct = ts?.leaveningPct ?? 0;
    const ambientTempC = ts?.tempAmbient ?? session.tLaboratorio ?? 22;
    const T_dough = ts?.tempDough ?? ambientTempC;
    // pH da leavAdu (orologio fermentazione) — v2.4.11 §2.6.1
    const pH = (computeCurrentPH as Function)(
      session.initialPH ?? 5.8,
      ts?.cumulativeAdu ?? 0,
      session.agentType,
    ) as number;

    const wRes = (computeDashboardEffectiveW as Function)(
      session, ts?.cumulativeAdu ?? 0, T_dough, pH,
    ) as {
      W_current: number; W_initial: number; decayPct: number;
      tRatio: number; tCritHours: number; structuralStatus: string;
    };

    const alertRes = (computeStyleAwareAlertLevel as Function)(
      session, enzymaticMatPct, wRes.W_current, wRes.W_initial, leaveningPct,
    ) as { level: string; message: string };

    return { styleProfile, enzymaticMatPct, leaveningPct, ambientTempC, T_dough, pH, wRes, alertRes };
  }, [session, ts]);

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

  const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const elapsedH = Math.max(0, (now.getTime() - startedAt.getTime()) / 3_600_000);
  // Ratio mostrato dal vivo (coincide con la posizione del dot Hill = elapsedH)
  const liveRatio = tCritHours > 0 ? elapsedH / tCritHours : 0;
  const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date(session.targetBakeAt ?? Date.now() + 86_400_000);
  const remainingH = Math.max(0, (targetBake.getTime() - now.getTime()) / 3_600_000);

  const phase = ts?.phase ?? 'bulk_room';
  const phaseLabel: Record<string, string> = {
    bulk_room: 'Puntata TA', bulk_fridge: 'Puntata TC',
    balled_room: 'Staglio', balled_fridge: 'Appretto TC',
    proofing: 'Lievitazione', baking: 'Cottura',
  };

  // Stati semaforo
  const matState = matSemaforoFromLevel(alertRes.level, enzymaticMatPct, threshold);
  const wState   = wStateFromRatio(tRatio);
  const matIndep = matStateIndependent(enzymaticMatPct, threshold);
  const currentSemaforoState: SemaforoState =
    primarySignal === 'structural' ? wState
    : primarySignal === 'dual'     ? moreSevere(matIndep, wState)
    : matState;

  const banner = bannerKindFor(alertRes.level);

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a0a', maxWidth: 430, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>

      {/* ── HEADER FISSO ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: '#0a0a0a', borderBottom: '1px solid #1f2937', padding: '12px 18px' }}>
        <div style={{ color: '#f9fafb', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
          PizzaMatrix · {session.style?.toUpperCase()} · {session.totalFlourGrams}g
        </div>
        <div style={{ color: '#6b7280', fontSize: 10, marginTop: 3, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
          {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {phaseLabel[phase] ?? phase} · +{elapsedH.toFixed(1)}h · {remainingH > 0 ? `${remainingH.toFixed(1)}h rimaste` : '🍕 cottura'}
        </div>
      </header>

      {/* ── BANNER ALERT ── */}
      {banner && (
        <div style={{
          background: BANNER_STYLE[banner].bg, borderBottom: `1px solid ${BANNER_STYLE[banner].border}`,
          padding: '10px 18px', color: BANNER_STYLE[banner].color, fontSize: 12, fontFamily: 'monospace',
        }}>
          {banner === 'COLLAPSE' ? '⛔' : banner === 'CRITICAL' ? '⚠' : banner === 'ADVISORY' ? '⚠' : 'ℹ'} {alertRes.message}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 14px 0' }}>

        {/* ── ZONA 1 — SEMAFORO ── */}
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
        <DarkCard style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>SWEET SPOT</span>
            <span style={{ color: '#14b8a6', fontSize: 9, border: '1px solid #14b8a6', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' }}>
              target {threshold}%
            </span>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9, letterSpacing: '0.06em' }}>AL TARGET COTTURA</div>
              <div style={{ color: '#f97316', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{remainingH.toFixed(1)}h</div>
            </div>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9, letterSpacing: '0.06em' }}>MATURAZIONE TARGET</div>
              <div style={{ color: '#eab308', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{threshold}%</div>
            </div>
          </div>
        </DarkCard>

        {/* ── ZONA 2 — STRUTTURA ── */}
        <DarkCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>STRUTTURA · DECADIMENTO W</span>
            <span style={{ color: SEMAFORO_COLORS[wState], fontSize: 10, fontFamily: 'monospace' }}>
              -{decayPct.toFixed(1)}%
            </span>
          </div>
          <div style={{ display: 'flex', gap: 18, marginBottom: 6 }}>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9 }}>W₀ → W</div>
              <div style={{ color: '#9ca3af', fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
                {Math.round(W_initial)} → {Math.round(W_current)}
              </div>
            </div>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9 }}>t / t_crit</div>
              <div style={{ color: SEMAFORO_COLORS[wState], fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
                {(liveRatio * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          <MiniHillCurve W0={W_initial} tCrit={tCritHours} currentT={elapsedH} width={398} height={96} />
        </DarkCard>

        {/* Temperature + slider T_amb */}
        <DarkCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>TEMPERATURE</span>
            <span style={{ color: '#14b8a6', fontSize: 9 }}>Modifica T_amb</span>
          </div>
          <div style={{ display: 'flex', gap: 24, margin: '10px 0' }}>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9 }}>T IMPASTO</div>
              <div style={{ color: '#60a5fa', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{T_dough.toFixed(1)}°C</div>
            </div>
            <div>
              <div style={{ color: '#4b5563', fontSize: 9 }}>T AMBIENTE</div>
              <div style={{ color: '#9ca3af', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{ambientTempC.toFixed(1)}°C</div>
            </div>
          </div>
          <input type="range" min={16} max={32} step={0.5} value={ambientTempC}
            onChange={e => setTempAmbient(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#60a5fa' }} />
        </DarkCard>

        {/* Prefermenti (condizionale) */}
        {session.prefermenti && session.prefermenti.length > 0 && (
          <Collapsible title={`PREFERMENTI · ${session.prefermenti.length}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {session.prefermenti.map((p: any, i: number) => (
                <div key={p.id ?? i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 11 }}>
                  <span style={{ color: '#9ca3af' }}>{(p.type ?? 'pref').toUpperCase()}</span>
                  <span style={{ color: '#6b7280' }}>
                    {p.flourFraction ?? 0}% farina · {p.hydration ?? '—'}% idr · {p.durationH ?? '—'}h
                  </span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Container thermal (condizionale — fase fredda) */}
        {(phase === 'balled_fridge' || phase === 'bulk_fridge') && (
          <DarkCard style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>CONTAINER · FRIGO</span>
              <span style={{ color: '#60a5fa', fontSize: 11, fontFamily: 'monospace' }}>
                {(session.fridgeTempC ?? 4).toFixed(0)}°C
              </span>
            </div>
            <div style={{ color: '#6b7280', fontSize: 11, fontFamily: 'monospace', marginTop: 6 }}>
              {(session.containerPreset ?? 'closed_box').replace(/_/g, ' ')} · inerzia termica attiva
            </div>
          </DarkCard>
        )}

        {/* ── ZONA 3 — GRAFICO + TIMELINE ── */}
        <DarkCard style={{ padding: '12px 12px 4px' }}>
          <GompertzChart session={session} ts={ts} />
          <FermentationTimeline session={session} now={now} currentSemaforoState={currentSemaforoState}
            onPhaseTransition={(p) => setPhase(p)} />
        </DarkCard>

        {/* ── PROFILO IMPASTO (collassabile) ── */}
        <Collapsible title="PROFILO IMPASTO">
          <QualityProfileCard session={session} ts={ts} />
        </Collapsible>

        <div style={{ height: 4 }} />
      </div>

      {/* ── FOOTER FISSO ── */}
      <footer style={{ position: 'sticky', bottom: 0, background: '#0a0a0a', borderTop: '1px solid #1f2937', padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        {confirmEnd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#fca5a5', fontSize: 12, fontFamily: 'monospace' }}>
              ⚠ Terminare la sessione? I dati NON saranno salvati.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => dispatch({ type: 'SESSION_END' })}
                style={{ flex: 1, background: '#7f1d1d', color: '#f9fafb', border: 'none', borderRadius: 8, padding: 12, fontSize: 13, cursor: 'pointer' }}>
                ■ Conferma
              </button>
              <button onClick={() => setConfirmEnd(false)}
                style={{ flex: 1, background: '#1f2937', color: '#f9fafb', border: 'none', borderRadius: 8, padding: 12, fontSize: 13, cursor: 'pointer' }}>
                ← Annulla
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => dispatch({ type: 'NAV', view: 'rotta' })}
              style={{ flex: 1, background: '#1f2937', color: '#f9fafb', border: 'none', borderRadius: 8, padding: 12, fontSize: 13, cursor: 'pointer' }}>
              ⚙ Aggiusta Rotta
            </button>
            <button onClick={() => setConfirmEnd(true)}
              style={{ flex: 1, background: '#7f1d1d', color: '#f9fafb', border: 'none', borderRadius: 8, padding: 12, fontSize: 13, cursor: 'pointer' }}>
              ■ Termina sessione
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

// Wrapper card per la SecondaryRow (sfondo dark coerente)
function SecondaryRowCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1f2937', borderRadius: 10, padding: '8px 16px' }}>
      {children}
    </div>
  );
}
