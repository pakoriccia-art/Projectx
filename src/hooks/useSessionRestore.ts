/**
 * PizzaMatrix — useSessionRestore
 * All'avvio riprende la sessione attiva da IndexedDB, con la sua timeline e
 * l'ultima fotografia del tick: useTickEngine recupera poi il tempo trascorso
 * ad app chiusa. Riprende anche il prefermento in maturazione (aperto da solo se non c'è un impasto).
 * Gli orfani "active" creati prima della correzione dell'id
 * non hanno la fotografia e restano dove sono.
 */
import { useEffect, useRef } from 'react';
import { useApp, type TickState } from '../context/AppContext';
import { db, type Session } from '../db/db';
import { classifyOrphans } from '../lib/orphans';
import { deleteSession, findPrefermentStage, updatePrefermentStage } from '../services/sessionService';
import { normalizeStage } from '../lib/preferment';

/**
 * Pulizia all'avvio dei record "active" orfani (doppioni del vecchio bug dell'id
 * o sessioni mai chiuse). Non tocca mai la sessione da riprendere.
 */
export async function cleanOrphanSessions(keepId?: number, now = Date.now()): Promise<{ removed: number; aborted: number }> {
  const rows = await db.sessions.toArray();
  const plan = classifyOrphans(rows as any, now, keepId);
  for (const id of plan.remove) await deleteSession(id);
  for (const id of plan.abort) {
    const r = rows.find(x => x.id === id);
    await db.sessions.update(id, { status: 'aborted', endedAt: r?.startedAt ? new Date(r.startedAt) : new Date() });
  }
  return { removed: plan.remove.length, aborted: plan.abort.length };
}

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
      .then(async s => {
        await cleanOrphanSessions(s?.id).catch(err => console.error('[cleanOrphanSessions]', err));
        // Il prefermento in maturazione si riprende sempre; si apre da solo
        // solo se non c'è un impasto in corso (altrimenti resta raggiungibile).
        const found = await findPrefermentStage().catch(() => null);
        // Preparazioni salvate da build precedenti: si convertono e si risalvano.
        const stage = found ? { ...normalizeStage(found), id: found.id } : null;
        if (stage) {
          dispatch({ type: 'PREF_STAGE_SET', stage });
          if (!found!.items?.length || found!.plannedH == null) {
            const { id, ...rest } = stage;
            updatePrefermentStage(id, rest).catch(err => console.error('[updatePrefermentStage]', err));
          }
        }
        if (!s) {
          if (stage) dispatch({ type: 'NAV', view: 'preferment' });
          return;
        }
        const { lastTickState, ...session } = s;
        dispatch({ type: 'SESSION_START', session: session as Session });
        dispatch({ type: 'TICK', patch: lastTickState as unknown as Partial<TickState> });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
