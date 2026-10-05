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
 * Scenario "pianifica": Planner (Orario TC Appretto, Servizio, Qualità) → wizard →
 * dashboard: piano in alto, stato conservato, valori "dal Planner", niente modale
 * fuori protocollo, target "(dal piano)", fasi in frigo, annulla e ripresa.
 *
 * Scenario "prefermento": biga da preparare → fase "in corso" → app chiusa e
 * riaperta → impasto finale con la durata reale → dashboard. Poolish già pronto
 * → la sessione parte subito.
 *
 * Prima di ogni scenario, e dopo un errore, chiude ciò che un giro interrotto ha
 * lasciato aperto (impasto in corso, biga in preparazione).
 *
 * Uso: node scripts/test-telefono.mjs [--scenario nuovo|pianifica|prefermento|tutti] [--wait 60] [--keep]
 *   --scenario  quale percorso provare (default: tutti)
 *   --wait N    secondi ad app chiusa prima di riaprirla (default 60)
 *   --keep      non terminare la sessione alla fine (solo scenario nuovo)
 */
import { _android as android } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PKG = 'com.pizzamatrix.app';
const args = process.argv.slice(2);
const WAIT_S = Number(args[args.indexOf('--wait') + 1]) || 60;
const KEEP = args.includes('--keep');
const SCENARIO = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : 'tutti';
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

let device;

/**
 * Avvia l'app e aggancia la sua WebView. Dopo un force-stop la WebView nuova ha
 * un altro pid: si cerca per 60 s e, se Playwright non la vede, ci si ricollega
 * al telefono (la connessione nuova rilegge l'elenco delle WebView).
 */
async function openApp() {
  // Dopo un force-stop Android può metterci un attimo a liberare la WebView vecchia.
  await sleep(3000);
  const launch = async () => {
    const out = String(await device.shell(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${PKG}/.MainActivity`).catch(e => e));
    if (/Error|Exception/i.test(out)) await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  };
  await launch();
  const start = Date.now();
  const deadline = start + 120_000;
  let lastReconnect = start, relaunched = false;
  while (Date.now() < deadline) {
    const wv = device.webViews().find(w => w.pkg() === PKG);
    if (wv) {
      const page = await wv.page();
      await page.waitForLoadState('domcontentloaded');
      await sleep(2500);
      return page;
    }
    // Ogni 20 s ci si ricollega (la connessione nuova rilegge l'elenco delle WebView),
    // anche dopo il rilancio.
    if (Date.now() - lastReconnect > 20_000) {
      lastReconnect = Date.now();
      await device.close().catch(() => {});
      [device] = await android.devices();
    }
    // A 45 s: l'app forse non è partita davvero, si rilancia.
    if (!relaunched && Date.now() - start > 45_000) {
      relaunched = true;
      await device.shell(`am force-stop ${PKG}`).catch(() => {});
      await sleep(1500);
      await launch();
    }
    await sleep(1000);
  }
  // Diagnosi: l'app non è partita, o è partita ma la WebView non si vede?
  const pid = String(await device.shell(`pidof ${PKG}`).catch(() => '')).trim();
  const top = String(await device.shell('dumpsys activity activities | grep mResumedActivity').catch(() => '')).trim();
  console.error(`  · openApp: pid ${pid || 'nessuno'} · in primo piano: ${top.slice(0, 120) || '?'}`);
  await device.screenshot({ path: path.join(OUT, 'openapp-fallita.png') }).catch(() => {});
  throw new Error(`WebView di PizzaMatrix non trovata dopo 120 s (${pid ? 'app avviata' : 'app non avviata'})`);
}

async function shot(page, device, name) {
  try { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); }
  catch { await device.screenshot({ path: path.join(OUT, `${name}.png`) }); }
}

/** Orari di una fase nella strip: "STAGLIO TA 14:30". */
async function timelineTimes(page) {
  const panel = page.locator('.pm4-stack').last().locator('.pm4-panel').filter({ hasText: 'COTTURA' }).last();
  const t = clean(await panel.innerText());
  // l'orario può avere il giorno davanti ("lun 01:25") quando non è oggi
  const get = label => (t.match(new RegExp(`${label}\\s+(?:TA|TC)?\\s*(?:[a-zà]{2,4}\\.?\\s+)?(\\d{2}:\\d{2})`)) || [])[1] ?? null;
  return { text: t, staglio: get('STAGLIO'), appretto: get('APPRETTO') };
}

/**
 * La sessione del test: la più recente tra le "active" con fotografia del tick.
 * Sul telefono possono esserci record "active" orfani di versioni precedenti
 * (senza fotografia): non vanno confusi con quella in prova.
 */
const currentSession = rows => (rows ?? [])
  .filter(s => s.status === 'active' && s.hasSnapshot)
  .sort((a, b) => b.id - a.id)[0];

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
        stage: !!s.prefermentStage,
        prefs: (s.prefermenti || []).map(p => ({ type: p.type, durationH: p.durationH, tempC: p.tempC })),
      })));
    };
  }));
}

let lastRecap = '';
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
    if (i === 7) lastRecap = clean(await page.locator('body').innerText());
    await cont.click();
    await sleep(400);
  }
  await sleep(2000);
}

[device] = await android.devices();
if (!device) { console.error('Nessun telefono trovato da adb.'); process.exit(2); }
console.log(`Telefono: ${device.model()} (${device.serial()})`);

const headerText = async () => clean(await page.locator('header').first().innerText().catch(() => ''));
const inDashboard = async () => await page.locator('header').filter({ hasText: /Trascorso/i }).count() > 0;
async function endSession() {
  await page.getByRole('button', { name: /^Termina$/ }).click();
  await page.getByRole('button', { name: /■ Termina/ }).click();
  await sleep(1500);
}

/**
 * Chiude ciò che un giro interrotto ha lasciato aperto: l'impasto in corso
 * (Termina) e la biga in preparazione (Annulla). Ripresi all'avvio, farebbero
 * fallire il giro dopo.
 */
async function cleanupApp() {
  for (let i = 0; i < 4; i++) {
    // la schermata del prefermento: l'unica fuori dalla dashboard con "Annulla"
    if (!(await inDashboard()) && await page.getByRole('button', { name: /^Annulla$/ }).count()) {
      await page.getByRole('button', { name: /^Annulla$/ }).click();
      await page.getByRole('button', { name: /Sì, annulla/ }).click();
      await sleep(1000);
      console.log('  · Annullata una preparazione rimasta aperta');
      // dietro può esserci ancora un impasto in corso: lo si ritrova riaprendo l'app
      await device.shell(`am force-stop ${PKG}`);
      page = await openApp();
      continue;
    }
    if (await inDashboard()) {
      const prefRow = page.locator('button[aria-label$=": apri"]');
      if (await prefRow.count()) { await prefRow.first().click(); await sleep(1000); continue; }
      console.log(`  · Chiusa una sessione rimasta aperta: ${(await headerText()).slice(0, 60)}`);
      await endSession();
      continue;
    }
    return;
  }
}

let page = await openApp();
await cleanupApp();
if (await inDashboard()) {
  console.error('C\'è una sessione che lo script non è riuscito a chiudere. Terminala dall\'app (Termina) e rilancia il test.');
  await shot(page, device, '00-sessione-esistente');
  process.exit(3);
}

/** Un'eccezione non deve lasciare sessioni aperte per il giro dopo. */
async function runScenario(name, fn) {
  try { await fn(); }
  catch (e) {
    check(`Scenario ${name} interrotto`, false, String(e?.message ?? e).split('\n')[0]);
    await shot(page, device, `errore-${name}`).catch(() => {});
    // si riparte da un'app appena aperta: lo stato a metà scenario è imprevedibile
    try { await device.shell(`am force-stop ${PKG}`); page = await openApp(); await cleanupApp(); }
    catch (e2) { console.error(`  Pulizia non riuscita: ${String(e2?.message ?? e2).split('\n')[0]}`); }
  }
}

async function scenarioNuovo() {
  console.log('\n1 · Nuova sessione e staglio');
  await runWizard(page);
  await shot(page, device, 'nuovo-01-dashboard');
  const before = await timelineTimes(page);
  check('Dashboard aperta con la timeline', !!before.staglio, before.text);
  const recapBake = (lastRecap.match(/COTTURA PREVISTA ~(\d{2}:\d{2})/i) || [])[1];
  const dashBake = ((await page.locator('header').first().innerText().catch(() => '')).match(/COTTURA\s*~?(\d{2}:\d{2})/i) || [])[1];
  check('Cottura del riepilogo = cottura in dashboard', !!recapBake && !!dashBake && Math.abs(toMin(recapBake) - toMin(dashBake)) <= 5,
    `riepilogo ${recapBake}, dashboard ${dashBake}`);

  await page.locator('[aria-label*="passa a STAGLIO"]').first().click();
  await page.getByRole('button', { name: 'Conferma', exact: true }).click();
  await sleep(1200);
  await shot(page, device, 'nuovo-02-dopo-staglio');
  const after = await timelineTimes(page);
  const gap = after.staglio && after.appretto ? toMin(after.appretto) - toMin(after.staglio) : NaN;
  check('APPRETTO = STAGLIO + 30 min', Math.abs(((gap % 1440) + 1440) % 1440 - 30) <= 1,
    `staglio ${after.staglio}, appretto ${after.appretto}`);

  console.log('\n2 · Annulla');
  await page.getByRole('button', { name: /↶ Annulla/ }).click();
  await sleep(1000);
  const undone = await timelineTimes(page);
  check('Annulla ripristina la timeline', !!before.staglio && !!before.appretto
    && undone.staglio === before.staglio && undone.appretto === before.appretto,
    `prima ${before.staglio}/${before.appretto}, dopo annulla ${undone.staglio}/${undone.appretto}`);
  check('STAGLIO di nuovo toccabile', await page.locator('[aria-label*="passa a STAGLIO"]').count() > 0);
  await page.locator('[aria-label*="passa a STAGLIO"]').first().click();
  await page.getByRole('button', { name: 'Conferma', exact: true }).click();
  await sleep(1500);

  const db1 = await readDb(page);
  const orphans = (db1 ?? []).filter(s => s.status === 'active' && !s.hasSnapshot).length;
  check('Nessuna sessione orfana nel DB (pulizia all\'avvio)', orphans === 0, orphans ? `${orphans} orfane` : '');
  const active1 = currentSession(db1);
  check('Timeline salvata in IndexedDB', !!active1 && active1.timeline.includes('balled_room:current'),
    active1 ? active1.timeline.join(' → ') : 'nessuna sessione attiva nel DB');

  console.log(`\n3 · App chiusa per ${WAIT_S}s e riaperta`);
  const matBefore = active1?.mat ?? null;
  await device.shell(`am force-stop ${PKG}`);
  await sleep(WAIT_S * 1000);
  page = await openApp();
  await shot(page, device, 'nuovo-03-dopo-riapertura');
  const header = clean(await page.locator('header').first().innerText().catch(() => ''));
  check('La sessione riprende sulla dashboard', /Trascorso/i.test(header), header.slice(0, 100));
  check('Fase corrente: STAGLIO', /STAGLIO/.test(header));
  const db2 = await readDb(page);
  const active2 = currentSession(db2);
  check('Maturazione non azzerata', active2?.mat != null && matBefore != null && active2.mat >= matBefore,
    `prima ${matBefore?.toFixed(2)}%, dopo ${active2?.mat?.toFixed(2)}%`);

  if (!KEEP) {
    console.log('\n4 · Termina e Storico');
    await page.getByRole('button', { name: /^Termina$/ }).click();
    const endTxt = clean(await page.locator('#pm-end-title').innerText().catch(() => ''));
    check('Termina senza infornare: avvisa che sarà "interrotta"', /interrotta/.test(endTxt), endTxt);
    await page.getByRole('button', { name: /■ Termina/ }).click();
    await sleep(1500);
    await page.getByRole('button', { name: /Storico/ }).first().click();
    await sleep(1500);
    await shot(page, device, 'nuovo-04-storico');
    const body = clean(await page.locator('body').innerText());
    check('Nessuna sessione "in corso" nello Storico', !/in corso/i.test(body));
    const first = clean(await page.locator('article').first().innerText().catch(() => ''));
    check('Nello Storico: "interrotta" e senza voto', /interrotta/i.test(first) && !/Com'è venuta/.test(first), first.slice(0, 80));
    const db3 = await readDb(page);
    check('Nessuna sessione attiva nel DB dopo Termina', !(db3 ?? []).some(s => s.status === 'active' && s.hasSnapshot));
    await device.shell(`am force-stop ${PKG}`);
    page = await openApp();
    const hdr = await page.locator('header').filter({ hasText: /Trascorso/i }).count();
    check('Riaprendo l\'app la sessione chiusa non riappare', hdr === 0);
  }
}

// ─── Scenario Pianifica ──────────────────────────────────────────────────────

/** "aaaa-mm-gg" di domani secondo l'orologio del telefono. */
async function tomorrowISO() {
  return page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}
/** "2h 22m" / "45 min" → ore decimali. */
function parseDur(t) {
  const m = t.match(/(\d+)h\s*(\d+)m/); if (m) return +m[1] + +m[2] / 60;
  const n = t.match(/(\d+)\s*min/); return n ? +n[1] / 60 : NaN;
}
async function openPlanner() {
  await page.getByRole('button', { name: /Pianifica/ }).first().click();
  await sleep(1200);
}
async function startFromWizard(tag) {
  await page.getByRole('button', { name: /Avvia sessione/ }).click();
  await sleep(2500);
  const alerts = (await page.locator('[role=alert]').allInnerTexts()).map(clean).filter(Boolean);
  check(`${tag}: la sessione parte senza errori`, alerts.length === 0 && await page.locator('header').filter({ hasText: /Trascorso/i }).count() > 0,
    alerts.join(' | '));
  check(`${tag}: nessun modale "fuori protocollo"`, await page.locator('#pm-oop-title').count() === 0);
}
const heroText = async () => clean(await page.locator('.pm4-stack').last().locator('.pm4-panel').first().innerText().catch(() => ''));
async function tapPhase(name) {
  const m = page.locator(`[aria-label*="passa a ${name}"]`).first();
  if (!(await m.count())) return false;
  await m.click();
  await page.getByRole('button', { name: 'Conferma', exact: true }).click();
  await sleep(1500);
  return true;
}

async function scenarioPianifica() {
  console.log('\nP1 · Planner, modalità Orario');
  await openPlanner();
  await page.getByRole('radio', { name: /Orario/ }).click().catch(() => {});
  const day = await tomorrowISO();
  await page.getByLabel('Giorno della cottura').fill(day);
  await page.getByLabel('Ora della cottura').fill('20:00');
  await sleep(1200);
  await shot(page, device, 'pian-01-planner');
  const summary = page.locator('section[aria-labelledby="pm-plan-title"]');
  const sumBox = await summary.boundingBox().catch(() => null);
  const sumText = clean(await summary.innerText().catch(() => ''));
  check('Piano consigliato visibile in alto', !!sumBox && sumBox.y < 900 && /Forno.*20:00/.test(sumText), sumText.slice(0, 140));

  const tcCard = page.locator('.pm4-panel').filter({ has: page.locator('text=TC Appretto') }).filter({ hasText: 'Puntata' }).first();
  const cardText = clean(await tcCard.innerText().catch(() => ''));
  const plannerWarmH = parseDur((cardText.match(/riscaldo ([^·]+?)(?: Maturazione|$)/) || [])[1] ?? '');
  const useTc = async () => {
    const btn = tcCard.getByRole('button', { name: 'Usa questo' });
    if (await btn.count()) await btn.click(); else await summary.getByRole('button', { name: /Usa questo piano/ }).click();
    await sleep(1500);
  };
  check('Card TC Appretto presente', !!cardText, cardText.slice(0, 120));
  await useTc();

  console.log('\nP2 · Wizard dal Planner');
  const wiz = clean(await page.locator('body').innerText());
  check('Wizard: valori marcati "dal Planner"', /dal Planner/.test(wiz));
  const wizWarm = parseFloat((wiz.match(/RISCALDO TA\s+([\d.]+)/i) || [])[1] ?? 'NaN');
  check('Wizard: riscaldo uguale al Planner', Number.isFinite(plannerWarmH) && Math.abs(wizWarm - plannerWarmH) < 0.1,
    `planner ${plannerWarmH.toFixed?.(2)}h, wizard ${wizWarm}h`);
  await shot(page, device, 'pian-02-wizard');
  await page.getByRole('button', { name: '← Planner' }).click();
  await sleep(1200);
  check('Tornando al Planner lo stato è conservato', await page.getByLabel('Giorno della cottura').inputValue() === day
    && await page.getByLabel('Ora della cottura').inputValue() === '20:00');
  await useTc();

  console.log('\nP3 · Dashboard del piano');
  await startFromWizard('Orario');
  await shot(page, device, 'pian-03-dashboard');
  const hdr = await headerText(); const hero = await heroText();
  const tl = (await timelineTimes(page)).text;
  check('Orario di cottura = orario del piano (20:00)', /COTTURA\s*~?20:00/i.test(hdr), hdr.slice(0, 120));
  check('Target "(dal piano)"', /target \d+% \(dal piano\)/.test(hero), hero.slice(-60));
  check('Con il frigo in programma comanda il piano', /frigo in programma/.test(hero), hero.slice(0, 120));
  check('Timeline con frigo e uscita frigo', /APPRETTO\s+TC/.test(tl) && /USCITA FRIGO/.test(tl), tl.slice(-160));

  console.log('\nP4 · Staglio e frigo dalla timeline');
  check('Staglio registrato', await tapPhase('STAGLIO'));
  check('Ingresso in frigo registrato', await tapPhase('APPRETTO'));
  await shot(page, device, 'pian-04-frigo');
  const hdrF = await headerText(); const heroF = await heroText();
  check('Fase corrente: APPRETTO · TC', /APPRETTO · TC/.test(hdrF), hdrF.slice(0, 120));
  check('In frigo: orario del piano, niente verde', /in frigo/.test(heroF) && !/PRONTO DA INFORNARE|Ho infornato/.test(heroF), heroF.slice(0, 120));
  await page.getByRole('button', { name: /↶ Annulla/ }).click();
  await sleep(1200);
  check('Annulla: si torna allo staglio', /STAGLIO/.test(await headerText()));
  await tapPhase('APPRETTO');
  // registrando le fasi in anticipo il piano si sposta: alla riapertura deve restare questo
  const bakeBefore = ((await headerText()).match(/COTTURA\s*(~?\d{2}:\d{2})/i) || [])[1] ?? null;

  console.log(`\nP5 · App chiusa per ${WAIT_S}s e riaperta (in frigo)`);
  await device.shell(`am force-stop ${PKG}`);
  await sleep(WAIT_S * 1000);
  page = await openApp();
  await shot(page, device, 'pian-05-riapertura');
  const hdrR = await headerText();
  check('Riprende in frigo (APPRETTO · TC)', /APPRETTO · TC/.test(hdrR), hdrR.slice(0, 120));
  const bakeAfter = (hdrR.match(/COTTURA\s*(~?\d{2}:\d{2})/i) || [])[1] ?? null;
  check('Riprende con lo stesso orario di cottura', !!bakeBefore && bakeBefore === bakeAfter, `prima ${bakeBefore}, dopo ${bakeAfter}`);
  check('Nessun avviso "impasto freddo a cottura" sul piano', !/inforni a ~\d+°/.test(hdrR), hdrR.slice(-80));

  console.log('\nP5b · Aggiusta rotta: cottura +2 h');
  await page.locator('footer').getByRole('button', { name: /Aggiusta rotta/ }).click(); await sleep(1000);
  const shiftSl = page.locator('#rotta-shift');
  check('Rotta: con il frigo si sposta la cottura', await shiftSl.count() > 0);
  const rottaTxt = clean(await page.locator('body').innerText());
  check('Rotta: durate leggibili, niente ore decimali', !/\d\.\d{3,}/.test(rottaTxt), (rottaTxt.match(/\S*\d\.\d{3,}\S*/) || [''])[0]);
  const applyBox = await page.getByRole('button', { name: /Applica modifiche|Nessuna modifica/ }).boundingBox().catch(() => null);
  const vh = page.viewportSize()?.height ?? await page.evaluate(() => innerHeight);
  check('Rotta: "Applica" visibile senza scorrere', !!applyBox && applyBox.y + applyBox.height <= vh + 1);
  if (await shiftSl.count()) {
    await shiftSl.focus();
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await sleep(150); }
    await page.getByRole('button', { name: /Applica modifiche/ }).click(); await sleep(1500);
    const shifted = (await headerText()).match(/COTTURA\s*~?(\d{2}:\d{2})/i)?.[1] ?? null;
    const exp = bakeAfter ? ((toMin(bakeAfter.replace('~', '')) + 120) % 1440) : NaN;
    check('Rotta: la dashboard mostra la nuova cottura (+2 h)', shifted != null && toMin(shifted) === exp, `prima ${bakeAfter}, dopo ${shifted}`);
    await device.shell(`am force-stop ${PKG}`);
    page = await openApp();
    const kept = (await headerText()).match(/COTTURA\s*~?(\d{2}:\d{2})/i)?.[1] ?? null;
    check('Rotta: la nuova cottura resta dopo la riapertura', kept != null && kept === shifted, `dopo la riapertura ${kept}`);
  }
  await endSession();

  console.log('\nP6 · Modalità Servizio');
  await openPlanner();
  await page.getByRole('radio', { name: /Servizio/ }).click();
  await page.getByLabel('Data del servizio').fill(day);
  await page.getByLabel('Ora di inizio del servizio').fill('19:00');
  await sleep(800);
  const slider = page.locator('#pm-plan-target-mat');
  let feasible = false; let target = null;
  // cerca un target fattibile partendo dal valore attuale, poi verso l'alto e verso il basso
  for (const key of ['ArrowRight', 'ArrowLeft']) {
    for (let i = 0; i < 16 && !feasible; i++) {
      if (await page.getByRole('button', { name: /Usa questo (schema|piano)/ }).count()) { feasible = true; target = await slider.inputValue(); break; }
      await slider.focus(); await page.keyboard.press(key); await sleep(350);
    }
    if (feasible) break;
  }
  await shot(page, device, 'pian-06-servizio');
  check('Servizio: esiste un target fattibile per domani alle 19:00', feasible, feasible ? `target ${target}%` : 'nessun target 64–100% fattibile');
  if (feasible) {
    await page.getByRole('button', { name: /Usa questo (schema|piano)/ }).first().click();
    await sleep(1500);
    await startFromWizard('Servizio');
    const heroS = await heroText(); const tlS = (await timelineTimes(page)).text;
    // la soglia è la maturazione prevista a INIZIO servizio (il target vale a fine finestra)
    check('Servizio: soglia del piano in dashboard', /target \d+% \(dal piano\)/.test(heroS), heroS.slice(-60));
    check('Servizio: pronto per l\'inizio del servizio (19:00)', /COTTURA\s*~?19:00/i.test(await headerText()), (await headerText()).slice(0, 110));
    check('Servizio: fase in corso PUNTATA (non riproposta)', !(await page.getByRole('region', { name: 'Fase da registrare' }).count()) && /PUNTATA/.test(await headerText()));
    check('Servizio: timeline con uscita frigo', /USCITA FRIGO/.test(tlS), tlS.slice(-140));
    await shot(page, device, 'pian-07-servizio-dashboard');
    await endSession();
  }

  console.log('\nP7 · Modalità Qualità');
  await openPlanner();
  await page.getByRole('radio', { name: /Qualità/ }).click();
  await sleep(1200);
  const useQ = page.getByRole('button', { name: /Usa questo (schema|piano)/ }).first();
  check('Qualità: profilo calcolato', await useQ.count() > 0);
  if (await useQ.count()) {
    await useQ.click(); await sleep(1500);
    // Il piano Qualità può avere un prefermento: qui lo si dà per pronto (la fase
    // "in corso" ha il suo scenario).
    const ready = page.getByRole('radio', { name: /Già pront/ }).first();
    if (await ready.count()) await ready.click();
    await startFromWizard('Qualità');
    await shot(page, device, 'pian-08-qualita-dashboard');
    await endSession();
  }
  // il planner torna in modalità Orario per il prossimo utilizzo
  await openPlanner();
  await page.getByRole('radio', { name: /Orario/ }).click().catch(() => {});
  await page.getByRole('button', { name: 'Torna alla schermata iniziale' }).click().catch(() => {});
}

// ─── Scenario Prefermento ────────────────────────────────────────────────────

/** Wizard fino al riepilogo con un prefermento: step 1, tipo, poi i default. */
async function wizardWithPref(kind, configure) {
  await page.getByRole('button', { name: /Nuovo impasto/ }).first().click();
  await sleep(800);
  await page.getByRole('radio', { name: /Napoletana/ }).click();
  await page.getByRole('button', { name: /Continua/ }).click(); await sleep(500);
  await page.getByRole('radio', { name: new RegExp(`Tipo di impasto: ${kind}`) }).click();
  await page.getByRole('button', { name: /Continua/ }).click(); await sleep(800);
  await configure();
  for (let i = 3; i < 8; i++) {
    const cont = page.getByRole('button', { name: /Continua/ }).first();
    await sleep(400);
    const groups = page.locator('[role=radiogroup]');
    for (let g = 0; g < await groups.count(); g++) {
      if (await cont.isEnabled()) break;
      const grp = groups.nth(g);
      if (await grp.locator('[aria-checked=true]').count()) continue;
      await grp.locator('[role=radio]').first().click();
    }
    await cont.click();
  }
  await sleep(1000);
}

async function scenarioPrefermento() {
  console.log('\nF1 · Biga da preparare');
  let step3 = '';
  await wizardWithPref('Biga', async () => {
    step3 = clean(await page.locator('body').innerText());
    await page.getByRole('radio', { name: /Dove matura: Fresco/ }).click();
    await page.getByRole('radio', { name: /Per quante ore: 16 h/ }).click();
  });
  check('Passo 3: quota di farina con i grammi', /Farina nella biga/i.test(step3) && /\d+ g/.test(step3), step3.slice(0, 120));
  const recap = clean(await page.locator('body').innerText());
  await shot(page, device, 'pref-01-riepilogo');
  check('Riepilogo: ricetta in grammi (biga + impasto finale)', /Impasto finale/i.test(recap) && /Biga \(tutta\)/.test(recap), recap.slice(0, 160));
  const startBtn = page.getByRole('button', { name: /Impasta la biga adesso/ });
  check('Riepilogo: si parte impastando la biga', await startBtn.count() > 0);
  if (!(await startBtn.count())) return;
  await startBtn.click(); await sleep(2000);
  await shot(page, device, 'pref-02-biga-in-corso');
  const stageText = clean(await page.locator('body').innerText());
  check('Fase "biga in corso" con orario e segni', /La biga sta maturando/.test(stageText) && /Come capire che è pronta/i.test(stageText), stageText.slice(0, 120));
  check('Cosa preparare per l\'impasto finale', /Per l'impasto finale prepara/i.test(stageText));
  check('Dosi della biga da impastare adesso', /Adesso: impasta la biga/i.test(stageText) && /Farina \d+ g/.test(stageText), stageText.slice(0, 200));
  const clock = async () => (clean(await page.locator('[role=timer]').innerText().catch(() => '')).match(/(\d{2}):(\d{2})/) || []).slice(1).map(Number);
  const [h1, m1] = await clock();
  await page.getByRole('radio', { name: /Dove si trova adesso: Frigo/ }).click(); await sleep(800);
  const [h2, m2] = await clock();
  const before = h1 * 60 + m1, after = h2 * 60 + m2;
  check('In frigo la biga sarà pronta più tardi', Number.isFinite(before) && Number.isFinite(after) && after !== before,
    `prima ${h1}:${String(m1).padStart(2, '0')}, dopo ${h2}:${String(m2).padStart(2, '0')}`);
  await page.getByRole('radio', { name: /Dove si trova adesso: Fresco/ }).click(); await sleep(500);
  await page.getByRole('button', { name: /Fatto ✓/ }).click(); await sleep(500);
  const dbS = await readDb(page);
  check('Preparazione salvata in IndexedDB', (dbS ?? []).some(s => s.status === 'planning' && s.stage));

  console.log(`\nF2 · App chiusa per ${WAIT_S}s e riaperta`);
  await device.shell(`am force-stop ${PKG}`);
  await sleep(WAIT_S * 1000);
  page = await openApp();
  await shot(page, device, 'pref-03-dopo-riapertura');
  check('Riprende sulla biga in corso', /La biga sta maturando/.test(clean(await page.locator('body').innerText())));

  console.log('\nF2b · Un impasto diretto mentre la biga matura');
  await page.getByRole('button', { name: /← Home/ }).click(); await sleep(800);
  await runWizard(page);
  const rowSel = () => page.getByRole('button', { name: /Biga in corso/ });
  check('In dashboard la biga resta raggiungibile', await rowSel().count() > 0);
  await device.shell(`am force-stop ${PKG}`);
  page = await openApp();
  check('Dopo la riapertura: impasto e biga entrambi presenti', /Trascorso/i.test(await headerText()) && await rowSel().count() > 0);
  await rowSel().first().click(); await sleep(1000);
  check('Dalla dashboard si apre la biga in corso', /La biga sta maturando/.test(clean(await page.locator('body').innerText())));
  await page.getByRole('button', { name: /← Impasto in corso/ }).click(); await sleep(1000);
  await endSession();
  await rowSel().first().click(); await sleep(1000);

  console.log('\nF3 · Impasto finale');
  await page.getByRole('button', { name: /impasto finale/i }).click(); await sleep(500);
  const wait = page.getByRole('button', { name: /^Aspetto$/ });
  const early = page.getByRole('button', { name: /Impasto lo stesso/ });
  check('Impasto in anticipo: chiede conferma, "Aspetto" in evidenza', await wait.count() > 0 && await early.count() > 0
    && /pm-btn-primary/.test(await wait.getAttribute('class') ?? ''));
  if (await early.count()) await early.click();
  await sleep(2500);
  await shot(page, device, 'pref-04-dashboard');
  check('Parte la sessione dell\'impasto', /Trascorso/i.test(await headerText()), (await headerText()).slice(0, 100));
  const dbF = await readDb(page);
  const act = currentSession(dbF) ?? (dbF ?? []).filter(s => s.status === 'active').sort((a, b) => b.id - a.id)[0];
  const bigaH = act?.prefs?.find(p => p.type === 'biga')?.durationH;
  check('La biga entra con la durata reale', bigaH != null && bigaH <= WAIT_S / 3600 + 1, `durata biga ${bigaH} h`);
  check('Nessuna preparazione rimasta nel DB', !(dbF ?? []).some(s => s.status === 'planning'));
  await endSession();

  console.log('\nF4 · Poolish già pronto');
  await wizardWithPref('Poolish', async () => {
    await page.getByRole('radio', { name: /Già pronto/ }).click();
    await page.getByRole('radio', { name: /Dove è stato: Frigo/ }).click();
  });
  check('Poolish pronto: si avvia subito', await page.getByRole('button', { name: /Avvia sessione/ }).count() > 0);
  await startFromWizard('Poolish pronto');
  const dbP = await readDb(page);
  const actP = (dbP ?? []).filter(s => s.status === 'active').sort((a, b) => b.id - a.id)[0];
  const pool = actP?.prefs?.find(p => p.type === 'poolish');
  check('Poolish dal frigo: 4°C nella ricetta', pool?.tempC != null && pool.tempC <= 6, `poolish ${pool?.durationH} h a ${pool?.tempC}°C`);
  await shot(page, device, 'pref-05-poolish-dashboard');
  await endSession();

  console.log('\nF5 · Biga e poolish insieme, e frigo in anticipo');
  await wizardWithPref('Avanzato', async () => {
    await page.getByRole('button', { name: /Aggiungi pre-fermento/ }).click(); await sleep(400);
    await page.getByRole('radio', { name: /Tipo pre-fermento 2: Poolish/ }).click(); await sleep(300);
  });
  const go = page.getByRole('button', { name: /Impasta la biga adesso/ });
  check('Avanzato: si parte dalla biga (la più lunga)', await go.count() > 0);
  if (!(await go.count())) return;
  await go.click(); await sleep(2000);
  const twoText = clean(await page.locator('body').innerText());
  await shot(page, device, 'pref-06-due-prefermenti');
  check('Il poolish ha il suo orario, più tardi', /Poi: il poolish alle/i.test(twoText), twoText.slice(0, 220));
  // retrodata la biga di 14 h 30: maturazione ~90%, compare il suggerimento del frigo
  await page.evaluate(() => new Promise(r => {
    const q = indexedDB.open('PizzaMatrixDB');
    q.onsuccess = () => {
      const tx = q.result.transaction('sessions', 'readwrite'); const st = tx.objectStore('sessions'); const g = st.getAll();
      g.onsuccess = () => {
        for (const s of g.result) if (s.status === 'planning' && s.prefermentStage) {
          const ps = s.prefermentStage, d = 14.5 * 3600e3;
          ps.startedAt = new Date(ps.startedAt.getTime() - d); ps.readyAt = new Date(ps.readyAt.getTime() - d);
          ps.mixedAck = true;
          ps.items = ps.items.map(it => ({ ...it, startAt: new Date(it.startAt.getTime() - d), mixedAt: it.mixedAt ? new Date(it.mixedAt.getTime() - d) : undefined }));
          st.put(s);
        }
      };
      tx.oncomplete = () => r();
    };
  }));
  await device.shell(`am force-stop ${PKG}`);
  page = await openApp();
  const hint = clean(await page.locator('body').innerText());
  await shot(page, device, 'pref-07-frigo-in-anticipo');
  check('Frigo suggerito prima che sia oltre', /mettila in frigo/i.test(hint) || /Mettila in frigo/.test(hint), hint.slice(0, 200));
  check('Poolish non impastato all\'ora: segnalato', /il poolish: da impastare/i.test(hint) && /Sei in ritardo di/.test(hint), (hint.match(/il poolish: da impastare.{0,160}/i) || [''])[0]);
  const skip = page.getByRole('button', { name: /Procedi senza il poolish/ });
  if (await skip.count()) {
    await skip.click(); await page.getByRole('button', { name: /Sì, procedi senza/ }).click(); await sleep(800);
  }
  const afterSkip = clean(await page.locator('body').innerText());
  check('Si può procedere senza il poolish', !/da impastare/i.test(afterSkip) && /impasto finale[^→]{0,12}→/i.test(afterSkip), afterSkip.slice(0, 160));
  await page.getByRole('button', { name: /^Annulla$/ }).click();
  await page.getByRole('button', { name: /Sì, annulla/ }).click(); await sleep(1000);
}

if (SCENARIO === 'nuovo' || SCENARIO === 'tutti') await runScenario('nuovo', scenarioNuovo);
if (SCENARIO === 'pianifica' || SCENARIO === 'tutti') {
  page = await openApp();
  await cleanupApp();
  await runScenario('pianifica', scenarioPianifica);
}
if (SCENARIO === 'prefermento' || SCENARIO === 'tutti') {
  page = await openApp();
  await cleanupApp();
  await runScenario('prefermento', scenarioPrefermento);
}

const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(OUT, 'risultati.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Screenshot e risultati in ${OUT}`);
await device.close();
process.exit(failed.length ? 1 : 0);
