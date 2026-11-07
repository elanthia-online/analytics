// One character: the overview entry plus range figures and the deep-dive
// tables. A port of GS4Analytics::Dashboard.character / range_figures and
// everything under them.
import { toI, toF, rround, mean, percent, truthy, sortBy, autoMap } from './ruby.js';
import { dayOf, addDays, midnight, dayStr, dateOf, hourLabel, hourOf } from './time.js';
import { rangeFromArg, parseWho, shortProfile, bountyTarget, offerLabel, figures, loginFor } from './report.js';
import { local, BASE_DAYS, DAY_HUNT, HOUR_HUNT, buildStatusFor } from './overview.js';

export const RANGES = { daily: 'Today', weekly: 'This Week', monthly: 'This Month' };

// +overview+ is the buildOverview result for the same database and now
export function buildCharacter(conn, overview, id, range, { now, alerts, dismissed }) {
  if (!Object.hasOwn(RANGES, range)) range = 'daily';
  const wanted = String(id).toLowerCase();
  const base = overview.characters.find((entry) => entry.id.toLowerCase() === wanted) ?? buildStatusFor(conn, id, { now, alerts, dismissed });
  if (!base) return null;

  return {
    ...base,
    ...rangeFigures(conn, base.id, range, now),
    generated_at: overview.generated_at, day_start: overview.day_start, range, ranges: RANGES,
  };
}

function rangeFigures(conn, id, range, now) {
  const [label, from] = rangeFromArg(range, now);
  const who = parseWho(id);
  const hours = Math.max((now - from) / 3600, 0.01);
  const huntOk = "cycle_type = 'hunt' AND end_time IS NOT NULL AND duration_seconds >= 10";
  const restOk = "cycle_type = 'rest' AND end_time IS NOT NULL AND duration_seconds > 0";
  const k = conn.one(
    `SELECT SUM(CASE WHEN ${huntOk} THEN duration_seconds ELSE 0 END) AS hunt_s, ` +
      `SUM(CASE WHEN ${huntOk} THEN 1 ELSE 0 END) AS hunt_n, ` +
      `SUM(CASE WHEN ${restOk} THEN duration_seconds ELSE 0 END) AS rest_s, ` +
      `SUM(CASE WHEN ${restOk} THEN 1 ELSE 0 END) AS rest_n, ` +
      "SUM(CASE WHEN cycle_type = 'dead' THEN 1 ELSE 0 END) AS deaths, MIN(exp_total_start) AS exp_a, " +
      'MAX(exp_total_end) AS exp_b FROM cycles WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ?',
    ...who, from, now,
  );
  const silver = toI(conn.one(
    "SELECT SUM(delta_silver) AS t FROM bank_snapshots WHERE game = ? AND character = ? AND bank_name = '__total__' " +
      'AND delta_silver IS NOT NULL AND timestamp >= ? AND timestamp <= ?',
    ...who, from, now,
  ).t);
  const kills = toI(conn.one(
    'SELECT SUM(kill_count) AS t FROM kill_stats WHERE game = ? AND character = ? AND date >= ? AND date <= ?',
    ...who, dateOf(from), dateOf(now),
  ).t);
  const done = conn.one(
    'SELECT COUNT(*) AS n, SUM(silver_reward) AS s, SUM(exp_reward) AS e FROM bounties WHERE game = ? AND character = ? ' +
      "AND status = 'completed' AND completed_time >= ? AND completed_time <= ?",
    ...who, from, now,
  );
  const dropped = conn.one(
    "SELECT SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS a, " +
      "SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS x FROM bounties " +
      'WHERE game = ? AND character = ? AND received_time >= ? AND received_time <= ?',
    ...who, from, now,
  );
  const stepSecs = new Map(conn.all(
    'SELECT step, SUM(seconds) AS s FROM rest_steps WHERE game = ? AND character = ? ' +
      'AND rest_start >= ? AND rest_start <= ? GROUP BY 1',
    ...who, from, now,
  ).map((row) => [String(row.step ?? ''), toF(row.s)]));
  const covered = toI(conn.one(
    'SELECT COUNT(DISTINCT cycle_id) AS n FROM rest_steps WHERE game = ? AND character = ? ' +
      'AND rest_start >= ? AND rest_start <= ?',
    ...who, from, now,
  ).n);
  const [trends, trendMeta] = trendsFor(conn, who, range, now);

  const hs = toI(k.hunt_s);
  const hn = toI(k.hunt_n);
  const rs = toI(k.rest_s);
  const rn = toI(k.rest_n);
  const huntH = hs / 3600;
  const gain = k.exp_a != null && k.exp_b != null && toI(k.exp_b) > toI(k.exp_a) ? toI(k.exp_b) - toI(k.exp_a) : 0;
  const steps = {};
  if (covered) for (const [step, secs] of stepSecs) steps[step] = rround(secs / covered, 1);
  return {
    label, hours: rround(hours, 2),
    range_stats: {
      silver, silver_hr: rround(silver / hours),
      silver_hunt_hr: huntH > 0 ? rround(silver / huntH) : null,
      exp: gain, exp_hr: rround(gain / hours), exp_hunt_hr: huntH > 0 ? rround(gain / huntH) : null,
      bounties: toI(done.n), bounties_hunt_hr: huntH > 0 ? rround(toI(done.n) / huntH, 2) : null,
      bounty_silver: toI(done.s), bounty_exp: toI(done.e),
      abandoned: toI(dropped.a), expired: toI(dropped.x),
      kills, deaths: toI(k.deaths),
      hunt_avg: hn === 0 ? null : rround(hs / hn), rest_avg: rn === 0 ? null : rround(rs / rn),
      hunts: hn, rests: rn, uptime_pct: percent(hs, hs + rs),
    },
    steps, steps_covered: covered,
    trends, trend: trendMeta,
    grounds: huntingGrounds(conn, who, now), recent_bounties: recentBounties(conn, who),
    offers: offersFor(conn, who, from, now),
    login: loginFigures(conn, who, now),
  };
}

// Each profile ranked by exp per hunt hour over the last 30 days
function huntingGrounds(conn, who, now) {
  const from = midnight(addDays(dayOf(now), -(BASE_DAYS - 1)));
  const grounds = autoMap(() => ({ hunt_s: 0, hunts: 0, exp: 0, kills: 0, silver: 0, deaths: 0 }));
  for (const row of conn.all(
    "SELECT profile, SUM(CASE WHEN cycle_type = 'hunt' THEN duration_seconds ELSE 0 END) AS hs, " +
      "SUM(CASE WHEN cycle_type = 'hunt' THEN 1 ELSE 0 END) AS n, " +
      "SUM(CASE WHEN cycle_type = 'hunt' AND exp_total_end > exp_total_start THEN exp_total_end - exp_total_start ELSE 0 END) AS xp, " +
      "SUM(CASE WHEN cycle_type = 'dead' THEN 1 ELSE 0 END) AS d FROM cycles " +
      'WHERE game = ? AND character = ? AND end_time IS NOT NULL AND profile IS NOT NULL AND start_time >= ? GROUP BY 1',
    ...who, from,
  )) {
    const ground = grounds.fetch(shortProfile(row.profile, who[1]));
    ground.hunt_s += toI(row.hs);
    ground.hunts += toI(row.n);
    ground.exp += toI(row.xp);
    ground.deaths += toI(row.d);
  }
  for (const row of conn.all(
    'SELECT profile, SUM(kill_count) AS k, SUM(total_silver) AS s FROM kill_stats ' +
      'WHERE game = ? AND character = ? AND date >= ? GROUP BY 1',
    ...who, dateOf(from),
  )) {
    const ground = grounds.fetch(shortProfile(row.profile, who[1]));
    ground.kills += toI(row.k);
    ground.silver += toI(row.s);
  }
  const list = [...grounds].filter(([, g]) => g.hunt_s >= 3600).map(([profile, g]) => {
    const h = g.hunt_s / 3600;
    return { profile, hours: rround(h, 1), hunts: g.hunts, exp_hr: rround(g.exp / h),
             kills_hr: rround(g.kills / h, 1), silver_hr: rround(g.silver / h), deaths: g.deaths };
  });
  return sortBy(list, (ground) => -ground.exp_hr);
}

function recentBounties(conn, who) {
  return conn.all(
    'SELECT bounty_type AS type, creature, area, status, received_time, completed_time, silver_reward, exp_reward ' +
      'FROM bounties WHERE game = ? AND character = ? ORDER BY received_time DESC LIMIT 12',
    ...who,
  ).map((row) => ({
    type: String(row.type ?? ''), target: bountyTarget(row.type, row.creature, row.area),
    status: String(row.status ?? ''), received: toI(row.received_time),
    took: row.completed_time != null ? toI(row.completed_time) - toI(row.received_time) : null,
    silver: row.silver_reward ?? null, exp: row.exp_reward ?? null,
  }));
}

// This game login's silver, exp and deaths, for the "This login" chip
function loginFigures(conn, who, now) {
  const login = loginFor(conn, who, now);
  if (!login) return null;
  return { ...figures(conn, who, toI(login.started_at), now), since: toI(login.started_at), live: login.live };
}

// The tasks offered in the range, newest first, with the ones sent back
function offersFor(conn, who, from, now) {
  if (!conn.tableExists('bounty_offers')) return { offered: 0, removed: 0, expedited: 0, vouchers: null, recent: [] };
  const rows = conn.all(
    'SELECT * FROM bounty_offers WHERE game = ? AND character = ? AND offered_at >= ? AND offered_at <= ? ' +
      'ORDER BY offered_at DESC, rowid DESC',
    ...who, from, now,
  );
  return {
    offered: rows.length,
    removed: rows.filter((row) => row.outcome === 'removed').length,
    expedited: rows.filter((row) => truthy(row.expedited)).length,
    vouchers: rows.find((row) => row.vouchers_left != null)?.vouchers_left ?? null,
    recent: rows.slice(0, 15).map((row) => ({
      at: toI(row.offered_at), task: offerLabel(row), outcome: String(row.outcome ?? ''), expedited: truthy(row.expedited),
    })),
  };
}

// Per-bucket values against the character's own baseline. Today is shown
// by hour (baseline: last 14 days of hours with real hunting); week and
// month by day (baseline: last 30 days of days with real hunting). The
// current, unfinished hour or day is plotted but left out of the baseline.
function trendsFor(conn, who, range, now) {
  const hourly = range === 'daily';
  const pattern = hourly ? '%Y-%m-%d %H' : '%Y-%m-%d';
  const today = dayOf(now);
  const baseDays = hourly ? 14 : BASE_DAYS;
  const baseFrom = midnight(addDays(today, -(baseDays - 1)));
  const minHunt = hourly ? HOUR_HUNT : DAY_HUNT;
  const hours = (date) => Array.from({ length: 24 }, (_, h) => hourLabel(date, h));
  let labels;
  let current;
  let baseKeys;
  if (hourly) {
    labels = hours(today);
    current = hourOf(now);
    baseKeys = Array.from({ length: baseDays }, (_, d) => hours(addDays(today, -(baseDays - 1 - d)))).flat();
  } else {
    const days = range === 'weekly' ? 7 : 30;
    labels = Array.from({ length: days }, (_, i) => dayStr(addDays(today, -(days - 1 - i))));
    current = dayStr(today);
    baseKeys = Array.from({ length: baseDays }, (_, i) => dayStr(addDays(today, -(baseDays - 1 - i))));
  }

  const data = autoMap(() => new Map());
  const at = (metric, key) => data.fetch(metric).get(key) ?? 0;
  const bucket = (col) => `strftime('${pattern}', ${local(col)})`;
  const grab = (metric, sql, ...params) => {
    const series = data.fetch(metric);
    for (const row of conn.all(sql, ...params)) {
      const key = String(row.b ?? '');
      series.set(key, (series.get(key) ?? 0) + toF(row.t));
    }
  };
  const huntWhere = "cycle_type = 'hunt' AND game = ? AND character = ? AND start_time >= ? AND start_time <= ?";
  grab('hunt', `SELECT ${bucket('start_time')} AS b, SUM(duration_seconds) AS t FROM cycles WHERE ${huntWhere} ` +
    'AND end_time IS NOT NULL AND duration_seconds >= 10 GROUP BY 1', ...who, baseFrom, now);
  grab('silver', `SELECT ${bucket('timestamp')} AS b, SUM(delta_silver) AS t FROM bank_snapshots WHERE game = ? AND character = ? ` +
    "AND bank_name = '__total__' AND delta_silver IS NOT NULL AND timestamp >= ? AND timestamp <= ? GROUP BY 1", ...who, baseFrom, now);
  grab('exp', `SELECT ${bucket('start_time')} AS b, SUM(exp_total_end - exp_total_start) AS t FROM cycles WHERE game = ? AND character = ? ` +
    'AND exp_total_end > exp_total_start AND start_time >= ? AND start_time <= ? GROUP BY 1', ...who, baseFrom, now);
  grab('bounties', `SELECT ${bucket('completed_time')} AS b, COUNT(*) AS t FROM bounties WHERE game = ? AND character = ? ` +
    "AND status = 'completed' AND completed_time >= ? AND completed_time <= ? GROUP BY 1", ...who, baseFrom, now);
  if (!hourly) { // kills are stored per day
    grab('kills', 'SELECT date AS b, SUM(kill_count) AS t FROM kill_stats WHERE game = ? AND character = ? ' +
      'AND date >= ? AND date <= ? GROUP BY 1', ...who, dateOf(baseFrom), dateOf(now));
  }
  const averaged = {
    enc: ['encumbrance_start', 'encumbrance_start IS NOT NULL'],
    mind: ['MIN(100.0, exp_field_end * 100.0 / exp_field_max)', 'exp_field_end IS NOT NULL AND exp_field_max > 0'],
  };
  for (const [metric, [expr, cond]] of Object.entries(averaged)) {
    grab(`${metric}_sum`, `SELECT ${bucket('start_time')} AS b, SUM(${expr}) AS t FROM cycles WHERE ${huntWhere} AND ${cond} GROUP BY 1`,
      ...who, baseFrom, now);
    grab(`${metric}_n`, `SELECT ${bucket('start_time')} AS b, COUNT(*) AS t FROM cycles WHERE ${huntWhere} AND ${cond} GROUP BY 1`,
      ...who, baseFrom, now);
  }

  const per = hourly ? 'per hour' : 'per day';
  const specs = [['silver', `Silver ${per}`, 'sum'], ['exp', `Experience ${per}`, 'sum'], ['bounties', `Bounties ${per}`, 'sum']];
  if (!hourly) specs.push(['kills', 'Kills per day', 'sum']);
  specs.push(['enc', 'Encumbrance at hunt start (%)', 'avg'], ['mind', 'Mind at hunt end (%)', 'avg']);

  const value = (metric, kind, key) => {
    if (kind === 'sum') return at(metric, key);
    const count = at(`${metric}_n`, key);
    return count > 0 ? at(`${metric}_sum`, key) / count : null;
  };
  const active = (key) => at('hunt', key) >= minHunt;

  const trends = {};
  for (const [metric, title, kind] of specs) {
    const baseline = baseKeys.filter((key) => key !== current && active(key)).map((key) => value(metric, kind, key)).filter((v) => v != null);
    const avgBase = mean(baseline) ?? 0;
    const sd = baseline.length < 2 ? 0 : Math.sqrt(baseline.reduce((a, v) => a + (v - avgBase) ** 2, 0) / baseline.length);
    const shown = labels.map((lab) => {
      const v = value(metric, kind, lab);
      if (lab === current) return at('hunt', lab) > 0 && v != null ? rround(v, 1) : null;
      if (lab > current) return null;
      return active(lab) && v != null ? rround(v, 1) : null;
    });
    const complete = labels.map((lab, i) => (lab !== current ? shown[i] : null)).filter((v) => v != null);
    const avg = mean(complete);
    const partial = labels.indexOf(current);
    trends[metric] = {
      title, kind, values: shown, mean: rround(avgBase, 2), sd: rround(sd, 2),
      n: baseline.length, shown_avg: avg == null ? null : rround(avg, 2),
      vs_pct: avg != null && avgBase > 0 ? rround(((avg - avgBase) * 100) / avgBase, 1) : null,
      partial_index: partial < 0 ? null : partial,
    };
  }
  return [trends, { labels, hourly, baseline_days: baseDays, min_hunt_minutes: Math.floor(minHunt / 60) }];
}
