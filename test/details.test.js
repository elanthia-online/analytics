// The character detail pages (aggregate/details.js). These figures are new,
// with no Ruby golden output, so each is checked against an independent
// query of the fixture, or against a small database built here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { Conn } from '../site/js/db.js';
import { buildIncome, buildHunting, buildBounties, buildHistory, buildDaily, buildProgress } from '../site/js/aggregate/index.js';
import { CAP_EXP, EXP_FOR_LEVEL, levelOf, buildReconciliation, buildCompare, targetEta, DETAIL_RANGES } from '../site/js/aggregate/details.js';
import { rangeFromArg } from '../site/js/aggregate/report.js';
import { windowDay, clockSeconds, dayOf, addDays, dayStr, midnight, dateOf } from '../site/js/aggregate/time.js';

const SQL = await initSqlJs();
const golden = JSON.parse(readFileSync(new URL('fixtures/afternoon.json', import.meta.url)));
const now = golden.now;
const db = new SQL.Database(readFileSync(new URL('fixtures/afternoon.db', import.meta.url)));
const conn = new Conn(db);
const ID = 'GS3:Splinter';
const W = ['GS3', 'Splinter'];
const one = (sql, ...p) => conn.one(sql, ...p);

test('income: every silver event in the window, plus coins searched from creatures', () => {
  for (const range of ['daily', 'weekly', 'monthly']) {
    const from = rangeFromArg(range, now)[1];
    const inc = buildIncome(conn, ID, range, { now });
    const events = one("SELECT SUM(amount) AS s FROM silver_events WHERE game = ? AND character = ? AND source_category <> 'expense' AND timestamp >= ? AND timestamp <= ?", ...W, from, now).s ?? 0;
    const spent = one("SELECT SUM(amount) AS s FROM silver_events WHERE game = ? AND character = ? AND source_category = 'expense' AND timestamp >= ? AND timestamp <= ?", ...W, from, now).s ?? 0;
    const coins = one('SELECT SUM(total_silver) AS s FROM kill_stats WHERE game = ? AND character = ? AND date >= ? AND date <= ?',
      ...W, windowDay(from), new Date(now * 1000).toLocaleDateString('sv')).s ?? 0;
    assert.equal(inc.total_in, events + coins, `${range}: in`);
    assert.equal(inc.total_out, spent, `${range}: out`);
    assert.equal(inc.net, inc.total_in - inc.total_out);
    assert.equal(inc.sources.reduce((a, s) => a + s.amount, 0), inc.total_in);
  }
  const month = buildIncome(conn, ID, 'monthly', { now });
  assert.deepEqual(month.sources.map((s) => s.key), ['creatures', 'gems', 'furs', 'pawn', 'boxes', 'bounties'], 'a fixed order');
  assert.ok(month.items.length > 0 && month.items.every((i, n, all) => n === 0 || all[n - 1].silver >= i.silver), 'items by silver');
  const visits = one('SELECT COUNT(*) AS n, SUM(duration_seconds) AS s FROM vendor_visits WHERE game = ? AND character = ? AND start_time >= ?', ...W, month.from);
  assert.equal(month.shops.reduce((a, s) => a + s.visits, 0), visits.n);
  assert.equal(month.shops.reduce((a, s) => a + s.seconds, 0), visits.s);
  assert.deepEqual(month.towns.map((t) => t.town), ["Wehnimer's Landing"]);
});

test('hunting: kills, silver and boxes per creature add up to the table', () => {
  const from = rangeFromArg('monthly', now)[1];
  const h = buildHunting(conn, ID, 'monthly', { now });
  const t = one('SELECT SUM(kill_count) AS k, SUM(total_silver) AS s, SUM(boxes) AS b, COUNT(DISTINCT creature) AS c FROM kill_stats WHERE game = ? AND character = ? AND date >= ?',
    ...W, new Date(from * 1000).toLocaleDateString('sv'));
  assert.deepEqual([h.kills, h.silver, h.boxes, h.creatures.length], [t.k, t.s, t.b, t.c]);
  for (const c of h.creatures) assert.equal(c.silver_per_kill, Math.round(c.silver / c.kills));
});

test('bounties: counted by type, with success, time and rewards for the completed ones', () => {
  const from = rangeFromArg('monthly', now)[1];
  const b = buildBounties(conn, ID, 'monthly', { now });
  const n = one('SELECT COUNT(*) AS n, SUM(status = ?) AS c, SUM(bp_reward) AS p FROM bounties WHERE game = ? AND character = ? AND received_time >= ? AND received_time <= ?',
    'completed', ...W, from, now);
  assert.equal(b.all.received, n.n);
  assert.equal(b.all.completed, n.c);
  assert.equal(b.all.points, n.p ?? 0);
  assert.equal(b.types.reduce((a, t) => a + t.received, 0), n.n);
  // the endings and the time to complete, from SQL rather than the function's own counts
  const e = one("SELECT SUM(status = 'abandoned') AS a, SUM(status = 'expired') AS x, " +
    "AVG(CASE WHEN status = 'completed' THEN MAX(0, completed_time - received_time) END) AS t FROM bounties " +
    'WHERE game = ? AND character = ? AND received_time >= ? AND received_time <= ?', ...W, from, now);
  assert.equal(b.all.abandoned, e.a ?? 0);
  assert.equal(b.all.expired, e.x ?? 0);
  assert.ok(b.all.abandoned + b.all.expired > 0, 'the fixture has bounties that did not complete');
  assert.equal(b.all.avg_seconds, Math.round(e.t));
  assert.equal(b.all.success_pct, Math.round(n.c * 100 / (n.c + (e.a ?? 0) + (e.x ?? 0))));
  assert.ok(b.offers && b.offers.offered >= 0);
});

test('history: newest first, every cycle in the window, gains never negative', () => {
  const from = rangeFromArg('weekly', now)[1];
  const h = buildHistory(conn, ID, 'weekly', { now });
  const n = one('SELECT COUNT(*) AS n FROM cycles WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ?', ...W, from, now).n;
  assert.equal(h.cycles.length, Math.min(n, 400));
  assert.ok(h.cycles.every((c, i, all) => i === 0 || all[i - 1].start >= c.start));
  assert.ok(h.cycles.every((c) => c.exp == null || c.exp >= 0));
});

test('daily: 28 days ending today, adding up to the cycles that started in them', () => {
  const d = buildDaily(conn, [ID, 'GS3:April'], { now });
  assert.equal(d.labels.length, 28);
  assert.equal(d.labels.at(-1), new Date(now * 1000).toLocaleDateString('sv'));
  const from = Math.floor(new Date(`${d.labels[0]}T00:00:00`).getTime() / 1000);
  const t = one('SELECT SUM(MAX(0, exp_total_end - exp_total_start)) AS e, SUM(MAX(0, exp_asc_end - exp_asc_start)) AS a FROM cycles WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ? AND exp_total_end IS NOT NULL', ...W, from, now);
  const sum = (xs) => xs.reduce((a, v) => a + v, 0);
  assert.equal(sum(d.series[ID].exp), t.e);
  assert.equal(sum(d.series[ID].ascension), t.a);
  assert.ok(d.series[ID].regular.every((v, i) => v + d.series[ID].ascension[i] === d.series[ID].exp[i]));
});

test('progress, before the cap: level and the share of it done, from the last row', () => {
  const p = buildProgress(conn, ID, { now });
  const last = one('SELECT level, exp FROM progress WHERE game = ? AND character = ? ORDER BY timestamp DESC LIMIT 1', ...W);
  assert.equal(p.available, true);
  assert.equal(p.level, last.level);
  assert.equal(levelOf(last.exp), last.level);
  assert.equal(p.capped, false);
  assert.equal(p.next_level.to_next, EXP_FOR_LEVEL[last.level + 1] - last.exp);
  // the latest RESOURCE reading (schema 10), wherever it is
  const r = one('SELECT timestamp, resource_name, resource_weekly, resource_total, suffused FROM progress WHERE game = ? AND character = ? ' +
    'AND resource_name IS NOT NULL AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1', ...W, now);
  assert.deepEqual(p.resource && [p.resource.at, p.resource.name, p.resource.weekly, p.resource.total, p.resource.suffused],
    [r.timestamp, r.resource_name, r.resource_weekly, r.resource_total, r.suffused]);
});

// A small schema 9 database, built here: one capped character. Readings
// (fame, deeds, long-term exp, Death's Sting) only on the rows an EXPERIENCE
// reading came before, training points only once, and a None row when the
// sting faded, as the script writes them.
function capped() {
  const d = new SQL.Database();
  d.run(`CREATE TABLE progress (game TEXT, character TEXT, timestamp INTEGER, level INTEGER, exp INTEGER, ascension_exp INTEGER,
    until_next INTEGER, fame INTEGER, deeds INTEGER, long_term_exp INTEGER, deaths_sting TEXT, ptp INTEGER, mtp INTEGER, atp INTEGER,
    lumnis INTEGER, rpa REAL, fashlonae INTEGER, PRIMARY KEY (game, character, timestamp)) WITHOUT ROWID`);
  d.run('CREATE TABLE cycles (cycle_id TEXT, game TEXT, character TEXT, cycle_type TEXT, start_time INTEGER, end_time INTEGER)');
  const t0 = 1_800_000_000;
  const row = (dt, exp, axp, lumnis, r = {}) => d.run('INSERT INTO progress VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['GS3', 'Rocksteady', t0 + dt, 100, exp, axp, null, r.fame ?? null, r.deeds ?? null, r.lte ?? null, r.sting ?? null,
      r.ptp ?? null, r.mtp ?? null, r.atp ?? null, lumnis, null, null]);
  const died = (end) => d.run("INSERT INTO cycles VALUES (?, 'GS3', 'Rocksteady', 'dead', ?, ?)", [`d${end}`, t0 + end - 300, t0 + end]);
  row(0, CAP_EXP + 10_000, 120_000, 1, { fame: 1000, deeds: 5, lte: 10, sting: 'None', ptp: 36, mtp: 0, atp: 6 });
  died(86400 - 3600);                                                  // a death, an hour before EXPERIENCE shows its sting
  row(86400, CAP_EXP + 20_000, 130_000, 1, { fame: 1100, deeds: 5, lte: 12, sting: 'Light' });
  row(2 * 86400, CAP_EXP + 25_000, 135_000, null);                     // the hourly heartbeat: no readings
  row(3 * 86400, CAP_EXP + 30_500, 140_000, null, { sting: 'None' });  // the sting faded
  died(3 * 86400 + 600);                                               // died again; it faded before any EXPERIENCE
  row(3 * 86400 + 4200, CAP_EXP + 30_500, 140_000, null, { sting: 'None' });
  died(3 * 86400 + 5000);                                              // and again, with nothing after it yet
  return { conn: new Conn(d), now: t0 + 3 * 86400 + 6000, close: () => d.close() };
}

test('progress, past the cap: training points from regular experience, ATPs from ascension, ETAs at the recent pace', () => {
  const c = capped();
  try {
    const p = buildProgress(c.conn, 'GS3:Rocksteady', { now: c.now });
    assert.equal(p.capped, true);
    assert.deepEqual([p.tp.earned, p.tp.to_next, p.tp.pct], [12, 2000, 20]); // 30,500 past the cap = 12 TPs + 500
    assert.deepEqual([p.atp.earned, p.atp.to_next], [2, 10_000]); // 140,000 = 2 ATPs + 40,000
    assert.equal(p.pace.days, 7);
    const days = (3 * 86400 + 4200) / 86400; // first row to the last
    assert.equal(p.pace.exp_per_day, Math.round(20_500 / days));
    assert.equal(p.tp.eta, Math.round(2000 / (20_500 / days) * 86400));
    // the latest reading of each, wherever it is
    assert.deepEqual(p.unspent, { ptp: 36, mtp: 0, atp: 6, at: 1_800_000_000 });
    assert.deepEqual([p.fame, p.deeds, p.long_term_exp, p.read_at], [1100, 5, 12, 1_800_000_000 + 86400]);
    assert.deepEqual([p.deaths_sting, p.sting_at], ['None', 1_800_000_000 + 3 * 86400 + 4200]);
    // from the death (the dead cycle's start, 300 s before it ended) to the None; a heartbeat
    // with no reading doesn't end it; a sting never read has no level; a death with nothing after it isn't shown
    assert.deepEqual(p.stings.map((s) => [s.level, s.seconds]), [[null, 3900], ['Light', 2 * 86400 + 3900]]);
    assert.equal(p.resource, null, 'a database without the RESOURCE columns: none');
    // Each step's gain counts toward Lumnis when the row before it had Lumnis active:
    // 20,000 (after row 0, active) + 10,000 (after row 1, active) of 20,000 + 10,000 + 10,500
    assert.equal(p.lumnis_share, Math.round(30_000 * 100 / 40_500));
  } finally {
    c.close();
  }
});

test('longer ranges: this year and all time hold at least the month', () => {
  assert.deepEqual(Object.keys(DETAIL_RANGES), ['daily', 'weekly', 'monthly', 'ytd', 'total']);
  const month = buildIncome(conn, ID, 'monthly', { now }), year = buildIncome(conn, ID, 'ytd', { now }), all = buildIncome(conn, ID, 'total', { now });
  assert.equal(all.label, 'All Time');
  assert.ok(year.total_in >= month.total_in && all.total_in >= year.total_in);
  const events = one("SELECT SUM(amount) AS s FROM silver_events WHERE game = ? AND character = ? AND source_category <> 'expense'", ...W).s;
  const coins = one('SELECT SUM(total_silver) AS s FROM kill_stats WHERE game = ? AND character = ? AND date <= ?', ...W, new Date(now * 1000).toLocaleDateString('sv')).s;
  assert.equal(all.total_in, events + coins);
});

test('bank reconciliation: every listing that found the total off, and by how much', () => {
  const r = buildReconciliation(conn, ID, 'total', { now });
  const t = one("SELECT COUNT(*) AS n, SUM(delta_silver) AS s, SUM(ABS(delta_silver)) AS a FROM bank_snapshots WHERE game = ? AND character = ? AND bank_name = '__total__' " +
    "AND snapshot_type NOT IN ('deposit', 'withdraw') AND delta_silver IS NOT NULL AND delta_silver <> 0 AND timestamp <= ?", ...W, now);
  assert.deepEqual([r.checks.length, r.off, r.apart], [t.n, t.s ?? 0, t.a ?? 0]);
  assert.ok(r.checks.length > 0, 'the fixture has listings that were off');
  assert.ok(r.checks.every((c, i, all) => i === 0 || all[i - 1].at >= c.at), 'newest first');
  assert.ok(r.listings >= r.checks.length);
});

test('compare: each character\'s own figures, side by side, every field', () => {
  const ids = [ID, 'GS3:April'];
  const c = buildCompare(conn, ids, 'monthly', { now });
  for (const id of ids) {
    const inc = buildIncome(conn, id, 'monthly', { now }), h = buildHunting(conn, id, 'monthly', { now }), b = buildBounties(conn, id, 'monthly', { now });
    const mine = (list) => list.filter((r) => r.id === id).map(({ id: _, ...rest }) => rest);
    assert.deepEqual(mine(c.shops), inc.shops, `${id} shops`);
    assert.deepEqual(mine(c.towns), inc.towns, `${id} towns`);
    assert.deepEqual(mine(c.creatures), h.creatures, `${id} creatures`);
    assert.deepEqual(mine(c.bounties), b.types, `${id} bounties`);
    const top = [...inc.sources].sort((x, y) => y.amount - x.amount)[0]?.label ?? null;
    assert.deepEqual(mine(c.income), [{ total_in: inc.total_in, total_out: inc.total_out, net: inc.net, top }], `${id} income`);
    assert.ok(inc.shops.length && h.creatures.length && b.types.length, `${id} has something in each`);
  }
  assert.equal(c.characters, ids.length);
  assert.equal(buildCompare(conn, ids, 'ytd', { now }).label, 'This Year', 'never "YTD"');
});

test('bank checks: only listings, never the deposits and withdrawals, of the types the script writes', () => {
  const d = new SQL.Database();
  d.run('CREATE TABLE bank_snapshots (game TEXT, character TEXT, timestamp INTEGER, bank_name TEXT, balance INTEGER, delta_silver INTEGER, snapshot_type TEXT, cycle_id TEXT)');
  const rows = [['bank_account', 50], ['baseline', -20], ['rest_cycle', 7], ['deposit', 1000], ['withdraw', -400], ['bank_account', 0]];
  rows.forEach(([type, delta], i) => d.run("INSERT INTO bank_snapshots VALUES ('GS3', 'Splinter', ?, '__total__', 5000, ?, ?, NULL)", [now - 3600 + i, delta, type]));
  try {
    const r = buildReconciliation(new Conn(d), ID, 'daily', { now });
    assert.deepEqual(r.checks.map((x) => x.type).sort(), ['bank_account', 'baseline', 'rest_cycle']);
    assert.deepEqual([r.off, r.apart, r.listings], [37, 77, 4]);
  } finally {
    d.close();
  }
});

test('targets: how far, and when at the recent pace', () => {
  const pre = buildProgress(conn, ID, { now });
  const lv = targetEta(pre, { kind: 'level', value: pre.level + 2 });
  assert.equal(lv.need, EXP_FOR_LEVEL[pre.level + 2] - pre.exp);
  assert.equal(lv.eta, Math.round(lv.need / pre.pace.exp_per_day * 86400));
  assert.equal(targetEta(pre, { kind: 'level', value: pre.level }).reached, true);
  // The bar counts from where the character stood when the target was set
  const from = pre.exp - 1000;
  const half = targetEta(pre, { kind: 'level', value: pre.level + 2, from });
  assert.equal(half.pct, Math.round(1000 * 1000 / (EXP_FOR_LEVEL[pre.level + 2] - from)) / 10);
  // and without one, from the start of the current level
  const noFrom = targetEta(pre, { kind: 'level', value: pre.level + 1 });
  assert.equal(noFrom.pct, pre.next_level.pct);
  assert.equal(targetEta(pre, { kind: 'level', value: 101 }), null);
  assert.equal(targetEta(pre, { kind: 'level', value: 'abc' }), null);
  assert.equal(targetEta(pre, { kind: 'nope', value: 5 }), null);
  const c = capped();
  try {
    const p = buildProgress(c.conn, 'GS3:Rocksteady', { now: c.now });
    const tp = targetEta(p, { kind: 'tp', value: 20 });
    assert.equal(tp.need, CAP_EXP + 20 * 2500 - p.exp); // 50,000 - 30,500
    assert.equal(tp.need, 19_500);
    assert.equal(tp.eta, Math.round(19_500 / p.pace.exp_per_day * 86400));
    const atp = targetEta(p, { kind: 'atp', value: 3 });
    assert.equal(atp.need, 10_000);
    assert.equal(atp.eta, Math.round(10_000 / p.pace.asc_per_day * 86400));
  } finally {
    c.close();
  }
});

test('an older database without the new tables gives empty pages, not errors', () => {
  const d = new SQL.Database();
  d.run('CREATE TABLE cycles (cycle_id TEXT, game TEXT, character TEXT, cycle_type TEXT, start_time INTEGER, end_time INTEGER, duration_seconds INTEGER, rest_reason TEXT, profile TEXT, exp_total_start INTEGER, exp_total_end INTEGER, fame_start INTEGER, fame_end INTEGER)');
  d.run('CREATE TABLE bounties (game TEXT, character TEXT, bounty_type TEXT, status TEXT, received_time INTEGER, completed_time INTEGER, silver_reward INTEGER, exp_reward INTEGER)');
  const c = new Conn(d);
  try {
    assert.equal(buildProgress(c, ID, { now }).available, false);
    assert.deepEqual(buildIncome(c, ID, 'weekly', { now }).sources, []);
    assert.deepEqual(buildHunting(c, ID, 'weekly', { now }).creatures, []);
    assert.equal(buildDaily(c, [ID], { now }).split, false);
    assert.equal(buildBounties(c, ID, 'weekly', { now }).all.received, 0);
  } finally {
    d.close();
  }
});

test.after(() => db.close());

test('Dashboard.details answers only the known pages, whatever the URL says', async () => {
  const { Dashboard } = await import('../site/js/data.js');
  const dash = new Dashboard(SQL);
  dash.conn = conn; dash.source = { live: false }; dash.asOf = now;
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'summary', 'nope', '']) {
    assert.equal(dash.details(ID, name, 'daily'), null, name);
  }
  assert.ok(dash.details(ID, 'income', 'daily').sources);
  assert.ok(dash.details(ID, 'progress', 'daily').progress.available);
});

test('a character off the overview (not played in the last day) still has a page', async () => {
  const { buildOverview, buildCharacter } = await import('../site/js/aggregate/index.js');
  const overview = buildOverview(conn, { now });
  assert.ok(!overview.names.includes('GS3:Raphael'), 'the fixture leaves Raphael off the overview');
  const last = one("SELECT MAX(COALESCE(end_time, start_time)) AS t FROM cycles WHERE game = 'GS3' AND character = 'Raphael'").t;
  const char = buildCharacter(conn, overview, 'gs3:raphael', 'weekly', { now });
  assert.equal(char.id, 'GS3:Raphael');
  assert.equal(char.state.type, 'offline');
  assert.equal(char.state.since, last, 'last seen at its last cycle, however old');
  assert.equal(buildCharacter(conn, overview, 'GS3:Nobody', 'daily', { now }), null);
});

test('DST: date-keyed windows start on the day they mean; the pace cut-off is the wall clock', () => {
  // the Wednesday after spring-forward: the week's seconds start an hour early, the evening before
  const spring = Math.floor(new Date(2027, 2, 17, 15).getTime() / 1000);
  const from = rangeFromArg('weekly', spring)[1];
  assert.equal(dateOf(from), '2027-03-10');
  assert.equal(windowDay(from), '2027-03-11');
  assert.equal(windowDay(rangeFromArg('monthly', spring)[1]), dayStr(addDays(dayOf(spring), -29)));
  // and after fall-back (the fixture's week) an hour late, the same day
  assert.equal(windowDay(rangeFromArg('weekly', now)[1]), dayStr(addDays(dayOf(now), -6)));
  // 15:00 on the 25-hour fall-back day is 16 hours after midnight, 15 on the clock
  const fallBack = Math.floor(new Date(2026, 10, 1, 15).getTime() / 1000);
  assert.equal(fallBack - midnight(dayOf(fallBack)), 16 * 3600);
  assert.equal(clockSeconds(fallBack), 15 * 3600);
});

test('DST: on the fall-back day, pace compares the same wall-clock hours', async () => {
  const { buildOverview } = await import('../site/js/aggregate/index.js');
  const d = new SQL.Database(readFileSync(new URL('fixtures/afternoon.db', import.meta.url)));
  for (const [name] of d.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values) d.run(`DELETE FROM "${name}"`);
  const at = (day, h, m = 0) => Math.floor(new Date(2026, 9, day, h, m).getTime() / 1000);
  let exp = 0;
  const hunt = (from, to, gain) => {
    d.run("INSERT INTO cycles (cycle_id, game, character, cycle_type, start_time, end_time, duration_seconds, exp_total_start, exp_total_end) VALUES (?, 'GS3', 'April', 'hunt', ?, ?, ?, ?, ?)",
      [`c${from}`, from, to, to - from, exp, exp += gain]);
  };
  for (let day = 20; day <= 32; day++) {           // Oct 20 .. Nov 1 (day 32), the 25-hour day
    hunt(at(day, 10), at(day, 14), 1000);
    if (day < 32) hunt(at(day, 15, 10), at(day, 15, 50), 500);   // done after 15:00 on the clock
  }
  const now = at(32, 15);                            // 15:00 on Nov 1, 16 hours after midnight
  const char = buildOverview(new Conn(d), { now }).characters.find((c) => c.id === 'GS3:April');
  assert.equal(char.pace.exp.typical_now, 1000, 'baseline days count only what was done before 15:00');
  assert.equal(char.pace.exp.pct, 0);
  d.close();
});

test('history: an open cycle past the stale cap ended at an unknown time (#31)', () => {
  const d = new SQL.Database();
  d.run('CREATE TABLE cycles (cycle_id TEXT, game TEXT, character TEXT, cycle_type TEXT, start_time INTEGER, end_time INTEGER, duration_seconds INTEGER, rest_reason TEXT, profile TEXT, exp_total_start INTEGER, exp_total_end INTEGER, fame_start INTEGER, fame_end INTEGER)');
  d.run("INSERT INTO cycles (cycle_id, game, character, cycle_type, start_time) VALUES ('old', 'GS3', 'Splinter', 'hunt', ?), ('new', 'GS3', 'Splinter', 'rest', ?)",
    [now - 3 * 3600, now - 600]);
  try {
    const [fresh, crashed] = buildHistory(new Conn(d), ID, 'daily', { now }).cycles;
    assert.deepEqual([fresh.stale, fresh.seconds], [false, 600], 'still going');
    assert.deepEqual([crashed.stale, crashed.seconds, crashed.end], [true, null, null], 'no duration that grows');
  } finally {
    d.close();
  }
});

test('a hunt stopped by hand is not a crash; the old unhandled exit still is (#25)', async () => {
  const { buildOverview } = await import('../site/js/aggregate/index.js');
  const d = new SQL.Database(readFileSync(new URL('fixtures/afternoon.db', import.meta.url)));
  for (const [name] of d.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values) d.run(`DELETE FROM "${name}"`);
  const crashes = (reason) => {
    d.run('DELETE FROM cycles');
    d.run("INSERT INTO cycles (cycle_id, game, character, cycle_type, start_time, end_time, duration_seconds, rest_reason) VALUES ('h', 'GS3', 'April', 'hunt', ?, ?, 1800, ?)",
      [now - 3600, now - 1800, reason]);
    const char = buildOverview(new Conn(d), { now }).characters.find((c) => c.id === 'GS3:April');
    return char.light.reasons.filter((r) => /crash/.test(r.text)).length;
  };
  try {
    assert.equal(crashes('hunt stopped'), 0);
    assert.equal(crashes('unhandled exit'), 1);
  } finally {
    d.close();
  }
});

test('alerts: without settings the Ruby shape; with them each has a kind, can be turned off, re-thresholded or dismissed', async () => {
  const { buildOverview } = await import('../site/js/aggregate/index.js');
  const { ALERT_DEFAULTS, alertSettings } = await import('../site/js/aggregate/overview.js');
  const plain = buildOverview(conn, { now });
  assert.ok(plain.alerts.length > 0 && plain.alerts.every((a) => !('kind' in a)), 'the golden shape, untouched');
  const kinds = buildOverview(conn, { now, alerts: {} });
  assert.deepEqual(kinds.alerts.map((a) => a.text), plain.alerts.map((a) => a.text), 'the same alerts at the defaults');
  assert.ok(kinds.alerts.every((a) => Object.hasOwn(ALERT_DEFAULTS, a.kind)), 'each names its kind');
  // dismissed for today: gone from the list and the card, and the light follows
  const first = kinds.alerts[0];
  const less = buildOverview(conn, { now, alerts: {}, dismissed: [`${first.id}\u0000${first.kind}`] });
  assert.equal(less.alerts.length, kinds.alerts.filter((a) => !(a.id === first.id && a.kind === first.kind)).length);
  const char = less.characters.find((c) => c.id === first.id);
  assert.ok(char.light.reasons.every((r) => r.kind !== first.kind));
  assert.equal(char.light.level, char.light.reasons.some((r) => r.level === 'red') ? 'red' : char.light.reasons.length ? 'amber' : char.state.type === 'offline' ? 'gray' : 'green');
  // a kind turned off, and a threshold that moves an alert
  const off = buildOverview(conn, { now, alerts: { [first.kind]: false } });
  assert.ok(off.alerts.every((a) => a.kind !== first.kind));
  const idle = kinds.alerts.find((a) => a.kind === 'idle');
  assert.ok(idle, 'the fixture has an idle alert');
  const mins = Number(idle.text.match(/(\d+) min/)[1]);
  assert.ok(!buildOverview(conn, { now, alerts: { idle_minutes: mins + 1 } }).alerts.some((a) => a.kind === 'idle' && a.id === idle.id));
  // only known keys of the right type are taken
  assert.deepEqual(alertSettings({ idle: 'no', idle_minutes: -3, bogus: true, mind_pct: 80 }), { ...ALERT_DEFAULTS, mind_pct: 80 });
});
