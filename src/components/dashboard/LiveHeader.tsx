/**
 * PizzaMatrix — LiveHeader (Dashboard v4 · skin "Banco")
 * Header strumento con timer isolato da 1s: non causa re-render del parent
 * DashboardV4 (che si aggiorna solo su cambio tickState).
 */
import { useState, useEffect } from 'react';
import type React from 'react';
import type { AlertLevel } from '../../engine';

interface LiveHeaderProps {
  style:          string;
  totalFlourGrams: number;
  startedAt:      Date;
  targetBakeAt:   Date;
  currentPhase:   string;
  alertLevel:     AlertLevel | string;
  alertMessage:   string;
}

const PHASE_LABELS: Record<string, string> = {
  bulk_room:    'Puntata · TA',
  bulk_fridge:  'Puntata · TC',
  balled_room:  'Staglio',
  balled_fridge:'Appretto · TC',
  proofing:     'Lievitazione',
  baking:       'Cottura',
};

const COLD_PHASES = new Set(['bulk_fridge', 'balled_fridge']);

const BANNER_STYLE: Record<string, { from: string; border: string; color: string; icon: string }> = {
  STRUCTURAL_COLLAPSED: { from: 'rgba(214,48,49,0.18)',  border: 'rgba(214,48,49,0.5)',  color: '#ffc9c7', icon: '⛔' },
  STRUCTURAL_CRITICAL:  { from: 'rgba(255,118,117,0.16)', border: 'rgba(255,118,117,0.45)', color: '#ff9c9a', icon: '⚠' },
  STRUCTURAL_WARNING:   { from: 'rgba(255,209,102,0.14)', border: 'rgba(255,209,102,0.4)', color: '#ffd166', icon: '⚠' },
  SWEET_SPOT:           { from: 'rgba(61,220,151,0.14)',  border: 'rgba(61,220,151,0.4)', color: '#7df0c2', icon: '◇' },
};

const HEADER_S: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 100,
  background: 'linear-gradient(180deg, rgba(12,9,6,0.97), rgba(12,9,6,0.74))',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  borderBottom: '1px solid var(--pm4-line)',
  padding: '14px 16px 13px',
};

export function LiveHeader({
  style, totalFlourGrams, startedAt, targetBakeAt, currentPhase, alertLevel, alertMessage,
}: LiveHeaderProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedH   = Math.max(0, (now.getTime() - startedAt.getTime()) / 3_600_000);
  const remainingH = Math.max(0, (targetBakeAt.getTime() - now.getTime()) / 3_600_000);
  const timeStr    = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const remainStr  = remainingH > 0.05 ? `${remainingH.toFixed(1)}h` : '🍕 ora';
  const banner     = BANNER_STYLE[alertLevel];
  const isCold     = COLD_PHASES.has(currentPhase);

  const K: React.CSSProperties = { fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--pm4-umber)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' };
  const V: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--pm4-tan)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 };

  return (
    <header style={HEADER_S}>
      {/* brand + segnale live */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '1.4rem', letterSpacing: '-0.02em', color: 'var(--pm4-flour)', textShadow: '0 0 22px rgba(255,140,50,0.26)' }}>
          Pizza<span style={{ color: 'var(--pm4-ember)' }}>Matrix</span>
          <span style={{ color: 'var(--pm4-ember)' }}>.</span>
        </span>
        <span style={{ ...K, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="pm4-live" /> live · {timeStr}
        </span>
      </div>

      {/* meta: stile · farina · trascorso · alla cottura · fase */}
      {/* R8: wrap + rowGap così su viewport stretti la pill-fase non viene troncata */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, rowGap: 8, marginTop: 11 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', color: 'var(--pm4-flour)' }}>
          {(style || '—').charAt(0).toUpperCase() + (style || '').slice(1)}
        </span>
        <span style={{ width: 1, height: 22, background: 'var(--pm4-line-strong)' }} />
        <div><div style={K}>Farina</div><div style={V}>{totalFlourGrams}<span style={{ color: 'var(--pm4-ember)' }}>g</span></div></div>
        <div><div style={K}>Trascorso</div><div style={V}>+{elapsedH.toFixed(1)}h</div></div>
        <div><div style={K}>Alla cottura</div><div style={{ ...V, color: 'var(--pm4-ember-lo)' }}>{remainStr}</div></div>
        <span style={{
          marginLeft: 'auto', flexShrink: 0, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-mono)',
          color: isCold ? 'var(--state-cold)' : 'var(--pm4-ember-lo)',
          border: `1px solid ${isCold ? 'rgba(116,185,255,0.35)' : 'rgba(255,209,102,0.3)'}`,
          background: isCold ? 'rgba(116,185,255,0.08)' : 'rgba(255,209,102,0.07)',
          padding: '5px 9px', borderRadius: 999,
        }}>
          {PHASE_LABELS[currentPhase] ?? currentPhase}
        </span>
      </div>

      {/* ribbon allarme */}
      {banner && (
        <div style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 9,
          padding: '9px 12px', borderRadius: 8,
          background: `linear-gradient(90deg, ${banner.from}, transparent)`,
          border: `1px solid ${banner.border}`, color: banner.color,
          fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.01em',
        }}>
          <span style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}>{banner.icon}</span>
          <span>{alertMessage}</span>
        </div>
      )}
    </header>
  );
}
