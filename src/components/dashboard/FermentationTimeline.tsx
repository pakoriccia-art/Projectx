/**
 * PizzaMatrix — FermentationTimeline (Dashboard v4)
 * Timeline orizzontale delle fasi, derivata da session.thermalTimeline (fonte di verità).
 * Si aggiorna automaticamente quando Aggiusta Rotta rigenera la timeline.
 */
import type { PhaseSegment, Session } from '../../db/db';
import { buildInitialTimeline } from '../../db/db';
import { SEMAFORO_COLORS, type SemaforoState } from './SemaforoCard';

export interface TimelinePhase {
  label:        string;
  absoluteTime: Date;
  isCompleted:  boolean;
  isCurrent:    boolean;
  isFuture:     boolean;
  isBake:       boolean;
  hoursFromNow: number;
}

function labelFor(phaseType: string, isLastProofing: boolean): string {
  switch (phaseType) {
    case 'bulk_room':     return 'PUNTATA · TA';
    case 'bulk_fridge':   return 'PUNTATA · TC';
    case 'balled_room':   return 'STAGLIO';
    case 'balled_fridge': return 'APPRETO · TC';
    case 'proofing':      return isLastProofing ? 'LIEVITAZIONE' : 'TEMPERING';
    case 'baking':        return 'COTTURA';
    default:              return phaseType.toUpperCase();
  }
}

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

  // Ultimo segmento proofing → LIEVITAZIONE finale (gli altri proofing = TEMPERING)
  const lastProofingIdx = segs.reduce(
    (acc, s, i) => (s.phaseType === 'proofing' ? i : acc), -1);

  const phases: TimelinePhase[] = segs.map((seg, i) => {
    const absMs = startMs + seg.startElapsedH * 3_600_000;
    return {
      label:        labelFor(seg.phaseType, i === lastProofingIdx),
      absoluteTime: new Date(absMs),
      isCompleted:  seg.status === 'completed',
      isCurrent:    seg.status === 'current',
      isFuture:     seg.status === 'planned',
      isBake:       false,
      hoursFromNow: (absMs - nowMs) / 3_600_000,
    };
  });

  // Marker COTTURA finale alla fine dell'ultimo segmento
  const last = segs[segs.length - 1];
  const bakeMs = startMs + (last.endElapsedH ?? last.startElapsedH) * 3_600_000;
  phases.push({
    label:        'COTTURA',
    absoluteTime: new Date(bakeMs),
    isCompleted:  bakeMs < nowMs,
    isCurrent:    false,
    isFuture:     bakeMs >= nowMs,
    isBake:       true,
    hoursFromNow: (bakeMs - nowMs) / 3_600_000,
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

function TimelineMarker({ phase, currentSemaforoState }: {
  phase: TimelinePhase; currentSemaforoState: SemaforoState;
}) {
  const dotColor = phase.isCurrent
    ? SEMAFORO_COLORS[currentSemaforoState]
    : phase.isCompleted ? '#374151' : '#4b5563';

  const showBadge = phase.isFuture && phase.hoursFromNow > 0 && phase.hoursFromNow <= 4;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 48 }}>
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
  session, now, currentSemaforoState,
}: {
  session: Session; now: Date; currentSemaforoState: SemaforoState;
}) {
  const phases = buildTimelinePhases(session.thermalTimeline, session, now);
  if (phases.length === 0) return null;

  return (
    <div style={{ position: 'relative', paddingTop: 16, paddingBottom: 8, overflowX: 'auto' }}>
      <div style={{ position: 'absolute', top: 40, left: 24, right: 24, height: 1, background: '#1f2937' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', gap: 4, minWidth: 'min-content' }}>
        {phases.map((phase, i) => (
          <TimelineMarker key={i} phase={phase} currentSemaforoState={currentSemaforoState} />
        ))}
      </div>
    </div>
  );
}
