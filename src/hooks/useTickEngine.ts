/**
 * PizzaMatrix — useTickEngine
 * Hook che esegue il tick loop dell'engine ogni TICK_INTERVAL ms.
 * Aggiorna ADU, pH, W_current, temperatura impasto, maturationPct.
 * v2.4.0: include sale, durezza acqua, inerzia bifase.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  kEffective, gompertz, estimatePH,
  computeTCrit, computeWHill, doughCoreTemp,
  thermalTimeConstant, thermalTimeConstantSphere,
  applyContainerResistance, currentDoughMassKg,
  fSaltYeast, fSaltProtease,
  fHardnessProtease,
  amylaseCorrectedRate,
  HILL_W_DECAY,
} from '../engine';

const TICK_INTERVAL_MS = 10_000;  // 10 secondi reali
const SIM_MINUTES_PER_TICK = 6;   // 1s reale = 6 min simulati (per demo)
const USE_SIM_TIME = false;        // true = accelerato per demo

export function useTickEngine() {
  const { state, dispatch } = useApp();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const tick = useCallback(() => {
    const session = state.activeSession;
    if (!session) return;

    const now = Date.now();
    const prevTick = lastTickRef.current;
    const realDeltaMs  = now - prevTick;
    const deltaSec     = USE_SIM_TIME
      ? SIM_MINUTES_PER_TICK * 60
      : realDeltaMs / 1000;
    const deltaH       = deltaSec / 3600;
    lastTickRef.current = now;

    const ts = state.tickState;
    const prevAdu       = ts?.cumulativeAdu ?? 0;
    const prevTDough    = ts?.tempDough ?? (session as any).initialTempC ?? 22;
    const prevPH        = ts?.estimatedPH ?? (session.initialPH ?? 5.8);
    const tAmbient      = ts?.tempAmbient ?? 22;
    const elapsedH      = ts?.elapsedH ?? 0;
    const phase         = ts?.phase ?? 'bulk_room';

    // ── Temperatura impasto ──────────────────────────────────────────────────
    const massKg = (currentDoughMassKg as Function)(session, phase);
    const tauBase = phase === 'bulk_room' || phase === 'bulk_fridge'
      ? (thermalTimeConstant as Function)(massKg, session.hydration)
      : (thermalTimeConstantSphere as Function)(massKg, session.hydration);
    const tauTotal = (applyContainerResistance as Function)(tauBase, session.containerPreset);
    const tDough = (doughCoreTemp as Function)(prevTDough, tAmbient, deltaSec, tauTotal);

    // ── Salt factors v2.4 ───────────────────────────────────────────────────
    const saltPct       = session.salt ?? 0;
    const saltYeast     = (fSaltYeast as Function)(saltPct);
    const saltProtease  = (fSaltProtease as Function)(saltPct);
    const hardProt      = session.waterHardnessPpm != null
      ? (fHardnessProtease as Function)(session.waterHardnessPpm)
      : 1.0;

    // ── kEffective + amylase correction ─────────────────────────────────────
    const baseRate  = (kEffective as Function)(tDough, session.agentEaKj, session.agentType);
    const corrRate  = (amylaseCorrectedRate as Function)(
      baseRate, session.effectiveAmylaseIndex, elapsedH, prevPH
    );
    // kRatio normalizzato (kRef a 25°C)
    const kRef = (kEffective as Function)(25, session.agentEaKj, session.agentType);
    const kRatioVal = kRef > 1e-12 ? corrRate / kRef : 0;

    // deltaAdu con inibizione sale
    const deltaAdu = kRatioVal * saltYeast * deltaH;
    const newAdu   = prevAdu + deltaAdu;

    // ── Maturazione Gompertz ─────────────────────────────────────────────────
    const matPct = (gompertz as Function)(
      newAdu + (session.initialMaturationOffset ?? 0) * 10,  // offset ADU approssimato
      session.agentMuMax,
      session.agentLambda,
      session.agentAsymptote ?? 100
    );

    // ── pH stimato ───────────────────────────────────────────────────────────
    const newPH = (estimatePH as Function)(session.initialPH ?? 5.8, matPct * 0.3, elapsedH + deltaH);

    // ── W corrente Hill ──────────────────────────────────────────────────────
    const W0     = session.effectiveW_initial;
    const tCrit  = (computeTCrit as Function)(W0, tDough, newPH, session.hydration)
                    / (saltProtease * hardProt);
    const W_curr = (computeWHill as Function)(W0, tCrit, elapsedH + deltaH, HILL_W_DECAY.hillExponent);

    // ── Alert ────────────────────────────────────────────────────────────────
    const wDecayPct = ((W0 - W_curr) / W0) * 100;
    if (wDecayPct > 35 && (ts == null || (ts as any).wAlertSent !== 'critical')) {
      dispatch({ type: 'ALERT_ADD', alert: {
        id: `w_crit_${Date.now()}`, level: 'critical',
        message: `W decay ${wDecayPct.toFixed(1)}% — struttura critica`,
        timestamp: Date.now()
      }});
    } else if (matPct > (session.alertThreshold ?? 85) && (ts == null || !(ts as any).peakAlertSent)) {
      dispatch({ type: 'ALERT_ADD', alert: {
        id: `peak_${Date.now()}`, level: 'advisory',
        message: `Maturazione ${matPct.toFixed(0)}% — zona ottimale raggiunta`,
        timestamp: Date.now()
      }});
    }

    dispatch({
      type: 'TICK',
      patch: {
        cumulativeAdu:  newAdu,
        maturationPct:  matPct,
        tempDough:      tDough,
        tempAmbient:    tAmbient,
        estimatedPH:    newPH,
        W_current:      W_curr,
        elapsedH:       elapsedH + deltaH,
        phase,
        lastTickAt:     now,
      } as any,
    });
  }, [state.activeSession, state.tickState, dispatch]);

  useEffect(() => {
    if (!state.activeSession) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    lastTickRef.current = Date.now();
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);
    tick(); // tick immediato
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.activeSession?.id]);

  const setTempAmbient = useCallback((t: number) => {
    dispatch({ type: 'TICK', patch: { tempAmbient: t } as any });
  }, [dispatch]);

  const setPhase = useCallback((p: string) => {
    dispatch({ type: 'TICK', patch: { phase: p } as any });
  }, [dispatch]);

  return { setTempAmbient, setPhase };
}
