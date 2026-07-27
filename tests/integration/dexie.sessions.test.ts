// tests/integration/dexie.sessions.test.ts
// Usa fake-indexeddb (configurato in tests/setup.ts) per ambienti Node/JSDOM
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db.ts';

describe('Dexie v5 — sessions + process_log + alerts + projection_cache', () => {

  beforeEach(async () => {
    await db.sessions.clear();
    await db.process_log.clear();
    await db.alerts.clear();
    await db.projection_cache.clear();
  });

  const mkSession = (overrides: Record<string, unknown> = {}) => ({
    status: 'planning' as const,
    style: 'napoletana',
    hydration: 65,
    salt: 2,
    createdAt: new Date(),
    startedAt: new Date(),
    targetBakeAt: new Date(),
    ...overrides,
  });

  it('INT-DEX-01: sessione salvabile e recuperabile per id', async () => {
    const id = await db.sessions.add(mkSession() as any);
    const s = await db.sessions.get(id);
    expect(s?.style).toBe('napoletana');
  });

  it('INT-DEX-02: schema usa hydration e salt (non hydrationPct — erratum v2.4.18)', async () => {
    const id = await db.sessions.add(mkSession({ status: 'active', style: 'contemporanea', hydration: 70, salt: 2.7 }) as any);
    const s = await db.sessions.get(id);
    expect(s?.hydration).toBe(70);
    expect(s?.salt).toBe(2.7);
    expect((s as any)?.hydrationPct).toBeUndefined();
  });

  it('INT-DEX-03: ProcessLogEntry accetta enzAdu e leavAdu separati', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    const logId = await db.process_log.add({
      sessionId, recordedAt: new Date(), hlcTimestamp: '2026-01-01T00:00:00.000Z',
      deviceId: 'test-device', tempAmbient: 22, tempDough: 22,
      doughLocation: 'bulk_room', tempSource: 'manual',
      cumulativeAdu: 1.5, deltaAdu: 0.1, deltaTSeconds: 60,
      maturationPct: 15, wEffective: 275,
      enzAdu: 1.2, leavAdu: 0.3,
      syncedAt: null,
    } as any);
    const log = await db.process_log.get(logId);
    expect(log?.enzAdu).toBe(1.2);
    expect(log?.leavAdu).toBe(0.3);
  });

  it('INT-DEX-04: query per [status+createdAt] funziona (indice composito)', async () => {
    await db.sessions.add(mkSession({ status: 'active', style: 'teglia', hydration: 72, salt: 2.5, createdAt: new Date('2026-01-01') }) as any);
    const results = await db.sessions.where('[status+createdAt]').between(
      ['active', new Date('2025-12-31')],
      ['active', new Date('2026-12-31')],
    ).toArray();
    expect(results.length).toBeGreaterThan(0);
  });

  it('INT-DEX-05: projection_cache unique constraint su sessionId (&sessionId)', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active', style: 'pala', hydration: 68 }) as any);
    await db.projection_cache.add({ sessionId, computedAt: new Date(), data: '{}' } as any);
    await expect(
      db.projection_cache.add({ sessionId, computedAt: new Date(), data: '{}' } as any),
    ).rejects.toThrow();
  });

  it('INT-DEX-06: alerts query per [sessionId+level]', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    await db.alerts.add({ sessionId, level: 'CRITICAL', message: 'Test', createdAt: new Date() } as any);
    const alerts = await db.alerts.where('[sessionId+level]').equals([sessionId, 'CRITICAL']).toArray();
    expect(alerts.length).toBe(1);
  });

  it('INT-DEX-07: status lifecycle planning→active→completed', async () => {
    const id = await db.sessions.add(mkSession() as any);
    await db.sessions.update(id, { status: 'active' });
    await db.sessions.update(id, { status: 'completed', endedAt: new Date() } as any);
    const s = await db.sessions.get(id);
    expect(s?.status).toBe('completed');
    expect((s as any)?.endedAt).toBeDefined();
  });

  it('INT-DEX-08: process_log append-only (5 record per sessione)', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    for (let i = 0; i < 5; i++) {
      await db.process_log.add({
        sessionId, recordedAt: new Date(), hlcTimestamp: `ts-${i}`,
        deviceId: 'device-1', tempAmbient: 22, tempDough: 22,
        doughLocation: 'bulk_room', tempSource: 'manual',
        cumulativeAdu: i * 0.5, deltaAdu: 0.5, deltaTSeconds: 60,
        maturationPct: i * 5, wEffective: 280 - i, syncedAt: null,
      } as any);
    }
    const logs = await db.process_log.where('sessionId').equals(sessionId).count();
    expect(logs).toBe(5);
  });

  it('INT-DEX-09: sessione con malt opzionale serializzabile', async () => {
    const id = await db.sessions.add(mkSession({
      style: 'teglia', hydration: 72, salt: 2.5,
      malt: { dosePercent: 0.3, dpLintner: 200, addedTo: 'final_dough' },
    }) as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.malt?.dpLintner).toBe(200);
  });

  it('INT-DEX-10: altitudeM e waterHardnessPpm salvati correttamente', async () => {
    const id = await db.sessions.add(mkSession({ altitudeM: 300, waterHardnessPpm: 200 }) as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.altitudeM).toBe(300);
    expect((s as any)?.waterHardnessPpm).toBe(200);
  });

  it('INT-DEX-11: projection_cache recuperabile per sessionId', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    await db.projection_cache.add({ sessionId, computedAt: new Date(), data: '{"test":true}' } as any);
    const cache = await db.projection_cache.where('sessionId').equals(sessionId).first();
    expect(cache).toBeDefined();
    expect(cache?.data).toBe('{"test":true}');
  });

  it('INT-DEX-12: sessione con prefermenti array serializzabile', async () => {
    const id = await db.sessions.add(mkSession({
      prefermenti: [{ id: 'p1', type: 'biga', flourFraction: 30, hydration: 48 }],
    }) as any);
    const s = await db.sessions.get(id);
    expect(Array.isArray((s as any)?.prefermenti)).toBe(true);
  });

  it('INT-DEX-13: outcomeRating salvabile su sessione completed', async () => {
    const id = await db.sessions.add(mkSession({ status: 'completed' }) as any);
    await db.sessions.update(id, { outcomeRating: 4 } as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.outcomeRating).toBe(4);
  });

  it('INT-DEX-14: query sessioni per stile (indice style)', async () => {
    await db.sessions.add(mkSession({ style: 'teglia', hydration: 72 }) as any);
    await db.sessions.add(mkSession({ style: 'napoletana', hydration: 65 }) as any);
    const teglia = await db.sessions.where('style').equals('teglia').toArray();
    expect(teglia.length).toBeGreaterThanOrEqual(1);
    expect(teglia.every(s => s.style === 'teglia')).toBe(true);
  });

  it('INT-DEX-15: process_log query per sessionId', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    await db.process_log.add({ sessionId, recordedAt: new Date(), hlcTimestamp: 'ts-0', deviceId: 'd1',
      tempAmbient: 22, tempDough: 22, doughLocation: 'bulk_room', tempSource: 'manual',
      cumulativeAdu: 0.5, deltaAdu: 0.1, deltaTSeconds: 60, maturationPct: 5, wEffective: 280, syncedAt: null } as any);
    const logs = await db.process_log.where('sessionId').equals(sessionId).toArray();
    expect(logs.length).toBe(1);
  });

  it('INT-DEX-16: sessione abortita ha status=aborted', async () => {
    const id = await db.sessions.add(mkSession({ status: 'active' }) as any);
    await db.sessions.update(id, { status: 'aborted', endedAt: new Date() } as any);
    const s = await db.sessions.get(id);
    expect(s?.status).toBe('aborted');
  });

  it('INT-DEX-17: peakMaturation e finalAdu salvabili su sessione', async () => {
    const id = await db.sessions.add(mkSession({ status: 'completed' }) as any);
    await db.sessions.update(id, { peakMaturation: 87.5, finalAdu: 11.2 } as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.peakMaturation).toBeCloseTo(87.5, 1);
  });

  it('INT-DEX-18: userNotes salvato e recuperato correttamente', async () => {
    const id = await db.sessions.add(mkSession() as any);
    await db.sessions.update(id, { userNotes: 'Impasto riuscito bene.' } as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.userNotes).toBe('Impasto riuscito bene.');
  });

  it('INT-DEX-19: alertsCount incrementabile su sessione', async () => {
    const id = await db.sessions.add(mkSession({ alertsCount: 0 }) as any);
    await db.sessions.update(id, { alertsCount: 3 } as any);
    const s = await db.sessions.get(id);
    expect((s as any)?.alertsCount).toBe(3);
  });

  it('INT-DEX-20: ProcessLogEntry.syncedAt null inizialmente, aggiornabile a Date', async () => {
    const sessionId = await db.sessions.add(mkSession({ status: 'active' }) as any);
    const logId = await db.process_log.add({
      sessionId, recordedAt: new Date(), hlcTimestamp: 'ts-sync', deviceId: 'd1',
      tempAmbient: 22, tempDough: 22, doughLocation: 'bulk_room', tempSource: 'manual',
      cumulativeAdu: 1.0, deltaAdu: 0.1, deltaTSeconds: 60, maturationPct: 10,
      wEffective: 280, syncedAt: null,
    } as any);
    const logBefore = await db.process_log.get(logId);
    expect(logBefore?.syncedAt).toBeNull();
    await db.process_log.update(logId, { syncedAt: new Date() } as any);
    const logAfter = await db.process_log.get(logId);
    expect(logAfter?.syncedAt).toBeInstanceOf(Date);
  });
});
