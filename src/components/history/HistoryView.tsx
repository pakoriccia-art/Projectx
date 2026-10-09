/**
 * PizzaMatrix — HistoryView (skin "Banco")
 * Storico sessioni caricate da Dexie (IndexedDB).
 * Ogni card racconta la sessione: inizio → infornata, pronta dalle, durata,
 * maturazione e usura W. Voto dato (e cambiato) dopo l'assaggio.
 * Eliminazione con conferma e annulla: il dato si cancella davvero solo dopo 10s.
 */
import { useState, useEffect, useRef } from 'react';
import { calendarDayDiff } from '../../lib/fmtTime';
import { bakedStoryText } from '../../lib/bakedStory';
import { useApp } from '../../context/AppContext';
import { loadSessionHistory, deleteSession, rateSession } from '../../services/sessionService';
import type { Session } from '../../db/db';

const AGENT_SHORT: Record<string, string> = {
  fresh_yeast:        'LBF',
  instant_dry_yeast:  'IDY',
  sourdough_wheat:    'LM',
};

const STYLE_LABELS: Record<string, string> = {
  napoletana: 'Napoletana', contemporanea: 'Contemporanea',
  teglia: 'Teglia', pala: 'Pala', nystyle: 'NY Style',
};

const OUTCOMES: Array<{ value: NonNullable<Session['outcomeRating']>; label: string }> = [
  { value: 'excellent', label: 'Ottima' },
  { value: 'good',      label: 'Buona' },
  { value: 'ok',        label: 'Ok' },
  { value: 'poor',      label: 'Da rivedere' },
];

const OUTCOME_LABEL: Record<string, string> = {
  excellent: 'ottima', good: 'buona', ok: 'ok', poor: 'da rivedere',
};

const STATUS_LABEL: Record<string, string> = {
  planning: 'pianificata', active: 'in corso', completed: 'completata', aborted: 'interrotta',
};

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

const RATING_SCORE: Record<string, number> = { excellent: 4, good: 3, ok: 2, poor: 1 };
const SCORE_LABEL = ['', 'da rivedere', 'ok', 'buona', 'ottima'];

/** Minuti tra "pronta" (primo PRONTO) e infornata reale; null se manca un dato. */
function bakeDelayMin(s: Session): number | null {
  if (!s.bakedAt || !s.readyAt) return null;
  return Math.round((new Date(s.bakedAt).getTime() - new Date(s.readyAt).getTime()) / 60_000);
}
const fmtDelay = (m: number) => m <= 1 ? 'subito' : m < 60 ? `+${m} min` : `+${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * Calibrazione minima per stile: quanto dopo il "pronto" inforni di solito e
 * come ti è venuta. Solo sessioni con infornata registrata.
 */
function Calibration({ sessions }: { sessions: Session[] }) {
  const byStyle = new Map<string, Session[]>();
  for (const s of sessions) {
    if (bakeDelayMin(s) == null) continue;
    const list = byStyle.get(s.style) ?? [];
    if (list.length < 5) list.push(s);
    byStyle.set(s.style, list);
  }
  const rows = [...byStyle.entries()].slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <section className="pm4-panel" aria-label="Come ti viene di solito" style={{ padding: '13px 14px 14px' }}>
      <div className="pm4-chan" style={{ marginBottom: 9 }}>
        <span className="pm4-chan-name">Come ti viene di solito</span>
        <span className="pm4-chan-rule" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([style, list]) => {
          const delays = list.map(bakeDelayMin).filter((m): m is number => m != null);
          const avg = Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
          const rated = list.filter(s => s.outcomeRating).map(s => RATING_SCORE[s.outcomeRating!]);
          const avgRating = rated.length ? SCORE_LABEL[Math.round(rated.reduce((a, b) => a + b, 0) / rated.length)] : null;
          return (
            <div key={style} style={{ ...MONO, fontSize: 12, color: 'var(--pm4-tan)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--pm4-flour)', fontWeight: 700 }}>
                {list.length === 1 ? 'Ultima' : `Ultime ${list.length}`} {STYLE_LABELS[style] ?? style}
              </span>
              {' · '}{avg <= 1 ? 'inforni appena è pronta' : `inforni in media ${fmtDelay(avg).slice(1)} dopo il pronto`}
              {avgRating && <> · voto medio {avgRating}</>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const hhmm = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
/** Orario con la data quando cade in un giorno diverso dall'inizio: 50 h di frigo non sembrano due ore. */
const clockFrom = (d: Date, start: Date) =>
  calendarDayDiff(d, start) === 0 ? hhmm(d) : `${hhmm(d)} ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;
function fmtDuration(h: number): string {
  const totalMin = Math.max(0, Math.round(h * 60));
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

const BTN: React.CSSProperties = {
  ...MONO, minHeight: 44, padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)', color: 'var(--pm4-tan)',
  border: '1px solid var(--pm4-line-strong)', fontSize: 12, fontWeight: 700,
};

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="pm4-cell">
      <div className="pm4-cell-k">{k}</div>
      <div className="pm4-cell-v" style={{ color: 'var(--pm4-flour)' }}>{v}</div>
    </div>
  );
}

function SessionCard({
  session, onDelete, onRate,
}: {
  session: Session;
  onDelete: (s: Session) => void;
  onRate: (id: number, rating: NonNullable<Session['outcomeRating']>) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteBtnRef    = useRef<HTMLButtonElement>(null);
  const changeRatingRef = useRef<HTMLButtonElement>(null);
  const firstRatingRef  = useRef<HTMLButtonElement>(null);
  // dove va il focus dopo che il comando premuto si è smontato
  const focusAfter = useRef<'delete' | 'change' | 'rating' | null>(null);
  useEffect(() => { if (confirmDelete) cancelDeleteRef.current?.focus(); }, [confirmDelete]);
  const [editRating, setEditRating] = useState(false);
  useEffect(() => {
    const t = focusAfter.current;
    if (!t) return;
    const el = t === 'delete' ? deleteBtnRef.current : t === 'change' ? changeRatingRef.current : firstRatingRef.current;
    if (el) { el.focus(); focusAfter.current = null; }
  });

  const start = session.startedAt instanceof Date
    ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const end = session.endedAt instanceof Date
    ? session.endedAt : session.endedAt ? new Date(session.endedAt) : null;
  const baked = session.bakedAt ? new Date(session.bakedAt) : null;
  const durationH = (baked ?? end) ? ((baked ?? end)!.getTime() - start.getTime()) / 3_600_000 : null;

  const W0 = session.effectiveW_initial ?? null;
  const Wf = session.effectiveW_current ?? null;
  const wWear = W0 && Wf != null ? Math.max(0, ((W0 - Wf) / W0) * 100) : null;
  const matPct = session.bakedMaturationPct ?? session.peakMaturation;
  const agent = AGENT_SHORT[session.agentType] ?? session.agentLabel;
  const styleName = STYLE_LABELS[session.style] ?? session.style ?? '—';
  const dateStr = start.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const showRating = session.status === 'completed' && session.id != null && (!session.outcomeRating || editRating);

  return (
    <article className="pm4-panel" data-session-id={session.id} tabIndex={-1} style={{ outline: 'none', padding: '13px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}
      aria-label={`${styleName}, ${dateStr}`}>
      {/* Titolo: stile · stato · esito */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--pm4-flour)' }}>
          {styleName}
        </h2>
        {/* completata e interrotta si distinguono per segno e colore, non solo per colore */}
        <span style={{ ...MONO, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: session.status === 'completed' ? 'var(--pm4-flour)' : 'var(--pm4-umber)' }}>
          {session.status === 'completed' ? '✓ ' : session.status === 'aborted' ? '■ ' : ''}
          {STATUS_LABEL[session.status] ?? session.status}
        </span>
        {session.outcomeRating && !editRating && (
          <button ref={changeRatingRef} type="button" onClick={() => { focusAfter.current = 'rating'; setEditRating(true); }}
            aria-label={`Esito: ${OUTCOME_LABEL[session.outcomeRating]}. Cambia voto`}
            style={{ ...BTN, padding: '6px 10px', fontSize: 12, color: 'var(--pm4-flour)' }}>
            🍕 {OUTCOME_LABEL[session.outcomeRating]} · cambia
          </button>
        )}
      </div>

      {/* Racconto: com'è andata, prima dei numeri */}
      <div style={{ ...MONO, fontSize: 12, color: 'var(--pm4-tan)', lineHeight: 1.5 }}>
        {dateStr} · {hhmm(start)}
        {baked && <> · <span style={{ color: 'var(--pm4-flour)' }}>Infornata {clockFrom(baked, start)}</span> · {bakedStoryText(session, d => clockFrom(d, start))}</>}
        {durationH != null && <> · {fmtDuration(durationH)}</>}
      </div>

      {/* Voto a posteriori: si dà dopo l'assaggio, e si può cambiare */}
      {showRating && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ ...MONO, fontSize: 13, color: 'var(--pm4-flour)', fontWeight: 700 }}>Com'è venuta?</div>
          <div role="group" aria-label="Esito della cottura" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && editRating) { e.preventDefault(); focusAfter.current = 'change'; setEditRating(false); }
            }}>
            {OUTCOMES.map((o, i) => (
              <button key={o.value} ref={i === 0 ? firstRatingRef : undefined} type="button" aria-pressed={session.outcomeRating === o.value}
                onClick={() => { focusAfter.current = 'change'; onRate(session.id!, o.value); setEditRating(false); }}
                className="pm4-btn pm4-btn-ghost"
                style={{ ...BTN, padding: '10px 4px', color: session.outcomeRating === o.value ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)' }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pm4-cells" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Cell k="Maturaz." v={matPct != null ? <>{matPct.toFixed(0)}<small>%</small></> : '—'} />
        <Cell k="Usura W" v={wWear != null ? <>{wWear.toFixed(0)}<small>%</small></> : '—'} />
        <Cell k="Farina" v={<>{session.totalFlourGrams}<small>g</small></>} />
        <Cell k="Agente" v={agent} />
      </div>

      <div style={{ ...MONO, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--pm4-umber)' }}>
        <span>Idratazione {session.hydration}%</span>
        <span>Sale {session.salt}%</span>
        {session.alertsCount != null && session.alertsCount > 0 && (
          <span style={{ color: 'var(--pm4-ember-lo)' }}>⚠ {session.alertsCount} {session.alertsCount === 1 ? 'avviso' : 'avvisi'}</span>
        )}
        {session.userNotes && <span style={{ color: 'var(--pm4-tan)', fontStyle: 'italic' }}>{session.userNotes}</span>}
        <button ref={deleteBtnRef} type="button" onClick={() => setConfirmDelete(true)}
          aria-label={`Elimina la sessione ${styleName} del ${dateStr}`}
          style={{ marginLeft: 'auto', width: 44, height: 44, margin: '-14px -10px -14px auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pm4-umber)', fontSize: 16 }}>
          <span aria-hidden="true">🗑</span>
        </button>
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-label="Conferma eliminazione"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); focusAfter.current = 'delete'; setConfirmDelete(false); } }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ ...MONO, fontSize: 12, color: 'var(--pm4-flour)', flex: '1 1 100%' }}>Eliminare questa sessione?</span>
          <button ref={cancelDeleteRef} type="button" onClick={() => { focusAfter.current = 'delete'; setConfirmDelete(false); }} style={{ ...BTN, flex: 1 }}>Annulla</button>
          <button type="button" onClick={() => { setConfirmDelete(false); onDelete(session); }}
            className="pm4-btn-danger-quiet"
            style={{ ...BTN, flex: 1, color: 'var(--state-critical)', border: '1px solid rgba(255,118,117,0.35)' }}>
            Elimina
          </button>
        </div>
      )}
    </article>
  );
}

export function HistoryView() {
  const { state, dispatch } = useApp();
  const live = !!state.activeSession;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  // Eliminazione differita: nascosta subito, cancellata davvero dopo 10s salvo annulla.
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef  = useRef<Session | null>(null);
  const undoRef     = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pendingDelete) undoRef.current?.focus(); }, [pendingDelete]);

  useEffect(() => {
    loadSessionHistory(30)
      // Le sessioni ancora "active" non sono storia (e i vecchi orfani non sono doppioni).
      .then(list => setSessions(list.filter(s => s.status === 'completed' || s.status === 'aborted')))
      .catch(() => { setSessions([]); setError('Non è stato possibile caricare lo Storico.'); })
      .finally(() => setLoading(false));
  }, []);

  const commitDelete = async (s: Session) => {
    if (s.id == null) return;
    try {
      await deleteSession(s.id);
    } catch {
      setSessions(prev => prev.some(x => x.id === s.id) ? prev : [...prev, s].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setError('Non è stato possibile eliminare la sessione: riprova.');
    }
  };

  // Uscendo dalla vista con un'eliminazione in sospeso, la si completa.
  useEffect(() => () => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    if (pendingRef.current) void commitDelete(pendingRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (s: Session) => {
    if (pendingRef.current) { void commitDelete(pendingRef.current); }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setError(null);
    setSessions(prev => prev.filter(x => x.id !== s.id));
    setPendingDelete(s);
    pendingRef.current = s;
    deleteTimer.current = setTimeout(() => {
      pendingRef.current = null;
      setPendingDelete(null);
      void commitDelete(s);
    }, 10_000);
  };

  const undoDelete = () => {
    const s = pendingRef.current;
    if (!s) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    pendingRef.current = null;
    setPendingDelete(null);
    setSessions(prev => [...prev, s].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    // il focus va sulla sessione ripristinata, non sul body
    setTimeout(() => document.querySelector<HTMLElement>(`[data-session-id="${s.id}"]`)?.focus(), 0);
  };

  const handleRate = async (id: number, rating: NonNullable<Session['outcomeRating']>) => {
    const before = sessions.find(s => s.id === id)?.outcomeRating;
    setError(null);
    setSessions(prev => prev.map(s => s.id === id ? { ...s, outcomeRating: rating } : s));
    try { await rateSession(id, rating); }
    catch {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, outcomeRating: before } : s));
      setError('Non è stato possibile salvare il voto: riprova.');
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', padding: '20px 16px', maxWidth: 430, margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <button type="button" onClick={() => dispatch({ type: 'NAV', view: 'home' })} aria-label="Torna alla home"
          style={{ width: 44, height: 44, marginLeft: -12, background: 'none', border: 'none', color: 'var(--pm4-ember)', ...MONO, fontSize: 18, cursor: 'pointer' }}>
          <span aria-hidden="true">←</span>
        </button>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--pm4-flour)', margin: 0 }}>
          Storico
        </h1>
        {!loading && (
          <span style={{ ...MONO, marginLeft: 'auto', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--pm4-tan)' }}>
            {sessions.length} {sessions.length === 1 ? 'sessione' : 'sessioni'}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" style={{ ...MONO, fontSize: 12, color: 'var(--state-critical)', border: '1px solid rgba(255,118,117,0.35)', borderRadius: 8, padding: '9px 12px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div role="status" style={{ ...MONO, textAlign: 'center', padding: '40px 0', color: 'var(--pm4-tan)', fontSize: 13 }}>
          Caricamento…
        </div>
      )}

      {!loading && sessions.length === 0 && !pendingDelete && (
        <div className="pm4-panel" style={{ ...MONO, padding: 28, textAlign: 'center', color: 'var(--pm4-tan)', fontSize: 13, lineHeight: 1.6 }}>
          Nessuna sessione ancora.
          <br /><span style={{ color: 'var(--pm4-umber)', fontSize: 12 }}>Le sessioni terminate compaiono qui, con l'ora d'infornata e il voto.</span>
        </div>
      )}

      {!loading && <Calibration sessions={sessions} />}

      {sessions.map(s => (
        <SessionCard key={s.id} session={s} onDelete={handleDelete} onRate={handleRate} />
      ))}

      <button
        type="button"
        onClick={() => {
          if (live) return;
          dispatch({ type: 'WIZARD_RESET' });
          dispatch({ type: 'NAV', view: 'wizard' });
        }}
        disabled={live}
        aria-describedby={live ? 'history-new-blocked' : undefined}
        className="pm-btn-primary"
        style={{
          background: 'var(--accent-brand)', color: 'var(--bg-primary)',
          border: 'none', borderRadius: 10, minHeight: 48,
          padding: '14px 20px', ...MONO, fontWeight: 700, fontSize: 14,
          cursor: live ? 'not-allowed' : 'pointer', opacity: live ? 0.45 : 1,
          marginTop: 8,
        }}
      >
        🍕 Nuovo impasto
      </button>
      {live && (
        <p id="history-new-blocked" style={{ margin: 0, ...MONO, fontSize: 12, color: 'var(--pm4-tan)', textAlign: 'center' }}>
          Prima termina l'impasto in corso.
        </p>
      )}

      {/* Annulla eliminazione (10s) */}
      {pendingDelete && (
        <div role="status" style={{
          position: 'sticky', bottom: 'max(12px, env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--pm4-panel-hi)', border: '1px solid var(--pm4-line-strong)', borderRadius: 10, padding: '6px 6px 6px 14px',
          ...MONO, fontSize: 12, color: 'var(--pm4-tan)',
        }}>
          <span style={{ flex: 1 }}>Sessione eliminata</span>
          <button ref={undoRef} type="button" onClick={undoDelete} style={{ ...BTN, color: 'var(--pm4-ember-lo)' }}>↶ Annulla</button>
        </div>
      )}
    </div>
  );
}
