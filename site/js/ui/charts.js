// The charts, as SVG strings. Hover is plain CSS (.hx:hover) plus the
// page-wide [data-tip] tooltip, so a refresh that redraws a chart needs no
// listeners put back.
import { U, DOT, DASH, esc, css, num, short, dur, clock, nice, nowSrv, shown,
         STATE_COL, STATE_NAME, STEP_ORDER, STEP_COL, STEP_DARK_TEXT } from './util.js';

// SVG ids are derived from what is drawn (not a counter), so drawing the
// same data twice gives the same markup and setHtml can skip it
// ---------------- activity timeline ----------------
function segTip(s) {
  return (STATE_NAME[s[0]] || s[0]) + ' ' + clock(s[1]) + ' ' + DASH + ' ' + clock(s[2]) + ' (' + dur(s[2] - s[1]) + ')' + (s[3] ? ' ' + DOT + ' ' + s[3] : '');
}
// width: the space it will be drawn in, so its text is drawn at its real size
export function timeline(chars, dayStart, idp, width) {
  var multi = chars.length > 1;
  var longest = Math.max.apply(null, chars.map(function (c) { return shown(c.name).length; }).concat([0]));
  var W = Math.round(Math.min(1400, Math.max(300, width || 1000)));
  var rowH = 34, barH = 18, L = multi ? Math.min(Math.round(W * 0.3), Math.max(70, Math.round(longest * 7.5 + 20))) : 0, R = 4, top = 6, n = chars.length, H = top + n * rowH + 22;
  var span = 86400, now = nowSrv();
  function x(t) { return L + (W - L - R) * Math.min(Math.max((t - dayStart) / span, 0), 1); }
  var svg = '';
  var every = W < 560 ? 6 : 3;
  for (var h = 0; h <= 24; h += every) {
    var hx = x(dayStart + h * 3600);
    svg += '<line x1="' + hx + '" x2="' + hx + '" y1="' + top + '" y2="' + (top + n * rowH) + '" stroke="var(--line)"/>' +
           '<text x="' + hx + '" y="' + (H - 4) + '" text-anchor="' + (h === 24 ? 'end' : h === 0 ? 'start' : 'middle') + '">' + (h === 24 ? '24' : String(h).padStart(2, '0')) + ':00</text>';
  }
  var id = 'tl-' + (idp || 'x');
  chars.forEach(function (c, i) {
    var y = top + i * rowH + (rowH - barH) / 2, clip = id + '-' + i;
    if (multi) svg += '<text class="tl-name" x="0" y="' + (y + 13) + '">' + esc(shown(c.name)) + '</text>';
    svg += '<clipPath id="' + clip + '"><rect x="' + L + '" y="' + y + '" width="' + (W - L - R) + '" height="' + barH + '" rx="6"/></clipPath>' +
           '<rect x="' + L + '" y="' + y + '" width="' + (W - L - R) + '" height="' + barH + '" rx="6" fill="var(--st-none)"/><g clip-path="url(#' + clip + ')">';
    c.timeline.forEach(function (s) {
      var x1 = x(s[1]), x2 = x(s[2]);
      svg += '<rect class="seg" x="' + x1.toFixed(1) + '" y="' + y + '" width="' + Math.max(1.2, x2 - x1).toFixed(1) + '" height="' + barH + '" fill="' + css(STATE_COL[s[0]] || '--gray') + '" data-tip="' + esc(segTip(s)) + '"/>';
    });
    svg += '</g>';
  });
  // Rounded so a refresh moves the marker only when it moves a visible amount
  var nx = Math.round(x(now) * 2) / 2;
  svg += '<line x1="' + nx + '" x2="' + nx + '" y1="' + (top - 4) + '" y2="' + (top + n * rowH) + '" stroke="var(--ink)" stroke-width="1.5"/>' +
         '<circle cx="' + nx + '" cy="' + (top - 4) + '" r="3.5" fill="var(--ink)"/>';
  var leg = ['hunt', 'rest', 'idle', 'dead'].map(function (k) {
    return '<span><i style="background:' + css(STATE_COL[k]) + '"></i>' + STATE_NAME[k] + '</span>'; }).join('') +
    '<span><i style="background:var(--st-none);box-shadow:inset 0 0 0 1px var(--line-2)"></i>No data</span>' +
    '<span><i style="background:var(--ink);width:2px;border-radius:0"></i>Now</span>';
  return '<svg class="tl" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Activity today">' + svg + '</svg><div class="legend">' + leg + '</div>';
}

// The day at a glance on a character card: the same stretches, no labels
export function dayStrip(c, dayStart, idp) {
  var W = 240, H = 8, now = nowSrv();
  function x(t) { return W * Math.min(Math.max((t - dayStart) / 86400, 0), 1); }
  var svg = '<rect width="' + W + '" height="' + H + '" rx="4" fill="var(--st-none)"/>';
  c.timeline.forEach(function (s) {
    svg += '<rect x="' + x(s[1]).toFixed(2) + '" width="' + Math.max(0.6, x(s[2]) - x(s[1])).toFixed(2) + '" height="' + H + '" fill="' + css(STATE_COL[s[0]] || '--gray') + '" data-tip="' + esc(segTip(s)) + '"/>';
  });
  var clip = 'ds-' + idp, nx = (Math.round(x(now) * 2) / 2 - 0.75).toFixed(2);
  return '<div class="strip"><svg viewBox="0 -2 ' + W + ' ' + (H + 4) + '" preserveAspectRatio="none" width="100%" height="12" role="img" aria-label="Today, midnight to midnight">' +
    '<clipPath id="' + clip + '"><rect width="' + W + '" height="' + H + '" rx="4"/></clipPath><g clip-path="url(#' + clip + ')">' + svg + '</g>' +
    '<rect x="' + nx + '" width="1.5" y="-2" height="' + (H + 4) + '" rx=".75" fill="var(--ink)"/></svg>' +
    '<div class="strip-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>';
}

// ---------------- trend charts ----------------
var FMT = { silver: short, exp: short, bounties: function (v) { return (Math.round(v * 10) / 10).toString(); }, kills: num,
            enc: function (v) { return Math.round(v) + '%'; }, mind: function (v) { return Math.round(v) + '%'; } };
var PCT = { enc: true, mind: true };
var CHART_ICON = { silver: 'coins', exp: 'spark', bounties: 'scroll', kills: 'target', enc: 'bag', mind: 'brain' };

// A monotone cubic through the points (Fritsch-Carlson): smooth, and never
// overshoots the data, so a curve can't suggest a value that wasn't there
function smooth(pts) {
  if (pts.length < 3) return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var n = pts.length, dx = [], m = [], t = [];
  for (var i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (i = 0; i < n - 1; i++) {
    var h = dx[i] / 3;
    d += ' C' + (pts[i][0] + h).toFixed(1) + ' ' + (pts[i][1] + h * t[i]).toFixed(1) + ' ' + (pts[i + 1][0] - h).toFixed(1) + ' ' +
         (pts[i + 1][1] - h * t[i + 1]).toFixed(1) + ' ' + pts[i + 1][0].toFixed(1) + ' ' + pts[i + 1][1].toFixed(1);
  }
  return d;
}

export function trendChart(key, m, labels, hourly, iconFn) {
  var fmtv = FMT[key], W = 420, H = 176, L = 44, R = 46, T = 14, B = 24, n = labels.length;
  var vals = m.values.filter(function (v) { return v != null; });
  if (!vals.length && !m.n) {
    return '<div class="chart-head"><span class="chart-ic">' + iconFn(CHART_ICON[key] || 'trend') + '</span><h4>' + esc(m.title.replace(/ \(%\)$/, '')) + '</h4></div>' +
      '<div class="empty small">No data yet</div>';
  }
  var scale = PCT[key] ? { max: 100, step: 25 } : nice(Math.max.apply(null, vals.concat([m.n ? m.mean + (m.n >= 5 ? m.sd : 0) : 0, 0])) * 1.05);
  var hi = scale.max;
  var tick = function (v) {
    if (PCT[key]) return Math.round(v) + '%';
    if (key === 'bounties') return scale.step < 1 ? v.toFixed(scale.step < 0.1 ? 2 : 1) : String(Math.round(v));
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + 'K';
    return String(Math.round(v));
  };
  function x(i) { return L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1)); }
  function y(v) { return T + (H - T - B) * (1 - Math.min(Math.max(v, 0), hi) / hi); }
  var id = 'tc-' + key, base = y(0);
  var svg = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--k1)" stop-opacity=".16"/>' +
            '<stop offset="1" stop-color="var(--k1)" stop-opacity="0"/></linearGradient></defs>';
  for (var g = 0; g <= hi + 1e-9; g += scale.step) {
    var gy = y(g);
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + (g === 0 ? 'var(--line-2)' : 'var(--line)') + '"/>' +
           '<text x="' + (L - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + tick(g) + '</text>';
  }
  var band = m.n >= 5;
  if (band) {
    var top = y(m.mean + m.sd), bot = y(Math.max(0, m.mean - m.sd));
    svg += '<rect x="' + L + '" y="' + top + '" width="' + (W - L - R) + '" height="' + Math.max(0, bot - top) + '" fill="var(--muted)" opacity=".08"/>';
  }
  if (m.n >= 1) {
    var my = y(m.mean);
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + my + '" y2="' + my + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3"/>' +
           '<text x="' + (W - R + 5) + '" y="' + (my + 3.5) + '">typical</text>';
  }
  // Runs of known values; a gap (no hunting that hour or day) breaks the line
  var runs = [], cur = null, last = null;
  m.values.forEach(function (v, i) {
    if (v == null) { cur = null; return; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push([x(i), y(v)]); last = i;
  });
  runs.forEach(function (pts) {
    var d = smooth(pts);
    if (pts.length > 1) svg += '<path d="' + d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + base + ' L' + pts[0][0].toFixed(1) + ' ' + base + 'Z" fill="url(#' + id + ')"/>';
    svg += '<path d="' + d + '" fill="none" stroke="var(--k1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  });
  var highBad = m.kind === 'avg', colW = (W - L - R) / Math.max(1, n - 1);
  m.values.forEach(function (v, i) {
    if (v == null) return;
    var partial = i === m.partial_index, cx = x(i), cy = y(v);
    if (partial || i === last || runs.some(function (r) { return r.length === 1 && r[0][0] === cx; })) {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + (partial ? 'var(--surface)' : 'var(--k1)') + '" stroke="' + (partial ? 'var(--k1)' : 'var(--surface)') + '" stroke-width="2"/>';
    }
  });
  // Hover: one column per point, a crosshair and the point drawn large
  m.values.forEach(function (v, i) {
    if (v == null) return;
    var partial = i === m.partial_index, cx = x(i), cy = y(v);
    var tip = (hourly ? labels[i].slice(11) : labels[i].slice(5)) + ': ' + fmtv(v) +
      (band ? ' (' + (v >= m.mean ? '+' : '') + Math.round((v - m.mean) * 100 / (m.mean || 1)) + '% vs typical)' : '') + (partial ? ' ' + DOT + ' still in progress' : '');
    svg += '<g class="hx"><line class="xh" x1="' + cx + '" x2="' + cx + '" y1="' + T + '" y2="' + base + '"/>' +
           '<circle class="hp" cx="' + cx + '" cy="' + cy + '" r="5.5"/>' +
           '<rect x="' + (cx - colW / 2).toFixed(1) + '" y="0" width="' + Math.max(colW, 12).toFixed(1) + '" height="' + H + '" fill="transparent" data-tip="' + esc(tip) + '"/></g>';
  });
  if (last != null) {
    var ly = y(m.values[last]), above = ly - 10 >= T + 2, lx = x(last), text = fmtv(m.values[last]);
    // Near the right edge the label goes on the point's left so it isn't cut off
    var left = lx + 8 + String(text).length * 6.5 > W;
    svg += '<text class="lab" x="' + (left ? lx - 9 : lx + 9) + '" y="' + (above ? ly - 9 : ly + 17) + '"' + (left ? ' text-anchor="end"' : '') + '>' + esc(text) + '</text>';
  }
  var step = hourly ? 3 : (n > 10 ? 5 : 1);
  labels.forEach(function (lb, i) {
    if (i % step === 0) svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(hourly ? lb.slice(11, 13) : lb.slice(5)) + '</text>';
  });
  var foot = band ? 'Dashed line: typical ' + fmtv(m.mean) + '. Shaded: usual range, ' + m.n + ' samples'
                  : 'Baseline building: ' + m.n + ' of 5 samples';
  var latest = last != null ? fmtv(m.values[last]) : '--';
  return '<div class="chart-head"><span class="chart-ic">' + iconFn(CHART_ICON[key] || 'trend') + '</span><h4>' + esc(m.title.replace(/ \(%\)$/, '')) + '</h4>' +
      (band ? delta(m.vs_pct, highBad) : '') + '</div>' +
    '<div class="chart-val">' + esc(latest) + '<span>' + (hourly ? 'latest hour' : 'latest day') + '</span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(m.title) + '">' + svg + '</svg>' +
    '<div class="chart-foot">' + foot + '</div>';
}
// A local copy so charts.js doesn't need util's delta signature to change
function delta(p, highBad) {
  if (p == null) return '';
  var r = Math.round(p);
  if (r === 0) return '<span class="delta flat" title="vs typical">0%</span>';
  var good = (r > 0) !== !!highBad;
  return '<span class="delta ' + (good ? 'good' : 'bad') + '" title="vs typical">' + (r > 0 ? U(0x25B2) + ' +' : U(0x25BC) + ' ') + r + '%</span>';
}

// ---------------- rest steps ----------------
export function stepBar(steps) {
  var keys = Object.keys(steps).filter(function (k) { return steps[k] > 0; }).sort(function (a, b) {
    var ia = STEP_ORDER.indexOf(a), ib = STEP_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  var total = keys.reduce(function (a, k) { return a + steps[k]; }, 0);
  if (!total) return '<div class="empty small">No step timing in this window yet.</div>';
  var bar = '<div class="segbar" role="img" aria-label="Average rest: ' + keys.map(function (k) { return k + ' ' + dur(steps[k]); }).join(', ') + '">' + keys.map(function (k) {
    var share = steps[k] * 100 / total, label = Math.round(share) + '%';
    return '<span class="' + (STEP_DARK_TEXT[k] ? 'dark' : '') + '" style="flex:' + steps[k] + ' 1 0;background:' + css(STEP_COL[k] || '--gray') + '" data-tip="' +
      esc(k + ' ' + DOT + ' ' + dur(steps[k]) + ' (' + label + ')') + '">' + (share >= 9 ? label : '') + '</span>'; }).join('') + '</div>';
  var list = '<div class="steps">' + keys.map(function (k) {
    return '<div><i style="background:' + css(STEP_COL[k] || '--gray') + '"></i><span>' + esc(k) + '</span><b>' + dur(steps[k]) + '</b><span class="muted">' +
      Math.round(steps[k] * 100 / total) + '%</span></div>'; }).join('') + '</div>';
  return '<div class="step-total"><span class="stat-val">' + dur(total) + '</span><span class="muted small">average rest</span></div>' + bar + list;
}
