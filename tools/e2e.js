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
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await page.waitForSelector('.card[data-who]', { timeout: 15_000 });
  const cards = await page.$$eval('.card[data-who]', (els) => els.map((el) => el.getAttribute('data-who')));
  check(cards.length === 5, `live: five character cards (${cards.join(', ')})`);
  check(/^Live/.test(await page.textContent('#statusText')), 'live: header says Live');
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
  check((await page.evaluate(() => location.hash)) === '#GS3%3ASplinter', 'detail: the URL hash names the character');
  if (shots) await page.screenshot({ path: `${shots}/detail-live.png`, fullPage: true });
  check(problems.length === 0, `live: no console errors or CSP violations${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  await context.close();

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
