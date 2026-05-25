/**
 * PizzaMatrix — HistoryView
 * Storico sessioni caricate da Dexie (IndexedDB).
 * Mostra: stile, data, durata, picco maturazione, W decay, agente.
 */
import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, S } from '../ui';
import { loadSessionHistory, deleteSession } from '../../services/sessionService';
import type { Session } from '../../db/db';

const AGENT_SHORT: Record<string, string> = {
  fresh_yeast:        'LBF',
  instant_dry_yeast:  'IDY',
  sourdough_wheat:    'LM',
};

const STYLE_EMOJI: Record<string, string> = {
  napoletana:    '🔥',
  contemporanea: '✨',
  teglia:        '📐',
  pala:          '🍕',
  nystyle:       '🗽',
};

function SessionCard({
  session,
  onDelete,
  deleting,
}: {
  session: Session;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const start = session.startedAt instanceof Date
    ? session.startedAt : new Date(session.startedAt ?? Date.now());
  const end = session.endedAt instanceof Date
    ? session.endedAt : session.endedAt ? new Date(session.endedAt) : null;
  const durationH = end ? (end.getTime() - start.getTime()) / 3_600_000 : null;

  const W0   = session.effectiveW_initial ?? 280;
  const Wf   = session.effectiveW_current ?? W0;
  const wDecay = ((W0 - Wf) / W0) * 100;
  const matPct = session.peakMaturation;

  const emoji = STYLE_EMOJI[session.style] ?? '🍕';
  const agent = AGENT_SHORT[session.agentType] ?? session.agentLabel;

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: '1.1rem', marginRight: 6 }}>{emoji}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            {session.style?.toUpperCase()}
          </span>
          <span style={{
            marginLeft: 8,
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
            color: session.status === 'completed' ? 'var(--state-optimal-lo)' : 'var(--text-muted)',
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px', borderRadius: 4,
          }}>
            {session.status}
          </span>
        </div>
        <button
          onClick={() => session.id != null && onDelete(session.id)}
          disabled={deleting}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '1rem', opacity: deleting ? 0.3 : 1,
            padding: '0 4px',
          }}
        >
          🗑
        </button>
      </div>

      {/* Date + duration */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {start.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
        {' · '}
        {start.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        {durationH != null && ` · ${durationH.toFixed(1)}h`}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        <Metric
          label="Picco mat."
          value={matPct != null ? matPct.toFixed(0) : '—'}
          unit={matPct != null ? '%' : undefined}
          color={
            matPct == null ? 'var(--text-muted)'
            : matPct >= 85 ? 'var(--state-optimal-hi)'
            : matPct >= 65 ? 'var(--state-optimal-lo)'
            : 'var(--state-approaching)'
          }
        />
        <Metric
          label="W decay"
          value={wDecay.toFixed(1)}
          unit="%"
          color={wDecay > 35 ? 'var(--state-critical)' : wDecay > 20 ? 'var(--accent-warning)' : 'var(--text-secondary)'}
        />
        <Metric
          label="Farina"
          value={session.totalFlourGrams.toString()}
          unit="g"
        />
        <Metric
          label="Agente"
          value={agent}
          color="var(--text-secondary)"
        />
      </div>

      {/* Footer: hydration + salt + alerts */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)',
      }}>
        <span>Idr {session.hydration}%</span>
        <span>Sale {session.salt}%</span>
        {session.alertsCount != null && session.alertsCount > 0 && (
          <span style={{ color: 'var(--accent-warning)' }}>⚠ {session.alertsCount} alert</span>
        )}
        {session.userNotes && (
          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{session.userNotes}</span>
        )}
      </div>
    </Card>
  );
}

export function HistoryView() {
  const { dispatch } = useApp();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    loadSessionHistory(30)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      /* silenzioso */
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          style={{ background: 'none', border: 'none', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer' }}
        >
          ←
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Storico sessioni
        </h2>
        {!loading && (
          <span style={{ ...S.label, marginLeft: 'auto' }}>
            {sessions.length} sessioni
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          Caricamento…
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
          padding: 32, textAlign: 'center',
          color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>📋</div>
          <div>Nessuna sessione completata ancora.</div>
          <div style={{ marginTop: 8, fontSize: '0.72rem' }}>
            Le sessioni terminate vengono salvate automaticamente su IndexedDB
          </div>
        </div>
      )}

      {/* Session cards */}
      {sessions.map(s => (
        <SessionCard
          key={s.id}
          session={s}
          onDelete={handleDelete}
          deleting={deletingId === s.id}
        />
      ))}

      {/* CTA */}
      <button
        onClick={() => {
          dispatch({ type: 'WIZARD_RESET' });
          dispatch({ type: 'NAV', view: 'wizard' });
        }}
        style={{
          background: 'var(--accent-brand)', color: '#0a0806',
          border: 'none', borderRadius: 'var(--radius-md)',
          padding: '14px 20px', fontFamily: 'var(--font-mono)',
          fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
          marginTop: 8,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
        }}
      >
        🍕 Nuovo impasto
      </button>
    </div>
  );
}
