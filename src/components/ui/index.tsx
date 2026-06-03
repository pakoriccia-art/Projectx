/**
 * PizzaMatrix — Shared UI Primitives
 * Design system §6: tokens, typography, interaction patterns
 */
import { type InputHTMLAttributes, type ReactNode, useState, useEffect, useRef } from 'react';

const S = {
  // Card
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px',
  } as React.CSSProperties,
  cardElevated: {
    background: 'var(--bg-elevated)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px',
  } as React.CSSProperties,
  // Typography — scala 11/12/15/18/22/32px (KB §1.4)
  label: {
    fontSize: '0.75rem',          // 12px — era 0.72rem (11.5, fuori scala)
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  value: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.6rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',  // KB §1.4: anti-jitter numeri live
  } as React.CSSProperties,
  unit: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',          // 12px — era 0.8rem (12.8, fuori scala)
    color: 'var(--text-secondary)',
    marginLeft: '4px',
  } as React.CSSProperties,
  btn: {
    background: 'var(--accent-brand)',
    color: '#0a0806',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '12px 20px',         // era 13px (fuori scala 4px)
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    fontSize: '0.9rem',
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  btnSecondary: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 20px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9rem',
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  input: {
    background: 'var(--bg-elevated)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 16px',         // era 11px 14px (entrambi fuori scala)
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '1rem',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,
};

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, elevated, style }: { children: ReactNode; elevated?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="pm-card" style={{ ...(elevated ? S.cardElevated : S.card), ...style }}>
      {children}
    </div>
  );
}

// ─── Metric Display ───────────────────────────────────────────────────────────
export function Metric({
  label, value, unit, color, live,
}: {
  label: string; value: string | number; unit?: string; color?: string;
  live?: boolean;  // true → aria-live="polite" per screen-reader (KB §3.3)
}) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (live && prevRef.current !== value) {
      prevRef.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(t);
    }
  }, [value, live]);

  const glowClass = color === 'var(--state-critical)' ? ' pm-glow-critical'
                  : color === 'var(--state-danger)'   ? ' pm-glow-danger'
                  : color === 'var(--state-optimal-hi)' || color === 'var(--accent-brand)' ? ' pm-glow-optimal'
                  : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={S.label}>{label}</span>
      <div
        style={{ display: 'flex', alignItems: 'baseline' }}
        aria-live={live ? 'polite' : undefined}
        aria-atomic={live ? 'true' : undefined}
      >
        <span
          className={`${flash ? 'pm-num-flash' : ''}${glowClass}`}
          style={{ ...S.value, color: color ?? 'var(--text-primary)' }}
        >
          {typeof value === 'number' ? value.toFixed(1) : value}
        </span>
        {unit && <span style={S.unit}>{unit}</span>}
      </div>
    </div>
  );
}

// ─── NumInput (fix floating point §9 bug #8) ──────────────────────────────────
// Bug fix: onChange non deve propagare valori intermedi durante la digitazione
// (es. typing "350" propagava 3 → 35 → 350 ad ogni tasto).
// Ora il valore viene committato solo su blur o tasto Enter.
// useEffect sincronizza il display se il prop value cambia dall'esterno.
export function NumInput({
  label, value, onChange, min, max, step = 1, unit,
  ...rest
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const [raw, setRaw]       = useState(String(value));
  const [dirty, setDirty]   = useState(false);

  // Sincronizza display quando il valore esterno cambia (es. wizard reset)
  useEffect(() => {
    if (!dirty) setRaw(String(value));
  }, [value, dirty]);

  const commit = () => {
    setDirty(false);
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) { setRaw(String(value)); return; }
    const clamped = min != null && max != null
      ? Math.max(min, Math.min(max, parsed))
      : parsed;
    setRaw(String(clamped));
    onChange(clamped);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label style={S.label}>{label}{unit ? ` (${unit})` : ''}</label>
      <input
        type="number" value={raw}
        onChange={e => { setRaw(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        min={min} max={max} step={step}
        className="pm-input" style={S.input} {...rest}
      />
    </div>
  );
}

// ─── SliderInput ──────────────────────────────────────────────────────────────
export function SliderInput({
  label, value, onChange, min, max, step = 1, unit, color,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string; color?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={S.label}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: color ?? 'var(--accent-brand)' }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color ?? 'var(--accent-brand)' }}
      />
    </div>
  );
}

// ─── SnapButtons (scelte rapide §6.3) ────────────────────────────────────────
export function SnapButtons<T extends string>({
  label, options, value, onChange,
}: {
  label?: string;
  options: { value: T; label: string; desc?: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {label && <span style={S.label}>{label}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`pm-snap-btn${value === opt.value ? ' pm-snap-active' : ''}`}
            style={{
              background: value === opt.value ? 'var(--accent-brand)' : 'var(--bg-elevated)',
              color: value === opt.value ? '#0a0806' : 'var(--text-secondary)',
              border: value === opt.value ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              fontWeight: value === opt.value ? 700 : 400,
              cursor: 'pointer',
              flex: '1 1 auto',
              minWidth: '80px',
              textAlign: 'center',
            }}
          >
            {opt.label}
            {opt.desc && (
              <div style={{ fontSize: '0.69rem', fontWeight: 400, marginTop: '4px', opacity: 0.7 }}>
                {opt.desc}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Btn({
  children, onClick, variant = 'primary', disabled,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  const base = variant === 'primary' ? S.btn
             : variant === 'danger'
               ? { ...S.btn, background: 'var(--state-critical)', color: '#fff' }
               : S.btnSecondary;
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={`pm-btn-${variant}`}
      style={{ ...base, opacity: disabled ? 0.38 : 1 }}
    >
      {children}
    </button>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const c = color ?? (pct >= 85 ? 'var(--state-optimal-hi)'
           : pct >= 65 ? 'var(--state-optimal-lo)'
           : pct >= 30 ? 'var(--state-approaching)'
           : 'var(--state-underfermented)');
  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: c, transition: 'width 0.5s var(--ease-out)' }} />
    </div>
  );
}

// ─── Alert Badge ──────────────────────────────────────────────────────────────
export function AlertBadge({ level, message }: { level: string; message: string }) {
  const colors: Record<string, string> = {
    info:     'var(--accent-info)',
    advisory: 'var(--accent-warning)',
    critical: 'var(--state-critical)',
    collapse: 'var(--state-collapsed)',
  };
  return (
    <div style={{
      background: `${colors[level] ?? colors.info}18`,
      border: `1px solid ${colors[level] ?? colors.info}44`,
      borderLeft: `4px solid ${colors[level] ?? colors.info}`,
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontFamily: 'var(--font-body)',
      fontSize: '0.75rem',
      color: 'var(--text-primary)',
    }}>
      {message}
    </div>
  );
}

// ─── Step Header ──────────────────────────────────────────────────────────────
export function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i < step ? 'var(--accent-brand)' : 'rgba(255,255,255,0.08)',
          }} />
        ))}
      </div>
      <span style={{ ...S.label, marginBottom: '4px', display: 'block' }}>
        Passo {step} di {total}
      </span>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1.4rem',
        fontWeight: 700,
        color: 'var(--text-primary)',
        margin: 0,
      }}>
        {title}
      </h2>
    </div>
  );
}

export { S };

// ─── FormSection ──────────────────────────────────────────────────────────────
// Raggruppa input correlati con un label-divider orizzontale e sfondo micro-elevato.
// Sostituisce blocchi di flex-column flat senza contesto visivo.
export function FormSection({
  title, children, accent,
}: { title: string; children: ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Divider con etichetta centrata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
        <span style={{
          fontSize: '0.69rem', letterSpacing: '0.14em', textTransform: 'uppercase',
          color: accent ?? 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
      </div>
      {/* Contenuto con sfondo leggermente differenziato */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        background: 'rgba(255,255,255,0.015)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        border: '1px solid rgba(255,255,255,0.04)',
      }}>
        {children}
      </div>
    </div>
  );
}

// ─── Row2 ─────────────────────────────────────────────────────────────────────
// Grid a 2 colonne bilanciata per affiancare coppie di input correlati.
export function Row2({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap }}>
      {children}
    </div>
  );
}
