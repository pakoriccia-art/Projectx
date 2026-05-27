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
import { type WaterTempResult, ICE_THRESHOLD_C } from '../../engine';
import { Metric, S } from '../ui';

// ─── Colore contestuale in base al risultato ──────────────────────────────────
function resultColor(result: WaterTempResult): string {
  if (result.mode === 'ice')   return 'var(--state-cold)';
  if (result.tWaterCalc > 28) return 'var(--accent-warning)';
  if (result.tWaterCalc < 10) return 'var(--accent-info)';
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
}: {
  result:       WaterTempResult;
  showFormula?: boolean;
  compact?:     boolean;
  ddtTarget?:   number;
  tAmbient?:    number;
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {result.mode === 'liquid' ? (
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
          C={result.cFriction}°C
        </span>
      </div>
    );
  }

  // ── Modalità card verticale ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {result.mode === 'liquid' ? (
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
          {result.tWaterCalc > 28 && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
              ⚠ Temperatura alta — verifica DDT o C_attrito
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Metric label="C_attrito" value={result.cFriction} unit="°C" />
            <Metric label="Fattori" value={result.factors === 4 ? '4 (indiretto)' : '3 (diretto)'} />
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ ...S.label, marginBottom: 4 }}>Ghiaccio tritato</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 800, color: 'var(--state-cold)' }}>
                {result.iceGrams}
              </div>
              <div style={{ ...S.unit }}>g</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ ...S.label, marginBottom: 4 }}>Acqua liquida</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-info)' }}>
                {result.liquidGrams}
              </div>
              <div style={{ ...S.unit }}>g</div>
            </div>
          </div>
          {/* Totale */}
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            Totale acqua ricetta: {result.waterTotalGrams}g
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Acqua a {result.tWaterEffective}°C · Ghiaccio a 0°C · L=80 cal/g
          </div>
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
