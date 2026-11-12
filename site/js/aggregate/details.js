// The character detail pages: income, hunting, bounties, history and
// progress, plus experience by day. Pure functions of (conn, ..., now), like
// the rest of aggregate/. These are new figures, not ports of the Ruby
// dashboard: test/details.test.js checks them against independent queries.
//
// Every function copes with an older database: a missing table or column
// gives an empty section, never an error.
import { toI } from './ruby.js';
import { dayOf, addDays, midnight, dayStr, dateOf, windowDay } from './time.js';
import { rangeFromArg, parseWho, shortProfile } from './report.js';
import { STALE_OPEN } from './overview.js';

export const SECTIONS = ['summary', 'income', 'hunting', 'bounties', 'progress', 'history'];

// The game's total experience for each level, 0 to 100 (gswiki,
// "Experience per level", as the in-game "Next lvl" confirms)
export const EXP_FOR_LEVEL = [
  0, 2500, 5000, 10000, 17500, 27500, 40000, 55000, 72500, 92500,
  115000, 140000, 167000, 197500, 230000, 265000, 302000, 341000, 382000, 425000,
  470000, 517000, 566000, 617000, 670000, 725000, 781500, 839500, 899000, 960000,
  1022500, 1086500, 1152000, 1219000, 1287500, 1357500, 1429000, 1502000, 1576500, 1652500,
  1730000, 1808500, 1888000, 1968500, 2050000, 2132500, 2216000, 2300500, 2386000, 2472500,
  2560000, 2648000, 2736500, 2825500, 2915000, 3005000, 3095500, 3186500, 3278000, 3370000,
  3462500, 3555500, 3649000, 3743000, 3837500, 3932500, 4028000, 4124000, 4220500, 4317500,
  4415000, 4513000, 4611500, 4710500, 4810000, 4910000, 5010500, 5111500, 5213000, 5315000,
  5417500, 5520500, 5624000, 5728000, 5832500, 5937500, 6043000, 6149000, 6255500, 6362500,
  6470000, 6578000, 6686500, 6795500, 6905000, 7015000, 7125500, 7236500, 7348000, 7460000,
  7572500,
];
export const CAP_EXP = EXP_FOR_LEVEL[100];
export const EXP_PER_TP = 2500; // past the cap: 1 PTP and 1 MTP per 2,500 regular experience
export const ASC_PER_ATP = 50000;

const columns = new WeakMap();
function hasColumn(conn, table, column) {
  if (!columns.has(conn)) columns.set(conn, new Map());
  const cache = columns.get(conn);
  if (!cache.has(table)) {
    cache.set(table, conn.tableExists(table) ? new Set(conn.all(`PRAGMA table_info(${table})`).map((row) => row.name)) : new Set());
  }
  return cache.get(table).has(column);
}
const hasTable = (conn, table) => hasColumn(conn, table, 'game');

function window(range, now, ranges) {
  const [label, from] = rangeFromArg(range, now, ranges) || rangeFromArg('daily', now, ranges);
  return { label, from };
}

// ---- income -------------------------------------------------------------------

// Where silver came from, in a fixed order (each keeps its colour), then what was spent
const SOURCES = [
  ['gems', 'Gems', (r) => r.source_category === 'sale' && /jewel|gem/i.test(r.vendor_type || '')],
  ['furs', 'Skins and furs', (r) => r.source_category === 'sale' && /furr/i.test(r.vendor_type || '')],
  // From schema 9 a sale's vendor_type is the shop's room tag (consignment, not
  // the clerk's "pawnbroker"); before, the first word of the sale line
  ['consign', 'Consignment', (r) => r.source_category === 'sale' && /consign/i.test(r.vendor_type || '')],
  ['pawn', 'Pawnshop', (r) => r.source_category === 'sale' && /pawn/i.test(r.vendor_type || '')],
  ['alchemy', 'Alchemy and herbs', (r) => r.source_category === 'sale' && /alchem|herb/i.test(r.vendor_type || '')],
  ['sales', 'Other sales', (r) => r.source_category === 'sale'],
  ['boxes', 'Box coins', (r) => r.source_category === 'box'],
  ['floor', 'Coins off the floor', (r) => r.source_category === 'floor'], // schema 10
  ['bounties', 'Bounty rewards', (r) => r.source_category === 'bounty'],
];

export function buildIncome(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  const out = { label, from, sources: [], expenses: [], items: [], shops: [], towns: [], total_in: 0, total_out: 0, net: 0 };
  const creature = hasTable(conn, 'kill_stats')
    ? toI(conn.one('SELECT SUM(total_silver) AS s FROM kill_stats WHERE game = ? AND character = ? AND date >= ? AND date <= ?',
      ...who, windowDay(from), dateOf(now)).s)
    : 0;
  const sums = new Map(SOURCES.map(([key, name]) => [key, { key, label: name, amount: 0, count: 0 }]));
  if (hasTable(conn, 'silver_events')) {
    const rows = conn.all('SELECT source_category, vendor_type, amount FROM silver_events WHERE game = ? AND character = ? ' +
      'AND timestamp >= ? AND timestamp <= ?', ...who, from, now);
    const spent = new Map();
    for (const r of rows) {
      if (r.source_category === 'expense') {
        const kind = r.vendor_type || 'other';
        const e = spent.get(kind) || { kind, amount: 0, count: 0 };
        e.amount += toI(r.amount); e.count += 1; spent.set(kind, e);
        continue;
      }
      const match = SOURCES.find(([, , test]) => test(r));
      if (!match) continue;
      const s = sums.get(match[0]);
      s.amount += toI(r.amount); s.count += 1;
    }
    out.expenses = [...spent.values()].sort((a, b) => b.amount - a.amount);
  }
  out.sources = [{ key: 'creatures', label: 'Coins on creatures', amount: creature, count: null }, ...sums.values()]
    .filter((s) => s.amount > 0);
  out.total_in = out.sources.reduce((a, s) => a + s.amount, 0);
  out.total_out = out.expenses.reduce((a, s) => a + s.amount, 0);
  out.net = out.total_in - out.total_out;

  if (hasTable(conn, 'item_sales')) {
    out.items = conn.all('SELECT item_name AS item, COUNT(*) AS n, SUM(total_price) AS silver, MAX(vendor_type) AS vendor ' +
      'FROM item_sales WHERE game = ? AND character = ? AND timestamp >= ? AND timestamp <= ? ' +
      'GROUP BY item_name ORDER BY silver DESC, item_name LIMIT 12', ...who, from, now)
      .map((r) => ({ item: r.item, count: toI(r.n), silver: toI(r.silver), each: Math.round(toI(r.silver) / Math.max(1, toI(r.n))), vendor: r.vendor }));
  }
  if (hasTable(conn, 'vendor_visits')) {
    const town = hasColumn(conn, 'vendor_visits', 'town'), spent = hasColumn(conn, 'vendor_visits', 'spent');
    const rows = conn.all(`SELECT vendor, ${town ? 'town' : 'NULL AS town'}, COUNT(*) AS n, SUM(duration_seconds) AS secs, ` +
      `SUM(silver) AS silver, ${spent ? 'SUM(spent)' : '0'} AS spent FROM vendor_visits WHERE game = ? AND character = ? ` +
      'AND start_time >= ? AND start_time <= ? GROUP BY vendor, town', ...who, from, now);
    const byShop = new Map(), byTown = new Map();
    for (const r of rows) {
      const s = byShop.get(r.vendor) || { vendor: r.vendor, visits: 0, seconds: 0, silver: 0, spent: 0 };
      s.visits += toI(r.n); s.seconds += toI(r.secs); s.silver += toI(r.silver); s.spent += toI(r.spent);
      byShop.set(r.vendor, s);
      if (r.town) {
        const t = byTown.get(r.town) || { town: r.town, visits: 0, seconds: 0, silver: 0 };
        t.visits += toI(r.n); t.seconds += toI(r.secs); t.silver += toI(r.silver);
        byTown.set(r.town, t);
      }
    }
    const per = (s) => ({ ...s, avg_seconds: Math.round(s.seconds / Math.max(1, s.visits)),
      per_minute: s.seconds > 0 ? Math.round(s.silver * 60 / s.seconds) : null });
    out.shops = [...byShop.values()].map(per).sort((a, b) => b.seconds - a.seconds);
    out.towns = [...byTown.values()].map(per).sort((a, b) => b.silver - a.silver);
  }
  out.pool = buildPool(conn, id, range, { now, ranges });
  return out;
}

// ---- hunting ------------------------------------------------------------------

export function buildHunting(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  if (!hasTable(conn, 'kill_stats')) return { label, from, creatures: [], kills: 0, boxes: 0, silver: 0, combat: buildCombat(conn, id, range, { now, ranges }) };
  const boxes = hasColumn(conn, 'kill_stats', 'boxes') ? 'SUM(boxes)' : '0';
  const creature = hasColumn(conn, 'kill_stats', 'creature') ? 'creature' : "'creatures'";
  const rows = conn.all(`SELECT ${creature} AS creature, SUM(kill_count) AS kills, SUM(total_silver) AS silver, ${boxes} AS boxes, ` +
    'MAX(last_kill_at) AS last, GROUP_CONCAT(DISTINCT profile) AS profiles FROM kill_stats WHERE game = ? AND character = ? ' +
    'AND date >= ? AND date <= ? GROUP BY 1 ORDER BY kills DESC, 1', ...who, windowDay(from), dateOf(now));
  const creatures = rows.map((r) => {
    const kills = toI(r.kills), silver = toI(r.silver), box = toI(r.boxes);
    return { creature: r.creature, kills, silver, boxes: box, silver_per_kill: kills ? Math.round(silver / kills) : null,
      boxes_per_100: kills ? Math.round(box * 1000 / kills) / 10 : null, last_kill: toI(r.last) || null,
      profiles: String(r.profiles || '').split(',').filter(Boolean).map((p) => shortProfile(p, who[1])) };
  });
  const sum = (k) => creatures.reduce((a, c) => a + c[k], 0);
  return { label, from, creatures, kills: sum('kills'), silver: sum('silver'), boxes: sum('boxes'), combat: buildCombat(conn, id, range, { now, ranges }) };
}

// ---- combat (schema 11) ----------------------------------------------------------

// The recorder names a creature as the game shows it ("cadaverous tatterdemalion
// ghast"); its searched kills say "tatterdemalion ghast". A name takes the
// longest searched name it ends with, so both line up; any other stays as is.
function searchedName(names) {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const seen = new Map();
  return (name) => {
    const full = String(name ?? '').toLowerCase();
    if (!seen.has(full)) seen.set(full, sorted.find((k) => full === k || full.endsWith(' ' + k)) || full || 'unknown');
    return seen.get(full);
  };
}

// What one character did to the creatures it fought in the window, from
// combat_stats (one row per cycle and creature kind): how many it hit, its own
// damage and hits on them, its kills (the killing blow was its own) and
// assists (it hit one someone else finished), and per hour of hunting. A
// cycle counts in the window it started in.
export function buildCombat(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  const out = { label, from, creatures: [], fought: 0, kills: 0, assists: 0, damage: 0, hits: 0, kill_damage: 0, hunt_s: 0 };
  if (!hasTable(conn, 'combat_stats')) return { ...out, recorded: false };
  const names = hasTable(conn, 'kill_stats')
    ? conn.all('SELECT DISTINCT creature FROM kill_stats WHERE game = ? AND character = ?', ...who).map((r) => String(r.creature).toLowerCase())
    : [];
  const nameOf = searchedName(names);
  const by = new Map();
  for (const r of conn.all('SELECT creature, SUM(fought) AS fought, SUM(kills) AS kills, SUM(assists) AS assists, SUM(damage) AS damage, ' +
    'SUM(hits) AS hits, SUM(kill_damage) AS kill_damage FROM combat_stats WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ? ' +
    'GROUP BY creature', ...who, from, now)) {
    const name = nameOf(r.creature);
    if (!by.has(name)) by.set(name, { creature: name, fought: 0, kills: 0, assists: 0, damage: 0, hits: 0, kill_damage: 0 });
    const c = by.get(name);
    for (const k of ['fought', 'kills', 'assists', 'damage', 'hits', 'kill_damage']) c[k] += toI(r[k]);
  }
  const per = (a, b) => (b ? Math.round(a / b) : null);
  out.creatures = [...by.values()].map((c) => ({ ...c, per_creature: per(c.damage, c.fought), per_kill: per(c.kill_damage, c.kills), per_hit: per(c.damage, c.hits) }))
    .sort((a, b) => b.damage - a.damage || a.creature.localeCompare(b.creature));
  for (const k of ['fought', 'kills', 'assists', 'damage', 'hits', 'kill_damage']) out[k] = out.creatures.reduce((a, c) => a + c[k], 0);
  // The hunt still going counts to now (its combat is summed as it goes); one
  // left open long ago by a crash doesn't
  out.hunt_s = toI(conn.one("SELECT SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds WHEN ? - start_time < ? THEN ? - start_time ELSE 0 END) AS s " +
    "FROM cycles WHERE game = ? AND character = ? AND cycle_type = 'hunt' AND start_time >= ? AND start_time <= ?", now, STALE_OPEN, now, ...who, from, now)?.s);
  const hourly = (n) => (out.hunt_s >= 600 ? Math.round(n * 3600 / out.hunt_s) : null);
  return { ...out, recorded: true, per_creature: per(out.damage, out.fought), per_kill: per(out.kill_damage, out.kills), per_hit: per(out.damage, out.hits),
    kills_per_hour: hourly(out.kills), damage_per_hour: hourly(out.damage) };
}

// ---- the locksmith pool (schema 11) ----------------------------------------------

// How many of one character's boxes the locksmith pool holds: the latest list
// whenever it was, and over the window the first and last count, the peak,
// how often it listed them and how many boxes it turned away for being full.
// By town too: the pool is one, game-wide (a list in any town shows every box),
// so the town is only where each list was taken.
export function buildPool(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  const out = { label, from, recorded: false, now: null, towns: [], lists: 0, turned_away: 0, first: null, last: null, peak: null };
  if (!hasTable(conn, 'pool_depth')) return out;
  out.recorded = true;
  const latest = conn.one('SELECT boxes, waiting, town, timestamp FROM pool_depth WHERE game = ? AND character = ? AND full = 0 AND boxes IS NOT NULL ' +
    'AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1', ...who, now);
  if (latest) out.now = { boxes: toI(latest.boxes), waiting: toI(latest.waiting), town: latest.town ?? null, at: toI(latest.timestamp) };
  const rows = conn.all('SELECT timestamp, full, town, boxes FROM pool_depth WHERE game = ? AND character = ? AND timestamp >= ? AND timestamp <= ? ' +
    'ORDER BY timestamp, full', ...who, from, now);
  const towns = new Map();
  for (const r of rows) {
    const town = r.town ?? 'unknown';
    if (!towns.has(town)) towns.set(town, { town, lists: 0, turned_away: 0, first: null, last: null, peak: null, last_at: null });
    const t = towns.get(town);
    if (toI(r.full) === 1) { t.turned_away += 1; out.turned_away += 1; continue; }
    if (r.boxes == null) continue;
    const boxes = toI(r.boxes);
    t.lists += 1; out.lists += 1;
    if (t.first == null) t.first = boxes;
    t.last = boxes; t.last_at = toI(r.timestamp); t.peak = Math.max(t.peak ?? boxes, boxes);
    if (out.first == null) out.first = boxes;
    out.last = boxes; out.peak = Math.max(out.peak ?? boxes, boxes);
  }
  out.towns = [...towns.values()].map((t) => ({ ...t, change: t.first == null ? null : t.last - t.first }))
    .sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
  out.change = out.first == null ? null : out.last - out.first;
  return out;
}

// ---- bounties -----------------------------------------------------------------

export function buildBounties(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  const bp = hasColumn(conn, 'bounties', 'bp_reward') ? 'bp_reward' : 'NULL';
  const rows = conn.all(`SELECT bounty_type, status, received_time, completed_time, silver_reward, exp_reward, ${bp} AS bp ` +
    'FROM bounties WHERE game = ? AND character = ? AND received_time >= ? AND received_time <= ?', ...who, from, now);
  const types = new Map();
  for (const r of rows) {
    const key = r.bounty_type || 'unknown';
    const t = types.get(key) || { type: key, received: 0, completed: 0, abandoned: 0, expired: 0, active: 0, seconds: 0, silver: 0, exp: 0, points: 0 };
    t.received += 1;
    if (r.status === 'completed') {
      t.completed += 1;
      t.seconds += Math.max(0, toI(r.completed_time) - toI(r.received_time));
      t.silver += toI(r.silver_reward); t.exp += toI(r.exp_reward); t.points += toI(r.bp);
    } else if (Object.hasOwn(t, r.status)) t[r.status] += 1;
    types.set(key, t);
  }
  const finish = (t) => {
    const ended = t.completed + t.abandoned + t.expired;
    return { ...t, success_pct: ended ? Math.round(t.completed * 100 / ended) : null,
      avg_seconds: t.completed ? Math.round(t.seconds / t.completed) : null,
      avg_silver: t.completed ? Math.round(t.silver / t.completed) : null,
      avg_exp: t.completed ? Math.round(t.exp / t.completed) : null,
      avg_points: t.completed && t.points ? Math.round(t.points / t.completed) : null,
      points_per_hour: t.seconds && t.points ? Math.round(t.points * 3600 / t.seconds) : null };
  };
  const list = [...types.values()].map(finish).sort((a, b) => b.received - a.received || (a.type < b.type ? -1 : 1));
  const all = finish(list.reduce((a, t) => {
    for (const k of ['received', 'completed', 'abandoned', 'expired', 'active', 'seconds', 'silver', 'exp', 'points']) a[k] += t[k];
    return a;
  }, { type: 'all', received: 0, completed: 0, abandoned: 0, expired: 0, active: 0, seconds: 0, silver: 0, exp: 0, points: 0 }));
  let offers = null;
  if (hasTable(conn, 'bounty_offers')) {
    const o = conn.all('SELECT outcome, expedited FROM bounty_offers WHERE game = ? AND character = ? AND offered_at >= ? AND offered_at <= ?',
      ...who, from, now);
    const by = {};
    for (const r of o) by[r.outcome || 'open'] = (by[r.outcome || 'open'] || 0) + 1;
    offers = { offered: o.length, expedited: o.filter((r) => toI(r.expedited) === 1).length, by_outcome: by };
  }
  return { label, from, types: list, all, offers };
}

// ---- history ------------------------------------------------------------------

export function buildHistory(conn, id, range, { now, ranges, limit = 400 }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  const rows = conn.all('SELECT cycle_id, cycle_type, start_time, end_time, duration_seconds, rest_reason, profile, ' +
    'exp_total_start, exp_total_end, fame_start, fame_end FROM cycles WHERE game = ? AND character = ? ' +
    'AND start_time >= ? AND start_time <= ? ORDER BY start_time DESC LIMIT ?', ...who, from, now, limit);
  const silver = new Map();
  if (rows.length && hasColumn(conn, 'bank_snapshots', 'cycle_id')) {
    for (const r of conn.all("SELECT cycle_id, SUM(delta_silver) AS s FROM bank_snapshots WHERE game = ? AND character = ? " +
      "AND bank_name = '__total__' AND delta_silver IS NOT NULL AND timestamp >= ? GROUP BY cycle_id", ...who, from)) {
      silver.set(r.cycle_id, toI(r.s));
    }
  }
  const gain = (a, b) => (a == null || b == null ? null : Math.max(0, toI(b) - toI(a)));
  return {
    label, from,
    // An open cycle older than STALE_OPEN was left by a crash (the overview's
    // cap too): it ended, but when isn't known, so it gets no duration
    cycles: rows.map((r) => ({
      type: r.cycle_type, start: toI(r.start_time), end: r.end_time == null ? null : toI(r.end_time),
      stale: r.end_time == null && now - toI(r.start_time) >= STALE_OPEN,
      seconds: r.end_time != null ? toI(r.duration_seconds) : now - toI(r.start_time) >= STALE_OPEN ? null : Math.max(0, now - toI(r.start_time)),
      reason: r.rest_reason || null, profile: r.profile ? shortProfile(r.profile, who[1]) : null,
      exp: gain(r.exp_total_start, r.exp_total_end), fame: gain(r.fame_start, r.fame_end),
      silver: silver.has(r.cycle_id) ? silver.get(r.cycle_id) : null,
    })),
    truncated: rows.length >= limit,
  };
}

// ---- experience by day ----------------------------------------------------------

// Experience gained per local day for the last +days+ days, per character.
// A cycle's gain counts on the day it started (cycles never span midnight).
export function buildDaily(conn, ids, { now, days = 28 }) {
  const today = dayOf(now);
  const first = addDays(today, -(days - 1));
  const from = midnight(first);
  const split = hasColumn(conn, 'cycles', 'exp_asc_start');
  const labels = [];
  for (let i = 0; i < days; i++) labels.push(dayStr(addDays(first, i)));
  const index = new Map(labels.map((l, i) => [l, i]));
  const series = {};
  for (const id of ids) {
    const who = parseWho(id);
    const exp = new Array(days).fill(0), asc = new Array(days).fill(0), fame = new Array(days).fill(0), hunt = new Array(days).fill(0);
    const rows = conn.all('SELECT cycle_type, start_time, duration_seconds, exp_total_start, exp_total_end, fame_start, fame_end' +
      (split ? ', exp_asc_start, exp_asc_end' : '') + ' FROM cycles WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ?',
    ...who, from, now);
    for (const r of rows) {
      const i = index.get(dateOf(toI(r.start_time)));
      if (i == null) continue;
      if (r.exp_total_start != null && r.exp_total_end != null) exp[i] += Math.max(0, toI(r.exp_total_end) - toI(r.exp_total_start));
      if (split && r.exp_asc_start != null && r.exp_asc_end != null) asc[i] += Math.max(0, toI(r.exp_asc_end) - toI(r.exp_asc_start));
      if (r.fame_start != null && r.fame_end != null) fame[i] += Math.max(0, toI(r.fame_end) - toI(r.fame_start));
      if (r.cycle_type === 'hunt') hunt[i] += toI(r.duration_seconds);
    }
    series[id] = { exp, ascension: split ? asc : null, regular: split ? exp.map((v, i) => Math.max(0, v - asc[i])) : null, fame, hunt_s: hunt };
  }
  return { labels, series, split };
}

// ---- progress -----------------------------------------------------------------

export function levelOf(exp) {
  let level = 0;
  while (level < 100 && exp >= EXP_FOR_LEVEL[level + 1]) level++;
  return level;
}

// Where a character stands and how fast it is moving, from the progress
// table (schema 8). Rates are regular and ascension experience per day over
// the last 7 days of rows (28 when 7 have too little).
export function buildProgress(conn, id, { now }) {
  if (!hasTable(conn, 'progress')) return { available: false };
  const who = parseWho(id);
  const last = conn.one('SELECT * FROM progress WHERE game = ? AND character = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1', ...who, now);
  if (!last) return { available: false };
  const exp = toI(last.exp), axp = toI(last.ascension_exp);
  const level = last.level != null ? toI(last.level) : levelOf(exp);
  const capped = level >= 100 || exp >= CAP_EXP;

  const rate = (days) => {
    const first = conn.one('SELECT timestamp, exp, ascension_exp FROM progress WHERE game = ? AND character = ? AND timestamp >= ? ' +
      'ORDER BY timestamp LIMIT 1', ...who, now - days * 86400);
    if (!first || toI(last.timestamp) - toI(first.timestamp) < 6 * 3600) return null;
    const span = (toI(last.timestamp) - toI(first.timestamp)) / 86400;
    return { days, exp: Math.max(0, exp - toI(first.exp)) / span, asc: Math.max(0, axp - toI(first.ascension_exp)) / span };
  };
  const pace = (() => { const w = rate(7); return w && w.exp + w.asc > 0 ? w : rate(28); })();
  const eta = (need, perDay) => (need > 0 && perDay > 0 ? Math.round(need / perDay * 86400) : null);

  // From schema 9 the EXPERIENCE readings (fame, deeds, long-term exp, Death's
  // Sting) are on a row only when one arrived since the row before, and the
  // training points only on the row after they were shown: the latest of each
  // is the latest row that has it. (Schema 8 rows have them on every row, so
  // the latest row is also the latest that has them.)
  const latest = (col) => conn.one(`SELECT ${col} AS v, timestamp AS t FROM progress WHERE game = ? AND character = ? ` +
    `AND timestamp <= ? AND ${col} IS NOT NULL ORDER BY timestamp DESC LIMIT 1`, ...who, now);
  const int = (r) => (r ? toI(r.v) : null);
  const fame = latest('fame'), deeds = latest('deeds'), lte = latest('long_term_exp'), sting = latest('deaths_sting');
  const tp = conn.one('SELECT ptp, mtp, atp, timestamp FROM progress WHERE game = ? AND character = ? AND timestamp <= ? ' +
    'AND ptp IS NOT NULL ORDER BY timestamp DESC LIMIT 1', ...who, now);
  // RESOURCE (schema 10): the latest reading, from the one row that has it
  const resource = hasColumn(conn, 'progress', 'resource_name')
    ? conn.one('SELECT timestamp, resource_name, resource_weekly, resource_total, suffused, voln_favor, covert_arts_charges, shadow_essence ' +
      'FROM progress WHERE game = ? AND character = ? AND timestamp <= ? AND COALESCE(resource_name, voln_favor, covert_arts_charges, ' +
      'shadow_essence, suffused) IS NOT NULL ORDER BY timestamp DESC LIMIT 1', ...who, now)
    : null;
  const opt = (v) => (v == null ? null : toI(v));
  const out = {
    available: true, at: toI(last.timestamp), level, capped, exp, ascension_exp: axp,
    resource: resource ? {
      at: toI(resource.timestamp), name: resource.resource_name || null, weekly: opt(resource.resource_weekly), total: opt(resource.resource_total),
      suffused: opt(resource.suffused), voln_favor: opt(resource.voln_favor), covert_arts_charges: opt(resource.covert_arts_charges),
      shadow_essence: opt(resource.shadow_essence),
    } : null,
    fame: int(fame), deeds: int(deeds), long_term_exp: int(lte),
    deaths_sting: sting ? String(sting.v) : null, lumnis: last.lumnis != null, rpa: last.rpa == null ? null : Number(last.rpa),
    read_at: fame ? toI(fame.t) : null, sting_at: sting ? toI(sting.t) : null,
    unspent: { ptp: tp ? toI(tp.ptp) : null, mtp: tp && tp.mtp != null ? toI(tp.mtp) : null, atp: tp && tp.atp != null ? toI(tp.atp) : null,
               at: tp ? toI(tp.timestamp) : null },
    pace: pace ? { days: pace.days, exp_per_day: Math.round(pace.exp), asc_per_day: Math.round(pace.asc) } : null,
  };
  if (capped) {
    const past = Math.max(0, exp - CAP_EXP);
    const toNext = EXP_PER_TP - (past % EXP_PER_TP);
    out.tp = { earned: Math.floor(past / EXP_PER_TP), to_next: toNext, pct: Math.round((EXP_PER_TP - toNext) * 100 / EXP_PER_TP),
      eta: eta(toNext, pace?.exp), per_day: pace ? Math.round(pace.exp / EXP_PER_TP * 10) / 10 : null };
  } else {
    const lo = EXP_FOR_LEVEL[level], hi = EXP_FOR_LEVEL[level + 1];
    out.next_level = { level: level + 1, to_next: hi - exp, pct: Math.round((exp - lo) * 1000 / (hi - lo)) / 10, eta: eta(hi - exp, pace?.exp) };
    out.to_cap = { to_next: CAP_EXP - exp, eta: eta(CAP_EXP - exp, pace?.exp) };
  }
  const toAtp = ASC_PER_ATP - (axp % ASC_PER_ATP);
  out.atp = { earned: Math.floor(axp / ASC_PER_ATP), to_next: toAtp, pct: Math.round((ASC_PER_ATP - toAtp) * 100 / ASC_PER_ATP), eta: eta(toAtp, pace?.asc) };

  // Death's Sting: each stretch from the death that brought it (the start of the
  // dead cycle, or the first reading that shows it when no death is recorded)
  // to the next reading of None. A row without a reading says nothing either
  // way. The level is the last reading in the stretch; null when none came
  // between the death and the None. A death no reading or None ever follows
  // isn't shown: whether it brought a sting isn't known.
  const from30 = now - 30 * 86400;
  const rows = conn.all('SELECT timestamp, deaths_sting, lumnis, exp, ascension_exp FROM progress WHERE game = ? AND character = ? ' +
    'AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp', ...who, from30, now);
  // From the death itself (the dead cycle's start): a potion can cure the sting
  // before the dead cycle ends, and the first reading may come much later
  const deaths = hasTable(conn, 'cycles')
    ? conn.all("SELECT start_time AS t FROM cycles WHERE game = ? AND character = ? AND cycle_type = 'dead' " +
      'AND start_time >= ? AND start_time <= ?', ...who, from30, now).map((r) => toI(r.t))
    : [];
  const events = [...deaths.map((t) => ({ t, death: true })),
    ...rows.filter((r) => r.deaths_sting != null).map((r) => ({ t: toI(r.timestamp), level: String(r.deaths_sting) }))]
    .sort((a, b) => a.t - b.t || (a.death ? -1 : 0) - (b.death ? -1 : 0));
  const stings = [];
  let open = null;
  for (const e of events) {
    if (e.death) { if (!open) open = { level: null, from: e.t, to: null, seen: false }; continue; }
    if (e.level !== 'None') {
      if (!open) open = { level: e.level, from: e.t, to: null, seen: true };
      else { open.level = e.level; open.seen = true; }
    } else if (open) {
      open.to = e.t; open.seconds = open.to - open.from; stings.push(open); open = null;
    }
  }
  if (open && open.seen) { open.seconds = now - open.from; stings.push(open); }
  out.stings = stings.reverse().slice(0, 10).map(({ seen: _, ...x }) => x);

  // Lumnis: the share of the last 7 days' experience gained while it was active
  let withL = 0, total = 0;
  for (let i = 1; i < rows.length; i++) {
    if (toI(rows[i].timestamp) < now - 7 * 86400) continue;
    const gained = Math.max(0, toI(rows[i].exp) - toI(rows[i - 1].exp)) + Math.max(0, toI(rows[i].ascension_exp) - toI(rows[i - 1].ascension_exp));
    total += gained;
    if (rows[i - 1].lumnis != null) withL += gained;
  }
  out.lumnis_share = total ? Math.round(withL * 100 / total) : null;
  return out;
}

// ---- longer ranges ------------------------------------------------------------

// The detail and Compare pages take two more ranges than the summary
export const DETAIL_RANGES = { daily: 'Today', weekly: 'This Week', monthly: 'This Month', ytd: 'This Year', total: 'All Time' };

// ---- bank reconciliation --------------------------------------------------------

// A BANK ACCOUNT listing stores how far its total was from the one tracked
// through deposits and withdrawals (delta_silver). Nonzero means the banks
// moved without a teller line being read: silver per hour counts it as
// income or spending like any other change, so it is shown, not hidden.
export function buildReconciliation(conn, id, range, { now, ranges }) {
  const who = parseWho(id);
  const { label, from } = window(range, now, ranges);
  if (!hasColumn(conn, 'bank_snapshots', 'snapshot_type')) return { label, from, listings: 0, checks: [], off: 0 };
  const rows = conn.all("SELECT timestamp, balance, delta_silver, snapshot_type FROM bank_snapshots WHERE game = ? AND character = ? " +
    "AND bank_name = '__total__' AND snapshot_type NOT IN ('deposit', 'withdraw', 'unstated') AND timestamp >= ? AND timestamp <= ? " +
    'ORDER BY timestamp DESC', ...who, from, now);
  const checks = rows.filter((r) => r.delta_silver != null && toI(r.delta_silver) !== 0)
    .map((r) => ({ at: toI(r.timestamp), balance: toI(r.balance), off: toI(r.delta_silver), type: r.snapshot_type }));
  return { label, from, listings: rows.filter((r) => r.delta_silver != null).length, checks,
    off: checks.reduce((a, c) => a + c.off, 0), apart: checks.reduce((a, c) => a + Math.abs(c.off), 0) };
}

// ---- comparing characters ---------------------------------------------------------

// The per-character figures of Income, Hunting and Bounties, side by side.
// Each list is flat (one row per character and thing) so tables can sort it.
export function buildCompare(conn, ids, range, { now, ranges }) {
  const { label, from } = window(range, now, ranges);
  const out = { label, from, characters: ids.length, shops: [], towns: [], creatures: [], bounties: [], income: [], combat: [], combat_creatures: [], pool: [] };
  for (const id of ids) {
    const inc = buildIncome(conn, id, range, { now, ranges });
    const hunt = buildHunting(conn, id, range, { now, ranges });
    const b = buildBounties(conn, id, range, { now, ranges });
    if (inc.total_in || inc.total_out) {
      out.income.push({ id, total_in: inc.total_in, total_out: inc.total_out, net: inc.net,
        top: inc.sources.slice().sort((x, y) => y.amount - x.amount)[0]?.label || null });
    }
    for (const s of inc.shops) out.shops.push({ id, ...s });
    for (const t of inc.towns) out.towns.push({ id, ...t });
    for (const c of hunt.creatures) out.creatures.push({ id, ...c });
    const pool = inc.pool;
    if (pool.now || pool.lists || pool.turned_away) {
      out.pool.push({ id, boxes: pool.now?.boxes ?? null, town: pool.now?.town ?? null, at: pool.now?.at ?? null, change: pool.change ?? null,
        peak: pool.peak, lists: pool.lists, turned_away: pool.turned_away });
    }
    const fight = hunt.combat;
    if (fight.fought) {
      const { creatures, label: _l, from: _f, recorded: _r, ...totals } = fight;
      out.combat.push({ id, ...totals });
      for (const c of creatures) out.combat_creatures.push({ id, ...c });
    }
    for (const t of b.types) out.bounties.push({ id, ...t });
  }
  return out;
}

// ---- targets --------------------------------------------------------------------

// A target the reader set on the Progress page: { kind: 'level' | 'tp' | 'atp', value,
// from }, from being the experience (ascension experience for 'atp') when it was set.
// How far it is, the share covered since it was set, and when at the recent pace.
// Pure maths on buildProgress.
export function targetEta(p, target) {
  if (!p || !p.available || !target) return null;
  const value = Math.floor(Number(target.value));
  if (!(value > 0)) return null;
  let need, have, total, perDay, label;
  if (target.kind === 'level') {
    if (value > 100) return null;
    label = `Level ${value}`;
    total = EXP_FOR_LEVEL[value]; have = p.exp; need = total - have; perDay = p.pace?.exp_per_day;
  } else if (target.kind === 'tp') {
    label = `${value} training points past the cap`;
    total = CAP_EXP + value * EXP_PER_TP; have = p.exp; need = total - have; perDay = p.pace?.exp_per_day;
  } else if (target.kind === 'atp') {
    label = `${value} ascension points`;
    total = value * ASC_PER_ATP; have = p.ascension_exp; need = total - have; perDay = p.pace?.asc_per_day;
  } else return null;
  const reached = need <= 0;
  // Without a starting point (an older saved target), count from the current level, the cap, or zero
  const base = Number.isFinite(Number(target.from)) && Number(target.from) < total ? Number(target.from)
    : target.kind === 'level' ? EXP_FOR_LEVEL[Math.min(p.level, value - 1)] : target.kind === 'tp' ? CAP_EXP : 0;
  const span = total - base;
  return { kind: target.kind, value, label, need: Math.max(0, need), reached,
    pct: reached ? 100 : span > 0 ? Math.max(0, Math.min(100, Math.round((have - base) * 1000 / span) / 10)) : 0,
    eta: reached || !(perDay > 0) ? null : Math.round(need / perDay * 86400) };
}
