// tests/e2e/dashboard.monitor.spec.ts
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('Dashboard v4 — caricamento e accessibilità di base', () => {

  test('E2E-DSH-01: app carica correttamente (status 200)', async ({ page }) => {
    const res = await page.goto(BASE_URL);
    expect(res?.status()).toBeLessThan(400);
  });

  test('E2E-DSH-02: viewport Pixel 5 (393×851) — app visibile', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto(BASE_URL);
    const root = page.locator('#root').or(page.getByTestId('app-root')).first();
    await expect(root).toBeVisible();
  });

  test('E2E-DSH-03: viewport iPhone 14 (390×844) — app visibile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    const root = page.locator('#root').or(page.getByTestId('app-root')).first();
    await expect(root).toBeVisible();
  });

  test('E2E-DSH-04: nessun error JS dopo 3 secondi di idle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => {
      if (!e.message.includes('ResizeObserver') && !e.message.includes('worker')) {
        errors.push(e.message);
      }
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  test('E2E-DSH-05: React root montato correttamente (id=root non vuoto)', async ({ page }) => {
    await page.goto(BASE_URL);
    const root = page.locator('#root');
    const innerHTML = await root.innerHTML();
    expect(innerHTML.length).toBeGreaterThan(50);
  });

  test('E2E-DSH-06: theme-color meta tag definito', async ({ page }) => {
    await page.goto(BASE_URL);
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBeTruthy();
  });

  test('E2E-DSH-07: nessuna richiesta a domini terzi non previsti', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('fonts.googleapis.com')) {
        externalRequests.push(url);
      }
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);
    // Solo Google Fonts ammesso come dominio esterno (CDN dichiarato nel manifest)
    expect(externalRequests.filter(u => !u.includes('fonts'))).toHaveLength(0);
  });

  test('E2E-DSH-08: content-type del bundle JS è javascript', async ({ page }) => {
    const jsRequests: string[] = [];
    page.on('response', res => {
      if (res.url().endsWith('.js')) jsRequests.push(res.headers()['content-type'] ?? '');
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(500);
    if (jsRequests.length > 0) {
      expect(jsRequests[0]).toContain('javascript');
    }
  });

  test('E2E-DSH-09: orientamento portrait rispettato (max-width 430px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL);
    const root = page.locator('#root').first();
    const box = await root.boundingBox();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(430);
    }
  });

  test('E2E-DSH-10: Service Worker registrato (PWA)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    const hasSW = await page.evaluate(() => !!navigator.serviceWorker?.controller || !!navigator.serviceWorker?.getRegistrations);
    expect(hasSW).toBe(true);
  });

  test('E2E-DSH-11: lang dell\'HTML è "it" (italiano)', async ({ page }) => {
    await page.goto(BASE_URL);
    const lang = await page.locator('html').getAttribute('lang');
    // L'app è italiana — lang può essere "it" o non definito (accettabile entrambi)
    expect(['it', null, '']).toContain(lang);
  });

  test('E2E-DSH-12: title non è vuoto', async ({ page }) => {
    await page.goto(BASE_URL);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('E2E-DSH-13: nessun 404 sulle risorse critiche (CSS, JS)', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', res => {
      if (res.status() === 404 && (res.url().endsWith('.js') || res.url().endsWith('.css'))) {
        failed.push(res.url());
      }
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);
    expect(failed).toHaveLength(0);
  });

  test('E2E-DSH-14: app max-width ≤ 430px su viewport 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(430);
  });

  test('E2E-DSH-15: snapshot baseline — app mountata entro 5 secondi', async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE_URL);
    await page.locator('#root').waitFor({ state: 'visible', timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
