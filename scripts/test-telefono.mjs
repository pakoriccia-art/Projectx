/**
 * PizzaMatrix — test sul telefono via adb (Playwright, API Android).
 * Lanciato da scripts/test-telefono.ps1. Richiede: telefono in debug USB, app
 * installata in build di debug (WebView ispezionabile), adb nel PATH.
 *
 * Verifica, su una sessione nuova con i valori di default del wizard:
 *  1. cambio fase STAGLIO: APPRETTO = staglio + 30 min (non + 4 h)
 *  2. "↶ Annulla" riporta la timeline com'era
 *  3. dopo la chiusura forzata dell'app, la sessione riprende (fase e maturazione)
 *  4. la timeline è salvata in IndexedDB
 *  5. Termina → Storico: un record, e la sessione non risorge riaprendo l'app
 *
 * Uso: node scripts/test-telefono.mjs [--wait 60] [--keep]
 *   --wait N  secondi ad app chiusa prima di riaprirla (default 60)
 *   --keep    non terminare la sessione alla fine
 */
import { _android as android } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PKG = 'com.pizzamatrix.app';
const args = process.argv.slice(2);
const WAIT_S = Number(args[args.indexOf('--wait') + 1]) || 60;
const KEEP = args.includes('--keep');
const OUT = path.resolve('test-results', 'telefono');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => s.replace(/\s+/g, ' ').trim();
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function openApp(device) {
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 30_000 });
  const page = await webview.page();
  await page.waitForLoadState('domcontentloaded');
  await sleep(2500);
  return page;
}

async function shot(page, device, name) {
  try { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); }
  catch { await device.screenshot({ path: path.join(OUT, `${name}.png`) }); }
}

/** Orari di una fase nella strip: "STAGLIO TA 14:30". */
async function timelineTimes(page) {
  const panel = page.locator('.pm4-stack').last().locator('.pm4-panel').filter({ hasText: 'COTTURA' }).last();
  const t = clean(await panel.innerText());
  const get = label => (t.match(new RegExp(`${label}\\s+(?:TA|TC)?\\s*(\\d{2}:\\d{2})`)) || [])[1] ?? null;
  return { text: t, staglio: get('STAGLIO'), appretto: get('APPRETTO') };
}

async function readDb(page) {
  return page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('PizzaMatrixDB');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const g = r.result.transaction('sessions').objectStore('sessions').getAll();
      g.onsuccess = () => res(g.result.map(s => ({
        id: s.id, status: s.status, hasSnapshot: !!s.lastTickState,
        mat: s.lastTickState?.enzymaticMatPct ?? null,
        timeline: (s.thermalTimeline || []).map(x => `${x.phaseType}:${x.status}`),
      })));
    };
  }));
}

async function runWizard(page) {
  await page.getByRole('button', { name: /Nuovo impasto/ }).first().click();
  for (let i = 0; i < 8; i++) {
    const cont = page.getByRole('button', { name: /Continua|Avvia sessione/ }).first();
    await cont.waitFor({ timeout: 15_000 });
    await sleep(500);
    const groups = page.locator('[role=radiogroup]');
    for (let g = 0; g < await groups.count(); g++) {
      if (await cont.isEnabled()) break;
      const grp = groups.nth(g);
      if (await grp.locator('[aria-checked=true]').count()) continue;
      await grp.locator('[role=radio]').first().click();
    }
    for (const re of [/Cassetta|Contenitore|Vaschetta/, /^TA\b/]) {
      if (await cont.isEnabled()) break;
      const el = page.getByRole('button', { name: re }).first();
      if (await el.count()) await el.click().catch(() => {});
    }
    if (!(await cont.isEnabled())) throw new Error(`wizard bloccato al passo ${i + 1}`);
    await cont.click();
    await sleep(400);
  }
  await sleep(2000);
}

const [device] = await android.devices();
if (!device) { console.error('Nessun telefono trovato da adb.'); process.exit(2); }
console.log(`Telefono: ${device.model()} (${device.serial()})`);

let page = await openApp(device);
const inDashboard = await page.locator('header').filter({ hasText: /Trascorso/i }).count();
if (inDashboard) {
  console.error('C\'è già una sessione in corso sul telefono. Terminala dall\'app (Termina) e rilancia il test.');
  await shot(page, device, '00-sessione-esistente');
  process.exit(3);
}

console.log('\n1 · Nuova sessione e staglio');
await runWizard(page);
await shot(page, device, '01-dashboard');
const before = await timelineTimes(page);
check('Dashboard aperta con la timeline', !!before.staglio, before.text);

await page.locator('[aria-label*="passa a STAGLIO"]').first().click();
await page.getByRole('button', { name: 'Conferma', exact: true }).click();
await sleep(1200);
await shot(page, device, '02-dopo-staglio');
const after = await timelineTimes(page);
const gap = after.staglio && after.appretto ? toMin(after.appretto) - toMin(after.staglio) : NaN;
check('APPRETTO = STAGLIO + 30 min', Math.abs(((gap % 1440) + 1440) % 1440 - 30) <= 1,
  `staglio ${after.staglio}, appretto ${after.appretto}`);

console.log('\n2 · Annulla');
await page.getByRole('button', { name: /↶ Annulla/ }).click();
await sleep(1000);
const undone = await timelineTimes(page);
check('Annulla ripristina la timeline', undone.staglio === before.staglio && undone.appretto === before.appretto,
  `prima ${before.staglio}/${before.appretto}, dopo annulla ${undone.staglio}/${undone.appretto}`);
check('STAGLIO di nuovo toccabile', await page.locator('[aria-label*="passa a STAGLIO"]').count() > 0);
await page.locator('[aria-label*="passa a STAGLIO"]').first().click();
await page.getByRole('button', { name: 'Conferma', exact: true }).click();
await sleep(1500);

const db1 = await readDb(page);
const active1 = db1?.find(s => s.status === 'active');
check('Timeline salvata in IndexedDB', !!active1 && active1.timeline.includes('balled_room:current'),
  active1 ? active1.timeline.join(' → ') : 'nessuna sessione attiva nel DB');

console.log(`\n3 · App chiusa per ${WAIT_S}s e riaperta`);
const matBefore = active1?.mat ?? null;
await device.shell(`am force-stop ${PKG}`);
await sleep(WAIT_S * 1000);
page = await openApp(device);
await shot(page, device, '03-dopo-riapertura');
const header = clean(await page.locator('header').first().innerText().catch(() => ''));
check('La sessione riprende sulla dashboard', /Trascorso/i.test(header), header.slice(0, 100));
check('Fase corrente: STAGLIO', /STAGLIO/.test(header));
const db2 = await readDb(page);
const active2 = db2?.find(s => s.status === 'active');
check('Maturazione non azzerata', active2?.mat != null && matBefore != null && active2.mat >= matBefore,
  `prima ${matBefore?.toFixed(2)}%, dopo ${active2?.mat?.toFixed(2)}%`);

if (!KEEP) {
  console.log('\n4 · Termina e Storico');
  await page.getByRole('button', { name: /^Termina$/ }).click();
  await page.getByRole('button', { name: /■ Termina/ }).click();
  await sleep(1500);
  await page.getByRole('button', { name: /Storico/ }).first().click();
  await sleep(1500);
  await shot(page, device, '04-storico');
  const body = clean(await page.locator('body').innerText());
  check('Nessuna sessione "in corso" nello Storico', !/in corso/i.test(body));
  const db3 = await readDb(page);
  check('Nessuna sessione attiva nel DB dopo Termina', !(db3 ?? []).some(s => s.status === 'active' && s.hasSnapshot));
  await device.shell(`am force-stop ${PKG}`);
  page = await openApp(device);
  const hdr = await page.locator('header').filter({ hasText: /Trascorso/i }).count();
  check('Riaprendo l\'app la sessione chiusa non riappare', hdr === 0);
}

const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(OUT, 'risultati.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Screenshot e risultati in ${OUT}`);
await device.close();
process.exit(failed.length ? 1 : 0);
