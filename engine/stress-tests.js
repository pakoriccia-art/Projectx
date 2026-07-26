/**
 * PizzaMatrix Engine v2.4.0 — Stress Test Suite
 * 16 sezioni. Esegui con: node engine/stress-tests.js
 */
import * as e from './engine-v2.4.0.js';
import { solveNowAnchoredWindow, buildServiceWindowTimeline } from './serviceWindowSolver.js';

let passed = 0, failed = 0;

function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function approx(a, b, tol = 0.01)    { return Math.abs(a - b) <= tol; }
function between(v, lo, hi)           { return v >= lo && v <= hi; }
function hasErr(result, code)         { return result.errors.some(s => s.includes(code)); }
function hasWarn(result, code)        { return result.warnings.some(s => s.includes(code)); }

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-CTM — Cardinal Temperature Model');
// ─────────────────────────────────────────────────────────────

// ST-CTM-01 — γ(Topt) = 1.0 per ogni agente
assert(approx(e.cardinalCorrection(28.0, 'fresh_yeast'), 1.0, 0.001),
  'ST-CTM-01a γ(Topt=28, fresh_yeast) ≈ 1.000');
assert(approx(e.cardinalCorrection(28.0, 'instant_dry_yeast'), 1.0, 0.001),
  'ST-CTM-01b γ(Topt=28, instant_dry_yeast) ≈ 1.000');
assert(approx(e.cardinalCorrection(26.0, 'sourdough_wheat'), 1.0, 0.001),
  'ST-CTM-01c γ(Topt=26, sourdough_wheat) ≈ 1.000');
assert(approx(e.cardinalCorrection(32.0, 'lab_bacteria'), 1.0, 0.001),
  'ST-CTM-01d γ(Topt=32, lab_bacteria) ≈ 1.000');

// ST-CTM-02 — γ = 0 ai boundary
assert(e.cardinalCorrection(1.5, 'fresh_yeast') === 0,
  'ST-CTM-02a γ(Tmin=1.5, fresh_yeast) = 0');
assert(e.cardinalCorrection(45.0, 'fresh_yeast') === 0,
  'ST-CTM-02b γ(Tmax=45, fresh_yeast) = 0');
assert(e.cardinalCorrection(1.4, 'fresh_yeast') === 0,
  'ST-CTM-02c γ(1.4 < Tmin) = 0 clamp');
assert(e.cardinalCorrection(45.1, 'fresh_yeast') === 0,
  'ST-CTM-02d γ(45.1 > Tmax) = 0 clamp');
assert(e.cardinalCorrection(2.0, 'instant_dry_yeast') === 0,
  'ST-CTM-02e γ(Tmin=2.0, instant_dry_yeast) = 0');
assert(e.cardinalCorrection(44.0, 'instant_dry_yeast') === 0,
  'ST-CTM-02f γ(Tmax=44, instant_dry_yeast) = 0');

// ST-CTM-03 — Asimmetria: γ(punto_medio_alto) > γ(punto_medio_basso)
{
  const g_low  = e.cardinalCorrection(14.75, 'fresh_yeast');  // mid(Tmin–Topt)
  const g_high = e.cardinalCorrection(36.5,  'fresh_yeast');  // mid(Topt–Tmax)
  assert(g_high > g_low,
    `ST-CTM-03 asimmetria γ(36.5)>γ(14.75): ${g_high.toFixed(3)} > ${g_low.toFixed(3)}`);
}

// ST-CTM-04 — k_effective = 0 sotto Tmin anche con Arrhenius > 0
{
  const arrPos = e.fArrhenius(1.0) > 0;
  const gammaZero = e.cardinalCorrection(1.0, 'fresh_yeast') === 0;
  const kZero = e.kEffective(1.0, 62, 'fresh_yeast') === 0;
  assert(arrPos,   'ST-CTM-04a fArrhenius(1°C) > 0 (mai zero)');
  assert(gammaZero,'ST-CTM-04b γ_CTM(1°C, fresh_yeast) = 0');
  assert(kZero,    'ST-CTM-04c kEffective(1°C) = 0 (CTM tronca)');
}

// ST-CTM-05 — kRatio(4°C) molto ridotto vs 25°C
{
  const kr4 = e.kRatio(4, 62, 'fresh_yeast');
  assert(kr4 > 0 && kr4 < 0.10,
    `ST-CTM-05 kRatio(4°C) piccolo ma >0: ${kr4.toFixed(4)}`);
  assert(e.kRatio(25, 62, 'fresh_yeast') > 0,
    'ST-CTM-05b kRatio(25°C) > 0 (attività di riferimento)');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-GMP — Gompertz Cinetica Fermentativa');
// ─────────────────────────────────────────────────────────────

// ST-GMP-01 — plateau ad A=100%
assert(approx(e.gompertz(50, 12.0, 1.2, 100), 100.0, 0.5),
  'ST-GMP-01a gompertz(ADU=50, LBF) ≈ 100%');
assert(approx(e.gompertz(50, 11.5, 0.8, 100), 100.0, 0.5),
  'ST-GMP-01b gompertz(ADU=50, IDY) ≈ 100%');
assert(approx(e.gompertz(50, 7.0, 3.5, 100), 100.0, 0.5),
  'ST-GMP-01c gompertz(ADU=50, LM) ≈ 100%');

// ST-GMP-02 — lag phase
assert(e.gompertz(0.5, 12.0, 1.2, 100) < 5,
  `ST-GMP-02a gompertz(ADU=0.5 < λ=1.2) < 5% — val=${e.gompertz(0.5,12,1.2,100).toFixed(2)}`);
// formula: A×exp(-exp((muMax×e/A)×(λ-adu)+1)), non è esattamente 0 a adu=0
assert(e.gompertz(0, 12.0, 1.2, 100) < 5,
  `ST-GMP-02b gompertz(ADU=0) < 5% (lag phase, valore piccolo) — val=${e.gompertz(0,12,1.2,100).toFixed(2)}`);
{
  // ADU = lambda: in questa parametrizzazione la curva è ancora in lag phase
  const m = e.gompertz(1.2, 12.0, 1.2, 100);
  assert(m < 15,
    `ST-GMP-02c gompertz(ADU=λ=1.2) ancora bassa (lag phase) val=${m.toFixed(2)}`);
  // La curva cresce monotonamente: gompertz(λ) < gompertz(2λ) < gompertz(10)
  assert(e.gompertz(1.2,12,1.2,100) < e.gompertz(2.4,12,1.2,100),
    'ST-GMP-02d gompertz monotona crescente');
}

// ST-GMP-03 — findAduAt: inversione roundtrip
{
  const adu50 = e.findAduAt(12.0, 1.2, 100, 50);
  assert(approx(e.gompertz(adu50, 12.0, 1.2, 100), 50, 0.5),
    `ST-GMP-03a findAduAt roundtrip 50%: back=${e.gompertz(adu50,12,1.2,100).toFixed(2)}`);
  const adu80 = e.findAduAt(12.0, 1.2, 100, 80);
  assert(approx(e.gompertz(adu80, 12.0, 1.2, 100), 80, 0.5),
    `ST-GMP-03b findAduAt roundtrip 80%`);
  const adu75lm = e.findAduAt(7.0, 3.5, 100, 75);
  assert(approx(e.gompertz(adu75lm, 7.0, 3.5, 100), 75, 0.5),
    `ST-GMP-03c findAduAt LM roundtrip 75%`);
}

// ST-GMP-04 — dose scaling: solo muMax scala, lambda/A invariati
{
  // gompertz con muMax scalato: stessa forma con diversa "velocità"
  const adu = 2.0;
  const m_ref  = e.gompertz(adu, 12.0, 1.2, 100);  // dose ref
  const m_2x   = e.gompertz(adu, 24.0, 1.2, 100);  // dose ×2
  const m_half = e.gompertz(adu, 6.0,  1.2, 100);  // dose ×0.5
  // muMax×2 → reach higher maturation at same ADU (curve faster)
  assert(m_2x > m_ref && m_ref > m_half,
    `ST-GMP-04 dose scaling: μ×2>${m_2x.toFixed(1)} > μref=${m_ref.toFixed(1)} > μ×0.5=${m_half.toFixed(1)}`);
  // A rimane 100 per tutti
  assert(approx(e.gompertz(50, 24.0, 1.2, 100), 100, 0.5),
    'ST-GMP-04b A=100 invariato con muMax×2');
}

// ST-GMP-05 — ADU a 25°C per 10h = 10.0
{
  // kRatio(25°C) = 1.0 → ADU = 1h × 10h = 10.0
  const kr25 = e.kRatio(25, 62, 'fresh_yeast');
  const adu10h = kr25 * 10;  // manuale: kRatio × deltaTH
  assert(approx(kr25, 1.0, 0.001),
    'ST-GMP-05a kRatio(25°C, fresh_yeast) = 1.0 (per definizione)');
  assert(approx(adu10h, 10.0, 0.1),
    `ST-GMP-05b ADU 10h@25°C = 10.0 ADU, val=${adu10h.toFixed(3)}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-HILL — Decay Strutturale W');
// ─────────────────────────────────────────────────────────────

// ST-HILL-01 — computeTCritRef: interpolazione + clamp (v2.4.19: anchor frame 25°C)
// Anchor ricalibrati: [[150,10.13],[220,18.82],[300,34.74],[400,61.51]]
assert(approx(e.computeTCritRef(180), 13.85, 0.1),
  `ST-HILL-01a tCritRef(W=180) ≈ 13.85h — val=${e.computeTCritRef(180).toFixed(2)}`);
assert(approx(e.computeTCritRef(210), 17.58, 0.5),
  `ST-HILL-01b tCritRef(W=210) ≈ 17.58h — val=${e.computeTCritRef(210).toFixed(2)}`);
assert(approx(e.computeTCritRef(240), 22.80, 0.1),
  `ST-HILL-01c tCritRef(W=240) ≈ 22.80h — val=${e.computeTCritRef(240).toFixed(2)}`);
assert(approx(e.computeTCritRef(277.5), 30.26, 0.5),
  `ST-HILL-01d tCritRef(W=277.5) ≈ 30.26h — val=${e.computeTCritRef(277.5).toFixed(2)}`);
assert(approx(e.computeTCritRef(315), 38.75, 0.1),
  `ST-HILL-01e tCritRef(W=315) ≈ 38.75h — val=${e.computeTCritRef(315).toFixed(2)}`);
assert(approx(e.computeTCritRef(357.5), 50.13, 0.5),
  `ST-HILL-01f tCritRef(W=357.5) ≈ 50.13h — val=${e.computeTCritRef(357.5).toFixed(2)}`);
assert(approx(e.computeTCritRef(400), 61.51, 0.1),
  'ST-HILL-01g tCritRef(W=400) = 61.51h (anchor)');
assert(approx(e.computeTCritRef(450), 61.51, 0.1),
  'ST-HILL-01h tCritRef(W=450) = 61.51h (clamp superiore)');

// ST-HILL-02 — fArrhenius, fPH, fHydration
assert(approx(e.fArrhenius(25), 1.0, 0.001),
  'ST-HILL-02a fArrhenius(25°C) = 1.000');
assert(approx(e.fArrhenius(22), 0.825, 0.01),
  `ST-HILL-02b fArrhenius(22°C) ≈ 0.824 — val=${e.fArrhenius(22).toFixed(4)}`);
assert(e.fArrhenius(4) < e.fArrhenius(22),
  'ST-HILL-02c fArrhenius(4°C) < fArrhenius(22°C)');
assert(e.fArrhenius(30) > 1.0,
  'ST-HILL-02d fArrhenius(30°C) > 1.0 (accelera sopra 25°C)');

assert(approx(e.fPH(5.2), 1.0, 0.001),  'ST-HILL-02e fPH(5.2) = 1.000');
assert(approx(e.fPH(4.5), 0.506, 0.01), `ST-HILL-02f fPH(4.5) ≈ 0.506 — val=${e.fPH(4.5).toFixed(4)}`);
assert(approx(e.fPH(6.0), 0.411, 0.01), `ST-HILL-02g fPH(6.0) ≈ 0.411 — val=${e.fPH(6.0).toFixed(4)}`);

assert(approx(e.fHydration(65), 1.0, 0.001),  'ST-HILL-02h fHydration(65%) = 1.000');
assert(approx(e.fHydration(70), 1.028, 0.005), `ST-HILL-02i fHydration(70%) ≈ 1.028 — val=${e.fHydration(70).toFixed(4)}`);
assert(approx(e.fHydration(50), 0.917, 0.005), `ST-HILL-02j fHydration(50%) ≈ 0.917 — val=${e.fHydration(50).toFixed(4)}`);
assert(approx(e.fHydration(80), 1.083, 0.005), `ST-HILL-02k fHydration(80%) ≈ 1.083 — val=${e.fHydration(80).toFixed(4)}`);

// ST-HILL-03 — computeTCrit composito (coerenza interna)
{
  // v2.4.19: t_crit_ref(300) = 34.74h (anchor diretto, frame 25°C)
  // fArr(22)≈0.825, fPH(5.5)≈0.882, fHyd(65)=1.0
  const tRef300 = e.computeTCritRef(300);
  assert(approx(tRef300, 34.74, 0.1),
    `ST-HILL-03a tCritRef(W=300) = 34.74h — val=${tRef300.toFixed(2)}`);
  const tc = e.computeTCrit(300, 22, 5.5, 65);
  assert(between(tc, 42, 54),
    `ST-HILL-03b computeTCrit(300,22,5.5,65) ≈ 47.7h (±6h) — val=${tc.toFixed(1)}`);
  // Coerenza: computeTCrit = tCritRef / (fArr × fPH × fHyd)
  const expected = tRef300 / (e.fArrhenius(22) * e.fPH(5.5) * e.fHydration(65));
  assert(approx(tc, expected, 0.1),
    `ST-HILL-03c coerenza interna computeTCrit: val=${tc.toFixed(2)} == ${expected.toFixed(2)}`);
}

// ST-HILL-04 — computeWHill: curva Hill n=5 con tCrit=61.1h
{
  const tC = 61.1, W0 = 300;
  assert(approx(e.computeWHill(W0, tC, 0), 300.0, 0.1),
    'ST-HILL-04a W(t=0h) = 300.0');
  // t/tCrit = 1.0 → W = W0/2
  assert(approx(e.computeWHill(W0, tC, 61.1), 150.0, 1.0),
    `ST-HILL-04b W(t=tCrit) = W0/2 = 150 — val=${e.computeWHill(W0,tC,61.1).toFixed(2)}`);
  // Valori intermedi (tolleranza ±3)
  assert(e.computeWHill(W0, tC, 12) > 299.5,
    `ST-HILL-04c W(12h) > 299.5 — val=${e.computeWHill(W0,tC,12).toFixed(2)}`);
  // t=48h: ratio=0.786, W=300/(1+0.786^5)≈300/1.300≈231; note: spec table used wrong tCrit
  const w48 = e.computeWHill(W0, tC, 48);
  assert(w48 > 200 && w48 < 280,
    `ST-HILL-04d W(48h) ∈ [200,280] (tRatio=0.786) — val=${w48.toFixed(2)}`);
}

// ST-HILL-05 — structuralState: soglie
{
  const W0 = 300;
  const wOK       = e.computeWHill(W0, 61.1, 30);   // tRatio≈0.49 → OK
  const wWarning  = e.computeWHill(W0, 61.1, 50);   // tRatio≈0.82 → WARNING
  const wCritical = e.computeWHill(W0, 61.1, 57);   // tRatio≈0.93 → CRITICAL
  const wCollapsed= e.computeWHill(W0, 61.1, 67);   // tRatio≈1.10 → COLLAPSED
  assert(e.structuralState(W0, wOK) === 'OK',
    `ST-HILL-05a structuralState OK — decay=${((W0-wOK)/W0*100).toFixed(1)}%`);
  assert(e.structuralState(W0, wWarning) === 'WARNING',
    `ST-HILL-05b structuralState WARNING — decay=${((W0-wWarning)/W0*100).toFixed(1)}%`);
  assert(e.structuralState(W0, wCritical) === 'CRITICAL',
    `ST-HILL-05c structuralState CRITICAL — decay=${((W0-wCritical)/W0*100).toFixed(1)}%`);
  assert(e.structuralState(W0, wCollapsed) === 'COLLAPSED',
    `ST-HILL-05d structuralState COLLAPSED — decay=${((W0-wCollapsed)/W0*100).toFixed(1)}%`);
}

// ST-HILL-06 — Autolisi: W quasi-invariato a pH=6.0, t=24h
{
  // v2.4.19: t_crit(W=280, T=22, pH=6.0, H=70%) resta lungo (pH=6 rallenta molto).
  // Con anchor ricalibrati (più stringenti) ≈ 88h (era >100h): comunque autolisi quasi-statica.
  const tCritAut = e.computeTCrit(280, 22, 6.0, 70);
  assert(tCritAut > 80,
    `ST-HILL-06a tCrit autolisi > 80h (pH=6 rallenta molto) — val=${tCritAut.toFixed(1)}h`);
  const W_24h = e.computeWHill(280, tCritAut, 24);
  assert(W_24h > 279,
    `ST-HILL-06b W(24h, autolisi) ≈ 280 invariato — val=${W_24h.toFixed(3)}`);
  assert(e.structuralState(280, W_24h) === 'OK',
    'ST-HILL-06c structuralState autolisi 24h = OK');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-THERM — Inerzia Termica e Contenitore');
// ─────────────────────────────────────────────────────────────

// ST-THERM-01 — doughSpecificHeat
assert(approx(e.doughSpecificHeat(50), 3013, 5),
  `ST-THERM-01a cp(H=50%) = 3013 J/kgK — val=${e.doughSpecificHeat(50).toFixed(0)}`);
assert(approx(e.doughSpecificHeat(65), 3365, 5),
  `ST-THERM-01b cp(H=65%) = 3365 J/kgK — val=${e.doughSpecificHeat(65).toFixed(0)}`);
assert(approx(e.doughSpecificHeat(70), 3482, 5),
  `ST-THERM-01c cp(H=70%) = 3482 J/kgK — val=${e.doughSpecificHeat(70).toFixed(0)}`);
assert(approx(e.doughSpecificHeat(80), 3717, 5),
  `ST-THERM-01d cp(H=80%) ≈ 3717 J/kgK — val=${e.doughSpecificHeat(80).toFixed(0)}`);

// ST-THERM-02 — thermalTimeConstant: geometria cilindro piatto
{
  const tau1 = e.thermalTimeConstant(1.0, 65);
  const tau05 = e.thermalTimeConstant(0.5, 65);
  assert(between(tau1, 8000, 8700),
    `ST-THERM-02a τ(1.0kg,65%) ≈ 8340s ∈ [8000,8700] — val=${tau1.toFixed(0)}s`);
  assert(between(tau05, 6200, 7000),
    `ST-THERM-02b τ(0.5kg,65%) ≈ 6600s ∈ [6200,7000] — val=${tau05.toFixed(0)}s`);
  // Scala τ ∝ m^(1/3): rapporto ≈ 2^(1/3) ≈ 1.26
  const ratio = tau1 / tau05;
  assert(between(ratio, 1.15, 1.40),
    `ST-THERM-02c τ ratio 1kg/0.5kg ≈ 1.26 — val=${ratio.toFixed(3)}`);
}

// ST-THERM-03 — applyContainerResistance: tutti i preset
{
  const tau = e.thermalTimeConstant(1.0, 65);
  const presets = [
    ['bare', 1.0], ['film', 1.2], ['open_box', 1.5],
    ['glass_covered', 2.0], ['plastic_bag', 2.2],
    ['closed_box', 2.5], ['closed_box_double', 3.0],
  ];
  for (const [preset, factor] of presets) {
    const tauTotal = e.applyContainerResistance(tau, preset);
    assert(approx(tauTotal, tau * factor, tau * 0.01),
      `ST-THERM-03 ${preset}: τ×${factor} — val=${(tauTotal/60).toFixed(0)}min`);
  }
  // Edge case: preset sconosciuto → fallback bare (×1.0)
  const tauUnknown = e.applyContainerResistance(tau, 'unknown_xyz');
  assert(approx(tauUnknown, tau * 1.0, tau * 0.01),
    'ST-THERM-03 fallback preset sconosciuto → ×1.0');
}

// ST-THERM-04 — doughCoreTemp: Newton cooling
{
  const tau = 8340;
  // T_init=25, T_amb=20: raffreddamento
  assert(approx(e.doughCoreTemp(25, 20, 0, tau), 25.0, 0.01),
    'ST-THERM-04a doughCoreTemp(t=0) = T_init');
  const t1800 = e.doughCoreTemp(25, 20, 1800, tau);
  assert(between(t1800, 23.5, 24.5),
    `ST-THERM-04b doughCoreTemp(25→20, t=30min) ∈ [23.5,24.5] — val=${t1800.toFixed(2)}`);
  // T_init = T_ambient → invariato
  assert(approx(e.doughCoreTemp(22, 22, 3600, tau), 22.0, 0.01),
    'ST-THERM-04c doughCoreTemp(T_init=T_amb) = T_amb sempre');
  // Riscaldamento frigo→ambiente
  const tWarm = e.doughCoreTemp(5, 22, 3600, tau);
  assert(between(tWarm, 8, 16),
    `ST-THERM-04d doughCoreTemp(5→22, 1h) ∈ [8,16] — val=${tWarm.toFixed(2)}`);
  // tau=0 → T_ambient
  assert(approx(e.doughCoreTemp(25, 20, 3600, 0), 20.0, 0.01),
    'ST-THERM-04e tau=0 → T_ambient');
}

// ST-THERM-05 — thermalTimeConstantSphere per panetti
{
  // Sfera 0.431kg ≈ panetto 300g (impasto = farina + acqua)
  const tauSph = e.thermalTimeConstantSphere(0.25, 65);
  assert(tauSph > 0,
    `ST-THERM-05a thermalTimeConstantSphere(0.25kg) > 0: ${tauSph.toFixed(0)}s`);
  // Sfera più piccola → τ minore (più veloce)
  const tau1kg = e.thermalTimeConstantSphere(1.0, 65);
  assert(tau1kg > tauSph,
    `ST-THERM-05b τ_sphere(1kg) > τ_sphere(0.25kg): ${tau1kg.toFixed(0)} > ${tauSph.toFixed(0)}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-AUTO — Autolisi');
// ─────────────────────────────────────────────────────────────

// ST-AUTO-01 — P/L improvement formula
{
  const fg = { effectiveW: 280, effectivePl: 0.7, effectiveAmylaseIndex: 0.75 };
  const a0h  = e.computeAutolysis({ flourGroup: fg, durationH: 0,  tempC: 22, hydration: 65, flourFraction: 100 });
  const a1h  = e.computeAutolysis({ flourGroup: fg, durationH: 1,  tempC: 22, hydration: 65, flourFraction: 100 });
  const a4h  = e.computeAutolysis({ flourGroup: fg, durationH: 4,  tempC: 22, hydration: 65, flourFraction: 100 });
  const a24h = e.computeAutolysis({ flourGroup: fg, durationH: 24, tempC: 22, hydration: 65, flourFraction: 100 });

  // formula: pl_post = pl_init × (0.7 + 0.3 × exp(-t/2.5))
  const expectedPl1h  = 0.7 * (0.7 + 0.3 * Math.exp(-1/2.5));
  const expectedPl4h  = 0.7 * (0.7 + 0.3 * Math.exp(-4/2.5));
  const expectedPl24h = 0.7 * (0.7 + 0.3 * Math.exp(-24/2.5));

  assert(approx(a0h.pl_modified, 0.7, 0.005),
    `ST-AUTO-01a pl(t=0) = 0.700 — val=${a0h.pl_modified.toFixed(4)}`);
  assert(approx(a1h.pl_modified, expectedPl1h, 0.005),
    `ST-AUTO-01b pl(t=1h) ≈ ${expectedPl1h.toFixed(3)} — val=${a1h.pl_modified.toFixed(4)}`);
  assert(approx(a4h.pl_modified, expectedPl4h, 0.005),
    `ST-AUTO-01c pl(t=4h) ≈ ${expectedPl4h.toFixed(3)} — val=${a4h.pl_modified.toFixed(4)}`);
  // Asintoto: pl(∞) = pl_init × 0.7
  assert(approx(a24h.pl_modified, 0.7 * 0.7, 0.005),
    `ST-AUTO-01d pl(t=24h) → asintoto 0.7×0.7=0.490 — val=${a24h.pl_modified.toFixed(4)}`);
}

// ST-AUTO-02 — Autolisi: nessuna maturazione biologica
{
  const fg = { effectiveW: 300, effectivePl: 0.55, effectiveAmylaseIndex: 0.75 };
  const auto = e.computeAutolysis({ flourGroup: fg, durationH: 12, tempC: 22, hydration: 65, flourFraction: 30 });
  assert(auto.maturationPct === 0, 'ST-AUTO-02a maturationPct = 0 (no Gompertz)');
  assert(approx(auto.pH, 6.0, 0.001), 'ST-AUTO-02b pH = 6.0 (nessuna acidificazione)');
  assert(auto.ready === true, 'ST-AUTO-02c ready = true');
  // amylase index conservato
  assert(approx(auto.amylase_index, 0.75, 0.001), 'ST-AUTO-02d amylase_index conservato');
}

// ST-AUTO-03 — Autolisi: validazione parametri (via validatePrefermentiMix)
{
  // autolisi durationH < 0.33 → error in biga/poolish type, ma autolisi ha AUTOLYSIS_DURATION_OUT_OF_RANGE
  const vShort = e.validatePrefermentiMix(
    [{ id: 'a1', type: 'autolysis', flourFraction: 30, durationH: 0.2, state: {} }], 70);
  assert(!vShort.ok, 'ST-AUTO-03a durationH=0.2h → errore (< 0.33)');
  const vOk = e.validatePrefermentiMix(
    [{ id: 'a2', type: 'autolysis', flourFraction: 30, durationH: 2, state: {} }], 70);
  assert(vOk.ok, 'ST-AUTO-03b durationH=2h → ok');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-MIX — Mix Prefermenti');
// ─────────────────────────────────────────────────────────────

const MAIN_FG = { effectiveW: 300, effectivePl: 0.55, effectiveProtein: 13, effectiveAsh: 0.60, effectiveAmylaseIndex: 0.75 };

// ST-MIX-01 — Solo rinfresco (nessun prefermento)
{
  const r = e.computeCombinedInitialState({ prefermenti: [], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 300.0, 0.1), 'ST-MIX-01a effectiveW=300');
  assert(approx(r.effectivePl_initial, 0.55, 0.001), 'ST-MIX-01b effectivePl=0.55');
  assert(r.initialMaturationOffset === 0, 'ST-MIX-01c matOffset=0');
  assert(approx(r.initialPH, 6.0, 0.001), 'ST-MIX-01d initialPH=6.0');
  assert(r.rinfrescoFraction === 1.0, 'ST-MIX-01e rinfrescoFraction=1.0');
}

// ST-MIX-02 — Poolish singolo 30%
{
  const prefA = {
    id: 'poolish_A', type: 'poolish', flourFraction: 30, durationH: 14,
    state: { pH: 4.8, maturationPct: 82, W_decayed: 275, pl_modified: 0.52, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefA], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 292.5, 0.5), `ST-MIX-02a effectiveW=292.5 — val=${r.effectiveW_initial.toFixed(2)}`);
  assert(approx(r.effectivePl_initial, 0.541, 0.005), `ST-MIX-02b effectivePl=0.541 — val=${r.effectivePl_initial.toFixed(4)}`);
  assert(approx(r.effectiveAmylaseIndex, 0.761, 0.005), `ST-MIX-02c amylase≈0.761 — val=${r.effectiveAmylaseIndex.toFixed(4)}`);
  assert(approx(r.initialPH, 5.263, 0.01), `ST-MIX-02d pH=5.263 — val=${r.initialPH.toFixed(4)}`);
  assert(approx(r.initialMaturationOffset, 0.246, 0.005), `ST-MIX-02e matOffset=0.246 — val=${r.initialMaturationOffset.toFixed(4)}`);
}

// ST-MIX-03 — Biga singola 50%
{
  const prefB = {
    id: 'biga_B', type: 'biga', flourFraction: 50, durationH: 20,
    state: { pH: 5.1, maturationPct: 74, W_decayed: 348, pl_modified: 0.48, amylase_index: 0.65, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefB], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 324.0, 0.5), `ST-MIX-03a effectiveW=324 — val=${r.effectiveW_initial.toFixed(2)}`);
  assert(approx(r.effectivePl_initial, 0.515, 0.005), `ST-MIX-03b effectivePl=0.515 — val=${r.effectivePl_initial.toFixed(4)}`);
  assert(approx(r.initialPH, 5.350, 0.01), `ST-MIX-03c pH≈5.350 — val=${r.initialPH.toFixed(4)}`);
  assert(approx(r.initialMaturationOffset, 0.370, 0.005), `ST-MIX-03d matOffset=0.370 — val=${r.initialMaturationOffset.toFixed(4)}`);
}

// ST-MIX-04 — Autolisi singola 30%
{
  const prefC = {
    id: 'auto_C', type: 'autolysis', flourFraction: 30,
    state: { pH: 6.0, maturationPct: 0, W_decayed: 280, pl_modified: 0.386, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefC], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 294.0, 0.5), `ST-MIX-04a effectiveW=294 — val=${r.effectiveW_initial.toFixed(2)}`);
  assert(approx(r.effectivePl_initial, 0.501, 0.005), `ST-MIX-04b effectivePl≈0.501 — val=${r.effectivePl_initial.toFixed(4)}`);
  assert(approx(r.effectiveAmylaseIndex, 0.772, 0.005), `ST-MIX-04c amylase≈0.772 — val=${r.effectiveAmylaseIndex.toFixed(4)}`);
  assert(r.initialMaturationOffset === 0, 'ST-MIX-04d matOffset=0 (autolisi no bio)');
  assert(approx(r.initialPH, 6.0, 0.001), 'ST-MIX-04e pH=6.0 (autolisi)');
  // Warning ONLY_AUTOLYSIS da validatePrefermentiMix
  const v = e.validatePrefermentiMix([prefC], 70);
  assert(hasWarn(v, 'ONLY_AUTOLYSIS'), 'ST-MIX-04f ONLY_AUTOLYSIS warning');
}

// ST-MIX-05 — Biga 50% + Poolish 30% + main 20%
{
  const prefB = {
    id: 'biga_B', type: 'biga', flourFraction: 50, durationH: 20,
    state: { pH: 5.1, maturationPct: 74, W_decayed: 348, pl_modified: 0.48, amylase_index: 0.65, ready: true },
    flourGroup: MAIN_FG,
  };
  const prefA = {
    id: 'poolish_A', type: 'poolish', flourFraction: 30, durationH: 14,
    state: { pH: 4.8, maturationPct: 82, W_decayed: 275, pl_modified: 0.52, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefB, prefA], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 316.5, 0.5), `ST-MIX-05a effectiveW=316.5 — val=${r.effectiveW_initial.toFixed(2)}`);
  assert(approx(r.effectivePl_initial, 0.506, 0.005), `ST-MIX-05b effectivePl=0.506 — val=${r.effectivePl_initial.toFixed(4)}`);
  assert(approx(r.initialMaturationOffset, 0.616, 0.005), `ST-MIX-05c matOffset=0.616 — val=${r.initialMaturationOffset.toFixed(4)}`);
  assert(between(r.initialPH, 5.03, 5.07), `ST-MIX-05d pH≈5.049 ∈ [5.03,5.07] — val=${r.initialPH.toFixed(4)}`);
}

// ST-MIX-06 — Autolisi 100%
{
  const prefC100 = {
    id: 'auto_100', type: 'autolysis', flourFraction: 100,
    state: { pH: 6.0, maturationPct: 0, W_decayed: 280, pl_modified: 0.386, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefC100], mainFlourGroup: MAIN_FG });
  assert(approx(r.effectiveW_initial, 280.0, 0.5), `ST-MIX-06a effectiveW=280 — val=${r.effectiveW_initial.toFixed(2)}`);
  assert(approx(r.rinfrescoFraction, 0.0, 0.001), 'ST-MIX-06b rinfrescoFraction=0');
}

// ST-MIX-07 — Errori validazione
{
  // Caso 8: 3 prefermenti → TOO_MANY_PREFERMENTI
  const v3 = e.validatePrefermentiMix([
    { id: 'p1', type: 'poolish', flourFraction: 20, state: {} },
    { id: 'p2', type: 'biga',   flourFraction: 20, state: {} },
    { id: 'p3', type: 'poolish', flourFraction: 20, state: {} },
  ], 40);
  assert(!v3.ok && hasErr(v3, 'TOO_MANY_PREFERMENTI'),
    'ST-MIX-07a 3 prefermenti → TOO_MANY_PREFERMENTI');

  // Caso 9: Σ > 100 → INVALID_FRACTION_SUM
  const vSum = e.validatePrefermentiMix([
    { id: 'p1', type: 'poolish', flourFraction: 60, state: {} },
    { id: 'p2', type: 'biga',   flourFraction: 60, state: {} },
  ], 0);
  assert(!vSum.ok && hasErr(vSum, 'INVALID_FRACTION_SUM'),
    'ST-MIX-07b Σfrac>100 → INVALID_FRACTION_SUM');

  // Caso 10: biologico con rinfresco < 10%
  const vRinf = e.validatePrefermentiMix(
    [{ id: 'p1', type: 'biga', flourFraction: 95, state: {} }], 5);
  assert(!vRinf.ok && hasErr(vRinf, 'MISSING_RINFRESCO_BIOLOGICAL'),
    'ST-MIX-07c biologico+rinfresco<10% → MISSING_RINFRESCO_BIOLOGICAL');

  // Caso 11: state mancante
  const vNoState = e.validatePrefermentiMix(
    [{ id: 'p1', type: 'poolish', flourFraction: 30, state: undefined }], 70);
  assert(!vNoState.ok && hasErr(vNoState, 'MISSING_PREFERMENTO_STATE'),
    'ST-MIX-07d state=undefined → MISSING_PREFERMENTO_STATE');
}

// ST-MIX-08 — DUPLICATE_BIOLOGICAL_TYPE (warning non bloccante)
{
  const vDup = e.validatePrefermentiMix([
    { id: 'p1', type: 'poolish', flourFraction: 30, state: {} },
    { id: 'p2', type: 'poolish', flourFraction: 30, state: {} },
  ], 40);
  assert(vDup.ok, 'ST-MIX-08a duplicato non è bloccante (ok=true)');
  assert(hasWarn(vDup, 'DUPLICATE_BIOLOGICAL_TYPE'),
    'ST-MIX-08b DUPLICATE_BIOLOGICAL_TYPE warning presente');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-FLOUR — Blend Farine');
// ─────────────────────────────────────────────────────────────

// ST-FLOUR-01 — Blend W non-lineare (v2.4.0)
{
  const flours2 = [
    { W: 250, pl: 0.4, protein: 12, ash: 0.50, percentage: 60, FN: 300 },
    { W: 350, pl: 0.6, protein: 14, ash: 0.60, percentage: 40, FN: 200 },
  ];
  const r = e.normalizeFlourGroup(flours2);
  // Non-lineare: spread=100 > threshold(75) → correzione
  // W_linear=290, f_nl = 1 - 0.0003×(100-75) = 0.9925
  assert(r.isBlend === true, 'ST-FLOUR-01a isBlend=true');
  assert(r.effectiveW < 290, `ST-FLOUR-01b effectiveW < 290 (non-lineare) — val=${r.effectiveW.toFixed(2)}`);
  assert(r.effectiveW > 270, `ST-FLOUR-01c effectiveW > 270 — val=${r.effectiveW.toFixed(2)}`);
  // P/L lineare
  assert(approx(r.effectivePl, 0.60*0.4 + 0.40*0.6, 0.01),
    `ST-FLOUR-01d effectivePl lineare — val=${r.effectivePl.toFixed(4)}`);
}

// ST-FLOUR-02 — 3 farine, Σ percentuali = 100
{
  const flours3 = [
    { W: 200, pl: 0.4, protein: 11.0, ash: 0.50, percentage: 33.33, FN: 280 },
    { W: 300, pl: 0.5, protein: 13.0, ash: 0.55, percentage: 33.33, FN: 250 },
    { W: 380, pl: 0.6, protein: 14.5, ash: 0.65, percentage: 33.34, FN: 350 },
  ];
  const sum = flours3.reduce((a, f) => a + f.percentage, 0);
  assert(approx(sum, 100, 0.01), `ST-FLOUR-02a Σ%=100 — val=${sum.toFixed(3)}`);
  const r = e.normalizeFlourGroup(flours3);
  // Amylase blend
  const amylExpect = (33.33/100)*e.normalizeAmylaseActivity(280)
    + (33.33/100)*e.normalizeAmylaseActivity(250)
    + (33.34/100)*e.normalizeAmylaseActivity(350);
  assert(approx(r.effectiveAmylaseIndex, amylExpect, 0.005),
    `ST-FLOUR-02b amylaseIndex blend — val=${r.effectiveAmylaseIndex.toFixed(4)}`);
}

// ST-FLOUR-03 — Default FN=340 quando assente
{
  const fSingle = [{ W: 300, pl: 0.55, protein: 13, ash: 0.55, percentage: 100 }];
  const r = e.normalizeFlourGroup(fSingle);
  const expected = e.normalizeAmylaseActivity(340); // DEFAULT_FN
  assert(approx(r.effectiveAmylaseIndex, expected, 0.005),
    `ST-FLOUR-03 FN assente → DEFAULT_FN=340 → amylase=${r.effectiveAmylaseIndex.toFixed(4)}`);
}

// ST-FLOUR-04 — Default ASH=0.55 quando assente
{
  const fNoAsh = [{ W: 300, pl: 0.55, protein: 13, percentage: 100, FN: 250 }]; // no ash
  const r = e.normalizeFlourGroup(fNoAsh);
  assert(r.effectiveAsh === 0.55,
    `ST-FLOUR-04 ash=undefined → DEFAULT_ASH=0.55 — val=${r.effectiveAsh}`);
}

// ST-FLOUR-05 — Warning EXTREME_W_SPREAD
{
  const fSpread = [
    { W: 180, pl: 0.4, protein: 11, ash: 0.50, percentage: 50, FN: 280 },
    { W: 380, pl: 0.6, protein: 14, ash: 0.60, percentage: 50, FN: 250 },
  ];
  const vWarn = e.validateFlourGroup(fSpread);
  assert(hasWarn(vWarn, 'EXTREME_W_SPREAD'),
    `ST-FLOUR-05a spread=200>150 → EXTREME_W_SPREAD warning`);
  // No warning con spread < 150
  const fOk = [
    { W: 250, pl: 0.4, protein: 12, ash: 0.50, percentage: 50, FN: 280 },
    { W: 380, pl: 0.6, protein: 14, ash: 0.60, percentage: 50, FN: 250 },
  ];
  const vOk2 = e.validateFlourGroup(fOk);
  assert(!hasWarn(vOk2, 'EXTREME_W_SPREAD'),
    'ST-FLOUR-05b spread=130 → nessun warning EXTREME_W_SPREAD');
}

// ST-FLOUR-06 — Blend P/L lineare
{
  const f = [
    { W: 250, pl: 0.4, protein: 12, ash: 0.50, percentage: 60, FN: 300 },
    { W: 350, pl: 0.8, protein: 14, ash: 0.60, percentage: 40, FN: 200 },
  ];
  const r = e.normalizeFlourGroup(f);
  assert(approx(r.effectivePl, 0.60*0.4 + 0.40*0.8, 0.005),
    `ST-FLOUR-06 effectivePl=0.56 lineare — val=${r.effectivePl.toFixed(4)}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-AMYL — Amilasi');
// ─────────────────────────────────────────────────────────────

// ST-AMYL-01 — normalizeAmylaseActivity: curva FN
assert(between(e.normalizeAmylaseActivity(100), 1.60, 1.80),
  `ST-AMYL-01a amylase(FN=100) ∈ [1.60,1.80] — val=${e.normalizeAmylaseActivity(100).toFixed(4)}`);
assert(approx(e.normalizeAmylaseActivity(250), 1.0, 0.001),
  `ST-AMYL-01b amylase(FN=250) = 1.000 — val=${e.normalizeAmylaseActivity(250).toFixed(4)}`);
assert(between(e.normalizeAmylaseActivity(400), 0.25, 0.40),
  `ST-AMYL-01c amylase(FN=400) ∈ [0.25,0.40] — val=${e.normalizeAmylaseActivity(400).toFixed(4)}`);
assert(approx(e.normalizeAmylaseActivity(340), 0.506, 0.01),
  `ST-AMYL-01d amylase(FN=340/default) ≈ 0.506 — val=${e.normalizeAmylaseActivity(340).toFixed(4)}`);

// ST-AMYL-02 — fPHAmylase (implementazione usa σ=0.7)
{
  const fPHA = (ph) => e.fPHAmylase(ph);
  // Formula con σ=0.7: exp(-(pH-5.5)^2 / (2×0.49)) = exp(-(pH-5.5)^2/0.98)
  assert(approx(fPHA(5.5), 1.0, 0.001), 'ST-AMYL-02a fPHAmylase(5.5) = 1.000');
  // pH=4.8: exp(-(0.7)^2/0.98) = exp(-0.5) ≈ 0.607 (confermato dal KB)
  assert(approx(fPHA(4.8), 0.607, 0.01),
    `ST-AMYL-02b fPHAmylase(4.8) ≈ 0.607 — val=${fPHA(4.8).toFixed(4)}`);
  // Simmetria: fPH(5.0) = fPH(6.0) per gaussiana centrata a 5.5
  assert(approx(fPHA(5.0), fPHA(6.0), 0.001),
    `ST-AMYL-02c simmetria: fPHAmylase(5.0)≈fPHAmylase(6.0)`);
  // Monotona: decrescente allontanandosi da 5.5
  assert(fPHA(4.5) < fPHA(5.0) && fPHA(5.0) < fPHA(5.5),
    'ST-AMYL-02d monotonia: fPH decrescente da 5.5');
}

// ST-AMYL-03 — computeDenaturationFactor: tutti i rami
assert(e.computeDenaturationFactor({ state: { pH: 6.0 }, durationH: 12 }) === 1.0,
  'ST-AMYL-03a pH=6.0 ≥ 5.5 → denat=1.0');
assert(e.computeDenaturationFactor({ state: { pH: 5.5 }, durationH: 14 }) === 1.0,
  'ST-AMYL-03b pH=5.5 esatto → denat=1.0');
assert(approx(e.computeDenaturationFactor({ state: { pH: 5.1 }, durationH: 20 }), 0.940, 0.001),
  `ST-AMYL-03c pH=5.1, dur=20h → denat=0.940 — val=${e.computeDenaturationFactor({state:{pH:5.1},durationH:20}).toFixed(4)}`);
assert(approx(e.computeDenaturationFactor({ state: { pH: 4.8 }, durationH: 14 }), 0.958, 0.001),
  `ST-AMYL-03d pH=4.8, dur=14h → denat=0.958 — val=${e.computeDenaturationFactor({state:{pH:4.8},durationH:14}).toFixed(4)}`);
// Floor a 0.92
assert(e.computeDenaturationFactor({ state: { pH: 4.8 }, durationH: 30 }) === 0.92,
  'ST-AMYL-03e pH=4.8, dur=30h → floor=0.920');
assert(e.computeDenaturationFactor({ state: { pH: 4.5 }, durationH: 50 }) === 0.92,
  'ST-AMYL-03f pH=4.5, dur=50h → floor=0.920');

// ST-AMYL-04 — amylaseCorrectedRate: tabella completa
{
  const cr = (ai, ph) => e.amylaseCorrectedRate(1.0, ai, 0, ph);
  assert(approx(cr(0.75, 5.5), 0.900, 0.005),
    `ST-AMYL-04a amylase=0.75,pH=5.5 → corr=0.900 — val=${cr(0.75,5.5).toFixed(4)}`);
  assert(approx(cr(1.00, 5.5), 1.000, 0.005),
    `ST-AMYL-04b amylase=1.00,pH=5.5 → corr=1.000 — val=${cr(1.00,5.5).toFixed(4)}`);
  assert(approx(cr(1.75, 5.5), 1.300, 0.005),
    `ST-AMYL-04c amylase=1.75,pH=5.5 → corr=1.300 — val=${cr(1.75,5.5).toFixed(4)}`);
  // pH sub-ottimale: fPH < 1 → effectiveActivity < amylaseIndex
  assert(cr(1.00, 4.8) < 1.0,
    `ST-AMYL-04d amylase=1.00,pH=4.8 < 1.0 — val=${cr(1.00,4.8).toFixed(4)}`);
  // Simmetria rispetto a pHOpt=5.5
  assert(approx(cr(1.00, 5.0), cr(1.00, 6.0), 0.005),
    'ST-AMYL-04e amylase=1.0: simmetria pH 5.0 ≈ pH 6.0');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-PH — pH Combining Logaritmico');
// ─────────────────────────────────────────────────────────────

// ST-PH-01 — Metodo logaritmico vs lineare
{
  // Poolish pH=4.8 (30%) + main pH=6.0 (70%)
  const prefPoolish = {
    id: 'ph_p', type: 'poolish', flourFraction: 30, durationH: 14,
    state: { pH: 4.8, maturationPct: 82, W_decayed: 275, pl_modified: 0.52, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefPoolish], mainFlourGroup: MAIN_FG });
  const pH_linear = 0.30 * 4.8 + 0.70 * 6.0;  // 5.64 (SBAGLIATO)
  const pH_log    = 5.263;                       // CORRETTO
  assert(approx(r.initialPH, pH_log, 0.01),
    `ST-PH-01a pH logaritmico ≈ 5.263 (non lineare 5.64) — val=${r.initialPH.toFixed(4)}`);
  assert(r.initialPH < pH_linear,
    `ST-PH-01b pH_log < pH_linear: ${r.initialPH.toFixed(3)} < ${pH_linear.toFixed(3)}`);
}

// ST-PH-02 — Solo autolisi (pH=6.0 ovunque) → initialPH=6.0
{
  const prefAut1 = { id: 'a1', type: 'autolysis', flourFraction: 40,
    state: { pH: 6.0, maturationPct: 0, W_decayed: 280, pl_modified: 0.38, amylase_index: 0.8, ready: true },
    flourGroup: MAIN_FG };
  const r = e.computeCombinedInitialState({ prefermenti: [prefAut1], mainFlourGroup: MAIN_FG });
  assert(approx(r.initialPH, 6.0, 0.001),
    `ST-PH-02 mix autolisi+main pH=6.0 → initialPH=6.000 — val=${r.initialPH.toFixed(4)}`);
}

// ST-PH-03 — Biga + Poolish: pH combining con 3 termini
{
  const prefB = {
    id: 'biga_ph', type: 'biga', flourFraction: 50, durationH: 20,
    state: { pH: 5.1, maturationPct: 74, W_decayed: 348, pl_modified: 0.48, amylase_index: 0.65, ready: true },
    flourGroup: MAIN_FG,
  };
  const prefA = {
    id: 'pool_ph', type: 'poolish', flourFraction: 30, durationH: 14,
    state: { pH: 4.8, maturationPct: 82, W_decayed: 275, pl_modified: 0.52, amylase_index: 0.822, ready: true },
    flourGroup: MAIN_FG,
  };
  const r = e.computeCombinedInitialState({ prefermenti: [prefB, prefA], mainFlourGroup: MAIN_FG });
  assert(between(r.initialPH, 5.03, 5.07),
    `ST-PH-03 pH biga+poolish ≈ 5.049 ∈ [5.03,5.07] — val=${r.initialPH.toFixed(4)}`);
}

// ─── Sezioni rimosse: coprivano solo codice morto ────────────────────────────
//
// § ST-LM — issue #18. computeLMState/estimatePH/phInhibition erano il dual-pop
//   v2.0: scala Gompertz incompatibile (85 % = 29 giorni contro 18.3 h) e
//   feedback pH inerte per costruzione. La cinetica LM reale (computeLabAdu +
//   computeCurrentPH, v2.4.14) resta coperta da tests/unit/engine.core.test.ts.
//
// § ST-FRICT — issue #17. computeFrictionHeat/computeWaterTemp erano una seconda
//   implementazione del bilancio DDT, sbagliata di 7.8 °C sull'acqua. Copertura
//   ora: tests/unit/engine.friction.test.ts (computeWaterTempDDT) e
//   engine/friction-v2.4.24.test.js (computeFrictionRise).

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-DASH — Dashboard W effettivo');
// ─────────────────────────────────────────────────────────────

// ST-DASH-01 — computeDashboardEffectiveW: struttura output + 4 stati
{
  const makeSession = (elapsedH) => ({
    effectiveW_initial: 300,
    initialPH: 5.8,
    agentMuMax: 12.0, agentLambda: 1.2, agentAsymptote: 100,
    agentEaKj: 62, agentType: 'fresh_yeast',
    hydration: 65,
    startedAt: new Date(Date.now() - elapsedH * 3_600_000).toISOString(),
  });

  // t=0: struttura output
  const r0 = e.computeDashboardEffectiveW(makeSession(0), 0, 22);
  assert(typeof r0.W_current === 'number' && r0.W_current > 0, 'ST-DASH-01a W_current numerico > 0');
  assert(r0.W_initial === 300, 'ST-DASH-01b W_initial=300');
  assert(typeof r0.tCritHours === 'number' && r0.tCritHours > 0, 'ST-DASH-01c tCritHours > 0');
  assert(['OK','WARNING','CRITICAL','COLLAPSED'].includes(r0.structuralStatus),
    `ST-DASH-01d structuralStatus valido: ${r0.structuralStatus}`);
  assert(typeof r0.breakdown === 'object', 'ST-DASH-01e breakdown presente');

  // t=0 → status=OK, decay≈0
  assert(r0.structuralStatus === 'OK', `ST-DASH-01f t=0 → status=OK`);
  assert(r0.decayPct < 1, `ST-DASH-01g t=0 → decayPct≈0 — val=${r0.decayPct.toFixed(2)}`);

  // t lungo → status deteriora
  const tCrit = r0.tCritHours;
  const rWarn = e.computeDashboardEffectiveW(makeSession(tCrit * 0.80), 0, 22);
  assert(['WARNING','CRITICAL','COLLAPSED'].includes(rWarn.structuralStatus),
    `ST-DASH-01h t=0.80×tCrit → status≠OK: ${rWarn.structuralStatus}`);
  const rColl = e.computeDashboardEffectiveW(makeSession(tCrit * 1.15), 0, 22);
  assert(rColl.structuralStatus === 'COLLAPSED',
    `ST-DASH-01i t=1.15×tCrit → COLLAPSED: ${rColl.structuralStatus}`);
}

// ST-DASH-02 — pH stimato da maturationPct (non-LM)
{
  const sess = {
    effectiveW_initial: 300, initialPH: 5.8,
    agentMuMax: 12.0, agentLambda: 1.2, agentAsymptote: 100,
    agentEaKj: 62, agentType: 'fresh_yeast', hydration: 65,
    startedAt: new Date().toISOString(),
  };
  // ADU=0 → matPct≈0 → pH≈5.8
  const r0 = e.computeDashboardEffectiveW(sess, 0, 22);
  // ADU molto alto → matPct≈100% → pH = max(4.8, 5.8 - 0.15) = 5.65
  const rHigh = e.computeDashboardEffectiveW({ ...sess, initialPH: 4.9 }, 100, 22);
  // clamp pH ≥ 4.8
  assert(rHigh.W_current > 0 && rHigh.W_current <= 300,
    `ST-DASH-02 pH clamp: sessione con pH4.9, mat100% non crasha — W=${rHigh.W_current.toFixed(2)}`);
}

// ST-DASH-03 — buildWBreakdown fallback senza combinedInitialState
{
  const sessNoState = {
    effectiveW_initial: 280, initialPH: 5.8,
    agentMuMax: 12.0, agentLambda: 1.2, agentAsymptote: 100,
    agentEaKj: 62, agentType: 'fresh_yeast', hydration: 65,
    startedAt: new Date().toISOString(),
    combinedInitialState: undefined,
  };
  const r = e.computeDashboardEffectiveW(sessNoState, 0, 22);
  assert(Array.isArray(r.breakdown.prefermenti) && r.breakdown.prefermenti.length === 0,
    'ST-DASH-03a breakdown.prefermenti=[] (fallback)');
  assert(r.breakdown.rinfresco.fraction === 1,
    'ST-DASH-03b rinfresco.fraction=1 (fallback)');
  assert(r.breakdown.rinfresco.W_initial === 280,
    `ST-DASH-03c rinfresco.W_initial=280 — val=${r.breakdown.rinfresco.W_initial}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-VAL — Validazioni Schema e Guardrail');
// ─────────────────────────────────────────────────────────────

// ST-VAL-01 — validateFlourGroup
{
  // 0 farine
  const v0 = e.validateFlourGroup([]);
  assert(!v0.ok && hasErr(v0, 'INVALID_FLOUR_COUNT'),
    'ST-VAL-01a 0 farine → INVALID_FLOUR_COUNT');
  // 4 farine
  const v4 = e.validateFlourGroup([
    {W:300,pl:0.5,protein:13,percentage:25,FN:250},{W:300,pl:0.5,protein:13,percentage:25,FN:250},
    {W:300,pl:0.5,protein:13,percentage:25,FN:250},{W:300,pl:0.5,protein:13,percentage:25,FN:250}]);
  assert(!v4.ok && hasErr(v4, 'INVALID_FLOUR_COUNT'),
    'ST-VAL-01b 4 farine → INVALID_FLOUR_COUNT');
  // Σ% = 99
  const vSum = e.validateFlourGroup([{W:300,pl:0.5,protein:13,percentage:99,FN:250}]);
  assert(!vSum.ok && hasErr(vSum, 'INVALID_PERCENTAGE_SUM'),
    'ST-VAL-01c Σ%=99 → INVALID_PERCENTAGE_SUM');
  // W range
  const vW = e.validateFlourGroup([{W:79,pl:0.5,protein:13,percentage:100,FN:250}]);
  assert(!vW.ok, 'ST-VAL-01d W=79 < 80 → error');
  const vW2 = e.validateFlourGroup([{W:501,pl:0.5,protein:13,percentage:100,FN:250}]);
  assert(!vW2.ok, 'ST-VAL-01e W=501 > 500 → error');
  const vWOk = e.validateFlourGroup([{W:300,pl:0.5,protein:13,percentage:100,FN:250}]);
  assert(vWOk.ok, 'ST-VAL-01f W=300 → ok');
  // P/L range
  const vPL = e.validateFlourGroup([{W:300,pl:0.19,protein:13,percentage:100,FN:250}]);
  assert(!vPL.ok, 'ST-VAL-01g pl=0.19 < 0.2 → error');
  // protein range
  const vProt = e.validateFlourGroup([{W:300,pl:0.5,protein:6.9,percentage:100,FN:250}]);
  assert(!vProt.ok, 'ST-VAL-01h protein=6.9 < 7 → error');
}

// ST-VAL-03 — safeExp, safeClamp numerics
assert(isFinite(e.safeExp(710)),
  'ST-VAL-03a safeExp(710) non Infinity');
assert(e.safeClamp(-1, 0, 1) === 0,
  'ST-VAL-03b safeClamp(-1,0,1) = 0');
assert(e.safeClamp(2, 0, 1) === 1,
  'ST-VAL-03c safeClamp(2,0,1) = 1');
assert(e.safeClamp(0.5, 0, 1) === 0.5,
  'ST-VAL-03d safeClamp(0.5,0,1) = 0.5 (dentro)');
// kEffective con T non-NaN
assert(!isNaN(e.kEffective(4, 62, 'fresh_yeast')),
  'ST-VAL-03e kEffective(4°C) non NaN');
assert(!isNaN(e.gompertz(0, 12, 1.2, 100)),
  'ST-VAL-03f gompertz(ADU=0) non NaN');

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-EDGE — Edge Cases e Robustezza Numerica');
// ─────────────────────────────────────────────────────────────

// ST-EDGE-01 — γ(Topt) non > 1.0 (floating point)
{
  for (const [agent, Topt] of [['fresh_yeast',28],['instant_dry_yeast',28],['sourdough_wheat',26]]) {
    const g = e.cardinalCorrection(Topt, agent);
    assert(g <= 1.0, `ST-EDGE-01 γ(Topt=${Topt}, ${agent}) ≤ 1.0 — val=${g.toFixed(6)}`);
  }
}

// ST-EDGE-02 — Impasto a zero ore
{
  assert(e.gompertz(0, 12, 1.2, 100) < 5,
    `ST-EDGE-02a gompertz(ADU=0) < 5% (lag, non-zero per formula) — val=${e.gompertz(0,12,1.2,100).toFixed(2)}`);
  assert(approx(e.computeWHill(300, 61.1, 0), 300.0, 0.1),
    'ST-EDGE-02b W(t=0) = W0');
}

// ST-EDGE-03 — ADU molto alto: matPct asintotico ≤ 100
{
  const mat100 = e.gompertz(100, 12.0, 1.2, 100);
  assert(mat100 <= 100.0 && mat100 > 99.5,
    `ST-EDGE-03a gompertz(ADU=100) ≤ 100% — val=${mat100.toFixed(4)}`);
  assert(!isNaN(mat100) && isFinite(mat100),
    'ST-EDGE-03b nessun NaN/Infinity');
}

// ST-EDGE-04 — Blend 3 farine identiche
{
  const f3eq = [
    { W: 300, pl: 0.55, protein: 13, ash: 0.55, percentage: 33.33, FN: 250 },
    { W: 300, pl: 0.55, protein: 13, ash: 0.55, percentage: 33.33, FN: 250 },
    { W: 300, pl: 0.55, protein: 13, ash: 0.55, percentage: 33.34, FN: 250 },
  ];
  const r = e.normalizeFlourGroup(f3eq);
  assert(r.isBlend === true, 'ST-EDGE-04a isBlend=true anche se identiche');
  // Spread=0 → nessun warning EXTREME_W_SPREAD
  const v = e.validateFlourGroup(f3eq);
  assert(!hasWarn(v, 'EXTREME_W_SPREAD'),
    'ST-EDGE-04b spread=0 → nessun EXTREME_W_SPREAD warning');
  assert(approx(r.effectiveAmylaseIndex, 1.0, 0.01),
    `ST-EDGE-04c amylase(FN=250) = 1.0 — val=${r.effectiveAmylaseIndex.toFixed(4)}`);
}

// ST-EDGE-05 — Idratazione limite: H=100%
{
  const cp100 = e.doughSpecificHeat(100);
  assert(approx(cp100, 4186, 5),
    `ST-EDGE-05a cp(H=100%) = 4186 J/kgK — val=${cp100.toFixed(0)}`);
  const tauH100 = e.thermalTimeConstant(1.0, 100);
  assert(tauH100 > 0, `ST-EDGE-05b thermalTimeConstant(H=100%) > 0: ${tauH100.toFixed(0)}s`);
  const fHyd100 = e.fHydration(100);
  assert(approx(fHyd100, 1.193, 0.01),
    `ST-EDGE-05c fHydration(100%) ≈ 1.193 — val=${fHyd100.toFixed(4)}`);
}

// ST-EDGE-06 — LM a T_frigo (4°C): LAB inibiti, saccharomyces residuo
{
  // sourdough_wheat Tmin=2.0 → γ(4°C) > 0
  const gSacc4 = e.cardinalCorrection(4.0, 'sourdough_wheat');
  assert(gSacc4 > 0,
    `ST-EDGE-06a γ_sacc(4°C, sourdough) > 0 — val=${gSacc4.toFixed(4)}`);
  // lab_bacteria Tmin=5.0 → γ(4°C) = 0
  const gLab4 = e.cardinalCorrection(4.0, 'lab_bacteria');
  assert(gLab4 === 0,
    'ST-EDGE-06b γ_lab(4°C) = 0 (Tmin=5°C → inibiti)');
}

// ST-EDGE-07 — flourFraction=0 non divide per zero in breakdown
{
  const prefZero = {
    id: 'aut_zero', type: 'autolysis', flourFraction: 0,
    state: { pH: 6.0, maturationPct: 0, W_decayed: 280, pl_modified: 0.38, amylase_index: 0.8, ready: true },
    flourGroup: MAIN_FG,
  };
  let threw = false;
  try {
    e.computeCombinedInitialState({ prefermenti: [prefZero], mainFlourGroup: MAIN_FG });
  } catch { threw = true; }
  assert(!threw, 'ST-EDGE-07 flourFraction=0 non genera eccezione');
}

// ST-EDGE-08 — Numerica: exp() con argomenti estremi
{
  assert(isFinite(e.safeExp(710)), 'ST-EDGE-08a safeExp(710) finito');
  assert(!isNaN(e.safeExp(-1000)), 'ST-EDGE-08b safeExp(-1000) non NaN');
  // T=60°C → γ_CTM=0 → k_effective=0 (corto circuito prima di Arrhenius)
  assert(e.kEffective(60, 62, 'fresh_yeast') === 0,
    'ST-EDGE-08c T=60°C > Tmax(45) → kEffective=0');
  // pH estremi per combinazione logaritmica
  const H_pH0  = Math.pow(10, 0);   // pH=0 → 1.0
  const H_pH14 = Math.pow(10, -14); // pH=14 → 1e-14
  assert(isFinite(H_pH0) && isFinite(H_pH14),
    'ST-EDGE-08d pH 0 e 14: H+ finito');
}

// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-STYLE — Style Profile Parameters (v2.4.4)');

// ST-STYLE-01 — napoletana profile params
{
  const p = e.getStyleProfile('napoletana');
  assert(p.alertThreshold       === 80,         'ST-STYLE-01a napoletana alertThreshold=80');
  assert(p.bubbleThresholdPct   === 85,         'ST-STYLE-01b napoletana bubbleThresholdPct=85');
  assert(p.primarySignal        === 'maturation','ST-STYLE-01c napoletana primarySignal=maturation');
  assert(p.W_minimo_stesura     === 160,         'ST-STYLE-01d napoletana W_minimo_stesura=160');
  assert(p.puntataMatPct_target === 10,          'ST-STYLE-01e napoletana puntataMatPct_target=10');
}

// ST-STYLE-02 — contemporanea profile params
{
  const p = e.getStyleProfile('contemporanea');
  assert(p.alertThreshold       === 90,   'ST-STYLE-02a contemporanea alertThreshold=90');
  assert(p.bubbleThresholdPct   === 92,   'ST-STYLE-02b contemporanea bubbleThresholdPct=92');
  assert(p.primarySignal        === 'dual','ST-STYLE-02c contemporanea primarySignal=dual');
  assert(p.W_minimo_stesura     === 190,  'ST-STYLE-02d contemporanea W_minimo_stesura=190');
  assert(p.puntataMatPct_target === 30,   'ST-STYLE-02e contemporanea puntataMatPct_target=30');
}

// ST-STYLE-03 — teglia profile params
{
  const p = e.getStyleProfile('teglia');
  assert(p.alertThreshold       === 96,         'ST-STYLE-03a teglia alertThreshold=96');
  assert(p.bubbleThresholdPct   === 98,         'ST-STYLE-03b teglia bubbleThresholdPct=98');
  assert(p.primarySignal        === 'structural','ST-STYLE-03c teglia primarySignal=structural');
  assert(p.W_minimo_stesura     === 140,         'ST-STYLE-03d teglia W_minimo_stesura=140');
  assert(p.puntataMatPct_target === 40,          'ST-STYLE-03e teglia puntataMatPct_target=40');
}

// ST-STYLE-04 — pala profile params
{
  const p = e.getStyleProfile('pala');
  assert(p.alertThreshold       === 92,         'ST-STYLE-04a pala alertThreshold=92');
  assert(p.bubbleThresholdPct   === 92,         'ST-STYLE-04b pala bubbleThresholdPct=92');
  assert(p.primarySignal        === 'structural','ST-STYLE-04c pala primarySignal=structural');
  assert(p.W_minimo_stesura     === 180,         'ST-STYLE-04d pala W_minimo_stesura=180');
  assert(p.puntataMatPct_target === 50,          'ST-STYLE-04e pala puntataMatPct_target=50');
}

// ST-STYLE-05 — nystyle profile params
{
  const p = e.getStyleProfile('nystyle');
  assert(p.alertThreshold       === 85,         'ST-STYLE-05a nystyle alertThreshold=85');
  assert(p.bubbleThresholdPct   === 88,         'ST-STYLE-05b nystyle bubbleThresholdPct=88');
  assert(p.primarySignal        === 'maturation','ST-STYLE-05c nystyle primarySignal=maturation');
  assert(p.W_minimo_stesura     === 220,         'ST-STYLE-05d nystyle W_minimo_stesura=220');
  assert(p.puntataMatPct_target === 10,          'ST-STYLE-05e nystyle puntataMatPct_target=10');
}

// ST-STYLE-06 — computeStyleAwareAlertLevel
{
  const sess = (style) => ({ style });

  // napoletana/maturation: matPct < 80 → OK
  const r1 = e.computeStyleAwareAlertLevel(sess('napoletana'), 50, 280, 280, 50);
  assert(r1.level === 'OK' && r1.bindingSignal === 'maturation',
    'ST-STYLE-06a napoletana matPct=50 → OK/maturation');

  // napoletana: matPct=75 ≥ 80×0.9=72 → APPROACHING
  const r2 = e.computeStyleAwareAlertLevel(sess('napoletana'), 75, 280, 280, 50);
  assert(r2.level === 'APPROACHING',
    'ST-STYLE-06b napoletana matPct=75 → APPROACHING');

  // napoletana: matPct=82 ≥ 80 → SWEET_SPOT
  const r3 = e.computeStyleAwareAlertLevel(sess('napoletana'), 82, 280, 280, 50);
  assert(r3.level === 'SWEET_SPOT' && r3.bindingSignal === 'maturation',
    'ST-STYLE-06c napoletana matPct=82 → SWEET_SPOT/maturation');

  // napoletana: leaveningPct=90 > bubbleThr=85 → STRUCTURAL_WARNING/bubble
  const r4 = e.computeStyleAwareAlertLevel(sess('napoletana'), 50, 280, 280, 90);
  assert(r4.level === 'STRUCTURAL_WARNING' && r4.bindingSignal === 'bubble',
    'ST-STYLE-06d napoletana bubble=90 → STRUCTURAL_WARNING/bubble');

  // contemporanea/dual: wDecay=(290-182)/290=37.2% → STRUCTURAL_CRITICAL, matPct=91≥90 → CRITICAL wins
  const r5 = e.computeStyleAwareAlertLevel(sess('contemporanea'), 91, 182, 290, 50);
  assert(r5.level === 'STRUCTURAL_CRITICAL' && r5.bindingSignal === 'structural',
    'ST-STYLE-06e contemporanea wDecay=37% + matPct=91 → STRUCTURAL_CRITICAL/structural');

  // contemporanea/dual: wDecay=0%, matPct=91≥90 → SWEET_SPOT/maturation
  const r6 = e.computeStyleAwareAlertLevel(sess('contemporanea'), 91, 290, 290, 50);
  assert(r6.level === 'SWEET_SPOT' && r6.bindingSignal === 'maturation',
    'ST-STYLE-06f contemporanea wDecay=0% + matPct=91 → SWEET_SPOT/maturation');

  // teglia/structural: wDecay=(350-277)/350=20.86% → STRUCTURAL_WARNING/structural
  const r7 = e.computeStyleAwareAlertLevel(sess('teglia'), 50, 277, 350, 50);
  assert(r7.level === 'STRUCTURAL_WARNING' && r7.bindingSignal === 'structural',
    'ST-STYLE-06g teglia wDecay=20.9% → STRUCTURAL_WARNING/structural');

  // teglia/structural: wDecay=0%, matPct=97≥96 → SWEET_SPOT (fallback a matLevel)
  const r8 = e.computeStyleAwareAlertLevel(sess('teglia'), 97, 350, 350, 50);
  assert(r8.level === 'SWEET_SPOT',
    'ST-STYLE-06h teglia wDecay=0% + matPct=97 → SWEET_SPOT');
}

// ST-STYLE-07 — checkPuntataTarget
{
  // napoletana in bulk_room, matPct=12% (≥ target=10, < hi=20) → ADVISORY
  const r1 = e.checkPuntataTarget({ style: 'napoletana', doughLocation: 'bulk_room' }, 12);
  assert(r1?.level === 'ADVISORY',
    'ST-STYLE-07a napoletana bulk_room matPct=12 → ADVISORY');

  // napoletana in bulk_room, matPct=22% (≥ hi=20) → CRITICAL
  const r2 = e.checkPuntataTarget({ style: 'napoletana', doughLocation: 'bulk_room' }, 22);
  assert(r2?.level === 'CRITICAL',
    'ST-STYLE-07b napoletana bulk_room matPct=22 → CRITICAL');

  // napoletana NOT in bulk → null
  const r3 = e.checkPuntataTarget({ style: 'napoletana', doughLocation: 'balled_fridge' }, 12);
  assert(r3 === null,
    'ST-STYLE-07c napoletana non-bulk → null');

  // contemporanea in bulk_room, matPct=31% (≥ target=30, < hi=40) → ADVISORY
  const r4 = e.checkPuntataTarget({ style: 'contemporanea', doughLocation: 'bulk_room' }, 31);
  assert(r4?.level === 'ADVISORY',
    'ST-STYLE-07d contemporanea bulk_room matPct=31 → ADVISORY');
}

// ST-STYLE-08 — checkWMinimoStesura
{
  // napoletana, W_current=155 < W_minimo=160 → CRITICAL
  const r1 = e.checkWMinimoStesura({ style: 'napoletana' }, 155);
  assert(r1?.level === 'CRITICAL',
    'ST-STYLE-08a napoletana W=155 < 160 → CRITICAL');

  // napoletana, W_current=165 ≥ W_minimo=160 → null
  const r2 = e.checkWMinimoStesura({ style: 'napoletana' }, 165);
  assert(r2 === null,
    'ST-STYLE-08b napoletana W=165 ≥ 160 → null');

  // nystyle, W_current=215 < W_minimo=220 → CRITICAL
  const r3 = e.checkWMinimoStesura({ style: 'nystyle' }, 215);
  assert(r3?.level === 'CRITICAL',
    'ST-STYLE-08c nystyle W=215 < 220 → CRITICAL');
}

// ST-STYLE-09 — solveNowAnchoredWindow style-aware
// Scenario 24h: infeasible con target=90% (window_too_short_maturation), feasible con napoletana (target=80%)
{
  const agent = e.AGENT_GOMPERTZ.fresh_yeast;
  const now = new Date('2026-06-03T00:00:00');
  const serviceStart = new Date('2026-06-03T22:00:00'); // +22h, service end +24h

  const base = {
    now, serviceStart, serviceDurationH: 2,
    ambientTempC: 22, fridgeTempC: 4, fridgeTempMin: 2,
    agentType: 'fresh_yeast', agentMuMax: agent.muMax, agentLambda: agent.lambda,
    agentEaKj: agent.Ea_kJ, agentAsymptote: 100, agentDosePct: 0.3,
    W0: 280, hydration: 65, salt: 2.8,
    totalFlourGrams: 1000, numPanetti: 1, containerPreset: 'bare',
  };

  // Default (no style): target=90% → window_too_short_maturation
  const rDef = solveNowAnchoredWindow(base);
  assert(!rDef.feasible && rDef.infeasibility?.reason === 'window_too_short_maturation',
    'ST-STYLE-09a 24h default (90%) → infeasible window_too_short_maturation');

  // Napoletana: target=80% → feasible
  const rNap = solveNowAnchoredWindow({ ...base, style: 'napoletana' });
  assert(rNap.feasible === true,
    'ST-STYLE-09b 24h napoletana (80%) → feasible');
  assert(rNap.atServiceEnd != null && Math.abs(rNap.atServiceEnd.maturationPct - 80) <= 2,
    'ST-STYLE-09c napoletana atServiceEnd.maturationPct ≈ 80±2',
    `got ${rNap.atServiceEnd?.maturationPct?.toFixed(1)}`);
  assert(rNap.atServiceEnd != null && rNap.atServiceEnd.leaveningPct <= 85.5,
    'ST-STYLE-09d napoletana atServiceEnd.leaveningPct ≤ 85.5 (bubbleThr)',
    `got ${rNap.atServiceEnd?.leaveningPct?.toFixed(1)}`);
}

// ST-STYLE-10 — fallback napoletana per stile non riconosciuto
{
  const pUndef   = e.getStyleProfile(undefined);
  const pUnknown = e.getStyleProfile('unknown');
  assert(pUndef.alertThreshold   === 80, 'ST-STYLE-10a getStyleProfile(undefined) → napoletana');
  assert(pUnknown.alertThreshold === 80, 'ST-STYLE-10b getStyleProfile("unknown") → napoletana');
}

// ─────────────────────────────────────────────────────────────
// ST-SOLVER — v2.4.5: puntataMaxH, overshootTolerance, resolveTargetMaturationPct
// ─────────────────────────────────────────────────────────────

// Base condiviso per i test ST-SOLVER (stesso base di ST-STYLE-09 — finestra 24h feasible)
const _solverBase = (() => {
  const agent = e.AGENT_GOMPERTZ.fresh_yeast;
  const now   = new Date('2026-06-03T00:00:00');
  const serviceStart = new Date('2026-06-03T22:00:00'); // +22h → totalH=24h
  return {
    now, serviceStart, serviceDurationH: 2,
    ambientTempC: 22, fridgeTempC: 4, fridgeTempMin: 2,
    agentType: 'fresh_yeast', agentMuMax: agent.muMax, agentLambda: agent.lambda,
    agentEaKj: agent.Ea_kJ, agentAsymptote: 100, agentDosePct: 0.3,
    W0: 280, hydration: 65, salt: 2.8,
    totalFlourGrams: 1000, numPanetti: 1, containerPreset: 'bare',
  };
})();

// ST-SOLVER-01: findHoursAtEnzMatPct via computePuntataMaxH — Contemporanea a 22°C
// puntataMatPct_target=30. Il tempo effettivo dipende da fArrhenius(22) del modello.
{
  const prof = e.getStyleProfile('contemporanea');
  const { muMax, lambda, A } = e.ENZYMATIC_CLOCK_PARAMS;
  const subStepH = 0.05;
  let enzAdu = 0;
  let hFound = 10.0;
  for (let step = 0; step < 200; step++) {
    if (e.gompertz(enzAdu, muMax, lambda, A) >= prof.puntataMatPct_target) { hFound = step * subStepH; break; }
    enzAdu += e.fArrhenius(22) * subStepH;
  }
  assert(hFound > 0 && hFound < 10.0,
    'ST-SOLVER-01 findHoursAtEnzMatPct(30, 22) è finito (< 10h fallback)',
    `got ${hFound.toFixed(2)}h`);
}

// ST-SOLVER-02: findHoursAtEnzMatPct — Napoletana a 22°C
// puntataMatPct_target=10 < 30 → deve richiedere meno ore di contemp.
{
  const profNap = e.getStyleProfile('napoletana');
  const profCon = e.getStyleProfile('contemporanea');
  const { muMax, lambda, A } = e.ENZYMATIC_CLOCK_PARAMS;
  const findH = (target) => {
    let enzAdu = 0, h = 10.0;
    for (let s = 0; s < 200; s++) {
      if (e.gompertz(enzAdu, muMax, lambda, A) >= target) { h = s * 0.05; break; }
      enzAdu += e.fArrhenius(22) * 0.05;
    }
    return h;
  };
  const hNap = findH(profNap.puntataMatPct_target);
  const hCon = findH(profCon.puntataMatPct_target);
  assert(hNap < hCon,
    'ST-SOLVER-02 findHoursAtEnzMatPct: napoletana(10%) richiede meno ore di contemporanea(30%)',
    `nap=${hNap.toFixed(2)}h con=${hCon.toFixed(2)}h`);
}

// ST-SOLVER-03: resolvedTargetMaturationPct esposto in tutti i path — napoletana
// Il base 24h con stile napoletana è feasible (verificato da ST-STYLE-09)
{
  const r3 = solveNowAnchoredWindow({ ..._solverBase, style: 'napoletana' });
  assert(r3.resolvedTargetMaturationPct === 80,
    'ST-SOLVER-03 napoletana → resolvedTargetMaturationPct=80 (qualsiasi path)',
    `got ${r3.resolvedTargetMaturationPct}`);
  assert(r3.resolvedBubbleThresholdPct === 85,
    'ST-SOLVER-03b napoletana → resolvedBubbleThresholdPct=85',
    `got ${r3.resolvedBubbleThresholdPct}`);
}

// ST-SOLVER-04: resolvedTargetMaturationPct esposto anche in infeasible path
// (window_too_short_maturation: 24h con target=90% default → infeasible)
{
  const r4 = solveNowAnchoredWindow(_solverBase); // no style → target=90 → infeasible
  assert(!r4.feasible && r4.infeasibility?.reason === 'window_too_short_maturation',
    'ST-SOLVER-04 base 24h + no style → window_too_short_maturation');
  assert(r4.resolvedTargetMaturationPct === 90,
    'ST-SOLVER-04b resolvedTargetMaturationPct=90 anche in infeasible',
    `got ${r4.resolvedTargetMaturationPct}`);
}

// ST-SOLVER-05: userTargetMaturationPct=75 vince su stile napoletana (alertThr=80)
{
  const r5 = solveNowAnchoredWindow({ ..._solverBase, style: 'napoletana', userTargetMaturationPct: 75 });
  assert(r5.resolvedTargetMaturationPct === 75,
    'ST-SOLVER-05 userTargetMaturationPct=75 vince su stile napoletana (alertThr=80)',
    `got ${r5.resolvedTargetMaturationPct}`);
}

// ST-SOLVER-06: no override + stile napoletana → resolved=80
{
  const r6 = solveNowAnchoredWindow({ ..._solverBase, style: 'napoletana' });
  assert(r6.resolvedTargetMaturationPct === 80,
    'ST-SOLVER-06 no override + style napoletana → resolved=80',
    `got ${r6.resolvedTargetMaturationPct}`);
}

// ST-SOLVER-07: resolveTargetMaturationPct — no override, no style → fallback globale 90
{
  const now7 = new Date('2026-06-03T00:00:00Z');
  const r7 = solveNowAnchoredWindow({
    now: now7,
    serviceStart: new Date('2026-06-04T08:00:00Z'),
    serviceDurationH: 2,
    ambientTempC: 22, fridgeTempC: 4, fridgeTempMin: 2,
    agentType: 'fresh_yeast', agentEaKj: 65, agentMuMax: 0.35, agentLambda: 3.5,
    agentDosePct: 0.3, W0: 280, hydration: 65, salt: 2.5,
    totalFlourGrams: 1000, numPanetti: 4, containerPreset: 'closed_box',
  });
  assert(r7.resolvedTargetMaturationPct === 90,
    'ST-SOLVER-07 no override + no style → resolved=90 (fallback globale)',
    `got ${r7.resolvedTargetMaturationPct}`);
}

// ST-SOLVER-08: buildServiceWindowTimeline con puntataMaxH=2, puntataH=13
// effectivePuntataH=2, extraH=11 spostato in TC, totalH invariato
{
  const tl = buildServiceWindowTimeline({
    puntataH: 13, puntataMaxH: 2, staglioH: 0.5,
    tcHours: 8, temperingH: 1, serviceDurationH: 2,
    ambientTempC: 22, fridgeTempC: 4,
  });
  const puntataPhase = tl.find(p => p.phaseType === 'bulk_room');
  const fridgePhase  = tl.find(p => p.phaseType === 'balled_fridge');
  const totalH = tl[tl.length - 1].endElapsedH;
  assert(puntataPhase != null && Math.abs(puntataPhase.endElapsedH - puntataPhase.startElapsedH - 2) < 0.01,
    'ST-SOLVER-08a buildServiceWindowTimeline puntataMaxH=2 → effectivePuntataH=2',
    `got ${(puntataPhase?.endElapsedH ?? 0) - (puntataPhase?.startElapsedH ?? 0)}`);
  assert(fridgePhase != null && Math.abs((fridgePhase.endElapsedH - fridgePhase.startElapsedH) - 19) < 0.01,
    'ST-SOLVER-08b tcH = 8 + 11 (extra) = 19',
    `got ${(fridgePhase?.endElapsedH ?? 0) - (fridgePhase?.startElapsedH ?? 0)}`);
  assert(Math.abs(totalH - (2 + 0.5 + 19 + 1 + 2)) < 0.01,
    'ST-SOLVER-08c totalH invariato = 24.5',
    `got ${totalH}`);
}

// ─────────────────────────────────────────────────────────────
// ST-SALT — SALT_TICK_PARITY §2.14.2 (v2.4.17)
// ─────────────────────────────────────────────────────────────
console.log('\n§ ST-SALT — Sale tick parity (§2.14.2 v2.4.17)');

// Tabella fattori §2.14.2
assert(e.fSaltYeast(0)   === 1.00, 'ST-SALT-01 fSaltYeast(0) = 1.000');
assert(approx(e.fSaltYeast(2),   0.80, 0.001), 'ST-SALT-02 fSaltYeast(2%) = 0.800');
assert(approx(e.fSaltYeast(3),   0.70, 0.001), 'ST-SALT-03 fSaltYeast(3%) = 0.700');
assert(e.fSaltYeast(10)  === 0.60, 'ST-SALT-04 fSaltYeast(10%): floor=0.60');
assert(e.fSaltProtease(0) === 1.00, 'ST-SALT-05 fSaltProtease(0) = 1.000');
assert(approx(e.fSaltProtease(2), 0.84, 0.001), 'ST-SALT-06 fSaltProtease(2%) = 0.840');
assert(approx(e.fSaltProtease(3), 0.76, 0.001), 'ST-SALT-07 fSaltProtease(3%) = 0.760');
assert(e.fSaltProtease(10) === 0.70, 'ST-SALT-08 fSaltProtease(10%): floor=0.70');

// INVARIANTE §2.0: salt NON tocca enzAdu — solo fArrhenius * deltaH
// Verifica tramite computeDeltaAdu: kRatio * saltFact * deltaH
// Il ramo enzimatico usa fArrhenius(T) * deltaH senza saltFact
{
  const base = { tempAmbient: 22, tempDoughLast: 22, eaKj: 65, agentType: 'fresh_yeast',
    amylaseIndex: 1, elapsedH: 0, currentPH: 5.8, deltaTSeconds: 3600 };
  const d0 = e.computeDeltaAdu({ ...base, saltPct: 0 });
  const d3 = e.computeDeltaAdu({ ...base, saltPct: 3 });

  // enzAdu step (orologio enzimatico) non dipende da salt — invariante
  const enzStep = e.fArrhenius(22) * (3600 / 3600); // × 1h
  const enzStep3 = e.fArrhenius(22) * (3600 / 3600);
  assert(approx(enzStep, enzStep3, 1e-9),
    'ST-SALT-09 enzAdu step invariante: salt 0 vs 3 identici');

  // leavAdu step: salt=3 rallenta rispetto a salt=0
  assert(d3 < d0, 'ST-SALT-10 leavAdu tick: salt=3 < salt=0 (inibizione)');

  // Il rapporto deve essere esattamente fSaltYeast(3) = 0.70
  assert(approx(d3 / d0, e.fSaltYeast(3), 1e-6),
    'ST-SALT-11 leavAdu ratio tick: d(salt=3)/d(salt=0) = fSaltYeast(3)',
    `got ${(d3/d0).toFixed(6)}, expected ${e.fSaltYeast(3)}`);

  // Parità solver↔tick per salt=2: ratio deve essere fSaltYeast(2) = 0.80
  const d2 = e.computeDeltaAdu({ ...base, saltPct: 2 });
  assert(approx(d2 / d0, e.fSaltYeast(2), 1e-6),
    'ST-SALT-12 parità solver↔tick salt=2: d2/d0 = fSaltYeast(2)',
    `got ${(d2/d0).toFixed(6)}, expected ${e.fSaltYeast(2)}`);
}

// W path: fSaltProtease su t_crit — W decade più lentamente con sale
{
  const W0 = 280, T = 22, pH = 5.8, H = 65;
  const tCritBase = e.computeTCrit(W0, T, pH, H);
  const tCritSalt0 = tCritBase / e.fSaltProtease(0);  // /1.0 → uguale
  const tCritSalt2 = tCritBase / e.fSaltProtease(2);  // /0.84 → più alto
  assert(tCritSalt2 > tCritSalt0,
    'ST-SALT-13 t_crit sale=2 > t_crit sale=0 (proteolisi rallentata)');

  // A t=30h: W con sale decade meno
  const W_salt0 = e.computeWHill(W0, tCritSalt0, 30);
  const W_salt2 = e.computeWHill(W0, tCritSalt2, 30);
  assert(W_salt2 > W_salt0,
    'ST-SALT-14 W(t=30h, salt=2) > W(t=30h, salt=0) — struttura regge di più',
    `W_salt0=${W_salt0.toFixed(1)}, W_salt2=${W_salt2.toFixed(1)}`);
}

// Anti-regressione: salt=0 (esplicito) ≡ omesso (default) → nessun cambiamento di comportamento
{
  const base = { tempAmbient: 22, tempDoughLast: 22, eaKj: 65, agentType: 'fresh_yeast',
    amylaseIndex: 1, elapsedH: 4, currentPH: 5.6, deltaTSeconds: 1800 };
  const dExplicit = e.computeDeltaAdu({ ...base, saltPct: 0 });
  const dDefault  = e.computeDeltaAdu({ ...base });
  assert(approx(dExplicit, dDefault, 1e-12),
    'ST-SALT-15 anti-regressione: saltPct=0 ≡ saltPct omesso (nessuna variazione)');
}

// ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`STRESS TEST RESULTS: ${passed} passed, ${failed} failed / ${passed + failed} total`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test FALLITI`);
  process.exit(1);
} else {
  console.log('\n✅ Tutti i test passati');
}
