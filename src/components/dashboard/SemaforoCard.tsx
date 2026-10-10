/**
 * PizzaMatrix — SemaforoCard (Dashboard v4 · skin "Banco")
 * Pannello strumento con meter a segmenti LED. Full-width (singola) o half (dual 50/50).
 * Stati struttura W: TOO_EARLY · OK · WARNING · CRITICAL · COLLAPSED.
 * Stati maturazione (presentazione): IN_CORSO · QUASI · PRONTO — distinti, così
 * "pronto per infornare" non ha lo stesso colore di "a metà lievitazione".
 */
import { useState } from 'react';
import type React from 'react';
import { useDialogFocus } from './useDialogFocus';

export type SemaforoState =
  | 'TOO_EARLY' | 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED'
  | 'IN_CORSO' | 'QUASI' | 'PRONTO' | 'FREDDO';

// Palette stati "Banco": calda, coerente coi token app (warning/critical/collapsed = token reali).
export const SEMAFORO_COLORS: Record<SemaforoState, string> = {
  TOO_EARLY: '#9a8a64',
  OK:        '#e8d5b0',   // glutine integro: farina (il verde è solo "pronto")
  WARNING:   '#ffd166',
  CRITICAL:  '#ff7675',
  COLLAPSED: '#d63031',
  IN_CORSO:  '#e8d5b0',   // farina: leggibile da lontano, nessun giudizio
  QUASI:     '#ff8c32',   // brace: lo stato ottimale si avvicina
  PRONTO:    '#3ddc97',   // verde pieno: si inforna
  FREDDO:    '#74b9ff',   // maturo ma freddo (frigo/riscaldo): non si inforna ancora
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
  FREDDO:    'FREDDO',
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
  FREDDO:    'MATURO · FREDDO',
};

export function StateBadge({ state, color, pulsing = false, full = false }: {
  state: SemaforoState; color: string; pulsing?: boolean; full?: boolean;
}) {
  return (
    <span
      className={pulsing ? 'pm4-glow-crit' : undefined}
      style={{
        color, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
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
  label, value, valueSuffix, big = false, help, note, state, color, progress, target, half = false, caption, sub, footnote,
}: {
  label: string; value: string; state: SemaforoState; color: string;
  /** Contesto piccolo accanto al valore (es. "domani"), così l'orario resta in testa. */
  valueSuffix?: string;
  /** Valore protagonista grande, leggibile a un metro (Monitor). */
  big?: boolean;
  /** Spiegazione breve dietro un "?" (progressive disclosure). */
  help?: string;
  /** Riga d'azione sotto il valore (es. scarto dal piano con "Aggiusta rotta"). */
  note?: React.ReactNode;
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
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className={`pm4-panel${isCollapsed ? ' pm4-crit' : ''}${isReady ? ' pm4-ready' : ''}`}
      style={{ flex: half ? 1 : undefined, padding: '13px 14px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ color: 'var(--pm4-tan)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{label}</span>
          {help && (
            <button type="button" onClick={() => setHelpOpen(o => !o)} aria-expanded={helpOpen}
              aria-label={helpOpen ? 'Nascondi spiegazione' : 'Cosa significa'}
              style={{ width: 44, height: 44, margin: '-14px -10px', background: 'none', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              <span aria-hidden="true" style={{
                width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center',
                border: `1px solid ${helpOpen ? 'var(--pm4-ember)' : 'var(--pm4-line-strong)'}`,
                color: helpOpen ? 'var(--pm4-ember)' : 'var(--pm4-tan)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
              }}>?</span>
            </button>
          )}
        </span>
        <StateBadge state={state} color={color} pulsing={isCollapsed} full={!half} />
      </div>
      {help && helpOpen && (
        <p style={{ margin: '-4px 0 12px', color: 'var(--pm4-tan)', fontSize: 12, lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
          {help}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: caption ? 4 : 11 }}>
        <span
          className={isCollapsed ? 'pm4-glow-crit' : undefined}
          style={{
            color, fontSize: half ? 25 : big ? 60 : 35, fontWeight: 800, fontFamily: 'var(--font-mono)',
            lineHeight: 0.9, letterSpacing: big ? '-0.03em' : '-0.01em', fontVariantNumeric: 'tabular-nums',
            // Bagliore solo nel collasso: negli altri stati il colore basta.
            textShadow: isCollapsed ? `0 0 18px ${color}5a` : undefined,
          }}>
          {value}
        </span>
        {valueSuffix && (
          <span style={{ color: 'var(--pm4-tan)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {valueSuffix}
          </span>
        )}
      </div>
      {sub && (
        <div style={{ color, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: '8px 0 10px' }}>
          {sub}
        </div>
      )}
      {caption && (
        <div style={{ color: 'var(--pm4-umber)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 7 }}>
          {caption}
        </div>
      )}

      {note && <div style={{ margin: '0 0 12px' }}>{note}</div>}
      <SegMeter progress={progress} color={color} />

      {footnote ? (
        <div style={{ marginTop: 9, color: 'var(--pm4-umber)', fontSize: 11, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {footnote}
        </div>
      ) : target != null && target > 0 && (
        <div style={{ marginTop: 9, display: 'flex', justifyContent: 'flex-end' }}>
          <span style={{ color: 'var(--pm4-umber)', fontSize: 11, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
            target {Math.round(target)}%
          </span>
        </div>
      )}

      {isCollapsed && (
        <div style={{ marginTop: 9, color: 'var(--state-critical)', fontSize: 11, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
          ⚠ Struttura non recuperabile — inforna immediatamente
        </div>
      )}
    </div>
  );
}

// ─── Modal collasso strutturale (non dismissibile) ────────────────────────────

export function CollapseModal({
  message, onBake, onEnd, onContinue,
}: {
  message: string;
  /** "Inforna adesso": registra l'infornata (stesso flusso di "Ho infornato"). */
  onBake: () => void;
  onEnd: () => void; onContinue: () => void;
}) {
  // Il primo comando (a fuoco all'apertura) è quello sensato, non il distruttivo.
  const ref = useDialogFocus<HTMLDivElement>();
  // Terminare senza infornare chiude la sessione: chiede un secondo tocco.
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="pm-collapse-title" aria-describedby="pm-collapse-msg" style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(40,6,6,0.97), rgba(8,6,5,0.98))',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24,
    }}>
      <div aria-hidden="true" className="pm4-glow-crit" style={{ color: 'var(--state-critical)', fontSize: 48 }}>⚠</div>
      <div id="pm-collapse-title" style={{
        color: 'var(--state-critical)', fontSize: 17, fontWeight: 800,
        textAlign: 'center', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
      }}>
        COLLASSO STRUTTURALE
      </div>
      {/* R2: distingue questa causa (proteolisi/glutine) dalla sbollatura da sovra-lievitazione */}
      <div style={{
        color: 'var(--pm4-tan)', fontSize: 12, textAlign: 'center',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', marginTop: -8,
      }}>
        causa: il glutine è stato consumato dagli enzimi
      </div>
      <div id="pm-collapse-msg" style={{ color: 'var(--pm4-tan)', fontSize: 13, textAlign: 'center', lineHeight: 1.6, maxWidth: 320 }}>
        {message}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320, marginTop: 8 }}>
        <button onClick={onBake} className="pm-btn-primary" style={{
          background: 'var(--accent-brand)', color: 'var(--bg-primary)', border: 'none',
          borderRadius: 9, padding: '14px 20px', minHeight: 52, fontSize: 15, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'var(--font-mono)',
        }}>
          🍕 Inforna adesso
        </button>
        <button onClick={onContinue} className="pm4-btn pm4-btn-ghost" style={{
          background: 'none', border: '1px solid var(--pm4-line-strong)', color: 'var(--pm4-tan)',
          fontSize: 13, cursor: 'pointer', borderRadius: 9, minHeight: 44,
          padding: '10px 22px', fontFamily: 'var(--font-mono)',
        }}>
          Continua a monitorare
        </button>
        <button onClick={confirmEnd ? onEnd : () => setConfirmEnd(true)} className="pm4-btn pm4-btn-danger-quiet" style={{
          background: 'none', border: '1px solid rgba(255,118,117,0.35)', color: 'var(--state-critical)',
          fontSize: 13, cursor: 'pointer', borderRadius: 9, minHeight: 44,
          padding: '10px 22px', fontFamily: 'var(--font-mono)',
        }}>
          {confirmEnd ? 'Sì, termina senza infornare' : 'Termina senza infornare'}
        </button>
      </div>
    </div>
  );
}
