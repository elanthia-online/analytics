// The "Everyone" view: today, every character. A port of
// GS4Analytics::Dashboard.build_overview and everything under it.
import { toI, toF, rround, idiv, floatStr, mean, median, percent, sortBy, uniq, autoMap } from './ruby.js';
import { dayOf, addDays, midnight, dayStr, dateOf, clockSeconds } from './time.js';
import { WHO_SQL as WHO, labels as reportLabels, shortProfile, bountyTarget, parseWho } from './report.js';

export const IDLE_WARN = 480; // seconds idle before amber/red, matches the cycle manager
export const STALE_OPEN = 7200; // an open cycle older than this means the character isn't running
export const NO_KILL_WARN = 900; // seconds hunting without a kill before red
export const DAY_HUNT = 7200; // hunting seconds for a day to count toward "typical"
export const HOUR_HUNT = 1200; // hunting seconds for an hour to count toward "typical"
export const BASE_DAYS = 30;

// The overview's alerts, and the thresholds they show at: what a reader can
// change on the page (saved in their browser). These defaults are the Ruby
// dashboard's, so an overview built without settings matches the golden figures.
export const ALERT_DEFAULTS = Object.freeze({
  dead: true,
  idle: true, idle_minutes: IDLE_WARN / 60, // red at twice this
  no_kills: true, no_kill_minutes: NO_KILL_WARN / 60,
  pace_silver: true, pace_exp: true, pace_amber_pct: 20, pace_red_pct: 50, // behind typical, after an hour of hunting
  deaths: true, item_rests: true, crashes: true, bounty: true, rest_reasons: true,
  encumbrance: true, encumbrance_points: 10, // above the typical starting encumbrance
  mind: true, mind_pct: 90, // the average starting mind
});

// A reader's settings over the defaults: only known keys, of the right type
export function alertSettings(saved) {
  const out = { ...ALERT_DEFAULTS };
  for (const [key, value] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
    if (!Object.hasOwn(ALERT_DEFAULTS, key)) continue;
    if (typeof ALERT_DEFAULTS[key] === 'boolean' && typeof value === 'boolean') out[key] = value;
    else if (typeof ALERT_DEFAULTS[key] === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}
export const MIN_SAMPLES = 5;
// The cycle each crash reason is recorded on. Up to schema 8 the script wrote
// 'unhandled exit' on any hunt that went idle without a rest, a stop by hand
// included; from schema 9 that is 'hunt stopped', which isn't a crash and
// isn't listed. 'unhandled exit' stays for the golden figures.
const CRASH_REASONS = { 'unhandled exit': 'hunt', 'idle recovery': 'rest' };

// ---- SQL fragments ---------------------------------------------------------
export const local = (col) => `${col}, 'unixepoch', 'localtime'`;
const day = (col) => `strftime('%Y-%m-%d', ${local(col)})`;
// Seconds since local midnight for a timestamp column
const tod = (col) =>
  `(CAST(strftime('%H', ${local(col)}) AS INTEGER) * 3600 + CAST(strftime('%M', ${local(col)}) AS INTEGER) * 60 ` +
  `+ CAST(strftime('%S', ${local(col)}) AS INTEGER))`;

// opts.alerts: the reader's alert settings (alertSettings), and opts.dismissed:
// "id\u0000kind" pairs dismissed for today. With either, each alert carries its
// kind; without, the output is the Ruby dashboard's shape exactly.
function context(now, latestFrom, opts = {}) {
  const today = dayOf(now);
  const dayStart = midnight(today);
  return { now, dayStart, todayS: dayStr(today), todNow: clockSeconds(now), baseFrom: midnight(addDays(today, -BASE_DAYS)), today,
           latestFrom: latestFrom ?? now - 7 * 86_400,
           alerts: alertSettings(opts.alerts), dismissed: new Set(opts.dismissed || []),
           kinds: opts.alerts != null || opts.dismissed != null };
}

// The overview entry for one character the overview leaves out (not played in
// the last day): the same figures, with its last cycle found however old it is.
// null when the database has nothing for that character.
export function buildStatusFor(conn, id, { now, alerts, dismissed }) {
  const ctx = context(now, Number.MIN_SAFE_INTEGER, { alerts, dismissed });
  const data = overviewData(conn, ctx);
  const wanted = String(id).toLowerCase();
  const found = [...data.labels.keys()].find((key) => key.toLowerCase() === wanted);
  return found == null ? null : buildStatus(found, data.labels.get(found) || found, ctx, data);
}

export function buildOverview(conn, { now, alerts, dismissed }) {
  const ctx = context(now, undefined, { alerts, dismissed });
  const data = overviewData(conn, ctx);

  const names = uniq([
    ...data.rows.keys(),
    ...[...data.latest].filter(([, row]) => now - toI(row.start_time) < 86_400).map(([id]) => id),
  ]);
  const chars = sortBy(names, (id) => String(data.labels.get(id) ?? '').toLowerCase())
    .map((id) => buildStatus(id, data.labels.get(id) || id, ctx, data));
  const alertList = sortBy(
    chars.flatMap((char) => char.light.reasons.map((r) => ({ id: char.id, character: char.name, level: r.level, text: r.text, ...(ctx.kinds ? { kind: r.kind } : {}) }))),
    (alert) => [alert.level === 'red' ? 0 : 1, alert.character],
  );
  return { generated_at: now, day_start: ctx.dayStart, characters: chars, alerts: alertList, names: chars.map((char) => char.id) };
}

function overviewData(conn, ctx) {
  const { now, dayStart, baseFrom, todNow, today } = ctx;
  const data = { labels: reportLabels(conn) };

  // cycles touching today (timeline and today's figures)
  data.rows = new Map();
  for (const row of conn.all(
    `SELECT ${WHO} AS who, cycle_type, start_time, end_time, duration_seconds, rest_reason, ` +
      'profile, exp_total_start, exp_total_end, exp_field_start, exp_field_end, exp_field_max, ' +
      'encumbrance_start FROM cycles WHERE start_time >= ? AND (end_time IS NULL OR end_time >= ?) ' +
      'ORDER BY start_time',
    dayStart - 86_400, dayStart,
  )) {
    if (!data.rows.has(row.who)) data.rows.set(row.who, []);
    data.rows.get(row.who).push(row);
  }

  // latest cycle per character, for state (covers characters not seen today)
  data.latest = new Map(conn.all(
    `SELECT ${WHO} AS who, cycle_type, start_time, end_time, rest_reason, profile FROM cycles ` +
      'WHERE start_time >= ? AND start_time = (SELECT MAX(c2.start_time) FROM cycles c2 ' +
      'WHERE c2.game = cycles.game AND c2.character = cycles.character)',
    ctx.latestFrom,
  ).map((row) => [row.who, row]));

  // per-day totals for pace: the full day, and up to this time of day
  const daily = autoMap(() => autoMap(() => new Map()));
  const perDay = (metric, value, table, ts, where) => {
    for (const row of conn.all(
      `SELECT ${WHO} AS who, ${day(ts)} AS d, SUM(${value}) AS f, ` +
        `SUM(CASE WHEN ${tod(ts)} < ? THEN ${value} ELSE 0 END) AS u FROM ${table} ` +
        `WHERE ${where} AND ${ts} >= ? AND ${ts} <= ? GROUP BY 1, 2`,
      todNow, baseFrom, now,
    )) {
      daily.fetch(row.who).fetch(metric).set(String(row.d ?? ''), [toF(row.f), toF(row.u)]);
    }
  };
  perDay('hunt', 'duration_seconds', 'cycles', 'start_time', "cycle_type = 'hunt' AND end_time IS NOT NULL AND duration_seconds >= 10");
  perDay('silver', 'delta_silver', 'bank_snapshots', 'timestamp', "bank_name = '__total__' AND delta_silver IS NOT NULL");
  perDay('exp', '(exp_total_end - exp_total_start)', 'cycles', 'start_time', 'exp_total_end > exp_total_start');
  perDay('bounties', '1', 'bounties', 'completed_time', "status = 'completed'");
  data.daily = daily;

  // rest reasons up to this time of day, per day
  const reasons = autoMap(() => autoMap(() => autoMap(() => 0)));
  for (const row of conn.all(
    `SELECT ${WHO} AS who, ${day('start_time')} AS d, LOWER(TRIM(rest_reason)) AS reason, COUNT(*) AS n ` +
      "FROM cycles WHERE cycle_type = 'rest' AND start_time >= ? AND start_time <= ? " +
      `AND ${tod('start_time')} < ? GROUP BY 1, 2, 3`,
    baseFrom, now, todNow,
  )) {
    const reason = String(row.reason ?? '').replace(/[.!]+$/, '');
    const perDayMap = reasons.fetch(row.who).fetch(String(row.d ?? ''));
    const key = reason === '' ? '(none)' : reason;
    perDayMap.set(key, perDayMap.fetch(key) + toI(row.n));
  }
  data.reasons = reasons;

  data.encBase = new Map(conn.all(
    `SELECT ${WHO} AS who, AVG(encumbrance_start) AS a, COUNT(*) AS n FROM cycles ` +
      "WHERE cycle_type = 'hunt' AND encumbrance_start IS NOT NULL " +
      'AND start_time >= ? AND start_time < ? GROUP BY 1',
    baseFrom, dayStart,
  ).map((row) => [row.who, [toF(row.a), toI(row.n)]]));
  data.lastKill = new Map(conn.all(
    `SELECT ${WHO} AS who, MAX(last_kill_at) AS t FROM kill_stats WHERE date >= ? GROUP BY 1`,
    dayStr(addDays(today, -1)),
  ).map((row) => [row.who, row.t == null ? null : toI(row.t)]));
  data.lastBounty = new Map(conn.all(
    `SELECT ${WHO} AS who, MAX(completed_time) AS t FROM bounties ` +
      "WHERE status = 'completed' AND completed_time >= ? GROUP BY 1",
    baseFrom,
  ).map((row) => [row.who, row.t == null ? null : toI(row.t)]));
  data.killsToday = new Map(conn.all(
    `SELECT ${WHO} AS who, SUM(kill_count) AS t FROM kill_stats WHERE date = ? GROUP BY 1`,
    ctx.todayS,
  ).map((row) => [row.who, toI(row.t)]));

  // the active bounty, and how long each bounty type usually takes
  data.active = new Map(conn.all(
    `SELECT ${WHO} AS who, bounty_type, creature, area, count_required, count_completed, ` +
      "received_time FROM bounties WHERE status = 'active' AND received_time >= ? " +
      'ORDER BY received_time',
    now - 86_400,
  ).map((row) => [row.who, row]));
  const took = autoMap(() => []);
  for (const row of conn.all(
    `SELECT ${WHO} AS who, bounty_type AS type, completed_time - received_time AS secs FROM bounties ` +
      "WHERE status = 'completed' AND completed_time >= ? AND received_time IS NOT NULL",
    baseFrom,
  )) {
    if (!(toI(row.secs) > 0)) continue;
    const type = String(row.type ?? '');
    took.fetch(`${row.who}\u0000${type}`).push(toI(row.secs));
    took.fetch(`\u0000${type}`).push(toI(row.secs));
  }
  data.took = took;
  return data;
}

function buildStatus(id, label, ctx, data) {
  const { now, dayStart, todayS } = ctx;
  const name = parseWho(id)[1];
  const last = data.latest.get(id);
  const daily = data.daily.fetch(id);
  const reasons = data.reasons.fetch(id);
  const lastKill = data.lastKill.has(id) ? data.lastKill.get(id) : null;

  // ---- state ----
  let state = { type: 'offline', since: null, reason: null, profile: null };
  if (last) {
    if (last.end_time == null && now - toI(last.start_time) < STALE_OPEN) {
      state = { type: String(last.cycle_type ?? ''), since: toI(last.start_time), reason: String(last.rest_reason ?? ''),
                profile: shortProfile(last.profile, name) };
    } else {
      state.since = toI(last.end_time ?? last.start_time);
    }
  }

  // ---- timeline segments, clipped to today ----
  const rows = data.rows.get(id) || [];
  const timeline = [];
  for (const row of rows) {
    const from = Math.max(toI(row.start_time), dayStart);
    const to = row.end_time != null ? toI(row.end_time) : (now - toI(row.start_time) < STALE_OPEN ? now : null);
    if (to != null && to > from) timeline.push([String(row.cycle_type ?? ''), from, to, String(row.rest_reason ?? '')]);
  }

  // ---- today's figures (cycles that started today) ----
  const started = rows.filter((row) => toI(row.start_time) >= dayStart);
  const hunts = started.filter((row) => row.cycle_type === 'hunt' && row.end_time != null && toI(row.duration_seconds) >= 10);
  const rests = started.filter((row) => row.cycle_type === 'rest' && row.end_time != null && toI(row.duration_seconds) > 0);
  const huntS = hunts.reduce((a, row) => a + toI(row.duration_seconds), 0);
  const restS = rests.reduce((a, row) => a + toI(row.duration_seconds), 0);
  const idleS = started.filter((row) => row.cycle_type === 'idle').reduce((a, row) => a + toI(row.duration_seconds), 0);
  const deaths = started.filter((row) => row.cycle_type === 'dead').length;
  const crashes = started
    .filter((row) => CRASH_REASONS[String(row.rest_reason ?? '').trim().toLowerCase()] === row.cycle_type)
    .map((row) => ({ at: toI(row.start_time), reason: String(row.rest_reason ?? '') }));
  const itemRests = rests.filter((row) => /\bitems?\b/i.test(String(row.rest_reason ?? ''))).length;

  // mind (field exp) as a percent of capacity, where capacity is known.
  // Bounty experience can take the mind past its capacity; it shows as full
  const pct = (value, max) => (value != null && max != null && toI(max) > 0 ? rround(Math.min((toF(value) * 100) / toI(max), 100), 1) : null);
  const huntRows = started.filter((row) => row.cycle_type === 'hunt');
  const mindStart = huntRows.map((row) => pct(row.exp_field_start, row.exp_field_max)).filter((v) => v != null);
  const mindEnd = huntRows.map((row) => (row.end_time != null ? pct(row.exp_field_end, row.exp_field_max) : null)).filter((v) => v != null);
  const absorbed = rests
    .filter((row) => row.exp_field_start != null && row.exp_field_end != null && toI(row.exp_field_start) >= toI(row.exp_field_end))
    .map((row) => [toI(row.exp_field_start) - toI(row.exp_field_end), toI(row.duration_seconds)]);
  const encToday = huntRows.filter((row) => row.encumbrance_start != null).map((row) => toF(row.encumbrance_start));

  const paced = paceFor(daily, todayS);
  const reasonRows = reasonRowsFor(reasons, todayS, paced.activeDays);
  const pace = paced.metrics;
  const bounty = bountyFor(id, data, now);
  const encBase = data.encBase.get(id) ?? null;

  const shown = (r) => !ctx.dismissed.has(`${id}\u0000${r.kind}`);
  const [reds, ambers] = lights(state, now, lastKill, huntS, pace, deaths, itemRests, crashes, bounty, reasonRows, encBase, encToday, mindStart, ctx.alerts)
    .map((list) => list.filter(shown));
  const reason = (lv) => (r) => (ctx.kinds ? { level: lv, text: r.text, kind: r.kind } : { level: lv, text: r.text });
  let level = 'green';
  if (state.type === 'offline') level = 'gray';
  else if (reds.length) level = 'red';
  else if (ambers.length) level = 'amber';

  const absorbedSecs = absorbed.reduce((a, x) => a + x[1], 0);
  const absorbedExp = absorbed.reduce((a, x) => a + x[0], 0);
  return {
    id, name: label, state, timeline,
    light: { level, reasons: [...reds.map(reason('red')), ...ambers.map(reason('amber'))] },
    pace, last_kill: lastKill, last_bounty: data.lastBounty.get(id) ?? null,
    today: {
      hunt_s: huntS, rest_s: restS, idle_s: idleS, deaths, kills: toI(data.killsToday.get(id)),
      hunts: hunts.length, rests: rests.length, item_rests: itemRests, uptime_pct: percent(huntS, huntS + restS),
    },
    crashes, bounty, rest_reasons: reasonRows.slice(0, 8),
    mind: {
      start_avg: rnd(mean(mindStart), 1), end_avg: rnd(mean(mindEnd), 1), samples: mindEnd.length,
      absorbed_per_min: absorbedSecs === 0 ? null : rround((absorbedExp * 60) / absorbedSecs, 1),
      absorbed_per_rest: absorbed.length ? rround(mean(absorbed.map((x) => x[0]))) : null,
    },
    encumbrance: { today: rnd(mean(encToday), 1), typical: encBase ? rround(encBase[0], 1) : null },
  };
}

const rnd = (v, digits) => (v == null ? null : rround(v, digits));

// Silver, exp and bounties so far today against what this character
// typically has by this time of day, and the projected end of day
function paceFor(daily, todayS) {
  const hunt = daily.fetch('hunt');
  const activeDays = [...hunt].filter(([d, [full]]) => d !== todayS && full >= DAY_HUNT).map(([d]) => d);
  const metrics = {};
  for (const metric of ['silver', 'exp', 'bounties']) {
    const series = daily.fetch(metric);
    const at = (d) => series.get(d) || [0, 0];
    const soFar = at(todayS)[0];
    const typicalNow = mean(activeDays.map((d) => at(d)[1]));
    const typicalDay = mean(activeDays.map((d) => at(d)[0]));
    const ok = activeDays.length >= MIN_SAMPLES && typicalNow != null && typicalNow > 0;
    metrics[metric] = {
      so_far: rround(soFar, 1), typical_now: rnd(typicalNow, 1), typical_day: rnd(typicalDay, 1),
      projected: ok ? rround((soFar / typicalNow) * typicalDay, 1) : null,
      pct: ok ? rround((soFar / typicalNow - 1) * 100, 1) : null, samples: activeDays.length,
    };
  }
  return { metrics, activeDays };
}

// Rest reasons today against the typical count by this time of day
function reasonRowsFor(reasons, todayS, activeDays) {
  const todays = reasons.fetch(todayS);
  const keys = uniq([...[...reasons.values()].flatMap((m) => [...m.keys()]), ...todays.keys()]);
  const rows = keys
    .map((reason) => {
      const typical = activeDays.length
        ? rround(activeDays.reduce((a, d) => a + reasons.fetch(d).fetch(reason), 0) / activeDays.length, 1)
        : null;
      return { reason, today: todays.fetch(reason), typical };
    })
    .filter((row) => row.today > 0 || toF(row.typical) >= 0.5);
  return sortBy(rows, (row) => [-row.today, -toF(row.typical)]);
}

// The active bounty's age against how long that type usually takes
function bountyFor(id, data, now) {
  const active = data.active.get(id);
  if (!active) return null;

  const type = String(active.bounty_type ?? '');
  const own = data.took.fetch(`${id}\u0000${type}`);
  const durations = own.length >= MIN_SAMPLES ? own : data.took.fetch(`\u0000${type}`);
  const typical = durations.length >= MIN_SAMPLES ? rround(median(durations)) : null;
  const age = now - toI(active.received_time);
  return {
    type, target: bountyTarget(type, active.creature, active.area),
    done: toI(active.count_completed), need: toI(active.count_required),
    received: toI(active.received_time), age, typical,
    stuck: typical != null ? age > Math.max(typical * 2, 600) : false,
  };
}

// The status light: what turns a character amber or red
// Each alert is { kind, text }; a: the alert settings
function lights(state, now, lastKill, huntS, pace, deaths, itemRests, crashes, bounty, reasonRows, encBase, encToday, mindStart, a) {
  const reds = [];
  const ambers = [];
  const add = (list, kind, text) => { if (a[kind]) list.push({ kind, text }); };
  // Counted to the wall-clock minute, like the hero figure, so every counter
  // here turns over at once and a refresh within the minute changes nothing
  const lag = now % 60;
  const since = state.since != null ? now - lag - state.since : 0;
  const idleWarn = a.idle_minutes * 60, noKill = a.no_kill_minutes * 60;
  if (state.type === 'dead') add(reds, 'dead', `Dead for ${idiv(since, 60)} min`);
  if (state.type === 'idle' && since > idleWarn) add(since > idleWarn * 2 ? reds : ambers, 'idle', `Idle for ${idiv(since, 60)} min`);
  if (state.type === 'hunt' && since > noKill && lastKill != null && now - lag - lastKill > noKill) {
    add(reds, 'no_kills', `No kills for ${idiv(now - lag - lastKill, 60)} min while hunting`);
  }
  if (huntS >= 3600) {
    for (const [metric, label] of [['silver', 'Silver'], ['exp', 'Exp']]) {
      const p = pace[metric].pct;
      if (p == null) continue;
      if (p <= -a.pace_red_pct) add(reds, `pace_${metric}`, `${label} ${rround(p)}% vs typical by this time`);
      else if (p <= -a.pace_amber_pct) add(ambers, `pace_${metric}`, `${label} ${rround(p)}% vs typical by this time`);
    }
  }
  if (deaths > 0) add(ambers, 'deaths', `${deaths} death${deaths === 1 ? '' : 's'} today`);
  if (itemRests > 0) add(ambers, 'item_rests', `${itemRests} item limit rest${itemRests === 1 ? '' : 's'} today`);
  if (crashes.length) add(ambers, 'crashes', `${crashes.length} crash / idle recovery today`);
  if (bounty && bounty.stuck) add(ambers, 'bounty', `Bounty running ${idiv(bounty.age - lag, 60)} min (typical ${idiv(bounty.typical, 60)} min)`);
  for (const row of reasonRows) {
    if (row.reason === '(none)' || row.typical == null) continue;
    if (row.today >= 3 && row.today >= row.typical * 2 + 1) {
      add(ambers, 'rest_reasons', `${row.reason}: ${row.today} rests today (typical ${floatStr(row.typical)} by now)`);
    }
  }
  if (encBase && encBase[1] >= 10 && encToday.length >= 3 && mean(encToday) >= encBase[0] + a.encumbrance_points) {
    add(ambers, 'encumbrance', `Starting hunts at ${rround(mean(encToday))}% encumbrance (typical ${rround(encBase[0])}%)`);
  }
  if (mindStart.length >= 3 && mean(mindStart) >= a.mind_pct) add(ambers, 'mind', `Starting hunts with mind ${rround(mean(mindStart))}% full`);
  return [reds, ambers];
}

export { dateOf };
