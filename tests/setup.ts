/**
 * Setup for tests/** suite (v2.4.25).
 * Uses fake-indexeddb for real Dexie integration tests (no mock).
 * Does NOT mock @capacitor plugins or the db module.
 */
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Silence console.warn in tests
vi.spyOn(console, 'warn').mockImplementation(() => {});
