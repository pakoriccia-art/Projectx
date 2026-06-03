/**
 * PizzaMatrix — Service-Window Fermentation Solver (v2.4.2)
 *
 * L'utente inserisce quando inizia il servizio (serviceStart) e quanto dura
 * (serviceDurationH). La finestra di servizio è a temperatura ambiente (palline
 * fuori dal frigo). Il solver calcola a ritroso lo schedule completo per centrare
 * maturazione(serviceEnd) ≈ 90% rispettando:
 *   C1: T_dough(serviceStart) ≥ 18°C  (tempering dal frigo via doughCoreTemp/τ)
 *   C2: maturazione(serviceEnd) ≤ 90%  (anti-collasso; W decay sotto CRITICAL)
 *   C3: lievitazione(serviceEnd) ≤ bubbleThreshold  (anti-bolle, default 92%)
 *
 * Separazione delle leve (garantita dal motore two-clock):
 *   - tempo + temperatura → maturazione enzimatica (C2). Dose-independent.
 *   - dose → lievitazione/bolle (C3). Scala SOLO muMax del lievito, lineare.
 *
 * Tutte funzioni PURE (nessuna dipendenza Dexie/React). Si appoggiano alle
 * primitive calibrate di engine-v2.4.0.js — NON le modifica.
 */

import {
  kEffective, gompertz, findAduAt, fArrhenius, ENZYMATIC_CLOCK_PARAMS,
  doughCoreTemp, thermalTimeConstant, thermalTimeConstantSphere, applyContainerResistance,
  computeTCrit, computeWHill, structuralState,
  fSaltYeast, fSaltProtease, fHardnessProtease, estimatePHForLBF,
  getStyleProfile,
} from './engine-v2.4.0.js';

// ─── Default calibrabili (niente magic number) ───────────────────────────────
export const SERVICE_WINDOW_DEFAULTS = {
  bubbleThresholdPct:    92,   // lievitazione oltre cui l'impasto fa bolle/blistering
  thermalServiceTargetC: 18,   // C1: cuore impasto minimo a serviceStart
  targetMaturationPct:   90,   // C2: target maturazione a serviceEnd
  puntataKickoffH:        2,   // puntata TA minima per sviluppo glutine
  staglioH:             0.5,   // staglio TA
  overshootTolerance:   2.0,   // tolleranza % sopra target prima di dichiarare cannot_slow_enough
};

const HOUR_MS = 3_600_000;

// ─── Helper: dose di riferimento per scaling muMax ───────────────────────────
function defaultDoseRef(agentType) {
  return agentType === 'fresh_yeast' ? 0.3
    : agentType === 'instant_dry_yeast' ? 0.1
    : null;  // sourdough: nessun scaling lineare
}

function muMaxScaledFor(dose, agentMuMax, doseRefPct) {
  if (doseRefPct == null) return agentMuMax;   // sourdough
  return agentMuMax * Math.max(0.1, Math.min(2, dose / doseRefPct));
}

// ─── Masse per fase (bulk = totale, altrimenti per-pallina) ──────────────────
function massesKg({ totalFlourGrams, hydration, salt = 0, numPanetti = 1 }) {
  const totalMassKg = (totalFlourGrams * (1 + hydration / 100 + salt / 100)) / 1000;
  const ballMassKg  = totalMassKg / Math.max(1, numPanetti);
  return { totalMassKg, ballMassKg };
}

/**
 * Integrazione forward dei DUE orologi lungo una timeline di segmenti,
 * replicando la fisica del tick loop (useTickEngine.tick): inerzia termica
 * (doughCoreTemp/τ), lievitazione (kEffective+cardinale), maturazione (fArrhenius),
 * danno W (integrale monotono). Il cuore impasto è CONTINUO attraverso i confini.
 *
 * @param segments  [{ phaseType, durationH, ambientTempC }]
 * @param initial   { tempDough, leavAdu, enzAdu, wDamage, elapsedH }
 * @param opts      parametri agente/impasto + muMaxScaled + leavLambda + subStepH
 * @returns { samples: [...], final: lastSample }
 */
export function simulateTimeline(segments, initial, opts) {
  const {
    agentEaKj, agentType, muMaxScaled, leavLambda, agentAsymptote = 100,
    enzMuMax = ENZYMATIC_CLOCK_PARAMS.muMax, enzLambda = ENZYMATIC_CLOCK_PARAMS.lambda,
    W0 = 280, hydration = 65, salt = 0, waterHardnessPpm,
    totalFlourGrams = 1000, numPanetti = 1, containerPreset = 'bare',
    initialPH = 5.8, subStepH = 0.05,
  } = opts;

  const { totalMassKg, ballMassKg } = massesKg({ totalFlourGrams, hydration, salt, numPanetti });
  const kRef         = kEffective(25, agentEaKj, agentType);
  const saltYeast    = fSaltYeast(salt);
  const saltProtease = fSaltProtease(salt);
  const hardProt     = waterHardnessPpm != null ? fHardnessProtease(waterHardnessPpm) : 1.0;

  let tempDough = initial.tempDough;
  let leavAdu   = initial.leavAdu ?? 0;
  let enzAdu    = initial.enzAdu ?? 0;
  let wDamage   = initial.wDamage ?? 0;
  let elapsedH  = initial.elapsedH ?? 0;

  const samples = [];
  const snapshot = (ambientTempC) => ({
    elapsedH, tempDough, ambientTempC, leavAdu, enzAdu,
    leaveningPct:    gompertz(leavAdu, muMaxScaled, leavLambda, agentAsymptote),
    enzymaticMatPct: gompertz(enzAdu, enzMuMax, enzLambda, 100),
    W_current:       computeWHill(W0, 1.0, wDamage, 5),
    wDamage,
  });
  samples.push(snapshot(initial.tempDough));

  for (const seg of segments) {
    if (!(seg.durationH > 0)) continue;
    const isBulk  = seg.phaseType === 'bulk_room' || seg.phaseType === 'bulk_fridge';
    const massKg  = isBulk ? totalMassKg : ballMassKg;
    const tauBase = isBulk ? thermalTimeConstant(massKg, hydration)
                           : thermalTimeConstantSphere(massKg, hydration);
    const tau     = applyContainerResistance(tauBase, containerPreset);
    const nSteps  = Math.max(1, Math.round(seg.durationH / subStepH));
    const stepH   = seg.durationH / nSteps;
    const stepSec = stepH * 3600;

    for (let i = 0; i < nSteps; i++) {
      tempDough = doughCoreTemp(tempDough, seg.ambientTempC, stepSec, tau);
      // Lievitazione (orologio lievito, cardinale)
      const kT     = kEffective(tempDough, agentEaKj, agentType);
      const kRatio = kRef > 1e-12 ? kT / kRef : 0;
      leavAdu += kRatio * saltYeast * stepH;
      // Maturazione (orologio enzimatico, fArrhenius senza CTM)
      enzAdu  += fArrhenius(tempDough) * stepH;
      // Danno W (integrale monotono di proteolisi)
      const matForPH = gompertz(leavAdu, muMaxScaled, leavLambda, agentAsymptote);
      const pH       = estimatePHForLBF(initialPH, matForPH);
      const tCrit    = computeTCrit(W0, tempDough, pH, hydration) / (saltProtease * hardProt);
      wDamage += tCrit > 1e-3 ? stepH / tCrit : 0;
      elapsedH += stepH;
      samples.push(snapshot(seg.ambientTempC));
    }
  }
  return { samples, final: samples[samples.length - 1] };
}

/**
 * C1 — ore di tempering: tempo per portare il cuore pallina da fridgeTempC a
 * targetC (18°C) a ambientTempC, via Newton + τ sferica + resistenza contenitore.
 * Closed-form: t = −τ·ln((target−amb)/(fridge−amb)).
 */
export function computeTemperingH({ ballMassKg, hydration, fridgeTempC, ambientTempC, targetC, containerPreset = 'bare' }) {
  if (ambientTempC <= targetC || fridgeTempC >= targetC) return 0;
  const tauBase = thermalTimeConstantSphere(ballMassKg, hydration);
  const tau     = applyContainerResistance(tauBase, containerPreset);  // secondi
  const ratio   = (targetC - ambientTempC) / (fridgeTempC - ambientTempC);
  if (ratio <= 0 || ratio >= 1) return 0;
  return (-tau * Math.log(ratio)) / 3600;  // ore
}

// ─── Helper risoluzione target per stile (v2.4.5) ────────────────────────────

function resolveTargetMaturationPct(input) {
  if (input.userTargetMaturationPct != null)
    return Math.max(70, Math.min(100, input.userTargetMaturationPct));
  if (input.style) return getStyleProfile(input.style).alertThreshold;
  // Legacy: campo diretto nell'input (backward compat con callers che passano targetMaturationPct)
  if (input.targetMaturationPct != null) return input.targetMaturationPct;
  return SERVICE_WINDOW_DEFAULTS.targetMaturationPct;
}

function resolveBubbleThresholdPct(input) {
  if (input.userBubbleThresholdPct != null)
    return Math.max(75, Math.min(100, input.userBubbleThresholdPct));
  if (input.style) return getStyleProfile(input.style).bubbleThresholdPct;
  // Legacy: campo diretto nell'input (backward compat con callers che passano bubbleThresholdPct)
  if (input.bubbleThresholdPct != null) return input.bubbleThresholdPct;
  return SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct;
}

// ─── Helper puntata cap per stile (v2.4.5) ───────────────────────────────────

function findHoursAtEnzMatPct(targetPct, ambientTempC, enzymaticParams) {
  const { muMax, lambda, A } = enzymaticParams;
  const subStepH = 0.05;
  let enzAdu = 0;
  for (let step = 0; step < 200; step++) {
    if (gompertz(enzAdu, muMax, lambda, A) >= targetPct) return step * subStepH;
    enzAdu += fArrhenius(ambientTempC) * subStepH;
  }
  return 10.0;
}

function computePuntataMaxH(style, ambientTempC) {
  const profile = getStyleProfile(style);
  return findHoursAtEnzMatPct(profile.puntataMatPct_target, ambientTempC, ENZYMATIC_CLOCK_PARAMS);
}

/**
 * Costruisce la PhaseSegment[] (timeline termica) dallo schedule risolto.
 * startElapsedH relativi a mixStart (= session.startedAt). Tempering + servizio
 * riusano la fase `proofing` (zero migrazione; l'integratore traccia tempDough
 * separato da ambientTempC, quindi la rampa di riscaldo è già modellata).
 */
export function buildServiceWindowTimeline({ puntataH, puntataMaxH, staglioH, tcHours, temperingH, serviceDurationH, ambientTempC, fridgeTempC }) {
  const effectivePuntataH = puntataMaxH != null ? Math.min(puntataH, puntataMaxH) : puntataH;
  const extraH = puntataH - effectivePuntataH;
  const effectiveTcH = Math.max(0, tcHours + extraH);
  const raw = [
    { phaseType: 'bulk_room',     durationH: effectivePuntataH, ambientTempC },
    { phaseType: 'balled_room',   durationH: staglioH,          ambientTempC },
    { phaseType: 'balled_fridge', durationH: effectiveTcH,      ambientTempC: fridgeTempC },
    { phaseType: 'proofing',      durationH: temperingH,        ambientTempC },
    { phaseType: 'proofing',      durationH: serviceDurationH,  ambientTempC },
  ].filter(s => s.durationH > 1e-6);

  let h = 0;
  return raw.map((s, i) => {
    const startH = h;
    h += s.durationH;
    return {
      id:            `svc-${i}-${Math.random().toString(36).slice(2, 8)}`,
      phaseType:     s.phaseType,
      startElapsedH: parseFloat(startH.toFixed(4)),
      endElapsedH:   parseFloat(h.toFixed(4)),
      ambientTempC:  s.ambientTempC,
      status:        'planned',
    };
  });
}

/**
 * STEP 2 — finestra di servizio sicura massima: da uno stato "appena temperato"
 * (open), simula fino a 24h a ambientTempC e trova il primo crossing tra
 * maturazione=target (C2), lievitazione=bubbleThreshold (C3), W=CRITICAL.
 * Ritorna il minimo (ore dall'apertura del servizio).
 */
export function computeMaxSafeServiceWindow(openState, opts, ceilings) {
  const { targetMaturationPct, bubbleThresholdPct, W0 } = ceilings;
  const probe = simulateTimeline(
    [{ phaseType: 'proofing', durationH: 24, ambientTempC: ceilings.ambientTempC }],
    { ...openState, elapsedH: 0 },
    opts,
  );
  let hMat = Infinity, hBubble = Infinity, hW = Infinity;
  for (const s of probe.samples) {
    if (hMat === Infinity && s.enzymaticMatPct >= targetMaturationPct) hMat = s.elapsedH;
    if (hBubble === Infinity && s.leaveningPct >= bubbleThresholdPct)  hBubble = s.elapsedH;
    if (hW === Infinity && structuralState(W0, s.W_current) === 'CRITICAL') hW = s.elapsedH;
  }
  const maxSafe = Math.min(hMat, hBubble, hW);
  return {
    maxSafeServiceWindowH: isFinite(maxSafe) ? parseFloat(maxSafe.toFixed(2)) : 24,
    binding: maxSafe === hMat ? 'maturation' : maxSafe === hBubble ? 'bubble' : maxSafe === hW ? 'w_collapse' : 'none',
  };
}

// ─── Bisezione generica monotona crescente ───────────────────────────────────
function bisectIncreasing(f, target, lo, hi, tol = 0.05, maxIter = 60) {
  let a = lo, b = hi;
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2;
    const v = f(m);
    if (Math.abs(v - target) <= tol) return m;
    if (v < target) a = m; else b = m;
  }
  return (a + b) / 2;
}

/**
 * Solver ancorato a NOW: mixStart = now (fisso).
 *
 * Invece di ottimizzare l'orario di inizio, fissa mixStart = now e trova la
 * temperatura frigo ottimale (fridgeTempC ∈ [fridgeTempMin, fridgeTempCUser])
 * che centra maturazione(serviceEnd) = targetMaturationPct, assorbendo lo
 * slack con il rallentamento (T frigo ↓), non con il ritardo dell'inizio.
 *
 * Sale: NON tocca l'orologio maturazione. Leva maturazione = temperatura frigo.
 *
 * Se non si rallenta abbastanza (matAtMin > target) → infeasibility.reason =
 * 'cannot_slow_enough': il chiamante propone opzioni esplicite all'utente
 * (anticipa servizio / riduci target / [ultima] ritarda inizio).
 */
export function solveNowAnchoredWindow(input) {
  const {
    now, serviceStart, serviceDurationH,
    ambientTempC, fridgeTempC: fridgeTempCUser = 4, fridgeTempMin = 2,
    agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote = 100,
    agentDosePct = 0.3,
    W0 = 280, hydration = 65, salt = 0, waterHardnessPpm, initialPH = 5.8,
    totalFlourGrams = 1000, numPanetti = 1, containerPreset = 'bare',
    prefermenti = [], initialMaturationOffset = 0,
    style,
    thermalServiceTargetC = SERVICE_WINDOW_DEFAULTS.thermalServiceTargetC,
    puntataKickoffH       = SERVICE_WINDOW_DEFAULTS.puntataKickoffH,
    staglioH              = SERVICE_WINDOW_DEFAULTS.staglioH,
    doseRefPct, doseMinPct, doseMaxPct,
    subStepH = 0.05,
  } = input;

  // v2.4.5: gerarchia userOverride > stile > default globale
  const targetMaturationPct = resolveTargetMaturationPct(input);
  const bubbleThresholdPct  = resolveBubbleThresholdPct(input);
  const overshootTol = input.overshootTolerance ?? SERVICE_WINDOW_DEFAULTS.overshootTolerance ?? 2.0;

  const mixStart   = now instanceof Date ? now : new Date(now);
  const serviceEnd = new Date(serviceStart.getTime() + serviceDurationH * HOUR_MS);
  const totalH     = (serviceEnd.getTime() - mixStart.getTime()) / HOUR_MS;

  if (ambientTempC <= thermalServiceTargetC) {
    return { feasible: false, mixStart, mixStartIsNow: true,
      resolvedTargetMaturationPct: targetMaturationPct, resolvedBubbleThresholdPct: bubbleThresholdPct,
      infeasibility: { reason: 'cannot_temper', mitigations: ['Alza la temperatura ambiente sopra 18°C'] } };
  }

  const doseRef    = doseRefPct !== undefined ? doseRefPct : defaultDoseRef(agentType);
  const prefFrac   = Math.min(1, (prefermenti ?? []).reduce((s, p) => s + (p.flourFraction ?? 0) / 100, 0));
  const leavLambda = Math.max(0.3, agentLambda * (1 - 0.5 * prefFrac));
  const enzSeed    = initialMaturationOffset > 0
    ? findAduAt(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, initialMaturationOffset * 100)
    : 0;
  const { ballMassKg } = massesKg({ totalFlourGrams, hydration, salt, numPanetti });

  const baseOpts = {
    agentEaKj, agentType, leavLambda, agentAsymptote,
    W0, hydration, salt, waterHardnessPpm, initialPH,
    totalFlourGrams, numPanetti, containerPreset, subStepH,
  };

  // Costruisce schedule e simula per un dato fridgeTempC candidato
  const scheduleFor = (fridgeTempC_c) => {
    const tempH = computeTemperingH({
      ballMassKg, hydration, fridgeTempC: fridgeTempC_c,
      ambientTempC, targetC: thermalServiceTargetC, containerPreset,
    });
    const tcH = totalH - serviceDurationH - tempH - puntataKickoffH - staglioH;
    if (tcH < 0) return null;
    const segs = [
      { phaseType: 'bulk_room',     durationH: puntataKickoffH, ambientTempC },
      { phaseType: 'balled_room',   durationH: staglioH,         ambientTempC },
      { phaseType: 'balled_fridge', durationH: tcH,              ambientTempC: fridgeTempC_c },
      { phaseType: 'proofing',      durationH: tempH,            ambientTempC },
      { phaseType: 'proofing',      durationH: serviceDurationH, ambientTempC },
    ].filter(s => s.durationH > 1e-6);
    return { temperingH: tempH, tcHours: tcH, segs };
  };

  // Maturazione a serviceEnd: CRESCENTE in fridgeTempC (temp più alta → più maturazione)
  const matAtServiceEnd = (fridgeTempC_c) => {
    const sc = scheduleFor(fridgeTempC_c);
    if (!sc) return -1;
    const mu = muMaxScaledFor(agentDosePct, agentMuMax, doseRef);
    const r  = simulateTimeline(sc.segs, { tempDough: ambientTempC, leavAdu: 0, enzAdu: enzSeed, wDamage: 0 }, { ...baseOpts, muMaxScaled: mu });
    return r.final.enzymaticMatPct;
  };

  // Verifica fattibilità agli estremi
  const minSc = scheduleFor(fridgeTempMin);
  if (!minSc) {
    return { feasible: false, mixStart, mixStartIsNow: true,
      resolvedTargetMaturationPct: targetMaturationPct, resolvedBubbleThresholdPct: bubbleThresholdPct,
      infeasibility: { reason: 'window_too_short', mitigations: ['La finestra è troppo corta: non c\'è tempo per puntata + appretto + tempering + servizio'] } };
  }
  const matMin = matAtServiceEnd(fridgeTempMin);
  const matMax = matAtServiceEnd(fridgeTempCUser);

  if (matMin > targetMaturationPct + overshootTol) {
    // Vera SOVRAMMATURAZIONE: troppo lontano dal target anche con tolleranza.
    return {
      feasible: false, mixStart, mixStartIsNow: true,
      resolvedTargetMaturationPct: targetMaturationPct, resolvedBubbleThresholdPct: bubbleThresholdPct,
      infeasibility: {
        reason: 'cannot_slow_enough',
        maturationAtMin: parseFloat(matMin.toFixed(1)),
        mitigations: [
          'Anticipa il servizio (inizia a servire prima)',
          `Riduci il target di maturazione (attuale: ${targetMaturationPct}%)`,
        ],
      },
    };
  }

  if (matMin > targetMaturationPct) {
    // NEAR_CEILING: entro la tolleranza overshootTol — feasible con warning.
    const ncSc = scheduleFor(fridgeTempMin);
    const puntataMaxH_nc = style ? computePuntataMaxH(style, ambientTempC) : null;
    const effectivePuntataH_nc = puntataMaxH_nc != null ? Math.min(puntataKickoffH, puntataMaxH_nc) : puntataKickoffH;
    const timeline_nc = buildServiceWindowTimeline({
      puntataH: puntataKickoffH, puntataMaxH: puntataMaxH_nc,
      staglioH, tcHours: ncSc?.tcHours ?? 0,
      temperingH: ncSc ? computeTemperingH({ ballMassKg, hydration, fridgeTempC: fridgeTempMin, ambientTempC, targetC: thermalServiceTargetC, containerPreset }) : 0,
      serviceDurationH, ambientTempC, fridgeTempC: fridgeTempMin,
    });
    return {
      feasible: true, mixStart, mixStartIsNow: true,
      recommendedFridgeTempC: fridgeTempMin,
      fridgeTempAdjusted: fridgeTempCUser !== fridgeTempMin,
      matWarning: 'NEAR_CEILING',
      enzymaticMatAtServiceEnd: parseFloat(matMin.toFixed(1)),
      resolvedTargetMaturationPct: targetMaturationPct,
      resolvedBubbleThresholdPct: bubbleThresholdPct,
      puntataMaxH: puntataMaxH_nc,
      effectivePuntataH: effectivePuntataH_nc,
      timeline: timeline_nc,
    };
  }

  if (matMax < targetMaturationPct) {
    return {
      feasible: false, mixStart, mixStartIsNow: true,
      resolvedTargetMaturationPct: targetMaturationPct, resolvedBubbleThresholdPct: bubbleThresholdPct,
      infeasibility: {
        reason: 'window_too_short_maturation',
        maturationAtMax: parseFloat(matMax.toFixed(1)),
        mitigations: [
          `Finestra troppo corta: maturazione a fine servizio sarebbe ${matMax.toFixed(0)}% (target ${targetMaturationPct}%)`,
          'Posticipa l\'inizio del servizio o allunga la durata totale',
          'Usa un prefermento per partire con maggiore maturazione iniziale',
        ],
      },
    };
  }

  // Bisezione: trova fridgeTempC* s.t. matAtServiceEnd = targetMaturationPct
  const optFridgeTempC_raw = bisectIncreasing(matAtServiceEnd, targetMaturationPct, fridgeTempMin, fridgeTempCUser, 0.15);
  const optFridgeTempC     = parseFloat(optFridgeTempC_raw.toFixed(1));
  const fridgeTempAdjusted = optFridgeTempC < fridgeTempCUser - 0.15;

  const optSc = scheduleFor(optFridgeTempC) ?? scheduleFor(fridgeTempCUser);
  const { temperingH, tcHours, segs: fullSegs } = optSc;

  // C3: bisezione dose per soglia bolle (schedule fisso)
  const initState = { tempDough: ambientTempC, leavAdu: 0, enzAdu: enzSeed, wDamage: 0 };
  const leaveningAtEnd = (dose) => simulateTimeline(fullSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) }).final.leaveningPct;

  let dose = agentDosePct;
  let bubbleCapped = false;
  if (doseRef != null) {
    const dMin = doseMinPct ?? doseRef * 0.1;
    const dMax = doseMaxPct ?? doseRef * 2;
    if (leaveningAtEnd(dMin) > bubbleThresholdPct) {
      dose = dMin; bubbleCapped = true;
    } else if (leaveningAtEnd(dMax) < bubbleThresholdPct) {
      dose = dMax;
    } else {
      dose = bisectIncreasing(leaveningAtEnd, bubbleThresholdPct, dMin, dMax, 0.1);
    }
  } else {
    bubbleCapped = leaveningAtEnd(agentDosePct) > bubbleThresholdPct;
  }

  // Simulazione finale
  const finalSim = simulateTimeline(fullSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) });
  const end = finalSim.final;

  // Stato a serviceStart (prima del segmento servizio) per finestra sicura
  const preServiceSegs = [
    { phaseType: 'bulk_room',     durationH: puntataKickoffH, ambientTempC },
    { phaseType: 'balled_room',   durationH: staglioH,         ambientTempC },
    { phaseType: 'balled_fridge', durationH: tcHours,          ambientTempC: optFridgeTempC },
    { phaseType: 'proofing',      durationH: temperingH,       ambientTempC },
  ].filter(s => s.durationH > 1e-6);
  const preServiceSim = simulateTimeline(preServiceSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) });
  const openState = {
    tempDough: preServiceSim.final.tempDough, leavAdu: preServiceSim.final.leavAdu,
    enzAdu: preServiceSim.final.enzAdu,       wDamage: preServiceSim.final.wDamage,
  };
  const { maxSafeServiceWindowH, binding } = computeMaxSafeServiceWindow(
    openState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) },
    { targetMaturationPct: targetMaturationPct, bubbleThresholdPct: bubbleThresholdPct, W0, ambientTempC },
  );

  const structuralStatus = structuralState(W0, end.W_current);
  const wCollapsed = structuralStatus === 'CRITICAL' || structuralStatus === 'COLLAPSED';

  const puntataMaxH = style ? computePuntataMaxH(style, ambientTempC) : null;
  const effectivePuntataH = puntataMaxH != null ? Math.min(puntataKickoffH, puntataMaxH) : puntataKickoffH;

  const timeline = buildServiceWindowTimeline({
    puntataH: puntataKickoffH, puntataMaxH, staglioH, tcHours, temperingH,
    serviceDurationH, ambientTempC, fridgeTempC: optFridgeTempC,
  });

  const result = {
    feasible: !wCollapsed,
    mixStart,
    mixStartIsNow: true,
    recommendedFridgeTempC: fridgeTempAdjusted ? optFridgeTempC : null,
    fridgeTempAdjusted,
    schedule: {
      puntataH:  parseFloat(puntataKickoffH.toFixed(2)),
      staglioH:  parseFloat(staglioH.toFixed(2)),
      tcHours:   parseFloat(tcHours.toFixed(2)),
      temperingH: parseFloat(temperingH.toFixed(2)),
      serviceDurationH,
    },
    dose: parseFloat(dose.toFixed(4)),
    bubbleCapped,
    atServiceStart: {
      tempDough:    parseFloat(preServiceSim.final.tempDough.toFixed(1)),
      maturationPct: parseFloat(preServiceSim.final.enzymaticMatPct.toFixed(1)),
      leaveningPct:  parseFloat(preServiceSim.final.leaveningPct.toFixed(1)),
    },
    atServiceEnd: {
      maturationPct:   parseFloat(end.enzymaticMatPct.toFixed(1)),
      leaveningPct:    parseFloat(end.leaveningPct.toFixed(1)),
      W_current:       parseFloat(end.W_current.toFixed(0)),
      structuralStatus,
      tempDough:       parseFloat(end.tempDough.toFixed(1)),
    },
    timeline,
    bakeTargetElapsedH: parseFloat(totalH.toFixed(4)),
    maxSafeServiceWindowH,
    puntataMaxH,
    effectivePuntataH,
    resolvedTargetMaturationPct: targetMaturationPct,
    resolvedBubbleThresholdPct: bubbleThresholdPct,
    diagnostics: {
      totalH: parseFloat(totalH.toFixed(2)),
      optFridgeTempC,
      fridgeTempAdjusted,
      maxSafeBinding: binding,
      enzSeed: parseFloat(enzSeed.toFixed(3)),
    },
  };

  if (wCollapsed) {
    result.infeasibility = {
      reason: 'w_collapse',
      mitigations: ['Usa una farina con W più alto', 'Aumenta il sale (rallenta la proteolisi)'],
    };
  }
  return result;
}

/**
 * SOLVER principale. Vedi header per i vincoli/leve.
 */
export function solveServiceWindow(input) {
  const {
    serviceStart, serviceDurationH, ambientTempC, fridgeTempC = 4,
    agentType, agentEaKj, agentMuMax, agentLambda, agentAsymptote = 100,
    agentDosePct = 0.3,
    W0 = 280, hydration = 65, salt = 0, waterHardnessPpm, initialPH = 5.8,
    totalFlourGrams = 1000, numPanetti = 1, containerPreset = 'bare',
    prefermenti = [], initialMaturationOffset = 0,
    thermalServiceTargetC = SERVICE_WINDOW_DEFAULTS.thermalServiceTargetC,
    puntataKickoffH       = SERVICE_WINDOW_DEFAULTS.puntataKickoffH,
    staglioH              = SERVICE_WINDOW_DEFAULTS.staglioH,
    doseRefPct,
    doseMinPct, doseMaxPct,
    subStepH = 0.05,
  } = input;

  // v2.4.5: gerarchia userOverride > stile > default globale
  const targetMaturationPct = resolveTargetMaturationPct(input);
  const bubbleThresholdPct  = resolveBubbleThresholdPct(input);

  const doseRef  = doseRefPct !== undefined ? doseRefPct : defaultDoseRef(agentType);
  const prefFrac = Math.min(1, (prefermenti ?? []).reduce((s, p) => s + (p.flourFraction ?? 0) / 100, 0));
  const leavLambda = Math.max(0.3, agentLambda * (1 - 0.5 * prefFrac));
  const enzSeed = initialMaturationOffset > 0
    ? findAduAt(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, initialMaturationOffset * 100)
    : 0;
  const aduMatTarget = findAduAt(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, targetMaturationPct);

  const { ballMassKg } = massesKg({ totalFlourGrams, hydration, salt, numPanetti });

  // opts condivisi per simulateTimeline (muMaxScaled iniettato per-chiamata)
  const baseOpts = {
    agentEaKj, agentType, leavLambda, agentAsymptote,
    W0, hydration, salt, waterHardnessPpm, initialPH,
    totalFlourGrams, numPanetti, containerPreset, subStepH,
  };

  const mitigations = (reason, maxSafe) => {
    const m = [];
    if (reason === 'cannot_temper')
      m.push('Alza la temperatura ambiente sopra 18°C', 'Accetta un servizio sotto i 18°C (estensibilità ridotta)');
    if (reason === 'maturation_overshoot') {
      if (maxSafe != null) m.push(`Riduci la durata del servizio a ≤ ${maxSafe.toFixed(1)}h`);
      m.push('Sforno progressivo: tieni parte delle palline al freddo più a lungo',
             'Abbassa la temperatura ambiente del servizio',
             'Riduci la maturazione del prefermento (offset iniziale)');
    }
    if (reason === 'w_collapse')
      m.push('Usa una farina con W più alto', 'Sposta più maturazione in frigo (proteolisi più lenta)',
             'Aumenta leggermente il sale (rallenta la proteolisi)');
    return m;
  };

  // ── C1: tempering ──────────────────────────────────────────────────────────
  if (ambientTempC <= thermalServiceTargetC) {
    return {
      feasible: false,
      infeasibility: { reason: 'cannot_temper', maxSafeServiceWindowH: 0, mitigations: mitigations('cannot_temper') },
    };
  }
  const temperingH = computeTemperingH({ ballMassKg, hydration, fridgeTempC, ambientTempC, targetC: thermalServiceTargetC, containerPreset });

  // ── Coda (tempering + servizio): contributo enzimatico fisso, dose-independent ─
  const tailSegs = [
    { phaseType: 'proofing', durationH: temperingH,       ambientTempC },
    { phaseType: 'proofing', durationH: serviceDurationH, ambientTempC },
  ];
  const tailSim = simulateTimeline(tailSegs,
    { tempDough: fridgeTempC, leavAdu: 0, enzAdu: 0, wDamage: 0 },
    { ...baseOpts, muMaxScaled: muMaxScaledFor(agentDosePct, agentMuMax, doseRef) });
  const enzAdu_tail = tailSim.final.enzAdu;

  const enzAdu_upstreamNeeded = aduMatTarget - enzSeed - enzAdu_tail;

  // Stato "open" (a serviceStart) per la finestra sicura — calcolato dopo lo schedule.
  let puntataH = puntataKickoffH;
  let tcHours  = 0;

  // Incremento enzimatico upstream (puntata TA + staglio TA + appretto TC)
  const upstreamEnzIncrement = (pH, tcH) => {
    const segs = [
      { phaseType: 'bulk_room',     durationH: pH,    ambientTempC },
      { phaseType: 'balled_room',   durationH: staglioH, ambientTempC },
      { phaseType: 'balled_fridge', durationH: tcH,   ambientTempC: fridgeTempC },
    ];
    const sim = simulateTimeline(segs,
      { tempDough: ambientTempC, leavAdu: 0, enzAdu: enzSeed, wDamage: 0 },
      { ...baseOpts, muMaxScaled: muMaxScaledFor(agentDosePct, agentMuMax, doseRef) });
    return sim.final.enzAdu - enzSeed;
  };

  if (enzAdu_upstreamNeeded <= 0) {
    // La finestra + tempering già superano il target → overshoot.
    // La finestra sicura si misura da uno stato post-tempering (il tempering è
    // obbligatorio per C1 e accumula maturazione): include quel contributo così
    // il valore è coerente con la durata di servizio realmente sostenibile.
    const ovrOpts = { ...baseOpts, muMaxScaled: muMaxScaledFor(agentDosePct, agentMuMax, doseRef) };
    const temperSim = simulateTimeline(
      [{ phaseType: 'proofing', durationH: temperingH, ambientTempC }],
      { tempDough: fridgeTempC, leavAdu: 0, enzAdu: enzSeed, wDamage: 0 }, ovrOpts);
    const openStateOvr = {
      tempDough: temperSim.final.tempDough, leavAdu: temperSim.final.leavAdu,
      enzAdu: temperSim.final.enzAdu, wDamage: temperSim.final.wDamage,
    };
    const { maxSafeServiceWindowH } = computeMaxSafeServiceWindow(openStateOvr, ovrOpts,
      { targetMaturationPct, bubbleThresholdPct, W0, ambientTempC });
    return {
      feasible: false,
      infeasibility: { reason: 'maturation_overshoot', maxSafeServiceWindowH, mitigations: mitigations('maturation_overshoot', maxSafeServiceWindowH) },
    };
  }

  // Risolvi lo schedule a monte: minimizza esposizione TA (puntata kickoff fissa,
  // risolvi tcH in frigo); fallback pura-TA se la sola kickoff già eccede.
  const incrAtKickoff0 = upstreamEnzIncrement(puntataKickoffH, 0);
  if (incrAtKickoff0 >= enzAdu_upstreamNeeded) {
    // Kickoff+staglio (a TA) bastano: riduci la puntata a TA, niente frigo.
    tcHours  = 0;
    puntataH = bisectIncreasing(p => upstreamEnzIncrement(p, 0), enzAdu_upstreamNeeded, 0, puntataKickoffH, 0.02);
  } else {
    puntataH = puntataKickoffH;
    tcHours  = bisectIncreasing(tc => upstreamEnzIncrement(puntataKickoffH, tc), enzAdu_upstreamNeeded, 0, 240, 0.05);
  }

  // ── C3: bisezione dose per la soglia bolle (schedule fisso) ─────────────────
  const fullSegs = [
    { phaseType: 'bulk_room',     durationH: puntataH,         ambientTempC },
    { phaseType: 'balled_room',   durationH: staglioH,         ambientTempC },
    { phaseType: 'balled_fridge', durationH: tcHours,          ambientTempC: fridgeTempC },
    { phaseType: 'proofing',      durationH: temperingH,       ambientTempC },
    { phaseType: 'proofing',      durationH: serviceDurationH, ambientTempC },
  ];
  const initState = { tempDough: ambientTempC, leavAdu: 0, enzAdu: enzSeed, wDamage: 0 };
  const leaveningAtEnd = (dose) => simulateTimeline(fullSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) }).final.leaveningPct;

  let dose = agentDosePct;
  let bubbleCapped = false;
  if (doseRef != null) {
    const dMin = doseMinPct ?? doseRef * 0.1;
    const dMax = doseMaxPct ?? doseRef * 2;
    if (leaveningAtEnd(dMin) > bubbleThresholdPct) {
      dose = dMin; bubbleCapped = true;                 // anche dose minima sfora la soglia
    } else if (leaveningAtEnd(dMax) < bubbleThresholdPct) {
      dose = dMax;                                       // dose non vincolante: usa max sicura
    } else {
      dose = bisectIncreasing(leaveningAtEnd, bubbleThresholdPct, dMin, dMax, 0.1);
    }
  } else {
    bubbleCapped = leaveningAtEnd(agentDosePct) > bubbleThresholdPct;  // sourdough: dose non scalabile
  }

  // ── Simulazione finale + readout vincoli ────────────────────────────────────
  const finalSim = simulateTimeline(fullSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) });
  const end = finalSim.final;

  // Stato a serviceStart (= fine tempering, prima della finestra) per la finestra sicura
  const preServiceSegs = fullSegs.slice(0, 4);
  const preServiceSim = simulateTimeline(preServiceSegs, initState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) });
  const openState = {
    tempDough: preServiceSim.final.tempDough,
    leavAdu:   preServiceSim.final.leavAdu,
    enzAdu:    preServiceSim.final.enzAdu,
    wDamage:   preServiceSim.final.wDamage,
  };
  const { maxSafeServiceWindowH, binding } = computeMaxSafeServiceWindow(openState,
    { ...baseOpts, muMaxScaled: muMaxScaledFor(dose, agentMuMax, doseRef) },
    { targetMaturationPct, bubbleThresholdPct, W0, ambientTempC });

  const structuralStatus = structuralState(W0, end.W_current);
  const wCollapsed = structuralStatus === 'CRITICAL' || structuralStatus === 'COLLAPSED';

  const totalUpstreamH = puntataH + staglioH + tcHours + temperingH;
  const mixStart = new Date(serviceStart.getTime() - totalUpstreamH * HOUR_MS);

  const timeline = buildServiceWindowTimeline({
    puntataH, staglioH, tcHours, temperingH, serviceDurationH, ambientTempC, fridgeTempC,
  });
  const bakeTargetElapsedH = parseFloat((totalUpstreamH + serviceDurationH).toFixed(4));

  const result = {
    feasible: !wCollapsed,
    mixStart,
    schedule: {
      puntataH:  parseFloat(puntataH.toFixed(2)),
      staglioH:  parseFloat(staglioH.toFixed(2)),
      tcHours:   parseFloat(tcHours.toFixed(2)),
      temperingH: parseFloat(temperingH.toFixed(2)),
      serviceDurationH,
    },
    dose: parseFloat(dose.toFixed(4)),
    bubbleCapped,
    atServiceStart: {
      tempDough:    parseFloat(preServiceSim.final.tempDough.toFixed(1)),
      maturationPct: parseFloat(preServiceSim.final.enzymaticMatPct.toFixed(1)),
      leaveningPct:  parseFloat(preServiceSim.final.leaveningPct.toFixed(1)),
    },
    atServiceEnd: {
      maturationPct:   parseFloat(end.enzymaticMatPct.toFixed(1)),
      leaveningPct:    parseFloat(end.leaveningPct.toFixed(1)),
      W_current:       parseFloat(end.W_current.toFixed(0)),
      structuralStatus,
      tempDough:       parseFloat(end.tempDough.toFixed(1)),
    },
    timeline,
    bakeTargetElapsedH,
    maxSafeServiceWindowH,
    diagnostics: {
      enzAdu_tail: parseFloat(enzAdu_tail.toFixed(3)),
      enzAdu_upstreamNeeded: parseFloat(enzAdu_upstreamNeeded.toFixed(3)),
      aduMatTarget: parseFloat(aduMatTarget.toFixed(3)),
      enzSeed: parseFloat(enzSeed.toFixed(3)),
      maxSafeBinding: binding,
    },
  };

  if (wCollapsed) {
    result.infeasibility = {
      reason: 'w_collapse',
      maxSafeServiceWindowH,
      mitigations: mitigations('w_collapse', maxSafeServiceWindowH),
    };
  }
  return result;
}
