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
import { fileURLToPath } from 'node:url';

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
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-server.js', import.meta.url)), '--port', String(API_PORT), '--demo'], { stdio: ['ignore', 'pipe', 'inherit'] });
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
  check(cards.length === 7, `live: the sample's seven characters active today (${cards.join(', ')})`);
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
  // Focus stays where it was through a refresh that changes the figures (#15): the
  // mock writes a deposit every 10 seconds, which rewrites the overview and the menu
  await page.click('#navOverview');
  await page.waitForSelector('#overview:not([hidden]) .card[data-who]');
  for (const [what, sel] of [['a card', '.card[data-who="GS3:Bebop"] .ch-link'], ['a menu link', '.nav-ch[data-who="GS3:April"]']]) {
    await page.focus(sel);
    await page.waitForTimeout(11_000);
    const kept = await page.evaluate((s) => document.activeElement === document.querySelector(s), sel);
    check(kept, `live: focus on ${what} survives a refresh that rewrote it`);
  }
  // A refresh that brings nothing new must leave the view alone (a rewrite resets
  // hover, focus and selection). The boxes a view is written into are watched (#29).
  const rewritesOf = (p, boxes, ms) => p.evaluate(([ids, wait]) => new Promise((resolve) => {
    let n = 0;
    const hour = new Date().getHours();
    const watch = new MutationObserver((list) => { n += list.length; });
    for (const id of ids) { const el = document.querySelector(id); if (el) watch.observe(el, { childList: true }); }
    setTimeout(() => { watch.disconnect(); resolve({ rewrites: n, newHour: new Date().getHours() !== hour }); }, wait);
  }), [boxes, ms]);
  await page.click('.nav-ch[data-who="GSF:Splinter"]');
  await page.waitForFunction(() => document.querySelector('.sb-name')?.textContent.includes('GSF'));
  await page.waitForTimeout(1200);
  const quiet = await rewritesOf(page, ['#detailBar', '#detailTabs ul', '#detailBody'], 16_000);
  // A new hour legitimately redraws the hourly trend labels. Within it, what's shown to
  // the minute (a stretch still going, "idle for N min", each on its own minute) may
  // redraw once each; the per-hour figures are taken to the minute too
  check(quiet.rewrites <= 2 || quiet.newHour, `live: refreshes with nothing new leave a character's page alone, but for the minute turning (${quiet.rewrites} rewrites in three refreshes)`);
  // The overview and the menu, on a source with no new writes at all; a stretch still
  // going is drawn to the minute, so a minute turning over may redraw once
  const still = spawn(process.execPath, [fileURLToPath(new URL('./mock-server.js', import.meta.url)), '--port', String(API_PORT + 2), '--demo', '--still'],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => still.stdout.once('data', resolve));
  try {
    const sp = await context.newPage();
    await sp.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT + 2}`);
    await sp.waitForSelector('.card[data-who]', { timeout: 15_000 });
    await sp.waitForTimeout(1500);
    const ovq = await rewritesOf(sp, ['#overview', '#navChars'], 16_000);
    check(ovq.rewrites <= 2, `live: refreshes with nothing new leave the overview and menu alone (${ovq.rewrites} rewrites in three refreshes)`);
    await sp.close();
  } finally {
    still.kill();
  }
  check(problems.length === 0, `live: no console errors or CSP violations${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  await context.close();

  // ---- keyboard, and the theme and contrast controls -------------------
  const kb = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const kbPage = await kb.newPage();
  await kbPage.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await kbPage.waitForSelector('.card[data-who]', { timeout: 15_000 });
  await kbPage.keyboard.press('Tab');
  check(await kbPage.evaluate(() => document.activeElement?.classList.contains('skip')), 'keyboard: the first Tab reaches "Skip to content"');
  await kbPage.focus('.card[data-who="GS3:Bebop"] .ch-link');
  await kbPage.keyboard.press('Enter');
  await kbPage.waitForFunction(() => location.hash === '#GS4%3ABebop');
  check(await kbPage.evaluate(() => document.activeElement?.matches('#detail h1')), 'keyboard: Enter on a card opens it, and focus moves to its heading');
  check(/^Bebop \(GS4\)/.test(await kbPage.title()), `keyboard: the window title names the character (${await kbPage.title()})`);
  await kbPage.click('#navOverview');
  const popup = kb.waitForEvent('page');
  await kbPage.click('.card[data-who="GS3:Splinter"] .ch-link', { modifiers: ['ControlOrMeta'] });
  const tab = await popup;
  await tab.waitForSelector('#tabs', { timeout: 15_000 });
  check(tab.url().endsWith('#GS4%3ASplinter') && !kbPage.url().includes('Splinter'), 'keyboard: Ctrl+click opens a character in a new tab and leaves this one');
  await tab.close();
  await kbPage.click('.side .contrast-btn');
  check(await kbPage.evaluate(() => document.documentElement.hasAttribute('data-hc')) && await kbPage.getAttribute('.side .contrast-btn', 'aria-pressed') === 'true',
    'contrast: the High contrast button turns it on');
  await kbPage.check('.side .theme-seg input[value="dark"]');
  await kbPage.reload();
  await kbPage.waitForSelector('.card[data-who]', { timeout: 15_000 });
  check(await kbPage.evaluate(() => document.documentElement.hasAttribute('data-hc') && document.documentElement.getAttribute('data-theme') === 'dark'),
    'contrast: high contrast and the dark theme are both remembered');
  check(await kbPage.isChecked('.side .theme-seg input[value="dark"]'), 'theme: the theme switch shows the remembered choice');
  await kbPage.click('.side .contrast-btn');
  await kbPage.check('.side .theme-seg input[value="auto"]');
  check(await kbPage.evaluate(() => !document.documentElement.hasAttribute('data-hc') && !document.documentElement.hasAttribute('data-theme')
    && localStorage.getItem('gs4a-contrast') === null && localStorage.getItem('gs4a-theme') === null), 'contrast and theme: back to following the system, nothing stored');
  await kb.close();
  const sysMore = await browser.newContext({ viewport: { width: 1320, height: 900 }, contrast: 'more' });
  const sysPage = await sysMore.newPage();
  await sysPage.goto(`http://localhost:${SITE_PORT}/`);
  await sysPage.waitForSelector('#source:not([hidden])');
  check(await sysPage.evaluate(() => document.documentElement.hasAttribute('data-hc')), 'contrast: on by itself when the system asks for more contrast');
  check(await sysPage.isVisible('.mbar .contrast-btn'), 'contrast: the first-visit page has the control too');
  await sysPage.click('.mbar .contrast-btn');
  await sysPage.reload();
  await sysPage.waitForSelector('#source:not([hidden])');
  check(await sysPage.evaluate(() => !document.documentElement.hasAttribute('data-hc') && localStorage.getItem('gs4a-contrast') === 'off'),
    'contrast: and turning it off there is remembered');
  await sysPage.goto(`http://localhost:${SITE_PORT}/guide/`);
  check(await sysPage.evaluate(() => !document.documentElement.hasAttribute('data-hc')) && await sysPage.getAttribute('.contrast-btn', 'aria-pressed') === 'false',
    'contrast: the guide follows the same choice');
  await sysMore.close();

  // ---- a character's pages, and hiding characters ------------------------
  const pages = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const pg = await pages.newPage();
  const pgProblems = [];
  pg.on('pageerror', (e) => pgProblems.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') pgProblems.push(m.text()); });
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#GS4%3ASplinter`);
  await pg.waitForSelector('.sub-nav');
  // Switching pages redraws the page only: the bar and tabs stay the same elements, and
  // the whole view doesn't replay its entrance (it did: the main column flashed)
  await pg.waitForFunction(() => !document.getElementById('detail').classList.contains('enter')); // the first entrance is over
  await pg.evaluate(() => { window.__bar = document.querySelector('#detail .subbar'); window.__tabs = document.querySelector('#detail .sub-nav'); });
  for (const [sec, ready] of [['income', '.brows'], ['hunting', '.brows'], ['bounties', '.kpi-grid'], ['progress', '.prog'], ['history', '#histBody tr']]) {
    await pg.click(`.sub-nav a[data-sec="${sec}"]`);
    const steady = await pg.evaluate(() => document.querySelector('#detail .subbar') === window.__bar &&
      document.querySelector('#detail .sub-nav') === window.__tabs && !document.getElementById('detail').classList.contains('enter'));
    check(steady, `pages: opening ${sec} keeps the bar and tabs in place and doesn't replay the page's entrance`);
    await pg.waitForSelector(`#detail ${ready}`, { timeout: 10_000 });
    const ok = (await pg.evaluate(() => location.hash)) === `#GS4%3ASplinter/${sec}` &&
      (await pg.getAttribute(`.sub-nav a[data-sec="${sec}"]`, 'aria-current')) === 'page' &&
      (await pg.evaluate(() => document.activeElement?.matches('#detail h1')));
    check(ok, `pages: ${sec} opens with its own address, marked current, focus on its heading`);
  }
  await pg.click('.sub-nav a[data-sec="income"]');
  await pg.waitForSelector('#detail .brows');
  const today = await pg.textContent('#detail .kpi .stat-sub');
  await pg.click('#tabs button[data-r="monthly"]');
  await pg.waitForFunction(() => document.querySelector('#detail .kpi .stat-sub')?.textContent === 'This Month');
  check(true, `pages: the range tabs apply to them (${today} -> This Month)`);
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#GS4%3ASplinter/history`);
  await pg.waitForSelector('#histBody tr');
  const allRows = await pg.$$eval('#histBody tr', (r) => r.length);
  await pg.fill('#histQ', 'encumbered');
  const some = await pg.$$eval('#histBody tr', (r) => r.length);
  await pg.waitForTimeout(6000); // a live refresh in between
  check(some < allRows && (await pg.evaluate(() => document.activeElement?.id)) === 'histQ' && (await pg.inputValue('#histQ')) === 'encumbered',
    `history: the filter narrows the rows (${allRows} -> ${some}) and keeps focus and text through a live refresh`);
  // Longer ranges on the pages, the summary keeping its own
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#GS4%3ASplinter/income`);
  await pg.waitForSelector('#detail .brows');
  await pg.click('#tabs button[data-r="total"]');
  await pg.waitForFunction(() => document.querySelector('#detail .kpi .stat-sub')?.textContent === 'All Time');
  check(!!(await pg.$('#detail .card-head h2:text("Bank checks")')), 'ranges: All Time on Income, with its bank checks');
  await pg.click('.sub-nav a[data-sec="summary"]');
  await pg.waitForSelector('#detail .profile:not(.slim)');
  check(await pg.getAttribute('#tabs button.on', 'data-r') === 'monthly', 'ranges: the summary shows the month for All Time (its own ranges stop there)');
  // Sorting: the heading's button sorts, says so, and keeps focus through the redraw
  await pg.click('.sub-nav a[data-sec="hunting"]');
  await pg.waitForSelector('#detail table.sortable');
  const silverCol = await pg.$eval('#detail [data-sort="creatures"]:text("Silver / kill")', (b) => b.getAttribute('data-col'));
  await pg.click(`#detail [data-sort="creatures"][data-col="${silverCol}"]`);
  const sorted = await pg.evaluate((col) => {
    const th = document.querySelector(`#detail [data-sort="creatures"][data-col="${col}"]`).closest('th');
    const idx = [...th.parentNode.children].indexOf(th);
    const vals = [...th.closest('table').querySelectorAll('tbody tr')].map((tr) => Number(tr.children[idx].textContent.replace(/,/g, '')) || 0);
    return { aria: th.getAttribute('aria-sort'), desc: vals.every((v, i) => i === 0 || vals[i - 1] >= v), focus: document.activeElement?.id };
  }, silverCol);
  check(sorted.aria === 'descending' && sorted.desc && sorted.focus === `sort-creatures-${silverCol}`, `sort: a heading sorts its column highest first, marked and focused (${JSON.stringify(sorted)})`);
  await pg.click(`#detail [data-sort="creatures"][data-col="${silverCol}"]`);
  check(await pg.$eval(`#detail [data-sort="creatures"][data-col="${silverCol}"]`, (b) => b.closest('th').getAttribute('aria-sort')) === 'ascending', 'sort: again flips it');
  // A target on the Progress page
  await pg.click('.sub-nav a[data-sec="progress"]');
  await pg.waitForSelector('#targetForm');
  await pg.fill('#targetValue', '90');
  await pg.click('#targetForm button[type="submit"]');
  await pg.waitForSelector('[data-target-clear]');
  await pg.reload();
  await pg.waitForSelector('#detail .prog');
  check(/Level 90/.test(await pg.textContent('#detail')) && !!(await pg.$('[data-target-clear]')), 'target: set, and kept after a reload');
  await pg.click('[data-target-clear]');
  await pg.waitForFunction(() => !document.querySelector('[data-target-clear]'));
  check(await pg.evaluate(() => localStorage.getItem('gs4a-targets')) === null, 'target: cleared');
  // Compare
  await pg.click('#navCompare');
  await pg.waitForSelector('#compare .section-body table');
  check((await pg.evaluate(() => location.hash)) === '#compare' && (await pg.getAttribute('#navCompare', 'aria-current')) === 'page' &&
    (await pg.evaluate(() => document.activeElement?.matches('#compare h1'))), 'compare: opens from the menu, current, focus on its heading');
  const tables = await pg.$$eval('#compare table', (t) => t.length);
  await pg.click('#cmpTabs button[data-r="total"]');
  await pg.waitForFunction(() => document.querySelector('#cmpTabs button.on')?.getAttribute('data-r') === 'total');
  check(tables >= 4, `compare: income, stops, creatures and bounties side by side (${tables} tables)`);
  await pg.click('#compare a[data-who="GS3:April"][data-sec="hunting"]');
  await pg.waitForFunction(() => location.hash === '#GS4%3AApril/hunting');
  check(true, 'compare: a character links to its own page');
  await pg.goBack();
  await pg.waitForSelector('#compare:not([hidden]) table');
  check(true, 'compare: Back returns to it');
  await pg.click('#compare a[data-who="GS3:Raphael"]');
  await pg.waitForSelector('#detail h1');
  check(!/No data for/.test(await pg.textContent('#detail')) && /Raphael/.test(await pg.textContent('#detail h1')),
    'compare: a character not played today still opens its page');
  await pg.goBack();
  await pg.waitForSelector('#compare:not([hidden]) table');
  await pg.evaluate(() => localStorage.setItem('gs4a-hidden', JSON.stringify(['GS3:Raphael'])));
  await pg.reload();
  await pg.waitForSelector('#compare .cmp-hidden [data-unhide="GS3:Raphael"]');
  await pg.click('#cmpTabs button[data-r="total"]');     // Raphael has nothing today, only in All Time
  await pg.waitForFunction(() => document.querySelector('#cmpTabs button.on')?.getAttribute('data-r') === 'total');
  check(!(await pg.$('#compare a[data-who="GS3:Raphael"]')), 'compare: lists a hidden character not played today, and leaves it out');
  await pg.click('#compare [data-unhide="GS3:Raphael"]');
  await pg.waitForFunction(() => !!document.querySelector('#compare a[data-who="GS3:Raphael"]'));
  check(!(await pg.$('#compare .cmp-hidden')) && (await pg.evaluate(() => localStorage.getItem('gs4a-hidden'))) === null,
    'compare: Show brings it back at once, with no range tab clicked');
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await pg.waitForSelector('.card[data-who]');
  await pg.click('.card[data-who="GS3:Bebop"] [data-hide]');
  await pg.waitForFunction(() => !document.querySelector('.card[data-who="GS3:Bebop"]'));
  check((await pg.$$('.nav-hidden .nav-ch[data-who="GS3:Bebop"]')).length === 1, 'hide: the card leaves the overview and the menu keeps it under Hidden');
  await pg.reload();
  await pg.waitForSelector('.card[data-who]');
  check(!(await pg.$('.card[data-who="GS3:Bebop"]')), 'hide: remembered after a reload');
  await pg.click('[data-unhide-all]');
  await pg.waitForSelector('.card[data-who="GS3:Bebop"]');
  check(await pg.evaluate(() => localStorage.getItem('gs4a-hidden')) === null, 'hide: Show them brings everyone back');
  // The side-by-side table: per-hour figures beside the totals, no crashes or item rests
  const allHeads = await pg.$$eval('#overview table thead th', (ths) => ths.map((th) => th.textContent.trim()));
  const sideHeads = allHeads.slice(allHeads.indexOf('Character'));
  check(sideHeads.join(',').startsWith('Character,Silver,Silver / hr,Exp,Exp / hr') && !sideHeads.includes('Crashes') && !sideHeads.includes('Items'),
    `side by side: silver and exp per hour beside the totals (${sideHeads.join(', ')})`);
  // Alerts: dismissed for today, remembered, and shown again
  const alertCount = () => pg.$$eval('#alertsCard .alert', (a) => a.length);
  const alertsBefore = await alertCount();
  const firstKey = await pg.getAttribute('#alertsCard [data-dismiss]', 'data-dismiss');
  await pg.click('#alertsCard [data-dismiss]');
  await pg.waitForFunction((n) => document.querySelectorAll('#alertsCard .alert').length === n - 1, alertsBefore);
  check((await pg.evaluate(() => document.activeElement?.matches('#alertsCard [data-dismiss], #alertsCard [data-undismiss]'))) &&
    !!(await pg.$('#alertsCard [data-undismiss]')), `alerts: one dismissed for today (${alertsBefore} -> ${alertsBefore - 1}), focus stays in the list, with a way back`);
  await pg.reload();
  await pg.waitForSelector('#alertsCard [data-undismiss]');
  check(await alertCount() === alertsBefore - 1 && !(await pg.$(`#alertsCard [data-dismiss="${firstKey}"]`)), 'alerts: the dismissal is remembered after a reload');
  await pg.click('#alertsCard [data-undismiss]');
  await pg.waitForFunction((n) => document.querySelectorAll('#alertsCard .alert').length === n, alertsBefore);
  check(await pg.evaluate(() => localStorage.getItem('gs4a-dismissed')) === null, 'alerts: Show them again brings it back');
  // Alert settings: a page of its own (#alerts), reached from the Alerts card, a character's page and the menu
  const onAlertsPage = () => pg.waitForFunction(() => ['#alerts', '#settings'].includes(location.hash) && !document.querySelector('#settingsPage').hidden &&
    document.querySelector('#navSettings').getAttribute('aria-current') === 'page');
  await pg.click('#alertsCard a.al-settings');
  await onAlertsPage();
  check(await pg.evaluate(() => location.hash === '#alerts' && document.activeElement?.matches('#set-alerts h2') && document.querySelector('#overview').hidden),
    'alerts: the Alerts card opens Settings at its Alerts section, current in the menu, focus on that heading');
  // Turning a kind off is saved and hides those alerts on the overview
  const kind = firstKey.slice(firstKey.lastIndexOf('|') + 1);
  await pg.uncheck(`#settingsPage [data-alert-on="${kind}"]`);
  await pg.waitForFunction((k) => JSON.parse(localStorage.getItem('gs4a-alerts') || '{}')[k] === false, kind);
  await pg.goBack();
  await pg.waitForSelector('#overview:not([hidden]) #alertsCard');
  check(!(await pg.$(`#alertsCard [data-dismiss$="|${kind}"]`)), `alerts: turning off "${kind}" there hides those alerts, and Back returns to the overview`);
  // From a character's page, and the menu
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#GS4%3ABebop`);
  await pg.waitForSelector('#detail .health a.al-settings');
  await pg.click('#detail .health a.al-settings');
  await onAlertsPage();
  await pg.click('#navOverview');
  await pg.waitForSelector('#overview:not([hidden]) #alertsCard');
  await pg.click('#navSettings');
  await onAlertsPage();
  check(await pg.evaluate(() => location.hash === '#settings' && document.activeElement?.matches('#settingsPage h1')), "alerts: a character's page and the menu's Settings open it too");
  // Display: the cards' silver and experience per hour, and the menu's figure
  await pg.check('#settingsPage input[data-display="card"][value="hour"]');
  await pg.check('#settingsPage input[data-display="nav"][value="exp_hr"]');
  await pg.waitForFunction(() => JSON.parse(localStorage.getItem('gs4a-display') || '{}').nav === 'exp_hr' && /exp\/hr/.test(document.querySelector('#navChars .nav-sub')?.textContent || ''));
  await pg.click('#navOverview');
  await pg.waitForSelector('#overview:not([hidden]) .ch-card');
  const cardLabels = await pg.$eval('.ch-card .kpis', (k) => k.textContent);
  check(/Silver \/ hr/.test(cardLabels) && /Exp \/ hr/.test(cardLabels), 'settings: the cards show silver and experience per hour, and the menu experience per hour, when chosen');
  await pg.reload();
  await pg.waitForSelector('#overview:not([hidden]) .ch-card');
  check(/Silver \/ hr/.test(await pg.$eval('.ch-card .kpis', (k) => k.textContent)), 'settings: the display choice is remembered after a reload');
  await pg.click('#navSettings');
  await onAlertsPage();
  await pg.check('#settingsPage input[data-display="card"][value="total"]');
  await pg.check('#settingsPage input[data-display="nav"][value="silver"]');
  await pg.waitForFunction(() => localStorage.getItem('gs4a-display') === null);
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#settings`);
  await onAlertsPage();
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}#alerts`);
  await onAlertsPage();
  check(true, 'settings: its addresses (#settings, and #alerts for its Alerts section) open it directly, like a bookmark');
  // What's dismissed today is listed there, and can be shown again one by one
  await pg.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}`);
  await pg.waitForSelector('#alertsCard [data-dismiss]');
  const another = await pg.getAttribute('#alertsCard [data-dismiss]', 'data-dismiss');
  await pg.click('#alertsCard [data-dismiss]');
  await pg.waitForSelector('#alertsCard [data-undismiss]');
  await pg.click('#alertsCard a.al-settings');
  await onAlertsPage();
  check((await pg.$$eval('#settingsPage [data-undismiss-one]', (b) => b.map((x) => x.getAttribute('data-undismiss-one')))).join() === another,
    'alerts: the page lists what was dismissed today');
  await pg.click('#settingsPage [data-undismiss-one]');
  await pg.waitForFunction(() => !document.querySelector('#settingsPage [data-undismiss-one]') && localStorage.getItem('gs4a-dismissed') === null);
  check(true, 'alerts: Show again brings one back');
  // A threshold is greyed out while its alert is off, and says its default once changed
  await pg.uncheck('#settingsPage [data-alert-on="no_kills"]');
  await pg.waitForFunction(() => document.querySelector('#al-num-no_kill_minutes')?.disabled);
  await pg.fill('#al-num-mind_pct', '80');
  await pg.press('#al-num-mind_pct', 'Enter');
  await pg.waitForFunction(() => /default 90/.test(document.querySelector('#al-num-mind_pct')?.parentElement.textContent || ''));
  check(await pg.$eval('#al-num-encumbrance_points', (el) => !el.disabled && el.labels[0]?.textContent === 'When'),
    'alerts: a threshold is greyed out while its alert is off, labelled, and shows its default once changed');
  await pg.click('#settingsPage [data-alerts-reset]');
  await pg.waitForFunction(() => localStorage.getItem('gs4a-alerts') === null && document.querySelector('#settingsPage [data-alert-on]').checked);
  check(true, 'alerts: Back to the defaults restores them');
  check(pgProblems.length === 0, `pages: no console errors${pgProblems.length ? `: ${pgProblems.join(' | ')}` : ''}`);
  await pages.close();

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
  check(await phonePage.$eval('.side', (el) => getComputedStyle(el).visibility === 'hidden'), 'phone: the closed menu cannot be reached with Tab');
  await phonePage.click('#menuBtn');
  // Waits for the slide to finish rather than a fixed time, which a busy machine can outlast
  const opened = await phonePage.waitForFunction(() => document.querySelector('.app').classList.contains('open') &&
    document.querySelector('.side').getBoundingClientRect().left >= 0, null, { timeout: 5000 }).then(() => true, () => false);
  check(opened, 'phone: the menu button opens the drawer');
  check(await phonePage.$eval('.main', (el) => el.inert), 'phone: while it is open, the page behind it is inert');
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
  check((await demo.$$('.card[data-who]')).length === 7, 'demo: the sample opens with its seven characters active today');
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
  check(await filePage.$eval('#warning', (el) => el.hidden), 'file: written in this browser\'s zone, so no zone warning');
  // The same file read in another zone: the page says its days may not be that computer's
  const tokyo = await browser.newContext({ viewport: { width: 1320, height: 900 }, timezoneId: 'Asia/Tokyo' });
  const tokyoPage = await tokyo.newPage();
  await tokyoPage.goto(`http://localhost:${SITE_PORT}/`);
  await tokyoPage.waitForSelector('#source:not([hidden])');
  await tokyoPage.setInputFiles('#pickFile', fixture);
  await tokyoPage.waitForSelector('#warning:not([hidden])', { timeout: 15_000 });
  check(/UTC\u22125 \(EST\), and this browser is at UTC\+9/.test(await tokyoPage.textContent('#warning')),
    'file: one written in another zone says so, with both offsets');
  await tokyo.close();

  // ---- a source that isn't there ---------------------------------------
  const deadPage = await fileContext.newPage();
  await deadPage.goto(`http://localhost:${SITE_PORT}/?live=1`);
  await deadPage.waitForSelector('#sourceError:not([hidden])', { timeout: 15_000 });
  const deadText = await deadPage.textContent('#sourceError');
  check(/Could not reach analytics\.lic/.test(deadText), 'unreachable: the chooser explains the script is not answering');
  check(/Local network access/.test(deadText), 'unreachable: and mentions the browser permission, which looks the same to the page');
  check(await deadPage.$('#source a[href="guide/"]') !== null, 'unreachable: the chooser links to the guide');
  // A script that answers but can't serve the database: its reason is shown (#21)
  const refuse = spawn(process.execPath, [fileURLToPath(new URL('./mock-server.js', import.meta.url)), '--port', String(API_PORT + 1), '--refuse'],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => refuse.stdout.once('data', resolve));
  try {
    await deadPage.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT + 1}`);
    await deadPage.waitForSelector('#sourceError:not([hidden])', { timeout: 15_000 });
    const why = await deadPage.textContent('#sourceError');
    check(/made by another build/.test(why) && /Rename or move it/.test(why), `refused: the script's reason is shown (${why.slice(0, 80)}...)`);
  } finally {
    refuse.kill();
  }
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
  const tocTargets = await guide.$$eval('.toc ol a', (els) => els.map((a) => a.getAttribute('href').slice(1)));
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
  // What's changed: linked from the guide, and its links into the guide land
  await guide.click('.toc-more a[href="changes.html"]');
  await guide.waitForSelector('.changes section[id]');
  const intoGuide = await guide.$$eval('.changes a[href^="./#"]', (els) => els.map((a) => a.getAttribute('href').slice(3)));
  await guide.goto(`http://localhost:${SITE_PORT}/guide/`);
  const gone = [];
  for (const id of intoGuide) if (!(await guide.$(`[id="${id}"]`))) gone.push(id);
  check(intoGuide.length > 0 && gone.length === 0, `changes: linked from the guide, and every link into the guide has a target${gone.length ? ` (missing ${gone.join(', ')})` : ''}`);
  check(guideProblems.length === 0, `changes: no console errors or CSP violations${guideProblems.length ? `: ${guideProblems.join(' | ')}` : ''}`);
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
