/**
 * PizzaMatrix — SessionService
 * Operazioni Dexie per sessioni, process_log, alerts
 */
import { db, buildInitialTimeline } from '../db/db';
import type { Session, ProcessLogEntry, PrefermentStage } from '../db/db';
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

  // ThermalTimeline: onora una timeline precomputata (es. dal Service-Window
  // planner, che include il segmento di tempering non ricostruibile dal solo
  // apprettoProtocol); altrimenti costruisce quella pianificata dal protocollo.
  const sessionWithId = { ...session, id };
  const thermalTimeline = session.thermalTimeline ?? buildInitialTimeline(sessionWithId);
  const bakeTargetElapsedH = session.startedAt && session.targetBakeAt
    ? Math.max(0, (new Date(session.targetBakeAt).getTime() - new Date(session.startedAt).getTime()) / 3600000)
    : undefined;
  await db.sessions.update(id, { thermalTimeline, bakeTargetElapsedH });

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
    // Terminata senza infornare: interrotta, non "completata" (e niente voto).
    status: session.bakedAt ? 'completed' : 'aborted',
    // La sessione finisce quando si inforna; il riepilogo può restare aperto dopo.
    endedAt: session.bakedAt ? new Date(session.bakedAt) : new Date(),
    peakMaturation: ts?.maturationPct ?? session.peakMaturation,
    finalAdu:       ts?.cumulativeAdu ?? session.finalAdu,
    // W a fine sessione: senza, lo Storico mostrava sempre usura 0%.
    effectiveW_current: ts?.W_current ?? session.effectiveW_current,
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

/** Esito dato a posteriori, dallo Storico o dal promemoria. */
export async function rateSession(id: number, outcomeRating: NonNullable<Session['outcomeRating']>): Promise<void> {
  await db.sessions.update(id, { outcomeRating });
}

// ─── Prefermento in preparazione ──────────────────────────────────────────────
// Un record 'planning' con la fase del prefermento: non ha tick né timeline,
// diventa una sessione vera quando l'utente conferma che il prefermento è pronto.

/** Oltre questo, una preparazione mai conclusa non si riprende più. */
const STAGE_MAX_AGE_MS = 5 * 24 * 3_600_000;

export async function savePrefermentStage(stage: PrefermentStage): Promise<number> {
  const d = stage.draft as { style?: Session['style']; prefermenti?: Session['prefermenti'] };
  return Number(await db.sessions.add({
    status: 'planning',
    style: d.style ?? 'napoletana',
    prefermenti: d.prefermenti ?? [],
    startedAt: stage.startedAt,
    createdAt: stage.startedAt,
    prefermentStage: stage,
  } as unknown as Session));
}

export async function findPrefermentStage(now = Date.now()): Promise<(PrefermentStage & { id: number }) | null> {
  const rows = await db.sessions.where('status').equals('planning').toArray();
  let best: (PrefermentStage & { id: number }) | null = null;
  for (const r of rows) {
    const st = r.prefermentStage;
    if (!st || r.id == null) continue;
    const t = new Date(st.startedAt).getTime();
    if (!Number.isFinite(t) || now - t > STAGE_MAX_AGE_MS) { await db.sessions.delete(r.id); continue; }
    if (!best || t > new Date(best.startedAt).getTime()) best = { ...st, id: r.id };
  }
  return best;
}

export async function deletePrefermentStage(id: number): Promise<void> {
  await db.sessions.delete(id);
}

export async function updatePrefermentStage(id: number, stage: PrefermentStage): Promise<void> {
  await db.sessions.update(id, { prefermentStage: stage });
}

/** Rete di sicurezza: elimina ogni preparazione (anche senza id noto). */
export async function deleteAllPrefermentStages(): Promise<void> {
  const rows = await db.sessions.where('status').equals('planning').toArray();
  for (const r of rows) if (r.id != null) await db.sessions.delete(r.id);
}
