/**
 * PizzaMatrix — Primitive di feedback UX (v2.4.25)
 *
 * Componenti riusabili per i 5 rami condizionali del Wizard. Tutte:
 *  • target tap ≥ 44px dove interattive
 *  • fallback prefers-reduced-motion (niente animazione → stato finale diretto)
 *  • nessuna informazione veicolata dal solo colore (sempre testo/emoji affiancata)
 *
 * Animazioni JS-driven (rAF / Element.animate) per non dipendere da @keyframes globali.
 */
import { type ReactNode, useState, useEffect, useRef } from 'react';

// ─── useReducedMotion ─────────────────────────────────────────────────────────
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// ─── Badge ──────────────────────────────────────────────────────────────────
// Pill con `tone`. Manual/advanced/base + stati semaforo (§7.9).
type BadgeTone =
  | 'manual' | 'advanced' | 'base' | 'derived'
  | 'too_early' | 'ok' | 'warning' | 'critical' | 'collapsed';

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  manual:    { bg: 'rgba(116,185,255,0.14)', fg: '#74b9ff', bd: 'rgba(116,185,255,0.35)' },
  advanced:  { bg: 'rgba(34,197,94,0.14)',   fg: '#22c55e', bd: 'rgba(34,197,94,0.35)' },
  base:      { bg: 'rgba(255,255,255,0.06)', fg: 'var(--text-muted)', bd: 'rgba(255,255,255,0.12)' },
  derived:   { bg: 'rgba(45,212,191,0.14)',  fg: '#2dd4bf', bd: 'rgba(45,212,191,0.35)' },
  too_early: { bg: 'rgba(107,114,128,0.18)', fg: '#9ca3af', bd: 'rgba(107,114,128,0.4)' },
  ok:        { bg: 'rgba(34,197,94,0.14)',   fg: '#22c55e', bd: 'rgba(34,197,94,0.35)' },
  warning:   { bg: 'rgba(234,179,8,0.14)',   fg: '#eab308', bd: 'rgba(234,179,8,0.35)' },
  critical:  { bg: 'rgba(239,68,68,0.14)',   fg: '#ef4444', bd: 'rgba(239,68,68,0.35)' },
  collapsed: { bg: 'rgba(127,29,29,0.20)',   fg: '#fca5a5', bd: 'rgba(127,29,29,0.5)' },
};

export function Badge({
  tone, children, onClick, ariaLabel,
}: {
  tone: BadgeTone; children: ReactNode; onClick?: () => void; ariaLabel?: string;
}) {
  const t = BADGE_TONES[tone];
  const interactive = !!onClick;
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
    borderRadius: 999, padding: interactive ? '6px 10px' : '2px 8px',
    minHeight: interactive ? 44 : undefined,
    fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 700,
    letterSpacing: '0.02em', cursor: interactive ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
  };
  if (interactive) {
    return <button type="button" onClick={onClick} aria-label={ariaLabel} style={style}>{children}</button>;
  }
  return <span aria-label={ariaLabel} style={style}>{children}</span>;
}

// ─── Advisory ─────────────────────────────────────────────────────────────────
// Banner inline dismissibile, con slot undo opzionale.
// tone teal → role="status"; tone amber → role="alert".
export function Advisory({
  tone = 'teal', text, onUndo, undoLabel = 'Annulla', dismissible = true, onDismiss,
}: {
  tone?: 'teal' | 'amber'; text: string;
  onUndo?: () => void; undoLabel?: string;
  dismissible?: boolean; onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const c = tone === 'amber'
    ? { fg: '#eab308', bg: 'rgba(234,179,8,0.10)', bd: 'rgba(234,179,8,0.4)', icon: '⚠' }
    : { fg: '#2dd4bf', bg: 'rgba(45,212,191,0.10)', bd: 'rgba(45,212,191,0.4)', icon: 'ℹ' };
  return (
    <div
      role={tone === 'amber' ? 'alert' : 'status'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: c.bg, border: `1px solid ${c.bd}`, borderLeft: `4px solid ${c.fg}`,
        borderRadius: 'var(--radius-sm)', padding: '10px 12px',
      }}
    >
      <span style={{ color: c.fg, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.3 }}>{c.icon}</span>
      <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>
        {text}
        {onUndo && (
          <button type="button" onClick={() => { onUndo(); setOpen(false); }}
            style={{
              display: 'block', marginTop: 6, minHeight: 44,
              background: 'transparent', border: `1px solid ${c.bd}`, borderRadius: 'var(--radius-sm)',
              color: c.fg, fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700,
              padding: '8px 14px', cursor: 'pointer',
            }}>
            ↩ {undoLabel}
          </button>
        )}
      </div>
      {dismissible && (
        <button type="button" aria-label="Chiudi avviso"
          onClick={() => { setOpen(false); onDismiss?.(); }}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer',
            minWidth: 44, minHeight: 44, lineHeight: 1, padding: 0,
          }}>
          ×
        </button>
      )}
    </div>
  );
}

// ─── AnimatedNumber ─────────────────────────────────────────────────────────
// Interpola from→to in ~600ms (ease-out). Reduced-motion → salta a `to`.
export function AnimatedNumber({
  from, to, durationMs = 600, decimals = 1, suffix = '', style,
}: {
  from: number; to: number; durationMs?: number; decimals?: number;
  suffix?: string; style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  const [val, setVal] = useState(from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) { setVal(to); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);  // ease-out cubic
      setVal(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [from, to, durationMs, reduced]);

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {val.toFixed(decimals)}{suffix}
    </span>
  );
}

// ─── CoverageBar ──────────────────────────────────────────────────────────────
// Barra orizzontale 0–1 con tone. Mostra sempre la percentuale come testo.
export function CoverageBar({
  fraction, tone = 'enzymatic', label,
}: {
  fraction: number; tone?: 'enzymatic' | 'thermal' | 'neutral'; label?: string;
}) {
  const color = tone === 'enzymatic' ? '#eab308' : tone === 'thermal' ? '#60a5fa' : 'var(--text-secondary)';
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          <span>{label}</span><span style={{ color }}>{pct.toFixed(0)}%</span>
        </div>
      )}
      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.5s var(--ease-out, ease-out)' }} />
      </div>
    </div>
  );
}

// ─── MassSplitBar ───────────────────────────────────────────────────────────
// Barra a 2 segmenti che scompone un totale noto. Grammi come testo (non solo larghezza).
export function MassSplitBar({
  segA, segB,
}: {
  segA: { grams: number; label: string; color: string };
  segB: { grams: number; label: string; color: string };
}) {
  const total = Math.max(1, segA.grams + segB.grams);
  const aPct = (segA.grams / total) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${aPct}%`, background: segA.color, transition: 'width 0.4s var(--ease-out, ease-out)' }} />
        <div style={{ width: `${100 - aPct}%`, background: segB.color, transition: 'width 0.4s var(--ease-out, ease-out)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
        <span style={{ color: segA.color }}>{segA.label} {Math.round(segA.grams)} g</span>
        <span style={{ color: segB.color }}>{segB.label} {Math.round(segB.grams)} g</span>
      </div>
    </div>
  );
}

// ─── ExpandableReward ─────────────────────────────────────────────────────────
// "Dormiente" (bordo tratteggiato + CTA) → si espande quando `unlocked` diventa true.
export function ExpandableReward({
  unlocked, dormantCta, children, tone = 'neutral',
}: {
  unlocked: boolean; dormantCta: ReactNode; children: ReactNode;
  tone?: 'neutral' | 'amber';
}) {
  const reduced = useReducedMotion();
  const innerRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState(unlocked ? 'none' : '0px');

  useEffect(() => {
    if (reduced) { setMaxH(unlocked ? 'none' : '0px'); return; }
    if (unlocked && innerRef.current) {
      const h = innerRef.current.scrollHeight;
      setMaxH(`${h}px`);
      const t = setTimeout(() => setMaxH('none'), 260);  // after transition → auto
      return () => clearTimeout(t);
    }
    setMaxH('0px');
  }, [unlocked, reduced, children]);

  const borderColor = tone === 'amber' ? '#eab308' : 'rgba(255,255,255,0.18)';

  if (!unlocked) {
    return (
      <div style={{
        border: `1px dashed ${borderColor}`, borderRadius: 'var(--radius-md)',
        padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {dormantCta}
      </div>
    );
  }
  return (
    <div style={{
      border: `1px solid ${tone === 'amber' ? 'rgba(234,179,8,0.4)' : 'rgba(255,255,255,0.1)'}`,
      borderRadius: 'var(--radius-md)',
      maxHeight: maxH, overflow: maxH === 'none' ? 'visible' : 'hidden',
      transition: reduced ? undefined : 'max-height 0.24s var(--ease-out, ease-out)',
    }}>
      <div ref={innerRef} style={{ padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  );
}

// ─── animateOnce — helper per pulse/shake via Web Animations API ──────────────
// Rispetta reduced-motion a monte (chi chiama non invoca se reduced).
export function pulseElement(el: HTMLElement | null) {
  if (!el || !el.animate) return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
    { duration: 180, easing: 'ease-out' },
  );
}

export function shakeElement(el: HTMLElement | null) {
  if (!el || !el.animate) return;
  el.animate(
    [
      { transform: 'translateX(0)' }, { transform: 'translateX(-3px)' },
      { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 200, easing: 'ease-in-out' },
  );
}
