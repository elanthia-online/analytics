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
