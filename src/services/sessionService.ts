/**
 * PizzaMatrix — SessionService
 * Operazioni Dexie per sessioni, process_log, alerts
 */
import { db } from '../db/db';
import type { Session, ProcessLogEntry } from '../db/db';
import type { TickState } from '../context/AppContext';

/**
 * Avvia una sessione: persiste la Session con status='active' e scrive
 * il primo ProcessLogEntry con cumulativeAdu = initialMaturationOffset × 100
 * (KB §12.1 — kickoff sessione).
 *
 * Fire-and-forget: la sessione vive in React state durante il run, il DB
 * traccia la storia per il replay e le statistiche post-sessione.
 */
export async function startSession(session: Session): Promise<number> {
  const id = Number(await db.sessions.add({ ...session, status: 'active' }));
  // Two-clock seeding: l'offset prefermento semina la MATURAZIONE (la biga ha già
  // maturato), non la lievitazione. L'ADU lievito parte da 0 (impasto degassato).
  const initialMatPct = (session.initialMaturationOffset ?? 0) * 100;
  const entry: ProcessLogEntry = {
    sessionId:        id,
    recordedAt:       session.startedAt ?? new Date(),
    hlcTimestamp:     `${Date.now()}-0-0`,
    deviceId:         'local',
    tempAmbient:      session.tLaboratorio ?? 22,
    tempDough:        session.tLaboratorio ?? 22,
    doughLocation:    'bulk_room',
    tempSource:       'estimated',
    cumulativeAdu:    0,
    deltaAdu:         0,
    deltaTSeconds:    0,
    maturationPct:    initialMatPct,
    leaveningPct:     0,
    enzymaticMatPct:  initialMatPct,
    estimatedPH:      session.initialPH ?? 5.8,
    wEffective:       session.effectiveW_initial,
    syncedAt:         null,
  };
  await db.process_log.add(entry);
  return id;
}

export async function persistSession(
  session: Session,
  ts: TickState | null,
  alertsCount: number,
): Promise<void> {
  const record: Session = {
    ...session,
    status: 'completed',
    endedAt: new Date(),
    peakMaturation: ts?.maturationPct ?? session.peakMaturation,
    finalAdu:       ts?.cumulativeAdu ?? session.finalAdu,
    alertsCount,
  };
  await db.sessions.put(record);
}

export async function loadSessionHistory(limit = 30): Promise<Session[]> {
  return db.sessions
    .orderBy('createdAt')
    .reverse()
    .limit(limit)
    .toArray();
}

export async function deleteSession(id: number): Promise<void> {
  await db.sessions.delete(id);
  await db.process_log.where('sessionId').equals(id).delete();
  await db.alerts.where('sessionId').equals(id).delete();
}
