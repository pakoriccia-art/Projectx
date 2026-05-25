/**
 * PizzaMatrix — Dashboard v2.4.0
 * Monitoraggio real-time fermentazione: ADU, maturationPct, W_current, pH, T_dough
 * Gompertz chart + sweet spot + alert feed + phase stepper
 */
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { useTickEngine } from '../../hooks/useTickEngine';
import {
  Card, Metric, Btn, ProgressBar, AlertBadge, S,
} from '../ui';
import {
  gompertz, sweetSpot, structuralState,
  computeAltitudeFactor, volumeMilestoneCorrection,
  maltAlertLevel,
} from '../../engine';

// ─── Clock ───────────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ─── Phase labels ─────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  bulk_room:    { label: 'Puntata – TA',   color: 'var(--accent-brand)' },
  bulk_fridge:  { label: 'Puntata – TC',   color: 'var(--state-cold)'   },
  balled_room:  { label: 'Appreto – TA',   color: 'var(--accent-brand)' },
  balled_fridge:{ label: 'Appreto – TC',   color: 'var(--state-cold)'   },
  proofing:     { label: 'Lievitazione',   color: 'var(--state-optimal-lo)' },
  baking:       { label: 'Cottura',        color: 'var(--accent-warning)' },
};

const PHASE_ORDER = ['bulk_room','bulk_fridge','balled_room','balled_fridge','proofing','baking'] as const;

// ─── Gompertz preview chart data ─────────────────────────────────────────────
function buildGompertzData(
  agentMuMax: number, agentLambda: number, agentAsymptote: number,
  totalH: number
) {
  const points: { h: number; pct: number; current?: boolean }[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const h = (i / steps) * Math.max(totalH * 1.5, 24);
    // Approximate ADU at each hour (at ref 25°C, kRatio=1): ADU ≈ h
    const adu = h;
    const pct = (gompertz as Function)(adu, agentMuMax, agentLambda, agentAsymptote) as number;
    points.push({ h: parseFloat(h.toFixed(2)), pct: parseFloat(pct.toFixed(1)) });
  }
  return points;
}

// ─── Sweet Spot Card ──────────────────────────────────────────────────────────
function SweetSpotCard({ session, ts }: { session: any; ts: any }) {
  const spot = useMemo(() => {
    try {
      return (sweetSpot as Function)(session, ts?.tempDough ?? 22) as {
        startH: number; endH: number; peakH: number; confidence: number;
      };
    } catch { return null; }
  }, [session, ts?.tempDough]);

  if (!spot) return null;
  const now = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const elapsed = (Date.now() - now.getTime()) / 3_600_000;
  const remaining = Math.max(0, spot.startH - elapsed);

  return (
    <Card elevated>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={S.label}>Sweet Spot</span>
        <span style={{
          fontSize: '0.68rem', fontFamily: 'var(--font-mono)',
          background: 'rgba(255,140,50,0.15)', color: 'var(--accent-brand)',
          borderRadius: 4, padding: '2px 6px',
        }}>
          conf. {(spot.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Metric label="Inizio" value={spot.startH.toFixed(1)} unit="h" color="var(--state-optimal-lo)" />
        <Metric label="Picco" value={spot.peakH.toFixed(1)} unit="h" color="var(--accent-brand)" />
        <Metric label="Fine" value={spot.endH.toFixed(1)} unit="h" color="var(--state-approaching)" />
      </div>
      {remaining > 0 && (
        <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          Mancano ~{remaining.toFixed(1)}h al sweet spot
        </div>
      )}
    </Card>
  );
}

// ─── Phase Stepper ────────────────────────────────────────────────────────────
function PhaseStepper({ currentPhase, onPhaseChange }: { currentPhase: string; onPhaseChange: (p: string) => void }) {
  return (
    <Card>
      <span style={{ ...S.label, display: 'block', marginBottom: 10 }}>Fase corrente</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PHASE_ORDER.map(p => {
          const info = PHASE_LABELS[p];
          const active = currentPhase === p;
          return (
            <button key={p} onClick={() => onPhaseChange(p)} style={{
              background: active ? info.color : 'var(--bg-elevated)',
              color: active ? '#0a0806' : 'var(--text-secondary)',
              border: active ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              fontWeight: active ? 700 : 400,
              cursor: 'pointer',
            }}>
              {info.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Structural W Card ────────────────────────────────────────────────────────
function WStructureCard({ ts, session }: { ts: any; session: any }) {
  const W0 = session.effectiveW_initial ?? 280;
  const Wcurr = ts?.W_current ?? W0;
  const decay = ((W0 - Wcurr) / W0) * 100;
  // structuralState(W0, W_current) → 'OK'|'WARNING'|'CRITICAL'|'COLLAPSED'
  const state = (structuralState as Function)(W0, Wcurr) as string;

  const stateColor =
    state === 'COLLAPSED' ? 'var(--state-collapsed)' :
    state === 'CRITICAL'  ? 'var(--state-critical)' :
    state === 'WARNING'   ? 'var(--accent-warning)' :
    'var(--state-optimal-hi)';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={S.label}>Struttura W</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: stateColor }}>
          {state}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Metric label="W₀" value={W0.toFixed(0)} color="var(--text-muted)" />
        <Metric label="W corrente" value={Wcurr.toFixed(0)} color={stateColor} />
        <Metric label="Decadimento" value={`${decay.toFixed(1)}%`}
          color={decay > 35 ? 'var(--state-critical)' : decay > 20 ? 'var(--accent-warning)' : 'var(--text-secondary)'} />
      </div>
      <div style={{ marginTop: 10 }}>
        <ProgressBar pct={100 - decay} color={stateColor} />
      </div>
    </Card>
  );
}

// ─── Temperature Card ─────────────────────────────────────────────────────────
function TempCard({ ts, setTempAmbient }: { ts: any; setTempAmbient: (t: number) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [tmpT, setTmpT] = useState(ts?.tempAmbient ?? 22);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <span style={S.label}>Temperature</span>
        <button onClick={() => setEditMode(e => !e)} style={{
          background: 'none', border: 'none', color: 'var(--accent-info)',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', cursor: 'pointer',
        }}>
          {editMode ? 'Salva' : 'Modifica T_amb'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Metric label="T impasto" value={(ts?.tempDough ?? 22).toFixed(1)} unit="°C" color="var(--accent-brand)" />
        <Metric label="T ambiente" value={(ts?.tempAmbient ?? 22).toFixed(1)} unit="°C" />
      </div>
      {editMode && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="range" min={-2} max={40} step={0.5}
            value={tmpT}
            onChange={e => setTmpT(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent-brand)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', minWidth: 40 }}>
            {tmpT}°C
          </span>
          <button onClick={() => { setTempAmbient(tmpT); setEditMode(false); }} style={{
            background: 'var(--accent-brand)', color: '#0a0806',
            border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px 12px', fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
          }}>OK</button>
        </div>
      )}
    </Card>
  );
}

// ─── Altitude correction card ─────────────────────────────────────────────────
function AltitudeCard({ altitudeM }: { altitudeM: number }) {
  if (!altitudeM || altitudeM < 100) return null;
  const factor = (computeAltitudeFactor as Function)(altitudeM) as number;
  const corrected = (volumeMilestoneCorrection as Function)(1.5, altitudeM) as number;
  return (
    <Card style={{ padding: '10px 14px', background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}>
      <span style={{ ...S.label, color: 'var(--pref-poolish)' }}>Correzione altitudine {altitudeM}m</span>
      <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        Fattore P: ×{factor.toFixed(3)} · Milestone vol. ×1.5 → {(corrected * 100).toFixed(0)}% bio
      </div>
    </Card>
  );
}

// ─── Alert Feed ───────────────────────────────────────────────────────────────
function AlertFeed({ alerts, onClear }: { alerts: any[]; onClear: () => void }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>Alert ({alerts.length})</span>
        <button onClick={onClear} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', cursor: 'pointer',
        }}>Pulisci</button>
      </div>
      {[...alerts].reverse().slice(0, 5).map(a => (
        <AlertBadge key={a.id} level={a.level} message={a.message} />
      ))}
    </div>
  );
}

// ─── Gompertz Chart ───────────────────────────────────────────────────────────
function GompertzChart({ session, ts }: { session: any; ts: any }) {
  const totalH = (session.puntataH ?? 8) + (session.staglioH ?? 0.5) + (session.apprettoH ?? 4) + (session.tcHours ?? 0);
  const data = useMemo(() =>
    buildGompertzData(session.agentMuMax, session.agentLambda, session.agentAsymptote ?? 100, totalH),
    [session.agentMuMax, session.agentLambda, session.agentAsymptote, totalH]
  );
  const elapsed = ts ? ts.elapsedH : 0;

  return (
    <Card>
      <span style={{ ...S.label, display: 'block', marginBottom: 10 }}>Curva Gompertz</span>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="h" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-muted)' }}
            label={{ value: 'h', position: 'insideBottomRight', offset: -4, fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 100]} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
            formatter={(v: number) => [`${v.toFixed(1)}%`, 'Maturazione']}
            labelFormatter={(l: number) => `t = ${l}h`}
          />
          <ReferenceLine x={elapsed} stroke="var(--accent-brand)" strokeDasharray="4 4"
            label={{ value: 'ora', position: 'top', fill: 'var(--accent-brand)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
          <ReferenceLine y={session.alertThreshold ?? 85} stroke="var(--state-optimal-hi)" strokeDasharray="4 4" />
          <ReferenceLine y={65} stroke="var(--state-optimal-lo)" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="pct" stroke="var(--accent-brand)" strokeWidth={2}
            dot={false} activeDot={{ r: 4, fill: 'var(--accent-brand)' }} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── Malt Badge ───────────────────────────────────────────────────────────────
function MaltBadge({ session }: { session: any }) {
  if (!session.malt) return null;
  const idx = session.effectiveAmylaseIndex ?? 1.0;
  const level = (maltAlertLevel as Function)(idx) as string;
  if (level === 'OK') return null;
  const colors: Record<string, string> = {
    ADVISORY: 'var(--accent-warning)',
    CRITICAL: 'var(--state-critical)',
    BLOCKED:  '#d63031',
  };
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 'var(--radius-sm)',
      background: `${colors[level]}18`, border: `1px solid ${colors[level]}44`,
      fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: colors[level],
    }}>
      ⚗ Malto: idx={idx.toFixed(3)} — {
        level === 'ADVISORY' ? 'Rischio destrinizzazione' :
        level === 'CRITICAL' ? 'Destrinizzazione probabile' :
        'Fuori range modello'
      }
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function DashboardView() {
  const { state, dispatch } = useApp();
  const { setTempAmbient, setPhase } = useTickEngine();
  const now = useClock();

  const session = state.activeSession;
  const ts = state.tickState;

  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Nessuna sessione attiva</span>
      </div>
    );
  }

  const matPct = ts?.maturationPct ?? 0;
  const phase = ts?.phase ?? 'bulk_room';
  const phaseInfo = PHASE_LABELS[phase] ?? { label: phase, color: 'var(--text-secondary)' };

  const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedH = elapsedMs / 3_600_000;
  const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date(session.targetBakeAt ?? Date.now() + 86400_000);
  const remainingH = Math.max(0, (targetBake.getTime() - now.getTime()) / 3_600_000);

  return (
    <div style={{ minHeight: '100dvh', padding: '20px var(--padding-h)', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            PizzaMatrix
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {session.style?.toUpperCase()} · {session.totalFlourGrams}g
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: phaseInfo.color }}>{phaseInfo.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            +{elapsedH.toFixed(1)}h · -{remainingH.toFixed(1)}h
          </div>
        </div>
      </div>

      {/* ── Hero Maturation ── */}
      <Card elevated>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
          <Metric
            label="Maturazione"
            value={matPct.toFixed(1)}
            unit="%"
            color={
              matPct >= 85 ? 'var(--state-optimal-hi)' :
              matPct >= 65 ? 'var(--state-optimal-lo)' :
              matPct >= 30 ? 'var(--state-approaching)' :
              'var(--state-underfermented)'
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Metric label="ADU" value={(ts?.cumulativeAdu ?? 0).toFixed(3)} color="var(--text-secondary)" />
            <Metric label="pH" value={(ts?.estimatedPH ?? 5.8).toFixed(2)} color="var(--accent-info)" />
          </div>
        </div>
        <ProgressBar pct={matPct} />
        {matPct >= 85 && (
          <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--state-optimal-hi)', fontFamily: 'var(--font-mono)' }}>
            ✓ Zona ottimale raggiunta
          </div>
        )}
      </Card>

      {/* ── Malt warning ── */}
      <MaltBadge session={session} />

      {/* ── Sweet Spot ── */}
      <SweetSpotCard session={session} ts={ts} />

      {/* ── W Structure ── */}
      <WStructureCard ts={ts} session={session} />

      {/* ── Gompertz Chart ── */}
      <GompertzChart session={session} ts={ts} />

      {/* ── Temperature ── */}
      <TempCard ts={ts} setTempAmbient={setTempAmbient} />

      {/* ── Altitude ── */}
      <AltitudeCard altitudeM={session.altitudeM ?? 0} />

      {/* ── Phase Stepper ── */}
      <PhaseStepper currentPhase={phase} onPhaseChange={setPhase} />

      {/* ── Alerts ── */}
      <AlertFeed alerts={state.alerts} onClear={() => dispatch({ type: 'ALERT_CLEAR' })} />

      {/* ── Actions ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: 'rotta' })}>
          🧭 Aggiusta Rotta
        </Btn>
        <Btn variant="danger" onClick={() => {
          if (confirm('Terminare la sessione corrente?')) dispatch({ type: 'SESSION_END' });
        }}>
          ■ Termina sessione
        </Btn>
      </div>

    </div>
  );
}
