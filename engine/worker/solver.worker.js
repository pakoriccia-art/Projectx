/**
 * PizzaMatrix — Solver Web Worker (v2.4.20)
 * =============================================================
 * Sposta il calcolo pesante del solver fuori dal main thread.
 * RILOCA, non riscrive: importa SOLO pure functions (zero Dexie/React/DOM)
 * e le esegue. Nessuna modifica alla matematica, ai parametri o ai risultati;
 * gli id segmento `svc-${i}` restano deterministici.
 *
 * Le Date attraversano postMessage via structured clone (native) — nessuna
 * serializzazione manuale. I contratti input/output sono identici alle
 * funzioni originali (zero-regressione).
 * =============================================================
 */
import {
  buildServiceWindowTimeline,
  simulateTimeline,
  computePlannedMatPctAt,
} from '../serviceWindowSolver.js';

// Contratti payload allineati alle firme REALI (multi-arg) delle pure functions.
const HANDLERS = {
  SOLVE_WINDOW:    (p) => buildServiceWindowTimeline(p.input),
  SIMULATE:        (p) => simulateTimeline(p.segments, p.initial, p.opts),
  PLANNED_MAT_PCT: (p) => computePlannedMatPctAt(p.timeline, p.initialState, p.elapsedH, p.opts),
};

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    const handler = HANDLERS[type];
    if (!handler) throw new Error(`Unknown worker task: ${type}`);
    const result = handler(payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
