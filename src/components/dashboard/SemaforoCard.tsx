/**
 * PizzaMatrix — SemaforoCard (Dashboard v4)
 * Card semaforo adattiva: full-width (singola) o half (dual 50/50).
 * 4 stati: TOO_EARLY (grigio) · OK (verde) · WARNING (giallo) · CRITICAL (rosso).
 */

export type SemaforoState = 'TOO_EARLY' | 'OK' | 'WARNING' | 'CRITICAL';

export const SEMAFORO_COLORS: Record<SemaforoState, string> = {
  TOO_EARLY: '#6b7280',
  OK:        '#22c55e',
  WARNING:   '#eab308',
  CRITICAL:  '#ef4444',
};

const STATE_LABELS: Record<SemaforoState, string> = {
  TOO_EARLY: 'PRESTO',
  OK:        'OK',
  WARNING:   'ATTENZIONE',
  CRITICAL:  'CRITICO',
};

export function StateBadge({ state, color }: { state: SemaforoState; color: string }) {
  return (
    <span style={{
      color, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
      border: `1px solid ${color}`, borderRadius: 4, padding: '2px 6px',
      fontFamily: 'monospace',
    }}>
      {STATE_LABELS[state]}
    </span>
  );
}

export function ProgressBar({ value, target, color }: { value: number; target?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ position: 'relative', height: 6, background: '#1f2937', borderRadius: 3, marginTop: 10 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: `${pct}%`, background: color, borderRadius: 3,
        transition: 'width 0.4s ease',
      }} />
      {target != null && target > 0 && target <= 100 && (
        <div style={{
          position: 'absolute', top: -2, bottom: -2, left: `${target}%`,
          width: 2, background: '#14b8a6', borderRadius: 1,
        }} />
      )}
    </div>
  );
}

export function SemaforoCard({
  label, value, state, color, progress, target, half = false,
}: {
  label: string; value: string; state: SemaforoState; color: string;
  progress: number; target?: number; half?: boolean;
}) {
  return (
    <div style={{
      flex: half ? 1 : undefined,
      background: '#111111',
      border: `1px solid ${color}33`,
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>{label}</span>
        <StateBadge state={state} color={color} />
      </div>
      <div style={{ color, fontSize: half ? 26 : 36, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>
        {value}
      </div>
      <ProgressBar value={progress} target={target} color={color} />
    </div>
  );
}
