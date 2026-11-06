// The JS aggregation must give what analytics.lic's Ruby dashboard gave for
// the same database at the same moment (test/fixtures/*.json, written by
// tools/gen-fixtures.rb). Run under the TZ the fixtures were made in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Conn } from '../site/js/db.js';
import { buildOverview, buildCharacter } from '../site/js/aggregate/index.js';

const SQL = await initSqlJs();
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const source = JSON.parse(readFileSync(fixture('source.json'), 'utf8'));

test('runs in the time zone the fixtures were made in', () => {
  assert.equal(process.env.TZ, source.tz, `run with TZ=${source.tz} (npm test sets it)`);
});

// Ruby's sort_by is not stable, so entries with equal sort keys can come out
// in any order there. These lists are compared with their tied runs sorted.
const UNSTABLE = {
  'overview.alerts': (a) => [a.level === 'red' ? 0 : 1, a.character],
  rest_reasons: (r) => [-r.today, -(r.typical ?? 0)],
  grounds: (g) => [-g.exp_hr],
};

function normalizeTies(list, key) {
  const out = [];
  let run = [];
  const flush = () => {
    out.push(...run.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)));
    run = [];
  };
  for (const item of list) {
    if (run.length && JSON.stringify(key(run[0])) !== JSON.stringify(key(item))) flush();
    run.push(item);
  }
  flush();
  return out;
}

// Deep comparison that reports the first differing path. Numbers compare
// by value (Ruby's 12.0 and JS's 12 are the same figure).
function diff(want, got, path) {
  if (typeof want === 'number' && typeof got === 'number') {
    return Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want)) ? null : `${path}: want ${want}, got ${got}`;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return `${path}: want an array, got ${JSON.stringify(got)}`;
    if (want.length !== got.length) return `${path}: want ${want.length} items, got ${got.length}`;
    const tail = path.replace(/^.*?(overview\.alerts|rest_reasons|grounds)$/, '$1');
    const key = UNSTABLE[tail];
    const [w, g] = key ? [normalizeTies(want, key), normalizeTies(got, key)] : [want, got];
    for (let i = 0; i < w.length; i++) {
      const d = diff(w[i], g[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') return `${path}: want an object, got ${JSON.stringify(got)}`;
    const wk = Object.keys(want);
    const gk = Object.keys(got);
    if (wk.join() !== gk.join()) return `${path}: want keys ${wk.join(',')}, got ${gk.join(',')}`;
    for (const k of wk) {
      const d = diff(want[k], got[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(want, got) ? null : `${path}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
}

for (const scenario of ['afternoon', 'after-midnight']) {
  const golden = JSON.parse(readFileSync(fixture(`${scenario}.json`), 'utf8'));
  const db = new SQL.Database(readFileSync(fixture(`${scenario}.db`)));
  const conn = new Conn(db);
  const now = golden.now;
  const overview = buildOverview(conn, { now });

  test(`${scenario}: the overview matches the Ruby dashboard`, () => {
    assert.equal(diff(golden.overview, overview, 'overview'), null);
  });

  for (const [id, ranges] of Object.entries(golden.characters)) {
    for (const [range, want] of Object.entries(ranges)) {
      test(`${scenario}: ${id} ${range} matches the Ruby dashboard`, () => {
        const got = buildCharacter(conn, overview, id, range, { now });
        assert.equal(diff(want, got, `${id}.${range}`), null);
      });
    }
  }

  test.after(() => db.close());
}
