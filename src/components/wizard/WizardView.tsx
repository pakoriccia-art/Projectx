/**
 * PizzaMatrix — Wizard v4 (7 step)
 * §7.2 KB: stile→protocollo→farine→idratazione→lievito→contenitore→tempistiche
 */
import { useState } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import type { Session, FlourGroup, FlourComponent } from '../../db/db';
import {
  Card, Btn, SnapButtons, NumInput, SliderInput, StepHeader, S,
} from '../ui';
import {
  normalizeFlourGroup, computeCombinedInitialState,
  computeMaltAmylaseContrib, computeTotalAmylaseIndex, maltAlertLevel,
  AGENT_GOMPERTZ, CONTAINER_THERMAL_PRESETS,
} from '../../engine';

const TOTAL_STEPS = 7;

// ─── Helper: crea Session da WizardDraft ─────────────────────────────────────
function buildSession(draft: WizardDraft): Session {
  const agent = AGENT_GOMPERTZ as any;
  const aType = draft.agentType ?? 'fresh_yeast';
  const aParams = agent[aType];
  const doseFactor = (draft.agentDosePct ?? 0.3) / (
    aType === 'fresh_yeast' ? 0.3
    : aType === 'instant_dry_yeast' ? 0.1
    : 0.0
  );
  const muMax = aParams.muMax * Math.max(0.1, Math.min(2, doseFactor || 1));

  const maltContrib = draft.maltDosePct
    ? (computeMaltAmylaseContrib as Function)(draft.maltDosePct, draft.maltDP ?? 200)
    : 0;

  const mainFG = draft.mainFlourGroup ?? (normalizeFlourGroup as Function)([
    { name: 'Farina', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }
  ]);

  const combined = (computeCombinedInitialState as Function)({
    prefermenti: draft.prefermenti ?? [],
    mainFlourGroup: mainFG,
  });

  const totalAmylase = (computeTotalAmylaseIndex as Function)(
    combined.effectiveAmylaseIndex, maltContrib
  );

  return {
    status: 'active',
    prefermenti:            draft.prefermenti ?? [],
    mainFlourGroup:         mainFG,
    effectiveW_initial:     combined.effectiveW_initial,
    effectivePl_initial:    combined.effectivePl_initial,
    effectiveProtein:       combined.effectiveProtein,
    effectiveAsh:           combined.effectiveAsh,
    effectiveAmylaseIndex:  totalAmylase,
    effectiveW_current:     combined.effectiveW_initial,
    agentLabel:             aType,
    agentType:              aType,
    agentEaKj:              aParams.Ea,
    agentMuMax:             muMax,
    agentLambda:            aParams.lambda,
    agentAsymptote:         100,
    agentDosePct:           draft.agentDosePct ?? 0.3,
    style:                  draft.style ?? 'napoletana',
    hydration:              draft.hydration ?? 65,
    salt:                   draft.salt ?? 2.0,
    totalFlourGrams:        draft.totalFlourGrams ?? 1000,
    alertThreshold:         85,
    containerPreset:        draft.containerPreset ?? 'closed_box',
    apprettoProtocol:       draft.apprettoProtocol ?? 'ta',
    puntataH:               draft.puntataH ?? 8,
    staglioH:               draft.staglioH ?? 0.5,
    apprettoH:              draft.apprettoH ?? 4,
    tcHours:                draft.tcHours,
    numPanetti:             draft.numPanetti ?? 6,
    altitudeM:              draft.altitudeM ?? 0,
    waterHardnessPpm:       draft.waterHardnessPpm ?? 150,
    malt:                   draft.maltDosePct ? {
      dosePercent: draft.maltDosePct,
      dpLintner: draft.maltDP ?? 200,
      addedTo: 'final_dough',
    } : undefined,
    initialMaturationOffset: combined.initialMaturationOffset,
    initialPH:              combined.initialPH,
    combinedInitialState:   combined,
    targetBakeAt:           draft.targetBakeAt ?? new Date(Date.now() + 24 * 3600_000),
    startedAt:              new Date(),
    createdAt:              new Date(),
  } as unknown as Session;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Stile + dimensione + numero panetti
// ═══════════════════════════════════════════════════════════════════════════════
function Step1({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const styles = [
    { value: 'napoletana',    label: 'Napoletana',    desc: '~260g / panetto' },
    { value: 'contemporanea', label: 'Contemp.',      desc: '~300g / panetto' },
    { value: 'teglia',        label: 'Teglia',        desc: '~800g / teglia'  },
    { value: 'pala',          label: 'Pala',          desc: '~300g / pezzo'   },
    { value: 'nystyle',       label: 'NY Style',      desc: '~320g / panetto' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Stile pizza"
        options={styles as any}
        value={draft.style}
        onChange={v => update({ style: v as any })}
      />
      <NumInput
        label="Farina totale" unit="g"
        value={draft.totalFlourGrams ?? 1000}
        onChange={v => update({ totalFlourGrams: v })}
        min={200} max={10000} step={50}
      />
      <NumInput
        label="Numero panetti"
        value={draft.numPanetti ?? 6}
        onChange={v => update({ numPanetti: Math.round(v) })}
        min={1} max={50} step={1}
      />
      <Card style={{ background: 'rgba(255,140,50,0.08)', border: '1px solid rgba(255,140,50,0.2)' }}>
        <span style={{ ...S.label, color: 'var(--accent-brand)' }}>Peso panetto stimato</span>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 700, marginTop: 4 }}>
          {draft.totalFlourGrams && draft.numPanetti
            ? `~${Math.round((draft.totalFlourGrams * (1 + (65/100))) / draft.numPanetti)}g`
            : '—'}
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Protocollo
// ═══════════════════════════════════════════════════════════════════════════════
function Step2({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SnapButtons
        label="Tipo di impasto"
        options={[
          { value: 'direct',       label: 'Diretto',          desc: 'Solo impasto finale' },
          { value: 'single_pref',  label: 'Pre-fermento',     desc: 'Poolish, Biga o Autolisi' },
          { value: 'mix_advanced', label: 'Mix avanzato',     desc: 'Fino a 2 pre-fermenti' },
        ]}
        value={draft.protocol}
        onChange={v => update({ protocol: v as any })}
      />
      {draft.protocol && draft.protocol !== 'direct' && (
        <Card>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
            {draft.protocol === 'single_pref'
              ? 'Configura un pre-fermento (poolish, biga o autolisi) nel prossimo step. Il contributo su W, pH e maturazione viene calcolato automaticamente.'
              : 'Puoi combinare fino a 2 pre-fermenti (es. biga + poolish, biga + autolisi). Il modello v2.3.2 gestisce il denaturation factor e il pH logaritmico.'
            }
          </p>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Farine + prefermenti
// ═══════════════════════════════════════════════════════════════════════════════
function FlourRow({
  flour, idx, total, onChange, onRemove,
}: {
  flour: FlourComponent; idx: number; total: number;
  onChange: (f: FlourComponent) => void; onRemove: () => void;
}) {
  return (
    <Card elevated style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>Farina {idx + 1}</span>
        {total > 1 && (
          <button onClick={onRemove} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '1.1rem', padding: '2px 6px',
          }}>×</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <NumInput label="W" value={flour.W} onChange={v => onChange({ ...flour, W: v })} min={80} max={500} />
        <NumInput label="P/L" value={flour.pl} step={0.05} onChange={v => onChange({ ...flour, pl: v })} min={0.2} max={1.2} />
        <NumInput label="Proteine" unit="%" value={flour.protein} step={0.5} onChange={v => onChange({ ...flour, protein: v })} min={7} max={17} />
        {total > 1 && (
          <NumInput label="Percentuale" unit="%" value={flour.percentage} onChange={v => onChange({ ...flour, percentage: v })} min={1} max={99} />
        )}
      </div>
    </Card>
  );
}

function Step3({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const [flours, setFlours] = useState<FlourComponent[]>(
    draft.mainFlourGroup?.flours ?? [{ name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }]
  );

  const updateFlours = (newFlours: FlourComponent[]) => {
    // Auto-bilancio percentuali se 2+ farine
    if (newFlours.length > 1) {
      const sum = newFlours.reduce((a, f) => a + f.percentage, 0);
      if (Math.abs(sum - 100) > 0.5) {
        const last = newFlours.length - 1;
        const rest = newFlours.slice(0, last).reduce((a, f) => a + f.percentage, 0);
        newFlours = [
          ...newFlours.slice(0, last),
          { ...newFlours[last], percentage: Math.max(1, 100 - rest) },
        ];
      }
    }
    setFlours(newFlours);
    const fg = (normalizeFlourGroup as Function)(newFlours) as FlourGroup;
    update({ mainFlourGroup: fg });
  };

  const addFlour = () => {
    if (flours.length >= 3) return;
    const pct = Math.floor(100 / (flours.length + 1));
    const newFlours = [
      ...flours.map(f => ({ ...f, percentage: pct })),
      { name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 - pct * flours.length },
    ];
    updateFlours(newFlours);
  };

  const fg = draft.mainFlourGroup;
  const spreadW = flours.length > 1 ? Math.max(...flours.map(f => f.W)) - Math.min(...flours.map(f => f.W)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <span style={S.label}>Farine impasto finale</span>
      {flours.map((f, i) => (
        <FlourRow key={i} flour={f} idx={i} total={flours.length}
          onChange={nf => updateFlours(flours.map((x, j) => j === i ? nf : x))}
          onRemove={() => updateFlours(flours.filter((_, j) => j !== i))}
        />
      ))}
      {flours.length < 3 && (
        <Btn variant="secondary" onClick={addFlour}>+ Aggiungi farina</Btn>
      )}

      {/* Preview blend */}
      {fg && (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <Metric label="W blend" value={fg.effectiveW.toFixed(0)} />
            <Metric label="P/L" value={fg.effectivePl.toFixed(2)} />
            <Metric label="Proteine" value={`${fg.effectiveProtein.toFixed(1)}%`} />
          </div>
          {spreadW > 150 && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(255,214,102,0.1)', borderRadius: 6, border: '1px solid rgba(255,214,102,0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent-warning)' }}>
                ⚠ Spread W = {spreadW} — blend eterogeneo. Correzione reologica v2.4 applicata.
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Idratazione + sale + opzionali
// ═══════════════════════════════════════════════════════════════════════════════
function Step4({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const maxHyd = draft.mainFlourGroup
    ? Math.round(75 + (draft.mainFlourGroup.effectiveW - 280) * 0.05)
    : 75;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SliderInput
        label="Idratazione" value={draft.hydration ?? 65}
        onChange={v => update({ hydration: v })}
        min={50} max={Math.min(85, maxHyd)} step={0.5} unit="%"
      />
      <SliderInput
        label="Sale" value={draft.salt ?? 2.0}
        onChange={v => update({ salt: v })}
        min={0} max={3.5} step={0.1} unit="%"
        color="var(--accent-info)"
      />
      {draft.salt !== undefined && (
        <Card style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Effetto sale v2.4: −{((1 - Math.max(0.6, 1 - 0.1 * draft.salt)) * 100).toFixed(0)}% velocità lievitazione ·
            +{((1 - Math.max(0.7, 1 - 0.08 * draft.salt)) * 100 * -1 + 100 * (1 - Math.max(0.7, 1 - 0.08 * draft.salt))).toFixed(0)} protezione strutturale W
          </span>
        </Card>
      )}
      <SliderInput
        label="Grasso" value={draft.fat ?? 0}
        onChange={v => update({ fat: v })}
        min={0} max={15} step={0.5} unit="%"
        color="var(--text-muted)"
      />

      <button
        onClick={() => setShowAdvanced(s => !s)}
        style={{ background: 'none', border: 'none', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
      >
        {showAdvanced ? '▾' : '▸'} Parametri avanzati (altitudine, durezza acqua)
      </button>

      {showAdvanced && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <NumInput
            label="Altitudine" unit="m"
            value={draft.altitudeM ?? 0}
            onChange={v => update({ altitudeM: v })}
            min={0} max={4000} step={50}
          />
          <NumInput
            label="Durezza acqua" unit="ppm CaCO₃"
            value={draft.waterHardnessPpm ?? 150}
            onChange={v => update({ waterHardnessPpm: v })}
            min={0} max={600} step={10}
          />
          {(draft.waterHardnessPpm ?? 150) !== 150 && (
            <Card style={{ padding: '10px 14px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                W correto: ×{(1 + 0.0008 * ((draft.waterHardnessPpm ?? 150) - 150)).toFixed(3)} ·
                Proteolisi: ×{(1 - 0.0004 * ((draft.waterHardnessPpm ?? 150) - 150)).toFixed(3)}
              </span>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Agente + malto
// ═══════════════════════════════════════════════════════════════════════════════
function Step5({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const [showMalt, setShowMalt] = useState(!!draft.maltDosePct);

  const agentOptions = [
    { value: 'fresh_yeast',       label: 'LBF',   desc: 'Lievito Birra Fresco' },
    { value: 'instant_dry_yeast', label: 'IDY',   desc: 'Instant Dry Yeast' },
    { value: 'sourdough_wheat',   label: 'LM',    desc: 'Lievito Madre' },
  ];

  const doseLabel = draft.agentType === 'sourdough_wheat' ? '% LM su farina'
    : draft.agentType === 'instant_dry_yeast' ? '% IDY su farina'
    : '% LBF su farina';
  const doseRange = draft.agentType === 'sourdough_wheat' ? [10, 40] as [number, number]
    : draft.agentType === 'instant_dry_yeast' ? [0.05, 1.0] as [number, number]
    : [0.05, 3.0] as [number, number];

  const maltAmyl = draft.maltDosePct
    ? (computeMaltAmylaseContrib as Function)(draft.maltDosePct, draft.maltDP ?? 200) as number
    : 0;
  const baseAmyl = draft.mainFlourGroup?.effectiveAmylaseIndex ?? 1.0;
  const totalAmyl = (computeTotalAmylaseIndex as Function)(baseAmyl, maltAmyl) as number;
  const maltLevel = (maltAlertLevel as Function)(totalAmyl) as string;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Agente lievitante"
        options={agentOptions as any}
        value={draft.agentType}
        onChange={v => update({ agentType: v as any, agentDosePct: undefined })}
      />
      {draft.agentType && (
        <SliderInput
          label={doseLabel} value={draft.agentDosePct ?? doseRange[0]}
          onChange={v => update({ agentDosePct: v })}
          min={doseRange[0]} max={doseRange[1]} step={draft.agentType === 'sourdough_wheat' ? 1 : 0.05}
          unit="%"
        />
      )}

      <button
        onClick={() => { setShowMalt(s => !s); if (showMalt) update({ maltDosePct: undefined }); }}
        style={{ background: 'none', border: 'none', color: 'var(--pref-biga)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
      >
        {showMalt ? '▾' : '▸'} Malto diastatico (v2.4.0)
      </button>

      {showMalt && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <SliderInput
              label="Dose malto" value={draft.maltDosePct ?? 0.3}
              onChange={v => update({ maltDosePct: v })}
              min={0.1} max={1.0} step={0.05} unit="% su farina"
              color="var(--pref-biga)"
            />
            <NumInput
              label="Potere diastatico" unit="°Lintner"
              value={draft.maltDP ?? 200}
              onChange={v => update({ maltDP: v })}
              min={50} max={500} step={10}
            />
            <Card style={{
              padding: '10px 14px',
              background: maltLevel === 'BLOCKED' ? 'rgba(214,48,49,0.15)'
                : maltLevel === 'CRITICAL' ? 'rgba(255,118,117,0.1)'
                : maltLevel === 'ADVISORY' ? 'rgba(255,214,102,0.1)'
                : 'rgba(0,184,148,0.1)',
              border: `1px solid ${maltLevel === 'BLOCKED' ? '#d63031' : maltLevel === 'CRITICAL' ? '#ff7675' : maltLevel === 'ADVISORY' ? '#ffd166' : '#00b894'}44`,
            }}>
              <span style={{ ...S.label }}>Amylase index totale</span>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, marginTop: 4 }}>
                {totalAmyl.toFixed(3)}
                <span style={{ fontSize: '0.75rem', fontWeight: 400, marginLeft: 8 }}>
                  {maltLevel === 'OK' ? '✓ OK'
                    : maltLevel === 'ADVISORY' ? '⚠ Rischio destrinizzazione'
                    : maltLevel === 'CRITICAL' ? '⛔ Destrinizzazione probabile'
                    : '🚫 Fuori range modello'}
                </span>
              </div>
            </Card>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Contenitore
// ═══════════════════════════════════════════════════════════════════════════════
function Step6({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const presets = Object.entries(CONTAINER_THERMAL_PRESETS as any) as [string, { label: string; tauMultiplier: number }][];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <span style={S.label}>Preset contenitore (influenza inerzia termica)</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {presets.map(([key, p]) => (
          <button
            key={key}
            onClick={() => update({ containerPreset: key as any })}
            style={{
              background: draft.containerPreset === key ? 'var(--accent-brand)' : 'var(--bg-elevated)',
              color: draft.containerPreset === key ? '#0a0806' : 'var(--text-secondary)',
              border: draft.containerPreset === key ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 10px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: draft.containerPreset === key ? 700 : 400 }}>
              {p.label}
            </div>
            <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 3 }}>
              τ × {p.tauMultiplier}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Tempistiche
// ═══════════════════════════════════════════════════════════════════════════════
function Step7({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const totalH = (draft.puntataH ?? 8) + (draft.staglioH ?? 0.5) + (draft.apprettoH ?? 4)
    + (draft.apprettoProtocol === 'tc' || draft.apprettoProtocol === 'misto' ? (draft.tcHours ?? 12) : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Protocollo maturazione"
        options={[
          { value: 'ta',    label: 'TA',    desc: 'Tutto a temperatura ambiente' },
          { value: 'tc',    label: 'TC',    desc: 'Tutto in frigo (freddo)' },
          { value: 'misto', label: 'Misto', desc: 'Freddo + TA finale' },
        ]}
        value={draft.apprettoProtocol}
        onChange={v => update({ apprettoProtocol: v as any })}
      />

      <SliderInput label="Puntata" value={draft.puntataH ?? 8} onChange={v => update({ puntataH: v })}
        min={0.5} max={24} step={0.5} unit="h" />
      <SliderInput label="Staglio + puntini" value={draft.staglioH ?? 0.5} onChange={v => update({ staglioH: v })}
        min={0.1} max={2} step={0.1} unit="h" />
      <SliderInput label="Appreto" value={draft.apprettoH ?? 4} onChange={v => update({ apprettoH: v })}
        min={0.5} max={12} step={0.5} unit="h" />

      {(draft.apprettoProtocol === 'tc' || draft.apprettoProtocol === 'misto') && (
        <SliderInput label="Fase freddo" value={draft.tcHours ?? 12} onChange={v => update({ tcHours: v })}
          min={2} max={72} step={1} unit="h" color="var(--state-cold)" />
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Metric label="Durata totale" value={totalH.toFixed(1)} unit="h" />
          <Metric label="Cottura prevista" value={
            new Date(Date.now() + totalH * 3600_000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
          } color="var(--accent-brand)" />
        </div>
      </Card>
    </div>
  );
}

// ─── Metric helper locale ──────────────────────────────────────────────────────
function Metric({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={S.label}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.1rem', color: color ?? 'var(--text-primary)' }}>
        {value}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIZARD CONTAINER
// ═══════════════════════════════════════════════════════════════════════════════
const STEP_TITLES = [
  'Stile e dimensione',
  'Tipo di impasto',
  'Farine',
  'Idratazione e sale',
  'Lievito',
  'Contenitore',
  'Tempistiche',
];

export function WizardView() {
  const { state, dispatch } = useApp();
  const { wizardStep: step, wizardDraft: draft } = state;

  const update = (p: Partial<WizardDraft>) =>
    dispatch({ type: 'WIZARD_UPDATE', patch: p });

  const next = () => {
    if (step < TOTAL_STEPS) dispatch({ type: 'WIZARD_STEP', step: step + 1 });
    else {
      // Avvia sessione
      const session = buildSession(draft);
      dispatch({ type: 'SESSION_START', session });
    }
  };

  const prev = () => {
    if (step > 1) dispatch({ type: 'WIZARD_STEP', step: step - 1 });
    else dispatch({ type: 'NAV', view: 'home' });
  };

  const canProceed = (): boolean => {
    if (step === 1) return !!(draft.style && draft.totalFlourGrams && draft.numPanetti);
    if (step === 2) return !!draft.protocol;
    if (step === 3) return !!draft.mainFlourGroup;
    if (step === 4) return !!(draft.hydration && draft.salt !== undefined);
    if (step === 5) return !!(draft.agentType && draft.agentDosePct);
    if (step === 6) return !!draft.containerPreset;
    if (step === 7) return !!(draft.puntataH && draft.apprettoProtocol);
    return true;
  };

  const StepComponent = [Step1, Step2, Step3, Step4, Step5, Step6, Step7][step - 1];

  return (
    <div style={{ minHeight: '100dvh', padding: '22px var(--padding-h)', display: 'flex', flexDirection: 'column' }}>
      <StepHeader step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>
        <StepComponent draft={draft} update={update} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '16px' }}>
        <Btn onClick={next} disabled={!canProceed()}>
          {step < TOTAL_STEPS ? 'Continua →' : '🍕 Avvia sessione'}
        </Btn>
        <Btn variant="secondary" onClick={prev}>
          {step === 1 ? '← Home' : '← Indietro'}
        </Btn>
      </div>
    </div>
  );
}
