/**
 * PizzaMatrix — Card "Credito del prefermento" (WP-2, v2.4.25)
 *
 * Two-Clock §2.0 reso visivo: il credito che un prefermento cede all'impasto è
 * DOPPIO e SEPARATO e va mostrato in due linguaggi distinti, MAI fusi:
 *   🟡 Enzimatico (giallo, UNITÀ: ore) — la biga è già matura → puntata più corta.
 *      Dato da breakdown.prefEnzAdu (già calcolato dal solver). NON ricalcola enzAdu.
 *   🔵 Termico (blu, UNITÀ: °C)        — la T della biga è il 4° fattore DDT (acqua).
 *      NON parla mai di tempo.
 *
 * Le due righe NON condividono barra né unità: è il vincolo Two-Clock reso visivo.
 */
import { AnimatedNumber, CoverageBar } from '../ui';

export interface PrefermentCreditCardProps {
  prefLabel: string;                 // es. "Biga 50% · 18h"
  enzymatic?: {                      // presente solo se prefEnzAdu > 0
    puntataBefore: number;           // breakdown.puntataRawNoCredit
    puntataAfter: number;            // breakdown.puntataRaw
    aduTarget: number; aduFridge: number; prefEnzAdu: number; aduNeeded: number;
  };
  thermal?: {                        // presente solo se DDT nFactors === 4
    prefTempC: number; nFactors: 4;
  };
}

export function PrefermentCreditCard({ prefLabel, enzymatic, thermal }: PrefermentCreditCardProps) {
  if (!enzymatic && !thermal) return null;

  const preMat = enzymatic ? Math.max(0.1, enzymatic.aduTarget - enzymatic.aduFridge) : 1;
  const coverage = enzymatic ? enzymatic.prefEnzAdu / preMat : 0;

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14,
      background: 'rgba(255,255,255,0.015)',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Credito del prefermento · {prefLabel}
      </div>

      {/* ── 🟡 Riga ENZIMATICA — unità: ore, mai acqua ── */}
      {enzymatic && (
        <div
          aria-label={`Credito enzimatico: la puntata scende da ${enzymatic.puntataBefore.toFixed(1)} a ${enzymatic.puntataAfter.toFixed(1)} ore`}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, color: '#eab308' }}>
              🟡 Enzimatico
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
              orologio maturazione · ore
            </span>
          </div>
          {/* Puntata: anima dal pre-credito al post-credito */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--font-mono)' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
              {enzymatic.puntataBefore.toFixed(1)}h
            </span>
            <span style={{ color: '#eab308' }}>→</span>
            <AnimatedNumber
              from={enzymatic.puntataBefore} to={enzymatic.puntataAfter}
              decimals={1} suffix="h"
              style={{ fontSize: '1.3rem', fontWeight: 800, color: '#eab308' }}
            />
            <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>puntata TA</span>
          </div>
          {/* Sottrazione esplicita */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--text-secondary)' }}>
            ADU: {enzymatic.aduTarget.toFixed(1)} − {enzymatic.aduFridge.toFixed(1)} (freddo)
            − {enzymatic.prefEnzAdu.toFixed(1)} (biga) = {enzymatic.aduNeeded.toFixed(1)} da fare a TA
          </div>
          <CoverageBar fraction={coverage} tone="enzymatic" label="quota maturazione coperta dalla biga" />
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            La biga è già matura: il tuo impasto parte avanti.
          </div>
        </div>
      )}

      {/* ── 🔵 Riga TERMICA — unità: °C, mai tempo ── */}
      {thermal && (
        <details
          aria-label={`Credito termico: la temperatura della biga (${thermal.prefTempC} gradi) è il quarto fattore DDT`}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <summary style={{ listStyle: 'none', cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, color: '#60a5fa' }}>
              🔵 Termico
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
              temperatura acqua · °C
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 800, color: '#60a5fa', marginLeft: 'auto' }}>
              {thermal.prefTempC}°C
            </span>
          </summary>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--text-secondary)', lineHeight: 1.5, paddingTop: 8 }}>
            La temperatura del prefermento è il <strong>4° fattore</strong> nel bilancio DDT:
            <div style={{ marginTop: 6, color: '#60a5fa' }}>
              T_acqua = DDT×4 − T_amb − T_farina − T_pref − C_attrito
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
