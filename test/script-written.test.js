// A database written by analytics.lic itself, not seeded: two characters over
// four days, played through the script's own managers by
// tools/script-written-db.rb (from the 2026-11-13 audit), run on analytics.lic
// 6088896c in TZ=America/New_York; run it again, as its header says, after a
// change to what the script writes. It carries the values the script writes today,
// which the parity fixtures predate: offers open, removed, completed and
// expired, 'hunt stopped' and 'crashed', coins off the floor, shop types from
// the map's room tags, combat and locksmith pool rows. Each page is checked
// against plain SQL on the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Conn } from '../site/js/db.js';
import { buildOverview, buildCharacter, buildIncome, buildHunting, buildBounties, buildHistory, buildDaily, buildProgress } from '../site/js/aggregate/index.js';
import { buildCombat, buildPool, buildCompare, buildReconciliation } from '../site/js/aggregate/details.js';
import { rangeFromArg } from '../site/js/aggregate/report.js';
import { windowDay, dateOf } from '../site/js/aggregate/time.js';

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(new URL('fixtures/script-written.db', import.meta.url)));
const conn = new Conn(db);
const now = 1794424116;                                   // where the probe's play ended
const one = (sql, ...p) => Object.values(conn.one(sql, ...p))[0] ?? 0;
const chars = conn.all('SELECT DISTINCT game, character FROM cycles').map((r) => [r.game, r.character]);
const ids = chars.map(([g, c]) => `${g}:${c}`);

test('the values the script writes are all in it', () => {
  const values = (sql) => conn.all(sql).map((r) => Object.values(r)[0]);
  assert.deepEqual(values('SELECT DISTINCT outcome FROM bounty_offers ORDER BY 1'), ['completed', 'expired', 'open', 'removed']);
  assert.ok(values("SELECT DISTINCT rest_reason FROM cycles WHERE cycle_type = 'hunt'").includes('hunt stopped'));
  assert.ok(values('SELECT DISTINCT rest_reason FROM cycles').includes('crashed'));
  assert.ok(values('SELECT DISTINCT source_category FROM silver_events').includes('floor'));
  assert.deepEqual(values('SELECT DISTINCT vendor_type FROM item_sales ORDER BY 1'), ['furrier', 'gemshop', 'pawnshop']);
  assert.ok(one('SELECT COUNT(*) FROM combat_stats') > 0 && one('SELECT COUNT(*) FROM pool_depth') > 0);
});

test('every page builds for every character and range', () => {
  const ov = buildOverview(conn, { now });
  assert.deepEqual(ov.characters.map((c) => c.id).sort(), [...ids].sort());
  for (const id of ids) {
    for (const range of ['daily', 'weekly', 'monthly', 'ytd', 'total']) {
      if (range !== 'ytd' && range !== 'total') assert.ok(buildCharacter(conn, ov, id, range, { now }), `${id} ${range}`);
      for (const build of [buildIncome, buildHunting, buildBounties, buildHistory, buildCombat, buildPool, buildReconciliation]) {
        assert.ok(build(conn, id, range, { now }), `${build.name} ${id} ${range}`);
      }
    }
    assert.ok(buildProgress(conn, id, { now }));
  }
  assert.ok(buildDaily(conn, ids, { now }) && buildCompare(conn, ids, 'weekly', { now }));
});

for (const range of ['daily', 'weekly', 'monthly']) {
  test(`${range}: the pages match plain SQL on the file`, () => {
    const from = rangeFromArg(range, now)[1];
    const days = [windowDay(from), dateOf(now)];
    const ov = buildOverview(conn, { now });
    for (const [g, c] of chars) {
      const id = `${g}:${c}`, who = [g, c];
      const rs = buildCharacter(conn, ov, id, range, { now }).range_stats;
      assert.equal(rs.silver, one("SELECT SUM(delta_silver) FROM bank_snapshots WHERE game = ? AND character = ? AND bank_name = '__total__' AND delta_silver IS NOT NULL AND timestamp BETWEEN ? AND ?", ...who, from, now), `${id} silver`);
      const kills = one('SELECT SUM(kill_count) FROM kill_stats WHERE game = ? AND character = ? AND date BETWEEN ? AND ?', ...who, ...days);
      assert.equal(rs.kills, kills, `${id} summary kills`);
      assert.equal(buildHunting(conn, id, range, { now }).kills, kills, `${id} hunting kills`);
      assert.equal(rs.bounties, one("SELECT COUNT(*) FROM bounties WHERE game = ? AND character = ? AND status = 'completed' AND completed_time BETWEEN ? AND ?", ...who, from, now), `${id} bounties`);
      const inc = buildIncome(conn, id, range, { now });
      const sale = (type) => one("SELECT SUM(amount) FROM silver_events WHERE game = ? AND character = ? AND source_category = 'sale' AND vendor_type = ? AND timestamp BETWEEN ? AND ?", ...who, type, from, now);
      const src = (key) => inc.sources.find((s) => s.key === key)?.amount ?? 0;
      assert.equal(src('gems'), sale('gemshop'), `${id} gems`);
      assert.equal(src('furs'), sale('furrier'), `${id} furs`);
      assert.equal(src('floor'), one("SELECT SUM(amount) FROM silver_events WHERE game = ? AND character = ? AND source_category = 'floor' AND timestamp BETWEEN ? AND ?", ...who, from, now), `${id} floor`);
      assert.equal(src('creatures'), one('SELECT SUM(total_silver) FROM kill_stats WHERE game = ? AND character = ? AND date BETWEEN ? AND ?', ...who, ...days), `${id} creature coins`);
      assert.equal(inc.total_out, one("SELECT SUM(amount) FROM silver_events WHERE game = ? AND character = ? AND source_category = 'expense' AND timestamp BETWEEN ? AND ?", ...who, from, now), `${id} spent`);
      const cb = buildCombat(conn, id, range, { now });
      assert.equal(cb.damage, one('SELECT SUM(damage) FROM combat_stats WHERE game = ? AND character = ? AND start_time BETWEEN ? AND ?', ...who, from, now), `${id} damage`);
      const offers = buildBounties(conn, id, range, { now }).offers;
      for (const row of conn.all('SELECT outcome, COUNT(*) AS n FROM bounty_offers WHERE game = ? AND character = ? AND offered_at BETWEEN ? AND ? GROUP BY 1', ...who, from, now)) {
        assert.equal(offers.by_outcome[row.outcome], row.n, `${id} offers ${row.outcome}`);
      }
      assert.equal(offers.offered, one('SELECT COUNT(*) FROM bounty_offers WHERE game = ? AND character = ? AND offered_at BETWEEN ? AND ?', ...who, from, now), `${id} offers`);
    }
  });
}

test('the crash the script found shows on that day, as a crash only', () => {
  const crash = conn.one("SELECT character, start_time FROM cycles WHERE rest_reason = 'crashed'");
  const at = crash.start_time + 3 * 3600;
  const char = buildOverview(conn, { now: at }).characters.find((c) => c.id === `GS3:${crash.character}`);
  assert.equal(char.crashes.length, 1);
  assert.equal(char.light.reasons.filter((r) => /crash/.test(r.text)).length, 1);
  assert.deepEqual(char.crashes.map((x) => x.reason), ['crashed']);
});
