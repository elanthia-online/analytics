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
  const type = String(row.bounty_type ?? '');
  if (type !== '') return `${type}: ${bountyTarget(type, row.creature, row.area)}`.replace(/: $/, '');

  const assignment = String(row.assignment ?? '');
  if (assignment === 'escort') return `escort to ${row.area ?? ''}`.replace(/ to $/, '');
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

// Report.windows / range_from_arg: [label, start]
export function windows(now) {
  const today = dayOf(now);
  const day = midnight(today);
  return [
    ['Today', day],
    ['This Week', day - 6 * 86_400],
    ['This Month', day - 29 * 86_400],
    ['YTD', midnight({ y: today.y, m: 1, d: 1 })],
  ];
}

export function rangeFromArg(arg, now) {
  const [today, week, month, year] = windows(now);
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
