// The README's screenshots, from the synthetic fixture (made-up characters),
// served live by the mock API in demo mode so the day looks like today.
//
//   npm run screenshots        (needs Playwright's Chromium; writes docs/images/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startDevServer } from './dev-server.js';

const OUT = new URL('../docs/images/', import.meta.url).pathname;
const SITE_PORT = 8775;
const API_PORT = 8776;
mkdirSync(OUT, { recursive: true });

const site = await startDevServer(SITE_PORT);
const mock = spawn(process.execPath, [new URL('./mock-server.js', import.meta.url).pathname, '--port', String(API_PORT), '--demo'],
  { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  mock.stdout.once('data', resolve);
  mock.once('exit', (code) => reject(new Error(`the mock server exited (${code}) before it started`)));
});

const browser = await chromium.launch();
const problems = [];
async function shot(name, { hash = '', scheme = 'light', width = 1280, height = 900, full = true, range = null }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: width < 600 ? 2 : 1.5 });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  await page.goto(`http://localhost:${SITE_PORT}/?live=${API_PORT}${hash}`);
  await page.waitForSelector(hash ? '#tabs' : '.card[data-who]', { timeout: 15_000 });
  if (range) {
    await page.click(`#tabs button[data-r="${range}"]`);
    await page.waitForFunction((r) => document.querySelector('#tabs button.on')?.getAttribute('data-r') === r, range);
  }
  await page.waitForTimeout(800); // let the 1-second timers settle
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
  await context.close();
  console.log(`docs/images/${name}.png`);
}

try {
  await shot('overview', {});
  await shot('character', { hash: '#GS3%3ASplinter', range: 'weekly' });
  await shot('character-dark', { hash: '#GS3%3ASplinter', scheme: 'dark', full: false });
  await shot('phone', { width: 390, height: 844, full: false });
} finally {
  await browser.close();
  mock.kill();
  site.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
