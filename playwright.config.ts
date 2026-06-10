/**
 * PizzaMatrix — Playwright config (OBIETTIVO 3, UI stress)
 * Avvia automaticamente il dev server Vite e gira gli spec in tests/.
 * Browser non incluso in questo sandbox (CDN bloccato): `npx playwright install chromium`
 * in locale prima di `npx playwright test`.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.PM_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['iPhone SE'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PM_BASE_URL ?? 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
