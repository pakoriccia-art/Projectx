/**
 * PizzaMatrix — SemaforoCard (Dashboard v4 · skin "Banco")
 * Pannello strumento con meter a segmenti LED. Full-width (singola) o half (dual 50/50).
 * Stati struttura W: TOO_EARLY · OK · WARNING · CRITICAL · COLLAPSED.
 * Stati maturazione (presentazione): IN_CORSO · QUASI · PRONTO — distinti, così
 * "pronto per infornare" non ha lo stesso colore di "a metà lievitazione".
 */
import type React from 'react';

export type SemaforoState =
  | 'TOO_EARLY' | 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED'
  | 'IN_CORSO' | 'QUASI' | 'PRONTO';

// Palette stati "Banco": calda, coerente coi token app (warning/critical/collapsed = token reali).
export const SEMAFORO_COLORS: Record<SemaforoState, string> = {
  TOO_EARLY: '#9a8a64',
  OK:        '#3ddc97',
  WARNING:   '#ffd166',
  CRITICAL:  '#ff7675',
  COLLAPSED: '#d63031',
  IN_CORSO:  '#e8d5b0',   // farina: leggibile da lontano, nessun giudizio
  QUASI:     '#ff8c32',   // brace: lo stato ottimale si avvicina
  PRONTO:    '#3ddc97',   // verde pieno: si inforna
};

const STATE_LABELS: Record<SemaforoState, string> = {
  TOO_EARLY: 'PRESTO',
  OK:        'OK',
  WARNING:   'ATTENZIONE',
  CRITICAL:  'CRITICO',
  COLLAPSED: 'COLLASSO',
  IN_CORSO:  'IN CORSO',
  QUASI:     'QUASI',
  PRONTO:    'PRONTO',
};

export const STATE_LABELS_FULL: Record<SemaforoState, string> = {
  TOO_EARLY: 'TROPPO PRESTO',
  OK:        'OK',
  WARNING:   'ATTENZIONE',
  CRITICAL:  'CRITICO',
  COLLAPSED: 'COLLASSO STRUTTURALE',
  IN_CORSO:  'IN CORSO',
  QUASI:     'QUASI PRONTO',
  PRONTO:    'PRONTO DA INFORNARE',
};

export function StateBadge({ state, color, pulsing = false, full = false }: {
  state: SemaforoState; color: string; pulsing?: boolean; full?: boolean;
}) {
  return (
    <span
      className={pulsing ? 'pm4-glow-crit' : undefined}
      style={{
        color, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        border: `1px solid ${color}80`, background: `${color}2a`,
        borderRadius: 5, padding: '3px 8px',
        fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
      }}
    >
      {full ? STATE_LABELS_FULL[state] : STATE_LABELS[state]}
    </span>
  );
}

/** Meter a segmenti LED — si accendono in sequenza (CSS), glow nel colore di stato. */
export function SegMeter({ progress, color, segments = 10 }: {
  progress: number; color: string; segments?: number;
}) {
  const on = Math.round(Math.max(0, Math.min(100, progress)) / (100 / segments));
  return (
    <div className="pm4-seg" style={{ ['--seg']: color } as React.CSSProperties}>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''}
          style={i < on ? { animationDelay: `${250 + i * 45}ms` } : undefined} />
      ))}
    </div>
  );
}

export function SemaforoCard({
  label, value, state, color, progress, target, half = false, caption, sub, footnote,
}: {
  label: string; value: string; state: SemaforoState; color: string;
  progress: number; target?: number; half?: boolean;
  /** R6: nomina esplicitamente COSA misura il numero grande (varia per stile). */
  caption?: string;
  /** Riga sotto il valore protagonista (es. "tra 11h 20m"), nel colore di stato. */
  sub?: string;
  /** Riga di supporto sotto il meter (sostituisce "target N%"). */
  footnote?: string;
}) {
  const isCollapsed = state === 'COLLAPSED';
  const isReady     = state === 'PRONTO';
  return (
    <div className={`pm4-panel${isCollapsed ? ' pm4-crit' : ''}${isReady ? ' pm4-ready' : ''}`}
      style={{ flex: half ? 1 : undefined, padding: '13px 14px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 11 }}>
        <span style={{ color: 'var(--pm4-tan)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{label}</span>
        <StateBadge state={state} color={color} pulsing={isCollapsed} full={!half} />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: caption ? 4 : 11 }}>
        <span
          className={isCollapsed ? 'pm4-glow-crit' : undefined}
          style={{
            color, fontSize: half ? 25 : 35, fontWeight: 800, fontFamily: 'var(--font-mono)',
            lineHeight: 0.82, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
            textShadow: `0 0 18px ${color}5a`,
          }}>
          {value}
        </span>
      </div>
      {sub && (
        <div style={{ color, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: '8px 0 10px' }}>
          {sub}
        </div>
      )}
      {caption && (
        <div style={{ color: 'var(--pm4-umber)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 7 }}>
          {caption}
        </div>
      )}

      <SegMeter progress={progress} color={color} />

      {footnote ? (
        <div style={{ marginTop: 9, color: 'var(--pm4-umber)', fontSize: 10, letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {footnote}
        </div>
      ) : target != null && target > 0 && (
        <div style={{ marginTop: 9, display: 'flex', justifyContent: 'flex-end' }}>
          <span style={{ color: 'var(--pm4-umber)', fontSize: 10, letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
            target {Math.round(target)}%
          </span>
        </div>
      )}

      {isCollapsed && (
        <div style={{ marginTop: 9, color: 'var(--state-critical)', fontSize: 10, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
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
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(40,6,6,0.97), rgba(8,6,5,0.98))',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24,
    }}>
      <div className="pm4-glow-crit" style={{ color: '#ff7675', fontSize: 48 }}>⚠</div>
      <div style={{
        color: '#ff7675', fontSize: 17, fontWeight: 800,
        textAlign: 'center', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
      }}>
        COLLASSO STRUTTURALE
      </div>
      {/* R2: distingue questa causa (proteolisi/glutine) dalla sbollatura da sovra-lievitazione */}
      <div style={{
        color: 'var(--pm4-umber)', fontSize: 10, textAlign: 'center',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginTop: -8,
      }}>
        degrado del glutine · proteolisi
      </div>
      <div style={{ color: 'var(--pm4-tan)', fontSize: 13, textAlign: 'center', lineHeight: 1.6, maxWidth: 320 }}>
        {message}
      </div>
      <div style={{ color: 'var(--pm4-umber)', fontSize: 11, textAlign: 'center' }}>
        Sessione ancora attiva — puoi registrare l'esito
      </div>
      <button onClick={onEnd} className="pm4-btn pm4-btn-warm" style={{
        background: 'linear-gradient(180deg, #e0463f, #b3231d)', color: '#fff', border: 'none',
        borderRadius: 9, padding: '14px 32px', fontSize: 14, fontWeight: 700,
        cursor: 'pointer', marginTop: 8, fontFamily: 'var(--font-mono)',
        boxShadow: '0 8px 22px -8px rgba(214,48,49,0.7)',
      }}>
        Termina e registra
      </button>
      <button onClick={onContinue} style={{
        background: 'none', border: 'none', color: 'var(--pm4-umber)',
        fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
        padding: 4, fontFamily: 'var(--font-mono)',
      }}>
        Continua a monitorare
      </button>
    </div>
  );
}
