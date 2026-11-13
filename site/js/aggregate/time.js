// Local-calendar helpers. "Local" is the viewer's time zone, the same zone
// sql.js uses for strftime(..., 'localtime'), so SQL day buckets and these
// agree. A day is { y, m, d } with m 1-12, like Ruby's Date.

export function dayOf(ts) {
  const t = new Date(ts * 1000);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

export function addDays(day, n) {
  const t = new Date(day.y, day.m - 1, day.d + n);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

// Util.midnight: unix time of local midnight on a day
export function midnight(day) {
  return Math.floor(new Date(day.y, day.m - 1, day.d, 0, 0, 0).getTime() / 1000);
}

// Wall-clock seconds since local midnight, the measure SQL's tod() uses. On a
// DST day this differs from now - midnight by the hour that was skipped or repeated.
export function clockSeconds(ts) {
  const t = new Date(ts * 1000);
  return t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
}

// The calendar day a window starting at +from+ stands for, for tables keyed by
// date (kill_stats): the day from's in when most of that day is in the window,
// else the next. Whole-day windows start whole multiples of 86,400 s before
// midnight, so across a DST change they start an hour either side of the
// midnight they mean, and this gives the day meant; a rolling window starts
// at any minute, and a day it starts in counts if it starts before noon.
export function windowDay(from) {
  return dateOf(from + 43_200);
}

const pad = (n) => String(n).padStart(2, '0');

// Date#to_s
export function dayStr(day) {
  return `${day.y}-${pad(day.m)}-${pad(day.d)}`;
}

// Report.date_of: the local date of a timestamp
export function dateOf(ts) {
  return dayStr(dayOf(ts));
}

// Time.new(y, m, d, h).strftime('%Y-%m-%d %H')
export function hourLabel(day, hour) {
  const t = new Date(day.y, day.m - 1, day.d, hour);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}`;
}

// Time.at(ts).strftime('%Y-%m-%d %H')
export function hourOf(ts) {
  const t = new Date(ts * 1000);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}`;
}
