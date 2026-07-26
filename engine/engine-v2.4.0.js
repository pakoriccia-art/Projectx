/**
 * PizzaMatrix Engine v2.4.0
 * =============================================================
 * Engine biochimico completo per la modellazione della
 * fermentazione degli impasti della pizza.
 *
 * Versioning incorporato:
 *  v2.0   — CTM×Arrhenius + Gompertz + inerzia termica + proteolisi pH + dual-pop LM
 *  v2.1   — fix pre-fermento (kRatio, dose scaling lineare)
 *  v2.2   — blend farine (max 3), autolisi, mix prefermenti (max 2)
 *  v2.3   — Hill W decay (n=5), resistenza contenitore, CTM×Arrhenius dichiarato
 *  v2.3.1 — anchor interpolati, f_hydration normalizzata, DEFAULT_FN=340, DEFAULT_ASH
 *  v2.3.2 — denaturation factor amylase, f_pH_amylase nel tick, pH combining logaritmico
 *  v2.4.0 — sale (inibizione osmotica), blend W non-lineare, inerzia bifase,
 *            malto diastatico, altitudine, durezza acqua, reverse scaling
 *  v2.4.17 — Fix #96: parità solver↔tick sul sale: fSaltYeast su leavAdu in
 *             computeDeltaAdu e tick loop; fSaltProtease su t_crit nel damage
 *             integral tick e computeDashboardEffectiveW. enzAdu invariante (§2.0).
 *             Costanti/funzioni già in engine come fonte unica. Test SALT_TICK_PARITY.
 *
 * Spec di riferimento: PIZZAMATRIX_KB21.md v2.4.0-pre
 * Letteratura: Rosso 1993 (CTM), Zwietering 1990 (Gompertz),
 *              Gobbetti 2005 (LM dual-pop), Hill 1910, Every 2002 (sale)
 *
 * REGOLE DI SVILUPPO:
 *  - Nessuna costante inventata: ogni valore è estratto dal KB
 *  - Equazioni non-lineari dove il KB le prevede (Hill, CTM, Gompertz)
 *  - Guard clauses su tutti i path numericamente instabili
 * =============================================================
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// § A — SAFETY UTILITIES
// ═══════════════════════════════════════════════════════════════

/** exp() con clamp per evitare Infinity/NaN su argomenti estremi */
function safeExp(x) {
  return Math.exp(Math.max(-700, Math.min(700, x)));
}

/** Divisione sicura: restituisce fallback se denominatore ≈ 0 */
function safeDiv(num, den, fallback = 0) {
  if (Math.abs(den) < 1e-12) return fallback;
  return num / den;
}

/** Clamp valore nell'intervallo [lo, hi] */
function safeClamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ═══════════════════════════════════════════════════════════════
// § B — COSTANTI v2.0–v2.3.2
// ═══════════════════════════════════════════════════════════════

const DEFAULT_FN   = 340;    // Falling Number default (v2.3.1) — §2.13
const DEFAULT_ASH  = 0.55;   // Ceneri default % — §2.13
const EXTREME_W_SPREAD = 150; // Soglia warning blend eterogeneo — §2.13

const T_REF_K = 298.15;  // 25°C in Kelvin — §2.4
const R_GAS   = 8.314;   // J/(mol·K) — costante dei gas

// Costanti termiche — §2.5 + §3
const CP_WATER  = 4186;  // J/(kg·K) calore specifico acqua
const CP_FLOUR  = 1840;  // J/(kg·K) calore specifico farina secca
const RHO_DOUGH = 1050;  // kg/m³ densità impasto
const H_AIR     = 8;     // W/(m²·K) convezione naturale aria (ambiente chiuso)

/**
 * Parametri cardinali CTM per agente — §2.1
 * Tmin/Topt/Tmax in °C
 */
const CARDINAL_PARAMS = {
  fresh_yeast:      { Tmin: 1.5, Topt: 28.0, Tmax: 45.0 },
  instant_dry_yeast:{ Tmin: 2.0, Topt: 28.0, Tmax: 44.0 },
  sourdough_wheat:  { Tmin: 2.0, Topt: 26.0, Tmax: 43.0 },
  lab_bacteria:     { Tmin: 5.0, Topt: 32.0, Tmax: 48.0 },
};

/**
 * Parametri Gompertz calibrati per agente impasto finale — §2.3
 * muMax [h⁻¹], lambda [h], Ea [kJ/mol]
 */
const AGENT_GOMPERTZ = {
  fresh_yeast:       { muMax: 12.0, lambda: 1.2, Ea: 62, asymptote: 100 },
  instant_dry_yeast: { muMax: 11.5, lambda: 0.8, Ea: 60, asymptote: 100 },
  sourdough_wheat:   { muMax:  7.0, lambda: 3.5, Ea: 65, asymptote: 100 },
};

// LM_PARAMS (modello dual-population v2.0) rimosso — issue #18.
// Era su una scala Gompertz incompatibile con AGENT_GOMPERTZ (85 % = 29 giorni).
// Il matrixFactor 0.6 sopravvive dov'è realmente usato: LAB_KINETICS.muMax.

/** Orologio maturazione enzimatica — two-clock v2.4.1 (KB §2.4)
 * Accumulo: enzAdu += fArrhenius(T) × deltaH — senza CTM → attivo a 4°C (~29% ritmo a 22°C).
 * Calibrazione: gompertz(11.41, 9.50, 0.5, 100) = 85.0% → 48h@4°C target.
 * A 22°C: 85% in ~13.8h (coincide con l'orologio lievitazione a TA).
 * EaKj = 47 ≡ HILL_W_DECAY.EaProteasiKj — riusa fArrhenius() già calibrata.
 */
const ENZYMATIC_CLOCK_PARAMS = {
  EaKj:   47,   // Ea proteolisi [kJ/mol] — stessa di fArrhenius
  muMax:  9.50,
  lambda: 0.50,
};

/** Hill W decay — §2.4 */
const HILL_W_DECAY = {
  hillExponent: 5,
  // tCritRefAnchors — frame 25°C/pH5.2/H65%.
  // v2.4.19 (#96): ricalibrati (più stringenti) da proposta esterna a 20°C/pH5.2
  // [[150,14],[220,26],[300,48],[400,85]], convertiti al frame 25°C via il
  // fattore g(20°C) = 1/fArrhenius(20°C) ≈ 1.38181 REALE di computeTCrit
  // (tCritRef25 = tCritProposto20 / g(20°C)). Grid W esteso a {150,220,300,400}.
  // [IPOTESI NON VALIDATA] fonte non peer-reviewed [UNCERTAIN]; manca misura
  // alveografica (serie t0/t12/t24 a 25°C/65%). Razionale: modello precedente
  // ([[180,25],[240,40],[315,60],[400,90]]) troppo tollerante (~2% decay
  // @24h/25°C/pH5.5 per W280 vs letteratura 30-50%). Esponente Hill n=5 invariato.
  tCritRefAnchors: [
    [150, 10.131634],
    [220, 18.815891],
    [300, 34.737030],
    [400, 61.513491],
  ],
  EaProteasiKj:    47,
  pHOptProteasi:   5.2,
  pHSigmaProteasi: 0.6,
  T_REF_K:         298.15,
};

/** Preset contenitore — §2.5 */
const CONTAINER_THERMAL_PRESETS = {
  bare:              { label: 'Nudo',                           tauMultiplier: 1.0 },
  film:              { label: 'Pellicola sottile',              tauMultiplier: 1.2 },
  open_box:          { label: 'Cassetta aperta',                tauMultiplier: 1.5 },
  glass_covered:     { label: 'Ciotola vetro coperta',          tauMultiplier: 2.0 },
  plastic_bag:       { label: 'Sacchetto plastica chiuso',      tauMultiplier: 2.2 },
  closed_box:        { label: 'Cassetta polipropilene coperta', tauMultiplier: 2.5 },
  closed_box_double: { label: 'Cassetta + isolamento',          tauMultiplier: 3.0 },
};

/** Calibrazione autolisi — §2.11 */
const AUTOLYSIS_CALIBRATION = {
  pHEffective:             6.0,
  plDecayAsymptote:        0.7,
  plDecayTau:              2.5,
  maxRecommendedHours:     24,
  minRecommendedHours:     0.33,
  minRecommendedHydration: 50,
  maxRecommendedTemp:      28,
};

/** Calibrazione pre-fermenti — §3 */
const PREFERMENTO_CALIBRATION = {
  poolish: {
    muMax: 5.75, lambda: 1.50,
    refDosePct: 0.20, refTempC: 20, refDurationH: 14,
    hydFactor: () => 1.0,
  },
  biga: {
    muMax: 22.0, lambda: 0.40,
    refDosePct: 0.50, refTempC: 17, refDurationH: 20,
    hydFactor: (h) => safeClamp(0.55 + (h - 44) / 11 * 0.35, 0.55, 0.90),
  },
};

/** pH amylase (modulazione reversibile) — §2.8.1 */
const AMYLASE_PH_PARAMS = {
  pHOpt:   5.5,
  pHSigma: 0.7,
};

/** Denaturation factor amylase (irreversibile) — §2.8.2 */
const AMYLASE_DENATURATION_PARAMS = {
  pHStressThreshold: 5.5,
  durationDecayRate: 0.003,
  floorFactor:       0.92,
};

/** Correzione amilasica sul tasso fermentativo — §3 amylaseCorrectedRate */
const AMYLASE_CORRECTION_PARAMS = {
  rateScale: 0.4,   // da calibrare empiricamente [§10]
  rateFloor: 0.50,
};

// ═══════════════════════════════════════════════════════════════
// § C — COSTANTI v2.4.0 (NUOVE)
// ═══════════════════════════════════════════════════════════════

/** Inibizione osmotica sale — §2.14.2 */
const SALT_INHIBITION_PARAMS = {
  yeastKSalt:    0.10,
  yeastFloor:    0.60,
  proteaseKSalt: 0.08,
  proteaseFloor: 0.70,
};

/** Blend W non-lineare — §2.14.1 */
const W_BLEND_NONLINEAR_K = 0.0003;  // da calibrare su alveografo [§10]

/** Malto diastatico — §2.15
 * maltAmylaseScale calibrato: 1% dose a 200°L contribuisce +0.60 all'amylaseIndex totale.
 * Farina tipica (FN=340) ha index~0.51 → con 1%/200°L totale=1.11 (+26% velocità ADU).
 * Rif: amylaseCorrectedRate usa rateScale=0.4; scala precedente (1.2) era ~50× sottostimata.
 */
const MALT_PARAMS = {
  refDPLintner:     200,
  maltAmylaseScale: 60,
  alertAdvisory:    1.50,
  alertCritical:    1.80,
  maxSafeIndex:     2.00,
};

/** Compensazione altitudine — §2.16 */
const ALTITUDE_PARAMS = {
  P0_Pa:        101325,
  scaleHeightM: 8500,
};

/** Durezza acqua — §2.17 */
const WATER_HARDNESS_PARAMS = {
  refPpm:        150,
  glutenKHard:   0.0008,
  proteaseKHard: 0.0004,
};

// pH drop per unità di leavAdu — v2.4.11 §2.6.1
// kAcid calibrato su dati fermentativi: LBF ≈ 0.0035 pH/ADU, LM ≈ 0.020 pH/ADU
const ACID_PRODUCTION_PARAMS = {
  fresh_yeast:       { kAcid: 0.0035, pHFloor: 5.0 },
  instant_dry_yeast: { kAcid: 0.0035, pHFloor: 5.0 },
  sourdough_wheat:   { kAcid: 0.020,  pHFloor: 4.5 },
};

// Cinetica LAB separata per LM (dual-pop Saccharomiceti + batteri lattici) — v2.4.14 §2.6
// I LAB (μmax alto, Topt=32°C) producono la maggior parte dell'acido; cinetica
// distinta dai Saccharomiceti (leavAdu). Autoinibizione progressiva sotto pH 4.8.
const LAB_KINETICS = {
  muMax:        0.45 * 0.6,  // matrixFactor=0.6 in matrice solida (§2.6)
  Topt:         32,
  Tmin:         5,
  Tmax:         45,
  Ea:           58,           // kJ/mol
  kAcid:        0.030,        // drop pH per unità labAdu
  pHFloor:      4.5,
  pHInhibFloor: 3.5,          // LAB completamente inibiti
  pHInhibStart: 4.8,          // inizio declino lineare
};
// Contributo acido residuo dei Saccharomiceti in LM (minore dei LAB)
const SACC_ACID_CONTRIB = { kAcid: 0.003 };

// ═══════════════════════════════════════════════════════════════
// § D — CORE KINETICS (v2.0)
// ═══════════════════════════════════════════════════════════════

/**
 * Modello CTM di Rosso (1993) su parametri cardinali espliciti — §2.1
 * Restituisce γ(T) ∈ [0, 1]. Helper riusabile (LAB dual-pop, §2.6).
 */
function _cardinalForParams(tempC, Tmin, Topt, Tmax) {
  if (tempC <= Tmin || tempC >= Tmax) return 0;
  const num = (tempC - Tmax) * Math.pow(tempC - Tmin, 2);
  const den = (Topt - Tmin) * (
    (Topt - Tmin) * (tempC - Topt)
    - (Topt - Tmax) * (Topt + Tmin - 2 * tempC)
  );
  return safeDiv(num, den, 0);
}

/**
 * Modello CTM di Rosso (1993) — §2.1
 * Restituisce γ(T) ∈ [0, 1]
 * γ(Topt) = 1.0 ; γ = 0 per T ≤ Tmin o T ≥ Tmax
 */
function cardinalCorrection(tempC, agentType) {
  const p = CARDINAL_PARAMS[agentType];
  if (!p) return 0;
  return _cardinalForParams(tempC, p.Tmin, p.Topt, p.Tmax);
}

/**
 * Modello composito CTM × Arrhenius — §2.1.1
 * k_effective(T) = arrhenius(T, Ea) × γ_CTM(T)
 * Restituisce tasso effettivo (non normalizzato)
 */
function kEffective(tempC, eaKj, agentType) {
  const T_K   = tempC + 273.15;
  const arr   = safeExp((-eaKj * 1000 / R_GAS) * (1 / T_K - 1 / T_REF_K));
  const gamma = cardinalCorrection(tempC, agentType);
  return arr * gamma;
}

/**
 * kRatio normalizzato a 25°C — usato per calcolo ADU
 * kRatio = kEffective(T) / kEffective(25°C)
 */
function kRatio(tempC, eaKj, agentType) {
  const kRef = kEffective(25, eaKj, agentType);
  if (kRef < 1e-12) return 0;
  return kEffective(tempC, eaKj, agentType) / kRef;
}

/**
 * Equazione di Gompertz modificata (Zwietering 1990) — §2.2
 * M(t) = A × exp(-exp((μmax·e/A) × (λ - t) + 1))
 * Restituisce maturazione [0, A] (tipicamente A=100 → %)
 */
function gompertz(adu, muMax, lambda, A = 100) {
  const arg = (muMax * Math.E / A) * (lambda - adu) + 1;
  return A * safeExp(-safeExp(arg));
}

/**
 * Inverso Gompertz: trova l'ADU corrispondente a una data percentuale
 * Algoritmo: bisezione [0, 2000] con tolleranza 0.01 ADU
 */
function findAduAt(muMax, lambda, A = 100, pct) {
  const target = safeClamp(pct, 0.01, A * 0.9999);
  let lo = 0, hi = 2000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gompertz(mid, muMax, lambda, A) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 0.01) break;
  }
  return (lo + hi) / 2;
}

// lagPhaseAtTemp() rimossa — issue #19. Mai chiamata, e ridondante: lambda è
// espressa in ADU, non in ore, quindi è GIÀ scalata implicitamente in temperatura
// dal kRatio che genera gli ADU. Applicarle un secondo fattore di Arrhenius
// avrebbe allungato la lag due volte al freddo.

// ═══════════════════════════════════════════════════════════════
// § E — THERMAL STACK (v2.3) — spec completa §3
// ═══════════════════════════════════════════════════════════════

/**
 * Calore specifico impasto — §3
 * Media pesata acqua/farina
 * c_p = 4186·h + 1840·(1−h)  [J/(kg·K)]
 */
function doughSpecificHeat(hydrationPct) {
  const h = hydrationPct / 100;
  return CP_WATER * h + CP_FLOUR * (1 - h);
}

/**
 * τ_intrinsic per geometria cilindro piatto (h/r = 0.3, fondo isolato) — §3
 * Volume V = π·r²·h = 0.3π·r³  →  r = cbrt(V / (0.3π))
 * Superficie attiva: A = πr² + 2πr·h = 1.6πr²
 * τ [s] = (m·cp) / (H_AIR·A)
 */
function thermalTimeConstant(massKg, hydrationPct) {
  const cp = doughSpecificHeat(hydrationPct);
  const V  = massKg / RHO_DOUGH;
  const r  = Math.cbrt(V / (0.3 * Math.PI));
  const A  = 1.6 * Math.PI * r * r;
  return (massKg * cp) / (H_AIR * A);  // secondi
}

/**
 * Applica moltiplicatore termico contenitore — §3
 * τ_total = τ_intrinsic × containerFactor
 * Fallback: factor=1.0 (bare) per preset sconosciuto
 */
function applyContainerResistance(tau, preset) {
  const factor = CONTAINER_THERMAL_PRESETS[preset]?.tauMultiplier ?? 1.0;
  return tau * factor;
}

/**
 * Temperatura impasto via Newton cooling — §3
 * T_dough(t) = T_ambient + (T_init − T_ambient) × exp(−t/τ)
 * Funziona sia per raffreddamento che riscaldamento (T_init < T_ambient)
 */
function doughCoreTemp(T_init, T_ambient, secondsElapsed, tauTotal) {
  if (tauTotal <= 0) return T_ambient;
  if (secondsElapsed <= 0) return T_init;
  return T_ambient + (T_init - T_ambient) * safeExp(-secondsElapsed / tauTotal);
}

// ═══════════════════════════════════════════════════════════════
// § F — HILL / PROTEOLISI (v2.3.1)
// ═══════════════════════════════════════════════════════════════

/**
 * Fattore Arrhenius proteasi — §2.4
 * f_Arr(T) = exp((-Ea/R) × (1/T_K − 1/T_ref_K))
 * f_Arr(25°C) = 1.000
 */
function fArrhenius(tempC) {
  const T_K = tempC + 273.15;
  const Ea  = HILL_W_DECAY.EaProteasiKj * 1000;
  return safeExp((-Ea / R_GAS) * (1 / T_K - 1 / HILL_W_DECAY.T_REF_K));
}

/**
 * Fattore pH per proteolisi — §2.4
 * f_pH(pH) = exp(-(pH − 5.2)² / (2 × 0.6²))  gaussiana
 * f_pH(5.2) = 1.0
 */
function fPH(pH) {
  const sigma = HILL_W_DECAY.pHSigmaProteasi;
  const opt   = HILL_W_DECAY.pHOptProteasi;
  return safeExp(-Math.pow(pH - opt, 2) / (2 * sigma * sigma));
}

/**
 * Fattore idratazione per proteolisi — §2.4 (v2.3.1)
 * Normalizzata a H=65%: f_hyd(65%) = 1.0
 * f_hydration(H) = (0.7 + 0.006·H) / 1.09
 */
function fHydration(H) {
  return (0.7 + 0.006 * H) / 1.09;
}

/**
 * t_crit_ref(W) via interpolazione lineare sugli anchor — §2.4 (v2.4.19)
 * Anchor (frame 25°C): [[150,10.13],[220,18.82],[300,34.74],[400,61.51]] → [W, t_crit_h]
 * Clamp: W ≤ 150 → 10.13h ; W ≥ 400 → 61.51h
 */
function computeTCritRef(W) {
  const anchors = HILL_W_DECAY.tCritRefAnchors;
  if (W <= anchors[0][0]) return anchors[0][1];
  if (W >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [W0, t0] = anchors[i];
    const [W1, t1] = anchors[i + 1];
    if (W >= W0 && W <= W1) {
      return t0 + (t1 - t0) * (W - W0) / (W1 - W0);
    }
  }
  return anchors[anchors.length - 1][1];
}

/**
 * t_crit modulato per condizioni reali — §2.4
 * t_crit(W,T,pH,H) = t_crit_ref(W) / (f_Arr(T) × f_pH(pH) × f_hyd(H))
 */
function computeTCrit(W, tempC, pH, H) {
  const tRef = computeTCritRef(W);
  const den  = fArrhenius(tempC) * fPH(pH) * fHydration(H);
  return safeDiv(tRef, den, tRef * 10); // fallback: molto lungo se den≈0
}

/**
 * W corrente via curva di Hill (n=5) — §2.4
 * W(t) = W₀ × 1 / (1 + (t/t_crit)^n)
 */
function computeWHill(W0, tCrit, hours, n = 5) {
  if (tCrit <= 0) return W0 * 0.5;
  const ratio = hours / tCrit;
  return W0 / (1 + Math.pow(ratio, n));
}

/**
 * Stato strutturale impasto — §2.4
 * Restituisce 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED'
 */
function structuralState(W0, W_current) {
  if (W0 <= 0) return 'OK';
  const decayPct = (W0 - W_current) / W0;
  if (decayPct > 0.55) return 'COLLAPSED';
  if (decayPct > 0.35) return 'CRITICAL';
  if (decayPct > 0.20) return 'WARNING';
  return 'OK';
}

// maxSafeHydration() rimossa — issue #19 + #20. Mai chiamata da src/, e in
// conflitto con le altre sorgenti: per W280/PL0.60/prot11.75 restituiva 58.9 %,
// bocciando il 65 % che il wizard stesso propone come default per la napoletana.
// Sorgente unica di verità: hydrationRangeForStyle() in src/data/styleConstraints.ts.

// ═══════════════════════════════════════════════════════════════
// § G — AMYLASE (v2.3.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Indice amilasico da Falling Number — §2.8
 * amylase_index = 2.0 / (1.0 + exp(0.012 × (FN − 250)))
 * FN=250 → 1.0 ; FN=100 → ~1.75 ; FN=400 → ~0.33
 */
function normalizeAmylaseActivity(fallingNumber) {
  const fn = fallingNumber ?? DEFAULT_FN;
  return 2.0 / (1.0 + safeExp(0.012 * (fn - 250)));
}

/**
 * Modulazione pH-dipendente attività amilasica (reversibile) — §2.8.1
 * f_pH_amylase(pH) = exp(-(pH − 5.5)² / (2 × 0.7²))
 * f_pH_amylase(5.5) = 1.0
 */
function fPHAmylase(pH) {
  const { pHOpt, pHSigma } = AMYLASE_PH_PARAMS;
  return safeExp(-Math.pow(pH - pHOpt, 2) / (2 * pHSigma * pHSigma));
}

/**
 * Denaturation factor amilasi da esposizione a pH sub-ottimale (irreversibile) — §2.8.2
 * denat = 1.0 se pH ≥ 5.5 ; altrimenti max(0.92, 1 − 0.003 × durationH)
 * @param {object} prefermento — deve avere state.pH e durationH
 */
function computeDenaturationFactor(prefermento) {
  const { pHStressThreshold, durationDecayRate, floorFactor } = AMYLASE_DENATURATION_PARAMS;
  const pH      = prefermento?.state?.pH ?? 6.0;
  const durH    = prefermento?.durationH ?? 0;
  if (pH >= pHStressThreshold) return 1.0;
  return Math.max(floorFactor, 1.0 - durationDecayRate * durH);
}

/**
 * Correzione amilasica sul tasso fermentativo — §3 (v2.3.2)
 *
 * effectiveActivity = amylaseIndex × f_pH_amylase(currentPH)
 * correction = 1.0 + rateScale × (effectiveActivity − 1.0)
 * result = baseRate × max(rateFloor, correction)
 *
 * Composizione: capacity (denaturation-corrected, statico) × modulazione pH (dinamica)
 */
function amylaseCorrectedRate(baseRate, amylaseIndex, elapsedH, currentPH) {
  const fPH_             = fPHAmylase(currentPH);
  const effectiveActivity = amylaseIndex * fPH_;
  const { rateScale, rateFloor } = AMYLASE_CORRECTION_PARAMS;
  const correction = 1.0 + rateScale * (effectiveActivity - 1.0);
  return baseRate * Math.max(rateFloor, correction);
}

// ═══════════════════════════════════════════════════════════════
// § H — FLOUR BLEND (v2.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Calcola amylase_index blend da array di farine — §2.13
 * amylase_blend = Σ(pct_i/100 × normalizeAmylaseActivity(FN_i))
 */
function blendAmylaseIndex(flours) {
  return flours.reduce((acc, f) => {
    return acc + (f.percentage / 100) * normalizeAmylaseActivity(f.FN);
  }, 0);
}

/**
 * Valida e normalizza un FlourGroup — §2.13 + §5.6
 * Restituisce { ok, warnings, errors }
 */
function validateFlourGroup(flours) {
  const errors   = [];
  const warnings = [];

  if (!Array.isArray(flours) || flours.length < 1 || flours.length > 3) {
    errors.push('INVALID_FLOUR_COUNT: 1–3 farine richieste');
  }

  const sum = flours.reduce((a, f) => a + (f.percentage ?? 0), 0);
  if (Math.abs(sum - 100) > 0.01) {
    errors.push(`INVALID_PERCENTAGE_SUM: Σ = ${sum.toFixed(2)}% (atteso 100%)`);
  }

  const Ws = flours.map(f => f.W ?? 0);
  const spread = Math.max(...Ws) - Math.min(...Ws);
  if (spread > EXTREME_W_SPREAD) {
    warnings.push(`EXTREME_W_SPREAD: spread W = ${spread} (soglia ${EXTREME_W_SPREAD})`);
  }

  for (const f of flours) {
    if (f.W < 80 || f.W > 500) errors.push(`W fuori range [80–500]: ${f.W}`);
    if (f.pl < 0.2 || f.pl > 1.2) errors.push(`P/L fuori range [0.2–1.2]: ${f.pl}`);
    if (f.protein < 7 || f.protein > 17) errors.push(`protein fuori range [7–17]: ${f.protein}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Normalizza un FlourGroup calcolando i valori effettivi — §2.13
 * v2.4.0: effectiveW usa computeWBlendNonLinear (blend non-lineare)
 * effectiveAsh SEMPRE popolato con DEFAULT_ASH se assente
 */
function normalizeFlourGroup(flours) {
  const effectiveW        = computeWBlendNonLinear(flours);  // v2.4.0 non-lineare
  const effectivePl       = flours.reduce((a, f) => a + (f.percentage / 100) * f.pl, 0);
  const effectiveProtein  = flours.reduce((a, f) => a + (f.percentage / 100) * f.protein, 0);
  const effectiveAsh      = flours.reduce((a, f) => a + (f.percentage / 100) * (f.ash ?? DEFAULT_ASH), 0);
  const effectiveAmylaseIndex = blendAmylaseIndex(flours);
  const isBlend           = flours.length > 1;

  const Ws     = flours.map(f => f.W);
  const spread = Math.max(...Ws) - Math.min(...Ws);
  const blendNote = isBlend && spread > EXTREME_W_SPREAD
    ? `W spread elevato: ${spread} (> ${EXTREME_W_SPREAD})`
    : undefined;

  return {
    flours,
    effectiveW,
    effectivePl,
    effectiveProtein,
    effectiveAsh,
    effectiveAmylaseIndex,
    isBlend,
    blendNote,
  };
}

// ═══════════════════════════════════════════════════════════════
// § I — PREFERMENTI (v2.2–v2.3.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Calcola stato autolisi — §2.11
 * Restituisce { W_decayed, pl_modified, pH, amylase_index, ready }
 * Nota: W decay è trascurabile nelle durate operative (< 0.1%)
 */
function computeAutolysis({ flourGroup, durationH, tempC, hydration, flourFraction }) {
  const W0    = flourGroup.effectiveW;
  const pl0   = flourGroup.effectivePl;
  const pHEff = AUTOLYSIS_CALIBRATION.pHEffective;  // 6.0

  // t_crit per autolisi (pH 6.0, condizioni date)
  const tCritAut = computeTCrit(W0, tempC, pHEff, hydration);
  const W_decayed = computeWHill(W0, tCritAut, durationH);

  // P/L improvement: pl_post = pl_init × (0.7 + 0.3 × exp(-t/2.5))
  const { plDecayAsymptote, plDecayTau } = AUTOLYSIS_CALIBRATION;
  const plFactor   = plDecayAsymptote + (1 - plDecayAsymptote) * safeExp(-durationH / plDecayTau);
  const pl_modified = pl0 * plFactor;

  return {
    W_decayed,
    pl_modified,
    pH:           pHEff,
    amylase_index: flourGroup.effectiveAmylaseIndex,
    maturationPct: 0,
    ready:        true,
  };
}

/**
 * Valida mix prefermenti — §2.12
 * Restituisce { ok, errors, warnings }
 */
function validatePrefermentiMix(prefermenti, mainFlourFraction) {
  const errors   = [];
  const warnings = [];

  if (prefermenti.length > 2) {
    errors.push('TOO_MANY_PREFERMENTI: max 2 prefermenti');
    return { ok: false, errors, warnings };
  }

  const totalFraction = prefermenti.reduce((a, p) => a + (p.flourFraction ?? 0), 0);
  if (totalFraction > 100 + 0.01) {
    errors.push(`INVALID_FRACTION_SUM: Σ = ${totalFraction.toFixed(1)}% (max 100%)`);
  }

  const hasBiological = prefermenti.some(p => p.type !== 'autolysis');
  if (hasBiological && (mainFlourFraction ?? (100 - totalFraction)) < 10) {
    errors.push('MISSING_RINFRESCO_BIOLOGICAL: rinfresco minimo 10% con prefermento biologico');
  }

  for (const p of prefermenti) {
    if (!p.state) {
      errors.push(`MISSING_PREFERMENTO_STATE: stato mancante per prefermento id=${p.id}`);
    }
  }

  // Warning duplicato biologico
  const bioTypes = prefermenti.filter(p => p.type !== 'autolysis').map(p => p.type);
  if (bioTypes.length === 2 && bioTypes[0] === bioTypes[1]) {
    warnings.push(`DUPLICATE_BIOLOGICAL_TYPE: due prefermenti dello stesso tipo (${bioTypes[0]})`);
  }

  // Warning solo autolisi
  const onlyAutolysis = prefermenti.length > 0 && prefermenti.every(p => p.type === 'autolysis');
  if (onlyAutolysis) {
    warnings.push('ONLY_AUTOLYSIS: nessun prefermento biologico presente');
  }

  // Warning rinfresco basso
  const rinfrescoFrac = 100 - totalFraction;
  if (hasBiological && rinfrescoFrac < 20) {
    warnings.push(`LOW_RINFRESCO: rinfresco = ${rinfrescoFrac.toFixed(1)}% (consigliato ≥ 20%)`);
  }

  // ── Vincoli biochimici per tipo (KB §5.7) ───────────────────────────────────
  for (const p of prefermenti) {
    if (p.type === 'biga') {
      if (p.hydration != null && (p.hydration < 40 || p.hydration > 55)) {
        errors.push(`BIGA_HYDRATION_OUT_OF_RANGE: id=${p.id} hyd=${p.hydration}% (atteso [40, 55])`);
      }
      if (p.yeastPct != null && (p.yeastPct < 0.05 || p.yeastPct > 2.0)) {
        errors.push(`BIGA_YEAST_OUT_OF_RANGE: id=${p.id} yeast=${p.yeastPct}% (atteso [0.05, 2.0])`);
      }
    } else if (p.type === 'poolish') {
      if (p.hydration != null && Math.abs(p.hydration - 100) > 5) {
        warnings.push(`POOLISH_HYDRATION_NONSTANDARD: id=${p.id} hyd=${p.hydration}% (atteso ≈100)`);
      }
      if (p.yeastPct != null && (p.yeastPct < 0.05 || p.yeastPct > 1.0)) {
        errors.push(`POOLISH_YEAST_OUT_OF_RANGE: id=${p.id} yeast=${p.yeastPct}% (atteso [0.05, 1.0])`);
      }
    } else if (p.type === 'autolysis') {
      if (p.durationH != null && (p.durationH < 0.33 || p.durationH > 24)) {
        errors.push(`AUTOLYSIS_DURATION_OUT_OF_RANGE: id=${p.id} dur=${p.durationH}h (atteso [0.33, 24])`);
      }
      if (p.tempC != null && (p.tempC < 4 || p.tempC > 35)) {
        errors.push(`AUTOLYSIS_TEMP_OUT_OF_RANGE: id=${p.id} T=${p.tempC}°C (atteso [4, 35])`);
      }
      if (p.hydration != null && (p.hydration < 50 || p.hydration > 80)) {
        errors.push(`AUTOLYSIS_HYDRATION_OUT_OF_RANGE: id=${p.id} hyd=${p.hydration}% (atteso [50, 80])`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Calcola la frazione rinfresco — §2.12
 * frac_r = 1 - Σ(frac_i)
 */
function computeRinfrescoFraction(prefermenti) {
  const total = prefermenti.reduce((a, p) => a + (p.flourFraction ?? 0), 0);
  return safeClamp(1 - total / 100, 0, 1);
}

/**
 * Stato combinato impasto finale con mix prefermenti — §2.12 (v2.3.2)
 * Spec completa §3 KB: interfaccia CombinedInitialState
 *
 * Ritorna:
 *  effectiveW_initial, effectivePl_initial, effectiveProtein, effectiveAsh
 *  effectiveAmylaseIndex, initialMaturationOffset [0,1], initialPH
 *  rinfrescoFraction, breakdown
 */
function computeCombinedInitialState({ prefermenti, mainFlourGroup, waterHardnessPpm = 150 }) {
  // Durezza acqua trasla W₀ operativo: ioni Ca²⁺/Mg²⁺ irrigidiscono il glutine
  // iniziale (non solo rallentano il decay). ppm=150 → 1.0 (nessun effetto). — v2.4.14 §2.17.1
  const fHardGluten = fHardnessGluten(waterHardnessPpm);
  if (!prefermenti || prefermenti.length === 0) {
    // Solo rinfresco
    return {
      effectiveW_initial:      mainFlourGroup.effectiveW * fHardGluten,
      effectivePl_initial:     mainFlourGroup.effectivePl,
      effectiveProtein:        mainFlourGroup.effectiveProtein,
      effectiveAsh:            mainFlourGroup.effectiveAsh,
      effectiveAmylaseIndex:   mainFlourGroup.effectiveAmylaseIndex,
      initialMaturationOffset: 0,
      initialPH:               6.0,
      rinfrescoFraction:       1.0,
      breakdown: {
        prefermenti: [],
        rinfresco: {
          fraction:        1.0,
          W_contrib:       mainFlourGroup.effectiveW,
          pl_contrib:      mainFlourGroup.effectivePl,
          protein_contrib: mainFlourGroup.effectiveProtein,
          ash_contrib:     mainFlourGroup.effectiveAsh,
          amylase_contrib: mainFlourGroup.effectiveAmylaseIndex,
          pH:              6.0,
        }
      }
    };
  }

  // Frazioni decimali
  const fracs = prefermenti.map(p => (p.flourFraction ?? 0) / 100);
  const frac_r = safeClamp(1 - fracs.reduce((a, x) => a + x, 0), 0, 1);

  // Valori effettivi combinati
  let effectiveW         = 0;
  let effectivePl        = 0;
  let effectiveProtein   = 0;
  let effectiveAsh       = 0;
  let effectiveAmylase   = 0;
  let matOffsetSum       = 0;  // Σ frac_i × mat_i/100 (solo biologici)
  let H_plus             = 0;  // per pH logaritmico

  const breakdownPrefermenti = prefermenti.map((p, i) => {
    const frac = fracs[i];
    const s    = p.state;
    const fg   = p.flourGroup;
    const denat = computeDenaturationFactor(p);

    const W_c      = frac * (s?.W_decayed ?? fg.effectiveW);
    const pl_c     = frac * (s?.pl_modified ?? fg.effectivePl);
    const prot_c   = frac * fg.effectiveProtein;
    const ash_c    = frac * (fg.effectiveAsh ?? DEFAULT_ASH);
    const amyl_c   = frac * (s?.amylase_index ?? fg.effectiveAmylaseIndex) * denat;
    const mat_c    = p.type !== 'autolysis' ? frac * (s?.maturationPct ?? 0) / 100 : 0;
    const pH_i     = p.type === 'autolysis' ? 6.0 : (s?.pH ?? 6.0);

    effectiveW       += W_c;
    effectivePl      += pl_c;
    effectiveProtein += prot_c;
    effectiveAsh     += ash_c;
    effectiveAmylase += amyl_c;
    matOffsetSum     += mat_c;
    H_plus           += frac * Math.pow(10, -pH_i);

    return {
      id:                  p.id ?? `pref_${i}`,
      type:                p.type,
      fraction:            frac,
      W_contrib:           W_c,
      pl_contrib:          pl_c,
      protein_contrib:     prot_c,
      ash_contrib:         ash_c,
      amylase_contrib:     amyl_c,
      denaturation_factor: denat,
      mat_contrib:         mat_c,
      pH:                  pH_i,
    };
  });

  // Contributo rinfresco
  const rW      = frac_r * mainFlourGroup.effectiveW;
  const rPl     = frac_r * mainFlourGroup.effectivePl;
  const rProt   = frac_r * mainFlourGroup.effectiveProtein;
  const rAsh    = frac_r * (mainFlourGroup.effectiveAsh ?? DEFAULT_ASH);
  const rAmyl   = frac_r * mainFlourGroup.effectiveAmylaseIndex;

  effectiveW       += rW;
  effectivePl      += rPl;
  effectiveProtein += rProt;
  effectiveAsh     += rAsh;
  effectiveAmylase += rAmyl;
  H_plus           += frac_r * Math.pow(10, -6.0);  // rinfresco pH 6.0

  // pH combinato logaritmico (§2.12 — v2.3.2 fix #42)
  const initialPH = H_plus > 0 ? -Math.log10(H_plus) : 6.0;

  return {
    effectiveW_initial:      effectiveW * fHardGluten,
    effectivePl_initial:     effectivePl,
    effectiveProtein,
    effectiveAsh,
    effectiveAmylaseIndex:   effectiveAmylase,
    initialMaturationOffset: safeClamp(matOffsetSum, 0, 1),
    initialPH,
    rinfrescoFraction:       frac_r,
    breakdown: {
      prefermenti: breakdownPrefermenti,
      rinfresco: {
        fraction:        frac_r,
        W_contrib:       rW,
        pl_contrib:      rPl,
        protein_contrib: rProt,
        ash_contrib:     rAsh,
        amylase_contrib: rAmyl,
        pH:              6.0,
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// § J — LM DUAL-POPULATION + FRICTION (v2.0)
// ═══════════════════════════════════════════════════════════════

// ─── Dual-population v2.0 — RIMOSSA (issue #18) ─────────────────────────────
//
// computeLMState(), estimatePH() e phInhibition() erano il modello dual-pop
// della v2.0. Mai chiamate da src/, ma esportate — e non funzionanti:
//
// 1. SCALA INCOMPATIBILE. computeLMState usava LM_PARAMS invece di
//    AGENT_GOMPERTZ. Con muMax = 0.25 × matrixFactor 0.6 = 0.15 servivano
//    693 ADU per l'85 % — 29 giorni a 25 °C, contro le 18.3 h che dà
//    AGENT_GOMPERTZ.sourdough_wheat (muMax 7.0, lambda 3.5), realmente in uso.
//
// 2. FEEDBACK pH INERTE PER COSTRUZIONE. La riga
//        const pHCurrent = estimatePH(initialPH, sacMat, elapsedH);
//    passava la maturazione dei SACCAROMICETI al parametro che estimatePH
//    chiama labMatPct; estimatePH cappava il calo a 0.08 pH e ignorava del
//    tutto elapsedH. Risultato: phInhibition restituiva sempre 1.0 e
//    l'inibizione acida non si attivava mai.
//
// La cinetica LM reale passa da computeLabAdu() + computeCurrentPH() (v2.4.14
// §2.6), che modellano i LAB con CTM × Arrhenius e autoinibizione progressiva.
// Nota: quel modello è a sua volta sotto-calibrato di ~1 unità di pH — issue #9.

// ─── Attrito meccanico e DDT — RIMOSSI in questo modulo (issue #17) ──────────
//
// FRICTION_BASE_FACTORS, computeFrictionHeat() e computeWaterTemp() vivevano qui
// come seconda implementazione del bilancio termico dell'acqua, mai chiamata da
// src/ ma esportata — e SBAGLIATA: computeWaterTemp sottraeva il ΔT grezzo invece
// del fattore di attrito N × ΔT che la formula di Calvel richiede.
//
// Divergenza misurata (DDT 24 °C, farina 20 °C, ambiente 22 °C, spirale 12 min, H 62 %):
//   computeWaterTemp        → 26.81 °C
//   computeWaterTempDDT     → 19.00 °C     ← corretta
//   7.81 °C sull'acqua ≈ 2.6 °C sulla DDT.
//
// Sorgenti di verità uniche, da usare al loro posto:
//   • bilancio DDT / ghiaccio  → computeWaterTempDDT()  in src/engine/index.ts
//   • salita termica da attrito → computeFrictionRise() in engine/friction-v2.4.24.js
//     (FRICTION_PARAMS, già dichiarata "sorgente unica di verità" §2.7 in v2.4.24)

// ═══════════════════════════════════════════════════════════════
// § K — SWEET SPOT + TICK LOOP + DASHBOARD (v2.3.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Delta ADU per un tick di temperatura — §3
 * deltaAdu = correctedRate × kRatioNorm × deltaTHours
 * Include correzione amilasica e (v2.4.0) correzione sale
 */
function computeDeltaAdu({
  tempAmbient,
  tempDoughLast,
  eaKj,
  agentType,
  amylaseIndex,
  elapsedH,
  currentPH,
  deltaTSeconds,
  saltPct = 0,         // v2.4.0
}) {
  const T         = tempDoughLast ?? tempAmbient;
  const deltaTH   = deltaTSeconds / 3600;

  // k_effective base
  const baseRate  = kEffective(T, eaKj, agentType);
  // Correzione amilasica
  const corrRate  = amylaseCorrectedRate(baseRate, amylaseIndex, elapsedH, currentPH);
  // v2.4.0: inibizione osmotica sale
  const saltFact  = fSaltYeast(saltPct);
  // kRatio (normalizzato su 25°C)
  const kRef      = kEffective(25, eaKj, agentType);
  const kRatioVal = kRef > 1e-12 ? corrRate / kRef : 0;

  return kRatioVal * saltFact * deltaTH;
}

/**
 * Sweet spot: ora ottimale di cottura — §3
 * Trova il tempo (da adesso) in cui la maturazione sarà al peak
 */
function sweetSpot(session, currentAdu, currentTempC) {
  const { agentMuMax, agentLambda, agentAsymptote: A = 100 } = session;
  const peakPct = session.alertThreshold ?? getStyleProfile(session.style).alertThreshold;
  const aduAtPeak = findAduAt(agentMuMax, agentLambda, A, peakPct);
  if (aduAtPeak <= currentAdu) {
    return { status: 'past_peak', hoursUntilPeak: 0, peakPct };
  }
  // Stima ore rimanenti con temperatura costante
  const deltaAduNeeded = aduAtPeak - currentAdu;
  const rateAtT = kRatio(currentTempC, session.agentEaKj, session.agentType);
  const hoursUntilPeak = rateAtT > 0 ? deltaAduNeeded / rateAtT : 999;
  return { status: 'upcoming', hoursUntilPeak, peakPct };
}

/**
 * Sweet spot MATURAZIONE — ETA al picco sull'orologio ENZIMATICO (two-clock v2.4.1)
 *
 * A differenza di sweetSpot() — che usa l'orologio LIEVITO (kRatio cardinale, ~0 a
 * T<Tmin) e quindi a 4°C dà ETA assurde (~1330h) — questo usa la cinetica della
 * proteolisi (fArrhenius, Ea=47, SENZA correzione cardinale): la maturazione resta
 * attiva al freddo. Sanity di validazione KB: 85% ≈ 48h @ 4°C costante partendo da 0.
 *
 * L'ETA del target di cottura (la maturazione enzimatica al peak) DEVE usare questa
 * funzione, non sweetSpot(), che resta per stime legate alla lievitazione del gas.
 *
 * @param {object} session       — usa alertThreshold come peakPct (default 85)
 * @param {number} currentEnzAdu — ADU enzimatico cumulato corrente (ts.enzymaticAdu)
 * @param {number} currentTempC  — temperatura corrente [°C] per la proiezione a T costante
 * @returns {{ status: 'upcoming'|'past_peak', hoursUntilPeak: number, peakPct: number }}
 */
function sweetSpotMaturation(session, currentEnzAdu, currentTempC) {
  const { muMax, lambda } = ENZYMATIC_CLOCK_PARAMS;
  const peakPct   = session.alertThreshold ?? getStyleProfile(session.style).alertThreshold;
  const aduAtPeak = findAduAt(muMax, lambda, 100, peakPct);
  const enzNow    = currentEnzAdu ?? 0;
  if (aduAtPeak <= enzNow) {
    return { status: 'past_peak', hoursUntilPeak: 0, peakPct };
  }
  // fArrhenius(T) = ADU enzimatico accumulato per ora a temperatura costante T.
  const rateAtT = fArrhenius(currentTempC);
  const hoursUntilPeak = rateAtT > 1e-9 ? (aduAtPeak - enzNow) / rateAtT : 999;
  return { status: 'upcoming', hoursUntilPeak, peakPct };
}

/** Helper: stima pH corrente per agenti non-LM */
function _estimateCurrentPH(session, currentAdu) {
  if (session.latestProcessEntry?.estimatedPH != null) {
    return session.latestProcessEntry.estimatedPH;
  }
  const matPct  = gompertz(currentAdu, session.agentMuMax, session.agentLambda, session.agentAsymptote ?? 100);
  const pH_drop = 0.0015 * matPct;
  return Math.max(4.8, (session.initialPH ?? 5.8) - pH_drop);
}

/** Helper: costruisce breakdown W per la dashboard */
function _buildWBreakdown(session) {
  const bd = session.combinedInitialState?.breakdown;
  if (!bd) {
    return {
      prefermenti: [],
      rinfresco: { fraction: 1, W_initial: session.effectiveW_initial },
    };
  }
  return {
    prefermenti: bd.prefermenti.map(p => ({
      id:        p.id,
      type:      p.type,
      fraction:  p.fraction,
      W_initial: p.fraction > 0 ? p.W_contrib / p.fraction : 0,
      label:     `${p.type.charAt(0).toUpperCase() + p.type.slice(1)} ${Math.round(p.fraction * 100)}%`,
    })),
    rinfresco: {
      fraction:  bd.rinfresco.fraction,
      W_initial: bd.rinfresco.fraction > 0
        ? bd.rinfresco.W_contrib / bd.rinfresco.fraction
        : session.effectiveW_initial,
    }
  };
}

/**
 * W corrente per la dashboard — §3 (v2.3.2)
 * Spec interfaccia: DashboardWResult
 */
function computeDashboardEffectiveW(session, currentAdu, currentTempC, currentPH) {
  const W_initial   = session.effectiveW_initial;
  const pH_current  = currentPH != null ? currentPH : _estimateCurrentPH(session, currentAdu);
  const H           = session.hydration;
  const elapsedH    = session.startedAt
    ? (Date.now() - new Date(session.startedAt).getTime()) / 3_600_000
    : 0;

  // t_crit nelle condizioni correnti
  // v2.4.0: modulato anche per sale e durezza acqua
  const saltFact = session.salt ? fSaltProtease(session.salt) : 1.0;
  const hardFact = session.waterHardnessPpm != null
    ? fHardnessProtease(session.waterHardnessPpm)
    : 1.0;

  const tCritBase = computeTCrit(W_initial, currentTempC, pH_current, H);
  // Sale rallenta proteolisi → t_crit più alto → divide per fSaltProtease (<1)
  // Durezza rallenta proteolisi → idem
  const tCritH = tCritBase / (saltFact * hardFact);

  const W_current = computeWHill(W_initial, tCritH, elapsedH, HILL_W_DECAY.hillExponent);
  const decayPct  = ((W_initial - W_current) / W_initial) * 100;
  const tRatio    = elapsedH / tCritH;

  const status = structuralState(W_initial, W_current);
  const breakdown = _buildWBreakdown(session);

  return {
    W_current,
    W_initial,
    decayPct,
    tRatio,
    tCritHours:      tCritH,
    structuralStatus: status,
    breakdown,
  };
}

// ─── Backward compat (deprecato v2.3) ───────────────────────────
function computeKprot(W, T, pH, H) { return 1 / computeTCrit(W, T, pH, H); }
function computeWEffectiveExp(W0, kprot, hours) { return W0 * Math.exp(-kprot * hours); }

// ═══════════════════════════════════════════════════════════════
// § L — v2.4.0 SALT INHIBITION (§2.14.2)
// IMPLEMENTATO v2.4.17: solver + tick real-time, parità garantita.
// fSaltYeast: leavAdu (computeDeltaAdu + tick loop).
// fSaltProtease: t_crit (computeDashboardEffectiveW + damage integral tick).
// enzAdu invariante — non modulato dal sale (invariante §2.0 Two-Clock).
// ═══════════════════════════════════════════════════════════════

/**
 * Inibizione osmotica sale sui lieviti — §2.14.2
 * f_salt_yeast(s) = max(0.60, 1.0 − 0.10 × s)
 * s = % sale su farina (baker's %)
 *
 * s=0 → 1.000 | s=2 → 0.800 | s=3 → 0.700
 */
function fSaltYeast(saltPct) {
  const { yeastKSalt, yeastFloor } = SALT_INHIBITION_PARAMS;
  return Math.max(yeastFloor, 1.0 - yeastKSalt * saltPct);
}

/**
 * Inibizione osmotica sale sulle proteasi — §2.14.2
 * f_salt_protease(s) = max(0.70, 1.0 − 0.08 × s)
 * Sale rallenta proteolisi → t_crit più alto → W decade più lentamente
 *
 * s=0 → 1.000 | s=2 → 0.840 | s=3 → 0.760
 */
function fSaltProtease(saltPct) {
  const { proteaseKSalt, proteaseFloor } = SALT_INHIBITION_PARAMS;
  return Math.max(proteaseFloor, 1.0 - proteaseKSalt * saltPct);
}

// ═══════════════════════════════════════════════════════════════
// § M — v2.4.0 BLEND W NON-LINEARE (§2.14.1)
// ═══════════════════════════════════════════════════════════════

/**
 * W effettivo blend con correzione reologica non-lineare — §2.14.1
 *
 * Proteine LMW (farine deboli) competono stericamente con HMW (farine forti)
 * abbassando il W reale rispetto alla media lineare.
 *
 * W_effective = W_linear × f_nonlinear(spread)
 * f_nonlinear(spread) = 1.0 − k × max(0, spread − 75)
 * k = W_BLEND_NONLINEAR_K = 0.0003 (da calibrare su alveografo — §10)
 *
 * Per spread < 75: f ≈ 1.0 (correzione trascurabile)
 * Per spread = 150: f = 0.9775 → −2.25%
 * Per spread = 200: f = 0.9625 → −3.75%
 */
function computeWBlendNonLinear(flours) {
  if (!Array.isArray(flours) || flours.length === 0) return 0;
  if (flours.length === 1) return flours[0].W;

  const W_linear = flours.reduce((a, f) => a + (f.percentage / 100) * f.W, 0);
  const Ws       = flours.map(f => f.W);
  const spread   = Math.max(...Ws) - Math.min(...Ws);

  // Soglia attivazione correzione = EXTREME_W_SPREAD / 2 = 75
  const threshold = EXTREME_W_SPREAD / 2;
  const f_nonlinear = 1.0 - W_BLEND_NONLINEAR_K * Math.max(0, spread - threshold);

  return W_linear * f_nonlinear;
}

// ═══════════════════════════════════════════════════════════════
// § N — v2.4.0 INERZIA TERMICA BIFASE (§2.14.4)
// ═══════════════════════════════════════════════════════════════

/**
 * Massa d'impasto corrente in base alla fase — §2.14.4
 * Puntata  → massa totale
 * Staglio/appreto → massa singolo panetto = M_total / numPanetti
 *
 * τ ∝ M^(1/3): un panetto da 250g si equilibra 2–4× più velocemente
 * di una massa da 1500g.
 */
function currentDoughMassKg(session, currentPhase) {
  const totalMass = ((session.totalFlourGrams ?? 1000) * (1 + (session.hydration ?? 65) / 100)) / 1000;
  const bulkPhases = ['bulk_room', 'bulk_fridge'];
  if (bulkPhases.includes(currentPhase)) {
    return totalMass;          // puntata — massa unica
  }
  // staglio / appreto / proofing / baking → panetti
  const nBalls = Math.max(1, session.numPanetti ?? 1);
  return totalMass / nBalls;
}

/**
 * τ_intrinsic per geometria sferica (panetti) — §2.14.4
 * V = massKg / ρ
 * r = cbrt(3V / 4π)
 * A = 4πr²  (sfera intera esposta)
 * τ = (m × cp) / (H_AIR × A)  [secondi]
 *
 * Diverso da thermalTimeConstant() che usa cilindro piatto (puntata).
 * Usare questa funzione per la fase appreto/staglio.
 */
function thermalTimeConstantSphere(massKg, hydrationPct) {
  const cp = doughSpecificHeat(hydrationPct);
  const V  = massKg / RHO_DOUGH;
  const r  = Math.cbrt((3 * V) / (4 * Math.PI));
  const A  = 4 * Math.PI * r * r;
  return (massKg * cp) / (H_AIR * A);  // secondi
}

/**
 * Sceglie il modello geometrico termico corretto per la fase e applica la
 * resistenza del contenitore — v2.4.14 §2.14.4. Astrazione unica per evitare
 * divergenze tra simulateTimeline, tick loop e transizioni di fase.
 *
 * Assunzione: la geometria dipende dalla fase (bulk=cilindro, balled/proofing=sfera),
 * non dalla configurazione fisica reale.
 *
 * @returns {number} τ_total in secondi
 */
function thermalTimeConstantForPhase(phase, massKg, hydration, containerPreset) {
  const isBalled = phase === 'balled_room' || phase === 'balled_fridge' || phase === 'proofing';
  const tauIntrinsic = isBalled
    ? thermalTimeConstantSphere(massKg, hydration)
    : thermalTimeConstant(massKg, hydration);
  return applyContainerResistance(tauIntrinsic, containerPreset);
}

// ═══════════════════════════════════════════════════════════════
// § O — v2.4.0 MALTO DIASTATICO (§2.15)
// ═══════════════════════════════════════════════════════════════

/**
 * Contributo amilasico del malto diastatico — §2.15.1
 *
 * amylase_index_malt = (maltDosePct / 100)
 *                    × (maltDP / MALT_PARAMS.refDPLintner)
 *                    × MALT_PARAMS.maltAmylaseScale
 *
 * La scala NON è ripetuta qui come numero: vive solo in MALT_PARAMS, che ne
 * documenta la calibrazione. (Il JSDoc riportava `× 1.2`, valore pre-v2.4.0
 * rimasto indietro rispetto a maltAmylaseScale = 60 — fattore 50×.)
 *
 * maltDosePct: % su farina [0–1%]
 * maltDP:      potere diastatico in °Lintner (default MALT_PARAMS.refDPLintner)
 *
 * Nota: se il malto è aggiunto a un prefermento a pH < 5.5, applicare
 * computeDenaturationFactor() sul contributo (stessa logica §2.8.2)
 */
function computeMaltAmylaseContrib(maltDosePct, maltDP = MALT_PARAMS.refDPLintner) {
  const { refDPLintner, maltAmylaseScale } = MALT_PARAMS;
  return (maltDosePct / 100) * (maltDP / refDPLintner) * maltAmylaseScale;
}

/**
 * Indice amilasico totale (farina + malto) — §2.15.1
 */
function computeTotalAmylaseIndex(flourAmylaseIndex, maltContrib) {
  return flourAmylaseIndex + maltContrib;
}

/**
 * Livello di alert per destrinizzazione — §2.15.2
 * Thresholds: 1.50 ADVISORY / 1.80 CRITICAL / 2.00 BLOCKED
 *
 * Restituisce 'OK' | 'ADVISORY' | 'CRITICAL' | 'BLOCKED'
 */
function maltAlertLevel(totalAmylaseIndex) {
  const { alertAdvisory, alertCritical, maxSafeIndex } = MALT_PARAMS;
  if (totalAmylaseIndex > maxSafeIndex)   return 'BLOCKED';
  if (totalAmylaseIndex > alertCritical)  return 'CRITICAL';
  if (totalAmylaseIndex > alertAdvisory)  return 'ADVISORY';
  return 'OK';
}

// ═══════════════════════════════════════════════════════════════
// § P — v2.4.0 COMPENSAZIONE ALTITUDINE (§2.16)
// ═══════════════════════════════════════════════════════════════

/**
 * Fattore di espansione CO₂ in quota — §2.16.1
 * P(altitude) = P0 × exp(−altitude / H_scale)
 * altitudeFactor = P0 / P(altitude) = exp(altitude / 8500)
 *
 * altitudeFactor > 1 in quota: CO₂ si espande di più
 * 0m → 1.000 | 500m → 1.060 | 1000m → 1.122 | 2000m → 1.259
 */
function computeAltitudeFactor(altitudeM) {
  const { P0_Pa, scaleHeightM } = ALTITUDE_PARAMS;
  const P = P0_Pa * safeExp(-altitudeM / scaleHeightM);
  return safeDiv(P0_Pa, P, 1.0);
}

/**
 * Correzione milestone volume osservato — §2.16.2
 * Per raggiungere il volume apparente targetVolumeFactor in quota,
 * la maturazione biologica reale necessaria è ridotta.
 *
 * volumeApparente = volumeReale × altitudeFactor
 * → Per osservare "raddoppio" (×2) a 1000m, la fermentazione reale
 *   ha prodotto solo 2/1.122 ≈ 1.78× di gas biologico.
 *
 * correctedTarget = targetVolumeFactor / altitudeFactor
 */
function volumeMilestoneCorrection(targetVolumeFactor, altitudeM) {
  const af = computeAltitudeFactor(altitudeM);
  return safeDiv(targetVolumeFactor, af, targetVolumeFactor);
}

// ═══════════════════════════════════════════════════════════════
// § Q — v2.4.0 DUREZZA ACQUA (§2.17)
// ═══════════════════════════════════════════════════════════════

/**
 * Correzione glutinica per durezza acqua — §2.17.1
 * Ioni Ca²⁺ rinforzano il network glutinico
 *
 * f_hardness_gluten(ppm) = 1.0 + 0.0008 × (ppm − 150)
 * f_hard(50)  ≈ 0.920 | f_hard(150) = 1.000 | f_hard(300) ≈ 1.120
 *
 * Applica come: W_effective_corr = W_blend × fHardnessGluten(ppm)
 */
function fHardnessGluten(ppm) {
  const { refPpm, glutenKHard } = WATER_HARDNESS_PARAMS;
  // ppm=150 → 1.0 (reference); clamp [0.85, 1.25] — v2.4.14 §2.17.1
  const factor = 1.0 + glutenKHard * (ppm - refPpm);
  return Math.max(0.85, Math.min(1.25, factor));
}

/**
 * Correzione proteolitica per durezza acqua — §2.17.1
 * Ca²⁺ riduce attività proteasi (inibizione competitiva)
 *
 * f_hardness_protease(ppm) = 1.0 − 0.0004 × (ppm − 150)
 * Acqua dura rallenta proteolisi → t_crit più alto
 * f_prot(50) ≈ 1.040 | f_prot(150) = 1.000 | f_prot(300) ≈ 0.940
 *
 * Applica come: t_crit_corr = t_crit / fHardnessProtease(ppm)
 */
function fHardnessProtease(ppm) {
  const { refPpm, proteaseKHard } = WATER_HARDNESS_PARAMS;
  return 1.0 - proteaseKHard * (ppm - refPpm);
}

// ═══════════════════════════════════════════════════════════════
// § R — v2.4.0 REVERSE SCALING DINAMICO (§2.18)
// ═══════════════════════════════════════════════════════════════

/**
 * Reverse scaling: dato prefermento disponibile, calcola impasto producibile — §2.18
 *
 * Caso d'uso: il pizzaiolo ha X kg di biga avanzata e vuole sapere
 * quante pizze può fare e quanto rinfresco preparare.
 *
 * Input:
 *   availablePrefermKg   — kg di prefermento già pronto
 *   prefermType          — 'poolish' | 'biga'
 *   targetFlourFraction  — % del prefermento sul totale farina [%]
 *   targetHydration      — idratazione finale target [%]
 *   targetPanWeightG     — peso panetto desiderato [g] (input utente)
 *
 * Output:
 *   totalFlourKg         — farina totale dell'impasto finale
 *   rinfrescoFlourKg     — farina del rinfresco da preparare
 *   rinfrescoWaterKg     — acqua del rinfresco
 *   totalDoughKg         — peso impasto finale totale
 *   numPanetti           — numero di panetti producibili
 *   panWeight            — peso panetto (echo dell'input)
 */
function computeReverseScaling({
  availablePrefermKg,
  prefermType,
  targetFlourFraction,
  targetHydration,
  targetPanWeightG,
}) {
  if (availablePrefermKg <= 0) throw new Error('availablePrefermKg deve essere > 0');
  if (targetFlourFraction <= 0 || targetFlourFraction >= 100) {
    throw new Error('targetFlourFraction deve essere in [1, 99]');
  }
  if (targetPanWeightG <= 0) throw new Error('targetPanWeightG deve essere > 0');

  const frac           = targetFlourFraction / 100;
  const totalFlourKg   = availablePrefermKg / frac;
  const rinfrescoFrac  = 1 - frac;
  const rinfrescoFlourKg = totalFlourKg * rinfrescoFrac;
  const rinfrescoWaterKg = rinfrescoFlourKg * (targetHydration / 100);
  const totalDoughKg   = totalFlourKg * (1 + targetHydration / 100);
  const numPanetti     = Math.round(totalDoughKg / (targetPanWeightG / 1000));

  return {
    totalFlourKg:      +totalFlourKg.toFixed(3),
    rinfrescoFlourKg:  +rinfrescoFlourKg.toFixed(3),
    rinfrescoWaterKg:  +rinfrescoWaterKg.toFixed(3),
    totalDoughKg:      +totalDoughKg.toFixed(3),
    numPanetti,
    panWeight:         targetPanWeightG,
    prefermType,
  };
}

// ═══════════════════════════════════════════════════════════════
// § T — FUNZIONI MANCANTI KB v2.3.2
// ═══════════════════════════════════════════════════════════════

// estimatePHForLBF() rimossa — issue #19. Sostituita da computeCurrentPH()
// (v2.4.11 §2.6.1), che deriva il pH da leavAdu invece che dalla maturazione.

/**
 * pH biochimicamente corretto da leavAdu — v2.4.11 §2.6.1
 * Il pH è prodotto dalla fermentazione (lievito/LAB), non dall'orologio enzimatico.
 * Calo lineare: ΔpH = kAcid × leavAdu, con floor biologico per agente.
 * Agenti non in tabella → restituisce initialPH invariato.
 */
function computeCurrentPH(initialPH, leavAdu, agentType, labAdu = 0) {
  const pH0 = initialPH ?? 5.8;
  if (agentType === 'sourdough_wheat') {
    // LM dual-pop: drop LAB (dominante) + drop Saccharomiceti (minore) — v2.4.14 §2.6
    const dropLAB  = LAB_KINETICS.kAcid * Math.max(0, labAdu);
    const dropSacc = SACC_ACID_CONTRIB.kAcid * Math.max(0, leavAdu);
    return Math.max(LAB_KINETICS.pHFloor, pH0 - dropLAB - dropSacc);
  }
  // LBF/IDY: invariato dalla v2.4.11 (lineare su leavAdu)
  const params = ACID_PRODUCTION_PARAMS[agentType];
  if (!params || leavAdu <= 0) return pH0;
  return Math.max(params.pHFloor, pH0 - params.kAcid * leavAdu);
}

/**
 * computeLabAdu — accumula l'ADU dei batteri lattici separatamente dai
 * Saccharomiceti, per LM. Da chiamare per sub-step SOLO se sourdough_wheat. — v2.4.14 §2.6
 * CTM(Topt=32) × Arrhenius(Ea=58) × autoinibizione pH (declino lineare 4.8→3.5).
 */
function computeLabAdu(prevLabAdu, currentPH, tempC, subStepH) {
  const labCTM = _cardinalForParams(tempC, LAB_KINETICS.Tmin, LAB_KINETICS.Topt, LAB_KINETICS.Tmax);
  const labArr = safeExp((-LAB_KINETICS.Ea * 1000 / R_GAS) * (1 / (tempC + 273.15) - 1 / T_REF_K));
  let phInhib = 1.0;
  if (currentPH <= LAB_KINETICS.pHInhibFloor) {
    phInhib = 0.0;
  } else if (currentPH < LAB_KINETICS.pHInhibStart) {
    phInhib = (currentPH - LAB_KINETICS.pHInhibFloor) /
              (LAB_KINETICS.pHInhibStart - LAB_KINETICS.pHInhibFloor);
  }
  const labRate = LAB_KINETICS.muMax * labCTM * labArr * phInhib;
  return (prevLabAdu ?? 0) + labRate * subStepH;
}

// computeExtensibilityIndex() e computeInverseProgram() rimosse — issue #19.
//
// computeExtensibilityIndex: mai integrata in UI. Il dashboard calcola i propri
//   indici con formule più semplici e slegate dalla fermentazione
//   (cfr. PROFILE_INDICES_REPORT.md §1.4).
// computeInverseProgram: sostituita dal Service-Window solver, che risolve lo
//   stesso problema inverso (dose per centrare un target) integrando la timeline
//   reale invece di assumere temperatura costante.

// ═══════════════════════════════════════════════════════════════
// § S — EXPORTS
// ═══════════════════════════════════════════════════════════════

// Costanti pubbliche
const _constants = {
  DEFAULT_FN,
  DEFAULT_ASH,
  EXTREME_W_SPREAD,
  T_REF_K,
  R_GAS,
  CP_WATER,
  CP_FLOUR,
  RHO_DOUGH,
  H_AIR,
  CARDINAL_PARAMS,
  AGENT_GOMPERTZ,
  HILL_W_DECAY,
  CONTAINER_THERMAL_PRESETS,
  AUTOLYSIS_CALIBRATION,
  PREFERMENTO_CALIBRATION,
  AMYLASE_PH_PARAMS,
  AMYLASE_DENATURATION_PARAMS,
  AMYLASE_CORRECTION_PARAMS,
  // v2.4.0
  SALT_INHIBITION_PARAMS,
  W_BLEND_NONLINEAR_K,
  MALT_PARAMS,
  ALTITUDE_PARAMS,
  WATER_HARDNESS_PARAMS,
  ENZYMATIC_CLOCK_PARAMS,
  // v2.4.11
  ACID_PRODUCTION_PARAMS,
  // v2.4.14
  LAB_KINETICS,
  SACC_ACID_CONTRIB,
};

// § S Style Profile Parameters (v2.4.4)
const STYLE_PROFILES = {

  napoletana: {
    // === FARINA ===
    W_range:          [250, 320],
    W_ottimale:       280,
    PL_range:         [0.5, 0.7],
    PL_ottimale:      0.60,
    protein_range:    [11.0, 12.5],

    // === IMPASTO ===
    hydration_range:  [55.5, 62.5],
    hydration_ott:    60.0,
    salt_range:       [2.5, 3.0],
    salt_ott:         2.8,
    peso_panetto_range: [200, 280],
    peso_panetto_ott:   250,

    // === FERMENTAZIONE — DISTRIBUZIONE ===
    sviluppo_puntata_range: [0, 10],
    sviluppo_puntata_ott:   5,
    sviluppo_appreto_range: [40, 70],
    sviluppo_appreto_ott:   60,
    puntataH_range_ta:  [1, 4],
    puntataH_ott_ta:    2,
    protocollo_preferito: 'ta_only',

    // === PARAMETRI MOTORE ===
    alertThreshold:       80,
    alertThreshold_range: [75, 85],
    puntataMatPct_target: 10,
    puntataMatPct_range:  [5, 20],
    W_minimo_stesura:     160,
    bubbleThresholdPct:   85,
    primarySignal:        'maturation',
    structuralAlertEnabled: false,

    // === COTTURA ===
    temp_forno_range:   [430, 485],
    temp_forno_ott:     450,
    tempo_cottura_s:    [60, 90],
    superficie_cottura: ['refrattario biscotto'],

    // === QUALITÀ ===
    indicatori_pronto:      ['Panetto rilassato', 'Leggero appiattimento senza collasso', 'Bollicine superficiali lievi'],
    indicatori_over:        ['Maglia glutinica cede allo staglio', 'Odore marcatamente acido/alcolico'],
    difetti_puntata_lunga:  ['Panetti che non tengono la forma', 'Eccessiva tenacità se non compensata'],
    difetti_puntata_corta:  ['Cornicione gommoso', 'Mancanza di maculatura in cottura'],
  },

  contemporanea: {
    // === FARINA ===
    W_range:          [280, 350],
    W_ottimale:       320,
    PL_range:         [0.5, 0.6],
    PL_ottimale:      0.55,
    protein_range:    [12.0, 14.0],

    // === IMPASTO ===
    hydration_range:  [65.0, 75.0],
    hydration_ott:    70.0,
    salt_range:       [2.5, 3.0],
    salt_ott:         2.7,
    peso_panetto_range: [250, 280],
    peso_panetto_ott:   260,

    // === FERMENTAZIONE — DISTRIBUZIONE ===
    sviluppo_puntata_range: [20, 40],
    sviluppo_puntata_ott:   30,
    sviluppo_appreto_range: [80, 120],
    sviluppo_appreto_ott:   100,
    puntataH_range_ta:  [1, 3],
    puntataH_ott_ta:    2,
    protocollo_preferito: 'misto_ta_tc',

    // === PARAMETRI MOTORE ===
    alertThreshold:       90,
    alertThreshold_range: [85, 95],
    puntataMatPct_target: 30,
    puntataMatPct_range:  [20, 40],
    W_minimo_stesura:     190,
    bubbleThresholdPct:   92,
    primarySignal:        'dual',
    structuralAlertEnabled: true,

    // === COTTURA ===
    temp_forno_range:   [380, 430],
    temp_forno_ott:     410,
    tempo_cottura_s:    [90, 120],
    superficie_cottura: ['refrattario biscotto'],

    // === QUALITÀ ===
    indicatori_pronto:      ['Raddoppio visibile in cassetta', 'Struttura gelatinosa/tremolante', 'Ragnatela glutinica visibile sotto'],
    indicatori_over:        ['Collasso strutturale al tocco', 'Incordatura persa, impasto appiccicoso'],
    difetti_puntata_lunga:  ['Eccessiva acidità', 'Difficoltà di stesura per maglia compromessa'],
    difetti_puntata_corta:  ['Cornicione chiuso/pesante', 'Effetto chewing-gum'],
  },

  teglia: {
    // === FARINA ===
    W_range:          [320, 400],
    W_ottimale:       350,
    PL_range:         [0.5, 0.6],
    PL_ottimale:      0.55,
    protein_range:    [13.0, 15.0],

    // === IMPASTO ===
    hydration_range:  [75.0, 90.0],
    hydration_ott:    80.0,
    salt_range:       [2.2, 3.0],
    salt_ott:         2.5,
    grasso:           true,
    grasso_range:     [2.0, 3.0],
    peso_panetto_range: [500, 1200],
    peso_panetto_ott:   600,

    // === FERMENTAZIONE — DISTRIBUZIONE ===
    sviluppo_puntata_range: [30, 60],
    sviluppo_puntata_ott:   50,
    sviluppo_appreto_range: [30, 60],
    sviluppo_appreto_ott:   50,
    puntataH_range_ta:  [2.0, 3.5],
    puntataH_ott_ta:    2.5,
    protocollo_preferito: 'misto_ta_tc',

    // === PARAMETRI MOTORE ===
    alertThreshold:       96,
    alertThreshold_range: [92, 100],
    puntataMatPct_target: 40,
    puntataMatPct_range:  [30, 55],
    W_minimo_stesura:     140,
    bubbleThresholdPct:   98,
    primarySignal:        'structural',
    structuralAlertEnabled: true,

    // === COTTURA ===
    temp_forno_range:   [250, 290],
    temp_forno_ott:     280,
    tempo_cottura_s:    [720, 1080],
    superficie_cottura: ['teglia in ferro blu'],

    // === QUALITÀ ===
    indicatori_pronto:      ['Panetto estremamente soffice', 'Aumento visibile 50% in cassetta', 'Grandi bolle in superficie'],
    indicatori_over:        ['Impasto si lacera traslandolo in teglia', 'Mancanza di spinta in forno'],
    difetti_puntata_lunga:  ['Proteolisi avanzata (impasto liquido/informe)'],
    difetti_puntata_corta:  ['Gommosità', 'Alveolatura fine e densa', 'Mancanza di croccantezza in base'],
  },

  pala: {
    // === FARINA ===
    W_range:          [280, 350],
    W_ottimale:       320,
    PL_range:         [0.5, 0.6],
    PL_ottimale:      0.55,
    protein_range:    [12.5, 14.0],

    // === IMPASTO ===
    hydration_range:  [75.0, 85.0],
    hydration_ott:    80.0,
    salt_range:       [2.0, 2.7],
    salt_ott:         2.5,
    grasso:           true,
    grasso_range:     [1.5, 2.5],
    peso_panetto_range: [400, 800],
    peso_panetto_ott:   500,

    // === FERMENTAZIONE — DISTRIBUZIONE ===
    sviluppo_puntata_range: [40, 70],
    sviluppo_puntata_ott:   60,
    sviluppo_appreto_range: [50, 80],
    sviluppo_appreto_ott:   60,
    puntataH_range_ta:  [1.0, 2.0],
    puntataH_ott_ta:    1.5,
    protocollo_preferito: 'misto_ta_tc',

    // === PARAMETRI MOTORE ===
    alertThreshold:       92,
    alertThreshold_range: [88, 95],
    puntataMatPct_target: 50,
    puntataMatPct_range:  [40, 65],
    W_minimo_stesura:     180,
    bubbleThresholdPct:   92,
    primarySignal:        'structural',
    structuralAlertEnabled: true,

    // === COTTURA ===
    temp_forno_range:   [260, 290],
    temp_forno_ott:     275,
    tempo_cottura_s:    [420, 600],
    superficie_cottura: ['refrattario'],

    // === QUALITÀ ===
    indicatori_pronto:      ['Panetto arioso', 'Resistenza minima alla trazione'],
    indicatori_over:        ['Strappo durante il caricamento in pala', 'Perdita di spinta verticale in cottura'],
    difetti_puntata_lunga:  ['Difficoltà di scorrimento dalla pala', 'Eccessivo appiattimento in forno'],
    difetti_puntata_corta:  ['Struttura interna troppo compatta (mollica da pane)'],
  },

  nystyle: {
    // === FARINA ===
    W_range:          [320, 380],
    W_ottimale:       350,
    PL_range:         [0.5, 0.6],
    PL_ottimale:      0.55,
    protein_range:    [13.0, 14.5],

    // === IMPASTO ===
    hydration_range:  [58.0, 65.0],
    hydration_ott:    62.0,
    salt_range:       [1.5, 2.5],
    salt_ott:         2.0,
    grasso:           true,
    grasso_range:     [1.5, 3.0],
    peso_panetto_range: [350, 500],
    peso_panetto_ott:   400,

    // === FERMENTAZIONE — DISTRIBUZIONE ===
    sviluppo_puntata_range: [0, 15],
    sviluppo_puntata_ott:   5,
    sviluppo_appreto_range: [50, 80],
    sviluppo_appreto_ott:   60,
    puntataH_range_ta:  [0.25, 1.0],
    puntataH_ott_ta:    0.5,
    protocollo_preferito: 'tc_only',

    // === PARAMETRI MOTORE ===
    alertThreshold:       85,
    alertThreshold_range: [80, 90],
    puntataMatPct_target: 10,
    puntataMatPct_range:  [5, 15],
    W_minimo_stesura:     220,
    bubbleThresholdPct:   88,
    primarySignal:        'maturation',
    structuralAlertEnabled: false,

    // === COTTURA ===
    temp_forno_range:   [260, 315],
    temp_forno_ott:     285,
    tempo_cottura_s:    [300, 480],
    superficie_cottura: ['acciaio', 'refrattario'],

    // === QUALITÀ ===
    indicatori_pronto:      ['Panetti espansi ma ancora tonici', 'Leggera ragnatela sul fondo della cassetta'],
    indicatori_over:        ['Impasto si lacera se lanciato ai bordi', 'Eccesso di bolle sul cornicione'],
    difetti_puntata_lunga:  ['n/a — puntata vera quasi inesistente in questo stile'],
    difetti_puntata_corta:  ['Retrazione (snapback) durante la stesura'],
  },
};

function getStyleProfile(style) {
  return STYLE_PROFILES[style] ?? STYLE_PROFILES['napoletana'];
}

function matLevelMessage(level) {
  switch (level) {
    case 'OK':          return 'Fermentazione in corso';
    case 'APPROACHING': return 'Sweet spot in avvicinamento';
    case 'SWEET_SPOT':  return 'Sweet spot raggiunto';
    default:            return '';
  }
}

function computeStyleAwareAlertLevel(session, matPct, W_current, W_initial, leaveningPct) {
  const profile = getStyleProfile(session.style);
  const wDecayPct = ((W_initial - W_current) / W_initial) * 100;

  const structuralLevel =
    wDecayPct > 55 ? 'STRUCTURAL_COLLAPSED' :
    wDecayPct > 35 ? 'STRUCTURAL_CRITICAL'  :
    wDecayPct > 20 ? 'STRUCTURAL_WARNING'   : null;

  const matLevel =
    matPct >= profile.alertThreshold        ? 'SWEET_SPOT'  :
    matPct >= profile.alertThreshold * 0.90 ? 'APPROACHING' : 'OK';

  const bubbleAlert = leaveningPct >= profile.bubbleThresholdPct;

  switch (profile.primarySignal) {
    case 'maturation':
      if (bubbleAlert)
        return { level: 'STRUCTURAL_WARNING', bindingSignal: 'bubble',
                 message: 'Lievitazione al limite — rischio bolle in cottura' };
      if (profile.structuralAlertEnabled && structuralLevel === 'STRUCTURAL_CRITICAL')
        return { level: 'STRUCTURAL_CRITICAL', bindingSignal: 'structural',
                 message: 'Struttura compromessa — cuoci o usa subito' };
      return { level: matLevel, bindingSignal: 'maturation',
               message: matLevelMessage(matLevel) };

    case 'dual':
      if (structuralLevel === 'STRUCTURAL_COLLAPSED')
        return { level: 'STRUCTURAL_COLLAPSED', bindingSignal: 'structural',
                 message: 'Collasso strutturale — gas perso, non recuperabile' };
      if (structuralLevel === 'STRUCTURAL_CRITICAL' && matPct >= profile.alertThreshold)
        return { level: 'STRUCTURAL_CRITICAL', bindingSignal: 'structural',
                 message: 'Struttura al limite — inforna ora prima del collasso' };
      if (structuralLevel === 'STRUCTURAL_CRITICAL')
        return { level: 'STRUCTURAL_CRITICAL', bindingSignal: 'structural',
                 message: 'Struttura critica — maturazione ancora incompleta, monitora' };
      if (matPct >= profile.alertThreshold && structuralLevel === 'STRUCTURAL_WARNING')
        return { level: 'SWEET_SPOT', bindingSignal: 'dual',
                 message: 'Sweet spot raggiunto — finestra strutturale in chiusura' };
      if (bubbleAlert)
        return { level: 'STRUCTURAL_WARNING', bindingSignal: 'bubble',
                 message: 'Lievitazione al limite — rischio bolle in cottura' };
      return { level: matLevel, bindingSignal: 'maturation',
               message: matLevelMessage(matLevel) };

    case 'structural':
      if (structuralLevel === 'STRUCTURAL_COLLAPSED')
        return { level: 'STRUCTURAL_COLLAPSED', bindingSignal: 'structural',
                 message: 'Collasso strutturale — impasto non lavorabile' };
      if (structuralLevel === 'STRUCTURAL_CRITICAL')
        return { level: 'STRUCTURAL_CRITICAL', bindingSignal: 'structural',
                 message: 'Struttura critica — trasferisci in teglia/pala ora' };
      if (structuralLevel === 'STRUCTURAL_WARNING')
        return { level: 'STRUCTURAL_WARNING', bindingSignal: 'structural',
                 message: 'Struttura in indebolimento — verifica visivamente' };
      if (bubbleAlert)
        return { level: 'STRUCTURAL_WARNING', bindingSignal: 'bubble',
                 message: 'Lievitazione al limite per questo stile' };
      return { level: matLevel, bindingSignal: 'maturation',
               message: matLevelMessage(matLevel) };

    default:
      return { level: matLevel, bindingSignal: 'maturation',
               message: matLevelMessage(matLevel) };
  }
}

function checkPuntataTarget(session, currentMatPct) {
  if (session.doughLocation !== 'bulk_room' && session.doughLocation !== 'bulk_fridge') return null;
  const profile = getStyleProfile(session.style);
  const target = profile.puntataMatPct_target;
  const [, hi] = profile.puntataMatPct_range;
  if (currentMatPct >= hi)
    return { level: 'CRITICAL', message: `Puntata oltre il target per ${session.style} (${currentMatPct.toFixed(0)}% > ${hi}%) — procedi allo staglio` };
  if (currentMatPct >= target)
    return { level: 'ADVISORY', message: `Puntata al target per ${session.style} (${currentMatPct.toFixed(0)}%) — momento ideale per lo staglio` };
  return null;
}

function checkWMinimoStesura(session, W_current) {
  const profile = getStyleProfile(session.style);
  if (W_current < profile.W_minimo_stesura) {
    return { level: 'CRITICAL', message: `W strutturale (${W_current.toFixed(0)}) sotto il minimo per stesura ${session.style} (${profile.W_minimo_stesura}) — rischio lacerazione` };
  }
  return null;
}

// Per CommonJS (Node.js test)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    ..._constants,

    // § D Core
    cardinalCorrection,
    kEffective,
    kRatio,
    gompertz,
    findAduAt,

    // § E Thermal
    doughSpecificHeat,
    thermalTimeConstant,
    applyContainerResistance,
    doughCoreTemp,

    // § F Hill/Proteolysis
    fArrhenius,
    fPH,
    fHydration,
    computeTCritRef,
    computeTCrit,
    computeWHill,
    structuralState,

    // § G Amylase
    normalizeAmylaseActivity,
    fPHAmylase,
    computeDenaturationFactor,
    amylaseCorrectedRate,

    // § H Blend
    blendAmylaseIndex,
    validateFlourGroup,
    normalizeFlourGroup,

    // § I Prefermenti
    computeAutolysis,
    validatePrefermentiMix,
    computeRinfrescoFraction,
    computeCombinedInitialState,

    // § J LM + Friction

    // § K Dashboard/Tick
    computeDeltaAdu,
    sweetSpot,
    sweetSpotMaturation,
    computeDashboardEffectiveW,

    // Backward compat (deprecato v2.3)
    computeKprot,
    computeWEffectiveExp,

    // § L Salt (v2.4.0)
    fSaltYeast,
    fSaltProtease,

    // § M Blend non-lineare (v2.4.0)
    computeWBlendNonLinear,

    // § N Thermal bifase (v2.4.0)
    currentDoughMassKg,
    thermalTimeConstantSphere,

    // § O Malt (v2.4.0)
    computeMaltAmylaseContrib,
    computeTotalAmylaseIndex,
    maltAlertLevel,

    // § P Altitude (v2.4.0)
    computeAltitudeFactor,
    volumeMilestoneCorrection,

    // § Q Water hardness (v2.4.0)
    fHardnessGluten,
    fHardnessProtease,

    // § R Reverse scaling (v2.4.0)
    computeReverseScaling,

    // § T KB v2.3.2 additions
    // v2.4.11
    computeCurrentPH,
    // v2.4.14
    computeLabAdu,
    thermalTimeConstantForPhase,

    // § S Style Profile Parameters (v2.4.4)
    STYLE_PROFILES,
    getStyleProfile,
    computeStyleAwareAlertLevel,
    checkPuntataTarget,
    checkWMinimoStesura,
  };
}

// Per ES modules (Vite/browser)
export {
  // Constants
  DEFAULT_FN, DEFAULT_ASH, EXTREME_W_SPREAD, T_REF_K, R_GAS,
  CARDINAL_PARAMS, AGENT_GOMPERTZ, HILL_W_DECAY,
  CONTAINER_THERMAL_PRESETS, AUTOLYSIS_CALIBRATION, PREFERMENTO_CALIBRATION,
  AMYLASE_PH_PARAMS, AMYLASE_DENATURATION_PARAMS, AMYLASE_CORRECTION_PARAMS,
  SALT_INHIBITION_PARAMS, W_BLEND_NONLINEAR_K, MALT_PARAMS,
  ALTITUDE_PARAMS, WATER_HARDNESS_PARAMS, ENZYMATIC_CLOCK_PARAMS,
  ACID_PRODUCTION_PARAMS,

  // Functions
  safeExp, safeDiv, safeClamp,
  cardinalCorrection, kEffective, kRatio, gompertz, findAduAt,
  doughSpecificHeat, thermalTimeConstant, applyContainerResistance, doughCoreTemp,
  fArrhenius, fPH, fHydration,
  computeTCritRef, computeTCrit, computeWHill, structuralState,
  normalizeAmylaseActivity, fPHAmylase, computeDenaturationFactor, amylaseCorrectedRate,
  blendAmylaseIndex, validateFlourGroup, normalizeFlourGroup,
  computeAutolysis, validatePrefermentiMix, computeRinfrescoFraction, computeCombinedInitialState,
  computeDeltaAdu, sweetSpot, sweetSpotMaturation, computeDashboardEffectiveW,
  computeKprot, computeWEffectiveExp,
  fSaltYeast, fSaltProtease,
  computeWBlendNonLinear,
  currentDoughMassKg, thermalTimeConstantSphere,
  computeMaltAmylaseContrib, computeTotalAmylaseIndex, maltAlertLevel,
  computeAltitudeFactor, volumeMilestoneCorrection,
  fHardnessGluten, fHardnessProtease,
  computeReverseScaling,
  computeCurrentPH,
  computeLabAdu, thermalTimeConstantForPhase,
  LAB_KINETICS, SACC_ACID_CONTRIB,
  STYLE_PROFILES, getStyleProfile, computeStyleAwareAlertLevel,
  checkPuntataTarget, checkWMinimoStesura,
};
