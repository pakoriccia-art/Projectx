/**
 * PizzaMatrix — Service-Window Solver Test Suite
 * Esegui con: node engine/serviceWindowSolver.test.js
 */
import {
  solveServiceWindow, simulateTimeline, computeTemperingH,
  buildServiceWindowTimeline, SERVICE_WINDOW_DEFAULTS,
} from './serviceWindowSolver.js';
import { ENZYMATIC_CLOCK_PARAMS, AGENT_GOMPERTZ } from './engine-v2.4.0.js';

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function approx(a, b, tol = 0.01) { return Math.abs(a - b) <= tol; }

const lbf = AGENT_GOMPERTZ.fresh_yeast;

// Input base riutilizzabile (LBF, W300, ambient 22, fridge 4)
function baseInput(overrides = {}) {
  return {
    serviceStart: new Date('2026-06-01T19:00:00'),
    serviceDurationH: 2,
    ambientTempC: 22,
    fridgeTempC: 4,
    agentType: 'fresh_yeast',
    agentEaKj: lbf.Ea,
    agentMuMax: lbf.muMax,
    agentLambda: lbf.lambda,
    agentAsymptote: 100,
    agentDosePct: 0.3,
    W0: 300, hydration: 65, salt: 2.0,
    totalFlourGrams: 1000, numPanetti: 6, containerPreset: 'closed_box',
    prefermenti: [], initialMaturationOffset: 0,
    ...overrides,
  };
}

console.log('\n§ SW1 — Servizio 2h fattibile (baseline)');
{
  const r = solveServiceWindow(baseInput());
  assert(r.feasible === true, 'feasible=true');
  assert(r.schedule.temperingH > 0, `temperingH > 0`, `val=${r.schedule.temperingH}`);
  assert(approx(r.atServiceEnd.maturationPct, 90, 1.0),
    'maturazione(serviceEnd) ≈ 90%', `val=${r.atServiceEnd.maturationPct}`);
  assert(r.atServiceEnd.leaveningPct <= SERVICE_WINDOW_DEFAULTS.bubbleThresholdPct + 0.5,
    'lievitazione(serviceEnd) ≤ 92%', `val=${r.atServiceEnd.leaveningPct}`);
  assert(['OK', 'WARNING'].includes(r.atServiceEnd.structuralStatus),
    'struttura OK/WARNING', `val=${r.atServiceEnd.structuralStatus}`);
  assert(r.mixStart.getTime() < baseInput().serviceStart.getTime(), 'mixStart < serviceStart');
  // timeline contigua
  let contig = true;
  for (let i = 0; i < r.timeline.length - 1; i++)
    if (!approx(r.timeline[i].endElapsedH, r.timeline[i + 1].startElapsedH, 1e-3)) contig = false;
  assert(contig, 'timeline contigua (no buchi/sovrapposizioni)');
  assert(approx(r.timeline[r.timeline.length - 1].endElapsedH, r.bakeTargetElapsedH, 0.05),
    'ultimo segmento finisce a bakeTargetElapsedH');
}

console.log('\n§ SW2 — C1 vincolante (ambient 19, palline grandi)');
{
  const r = solveServiceWindow(baseInput({ ambientTempC: 19, totalFlourGrams: 3000, numPanetti: 2 }));
  assert(r.feasible === true, 'feasible=true');
  assert(r.schedule.temperingH > 1.0, 'temperingH grande (palline grandi, ΔT piccolo)', `val=${r.schedule.temperingH}`);
  assert(r.atServiceStart.tempDough >= 17.9,
    'C1 soddisfatto: tempDough(serviceStart) ≥ 18°C', `val=${r.atServiceStart.tempDough}`);
}

console.log('\n§ SW3 — Servizio lungo infattibile (overshoot)');
{
  const r = solveServiceWindow(baseInput({
    serviceDurationH: 8, ambientTempC: 26, initialMaturationOffset: 0.4,
    prefermenti: [{ flourFraction: 40 }],
  }));
  assert(r.feasible === false, 'feasible=false');
  assert(r.infeasibility?.reason === 'maturation_overshoot',
    "reason='maturation_overshoot'", `val=${r.infeasibility?.reason}`);
  assert(r.infeasibility?.maxSafeServiceWindowH < 8,
    'maxSafeServiceWindowH < 8h', `val=${r.infeasibility?.maxSafeServiceWindowH}`);
  assert((r.infeasibility?.mitigations ?? []).some(m => /[Rr]iduci la durata/.test(m)),
    'mitigazioni includono "riduci durata servizio"');
}

console.log('\n§ SW4 — Dose alta bubble-capped');
{
  // Soglia bolle molto bassa: anche la dose minima supera la soglia → capped,
  // ma la maturazione resta ancorata a 90% (prova separazione delle leve).
  const r = solveServiceWindow(baseInput({
    serviceDurationH: 4, ambientTempC: 24, bubbleThresholdPct: 8,
  }));
  assert(r.bubbleCapped === true, 'bubbleCapped=true', `leav=${r.atServiceEnd.leaveningPct}`);
  assert(r.atServiceEnd.leaveningPct > 8, 'lievitazione(serviceEnd) > soglia', `val=${r.atServiceEnd.leaveningPct}`);
  // La maturazione resta ≈90 indipendentemente dalla dose minima
  assert(approx(r.atServiceEnd.maturationPct, 90, 2.0),
    'maturazione(serviceEnd) ≈ 90% (dose non perturba l\'ancora)', `val=${r.atServiceEnd.maturationPct}`);
}

console.log('\n§ SW5 — Invarianti');
{
  const inp = baseInput();
  // C1 short-circuit
  const cold = solveServiceWindow(baseInput({ ambientTempC: 17 }));
  assert(cold.feasible === false && cold.infeasibility?.reason === 'cannot_temper',
    'ambient ≤ 18 → reason=cannot_temper');

  // Indipendenza maturazione/dose: enzAdu identico a dosi diverse, stesso schedule
  const segs = [
    { phaseType: 'bulk_room', durationH: 3, ambientTempC: 22 },
    { phaseType: 'balled_fridge', durationH: 10, ambientTempC: 4 },
  ];
  const optsLo = {
    agentEaKj: lbf.Ea, agentType: 'fresh_yeast', leavLambda: lbf.lambda,
    muMaxScaled: lbf.muMax * 0.5, W0: 300, hydration: 65, salt: 2,
    totalFlourGrams: 1000, numPanetti: 6, containerPreset: 'closed_box',
  };
  const optsHi = { ...optsLo, muMaxScaled: lbf.muMax * 1.5 };
  const init = { tempDough: 22, leavAdu: 0, enzAdu: 0, wDamage: 0 };
  const lo = simulateTimeline(segs, init, optsLo).final;
  const hi = simulateTimeline(segs, init, optsHi).final;
  assert(approx(lo.enzAdu, hi.enzAdu, 1e-9),
    'maturazione (enzAdu) indipendente dalla dose', `lo=${lo.enzAdu} hi=${hi.enzAdu}`);
  assert(hi.leaveningPct > lo.leaveningPct,
    'lievitazione monotòna crescente nella dose', `lo=${lo.leaveningPct} hi=${hi.leaveningPct}`);

  // computeTemperingH: closed-form coerente (22°C, 4°C frigo, sfera)
  const tH = computeTemperingH({ ballMassKg: 0.25, hydration: 65, fridgeTempC: 4, ambientTempC: 22, targetC: 18, containerPreset: 'bare' });
  assert(tH > 0, 'temperingH > 0 a 22°C ambient', `val=${tH}`);
  const tH0 = computeTemperingH({ ballMassKg: 0.25, hydration: 65, fridgeTempC: 4, ambientTempC: 17, targetC: 18, containerPreset: 'bare' });
  assert(tH0 === 0, 'temperingH = 0 se ambient ≤ target');

  // buildServiceWindowTimeline: status planned, fasi attese
  const tl = buildServiceWindowTimeline({ puntataH: 2, staglioH: 0.5, tcHours: 10, temperingH: 1.5, serviceDurationH: 2, ambientTempC: 22, fridgeTempC: 4 });
  assert(tl.every(s => s.status === 'planned'), 'tutti i segmenti planned');
  assert(tl.some(s => s.phaseType === 'balled_fridge') && tl.filter(s => s.phaseType === 'proofing').length === 2,
    'timeline: 1 frigo + 2 proofing (tempering + servizio)');
}

console.log('\n── Riepilogo Service-Window Solver ──');
console.log(`  Totale:  ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
