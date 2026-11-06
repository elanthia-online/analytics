// A character's detail pages: income, hunting, bounties, progress and
// history, as HTML strings. Each takes the figures from aggregate/details.js;
// everything from the database goes through esc().
import { DOT, esc, num, short, dur, clock, stamp, plural, STATE_COL, STATE_NAME, css } from './util.js';
import { scroll, head, kpi, tile } from './parts.js';
import { barChart, barRows } from './charts.js';
import { icon } from './icons.js';

export const SECTION_NAMES = { summary: 'Summary', income: 'Income', hunting: 'Hunting', bounties: 'Bounties', progress: 'Progress', history: 'History' };
const SECTION_ICONS = { summary: 'grid', income: 'coins', hunting: 'target', bounties: 'scroll', progress: 'trend', history: 'clock' };
export function sectionIcon(key) { return SECTION_ICONS[key] || 'grid'; }

function empty(ic, title, text) {
  return '<div class="card empty big">' + icon(ic, 'empty-ic') + '<h2>' + title + '</h2><p class="muted">' + text + '</p></div>';
}
// plural() adds an s; these need their own plural
function many(n, one, more) { return num(n) + ' ' + (n === 1 ? one : more); }
function pctOf(part, whole) { return whole ? Math.round(part * 100 / whole) : 0; }
function when(seconds) {
  if (seconds == null) return '--';
  if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + ' min';
  if (seconds < 2 * 86400) return dur(seconds);
  return Math.round(seconds / 86400) + ' days';
}
function shopName(v) {
  return { gemshop: 'Gem shop', pawnshop: 'Pawnshop', furrier: 'Furrier', alchemist: 'Alchemist', consignment: 'Consignment', herbalist: 'Herbalist',
    'general store': 'General store', 'locksmith pool': 'Locksmith pool', locksmith: 'Locksmith', bank: 'Bank', chronomage: 'Chronomage', debt: 'Debt collector' }[v] || v;
}

// ---- income -------------------------------------------------------------------
export function incomeHtml(d) {
  if (!d.total_in && !d.total_out && !d.shops.length) {
    return empty('coins', 'No silver recorded ' + esc(d.label.toLowerCase()), 'Sales, box coins and bounty rewards show up here as analytics.lic reads them from the game.');
  }
  var shopTime = d.shops.reduce(function (a, s) { return a + s.seconds; }, 0);
  var kpis = '<div class="kpi-grid even">' +
    kpi('coins', 'Taken in', short(d.total_in), esc(d.label)) +
    kpi('bag', 'Spent', short(d.total_out), d.expenses.length ? plural(d.expenses.reduce(function (a, e) { return a + e.count; }, 0), 'payment') : 'nothing recorded') +
    kpi('trend', 'Net', short(d.net), d.total_in ? pctOf(d.net, d.total_in) + '% kept' : '') +
    kpi('clock', 'Time in shops', shopTime ? dur(shopTime) : '--', d.shops.length ? plural(d.shops.reduce(function (a, s) { return a + s.visits; }, 0), 'stop') : 'no stops recorded') +
    '</div>';
  var sources = '<section class="card">' + head('Where it came from', esc(d.label) + ' ' + DOT + ' read from the game text') +
    barRows(d.sources.map(function (s) {
      var what = s.key === 'boxes' ? many(s.count, 'box', 'boxes') : s.key === 'bounties' ? many(s.count, 'bounty', 'bounties') : many(s.count, 'sale', 'sales');
      return { label: s.label, value: s.amount, sub: s.count ? what + ' ' + DOT + ' ' + short(Math.round(s.amount / s.count)) + ' each' : 'from kills searched' };
    }), short, '--k1') +
    (d.expenses.length ? '<div class="divider"></div>' + head('Spent on', '', '', 3) + barRows(d.expenses.map(function (e) {
      return { label: e.kind, value: e.amount, sub: plural(e.count, 'payment') };
    }), short, '--gray') : '') +
    '<p class="small muted note-p">Silver per hour elsewhere comes from bank balances; this is what the game text said you were paid, so the two can differ.</p></section>';
  var items = d.items.length ? '<section class="card">' + head('Best sellers', esc(d.label)) + scroll('Best sellers') +
    '<table><thead><tr><th>Item</th><th class="l">Sold to</th><th>Sold</th><th>Each</th><th>Silver</th></tr></thead><tbody>' +
    d.items.map(function (i) {
      return '<tr><td class="wrapcell">' + esc(i.item) + '</td><td class="l">' + esc(i.vendor || '') + '</td><td>' + num(i.count) + '</td><td>' + short(i.each) + '</td><td>' + short(i.silver) + '</td></tr>';
    }).join('') + '</tbody></table></div></section>' : '';
  var shops = d.shops.length ? '<section class="card">' + head('Shops and stops', 'time from walking in to walking out') + scroll('Shops and stops') +
    '<table><thead><tr><th>Stop</th><th>Visits</th><th>Average stay</th><th>Total time</th><th>Silver</th><th>Spent</th><th title="Silver per minute in the shop">Silver / min</th></tr></thead><tbody>' +
    d.shops.map(function (s) {
      return '<tr><td>' + esc(shopName(s.vendor)) + '</td><td>' + num(s.visits) + '</td><td>' + dur(s.avg_seconds) + '</td><td>' + dur(s.seconds) + '</td><td>' + short(s.silver) +
        '</td><td>' + (s.spent ? short(s.spent) : '--') + '</td><td>' + (s.silver && s.per_minute != null ? short(s.per_minute) : '--') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (d.towns.length > 0 ? '<div class="divider"></div>' + head('By town', '', '', 3) + barRows(d.towns.map(function (t) {
      return { label: t.town, value: t.silver, sub: plural(t.visits, 'stop') + ' ' + DOT + ' ' + dur(t.seconds) };
    }), short, '--k1') : '') + '</section>'
    : '<section class="card">' + head('Shops and stops') + '<p class="small muted">Stops at shops, the bank and the locksmith are recorded by analytics.lic with <code>track_shops</code> on (the default, from schema 8).</p></section>';
  return kpis + '<div class="grid g-2">' + sources + (items || '<span></span>') + '</div>' + shops;
}

// ---- hunting ------------------------------------------------------------------
export function huntingHtml(d) {
  if (!d.creatures.length) return empty('target', 'No kills recorded ' + esc(d.label.toLowerCase()), 'Each creature searched shows up here, with its silver and boxes.');
  var kpis = '<div class="kpi-grid even">' +
    kpi('target', 'Kills', num(d.kills), plural(d.creatures.length, 'kind') + ' of creature') +
    kpi('coins', 'Coins searched', short(d.silver), d.kills ? short(Math.round(d.silver / d.kills)) + ' a kill' : '') +
    kpi('bag', 'Boxes', num(d.boxes), d.kills ? (Math.round(d.boxes * 1000 / d.kills) / 10) + ' per 100 kills' : '') +
    kpi('layers', 'Top creature', esc(d.creatures[0].creature), plural(d.creatures[0].kills, 'kill')) + '</div>';
  var bars = '<section class="card">' + head('Kills by creature', esc(d.label)) +
    barRows(d.creatures.slice(0, 8).map(function (c) {
      return { label: c.creature, value: c.kills, sub: short(c.silver) + ' silver ' + DOT + ' ' + many(c.boxes, 'box', 'boxes') };
    }), num, '--k3') + (d.creatures.length > 8 ? '<p class="small muted">Every creature is in the table below.</p>' : '') + '</section>';
  var table = '<section class="card">' + head('Every creature', esc(d.label)) + scroll('Every creature') +
    '<table><thead><tr><th>Creature</th><th>Kills</th><th>Silver</th><th>Silver / kill</th><th>Boxes</th><th>Boxes / 100</th><th class="l">Profile</th><th>Last kill</th></tr></thead><tbody>' +
    d.creatures.map(function (c) {
      return '<tr><td class="wrapcell">' + esc(c.creature) + '</td><td>' + num(c.kills) + '</td><td>' + short(c.silver) + '</td><td>' + (c.silver_per_kill == null ? '--' : num(c.silver_per_kill)) +
        '</td><td>' + num(c.boxes) + '</td><td>' + (c.boxes_per_100 == null ? '--' : c.boxes_per_100) + '</td><td class="l">' + esc(c.profiles.join(', ')) + '</td><td>' +
        (c.last_kill ? stamp(c.last_kill) : '--') + '</td></tr>';
    }).join('') + '</tbody></table></div></section>';
  return kpis + bars + table;
}

// ---- bounties -----------------------------------------------------------------
export function bountiesHtml(d) {
  var a = d.all;
  if (!a.received) return empty('scroll', 'No bounties ' + esc(d.label.toLowerCase()), 'Bounties taken from the Adventurer\'s Guild show up here, by type.');
  var kpis = '<div class="kpi-grid even">' +
    kpi('scroll', 'Completed', num(a.completed), 'of ' + many(a.received, 'bounty', 'bounties') + ' taken') +
    kpi('trend', 'Success', a.success_pct == null ? '--' : a.success_pct + '%', a.abandoned + ' abandoned ' + DOT + ' ' + a.expired + ' expired') +
    kpi('clock', 'Average time', a.avg_seconds == null ? '--' : dur(a.avg_seconds), 'received to turned in') +
    kpi('spark', 'Bounty points', a.points ? num(a.points) : '--', a.points_per_hour ? num(a.points_per_hour) + ' an hour of bounty time' : 'per completed bounty') + '</div>';
  var types = '<section class="card">' + head('By type', esc(d.label)) + scroll('Bounties by type') +
    '<table><thead><tr><th>Type</th><th>Taken</th><th>Done</th><th>Success</th><th>Average time</th><th>Silver each</th><th>Exp each</th><th>Points each</th></tr></thead><tbody>' +
    d.types.map(function (t) {
      return '<tr><td>' + esc(t.type) + '</td><td>' + num(t.received) + '</td><td>' + num(t.completed) + '</td><td>' + (t.success_pct == null ? '--' : t.success_pct + '%') +
        '</td><td>' + (t.avg_seconds == null ? '--' : dur(t.avg_seconds)) + '</td><td>' + (t.avg_silver == null ? '--' : short(t.avg_silver)) + '</td><td>' +
        (t.avg_exp == null ? '--' : num(t.avg_exp)) + '</td><td>' + (t.avg_points == null ? '--' : num(t.avg_points)) + '</td></tr>';
    }).join('') + '</tbody></table></div></section>';
  var o = d.offers, offers = '';
  if (o && o.offered) {
    var order = ['accepted', 'completed', 'removed', 'replaced', 'expired', 'open'];
    var keys = Object.keys(o.by_outcome).sort(function (x, y) { return (order.indexOf(x) + 99) % 99 - (order.indexOf(y) + 99) % 99; });
    offers = '<section class="card">' + head('Task offers', esc(d.label) + ' ' + DOT + ' ' + plural(o.offered, 'offer') + ', ' + o.expedited + ' with a voucher') +
      barRows(keys.map(function (k) { return { label: k, value: o.by_outcome[k] }; }), num, '--k1') + '</section>';
  }
  return kpis + types + offers;
}

// ---- progress -----------------------------------------------------------------
function meterRow(label, pct, text, sub) {
  return '<div class="prog"><div class="prog-top"><span class="prog-lab">' + label + '</span><span class="prog-val">' + text + '</span></div>' +
    '<div class="meter big" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + Math.min(100, Math.max(0, pct)) + '%"></span></div>' +
    (sub ? '<div class="prog-sub">' + sub + '</div>' : '') + '</div>';
}
function eta(seconds) { return seconds == null ? 'no recent pace' : 'about ' + when(seconds) + ' at the recent pace'; }

export function progressHtml(d, width) {
  var p = d.progress;
  if (!p.available) {
    return empty('trend', 'No progress recorded yet', 'Level, training points, ascension and Death\'s Sting are recorded by analytics.lic from schema 8. Run the latest version, and this fills in within the hour.');
  }
  var top = '<div class="kpi-grid even">' +
    (p.capped ? kpi('trend', 'Training points earned', num(p.tp.earned), 'past the level cap') : kpi('trend', 'Level', num(p.level), p.next_level.pct + '% of the way to ' + p.next_level.level)) +
    kpi('spark', 'Ascension points', num(p.atp.earned), short(p.ascension_exp) + ' ascension exp') +
    kpi('clock', 'Pace', p.pace ? short(p.pace.exp_per_day + p.pace.asc_per_day) : '--', p.pace ? 'exp a day, last ' + p.pace.days + ' days' : 'needs a few hours of rows') +
    kpi('skull', 'Death\'s Sting', esc(p.deaths_sting || '--'), p.deaths_sting && p.deaths_sting !== 'None' ? 'a penalty is on' : 'no penalty') + '</div>';
  var meters = '<section class="card">' + head('Next milestones', 'as of ' + clock(p.at)) + '<div class="progs">' +
    (p.capped
      ? meterRow('Next training point', p.tp.pct, short(p.tp.to_next) + ' exp to go', eta(p.tp.eta) + (p.tp.per_day ? ' ' + DOT + ' ' + p.tp.per_day + ' a day' : ''))
      : meterRow('Level ' + p.next_level.level, p.next_level.pct, short(p.next_level.to_next) + ' exp to go', eta(p.next_level.eta)) +
        meterRow('The level cap', Math.round((1 - p.to_cap.to_next / 7572500) * 100), short(p.to_cap.to_next) + ' exp to go', eta(p.to_cap.eta))) +
    meterRow('Next ascension point', p.atp.pct, short(p.atp.to_next) + ' to go', 'ascension exp ' + DOT + ' ' + eta(p.atp.eta)) + '</div></section>';
  var u = p.unspent;
  var tiles = '<section class="card">' + head('Where it stands') + '<div class="tiles">' +
    tile('layers', 'Unspent PTP / MTP', u.ptp == null ? '--' : num(u.ptp) + ' / ' + num(u.mtp), u.ptp == null ? 'shown after EXPERIENCE' : 'physical / mental') +
    tile('spark', 'Unspent ATP', u.atp == null ? '--' : num(u.atp), u.atp == null ? 'shown after EXPERIENCE' : 'ascension') +
    tile('star', 'Fame', p.fame == null ? '--' : short(p.fame), '') +
    tile('scroll', 'Deeds', p.deeds == null ? '--' : num(p.deeds), '') +
    tile('brain', 'Long-term exp', p.long_term_exp == null ? '--' : num(p.long_term_exp), 'waiting to absorb') +
    tile('sparkles', 'Lumnis', p.lumnis ? 'Active' : 'Not active', p.lumnis_share == null ? '' : p.lumnis_share + '% of the last 7 days\' exp') +
    '</div></section>';
  var dl = d.daily, s = dl.series[Object.keys(dl.series)[0]];
  var series = dl.split ? [{ name: 'Regular', values: s.regular, color: '--k1' }, { name: 'Ascension', values: s.ascension, color: '--k2' }]
    : [{ name: 'Experience', values: s.exp, color: '--k1' }];
  var chart = '<section class="card">' + head('Experience by day', 'last ' + dl.labels.length + ' days' + (dl.split ? ' ' + DOT + ' regular and ascension' : '')) +
    barChart('progress-daily', dl.labels, series, short, width, 'Experience by day') + '</section>';
  var stings = p.stings.length ? '<section class="card">' + head('Death\'s Sting', 'last 30 days') + scroll('Death\'s Sting') +
    '<table><thead><tr><th>From</th><th class="l">Level</th><th>Lasted</th></tr></thead><tbody>' + p.stings.map(function (x) {
      return '<tr><td>' + stamp(x.from) + '</td><td class="l">' + esc(x.level) + '</td><td>' + (x.to ? dur(x.seconds) : dur(x.seconds) + ' so far') + '</td></tr>';
    }).join('') + '</tbody></table></div></section>' : '';
  return top + meters + chart + tiles + stings;
}

// ---- history ------------------------------------------------------------------
// Which columns have anything in them (an older database has no fame or per-cycle silver)
export function historyCols(cycles) {
  return { fame: cycles.some(function (c) { return c.fame != null; }), silver: cycles.some(function (c) { return c.silver != null; }) };
}
export function historyRows(cycles, filter) {
  var cols = historyCols(cycles), span = 5 + (cols.fame ? 1 : 0) + (cols.silver ? 1 : 0);
  var q = String(filter.q || '').toLowerCase();
  var shown = cycles.filter(function (c) {
    if (filter.type !== 'all' && c.type !== filter.type) return false;
    return !q || [c.reason, c.profile, c.type].some(function (t) { return t && String(t).toLowerCase().indexOf(q) >= 0; });
  });
  if (!shown.length) return { html: '<tr><td colspan="' + span + '" class="muted">Nothing matches.</td></tr>', count: 0 };
  return { count: shown.length, html: shown.map(function (c) {
    return '<tr><td>' + stamp(c.start) + '</td><td class="l"><span class="state st-' + esc(c.type) + '"><i style="background:' + css(STATE_COL[c.type] || '--gray') + '"></i>' +
      esc(STATE_NAME[c.type] || c.type) + '</span></td><td>' + (c.end == null ? dur(c.seconds) + ' so far' : dur(c.seconds)) + '</td><td class="l wrapcell">' +
      esc(c.reason || c.profile || '') + '</td><td>' + (c.exp == null ? '--' : short(c.exp)) + '</td>' + (cols.fame ? '<td>' + (c.fame == null ? '--' : short(c.fame)) + '</td>' : '') +
      (cols.silver ? '<td>' + (c.silver == null ? '--' : short(c.silver)) + '</td>' : '') + '</tr>';
  }).join('') };
}

export function historyHtml(d, filter) {
  if (!d.cycles.length) return empty('clock', 'Nothing recorded ' + esc(d.label.toLowerCase()), 'Every hunt, rest, death and idle stretch shows up here.');
  var rows = historyRows(d.cycles, filter), cols = historyCols(d.cycles);
  var opt = function (v, t) { return '<option value="' + v + '"' + (filter.type === v ? ' selected' : '') + '>' + t + '</option>'; };
  return '<section class="card">' + head('Every hunt and rest', esc(d.label) + ' ' + DOT + ' newest first') +
    '<div class="filters" role="search"><label class="fl"><span>Show</span><select id="histType">' + opt('all', 'Everything') + opt('hunt', 'Hunts') + opt('rest', 'Rests') +
      opt('dead', 'Deaths') + opt('idle', 'Idle') + '</select></label>' +
    '<label class="fl grow"><span>Search reasons and profiles</span><input id="histQ" type="search" autocomplete="off" value="' + esc(filter.q || '') + '" placeholder="e.g. encumbered"></label>' +
    '<span class="fl-count" id="histCount" role="status">' + plural(rows.count, 'row') + (d.truncated ? ' (the newest ' + d.cycles.length + ')' : '') + '</span></div>' +
    scroll('Every hunt and rest') + '<table><thead><tr><th>Started</th><th class="l">What</th><th>Length</th><th class="l">Reason or profile</th><th>Exp</th>' + (cols.fame ? '<th>Fame</th>' : '') + (cols.silver ? '<th>Silver</th>' : '') + '</tr></thead>' +
    '<tbody id="histBody">' + rows.html + '</tbody></table></div></section>';
}
