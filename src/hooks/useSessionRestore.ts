/**
 * PizzaMatrix — useSessionRestore
 * All'avvio riprende la sessione attiva da IndexedDB, con la sua timeline e
 * l'ultima fotografia del tick: useTickEngine recupera poi il tempo trascorso
 * ad app chiusa. Gli orfani "active" creati prima della correzione dell'id
 * non hanno la fotografia e restano dove sono.
 */
import { useEffect, useRef } from 'react';
import { useApp, type TickState } from '../context/AppContext';
import { db, type Session } from '../db/db';

const MAX_AGE_MS = 72 * 3_600_000;

export async function findResumableSession(now = Date.now()): Promise<Session | null> {
  const active = await db.sessions.where('status').equals('active').toArray();
  const candidates = active
    .filter(s => s.lastTickState && s.startedAt && now - new Date(s.startedAt).getTime() < MAX_AGE_MS)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return candidates[0] ?? null;
}

export function useSessionRestore() {
  const { state, dispatch } = useApp();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || state.activeSession) return;
    tried.current = true;
    findResumableSession()
      .then(s => {
        if (!s) return;
        const { lastTickState, ...session } = s;
        dispatch({ type: 'SESSION_START', session: session as Session });
        dispatch({ type: 'TICK', patch: lastTickState as unknown as Partial<TickState> });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
