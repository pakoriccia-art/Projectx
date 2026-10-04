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
  totalFlourGrams?: number;
  startedAt:      Date;
  targetBakeAt:   Date;
  currentPhase:   string;
  alertLevel:     AlertLevel | string;
  alertMessage:   string;
  // v2.4.20: chip derivato dalla fase CANONICA corrente (single source of truth con
  // la strip). Se assenti, fallback alla mappa PHASE_LABELS per phaseType.
  currentPhaseLabel?: string;
  currentPhaseCold?:  boolean;
  // v2.4.21: advisory dedicato "impasto freddo a cottura" (cuore < 18°C). Ribbon
  // separato dagli alert strutturali — non entra in BANNER_STYLE/alertLevel.
  coldBakeWarning?:   string;
  /** Azione suggerita sui ribbon strutturali (→ Aggiusta Rotta). */
  onAdjust?:          () => void;
  /**
   * Cottura PREVISTA (stessa sorgente del blocco centrale): 'ORA' a pronto,
   * altrimenti l'orario. Il piano resta come riferimento secondario.
   */
  bakeForecast?: string;
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

// Solo gli allarmi strutturali hanno un ribbon: quasi pronto / pronto li dice già
// il blocco centrale, ripeterli qui era rumore.
const BANNER_STYLE: Record<string, { from: string; border: string; color: string; icon: string; action?: boolean }> = {
  STRUCTURAL_COLLAPSED: { from: 'rgba(214,48,49,0.18)',  border: 'rgba(214,48,49,0.5)',   color: 'var(--state-critical)', icon: '⛔' },
  STRUCTURAL_CRITICAL:  { from: 'rgba(255,118,117,0.16)', border: 'rgba(255,118,117,0.45)', color: 'var(--state-critical)', icon: '⚠', action: true },
  STRUCTURAL_WARNING:   { from: 'rgba(255,209,102,0.14)', border: 'rgba(255,209,102,0.4)',  color: 'var(--accent-warning)', icon: '⚠', action: true },
};

const HEADER_S: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 100,
  background: 'linear-gradient(180deg, rgba(12,9,6,0.97), rgba(12,9,6,0.74))',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  borderBottom: '1px solid var(--pm4-line)',
  padding: '14px 16px 13px',
};

export function LiveHeader({
  style, startedAt, targetBakeAt, currentPhase, alertLevel, alertMessage,
  currentPhaseLabel, currentPhaseCold, coldBakeWarning, onAdjust, bakeForecast,
}: LiveHeaderProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedH   = Math.max(0, (now.getTime() - startedAt.getTime()) / 3_600_000);
  const timeStr    = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  // Un solo orario di cottura: la previsione del blocco centrale. Il piano è il
  // riferimento piccolo accanto, senza "superato" (non è un errore, è il piano).
  const planClock  = targetBakeAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const bakeMain   = bakeForecast ?? planClock;
  const showPlan   = bakeForecast != null && bakeForecast.replace('~', '') !== planClock;
  const banner     = BANNER_STYLE[alertLevel];
  // v2.4.20: env dalla fase canonica se fornita, altrimenti dal phaseType.
  const isCold     = currentPhaseCold ?? COLD_PHASES.has(currentPhase);
  const phaseLabel = currentPhaseLabel ?? PHASE_LABELS[currentPhase] ?? currentPhase;

  const K: React.CSSProperties = { fontSize: 11, letterSpacing: '0.14em', color: 'var(--pm4-umber)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' };
  const V: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--pm4-tan)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 };

  return (
    <header style={HEADER_S}>
      {/* brand + segnale live */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '1.4rem', letterSpacing: '-0.02em', color: 'var(--pm4-flour)' }}>
          Pizza<span style={{ color: 'var(--pm4-ember)' }}>Matrix</span>
          <span style={{ color: 'var(--pm4-ember)' }}>.</span>
        </span>
        <span style={{ ...K, color: 'var(--pm4-tan)', display: 'flex', alignItems: 'center', gap: 6 }}>
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
        <div><div style={K}>Trascorso</div><div style={V}>{Math.floor(elapsedH)}h {String(Math.floor((elapsedH % 1) * 60)).padStart(2, '0')}m</div></div>
        <div>
          <div style={K}>Cottura</div>
          <div style={{ ...V, color: 'var(--pm4-flour)' }}>
            {bakeMain}
            {showPlan && <span style={{ color: 'var(--pm4-umber)', fontWeight: 400, fontSize: 11 }}> · piano {planClock}</span>}
          </div>
        </div>
        <span style={{
          marginLeft: 'auto', flexShrink: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-mono)',
          color: isCold ? 'var(--state-cold)' : 'var(--pm4-ember-lo)',
          border: `1px solid ${isCold ? 'rgba(116,185,255,0.35)' : 'rgba(255,209,102,0.3)'}`,
          background: isCold ? 'rgba(116,185,255,0.08)' : 'rgba(255,209,102,0.07)',
          padding: '5px 9px', borderRadius: 999,
        }}>
          {phaseLabel}
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
          <span aria-hidden="true">{banner.icon}</span>
          <span style={{ flex: 1 }}>{alertMessage}</span>
          {banner.action && onAdjust && (
            <button type="button" onClick={onAdjust} style={{
              background: 'none', border: `1px solid ${banner.border}`, borderRadius: 6, color: banner.color,
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, padding: '6px 10px', minHeight: 44,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              Aggiusta rotta →
            </button>
          )}
        </div>
      )}

      {/* ribbon advisory "impasto freddo a cottura" (v2.4.21) — separato dagli alert */}
      {coldBakeWarning && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 12px', borderRadius: 8,
          background: 'linear-gradient(90deg, rgba(116,185,255,0.12), transparent)',
          border: '1px solid rgba(116,185,255,0.4)', color: 'var(--state-cold)',
          fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.01em',
        }}>
          <span aria-hidden="true">❄</span>
          <span>{coldBakeWarning}</span>
        </div>
      )}
    </header>
  );
}
