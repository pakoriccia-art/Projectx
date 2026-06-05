/**
 * PizzaMatrix — FermentationTimeline (Dashboard v4)
 * Timeline orizzontale delle fasi, derivata da session.thermalTimeline (fonte di verità).
 * Si aggiorna automaticamente quando Aggiusta Rotta rigenera la timeline.
 */
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
      isFuture:     seg.status === 'planned',
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
  const dotColor = phase.isCurrent
    ? SEMAFORO_COLORS[currentSemaforoState]
    : phase.isCompleted ? '#374151' : '#4b5563';

  const showBadge = phase.isFuture && phase.hoursFromNow > 0 && phase.hoursFromNow <= 4;
  // Tappabile: qualsiasi fase NON corrente (futura o passata → steering bidirezionale)
  const canTransition = !phase.isCurrent && !!onTransition;

  return (
    <div
      onClick={canTransition ? () => onTransition!(phase.phaseType) : undefined}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 4, minWidth: 48,
        cursor: canTransition ? 'pointer' : 'default',
        opacity: phase.isCompleted ? 0.55 : 1,
      }}
    >
      {/* Affordance tap (teal) sui marker tappabili */}
      {canTransition && (
        <div style={{
          position: 'absolute', top: 14, right: 6,
          width: 7, height: 7, borderRadius: '50%',
          background: '#14b8a6', opacity: 0.85,
        }} />
      )}
      {showBadge ? (
        <div style={{
          background: '#f9731622', border: '1px solid #f97316', borderRadius: 4,
          padding: '1px 4px', color: '#f97316', fontSize: 8, letterSpacing: '0.04em',
          marginBottom: 2, whiteSpace: 'nowrap', fontFamily: 'monospace',
        }}>
          tra {formatCountdown(phase.hoursFromNow)}
        </div>
      ) : (
        <div style={{ height: 18 }} />
      )}

      <div style={{
        width: phase.isCurrent ? 14 : 10,
        height: phase.isCurrent ? 14 : 10,
        borderRadius: phase.isBake ? 2 : '50%',
        background: dotColor,
        boxShadow: phase.isCurrent ? `0 0 8px ${dotColor}88` : 'none',
        transform: phase.isBake ? 'rotate(45deg)' : 'none',
      }} />

      <div style={{
        color: phase.isCurrent ? '#f9fafb' : '#6b7280',
        fontSize: 8, textAlign: 'center', letterSpacing: '0.05em',
        lineHeight: 1.2, fontFamily: 'monospace', maxWidth: 56,
      }}>
        {phase.label}
      </div>

      <div style={{
        color: phase.isCompleted ? '#374151' : '#9ca3af',
        fontSize: 9, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
      }}>
        {formatAbsoluteTime(phase.absoluteTime)}
      </div>
    </div>
  );
}

export function FermentationTimeline({
  session, now, currentSemaforoState, onPhaseTransition,
}: {
  session: Session; now: Date; currentSemaforoState: SemaforoState;
  onPhaseTransition?: (phaseType: string) => void;
}) {
  const phases = buildTimelinePhases(session.thermalTimeline, session, now);
  if (phases.length === 0) return null;

  return (
    <div style={{ position: 'relative', paddingTop: 16, paddingBottom: 8, overflowX: 'auto' }}>
      <div style={{ position: 'absolute', top: 40, left: 24, right: 24, height: 1, background: '#1f2937' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', gap: 4, minWidth: 'min-content' }}>
        {phases.map((phase, i) => (
          <TimelineMarker key={i} phase={phase} currentSemaforoState={currentSemaforoState}
            onTransition={onPhaseTransition} />
        ))}
      </div>
    </div>
  );
}
