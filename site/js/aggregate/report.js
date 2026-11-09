// Ports of the GS4Analytics::Report and Util helpers the dashboard uses.
import { toI, rround, sortBy } from './ruby.js';
import { dayOf, addDays, midnight, dateOf } from './time.js';

export const WHO_SQL = "(game || ':' || character)";

// Who.parse: "GS3:Name" -> [game, name]
export function parseWho(id) {
  const text = String(id ?? '');
  const at = text.indexOf(':');
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

// Util.bounty_target
export function bountyTarget(type, creature, area) {
  const name = String(creature ?? '');
  if (name === '') return String(area ?? '');
  if (!['gem', 'herb'].includes(String(type ?? '')) || String(area ?? '') === '') return name;
  return `${name} (${area})`;
}

// Util.offer_label
export function offerLabel(row) {
  const assignment = String(row.assignment ?? '');
  if (assignment === 'escort') return `escort to ${row.area ?? ''}`.replace(/ to $/, '');

  // Until the guard names the target, the taskmaster's words say more
  const type = String(row.bounty_type ?? '');
  const target = bountyTarget(type, row.creature, row.area);
  if (type !== '' && target !== '') return `${type}: ${target}`;

  if (assignment.endsWith('_assignment')) {
    return `${assignment.slice(0, -'_assignment'.length)} task from ${row.town ?? ''}`.replace(/ from $/, '');
  }
  const text = String(row.description ?? '').slice(0, 60);
  return text === '' ? 'unknown' : text;
}

// Report.short_profile: drops the "charname_" prefix bigshot profiles carry
export function shortProfile(profile, name) {
  const text = String(profile ?? '');
  const lower = String(name).toLowerCase();
  return text.toLowerCase().startsWith(`${lower}_`) ? text.slice(name.length + 1) : text;
}

// Report.labels: { "GS3:Name" => "Name" }, with the game appended when the
// database holds more than one game
export function labels(conn) {
  const rows = conn.all('SELECT game, character FROM cycles UNION SELECT game, character FROM bank_snapshots');
  const multi = new Set(rows.map((row) => row.game)).size > 1;
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.game}:${row.character}`, multi ? `${row.character} (${row.game})` : row.character);
  }
  return new Map(sortBy([...map], ([, label]) => String(label).toLowerCase()));
}

// How each range is counted, as the reader chose (Settings > Date ranges).
// The defaults are the text reports' (Report.windows): whole days, the week
// and month rolling a day at a time, the year from January 1.
//   day:   midnight (since midnight) | rolling (the last 24 hours)
//   week:  days (the last 7 whole days) | rolling (the last 7 x 24 hours) | calendar (since the week began)
//   month: days (the last 30 whole days) | rolling (the last 30 x 24 hours) | calendar (since the 1st)
//   year:  calendar (since January 1) | rolling (the last 365 x 24 hours)
//   weekStart: monday | sunday, for a calendar week
export const RANGE_DEFAULTS = Object.freeze({ day: 'midnight', week: 'days', month: 'days', year: 'calendar', weekStart: 'monday' });
export const RANGE_CHOICES = Object.freeze({
  day: ['midnight', 'rolling'], week: ['days', 'rolling', 'calendar'], month: ['days', 'rolling', 'calendar'],
  year: ['calendar', 'rolling'], weekStart: ['monday', 'sunday'],
});

// The rules with anything missing or unknown back at its default
export function rangeRules(rules) {
  const out = { ...RANGE_DEFAULTS };
  for (const [key, choices] of Object.entries(RANGE_CHOICES)) {
    if (rules && choices.includes(rules[key])) out[key] = rules[key];
  }
  return out;
}

// Report.windows / range_from_arg: [label, start]. With the default rules,
// exactly the text reports' windows.
export function windows(now, rules) {
  const r = rangeRules(rules);
  const today = dayOf(now);
  const day = midnight(today);
  const hours = (n) => now - n * 86_400;
  const weekStart = () => {
    const dow = new Date(today.y, today.m - 1, today.d).getDay(); // 0 is Sunday
    return midnight(addDays(today, -((dow - (r.weekStart === 'sunday' ? 0 : 1) + 7) % 7)));
  };
  return [
    r.day === 'rolling' ? ['Last 24 Hours', hours(1)] : ['Today', day],
    { days: ['This Week', day - 6 * 86_400], rolling: ['Last 7 Days', hours(7)],
      calendar: [r.weekStart === 'sunday' ? 'Since Sunday' : 'Since Monday', null] }[r.week],
    { days: ['This Month', day - 29 * 86_400], rolling: ['Last 30 Days', hours(30)],
      calendar: ['Since the 1st', midnight({ y: today.y, m: today.m, d: 1 })] }[r.month],
    r.year === 'rolling' ? ['Last 365 Days', hours(365)] : ['This Year', midnight({ y: today.y, m: 1, d: 1 })],
  ].map((w) => (w[1] === null ? [w[0], weekStart()] : w));
}

// The tab names for the ranges, under these rules
export function rangeLabels(rules) {
  const [today, week, month, year] = windows(0, rules);
  return { daily: today[0], weekly: week[0], monthly: month[0], ytd: year[0], total: 'All Time' };
}

export function rangeFromArg(arg, now, rules) {
  const [today, week, month, year] = windows(now, rules);
  switch (String(arg ?? '').toLowerCase()) {
    case '': case 'daily': case 'day': case 'today': return today;
    case 'weekly': case 'week': return week;
    case 'monthly': case 'month': return month;
    case 'ytd': case 'year': return year;
    case 'total': case 'all': case 'alltime': return ['All Time', 0];
    default: return null;
  }
}

// Report.figures: silver, exp, deaths and hours for one character from
// +from+ to now (an open cycle counts up to now)
export function figures(conn, who, from, now) {
  const silver = toI(conn.one(
    "SELECT COALESCE(SUM(delta_silver), 0) AS s FROM bank_snapshots WHERE game = ? AND character = ? " +
      "AND bank_name = '__total__' AND delta_silver IS NOT NULL AND timestamp >= ? AND timestamp <= ?",
    ...who, from, now,
  ).s);
  const openSecs = 'CASE WHEN end_time IS NOT NULL THEN duration_seconds WHEN start_time >= ? THEN ? - start_time ELSE 0 END';
  const row = conn.one(
    'SELECT MIN(exp_total_start) AS exp_a, MAX(COALESCE(exp_total_end, exp_total_start)) AS exp_b, ' +
      "SUM(CASE WHEN cycle_type = 'dead' THEN 1 ELSE 0 END) AS deaths, " +
      `COALESCE(SUM(${openSecs}), 0) AS secs, ` +
      `COALESCE(SUM(CASE WHEN cycle_type = 'hunt' THEN ${openSecs} ELSE 0 END), 0) AS hunt_secs ` +
      'FROM cycles WHERE game = ? AND character = ? AND start_time >= ? AND start_time <= ?',
    now - 86_400, now, now - 86_400, now, ...who, from, now,
  );
  const exp = row.exp_a != null && row.exp_b != null ? Math.max(toI(row.exp_b) - toI(row.exp_a), 0) : 0;
  const hours = toI(row.secs) / 3600;
  const huntHours = toI(row.hunt_secs) / 3600;
  const per = (total, hrs) => (hrs >= 0.05 ? rround(total / hrs) : null);
  return {
    silver, exp, deaths: toI(row.deaths), secs: toI(row.secs), hunt_secs: toI(row.hunt_secs),
    silver_hr: per(silver, hours), silver_hunt_hr: per(silver, huntHours),
    exp_hr: per(exp, hours), exp_hunt_hr: per(exp, huntHours),
  };
}

// Report.login_for, without the "collector running in this process" branch,
// which has no meaning outside Lich: the logins table is the only source.
// live: seen in the last 3 minutes (the collector touches it every minute).
export function loginFor(conn, who, now) {
  let row;
  try {
    row = conn.one('SELECT started_at, last_seen FROM logins WHERE game = ? AND character = ? ORDER BY started_at DESC LIMIT 1', ...who);
  } catch {
    return null; // a database from before the logins table
  }
  if (!row || row.started_at == null) return null;
  return { ...row, live: now - toI(row.last_seen) <= 180 };
}

export { dateOf, addDays, dayOf, midnight };
