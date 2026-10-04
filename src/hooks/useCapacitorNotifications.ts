/**
 * PizzaMatrix — useCapacitorNotifications
 * Notifiche locali Capacitor: pronto per infornare, W critica e — programmata in
 * anticipo, così arriva anche a telefono bloccato — la prossima fase pianificata.
 * Su web: richiesta permessi no-op, schedule ignorato silenziosamente.
 */
import { useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useApp } from '../context/AppContext';
import { getStyleProfile } from '../engine';
import { buildEffectiveTimeline } from '../engine/outOfProtocol';
import { nextPlannedSegment, phaseActionText } from '../lib/phaseDue';
import { canBakeNow, isFridgePhase, resolveThreshold } from '../lib/bakeReadiness';
import { currentSpot, fridgeGain, normalizeStage, overSign, prefIsFeminine, prefWithArticle, stageStatus } from '../lib/preferment';

export const NOTIF_ID = {
  ready:   100,
  wCrit:   101,
  phase:   110,
  snooze:  111,
  outcome: 120,
  preferment: 130,
  prefermentLate: 131,
  prefermentNext: 132,
  prefermentFridge: 133,
} as const;

/** Programma una notifica a un istante preciso (no-op silenzioso dove manca). */
export function scheduleAt(id: number, title: string, body: string, at: Date) {
  LocalNotifications.cancel({ notifications: [{ id }] })
    .catch(() => {})
    .finally(() => {
      LocalNotifications.schedule({
        notifications: [{ id, title, body, schedule: { at, allowWhileIdle: true } }],
      }).catch(() => {});
    });
}

export function cancelNotification(id: number) {
  LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
}

interface SentState {
  peak: boolean;
  crit: boolean;
  sessionKey: string;
}

export function useCapacitorNotifications() {
  const { state } = useApp();
  const sentRef = useRef<SentState>({ peak: false, crit: false, sessionKey: '' });

  // Richiedi permessi al primo mount
  useEffect(() => {
    LocalNotifications.requestPermissions().catch(() => {/* no-op su web */});
  }, []);

  // Prefermenti in maturazione, anche ad app chiusa:
  //  130 pronto · 131 oltre la soglia · 132 ora di impastare il secondo · 133 frigo in anticipo.
  const stage = state.prefermentStage;
  useEffect(() => {
    const ids = [NOTIF_ID.preferment, NOTIF_ID.prefermentLate, NOTIF_ID.prefermentNext, NOTIF_ID.prefermentFridge];
    if (!stage) { ids.forEach(cancelNotification); return; }
    const st = normalizeStage(stage);
    const items = st.items ?? [];
    const main = items[0];
    const type = main?.type ?? 'biga';
    const Name = prefWithArticle(type).replace(/^./, c => c.toUpperCase());
    const fem = prefIsFeminine(type);
    const now = Date.now();
    const at = (id: number, title: string, body: string, when: number | null | undefined) => {
      if (when != null && when > now) scheduleAt(id, title, body, new Date(when)); else cancelNotification(id);
    };
    const status = stageStatus(st, now);
    at(NOTIF_ID.preferment, `🥣 ${Name} dovrebbe essere ${fem ? 'pronta' : 'pronto'}`,
      "Controlla i segni e, se ci siamo, apri PizzaMatrix per l'impasto finale.", status.readyAt);
    at(NOTIF_ID.prefermentLate, `⚠️ ${Name} potrebbe essere oltre`,
      `${overSign(type).replace(/: è oltre$/, '')}? Allora è oltre: impasta appena puoi o mett${fem ? 'ila' : 'ilo'} in frigo.`, status.lateAt);
    const next = items.slice(1).find(it => !it.mixedAt);
    at(NOTIF_ID.prefermentNext, `🥣 Ora impasta ${prefWithArticle(next?.type ?? 'poolish')}`,
      `Così è pronto insieme a ${prefWithArticle(type)}. Le dosi sono in PizzaMatrix.`, next ? new Date(next.startAt).getTime() : null);
    // Frigo in anticipo: un'ora prima del pronto, se non è già in frigo.
    const hintAt = status.readyAt - 3_600_000;
    if (main?.mixedAt && currentSpot(main, 'fresco').place !== 'frigo' && hintAt > now) {
      const g = fridgeGain(main, hintAt, (stage.draft as { fridgeTempC?: number }).fridgeTempC ?? 4);
      const hm = (ms: number) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      at(NOTIF_ID.prefermentFridge, `🥣 ${Name} tra un'ora è ${fem ? 'pronta' : 'pronto'}`,
        `Se non impasti entro le ${hm(g.lateAtStay)}, mett${fem ? 'ila' : 'ilo'} in frigo: regge fino alle ${hm(g.lateAtFridge)}.`, hintAt);
    } else cancelNotification(NOTIF_ID.prefermentFridge);
  }, [stage?.id, stage?.readyAt, stage?.items]);

  // Prossima fase pianificata: notifica all'orario previsto, riprogrammata
  // a ogni cambio di timeline; cancellata a fine sessione.
  const session = state.activeSession;
  useEffect(() => {
    if (!session?.startedAt) { cancelNotification(NOTIF_ID.phase); return; }
    if (session.bakedAt) { cancelNotification(NOTIF_ID.phase); return; }
    const tl  = buildEffectiveTimeline(session, !!session.outOfProtocolPhaseConfirmed);
    const seg = nextPlannedSegment(tl);
    const startedMs = new Date(session.startedAt).getTime();
    const at = seg ? new Date(startedMs + seg.startElapsedH * 3_600_000) : null;
    if (!seg || !at || at.getTime() <= Date.now()) { cancelNotification(NOTIF_ID.phase); return; }
    scheduleAt(NOTIF_ID.phase, `🍕 ${phaseActionText(seg, tl)}`, 'Quando lo fai, registralo in PizzaMatrix: la previsione resta giusta.', at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.thermalTimeline, session?.outOfProtocolPhaseConfirmed, session?.bakedAt]);

  // Controlla triggers ad ogni tick
  useEffect(() => {
    const ts      = state.tickState;
    const session = state.activeSession;
    if (!ts || !session) return;

    // Rileva nuova sessione (reset flags)
    const key = session.startedAt instanceof Date
      ? session.startedAt.toISOString()
      : String(session.startedAt);

    if (sentRef.current.sessionKey !== key) {
      sentRef.current = { peak: false, crit: false, sessionKey: key };
    }

    const matPct  = ts.maturationPct;
    const W0      = session.effectiveW_initial ?? 280;
    const wDecay  = W0 > 0 ? ((W0 - ts.W_current) / W0) * 100 : 0;
    // Stessa soglia del semaforo in dashboard (profilo di stile).
    const threshold = resolveThreshold(session.alertThreshold, getStyleProfile(session.style)?.alertThreshold);
    const hadFridge = (session.thermalTimeline ?? []).some(sg => isFridgePhase(sg?.phaseType) && sg.status !== 'planned');
    const bakeable  = canBakeNow({ phase: ts.phase, tDoughC: ts.tempDough, hadFridge });

    // Pronto per infornare
    if (!sentRef.current.peak && !session.bakedAt && bakeable && matPct >= threshold) {
      sentRef.current.peak = true;
      LocalNotifications.schedule({
        notifications: [{
          id: NOTIF_ID.ready,
          title: '🍕 Pronto per infornare',
          body: `Maturazione ${matPct.toFixed(0)}%: puoi infornare.`,
          schedule: { at: new Date(Date.now() + 500) },
        }],
      }).catch(() => {});
    }

    // W critico
    if (!sentRef.current.crit && wDecay > 35) {
      sentRef.current.crit = true;
      LocalNotifications.schedule({
        notifications: [{
          id: NOTIF_ID.wCrit,
          title: '⚠️ Glutine allo stremo',
          body: `La W è calata del ${wDecay.toFixed(0)}%: inforna appena puoi.`,
          schedule: { at: new Date(Date.now() + 500) },
        }],
      }).catch(() => {});
    }
  }, [state.tickState, state.activeSession]);
}
