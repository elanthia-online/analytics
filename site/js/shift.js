// Moves every timestamp in an analytics.lic database by `delta` seconds, and
// its date strings by the matching number of calendar days. Used by the
// page's sample data and by tools/mock-server.js --demo, so a fixture taken
// at one moment reads as if it were taken at another.
//
// `db` is an open sql.js Database. The caller owns it (and closes it).
export const TIME_COLUMNS = {
  cycles: ['start_time', 'end_time'], bounties: ['received_time', 'completed_time'], bank_snapshots: ['timestamp'],
  rest_steps: ['rest_start'], logins: ['started_at', 'first_seen', 'last_seen'], bounty_offers: ['offered_at', 'ended_at'],
  kill_stats: ['last_kill_at'], silver_events: ['timestamp'],
  item_sales: ['timestamp'], vendor_visits: ['start_time', 'end_time'],
};
const DATE_COLUMNS = [['kill_stats', 'date']];

// Local calendar day number of a Unix time
function dayNumber(ts) {
  const t = new Date(ts * 1000);
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 86_400_000;
}

export function shiftTimes(db, delta, from) {
  delta = Math.round(delta);
  const days = dayNumber(from + delta) - dayNumber(from);
  for (const [table, cols] of Object.entries(TIME_COLUMNS)) {
    db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ${c} + ${delta}`).join(', ')}`);
  }
  // Rewritten through a copy: shifting in place would collide with rows not yet moved
  const by = `'${days >= 0 ? '+' : ''}${days} days'`;
  for (const [table, col] of DATE_COLUMNS) {
    const cols = db.exec(`PRAGMA table_info(${table})`)[0].values.map((row) => row[1]);
    db.run(`CREATE TEMP TABLE moved AS SELECT * FROM ${table}; DELETE FROM ${table};`);
    db.run(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) SELECT ${cols.map((c) => (c === col ? `date("${c}", ${by})` : `"${c}"`)).join(', ')} FROM moved; DROP TABLE moved;`);
  }
  return delta;
}

// The shift that puts `fixtureNow`'s wall-clock time in `tz` on today's date
// at the same wall-clock time here, so the sample day always looks like a
// full afternoon of play, whatever the reader's clock or time zone.
export function sameTimeToday(fixtureNow, tz, now = Date.now() / 1000) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(fixtureNow * 1000)).map((p) => [p.type, Number(p.value)]));
  const today = new Date(now * 1000);
  today.setHours(parts.hour % 24, parts.minute, parts.second, 0);
  return Math.floor(today.getTime() / 1000) - fixtureNow;
}
