/**
 * PizzaMatrix — Calcolatore Reverse Scaling (§2.18)
 * Input: prefermento disponibile → Output: ricetta completa
 * computeReverseScaling: availablePrefermKg, prefermType,
 *   targetFlourFraction, targetHydration, targetPanWeightG
 * → totalFlourKg, rinfrescoFlourKg, rinfrescoWaterKg,
 *   totalDoughKg, numPanetti, panWeight
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, SliderInput, NumInput, SnapButtons, S } from '../ui';
import { computeReverseScaling } from '../../engine';

interface ScalingResult {
  totalFlourKg:     number;
  rinfrescoFlourKg: number;
  rinfrescoWaterKg: number;
  totalDoughKg:     number;
  numPanetti:       number;
  panWeight:        number;
}

// ─── Tipi prefermento ─────────────────────────────────────────────────────────
const PREF_OPTIONS = [
  { value: 'poolish', label: 'Poolish', desc: 'Idratazione 100%' },
  { value: 'biga',    label: 'Biga',    desc: 'Idratazione 44–50%' },
] as const;

// ─── Idratazione tipica prefermento per preview ───────────────────────────────
const PREF_HYDRATION: Record<string, number> = {
  poolish: 100,
  biga:     48,
};

export function ReverseScalingView() {
  const { dispatch } = useApp();

  const [availKg,    setAvailKg]    = useState(2.0);
  const [prefType,   setPrefType]   = useState<'poolish' | 'biga'>('poolish');
  const [flourFrac,  setFlourFrac]  = useState(50);   // % farina totale
  const [hydration,  setHydration]  = useState(65);   // idratazione impasto finale
  const [panWeight,  setPanWeight]  = useState(260);  // g / panetto

  // ─── Calcolo live ───────────────────────────────────────────────────────────
  const result = useMemo<ScalingResult | null>(() => {
    if (availKg <= 0) return null;
    try {
      return (computeReverseScaling as Function)({
        availablePrefermKg:   availKg,
        prefermType:          prefType,
        targetFlourFraction:  flourFrac,
        targetHydration:      hydration,
        targetPanWeightG:     panWeight,
      }) as ScalingResult;
    } catch {
      return null;
    }
  }, [availKg, prefType, flourFrac, hydration, panWeight]);

  // ─── Prefermento breakdown preview ─────────────────────────────────────────
  // poolish: flour = water = availKg/2; biga: flour ≈ availKg*(100/(100+48))
  const prefHyd = PREF_HYDRATION[prefType];
  const prefFlourKg = availKg * 100 / (100 + prefHyd);
  const prefWaterKg = availKg - prefFlourKg;

  // ─── Lancia wizard con questi valori ───────────────────────────────────────
  const launchWizard = () => {
    if (!result) return;
    dispatch({ type: 'WIZARD_RESET' });
    dispatch({ type: 'WIZARD_UPDATE', patch: {
      totalFlourGrams: Math.round(result.totalFlourKg * 1000),
      numPanetti:      result.numPanetti,
      hydration,
    }});
    dispatch({ type: 'NAV', view: 'wizard' });
  };

  return (
    <div style={{
      minHeight: '100dvh',
      padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 20,
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          style={{ background: 'none', border: 'none', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer' }}
        >←</button>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Reverse Scaling
          </h2>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
            §2.18 · Da prefermento disponibile → ricetta completa
          </div>
        </div>
      </div>

      {/* ── Input: prefermento disponibile ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <NumInput
            label="Prefermento disponibile" unit="kg"
            value={availKg} onChange={setAvailKg}
            min={0.1} max={20} step={0.1}
          />
          <SnapButtons
            label="Tipo prefermento"
            options={PREF_OPTIONS as any}
            value={prefType}
            onChange={v => setPrefType(v as 'poolish' | 'biga')}
          />

          {/* Breakdown prefermento */}
          <Card elevated style={{ padding: '10px 14px' }}>
            <span style={{ ...S.label, marginBottom: 6, display: 'block' }}>
              Composizione {prefType} ({availKg.toFixed(2)} kg)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Metric label="Farina"  value={(prefFlourKg * 1000).toFixed(0)} unit="g" />
              <Metric label="Acqua"   value={(prefWaterKg * 1000).toFixed(0)} unit="g" />
              <Metric label="Idr."    value={prefHyd.toString()} unit="%" color="var(--pref-poolish)" />
            </div>
          </Card>
        </div>
      </Card>

      {/* ── Input: parametri impasto ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SliderInput
            label="% prefermento su farina totale"
            value={flourFrac} onChange={setFlourFrac}
            min={10} max={80} step={1} unit="%"
            color="var(--pref-biga)"
          />
          <SliderInput
            label="Idratazione impasto finale"
            value={hydration} onChange={setHydration}
            min={50} max={85} step={0.5} unit="%"
          />
          <NumInput
            label="Peso panetto desiderato" unit="g"
            value={panWeight} onChange={setPanWeight}
            min={150} max={600} step={10}
          />
        </div>
      </Card>

      {/* ── Risultati ── */}
      {result ? (
        <Card elevated style={{ borderColor: 'rgba(255,140,50,0.25)' }}>
          <span style={{ ...S.label, display: 'block', marginBottom: 14, color: 'var(--accent-brand)' }}>
            Ricetta calcolata
          </span>

          {/* Numeri principali */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <Metric
              label="Farina totale"
              value={(result.totalFlourKg * 1000).toFixed(0)}
              unit="g"
              color="var(--text-primary)"
            />
            <Metric
              label="Impasto totale"
              value={(result.totalDoughKg * 1000).toFixed(0)}
              unit="g"
            />
            <Metric
              label="N° panetti"
              value={result.numPanetti.toString()}
              color="var(--accent-brand)"
            />
            <Metric
              label="Peso / panetto"
              value={result.panWeight.toString()}
              unit="g"
              color="var(--state-optimal-lo)"
            />
          </div>

          {/* Rinfresco */}
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            marginBottom: 14,
          }}>
            <span style={{ ...S.label, display: 'block', marginBottom: 10 }}>
              Rinfresco (impasto finale)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Metric
                label="Farina rinfresco"
                value={(result.rinfrescoFlourKg * 1000).toFixed(0)}
                unit="g"
                color="var(--text-secondary)"
              />
              <Metric
                label="Acqua rinfresco"
                value={(result.rinfrescoWaterKg * 1000).toFixed(0)}
                unit="g"
                color="var(--accent-info)"
              />
            </div>
          </div>

          {/* Schema visivo proporzioni */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ ...S.label }}>Proporzioni farina</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {flourFrac}% pref. · {(100 - flourFrac)}% rinfresco
              </span>
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${flourFrac}%`, height: '100%',
                background: prefType === 'poolish' ? 'var(--pref-poolish)' : 'var(--pref-biga)',
                transition: 'width 0.3s ease',
              }} />
              <div style={{
                flex: 1, height: '100%',
                background: 'rgba(255,255,255,0.12)',
              }} />
            </div>
          </div>
        </Card>
      ) : (
        <Card style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          Inserisci un prefermento disponibile {'>'} 0 kg
        </Card>
      )}

      {/* ── Azioni ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <button
          onClick={launchWizard}
          disabled={!result}
          style={{
            background: result ? 'var(--accent-brand)' : 'rgba(255,255,255,0.08)',
            color: result ? '#0a0806' : 'var(--text-muted)',
            border: 'none', borderRadius: 'var(--radius-md)',
            padding: '14px 20px', fontFamily: 'var(--font-mono)',
            fontWeight: 700, fontSize: '0.95rem', cursor: result ? 'pointer' : 'default',
          }}
        >
          🍕 Lancia Wizard con questi valori
        </button>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          style={{
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 'var(--radius-md)',
            padding: '13px 20px', fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem', cursor: 'pointer',
          }}
        >
          ← Home
        </button>
      </div>
    </div>
  );
}
