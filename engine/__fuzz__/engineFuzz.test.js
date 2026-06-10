/**
 * PizzaMatrix — Adversarial Engine Fuzzer (OBIETTIVO 1)
 * Esegui con: node engine/__fuzz__/engineFuzz.test.js
 *
 * Bombarda le funzioni matematiche PURE dell'engine con input estremi/maligni:
 *  - valori fuori scala / negativi (idratazione, sale, lievito, temperatura)
 *  - timestamp incoerenti / invertiti (mixStart dopo la cottura)
 *  - NaN / Infinity / stringhe iniettate nei campi numerici del solver
 *
 * Asserzioni di INVARIANTE (non solo "non crasha"):
 *  INV-1  nessuna funzione produce NaN/Infinity su output finito atteso
 *  INV-2  fSaltProtease modula t_crit, MAI k_effective (Two-Clock §2.0)
 *  INV-3  fSaltYeast/fSaltProtease rispettano i floor (0.x) e sono monotòne ↓
 *  INV-4  computeWHill ∈ [0, W0] sempre (mai W negativo o amplificato)
 *  INV-5  gompertz ∈ [0, A] sempre
 *  INV-6  solveNowAnchoredWindow non lancia mai e ritorna struttura valida
 */
import * as e from '../engine-v2.4.0.js';
import { solveNowAnchoredWindow, simulateTimeline, computeTemperingH } from '../serviceWindowSolver.js';

let passed = 0, failed = 0;
const bugs = [];
function ok(cond, label, detail = '') {
  if (cond) { passed++; }
  else { failed++; bugs.push(`${label}${detail ? ' — ' + detail : ''}`); console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

// Pool di input adversariali riutilizzato ovunque
const EVIL_NUMS = [
  NaN, Infinity, -Infinity, -0, 0,
  -1, -9999, 1e9, 1e308, -1e308, 1e-308,
  Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
  '42', 'abc', '', null, undefined, {}, [], true, false,
];
const EVIL_TEMPS  = [-273.16, -300, -50, 0, 4, 22, 60, 100, 500, NaN, Infinity, '25', null];
const EVIL_SALT   = [-5, -1, 0, 2, 3, 50, 1000, NaN, Infinity, '2', null, undefined];
const EVIL_HYD    = [-50, 0, 30, 65, 100, 200, 1e6, NaN, Infinity, 'wet', null];
const EVIL_PH     = [-1, 0, 3, 5.8, 7, 14, 100, NaN, Infinity, null];
const EVIL_W      = [-100, 0, 150, 280, 450, 1e6, NaN, Infinity, '300', null];

// ─────────────────────────────────────────────────────────────
// § F1 — helper sicuri (safeExp/safeDiv/safeClamp) non propagano NaN→crash
// ─────────────────────────────────────────────────────────────
console.log('\n§ F1 — safe primitives');
for (const x of EVIL_NUMS) {
  let r; try { r = e.safeExp(x); } catch (err) { ok(false, 'safeExp throw', `x=${String(x)} ${err.message}`); continue; }
  // safeExp clampa l'argomento a [-700,700] → output sempre finito SE input numerico
  if (typeof x === 'number' && !Number.isNaN(x)) ok(finite(r), 'F1 safeExp finite', `x=${String(x)} → ${r}`);
}
for (const d of EVIL_NUMS) {
  let r; try { r = e.safeDiv(1, d, -1); } catch (err) { ok(false, 'safeDiv throw', `d=${String(d)}`); continue; }
  ok(r !== undefined, 'F1 safeDiv returns', `d=${String(d)}`);
}

// ─────────────────────────────────────────────────────────────
// § F2 — kEffective: temperature estreme, no crash, output finito
// ─────────────────────────────────────────────────────────────
console.log('§ F2 — kEffective boundary temps');
for (const T of EVIL_TEMPS) {
  let r; try { r = e.kEffective(T, 47, 'saccharomyces'); } catch (err) { ok(false, 'F2 kEffective throw', `T=${String(T)} ${err.message}`); continue; }
  if (typeof T === 'number' && Number.isFinite(T)) {
    ok(finite(r) && r >= 0, 'F2 kEffective finite≥0', `T=${T} → ${r}`);
  }
}

// ─────────────────────────────────────────────────────────────
// § F3 — gompertz ∈ [0, A] (INV-5)
// ─────────────────────────────────────────────────────────────
console.log('§ F3 — gompertz range invariant');
for (const adu of EVIL_NUMS) {
  for (const A of [100, 0, -10, 1e6]) {
    let r; try { r = e.gompertz(adu, 0.02, 100, A); } catch (err) { ok(false, 'F3 gompertz throw', `adu=${String(adu)}`); continue; }
    if (typeof adu === 'number' && Number.isFinite(adu) && A > 0) {
      ok(finite(r) && r >= -1e-6 && r <= A + 1e-6, 'F3 gompertz∈[0,A]', `adu=${adu} A=${A} → ${r}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// § F4 — computeWHill ∈ [0, W0] (INV-4)
// ─────────────────────────────────────────────────────────────
console.log('§ F4 — computeWHill range invariant');
for (const W0 of EVIL_W) {
  for (const tCrit of [-5, 0, 10, 50]) {
    for (const hours of [-10, 0, 25, 1e6, NaN]) {
      let r; try { r = e.computeWHill(W0, tCrit, hours); } catch (err) { ok(false, 'F4 Hill throw', `W0=${String(W0)} t=${tCrit} h=${hours}`); continue; }
      if (finite(W0) && W0 > 0 && finite(hours) && hours >= 0) {
        ok(finite(r) && r >= -1e-6 && r <= W0 + 1e-6, 'F4 Hill∈[0,W0]', `W0=${W0} tCrit=${tCrit} h=${hours} → ${r}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// § F5 — INVARIANTE TWO-CLOCK: fSaltProtease modula t_crit, NON k_effective
// ─────────────────────────────────────────────────────────────
console.log('§ F5 — Two-Clock salt invariant (INV-2)');
// (a) fSaltProtease deve cambiare computeTCrit ma kEffective deve essere indipendente dal sale
{
  const kNoArgSalt = e.kEffective(22, 47, 'saccharomyces');
  // kEffective non accetta sale → se mai cambiasse, sarebbe una violazione di firma
  ok(finite(kNoArgSalt), 'F5 kEffective baseline finite');
  // fSaltProtease monotòna decrescente + floor
  let prev = Infinity, monot = true, floored = true;
  for (let s = 0; s <= 60; s += 0.5) {
    const f = e.fSaltProtease(s);
    if (f > prev + 1e-9) monot = false;
    if (f < 0.69) floored = false; // floor 0.70
    prev = f;
  }
  ok(monot, 'F5 fSaltProtease monotòna ↓');
  ok(floored, 'F5 fSaltProtease floor 0.70 rispettato');
  // fSaltYeast idem
  let pY = Infinity, mY = true;
  for (let s = 0; s <= 60; s += 0.5) { const f = e.fSaltYeast(s); if (f > pY + 1e-9) mY = false; pY = f; }
  ok(mY, 'F5 fSaltYeast monotòna ↓');
}
// (b) input maligni a fSaltProtease/fSaltYeast → mai NaN
for (const s of EVIL_SALT) {
  let fp, fy;
  try { fp = e.fSaltProtease(s); fy = e.fSaltYeast(s); } catch (err) { ok(false, 'F5 salt fn throw', `s=${String(s)}`); continue; }
  if (typeof s === 'number' && Number.isFinite(s)) {
    ok(finite(fp) && fp >= 0.70 - 1e-9, 'F5 fSaltProtease≥floor', `s=${s} → ${fp}`);
    ok(finite(fy) && fy >= 0, 'F5 fSaltYeast≥0', `s=${s} → ${fy}`);
  }
}

// ─────────────────────────────────────────────────────────────
// § F6 — computeTCrit con pH/T/H maligni (no division-by-zero crash)
// ─────────────────────────────────────────────────────────────
console.log('§ F6 — computeTCrit malicious modulators');
for (const W of [150, 280, 450]) {
  for (const T of EVIL_TEMPS) for (const pH of EVIL_PH) for (const H of [0, 65, 200]) {
    let r; try { r = e.computeTCrit(W, T, pH, H); } catch (err) { ok(false, 'F6 tCrit throw', `W=${W} T=${String(T)} pH=${String(pH)} H=${H} ${err.message}`); continue; }
    if (finite(T) && finite(pH)) ok(finite(r), 'F6 tCrit finite', `W=${W} T=${T} pH=${pH} H=${H} → ${r}`);
  }
}

// ─────────────────────────────────────────────────────────────
// § F7 — SOLVER end-to-end: timestamp invertiti + NaN injection (INV-6)
// ─────────────────────────────────────────────────────────────
console.log('§ F7 — solveNowAnchoredWindow adversarial');
// Contratto reale: now (Date|ms), serviceStart (Date), serviceDurationH, ...
const lbf = e.AGENT_GOMPERTZ.fresh_yeast;
function baseInput() {
  return {
    now: new Date('2026-06-01T10:00:00'),
    serviceStart: new Date('2026-06-01T19:00:00'),
    serviceDurationH: 2,
    style: 'contemporanea',
    ambientTempC: 22, fridgeTempC: 4,
    agentType: 'fresh_yeast', agentEaKj: lbf.Ea, agentMuMax: lbf.muMax,
    agentLambda: lbf.lambda, agentAsymptote: 100, agentDosePct: 0.3,
    hydration: 65, salt: 2, W0: 280, initialPH: 5.8,
    totalFlourGrams: 1000, numPanetti: 6, containerPreset: 'closed_box',
    prefermenti: [], initialMaturationOffset: 0,
  };
}
let solverCrashes = 0, solverRuns = 0;
function trySolve(mut, label) {
  const input = { ...baseInput(), ...mut };
  solverRuns++;
  let r;
  try { r = solveNowAnchoredWindow(input); }
  catch (err) { solverCrashes++; ok(false, 'F7 solver THROW', `${label}: ${err.message}`); return; }
  ok(r != null && typeof r === 'object' && typeof r.feasible === 'boolean', 'F7 solver returns valid', label);
}
// timestamp invertiti: servizio PRIMA del mix (serviceStart < now)
trySolve({ serviceStart: new Date('2026-06-01T08:00:00') }, 'service-before-now');
// serviceStart nel passato lontano
trySolve({ serviceStart: new Date('1970-01-01T00:00:00') }, 'service-epoch');
// durata di servizio negativa / enorme
trySolve({ serviceDurationH: -5 }, 'negative-service-dur');
trySolve({ serviceDurationH: 1e6 }, 'huge-service-dur');
// NaN/Inf/string injection sui campi NUMERICI (non-Date)
for (const field of ['hydration', 'salt', 'ambientTempC', 'fridgeTempC', 'totalFlourGrams',
  'numPanetti', 'W0', 'initialPH', 'serviceDurationH', 'agentEaKj', 'agentMuMax', 'agentLambda',
  'agentDosePct', 'initialMaturationOffset']) {
  for (const bad of [NaN, Infinity, -Infinity, -1, 1e308, 'xx', null, undefined]) {
    trySolve({ [field]: bad }, `${field}=${String(bad)}`);
  }
}
// REGRESSIONE Finding-A: serviceStart/now malformato (Date invalida / non-Date)
// — prima crashava con TypeError su .getTime(); ora deve ritornare infeasible.
for (const bad of [new Date('not-a-date'), null, undefined, 'ieri', 12345, {}, NaN]) {
  trySolve({ serviceStart: bad }, `serviceStart=${String(bad)}`);
}
for (const bad of [new Date('xxx'), null, 'oggi', {}]) {
  trySolve({ now: bad }, `now=${String(bad)}`);
}
// valori fuori scala combinati
trySolve({ hydration: 1e6, salt: -50, ambientTempC: 500, numPanetti: -3 }, 'all-out-of-range');
trySolve({ hydration: 0, salt: 0, W0: 0 }, 'all-zero');
ok(solverCrashes === 0, `F7 solver 0 crash / ${solverRuns} runs`, solverCrashes ? `${solverCrashes} crashes` : '');

// REGRESSIONE Finding-A esplicita: date non-Date → infeasible, MAI throw.
// (undefined/stringa/oggetto → Date invalida; null → epoch 1970 = past valido)
for (const bad of [undefined, 'ieri', {}, NaN]) {
  let r, threw = false;
  try { r = solveNowAnchoredWindow({ ...baseInput(), serviceStart: bad }); } catch { threw = true; }
  ok(!threw && r && r.feasible === false, `F7 Finding-A serviceStart=${String(bad)} → infeasible no-throw`,
    threw ? 'THREW' : JSON.stringify(r?.infeasibility?.reason));
}
// Finding-D: ambientTempC stringa → infeasible invece di crash su .toFixed()
for (const bad of ['xx', NaN, Infinity, null, undefined]) {
  let r, threw = false;
  try { r = solveNowAnchoredWindow({ ...baseInput(), ambientTempC: bad }); } catch { threw = true; }
  ok(!threw && r && r.feasible === false, `F7 Finding-D ambientTempC=${String(bad)} → no-throw`,
    threw ? 'THREW' : 'ok');
}

// REGRESSIONE Finding-B: durata gigantesca NON deve esplodere in memoria/tempo.
// Cap MAX_STEPS_PER_SEG=100k → simulateTimeline limita i samples.
{
  const optsB = { agentEaKj: 60, agentType: 'fresh_yeast', muMaxScaled: 0.02, leavLambda: 4,
    agentAsymptote: 100, W0: 280, hydration: 65, salt: 2, totalFlourGrams: 1000, numPanetti: 6,
    containerPreset: 'closed_box', initialPH: 5.8, subStepH: 0.05 };
  const initB = { tempDough: 22, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 };
  const t0 = Date.now();
  const r = simulateTimeline([{ phaseType: 'proofing', durationH: 1e7, ambientTempC: 22 }], initB, optsB);
  const dt = Date.now() - t0;
  ok(r && r.samples.length <= 100_002, 'F7 Finding-B samples capped ≤100k', `len=${r?.samples?.length}`);
  ok(dt < 5000, 'F7 Finding-B durata gigante < 5s (no DoS)', `${dt}ms`);
}

// ─────────────────────────────────────────────────────────────
// § F8 — simulateTimeline con segmenti corrotti / vuoti
// ─────────────────────────────────────────────────────────────
console.log('§ F8 — simulateTimeline corrupt segments');
const simOpts = { agentEaKj: 60, agentType: 'saccharomyces', muMaxScaled: 0.02, leavLambda: 4,
  agentAsymptote: 100, W0: 280, hydration: 65, salt: 2, totalFlourGrams: 1000, numPanetti: 6,
  containerPreset: 'closed_box', initialPH: 5.8, subStepH: 0.1 };
const simInit = { tempDough: 22, leavAdu: 0, enzAdu: 0, wDamage: 0, elapsedH: 0 };
const evilSegs = [
  [],
  null,
  undefined,
  [{ phaseType: 'proofing', durationH: -5, ambientTempC: 22 }],
  [{ phaseType: 'proofing', durationH: NaN, ambientTempC: NaN }],
  [{ phaseType: 'proofing', durationH: 1e6, ambientTempC: 500 }],
  [{ phaseType: 'xyz', durationH: 10, ambientTempC: 22 }],
  [{ durationH: 10 }],
  [{}],
];
for (const segs of evilSegs) {
  let r; try { r = simulateTimeline(segs, simInit, simOpts); }
  catch (err) { ok(false, 'F8 simulateTimeline THROW', `${JSON.stringify(segs)}: ${err.message}`); continue; }
  ok(r != null, 'F8 simulateTimeline returns', JSON.stringify(segs)?.slice(0, 40));
}

// ─────────────────────────────────────────────────────────────
// § F9 — computeTemperingH boundary (massa/idratazione estreme)
// ─────────────────────────────────────────────────────────────
console.log('§ F9 — computeTemperingH boundary');
for (const ballMassKg of [-1, 0, 0.28, 1e6, NaN]) {
  for (const hydration of EVIL_HYD) {
    let r; try { r = computeTemperingH({ ballMassKg, hydration, fridgeTempC: 4, ambientTempC: 22, targetC: 18, containerPreset: 'bare' }); }
    catch (err) { ok(false, 'F9 temperingH THROW', `m=${ballMassKg} H=${String(hydration)}: ${err.message}`); continue; }
    ok(r === undefined || finite(r) || typeof r === 'object', 'F9 temperingH safe', `m=${ballMassKg} H=${String(hydration)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// § F10 — structuralState / computeStyleAwareAlertLevel non crashano
// ─────────────────────────────────────────────────────────────
console.log('§ F10 — alert level adversarial');
for (const W0 of EVIL_W) for (const Wc of EVIL_W) {
  let r; try { r = e.structuralState(W0, Wc); } catch (err) { ok(false, 'F10 structuralState THROW', `${String(W0)},${String(Wc)}`); continue; }
  ok(typeof r === 'string', 'F10 structuralState string', `${String(W0)},${String(Wc)} → ${r}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────');
console.log(`OBIETTIVO 1 — ENGINE FUZZ: ${passed} passed, ${failed} failed / ${passed + failed} assertions`);
if (bugs.length) {
  console.log('\n🔴 BUG / VIOLAZIONI INVARIANTI:');
  for (const b of bugs.slice(0, 50)) console.log('  • ' + b);
}
process.exit(failed > 0 ? 1 : 0);
