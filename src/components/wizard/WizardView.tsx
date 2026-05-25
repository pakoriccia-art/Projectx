/**
 * PizzaMatrix — Wizard v4 (7 step)
 * §7.2 KB: stile→protocollo→farine+prefermenti→idratazione→lievito→contenitore→tempistiche
 */
import { useState, useEffect } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import type { Session, FlourGroup, FlourComponent, PrefermentoComponent } from '../../db/db';
import {
  Card, Btn, SnapButtons, NumInput, SliderInput, StepHeader, S,
} from '../ui';
import {
  normalizeFlourGroup, computeCombinedInitialState,
  computeMaltAmylaseContrib, computeTotalAmylaseIndex, maltAlertLevel,
  AGENT_GOMPERTZ, CONTAINER_THERMAL_PRESETS, kEffective,
} from '../../engine';

const TOTAL_STEPS = 7;

// ─── Prefermento defaults ─────────────────────────────────────────────────────
function createDefaultPref(
  type: 'poolish' | 'biga' | 'autolysis',
  flourGroup: FlourGroup,
): PrefermentoComponent {
  const cfg = {
    poolish:   { flourFraction: 30, hydration: 100, tempC: 18, durationH: 12, yeastPct: 0.05 },
    biga:      { flourFraction: 40, hydration:  48, tempC: 16, durationH: 16, yeastPct: 0.10 },
    autolysis: { flourFraction: 30, hydration:  65, tempC: 20, durationH:  1, yeastPct: undefined },
  }[type];
  return {
    id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    flourGroup,
    ...cfg,
  } as PrefermentoComponent;
}

// ─── Helper: crea Session da WizardDraft ─────────────────────────────────────
// Costanti modello crescita lievito nei prefermenti
// Doubling time a 20°C ≈ 2h; Arrhenius Ea ≈ 75 kJ/mol (lievito Saccharomyces)
const YEAST_DOUBLING_20C = 2.0;   // ore
const YEAST_EA_KJ        = 75;    // kJ/mol
const R_GAS              = 8.314e-3; // kJ/(mol·K)
const T_20C_K            = 293.15;   // K

/**
 * Stima la dose lievito efficace dell'impasto finale tenendo conto del lievito
 * già cresciuto all'interno dei prefermenti biga/poolish.
 * Restituisce anche l'ADU di "vantaggio iniziale" accumulato dai prefermenti.
 */
function computeEffectiveDose(
  prefermenti: { type: string; yeastPct?: number; flourFraction: number; tempC?: number; durationH?: number }[],
  mainDosePct: number,
  aParams: { Ea: number },
  aType: string,
): { effectiveDosePct: number; prefInitialAdu: number } {
  let yeastBoost    = 0;
  let prefInitialAdu = 0;
  const kRef25 = (kEffective as Function)(25, aParams.Ea, aType) as number;

  for (const pref of prefermenti) {
    if (pref.type === 'autolysis' || !pref.yeastPct) continue;
    const tempK  = (pref.tempC ?? 16) + 273.15;
    const doubH  = YEAST_DOUBLING_20C * Math.exp(YEAST_EA_KJ / R_GAS * (1 / tempK - 1 / T_20C_K));
    const growth = Math.min(40, Math.pow(2, (pref.durationH ?? 12) / doubH));
    // Contributo lievito attivo (% su farina totale)
    yeastBoost += (pref.yeastPct ?? 0) * (pref.flourFraction / 100) * growth;
    // ADU accumulato nel prefermento (proporzionale a frazione farina)
    const kT    = (kEffective as Function)(pref.tempC ?? 16, aParams.Ea, aType) as number;
    const kRatio = kRef25 > 1e-12 ? kT / kRef25 : 0;
    prefInitialAdu += kRatio * (pref.durationH ?? 12) * (pref.flourFraction / 100);
  }
  return { effectiveDosePct: mainDosePct + yeastBoost, prefInitialAdu };
}

function buildSession(draft: WizardDraft): Session {
  const agent  = AGENT_GOMPERTZ as any;
  const aType  = draft.agentType ?? 'fresh_yeast';
  const aParams = agent[aType];

  // Dose di riferimento per scaling muMax (sourdough: nessun scaling lineare)
  const doseRef = aType === 'fresh_yeast' ? 0.3
    : aType === 'instant_dry_yeast' ? 0.1
    : null;

  const maltContrib = draft.maltDosePct
    ? (computeMaltAmylaseContrib as Function)(draft.maltDosePct, draft.maltDP ?? 200)
    : 0;

  const defaultFlour: FlourComponent = { name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 };
  const mainFG = draft.mainFlourGroup
    ?? (normalizeFlourGroup as Function)([defaultFlour]) as FlourGroup;

  // Prefermenti: aggiorna flourGroup al mainFG corrente se non già fatto
  const prefermenti = (draft.prefermenti ?? []).map(p => ({
    ...p,
    flourGroup: p.flourGroup ?? mainFG,
  }));

  // ── Bug fix: biga/poolish contribuiscono lievito già cresciuto ────────────
  // Senza questa correzione, 0.05% nell'impasto finale con biga al 40%
  // porta a previsioni >70h (il lievito del prefermento viene ignorato).
  const mainDose = draft.agentDosePct ?? (doseRef ?? 0.1);
  const { effectiveDosePct, prefInitialAdu } = computeEffectiveDose(
    prefermenti, mainDose, aParams, aType,
  );
  const doseFactor = doseRef != null ? effectiveDosePct / doseRef : 1.0;
  const muMax = aParams.muMax * Math.max(0.1, Math.min(2, doseFactor));

  const combined = (computeCombinedInitialState as Function)({
    prefermenti,
    mainFlourGroup: mainFG,
  });

  const totalAmylase = (computeTotalAmylaseIndex as Function)(
    combined.effectiveAmylaseIndex, maltContrib
  );

  const _proto = draft.apprettoProtocol ?? 'ta';
  const _p = draft.puntataH ?? 8;
  const _s = draft.staglioH ?? 0.5;
  const _a = draft.apprettoH ?? 4;
  const _tc = draft.tcHours ?? 12;
  const totalH =
    _proto === 'ta'         ? _p + _s + _a
    : _proto === 'tc'       ? _tc + _s
    : _proto === 'tc_puntata' ? _tc + _s + _a
    : /* tc_appreto */        _p + _s + _tc;
  const bakeAt = draft.targetBakeAt ?? new Date(Date.now() + totalH * 3_600_000);

  return {
    status:                 'active',
    prefermenti,
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
    fridgeTempC:            draft.fridgeTempC ?? 4,
    numPanetti:             draft.numPanetti ?? 6,
    altitudeM:              draft.altitudeM ?? 0,
    waterHardnessPpm:       draft.waterHardnessPpm ?? 150,
    malt: draft.maltDosePct ? {
      dosePercent: draft.maltDosePct,
      dpLintner:   draft.maltDP ?? 200,
      addedTo:     'final_dough',
    } : undefined,
    // Offset iniziale: contributo sourdough (engine) + ADU head-start da biga/poolish
    // prefInitialAdu è in unità ADU; /10 per normalizzare alla scala di initialMaturationOffset
    initialMaturationOffset: (combined.initialMaturationOffset ?? 0) + prefInitialAdu / 10,
    initialPH:               combined.initialPH,
    combinedInitialState:    combined,
    targetBakeAt:            bakeAt,
    startedAt:               new Date(),
    createdAt:               new Date(),
  } as unknown as Session;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Stile + dimensione + numero panetti
// ═══════════════════════════════════════════════════════════════════════════════
function Step1({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const styles = [
    { value: 'napoletana',    label: 'Napoletana',  desc: '~260g / panetto' },
    { value: 'contemporanea', label: 'Contemp.',    desc: '~300g / panetto' },
    { value: 'teglia',        label: 'Teglia',      desc: '~800g / teglia'  },
    { value: 'pala',          label: 'Pala',        desc: '~300g / pezzo'   },
    { value: 'nystyle',       label: 'NY Style',    desc: '~320g / panetto' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons label="Stile pizza" options={styles as any} value={draft.style}
        onChange={v => update({ style: v as any })} />
      <NumInput label="Farina totale" unit="g"
        value={draft.totalFlourGrams ?? 1000} onChange={v => update({ totalFlourGrams: v })}
        min={200} max={10000} step={50} />
      <NumInput label="Numero panetti"
        value={draft.numPanetti ?? 6} onChange={v => update({ numPanetti: Math.round(v) })}
        min={1} max={50} step={1} />
      <Card style={{ background: 'rgba(255,140,50,0.08)', border: '1px solid rgba(255,140,50,0.2)' }}>
        <span style={{ ...S.label, color: 'var(--accent-brand)' }}>Peso panetto stimato</span>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 700, marginTop: 4 }}>
          {draft.totalFlourGrams && draft.numPanetti
            ? `~${Math.round((draft.totalFlourGrams * (1 + (65 / 100))) / draft.numPanetti)}g`
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
          { value: 'direct',       label: 'Diretto',      desc: 'Solo impasto finale' },
          { value: 'single_pref',  label: 'Pre-fermento', desc: 'Poolish, Biga o Autolisi' },
          { value: 'mix_advanced', label: 'Mix avanzato', desc: 'Fino a 2 pre-fermenti' },
        ]}
        value={draft.protocol}
        onChange={v => update({ protocol: v as any, prefermenti: [] })}
      />
      {draft.protocol && draft.protocol !== 'direct' && (
        <Card>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
            {draft.protocol === 'single_pref'
              ? 'Configura un pre-fermento nel prossimo step. W, pH e maturazione iniziale vengono calcolati automaticamente.'
              : 'Combina fino a 2 pre-fermenti (es. biga + autolisi, poolish + biga). Modello v2.3.2: denaturation factor + pH logaritmico.'}
          </p>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Farine + prefermenti
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Riga farina rinfresco ────────────────────────────────────────────────────
function FlourRow({ flour, idx, total, onChange, onRemove }: {
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
          <NumInput label="%" value={flour.percentage} onChange={v => onChange({ ...flour, percentage: v })} min={1} max={99} />
        )}
      </div>
    </Card>
  );
}

// ─── Riga prefermento ─────────────────────────────────────────────────────────
function PrefRow({ pref, idx, onUpdate, onRemove }: {
  pref: PrefermentoComponent; idx: number;
  onUpdate: (p: PrefermentoComponent) => void; onRemove: () => void;
}) {
  const TYPE_COLORS: Record<string, string> = {
    poolish:   'var(--pref-poolish)',
    biga:      'var(--pref-biga)',
    autolysis: 'var(--accent-info)',
  };
  const color = TYPE_COLORS[pref.type] ?? 'var(--accent-brand)';

  const hydMin = pref.type === 'biga' ? 40 : 80;
  const hydMax = pref.type === 'biga' ? 60 : 110;

  return (
    <Card elevated style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ ...S.label, color }}>Pre-fermento {idx + 1}</span>
        <button onClick={onRemove} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: '1.1rem', padding: '2px 6px',
        }}>×</button>
      </div>

      <SnapButtons
        label="Tipo"
        options={[
          { value: 'poolish',   label: 'Poolish',  desc: 'Idr. ~100%' },
          { value: 'biga',      label: 'Biga',     desc: 'Idr. ~48%'  },
          { value: 'autolysis', label: 'Autolisi', desc: 'Senza lievito' },
        ]}
        value={pref.type}
        onChange={v => {
          const t = v as 'poolish' | 'biga' | 'autolysis';
          const newDefaults: Partial<PrefermentoComponent> =
            t === 'poolish'   ? { hydration: 100, yeastPct: 0.05, durationH: 12 }
            : t === 'biga'    ? { hydration:  48, yeastPct: 0.10, durationH: 16 }
            : { yeastPct: undefined, durationH: 1 };
          onUpdate({ ...pref, type: t, ...newDefaults });
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: 14 }}>
        <SliderInput
          label="% farina totale" unit="%"
          value={pref.flourFraction}
          onChange={v => onUpdate({ ...pref, flourFraction: v })}
          min={5} max={70} step={1} color={color}
        />
        {pref.type !== 'autolysis' && (
          <SliderInput
            label="Idratazione pref." unit="%"
            value={pref.hydration}
            onChange={v => onUpdate({ ...pref, hydration: v })}
            min={hydMin} max={hydMax} step={1}
            color={color}
          />
        )}
        <NumInput label="Temperatura" unit="°C"
          value={pref.tempC} onChange={v => onUpdate({ ...pref, tempC: v })}
          min={2} max={32} step={0.5} />
        <NumInput label="Durata" unit="h"
          value={pref.durationH} onChange={v => onUpdate({ ...pref, durationH: v })}
          min={0.5} max={72} step={0.5} />
        {pref.type !== 'autolysis' && (
          <NumInput label="Lievito" unit="%"
            value={pref.yeastPct ?? 0.05} onChange={v => onUpdate({ ...pref, yeastPct: v })}
            min={0.005} max={0.5} step={0.005} />
        )}
      </div>

      {/* Summary pill */}
      <div style={{
        marginTop: 10, padding: '6px 10px',
        background: `${color}14`, borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)',
      }}>
        {pref.flourFraction}% farina · {pref.tempC}°C · {pref.durationH}h
        {pref.type !== 'autolysis' ? ` · idr. ${pref.hydration}% · lievito ${pref.yeastPct ?? 0.05}%` : ''}
      </div>
    </Card>
  );
}

// ─── Step 3 container ─────────────────────────────────────────────────────────
function Step3({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const defaultFlour: FlourComponent = { name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 };
  const [flours, setFlours] = useState<FlourComponent[]>(
    draft.mainFlourGroup?.flours ?? [defaultFlour]
  );

  const needsPref   = draft.protocol === 'single_pref' || draft.protocol === 'mix_advanced';
  const maxPrefs    = draft.protocol === 'mix_advanced' ? 2 : 1;
  const prefermenti = draft.prefermenti ?? [];

  // Auto-inizializza mainFlourGroup al mount
  useEffect(() => {
    if (!draft.mainFlourGroup) {
      const fg = (normalizeFlourGroup as Function)([defaultFlour]) as FlourGroup;
      update({ mainFlourGroup: fg });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-aggiungi un prefermento default se l'utente entra nello step e non ce n'è ancora nessuno
  useEffect(() => {
    if (needsPref && prefermenti.length === 0 && draft.mainFlourGroup) {
      const defaultType: 'poolish' | 'biga' = draft.protocol === 'mix_advanced' ? 'biga' : 'poolish';
      update({ prefermenti: [createDefaultPref(defaultType, draft.mainFlourGroup)] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPref, draft.mainFlourGroup]);

  const updateFlours = (newFlours: FlourComponent[]) => {
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
    // Aggiorna anche flourGroup dei prefermenti con la nuova farina
    const updatedPrefs = prefermenti.map(p => ({ ...p, flourGroup: fg }));
    update({ mainFlourGroup: fg, prefermenti: updatedPrefs });
  };

  const addFlour = () => {
    if (flours.length >= 3) return;
    const pct = Math.floor(100 / (flours.length + 1));
    updateFlours([
      ...flours.map(f => ({ ...f, percentage: pct })),
      { name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 - pct * flours.length },
    ]);
  };

  const updatePref = (idx: number, newPref: PrefermentoComponent) => {
    const newPrefs = prefermenti.map((p, i) => i === idx ? newPref : p);
    update({ prefermenti: newPrefs });
  };

  const addPref = () => {
    if (!draft.mainFlourGroup || prefermenti.length >= maxPrefs) return;
    const newType: 'poolish' | 'biga' | 'autolysis' =
      prefermenti.length === 0 ? 'poolish' : 'biga';
    update({ prefermenti: [...prefermenti, createDefaultPref(newType, draft.mainFlourGroup)] });
  };

  const removePref = (idx: number) => {
    update({ prefermenti: prefermenti.filter((_, i) => i !== idx) });
  };

  const fg = draft.mainFlourGroup;
  const spreadW = flours.length > 1
    ? Math.max(...flours.map(f => f.W)) - Math.min(...flours.map(f => f.W))
    : 0;

  const totalPrefFrac = prefermenti.reduce((a, p) => a + (p.flourFraction ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Sezione prefermenti ── */}
      {needsPref && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>Pre-fermenti</span>
            {totalPrefFrac > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                color: totalPrefFrac >= 80 ? 'var(--state-critical)' : 'var(--text-muted)',
              }}>
                {totalPrefFrac}% su farina totale
              </span>
            )}
          </div>

          {prefermenti.map((p, i) => (
            <PrefRow key={p.id} pref={p} idx={i}
              onUpdate={np => updatePref(i, np)}
              onRemove={() => removePref(i)}
            />
          ))}

          {prefermenti.length < maxPrefs && (
            <Btn variant="secondary" onClick={addPref}>
              + Aggiungi pre-fermento
            </Btn>
          )}

          {totalPrefFrac >= 80 && (
            <Card style={{ padding: '8px 12px', background: 'rgba(255,118,117,0.1)', border: '1px solid rgba(255,118,117,0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--state-critical)' }}>
                ⚠ {totalPrefFrac}% farina in prefermento — lascia almeno 20% per il rinfresco
              </span>
            </Card>
          )}
        </div>
      )}

      {/* ── Divisore ── */}
      {needsPref && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}>
          <span style={{ ...S.label, color: 'var(--text-muted)' }}>
            Farine rinfresco — impasto finale ({Math.max(0, 100 - totalPrefFrac)}% farina)
          </span>
        </div>
      )}

      {/* ── Sezione farine rinfresco ── */}
      {!needsPref && <span style={S.label}>Farine impasto</span>}

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
            <BlendMetric label="W blend" value={fg.effectiveW.toFixed(0)} />
            <BlendMetric label="P/L"     value={fg.effectivePl.toFixed(2)} />
            <BlendMetric label="Proteine" value={`${fg.effectiveProtein.toFixed(1)}%`} />
          </div>
          {spreadW > 150 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,214,102,0.1)', borderRadius: 6, border: '1px solid rgba(255,214,102,0.3)' }}>
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

// ─── Metric helper locale ──────────────────────────────────────────────────────
function BlendMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={S.label}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>{value}</span>
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
        min={50} max={Math.min(85, maxHyd)} step={0.5} unit="%" />
      <SliderInput
        label="Sale" value={draft.salt ?? 2.0}
        onChange={v => update({ salt: v })}
        min={0} max={3.5} step={0.1} unit="%" color="var(--accent-info)" />
      {draft.salt !== undefined && (
        <Card style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Sale v2.4: −{((1 - Math.max(0.6, 1 - 0.1 * draft.salt)) * 100).toFixed(0)}% velocità lievitazione · protezione W +{((Math.max(0.7, 1 - 0.08 * draft.salt)) * 100 - 100 + (1 - Math.max(0.7, 1 - 0.08 * draft.salt)) * 100).toFixed(0)}%
          </span>
        </Card>
      )}
      <SliderInput
        label="Grasso" value={draft.fat ?? 0}
        onChange={v => update({ fat: v })}
        min={0} max={15} step={0.5} unit="%" color="var(--text-muted)" />

      <button
        onClick={() => setShowAdvanced(s => !s)}
        style={{ background: 'none', border: 'none', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
      >
        {showAdvanced ? '▾' : '▸'} Parametri avanzati (altitudine, durezza acqua)
      </button>

      {showAdvanced && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <NumInput label="Altitudine" unit="m"
            value={draft.altitudeM ?? 0} onChange={v => update({ altitudeM: v })}
            min={0} max={4000} step={50} />
          <NumInput label="Durezza acqua" unit="ppm CaCO₃"
            value={draft.waterHardnessPpm ?? 150} onChange={v => update({ waterHardnessPpm: v })}
            min={0} max={600} step={10} />
          {(draft.waterHardnessPpm ?? 150) !== 150 && (
            <Card style={{ padding: '10px 14px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                W corretto: ×{(1 + 0.0008 * ((draft.waterHardnessPpm ?? 150) - 150)).toFixed(3)} ·
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
    { value: 'fresh_yeast',       label: 'LBF', desc: 'Lievito Birra Fresco' },
    { value: 'instant_dry_yeast', label: 'IDY', desc: 'Instant Dry Yeast' },
    { value: 'sourdough_wheat',   label: 'LM',  desc: 'Lievito Madre' },
  ];

  const doseLabel = draft.agentType === 'sourdough_wheat' ? '% LM su farina'
    : draft.agentType === 'instant_dry_yeast' ? '% IDY su farina'
    : '% LBF su farina';
  const doseRange: [number, number] = draft.agentType === 'sourdough_wheat' ? [10, 40]
    : draft.agentType === 'instant_dry_yeast' ? [0.05, 1.0]
    : [0.05, 3.0];

  const maltAmyl  = draft.maltDosePct
    ? (computeMaltAmylaseContrib as Function)(draft.maltDosePct, draft.maltDP ?? 200) as number
    : 0;
  const baseAmyl  = draft.mainFlourGroup?.effectiveAmylaseIndex ?? 1.0;
  const totalAmyl = (computeTotalAmylaseIndex as Function)(baseAmyl, maltAmyl) as number;
  const maltLevel = (maltAlertLevel as Function)(totalAmyl) as string;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Agente lievitante"
        options={agentOptions as any}
        value={draft.agentType}
        onChange={v => {
          const defaults: Record<string, number> = {
            fresh_yeast: 0.3, instant_dry_yeast: 0.1, sourdough_wheat: 20,
          };
          update({ agentType: v as any, agentDosePct: defaults[v] ?? 0.3 });
        }}
      />
      {draft.agentType && (
        <SliderInput
          label={doseLabel} value={draft.agentDosePct ?? doseRange[0]}
          onChange={v => update({ agentDosePct: v })}
          min={doseRange[0]} max={doseRange[1]}
          step={draft.agentType === 'sourdough_wheat' ? 1 : 0.05} unit="%" />
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
              min={0.1} max={3.0} step={0.05} unit="% su farina"
              color="var(--pref-biga)" />
            <NumInput
              label="Potere diastatico" unit="°Lintner"
              value={draft.maltDP ?? 200} onChange={v => update({ maltDP: v })}
              min={50} max={500} step={10} />
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
          <button key={key} onClick={() => update({ containerPreset: key as any })} style={{
            background: draft.containerPreset === key ? 'var(--accent-brand)' : 'var(--bg-elevated)',
            color: draft.containerPreset === key ? '#0a0806' : 'var(--text-secondary)',
            border: draft.containerPreset === key ? 'none' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--radius-md)', padding: '12px 10px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: draft.containerPreset === key ? 700 : 400 }}>
              {p.label}
            </div>
            <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 3 }}>τ × {p.tauMultiplier}</div>
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
  const proto   = draft.apprettoProtocol ?? 'ta';
  const puntata = draft.puntataH ?? 8;
  const staglio = draft.staglioH ?? 0.5;
  const appreto = draft.apprettoH ?? 4;
  const freddo  = draft.tcHours ?? 12;
  const fridgeT = draft.fridgeTempC ?? 4;

  // Durata totale per protocollo
  const totalH =
    proto === 'ta'          ? puntata + staglio + appreto
    : proto === 'tc'        ? freddo + staglio
    : proto === 'tc_puntata' ? freddo + staglio + appreto
    : /* tc_appreto */        puntata + staglio + freddo;

  const isTcProto = proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Protocollo maturazione"
        options={[
          { value: 'ta',          label: 'TA',         desc: 'Tutto a temperatura ambiente' },
          { value: 'tc',          label: 'TC',         desc: 'Tutto in frigo (puntata + appreto)' },
          { value: 'tc_puntata',  label: 'TC Puntata', desc: 'Puntata in frigo → appreto TA' },
          { value: 'tc_appreto',  label: 'TC Appreto', desc: 'Puntata TA → appreto in frigo' },
        ]}
        value={proto}
        onChange={v => update({ apprettoProtocol: v as any })}
      />

      {/* Temperatura frigo — visibile per tutti i protocolli TC */}
      {isTcProto && (
        <SliderInput label="Temperatura frigo" value={fridgeT}
          onChange={v => update({ fridgeTempC: v })} min={1} max={8} step={0.5} unit="°C"
          color="var(--state-cold)" />
      )}

      {/* TA: puntata + staglio + appreto */}
      {proto === 'ta' && <>
        <SliderInput label="Puntata (TA)" value={puntata} onChange={v => update({ puntataH: v })}
          min={0.5} max={24} step={0.5} unit="h" />
        <SliderInput label="Staglio + puntini" value={staglio} onChange={v => update({ staglioH: v })}
          min={0.1} max={2} step={0.1} unit="h" />
        <SliderInput label="Appreto (TA)" value={appreto} onChange={v => update({ apprettoH: v })}
          min={0.5} max={12} step={0.5} unit="h" />
      </>}

      {/* TC: tutto in frigo — freddo totale + staglio */}
      {proto === 'tc' && <>
        <SliderInput label="Freddo totale (puntata + appreto in frigo)" value={freddo}
          onChange={v => update({ tcHours: v })} min={2} max={72} step={1} unit="h"
          color="var(--state-cold)" />
        <SliderInput label="Staglio + puntini" value={staglio} onChange={v => update({ staglioH: v })}
          min={0.1} max={2} step={0.1} unit="h" />
        <Card style={{ padding: '10px 14px', background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--state-cold)', fontFamily: 'var(--font-mono)' }}>
            ❄ Tutto in frigo · puntata + appreto entrambi a freddo
          </span>
        </Card>
      </>}

      {/* TC Puntata: puntata TC (freddo) + staglio + appreto TA */}
      {proto === 'tc_puntata' && <>
        <SliderInput label="Puntata in frigo (TC)" value={freddo}
          onChange={v => update({ tcHours: v })} min={2} max={72} step={1} unit="h"
          color="var(--state-cold)" />
        <SliderInput label="Staglio + puntini" value={staglio} onChange={v => update({ staglioH: v })}
          min={0.1} max={2} step={0.1} unit="h" />
        <SliderInput label="Appreto finale (TA)" value={appreto} onChange={v => update({ apprettoH: v })}
          min={0.5} max={12} step={0.5} unit="h" color="var(--accent-brand)" />
        <Card style={{ padding: '10px 14px', background: 'rgba(255,140,50,0.06)', border: '1px solid rgba(255,140,50,0.15)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            ❄ Puntata in frigo → 🌡 Staglio + appreto a temperatura ambiente
          </span>
        </Card>
      </>}

      {/* TC Appreto: puntata TA + staglio + appreto TC (freddo) */}
      {proto === 'tc_appreto' && <>
        <SliderInput label="Puntata (TA)" value={puntata} onChange={v => update({ puntataH: v })}
          min={0.5} max={24} step={0.5} unit="h" />
        <SliderInput label="Staglio + puntini" value={staglio} onChange={v => update({ staglioH: v })}
          min={0.1} max={2} step={0.1} unit="h" />
        <SliderInput label="Appreto in frigo (TC)" value={freddo} onChange={v => update({ tcHours: v })}
          min={2} max={72} step={1} unit="h" color="var(--state-cold)" />
        <Card style={{ padding: '10px 14px', background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            🌡 Puntata a TA → ❄ Staglio + appreto in frigo
          </span>
        </Card>
      </>}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <StepMetric label="Durata totale" value={totalH.toFixed(1)} unit="h" />
          <StepMetric
            label="Cottura prevista"
            value={new Date(Date.now() + totalH * 3600_000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
            color="var(--accent-brand)"
          />
        </div>
      </Card>
    </div>
  );
}

// ─── Metric helper locale ──────────────────────────────────────────────────────
function StepMetric({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
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
  'Farine e prefermenti',
  'Idratazione e sale',
  'Lievito',
  'Contenitore',
  'Tempistiche',
];

export function WizardView() {
  const { state, dispatch } = useApp();
  const { wizardStep: step, wizardDraft: draft } = state;
  const [buildError, setBuildError] = useState<string | null>(null);

  const update = (p: Partial<WizardDraft>) =>
    dispatch({ type: 'WIZARD_UPDATE', patch: p });

  const next = () => {
    setBuildError(null);
    if (step < TOTAL_STEPS) {
      dispatch({ type: 'WIZARD_STEP', step: step + 1 });
    } else {
      try {
        const session = buildSession(draft);
        dispatch({ type: 'SESSION_START', session });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setBuildError(msg);
        console.error('[WizardView] buildSession error:', e);
      }
    }
  };

  const prev = () => {
    setBuildError(null);
    if (step > 1) dispatch({ type: 'WIZARD_STEP', step: step - 1 });
    else dispatch({ type: 'NAV', view: 'home' });
  };

  const canProceed = (): boolean => {
    if (step === 1) return !!(draft.style && draft.totalFlourGrams && draft.numPanetti);
    if (step === 2) return !!draft.protocol;
    if (step === 3) {
      if (!draft.mainFlourGroup) return false;
      if (draft.protocol === 'direct') return true;
      // prefermenti richiesti per single_pref e mix_advanced
      return !!(draft.prefermenti && draft.prefermenti.length >= 1);
    }
    if (step === 4) return !!(draft.hydration && draft.salt !== undefined);
    if (step === 5) return !!(draft.agentType && draft.agentDosePct);
    if (step === 6) return !!draft.containerPreset;
    if (step === 7) return !!(draft.puntataH && draft.apprettoProtocol);
    return true;
  };

  const StepComponent = [Step1, Step2, Step3, Step4, Step5, Step6, Step7][step - 1];

  return (
    <div style={{
      height: '100dvh', overflow: 'hidden',
      padding: '22px var(--padding-h) 0',
      display: 'flex', flexDirection: 'column',
    }}>
      <StepHeader step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />

      {/* Contenuto scrollabile */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '8px', minHeight: 0 }}>
        <StepComponent draft={draft} update={update} />
      </div>

      {/* Pulsanti sempre visibili in fondo */}
      <div style={{
        flexShrink: 0,
        paddingTop: '12px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: '10px',
        background: 'var(--bg-base)',
      }}>
        {buildError && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(214,48,49,0.15)', border: '1px solid rgba(214,48,49,0.4)',
            borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
            color: 'var(--state-critical)', fontFamily: 'var(--font-mono)',
          }}>
            ⚠ {buildError}
          </div>
        )}
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
