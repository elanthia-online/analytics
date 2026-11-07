// Dashboard's handling of sources (site/js/data.js), with sources made up here
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Dashboard } from '../site/js/data.js';

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
