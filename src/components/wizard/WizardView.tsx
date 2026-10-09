/**
 * PizzaMatrix — Wizard v4 (7 step)
 * §7.2 KB: stile→protocollo→farine+prefermenti→idratazione→lievito→contenitore→tempistiche
 */
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { fmtClockDay } from '../../lib/fmtTime';
import { useApp, type WizardDraft } from '../../context/AppContext';
import type { Session, FlourGroup, FlourComponent, PrefermentoComponent } from '../../db/db';
import { buildInitialTimeline, type PhaseSegment } from '../../db/db';

/**
 * Una timeline precomputata (Planner/Servizio) può arrivare tutta "planned":
 * all'avvio il primo segmento è già in corso. Stati dal tempo trascorso (zero),
 * altrimenti la dashboard chiederebbe di "entrare" nella fase già in corso.
 */
export function normalizeTimelineStatus(tl: PhaseSegment[], nowElapsedH = 0): PhaseSegment[] {
  return [...tl].sort((a, b) => a.startElapsedH - b.startElapsedH).map(sg => {
    const end = sg.endElapsedH ?? sg.startElapsedH;
    const status: PhaseSegment['status'] =
      end <= nowElapsedH && end > sg.startElapsedH ? 'completed'
      : sg.startElapsedH <= nowElapsedH && end > nowElapsedH ? 'current'
      : 'planned';
    return { ...sg, status };
  });
}
import {
  Card, Btn, SnapButtons, NumInput, SliderInput, StepHeader, S, FormSection, Row2, Metric,
  Badge, ExpandableReward, Advisory, fmtHours,
} from '../ui';
import {
  normalizeFlourGroup, computeCombinedInitialState,
  computeMaltAmylaseContrib, computeTotalAmylaseIndex, maltAlertLevel,
  scaleMuMaxByDose, doseFactorSaturated,
  AGENT_GOMPERTZ, CONTAINER_THERMAL_PRESETS, kEffective, getStyleProfile,
  KNEADING_METHODS_FRICTION, computeWaterTempDDT, type KneadingMethod,
  computeEffectiveMixHydration,
} from '../../engine';
import { WaterTempResultCard } from '../tools/WaterTempView';
import { WizardInputSchema } from '../../lib/schemas';
import { draftOverrunH } from '../../lib/plannerFit';
import { warmupHForSession, TH_CP_WATER, TH_CP_FLOUR, TH_RHO_DOUGH, TH_H_AIR } from '../../lib/warmup';
import { fridgePhaseIsSanctioned } from '../../engine/outOfProtocol';
import { engineReadyH, apprettoCorrectionH, fmtBakeClock, suggestedApprettoH } from '../../lib/bakeForecast';
import { startSession, savePrefermentStage, deletePrefermentStage, deleteAllPrefermentStages } from '../../services/sessionService';
import {
  isPreparable, placeOf, placeTempC, durationOptions, defaultDuration, fractionOptions,
  prefName, prefWithArticle, prefIsFeminine, splitRecipe, prefTempAtMix, fmtGrams, type PrefPlace,
  recipeProblem, stageDurationH, MIN_FINAL_FLOUR_PCT, buildStageItems, mainPreparable, recipeFixKind, prefAl,
} from '../../lib/preferment';
import { estimateEnzMatPctAtH } from '../../engine/serviceWindowSolver';
import {
  FLOUR_DATABASE, getFlourBrands, getFloursByBrand, type FlourEntry,
  DEFAULT_FALLING_NUMBER, resolveFallingNumber,
} from '../../data/flourDatabase';
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
    poolish:   { flourFraction: 30, hydration: 100, tempC: 20, durationH: 12, yeastPct: 0.05, place: 'stanza' },
    biga:      { flourFraction: 50, hydration:  48, tempC: 16, durationH: 16, yeastPct: 0.10, place: 'fresco' },
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

/**
 * Appretto del draft: quello scelto, altrimenti (tutto TA) quello che fa
 * infornare al pronto del motore; 4 h se il motore non lo sa dire.
 */
export function resolvedApprettoH(draft: WizardDraft): number {
  if (draft.apprettoH != null) return draft.apprettoH;
  if ((draft.apprettoProtocol ?? 'ta') !== 'ta') return 4;
  try {
    const s0 = buildSessionRaw({ ...draft, apprettoH: 4 });
    return suggestedApprettoH(engineReadyH(s0), s0.puntataH ?? 8, s0.staglioH ?? 0.5) ?? 4;
  } catch {
    return 4;
  }
}

export function buildSession(draft: WizardDraft): Session {
  return buildSessionRaw((draft.apprettoProtocol ?? 'ta') === 'ta' && draft.apprettoH == null
    ? { ...draft, apprettoH: resolvedApprettoH(draft) }
    : draft);
}

function buildSessionRaw(draft: WizardDraft): Session {
  // ── Validazione Zod .strict() (guardia data-layer per tutti i campi wizard) ──
  const parsed = WizardInputSchema.safeParse(draft);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => i.message).join(' · ');
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
  // issue #8 — sorgente unica nell'engine. Il clamp era [0.1, 2] duplicato in
  // cinque punti fra questo file, il Planner e il solver.
  const muMax = (scaleMuMaxByDose as Function)(aParams.muMax, effectiveDosePct, doseRef) as number;

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
  // Un piano arrivato dal Planner è autoritativo anche senza timeline precomputata:
  // riscaldo e puntata restano quelli mostrati nel planner, niente ricalcolo qui.
  const fromPlanner = draft.navigationSource === 'planner';
  const plannerAuthoritative = hasPrecomputedTimeline || fromPlanner;

  // Anche "TC · Tutto in frigo" finisce con il riscaldo fuori dal frigo: senza,
  // dopo 30 min di staglio il cuore arriva a cottura a ~9 °C.
  const needsWarmup = _proto === 'tc_appreto' || _proto === 'tc';
  const _warmup = (needsWarmup && !plannerAuthoritative) ? warmupHForSession(draft, 22) : 0;
  const _a = needsWarmup
    ? (fromPlanner && !hasPrecomputedTimeline ? (draft.temperingH ?? draft.apprettoH ?? 0) : _warmup)
    : (draft.apprettoH ?? 4);

  // Per tc_appreto: puntataH viene back-calcolata automaticamente oppure usa l'override
  // manuale dell'utente (draft.puntataH != null dopo che l'utente ha spostato il cursore).
  const _p = (_proto === 'tc_appreto' && !plannerAuthoritative) ? (() => {
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
    : _proto === 'tc'         ? _tc + _s + _a
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
    // Soglia della sessione: quella scelta (planner) o, di default, quella dello stile.
    alertThreshold:         draft.alertThreshold ?? (getStyleProfile as Function)(draft.style ?? 'napoletana').alertThreshold ?? 85,
    alertThresholdFromPlan: fromPlanner && draft.alertThreshold != null ? true : undefined,
    // Piano del Planner con il frigo: la scelta è già fatta, niente modale fuori protocollo.
    // Il frigo scelto nel wizard (o nel Planner) è una scelta già fatta: niente modale dopo l'avvio.
    outOfProtocolPhaseConfirmed: _proto !== 'ta' ? true : undefined,
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
    kneadDurationMin:        draft.kneadDurationMin ?? 12,       // §2.7 v2.4.24 — durata impasto
    tapWaterC:               draft.tapWaterC,                    // §2.7 v2.4.24 — acqua rubinetto
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
    // temperingH: dal planner (draft.temperingH) o calcolato da buildSession per tc e tc_appreto
    temperingH:              draft.temperingH ?? (needsWarmup ? _a : 0),
    serviceWindowH:          draft.serviceWindowH,
  } as unknown as Session;
}

/** Il piano non sta nell'orario di cottura scelto: la frase da mostrare, o null. */
export function overrunMessage(draft: WizardDraft, now = Date.now()): string | null {
  const over = draftOverrunH(draft, now);
  return over != null && over > 0
    ? `Il piano non sta nell'orario: finisce ${fmtHours(over)} dopo il Forno. Torna al Planner.`
    : null;
}

/** Prefermento da preparare adesso: prima la fase "in corso", poi l'impasto. */
export function startsWithPreferment(draft: WizardDraft): boolean {
  return (draft.prefermentTiming ?? 'now') === 'now'
    && draft.protocol !== 'direct'
    && (draft.prefermenti ?? []).some(isPreparable);
}

/**
 * Costruisce la sessione dal draft e la avvia (memoria + IndexedDB).
 * Lancia se il draft non è valido. Usata dal wizard e dalla fase prefermento.
 */
export function launchSession(draft: WizardDraft, dispatch: ReturnType<typeof useApp>['dispatch']): void {
  const built = buildSession(draft);
  // La sessione in memoria nasce già con la sua timeline: altrimenti ogni
  // cambio di fase la ricostruirebbe dall'orologio (stati per orario, durate
  // di default) e l'annulla ripartirebbe da una timeline diversa da quella mostrata.
  const session: Session = {
    ...built,
    thermalTimeline: built.thermalTimeline && built.thermalTimeline.length > 0
      ? normalizeTimelineStatus(built.thermalTimeline)
      : buildInitialTimeline(built as any),
  };
  dispatch({ type: 'SESSION_START', session });
  // Persist session + initial ProcessLogEntry (KB §12.1). L'id arriva da Dexie:
  // senza, i cambi di fase non verrebbero mai salvati e la chiusura creerebbe
  // un secondo record nello Storico.
  startSession(session)
    .then(id => dispatch({ type: 'SESSION_UPDATE', patch: { id } }))
    .catch(err => console.error('[startSession]', err));
}

/**
 * Orario di cottura previsto per il draft, lo stesso che mostrerà la dashboard:
 * tutto TA → previsione del motore; con il frigo → il piano delle fasi.
 * Con un prefermento da preparare l'impasto parte quando è pronto.
 */
export function draftBakeForecast(draft: WizardDraft, now = Date.now()): { ms: number; planMs: number; fromEngine: boolean } | null {
  try {
    const s = buildSession(draft);
    const offset = startsWithPreferment(draft) ? stageDurationH(draft.prefermenti) * 3_600_000 : 0;
    const planMs = new Date(s.targetBakeAt).getTime() - new Date(s.startedAt).getTime() + now + offset;
    const h = draft.targetBakeAt ? null : engineReadyH(s);
    return h != null ? { ms: now + offset + h * 3_600_000, planMs, fromEngine: true } : { ms: planMs, planMs, fromEngine: false };
  } catch {
    return null;
  }
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
  // Quattro scelte concrete invece del "protocollo": biga e poolish sono i casi
  // comuni e partono già configurati; il resto (riporto, autolisi, due
  // prefermenti) sta in "Avanzato".
  type Kind = 'direct' | 'biga' | 'poolish' | 'advanced';
  const first = draft.prefermenti?.[0];
  const kind: Kind | undefined = !draft.protocol ? undefined
    : draft.protocol === 'direct' ? 'direct'
    : draft.protocol === 'single_pref' && first && isPreparable(first) ? first.type as Kind
    : 'advanced';
  const choose = (k: Kind) => {
    if (k === kind) return;
    if (k === 'direct') { update({ protocol: 'direct', prefermenti: [] }); return; }
    if (k === 'advanced') { update({ protocol: 'mix_advanced', prefermenti: [] }); return; }
    const fg = draft.mainFlourGroup ?? (normalizeFlourGroup as Function)([
      { name: '', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 },
    ]) as FlourGroup;
    update({ protocol: 'single_pref', mainFlourGroup: fg, prefermenti: [createDefaultPref(k, fg)] });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SnapButtons<Kind>
        label="Tipo di impasto"
        options={[
          { value: 'direct',   label: 'Diretto',  desc: 'Tutto in una volta' },
          { value: 'biga',     label: 'Biga',     desc: 'Asciutta · 16–24 h prima' },
          { value: 'poolish',  label: 'Poolish',  desc: 'Liquido · 8–16 h prima (di più in frigo)' },
          { value: 'advanced', label: 'Avanzato', desc: 'Riporto, autolisi, due prefermenti' },
        ]}
        value={kind}
        onChange={choose}
      />
      {(kind === 'biga' || kind === 'poolish') && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, margin: 0 }}>
          Nel prossimo passo scegli quanta farina va {kind === 'biga' ? 'nella biga' : 'nel poolish'} e
          quando {kind === 'biga' ? 'la' : 'lo'} prepari: grammi e orari li calcolo io.
        </p>
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
        border: '1px solid var(--pm4-line-strong)',
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
  const fnResolved = resolveFallingNumber(flour);

  return (
    <Card elevated style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>Farina {idx + 1}</span>
        {total > 1 && (
          <button onClick={onRemove} aria-label={`Rimuovi farina ${idx + 1}`} style={{
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
      {/* Falling Number — issue #7: il default non deve piu' essere silenzioso */}
      <NumInput
        label="Falling Number" unit="s"
        value={flour.FN ?? DEFAULT_FALLING_NUMBER} step={10} min={150} max={450}
        onChange={v => onChange({ ...flour, FN: v })} />
      {!fnResolved.measured && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Indice di caduta non dichiarato dal molino: calcolo amilasico su stima
          ({DEFAULT_FALLING_NUMBER} s). Se hai la scheda tecnica, inserisci il valore reale.
        </span>
      )}
    </Card>
  );
}

// ─── Prefermento in pratica: poche scelte, il resto si ricava ─────────────────
const PLACE_LABEL: Record<PrefPlace, string> = { fresco: 'Fresco', stanza: 'Stanza', frigo: 'Frigo' };

/** "Da preparare / Già pronta": vale per tutti i prefermenti che si preparano. */
function PrefTimingPicker({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const [undo, setUndo] = useState<{ prev: PrefermentoComponent[]; text: string } | null>(null);
  const prep = (draft.prefermenti ?? []).filter(isPreparable);
  if (prep.length === 0) return null;
  const type = prep.length === 1 ? prep[0].type : 'biga';
  const fem = prep.length === 1 ? prefIsFeminine(type) : false;
  const name = prep.length === 1 ? prefWithArticle(type) : 'i prefermenti';
  // "Impastata 20 h fa" non è una durata di maturazione: passando a "da preparare"
  // la durata torna quella proposta per il luogo, con avviso e ripristino.
  const choose = (v: 'now' | 'ready') => {
    setUndo(null);
    const all = draft.prefermenti ?? [];
    if (v === 'now' && draft.prefermentTiming === 'ready') {
      const changed: string[] = [];
      const next = all.map(p => {
        if (!isPreparable(p)) return p;
        const opts = durationOptions(p.type, placeOf(p));
        if (opts.includes(p.durationH)) return p;
        const d = defaultDuration(p.type, placeOf(p));
        changed.push(`${prefName(p.type)} ${d} h (era ${p.durationH} h)`);
        return { ...p, durationH: d };
      });
      if (changed.length) {
        setUndo({ prev: all, text: `Ho riportato la durata a quella proposta: ${changed.join(', ')}.` });
        update({ prefermentTiming: v, prefermenti: next });
        return;
      }
    }
    update({ prefermentTiming: v });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <SnapButtons<'now' | 'ready'>
      label={prep.length === 1 ? `${name.charAt(0).toUpperCase()}${name.slice(1)} è…` : 'I prefermenti sono…'}
      options={[
        { value: 'now',   label: 'Da preparare', desc: prep.length === 1 ? `${fem ? 'la' : 'lo'} preparo adesso` : 'li preparo adesso' },
        { value: 'ready', label: prep.length === 1 ? (fem ? 'Già pronta' : 'Già pronto') : 'Già pronti',
          desc: prep.length === 1 ? (fem ? "l'ho già fatta" : "l'ho già fatto") : "li ho già fatti" },
      ]}
      value={draft.prefermentTiming ?? 'now'}
      onChange={choose}
    />
    {undo && (
      <Advisory tone="teal" text={undo.text} undoLabel="Ripristina"
        onUndo={() => { update({ prefermenti: undo.prev }); setUndo(null); }}
        onDismiss={() => setUndo(null)} />
    )}
    </div>
  );
}

function SimplePrefCard({ pref, draft, update, onUpdate }: {
  pref: PrefermentoComponent; draft: WizardDraft;
  update: (p: Partial<WizardDraft>) => void;
  onUpdate: (p: PrefermentoComponent) => void;
}) {
  const totalFlour = draft.totalFlourGrams ?? 1000;
  const fridge = draft.fridgeTempC ?? 4;
  const place = placeOf(pref);
  const ready = draft.prefermentTiming === 'ready';
  const name = prefName(pref.type);
  const fem = prefIsFeminine(pref.type);
  const color = pref.type === 'biga' ? 'var(--pref-biga)' : 'var(--pref-poolish)';
  const durations = durationOptions(pref.type, place);
  const setPlace = (pl: PrefPlace) => onUpdate({
    ...pref, place: pl, tempC: placeTempC(pl, fridge),
    durationH: ready ? pref.durationH : defaultDuration(pref.type, pl),
  });
  const grams = splitRecipe({
    totalFlourG: totalFlour, hydrationPct: draft.hydration ?? 65, saltPct: draft.salt ?? 2,
    agentDosePct: draft.agentDosePct ?? 0, prefermenti: [pref],
  }).prefs[0];

  return (
    <Card elevated style={{ border: `1px solid ${color}55`, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ ...S.label, color }}>{name.charAt(0).toUpperCase() + name.slice(1)}</span>

      <SnapButtons<string>
        label={`Farina ${fem ? 'nella' : 'nel'} ${name}`}
        options={fractionOptions(pref.type).map(f => ({
          value: String(f), label: `${f}%`, desc: fmtGrams(totalFlour * f / 100),
        }))}
        value={String(pref.flourFraction)}
        onChange={v => onUpdate({ ...pref, flourFraction: Number(v) })}
      />

      <PrefTimingPicker draft={draft} update={update} />

      <SnapButtons<PrefPlace>
        label={ready ? `Dove è ${fem ? 'stata' : 'stato'}` : 'Dove matura'}
        options={(['fresco', 'stanza', 'frigo'] as PrefPlace[]).map(pl => ({
          value: pl, label: PLACE_LABEL[pl], desc: `~${placeTempC(pl, fridge)}°C`,
        }))}
        value={place}
        onChange={setPlace}
      />

      {ready ? (
        <NumInput label={`Da quante ore ${fem ? "l'hai impastata" : "l'hai impastato"}`} unit="h"
          value={pref.durationH} onChange={v => onUpdate({ ...pref, durationH: v })}
          min={1} max={72} step={1} />
      ) : (
        <SnapButtons<string>
          label="Per quante ore"
          options={(durations.includes(pref.durationH) ? durations : [...durations, pref.durationH].sort((a, b) => a - b))
            .map(h => ({ value: String(h), label: `${h} h` }))}
          value={String(pref.durationH)}
          onChange={v => onUpdate({ ...pref, durationH: Number(v) })}
        />
      )}

      {/* Cosa pesare: subito, non al riepilogo */}
      <div style={{
        padding: '8px 12px', background: `${color}14`, borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--pm4-flour)', lineHeight: 1.6,
      }}>
        {fmtGrams(grams.flourG)} farina · {fmtGrams(grams.waterG)} acqua
        {grams.yeastG != null && <> · {fmtGrams(grams.yeastG)} lievito</>}
      </div>

      <details>
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center',
          fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--pm4-tan)' }}>
          Regola a mano (idratazione, lievito, temperatura)
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
          <SliderInput label="Idratazione" unit="%" value={pref.hydration}
            onChange={v => onUpdate({ ...pref, hydration: v })}
            min={pref.type === 'biga' ? 40 : 95} max={pref.type === 'biga' ? 55 : 105} step={1} color={color} />
          <Row2>
            <NumInput label={`Lievito ${fem ? 'nella' : 'nel'} ${name}`} unit="%"
              value={pref.yeastPct ?? 0.05} onChange={v => onUpdate({ ...pref, yeastPct: v })}
              min={0.05} max={pref.type === 'biga' ? 2 : 1} step={0.05} />
            <NumInput label="Temperatura" unit="°C"
              value={pref.tempC} onChange={v => onUpdate({ ...pref, tempC: v })}
              min={2} max={32} step={0.5} />
          </Row2>
        </div>
      </details>
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

  // Cambio di tipo: valori precedenti da ripristinare (WP-5B esteso a tutti i tipi).
  const [typeUndo, setTypeUndo] = useState<{ prev: PrefermentoComponent; text: string } | null>(null);
  const typeRef = useRef<HTMLDivElement>(null);

  // Stessi limiti dello schema (schemas.ts): uno slider non deve portare dove l'avvio poi rifiuta.
  const hydMin = pref.type === 'biga' ? 40 : pref.type === 'riporto' ? 55 : pref.type === 'autolysis' ? 50 : 95;
  const hydMax = pref.type === 'biga' ? 55 : pref.type === 'riporto' ? 75 : pref.type === 'autolysis' ? 80 : 105;

  return (
    <Card elevated style={{ border: `1px solid ${color}55` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ ...S.label, color }}>Pre-fermento {idx + 1}</span>
        <button onClick={onRemove} aria-label={`Rimuovi pre-fermento ${idx + 1}`} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: '1.1rem', minWidth: 44, minHeight: 44,
        }}>×</button>
      </div>

      <div ref={typeRef}>
      <SnapButtons
        label={`Tipo pre-fermento ${idx + 1}`}
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
            // Autolisi: idr. 50–80% (vincolo schema). Reset esplicito perché lo slider
            // idratazione è nascosto per l'autolisi → senza questo, un poolish convertito
            // resterebbe a 100% e bloccherebbe l'avvio (Zod superRefine).
            : { hydration: 65, yeastPct: undefined, durationH: 1 };
          // Mai sovrascrivere in silenzio: se cambiano idratazione, lievito o durata
          // lo si dice, con "Ripristina" che rimette il prefermento com'era (tipo compreso).
          const next = { ...pref, type: t, ...newDefaults };
          const fmt = (p: PrefermentoComponent) => [
            `idratazione ${p.hydration}%`,
            p.yeastPct != null ? `lievito ${String(p.yeastPct).replace('.', ',')}%` : 'senza lievito',
            `${p.durationH} h`,
          ].join(', ');
          const changed = next.hydration !== pref.hydration || next.yeastPct !== pref.yeastPct || next.durationH !== pref.durationH;
          setTypeUndo(changed && t !== pref.type
            ? { prev: pref, text: `Passando a ${prefName(t)}: ${fmt(next)} (prima ${fmt(pref)}).` }
            : null);
          onUpdate(next);
        }}
      />
      </div>

      {typeUndo && (
        <div style={{ marginTop: 10 }}>
          <Advisory
            key={typeUndo.text}
            tone="teal"
            text={typeUndo.text}
            undoLabel="Ripristina"
            onUndo={() => {
              onUpdate(typeUndo.prev); setTypeUndo(null);
              // Il focus torna sulla scelta del tipo ripristinata.
              requestAnimationFrame(() => typeRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
            }}
            onDismiss={() => setTypeUndo(null)}
          />
        </div>
      )}

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
        {pref.type !== 'autolysis' ? ` · idr. ${pref.hydration}%` : ''}
        {isPreparable(pref) ? ` · lievito ${String(pref.yeastPct ?? 0.05).replace('.', ',')}%` : ''}
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
    // Il nuovo prefermento prende la farina che resta (almeno il 10% va all'impasto finale).
    const left = 100 - MIN_FINAL_FLOUR_PCT - totalPrefFrac;
    if (left < 5) return;
    const np = createDefaultPref(newType, draft.mainFlourGroup);
    // Al massimo il 25%: di più lascerebbe all'impasto finale pochissima acqua.
    update({ prefermenti: [...prefermenti, { ...np, flourFraction: Math.min(25, left) }] });
  };

  const removePref = (idx: number) => {
    update({ prefermenti: prefermenti.filter((_, i) => i !== idx) });
  };

  const fg = draft.mainFlourGroup;
  const spreadW = flours.length > 1
    ? Math.max(...flours.map(f => f.W)) - Math.min(...flours.map(f => f.W))
    : 0;

  const totalPrefFrac = prefermenti.reduce((a, p) => a + (p.flourFraction ?? 0), 0);
  // Biga o poolish singolo: la scheda a poche scelte. Il resto: editor completo.
  const simple = draft.protocol === 'single_pref' && prefermenti.length === 1 && isPreparable(prefermenti[0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Sezione prefermenti ── */}
      {needsPref && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>{simple ? 'Prefermento' : 'Pre-fermenti'}</span>
            {!simple && totalPrefFrac > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                color: totalPrefFrac > 100 - MIN_FINAL_FLOUR_PCT ? 'var(--state-critical)' : 'var(--text-muted)',
              }}>
                {totalPrefFrac}% su farina totale
              </span>
            )}
          </div>

          {simple
            ? <SimplePrefCard pref={prefermenti[0]} draft={draft} update={update} onUpdate={np => updatePref(0, np)} />
            : prefermenti.map((p, i) => (
              <PrefRow key={p.id} pref={p} idx={i}
                onUpdate={np => updatePref(i, np)}
                onRemove={() => removePref(i)}
              />
            ))}

          {!simple && <PrefTimingPicker draft={draft} update={update} />}

          {!simple && prefermenti.length < maxPrefs && 100 - MIN_FINAL_FLOUR_PCT - totalPrefFrac >= 5 && (
            <Btn variant="secondary" onClick={addPref}>
              + Aggiungi pre-fermento
            </Btn>
          )}

          {totalPrefFrac > 100 - MIN_FINAL_FLOUR_PCT && (
            <Card style={{ padding: '8px 12px', background: 'rgba(255,118,117,0.1)', border: '1px solid rgba(255,118,117,0.3)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--state-critical)' }}>
                ⚠ {totalPrefFrac}% farina in prefermento — lascia almeno il {MIN_FINAL_FLOUR_PCT}% per l'impasto finale
              </span>
            </Card>
          )}
        </div>
      )}

      {/* ── Divisore ── */}
      {needsPref && (
        <div style={{ borderTop: '1px solid var(--pm4-line)', paddingTop: 4 }}>
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
            Effetto sale: −{((1 - Math.max(0.6, 1 - 0.1 * draft.salt)) * 100).toFixed(0)}% velocità lievitazione · −{((1 - Math.max(0.7, 1 - 0.08 * draft.salt)) * 100).toFixed(0)}% velocità proteolisi
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
        <NumInput
          label="Durata impastamento"
          unit="min"
          value={draft.kneadDurationMin ?? 12}
          onChange={v => update({ kneadDurationMin: v })}
          min={0} max={120} step={1}
        />
        <NumInput
          label="T acqua rubinetto"
          unit="°C"
          value={draft.tapWaterC ?? 15}
          onChange={v => update({ tapWaterC: v })}
          min={0} max={40} step={0.5}
        />
        {/* Risultato live: aggiornato ad ogni cambio di impastatrice, durata o T_lab.
            WP-3: con durata 0 → path legacy (C_attrito fisso) e card T uscita dormiente;
            con durata > 0 → path unified e la previsione T uscita si "sblocca". */}
        {(() => {
          const knead   = draft.kneadDurationMin ?? 12;
          // Acqua che si versa davvero (quella dei prefermenti è già dentro di loro)
          // e temperatura dei prefermenti pesata sulla loro massa.
          const waterG  = Math.round(splitRecipe({
            totalFlourG: draft.totalFlourGrams ?? 1000, hydrationPct: draft.hydration ?? 65,
            saltPct: draft.salt ?? 2, agentDosePct: 0, prefermenti: draft.prefermenti,
          }).final.waterG);
          const tPref   = prefTempAtMix(draft.prefermenti, draft.totalFlourGrams ?? 1000);
          const ddtDef  = DDT_BY_STYLE[draft.style ?? 'napoletana'] ?? 24;
          const wResult = computeWaterTempDDT({
            ddtTarget:        ddtDef,
            tempAmbient:      draft.tLaboratorio ?? 20,
            kneadingMethod:   (draft.kneadingMethod ?? 'spiral') as KneadingMethod,
            waterTotalGrams:  waterG,
            tempPreferment:   tPref,
            kneadDurationMin: knead > 0 ? knead : undefined,
            hydrationEff:     computeEffectiveMixHydration({ hydration: draft.hydration ?? 65, prefermenti: draft.prefermenti ?? [] }),
            doughMassKg:      ((draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100)) / 1000,
            tapWaterC:        draft.tapWaterC,
          });
          const unlocked = knead > 0 && wResult.exitTempC != null;
          return (
            <>
              <WaterTempResultCard result={wResult} compact={true} />
              {draft.kneadingMethod && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {wResult.frictionModel === 'unified'
                    ? `ΔT_attrito: ${wResult.frictionRiseC?.toFixed(1)}°C · C_attrito: ${wResult.cFriction.toFixed(1)}°C`
                    : `C_attrito: ${KNEADING_METHODS_FRICTION[draft.kneadingMethod].cFrictionLo}–${KNEADING_METHODS_FRICTION[draft.kneadingMethod].cFrictionHi}°C · ${KNEADING_METHODS_FRICTION[draft.kneadingMethod].notes}`
                  }
                </div>
              )}
              {/* WP-3: previsione T uscita — premio della compilazione */}
              <ExpandableReward
                unlocked={unlocked}
                tone={wResult.exitWarning ? 'amber' : 'neutral'}
                dormantCta={
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                    🔓 Imposta la <strong>durata impasto</strong> per sbloccare la previsione T uscita
                  </span>
                }
              >
                {unlocked && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        T uscita prevista
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 800, color: wResult.exitWarning ? '#ffd166' : 'var(--text-primary)' }}>
                        {wResult.exitTempC!.toFixed(1)}°C
                      </span>
                      <Badge tone={wResult.frictionModel === 'unified' ? 'advanced' : 'base'}>
                        {wResult.frictionModel === 'unified' ? 'Calcolo avanzato' : 'Calcolo base'}
                      </Badge>
                    </div>
                    {wResult.frictionRiseC != null && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                        di cui attrito: +{wResult.frictionRiseC.toFixed(1)}°C ({knead} min)
                      </div>
                    )}
                    {wResult.exitWarning && (
                      <Advisory
                        tone="amber"
                        dismissible={false}
                        text={`T uscita ${wResult.exitTempC!.toFixed(1)}°C — sopra 27°C: rischio glutine slegato. Usa acqua più fredda o accorcia l'impasto.`}
                      />
                    )}
                  </div>
                )}
              </ExpandableReward>
            </>
          );
        })()}
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
  // issue #8 — dose di riferimento per rilevare la saturazione del modello
  const doseRefStep = draft.agentType === 'fresh_yeast' ? 0.3
    : draft.agentType === 'instant_dry_yeast' ? 0.1
    : draft.agentType === 'sourdough_wheat' ? 20 : null;

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
        {/* issue #8 — la saturazione non deve piu' avvenire in silenzio */}
        {(doseFactorSaturated as Function)(draft.agentDosePct ?? doseRange[0], doseRefStep) && (
          <div role="status" style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.45,
            color: 'var(--accent-warning)', marginTop: -4,
          }}>
            Dose fuori dal dominio calibrato: la previsione e' saturata al limite
            e sara' ottimistica.
          </div>
        )}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -8 }}>
          {draft.agentDosePct ?? doseRange[0]}% su {draft.totalFlourGrams ?? 1000}g farina ={' '}
          <strong style={{ color: 'var(--accent-brand)' }}>
            {computeGrammiLievito(draft.totalFlourGrams ?? 1000, draft.agentDosePct ?? doseRange[0], draft.agentType)}
          </strong>
        </div>
      </>)}

      <button
        onClick={() => { setShowMalt(s => !s); if (showMalt) update({ maltDosePct: undefined }); }}
        aria-expanded={showMalt}
        style={{ background: 'none', border: 'none', color: 'var(--pref-biga)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', cursor: 'pointer', padding: '4px 0', minHeight: 44, textAlign: 'left' }}
      >
        {showMalt ? '▾' : '▸'} Malto diastatico
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
            border: draft.containerPreset === key ? 'none' : '1px solid var(--pm4-line-strong)',
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

/** Riscaldo TA finale (tc, tc_appreto): calcolato, non regolabile qui. */
function WarmupBox({ fridgeT, warmupH }: { fridgeT: number; warmupH: number }) {
  return (
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
          {warmupH > 0.05 ? fmtHours(warmupH) : '< 5 min'}
        </span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        Calcolato con legge di Newton · τ sferica · T ambiente 22°C assunta
      </span>
    </FormSection>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Tempistiche
// ═══════════════════════════════════════════════════════════════════════════════
function Step7({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const [apprettoUndo, setApprettoUndo] = useState<number | null>(null);
  const proto   = draft.apprettoProtocol ?? 'ta';
  const puntata = draft.puntataH ?? 8;
  const staglio = draft.staglioH ?? 0.5;
  // Tutto TA: finché non lo tocchi, l'appretto è quello che fa infornare al pronto.
  const appreto = resolvedApprettoH(draft);
  const apprettoFromModel = proto === 'ta' && draft.apprettoH == null;
  const freddo  = draft.tcHours ?? 12;
  const fridgeT = draft.fridgeTempC ?? 4;

  // Riscaldo TA finale (tc e tc_appreto): ore per portare il panetto da frigo a 18°C
  // T ambiente assunta 22°C (default cucina) poiché il wizard non raccoglie tAmb.
  // Applica tauMultiplier del contenitore selezionato (inerzia termica).
  const warmupHDisplay = (proto === 'tc_appreto' || proto === 'tc') ? warmupHForSession(draft, 22) : 0;

  // Puntata TA ottimale calcolata (solo tc_appreto) — usata come default quando
  // l'utente non ha ancora spostato il cursore (draft.puntataH == null).
  const puntataHOptimalComputed = proto === 'tc_appreto' ? (() => {
    const aT2   = draft.agentType ?? 'fresh_yeast';
    const aP2   = (AGENT_GOMPERTZ as any)[aT2] as { Ea: number; lambda: number; muMax: number };
    const dRef2 = aT2 === 'fresh_yeast' ? 0.3 : aT2 === 'instant_dry_yeast' ? 0.1 : 1.0;
    const muMax2 = (scaleMuMaxByDose as Function)(aP2.muMax, draft.agentDosePct ?? dRef2, dRef2) as number;
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
    : proto === 'tc'         ? freddo + staglio + warmupHDisplay
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

      {/* Frigo fuori dal protocollo dello stile: lo si dice qui, non con un modale dopo l'avvio */}
      {isTcProto && !(fridgePhaseIsSanctioned as (p: unknown) => boolean)((getStyleProfile as Function)(draft.style ?? 'napoletana')?.protocollo_preferito) && (
        <p role="note" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
          Per la {String(draft.style ?? 'napoletana').replace(/^./, c => c.toUpperCase())} di solito è tutto a temperatura ambiente: il frigo è una tua scelta, la seguo.
        </p>
      )}

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
          <SliderInput label={apprettoFromModel ? 'Appretto (dal modello: inforni al pronto)' : 'Appretto'}
            value={appreto} onChange={v => update({ apprettoH: v })}
            min={0.5} max={12} step={0.5} unit="h" />
          {!apprettoFromModel && (
            <button
              onClick={() => update({ apprettoH: undefined })}
              style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, minHeight: 44, textAlign: 'left' }}
            >
              Ripristina dal modello
            </button>
          )}
        </FormSection>
      )}

      {/* ── TC: tutto in frigo ── */}
      {proto === 'tc' && (
        <FormSection title="❄ Tutto in frigo" accent="var(--state-cold)">
          <SliderInput label="Freddo (puntata + appretto in frigo)" value={freddo}
            onChange={v => update({ tcHours: v })} min={2} max={72} step={1} unit="h"
            color="var(--state-cold)" />
          <SliderInput label="Staglio" value={staglio} onChange={v => update({ staglioH: v })}
            min={0.1} max={2} step={0.1} unit="h" />
        </FormSection>
      )}
      {proto === 'tc' && <WarmupBox fridgeT={fridgeT} warmupH={warmupHDisplay} />}

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
        <WarmupBox fridgeT={fridgeT} warmupH={warmupHDisplay} />
      </>}

      {(() => {
        // Lo stesso orario che darà la dashboard (motore se tutto TA, piano se c'è il frigo).
        const fc = draftBakeForecast(draft);
        const corr = proto === 'ta' && fc?.fromEngine
          ? apprettoCorrectionH(totalH, (fc.ms - Date.now()) / 3_600_000, appreto) : null;
        const fmtH = (h: number) => { const m = Math.round(h * 60); return m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`; };
        return (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <StepMetric label="Durata delle fasi" value={fmtH(totalH)} />
              <StepMetric label="Cottura prevista" value={fc ? fmtBakeClock(fc.ms) : '—'} color="var(--accent-brand)" />
            </div>
            {corr != null && fc && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
                  Con queste durate inforneresti {fmtBakeClock(fc.planMs).replace(/^~/, 'alle ')}: l'impasto sarebbe {corr > 0 ? 'ancora acerbo' : 'già oltre il punto giusto'} (~{fmtH(Math.abs(corr))} {corr > 0 ? 'prima' : 'dopo'} del pronto).
                </div>
                <Btn variant="secondary" onClick={() => {
                  setApprettoUndo(appreto);
                  update({ apprettoH: appreto + corr });
                }}>{corr > 0 ? 'Allunga' : 'Accorcia'} l'appretto di {fmtH(Math.abs(corr))}</Btn>
              </div>
            )}
            {apprettoUndo != null && (
              <div style={{ marginTop: 10 }}>
                <Advisory tone="teal" text={`Appretto portato da ${fmtH(apprettoUndo)} a ${fmtH(appreto)}.`} undoLabel="Annulla"
                  onUndo={() => { update({ apprettoH: apprettoUndo }); setApprettoUndo(null); }}
                  onDismiss={() => setApprettoUndo(null)} />
              </div>
            )}
          </Card>
        );
      })()}
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

// ─── Ricetta in grammi (passo 8) ──────────────────────────────────────────────
function RecipeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.9 }}>
      <span style={{ color: 'var(--pm4-tan)' }}>{label}</span>
      <span style={{ color: strong ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function RecipeCard({ draft, update, recipe }: {
  draft: WizardDraft; update: (p: Partial<WizardDraft>) => void; recipe: ReturnType<typeof splitRecipe>;
}) {
  const prefs = draft.prefermenti ?? [];
  const agent = draft.agentType ?? 'fresh_yeast';
  const yeastLabel = agent === 'sourdough_wheat' ? 'Lievito madre' : agent === 'instant_dry_yeast' ? 'Lievito secco' : 'Lievito di birra';
  const heading = { marginBottom: 6, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--pm4-tan)', fontFamily: 'var(--font-mono)' };
  const fmtH = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  // Nell'ordine in cui si fanno: prima biga/poolish, poi riporto e autolisi.
  const rank = (t: string) => (isPreparable({ type: t }) ? 0 : t === 'riporto' ? 1 : 2);
  const ordered = [...recipe.prefs].sort((a, b) => rank(a.type) - rank(b.type));
  // Ricetta impossibile: si blocca l'avvio e si propone la correzione, annullabile.
  const problem = recipeProblem(draft);
  const [undo, setUndo] = useState<{ prev: Partial<WizardDraft>; text: string } | null>(null);
  const fix = (() => {
    if (!problem) return null;
    // L'idratazione proposta deve stare nel range dello stile; altrimenti si riduce il prefermento.
    const kind = recipeFixKind(draft);
    if (kind === 'reduceWater' && problem.fixFraction) {
      const ff = problem.fixFraction;
      const p = prefs.find(x => x.id === ff.id)!;
      return {
        label: `Riduci ${prefWithArticle(p.type)} al ${ff.value}%`,
        apply: () => {
          setUndo({ prev: { prefermenti: prefs }, text: `${prefName(p.type).replace(/^./, c => c.toUpperCase())} ridott${prefIsFeminine(p.type) ? 'a' : 'o'} dal ${p.flourFraction}% al ${ff.value}%.` });
          update({ prefermenti: prefs.map(x => (x.id === ff.id ? { ...x, flourFraction: ff.value } : x)) });
        },
      };
    }
    if (kind === 'hydration') {
      return {
        label: `Porta l'idratazione al ${problem.fixValue}%`,
        apply: () => {
          setUndo({ prev: { hydration: draft.hydration }, text: `Idratazione portata dal ${draft.hydration ?? 65}% al ${problem.fixValue}%.` });
          update({ hydration: problem.fixValue });
        },
      };
    }
    if (problem.kind === 'flour') {
      const big = prefs.reduce((a, b) => ((b.flourFraction ?? 0) > (a.flourFraction ?? 0) ? b : a));
      return {
        label: `Riduci ${prefWithArticle(big.type)} al ${problem.fixValue}%`,
        apply: () => {
          setUndo({ prev: { prefermenti: prefs }, text: `${prefName(big.type).replace(/^./, c => c.toUpperCase())} ridott${prefIsFeminine(big.type) ? 'a' : 'o'} dal ${big.flourFraction}% al ${problem.fixValue}%.` });
          update({ prefermenti: prefs.map(p => (p.id === big.id ? { ...p, flourFraction: problem.fixValue } : p)) });
        },
      };
    }
    return null;
  })();
  return (
    <Card elevated>
      <div style={{ marginBottom: 10, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)' }}>
        Ricetta
      </div>
      {prefs.some(isPreparable) && (
        <div style={{ marginBottom: 12 }}><PrefTimingPicker draft={draft} update={update} /></div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {ordered.map((g, i) => {
          const p = prefs.find(x => x.id === g.id)!;
          const name = prefName(g.type);
          const title = name.charAt(0).toUpperCase() + name.slice(1);
          const when = isPreparable(p)
            ? (draft.prefermentTiming === 'ready'
              ? `${prefIsFeminine(p.type) ? 'impastata' : 'impastato'} ${fmtH(p.durationH)} fa`
              : `${fmtH(p.durationH)} · ${PLACE_LABEL[placeOf(p)].toLowerCase()} ~${Math.round(p.tempC)}°C`)
            : `${fmtH(p.durationH)} a ${Math.round(p.tempC)}°C`;
          return (
            <div key={g.id}>
              <div style={heading}>{i + 1} · {title} <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {when}</span></div>
              <RecipeRow label="Farina" value={fmtGrams(g.flourG)} />
              <RecipeRow label="Acqua" value={fmtGrams(g.waterG)} />
              {g.yeastG != null && <RecipeRow label={yeastLabel} value={fmtGrams(g.yeastG)} />}
            </div>
          );
        })}
        <div>
          {recipe.prefs.length > 0 && <div style={heading}>{recipe.prefs.length + 1} · Impasto finale</div>}
          {ordered.map((g, i) => (
            <RecipeRow key={g.id} label={`${prefName(g.type).charAt(0).toUpperCase()}${prefName(g.type).slice(1)} (${prefIsFeminine(g.type) ? 'tutta' : 'tutto'})`} value={fmtGrams(g.totalG)} strong={i === 0} />
          ))}
          <RecipeRow label="Farina" value={fmtGrams(recipe.final.flourG)} />
          <RecipeRow label="Acqua" value={recipe.final.waterG >= 1 ? fmtGrams(recipe.final.waterG) : '—'} />
          <RecipeRow label="Sale" value={fmtGrams(recipe.final.saltG)} />
          {recipe.final.fatG > 0 && <RecipeRow label="Grassi" value={fmtGrams(recipe.final.fatG)} />}
          {recipe.final.yeastG > 0 && <RecipeRow label={yeastLabel} value={fmtGrams(recipe.final.yeastG)} />}
        </div>
        {problem && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--state-critical)' }}>
            <span>{problem.message} Così non si può impastare.</span>
            {fix && (
              <button id="recipe-fix" type="button" onClick={() => {
                fix.apply();
                // Dopo la correzione il passo successivo è avviare: il focus va lì.
                requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#wizard-next button')?.focus());
              }} style={{
                alignSelf: 'flex-start', minHeight: 44, padding: '10px 14px', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', color: 'var(--pm4-flour)',
                border: '1px solid var(--pm4-line-strong)', borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
              }}>{fix.label}</button>
            )}
          </div>
        )}
        {undo && (
          <Advisory tone="teal" text={undo.text} undoLabel="Annulla"
            onUndo={() => { update(undo.prev); setUndo(null); }} onDismiss={() => setUndo(null)} />
        )}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Riepilogo ricetta (read-only, pre-avvio sessione)
// ═══════════════════════════════════════════════════════════════════════════════
function Step8({ draft, update }: { draft: WizardDraft; update: (p: Partial<WizardDraft>) => void }) {
  const hydration = draft.hydration ?? 65;
  const salt      = draft.salt ?? 2;
  const flour     = draft.totalFlourGrams ?? 0;
  const panetti   = draft.numPanetti ?? 1;
  const recipe    = splitRecipe({
    totalFlourG: flour, hydrationPct: hydration, saltPct: salt, fatPct: draft.fat,
    agentDosePct: draft.agentDosePct ?? 0, prefermenti: draft.prefermenti,
  });

  // Peso panetto stimato = (farina + acqua + sale) / numPanetti
  const totalDoughG = flour * (1 + hydration / 100 + salt / 100);
  const panWeight   = panetti > 0 ? Math.round(totalDoughG / panetti) : 0;

  // Per tc e tc_appreto: tempo di riscaldo TA finale; per tc_appreto anche la puntata ottimale
  const panMassKgStep8 = panetti > 0 ? totalDoughG / 1000 / panetti : 0.28;
  const cPresetStep8   = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)[draft.containerPreset ?? 'closed_box'];
  const tauMultStep8   = cPresetStep8?.tauMultiplier ?? 1.0;
  const fromPlannerStep8 = draft.navigationSource === 'planner';
  const warmupHStep8   = draft.apprettoProtocol === 'tc_appreto' || draft.apprettoProtocol === 'tc'
    ? (fromPlannerStep8 ? (draft.temperingH ?? draft.apprettoH ?? 0) : warmupHForSession(draft, 22))
    : 0;
  // Puntata ottimale per step 8: muMax semplificato (senza prefermento, per anteprima)
  const puntataHStep8  = draft.apprettoProtocol === 'tc_appreto' ? (() => {
    const aT8   = draft.agentType ?? 'fresh_yeast';
    const aP8   = (AGENT_GOMPERTZ as any)[aT8] as { Ea: number; lambda: number; muMax: number };
    const dRef8 = aT8 === 'fresh_yeast' ? 0.3 : aT8 === 'instant_dry_yeast' ? 0.1 : 1.0;
    const muMax8 = (scaleMuMaxByDose as Function)(aP8.muMax, draft.agentDosePct ?? dRef8, dRef8) as number;
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

      {/* ── Piano dal Planner: gli orari, non solo le durate ── */}
      {fromPlannerStep8 && (() => {
        // Con un prefermento da preparare, l'impasto parte quando è pronto.
        // Stessa durata della fase "in corso": il prefermento biologico più lungo.
        const prepPref = startsWithPreferment(draft) ? mainPreparable(draft.prefermenti) : undefined;
        const t0 = Date.now() + (prepPref ? stageDurationH(draft.prefermenti) * 3_600_000 : 0);
        const at = (h: number) => new Date(t0 + h * 3_600_000);
        const p = draft.puntataH ?? 0, sH = draft.staglioH ?? 0.5, tc = draft.tcHours ?? 0;
        const proto = draft.apprettoProtocol ?? 'ta';
        const rows: Array<[string, Date]> = proto === 'tc_appreto'
          ? [['Impasta', at(0)], ['Staglio', at(p)], ['In frigo', at(p + sH)], ['Fuori dal frigo', at(p + sH + tc)]]
          : proto === 'tc' || proto === 'tc_puntata'
            ? [['Impasta · in frigo', at(0)], ['Staglio', at(tc)]]
            : [['Impasta', at(0)], ['Staglio', at(p)]];
        if (prepPref) rows.unshift([`Impasta ${prefWithArticle(prepPref.type)}`, new Date()]);
        if (draft.targetBakeAt) rows.push([draft.serviceWindowH ? 'Servizio' : 'Forno', new Date(draft.targetBakeAt)]);
        const hl = (label: string) => label === 'Forno' || label === 'Servizio';
        const fmtAt = (d: Date) => fmtClockDay(d);
        return (
          <Card>
            <div style={{ marginBottom: 10, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--pm4-tan)', fontFamily: 'var(--font-mono)' }}>
              Il tuo piano · dal Planner
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map(([label, d]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                  <span style={{ color: hl(label) ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)' }}>{label}</span>
                  <span style={{ color: hl(label) ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtAt(d)}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {overrunMessage(draft) && (
        <p role="alert" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
          {overrunMessage(draft)}
        </p>
      )}

      {/* ── Quando inforni: lo stesso orario che mostrerà la dashboard ── */}
      {!fromPlannerStep8 && (() => {
        const fc = draftBakeForecast(draft);
        if (!fc) return null;
        return (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--pm4-tan)' }}>
                Cottura prevista
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--pm4-ember-lo)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtBakeClock(fc.ms)}
              </span>
            </div>
            {startsWithPreferment(draft) && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginTop: 4 }}>
                contando il tempo {prefIsFeminine(mainPreparable(draft.prefermenti)!.type) ? 'della' : 'del'} {prefName(mainPreparable(draft.prefermenti)!.type)}
              </div>
            )}
          </Card>
        );
      })()}

      {/* ── Ricetta: cosa pesare, nell'ordine in cui lo fai ── */}
      <RecipeCard draft={draft} update={update} recipe={recipe} />

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
          {draft.apprettoProtocol !== 'tc' && (() => {
            // WP-5(C): override puntata persistente e visibile. Per tc_appreto, se il
            // valore attivo (draft.puntataH) diverge dal teorico (puntataHStep8) oltre
            // 0.05h, marca "modificato manualmente" + riferimento ghost ripristinabile.
            const isAppreto = draft.apprettoProtocol === 'tc_appreto';
            const overridden = isAppreto && !fromPlannerStep8 && draft.puntataH != null
              && Math.abs(draft.puntataH - puntataHStep8) > 0.05;
            const shown = isAppreto
              ? (draft.puntataH != null ? draft.puntataH.toFixed(1) : puntataHStep8.toFixed(1))
              : (draft.puntataH ?? '–');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  aria-label={overridden
                    ? `Puntata ${shown} ore, modificata manualmente; teorico ${puntataHStep8.toFixed(1)} ore`
                    : undefined}
                >
                  <Metric label="Puntata TA" value={shown} unit="h"
                    color={isAppreto ? 'var(--accent-brand)' : undefined} />
                </div>
                {fromPlannerStep8 && <Badge tone="source">dal Planner</Badge>}
                {overridden && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Badge tone="manual">modificato manualmente</Badge>
                    <button
                      type="button"
                      onClick={() => update({ puntataH: undefined })}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                        padding: '4px 0', minHeight: 44,
                        fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)',
                      }}
                    >
                      teorico {puntataHStep8.toFixed(1)}h · <span style={{ color: 'var(--accent-info)', textDecoration: 'underline' }}>ripristina</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {isTcProto && (
            <Metric label="Freddo" value={draft.tcHours ?? '–'} unit="h" color="var(--state-cold)" />
          )}
          <Metric label="Staglio" value={draft.staglioH ?? '–'} unit="h" />
          {draft.apprettoProtocol !== 'tc' && draft.apprettoProtocol !== 'tc_appreto' && (
            <Metric label="Appretto" value={draft.apprettoProtocol === 'tc_puntata' ? (draft.apprettoH ?? 4) : resolvedApprettoH(draft)} unit="h" />
          )}
          {(draft.apprettoProtocol === 'tc_appreto' || draft.apprettoProtocol === 'tc') && (
            <Metric label="Riscaldo TA" value={warmupHStep8.toFixed(1)} unit="h" color="var(--state-approaching)" />
          )}
          {isTcProto && (
            <Metric label="T frigo" value={draft.fridgeTempC ?? 4} unit="°C" color="var(--state-cold)" />
          )}
        </div>
      </Card>

      {/* ── 💧 Acqua di impastamento (DDT automatico) ──
          Con un prefermento da preparare l'acqua dell'impasto finale dipende da
          dove sarà il prefermento: la calcola la fase in corso, un solo calcolo. */}
      {startsWithPreferment(draft) ? (
        <Card>
          <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
            💧 Acqua · impasto finale
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
            La temperatura dell'acqua per l'impasto finale te la calcolo quando {prefWithArticle(mainPreparable(draft.prefermenti)!.type)} è {prefIsFeminine(mainPreparable(draft.prefermenti)!.type) ? 'pronta' : 'pronto'}: dipende da dove sarà.
          </div>
        </Card>
      ) : (() => {
        const waterG    = Math.round(recipe.final.waterG);
        const tPrefAvg  = prefTempAtMix(draft.prefermenti, flour);
        const ddtDef    = DDT_BY_STYLE[draft.style ?? 'napoletana'] ?? 24;
        const wResult   = computeWaterTempDDT({
          ddtTarget:        ddtDef,
          tempAmbient:      draft.tLaboratorio ?? 20,
          kneadingMethod:   (draft.kneadingMethod ?? 'spiral') as KneadingMethod,
          waterTotalGrams:  waterG,
          tempPreferment:   tPrefAvg,
          // Stessa regola del passo 4: 0 minuti = modello senza durata.
          kneadDurationMin: (draft.kneadDurationMin ?? 12) > 0 ? (draft.kneadDurationMin ?? 12) : undefined,
          hydrationEff:     computeEffectiveMixHydration({ hydration: hydration, prefermenti: draft.prefermenti ?? [] }),
          doughMassKg:      (flour * (1 + hydration / 100)) / 1000,
          tapWaterC:        draft.tapWaterC,
        });
        return (
          <Card>
            <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
              💧 Acqua di impastamento
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginBottom: 8 }}>
              Calcolata con {draft.kneadDurationMin ?? 12} min di impastamento · si cambia al passo 4
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
        {startsWithPreferment(draft)
          ? `Ti avviso quando ${prefWithArticle(mainPreparable(draft.prefermenti)!.type)} è ${prefIsFeminine(mainPreparable(draft.prefermenti)!.type) ? 'pronta' : 'pronto'}: da lì parte il monitoraggio dell'impasto`
          : 'Premi "🍕 Avvia sessione" per iniziare il monitoraggio'}
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

  // Scroll-to-top ad ogni cambio step: il div interno è riusato tra gli step e
  // manterrebbe lo scrollTop del passo precedente. useLayoutEffect evita il flash.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [step]);

  // "Sostituisci la biga in corso?": null = nessuna domanda, 'ask' = in attesa.
  const [replaceStage, setReplaceStage] = useState<null | 'ask'>(null);
  const [starting, setStarting] = useState(false);
  const replaceRef = useRef<HTMLDivElement>(null);
  // La domanda "C'è già … in corso" prende il focus quando compare.
  useEffect(() => { if (replaceStage === 'ask') replaceRef.current?.focus(); }, [replaceStage]);

  /** Salva la preparazione e solo dopo la mostra: l'id c'è sempre (annulla sicuro). */
  const startingRef = useRef(false);
  const startStage = async () => {
    // Un secondo tocco durante il salvataggio non crea una seconda preparazione.
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const old = state.prefermentStage;
      if (old) {
        if (old.id != null) await deletePrefermentStage(old.id);
        else await deleteAllPrefermentStages();
      }
      const startedAt = new Date();
      const prep = (draft.prefermenti ?? []).filter(isPreparable);
      const durH = stageDurationH(draft.prefermenti);
      const main = prep.find(p => p.durationH === durH) ?? prep[0];
      // Il più lungo parte subito, gli altri più tardi: pronti tutti insieme.
      const items = buildStageItems(draft.prefermenti, startedAt);
      const stage = {
        startedAt, readyAt: new Date(startedAt.getTime() + durH * 3_600_000),
        plannedH: durH, plannedTempC: main?.tempC ?? 16, items,
        draft: draft as Record<string, unknown>,
      };
      const id = await savePrefermentStage(stage);
      setReplaceStage(null);
      dispatch({ type: 'PREF_STAGE_SET', stage: { ...stage, id } });
      dispatch({ type: 'NAV', view: 'preferment' });
    } catch (err) {
      console.error('[savePrefermentStage]', err);
      setBuildError('Non riesco a salvare la preparazione. Riprova.');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const next = () => {
    setBuildError(null);
    if (step < TOTAL_STEPS) {
      dispatch({ type: 'WIZARD_STEP', step: step + 1 });
    } else {
      try {
        if (startsWithPreferment(draft)) {
          // Prima il prefermento: la sessione dell'impasto partirà alla conferma "è pronto".
          buildSession(draft);   // valida subito: gli errori si vedono adesso, non domani
          // Una sola preparazione alla volta: se ce n'è già una, si chiede.
          if (state.prefermentStage && !replaceStage) { setReplaceStage('ask'); return; }
          void startStage();
          return;
        }
        launchSession(draft, dispatch);
      } catch (e) {
        // L'utente legge una frase, il dettaglio tecnico (Zod) resta in console.
        const raw = e instanceof Error ? e.message : String(e);
        setBuildError(/Unrecognized key|Expected|Invalid|Number must|Required/i.test(raw)
          ? 'Non riesco ad avviare questo piano: alcuni valori non sono validi.'
          : `Non riesco ad avviare: ${raw.replace(/ · /g, '; ')}. Correggilo al passo dei prefermenti.`);
        console.error('[WizardView] buildSession error:', e);
      }
    }
  };

  const prev = () => {
    setBuildError(null);
    setReplaceStage(null);
    if (step === 8 && draft.navigationSource === 'planner') {
      dispatch({ type: 'WIZARD_UPDATE', patch: { navigationSource: undefined } });
      dispatch({ type: 'NAV', view: 'planner' });
    } else if (step > 1) {
      dispatch({ type: 'WIZARD_STEP', step: step - 1 });
    } else {
      dispatch({ type: 'NAV', view: 'home' });
    }
  };

  const canProceed = (): boolean => {
    if (step === 1) return !!(draft.style && draft.totalFlourGrams && draft.numPanetti);
    if (step === 2) return !!draft.protocol;
    if (step === 3) {
      if (!draft.mainFlourGroup) return false;
      if (draft.protocol === 'direct') return true;
      // prefermenti richiesti per single_pref e mix_advanced
      // Al passo 3 conta solo la farina: l'idratazione si sceglie dopo, al passo 4.
      return !!(draft.prefermenti && draft.prefermenti.length >= 1) && recipeProblem(draft)?.kind !== 'flour';
    }
    if (step === 4) return !!(draft.hydration && draft.salt !== undefined);
    if (step === 5) return !!(draft.agentType && draft.agentDosePct);
    if (step === 6) return !!draft.containerPreset;
    // v2.4.21 fix blocco silenzioso: il vecchio gate richiedeva draft.puntataH
    // per ta/tc/tc_puntata, ma tc e tc_puntata non rendono nemmeno lo slider
    // puntata e per ta il default (8h) vive solo nel display → Continua morto
    // senza messaggio. Ogni campo del passo 7 ha default coerenti sia in Step7
    // sia in buildSession (proto 'ta', puntata 8h, staglio 0.5h, ...): il passo
    // è sempre strutturalmente valido. Nessun solver gira a questo passo.
    if (step === 7) return true;
    if (step === 8) return !recipeProblem(draft) && !overrunMessage(draft);
    return true;
  };

  // Un Continua disabilitato deve dire cosa manca: niente blocchi muti.
  const blockedReason = (): string => {
    if (step === 1) return draft.style ? 'Indica farina totale e numero di panetti' : 'Scegli uno stile per continuare';
    if (step === 2) return 'Scegli il tipo di impasto per continuare';
    const pb = recipeProblem(draft);
    if (pb && (step === 8 || (step === 3 && pb.kind === 'flour'))) return pb.message;
    if (step === 8) return overrunMessage(draft) ?? '';
    if (step === 3) return draft.mainFlourGroup ? 'Aggiungi almeno un pre-fermento' : 'Scegli la farina per continuare';
    if (step === 4) return 'Imposta idratazione e sale';
    if (step === 5) return draft.agentType ? 'Imposta la dose di lievito' : 'Scegli l\'agente lievitante per continuare';
    if (step === 6) return 'Scegli un contenitore per continuare';
    return '';
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
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: '8px', minHeight: 0 }}>
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
          <div role="alert" style={{
            padding: '10px 14px',
            background: 'rgba(214,48,49,0.15)', border: '1px solid rgba(214,48,49,0.4)',
            borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
            color: 'var(--state-critical)', fontFamily: 'var(--font-mono)',
          }}>
            ⚠ {buildError}
            {draft.navigationSource === 'planner' && (
              <div style={{ marginTop: 6, color: 'var(--pm4-tan)' }}>Torna al Planner con "← Planner" e riprova, o correggi i valori qui.</div>
            )}
          </div>
        )}
        {replaceStage === 'ask' && state.prefermentStage && (() => {
          const cur = mainPreparable((state.prefermentStage.draft as WizardDraft).prefermenti);
          const t = cur?.type ?? 'biga';
          const at = new Date(state.prefermentStage.readyAt);
          const when = `alle ${fmtClockDay(at)}`;
          return (
            <div ref={replaceRef} tabIndex={-1} role="group" aria-label="Preparazione già in corso" style={{
              outline: 'none',
              display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px',
              border: '1px solid var(--accent-brand)', borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--pm4-flour)',
            }}>
              <span>C'è già {prefWithArticle(t)} in corso ({prefIsFeminine(t) ? 'pronta' : 'pronto'} {when}). {prefIsFeminine(t) ? 'La' : 'Lo'} sostituisco con la nuova preparazione?</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => {
                  setReplaceStage(null);
                  // Non sul pulsante di avvio, che riaprirebbe la domanda: su "← Indietro".
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#wizard-back button')?.focus());
                }}>Tieni {prefIsFeminine(t) ? 'quella' : 'quello'}</Btn></div>
                <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: 'preferment' })}>Vai {prefAl(t)}</Btn></div>
              </div>
              <Btn variant="danger" disabled={starting} onClick={() => void startStage()}>Sostituisci</Btn>
            </div>
          );
        })()}
        {!canProceed() && (
          <p id="wizard-blocked-hint" role="status" style={{
            margin: 0, textAlign: 'center', fontSize: '0.75rem',
            color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
          }}>
            {blockedReason()}
          </p>
        )}
        {step === 8 && recipeFixKind(draft) && (
          // La correzione sta nella ricetta, spesso sotto la piega: un tocco la porta in vista.
          <Btn variant="secondary" onClick={() => {
            const el = document.getElementById('recipe-fix');
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.focus();
          }}>Vedi la correzione ↑</Btn>
        )}
        <div id="wizard-next">
        <Btn onClick={next} disabled={!canProceed() || starting || replaceStage === 'ask'}
          aria-describedby={!canProceed() ? 'wizard-blocked-hint' : undefined}>
          {step < TOTAL_STEPS ? 'Continua →'
            : startsWithPreferment(draft)
              ? `🥣 Impasta ${prefWithArticle(mainPreparable(draft.prefermenti)!.type)} adesso`
              : '🍕 Avvia sessione'}
        </Btn>
        </div>
        <div id="wizard-back">
        <Btn variant="secondary" onClick={prev}>
          {step === 8 && draft.navigationSource === 'planner' ? '← Planner'
            : step === 1 ? '← Home' : '← Indietro'}
        </Btn>
        </div>
      </div>
    </div>
  );
}
