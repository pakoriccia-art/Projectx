/**
 * PizzaMatrix — Solver Client (v2.4.20)
 * Parità worker↔sync, fallback sincrono, latest-wins, determinismo svc-${i}.
 * Il worker reale non gira in jsdom: testiamo runSync (parità) e mockiamo
 * Worker per il path async/latest-wins.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runSync, runSolverTask, disposeSolverWorker } from '../solverClient';
import { buildServiceWindowTimeline, computePlannedMatPctAt } from '../../../engine/serviceWindowSolver.js';

// `any`: le pure functions JS espongono firme inferite con tutti i campi
// destrutturati come richiesti; nel test passiamo solo quelli rilevanti.
const WINDOW_INPUT: any = {
  puntataH: 2, staglioH: 0.5, tcHours: 10, temperingH: 1.5,
  serviceDurationH: 2, ambientTempC: 22, fridgeTempC: 4,
};

describe('runSync — parità con le pure functions', () => {
  it('SOLVE_WINDOW: output identico a buildServiceWindowTimeline diretto', () => {
    const direct = buildServiceWindowTimeline(WINDOW_INPUT);
    const viaSync = runSync('SOLVE_WINDOW', { input: WINDOW_INPUT });
    expect(viaSync).toEqual(direct);
  });

  it('determinismo: due SOLVE_WINDOW con stesso input → id segmenti svc-0..n identici', () => {
    const a = runSync('SOLVE_WINDOW', { input: WINDOW_INPUT });
    const b = runSync('SOLVE_WINDOW', { input: WINDOW_INPUT });
    expect(a.map((s: any) => s.id)).toEqual(b.map((s: any) => s.id));
    expect(a[0].id).toBe('svc-0');
  });

  it('PLANNED_MAT_PCT: output identico a computePlannedMatPctAt diretto', () => {
    const timeline = buildServiceWindowTimeline(WINDOW_INPUT);
    const args: any = { timeline, initialState: undefined, elapsedH: 0, opts: undefined };
    const direct = computePlannedMatPctAt(args.timeline, args.initialState, args.elapsedH, args.opts);
    const viaSync = runSync('PLANNED_MAT_PCT', args);
    expect(viaSync).toEqual(direct);
  });
});

describe('runSolverTask — fallback sincrono (Worker indisponibile in jsdom)', () => {
  it('risolve via runSync quando typeof Worker === undefined', async () => {
    expect(typeof Worker).toBe('undefined'); // jsdom non implementa Worker
    const result = await runSolverTask('SOLVE_WINDOW', { input: WINDOW_INPUT });
    expect(result).toEqual(buildServiceWindowTimeline(WINDOW_INPUT));
  });
});

describe('runSolverTask — latest-wins (Worker mockato)', () => {
  class MockWorker {
    static instance: MockWorker | null = null;
    onmessage: ((e: { data: any }) => void) | null = null;
    posted: any[] = [];
    constructor() { MockWorker.instance = this; }
    postMessage(msg: any) { this.posted.push(msg); }
    terminate() {}
  }

  afterEach(() => {
    disposeSolverWorker();
    delete (globalThis as any).Worker;
    MockWorker.instance = null;
  });

  it('la richiesta superata non risolve né rigetta; risolve solo la più recente', async () => {
    (globalThis as any).Worker = MockWorker as any;
    disposeSolverWorker(); // forza ricreazione worker col mock

    const p1 = runSolverTask('SIMULATE', { segments: [], initial: {}, opts: {} }, { latestWins: true });
    const p2 = runSolverTask('SIMULATE', { segments: [], initial: {}, opts: {} }, { latestWins: true });

    const w = MockWorker.instance!;
    expect(w.posted.length).toBe(2);
    const id1 = w.posted[0].id;
    const id2 = w.posted[1].id;

    // Risponde prima alla richiesta superata (id1): NON deve risolvere p1.
    w.onmessage!({ data: { id: id1, ok: true, result: 'R1' } });
    // Poi alla più recente (id2): risolve p2.
    w.onmessage!({ data: { id: id2, ok: true, result: 'R2' } });

    await expect(p2).resolves.toBe('R2');

    // p1 resta pending: race con un timeout → vince il timeout (sentinella).
    const sentinel = Symbol('pending');
    const raced = await Promise.race([
      p1,
      new Promise((r) => setTimeout(() => r(sentinel), 20)),
    ]);
    expect(raced).toBe(sentinel);
  });
});
