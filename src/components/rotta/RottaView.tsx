/**
 * PizzaMatrix — RottaView (Aggiusta Rotta)
 * Modifica in corsa: T_amb, frigo, durate, soglia alert. In cima la risposta
 * (quando inforni, prima e dopo); i numeri del modello stanno nei dettagli.
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, S, SliderInput, fmtHours, speakHours } from '../ui';
import { kEffective, sweetSpotMaturation, findAduAt, ENZYMATIC_CLOCK_PARAMS, getStyleProfile } from '../../engine';
import { resolveThreshold } from '../../lib/bakeReadiness';
import { buildInitialTimeline, db } from '../../db/db';
import { retimeTimeline, seedPhase, timelineEndH, type DurationKey } from '../../lib/timeline';
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
  const [localT, setLocalT]               = useState(ts?.tempAmbient ?? seedPhase(session).tempAmbient);
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

  // Ritmo relativo a 25°C: adesso (T ambiente della sessione) contro la T proposta.
  const tAmbNow  = ts?.tempAmbient ?? seedPhase(session).tempAmbient;
  const kAt      = (t: number) => (kEffective as Function)(t, session.agentEaKj, session.agentType) as number;
  const kRef     = kAt(25);
  const kRatioCurr = kRef > 0 ? kAt(tAmbNow) / kRef : 0;
  const kRatioNew  = kRef > 0 ? kAt(localT) / kRef : 0;
  const speedDelta = kRatioCurr > 0 ? ((kRatioNew / kRatioCurr) - 1) * 100 : 0;

  // Picco di maturazione (orologio enzimatico two-clock): ADU enzimatico integrato
  // reale (ts.enzymaticAdu), NON l'ADU lievito né l'offset prefermento.
  const enzAdu = (() => {
    if (ts?.enzymaticAdu != null) return ts.enzymaticAdu;
    const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;  // pre-tick fallback
    return matOffsetPct > 0
      ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
      : 0;
  })();
  const spot = (threshold: number, tC: number) => {
    try { return (sweetSpotMaturation as Function)({ ...session, alertThreshold: threshold }, enzAdu, tC) as any; }
    catch { return null; }
  };
  const spotBase = useMemo(() => spot(sessionThreshold, tAmbNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, enzAdu, tAmbNow, sessionThreshold]);
  const spotNew = useMemo(() => spot(localThreshold, localT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, enzAdu, localT, localThreshold]);

  // A temperatura ambiente l'orario lo decide la maturazione, non le durate.
  const readyMs = (sp: any) => sp && Number.isFinite(sp.hoursUntilPeak)
    ? Date.now() + Math.max(0, sp.hoursUntilPeak) * 3_600_000 : null;
  const bakeBeforeMs = isTcProto ? oldBakeMs : readyMs(spotBase);
  const bakeAfterMs  = isTcProto ? newBakeAt.getTime() : readyMs(spotNew);
  const bakeMoved = bakeBeforeMs != null && bakeAfterMs != null && Math.abs(bakeAfterMs - bakeBeforeMs) >= 60_000;

  // Il frigo che lo spostamento allunga o accorcia: la durata che ne risulta.
  const fridgeIdx = (() => {
    const segs = baseTimeline.slice().sort((a, b) => a.startElapsedH - b.startElapsedH);
    const i = segs.reduce((acc, sg, k) => (sg.status !== 'completed' && /fridge/.test(sg.phaseType) ? k : acc), -1);
    return i;
  })();
  const segDur = (tl: typeof baseTimeline, i: number) => {
    const sg = tl.slice().sort((a, b) => a.startElapsedH - b.startElapsedH)[i];
    return sg ? Math.max(0, (sg.endElapsedH ?? sg.startElapsedH) - sg.startElapsedH) : null;
  };
  const fridgeBefore = fridgeIdx >= 0 ? segDur(baseTimeline, fridgeIdx) : null;
  const fridgeAfter  = fridgeIdx >= 0 ? segDur(newTimeline, fridgeIdx) : null;

  const thresholdChanged = localThreshold !== sessionThreshold;
  const dirty = Object.keys(changes).length > 0 || thresholdChanged || localT !== tAmbNow
    || (isTcProto && (bakeShiftH !== 0 || localFridgeT !== (session.fridgeTempC ?? 4)));

  const apply = () => {
    if (!dirty) return;
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

  const mono = { fontFamily: 'var(--font-mono)' } as const;
  const valueStyle = (color: string) => ({ ...mono, fontSize: '0.9rem', fontWeight: 700, color });
  const note = { ...mono, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 } as const;

  const tempCard = (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <label htmlFor="rotta-tamb" style={S.label}>Temperatura ambiente</label>
        <span style={valueStyle('var(--text-primary)')}>{localT}°C</span>
      </div>
      <input
        id="rotta-tamb" type="range" min={10} max={38} step={0.5}
        value={localT} aria-valuetext={`${localT}°C`}
        onChange={e => setLocalT(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent-brand)', marginBottom: 10 }}
      />
      <div style={note} aria-live="polite">
        {Math.abs(speedDelta) < 0.5
          ? <>Stesso ritmo di adesso ({tAmbNow}°C).</>
          : <>Matura il <strong style={{ color: speedDelta > 0 ? 'var(--state-optimal-lo)' : 'var(--state-cold)' }}>{Math.abs(speedDelta).toFixed(0)}% più {speedDelta > 0 ? 'in fretta' : 'piano'}</strong> che a {tAmbNow}°C.</>}
      </div>
    </Card>
  );

  const durationSliders = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(proto === 'ta' || proto === 'tc_appreto') && (
        <SliderInput label="Puntata TA" value={localPuntataH} onChange={setLocalPuntataH}
          min={1} max={24} step={0.5} unit="h" color="var(--text-primary)" />
      )}
      {/* tc / tc_puntata: il frigo è la puntata (stessa durata di "Sposta la cottura") */}
      {(proto === 'tc' || proto === 'tc_puntata') && (
        <SliderInput label="Puntata TC (frigo)" value={localTcH} onChange={setLocalTcH}
          min={1} max={72} step={1} unit="h" color="var(--state-cold)" />
      )}
      <SliderInput label="Staglio" value={localStaglioH} onChange={setLocalStaglioH}
        min={0.1} max={3} step={0.1} unit="h" color="var(--text-primary)" />
      {(proto === 'ta' || proto === 'tc_puntata') && (
        <SliderInput label="Appretto TA" value={localApprettoH} onChange={setLocalApprettoH}
          min={0.5} max={12} step={0.5} unit="h" color="var(--text-primary)" />
      )}
      {proto === 'tc_appreto' && (
        <SliderInput label="Appretto TC (frigo)" value={localTcH} onChange={setLocalTcH}
          min={1} max={48} step={1} unit="h" color="var(--state-cold)" />
      )}
    </div>
  );

  const thresholdCard = (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <label htmlFor="rotta-soglia" style={S.label}>Soglia alert maturazione</label>
        <span style={valueStyle('var(--text-primary)')}>{localThreshold}%</span>
      </div>
      <input
        id="rotta-soglia" type="range" min={60} max={98} step={1}
        value={localThreshold} aria-valuetext={`${localThreshold}%`}
        onChange={e => setThreshold(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent-brand)', marginBottom: 8 }}
      />
      <div style={note}>La maturazione a cui l'impasto è pronto da infornare.</div>
    </Card>
  );

  const statusIt = (st?: string) => st === 'past_peak' ? 'picco passato' : st === 'upcoming' ? 'prima del picco' : '';
  const peakLine = (sp: any, tC: number) => !sp || !Number.isFinite(sp.hoursUntilPeak) ? '—'
    : sp.hoursUntilPeak > 0 ? `a ${tC}°C: tra ${fmtHours(sp.hoursUntilPeak)}${statusIt(sp.status) ? ` (${statusIt(sp.status)})` : ''}`
    : `a ${tC}°C: in finestra`;

  // il triangolo nativo resta: dice che si apre
  const summaryStyle = { ...S.label, padding: '14px 0', margin: '-14px 0', cursor: 'pointer' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Riepilogo sessione corrente */}
      <Card style={{ padding: '12px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Metric label="Maturazione" value={`${(ts?.maturationPct ?? 0).toFixed(0)}%`} />
          <Metric label="T impasto"   value={`${(ts?.tempDough ?? 22).toFixed(1)}°C`} />
          <Metric label="Agente"      value={AGENT_SHORT[session.agentType] ?? session.agentLabel} />
        </div>
      </Card>

      {/* ── La risposta: quando inforni, prima e dopo le modifiche ── */}
      <Card>
        <div style={{ ...S.label, marginBottom: 8 }}>Inforni alle</div>
        <div aria-live="polite">
          <div style={{ ...mono, fontSize: 35, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-0.03em', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {bakeAfterMs != null ? fmtBakeClock(bakeAfterMs) : '—'}
          </div>
          <div style={{ ...note, marginTop: 10 }}>
            {bakeMoved
              ? <>prima {fmtBakeClock(bakeBeforeMs!)} · {bakeAfterMs! > bakeBeforeMs! ? '+' : '−'}{fmtHours(Math.abs(bakeAfterMs! - bakeBeforeMs!) / 3_600_000)}</>
              : 'nessuna modifica all\'orario'}
            {isTcProto
              ? <> · secondo il piano</>
              : <> · con {localT}°C e maturazione al {localThreshold}%</>}
          </div>
        </div>
      </Card>

      {isTcProto ? (
        <>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <label htmlFor="rotta-shift" style={S.label}>Sposta la cottura</label>
              <span style={valueStyle(bakeShiftH !== 0 ? 'var(--accent-warning)' : 'var(--text-muted)')}>
                {bakeShiftH === 0 ? '0' : `${bakeShiftH > 0 ? '+' : '−'}${fmtHours(Math.abs(bakeShiftH))}`}
              </span>
            </div>
            <input
              id="rotta-shift" type="range" min={-6} max={24} step={0.5}
              value={bakeShiftH} aria-valuetext={bakeShiftH === 0 ? 'nessuno spostamento' : `${bakeShiftH > 0 ? 'più' : 'meno'} ${speakHours(Math.abs(bakeShiftH))}`}
              onChange={e => setBakeShiftH(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-warning)', marginBottom: 10 }}
            />
            <div style={note} aria-live="polite">
              {fridgeBefore != null && fridgeAfter != null
                ? <>In frigo: {Math.abs(fridgeAfter - fridgeBefore) >= 1 / 60
                    ? <>{fmtHours(fridgeBefore)} → <strong style={{ color: 'var(--state-cold)' }}>{fmtHours(fridgeAfter)}</strong></>
                    : fmtHours(fridgeBefore)}. Allunga o accorcia il frigo: lì l'impasto regge.</>
                : <>Allunga o accorcia l'ultima fase.</>}
            </div>
          </Card>
          {tempCard}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <label htmlFor="rotta-tfrigo" style={S.label}>Temperatura frigo</label>
              <span style={valueStyle('var(--state-cold)')}>{localFridgeT}°C</span>
            </div>
            <input
              id="rotta-tfrigo" type="range" min={1} max={8} step={0.5}
              value={localFridgeT} aria-valuetext={`${localFridgeT}°C`}
              onChange={e => setLocalFridgeT(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--state-cold)', marginBottom: 8 }}
            />
            <div style={note}>Cambia il ritmo della maturazione nelle fasi in frigo.</div>
          </Card>
          <Card>
            <div style={{ ...S.label, marginBottom: 12 }}>Durate delle fasi</div>
            {durationSliders}
          </Card>
          {thresholdCard}
        </>
      ) : (
        <>
          {tempCard}
          {thresholdCard}
          {/* In TA le durate non spostano l'orario: restano a portata, ma chiuse. */}
          <Card>
            <details>
              <summary style={summaryStyle}>Durate delle fasi</summary>
              <div style={{ ...note, margin: '4px 0 14px' }}>
                Non spostano l'orario di cottura: servono per la timeline e i promemoria delle fasi.
              </div>
              {durationSliders}
            </details>
          </Card>
        </>
      )}

      {/* ── I numeri del modello, per chi li vuole ── */}
      <Card>
        <details>
          <summary style={summaryStyle}>Dettagli del modello</summary>
          <div style={{ ...note, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div>Ritmo (kRatio, rif. 25°C): {kRatioCurr.toFixed(3)} a {tAmbNow}°C → {kRatioNew.toFixed(3)} a {localT}°C</div>
            <div>Picco di maturazione {peakLine(spotNew, localT)}</div>
            {isTcProto && <div>kRatio in frigo a {localFridgeT}°C ≈ {(kAt(localFridgeT) / kRef).toFixed(4)}</div>}
          </div>
        </details>
      </Card>

      {/* ── Azioni: sempre a portata, anche con la pagina lunga ── */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 20,
        margin: '0 calc(-1 * var(--padding-h))', padding: '13px var(--padding-h)',
        paddingBottom: 'max(13px, env(safe-area-inset-bottom))',
        background: 'linear-gradient(0deg, rgba(10,8,6,0.98), rgba(10,8,6,0.72))',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderTop: '1px solid var(--pm4-line)',
        display: 'flex', gap: 10,
      }}>
        <button onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })} className="pm-btn-secondary" style={{
          flex: 1, minHeight: 44, background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)',
          border: '1px solid var(--pm4-line-strong)', borderRadius: 'var(--radius-md)',
          ...mono, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
        }}>
          ← Annulla
        </button>
        <button onClick={apply} disabled={!dirty} className="pm-btn-primary" style={{
          flex: 2, minHeight: 44, background: 'var(--accent-brand)', color: '#0a0806',
          border: 'none', borderRadius: 'var(--radius-md)', padding: '0 14px',
          ...mono, fontWeight: 700, fontSize: '0.9rem',
          cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.38,
        }}>
          {dirty ? '✓ Applica modifiche' : 'Nessuna modifica'}
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
      minHeight: '100dvh', padding: '24px var(--padding-h) 0',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })}
          aria-label="Torna alla dashboard"
          style={{ minWidth: 44, minHeight: 44, margin: '-10px 0 -10px -12px', background: 'none', border: 'none', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem', cursor: 'pointer' }}
        >
          ←
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Aggiusta rotta
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
