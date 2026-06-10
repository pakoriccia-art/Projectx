/**
 * PizzaMatrix — FermentationTimeline (Dashboard v4)
 * Timeline orizzontale delle fasi, derivata da session.thermalTimeline (fonte di verità).
 * Si aggiorna automaticamente quando Aggiusta Rotta rigenera la timeline.
 */
import { useMemo, useState, useEffect } from 'react';
import type React from 'react';
import type { PhaseSegment, Session } from '../../db/db';
import { buildInitialTimeline } from '../../db/db';
import { SEMAFORO_COLORS, type SemaforoState } from './SemaforoCard';

export interface TimelinePhase {
  phaseType:    string;
  label:        string;
  absoluteTime: Date;
  isCompleted:  boolean;
  isCurrent:    boolean;
  isFuture:     boolean;
  isBake:       boolean;
  hoursFromNow: number;
}

/**
 * Mappa un PhaseSegment → label timeline (Bug #76).
 * L'ultimo proofing è la COTTURA; i proofing precedenti con durata > 0.1h
 * sono TEMPERING. Nessuna fase 'LIEVITAZIONE' (non esiste in PhaseSegment[]).
 */
export function buildTimelinePhases(
  timeline: PhaseSegment[] | undefined,
  session: Session,
  now: Date,
): TimelinePhase[] {
  const segs = (timeline && timeline.length > 0)
    ? timeline
    : buildInitialTimeline(session as any);
  if (segs.length === 0) return [];

  const startMs = session.startedAt
    ? new Date(session.startedAt).getTime()
    : Date.now();
  const nowMs = now.getTime();

  const lastProofingIdx = segs.reduce(
    (acc, s, i) => (s.phaseType === 'proofing' ? i : acc), -1);

  const phases: TimelinePhase[] = [];
  segs.forEach((seg, i) => {
    let label: string;
    let isBake = false;
    switch (seg.phaseType) {
      case 'bulk_room':     label = 'PUNTATA · TA'; break;
      case 'bulk_fridge':   label = 'PUNTATA · TC'; break;
      case 'balled_room':   label = 'STAGLIO';      break;
      case 'balled_fridge': label = 'APPRETO · TC'; break;
      case 'baking':        label = 'COTTURA'; isBake = true; break;
      case 'proofing': {
        const dur = (seg.endElapsedH ?? seg.startElapsedH) - seg.startElapsedH;
        if (i === lastProofingIdx) { label = 'COTTURA'; isBake = true; }
        else if (dur > 0.1)        { label = 'TEMPERING'; }
        else return; // proofing intermedio a durata nulla → non mostrare
        break;
      }
      default: label = seg.phaseType.toUpperCase();
    }
    const absMs = startMs + seg.startElapsedH * 3_600_000;
    phases.push({
      phaseType:    seg.phaseType,
      label,
      absoluteTime: new Date(absMs),
      isCompleted:  seg.status === 'completed',
      isCurrent:    seg.status === 'current',
      // Bug #94: usa margine 5min per evitare che la fase corrente risulti "futura"
      // di pochi secondi. Solo fasi con start > now + 5min sono tappabili.
      isFuture:     (absMs - nowMs) > 5 * 60 * 1000,
      isBake,
      hoursFromNow: (absMs - nowMs) / 3_600_000,
    });
  });

  return phases;
}

function formatAbsoluteTime(d: Date): string {
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(h: number): string {
  if (h <= 0) return 'ora';
  if (h < 1) return `${Math.round(h * 60)}min`;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm > 0 ? `${hh}h${mm.toString().padStart(2, '0')}` : `${hh}h`;
}

function TimelineMarker({ phase, currentSemaforoState, onTransition }: {
  phase: TimelinePhase; currentSemaforoState: SemaforoState;
  onTransition?: (phaseType: string) => void;
}) {
  const dotColor = phase.isCurrent ? SEMAFORO_COLORS[currentSemaforoState] : '#2a8f74';

  const showBadge = phase.isFuture && phase.hoursFromNow > 0 && phase.hoursFromNow <= 4;
  // Bug #94: SOLO fasi future sono tappabili — mai passate, mai corrente.
  // isFuture usa margine 5min → nessun edge case con la fase corrente appena iniziata.
  const canTransition = phase.isFuture === true && !!onTransition;

  const pipBase: React.CSSProperties = {
    width: phase.isCurrent ? 15 : 11,
    height: phase.isCurrent ? 15 : 11,
    borderRadius: phase.isBake ? 2 : '50%',
    transform: phase.isBake ? 'rotate(45deg)' : 'none',
  };
  const pipStyle: React.CSSProperties = phase.isCurrent
    ? { ...pipBase, background: dotColor, boxShadow: `0 0 0 3px ${dotColor}33, 0 0 16px ${dotColor}` }
    : phase.isCompleted
      ? { ...pipBase, background: '#2a8f74' }
      : { ...pipBase, background: 'var(--pm4-panel-hi)', boxShadow: '0 0 0 2px var(--pm4-line-strong)' };

  return (
    <div
      onClick={canTransition ? () => onTransition!(phase.phaseType) : undefined}
      className={canTransition ? 'pm4-tap' : undefined}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 5, minWidth: 56,
        cursor: canTransition ? 'pointer' : 'default',
        opacity: phase.isCompleted ? 0.6 : 1,
      }}
    >
      {/* Affordance tap (teal) sui marker tappabili */}
      {canTransition && (
        <div style={{
          position: 'absolute', top: 16, right: 6,
          width: 6, height: 6, borderRadius: '50%',
          background: '#14b8a6', boxShadow: '0 0 6px #14b8a6',
        }} />
      )}
      {showBadge ? (
        <div style={{
          background: 'rgba(255,209,102,0.12)', border: '1px solid rgba(255,209,102,0.4)', borderRadius: 5,
          padding: '1px 5px', color: 'var(--pm4-ember-lo)', fontSize: 8, letterSpacing: '0.04em',
          marginBottom: 2, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)',
        }}>
          tra {formatCountdown(phase.hoursFromNow)}
        </div>
      ) : (
        <div style={{ height: 18 }} />
      )}

      <div className={phase.isCurrent ? 'pm4-pip-cur' : (canTransition ? 'pm4-pip-tap' : undefined)} style={pipStyle} />

      <div style={{
        color: phase.isCurrent ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)',
        fontSize: 8, textAlign: 'center', letterSpacing: '0.06em', textTransform: 'uppercase',
        lineHeight: 1.25, fontFamily: 'var(--font-mono)', maxWidth: 52,
      }}>
        {phase.label}
      </div>

      <div style={{
        color: phase.isCompleted ? 'var(--pm4-faint)' : 'var(--pm4-umber)',
        fontSize: 9, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
      }}>
        {formatAbsoluteTime(phase.absoluteTime)}
      </div>
    </div>
  );
}

export function FermentationTimeline({
  session, currentSemaforoState, onPhaseTransition,
}: {
  session: Session; currentSemaforoState: SemaforoState;
  onPhaseTransition?: (phaseType: string) => void;
}) {
  // now è locale — non causa re-render del parent ogni secondo
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const phases = useMemo(
    () => buildTimelinePhases(session.thermalTimeline, session, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Re-calcola ogni minuto (countdown badge) + su cambio timeline o sessione
    [session.thermalTimeline, session.id, Math.floor(now.getTime() / 60_000)],
  );

  if (phases.length === 0) return null;

  // Deduplica fasi con lo stesso phaseType (può accadere dopo transizione backward):
  // mostra la versione 'current' se presente, altrimenti la prima occorrenza.
  const deduped = phases.reduce<TimelinePhase[]>((acc, phase) => {
    const existing = acc.findIndex(p => p.phaseType === phase.phaseType && p.label === phase.label);
    if (existing === -1) {
      acc.push(phase);
    } else if (phase.isCurrent) {
      acc[existing] = phase;
    }
    return acc;
  }, []);

  // R7: con molte fasi la timeline scrolla in orizzontale; mostra un fade a destra
  // come affordance di scroll (euristica: ≥6 marker superano il viewport ~430px).
  const scrollable = deduped.length >= 6;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', paddingTop: 16, paddingBottom: 8, overflowX: 'auto' }}>
        <div style={{ position: 'absolute', top: 41, left: 24, right: 24, height: 2, borderRadius: 2,
          background: 'linear-gradient(90deg, #2a8f74 0%, #2a8f74 42%, var(--pm4-line-strong) 42%, var(--pm4-line-strong) 100%)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', gap: 10, minWidth: 'min-content' }}>
          {deduped.map((phase, i) => (
            <TimelineMarker
              key={`${phase.phaseType}-${phase.label}-${phase.absoluteTime.getTime()}-${i}`}
              phase={phase}
              currentSemaforoState={currentSemaforoState}
              onTransition={onPhaseTransition}
            />
          ))}
        </div>
      </div>
      {scrollable && (
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, var(--pm4-panel-lo))',
        }} />
      )}
    </div>
  );
}
