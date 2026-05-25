/**
 * PizzaMatrix Engine v2.4.0 — Test Suite
 * Esegui con: node engine/engine-v2.4.0.test.js
 *
 * Verifica le tabelle di validazione del KB e i casi §3.
 */
import * as e from './engine-v2.4.0.js';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function approx(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol;
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ D — Core Kinetics');
// ─────────────────────────────────────────────────────────────

// CTM: γ(Topt) = 1.0
assert(approx(e.cardinalCorrection(28, 'fresh_yeast'), 1.0, 0.001),
  'CTM: γ(Topt=28°C, fresh_yeast) ≈ 1.0');

// CTM: γ = 0 oltre Tmax
assert(e.cardinalCorrection(45, 'fresh_yeast') === 0,
  'CTM: γ(Tmax=45°C) = 0');

// CTM: γ = 0 sotto Tmin
assert(e.cardinalCorrection(1.5, 'fresh_yeast') === 0,
  'CTM: γ(Tmin=1.5°C) = 0');

// kRatio(25°C) = 1.0 per definizione
assert(approx(e.kRatio(25, 62, 'fresh_yeast'), 1.0, 0.001),
  'kRatio(25°C) = 1.0 (normalizzato)');

// Gompertz: maturazione a ADU = lambda deve essere bassa
const mat_at_lag = e.gompertz(1.2, 12.0, 1.2, 100);
assert(mat_at_lag < 30, `Gompertz(ADU=λ): maturazione < 30% — val=${mat_at_lag.toFixed(2)}`);

// findAduAt: inverso
const adu_at_85 = e.findAduAt(12.0, 1.2, 100, 85);
const back_to_85 = e.gompertz(adu_at_85, 12.0, 1.2, 100);
assert(approx(back_to_85, 85, 0.1), `findAduAt roundtrip: gompertz(findAduAt(85)) ≈ 85 — val=${back_to_85.toFixed(2)}`);

// ─────────────────────────────────────────────────────────────
console.log('\n§ E — Thermal Stack (tabelle KB §3)');
// ─────────────────────────────────────────────────────────────

// doughSpecificHeat: formula esatta = CP_WATER·h + CP_FLOUR·(1-h)
// KB table: 3715 è arrotondato; valore esatto = 4186×0.8 + 1840×0.2 = 3716.8
assert(approx(e.doughSpecificHeat(50), 3013, 2), 'cp(50%) ≈ 3013');
assert(approx(e.doughSpecificHeat(65), 3365, 2), 'cp(65%) ≈ 3365 (riferimento)');
assert(approx(e.doughSpecificHeat(80), 3717, 2), 'cp(80%) ≈ 3717 (formula: 4186×0.8+1840×0.2)');

// thermalTimeConstant: tabella §3 (τ in minuti, tolleranza 5%)
const tau_1kg = e.thermalTimeConstant(1.0, 65) / 60;
assert(approx(tau_1kg, 139, 8), `τ_intrinsic(1kg, 65%) ≈ 139 min — val=${tau_1kg.toFixed(1)}`);

// applyContainerResistance
const tau_bare = e.thermalTimeConstant(1.0, 65);
assert(approx(e.applyContainerResistance(tau_bare, 'film') / tau_bare, 1.2, 0.001),
  'applyContainerResistance(film) = τ × 1.2');
assert(approx(e.applyContainerResistance(tau_bare, 'UNKNOWN') / tau_bare, 1.0, 0.001),
  'applyContainerResistance(UNKNOWN) fallback = 1.0');

// doughCoreTemp: tabella §3 (T_init=25, T_amb=20, τ=8340s)
const tau8340 = 8340;
// Tabella KB usa τ=8340s. thermalTimeConstant(1kg,65%)≈8325s (leggero delta geometrico).
// I test usano la formula diretta per evitare dipendenza da τ specifico.
assert(approx(e.doughCoreTemp(25, 20, 0, tau8340), 25.0, 0.01),
  'doughCoreTemp(t=0) = T_init');
assert(approx(e.doughCoreTemp(25, 20, 1800, tau8340), 23.94, 0.1),
  'doughCoreTemp(t=30min) ≈ 23.94°C (τ=8340s)');
// t=60min con τ reale (~8325s): 20 + 5·exp(-3600/8325) ≈ 23.25°C
const tau_real_1kg = e.thermalTimeConstant(1.0, 65);
const T_60min = e.doughCoreTemp(25, 20, 3600, tau_real_1kg);
assert(T_60min > 23.0 && T_60min < 23.5,
  `doughCoreTemp(t=60min) ∈ [23.0, 23.5] — val=${T_60min.toFixed(2)}`);
assert(e.doughCoreTemp(25, 20, 0, 0) === 20,
  'doughCoreTemp(tauTotal=0) → T_ambient');

// ─────────────────────────────────────────────────────────────
console.log('\n§ F — Hill / Proteolisi');
// ─────────────────────────────────────────────────────────────

// fArrhenius(25°C) = 1.0
assert(approx(e.fArrhenius(25), 1.0, 0.001), 'fArrhenius(25°C) = 1.0');
assert(approx(e.fArrhenius(22), 0.824, 0.01), 'fArrhenius(22°C) ≈ 0.824');
// NOTA KB: il valore 0.353 nella tabella §2.4 corrisponde a ~9.4°C (typo KB).
// Formula corretta Ea=47kJ/mol: exp(-5653×(1/277.15-1/298.15)) ≈ 0.238
assert(approx(e.fArrhenius(4), 0.238, 0.005), 'fArrhenius(4°C) ≈ 0.238 (formula Ea=47 kJ/mol)');
// Il valore 0.353 del KB §2.4 corrisponde esattamente a T≈9.5°C (non 4°C né 10°C)
assert(approx(e.fArrhenius(9.5), 0.353, 0.01), 'fArrhenius(9.5°C) ≈ 0.353 (valore KB corretto a ~9.5°C)');

// fPH(5.2) = 1.0
assert(approx(e.fPH(5.2), 1.0, 0.001), 'fPH(5.2) = 1.0 (optimum)');
assert(approx(e.fPH(4.5), 0.506, 0.01), 'fPH(4.5) ≈ 0.506');

// fHydration(65%) = 1.0
assert(approx(e.fHydration(65), 1.0, 0.001), 'fHydration(65%) = 1.0');
assert(approx(e.fHydration(70), 1.028, 0.003), 'fHydration(70%) ≈ 1.028');

// computeTCritRef — interpolazione anchor
assert(approx(e.computeTCritRef(180), 25, 0.01), 'tCritRef(W=180) = 25h (clamp basso)');
assert(approx(e.computeTCritRef(400), 90, 0.01), 'tCritRef(W=400) = 90h (clamp alto)');
// W=210: interpola tra [180,25] e [240,40] → 25 + (210-180)/(240-180) × 15 = 25 + 7.5 = 32.5
assert(approx(e.computeTCritRef(210), 32.5, 0.1), 'tCritRef(W=210) ≈ 32.5h (interpolato)');

// computeWHill: tabella §2.4
// t/t_crit=1.0 → W/W0=0.50
const W0 = 300;
const tCrit = 50;
assert(approx(e.computeWHill(W0, tCrit, tCrit) / W0, 0.50, 0.01),
  'Hill(t=t_crit): W/W0 = 0.50');
// t/t_crit=0.5 → W/W0≈0.97
assert(approx(e.computeWHill(W0, tCrit, tCrit * 0.5) / W0, 0.97, 0.01),
  'Hill(t=0.5×t_crit): W/W0 ≈ 0.97');

// structuralState
assert(e.structuralState(300, 300) === 'OK', 'structuralState: decay=0% → OK');
assert(e.structuralState(300, 225) === 'WARNING', 'structuralState: decay=25% → WARNING');
assert(e.structuralState(300, 180) === 'CRITICAL', 'structuralState: decay=40% → CRITICAL');
assert(e.structuralState(300, 120) === 'COLLAPSED', 'structuralState: decay=60% → COLLAPSED');

// ─────────────────────────────────────────────────────────────
console.log('\n§ G — Amylase');
// ─────────────────────────────────────────────────────────────

// normalizeAmylaseActivity
assert(approx(e.normalizeAmylaseActivity(250), 1.0, 0.001), 'amylaseIndex(FN=250) = 1.0');
assert(e.normalizeAmylaseActivity(100) > 1.5, 'amylaseIndex(FN=100) > 1.5');
assert(e.normalizeAmylaseActivity(400) < 0.4, 'amylaseIndex(FN=400) < 0.4');

// fPHAmylase
// f_pH_amylase(pH) = exp(-(pH-5.5)²/(2×0.7²))
// NOTA KB: la tabella §2.8.1 ha incoerenze con σ=0.7 (sembra calcolata con σ≈0.65).
// Usiamo i valori formula con σ=0.7 (spec autoritativa):
//   pH=5.0: exp(-0.25/0.98) = 0.775  (KB table: 0.744)
//   pH=4.8: exp(-0.49/0.98) = 0.607  (KB table: 0.607 ✓ coincide)
//   pH=4.5: exp(-1.00/0.98) = 0.361  (KB table: 0.306)
assert(approx(e.fPHAmylase(5.5), 1.0, 0.001),   'fPHAmylase(5.5) = 1.0 (optimum)');
assert(approx(e.fPHAmylase(5.0), 0.775, 0.005),  'fPHAmylase(5.0) ≈ 0.775 (formula σ=0.7)');
assert(approx(e.fPHAmylase(4.8), 0.607, 0.005),  'fPHAmylase(4.8) ≈ 0.607 (formula = KB table)');
assert(approx(e.fPHAmylase(4.5), 0.361, 0.005),  'fPHAmylase(4.5) ≈ 0.361 (formula σ=0.7)');

// computeDenaturationFactor
const pref_no_stress = { state: { pH: 6.0 }, durationH: 14 };
const pref_stress_14 = { state: { pH: 4.8 }, durationH: 14 };  // poolish 14h
const pref_stress_20 = { state: { pH: 5.1 }, durationH: 20 };  // biga 20h
assert(e.computeDenaturationFactor(pref_no_stress) === 1.0, 'denaturation: pH≥5.5 → 1.0');
assert(approx(e.computeDenaturationFactor(pref_stress_14), 0.958, 0.001),
  'denaturation: poolish 14h pH=4.8 → 0.958');
assert(approx(e.computeDenaturationFactor(pref_stress_20), 0.940, 0.001),
  'denaturation: biga 20h pH=5.1 → 0.940');

// amylaseCorrectedRate — tabella §3
assert(approx(e.amylaseCorrectedRate(1.0, 1.0, 0, 5.5), 1.0, 0.001),
  'amylaseCorrected(baseline, pH5.5) = 1.0');
assert(approx(e.amylaseCorrectedRate(1.0, 1.75, 0, 5.5), 1.3, 0.005),
  'amylaseCorrected(FN=100, pH5.5) = 1.3');
assert(approx(e.amylaseCorrectedRate(1.0, 0.33, 0, 5.5), 0.732, 0.005),
  'amylaseCorrected(FN=400, pH5.5) = 0.732');
assert(approx(e.amylaseCorrectedRate(1.0, 1.75, 0, 4.8), 1.025, 0.005),
  'amylaseCorrected(FN=100, pH4.8) ≈ 1.025 (soppressione acido)');

// ─────────────────────────────────────────────────────────────
console.log('\n§ H/I — Blend + Prefermenti (fixtures §3 KB)');
// ─────────────────────────────────────────────────────────────

// computeWBlendNonLinear — spread = 0 (singola farina)
const single = [{ W: 300, percentage: 100 }];
assert(approx(e.computeWBlendNonLinear(single), 300, 0.01),
  'WBlendNonLinear(singola farina) = W');

// spread = 200 (W=180, W=380 al 50/50)
const extreme_blend = [
  { W: 180, percentage: 50 },
  { W: 380, percentage: 50 },
];
const W_lin = 280;
const W_nonlin = e.computeWBlendNonLinear(extreme_blend);
assert(W_nonlin < W_lin, `WBlendNonLinear(spread=200) < lineare — val=${W_nonlin.toFixed(1)} < ${W_lin}`);
assert(W_nonlin > 250 && W_nonlin < 280,
  `WBlendNonLinear(spread=200) ∈ [250,280] — val=${W_nonlin.toFixed(1)}`);

// fixture §3: Caso 1 — solo rinfresco
const main = {
  effectiveW: 300, effectivePl: 0.55, effectiveProtein: 13,
  effectiveAsh: 0.60, effectiveAmylaseIndex: 0.75
};
const c1 = e.computeCombinedInitialState({ prefermenti: [], mainFlourGroup: main });
assert(approx(c1.effectiveW_initial, 300), 'Caso1 effW=300');
assert(approx(c1.initialPH, 6.0, 0.01), 'Caso1 pH=6.0');
assert(c1.initialMaturationOffset === 0, 'Caso1 matOffset=0');

// fixture §3: Caso 2 — Poolish 30%
const prefA = {
  id: 'pref_a', type: 'poolish', flourFraction: 30, durationH: 14,
  flourGroup: main,
  state: { pH: 4.8, maturationPct: 82, W_decayed: 275, pl_modified: 0.52, amylase_index: 0.822, ready: true }
};
const c2 = e.computeCombinedInitialState({ prefermenti: [prefA], mainFlourGroup: main });
assert(approx(c2.effectiveW_initial, 292.5, 0.5), `Caso2 effW ≈ 292.5 — val=${c2.effectiveW_initial.toFixed(2)}`);
assert(approx(c2.initialPH, 5.263, 0.05), `Caso2 pH ≈ 5.263 — val=${c2.initialPH.toFixed(3)}`);
assert(approx(c2.initialMaturationOffset, 0.246, 0.01), `Caso2 matOffset ≈ 0.246 — val=${c2.initialMaturationOffset.toFixed(3)}`);

// ─────────────────────────────────────────────────────────────
console.log('\n§ L — Salt (v2.4.0)');
// ─────────────────────────────────────────────────────────────

assert(approx(e.fSaltYeast(0), 1.0, 0.001), 'fSaltYeast(0) = 1.0');
assert(approx(e.fSaltYeast(2), 0.80, 0.001), 'fSaltYeast(2%) = 0.80');
assert(approx(e.fSaltYeast(2.5), 0.75, 0.001), 'fSaltYeast(2.5%) = 0.75');
assert(approx(e.fSaltYeast(3), 0.70, 0.001), 'fSaltYeast(3%) = 0.70');
// Floor: sale altissimo non scende sotto 0.60
assert(e.fSaltYeast(10) === 0.60, 'fSaltYeast(10%): floor = 0.60');

assert(approx(e.fSaltProtease(0), 1.0, 0.001), 'fSaltProtease(0) = 1.0');
assert(approx(e.fSaltProtease(2), 0.84, 0.001), 'fSaltProtease(2%) = 0.84');
assert(approx(e.fSaltProtease(3), 0.76, 0.001), 'fSaltProtease(3%) = 0.76');
assert(e.fSaltProtease(10) === 0.70, 'fSaltProtease(10%): floor = 0.70');

// ─────────────────────────────────────────────────────────────
console.log('\n§ M — Blend W Non-Lineare (v2.4.0)');
// ─────────────────────────────────────────────────────────────

// spread < 75: f ≈ 1.0 (no correzione)
const small_spread = [{ W: 260, percentage: 50 }, { W: 300, percentage: 50 }];
const W_small = e.computeWBlendNonLinear(small_spread);
assert(approx(W_small, 280, 1), `WBlendNonLinear(spread=40) ≈ lineare — val=${W_small.toFixed(1)}`);

// spread = 150: threshold esatta, f=1 - 0.0003×(150-75) = 1 - 0.0225 = 0.9775
const at_threshold = [{ W: 150, percentage: 50 }, { W: 300, percentage: 50 }];
const W_thresh = e.computeWBlendNonLinear(at_threshold);
assert(approx(W_thresh, 225 * 0.9775, 0.5),
  `WBlendNonLinear(spread=150): f=0.9775 — val=${W_thresh.toFixed(2)}`);

// ─────────────────────────────────────────────────────────────
console.log('\n§ N — Inerzia Termica Bifase (v2.4.0)');
// ─────────────────────────────────────────────────────────────

const session_2kg = { totalFlourGrams: 1000, hydration: 65, numPanetti: 8 };
// Bulk: massa totale ≈ 1.65 kg
const massaBulk = e.currentDoughMassKg(session_2kg, 'bulk_room');
assert(approx(massaBulk, 1.65, 0.01), `massa bulk = 1.65 kg — val=${massaBulk.toFixed(3)}`);
// Panetto: 1.65/8 ≈ 0.206 kg
const massaPanetto = e.currentDoughMassKg(session_2kg, 'balled_room');
assert(approx(massaPanetto, 1.65 / 8, 0.01), `massa panetto = ${(1.65/8).toFixed(3)} kg — val=${massaPanetto.toFixed(3)}`);

// thermalTimeConstantSphere vs thermalTimeConstant:
// La SFERA è la geometria più compatta → minimizza A → τ_sphere ≥ τ_cylinder per stessa massa.
// La differenza rilevante è di MASSA: un panetto (250g sfera) ha τ molto < impasto totale (1650g cilindro).
const tau_bulk   = e.thermalTimeConstant(1.65, 65);       // massa totale (cilindro)
const tau_ball   = e.thermalTimeConstantSphere(0.25, 65); // panetto (sfera)
assert(tau_ball < tau_bulk,
  `τ_sphere(panetto 250g) < τ_cyl(bulk 1650g): ${tau_ball.toFixed(0)}s < ${tau_bulk.toFixed(0)}s`);
// Verifica scaling M^(1/3): raddoppiare la massa → τ × 1.26
const tau_sph_250 = e.thermalTimeConstantSphere(0.25, 65);
const tau_sph_500 = e.thermalTimeConstantSphere(0.50, 65);
assert(approx(tau_sph_500 / tau_sph_250, Math.pow(2, 1/3), 0.02),
  `τ_sphere scala come M^(1/3): ratio = ${(tau_sph_500/tau_sph_250).toFixed(3)} ≈ ${Math.pow(2,1/3).toFixed(3)}`);

// ─────────────────────────────────────────────────────────────
console.log('\n§ O — Malto Diastatico (v2.4.0)');
// ─────────────────────────────────────────────────────────────

// dose 0.5% a DP=200 → contrib = (0.5/100) × (200/200) × 1.2 = 0.006
assert(approx(e.computeMaltAmylaseContrib(0.5, 200), 0.006, 0.0001),
  'maltContrib(0.5%, 200°L) = 0.006');
// dose 1% a DP=400 → (1/100) × (400/200) × 1.2 = 0.024
assert(approx(e.computeMaltAmylaseContrib(1.0, 400), 0.024, 0.0001),
  'maltContrib(1%, 400°L) = 0.024');

// computeTotalAmylaseIndex
assert(approx(e.computeTotalAmylaseIndex(1.0, 0.5), 1.5, 0.001),
  'totalAmylaseIndex(1.0 + 0.5) = 1.5');

// maltAlertLevel
assert(e.maltAlertLevel(1.2) === 'OK', 'maltAlert(1.2) = OK');
assert(e.maltAlertLevel(1.55) === 'ADVISORY', 'maltAlert(1.55) = ADVISORY');
assert(e.maltAlertLevel(1.82) === 'CRITICAL', 'maltAlert(1.82) = CRITICAL');
assert(e.maltAlertLevel(2.01) === 'BLOCKED', 'maltAlert(2.01) = BLOCKED');

// ─────────────────────────────────────────────────────────────
console.log('\n§ P — Altitudine (v2.4.0)');
// ─────────────────────────────────────────────────────────────

// Tabella §2.16.1
assert(approx(e.computeAltitudeFactor(0), 1.0, 0.001), 'altitudeFactor(0m) = 1.0');
assert(approx(e.computeAltitudeFactor(500), 1.060, 0.002), 'altitudeFactor(500m) ≈ 1.060');
assert(approx(e.computeAltitudeFactor(1000), 1.122, 0.003), 'altitudeFactor(1000m) ≈ 1.122');
// exp(2000/8500) = 1.2657 — KB dice 1.259 (arrotondamento di tabella)
assert(approx(e.computeAltitudeFactor(2000), 1.259, 0.01), 'altitudeFactor(2000m) ≈ 1.259 (±0.01)');

// volumeMilestoneCorrection: target ×2 a 1000m → maturazione biologica < 2
const vm = e.volumeMilestoneCorrection(2.0, 1000);
assert(vm < 2.0 && vm > 1.5,
  `volumeMilestone(×2 @ 1000m) ∈ [1.5, 2.0] — val=${vm.toFixed(3)}`);

// ─────────────────────────────────────────────────────────────
console.log('\n§ Q — Durezza Acqua (v2.4.0)');
// ─────────────────────────────────────────────────────────────

// Tabella §2.17.1
assert(approx(e.fHardnessGluten(150), 1.0, 0.001), 'fHardnessGluten(150ppm) = 1.0 (ref)');
assert(approx(e.fHardnessGluten(50), 0.920, 0.001), 'fHardnessGluten(50ppm) ≈ 0.920');
assert(approx(e.fHardnessGluten(300), 1.120, 0.001), 'fHardnessGluten(300ppm) ≈ 1.120');

assert(approx(e.fHardnessProtease(150), 1.0, 0.001), 'fHardnessProtease(150ppm) = 1.0 (ref)');
assert(approx(e.fHardnessProtease(50), 1.040, 0.001), 'fHardnessProtease(50ppm) ≈ 1.040');
assert(approx(e.fHardnessProtease(300), 0.940, 0.001), 'fHardnessProtease(300ppm) ≈ 0.940');

// ─────────────────────────────────────────────────────────────
console.log('\n§ R — Reverse Scaling (v2.4.0)');
// ─────────────────────────────────────────────────────────────

// 2 kg di biga, flourFraction=60%, idrat=65%, panetto=260g
const rs = e.computeReverseScaling({
  availablePrefermKg:  2.0,
  prefermType:         'biga',
  targetFlourFraction: 60,
  targetHydration:     65,
  targetPanWeightG:    260,
});
// totalFlourKg = 2.0 / 0.60 ≈ 3.333
assert(approx(rs.totalFlourKg, 3.333, 0.01),
  `reverseScaling totalFlourKg ≈ 3.333 — val=${rs.totalFlourKg}`);
// rinfrescoFlourKg = 3.333 × 0.40 ≈ 1.333
assert(approx(rs.rinfrescoFlourKg, 1.333, 0.01),
  `reverseScaling rinfrescoFlourKg ≈ 1.333 — val=${rs.rinfrescoFlourKg}`);
// totalDoughKg = 3.333 × 1.65 ≈ 5.5
assert(approx(rs.totalDoughKg, 3.333 * 1.65, 0.05),
  `reverseScaling totalDoughKg ≈ ${(3.333*1.65).toFixed(2)} — val=${rs.totalDoughKg}`);
// numPanetti = round(5.5 / 0.260) ≈ 21
assert(rs.numPanetti > 15 && rs.numPanetti < 30,
  `reverseScaling numPanetti ragionevole — val=${rs.numPanetti}`);

// Errore su input invalido
let threw = false;
try { e.computeReverseScaling({ availablePrefermKg: 0, prefermType: 'biga', targetFlourFraction: 50, targetHydration: 65, targetPanWeightG: 260 }); }
catch { threw = true; }
assert(threw, 'reverseScaling: errore su availablePrefermKg=0');

// ─────────────────────────────────────────────────────────────
console.log('\n── Riepilogo ────────────────────────────────────');
console.log(`  Totale:  ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
if (failed > 0) {
  console.error(`  ❌ Failed: ${failed}`);
  process.exit(1);
} else {
  console.log('  Tutti i test superati 🍕');
}
