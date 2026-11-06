// Formatting and small HTML helpers shared by the views. Everything taken
// from the database goes through esc(): game text is player-controlled.

// Symbols are built from code points so the source stays plain ASCII
export function U(code) { return String.fromCharCode(code); }
export const DOT = U(0x00B7);
export const DASH = U(0x2013);

export function $(id) { return document.getElementById(id); }
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
export function css(v) { return 'var(' + v + ')'; }

// The clock the views read. A snapshot's clock stands still at the moment it
// was saved; a live one follows the source's clock (offset from ours).
export const clockState = { offset: 0, frozen: null };
export function nowSrv() { return clockState.frozen != null ? clockState.frozen : Date.now() / 1000 + clockState.offset; }

export function num(n) { return n == null ? '--' : Math.round(n).toLocaleString('en-US'); }
export function short(n) {
  if (n == null) return '--';
  var a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K';
  if (a > 0 && a < 10 && a % 1) return s + a.toFixed(1);
  return s + Math.round(a).toLocaleString('en-US');
}
export function dur(sec) {
  if (sec == null) return '--';
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  return m + ':' + String(s).padStart(2, '0');
}
export function ago(ts) {
  if (!ts) return '--';
  var s = Math.max(0, nowSrv() - ts);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm ago';
  return Math.floor(s / 86400) + 'd ago';
}
export function clock(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export function stamp(ts) { return new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
export function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

// Rest steps in a fixed order, each on its own categorical slot
export const STEP_ORDER = ['travel', 'selling', 'eloot', 'bounty', 'healing', 'spells', 'other scripts', 'waiting'];
export const STEP_COL = { travel: '--k1', selling: '--k2', eloot: '--k3', bounty: '--k4', healing: '--k5', spells: '--k6', 'other scripts': '--k7', waiting: '--gray' };
export const STEP_DARK_TEXT = { bounty: true };
export const STATE_COL = { hunt: '--st-hunt', rest: '--st-rest', idle: '--st-idle', dead: '--st-dead', offline: '--gray' };
export const STATE_NAME = { hunt: 'Hunting', rest: 'Resting', idle: 'Idle', dead: 'Dead', offline: 'Offline' };
export const LIGHT = { green: [U(0x2713), 'All normal'], amber: ['!', 'Needs a look'], red: ['!', 'Problem'], gray: [DASH, 'Not running'] };

// A change vs typical: arrow and sign, green when it's the good direction
export function delta(p, highBad, suffix) {
  if (p == null) return '';
  var r = Math.round(p);
  if (r === 0) return '<span class="delta flat">0%' + (suffix || '') + '</span>';
  var good = (r > 0) !== !!highBad;
  return '<span class="delta ' + (good ? 'good' : 'bad') + '">' + (r > 0 ? U(0x25B2) + ' +' : U(0x25BC) + ' ') + r + '%' + (suffix || '') + '</span>';
}
export function status(level, cls) {
  var l = LIGHT[level] || LIGHT.gray;
  return '<span class="status s-' + esc(level) + (cls ? ' ' + cls : '') + '" title="' + l[1] + '" aria-label="' + l[1] + '">' + l[0] + '</span>';
}
export function stateHtml(st) {
  return '<span class="state st-' + esc(st.type) + '"><i style="background:' + css(STATE_COL[st.type] || '--gray') + '"></i>' + esc(STATE_NAME[st.type] || st.type) + '</span>' +
         '<span class="timer" data-since="' + (st.since || '') + '" data-type="' + esc(st.type) + '"></span>';
}

// Lich and the game servers still call GemStone IV "GS3", and so do the
// database and the ids the figures use ("GS3:Name", data-who). Players know
// it as GS4, so everything shown, the URL included, says GS4.
var SHOWN_GAME = { GS3: 'GS4' };
var STORED_GAME = { GS4: 'GS3' };
export function shown(name) {
  return String(name == null ? '' : name).replace(/\((\w+)\)$/, function (m, g) { return '(' + (SHOWN_GAME[g] || g) + ')'; });
}
export function shownId(id) {
  return String(id == null ? '' : id).replace(/^(\w+):/, function (m, g) { return (SHOWN_GAME[g] || g) + ':'; });
}
// A shown id (from the URL) back to the database's
export function storedId(id) {
  return String(id == null ? '' : id).replace(/^(\w+):/, function (m, g) { return (STORED_GAME[g.toUpperCase()] || g) + ':'; });
}
// "Splinter (GS4)" -> ["Splinter", "GS4"]
export function nameParts(name) {
  var m = /^(.*?)\s*\((\w+)\)$/.exec(shown(name));
  return m ? [m[1], m[2]] : [shown(name), ''];
}
export function initial(name) { return esc(String(name || '?').charAt(0).toUpperCase()); }
export function avatar(c, cls) {
  var st = c.state ? c.state.type : 'offline';
  return '<span class="avatar ' + (cls || '') + '" style="--ring:' + css(STATE_COL[st] || '--gray') + '">' + initial(c.name) + '</span>';
}
export function stat(lab, val, sub, cls) {
  return '<div' + (cls ? ' class="' + cls + '"' : '') + '><div class="stat-lab">' + lab + '</div><div class="stat-val">' + val + '</div>' +
         (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
}
export function reasonsHtml(light) {
  if (!light.reasons.length) return '';
  return '<ul class="reasons">' + light.reasons.map(function (r) { return '<li>' + status(r.level) + '<span>' + esc(r.text) + '</span></li>'; }).join('') + '</ul>';
}
// Clean axis steps (1, 2, 2.5, 5 x 10^n) so tick labels never repeat
export function nice(hi) {
  if (!(hi > 0)) return { max: 1, step: 0.25 };
  var raw = hi / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return { max: step * Math.ceil(hi / step - 1e-9), step: step };
}
export function bountyText(b) {
  if (!b) return 'None active';
  return esc(b.target || b.type) + (b.need ? ' ' + DOT + ' ' + b.done + '/' + b.need : '');
}
export function meter(b) {
  if (!b || !b.need) return '';
  return '<div class="meter" role="img" aria-label="' + b.done + ' of ' + b.need + '"><span style="width:' + Math.min(100, b.done * 100 / b.need) + '%"></span></div>';
}
// Writes HTML only when it changed, so a refresh that brings nothing new
// leaves the page (hover, focus, selection) alone
export function setHtml(el, html) {
  if (el._html === html) return false;
  el.innerHTML = html; el._html = html;
  return true;
}
