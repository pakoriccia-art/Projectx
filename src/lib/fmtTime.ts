/**
 * Un solo modo di dire il giorno in tutta l'app: orario prima, giorno come
 * suffisso solo se non è oggi. "domani" / "ieri", poi il giorno corto entro
 * sei giorni ("mer"), oltre la data ("6 ott"). Fuori dal motore: è testo.
 */

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}

/** Giorni di calendario fra `now` e `d` (0 oggi, 1 domani, −1 ieri). */
export function calendarDayDiff(d: Date | number, now: Date | number = Date.now()): number {
  return Math.round((startOfDay(new Date(d)) - startOfDay(new Date(now))) / DAY_MS);
}

/** "" oggi, "domani", "ieri", "mer" entro sei giorni, altrimenti "6 ott". */
export function fmtDay(d: Date | number, now: Date | number = Date.now()): string {
  const x = new Date(d);
  const diff = calendarDayDiff(x, now);
  if (diff === 0) return '';
  if (diff === 1) return 'domani';
  if (diff === -1) return 'ieri';
  if (Math.abs(diff) <= 6) return x.toLocaleDateString('it-IT', { weekday: 'short' }).replace(/\.$/, '');
  return x.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace(/\.$/, '');
}

/** "20:30" */
export function fmtHM(d: Date | number): string {
  return new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** "20:30", "09:46 domani", "09:46 mer", "09:46 6 ott". */
export function fmtClockDay(d: Date | number, now: Date | number = Date.now()): string {
  const day = fmtDay(d, now);
  const t = fmtHM(d);
  return day ? `${t} ${day}` : t;
}

/** Durate brevi: "76 s" sotto i 3 minuti, poi "10 min" / "11 min 30". */
export function fmtSeconds(s: number): string {
  const r = Math.round(s);
  if (r < 180) return `${r} s`;
  const m = Math.floor(r / 60), sec = r % 60;
  return sec ? `${m} min ${String(sec).padStart(2, '0')}` : `${m} min`;
}
