/**
 * PizzaMatrix — Collapse Model Test Suite (v2.4.23)
 * Esegui con: node engine/structural/__tests__/collapseModel.test.js
 *
 * Verifica: ancora 24°C→~2h, generalizzazione termica monotòna (derivata dalla
 * cinetica, senza costanti termiche nuove), scaling W, two-clock guard, sotto-proof.
 */
import {
  makeLeavAduRateAt, computeCollapseOvershootAdu, collapseToleranceAdu,
  computeCollapseETA, overLeaveningState, worstStructuralState,
  COLLAPSE_ANCHOR, COLLAPSE_W_REF,
} from '../collapseModel.js';
import { gompertz, AGENT_GOMPERTZ } from '../../engine-v2.4.0.js';

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

// Parametri agente realistici (LBF fresco) per il rate di lievitazione.
const AGENT = { agentEaKj: AGENT_GOMPERTZ.fresh_yeast.Ea, agentType: 'fresh_yeast', salt: 2.5 };
const rateAt = makeLeavAduRateAt(AGENT);

// Costruisce una trajectory a temperatura COSTANTE integrando leavAdu col rate
// reale (stesso rate del solver). leaveningPct cresce via Gompertz e attraversa
// la soglia bolle a un certo punto → definisce il picco. W_current fisso.
function buildConstTempTrajectory({ tempC, W_current, totalH, stepH = 0.02, muMax, lambda, asymptote = 100, leavAduStart = 0 }) {
  const rate = rateAt(tempC);
  const traj = [];
  let leavAdu = leavAduStart;
  let h = 0;
  while (h <= totalH + 1e-9) {
    traj.push({
      elapsedH: h,
      leavAdu,
      leaveningPct: gompertz(leavAdu, muMax, lambda, asymptote),
      W_current,
      // campi enzimatici inclusi per il two-clock guard (devono restare intatti)
      enzAdu: 99.9,
      enzymaticMatPct: 42.0,
    });
    leavAdu += rate * stepH;
    h += stepH;
  }
  return traj;
}

const GOMP = { muMax: AGENT_GOMPERTZ.fresh_yeast.muMax, lambda: AGENT_GOMPERTZ.fresh_yeast.lambda };
const BUBBLE = 92; // contemporanea

console.log('\n§ COLLAPSE — Over-leavening structural collapse (v2.4.23)');

// ANCORA: a 24°C, W = COLLAPSE_W_REF → marginH ≈ 2.0 (per costruzione del modello)
let eta24;
{
  const traj = buildConstTempTrajectory({ tempC: 24, W_current: COLLAPSE_W_REF, totalH: 40, ...GOMP });
  eta24 = computeCollapseETA({ trajectory: traj, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  assert(eta24.reachesPeak === true, 'COL-01a picco raggiunto a 24°C');
  assert(eta24.marginH != null && approx(eta24.marginH, COLLAPSE_ANCHOR.hoursPastPeak, 0.1),
    'COL-01b 24°C, W=W_REF → marginH ≈ 2.0h (ancora)', `marginH=${eta24.marginH?.toFixed(3)}`);
}

// GENERALIZZAZIONE TERMICA (monotonia, derivata dalla cinetica): 30°C < 2 < 4°C
{
  const t30 = buildConstTempTrajectory({ tempC: 30, W_current: COLLAPSE_W_REF, totalH: 40, ...GOMP });
  // A 4°C il picco naturale arriverebbe a ~2870h: partiamo vicino al picco
  // (leavAduStart) per isolare il margine POST-picco, che è ciò che il test
  // asserisce ("collasso lontano" al freddo). La finestra post-picco basta.
  const t04 = buildConstTempTrajectory({ tempC: 4,  W_current: COLLAPSE_W_REF, totalH: 500, leavAduStart: 12, ...GOMP });
  const e30 = computeCollapseETA({ trajectory: t30, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  const e04 = computeCollapseETA({ trajectory: t04, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  assert(e30.reachesPeak && e30.marginH < COLLAPSE_ANCHOR.hoursPastPeak,
    'COL-02a 30°C → marginH < 2h (più caldo → collassa prima)', `marginH=${e30.marginH?.toFixed(3)}`);
  // Il margine post-picco scala con l'INVERSO del rate di lievitazione: a 4 °C il
  // rate è rateAt(24)/rateAt(4) volte più lento, quindi il margine è altrettante
  // volte più lungo. Il vecchio oracolo era `> hoursPastPeak × 10`, un numero
  // magico che funzionava solo con la cinetica pre-#3: lì il rapporto 24→4 °C era
  // ~166 (margine ~330 h, due settimane), ora è ~6 (margine ~12 h). Ancorare la
  // soglia al rate reale rende il test indipendente da future ricalibrazioni.
  const ratio04 = rateAt(COLLAPSE_ANCHOR.tempC) / rateAt(4);
  const atteso04 = COLLAPSE_ANCHOR.hoursPastPeak * ratio04;
  assert(e04.reachesPeak && e04.marginH != null
         && e04.marginH > COLLAPSE_ANCHOR.hoursPastPeak
         && approx(e04.marginH, atteso04, atteso04 * 0.15),
    'COL-02b 4°C → marginH = ancora × (rate24/rate4)',
    `marginH=${e04.marginH?.toFixed(1)} atteso≈${atteso04.toFixed(1)} (rapporto ${ratio04.toFixed(1)}×)`);
  // monotonia stretta a parità di W: marginH(30) < marginH(24) < marginH(4)
  assert(e30.marginH < eta24.marginH && eta24.marginH < e04.marginH,
    'COL-02c monotonia: marginH(30) < marginH(24) < marginH(4)',
    `30→${e30.marginH?.toFixed(2)}, 24→${eta24.marginH?.toFixed(2)}, 4→${e04.marginH?.toFixed(1)}`);
}

// SCALING W: W più basso → tolleranza minore → collassa prima (marginH minore)
{
  const tHi = buildConstTempTrajectory({ tempC: 24, W_current: COLLAPSE_W_REF,      totalH: 40, ...GOMP });
  const tLo = buildConstTempTrajectory({ tempC: 24, W_current: COLLAPSE_W_REF * 0.6, totalH: 40, ...GOMP });
  const eHi = computeCollapseETA({ trajectory: tHi, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  const eLo = computeCollapseETA({ trajectory: tLo, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  assert(eLo.marginH < eHi.marginH, 'COL-03 W più basso → marginH minore (collassa prima)',
    `W_lo→${eLo.marginH?.toFixed(2)}, W_hi→${eHi.marginH?.toFixed(2)}`);
}

// TWO-CLOCK GUARD: il modulo non legge/scrive enzAdu; gli stati restano intatti
{
  const traj = buildConstTempTrajectory({ tempC: 24, W_current: COLLAPSE_W_REF, totalH: 40, ...GOMP });
  const before = JSON.stringify(traj.map((s) => [s.enzAdu, s.enzymaticMatPct]));
  computeCollapseETA({ trajectory: traj, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  const after = JSON.stringify(traj.map((s) => [s.enzAdu, s.enzymaticMatPct]));
  assert(before === after, 'COL-04a enzAdu/enzymaticMatPct invariati (two-clock: nessuna scrittura)');
  // il sorgente non importa simboli enzimatici
  assert(makeLeavAduRateAt.toString().indexOf('enzAdu') === -1, 'COL-04b makeLeavAduRateAt non referenzia enzAdu');
}

// SOTTO-PROOF: leaveningPct non raggiunge mai la soglia → reachesPeak:false
{
  // finestra cortissima a 4°C: la lievitazione resta sotto soglia
  const traj = buildConstTempTrajectory({ tempC: 4, W_current: COLLAPSE_W_REF, totalH: 2, ...GOMP });
  const eta = computeCollapseETA({ trajectory: traj, bubbleThresholdPct: BUBBLE, leavAduRateAt: rateAt });
  assert(eta.reachesPeak === false, 'COL-05 sotto-proof → reachesPeak:false (nessun collasso)');
}

// STATI over-lievitazione + worst-merge
{
  assert(overLeaveningState(-1, 10) === 'OK', 'COL-06a overshoot ≤ 0 → OK');
  assert(overLeaveningState(1, 10) === 'WARNING', 'COL-06b frac basso → WARNING');
  assert(overLeaveningState(8, 10) === 'CRITICAL', 'COL-06c frac ≥ 0.70 → CRITICAL');
  assert(overLeaveningState(10, 10) === 'COLLAPSED', 'COL-06d frac ≥ 1 → COLLAPSED');
  assert(worstStructuralState('WARNING', 'COLLAPSED') === 'COLLAPSED', 'COL-06e worst = COLLAPSED');
  assert(worstStructuralState('CRITICAL', 'OK') === 'CRITICAL', 'COL-06f worst = CRITICAL');
}

// Coerenza overshoot/tolleranza
{
  const rate24 = rateAt(24);
  const ref = computeCollapseOvershootAdu({ leavAduRateAt: rateAt, peakState: {} });
  assert(approx(ref, rate24 * 2, 1e-9), 'COL-07a overshootRef = rate(24)×2h');
  assert(approx(collapseToleranceAdu(ref, COLLAPSE_W_REF), ref, 1e-9), 'COL-07b tolleranza(W_REF) = overshootRef');
  assert(collapseToleranceAdu(ref, COLLAPSE_W_REF * 0.5) < ref, 'COL-07c tolleranza scala con W');
}

console.log('\n── Riepilogo Collapse Model ──');
console.log(`  Totale:  ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
