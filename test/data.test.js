// Dashboard's handling of sources (site/js/data.js), with sources made up here
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Dashboard, LiveSource } from '../site/js/data.js';
import http from 'node:http';

const real = await initSqlJs();
const fixture = new Uint8Array(readFileSync(new URL('fixtures/afternoon.db', import.meta.url)));

// sql.js with a count of the databases left open
function counting() {
  let open = 0;
  class Database extends real.Database {
    constructor(...args) { super(...args); open++; }
    close() { open--; return super.close(); }
  }
  return { SQL: { ...real, Database }, open: () => open };
}
const source = (bytes, wait = 0, label = 'x') => ({
  label, live: false, kind: 'file', forgotten: 0,
  forget() { this.forgotten++; },
  load() { return new Promise((resolve) => setTimeout(() => resolve({ bytes, changed: true, asOf: 1 }), wait)); },
});

test('a file that is not SQLite is refused plainly, and its database freed every time (#19)', async () => {
  const { SQL, open } = counting();
  const dash = new Dashboard(SQL);
  const junk = source(new TextEncoder().encode('PK not a database at all, just a zip-ish file'.repeat(50)));
  for (let i = 0; i < 3; i++) {
    dash.setSource(junk);
    await assert.rejects(dash.refresh(), /isn't an SQLite database/);
  }
  assert.equal(open(), 0, 'no database left open');
  assert.equal(junk.forgotten, 3, 'the source forgets an image that did not open');
  // from the script's API it's not "that file": it says the script sent it and tries again
  dash.setSource({ ...junk, live: true, kind: 'live' });
  await assert.rejects(dash.refresh(), (e) => /analytics\.lic sent a copy .* isn't an SQLite database/.test(e.message) && !/That file/.test(e.message));
  assert.equal(open(), 0);
  dash.setSource(source(fixture));
  await dash.refresh();
  assert.equal(open(), 1);
  dash.close();
});

test('a load that finishes after the source changed is thrown away (#18)', async () => {
  const { SQL } = counting();
  const dash = new Dashboard(SQL);
  const slow = source(fixture, 60, 'slow live');
  const quick = source(fixture, 0, 'the sample');
  dash.setSource(slow);
  const first = dash.refresh();
  dash.setSource(quick); // the reader picked another source meanwhile
  const second = await dash.refresh();
  await assert.rejects(first, (e) => e.superseded === true);
  assert.equal(second.label, 'the sample');
  assert.equal(dash.source, quick);
  dash.close();
});

test('of two overlapping refreshes of one source, the older is thrown away (#18)', async () => {
  const { SQL } = counting();
  const dash = new Dashboard(SQL);
  let n = 0;
  const live = { label: 'live', live: true, kind: 'live',
    load() { const me = ++n; return new Promise((r) => setTimeout(() => r({ bytes: fixture, changed: true, asOf: me }), me === 1 ? 60 : 0)); } };
  dash.setSource(live);
  const older = dash.refresh();
  const newer = await dash.refresh();
  await assert.rejects(older, (e) => e.superseded === true);
  assert.equal(newer.asOf, 2);
  assert.equal(dash.asOf, 2, 'the older answer never overwrote the newer');
  dash.close();
});

test('a long range is built once a minute while the image is unchanged; short ranges every second (#37)', async () => {
  const { SQL } = counting();
  const dash = new Dashboard(SQL);
  dash.setSource(source(fixture));
  await dash.refresh();
  let clock = 1793824620;
  dash.now = () => clock;
  const ids = ['GS3:April'];
  const year = dash.compare(ids, 'ytd'), today = dash.compare(ids, 'daily');
  clock += 5;   // a refresh with nothing new, a few seconds on (the same minute: ...620 is 0 s into it)
  assert.equal(dash.compare(ids, 'ytd'), year, 'the same object, not rebuilt');
  assert.notEqual(dash.compare(ids, 'daily'), today, 'a short range is rebuilt');
  clock += 60;
  assert.notEqual(dash.compare(ids, 'ytd'), year, 'rebuilt once the minute turns');
  dash.close();
});

test('a database written in another zone is flagged; the same zone, or no zone recorded, is not (#37)', async () => {
  const { zoneWarning } = await import('../site/js/data.js');
  const { Conn } = await import('../site/js/db.js');
  const db = new real.Database(fixture);
  const conn = new Conn(db);
  try {
    assert.equal(zoneWarning(conn), null, 'the fixture was written in New York, where npm test runs');
    db.run("UPDATE metadata SET value = '32400' WHERE key = 'utc_offset'");
    db.run("UPDATE metadata SET value = 'JST' WHERE key = 'zone'");
    assert.match(zoneWarning(conn), /Lich running at UTC\+9 \(JST\), and this browser is at UTC−5\./);
    assert.match(zoneWarning(conn), /14 hours apart, so kills can show on the day before or after .* a whole day's worth/, 'kills can be a whole day off, not just near midnight (S7)');
    // a DST change since doesn't count: the offset is compared at the moment it was read
    const july = Math.floor(new Date(2026, 6, 1, 12).getTime() / 1000);
    db.run("UPDATE metadata SET value = '-14400', updated_at = ? WHERE key = 'utc_offset'", [july]);
    assert.equal(zoneWarning(conn), null, 'EDT in July is New York too');
    db.run("DELETE FROM metadata WHERE key = 'utc_offset'");
    assert.equal(zoneWarning(conn), null, 'an older file without it: unknown, not a warning');
  } finally {
    db.close();
  }
});

test('a load that fails after the source changed is thrown away too, not reported against the new one (#18)', async () => {
  const { SQL } = counting();
  const dash = new Dashboard(SQL);
  const failing = { label: 'gone', live: true, kind: 'live', load: () => new Promise((_, reject) => setTimeout(() => reject(new Error('connection refused')), 40)) };
  dash.setSource(failing);
  const first = dash.refresh();
  dash.setSource(source(fixture));
  await assert.rejects(first, (e) => e.superseded === true, 'superseded, not "connection refused"');
  await dash.refresh();
  // and with no switch, the failure is the source's own
  dash.setSource(failing);
  await assert.rejects(dash.refresh(), /connection refused/);
  dash.close();
});

test('a live image that didn\'t open is asked for again, though its token is unchanged (#37)', async () => {
  const marked = (() => { const d = new real.Database(fixture); d.run("UPDATE cycles SET character = 'Krang' WHERE character = 'April'"); const b = d.export(); d.close(); return Buffer.from(b); })();
  let token = 'T1', downloads = 0, corrupt = false;
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api/meta') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ app: 'analytics', api: 1, token, now: 1 })); }
    downloads++;
    res.writeHead(200, { 'X-Analytics-Token': token });
    if (token === 'T1') return res.end(Buffer.from(fixture));
    if (corrupt) { corrupt = false; return res.end(Buffer.alloc(4096, 7)); }
    return res.end(marked);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dash = new Dashboard(real);
  try {
    dash.setSource(new LiveSource(server.address().port));
    await dash.refresh();
    token = 'T2'; corrupt = true;
    await assert.rejects(dash.refresh(), /isn't an SQLite database/);
    await dash.refresh();
    assert.equal(downloads, 3, 'the image after the bad one is downloaded again');
    assert.ok(dash.conn.one("SELECT COUNT(*) AS n FROM cycles WHERE character = 'Krang'").n > 0, 'and shown');
  } finally {
    dash.close();
    server.close();
  }
});
