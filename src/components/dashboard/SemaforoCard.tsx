/**
 * PizzaMatrix — SemaforoCard (Dashboard v4)
 * Card semaforo adattiva: full-width (singola) o half (dual 50/50).
 * 5 stati: TOO_EARLY · OK · WARNING · CRITICAL · COLLAPSED (rosso scuro, lampeggiante).
 */

// Keyframes pulse per il badge COLLAPSED — iniettato una volta sola via <style>
const PULSE_KEYFRAMES = `@keyframes pmPulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }`;

export type SemaforoState = 'TOO_EARLY' | 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED';

export const SEMAFORO_COLORS: Record<SemaforoState, string> = {
  TOO_EARLY: '#6b7280',
  OK:        '#22c55e',
  WARNING:   '#eab308',
  CRITICAL:  '#ef4444',
  COLLAPSED: '#7f1d1d',
};

const STATE_LABELS: Record<SemaforoState, string> = {
  TOO_EARLY: 'PRESTO',
  OK:        'OK',
  WARNING:   'ATTENZIONE',
  CRITICAL:  'CRITICO',
  COLLAPSED: 'COLLASSO',
};

export const STATE_LABELS_FULL: Record<SemaforoState, string> = {
  TOO_EARLY: 'TROPPO PRESTO',
  OK:        'OK',
  WARNING:   'ATTENZIONE',
  CRITICAL:  'CRITICO',
  COLLAPSED: 'COLLASSO STRUTTURALE',
};

export function StateBadge({ state, color, pulsing = false }: {
  state: SemaforoState; color: string; pulsing?: boolean;
}) {
  return (
    <>
      {pulsing && <style>{PULSE_KEYFRAMES}</style>}
      <span style={{
        color, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        border: `1px solid ${color}`, borderRadius: 4, padding: '2px 6px',
        fontFamily: 'monospace', whiteSpace: 'nowrap',
        animation: pulsing ? 'pmPulse 2s ease-in-out infinite' : undefined,
      }}>
        {STATE_LABELS[state]}
      </span>
    </>
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
          width: 2, background: '#6b7280', borderRadius: 1,
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
  const isCollapsed = state === 'COLLAPSED';
  return (
    <div style={{
      flex: half ? 1 : undefined,
      background: isCollapsed ? '#1c0a0a' : '#111111',
      border: `1px solid ${color}${isCollapsed ? 'aa' : '33'}`,
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: '0.12em' }}>{label}</span>
        <StateBadge state={state} color={color} pulsing={isCollapsed} />
      </div>
      <div style={{ color, fontSize: half ? 26 : 36, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>
        {value}
      </div>
      <ProgressBar value={progress} target={target} color={color} />
      {isCollapsed && (
        <div style={{ marginTop: 8, color: '#ef4444', fontSize: 10, letterSpacing: '0.06em' }}>
          ⚠ Struttura non recuperabile — inforna immediatamente
        </div>
      )}
    </div>
  );
}

// ─── Modal collasso strutturale (non dismissibile) ────────────────────────────

export function CollapseModal({
  message, onEnd, onContinue,
}: {
  message: string; onEnd: () => void; onContinue: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(10,10,10,0.96)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24,
    }}>
      <div style={{ color: '#7f1d1d', fontSize: 48 }}>⚠</div>
      <div style={{
        color: '#ef4444', fontSize: 16, fontWeight: 700,
        textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.08em',
      }}>
        COLLASSO STRUTTURALE
      </div>
      <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', lineHeight: 1.6, maxWidth: 320 }}>
        {message}
      </div>
      <div style={{ color: '#4b5563', fontSize: 11, textAlign: 'center' }}>
        Sessione ancora attiva — puoi registrare l'esito
      </div>
      <button onClick={onEnd} style={{
        background: '#7f1d1d', color: '#f9fafb', border: 'none',
        borderRadius: 8, padding: '14px 32px', fontSize: 14,
        cursor: 'pointer', marginTop: 8,
      }}>
        Termina e registra
      </button>
      <button onClick={onContinue} style={{
        background: 'none', border: 'none', color: '#4b5563',
        fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
        padding: 4,
      }}>
        Continua a monitorare
      </button>
    </div>
  );
}
