/**
 * PizzaMatrix — Componente display T_acqua (§2.7 DDT)
 *
 * WaterTempResultCard — display puro, senza stato interno.
 * Riceve un WaterTempResult già calcolato e mostra:
 *   • Modalità liquid: T_acqua + grammi totali con colore contestuale
 *   • Modalità ice: grammi ghiaccio + grammi acqua liquida
 *
 * Usato in:
 *   • WizardView Step 4 — live inline (compact=true)
 *   • WizardView Step 8 — card compatta con formula (showFormula=true)
 *   • DashboardView    — card di riferimento impasto (showFormula=false)
 */
import type React from 'react';
import { type WaterTempResult, ICE_THRESHOLD_C } from '../../engine';
import { Metric, S, MassSplitBar } from '../ui';

// ─── WP-4: mappa leva (stringa engine) → chip d'azione ────────────────────────
// Le stringhe levers[] sono testo libero dal motore: si mappa per keyword. Le leve
// note diventano chip con freccia di verso + target step; le sconosciute restano
// chip informative non-naviganti (fallback safe). onLever (opzionale) naviga.
type LeverTarget = 'knead' | 'tAmb' | 'hydration' | 'tapWater';
interface LeverCfg { match: RegExp; icon: string; target: LeverTarget }
const LEVER_CONFIG: LeverCfg[] = [
  { match: /idratazion/i,            icon: '↓', target: 'hydration' },
  { match: /durat|impast|più cort/i, icon: '↓', target: 'knead' },
  { match: /ambient|t\s*amb|temperatura ambiente/i, icon: '↓', target: 'tAmb' },
  { match: /rubinetto|acqua più fredd|acqua fredd/i, icon: '❄', target: 'tapWater' },
];
function leverFor(text: string): LeverCfg | null {
  return LEVER_CONFIG.find(c => c.match.test(text)) ?? null;
}

// ─── Colore contestuale in base al risultato ──────────────────────────────────
function resultColor(result: WaterTempResult): string {
  if (result.mode === 'unreachable') return 'var(--accent-warning)';
  if (result.mode === 'ice')         return 'var(--state-cold)';
  if (result.tWaterCalc > 28)        return 'var(--accent-warning)';
  if (result.tWaterCalc < 10)        return 'var(--accent-info)';
  return 'var(--state-optimal-lo)';
}

/**
 * Display puro del risultato DDT acqua.
 *
 * @param result        WaterTempResult da computeWaterTempDDT()
 * @param showFormula   Se true mostra la formula DDT sotto il risultato
 * @param compact       Se true layout inline orizzontale (Step 4); false layout verticale (Step 8, Dashboard)
 * @param ddtTarget     DDT target usato nel calcolo (per la formula)
 * @param tAmbient      T_amb usato nel calcolo (per la formula)
 */
export function WaterTempResultCard({
  result,
  showFormula = false,
  compact = false,
  ddtTarget,
  tAmbient,
  variant = 'interactive',
  onLever,
}: {
  result:       WaterTempResult;
  showFormula?: boolean;
  compact?:     boolean;
  ddtTarget?:   number;
  tAmbient?:    number;
  // WP-4: 'interactive' (Step 4, ricalcolo live) | 'summary' (Step 8, consuntivo;
  // se unreachable mostra hint di blocco). onLever naviga allo step della leva.
  variant?:     'interactive' | 'summary';
  onLever?:     (target: LeverTarget) => void;
}) {
  const color = resultColor(result);

  // ── Stringa formula completa (valori sostituiti) ──────────────────────────
  const formulaStr = ddtTarget != null && tAmbient != null
    ? result.factors === 4
      ? `${ddtTarget}×4 − ${tAmbient} − ${result.tempFlour.toFixed(0)} − T_pref − ${result.cFriction}`
      : `${ddtTarget}×3 − ${tAmbient} − ${result.tempFlour.toFixed(0)} − ${result.cFriction}`
    : null;

  // ── Modalità compact: riga orizzontale inline ─────────────────────────────
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {result.mode === 'unreachable' ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent-warning)' }}>
              ⚠ Target irraggiungibile — riduci durata o alza TMD
            </span>
          ) : result.mode === 'liquid' ? (
            <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                💧 Acqua consigliata:
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 800, color }}>
                {result.tWaterLiquid!.toFixed(1)}°C
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                · {result.waterTotalGrams}g
              </span>
              {result.tWaterCalc < 10 && (
                <span style={{ fontSize: '0.7rem', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
                  (fredda — frigo)
                </span>
              )}
            </>
          ) : (
            <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--state-cold)' }}>
                ❄ Ghiaccio:
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--state-cold)' }}>
                {result.iceGrams}g
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                + {result.liquidGrams}g acqua ({result.waterTotalGrams}g tot.)
              </span>
            </>
          )}
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            C={result.cFriction.toFixed(1)}°C
          </span>
        </div>
        {result.exitWarning && result.exitTempC != null && (
          <div style={{ fontSize: '0.7rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
            ⚠ Uscita prevista {result.exitTempC.toFixed(1)}°C — glutine tende a slegarsi (&gt;{27}°C)
          </div>
        )}
      </div>
    );
  }

  // ── Modalità card verticale ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {result.mode === 'unreachable' ? (
        /* Target irraggiungibile (v2.4.24) */
        <>
          <div role="alert" style={{
            background: 'rgba(255,200,0,0.07)',
            border: '1px solid var(--accent-warning)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
          }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              ⚠ Target irraggiungibile
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              T_acqua richiesta {result.requiredWaterTempC?.toFixed(1)}°C — impossibile anche con tutto ghiaccio
            </div>
          </div>
          {result.levers && result.levers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Leve disponibili{onLever ? ' — tocca per modificare' : ''}:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {result.levers.map((l, i) => {
                  const cfg = leverFor(l);
                  const navigable = !!(cfg && onLever);
                  const chipStyle: React.CSSProperties = {
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    minHeight: 44, padding: '8px 12px', borderRadius: 999,
                    fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                    background: navigable ? 'rgba(255,200,0,0.10)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${navigable ? 'rgba(255,200,0,0.35)' : 'rgba(255,255,255,0.12)'}`,
                    color: navigable ? 'var(--accent-warning)' : 'var(--text-secondary)',
                    cursor: navigable ? 'pointer' : 'default',
                  };
                  if (navigable) {
                    return (
                      <button key={i} type="button" onClick={() => onLever!(cfg!.target)}
                        aria-label={`${l} — vai a modificare`} style={chipStyle}>
                        <span aria-hidden="true">{cfg!.icon}</span>{l}
                      </button>
                    );
                  }
                  return (
                    <span key={i} style={chipStyle}>
                      {cfg && <span aria-hidden="true">{cfg.icon}</span>}{l}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {variant === 'summary' && (
            <div style={{ fontSize: '0.72rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
              Risolvi prima di confermare: tocca una leva per modificarla.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Metric label="C_attrito" value={result.cFriction.toFixed(1)} unit="°C" />
            <Metric label="Fattori" value={result.factors === 4 ? '4 (indiretto)' : '3 (diretto)'} />
          </div>
        </>
      ) : result.mode === 'liquid' ? (
        /* Acqua liquida */
        <>
          {/* Temperatura + grammi in evidenza */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...S.value, fontSize: '2rem', color }}>
              {result.tWaterLiquid!.toFixed(1)}
            </span>
            <span style={{ ...S.unit, fontSize: '0.95rem' }}>°C</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700,
              color: 'var(--text-primary)', marginLeft: 6,
            }}>
              {result.waterTotalGrams}g
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)', marginLeft: 2 }}>
              acqua liquida
            </span>
          </div>

          {result.tWaterCalc < 10 && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
              ℹ Usa acqua di frigorifero
            </div>
          )}
          {result.tWaterCalc > 28 && !result.exitWarning && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
              ⚠ Temperatura alta — verifica DDT o C_attrito
            </div>
          )}
          {result.exitWarning && result.exitTempC != null && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
              ⚠ Impasto caldo: uscita prevista {result.exitTempC.toFixed(1)}°C — glutine tende a slegarsi
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Metric label="C_attrito" value={result.cFriction.toFixed(1)} unit="°C" />
            <Metric label="Fattori" value={result.factors === 4 ? '4 (indiretto)' : '3 (diretto)'} />
            {result.frictionRiseC != null && (
              <Metric label="ΔT_attrito" value={result.frictionRiseC.toFixed(1)} unit="°C" />
            )}
            {result.exitTempC != null && (
              <Metric label="T uscita" value={result.exitTempC.toFixed(1)} unit="°C" />
            )}
          </div>
        </>
      ) : (
        /* Ghiaccio */
        <>
          <div style={{
            background: 'rgba(100,180,255,0.07)',
            border: '1px solid var(--state-cold)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
          }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--state-cold)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              ❄ Usa ghiaccio tritato
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              T_acqua calcolata ({result.tWaterCalc.toFixed(1)}°C) è sotto {ICE_THRESHOLD_C}°C
            </div>
          </div>
          {/* WP-4: MassSplitBar — i due segmenti sommano al totale noto (invariante di
              massa resa visiva: impossibile sbagliare la somma). */}
          <MassSplitBar
            segA={{ grams: result.iceGrams ?? 0, label: '🧊 ghiaccio', color: 'var(--state-cold)' }}
            segB={{ grams: result.liquidGrams ?? 0, label: '💧 acqua', color: 'var(--accent-info)' }}
          />
          {/* Totale */}
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            Totale acqua ricetta: {result.waterTotalGrams}g
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Acqua a {result.tWaterEffective}°C · Ghiaccio a 0°C · L=80 cal/g
          </div>
          {result.exitWarning && result.exitTempC != null && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
              ⚠ Impasto caldo: uscita prevista {result.exitTempC.toFixed(1)}°C — glutine tende a slegarsi
            </div>
          )}
        </>
      )}

      {/* Formula DDT (opzionale) — tutti i valori sostituiti */}
      {showFormula && formulaStr != null && (
        <div style={{
          fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6, marginTop: 2,
        }}>
          {formulaStr}
          {' '}= <strong style={{ color }}>{result.tWaterCalc.toFixed(1)}°C</strong>
        </div>
      )}
    </div>
  );
}

// Re-export convenienza per chi importa solo il tipo result
export type { WaterTempResult };
