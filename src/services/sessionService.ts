/**
 * PizzaMatrix — SessionService
 * Operazioni Dexie per sessioni, process_log, alerts
 */
import { db } from '../db/db';
import type { Session } from '../db/db';
import type { TickState } from '../context/AppContext';

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
