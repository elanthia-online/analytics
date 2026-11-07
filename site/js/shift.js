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
  item_sales: ['timestamp'], vendor_visits: ['start_time', 'end_time'], progress: ['timestamp'], metadata: ['updated_at'],
};
const DATE_COLUMNS = [['kill_stats', 'date']];

// Calendar day number of a Unix time: in the zone given, or this computer's
function dayNumber(ts, tz) {
  if (tz) {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ts * 1000)).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  }
  const t = new Date(ts * 1000);
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 86_400_000;
}

// tz: the zone the database's date strings were written in (the fixture's).
// A date moves by the days from that date, there, to the shifted moment's
// date here, which is how the page reads it back.
export function shiftTimes(db, delta, from, tz) {
  delta = Math.round(delta);
  const days = dayNumber(from + delta) - dayNumber(from, tz);
  // In two steps through negatives: a table keyed by a time (progress,
  // logins) would otherwise collide with its own rows exactly delta apart
  for (const [table, cols] of Object.entries(TIME_COLUMNS)) {
    if (!db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length) continue;
    db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = -(${c} + ${delta})`).join(', ')}`);
    db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = -${c}`).join(', ')}`);
  }
  // Rewritten through a copy: shifting in place would collide with rows not yet moved
  const by = `'${days >= 0 ? '+' : ''}${days} days'`;
  for (const [table, col] of DATE_COLUMNS) {
    const cols = db.exec(`PRAGMA table_info(${table})`)[0].values.map((row) => row[1]);
    db.run(`CREATE TEMP TABLE moved AS SELECT * FROM ${table}; DELETE FROM ${table};`);
    db.run(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) SELECT ${cols.map((c) => (c === col ? `date("${c}", ${by})` : `"${c}"`)).join(', ')} FROM moved; DROP TABLE moved;`);
  }
  // The dates now read as this computer's, so the zone they were written in is this one
  const zone = db.exec("SELECT updated_at FROM metadata WHERE key = 'utc_offset'")[0]?.values[0];
  if (zone) {
    const offset = -new Date(Number(zone[0]) * 1000).getTimezoneOffset() * 60;
    db.run("UPDATE metadata SET value = ? WHERE key = 'utc_offset'", [String(offset)]);
    db.run("UPDATE metadata SET value = ? WHERE key = 'zone'", [Intl.DateTimeFormat().resolvedOptions().timeZone || 'local']);
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
