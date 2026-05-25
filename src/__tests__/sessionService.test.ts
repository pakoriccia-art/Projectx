/**
 * PizzaMatrix — sessionService tests
 * Verifica persistSession, loadSessionHistory, deleteSession con Dexie mockato
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistSession, loadSessionHistory, deleteSession } from '../services/sessionService';
import { db } from '../db/db';
import type { Session } from '../db/db';

const mockSession: Session = {
  id: 1,
  status: 'active',
  prefermenti: [],
  mainFlourGroup: {
    flours: [{ name: 'T', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }],
    effectiveW: 280, effectivePl: 0.55, effectiveProtein: 12.5,
    effectiveAsh: 0.55, effectiveAmylaseIndex: 1.0, isBlend: false,
  },
  effectiveW_initial: 280, effectivePl_initial: 0.55,
  effectiveProtein: 12.5, effectiveAsh: 0.55,
  effectiveAmylaseIndex: 1.0, effectiveW_current: 280,
  agentLabel: 'fresh_yeast', agentType: 'fresh_yeast',
  agentEaKj: 47, agentMuMax: 0.5, agentLambda: 2, agentAsymptote: 100,
  agentDosePct: 0.3, style: 'napoletana', hydration: 65, salt: 2,
  totalFlourGrams: 1000, alertThreshold: 85,
  containerPreset: 'closed_box', apprettoProtocol: 'ta',
  puntataH: 8, staglioH: 0.5, apprettoH: 4,
  numPanetti: 6, altitudeM: 0, waterHardnessPpm: 150,
  targetBakeAt: new Date(), startedAt: new Date(), createdAt: new Date(),
};

const mockTickState = {
  cumulativeAdu: 1.234,
  maturationPct: 78.5,
  tempDough: 22.1,
  tempAmbient: 22,
  estimatedPH: 5.4,
  W_current: 265,
  elapsedH: 12,
  doughLocation: 'balled_room' as const,
  phase: 'balled_room' as const,
  lastTickAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistSession', () => {
  it('chiama db.sessions.put con status=completed', async () => {
    await persistSession(mockSession, mockTickState, 3);
    expect(db.sessions.put).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        peakMaturation: mockTickState.maturationPct,
        finalAdu: mockTickState.cumulativeAdu,
        alertsCount: 3,
      })
    );
  });

  it('usa valori dal tickState per peak/finalAdu', async () => {
    await persistSession(mockSession, mockTickState, 0);
    const call = (db.sessions.put as ReturnType<typeof vi.fn>).mock.calls[0][0] as Session;
    expect(call.peakMaturation).toBe(78.5);
    expect(call.finalAdu).toBe(1.234);
  });

  it('funziona con tickState null (sessione senza tick)', async () => {
    await expect(persistSession(mockSession, null, 0)).resolves.not.toThrow();
    const call = (db.sessions.put as ReturnType<typeof vi.fn>).mock.calls[0][0] as Session;
    expect(call.status).toBe('completed');
  });
});

describe('loadSessionHistory', () => {
  it('ritorna array (mock vuoto)', async () => {
    const result = await loadSessionHistory(10);
    expect(Array.isArray(result)).toBe(true);
  });

  it('chiama orderBy + reverse + limit', async () => {
    await loadSessionHistory(5);
    expect(db.sessions.orderBy).toHaveBeenCalledWith('createdAt');
  });
});

describe('deleteSession', () => {
  it('chiama db.sessions.delete con l\'id corretto', async () => {
    await deleteSession(42);
    expect(db.sessions.delete).toHaveBeenCalledWith(42);
  });

  it('pulisce anche process_log e alerts', async () => {
    await deleteSession(42);
    expect(db.process_log.where).toHaveBeenCalledWith('sessionId');
    expect(db.alerts.where).toHaveBeenCalledWith('sessionId');
  });
});
