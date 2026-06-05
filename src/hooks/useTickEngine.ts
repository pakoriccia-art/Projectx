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
import { db, buildInitialTimeline, applyPhaseTransition } from '../db/db';
import {
  kEffective, gompertz, computeCurrentPH,
  computeTCrit, computeWHill, doughCoreTemp,
  thermalTimeConstant, thermalTimeConstantSphere,
  applyContainerResistance, currentDoughMassKg,
  fSaltYeast, fSaltProtease,
  fHardnessProtease,
  amylaseCorrectedRate,
  HILL_W_DECAY,
  fArrhenius, ENZYMATIC_CLOCK_PARAMS, findAduAt,
} from '../engine';

const TICK_INTERVAL_MS    = 10_000;  // 10 secondi reali
const SIM_MINUTES_PER_TICK = 6;      // 1s reale = 6 min simulati (per demo)
const USE_SIM_TIME         = false;   // true = accelerato per demo

// Soglie minime di variazione per triggerare un re-render (performance mobile)
const TICK_SIGNIFICANCE = {
  enzymaticMatPct: 0.05,  // %
  leaveningPct:    0.05,  // %
  tempDough:       0.05,  // °C
  W_current:       0.1,   // unità W
};

function hasSignificantChange(prev: Record<string, unknown> | null | undefined, next: {
  enzymaticMatPct: number; leaveningPct: number; tempDough: number; W_current: number;
}): boolean {
  if (!prev) return true;  // primo tick — sempre significativo
  return (
    Math.abs(next.enzymaticMatPct - ((prev.enzymaticMatPct as number) ?? 0)) >= TICK_SIGNIFICANCE.enzymaticMatPct ||
    Math.abs(next.leaveningPct    - ((prev.leaveningPct    as number) ?? 0)) >= TICK_SIGNIFICANCE.leaveningPct    ||
    Math.abs(next.tempDough       - ((prev.tempDough       as number) ?? 0)) >= TICK_SIGNIFICANCE.tempDough       ||
    Math.abs(next.W_current       - ((prev.W_current       as number) ?? 0)) >= TICK_SIGNIFICANCE.W_current
  );
}

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
    // Al primo tick ts è null: usa tLaboratorio della sessione come T iniziale impasto/ambiente.
    // I tick successivi leggono da ts (aggiornato ad ogni TICK dispatch).
    const prevTDough = ts?.tempDough    ?? session.tLaboratorio ?? 22;
    const tAmbient   = ts?.tempAmbient  ?? session.tLaboratorio ?? 22;
    const elapsedH = ts?.elapsedH       ?? 0;
    const phase    = ts?.phase          ?? 'bulk_room';   // ← legge dal ref, non dalla closure

    // ── Seeding prefermenti (two-clock) — FIX inversione maturazione/lievitazione ─
    // initialMaturationOffset semina l'orologio MATURAZIONE (la biga ha già maturato),
    // NON la lievitazione (l'impasto finale è degassato all'impastamento).
    // La biga influenza la lievitazione via CINETICA (popolazione di lievito attiva
    // → lag ridotto), non gonfiando il livello iniziale di gas.
    const matOffsetPct = (session.initialMaturationOffset ?? 0) * 100;   // [0,100]
    const prefFrac     = Math.min(1, (session.prefermenti ?? [])
      .reduce((s: number, p: any) => s + (p.flourFraction ?? 0) / 100, 0));
    // Seed enzimatico: ADU che produce enzymaticMatPct = matOffsetPct a t=0
    const enzSeed      = matOffsetPct > 0
      ? (findAduAt as Function)(ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100, matOffsetPct) as number
      : 0;
    // Lag lievitazione ridotto dalla biga (cinetica più rapida, non livello iniziale)
    const leavLambda   = Math.max(0.3, session.agentLambda * (1 - 0.5 * prefFrac));

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

    // ── pH corrente (da prevAdu, senza circolarità) — v2.4.11 §2.6.1 ──────────
    // pH prodotto dalla fermentazione (leavAdu), non dall'orologio enzimatico.
    // Usa prevAdu per evitare dipendenza circolare: prevAdu→currentPH→corrRate→newAdu
    const currentPH = (computeCurrentPH as Function)(
      session.initialPH ?? 5.8, prevAdu, session.agentType,
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

    // ── Gompertz lievitazione (orologio lievito) ────────────────────────────────
    // Parte BASSA (impasto degassato): nessun offset di maturazione iniettato.
    // La biga accelera solo la cinetica (leavLambda ridotto), non il livello.
    const matPct = (gompertz as Function)(
      newAdu,
      session.agentMuMax,
      leavLambda,
      session.agentAsymptote ?? 100,
    ) as number;
    const leaveningPct = matPct;  // alias esplicito — orologio lievito

    // ── Enzymatic clock (two-clock model, v2.4.1) ────────────────────────────
    // fArrhenius(tDough) usa Ea=47kJ/mol senza CTM: proteolisi rimane attiva
    // vicino a T_min (a 4°C = 29% del ritmo a 22°C, vs lievito a 0.55%).
    // Seed = enzSeed: la biga porta maturazione già acquisita (offset alto).
    const prevEnzAdu      = ts?.enzymaticAdu ?? enzSeed;
    const enzRate         = (fArrhenius as Function)(tDough) as number;
    const newEnzAdu       = prevEnzAdu + enzRate * deltaH;
    const enzymaticMatPct = (gompertz as Function)(
      newEnzAdu, ENZYMATIC_CLOCK_PARAMS.muMax, ENZYMATIC_CLOCK_PARAMS.lambda, 100,
    ) as number;

    // ── pH end-of-tick (da newAdu) — v2.4.11 §2.6.1 ───────────────────────────
    const newPH = (computeCurrentPH as Function)(
      session.initialPH ?? 5.8, newAdu, session.agentType,
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

    const tickPatch = {
      estimatedPH:      newPH,
      W_current:        W_curr,
      wDamage,
      elapsedH:         elapsedH + deltaH,
      phase,
      lastTickAt:       now,
    };

    // Dispatch solo su variazione significativa — evita re-render inutili su mobile
    const prevTs = state.tickState as Record<string, unknown> | null | undefined;
    if (hasSignificantChange(prevTs, {
      enzymaticMatPct, leaveningPct, tempDough: tDough, W_current: W_curr,
    })) {
      dispatch({ type: 'TICK', patch: tickPatch as any });
    }
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

  /**
   * Aggiorna T_amb in tickState E aggiorna la ThermalTimeline:
   * - il segmento current e i planned della stessa categoria termica (warm/cold)
   *   ricevono la nuova temperatura così la proiezione futura è coerente.
   * - i segmenti completed non vengono mai toccati.
   */
  const setTempAmbient = useCallback((t: number) => {
    dispatch({ type: 'TICK', patch: { tempAmbient: t } as any });
    const session = sessionRef.current;
    if (!session?.id || !session.thermalTimeline) return;
    const isColdPhase = tsRef.current?.phase === 'bulk_fridge' || tsRef.current?.phase === 'balled_fridge';
    const newTimeline = session.thermalTimeline.map(seg => {
      if (seg.status === 'completed') return seg;
      const segIsCold = seg.phaseType === 'bulk_fridge' || seg.phaseType === 'balled_fridge';
      return segIsCold === isColdPhase ? { ...seg, ambientTempC: t } : seg;
    });
    dispatch({ type: 'SESSION_UPDATE', patch: { thermalTimeline: newTimeline } } as any);
    db.sessions.update(session.id, { thermalTimeline: newTimeline }).catch(console.error);
  }, [dispatch]);

  /**
   * Cambia fase: logga la transizione nella ThermalTimeline (chiude il segmento
   * current, apre il nuovo) e, se si entra in una fase fredda (TC), aggiorna
   * automaticamente tempAmbient → session.fridgeTempC così Newton cooling parte subito.
   *
   * Principio: i bottoni di fase loggano transizioni, NON resettano la proiezione.
   * I segmenti completed sono immutabili → il passato non può appiattirsi.
   *
   * Fisica: senza auto-switch tAmbient, kRatio rimane a 0.711 invece di 0.006
   * → ADU in TC sbaglia di ~12% nelle prime 4h (per closed_box).
   */
  const setPhase = useCallback((p: string) => {
    const session = sessionRef.current;
    if (!session) return;
    const isCold = p === 'bulk_fridge' || p === 'balled_fridge';
    const ambientTempC = isCold ? (session.fridgeTempC ?? 4) : (session.tLaboratorio ?? 22);
    const nowElapsedH  = session.startedAt
      ? (Date.now() - new Date(session.startedAt).getTime()) / 3600000
      : 0;

    // Aggiorna ThermalTimeline (chiudi current, apri nuovo, ripianta planned)
    const existingTimeline = session.thermalTimeline ?? buildInitialTimeline(session);
    const newTimeline = applyPhaseTransition(existingTimeline, p, ambientTempC, nowElapsedH);
    dispatch({ type: 'SESSION_UPDATE', patch: { thermalTimeline: newTimeline } } as any);
    if (session.id) {
      db.sessions.update(session.id, { thermalTimeline: newTimeline }).catch(console.error);
    }

    // Aggiorna ts.phase e ts.tempAmbient sempre: frigo→TA ripristina tLaboratorio,
    // TA→frigo imposta fridgeTempC (Newton cooling parte subito in TC).
    dispatch({ type: 'TICK', patch: { phase: p, tempAmbient: ambientTempC } as any });
  }, [dispatch]);

  return { setTempAmbient, setPhase };
}
