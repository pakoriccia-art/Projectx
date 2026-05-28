/**
 * PizzaMatrix — useTickEngine
 * Hook che esegue il tick loop dell'engine ogni TICK_INTERVAL ms.
 * Aggiorna ADU, pH, W_current, temperatura impasto, maturationPct.
 * v2.4.0: include sale, durezza acqua, inerzia bifase.
 *
 * FIX stale closure: sessionRef + tickStateRef sempre aggiornati via useEffect
 * così setInterval chiama sempre tick() con dati freschi.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  kEffective, gompertz, estimatePHForLBF,
  computeTCrit, computeWHill, doughCoreTemp,
  thermalTimeConstant, thermalTimeConstantSphere,
  applyContainerResistance, currentDoughMassKg,
  fSaltYeast, fSaltProtease,
  fHardnessProtease,
  amylaseCorrectedRate,
  HILL_W_DECAY,
  fArrhenius, ENZYMATIC_CLOCK_PARAMS,
} from '../engine';

const TICK_INTERVAL_MS    = 10_000;  // 10 secondi reali
const SIM_MINUTES_PER_TICK = 6;      // 1s reale = 6 min simulati (per demo)
const USE_SIM_TIME         = false;   // true = accelerato per demo

export function useTickEngine() {
  const { state, dispatch } = useApp();

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef  = useRef<number>(Date.now());

  // ── Refs sempre freschi: il setInterval li legge senza stale closure ────────
  const sessionRef   = useRef(state.activeSession);
  const tsRef        = useRef(state.tickState);

  useEffect(() => { sessionRef.current = state.activeSession; }, [state.activeSession]);
  useEffect(() => { tsRef.current      = state.tickState;     }, [state.tickState]);

  // ── Funzione tick stabile (dipende solo da dispatch, che non cambia mai) ────
  const tick = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    const now         = Date.now();
    const prevTick    = lastTickRef.current;
    const realDeltaMs = now - prevTick;
    const deltaSec    = USE_SIM_TIME ? SIM_MINUTES_PER_TICK * 60 : realDeltaMs / 1000;
    const deltaH      = deltaSec / 3600;
    lastTickRef.current = now;

    // Legge tickState dal ref → sempre il valore più recente
    const ts       = tsRef.current;
    const prevAdu  = ts?.cumulativeAdu  ?? 0;
    const prevTDough = ts?.tempDough    ?? 22;
    const tAmbient = ts?.tempAmbient    ?? 22;
    const elapsedH = ts?.elapsedH       ?? 0;
    const phase    = ts?.phase          ?? 'bulk_room';   // ← legge dal ref, non dalla closure

    // ── Temperatura impasto ────────────────────────────────────────────────────
    const massKg  = (currentDoughMassKg as Function)(session, phase);
    const tauBase = (phase === 'bulk_room' || phase === 'bulk_fridge')
      ? (thermalTimeConstant as Function)(massKg, session.hydration)
      : (thermalTimeConstantSphere as Function)(massKg, session.hydration);
    const tauTotal = (applyContainerResistance as Function)(tauBase, session.containerPreset);
    const tDough   = (doughCoreTemp as Function)(prevTDough, tAmbient, deltaSec, tauTotal);

    // ── Salt + water hardness (v2.4) ──────────────────────────────────────────
    const saltPct      = session.salt ?? 0;
    const saltYeast    = (fSaltYeast as Function)(saltPct);
    const saltProtease = (fSaltProtease as Function)(saltPct);
    const hardProt     = session.waterHardnessPpm != null
      ? (fHardnessProtease as Function)(session.waterHardnessPpm)
      : 1.0;

    // ── pH corrente (da prevAdu, senza circolarità) — KB §12.2 step 5 ──────────
    // Usa estimatePHForLBF (KB §2.6) con la maturazione del tick precedente.
    // Questo evita la dipendenza circolare: prevAdu → prevMatPct → currentPH → corrRate → newAdu
    const prevMatPct = (gompertz as Function)(
      prevAdu + (session.initialMaturationOffset ?? 0) * 10,
      session.agentMuMax, session.agentLambda, session.agentAsymptote ?? 100,
    ) as number;
    const currentPH = (estimatePHForLBF as Function)(
      session.initialPH ?? 5.8, prevMatPct,
    ) as number;

    // ── kEffective + amylase correction ───────────────────────────────────────
    const baseRate = (kEffective as Function)(tDough, session.agentEaKj, session.agentType);
    const corrRate = (amylaseCorrectedRate as Function)(
      baseRate, session.effectiveAmylaseIndex, elapsedH, currentPH,
    );
    const kRef     = (kEffective as Function)(25, session.agentEaKj, session.agentType);
    const kRatioVal = kRef > 1e-12 ? corrRate / kRef : 0;

    const deltaAdu = kRatioVal * saltYeast * deltaH;
    const newAdu   = prevAdu + deltaAdu;

    // ── Gompertz lievitazione (orologio lievito, ex maturationPct) ──────────────
    const matPct = (gompertz as Function)(
      newAdu + (session.initialMaturationOffset ?? 0) * 10,
      session.agentMuMax,
      session.agentLambda,
      session.agentAsymptote ?? 100,
    ) as number;
    const leaveningPct = matPct;  // alias esplicito — orologio lievito

    // ── Enzymatic clock (two-clock model, v2.4.1) ────────────────────────────
    // fArrhenius(tDough) usa Ea=47kJ/mol senza CTM: proteolisi rimane attiva
    // vicino a T_min (a 4°C = 29% del ritmo a 22°C, vs lievito a 0.55%).
    const prevEnzAdu      = ts?.enzymaticAdu ?? 0;
    const enzRate         = (fArrhenius as Function)(tDough) as number;
    const newEnzAdu       = prevEnzAdu + enzRate * deltaH;
    const enzymaticMatPct = (gompertz as Function)(
      newEnzAdu, ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100,
    ) as number;

    // ── pH stimato end-of-tick (stored for next tick) — KB §12.2 step 7 ───────
    const newPH = (estimatePHForLBF as Function)(
      session.initialPH ?? 5.8, matPct,
    ) as number;

    // ── W corrente Hill — damage integral ─────────────────────────────────────
    // FIX fisico: invece del modello snapshot W = W0/(1+(totalH/tCrit_corrente)^n)
    // — che causa salti discontinui di W ad ogni cambio di fase termica violando
    // l'irreversibilità della proteolisi — si usa l'integrale di danno cumulativo:
    //   D(t) = Σ [ΔH / tCrit(T_dough)]     (monotono crescente, Δ > 0)
    //   W(t) = W0 / (1 + D(t)^n)            (monotono non-crescente garantito)
    //
    // computeWHill(W0, tCrit=1.0, hours=D, n) ≡ W0/(1+(D/1)^n) = W0/(1+D^n) ✓
    const W0       = session.effectiveW_initial ?? 280;
    const tCrit    = (computeTCrit as Function)(W0, tDough, newPH, session.hydration)
                     / (saltProtease * hardProt);
    const prevWDmg = ts?.wDamage ?? 0;
    const wDamage  = prevWDmg + (tCrit > 1e-3 ? deltaH / tCrit : 0);
    const W_curr   = (computeWHill as Function)(
      W0, 1.0, wDamage, (HILL_W_DECAY as any).hillExponent,
    ) as number;

    // ── Alert (deduplication via ref) ─────────────────────────────────────────
    const wDecayPct = W0 > 0 ? ((W0 - W_curr) / W0) * 100 : 0;
    const prevFlags = ts as any;
    if (wDecayPct > 35 && prevFlags?.wAlertSent !== 'critical') {
      dispatch({ type: 'ALERT_ADD', alert: {
        id: `w_crit_${now}`, level: 'critical',
        message: `W decay ${wDecayPct.toFixed(1)}% — struttura critica`,
        timestamp: now,
      }});
    } else if (enzymaticMatPct > (session.alertThreshold ?? 85) && !prevFlags?.peakAlertSent) {
      dispatch({ type: 'ALERT_ADD', alert: {
        id: `peak_${now}`, level: 'advisory',
        message: `Maturazione ${enzymaticMatPct.toFixed(0)}% — zona ottimale raggiunta`,
        timestamp: now,
      }});
    }

    dispatch({
      type: 'TICK',
      patch: {
        cumulativeAdu:    newAdu,
        maturationPct:    enzymaticMatPct,  // ← ora = orologio enzimatico (two-clock)
        leaveningPct,                        // ← Gompertz lievito (ex maturationPct)
        enzymaticAdu:     newEnzAdu,
        enzymaticMatPct,
        tempDough:        tDough,
        tempAmbient:      tAmbient,
        estimatedPH:      newPH,
        W_current:        W_curr,
        wDamage,
        elapsedH:         elapsedH + deltaH,
        phase,
        lastTickAt:       now,
      } as any,
    });
  }, [dispatch]); // dispatch è stabile → tick non cambia mai → setInterval ok

  // ── Avvia / ferma il loop quando cambia la sessione ───────────────────────
  useEffect(() => {
    if (!state.activeSession) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    lastTickRef.current = Date.now();
    // Primo tick immediato per popolare tickState
    tick();
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSession?.id]); // tick è stabile, non serve come dep

  // ── Helpers esposti alla Dashboard ────────────────────────────────────────
  const setTempAmbient = useCallback((t: number) => {
    dispatch({ type: 'TICK', patch: { tempAmbient: t } as any });
  }, [dispatch]);

  /**
   * Cambia fase e, se si entra in una fase fredda (TC), aggiorna automaticamente
   * tempAmbient → session.fridgeTempC così Newton cooling si attiva subito.
   *
   * Fisica: senza questo auto-switch, l'utente dovrebbe manualmente aggiornare
   * T_amb via TempCard dopo aver cliccato PhaseStepper — se lo dimentica,
   * tAmbient rimane a 22°C e kRatio ≈ 0.711 invece di 0.006 → ADU in TC sbaglia
   * di ~12% del budget totale (1.18 ADU extra nelle prime 4h per closed_box).
   *
   * Per le fasi calde (TA): NON forziamo tAmbient — varia per contesto (20–28°C)
   * e l'utente lo conosce meglio del modello. Il Newton cooling poi lo porta verso
   * la nuova temperatura con la giusta inerzia termica.
   */
  const setPhase = useCallback((p: string) => {
    const isCold = p === 'bulk_fridge' || p === 'balled_fridge';
    const patch: Record<string, unknown> = { phase: p };
    if (isCold) {
      // Entra in TC: imposta tAmbient = fridgeTempC → Newton law del raffreddamento parte
      patch.tempAmbient = sessionRef.current?.fridgeTempC ?? 4;
    }
    dispatch({ type: 'TICK', patch: patch as any });
  }, [dispatch]);

  return { setTempAmbient, setPhase };
}
