/**
 * PizzaMatrix — AppContext reducer tests
 * Testa ogni action del reducer in isolamento (puro, senza React)
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';
import type { Session } from '../db/db';

// ─── Session fixture ──────────────────────────────────────────────────────────
const mockSession: Session = {
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
  targetBakeAt: new Date(Date.now() + 86_400_000),
  startedAt: new Date(), createdAt: new Date(),
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('AppContext — NAV', () => {
  it('view iniziale = home', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    expect(result.current.state.view).toBe('home');
  });

  it('NAV cambia view', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'NAV', view: 'wizard' }));
    expect(result.current.state.view).toBe('wizard');
  });
});

describe('AppContext — WIZARD', () => {
  it('WIZARD_UPDATE accumula patch', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'WIZARD_UPDATE', patch: { style: 'napoletana', hydration: 70 } }));
    expect(result.current.state.wizardDraft.style).toBe('napoletana');
    expect(result.current.state.wizardDraft.hydration).toBe(70);
  });

  it('WIZARD_RESET azzera draft e step', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'WIZARD_UPDATE', patch: { style: 'teglia' } });
      result.current.dispatch({ type: 'WIZARD_STEP',   step: 4 });
      result.current.dispatch({ type: 'WIZARD_RESET' });
    });
    expect(result.current.state.wizardDraft).toEqual({});
    expect(result.current.state.wizardStep).toBe(1);
  });
});

describe('AppContext — SESSION_START / SESSION_END', () => {
  it('SESSION_START imposta activeSession e view=dashboard', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'SESSION_START', session: mockSession }));
    expect(result.current.state.activeSession).toEqual(mockSession);
    expect(result.current.state.view).toBe('dashboard');
    expect(result.current.state.tickState).toBeNull();
  });

  it('SESSION_END azzera session e tickState, torna a home', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START', session: mockSession });
      result.current.dispatch({ type: 'SESSION_END' });
    });
    expect(result.current.state.activeSession).toBeNull();
    expect(result.current.state.tickState).toBeNull();
    expect(result.current.state.view).toBe('home');
  });
});

describe('AppContext — SESSION_UPDATE', () => {
  it('aggiorna campo su activeSession', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'SESSION_START',  session: mockSession });
      result.current.dispatch({ type: 'SESSION_UPDATE', patch: { alertThreshold: 90 } });
    });
    expect(result.current.state.activeSession?.alertThreshold).toBe(90);
  });

  it('no-op se non c\'è sessione attiva', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({ type: 'SESSION_UPDATE', patch: { alertThreshold: 90 } }));
    expect(result.current.state.activeSession).toBeNull();
  });
});

describe('AppContext — TICK', () => {
  it('TICK crea tickState se null', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({
      type: 'TICK',
      patch: { maturationPct: 42, tempDough: 22 } as any,
    }));
    expect(result.current.state.tickState?.maturationPct).toBe(42);
  });

  it('TICK mergia in tickState esistente', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'TICK', patch: { maturationPct: 10, tempDough: 20 } as any });
      result.current.dispatch({ type: 'TICK', patch: { maturationPct: 25 } as any });
    });
    expect(result.current.state.tickState?.maturationPct).toBe(25);
    expect((result.current.state.tickState as any)?.tempDough).toBe(20); // invariato
  });
});

describe('AppContext — ALERT', () => {
  it('ALERT_ADD aggiunge alert', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.dispatch({
      type: 'ALERT_ADD',
      alert: { id: 'a1', level: 'advisory', message: 'test', timestamp: Date.now() },
    }));
    expect(result.current.state.alerts).toHaveLength(1);
    expect(result.current.state.alerts[0].id).toBe('a1');
  });

  it('ALERT_CLEAR svuota alerts', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      result.current.dispatch({ type: 'ALERT_ADD', alert: { id: 'a1', level: 'info', message: 'm', timestamp: 0 } });
      result.current.dispatch({ type: 'ALERT_CLEAR' });
    });
    expect(result.current.state.alerts).toHaveLength(0);
  });

  it('buffer alerts limitato a 20', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.dispatch({
          type: 'ALERT_ADD',
          alert: { id: `a${i}`, level: 'info', message: `m${i}`, timestamp: i },
        });
      }
    });
    expect(result.current.state.alerts.length).toBeLessThanOrEqual(20);
  });
});
