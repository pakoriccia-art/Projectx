/**
 * PizzaMatrix — useSessionPersistence
 * Salva automaticamente su Dexie quando la sessione termina (SESSION_END).
 * Usa refs per catturare l'ultimo tickState valido prima che venga azzerato.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { persistSession } from '../services/sessionService';
import type { Session } from '../db/db';
import type { TickState } from '../context/AppContext';

export function useSessionPersistence() {
  const { state } = useApp();
  const prevSessionRef  = useRef<Session | null>(null);
  const lastTickRef     = useRef<TickState | null>(null);
  const lastAlertCount  = useRef<number>(0);

  // Aggiorna refs ogni render (inline — pattern "latest ref")
  // tickState: catturiamo solo valori non-null così dopo SESSION_END
  // il ref mantiene l'ultimo snapshot valido
  if (state.tickState !== null) {
    lastTickRef.current = state.tickState;
  }
  lastAlertCount.current = state.alerts.length;

  useEffect(() => {
    const prev = prevSessionRef.current;
    const curr = state.activeSession;

    if (prev !== null && curr === null) {
      // Sessione terminata → persisti su IndexedDB
      persistSession(prev, lastTickRef.current, lastAlertCount.current)
        .catch(console.error);
    }
    prevSessionRef.current = curr;
  }, [state.activeSession]);
}
