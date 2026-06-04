/**
 * PizzaMatrix — Wizard v4 (7 step)
 * §7.2 KB: stile→protocollo→farine+prefermenti→idratazione→lievito→contenitore→tempistiche
 */
import { useState, useEffect } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import type { Session, FlourGroup, FlourComponent, PrefermentoComponent } from '../../db/db';
import {
  Card, Btn, SnapButtons, NumInput, SliderInput, StepHeader, S, FormSection, Row2, Metric,
} from '../ui';
import {
  normalizeFlourGroup, computeCombinedInitialState,
  computeMaltAmylaseContrib, computeTotalAmylaseIndex, maltAlertLevel,
  AGENT_GOMPERTZ, CONTAINER_THERMAL_PRESETS, kEffective, getStyleProfile,
  KNEADING_METHODS_FRICTION, computeWaterTempDDT, type KneadingMethod,
} from '../../engine';
import { WaterTempResultCard } from '../tools/WaterTempView';
import { WizardInputSchema } from '../../lib/schemas';
import { startSession } from '../../services/sessionService';
import { estimateEnzMatPctAtH } from '../../engine/serviceWindowSolver';
import { FLOUR_DATABASE, getFlourBrands, getFloursByBrand, type FlourEntry } from '../../data/flourDatabase';
import { STYLE_CONSTRAINTS, hydrationRangeForStyle } from '../../data/styleConstraints';

const TOTAL_STEPS = 8;

/** DDT target per stile — delegato a styleConstraints (§7.x) */
const DDT_BY_STYLE: Record<string, number> = Object.fromEntries(
  Object.entries(STYLE_CONSTRAINTS).map(([k, v]) => [k, v.ddtTarget]),
);
// Mantiene compat con codice legacy; nuovi call-site usano direttamente ddtForStyle()
void DDT_BY_STYLE;

// ─── Prefermento defaults ─────────────────────────────────────────────────────
function createDefaultPref(
  type: 'poolish' | 'biga' | 'autolysis' | 'riporto',
  flourGroup: FlourGroup,
): PrefermentoComponent {
  const cfg = {
    poolish:   { flourFraction: 30, hydration: 100, tempC: 18, durationH: 12, yeastPct: 0.05 },
    biga:      { flourFraction: 40, hydration:  48, tempC: 16, durationH: 16, yeastPct: 0.10 },
    autolysis: { flourFraction: 30, hydration:  65, tempC: 20, durationH:  1, yeastPct: undefined },
    riporto:   { flourFraction: 20, hydration:  65, tempC: 20, durationH: 24, yeastPct: undefined },
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

// ─── Stima pH prefermento da tipo/durata/temperatura ────────────────────────
// Il motore usa p.state?.pH ?? 6.0 — senza stato stimato il pH è sempre 6.0.
// Questa funzione approssima il pH finale del prefermento basandosi su
// dati bibliografici (De Vuyst 2005, Chavan 2017):
//   biga 16h/16°C → pH ~4.8-5.2; poolish 12h/18°C → pH ~3.9-4.4
function estimatePrefPH(type: string, durationH: number, tempC: number): number {
  if (type === 'autolysis') return 6.0;
  if (type === 'riporto')   return 4.9;  // impasto riporto già acidificato
  // Tasso di caduta pH: poolish (idr.100%) >  biga (idr.48%) per maggiore attività batterica
  const kPH = type === 'poolish' ? 0.065 : 0.040;  // unità pH / ora
  // Fattore temperatura: normalizzato a 16°C (temperatura biga di riferimento)
  const tempFactor = Math.max(0.4, Math.min(2.5, tempC / 16));
  const floor = type === 'poolish' ? 3.6 : 4.4;
  return Math.max(floor, 6.0 - kPH * durationH * tempFactor);
}

// ─── Stima W decaduto nel prefermento ────────────────────────────────────────
function estimatePrefWDecay(W0: number, type: string, durationH: number, tempC: number): number {
  if (type === 'autolysis') return W0 * 0.97;  // lieve rilassamento
  if (type === 'riporto')   return W0 * 0.82;  // già ben degradato
  // Approssimazione Hill semplificata (tCrit ≈ W0 * 0.15 ore a 16°C)
  const tCritBase = W0 * 0.15;
  const tFactor = Math.max(0.3, Math.min(3.0, tempC / 16));
  const tCrit = tCritBase / tFactor;
  const decay = 1 / (1 + Math.pow(durationH / tCrit, 3));
  return Math.max(W0 * 0.6, W0 * decay);
}

// ─── Costanti termofisiche (specchio di FermentationPlannerView) ─────────────
const TH_CP_WATER  = 4186;   // J/(kg·K) — calore specifico acqua
const TH_CP_FLOUR  = 1840;   // J/(kg·K) — calore specifico farina
const TH_RHO_DOUGH = 1050;   // kg/m³    — densità impasto
const TH_H_AIR     = 8;      // W/(m²·K) — convezione naturale aria in ambiente chiuso

/** Inverse analitica di Gompertz (Zwietering 1990): ADU al quale maturation = targetPct% */
function invertGompertzWizard(targetPct: number, muMax: number, lambda: number, asymptote = 100): number {
  const safeRatio = Math.max(1e-4, Math.min(targetPct / asymptote, 1 - 1e-4));
  return lambda - (Math.log(-Math.log(safeRatio)) - 1) * asymptote / (muMax * Math.E);
}

/**
 * ADU accumulato durante la risalita termica (stemperamento) da fridgeTempC verso tAmb.
 * Integrazione numerica di Riemann con N=20 passi su T(t)=tAmb+(fridgeT−tAmb)·exp(−t/τ).
 * tauMultiplier applica la resistenza termica del contenitore (coerente con computeWarmupH).
 */
function computeRampAduWizard(
  panMassKg: number, hydrationPct: number,
  fridgeTempC: number, tAmb: number, wH: number,
  Ea: number, agentType: string, kRef: number,
  tauMultiplier = 1.0,
): number {
  if (wH <= 0 || kRef <= 1e-12) return 0;
  const h   = Math.max(0.01, hydrationPct / 100);
  const cp  = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);
  const V   = panMassKg / TH_RHO_DOUGH;
  const r   = Math.cbrt((3 * V) / (4 * Math.PI));
  const A   = 4 * Math.PI * r * r;
  const tau = (panMassKg * cp) / (TH_H_AIR * A) * tauMultiplier;  // s
  const N = 20; const dt_h = wH / N; const dt_s = dt_h * 3600;
  let adu = 0;
  for (let i = 0; i < N; i++) {
    const T = tAmb + (fridgeTempC - tAmb) * Math.exp(-((i + 0.5) * dt_s) / tau);
    const k = (kEffective as Function)(T, Ea, agentType) as number;
    adu += (k / kRef) * dt_h;
  }
  return adu;
}

/**
 * Back-calcola la durata ottimale della Puntata TA per tc_appreto in modo che
 * ADU(puntata) + ADU(staglio) + ADU(TC) + ADU(ramp) = ADU_target(85%).
 * tcHours è fissato dall'utente → nessuna circolarità.
 * Ritorna 0 se il solo TC supera già il target (tcHours troppo lungo per il lievito usato).
 *
 * Formula: puntataH = (aduTarget − initialAdu − rAmb·staglioH − rFri·tcHours − rampAdu) / rAmb
 */
function computeOptimalPuntataH(p: {
  muMax: number; lambda: number; agentType: string; Ea: number;
  fridgeTempC: number; tcHours: number; staglioH: number;
  panMassKg: number; hydrationPct: number;
  tauMultiplier: number; warmupH: number;
  initialAdu: number; tAmb?: number;
  maxH?: number;  // cap stile-dipendente — se presente: Math.min(computed, maxH)
}): number {
  const tAmb  = p.tAmb ?? 22;
  const kRef  = (kEffective as Function)(25, p.Ea, p.agentType) as number;
  if (kRef <= 1e-12) return 0;
  const rAmb  = ((kEffective as Function)(tAmb, p.Ea, p.agentType) as number) / kRef;
  const rFri  = ((kEffective as Function)(p.fridgeTempC, p.Ea, p.agentType) as number) / kRef;
  const aduT  = invertGompertzWizard(85, p.muMax, p.lambda);
  const rampAdu = computeRampAduWizard(p.panMassKg, p.hydrationPct, p.fridgeTempC, tAmb,
                                        p.warmupH, p.Ea, p.agentType, kRef, p.tauMultiplier);
  const needed = aduT - p.initialAdu - rAmb * p.staglioH - rFri * p.tcHours - rampAdu;
  const raw = rAmb > 1e-12 ? Math.max(0, needed / rAmb) : 0;
  return p.maxH != null ? Math.min(raw, p.maxH) : raw;
}

/** Ore massime di puntata TA per il profilo stile, nel modello Arrhenius wizard. */
function puntataMaxHForStyle(
  style: string, muMax: number, lambda: number,
  Ea: number, agentType: string, initialAdu = 0, tAmb = 22,
): number {
  const profile = (getStyleProfile as Function)(style);
  const kRef = (kEffective as Function)(25, Ea, agentType) as number;
  if (kRef <= 1e-12) return Infinity;
  const rAmb = ((kEffective as Function)(tAmb, Ea, agentType) as number) / kRef;
  const aduTarget = invertGompertzWizard(profile.puntataMatPct_target, muMax, lambda);
  return rAmb > 1e-12 ? Math.max(0, (aduTarget - initialAdu) / rAmb) : Infinity;
}

// ─── Calcolo tempo di riscaldo: da T frigo a 18°C (servizio) con legge di Newton ─
// Specula thermalTimeConstantSphere del motore (costanti identiche: CP_WATER=4186, CP_FLOUR=1840,
// RHO_DOUGH=1050, H_AIR=8). Restituisce le ORE per portare il core del panetto a 18°C a tAmb.
// Ritorna 0 se tAmb ≤ 18°C (ambiente freddo → riscaldo impossibile) o fridgeTempC ≥ 18°C.
/**
 * Ore necessarie affinché il panetto raggiunga 18°C partendo da fridgeTempC,
 * usando Newton's law of cooling con geometria sferica.
 * tauMultiplier ≥ 1.0 amplifica l'inerzia termica in base al contenitore
 * (es. closed_box = 2.5×, plastic_bag = 2.2×) — speculare all'engine
 * applyContainerResistance() usato nel tick loop.
 */
function computeWarmupH(
  panMassKg: number, hydrationPct: number, fridgeTempC: number, tAmb: number,
  tauMultiplier = 1.0,
): number {
  const T_SERVICE = 18;                                    // °C — temperatura servizio target
  if (tAmb <= T_SERVICE || fridgeTempC >= T_SERVICE) return 0;
  const h   = Math.max(0.01, hydrationPct / 100);
  const cp  = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);   // J/(kg·K) — calore specifico impasto
  const V   = panMassKg / TH_RHO_DOUGH;                   // m³ — volume panetto
  const r   = Math.cbrt((3 * V) / (4 * Math.PI));         // m — raggio sfera equivalente
  const A   = 4 * Math.PI * r * r;                        // m² — superficie
  // τ moltiplicato per tauMultiplier del contenitore (inerzia extra da coperchio/borsa)
  const tau = (panMassKg * cp) / (TH_H_AIR * A) * tauMultiplier; // s — τ sferica con resistenza contenitore
  const ratio = (fridgeTempC - tAmb) / (T_SERVICE - tAmb);
  if (ratio <= 0) return 0;
  return Math.max(0, (tau * Math.log(ratio)) / 3600);     // ore
}

function buildSession(draft: WizardDraft): Session {
  // ── Validazione Zod .strict() (guardia data-layer per tutti i campi wizard) ──
  const parsed = WizardInputSchema.safeParse(draft);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' · ');
    throw new Error(msg);
  }
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

  // Prefermenti: aggiorna flourGroup + stima stato iniziale (pH, W_decayed)
  // FIX: il motore usa p.state?.pH ?? 6.0 — senza stato esplicito il pH è sempre 6.0
  // indipendentemente dal tipo/durata del prefermento.
  const prefermenti = (draft.prefermenti ?? []).map(p => {
    const fg = p.flourGroup ?? mainFG;
    const W0 = fg.effectiveW ?? 280;
    const estimatedState = p.state ?? {
      pH:            estimatePrefPH(p.type, p.durationH ?? 12, p.tempC ?? 18),
      W_decayed:     estimatePrefWDecay(W0, p.type, p.durationH ?? 12, p.tempC ?? 18),
      pl_modified:   fg.effectivePl ?? 0.55,
      amylase_index: fg.effectiveAmylaseIndex ?? 0.5,
      maturationPct: 0,
      ready:         false,
    };
    return { ...p, flourGroup: fg, state: estimatedState };
  });

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
  const _s = draft.staglioH ?? 0.5;
  const _tc = draft.tcHours ?? 12;

  // Per tc_appreto: apprettoH = tempo di riscaldo calcolato dinamicamente (frigo → 18°C servizio)
  // T ambiente 22°C assunta — il wizard non raccoglie tAmb.
  // Il tauMultiplier del contenitore viene applicato per riflettere l'inerzia del contenitore
  // scelto (es. closed_box → τ × 2.5): coerente con applyContainerResistance() nel tick loop.
  // Se è presente una timeline precomputata (Service-Window planner), lo schedule
  // del solver è autoritativo: salta il ricalcolo tc_appreto di warmup/puntata.
  const hasPrecomputedTimeline = !!(draft.thermalTimeline && draft.thermalTimeline.length > 0);

  const _warmup = (_proto === 'tc_appreto' && !hasPrecomputedTimeline) ? (() => {
    const totalDoughG = (draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100 + (draft.salt ?? 2) / 100);
    const panMassKg   = totalDoughG / 1000 / Math.max(1, draft.numPanetti ?? 6);
    const cPreset = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
    const tauMult = cPreset?.tauMultiplier ?? 1.0;
    return computeWarmupH(panMassKg, draft.hydration ?? 65, draft.fridgeTempC ?? 4, 22, tauMult);
  })() : 0;
  const _a = _proto === 'tc_appreto' ? _warmup : (draft.apprettoH ?? 4);

  // Per tc_appreto: puntataH viene back-calcolata automaticamente oppure usa l'override
  // manuale dell'utente (draft.puntataH != null dopo che l'utente ha spostato il cursore).
  const _p = (_proto === 'tc_appreto' && !hasPrecomputedTimeline) ? (() => {
    if (draft.puntataH != null) return draft.puntataH;  // override manuale
    const totalDoughG2 = (draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100 + (draft.salt ?? 2) / 100);
    const panMassKg2   = totalDoughG2 / 1000 / Math.max(1, draft.numPanetti ?? 6);
    const cPreset2 = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
    // initialAdu include sia lievito madre che prefermento (biga/poolish)
    const initAdu2  = ((combined.initialMaturationOffset ?? 0) + prefInitialAdu / 10) * 10;
    const puntataMax2 = puntataMaxHForStyle(
      draft.style ?? 'napoletana', muMax, aParams.lambda, aParams.Ea, aType, initAdu2,
    );
    return computeOptimalPuntataH({
      muMax, lambda: aParams.lambda, agentType: aType, Ea: aParams.Ea,
      fridgeTempC: draft.fridgeTempC ?? 4,
      tcHours: _tc, staglioH: _s,
      panMassKg: panMassKg2, hydrationPct: draft.hydration ?? 65,
      tauMultiplier: cPreset2?.tauMultiplier ?? 1.0,
      warmupH: _warmup, initialAdu: initAdu2,
      maxH: puntataMax2,
    });
  })() : (draft.puntataH ?? 8);

  const totalH =
    _proto === 'ta'           ? _p + _s + _a
    : _proto === 'tc'         ? _tc + _s
    : _proto === 'tc_puntata' ? _tc + _s + _a
    : /* tc_appreto */          _p + _s + _tc + _a;
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
    alertThreshold:         draft.alertThreshold ?? 85,
    containerPreset:        draft.containerPreset ?? 'closed_box',
    apprettoProtocol:       draft.apprettoProtocol ?? 'ta',
    puntataH:               _p,   // tc_appreto → back-calcolato; altri → slider utente
    staglioH:               draft.staglioH ?? 0.5,
    apprettoH:              _a,
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
    kneadingMethod:          draft.kneadingMethod ?? 'spiral',  // §2.7 — default spirale
    tLaboratorio:            draft.tLaboratorio ?? 20,           // §2.7 — T ambiente impasto
    // Offset iniziale: contributo sourdough (engine) + ADU head-start da biga/poolish
    // prefInitialAdu è in unità ADU; /10 per normalizzare alla scala di initialMaturationOffset
    initialMaturationOffset: (combined.initialMaturationOffset ?? 0) + prefInitialAdu / 10,
    initialPH:               combined.initialPH,
    combinedInitialState:    combined,
    targetBakeAt:            bakeAt,
    startedAt:               new Date(),
    createdAt:               new Date(),
    // Service-Window planner: timeline precomputata (onorata da startSession) + soglia bolle
    thermalTimeline:         draft.thermalTimeline,
    bubbleThresholdPct:      draft.bubbleThresholdPct ?? 92,
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
        min={200} max={13_000} step={50} />
      <NumInput label="Numero panetti"
        value={draft.numPanetti ?? 6} onChange={v => update({ numPanetti: Math.round(v) })}
        min={1} max={100} step={1} />
      <Card style={{ background: 'rgba(255,140,50,0.08)', border: '1px solid rgba(255,140,50,0.2)' }}>
        <span style={{ ...S.label, color: 'var(--accent-brand)' }}>Peso panetto stimato</span>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 700, marginTop: 4 }}>
          {draft.totalFlourGrams && draft.numPanetti
            ? `~${Math.round((draft.totalFlourGrams * (1 + ((draft.hydration ?? 65) / 100))) / draft.numPanetti)}g`
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

// ─── Selettore farina da libreria ─────────────────────────────────────────────
function FlourSelector({ value, onSelect }: {
  value: string;
  onSelect: (entry: FlourEntry) => void;
}) {
  const brands = getFlourBrands();
  return (
    <select
      value={value}
      onChange={e => {
        const entry = FLOUR_DATABASE.find(f => f.id === e.target.value);
        if (entry) onSelect(entry);
      }}
      style={{
        width: '100%',
        background: 'var(--bg-elevated)',
        color: value ? 'var(--text-primary)' : 'var(--text-muted)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        cursor: 'pointer',
        outline: 'none',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        paddingRight: 28,
      }}
    >
      <option value="">📚 Libreria farine…</option>
      {brands.map(brand => (
        <optgroup key={brand} label={brand}>
          {getFloursByBrand(brand).map(f => (
            <option key={f.id} value={f.id}>
              {f.name} — W{f.W} · P/L {f.pl} · {f.protein}% prot.
            </option>
          ))}
        </optgroup>
      ))}
      <option value="custom">✏️ Personalizzata (valori manuali)</option>
    </select>
  );
}

// ─── Riga farina rinfresco ────────────────────────────────────────────────────
function FlourRow({ flour, idx, total, onChange, onRemove }: {
  flour: FlourComponent; idx: number; total: number;
  onChange: (f: FlourComponent) => void; onRemove: () => void;
}) {
  const [selectedId, setSelectedId] = useState('');

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
      {/* Selettore libreria */}
      <FlourSelector value={selectedId} onSelect={entry => {
        setSelectedId(entry.id);
        if (entry.id !== 'custom') {
          onChange({
            ...flour,
            name: entry.name, brand: entry.brand,
            W: entry.W, pl: entry.pl, protein: entry.protein,
            ...(entry.ash !== undefined ? { ash: entry.ash } : {}),
            ...(entry.FN  !== undefined ? { FN:  entry.FN  } : {}),
          });
        }
      }} />
      {/* Forza reologica: W + P/L sempre affiancati */}
      <Row2>
        <NumInput label="W" value={flour.W} onChange={v => onChange({ ...flour, W: v })} min={80} max={500} />
        <NumInput label="P/L" value={flour.pl} step={0.05} onChange={v => onChange({ ...flour, pl: v })} min={0.2} max={1.2} />
      </Row2>
      {/* Composizione: Proteine sola o affiancata a % blend */}
      {total > 1 ? (
        <Row2>
          <NumInput label="Proteine" unit="%" value={flour.protein} step={0.5} onChange={v => onChange({ ...flour, protein: v })} min={7} max={17} />
          <NumInput label="% blend" value={flour.percentage} onChange={v => onChange({ ...flour, percentage: v })} min={1} max={99} />
        </Row2>
      ) : (
        <NumInput label="Proteine" unit="%" value={flour.protein} step={0.5} onChange={v => onChange({ ...flour, protein: v })} min={7} max={17} />
      )}
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
    riporto:   'var(--state-approaching)',
  };
  const color = TYPE_COLORS[pref.type] ?? 'var(--accent-brand)';

  const hydMin = pref.type === 'biga' ? 40 : pref.type === 'riporto' ? 55 : 80;
  const hydMax = pref.type === 'biga' ? 60 : pref.type === 'riporto' ? 75 : 110;

  return (
    <Card elevated style={{ borderLeft: `4px solid ${color}`, paddingLeft: 12 }}>
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
          { value: 'riporto',   label: 'Riporto',  desc: 'Impasto vecchio' },
        ]}
        value={pref.type}
        onChange={v => {
          const t = v as 'poolish' | 'biga' | 'autolysis' | 'riporto';
          const newDefaults: Partial<PrefermentoComponent> =
            t === 'poolish'   ? { hydration: 100, yeastPct: 0.05, durationH: 12 }
            : t === 'biga'    ? { hydration:  48, yeastPct: 0.10, durationH: 16 }
            : t === 'riporto' ? { hydration:  65, yeastPct: undefined, durationH: 24 }
            : { yeastPct: undefined, durationH: 1 };
          onUpdate({ ...pref, type: t, ...newDefaults });
        }}
      />

      {/* ── Composizione ── */}
      <FormSection title="Composizione" accent={color}>
        {pref.type !== 'autolysis' ? (
          <Row2>
            <SliderInput label="% farina tot." unit="%" value={pref.flourFraction}
              onChange={v => onUpdate({ ...pref, flourFraction: v })}
              min={5} max={70} step={1} color={color} />
            <SliderInput label="Idratazione" unit="%" value={pref.hydration}
              onChange={v => onUpdate({ ...pref, hydration: v })}
              min={hydMin} max={hydMax} step={1} color={color} />
          </Row2>
        ) : (
          <SliderInput label="% farina tot." unit="%" value={pref.flourFraction}
            onChange={v => onUpdate({ ...pref, flourFraction: v })}
            min={5} max={70} step={1} color={color} />
        )}
      </FormSection>

      {/* ── Parametri di maturazione ── */}
      <FormSection title="Maturazione" accent={color}>
        <Row2>
          <NumInput label="Temperatura" unit="°C"
            value={pref.tempC} onChange={v => onUpdate({ ...pref, tempC: v })}
            min={2} max={32} step={0.5} />
          <NumInput label="Durata" unit="h"
            value={pref.durationH} onChange={v => onUpdate({ ...pref, durationH: v })}
            min={0.5} max={72} step={0.5} />
        </Row2>
        {pref.type !== 'autolysis' && pref.type !== 'riporto' && (
          <NumInput label="Lievito" unit="%"
            value={pref.yeastPct ?? 0.05} onChange={v => onUpdate({ ...pref, yeastPct: v })}
            min={0.005} max={1.0} step={0.005} />
        )}
        {pref.type === 'riporto' && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', padding: '6px 0' }}>
            Lievito già attivo dal batch precedente — nessuna dose aggiuntiva richiesta
          </div>
        )}
      </FormSection>

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
    const newType: 'poolish' | 'biga' | 'autolysis' | 'riporto' =
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
  // Range idratazione: intersezione vincoli stile (§7.x) × capacità farina (W)
  const hydRange = hydrationRangeForStyle(draft.style, draft.mainFlourGroup?.effectiveW);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SliderInput
        label="Idratazione" value={draft.hydration ?? hydRange.default}
        onChange={v => update({ hydration: v })}
        min={hydRange.min} max={hydRange.max} step={0.5} unit="%" />
      <SliderInput
        label="Sale" value={draft.salt ?? 2.0}
        onChange={v => update({ salt: v })}
        min={0} max={3.5} step={0.1} unit="%" color="var(--accent-info)" />
      {draft.salt !== undefined && (
        <Card style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Sale v2.4: −{((1 - Math.max(0.6, 1 - 0.1 * draft.salt)) * 100).toFixed(0)}% velocità lievitazione · −{((1 - Math.max(0.7, 1 - 0.08 * draft.salt)) * 100).toFixed(0)}% velocità proteolisi
          </span>
        </Card>
      )}
      <SliderInput
        label="Grasso" value={draft.fat ?? 0}
        onChange={v => update({ fat: v })}
        min={0} max={15} step={0.5} unit="%" color="var(--text-muted)" />

      {/* ── Metodo di impastamento + T_laboratorio → live T_acqua (§2.7 DDT) ── */}
      <FormSection title="Impastatrice">
        <SnapButtons<KneadingMethod>
          options={Object.entries(KNEADING_METHODS_FRICTION).map(([k, v]) => ({
            value: k as KneadingMethod,
            label: v.label,
          }))}
          value={draft.kneadingMethod ?? 'spiral'}
          onChange={v => update({ kneadingMethod: v })}
        />
        {/* Unico input mancante per il calcolo DDT: T ambiente al momento dell'impasto */}
        <NumInput
          label="T laboratorio (al momento impasto)"
          unit="°C"
          value={draft.tLaboratorio ?? 20}
          onChange={v => update({ tLaboratorio: v })}
          min={5} max={40} step={0.5}
        />
        {/* Risultato live: aggiornato ad ogni cambio di impastatrice o T_lab */}
        {(() => {
          const waterG  = Math.round((draft.totalFlourGrams ?? 1000) * (draft.hydration ?? 65) / 100);
          const tPref   = (draft.prefermenti?.length ?? 0) > 0
            ? draft.prefermenti!.reduce((s, p) => s + (p.tempC ?? 16), 0) / draft.prefermenti!.length
            : undefined;
          const ddtDef  = DDT_BY_STYLE[draft.style ?? 'napoletana'] ?? 24;
          const wResult = computeWaterTempDDT({
            ddtTarget:      ddtDef,
            tempAmbient:    draft.tLaboratorio ?? 20,
            kneadingMethod: (draft.kneadingMethod ?? 'spiral') as KneadingMethod,
            waterTotalGrams: waterG,
            tempPreferment: tPref,
          });
          return <WaterTempResultCard result={wResult} compact={true} />;
        })()}
        {draft.kneadingMethod && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            C_attrito: {KNEADING_METHODS_FRICTION[draft.kneadingMethod].cFrictionLo}–{KNEADING_METHODS_FRICTION[draft.kneadingMethod].cFrictionHi}°C
            · {KNEADING_METHODS_FRICTION[draft.kneadingMethod].notes}
          </div>
        )}
      </FormSection>

      <button
        onClick={() => setShowAdvanced(s => !s)}
        style={{ background: 'none', border: 'none', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
      >
        {showAdvanced ? '▾' : '▸'} Parametri avanzati (altitudine, durezza acqua)
      </button>

      {showAdvanced && (
        <FormSection title="Ambiente · Acqua">
          <Row2>
            <NumInput label="Altitudine" unit="m"
              value={draft.altitudeM ?? 0} onChange={v => update({ altitudeM: v })}
              min={0} max={4000} step={50} />
            <NumInput label="Durezza acqua" unit="ppm"
              value={draft.waterHardnessPpm ?? 150} onChange={v => update({ waterHardnessPpm: v })}
              min={0} max={600} step={10} />
          </Row2>
          {(draft.waterHardnessPpm ?? 150) !== 150 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              W ×{(1 + 0.0008 * ((draft.waterHardnessPpm ?? 150) - 150)).toFixed(3)} ·
              Proteolisi ×{(1 - 0.0004 * ((draft.waterHardnessPpm ?? 150) - 150)).toFixed(3)}
            </div>
          )}
        </FormSection>
      )}
    </div>
  );
}

function computeGrammiLievito(pesoFarinaG: number, dosePct: number, agentType: string): string {
  const grammi = (pesoFarinaG * dosePct) / 100;
  if (agentType === 'sourdough_wheat') return `${Math.round(grammi)}g lievito madre`;
  return `${grammi.toFixed(1)}g`;
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
      {draft.agentType && (<>
        <SliderInput
          label={doseLabel} value={draft.agentDosePct ?? doseRange[0]}
          onChange={v => update({ agentDosePct: v })}
          min={doseRange[0]} max={doseRange[1]}
          step={draft.agentType === 'sourdough_wheat' ? 1 : 0.05} unit="%" />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -8 }}>
          {draft.agentDosePct ?? doseRange[0]}% su {draft.totalFlourGrams ?? 1000}g farina ={' '}
          <strong style={{ color: 'var(--accent-brand)' }}>
            {computeGrammiLievito(draft.totalFlourGrams ?? 1000, draft.agentDosePct ?? doseRange[0], draft.agentType)}
          </strong>
        </div>
      </>)}

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

// ─── PuntataAlert ─────────────────────────────────────────────────────────────
function PuntataAlert({ puntataH, ambientTempC, style }: { puntataH: number; ambientTempC: number; style: string }) {
  const matPct = estimateEnzMatPctAtH(puntataH, ambientTempC);
  const profile = (getStyleProfile as Function)(style) as { puntataMatPct_target: number; puntataMatPct_range: [number, number] };
  const [lo, hi] = profile.puntataMatPct_range ?? [profile.puntataMatPct_target - 5, profile.puntataMatPct_target + 5];
  const over = matPct > hi;
  const under = matPct < lo;
  if (!over && !under) return null;
  return (
    <div style={{
      background: over ? 'rgba(214,48,49,0.12)' : 'rgba(253,203,110,0.12)',
      border: `1px solid ${over ? 'rgba(214,48,49,0.4)' : 'rgba(253,203,110,0.4)'}`,
      borderRadius: 'var(--radius-sm)', padding: '8px 12px',
      fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
      color: over ? 'var(--state-critical)' : 'var(--accent-warning)',
    }}>
      {over
        ? `⚠ Puntata eccessiva: maturazione al ${matPct.toFixed(0)}% (max ${hi}% per ${style}). Riduci le ore o abbassi la soglia.`
        : `ℹ Puntata breve: maturazione al ${matPct.toFixed(0)}% (min ${lo}% per ${style}).`}
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

  // Riscaldo TA finale (solo tc_appreto): ore per portare il panetto da frigo a 18°C
  // T ambiente assunta 22°C (default cucina) poiché il wizard non raccoglie tAmb.
  // Applica tauMultiplier del contenitore selezionato (inerzia termica).
  const warmupHDisplay = proto === 'tc_appreto' ? (() => {
    const totalDoughG = (draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100 + (draft.salt ?? 2) / 100);
    const panMassKg   = totalDoughG / 1000 / Math.max(1, draft.numPanetti ?? 6);
    const cPreset = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
    const tauMult = cPreset?.tauMultiplier ?? 1.0;
    return computeWarmupH(panMassKg, draft.hydration ?? 65, fridgeT, 22, tauMult);
  })() : 0;

  // Puntata TA ottimale calcolata (solo tc_appreto) — usata come default quando
  // l'utente non ha ancora spostato il cursore (draft.puntataH == null).
  const puntataHOptimalComputed = proto === 'tc_appreto' ? (() => {
    const aT2   = draft.agentType ?? 'fresh_yeast';
    const aP2   = (AGENT_GOMPERTZ as any)[aT2] as { Ea: number; lambda: number; muMax: number };
    const dRef2 = aT2 === 'fresh_yeast' ? 0.3 : aT2 === 'instant_dry_yeast' ? 0.1 : 1.0;
    const muMax2 = aP2.muMax * Math.max(0.1, Math.min(2, (draft.agentDosePct ?? dRef2) / dRef2));
    const totalDG2 = (draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100 + (draft.salt ?? 2) / 100);
    const panKg2  = totalDG2 / 1000 / Math.max(1, draft.numPanetti ?? 6);
    const cPreset2 = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
    const puntataMaxD = puntataMaxHForStyle(
      draft.style ?? 'napoletana', muMax2, aP2.lambda, aP2.Ea, aT2,
    );
    return computeOptimalPuntataH({
      muMax: muMax2, lambda: aP2.lambda, agentType: aT2, Ea: aP2.Ea,
      fridgeTempC: fridgeT, tcHours: freddo, staglioH: staglio,
      panMassKg: panKg2, hydrationPct: draft.hydration ?? 65,
      tauMultiplier: cPreset2?.tauMultiplier ?? 1.0,
      warmupH: warmupHDisplay, initialAdu: 0,
      maxH: puntataMaxD,
    });
  })() : puntata;
  // Effettivo per il display (usa override manuale se l'utente ha mosso il cursore)
  const puntataHOptimalDisplay = (proto === 'tc_appreto' && draft.puntataH != null)
    ? draft.puntataH
    : puntataHOptimalComputed;

  // Durata totale per protocollo
  const totalH =
    proto === 'ta'           ? puntata + staglio + appreto
    : proto === 'tc'         ? freddo + staglio
    : proto === 'tc_puntata' ? freddo + staglio + appreto
    : /* tc_appreto */         puntataHOptimalDisplay + staglio + freddo + warmupHDisplay;

  const isTcProto = proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SnapButtons
        label="Protocollo maturazione"
        options={[
          { value: 'ta',          label: 'TA',         desc: 'Tutto a temperatura ambiente' },
          { value: 'tc',          label: 'TC',         desc: 'Tutto in frigo (puntata + appretto)' },
          { value: 'tc_puntata',  label: 'TC Puntata', desc: 'Puntata in frigo → appretto TA' },
          { value: 'tc_appreto',  label: 'TC Appretto', desc: 'Puntata TA → appretto in frigo' },
        ]}
        value={proto}
        onChange={v => update({ apprettoProtocol: v as any, puntataH: undefined })}
      />

      {/* Temperatura frigo — visibile per tutti i protocolli TC */}
      {isTcProto && (
        <SliderInput label="Temperatura frigo" value={fridgeT}
          onChange={v => update({ fridgeTempC: v })} min={1} max={8} step={0.5} unit="°C"
          color="var(--state-cold)" />
      )}

      {/* ── TA: tutto a temperatura ambiente ── */}
      {proto === 'ta' && (
        <FormSection title="🌡 Tutto a temperatura ambiente">
          <SliderInput label="Puntata" value={puntata} onChange={v => update({ puntataH: v })}
            min={0.5} max={24} step={0.5} unit="h" />
          <SliderInput label="Staglio" value={staglio} onChange={v => update({ staglioH: v })}
            min={0.1} max={2} step={0.1} unit="h" />
          <SliderInput label="Appretto" value={appreto} onChange={v => update({ apprettoH: v })}
            min={0.5} max={12} step={0.5} unit="h" />
        </FormSection>
      )}

      {/* ── TC: tutto in frigo ── */}
      {proto === 'tc' && (
        <FormSection title="❄ Tutto in frigo" accent="var(--state-cold)">
          <SliderInput label="Freddo totale (puntata + appreto)" value={freddo}
            onChange={v => update({ tcHours: v })} min={2} max={72} step={1} unit="h"
            color="var(--state-cold)" />
          <SliderInput label="Staglio" value={staglio} onChange={v => update({ staglioH: v })}
            min={0.1} max={2} step={0.1} unit="h" />
        </FormSection>
      )}

      {/* ── TC Puntata: frigo → TA ── */}
      {proto === 'tc_puntata' && <>
        <FormSection title="❄ Puntata in frigo" accent="var(--state-cold)">
          <SliderInput label="Durata puntata" value={freddo}
            onChange={v => update({ tcHours: v })} min={2} max={72} step={1} unit="h"
            color="var(--state-cold)" />
        </FormSection>
        <FormSection title="🌡 Staglio + appretto a TA">
          <SliderInput label="Staglio" value={staglio} onChange={v => update({ staglioH: v })}
            min={0.1} max={2} step={0.1} unit="h" />
          <SliderInput label="Appretto finale" value={appreto} onChange={v => update({ apprettoH: v })}
            min={0.5} max={12} step={0.5} unit="h" color="var(--accent-brand)" />
        </FormSection>
      </>}

      {/* ── TC Appretto: TA → frigo → riscaldo ── */}
      {proto === 'tc_appreto' && <>
        <FormSection title="🌡 Puntata a temperatura ambiente">
          <SliderInput
            label={`Puntata TA ${draft.puntataH == null ? '(ottimale calcolata)' : '(manuale)'}`}
            value={puntataHOptimalDisplay}
            onChange={v => update({ puntataH: v })}
            min={0.5} max={24} step={0.5} unit="h"
            color="var(--accent-brand)"
          />
          {draft.puntataH != null && (
            <button
              onClick={() => update({ puntataH: undefined })}
              style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
            >
              Ripristina ottimale ({puntataHOptimalDisplay.toFixed(1)}h)
            </button>
          )}
          <PuntataAlert
            puntataH={puntataHOptimalDisplay}
            ambientTempC={draft.tLaboratorio ?? 22}
            style={draft.style ?? 'napoletana'}
          />
          <SliderInput label="Staglio" value={staglio} onChange={v => update({ staglioH: v })}
            min={0.1} max={2} step={0.1} unit="h" />
        </FormSection>
        <FormSection title="❄ Appretto in frigo" accent="var(--state-cold)">
          <SliderInput label="Durata appretto" value={freddo} onChange={v => update({ tcHours: v })}
            min={2} max={72} step={1} unit="h" color="var(--state-cold)" />
        </FormSection>
        <FormSection title="🌡 Riscaldo TA finale" accent="var(--state-approaching)">
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', background: 'rgba(253,203,110,0.08)',
            borderRadius: 'var(--radius-sm)', border: '1px solid rgba(253,203,110,0.18)',
          }}>
            <span style={{ ...S.label, color: 'var(--state-approaching)' }}>
              Da {fridgeT}°C → 18°C (servizio)
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--state-approaching)' }}>
              {warmupHDisplay > 0.05 ? `${warmupHDisplay.toFixed(1)}h` : '< 5 min'}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            Calcolato con legge di Newton · τ sferica · T ambiente 22°C assunta
          </span>
        </FormSection>
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
// STEP 8 — Riepilogo ricetta (read-only, pre-avvio sessione)
// ═══════════════════════════════════════════════════════════════════════════════
function Step8({ draft }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const hydration = draft.hydration ?? 65;
  const salt      = draft.salt ?? 2;
  const flour     = draft.totalFlourGrams ?? 0;
  const panetti   = draft.numPanetti ?? 1;

  // Peso panetto stimato = (farina + acqua + sale) / numPanetti
  const totalDoughG = flour * (1 + hydration / 100 + salt / 100);
  const panWeight   = panetti > 0 ? Math.round(totalDoughG / panetti) : 0;

  // Per tc_appreto: tempo di riscaldo TA finale e puntata ottimale (con inerzia contenitore)
  const panMassKgStep8 = panetti > 0 ? totalDoughG / 1000 / panetti : 0.28;
  const cPresetStep8   = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
  const tauMultStep8   = cPresetStep8?.tauMultiplier ?? 1.0;
  const warmupHStep8   = draft.apprettoProtocol === 'tc_appreto'
    ? computeWarmupH(panMassKgStep8, hydration, draft.fridgeTempC ?? 4, 22, tauMultStep8)
    : 0;
  // Puntata ottimale per step 8: muMax semplificato (senza prefermento, per anteprima)
  const puntataHStep8  = draft.apprettoProtocol === 'tc_appreto' ? (() => {
    const aT8   = draft.agentType ?? 'fresh_yeast';
    const aP8   = (AGENT_GOMPERTZ as any)[aT8] as { Ea: number; lambda: number; muMax: number };
    const dRef8 = aT8 === 'fresh_yeast' ? 0.3 : aT8 === 'instant_dry_yeast' ? 0.1 : 1.0;
    const muMax8 = aP8.muMax * Math.max(0.1, Math.min(2, (draft.agentDosePct ?? dRef8) / dRef8));
    const puntataMax8 = puntataMaxHForStyle(
      draft.style ?? 'napoletana', muMax8, aP8.lambda, aP8.Ea, aT8,
    );
    return computeOptimalPuntataH({
      muMax: muMax8, lambda: aP8.lambda, agentType: aT8, Ea: aP8.Ea,
      fridgeTempC: draft.fridgeTempC ?? 4,
      tcHours: draft.tcHours ?? 12, staglioH: draft.staglioH ?? 0.5,
      panMassKg: panMassKgStep8, hydrationPct: hydration,
      tauMultiplier: tauMultStep8, warmupH: warmupHStep8, initialAdu: 0,
      maxH: puntataMax8,
    });
  })() : (draft.puntataH ?? 8);

  const protoLabel: Record<string, string> = {
    ta:         'Tutto TA',
    tc:         'TC totale',
    tc_puntata: 'TC Puntata',
    tc_appreto: 'TC Appretto',
  };
  const agentLabel: Record<string, string> = {
    fresh_yeast:       'LBF (fresco)',
    instant_dry_yeast: 'IDY (secco)',
    sourdough_wheat:   'LM (pasta madre)',
  };
  const styleLabel: Record<string, string> = {
    napoletana:    'Napoletana',
    contemporanea: 'Contemporanea',
    teglia:        'Teglia',
    pala:          'Pala',
    nystyle:       'NY Style',
  };

  const isTcProto = draft.apprettoProtocol !== 'ta';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Dimensioni impasto ── */}
      <Card elevated>
        <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)' }}>
          Impasto
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Metric label="Farina" value={flour} unit="g" />
          <Metric label="Panetti" value={panetti} />
          <Metric label="Peso panetto" value={panWeight} unit="g" />
          <Metric label="Idratazione" value={hydration} unit="%" />
          <Metric label="Sale" value={salt} unit="%" />
          {(draft.fat ?? 0) > 0 && <Metric label="Grassi" value={draft.fat!} unit="%" />}
        </div>
      </Card>

      {/* ── Farina e stile ── */}
      <Card>
        <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Farina e stile
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Metric label="Stile" value={styleLabel[draft.style ?? ''] ?? draft.style ?? '–'} />
          <Metric label="W" value={draft.mainFlourGroup?.effectiveW != null ? draft.mainFlourGroup.effectiveW.toFixed(0) : '–'} />
          <Metric label="Protocollo" value={protoLabel[draft.apprettoProtocol ?? 'ta'] ?? '–'} />
          {draft.mainFlourGroup?.effectivePl != null && <Metric label="P/L" value={draft.mainFlourGroup.effectivePl.toFixed(2)} />}
        </div>
      </Card>

      {/* ── Agente lievitante ── */}
      <Card>
        <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Agente lievitante
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Metric label="Tipo" value={agentLabel[draft.agentType ?? ''] ?? draft.agentType ?? '–'} />
          <Metric label="Dose" value={draft.agentDosePct ?? '–'} unit="%" />
          {draft.agentType && draft.agentDosePct != null && (draft.totalFlourGrams ?? 0) > 0 && (
            <Metric label="Grammi lievito" value={computeGrammiLievito(draft.totalFlourGrams!, draft.agentDosePct, draft.agentType)} />
          )}
          {(draft.maltDosePct ?? 0) > 0 && <Metric label="Malto" value={draft.maltDosePct!} unit="%" />}
        </div>
      </Card>

      {/* ── Tempistiche ── */}
      <Card>
        <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Tempistiche
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {draft.apprettoProtocol !== 'tc' && (
            <Metric
              label="Puntata TA"
              value={draft.apprettoProtocol === 'tc_appreto' ? puntataHStep8.toFixed(1) : (draft.puntataH ?? '–')}
              unit="h"
              color={draft.apprettoProtocol === 'tc_appreto' ? 'var(--accent-brand)' : undefined}
            />
          )}
          {isTcProto && (
            <Metric label="Freddo" value={draft.tcHours ?? '–'} unit="h" color="var(--state-cold)" />
          )}
          <Metric label="Staglio" value={draft.staglioH ?? '–'} unit="h" />
          {draft.apprettoProtocol !== 'tc' && draft.apprettoProtocol !== 'tc_appreto' && (
            <Metric label="Appretto" value={draft.apprettoH ?? '–'} unit="h" />
          )}
          {draft.apprettoProtocol === 'tc_appreto' && (
            <Metric label="Riscaldo TA" value={warmupHStep8.toFixed(1)} unit="h" color="var(--state-approaching)" />
          )}
          {isTcProto && (
            <Metric label="T frigo" value={draft.fridgeTempC ?? 4} unit="°C" color="var(--state-cold)" />
          )}
        </div>
      </Card>

      {/* ── Prefermenti ── */}
      {draft.prefermenti && draft.prefermenti.length > 0 && (
        <Card>
          <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Prefermenti
          </div>
          {draft.prefermenti.map((p: PrefermentoComponent, i: number) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: i < draft.prefermenti!.length - 1 ? 8 : 0 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700, textTransform: 'capitalize' }}>{p.type}</span>
              {' '}{p.flourFraction}% farina · {p.durationH}h · {p.tempC}°C · idr. {p.hydration}%
            </div>
          ))}
        </Card>
      )}

      {/* ── 💧 Acqua di impastamento (DDT automatico) ── */}
      {(() => {
        const waterG    = Math.round(flour * (hydration / 100));
        const hasPref   = (draft.prefermenti?.length ?? 0) > 0;
        const tPrefAvg  = hasPref
          ? draft.prefermenti!.reduce((s, p) => s + (p.tempC ?? 16), 0) / draft.prefermenti!.length
          : undefined;
        const ddtDef    = DDT_BY_STYLE[draft.style ?? 'napoletana'] ?? 24;
        const wResult   = computeWaterTempDDT({
          ddtTarget:       ddtDef,
          tempAmbient:     draft.tLaboratorio ?? 20,
          kneadingMethod:  (draft.kneadingMethod ?? 'spiral') as KneadingMethod,
          waterTotalGrams: waterG,
          tempPreferment:  tPrefAvg,
        });
        return (
          <Card>
            <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
              💧 Acqua di impastamento
            </div>
            <WaterTempResultCard
              result={wResult}
              showFormula={true}
              ddtTarget={ddtDef}
              tAmbient={draft.tLaboratorio ?? 20}
            />
          </Card>
        );
      })()}

      {/* Nota avvio */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)',
        textAlign: 'center', padding: '4px 0',
      }}>
        Premi "🍕 Avvia sessione" per iniziare il monitoraggio
      </div>
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
  'Riepilogo',
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
        // Persist session + initial ProcessLogEntry (KB §12.1) — fire-and-forget
        startSession(session).catch(err => console.error('[startSession]', err));
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
    // tc_appreto: puntataH calcolata automaticamente → basta avere il protocollo
    if (step === 7) return !!(draft.apprettoProtocol && (draft.apprettoProtocol === 'tc_appreto' || draft.puntataH));
    if (step === 8) return true;
    return true;
  };

  const StepComponent = [Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8][step - 1];

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
