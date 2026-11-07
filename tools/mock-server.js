// A stand-in for analytics.lic's dashboard API (docs/api.md), for local
// development and the end-to-end check. It answers exactly as the updated
// script is specified to: the same routes, the same CORS and Host rules.
//
//   node tools/mock-server.js [--port 8080] [--db test/fixtures/afternoon.db] [--demo]
//   (--demo defaults --db to site/demo/sample.db)
//
// --demo moves every timestamp in the database so the fixture's "now" is
// the real now, and keeps writing (a bank deposit every 10 seconds) so a
// live page has something to update.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { shiftTimes } from '../site/js/shift.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const PORT = Number(opt('port', 8080));
// --demo serves the site's sample data (the fixture plus more characters; tools/build-sample.js)
const DB_PATH = opt('db', new URL(args.includes('--demo') ? '../site/demo/sample.db' : '../test/fixtures/afternoon.db', import.meta.url).pathname);
const DEMO = args.includes('--demo');
// --refuse answers every API request 503 with the script's reason for a
// database made by another build, as analytics.lic does (docs/api.md)
const REFUSE = args.includes('--refuse');

// The origins whose pages may read the API (docs/api.md, "CORS"). The
// project's site (its own domain, so no other Pages site shares the
// origin), plus any page served from this computer.
const ALLOWED_ORIGINS = [/^https:\/\/analytics\.elanthia\.online$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(DB_PATH));
let version = 1;
const bootId = Date.now().toString(36);
let image = db.export();

if (DEMO) {
  const golden = JSON.parse(readFileSync(DB_PATH.replace(/\.db$/, '.json'), 'utf8'));
  // The fixture's moment becomes the real now (the page's own sample data
  // keeps the time of day instead; see site/js/shift.js)
  shiftTimes(db, Math.floor(Date.now() / 1000) - golden.now, golden.now, golden.tz);
  image = db.export();
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const last = db.exec("SELECT balance FROM bank_snapshots WHERE game = 'GS3' AND character = 'Splinter' AND bank_name = '__total__' ORDER BY timestamp DESC LIMIT 1");
    const balance = (last[0]?.values[0][0] ?? 0) + 2500;
    db.run("INSERT INTO bank_snapshots (snapshot_id, game, character, timestamp, bank_name, balance, delta_silver, snapshot_type) VALUES (?, 'GS3', 'Splinter', ?, '__total__', ?, 2500, 'deposit')",
      [`b-demo-${now}`, now, balance]);
    db.run("UPDATE logins SET last_seen = ? WHERE game = 'GS3' AND character = 'Splinter' AND started_at = (SELECT MAX(started_at) FROM logins WHERE game = 'GS3' AND character = 'Splinter')", [now]);
    image = db.export();
    version++;
  }, 10_000).unref();
}

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'X-Analytics-Token' };
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const reply = (code, type, body, extra = {}) => {
    res.writeHead(code, { ...BASE_HEADERS, ...corsHeaders(origin), 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
    res.end(body);
  };
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.includes(host)) return reply(403, 'text/plain', 'Forbidden'); // DNS rebinding
  if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) return reply(403, 'text/plain', 'Forbidden');

  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    // Only older Chromium sends this (Private Network Access); simple GETs need no preflight
    return reply(204, 'text/plain', '', {
      'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600',
    });
  }
  if (req.method !== 'GET') return reply(405, 'text/plain', 'Method not allowed');

  if (REFUSE && url.pathname.startsWith('/api/')) {
    return reply(503, 'text/plain', `${DB_PATH} was made by another build of analytics.lic (schema 7, this one uses 9). ` +
      'Rename or move it, then start ;analytics again for a fresh one.');
  }
  const token = `${bootId}.${version}`;
  switch (url.pathname) {
    case '/':
    case '/index.html':
      return reply(302, 'text/plain', '', { Location: `https://analytics.elanthia.online/?live=${PORT}` });
    case '/api/meta':
      return reply(200, 'application/json', JSON.stringify({
        app: 'analytics', api: 1, script_version: 'mock', schema_version: '8', token,
        now: Math.floor(Date.now() / 1000), db_bytes: image.byteLength,
      }));
    case '/api/db':
      res.writeHead(200, { ...BASE_HEADERS, ...corsHeaders(origin), 'Content-Type': 'application/vnd.sqlite3',
                           'Content-Length': image.byteLength, 'X-Analytics-Token': token });
      return res.end(Buffer.from(image));
    default:
      return reply(404, 'text/plain', 'Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock analytics.lic API on http://127.0.0.1:${PORT} (${DB_PATH}${DEMO ? ', demo' : ''})`);
});
