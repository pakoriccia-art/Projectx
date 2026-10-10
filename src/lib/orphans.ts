/**
 * PizzaMatrix — sessioni "active" orfane.
 * Prima della correzione dell'id, ogni sessione chiusa lasciava due record: quello
 * iniziale "active" e una copia "completed" senza id. Qui si decide cosa farne,
 * senza toccare la sessione in corso (quella con la fotografia del tick).
 */
export interface OrphanCandidate {
  id?: number;
  status: string;
  startedAt?: Date | string;
  lastTickState?: unknown;
}

export interface OrphanPlan {
  /** Doppioni di una sessione già salvata come "completed": si eliminano. */
  remove: number[];
  /** Sessioni mai chiuse: diventano "interrotte" (visibili nello Storico). */
  abort: number[];
}

const MAX_AGE_MS = 72 * 3_600_000;
const SAME_START_MS = 1_000;

const ms = (d: Date | string | undefined) => (d == null ? NaN : new Date(d).getTime());

export function classifyOrphans(rows: OrphanCandidate[], now = Date.now(), keepId?: number): OrphanPlan {
  const plan: OrphanPlan = { remove: [], abort: [] };
  const closedStarts = rows
    .filter(r => r.status === 'completed' || r.status === 'aborted')
    .map(r => ms(r.startedAt))
    .filter(Number.isFinite);
  for (const r of rows) {
    if (r.status !== 'active' || r.id == null || r.id === keepId) continue;
    const start = ms(r.startedAt);
    const stale = !Number.isFinite(start) || now - start > MAX_AGE_MS;
    if (r.lastTickState && !stale) continue;          // sessione viva: non si tocca
    const twin = Number.isFinite(start) && closedStarts.some(t => Math.abs(t - start) <= SAME_START_MS);
    (twin ? plan.remove : plan.abort).push(r.id);
  }
  return plan;
}
