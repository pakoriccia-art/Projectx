/**
 * PizzaMatrix — Controllo Temperatura Idrica (§2.7 DDT)
 *
 * Calcola la temperatura ottimale dell'acqua di impastamento per raggiungere
 * la Temperatura Desiderata Finale (DDT) dell'impasto, tenendo conto del
 * calore generato dall'attrito meccanico della macchina.
 *
 * Se T_acqua < 3°C: attiva automaticamente la modalità ghiaccio con bilancio
 * entalpico esatto (L_fusione = 80 cal/g).
 *
 * Formule:
 *   Diretto:   T_acqua = DDT × 3 − T_amb − T_farina − C_attrito
 *   Indiretto: T_acqua = DDT × 4 − T_amb − T_farina − T_preimpasto − C_attrito
 *   Ghiaccio:  M_ghiaccio = M_acqua × (T_avail − T_calc) / (80 + T_avail)
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Card, Metric, NumInput, SnapButtons, Row2, FormSection, S,
} from '../ui';
import {
  KNEADING_METHODS_FRICTION,
  ICE_THRESHOLD_C,
  computeWaterTempDDT,
  type KneadingMethod,
  type WaterTempResult,
} from '../../engine';

// ─── Colori per stato risultato ───────────────────────────────────────────────
function resultColor(result: WaterTempResult): string {
  if (result.mode === 'ice')    return 'var(--state-cold)';
  if (result.tWaterCalc > 28)  return 'var(--accent-warning)';   // acqua calda → errore
  if (result.tWaterCalc < 10)  return 'var(--accent-info)';       // acqua molto fredda
  return 'var(--state-optimal-lo)';                                 // zona ottimale
}

// ─── Variante C_attrito ───────────────────────────────────────────────────────
const FRICTION_VARIANTS = [
  { value: 'lo',  label: 'Bassa vel.' },
  { value: 'mid', label: 'Media vel.' },
  { value: 'hi',  label: 'Alta vel.'  },
] as const;

// ─── Widget "Controllo Temperatura Idrica" ─────────────────────────────────────
// Componente riusabile: usato sia come view standalone che in wizard Step 8.
export function WaterTempWidget({
  waterTotalGrams,
  hasPreferment = false,
  initialDdtTarget = 24,
  initialKneadingMethod = 'spiral' as KneadingMethod,
}: {
  waterTotalGrams: number;
  hasPreferment?: boolean;
  initialDdtTarget?: number;
  initialKneadingMethod?: KneadingMethod;
}) {
  const [ddtTarget,      setDdtTarget]      = useState(initialDdtTarget);
  const [tempAmbient,    setTempAmbient]     = useState(22);
  const [tempFlour,      setTempFlour]       = useState(22);
  const [tempPreferment, setTempPreferment]  = useState(16);
  const [kneadingMethod, setKneadingMethod]  = useState<KneadingMethod>(initialKneadingMethod);
  const [cFrictionVariant, setCFrictionVariant] = useState<'lo' | 'mid' | 'hi'>('mid');
  const [usePreferment,  setUsePreferment]   = useState(hasPreferment);

  const result = useMemo<WaterTempResult>(() => {
    return computeWaterTempDDT({
      ddtTarget,
      tempAmbient,
      tempFlour,
      tempPreferment: usePreferment ? tempPreferment : undefined,
      kneadingMethod,
      cFrictionVariant,
      waterTotalGrams: waterTotalGrams > 0 ? waterTotalGrams : 650,
      waterAvailableTempC: ICE_THRESHOLD_C,
    });
  }, [ddtTarget, tempAmbient, tempFlour, tempPreferment, kneadingMethod, cFrictionVariant, usePreferment, waterTotalGrams]);

  const spec = KNEADING_METHODS_FRICTION[kneadingMethod];
  const color = resultColor(result);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Metodo di impasto ── */}
      <FormSection title="Impastatrice">
        <SnapButtons<KneadingMethod>
          options={Object.entries(KNEADING_METHODS_FRICTION).map(([k, v]) => ({
            value: k as KneadingMethod,
            label: v.label,
          }))}
          value={kneadingMethod}
          onChange={setKneadingMethod}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {FRICTION_VARIANTS.map(v => (
            <button key={v.value}
              onClick={() => setCFrictionVariant(v.value)}
              style={{
                flex: 1,
                padding: '5px 0',
                background: cFrictionVariant === v.value ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 'var(--radius-sm, 6px)',
                color: cFrictionVariant === v.value ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            >{v.label}</button>
          ))}
        </div>
        {/* Nota tecnica sul C_attrito scelto */}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          C_attrito = <strong style={{ color: 'var(--text-primary)' }}>{result.cFriction}°C</strong>
          {' '}(range: {spec.cFrictionLo}–{spec.cFrictionHi}°C)
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {spec.notes}
        </div>
      </FormSection>

      {/* ── Temperature di input ── */}
      <FormSection title="Temperature impasto">
        <Row2>
          <NumInput label="DDT target" unit="°C"
            value={ddtTarget} onChange={setDdtTarget} min={18} max={32} step={0.5} />
          <NumInput label="T ambiente" unit="°C"
            value={tempAmbient} onChange={setTempAmbient} min={5} max={40} step={0.5} />
        </Row2>
        <Row2>
          <NumInput label="T farina" unit="°C"
            value={tempFlour} onChange={setTempFlour} min={5} max={40} step={0.5} />
          <div>
            <div style={{ ...S.label, marginBottom: 4 }}>Pre-impasto</div>
            <button
              onClick={() => setUsePreferment(p => !p)}
              style={{
                width: '100%',
                padding: '8px',
                background: usePreferment ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 'var(--radius-sm, 6px)',
                color: usePreferment ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >{usePreferment ? '✓ Con biga/poolish' : '○ Diretto'}</button>
          </div>
        </Row2>
        {usePreferment && (
          <NumInput label="T pre-impasto (biga/poolish)" unit="°C"
            value={tempPreferment} onChange={setTempPreferment} min={2} max={30} step={0.5} />
        )}
        {/* Formula mostrata all'utente */}
        <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 4 }}>
          Formula: {result.factors === 4
            ? `${ddtTarget}×4 − ${tempAmbient} − ${tempFlour} − ${tempPreferment} − ${result.cFriction}`
            : `${ddtTarget}×3 − ${tempAmbient} − ${tempFlour} − ${result.cFriction}`
          } = <strong style={{ color }}>{result.tWaterCalc.toFixed(1)}°C</strong>
        </div>
      </FormSection>

      {/* ── Risultato — Controllo Temperatura Idrica ── */}
      <Card elevated style={{ border: `1px solid ${color}33` }}>
        <div style={{ ...S.label, color, marginBottom: 10 }}>
          💧 Controllo Temperatura Idrica
        </div>

        {result.mode === 'liquid' ? (
          /* Modalità acqua liquida */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...S.value, fontSize: '2.2rem', color }}>
                {result.tWaterLiquid!.toFixed(1)}
              </span>
              <span style={{ ...S.unit, fontSize: '1rem' }}>°C</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                acqua liquida
              </span>
            </div>
            {result.tWaterCalc < 12 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
                ℹ Usa acqua di frigorifero o mescola acqua fredda e fredda corrente
              </div>
            )}
            {result.tWaterCalc > 28 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)' }}>
                ⚠ Temperatura molto alta — verifica DDT o C_attrito
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <Metric label="DDT target" value={ddtTarget} unit="°C" />
              <Metric label="C_attrito" value={result.cFriction} unit="°C" />
            </div>
          </div>
        ) : (
          /* Modalità ghiaccio */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: 'rgba(100,180,255,0.08)',
              border: '1px solid var(--state-cold)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
            }}>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--state-cold)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                ❄ Usa ghiaccio tritato
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                T_acqua calcolata ({result.tWaterCalc.toFixed(1)}°C) è sotto {ICE_THRESHOLD_C}°C
                — impossibile con acqua liquida.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ ...S.label, marginBottom: 4 }}>Ghiaccio tritato</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.9rem', fontWeight: 800, color: 'var(--state-cold)' }}>
                  {result.iceGrams}
                </div>
                <div style={{ ...S.unit }}>g</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ ...S.label, marginBottom: 4 }}>Acqua liquida</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.9rem', fontWeight: 800, color: 'var(--accent-info)' }}>
                  {result.liquidGrams}
                </div>
                <div style={{ ...S.unit }}>g</div>
              </div>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Acqua liquida a {result.tWaterEffective}°C · Ghiaccio a 0°C
              · L_fusione = 80 cal/g
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Totale idrico: {waterTotalGrams > 0 ? waterTotalGrams : 650} g
              · Formula: M_g = M × ({result.tWaterEffective} − {result.tWaterCalc.toFixed(1)}) / (80 + {result.tWaterEffective})
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}

// ─── View standalone (navigabile dalla home) ──────────────────────────────────
export function WaterTempView() {
  const { dispatch } = useApp();

  // Massa acqua: inserita manualmente in questa view (non c'è sessione attiva)
  const [waterGrams, setWaterGrams] = useState(650);

  return (
    <div style={{ minHeight: '100dvh', padding: 'max(20px,env(safe-area-inset-top)) 16px 32px', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', padding: 0, width: 'auto', fontSize: '1.2rem', cursor: 'pointer' }}>
          ←
        </button>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            💧 Temperatura Acqua
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Calcolo DDT — bilancio termico impastamento
          </div>
        </div>
      </div>

      {/* Massa totale acqua ricetta */}
      <Card style={{ marginBottom: 16 }}>
        <NumInput
          label="Massa totale acqua ricetta"
          unit="g"
          value={waterGrams}
          onChange={setWaterGrams}
          min={50}
          max={20000}
          step={10}
        />
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
          Necessaria per il calcolo ghiaccio. Esempio: 1000 g farina × 65% = 650 g acqua.
        </div>
      </Card>

      {/* Widget principale */}
      <WaterTempWidget
        waterTotalGrams={waterGrams}
        hasPreferment={false}
        initialDdtTarget={24}
        initialKneadingMethod="spiral"
      />
    </div>
  );
}
