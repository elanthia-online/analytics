// Building blocks shared by the views: headings, tiles, names, tables.
import { esc, nameParts } from './util.js';
import { icon } from './icons.js';

// A table that may scroll sideways: reachable and named for keyboard users
export function scroll(label) { return '<div class="scroll" tabindex="0" role="region" aria-label="' + esc(label) + '">'; }
export function nameHtml(name, cls) {
  var p = nameParts(name);
  return '<span class="' + (cls || 'nm') + '">' + esc(p[0]) + (p[1] ? ' <span class="game">' + esc(p[1]) + '</span>' : '') + '</span>';
}
export function kpi(ic, lab, val, sub) {
  return '<div class="kpi"><span class="kpi-ic">' + icon(ic) + '</span><div class="stat-lab">' + lab + '</div><div class="stat-val">' + val + '</div>' +
    (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
}
// A card's heading: level 2 for a card on the page, 3 for one inside a card
export function head(title, note, extra, level) {
  var h = 'h' + (level || 2);
  return '<div class="card-head"><' + h + '>' + title + '</' + h + '>' + (note ? '<span class="note">' + note + '</span>' : '') + (extra || '') + '</div>';
}
export function statusTag(s) {
  var cls = s === 'completed' ? 't-ok' : (s === 'active' || s === 'open') ? 't-live' : 't-off';
  return '<span class="tag ' + cls + '"><i></i>' + esc(s) + '</span>';
}
export function tile(ic, lab, val, sub, extra, cls) {
  return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="tile-lab">' + icon(ic) + '<span>' + lab + '</span></div><div class="stat-val">' + val + '</div>' +
    (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + (extra || '') + '</div>';
}
export function unit(s) { return '<span class="unit">' + s + '</span>'; }

// ---- sortable tables -----------------------------------------------------------
// Sort choices per table, kept across redraws (and set by app.js on a click)
export var sortState = {};

// cols: [{ h: heading (plain text; it is escaped), v: row => sort value, c: row => cell HTML, text: true for a
// text column (sorted A-Z first, left-aligned), title: tooltip }]. def: { col, dir }.
// The sorted column's header carries aria-sort; each header is a button.
export function sortTable(key, label, cols, rows, def) {
  var st = sortState[key] || def || { col: 0, dir: 'desc' };
  var col = cols[st.col] || cols[0], sign = st.dir === 'asc' ? 1 : -1;
  var sorted = rows.map(function (r, i) { return [r, i]; }).sort(function (a, b) {
    var x = col.v(a[0]), y = col.v(b[0]);
    if (x == null && y == null) return a[1] - b[1];
    if (x == null) return 1; // blanks last either way
    if (y == null) return -1;
    var d = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return d ? d * sign : a[1] - b[1];
  }).map(function (p) { return p[0]; });
  var head = cols.map(function (c, i) {
    var on = i === st.col, dir = on ? st.dir : null;
    return '<th' + (c.text ? ' class="l"' : '') + (on ? ' aria-sort="' + (dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' +
      '<button type="button" class="sort' + (on ? ' on ' + dir : '') + '" id="sort-' + esc(key) + '-' + i + '" data-sort="' + esc(key) + '" data-col="' + i + '" data-text="' + (c.text ? 1 : 0) + '">' +
      esc(c.h) + '<span class="sort-ic" aria-hidden="true"></span></button></th>';
  }).join('');
  var body = sorted.map(function (r) {
    return '<tr>' + cols.map(function (c) { return '<td' + (c.text ? ' class="l' + (c.wrap ? ' wrapcell' : '') + '"' : '') + '>' + c.c(r) + '</td>'; }).join('') + '</tr>';
  }).join('');
  return scroll(label) + '<table class="sortable"><caption class="sr">' + esc(label) + ', sorted by ' + esc(col.h) +
    (col.text ? (st.dir === 'asc' ? ', A to Z' : ', Z to A') : st.dir === 'asc' ? ', lowest first' : ', highest first') + '. Choose a column heading to sort by it.</caption><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
