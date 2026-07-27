/**
 * PizzaMatrix — ProcessLog two-clock writer (v2.4.19)
 * =============================================================
 * Persiste lo storico delle ProcessLogEntry dallo stato di simulazione
 * corrente (TickState). Sblocca calibration harness, tracking sessioni,
 * futura staglio-annotazione.
 *
 * INVARIANTI:
 *  - Offline-first: ogni scrittura locale ha `syncedAt: null`. Nessun backend.
 *  - Two-Clock §2.0: enzAdu/leavAdu/labAdu provengono dallo SimulationState,
 *    MAI ricombinati o derivati l'uno dall'altro.
 *  - Mai fabbricare dati: i campi assenti nello state restano `undefined`.
 *  - Osservatore passivo: NON modifica la logica di simulazione.
 * =============================================================
 */
import Dexie from 'dexie';
import { db } from '../db/db';
import type { ProcessLogEntry, Session } from '../db/db';
import type { TickState } from '../context/AppContext';

/** Cadenza di scrittura (minuti di tempo trascorso), non per sub-step. */
export const PROCESS_LOG_INTERVAL_MIN = 15;

/**
 * Costruisce (puro, senza I/O) una ProcessLogEntry dallo stato di simulazione.
 * I campi two-clock arrivano dal TickState separati. `currentPH` è già calcolato
 * a monte nel tick (computeCurrentPH end-of-tick) ed esposto come `estimatedPH`.
 */
export function buildProcessLogEntry({
  session, ts, recordedAt = new Date(), prevCumulativeAdu = 0, deltaTSeconds = 0,
}: {
  session: Session; ts: TickState;
  recordedAt?: Date; prevCumulativeAdu?: number; deltaTSeconds?: number;
}): ProcessLogEntry {
  // Riferimento cumulativo storico: l'ADU di maturazione enzimatica.
  const cumulativeAdu = ts.enzymaticAdu;
  return {
    sessionId:       session.id as number,
    recordedAt,
    hlcTimestamp:    `${recordedAt.getTime()}-0-0`,
    deviceId:        'local',
    tempAmbient:     ts.tempAmbient,
    tempDough:       ts.tempDough,
    doughLocation:   ts.phase,
    tempSource:      'estimated',
    cumulativeAdu,
    deltaAdu:        cumulativeAdu - prevCumulativeAdu,
    deltaTSeconds,
    maturationPct:   ts.enzymaticMatPct,
    leaveningPct:    ts.leaveningPct,
    enzymaticMatPct: ts.enzymaticMatPct,
    estimatedPH:     ts.estimatedPH,
    wEffective:      ts.W_current,
    // two-clock grezzi — dal TickState, separati (mai ricombinati)
    enzAdu:          ts.enzymaticAdu,
    leavAdu:         ts.cumulativeAdu,
    labAdu:          ts.labAdu,
    currentPH:       ts.estimatedPH,
    syncedAt:        null,
  };
}

/**
 * Persiste una ProcessLogEntry (fire-and-forget, offline-first).
 * Non blocca la UI; gli errori vengono solo loggati.
 */
export function logProcessEntry(args: {
  session: Session; ts: TickState;
  recordedAt?: Date; prevCumulativeAdu?: number; deltaTSeconds?: number;
}): ProcessLogEntry {
  const entry = buildProcessLogEntry(args);
  db.process_log.add(entry).catch((e) => console.warn('[PizzaMatrix] process_log add failed', e));
  return entry;
}

/** Storia di una sessione, ordinata per recordedAt (indice composto). */
export async function getSessionLog(sessionId: number): Promise<ProcessLogEntry[]> {
  return db.process_log
    .where('[sessionId+recordedAt]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .toArray();
}
