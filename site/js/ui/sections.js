// A character's detail pages: income, hunting, bounties, progress and
// history, as HTML strings. Each takes the figures from aggregate/details.js;
// everything from the database goes through esc().
import { U, DOT, esc, num, short, dur, clock, stamp, plural, status as statusIcon, STATE_COL, STATE_NAME, css, shown, hrefFor, avatar } from './util.js';
import { scroll, head, kpi, tile, sortTable } from './parts.js';
import { barChart, barRows } from './charts.js';
import { targetEta } from '../aggregate/details.js';
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
  var items = d.items.length ? '<section class="card">' + head('Best sellers', esc(d.label)) +
    sortTable('items', 'Best sellers', [
      { h: 'Item', text: true, wrap: true, v: function (i) { return i.item; }, c: function (i) { return esc(i.item); } },
      { h: 'Sold to', text: true, v: function (i) { return i.vendor || ''; }, c: function (i) { return esc(i.vendor || ''); } },
      { h: 'Sold', v: function (i) { return i.count; }, c: function (i) { return num(i.count); } },
      { h: 'Each', v: function (i) { return i.each; }, c: function (i) { return short(i.each); } },
      { h: 'Silver', v: function (i) { return i.silver; }, c: function (i) { return short(i.silver); } },
    ], d.items, { col: 4, dir: 'desc' }) + '</section>' : '';
  var shops = d.shops.length ? '<section class="card">' + head('Shops and stops', 'time from walking in to walking out') +
    sortTable('shops', 'Shops and stops', shopCols(false), d.shops, { col: 3, dir: 'desc' }) +
    (d.towns.length > 0 ? '<div class="divider"></div>' + head('By town', '', '', 3) + barRows(d.towns.map(function (t) {
      return { label: t.town, value: t.silver, sub: plural(t.visits, 'stop') + ' ' + DOT + ' ' + dur(t.seconds) };
    }), short, '--k1') : '') + '</section>'
    : '<section class="card">' + head('Shops and stops') + '<p class="small muted">Stops at shops, the bank and the locksmith are recorded by analytics.lic with <code>track_shops</code> on (the default, from schema 8).</p></section>';
  return kpis + '<div class="grid g-2">' + sources + (items || '<span></span>') + '</div>' + shops + bankChecks(d.reconciliation);
}

// Bank listings against the total tracked through deposits and withdrawals
function bankChecks(r) {
  if (!r || !r.listings) return '';
  if (!r.checks.length) {
    return '<section class="card">' + head('Bank checks', esc(r.label)) + '<div class="empty ok">' + statusIcon('green') +
      '<div><b>Every listing matched</b><div class="small muted">' + plural(r.listings, 'BANK ACCOUNT listing') + ' found the same total as the one tracked from the teller.</div></div></div></section>';
  }
  return '<section class="card">' + head('Bank checks', esc(r.label) + ' ' + DOT + ' ' + many(r.checks.length, 'listing', 'listings') + ' of ' + num(r.listings) + ' off') +
    '<p class="small muted note-p first">A <code>BANK ACCOUNT</code> listing that differs from the tracked total means the banks moved without a teller line being read ' +
    '(a deposit by another character, a note, a transfer). Silver per hour counts the difference like any other change: ' +
    '<b>' + (r.off >= 0 ? '+' : U(0x2212)) + short(Math.abs(r.off)) + '</b> in all.</p>' +
    sortTable('bankchecks', 'Bank checks', [
      { h: 'Listed', v: function (c) { return c.at; }, c: function (c) { return stamp(c.at); } },
      { h: 'Listed total', v: function (c) { return c.balance; }, c: function (c) { return short(c.balance); } },
      { h: 'Off by', v: function (c) { return c.off; }, c: function (c) { return '<span class="' + (c.off >= 0 ? 'pos' : 'neg') + '">' + (c.off >= 0 ? '+' : U(0x2212)) + short(Math.abs(c.off)) + '</span>'; } },
    ], r.checks.slice(0, 20), { col: 0, dir: 'desc' }) +
    (r.checks.length > 20 ? '<p class="small muted note-p">The newest 20 of ' + num(r.checks.length) + '. A shorter range shows fewer.</p>' : '') + '</section>';
}

// Columns for a table of shop stops; with who, a character column first
export function shopCols(who) {
  return (who ? [who] : []).concat([
    { h: 'Stop', text: true, v: function (s) { return shopName(s.vendor); }, c: function (s) { return esc(shopName(s.vendor)); } },
    { h: 'Visits', v: function (s) { return s.visits; }, c: function (s) { return num(s.visits); } },
    { h: 'Average stay', v: function (s) { return s.avg_seconds; }, c: function (s) { return dur(s.avg_seconds); } },
    { h: 'Total time', v: function (s) { return s.seconds; }, c: function (s) { return dur(s.seconds); } },
    { h: 'Silver', v: function (s) { return s.silver; }, c: function (s) { return short(s.silver); } },
    { h: 'Spent', v: function (s) { return s.spent || null; }, c: function (s) { return s.spent ? short(s.spent) : '--'; } },
    { h: 'Silver / min', title: 'Silver per minute in the shop', v: function (s) { return s.silver ? s.per_minute : null; },
      c: function (s) { return s.silver && s.per_minute != null ? short(s.per_minute) : '--'; } },
  ]);
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
  var table = '<section class="card">' + head('Every creature', esc(d.label)) +
    sortTable('creatures', 'Every creature', creatureCols(false).concat([
      { h: 'Profile', text: true, v: function (c) { return c.profiles.join(', '); }, c: function (c) { return esc(c.profiles.join(', ')); } },
      { h: 'Last kill', v: function (c) { return c.last_kill; }, c: function (c) { return c.last_kill ? stamp(c.last_kill) : '--'; } },
    ]), d.creatures, { col: 1, dir: 'desc' }) + '</section>';
  return kpis + bars + table;
}

export function creatureCols(who) {
  return (who ? [who] : []).concat([
    { h: 'Creature', text: true, wrap: true, v: function (c) { return c.creature; }, c: function (c) { return esc(c.creature); } },
    { h: 'Kills', v: function (c) { return c.kills; }, c: function (c) { return num(c.kills); } },
    { h: 'Silver', v: function (c) { return c.silver; }, c: function (c) { return short(c.silver); } },
    { h: 'Silver / kill', v: function (c) { return c.silver_per_kill; }, c: function (c) { return c.silver_per_kill == null ? '--' : num(c.silver_per_kill); } },
    { h: 'Boxes', v: function (c) { return c.boxes; }, c: function (c) { return num(c.boxes); } },
    { h: 'Boxes / 100', v: function (c) { return c.boxes_per_100; }, c: function (c) { return c.boxes_per_100 == null ? '--' : String(c.boxes_per_100); } },
  ]);
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
  var types = '<section class="card">' + head('By type', esc(d.label)) + sortTable('btypes', 'Bounties by type', bountyCols(false), d.types, { col: 1, dir: 'desc' }) + '</section>';
  var o = d.offers, offers = '';
  if (o && o.offered) {
    var order = ['accepted', 'completed', 'removed', 'replaced', 'expired', 'open'];
    var keys = Object.keys(o.by_outcome).sort(function (x, y) { return (order.indexOf(x) + 99) % 99 - (order.indexOf(y) + 99) % 99; });
    offers = '<section class="card">' + head('Task offers', esc(d.label) + ' ' + DOT + ' ' + plural(o.offered, 'offer') + ', ' + o.expedited + ' with a voucher') +
      barRows(keys.map(function (k) { return { label: k, value: o.by_outcome[k] }; }), num, '--k1') + '</section>';
  }
  return kpis + types + offers;
}

export function bountyCols(who) {
  var opt = function (v, f) { return v == null ? '--' : f(v); };
  return (who ? [who] : []).concat([
    { h: 'Type', text: true, v: function (t) { return t.type; }, c: function (t) { return esc(t.type); } },
    { h: 'Taken', v: function (t) { return t.received; }, c: function (t) { return num(t.received); } },
    { h: 'Done', v: function (t) { return t.completed; }, c: function (t) { return num(t.completed); } },
    { h: 'Success', v: function (t) { return t.success_pct; }, c: function (t) { return opt(t.success_pct, function (v) { return v + '%'; }); } },
    { h: 'Average time', v: function (t) { return t.avg_seconds; }, c: function (t) { return opt(t.avg_seconds, dur); } },
    { h: 'Silver each', v: function (t) { return t.avg_silver; }, c: function (t) { return opt(t.avg_silver, short); } },
    { h: 'Exp each', v: function (t) { return t.avg_exp; }, c: function (t) { return opt(t.avg_exp, num); } },
    { h: 'Points each', v: function (t) { return t.avg_points; }, c: function (t) { return opt(t.avg_points, num); } },
    { h: 'Points / hr', title: 'Bounty points per hour of bounty time', v: function (t) { return t.points_per_hour; }, c: function (t) { return opt(t.points_per_hour, num); } },
  ]);
}

// ---- progress -----------------------------------------------------------------
function meterRow(label, pct, text, sub) {
  return '<div class="prog"><div class="prog-top"><span class="prog-lab">' + label + '</span><span class="prog-val">' + text + '</span></div>' +
    '<div class="meter big" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + Math.min(100, Math.max(0, pct)) + '%"></span></div>' +
    (sub ? '<div class="prog-sub">' + sub + '</div>' : '') + '</div>';
}
function eta(seconds) { return seconds == null ? 'no recent pace' : 'about ' + when(seconds) + ' at the recent pace'; }

// The reader's own target for this character (saved in the browser)
function targetHtml(p, ui) {
  var t = ui && ui.target ? targetEta(p, ui.target) : null, draft = (ui && ui.draft) || {};
  var kinds = p.capped ? [['tp', 'Training points past the cap'], ['atp', 'Ascension points']] : [['level', 'Level'], ['atp', 'Ascension points']];
  var kind = draft.kind || (t && t.kind) || kinds[0][0];
  var shown_ = t ? meterRow(esc(t.label), t.pct, t.reached ? 'reached' : short(t.need) + ' to go', t.reached ? 'Done. Set the next one below.' : eta(t.eta)) +
    '<button type="button" class="link-btn" data-target-clear>Clear the target</button>' : '<p class="small muted">Set a goal and see when you get there at your recent pace. It is saved in this browser.</p>';
  return '<section class="card">' + head('Your target', t ? '' : 'none set') + shown_ +
    '<form class="filters target-form" id="targetForm"><label class="fl"><span>Target</span><select id="targetKind">' + kinds.map(function (k) {
      return '<option value="' + k[0] + '"' + (k[0] === kind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label>' +
    '<label class="fl"><span>Value</span><input id="targetValue" type="number" min="1" max="' + (kind === 'level' ? 100 : 100000) + '" inputmode="numeric" required value="' +
      esc(draft.value != null ? draft.value : t ? t.value : '') + '"></label>' +
    '<button class="btn primary" type="submit">' + (t ? 'Change target' : 'Set target') + '</button></form></section>';
}

export function progressHtml(d, width, ui) {
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
  return top + meters + targetHtml(p, ui) + chart + tiles + stings;
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
      esc(STATE_NAME[c.type] || c.type) + '</span></td><td>' + (c.stale ? '<span class="muted">ended, time unknown</span>' : c.end == null ? dur(c.seconds) + ' so far' : dur(c.seconds)) + '</td><td class="l wrapcell">' +
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

// ---- comparing characters ---------------------------------------------------------
// names: id -> display name; state: id -> overview entry (or none, shown offline)
export function compareHtml(d, names, entry) {
  var who = function (page) {
    return { h: 'Character', text: true, v: function (r) { return shown(names[r.id] || r.id); }, c: function (r) {
      var e = entry(r.id) || { name: names[r.id] || r.id, state: { type: 'offline' } };
      return '<a class="cell-ch" href="' + hrefFor(r.id, page) + '" data-who="' + esc(r.id) + '" data-sec="' + page + '">' + avatar(e, 'xs') + '<b>' + esc(shown(e.name)) + '</b></a>';
    } };
  };
  if (!d.income.length && !d.creatures.length && !d.bounties.length && !d.shops.length) {
    return empty('layers', 'Nothing to compare ' + esc(d.label.toLowerCase()), 'Pick a longer range, or play a little first.');
  }
  var sec = function (title, note, html) { return '<section class="card">' + head(title, note) + html + '</section>'; };
  var none = function (text) { return '<p class="small muted">' + text + '</p>'; };
  return sec('Income', esc(d.label), d.income.length ? sortTable('cmp-income', 'Income by character', [who('income'),
      { h: 'Taken in', v: function (r) { return r.total_in; }, c: function (r) { return short(r.total_in); } },
      { h: 'Spent', v: function (r) { return r.total_out; }, c: function (r) { return short(r.total_out); } },
      { h: 'Net', v: function (r) { return r.net; }, c: function (r) { return short(r.net); } },
      { h: 'Biggest source', text: true, v: function (r) { return r.top || ''; }, c: function (r) { return esc(r.top || '--'); } },
    ], d.income, { col: 3, dir: 'desc' }) : none('No silver recorded in this range.')) +
    sec('Shops and stops', esc(d.label) + ' ' + DOT + ' where the time and silver went', d.shops.length
      ? sortTable('cmp-shops', 'Shops and stops by character', shopCols(who('income')), d.shops, { col: 7, dir: 'desc' }) : none('No shop stops recorded in this range.')) +
    (d.towns.length ? sec('By town', esc(d.label), sortTable('cmp-towns', 'Towns by character', [who('income'),
      { h: 'Town', text: true, v: function (t) { return t.town; }, c: function (t) { return esc(t.town); } },
      { h: 'Stops', v: function (t) { return t.visits; }, c: function (t) { return num(t.visits); } },
      { h: 'Time', v: function (t) { return t.seconds; }, c: function (t) { return dur(t.seconds); } },
      { h: 'Silver', v: function (t) { return t.silver; }, c: function (t) { return short(t.silver); } },
      { h: 'Silver / min', v: function (t) { return t.silver ? t.per_minute : null; }, c: function (t) { return t.silver && t.per_minute != null ? short(t.per_minute) : '--'; } },
    ], d.towns, { col: 5, dir: 'desc' })) : '') +
    sec('Creatures', esc(d.label), d.creatures.length
      ? sortTable('cmp-creatures', 'Creatures by character', creatureCols(who('hunting')), d.creatures, { col: 2, dir: 'desc' }) : none('No kills recorded in this range.')) +
    sec('Bounties by type', esc(d.label), d.bounties.length
      ? sortTable('cmp-bounties', 'Bounty types by character', bountyCols(who('bounties')), d.bounties, { col: 2, dir: 'desc' }) : none('No bounties in this range.'));
}
