/**
 * PizzaMatrix — preferenze del dispositivo (es. il forno che usi), da una
 * sessione all'altra. localStorage può mancare o lanciare: allora il default.
 */
const PREFIX = 'pm-prefs:';

export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage pieno o bloccato: la sessione tiene comunque il valore */ }
}
