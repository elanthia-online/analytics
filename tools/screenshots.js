// The README's screenshots, from the synthetic fixture (made-up characters),
// served live by the mock API in demo mode so the day looks like today.
// Each view is saved twice: <name>.png, the whole page (what the README links
// to), and <name>-preview.png, its top at one fixed shape, so the previews line
// up in the README's grid. Also site/img/og.png, the picture a link to the
// site shows in chat apps and social sites (og:image in site/index.html).
//
//   npm run screenshots        (needs Playwright's Chromium; writes docs/images/ and site/img/og.png)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startDevServer } from './dev-server.js';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url));
const OG = fileURLToPath(new URL('../site/img/og.png', import.meta.url));
const SITE_PORT = 8775;
const API_PORT = 8776;
mkdirSync(OUT, { recursive: true });
mkdirSync(fileURLToPath(new URL('../site/img/', import.meta.url)), { recursive: true });

const site = await startDevServer(SITE_PORT);
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-server.js', import.meta.url)), '--port', String(API_PORT), '--demo'],
  { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  mock.stdout.once('data', resolve);
  mock.once('exit', (code) => reject(new Error(`the mock server exited (${code}) before it started`)));
});

const browser = await chromium.launch();
const problems = [];
async function shot(name, { hash = '', scheme = 'light', width = 1440, height = 900, preview = height, range = null, landing = false, path = null, scale = null, contrast = false }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: scale ?? (width < 600 ? 2 : 1.5), contrast: contrast ? 'more' : 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  await page.goto(landing ? `http://localhost:${SITE_PORT}/` : `http://localhost:${SITE_PORT}/?live=${API_PORT}${hash}`);
  await page.waitForSelector(landing ? '#source:not([hidden]) #demoBtn' : hash === '#compare' ? '#compare table' : hash === '#settings' ? '#settingsPage #set-alerts' : hash ? '.sub-nav' : '.card[data-who]', { timeout: 15_000 });
  if (range) {
    const tabs = hash === '#compare' ? '#cmpTabs' : '#tabs';
    await page.click(`${tabs} button[data-r="${range}"]`);
    await page.waitForFunction(([t, r]) => document.querySelector(`${t} button.on`)?.getAttribute('data-r') === r, [tabs, range]);
  }
  await page.waitForTimeout(1200); // let the 1-second timers and the entrance settle
  if (path) {
    await page.screenshot({ path });
    await context.close();
    console.log(path);
    return;
  }
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}${name}-preview.png`, clip: { x: 0, y: 0, width, height: preview } });
  await context.close();
  console.log(`docs/images/${name}.png, ${name}-preview.png`);
}

try {
  await shot('landing', { landing: true });
  await shot('overview', {});
  await shot('character', { hash: '#GS4%3ASplinter', range: 'weekly' });
  await shot('character-dark', { hash: '#GS4%3ASplinter', scheme: 'dark' });
  // Karai: the sample's combat and locksmith pool rows are Bebop's, Casey's, Karai's and Leonardo's
  await shot('income', { hash: '#GS4%3AKarai/income', range: 'weekly' });
  await shot('hunting', { hash: '#GS4%3AKarai/hunting', range: 'weekly' });
  await shot('progress', { hash: '#GS4%3ASplinter/progress', scheme: 'dark' });
  await shot('compare', { hash: '#compare', range: 'weekly' });
  await shot('settings', { hash: '#settings' });
  await shot('phone', { width: 390, height: 844, preview: 620 });
  await shot('character-contrast', { hash: '#GS4%3ASplinter', contrast: true });
  await shot('og', { scheme: 'dark', width: 1200, height: 630, scale: 1, path: OG });
} finally {
  await browser.close();
  mock.kill();
  site.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
