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
} from './engine-v2.4.0.js';

// ─── Default calibrabili (niente magic number) ───────────────────────────────
export const SERVICE_WINDOW_DEFAULTS = {
  bubbleThresholdPct:    92,   // lievitazione oltre cui l'impasto fa bolle/blistering
  thermalServiceTargetC: 18,   // C1: cuore impasto minimo a serviceStart
  targetMaturationPct:   90,   // C2: target maturazione a serviceEnd
  puntataKickoffH:        2,   // puntata TA minima per sviluppo glutine
  staglioH:             0.5,   // staglio TA
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

/**
 * Costruisce la PhaseSegment[] (timeline termica) dallo schedule risolto.
 * startElapsedH relativi a mixStart (= session.startedAt). Tempering + servizio
 * riusano la fase `proofing` (zero migrazione; l'integratore traccia tempDough
 * separato da ambientTempC, quindi la rampa di riscaldo è già modellata).
 */
export function buildServiceWindowTimeline({ puntataH, staglioH, tcHours, temperingH, serviceDurationH, ambientTempC, fridgeTempC }) {
  const raw = [
    { phaseType: 'bulk_room',     durationH: puntataH,         ambientTempC },
    { phaseType: 'balled_room',   durationH: staglioH,         ambientTempC },
    { phaseType: 'balled_fridge', durationH: tcHours,          ambientTempC: fridgeTempC },
    { phaseType: 'proofing',      durationH: temperingH,       ambientTempC },
    { phaseType: 'proofing',      durationH: serviceDurationH, ambientTempC },
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
    targetMaturationPct   = SERVICE_WINDOW_DEFAULTS.targetMaturationPct,
    bubbleThresholdPct    = SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct,
    thermalServiceTargetC = SERVICE_WINDOW_DEFAULTS.thermalServiceTargetC,
    puntataKickoffH       = SERVICE_WINDOW_DEFAULTS.puntataKickoffH,
    staglioH              = SERVICE_WINDOW_DEFAULTS.staglioH,
    doseRefPct,
    doseMinPct, doseMaxPct,
    subStepH = 0.05,
  } = input;

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
