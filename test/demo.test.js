// The page's sample data is the synthetic fixture, unchanged, and the shift
// that moves it to today keeps every row and moves every time by the same gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { shiftTimes, sameTimeToday, TIME_COLUMNS } from '../site/js/shift.js';

const read = (path) => readFileSync(new URL(path, import.meta.url));

test('site/demo/sample.db is test/fixtures/afternoon.db, byte for byte', () => {
  assert.ok(read('../site/demo/sample.db').equals(read('fixtures/afternoon.db')),
    'copy test/fixtures/afternoon.db to site/demo/sample.db');
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
