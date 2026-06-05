/**
 * PizzaMatrix — LiveHeader (Dashboard v4)
 * Header isolato con timer da 1s. Non causa re-render del parent DashboardV4
 * (il parent si aggiorna solo su cambio tickState).
 */
import { useState, useEffect } from 'react';
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
  bulk_room:    'Puntata TA',
  bulk_fridge:  'Puntata TC',
  balled_room:  'Staglio',
  balled_fridge:'Appretto TC',
  proofing:     'Lievitazione',
  baking:       'Cottura',
};

const BANNER_STYLE: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  STRUCTURAL_COLLAPSED: { bg: '#450a0a', border: '#7f1d1d', color: '#fca5a5', icon: '⛔' },
  STRUCTURAL_CRITICAL:  { bg: '#1f0a0a', border: '#ef4444', color: '#ef4444', icon: '⚠' },
  STRUCTURAL_WARNING:   { bg: '#1c1605', border: '#eab308', color: '#eab308', icon: '⚠' },
  SWEET_SPOT:           { bg: '#06201c', border: '#14b8a6', color: '#5eead4', icon: 'ℹ' },
};

const HEADER_S: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 100,
  background: '#0a0a0a', borderBottom: '1px solid #1f2937',
  padding: '12px 18px',
};
const TITLE_S: React.CSSProperties = {
  color: '#f9fafb', fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
};
const SUBTITLE_S: React.CSSProperties = {
  color: '#6b7280', fontSize: 10, marginTop: 3,
  fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
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
  const remainStr  = remainingH > 0.05 ? `${remainingH.toFixed(1)}h rimaste` : '🍕 cottura';
  const banner     = BANNER_STYLE[alertLevel];

  return (
    <header style={HEADER_S}>
      <div style={TITLE_S}>
        PizzaMatrix · {style?.toUpperCase()} · {totalFlourGrams}g
      </div>
      <div style={SUBTITLE_S}>
        {timeStr} · {PHASE_LABELS[currentPhase] ?? currentPhase} · +{elapsedH.toFixed(1)}h · {remainStr}
      </div>
      {banner && (
        <div style={{
          background: banner.bg, borderTop: `1px solid ${banner.border}`,
          padding: '8px 0', color: banner.color, fontSize: 11, fontFamily: 'monospace',
          marginTop: 8,
        }}>
          {banner.icon} {alertMessage}
        </div>
      )}
    </header>
  );
}

import type React from 'react';
