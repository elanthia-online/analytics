// End-to-end check in a real browser: the site served as Pages would serve
// it, talking to the mock analytics.lic API (a different origin, so CORS and
// the page's Content-Security-Policy are both exercised), then the same
// page opening a database file.
//
//   npm run e2e [-- --shots dir]     (needs Playwright's Chromium)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startDevServer } from './dev-server.js';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const SITE_PORT = 8765;
const API_PORT = 8766;
// A copy of the fixture whose modification time is the fixture's own moment:
// a picked file is shown as of when it was last written
const golden = JSON.parse(readFileSync(new URL('../test/fixtures/afternoon.json', import.meta.url), 'utf8'));
const fixture = join(mkdtempSync(join(tmpdir(), 'analytics-e2e-')), 'analytics.db');
copyFileSync(new URL('../test/fixtures/afternoon.db', import.meta.url), fixture);
utimesSync(fixture, golden.now, golden.now);

const site = await startDevServer(SITE_PORT);
const mock = spawn(process.execPath, [new URL('./mock-server.js', import.meta.url).pathname, '--port', String(API_PORT), '--demo'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  mock.stdout.once('data', resolve);
  mock.once('exit', (code) => reject(new Error(`the mock server exited (${code}) before it started`)));
});

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const browser = await chromium.launch();
try {
  // ---- live, from the mock script --------------------------------------
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: shots ? 2 : 1, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await page.waitForSelector('.card[data-who]', { timeout: 15_000 });
  const cards = await page.$$eval('.card[data-who]', (els) => els.map((el) => el.getAttribute('data-who')));
  check(cards.length === 5, `live: five character cards (${cards.join(', ')})`);
  check(/^Live/.test(await page.textContent('#statusText')), 'live: header says Live');
  const shownText = await page.$$eval('.ch-name, .tl-name, .alert b, .nav-name, tbody td b', (els) => els.map((el) => el.textContent).join('|'));
  check(/\(GS4\)/.test(shownText) && !/GS3/.test(shownText) && cards.includes('GS3:Splinter'),
    'live: names show GemStone IV as GS4, while ids stay GS3 (as Lich and the database have it)');
  check(await page.isHidden('#source'), 'live: the source chooser is closed once connected');
  const alerts = await page.$$eval('.alert', (els) => els.length);
  check(alerts > 3, `live: alerts listed (${alerts})`);
  if (shots) await page.screenshot({ path: `${shots}/overview-live.png`, fullPage: true });

  const before = await page.textContent('.hero-fig');
  await page.waitForFunction((old) => document.querySelector('.hero-fig')?.textContent !== old, before, { timeout: 25_000 }).catch(() => {});
  check((await page.textContent('.hero-fig')) !== before, `live: the page picked up a new write by itself (${before} -> ${await page.textContent('.hero-fig')})`);

  await page.click('.card[data-who="GS3:Splinter"]');
  await page.waitForSelector('#tabs');
  const charts = await page.$$eval('.chart', (els) => els.length);
  check(charts === 5, `detail: five trend charts for Today (${charts})`);
  await page.click('#tabs button[data-r="weekly"]');
  await page.waitForFunction(() => document.querySelectorAll('.chart').length === 6);
  check(true, 'detail: the This Week tab adds the kills chart');
  check((await page.evaluate(() => location.hash)) === '#GS4%3ASplinter', 'detail: the URL hash names the character');
  if (shots) await page.screenshot({ path: `${shots}/detail-live.png`, fullPage: true });

  // ---- the sidebar, and saving an image -------------------------------
  await page.click('.nav-ch[data-who="GS3:Bebop"]');
  await page.waitForFunction(() => location.hash === '#GS4%3ABebop' && document.querySelector('.sb-name')?.textContent.startsWith('Bebop'));
  check(await page.getAttribute('.nav-ch[data-who="GS3:Bebop"]', 'aria-current') === 'page', 'sidebar: picking a character opens it and marks it current');
  const download = page.waitForEvent('download', { timeout: 20_000 });
  await page.click('#export');
  const saved = (await download).suggestedFilename();
  check(/^gs4-analytics-GS4_Bebop-(daily|weekly|monthly)-\d{8}-\d{4}\.png$/.test(saved), `export: the character view saves as a PNG (${saved})`);
  await page.click('#navOverview');
  await page.waitForSelector('#overview:not([hidden]) .card[data-who]');
  check(await page.getAttribute('#navOverview', 'aria-current') === 'page' && (await page.evaluate(() => location.hash)) === '',
    'sidebar: Overview goes back to everyone');
  const download2 = page.waitForEvent('download', { timeout: 20_000 });
  await page.click('#export');
  const saved2 = (await download2).suggestedFilename();
  check(/^gs4-analytics-everyone-.*\.png$/.test(saved2), `export: the overview saves as a PNG (${saved2})`);
  // A refresh that brings nothing new for this character must leave its view alone
  // (a rewrite resets hover, focus and selection)
  await page.click('.nav-ch[data-who="GSF:Splinter"]');
  await page.waitForFunction(() => document.querySelector('.sb-name')?.textContent.includes('GSF'));
  await page.waitForTimeout(1200);
  const rewrites = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const watch = new MutationObserver(() => { n++; });
    watch.observe(document.getElementById('detail'), { childList: true });
    setTimeout(() => { watch.disconnect(); resolve(n); }, 16_000);
  }));
  check(rewrites === 0, `live: refreshes with nothing new leave the page alone (${rewrites} rewrites in three refreshes)`);
  check(problems.length === 0, `live: no console errors or CSP violations${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  await context.close();

  // ---- a phone ---------------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  const sideways = async (what) => {
    const extra = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(extra <= 0, `phone: nothing scrolls sideways on the ${what}${extra > 0 ? ` (${extra}px too wide)` : ''}`);
  };
  await phonePage.goto(`http://localhost:${SITE_PORT}/`);
  await phonePage.waitForSelector('#source:not([hidden])');
  await sideways('first-visit page');
  await phonePage.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await phonePage.waitForSelector('.card[data-who]', { timeout: 15_000 });
  await sideways('overview');
  check(await phonePage.isHidden('.side') || (await phonePage.$eval('.side', (el) => el.getBoundingClientRect().right <= 0)), 'phone: the sidebar starts closed');
  await phonePage.click('#menuBtn');
  await phonePage.waitForFunction(() => document.querySelector('.app').classList.contains('open'));
  await phonePage.waitForTimeout(350);
  check(await phonePage.$eval('.side', (el) => el.getBoundingClientRect().left >= 0), 'phone: the menu button opens the drawer');
  await phonePage.keyboard.press('Escape');
  check(!(await phonePage.$eval('.app', (el) => el.classList.contains('open'))) && await phonePage.isHidden('#scrim'), 'phone: Escape closes it');
  await phonePage.click('#menuBtn');
  await phonePage.click('.nav-ch[data-who="GS3:Splinter"]');
  await phonePage.waitForSelector('#tabs');
  check(!(await phonePage.$eval('.app', (el) => el.classList.contains('open'))), 'phone: picking a character closes the drawer');
  await phonePage.waitForTimeout(300);
  await sideways('character view');
  await phone.close();

  // ---- the sample data -------------------------------------------------
  const demoContext = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const demo = await demoContext.newPage();
  const demoProblems = [];
  demo.on('pageerror', (e) => demoProblems.push(e.message));
  demo.on('console', (m) => { if (m.type() === 'error') demoProblems.push(m.text()); });
  await demo.goto(`http://localhost:${SITE_PORT}/`);
  await demo.waitForSelector('#source:not([hidden]) #demoBtn');
  check(await demo.isHidden('.side'), 'first visit: no sidebar until there is data');
  await demo.click('#demoBtn');
  await demo.waitForSelector('.card[data-who]', { timeout: 15_000 });
  check((await demo.$$('.card[data-who]')).length === 5, 'demo: the sample opens with its five characters');
  check(await demo.isVisible('#banner') && /sample data/i.test(await demo.textContent('#banner')), 'demo: a banner says it is sample data');
  check(/^Sample data/.test(await demo.textContent('#statusText')), `demo: the status says so too (${await demo.textContent('#statusText')})`);
  const hour = await demo.evaluate(() => new Date().toDateString() === new Date(Number(document.querySelector('[data-since]')?.dataset.since) * 1000).toDateString());
  check(hour, 'demo: the sample is moved to today');
  await demo.click('#bannerConnect');
  check(await demo.isVisible('#source') && await demo.isVisible('#sourceClose') && await demo.isHidden('#overview'), 'demo: Connect your own opens the source chooser');
  await demo.click('#sourceClose');
  check(await demo.isVisible('#overview .card[data-who]'), 'demo: and Back returns to the dashboard');
  await demo.reload();
  await demo.waitForSelector('#source:not([hidden])');
  check(await demo.isHidden('#banner'), 'demo: never remembered as the reader\'s own source');
  // A shared ?demo link, then the reader's own data: their source wins on the next visit
  await demo.goto(`http://localhost:${SITE_PORT}/?demo`);
  await demo.waitForSelector('#banner:not([hidden])', { timeout: 15_000 });
  await demo.click('#bannerConnect');
  await demo.fill('#port', String(API_PORT));
  await demo.click('#liveForm button[type="submit"]');
  await demo.waitForFunction(() => /^Live/.test(document.querySelector('#statusText').textContent), null, { timeout: 15_000 });
  await demo.reload();
  await demo.waitForFunction(() => /^Live/.test(document.querySelector('#statusText').textContent), null, { timeout: 15_000 });
  check(await demo.isHidden('#banner') && !/demo/.test(await demo.evaluate(() => location.search)),
    'demo: after ?demo, connecting your own data drops ?demo, so a reload opens your data');
  check(demoProblems.length === 0, `demo: no console errors${demoProblems.length ? `: ${demoProblems.join(' | ')}` : ''}`);
  await demoContext.close();

  // ---- a file, picked from disk ----------------------------------------
  const fileContext = await browser.newContext({ viewport: { width: 1320, height: 900 }, timezoneId: golden.tz });
  const filePage = await fileContext.newPage();
  const fileProblems = [];
  filePage.on('pageerror', (e) => fileProblems.push(e.message));
  filePage.on('console', (m) => { if (m.type() === 'error') fileProblems.push(m.text()); });
  await filePage.goto(`http://localhost:${SITE_PORT}/`);
  await filePage.waitForSelector('#source:not([hidden])');
  check(true, 'file: with nothing remembered, the source chooser opens');
  await filePage.setInputFiles('#pickFile', fixture);
  await filePage.waitForSelector('.card[data-who]', { timeout: 15_000 });
  check(/^Snapshot/.test(await filePage.textContent('#statusText')), `file: header says Snapshot (${await filePage.textContent('#statusText')})`);
  check((await filePage.$$('.card[data-who]')).length === 5, 'file: five character cards');
  const shown = await filePage.$$eval('.card[data-who] .reasons li span:last-child', (els) => els.map((el) => el.textContent));
  const want = golden.overview.characters.flatMap((c) => (c.light.reasons.length ? c.light.reasons.map((r) => r.text) : ['Not running']));
  check(JSON.stringify(shown) === JSON.stringify(want), 'file: the cards show the same alert texts as the Ruby dashboard did at that moment');
  check(fileProblems.length === 0, `file: no console errors${fileProblems.length ? `: ${fileProblems.join(' | ')}` : ''}`);
  if (shots) await filePage.screenshot({ path: `${shots}/overview-file.png`, fullPage: true });

  // ---- a source that isn't there ---------------------------------------
  const deadPage = await fileContext.newPage();
  await deadPage.goto(`http://localhost:${SITE_PORT}/?live=1`);
  await deadPage.waitForSelector('#sourceError:not([hidden])', { timeout: 15_000 });
  const deadText = await deadPage.textContent('#sourceError');
  check(/Could not reach analytics\.lic/.test(deadText), 'unreachable: the chooser explains the script is not answering');
  check(/Local network access/.test(deadText), 'unreachable: and mentions the browser permission, which looks the same to the page');
  check(await deadPage.$('#source a[href="guide/"]') !== null, 'unreachable: the chooser links to the guide');
  await fileContext.close();

  // ---- the guide -------------------------------------------------------
  const guideContext = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const guide = await guideContext.newPage();
  const guideProblems = [];
  guide.on('pageerror', (e) => guideProblems.push(e.message));
  guide.on('console', (m) => { if (m.type() === 'error') guideProblems.push(m.text()); });
  const guideResponse = await guide.goto(`http://localhost:${SITE_PORT}/guide/`);
  check(guideResponse.ok(), `guide: served (${guideResponse.status()})`);
  const sections = await guide.$$eval('main section[id]', (els) => els.map((el) => el.id));
  const tocTargets = await guide.$$eval('.toc a', (els) => els.map((a) => a.getAttribute('href').slice(1)));
  check(sections.length >= 10 && JSON.stringify(sections) === JSON.stringify(tocTargets), `guide: every section is in the contents (${sections.length})`);
  const anchors = await guide.$$eval('a[href^="#"]', (els) => els.map((a) => a.getAttribute('href').slice(1)));
  const missing = [];
  for (const id of anchors) if (!(await guide.$(`[id="${id}"]`))) missing.push(id);
  check(missing.length === 0, `guide: every in-page link has a target${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  for (const id of ['connect', 'lan', 'settings']) check((await guide.$(`[id="${id}"]`)) !== null, `guide: #${id} exists, the script and the page link to it`);
  const icons = await guide.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (els) => els.map((el) => el.href));
  const served = await Promise.all(icons.concat([`http://localhost:${SITE_PORT}/favicon.ico`]).map((href) => guide.request.get(href).then((r) => r.ok())));
  check(icons.length === 3 && served.every(Boolean), `favicon: the SVG, PNG and touch icons are linked and served, and /favicon.ico (${served.filter(Boolean).length}/${served.length})`);
  check(guideProblems.length === 0, `guide: no console errors or CSP violations${guideProblems.length ? `: ${guideProblems.join(' | ')}` : ''}`);
  if (shots) await guide.screenshot({ path: `${shots}/guide.png`, fullPage: true });
  await guideContext.close();
} finally {
  await browser.close();
  mock.kill();
  site.close();
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall end-to-end checks passed');
