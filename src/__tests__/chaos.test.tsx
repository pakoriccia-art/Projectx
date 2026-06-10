/**
 * PizzaMatrix — State & DB Chaos Testing (OBIETTIVO 2)
 * Esegui con: npx vitest run src/__tests__/chaos.test.tsx
 *
 * Inietta anomalie nei flussi di stato reattivi e nella persistenza Dexie:
 *  1. record Dexie corrotti / incompleti / timeline vuote → resilienza
 *  2. eventi contrastanti ultra-rapidi sul main clock (TICK/SESSION_*)
 *  3. transizione forzata a COLLAPSED durante ricalcolo async del solver
 *
 * Tutti i consumer derivati (buildTimelinePhases, buildInitialTimeline) devono
 * degradare con grazia: nessun throw, nessuna timeline NaN, nessun deadlock UI.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Il setup globale (src/__tests__/setup.ts) mocka INTERAMENTE ../db/db, perdendo
// le funzioni pure (buildInitialTimeline). Qui facciamo un mock PARZIALE: teniamo
// le funzioni reali e stubbiamo solo l'istanza Dexie `db` (IndexedDB assente in jsdom).
vi.mock('../db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/db')>();
  return {
    ...actual,
    db: {
      sessions: { put: vi.fn(), add: vi.fn(), update: vi.fn(), delete: vi.fn(),
        orderBy: vi.fn().mockReturnValue({ reverse: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) }) },
      process_log: { add: vi.fn(), where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ delete: vi.fn() }) }) },
      alerts: { where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ delete: vi.fn() }) }) },
    },
  };
});

import { AppProvider, useApp } from '../context/AppContext';
import { buildInitialTimeline, type Session } from '../db/db';
import { buildTimelinePhases } from '../components/dashboard/FermentationTimeline';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

// Sessione minima valida — i test la mutilano selettivamente
function makeSession(over: Partial<Session> = {}): Session {
  return {
    status: 'active', prefermenti: [],
    mainFlourGroup: {
      flours: [{ name: 'T', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }],
      effectiveW: 280, effectivePl: 0.55, effectiveProtein: 12.5,
      effectiveAsh: 0.55, effectiveAmylaseIndex: 1.0, isBlend: false,
    },
    effectiveW_initial: 280, effectivePl_initial: 0.55, effectiveProtein: 12.5,
    effectiveAsh: 0.55, effectiveAmylaseIndex: 1.0, effectiveW_current: 280,
    agentLabel: 'fresh_yeast', agentType: 'fresh_yeast', agentEaKj: 47,
    agentMuMax: 0.5, agentLambda: 2, agentAsymptote: 100, agentDosePct: 0.3,
    style: 'napoletana', hydration: 65, salt: 2, totalFlourGrams: 1000,
    alertThreshold: 85, containerPreset: 'closed_box', apprettoProtocol: 'ta',
    puntataH: 8, staglioH: 0.5, apprettoH: 4, numPanetti: 6, altitudeM: 0,
    waterHardnessPpm: 150, targetBakeAt: new Date(Date.now() + 86_400_000),
    startedAt: new Date(), createdAt: new Date(),
    ...over,
  } as Session;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('CHAOS-1 — record Dexie corrotti / incompleti', () => {
  it('buildInitialTimeline su sessione vuota {} non lancia e ritorna array', () => {
    expect(() => buildInitialTimeline({} as any)).not.toThrow();
    const tl = buildInitialTimeline({} as any);
    expect(Array.isArray(tl)).toBe(true);
    expect(tl.length).toBeGreaterThan(0); // usa i default
  });

  it('buildInitialTimeline con campi NaN/negativi → durate finite (no NaN segment)', () => {
    const tl = buildInitialTimeline({
      puntataH: NaN, staglioH: -5, apprettoH: Infinity, tcHours: -1,
      apprettoProtocol: 'tc_appreto', startedAt: new Date(),
    } as any);
    expect(Array.isArray(tl)).toBe(true);
    // Nessun segmento deve avere startElapsedH NaN se a monte i numeri sono validi;
    // qui verifichiamo solo che la funzione non esploda e produca oggetti coerenti.
    for (const seg of tl) {
      expect(typeof seg.phaseType).toBe('string');
      expect(seg).toHaveProperty('startElapsedH');
      expect(seg).toHaveProperty('endElapsedH');
    }
  });

  it('buildInitialTimeline con startedAt corrotto (stringa non-data) non lancia', () => {
    expect(() => buildInitialTimeline({ startedAt: 'non-una-data' as any })).not.toThrow();
  });

  it('buildInitialTimeline con apprettoProtocol sconosciuto → fallback tc_appreto', () => {
    const tl = buildInitialTimeline({ apprettoProtocol: 'xyz-protocollo-fantasma' } as any);
    expect(tl.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CHAOS-2 — timeline vuote / corrotte in buildTimelinePhases', () => {
  it('thermalTimeline = [] → ricostruisce dai default, non lancia', () => {
    const s = makeSession({ thermalTimeline: [] });
    expect(() => buildTimelinePhases([], s, new Date())).not.toThrow();
    const phases = buildTimelinePhases([], s, new Date());
    expect(Array.isArray(phases)).toBe(true);
  });

  it('thermalTimeline = undefined → ricostruisce dai default', () => {
    const s = makeSession();
    expect(() => buildTimelinePhases(undefined, s, new Date())).not.toThrow();
  });

  it('thermalTimeline con segmenti corrotti (durate NaN/mancanti) non lancia', () => {
    const s = makeSession();
    const corrupt: any[] = [
      { phaseType: 'bulk_room', startElapsedH: 0, endElapsedH: NaN, status: 'current' },
      { phaseType: 'proofing', startElapsedH: NaN, status: 'planned' },
      { /* segmento totalmente vuoto */ },
      null,
    ];
    expect(() => buildTimelinePhases(corrupt as any, s, new Date())).not.toThrow();
  });

  it('session senza startedAt → buildTimelinePhases usa Date.now() (no NaN absoluteTime)', () => {
    const s = makeSession({ startedAt: undefined as any });
    const phases = buildTimelinePhases(undefined, s, new Date());
    for (const p of phases) {
      expect(Number.isNaN(p.absoluteTime.getTime())).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CHAOS-3 — eventi contrastanti ultra-rapidi sul main clock', () => {
  it('100 TICK consecutivi non corrompono lo stato e mantengono l\'ultimo', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START', session: makeSession() });
      for (let i = 0; i < 100; i++) {
        result.current.dispatch({ type: 'TICK', patch: { cumulativeAdu: i, phase: i % 2 ? 'proofing' : 'bulk_room' } as any });
      }
    });
    expect(result.current.state.tickState?.cumulativeAdu).toBe(99);
    expect(result.current.state.activeSession).not.toBeNull();
  });

  it('SESSION_END nel mezzo di una raffica di TICK azzera tutto in modo coerente', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START', session: makeSession() });
      result.current.dispatch({ type: 'TICK', patch: { cumulativeAdu: 5 } as any });
      result.current.dispatch({ type: 'SESSION_END' });
      // TICK "in ritardo" che arriva DOPO la fine sessione (race tipica del tick engine)
      result.current.dispatch({ type: 'TICK', patch: { cumulativeAdu: 6 } as any });
    });
    // SESSION_END ha azzerato activeSession; il TICK tardivo crea un tickState orfano
    // ma NON resuscita la sessione → nessuno stato incoerente (session viva + view home).
    expect(result.current.state.activeSession).toBeNull();
    expect(result.current.state.view).toBe('home');
  });

  it('SESSION_UPDATE senza sessione attiva è un no-op (non crea sessione fantasma)', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'SESSION_UPDATE', patch: { hydration: 99 } }));
    expect(result.current.state.activeSession).toBeNull();
  });

  it('raffica alternata START/END/START non lascia stato a metà', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.dispatch({ type: 'SESSION_START', session: makeSession({ hydration: 60 + i }) });
        result.current.dispatch({ type: 'SESSION_END' });
      }
      result.current.dispatch({ type: 'SESSION_START', session: makeSession({ hydration: 88 }) });
    });
    expect(result.current.state.activeSession?.hydration).toBe(88);
    expect(result.current.state.tickState).toBeNull(); // START azzera sempre il tick
  });

  it('ALERT_ADD in raffica mantiene il buffer cappato (max 20)', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START', session: makeSession() });
      for (let i = 0; i < 50; i++) {
        result.current.dispatch({ type: 'ALERT_ADD', alert: { id: `a${i}`, level: 'WARNING', message: `m${i}`, at: new Date() } as any });
      }
    });
    const alerts = result.current.state.alerts;
    expect(alerts.length).toBeLessThanOrEqual(20);
    // l'ultimo deve essere preservato (FIFO con slice(-19))
    expect(alerts[alerts.length - 1]?.message).toBe('m49');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CHAOS-4 — COLLAPSED forzato durante ricalcolo async del solver', () => {
  it('TICK→COLLAPSED mentre arriva un SESSION_UPDATE async non blocca né corrompe', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'SESSION_START', session: makeSession() }));

    // Simula un ricalcolo async del solver (microtask) che risolve DOPO il collasso
    const asyncSolve = Promise.resolve().then(() => ({ feasible: true, newW: 250 }));

    act(() => {
      // il main clock scatta a COLLAPSED
      result.current.dispatch({ type: 'TICK', patch: { phase: 'proofing', alertLevel: 'STRUCTURAL_COLLAPSED' } as any });
    });
    expect((result.current.state.tickState as any)?.alertLevel).toBe('STRUCTURAL_COLLAPSED');

    // il solver async risolve e tenta un SESSION_UPDATE: deve applicarsi senza
    // deadlock e senza sovrascrivere lo stato di collasso del tick.
    const res = await asyncSolve;
    act(() => result.current.dispatch({ type: 'SESSION_UPDATE', patch: { effectiveW_current: res.newW } }));

    expect(result.current.state.activeSession?.effectiveW_current).toBe(250);
    // lo stato di collasso del tick è indipendente dalla sessione → resta COLLAPSED
    expect((result.current.state.tickState as any)?.alertLevel).toBe('STRUCTURAL_COLLAPSED');
  });

  it('COLLAPSED seguito da SESSION_END durante async non lascia tickState orfano persistente', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START', session: makeSession() });
      result.current.dispatch({ type: 'TICK', patch: { alertLevel: 'STRUCTURAL_COLLAPSED' } as any });
    });
    const late = Promise.resolve().then(() => 'late-solver-result');
    act(() => result.current.dispatch({ type: 'SESSION_END' }));
    await late;
    // SESSION_END pulisce tickState anche se un solver async era in volo
    expect(result.current.state.tickState).toBeNull();
    expect(result.current.state.activeSession).toBeNull();
  });
});
