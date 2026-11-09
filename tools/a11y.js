// Accessibility check: axe-core (WCAG 2.2 A and AA, plus best practices) on
// every view, in every theme, served against the mock API.
//
//   npm run a11y [-- --verbose]      (needs Playwright's Chromium)
//
// axe-core is a dev dependency only: the site never loads it. It is added to
// each page here with the page's CSP bypassed, which the published site never is.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startDevServer } from './dev-server.js';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const verbose = process.argv.includes('--verbose');
const SITE_PORT = 8825;
const API_PORT = 8826;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const site = await startDevServer(SITE_PORT);
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-server.js', import.meta.url)), '--port', String(API_PORT), '--demo'],
  { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  mock.stdout.once('data', resolve);
  mock.once('exit', (code) => reject(new Error(`the mock server exited (${code}) before it started`)));
});

const live = `/?live=${API_PORT}`;
// [name, path, element to wait for, what to do first]
const VIEWS = [
  ['first visit', '/', '#source:not([hidden]) #demoBtn'],
  ['overview', live, '.card[data-who]'],
  ['settings, one alert dismissed', live, '.card[data-who]', async (page) => {
    await page.click('#alertsCard [data-dismiss]');
    await page.waitForSelector('#alertsCard [data-undismiss]');
    await page.click('#alertsCard a.al-settings');
    await page.waitForSelector('#settingsPage:not([hidden]) [data-undismiss-one]');
  }],
  ['character, today', `${live}#GS4%3ASplinter`, '#tabs'],
  ['character, this month', `${live}#GS4%3ASplinter`, '#tabs', async (page) => {
    await page.click('#tabs button[data-r="monthly"]');
    await page.waitForFunction(() => document.querySelector('#tabs button.on')?.getAttribute('data-r') === 'monthly');
  }],
  ['chart data tables open', `${live}#GS4%3ASplinter`, '#tabs', async (page) => {
    for (const d of await page.$$('details.chart-table')) await d.evaluate((el) => { el.open = true; });
  }],
  ['character income', `${live}#GS4%3ASplinter/income`, '#detail .brows'],
  ['character hunting', `${live}#GS4%3ASplinter/hunting`, '#detail .brows'],
  // All Time, so the page has figures whatever the hour (just after midnight, today has none yet)
  ['character bounties', `${live}#GS4%3ASplinter/bounties`, '#tabs', async (page) => {
    await page.click('#tabs button[data-r="total"]');
    await page.waitForSelector('#detail .kpi-grid');
  }],
  ['character progress', `${live}#GS4%3ASplinter/progress`, '#detail .prog', async (page) => {
    for (const d of await page.$$('details.chart-table')) await d.evaluate((el) => { el.open = true; });
  }],
  ['character history, filtered', `${live}#GS4%3ASplinter/history`, '#tabs', async (page) => {
    await page.click('#tabs button[data-r="total"]');
    await page.waitForSelector('#histBody tr');
    await page.fill('#histQ', 'crags');
  }],
  ['overview with a character hidden', live, '.card[data-who]', async (page) => {
    await page.click('.card[data-who="GS3:Bebop"] [data-hide]');
    await page.click('.nav-hidden summary');
  }],
  ['compare', `${live}#compare`, '#compare table'],
  ['compare, all time, sorted', `${live}#compare`, '#compare table', async (page) => {
    await page.click('#cmpTabs button[data-r="total"]');
    await page.click('#compare [data-sort="cmp-creatures"][data-col="3"]');
  }],
  ['income, all time with bank checks', `${live}#GS4%3ASplinter/income`, '#detail .brows', async (page) => { await page.click('#tabs button[data-r="total"]'); }],
  ['progress with a target', `${live}#GS4%3ASplinter/progress`, '#targetForm', async (page) => {
    await page.fill('#targetValue', '90');
    await page.click('#targetForm button[type="submit"]');
    await page.waitForSelector('[data-target-clear]');
  }],
  ['sample data', '/?demo', '#banner:not([hidden])'],
  ['choosing another source', '/?demo', '#banner:not([hidden])', async (page) => { await page.click('#bannerConnect'); }],
  ['unreachable source', '/?live=1', '#sourceError:not([hidden])'],
  ['guide', '/guide/', 'main section[id]'],
  ['what\'s changed', '/guide/changes.html', '.changes section[id]'],
];
const PHONE_VIEWS = [
  ['phone overview', live, '.card[data-who]'],
  ['phone menu open', live, '.card[data-who]', async (page) => { await page.click('#menuBtn'); await page.waitForTimeout(400); }],
  ['phone character', `${live}#GS4%3ASplinter`, '#tabs'],
  ['phone income', `${live}#GS4%3ASplinter/income`, '#detail .brows'],
  ['phone compare', `${live}#compare`, '#compare table'],
  ['phone history', `${live}#GS4%3ASplinter/history`, '#tabs', async (page) => {
    await page.$eval('#tabs button[data-r="total"]', (b) => b.click()); // the tabs scroll sideways on a phone
    await page.waitForSelector('#histBody tr');
  }],
];
const THEMES = [
  ['light', { colorScheme: 'light' }, {}],
  ['dark', { colorScheme: 'dark' }, {}],
  ['light, high contrast', { colorScheme: 'light' }, { 'gs4a-contrast': 'more' }],
  ['dark, high contrast', { colorScheme: 'dark' }, { 'gs4a-contrast': 'more' }],
  ['system high contrast', { colorScheme: 'light', contrast: 'more' }, {}],
];

const browser = await chromium.launch();
let failures = 0;
const seen = new Map();
async function audit(name, path, wait, before, theme, store, viewport) {
  const context = await browser.newContext({ viewport, bypassCSP: true, reducedMotion: 'reduce', ...theme });
  await context.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
  const page = await context.newPage();
  await page.goto(`http://localhost:${SITE_PORT}${path}`);
  await page.waitForSelector(wait, { timeout: 15_000 });
  if (before) await before(page);
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  await context.close();
  for (const v of result.violations) {
    failures += v.nodes.length;
    const key = `${v.id}`;
    if (!seen.has(key)) seen.set(key, { help: v.help, impact: v.impact, where: [], samples: [] });
    const s = seen.get(key);
    s.where.push(`${name} [${theme.colorScheme}${store['gs4a-contrast'] || theme.contrast ? ', contrast' : ''}] x${v.nodes.length}`);
    for (const n of v.nodes.slice(0, verbose ? 20 : 2)) s.samples.push(`${n.target.join(' ')}: ${n.failureSummary.split('\n').slice(1).join(' ').trim().slice(0, 220)}`);
  }
  console.log(`${result.violations.length ? 'FAIL' : 'ok  '} ${name} (${theme.colorScheme}${store['gs4a-contrast'] ? ', high contrast' : theme.contrast ? ', system high contrast' : ''})`);
}

// ---- contrast of the colour tokens themselves --------------------------
// axe checks text it can see; these are the pairs it can't (SVG text, text on
// data colours, borders and marks), read from each theme's computed tokens.
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ...['--ink', '--ink-2', '--muted'].flatMap((fg) => ['--page', '--surface', '--surface-2', '--sunken', '--side'].map((bg) => [fg, bg, TEXT, 'text'])),
  ['--accent-ink', '--surface', TEXT, 'link text'], ['--accent-ink', '--page', TEXT, 'link text'], ['--accent-ink', ['--accent-soft', '--surface'], TEXT, 'badge'],
  ['--good-ink', ['--good-soft', '--surface'], TEXT, 'good delta'], ['--crit-ink', ['--crit-soft', '--surface'], TEXT, 'bad delta'],
  ['--warn-ink', ['--warn-soft', '--surface'], TEXT, 'warning tag'], ['--crit-ink', ['--crit-soft', '--page'], TEXT, 'error'],
  ...['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'gray'].map((k) => [`--on-${k}`, `--${k}`, TEXT, 'label on a data colour']),
  ['--field-line', '--surface-2', UI, 'text field border'], ['--accent', '--surface', UI, 'focus ring, meter'], ['--muted', '--surface', UI, 'pin, icons'],
];
const HC_PAIRS = [
  ['--line', '--surface', UI, 'card border'], ['--line-2', '--surface', UI, 'control border'],
  ...['--st-hunt', '--st-rest', '--st-dead', '--st-idle'].map((k) => [k, '--surface', UI, 'activity state']),
  ...['--k1', '--k2', '--k3', '--k4', '--k5', '--k6', '--k7', '--k8'].map((k) => [k, '--surface', UI, 'chart colour']),
];
function rgb(value) {
  const v = value.trim();
  if (v.startsWith('#')) {
    const h = v.length === 4 ? v.slice(1).split('').map((c) => c + c).join('') : v.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([1]);
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`cannot read colour ${v}`);
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3])).concat([1]);
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
async function tokens(theme, store) {
  const context = await browser.newContext({ ...theme });
  await context.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
  const page = await context.newPage();
  await page.goto(`http://localhost:${SITE_PORT}/`);
  const hc = await page.evaluate(() => document.documentElement.hasAttribute('data-hc'));
  const names = [...new Set([...PAIRS, ...HC_PAIRS].flatMap(([f, b]) => [f, b].flat()))];
  const values = await page.evaluate((list) => Object.fromEntries(list.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n)])), names);
  await context.close();
  return { hc, values };
}

try {
  for (const [label, theme, store] of THEMES) {
    const { hc, values } = await tokens(theme, store);
    const bad = [];
    for (const [fg, bg, min, what] of hc ? PAIRS.concat(HC_PAIRS) : PAIRS) {
      const back = Array.isArray(bg) ? over(rgb(values[bg[0]]), rgb(values[bg[1]])) : rgb(values[bg]);
      const r = ratio(over(rgb(values[fg]), back), back);
      if (r < min) bad.push(`${fg} on ${[bg].flat().join(' over ')} ${r.toFixed(2)}:1, needs ${min}:1 (${what})`);
    }
    failures += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} colour tokens (${label}${hc ? '' : ''})${bad.length ? '\n       ' + bad.join('\n       ') : ''}`);
  }
  // Six pages at a time: each is its own browser context
  const jobs = THEMES.flatMap(([, theme, store]) => [
    ...VIEWS.map(([name, path, wait, before]) => () => audit(name, path, wait, before, theme, store, { width: 1440, height: 900 })),
    ...PHONE_VIEWS.map(([name, path, wait, before]) => () => audit(name, path, wait, before, theme, store, { width: 390, height: 844 })),
  ]);
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) await jobs[next++](); }));
} finally {
  await browser.close();
  mock.kill();
  site.close();
}
for (const [id, s] of seen) {
  console.error(`\n${id} (${s.impact}): ${s.help}\n  in: ${s.where.join('; ')}`);
  for (const sample of [...new Set(s.samples)].slice(0, verbose ? 40 : 6)) console.error(`  - ${sample}`);
}
if (failures) {
  console.error(`\n${failures} accessibility problem(s)`);
  process.exit(1);
}
console.log('\nno accessibility problems found');
