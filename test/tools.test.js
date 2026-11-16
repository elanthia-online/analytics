// The dev tools work from a clone whose path has a space in it (#33): they
// turn import.meta.url into a path, and URL.pathname would keep the %20.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

function serve(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${script} didn't start`)); }, 10_000);
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.stdout.once('data', () => { clearTimeout(timer); resolve(child); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${script} exited (${code})`)); });
  });
}

test('the dev server and the mock API serve from a path with a space (#33)', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'gs4a-')), 'My Repos', 'analytics');
  for (const part of ['site', 'tools', 'test/fixtures', 'package.json']) cpSync(join(repo, part), join(dir, part), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const site = await serve(join(dir, 'tools', 'dev-server.js'), ['--port', String(port)]);
  const api = await serve(join(dir, 'tools', 'mock-server.js'), ['--port', String(port + 1)]);
  try {
    const page = await fetch(`http://localhost:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>/);
    assert.equal((await fetch(`http://localhost:${port}/js/app.js`)).status, 200);
    assert.equal((await fetch(`http://localhost:${port}/no-such-page`)).status, 404);
    const meta = await (await fetch(`http://127.0.0.1:${port + 1}/api/meta`, { headers: { Origin: `http://localhost:${port}` } })).json();
    assert.equal(meta.app, 'analytics');
    // as from the script: another site's no-cors load is refused, a typed address isn't (docs/api.md)
    assert.equal((await fetch(`http://127.0.0.1:${port + 1}/api/db`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port + 1}/api/meta`, { headers: { 'Sec-Fetch-Site': 'none' } })).status, 200);
  } finally {
    site.kill();
    api.kill();
    rmSync(join(dir, '..', '..'), { recursive: true, force: true });
  }
});

test('the dev server starts through a symlinked path, as from macOS\'s /var (#60)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'gs4a-'));
  const link = join(base, 'linked');
  symlinkSync(repo, link);
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const site = await serve(join(link, 'tools', 'dev-server.js'), ['--port', String(port)]);
  try {
    assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
  } finally {
    site.kill();
    rmSync(base, { recursive: true, force: true });
  }
});
