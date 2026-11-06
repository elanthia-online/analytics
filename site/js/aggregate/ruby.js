// Small helpers that reproduce the Ruby semantics the dashboard was written
// in (analytics.lic's GS4Analytics::Util and core Ruby), so the port gives
// the same numbers. See docs/porting-notes.md before changing any of them.

// Ruby's nil.to_i / "12".to_i / 3.9.to_i
export function toI(value) {
  if (value == null || value === '') return 0;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
}

// Ruby's nil.to_f / "1.5".to_f
export function toF(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Ruby's Float#round(digits): half away from zero, with the same correction
// Ruby applies so 2.675.round(2) and friends match (float.c round_half_up)
export function rround(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return x;
  if (digits <= 0) return roundHalfAway(x);
  const s = 10 ** digits;
  let f = roundHalfAway(x * s);
  if (x > 0 && (f + 0.5) / s <= x) f += 1;
  if (x < 0 && (f - 0.5) / s >= x) f -= 1;
  return f / s;
}

function roundHalfAway(v) {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

// Ruby's Integer#/ for the integer divisions in the alert texts
export function idiv(a, b) {
  return Math.floor(a / b);
}

// How Ruby interpolates a Float into a string: 0.0, 1.5, 12.0
export function floatStr(x) {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

export function mean(values) {
  const list = values.filter((v) => v != null);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

export function median(values) {
  const list = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// Util.percent: part as a percent of whole, nil when whole isn't positive
export function percent(part, whole, digits = 1) {
  return toF(whole) > 0 ? rround((part * 100) / whole, digits) : null;
}

// SQLite hands booleans back as 0 or 1
export function truthy(value) {
  return value === true || value === 1 || value === 't' || value === '1';
}

// Array#sort_by with an array (or scalar) key. Stable, where Ruby's isn't:
// see docs/porting-notes.md on ties.
export function sortBy(list, key) {
  return list
    .map((item, i) => [key(item), i, item])
    .sort((a, b) => compareKeys(a[0], b[0]) || a[1] - b[1])
    .map((entry) => entry[2]);
}

function compareKeys(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareKeys(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function uniq(list) {
  return [...new Set(list)];
}

// A Map that hands back (and stores) a default for a missing key, like
// Ruby's Hash.new { |h, k| h[k] = ... }
export function autoMap(make) {
  const map = new Map();
  const get = map.get.bind(map);
  map.fetch = (key) => {
    if (!map.has(key)) map.set(key, make(key));
    return get(key);
  };
  return map;
}
