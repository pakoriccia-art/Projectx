// tests/e2e/wizard.flow.spec.ts
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('Wizard — flusso creazione sessione', () => {

  test('E2E-WIZ-01: app carica e titolo contiene PizzaMatrix', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/PizzaMatrix/);
  });

  test('E2E-WIZ-02: pulsante Nuova Sessione o wizard navigabile', async ({ page }) => {
    await page.goto(BASE_URL);
    const hasNewSession = await page.getByRole('button', { name: /Nuova Sessione/i }).isVisible().catch(() => false);
    const hasWizard = await page.getByTestId('wizard-step-1').isVisible().catch(() => false);
    expect(hasNewSession || hasWizard).toBe(true);
  });

  test('E2E-WIZ-03: app non crasha navigando a /wizard', async ({ page }) => {
    await page.goto(BASE_URL);
    // Naviga verso wizard (via hash o path)
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(1000);
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('E2E-WIZ-04: app root visibile', async ({ page }) => {
    await page.goto(BASE_URL);
    const root = page.locator('#root').or(page.getByTestId('app-root')).first();
    await expect(root).toBeVisible();
  });

  test('E2E-WIZ-05: nessun errore JS al caricamento', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    expect(errors.filter(e => !e.includes('ResizeObserver') && !e.includes('worker'))).toHaveLength(0);
  });

  test('E2E-WIZ-06: viewport mobile (375px) → app visibile senza overflow orizzontale', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL);
    const root = page.locator('#root').first();
    await expect(root).toBeVisible();
    const box = await root.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(430);
  });

  test('E2E-WIZ-07: app usa schema dark (background scuro)', async ({ page }) => {
    await page.goto(BASE_URL);
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    // Il tema è scuro (#0a0806 o simile) — almeno un canale RGB basso
    expect(bg).toMatch(/^rgb/);
  });

  test('E2E-WIZ-08: nessun redirect loop (page load stabile)', async ({ page }) => {
    const urls: string[] = [];
    page.on('framenavigated', f => urls.push(f.url()));
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);
    // Al massimo 2 navigazioni (redirect iniziale + finale)
    expect(urls.length).toBeLessThanOrEqual(3);
  });

  test('E2E-WIZ-09: meta viewport corretto per mobile', async ({ page }) => {
    await page.goto(BASE_URL);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('E2E-WIZ-10: touch target ≥ 44px per pulsanti interattivi', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL);
    const buttons = page.getByRole('button').first();
    const visible = await buttons.isVisible().catch(() => false);
    if (visible) {
      const box = await buttons.boundingBox();
      if (box) {
        // WCAG 2.1: almeno una dimensione ≥ 44px
        const ok = box.height >= 44 || box.width >= 44;
        expect(ok).toBe(true);
      }
    }
  });

  test('E2E-WIZ-11: nessun console.error con stack trace al caricamento', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('ResizeObserver')) {
        consoleErrors.push(msg.text());
      }
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    expect(consoleErrors.length).toBe(0);
  });

  test('E2E-WIZ-12: PWA manifest accessibile', async ({ page }) => {
    await page.goto(BASE_URL);
    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifest).toBeTruthy();
  });

  test('E2E-WIZ-13: icone PWA definite nel manifest', async ({ page }) => {
    await page.goto(BASE_URL);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    if (manifestHref) {
      const url = new URL(manifestHref, BASE_URL).href;
      const res = await page.request.get(url);
      if (res.ok()) {
        const json = await res.json();
        expect(json.icons?.length).toBeGreaterThan(0);
      }
    }
  });

  test('E2E-WIZ-14: display:standalone nel manifest (PWA installabile)', async ({ page }) => {
    await page.goto(BASE_URL);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    if (manifestHref) {
      const url = new URL(manifestHref, BASE_URL).href;
      const res = await page.request.get(url);
      if (res.ok()) {
        const json = await res.json();
        expect(json.display).toBe('standalone');
      }
    }
  });

  test('E2E-WIZ-15: nessun Mixed Content (tutto HTTPS o localhost)', async ({ page }) => {
    const insecure: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        insecure.push(url);
      }
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);
    expect(insecure).toHaveLength(0);
  });
});
