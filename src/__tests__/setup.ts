/**
 * Vitest global setup
 * Configura @testing-library/jest-dom matchers e mock Capacitor plugins
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ─── Mock Capacitor LocalNotifications ───────────────────────────────────────
// Su jsdom non esiste WebPlugin nativo; il mock previene crash nei test
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    schedule: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Mock Dexie (IndexedDB non disponibile in jsdom) ─────────────────────────
vi.mock('../db/db', () => {
  const sessions: object[] = [];
  return {
    db: {
      sessions: {
        put:      vi.fn().mockResolvedValue(1),
        add:      vi.fn().mockResolvedValue(1),
        delete:   vi.fn().mockResolvedValue(undefined),
        orderBy:  vi.fn().mockReturnValue({
          reverse: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(sessions) }),
          }),
        }),
      },
      process_log: {
        add:   vi.fn().mockResolvedValue(1),
        where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue(undefined) }) }),
      },
      alerts: {
        where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue(undefined) }) }),
      },
    },
  };
});
