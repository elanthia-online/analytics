// The page's sample data is the synthetic fixture, unchanged, and the shift
// that moves it to today keeps every row and moves every time by the same gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { shiftTimes, sameTimeToday, TIME_COLUMNS } from '../site/js/shift.js';

const read = (path) => readFileSync(new URL(path, import.meta.url));

// The sample is the parity fixture plus made-up characters and history
// (tools/build-sample.js). Rebuilding it gives the committed file exactly.
test('site/demo/sample.db is what tools/build-sample.js makes from the fixture', async () => {
  const { buildSample } = await import('../tools/build-sample.js');
  const SQL = await initSqlJs();
  const meta = JSON.parse(read('../site/demo/sample.json'));
  const built = Buffer.from(buildSample(SQL, read('fixtures/afternoon.db'), meta.now));
  assert.ok(built.equals(read('../site/demo/sample.db')), 'run npm run sample');
});

test('the sample keeps every fixture row unchanged, and adds only for its own characters', async () => {
  const SQL = await initSqlJs();
  const fix = new SQL.Database(read('fixtures/afternoon.db')), sample = new SQL.Database(read('../site/demo/sample.db'));
  try {
    const tables = fix.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values.map((r) => r[0]);
    for (const t of tables) {
      const rows = (db, where = '') => (db.exec(`SELECT * FROM ${t}${where}`)[0]?.values ?? []).map((r) => JSON.stringify(r));
      const have = new Set(rows(sample));
      const missing = rows(fix).filter((r) => !have.has(r));
      assert.equal(missing.length, 0, `${t}: ${missing.length} fixture rows changed or missing`);
      const cols = fix.exec(`PRAGMA table_info(${t})`)[0].values.map((r) => r[1]);
      if (!cols.includes('character')) continue;
      const extra = new Set(rows(fix));
      const added = (sample.exec(`SELECT character, * FROM ${t}`)[0]?.values ?? []).filter((r) => !extra.has(JSON.stringify(r.slice(1))));
      const who = [...new Set(added.map((r) => r[0]))].sort();
      assert.ok(who.every((c) => ['Bebop', 'Casey', 'Karai', 'Leonardo'].includes(c)), `${t}: rows added for ${who.join(', ')}`);
    }
    // What the sample is for: a week of history, one character past the cap and others below it
    const days = (c) => sample.exec(`SELECT COUNT(DISTINCT date(start_time, 'unixepoch', 'localtime')) FROM cycles WHERE character = '${c}'`)[0].values[0][0];
    for (const c of ['Karai', 'Casey', 'Bebop', 'Leonardo']) assert.ok(days(c) >= 7, `${c}: ${days(c)} days`);
    const level = (c) => sample.exec(`SELECT level FROM progress WHERE character = '${c}' ORDER BY timestamp DESC LIMIT 1`)[0].values[0][0];
    assert.equal(level('Karai'), 100);
    assert.ok(level('Casey') < 50 && level('Splinter') < 100);
  } finally {
    fix.close();
    sample.close();
  }
});

test('site/demo/sample.json carries the fixture moment', () => {
  const meta = JSON.parse(read('../site/demo/sample.json'));
  const golden = JSON.parse(read('fixtures/afternoon.json'));
  assert.equal(meta.now, golden.now);
  assert.equal(meta.tz, golden.tz);
});

test('sameTimeToday keeps the wall-clock time and lands on today', () => {
  const golden = JSON.parse(read('fixtures/afternoon.json'));
  const now = Date.UTC(2027, 2, 14, 20, 0, 0) / 1000; // any later moment
  const at = new Date((golden.now + sameTimeToday(golden.now, golden.tz, now)) * 1000);
  const want = new Date(golden.now * 1000); // TZ is the fixture's (npm test pins it)
  assert.deepEqual([at.getHours(), at.getMinutes()], [want.getHours(), want.getMinutes()]);
  assert.equal(at.toDateString(), new Date(now * 1000).toDateString());
});

test('shiftTimes moves every timestamp by the gap and keeps every row', async () => {
  const SQL = await initSqlJs();
  const before = new SQL.Database(read('fixtures/afternoon.db'));
  const after = new SQL.Database(read('fixtures/afternoon.db'));
  try {
    const delta = 9 * 86400 + 3600;
    shiftTimes(after, delta, 1793824620);
    for (const [table, cols] of Object.entries(TIME_COLUMNS)) {
      for (const col of cols) {
        const q = `SELECT COUNT(*), MIN(${col}), MAX(${col}) FROM ${table}`;
        const [n0, lo0, hi0] = before.exec(q)[0].values[0];
        const [n1, lo1, hi1] = after.exec(q)[0].values[0];
        assert.equal(n1, n0, `${table} keeps its rows`);
        if (lo0 != null) assert.deepEqual([lo1 - lo0, hi1 - hi0], [delta, delta], `${table}.${col} moves by the gap`);
      }
    }
    const dates = (db) => db.exec('SELECT MIN(date), MAX(date) FROM kill_stats')[0].values[0];
    const [d0] = dates(before), [d1] = dates(after);
    assert.equal((Date.parse(d1) - Date.parse(d0)) / 86_400_000, 9);
  } finally {
    before.close();
    after.close();
  }
});
