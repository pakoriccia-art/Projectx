/**
 * PizzaMatrix — RottaView (Aggiusta Rotta)
 * Modifica in corsa: T_amb, tcHours, target cottura, soglia alert.
 * Mostra preview impatto kRatio sul ritmo di maturazione.
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, S, SliderInput } from '../ui';
import { kEffective, sweetSpotMaturation, findAduAt, ENZYMATIC_CLOCK_PARAMS, getStyleProfile } from '../../engine';
import { resolveThreshold } from '../../lib/bakeReadiness';
import { buildInitialTimeline, db } from '../../db/db';
import { retimeTimeline, timelineEndH, type DurationKey } from '../../lib/timeline';
import { fmtBakeClock } from '../../lib/bakeForecast';

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
  // la stessa soglia della dashboard: quella della sessione, altrimenti dello stile
  const sessionThreshold = resolveThreshold(session.alertThreshold, (getStyleProfile as Function)(session.style)?.alertThreshold);
  const [localThreshold, setThreshold]    = useState(sessionThreshold);
  const [bakeShiftH, setBakeShiftH]       = useState(0);
  const [localPuntataH,  setLocalPuntataH]  = useState(session.puntataH  ?? 8);
  const [localStaglioH,  setLocalStaglioH]  = useState(session.staglioH  ?? 0.5);
  const [localApprettoH, setLocalApprettoH] = useState(session.apprettoH ?? 4);

  const proto = session.apprettoProtocol ?? 'ta';
  const isTcProto = proto !== 'ta';

  // La cottura del piano è la fine della timeline (meno la finestra di servizio):
  // le durate e lo spostamento la ritemporizzano, la dashboard legge quella.
  const startMs = new Date(session.startedAt ?? Date.now()).getTime();
  const nowElapsedH = Math.max(0, (Date.now() - startMs) / 3_600_000);
  const serviceH = session.serviceWindowH ?? 0;
  const changes = useMemo(() => {
    const c: Partial<Record<DurationKey, number>> = {};
    if (localPuntataH  !== (session.puntataH  ?? 8))   c.puntataH  = localPuntataH;
    if (localStaglioH  !== (session.staglioH  ?? 0.5)) c.staglioH  = localStaglioH;
    if (localApprettoH !== (session.apprettoH ?? 4))   c.apprettoH = localApprettoH;
    if (isTcProto && localTcH !== (session.tcHours ?? 0)) c.tcHours = localTcH;
    return c;
  }, [localPuntataH, localStaglioH, localApprettoH, localTcH, isTcProto, session]);
  const baseTimeline = session.thermalTimeline ?? buildInitialTimeline(session as any);
  const newTimeline = useMemo(
    () => retimeTimeline(baseTimeline, changes, nowElapsedH, isTcProto ? bakeShiftH : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseTimeline, changes, bakeShiftH, isTcProto]);
  const planBakeMs = (tl: typeof baseTimeline) => startMs + (timelineEndH(tl) - serviceH) * 3_600_000;
  const oldBakeMs = planBakeMs(baseTimeline);
  const newBakeAt = new Date(planBakeMs(newTimeline));

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
    try { return (sweetSpotMaturation as Function)({ ...session, alertThreshold: localThreshold }, enzAdu, ts?.tempAmbient ?? 22) as any; }
    catch { return null; }
  }, [session, enzAdu, ts?.tempAmbient, localThreshold]);
  const spotNew = useMemo(() => {
    try { return (sweetSpotMaturation as Function)({ ...session, alertThreshold: localThreshold }, enzAdu, localT) as any; }
    catch { return null; }
  }, [session, enzAdu, localT, localThreshold]);

  // Ora del pronto a temperatura ambiente: la decide la maturazione, non le durate.
  const taReadyMs = spotNew && Number.isFinite(spotNew.hoursUntilPeak)
    ? Date.now() + Math.max(0, spotNew.hoursUntilPeak) * 3_600_000 : null;

  const apply = () => {
    const thresholdChanged = localThreshold !== sessionThreshold;
    const patch = {
      tcHours:        isTcProto ? localTcH : undefined,
      fridgeTempC:    isTcProto ? localFridgeT : undefined,
      puntataH:       localPuntataH,
      staglioH:       localStaglioH,
      apprettoH:      localApprettoH,
      alertThreshold: thresholdChanged ? localThreshold : session.alertThreshold,
      ...(thresholdChanged ? { alertThresholdFromPlan: false } : {}),
      thermalTimeline: newTimeline,
      bakeTargetElapsedH: timelineEndH(newTimeline),
      // il nuovo obiettivo è il piano ritemporizzato: niente "obiettivo −2h" fantasma
      ...(isTcProto ? { targetBakeAt: newBakeAt } : {}),
    };
    dispatch({ type: 'TICK',           patch: { tempAmbient: localT } as any });
    dispatch({ type: 'SESSION_UPDATE', patch });
    // subito nel DB: chiudendo l'app la rotta non si perde
    if (session.id != null) db.sessions.update(session.id, patch as any).catch(console.error);
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
          <label htmlFor="rotta-tamb" style={S.label}>Temperatura ambiente</label>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--accent-brand)' }}>
            {localT}°C
          </span>
        </div>
        <input
          id="rotta-tamb" type="range" min={-2} max={40} step={0.5}
          value={localT} aria-valuetext={`${localT}°C`}
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
            <div style={{ borderRight: '1px solid var(--pm4-line)', paddingRight: 10 }}>
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
              marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--pm4-line)',
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

      {/* ── Cottura ── */}
      {isTcProto ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <label htmlFor="rotta-shift" style={S.label}>Sposta la cottura</label>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: bakeShiftH !== 0 ? 'var(--accent-warning)' : 'var(--text-muted)' }}>
              {bakeShiftH > 0 ? '+' : ''}{bakeShiftH}h
            </span>
          </div>
          <input
            id="rotta-shift" type="range" min={-6} max={24} step={0.5}
            value={bakeShiftH} aria-valuetext={`${bakeShiftH > 0 ? 'più ' : bakeShiftH < 0 ? 'meno ' : ''}${Math.abs(bakeShiftH)} ore`}
            onChange={e => setBakeShiftH(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-warning)', marginBottom: 10 }}
          />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }} aria-live="polite">
            Cottura: <strong style={{ color: 'var(--text-primary)' }}>{fmtBakeClock(newBakeAt.getTime())}</strong>
            {Math.abs(newBakeAt.getTime() - oldBakeMs) >= 60_000 && <> · prima {fmtBakeClock(oldBakeMs)}</>}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
            Allunga o accorcia il frigo (o l'ultima fase): così si sposta l'infornata.
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ ...S.label, marginBottom: 8 }}>Cottura</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }} aria-live="polite">
            A temperatura ambiente l'orario lo decide la maturazione
            {taReadyMs != null ? <>: <strong style={{ color: 'var(--text-primary)' }}>{fmtBakeClock(taReadyMs)}</strong> con {localT}°C.</> : '.'}
            {' '}Per anticipare o ritardare cambia la temperatura.
          </div>
        </Card>
      )}

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
            value={localTcH} aria-label="Freddo in corsa (ore)" aria-valuetext={localTcH > 0 ? `${localTcH} ore` : 'disattivo'}
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
            <label htmlFor="rotta-tfrigo" style={S.label}>Temperatura frigo</label>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-cold)' }}>
              {localFridgeT}°C
            </span>
          </div>
          <input
            id="rotta-tfrigo" type="range" min={1} max={8} step={0.5}
            value={localFridgeT} aria-valuetext={`${localFridgeT}°C`}
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
          <label htmlFor="rotta-soglia" style={S.label}>Soglia alert maturazione</label>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--state-optimal-hi)' }}>
            {localThreshold}%
          </span>
        </div>
        <input
          id="rotta-soglia" type="range" min={60} max={98} step={1}
          value={localThreshold} aria-valuetext={`${localThreshold}%`}
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
          border: '1px solid var(--pm4-line-strong)',
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
