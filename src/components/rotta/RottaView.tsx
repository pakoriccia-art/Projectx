/**
 * PizzaMatrix — RottaView (Aggiusta Rotta)
 * Modifica in corsa: T_amb, tcHours, target cottura, soglia alert.
 * Mostra preview impatto kRatio sul ritmo di maturazione.
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, S, SliderInput } from '../ui';
import { kEffective, sweetSpotMaturation, findAduAt, ENZYMATIC_CLOCK_PARAMS } from '../../engine';

const AGENT_SHORT: Record<string, string> = {
  fresh_yeast:       'LBF',
  instant_dry_yeast: 'IDY',
  sourdough_wheat:   'LM',
};

// ─── Contenuto (session garantita non-null) ───────────────────────────────────
function RottaContent() {
  const { state, dispatch } = useApp();
  const session = state.activeSession!;
  const ts      = state.tickState;

  // Stato locale (prima di applicare)
  const [localT, setLocalT]               = useState(ts?.tempAmbient ?? 22);
  const [localTcH, setLocalTcH]           = useState(session.tcHours ?? 0);
  const [localFridgeT, setLocalFridgeT]   = useState(session.fridgeTempC ?? 4);
  const [localThreshold, setThreshold]    = useState(session.alertThreshold ?? 85);
  const [bakeShiftH, setBakeShiftH]       = useState(0);
  const [localPuntataH,  setLocalPuntataH]  = useState(session.puntataH  ?? 8);
  const [localStaglioH,  setLocalStaglioH]  = useState(session.staglioH  ?? 0.5);
  const [localApprettoH, setLocalApprettoH] = useState(session.apprettoH ?? 4);

  const proto = session.apprettoProtocol ?? 'ta';
  const isTcProto = proto !== 'ta';

  const targetBake = session.targetBakeAt instanceof Date
    ? session.targetBakeAt
    : new Date(session.targetBakeAt ?? Date.now() + 86_400_000);

  const newBakeAt = new Date(targetBake.getTime() + bakeShiftH * 3_600_000);

  // Preview kRatio (velocità relativa a 25°C ref)
  const kRef     = (kEffective as Function)(25, session.agentEaKj, session.agentType) as number;
  const kCurrent = (kEffective as Function)(ts?.tempDough ?? localT, session.agentEaKj, session.agentType) as number;
  const kNew     = (kEffective as Function)(localT, session.agentEaKj, session.agentType) as number;

  const kRatioCurr = kRef > 0 ? kCurrent / kRef : 0;
  const kRatioNew  = kRef > 0 ? kNew / kRef : 0;
  const speedDelta = kRatioCurr > 0 ? ((kRatioNew / kRatioCurr) - 1) * 100 : 0;

  // Sweet spot preview: ore al PICCO DI MATURAZIONE (orologio enzimatico two-clock)
  // con T corrente vs T proposta. Usa l'ADU enzimatico integrato reale (ts.enzymaticAdu),
  // NON l'ADU lievito né l'offset prefermento — quello seminava la lievitazione (bug risolto).
  const enzAdu = (() => {
    if (ts?.enzymaticAdu != null) return ts.enzymaticAdu;
    const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;  // pre-tick fallback
    return matOffsetPct > 0
      ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
      : 0;
  })();
  const spotCurr = useMemo(() => {
    try { return (sweetSpotMaturation as Function)(session, enzAdu, ts?.tempAmbient ?? 22) as any; }
    catch { return null; }
  }, [session, enzAdu, ts?.tempAmbient]);
  const spotNew = useMemo(() => {
    try { return (sweetSpotMaturation as Function)(session, enzAdu, localT) as any; }
    catch { return null; }
  }, [session, enzAdu, localT]);

  const apply = () => {
    dispatch({ type: 'TICK',           patch: { tempAmbient: localT } as any });
    dispatch({ type: 'SESSION_UPDATE', patch: {
      tcHours:        isTcProto ? localTcH : undefined,
      fridgeTempC:    isTcProto ? localFridgeT : undefined,
      puntataH:       localPuntataH,
      staglioH:       localStaglioH,
      apprettoH:      localApprettoH,
      alertThreshold: localThreshold,
      targetBakeAt:   newBakeAt,
    }});
    dispatch({ type: 'NAV', view: 'dashboard' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Riepilogo sessione corrente */}
      <Card style={{ padding: '12px 16px', background: 'rgba(255,140,50,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Metric label="Maturazione" value={`${(ts?.maturationPct ?? 0).toFixed(0)}%`} color="var(--accent-brand)" />
          <Metric label="T impasto"   value={`${(ts?.tempDough ?? 22).toFixed(1)}°C`} />
          <Metric label="Agente"      value={AGENT_SHORT[session.agentType] ?? session.agentLabel} />
        </div>
      </Card>

      {/* ── T Ambiente ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <span style={S.label}>Temperatura ambiente</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--accent-brand)' }}>
            {localT}°C
          </span>
        </div>
        <input
          type="range" min={-2} max={40} step={0.5}
          value={localT}
          onChange={e => setLocalT(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent-brand)', marginBottom: 12 }}
        />
        {/* Preview velocità */}
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            kRatio attuale: <strong style={{ color: 'var(--text-secondary)' }}>{kRatioCurr.toFixed(3)}</strong>
            &nbsp;→ nuovo: <strong style={{ color: 'var(--accent-brand)' }}>{kRatioNew.toFixed(3)}</strong>
          </span>
          <span style={{
            color: speedDelta > 0 ? 'var(--state-optimal-lo)' : speedDelta < 0 ? 'var(--state-cold)' : 'var(--text-muted)',
            fontWeight: 700,
          }}>
            {speedDelta > 0 ? '+' : ''}{speedDelta.toFixed(1)}%
          </span>
        </div>
      </Card>

      {/* ── Sweet spot preview ── */}
      {(spotCurr || spotNew) && (
        <Card style={{ padding: '12px 16px', background: 'rgba(0,184,148,0.05)' }}>
          <div style={{ ...S.label, marginBottom: 10 }}>Effetto sul picco di maturazione</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: 10 }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                T attuale — {(ts?.tempAmbient ?? localT).toFixed(1)}°C
              </div>
              {spotCurr ? (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {Number.isFinite(spotCurr.hoursUntilPeak) && spotCurr.hoursUntilPeak > 0
                      ? `+${spotCurr.hoursUntilPeak.toFixed(1)}h`
                      : 'In finestra'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {spotCurr.status ?? ''}
                  </div>
                </>
              ) : <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>—</div>}
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                T proposta — {localT.toFixed(1)}°C
              </div>
              {spotNew ? (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent-brand)' }}>
                    {Number.isFinite(spotNew.hoursUntilPeak) && spotNew.hoursUntilPeak > 0
                      ? `+${spotNew.hoursUntilPeak.toFixed(1)}h`
                      : 'In finestra'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {spotNew.status ?? ''}
                  </div>
                </>
              ) : <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>—</div>}
            </div>
          </div>
          {spotCurr && spotNew &&
            Number.isFinite(spotCurr.hoursUntilPeak) &&
            Number.isFinite(spotNew.hoursUntilPeak) && (
            <div style={{
              marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)',
              fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Δ picco con nuova T</span>
              <span style={{
                fontWeight: 700,
                color: spotNew.hoursUntilPeak - spotCurr.hoursUntilPeak > 0
                  ? 'var(--state-cold)'
                  : spotNew.hoursUntilPeak - spotCurr.hoursUntilPeak < 0
                  ? 'var(--state-optimal-lo)'
                  : 'var(--text-muted)',
              }}>
                {spotNew.hoursUntilPeak - spotCurr.hoursUntilPeak > 0 ? '+' : ''}
                {(spotNew.hoursUntilPeak - spotCurr.hoursUntilPeak).toFixed(1)}h
              </span>
            </div>
          )}
        </Card>
      )}

      {/* ── Slittamento cottura ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <span style={S.label}>Slittamento target cottura</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: bakeShiftH !== 0 ? 'var(--accent-warning)' : 'var(--text-muted)' }}>
            {bakeShiftH > 0 ? '+' : ''}{bakeShiftH}h
          </span>
        </div>
        <input
          type="range" min={-6} max={24} step={0.5}
          value={bakeShiftH}
          onChange={e => setBakeShiftH(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent-warning)', marginBottom: 10 }}
        />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Nuova cottura: <strong style={{ color: 'var(--text-primary)' }}>
            {newBakeAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
            {' '}
            {newBakeAt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
          </strong>
        </div>
      </Card>

      {/* ── Freddo in corsa (solo protocolli TC) ── */}
      {isTcProto && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span style={S.label}>Freddo in corsa (TC)</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-cold)' }}>
              {localTcH > 0 ? `${localTcH}h` : 'disattivo'}
            </span>
          </div>
          <input
            type="range" min={0} max={72} step={1}
            value={localTcH}
            onChange={e => setLocalTcH(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--state-cold)', marginBottom: 8 }}
          />
          {localTcH > 0 && (
            <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              kRatio a {localFridgeT}°C ≈ {((kEffective as Function)(localFridgeT, session.agentEaKj, session.agentType) as number / kRef).toFixed(4)}
              {' '}— rallentamento fisiologico
            </div>
          )}
        </Card>
      )}

      {/* ── Durate fasi ── */}
      <Card>
        <div style={{ ...S.label, marginBottom: 12 }}>Durate fasi</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Puntata TA — per protocolli 'ta' e 'tc_appreto' */}
          {(proto === 'ta' || proto === 'tc_appreto') && (
            <SliderInput label="Puntata TA" value={localPuntataH} onChange={setLocalPuntataH}
              min={1} max={24} step={0.5} unit="h" color="var(--accent-brand)" />
          )}
          {/* Puntata TC — per protocolli 'tc' e 'tc_puntata' (usa localTcH) */}
          {(proto === 'tc' || proto === 'tc_puntata') && (
            <SliderInput label="Puntata TC (frigo)" value={localTcH} onChange={setLocalTcH}
              min={1} max={72} step={1} unit="h" color="var(--state-cold)" />
          )}
          {/* Staglio — sempre visibile */}
          <SliderInput label="Staglio" value={localStaglioH} onChange={setLocalStaglioH}
            min={0.1} max={3} step={0.1} unit="h" color="var(--text-muted)" />
          {/* Appretto TA — per protocolli 'ta' e 'tc_puntata' */}
          {(proto === 'ta' || proto === 'tc_puntata') && (
            <SliderInput label="Appretto TA" value={localApprettoH} onChange={setLocalApprettoH}
              min={0.5} max={12} step={0.5} unit="h" color="var(--accent-brand)" />
          )}
          {/* Appretto TC — per protocollo 'tc_appreto' (usa localTcH) */}
          {proto === 'tc_appreto' && (
            <SliderInput label="Appretto TC (frigo)" value={localTcH} onChange={setLocalTcH}
              min={1} max={48} step={1} unit="h" color="var(--state-cold)" />
          )}
        </div>
      </Card>

      {/* ── Temperatura frigo (solo protocolli TC) ── */}
      {isTcProto && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span style={S.label}>Temperatura frigo</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-cold)' }}>
              {localFridgeT}°C
            </span>
          </div>
          <input
            type="range" min={1} max={8} step={0.5}
            value={localFridgeT}
            onChange={e => setLocalFridgeT(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--state-cold)', marginBottom: 8 }}
          />
          <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            Aggiorna la curva Gompertz nei segmenti a freddo
          </div>
        </Card>
      )}

      {/* ── Soglia alert ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <span style={S.label}>Soglia alert maturazione</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-optimal-hi)' }}>
            {localThreshold}%
          </span>
        </div>
        <input
          type="range" min={60} max={98} step={1}
          value={localThreshold}
          onChange={e => setThreshold(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--state-optimal-hi)' }}
        />
      </Card>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <button onClick={apply} style={{
          background: 'var(--accent-brand)', color: '#0a0806',
          border: 'none', borderRadius: 'var(--radius-md)',
          padding: '14px 20px', fontFamily: 'var(--font-mono)',
          fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
        }}>
          ✓ Applica modifiche
        </button>
        <button onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })} style={{
          background: 'transparent', color: 'var(--text-secondary)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 'var(--radius-md)',
          padding: '13px 20px', fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem', cursor: 'pointer',
        }}>
          ← Annulla
        </button>
      </div>
    </div>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────
export function RottaView() {
  const { state, dispatch } = useApp();

  return (
    <div style={{
      minHeight: '100dvh', padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })}
          style={{ background: 'none', border: 'none', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer' }}
        >
          ←
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Aggiusta Rotta
        </h2>
      </div>

      {state.activeSession
        ? <RottaContent />
        : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Nessuna sessione attiva
          </div>
        )
      }
    </div>
  );
}
