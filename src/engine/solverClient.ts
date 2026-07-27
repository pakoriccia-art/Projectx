/**
 * PizzaMatrix — Solver Client (v2.4.20)
 * =============================================================
 * Confine UI→engine. Esegue i task del solver nel Web Worker quando
 * disponibile, con FALLBACK SINCRONO obbligatorio (ambienti senza
 * supporto Worker, test SSR/jsdom): stessa firma, stesso output.
 *
 * - Determinismo preservato: il worker non introduce non-determinismo.
 * - Latest-wins (opzionale): richieste rapide dello stesso tipo non si
 *   accumulano — una nuova annulla la precedente non ancora risolta
 *   (né resolve né reject spurio per quella superata).
 *
 * I call site ENGINE-INTERNI restano sincroni: il worker è solo per il
 * confine UI→engine (niente deadlock né doppia serializzazione).
 * =============================================================
 */
import {
  buildServiceWindowTimeline,
  simulateTimeline,
  computePlannedMatPctAt,
} from '../../engine/serviceWindowSolver.js';

export type TaskType = 'SOLVE_WINDOW' | 'SIMULATE' | 'PLANNED_MAT_PCT';

let worker: Worker | null = null;
function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;            // fallback sincrono
  if (!worker) {
    worker = new Worker(new URL('../../engine/worker/solver.worker.js', import.meta.url), { type: 'module' });
    attach(worker);
  }
  return worker;
}

let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
// latest-wins: ultimo id richiesto per tipo; i precedenti vengono scartati alla risoluzione
const latestByType = new Map<TaskType, number>();

function attach(w: Worker) {
  w.onmessage = (e: MessageEvent) => {
    const { id, ok, result, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    ok ? entry.resolve(result) : entry.reject(new Error(error));
  };
}

// Fallback sincrono — stessa firma reale delle pure functions.
export function runSync(type: TaskType, payload: any): any {
  switch (type) {
    case 'SOLVE_WINDOW':    return buildServiceWindowTimeline(payload.input);
    case 'SIMULATE':        return simulateTimeline(payload.segments, payload.initial, payload.opts);
    case 'PLANNED_MAT_PCT': return computePlannedMatPctAt(payload.timeline, payload.initialState, payload.elapsedH, payload.opts);
  }
}

export function runSolverTask<T = any>(
  type: TaskType, payload: any, opts?: { latestWins?: boolean },
): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve(runSync(type, payload) as T);   // fallback sincrono

  const id = ++seq;
  if (opts?.latestWins) latestByType.set(type, id);

  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => {
        // latest-wins: se è arrivata una richiesta più recente dello stesso tipo,
        // questa è superata → non risolvere (silently superseded), nessun reject spurio.
        if (opts?.latestWins && latestByType.get(type) !== id) return;
        resolve(v);
      },
      reject,
    });
    w.postMessage({ id, type, payload });
  });
}

export function disposeSolverWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
  latestByType.clear();
}
