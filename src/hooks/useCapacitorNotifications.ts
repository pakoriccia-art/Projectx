/**
 * PizzaMatrix — useCapacitorNotifications
 * Notifiche locali Capacitor per sweet spot e W critico.
 * Su web: richiesta permessi no-op, schedule ignorato silenziosamente.
 */
import { useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useApp } from '../context/AppContext';

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

    // Sweet spot
    if (!sentRef.current.peak && matPct >= (session.alertThreshold ?? 85)) {
      sentRef.current.peak = true;
      LocalNotifications.schedule({
        notifications: [{
          id: 100,
          title: '🍕 Sweet Spot raggiunto!',
          body: `Maturazione ${matPct.toFixed(0)}% — zona ottimale. Pronti per la cottura!`,
          schedule: { at: new Date(Date.now() + 500) },
        }],
      }).catch(() => {});
    }

    // W critico
    if (!sentRef.current.crit && wDecay > 35) {
      sentRef.current.crit = true;
      LocalNotifications.schedule({
        notifications: [{
          id: 101,
          title: '⚠️ Struttura W critica',
          body: `Decadimento W: ${wDecay.toFixed(1)}% — cuoci subito!`,
          schedule: { at: new Date(Date.now() + 500) },
        }],
      }).catch(() => {});
    }
  }, [state.tickState, state.activeSession]);
}
