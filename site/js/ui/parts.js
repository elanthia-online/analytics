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
