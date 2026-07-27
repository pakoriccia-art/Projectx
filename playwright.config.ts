/**
 * PizzaMatrix — Playwright config
 * Avvia automaticamente il dev server Vite e gira gli spec in tests/e2e/.
 * Prima di usare: `npx playwright install chromium`
 */
import { defineConfig, devices } from '@playwright/test';

// Samsung Galaxy S25 — viewport identico S24 (360×780, DPR 3), UA string aggiornata
const GalaxyS25 = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
  viewport:         { width: 360, height: 780 },
  deviceScaleFactor: 3,
  isMobile:          true,
  hasTouch:          true,
  defaultBrowserType: 'chromium' as const,
};

const GalaxyS25Landscape = {
  ...GalaxyS25,
  viewport: { width: 780, height: 360 },
};

export default defineConfig({
  testDir:       './tests/e2e',
  testMatch:     '**/*.spec.ts',
  timeout:        30_000,
  fullyParallel:  true,
  retries:        process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL:    process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
    video:      'off',
  },

  projects: [
    // ── Galaxy S25 (dispositivo principale) ──────────────────────────────────
    {
      name: 'Galaxy S25',
      use: { ...GalaxyS25 },
    },
    {
      name: 'Galaxy S25 landscape',
      use: { ...GalaxyS25Landscape },
    },
    // ── Riferimento desktop Chromium ─────────────────────────────────────────
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    // ── Pixel 5 — già nei test E2E-DSH-02 ───────────────────────────────────
    {
      name: 'Pixel 5',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    command:             'npm run dev',
    url:                 process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout:              60_000,
  },
});
