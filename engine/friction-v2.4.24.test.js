/**
 * PizzaMatrix — Test accettazione Modello Attrito Unificato (v2.4.24, §7)
 *
 * Run: node engine/friction-v2.4.24.test.js
 */
import {
  FRICTION_PARAMS,
  frictionRiseStructural,
  fitFrictionCalib,
  computeFrictionRise,
  computeEffectiveMixHydration,
  predictDoughExitTemp,
} from './friction-v2.4.24.js';

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
function approx(a, b, tol = 0.01) { return Math.abs(a - b) <= tol; }

// ─── T1 — Regressione anchor (spiral, biga contemporanea) ────────────────────
console.log('\n§ T1 — Regressione anchor reale (Pasquale, spiral 14min)');
{
  const struct = frictionRiseStructural('spiral', 14, 70, 1);
  assert(approx(struct, 5.12, 0.15), 'frictionRiseStructural ≈ 5.1', `got ${struct.toFixed(3)}`);

  const calib = fitFrictionCalib('spiral');
  assert(approx(calib, 1.9, 0.1), 'fitFrictionCalib(spiral) ≈ 1.9', `got ${calib.toFixed(3)}`);

  const rise = computeFrictionRise('spiral', 14, 70, 1);
  assert(approx(rise, 9.75, 0.3), 'computeFrictionRise ≈ 9.75', `got ${rise.toFixed(3)}`);

  const exit = predictDoughExitTemp(22.25, 'spiral', 14, 70, 1);
  assert(approx(exit, 32, 0.3), 'predictDoughExitTemp(22.25) ≈ 32', `got ${exit.toFixed(3)}`);
}

// ─── T3 — Generalità diretto (nessun prefermento) ─────────────────────────────
console.log('\n§ T3 — Generalità: impasto diretto');
{
  const Heff = computeEffectiveMixHydration({ hydration: 65, prefermenti: [] });
  assert(approx(Heff, 65, 0.001), 'H_eff diretto = hydration finale', `got ${Heff}`);

  const HeffNoPref = computeEffectiveMixHydration({ hydration: 58 });
  assert(approx(HeffNoPref, 58, 0.001), 'H_eff senza campo prefermenti = finale', `got ${HeffNoPref}`);

  const rise = computeFrictionRise('spiral', 12, 65, 1);
  assert(Number.isFinite(rise) && rise > 0, 'ΔT diretto finito e positivo', `got ${rise}`);
}

// ─── T4 — Generalità prefermenti: biga (rigida) > poolish (idratato) ─────────
console.log('\n§ T4 — Generalità: biga vs poolish (monotonia f_hyd)');
{
  // Biga 45% farina @ 45% idr + rinfresco 55% @ 70% finale
  const Hbiga = computeEffectiveMixHydration({
    hydration: 70,
    prefermenti: [{ flourFraction: 45, hydration: 45 }],
  });
  // Poolish 45% farina @ 100% idr + rinfresco
  const Hpoolish = computeEffectiveMixHydration({
    hydration: 70,
    prefermenti: [{ flourFraction: 45, hydration: 100 }],
  });
  assert(Hbiga < Hpoolish, 'H_eff biga < H_eff poolish', `biga ${Hbiga.toFixed(1)} vs poolish ${Hpoolish.toFixed(1)}`);

  const riseBiga = computeFrictionRise('spiral', 12, Hbiga, 1);
  const risePoolish = computeFrictionRise('spiral', 12, Hpoolish, 1);
  assert(riseBiga > risePoolish, 'ΔT biga > ΔT poolish (impasto rigido scalda di più)',
    `biga ${riseBiga.toFixed(2)} vs poolish ${risePoolish.toFixed(2)}`);
}

// ─── T5 — Generalità mixer: hand ≪ spiral ─────────────────────────────────────
console.log('\n§ T5 — Generalità: mixer hand ≪ spiral');
{
  const hand = computeFrictionRise('hand', 14, 70, 1);
  const spiral = computeFrictionRise('spiral', 14, 70, 1);
  assert(hand < spiral, 'ΔT hand < ΔT spiral', `hand ${hand.toFixed(2)} vs spiral ${spiral.toFixed(2)}`);
  // hand non calibrato (calib=1.0), spiral calibrato (~1.9): divario marcato
  assert(hand < spiral * 0.5, 'ΔT hand molto minore di spiral', `hand ${hand.toFixed(2)} vs spiral ${spiral.toFixed(2)}`);
}

// ─── T6 — Duration-aware: 20min > 12min, scala lineare ───────────────────────
console.log('\n§ T6 — Duration-aware (scala lineare nel tempo)');
{
  const r12 = computeFrictionRise('spiral', 12, 65, 1);
  const r20 = computeFrictionRise('spiral', 20, 65, 1);
  assert(r20 > r12, '20min scalda più di 12min', `12 ${r12.toFixed(2)} vs 20 ${r20.toFixed(2)}`);
  assert(approx(r20 / r12, 20 / 12, 0.001), 'rapporto = 20/12 (lineare in durata)',
    `got ${(r20 / r12).toFixed(4)}`);
}

// ─── T7 — Clamp e robustezza ──────────────────────────────────────────────────
console.log('\n§ T7 — Clamp f_hyd / f_mass + input degeneri');
{
  // Idratazione estrema bassa → f_hyd clamp a 1.30
  const fHydClampLo = computeFrictionRise('fork', 10, 0, 1) / (FRICTION_PARAMS.baseRatePer10min.fork * 1);
  assert(fHydClampLo <= 1.30 + 1e-9, 'f_hyd clampato ≤ 1.30', `got ${fHydClampLo.toFixed(3)}`);

  // Idratazione estrema alta → f_hyd clamp a 0.80
  const fHydClampHi = computeFrictionRise('fork', 10, 200, 1) / (FRICTION_PARAMS.baseRatePer10min.fork * 1);
  assert(fHydClampHi >= 0.80 - 1e-9, 'f_hyd clampato ≥ 0.80', `got ${fHydClampHi.toFixed(3)}`);

  // Mixer sconosciuto → fallback spiral baseRate, calib 1.0 (esplicito non presente → fit; fit per mixer ignoto = 1.0)
  const unknown = computeFrictionRise('martian_mixer', 14, 70, 1);
  assert(Number.isFinite(unknown) && unknown > 0, 'mixer sconosciuto → fallback finito', `got ${unknown}`);

  // Durata 0 → ΔT 0
  const zero = computeFrictionRise('spiral', 0, 65, 1);
  assert(approx(zero, 0, 1e-9), 'durata 0 → ΔT 0', `got ${zero}`);

  // Massa mancante → trattata come 1kg (no crash)
  const noMass = computeFrictionRise('spiral', 12, 65, undefined);
  assert(Number.isFinite(noMass) && noMass > 0, 'massKg undefined → fallback 1kg', `got ${noMass}`);
}

// ─── Riepilogo ────────────────────────────────────────────────────────────────
console.log('\n── Riepilogo Friction v2.4.24 ──────────────────');
console.log(`  Totale:  ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
if (failed > 0) {
  console.error(`  ❌ Failed: ${failed}`);
  process.exit(1);
} else {
  console.log('  Tutti i test superati 🍕');
}
