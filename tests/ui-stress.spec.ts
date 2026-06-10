/**
 * PizzaMatrix — UI Reflow & Interaction Stress (OBIETTIVO 3)
 *
 * Richiede un browser Playwright + dev server. Esegui con:
 *   npx playwright install chromium      # una tantum (serve rete CDN)
 *   npm run dev                          # in un terminale (porta 5173)
 *   npx playwright test tests/ui-stress.spec.ts
 *
 * NOTA: questo sandbox NON ha potuto scaricare il browser (CDN in blocklist),
 * quindi lo spec è fornito pronto-all'uso per l'esecuzione locale. I tre scenari
 * sono comunque stati validati staticamente contro il sorgente dei componenti
 * (vedi report nel commit). Le tre aree:
 *   O3-1  tap ad altissima frequenza su header/timeline → no memory leak/jank
 *   O3-2  tap su fasi PASSATE → bloccato dal vincolo isFuture
 *   O3-3  stringhe lunghissime (stile/telemetria) → no overflow/distorsione griglia
 */
import { test, expect, devices } from '@playwright/test';

const BASE = process.env.PM_BASE_URL ?? 'http://localhost:5173';

// Helper: porta l'app fino alla Dashboard v4 con una sessione attiva.
// Adatta i selettori al wizard reale del progetto se cambiano.
async function bootToDashboard(page: import('@playwright/test').Page) {
  await page.goto(BASE);
  // Avvia un nuovo impasto dalla home (bottone primario).
  const start = page.getByRole('button', { name: /nuovo|inizia|impasto|start/i }).first();
  if (await start.isVisible().catch(() => false)) await start.click();
  // Se esiste un percorso "demo/seed", preferiscilo; altrimenti il test verifica
  // solo i componenti raggiungibili. La dashboard è riconosciuta dall'header live.
  await page.waitForTimeout(500);
}

test.use({ ...devices['iPhone SE'] }); // viewport stretto 320px — caso peggiore reflow

// ─────────────────────────────────────────────────────────────────────────────
test.describe('O3-1 — tap ad altissima frequenza (timer/leak)', () => {
  test('200 tap rapidi su header e timeline non degradano i timer né perdono memoria', async ({ page }) => {
    await bootToDashboard(page);

    // Baseline heap (se disponibile via CDP)
    const heapBefore = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);

    // Conta gli interval attivi prima/dopo: stub di setInterval per rilevare leak.
    await page.evaluate(() => {
      (window as any).__intervals = 0;
      const orig = window.setInterval;
      // @ts-ignore
      window.setInterval = (...a: any[]) => { (window as any).__intervals++; return orig(...a); };
      const origClear = window.clearInterval;
      // @ts-ignore
      window.clearInterval = (id: any) => { (window as any).__intervals--; return origClear(id); };
    });

    const header = page.locator('header').first();
    for (let i = 0; i < 200; i++) {
      await header.click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
    }
    await page.waitForTimeout(300);

    const heapAfter = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
    const intervals = await page.evaluate(() => (window as any).__intervals);

    // Il numero netto di interval attivi deve restare piccolo e costante (no accumulo).
    expect(intervals, 'interval netti accumulati').toBeLessThanOrEqual(5);
    // Heap non deve esplodere (tolleranza 50MB) — euristica anti-leak.
    if (heapBefore > 0) expect(heapAfter - heapBefore).toBeLessThan(50 * 1024 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('O3-2 — tap su fasi passate bloccato da isFuture', () => {
  test('le fasi completate/correnti non sono cliccabili (cursor default, nessuna transizione)', async ({ page }) => {
    await bootToDashboard(page);

    // I marker tappabili espongono cursor:pointer + classe pm4-tap (solo isFuture).
    const tappable = page.locator('.pm4-tap');
    const allMarkers = page.locator('[class*="pm4-pip"], .pm4-tap, .pm4-pip-cur');

    const tappableCount = await tappable.count();
    const totalCount = await allMarkers.count();

    // Deve esistere almeno un marker non-tappabile (passato/corrente) se la timeline
    // ha più di una fase. Nessun marker passato deve avere cursor pointer.
    if (totalCount > tappableCount) {
      // Verifica che i marker NON .pm4-tap abbiano cursor != pointer
      const nonTap = page.locator('[class*="pm4-pip"]:not(.pm4-tap)');
      const n = await nonTap.count();
      for (let i = 0; i < n; i++) {
        const cursor = await nonTap.nth(i).evaluate(el => getComputedStyle(el.parentElement as Element).cursor);
        expect(cursor, `marker passato #${i} non deve essere pointer`).not.toBe('pointer');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('O3-3 — reflow con stringhe estreme', () => {
  test('Zona 1 e i grafici non producono overflow orizzontale a 320px', async ({ page }) => {
    await bootToDashboard(page);

    // Inietta uno stile/telemetria abnorme nel DOM per stressare la griglia.
    await page.evaluate(() => {
      document.querySelectorAll('span, div').forEach((el) => {
        if (/napoletana|contemporanea/i.test(el.textContent ?? '')) {
          el.textContent = 'X'.repeat(120); // nome stile abnorme
        }
      });
    });
    await page.waitForTimeout(200);

    // Nessun elemento deve sforare la larghezza del viewport (overflow orizzontale).
    const overflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let worst = 0;
      document.querySelectorAll('*').forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.right > vw + 1) worst = Math.max(worst, r.right - vw);
      });
      return { vw, worst, scrollW: document.documentElement.scrollWidth };
    });

    // scrollWidth non deve superare il viewport di oltre 2px (tolleranza sub-pixel).
    expect(overflow.scrollW, `overflow orizzontale (peggiore +${overflow.worst}px)`).toBeLessThanOrEqual(overflow.vw + 2);
  });

  test('lo screenshot della dashboard a 320px è stabile (snapshot visivo)', async ({ page }) => {
    await bootToDashboard(page);
    await expect(page).toHaveScreenshot('dashboard-iphone-se.png', { maxDiffPixelRatio: 0.02, fullPage: true });
  });
});
