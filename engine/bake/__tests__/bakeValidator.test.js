/**
 * PizzaMatrix — Bake Validator Test Suite (v2.4.18)
 * Esegui con: node engine/bake/__tests__/bakeValidator.test.js
 */
import { validateBakeFeasibility, STYLE_BAKE_WINDOW_C } from '../bakeValidator.js';
import { computeBakeRecommendation } from '../bakeRecommendation.js';
import { resolveOvenTempC, OVEN_ARCHETYPES } from '../ovenProfiles.js';
import { BAKE_ARREST_C } from '../bakeKinetics.js';
import { getStyleProfile } from '../../engine-v2.4.0.js';

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// Session minimale (solo i campi letti dal validatore): hydration/salt/style reali.
function session(overrides = {}) {
  return { style: 'napoletana', hydration: 60, salt: 2.5, ...overrides };
}

console.log('\n§ BAKE — Validatore stile-vs-hardware (v2.4.18)');

// (a) temp_deficit_evaporative: contemporanea 72% + domestico_std (250°C) → infeasible
{
  const s = session({ style: 'contemporanea', hydration: 72 });
  const hydrBefore = s.hydration;
  const r = validateBakeFeasibility({
    session: s,
    finalState: { W_current: 300 },
    ovenProfile: { archetipo: 'domestico_std', stone: 'cordierite_refrattaria', dualZone: false },
  });
  assert(r.feasible === false, 'BAKE-01a contemporanea 72% + domestico 250°C → feasible:false');
  assert(r.reason === 'temp_deficit_evaporative', 'BAKE-01b reason = temp_deficit_evaporative', `got ${r.reason}`);
  assert(r.ovenTempC === 250, 'BAKE-01c ovenTempC = 250 (tMax domestico)', `got ${r.ovenTempC}`);
  // INVARIANTE anti-mutazione: il validatore NON tocca session.hydration
  assert(s.hydration === hydrBefore, 'BAKE-01d session.hydration invariata (no mutazione)');
}

// (b) w_below_min_at_infornata: W < W_minimo_stesura dello stile
{
  const s = session({ style: 'contemporanea', hydration: 70 });
  const wMin = getStyleProfile('contemporanea').W_minimo_stesura; // 190
  const r = validateBakeFeasibility({
    session: s,
    finalState: { W_current: wMin - 30 },
    // forno adeguato per isolare la reason W (elettrico pizza 450°C)
    ovenProfile: { archetipo: 'elettrico_pizza', stone: 'cordierite_refrattaria', dualZone: true },
  });
  assert(r.feasible === false, 'BAKE-02a W sotto soglia → feasible:false');
  assert(r.reason === 'w_below_min_at_infornata', 'BAKE-02b reason = w_below_min_at_infornata', `got ${r.reason}`);
  assert(r.kineticArrest.W_minimo_stesura === wMin, 'BAKE-02c kineticArrest riporta W_minimo_stesura corretto');
}

// (c) napoletana + legna_prof (485°C, biscotto) → feasible, advice non bloccante
{
  const s = session({ style: 'napoletana', hydration: 62 });
  const r = validateBakeFeasibility({
    session: s,
    finalState: { W_current: 250 },
    ovenProfile: { archetipo: 'legna_prof', stone: 'biscotto', dualZone: false, bakeTimeS: 80 },
  });
  assert(r.feasible === true, 'BAKE-03a napoletana + legna_prof biscotto → feasible:true');
  assert(r.ovenTempC === 485, 'BAKE-03b ovenTempC = 485', `got ${r.ovenTempC}`);
}

// (d) dual-zone alta idratazione → recommendation con plateaC < cieloC (v2.4.21)
{
  const s = session({ style: 'teglia', hydration: 80 });
  const r = validateBakeFeasibility({
    session: s,
    finalState: { W_current: 300 },
    ovenProfile: { archetipo: 'elettrico_pizza', stone: 'cordierite_refrattaria', dualZone: true },
  });
  assert(r.recommendation != null, 'BAKE-04a recommendation presente nel risultato del validatore');
  assert(r.recommendation.plateaC < r.recommendation.cieloC,
    'BAKE-04b recommendation.plateaC < cieloC (asimmetrico alta idratazione)',
    `cielo=${r.recommendation?.cieloC}, platea=${r.recommendation?.plateaC}`);
  assert(r.dualZoneSuggestion === undefined, 'BAKE-04c dualZoneSuggestion rimosso (sostituito da recommendation)');
}

// (e) conchiglia knobLevel:5 non modded → 390; modded measuredTmaxC:430 → 430
{
  const t5 = resolveOvenTempC({ archetipo: 'fornetto_conchiglia', stone: 'acciaio', dualZone: false, knobLevel: 5 });
  assert(t5 === 390, 'BAKE-05a conchiglia knobLevel 5 → 390°C', `got ${t5}`);
  const tMod = resolveOvenTempC({ archetipo: 'fornetto_conchiglia', stone: 'acciaio', dualZone: false, knobLevel: 5, is_modded: true, measuredTmaxC: 430 });
  assert(tMod === 430, 'BAKE-05b conchiglia modded measuredTmaxC 430 → 430°C', `got ${tMod}`);
}

// Two-Clock guard: il modulo non scrive su enzAdu/leavAdu/labAdu — finalState invariato
{
  const finalState = { W_current: 300, enzAdu: 12.3, leavAdu: 8.1, labAdu: 0 };
  const snapshot = JSON.stringify(finalState);
  validateBakeFeasibility({
    session: session(),
    finalState,
    ovenProfile: { archetipo: 'legna_prof', stone: 'biscotto', dualZone: false },
  });
  assert(JSON.stringify(finalState) === snapshot, 'BAKE-06 finalState invariato (Two-Clock: nessuna scrittura accumulatori)');
}

// Arresti sequenziali: alpha 85 (non 65), proteolisi 55, beta 70
{
  assert(BAKE_ARREST_C.alphaAmylase === 85, 'BAKE-07a alphaAmylaseArrestC = 85 (non 65)');
  assert(BAKE_ARREST_C.proteolysis === 55, 'BAKE-07b proteolysisArrestC = 55');
  assert(BAKE_ARREST_C.betaAmylase === 70, 'BAKE-07c betaAmylaseArrestC = 70');
}

// STYLE_BAKE_WINDOW_C copre i 5 stili reali
{
  const styles = ['napoletana', 'contemporanea', 'teglia', 'pala', 'nystyle'];
  assert(styles.every(st => STYLE_BAKE_WINDOW_C[st] != null), 'BAKE-08 STYLE_BAKE_WINDOW_C copre i 5 stili');
}

console.log('\n§ REC — Raccomandazione cottura, effusività attiva (v2.4.21)');

// REC-01 anti-regressione "materiale ininfluente": stesso input, stone diverso
// → plateaC e bakeTimeS DIFFERENTI (acciaio: platea più bassa e tempo più corto del biscotto)
{
  const base = { style: 'contemporanea', ovenTempC: 450, hydration: 75, dualZone: true };
  const acciaio  = computeBakeRecommendation({ ...base, stone: 'acciaio' });
  const biscotto = computeBakeRecommendation({ ...base, stone: 'biscotto' });
  assert(acciaio.plateaC < biscotto.plateaC,
    'REC-01a acciaio → platea più bassa del biscotto',
    `acciaio=${acciaio.plateaC}, biscotto=${biscotto.plateaC}`);
  assert(acciaio.bakeTimeS < biscotto.bakeTimeS,
    'REC-01b acciaio → tempo più corto del biscotto',
    `acciaio=${acciaio.bakeTimeS}s, biscotto=${biscotto.bakeTimeS}s`);
  assert(acciaio.stoneNote !== biscotto.stoneNote, 'REC-01c stoneNote differisce per materiale');
}

// REC-02 single-zone: cieloC/plateaC undefined, targetTempC presente
{
  const r = computeBakeRecommendation({
    style: 'napoletana', ovenTempC: 485, hydration: 62, stone: 'biscotto', dualZone: false,
  });
  assert(r.cieloC === undefined && r.plateaC === undefined, 'REC-02a single-zone → cielo/platea undefined');
  assert(typeof r.targetTempC === 'number' && r.targetTempC > 0, 'REC-02b targetTempC presente');
  assert(r.validationStatus === 'hypothesis', 'REC-02c validationStatus = hypothesis');
}

// REC-03 clamp alla finestra di stile: forno oltre max → target = window.max
{
  const r = computeBakeRecommendation({
    style: 'teglia', ovenTempC: 450, hydration: 80, stone: 'cordierite_refrattaria', dualZone: false,
  });
  assert(r.targetTempC === STYLE_BAKE_WINDOW_C.teglia.max,
    'REC-03 targetTempC clampato a window.max stile', `got ${r.targetTempC}`);
}

// REC-04 idratazione alta abbassa la platea (a parità di stone)
{
  const base = { style: 'contemporanea', ovenTempC: 430, stone: 'acciaio', dualZone: true };
  const hi = computeBakeRecommendation({ ...base, hydration: 80 });
  const lo = computeBakeRecommendation({ ...base, hydration: 60 });
  assert(hi.plateaC < lo.plateaC, 'REC-04 idratazione 80% → platea più bassa di 60%',
    `hi=${hi.plateaC}, lo=${lo.plateaC}`);
}

// REC-05 nessuna mutazione dell'input (advisory puro)
{
  const input = { style: 'pala', ovenTempC: 320, hydration: 70, stone: 'acciaio', dualZone: true };
  const snapshot = JSON.stringify(input);
  computeBakeRecommendation(input);
  assert(JSON.stringify(input) === snapshot, 'REC-05 input invariato (nessuna mutazione)');
}

console.log('\n── Riepilogo Bake Validator ──');
console.log(`  Totale:  ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
