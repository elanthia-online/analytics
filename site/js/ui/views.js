// The two views as HTML strings: everyone (overview) and one character
// (detail). They only read the aggregation's JSON; app.js puts them on the page.
import { DOT, esc, css, hrefFor, num, short, dur, clock, stamp, plural, ago, nowSrv, delta, status, stateHtml, shown, nameParts, avatar,
         stat, reasonsHtml, bountyText, meter, LIGHT, STATE_COL } from './util.js';
import { timeline, dayStrip, trendChart, stepBar } from './charts.js';
import { icon } from './icons.js';
import { scroll, nameHtml, kpi, head, statusTag, tile, unit } from './parts.js';
import { SECTION_NAMES, sectionIcon, incomeHtml, huntingHtml, bountiesHtml, progressHtml, historyHtml, compareHtml } from './sections.js';
import { DETAIL_RANGES } from '../aggregate/details.js';
import { barChart } from './charts.js';

var CATEGORICAL = ['--k1', '--k2', '--k3', '--k4', '--k5', '--k6', '--k7', '--k8'];

function greeting(ts) {
  var h = new Date(ts * 1000).getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function paceKpi(lab, m) {
  // Three to a card leaves no room for words beside the number: the tooltip says what it compares
  var sub = m.pct == null ? '<span class="muted" title="Not enough days yet to say what is typical">building<span class="sr"> a baseline</span></span>' : '<span title="vs typical by now">' + delta(m.pct, false, '') + '</span>';
  return stat(lab, short(m.so_far), sub);
}

// ---------------- everyone ----------------
function card(c, ov, on) {
  var b = c.bounty, level = c.light.level;
  return '<article class="card ch-card click lv-' + esc(level) + '" data-who="' + esc(c.id) + '">' +
    '<div class="ch-head">' + avatar(c) + '<div class="ch-id">' +
      '<h3 class="ch-name"><a class="ch-link" href="' + hrefFor(c.id) + '">' + nameHtml(c.name) + '</a></h3><div class="ch-meta">' + stateHtml(c.state) + '</div></div>' +
      '<span class="ch-actions no-export"><button class="pin' + (on ? ' on' : '') + '" type="button" data-pin="' + esc(c.id) + '" title="' + (on ? 'Unpin' : 'Pin to the top') +
      '" aria-label="' + (on ? 'Unpin ' : 'Pin ') + esc(shown(c.name)) + '" aria-pressed="' + on + '">' + icon('star') + '</button>' +
      '<button class="pin hide-btn" type="button" data-hide="' + esc(c.id) + '" title="Hide from the overview" aria-label="Hide ' + esc(shown(c.name)) + ' from the overview">' +
      icon('eyeoff') + '</button></span></div>' +
    dayStrip(c, ov.day_start, esc(c.id).replace(/\W/g, '_')) +
    (c.light.reasons.length ? reasonsHtml(c.light)
      : '<ul class="reasons"><li>' + status(level) + '<span>' + LIGHT[level][1] + '</span></li></ul>') +
    '<div class="kpis">' + paceKpi('Silver', c.pace.silver) + paceKpi('Experience', c.pace.exp) + paceKpi('Bounties', c.pace.bounties) + '</div>' +
    '<div class="facts">' +
      '<div class="fact-b"><div class="fact"><span>Active bounty</span><span>' + bountyText(b) + '</span></div>' + meter(b) + '</div>' +
      '<div class="fact"><span>Last kill</span><span data-ago="' + (c.last_kill || '') + '"></span></div>' +
      '<div class="fact"><span>Last bounty</span><span data-ago="' + (c.last_bounty || '') + '"></span></div>' +
    '</div></article>';
}

// Silver by character as one bar, each character on its categorical slot in
// the database's order (so a pin never repaints anyone)
function shareBar(ov, visible) {
  var total = ov.characters.reduce(function (a, c) { return a + (visible(c.id) ? c.pace.silver.so_far || 0 : 0); }, 0);
  if (!total) return '';
  var order = ov.characters.slice(), slot = {};
  order.forEach(function (c, i) { slot[c.id] = CATEGORICAL[i] || '--gray'; });
  var parts = order.filter(function (c) { return visible(c.id) && c.pace.silver.so_far > 0; });
  return '<div class="share"><div class="share-bar" aria-hidden="true">' + parts.map(function (c) {
    var pct = c.pace.silver.so_far * 100 / total;
    return '<span style="flex:' + c.pace.silver.so_far + ' 1 0;background:' + css(slot[c.id]) + '" data-tip="' + esc(shown(c.name) + ' ' + DOT + ' ' + short(c.pace.silver.so_far) + ' (' + Math.round(pct) + '%)') + '"></span>';
  }).join('') + '</div><div class="share-leg"><span class="sr">Share of silver today:</span>' + parts.map(function (c) {
    return '<span><i style="background:' + css(slot[c.id]) + '"></i>' + esc(shown(c.name)) + ' <b>' + Math.round(c.pace.silver.so_far * 100 / total) + '%</b></span>';
  }).join('') + '</div></div>';
}

// The alerts a reader can turn off, and the threshold each has (if any)
export var ALERT_KINDS = [
  ['dead', 'Dead'],
  ['idle', 'Idle', 'idle_minutes', 'Minutes (red at twice)'],
  ['no_kills', 'No kills while hunting', 'no_kill_minutes', 'Minutes'],
  ['pace_silver', 'Silver behind typical'],
  ['pace_exp', 'Exp behind typical'],
  ['deaths', 'Deaths today'],
  ['item_rests', 'Rests for the item limit'],
  ['crashes', 'Crashes and idle recoveries'],
  ['bounty', 'A bounty taking much longer than usual'],
  ['rest_reasons', 'Many more rests than usual for one reason'],
  ['encumbrance', 'Starting hunts heavier than usual', 'encumbrance_points', 'Points over typical'],
  ['mind', 'Starting hunts with a full mind', 'mind_pct', 'Percent full']
];

// The Alerts card's settings: which show, and their thresholds (saved in this browser)
function alertSettingsHtml(a, open) {
  var num = function (key, label, min, max) {
    return '<label class="fl as-num"><span>' + esc(label) + '</span><input type="number" inputmode="numeric" min="' + min + '" max="' + max + '" step="1" data-alert-num="' +
      key + '" value="' + esc(String(a[key])) + '"></label>';
  };
  return '<details class="alert-settings no-export"' + (open ? ' open' : '') + '><summary>' + icon('settings') + '<span>Alert settings: choose which alerts show</span></summary>' +
    '<p class="small muted">Saved in this browser only. The script\'s in-game and Discord alerts are set in its settings file.</p>' +
    '<fieldset class="as-list"><legend class="sr">Alerts to show</legend>' + ALERT_KINDS.map(function (k) {
      return '<div class="as-row"><label class="as-check"><input type="checkbox" data-alert-on="' + k[0] + '"' + (a[k[0]] ? ' checked' : '') + '><span>' + esc(k[1]) + '</span></label>' +
        (k[2] ? num(k[2], k[3], 1, 1000) : '') + '</div>';
    }).join('') + '</fieldset>' +
    '<div class="filters as-pace">' + num('pace_amber_pct', 'Behind typical pace: amber at % below', 1, 100) + num('pace_red_pct', 'red at % below', 1, 100) + '</div>' +
    '<button type="button" class="btn" data-alerts-reset>Back to the defaults</button></details>';
}

function alertsHtml(ov, visible, dismissedCount) {
  var alerts = ov.alerts.filter(function (a) { return visible(a.id); });
  var undo = dismissedCount ? '<p class="small muted as-undo">' + plural(dismissedCount, 'alert') + ' dismissed for today &middot; <button type="button" class="link-btn" data-undismiss>Show ' +
    (dismissedCount === 1 ? 'it' : 'them') + ' again</button></p>' : '';
  if (!alerts.length) return undo + '<div class="empty ok">' + status('green') + '<div><b>Nothing to flag</b><div class="small muted">Every character is running normally.</div></div></div>';
  var groups = [['red', 'Problems'], ['amber', 'Needs a look']];
  return undo + '<div class="alerts">' + groups.map(function (g) {
    var list = alerts.filter(function (a) { return a.level === g[0]; });
    if (!list.length) return '';
    return '<div class="ag"><h3 class="ag-head">' + status(g[0]) + '<span>' + g[1] + '</span><span class="count"><span class="sr">(</span>' + list.length + '<span class="sr">)</span></span></h3>' +
      list.map(function (a) {
        return '<div class="alert-row"><a class="alert" data-who="' + esc(a.id) + '" href="' + hrefFor(a.id) + '"><span class="al-text"><b>' + esc(shown(a.character)) + '</b><span>' + esc(a.text) + '</span></span>' +
          icon('chevron', 'al-go') + '</a>' + (a.kind ? '<button type="button" class="icon-btn sm al-x no-export" data-dismiss="' + esc(a.id + '|' + a.kind) + '" title="Dismiss for today" aria-label="Dismiss for today: ' +
          esc(shown(a.character)) + ', ' + esc(a.text) + '">' + icon('x') + '</button>' : '') + '</div>';
      }).join('') + '</div>';
  }).join('') + '</div>';
}

// opts: { hidden: [ids], daily: buildDaily for the shown characters,
//         alertSettings, alertSettingsOpen, dismissedCount }
export function overviewHtml(ov, chars, pinned, width, opts) {
  opts = opts || {};
  var hidden = opts.hidden || [];
  var visible = function (id) { return hidden.indexOf(id) < 0; };
  if (!ov.characters.length) {
    return '<div class="card empty big">' + icon('pulse', 'empty-ic') + '<h3>No characters with data in the last day</h3><p class="muted">Run analytics.lic while you hunt and they will show up here.</p></div>';
  }
  var sum = function (f) { return chars.reduce(function (a, c) { return a + (f(c) || 0); }, 0); };
  var silver = sum(function (c) { return c.pace.silver.so_far; }), exp = sum(function (c) { return c.pace.exp.so_far; });
  // To the minute, like the stretches still going: a refresh with nothing new
  // leaves the figure (and so the overview) alone until the minute turns
  var hours = Math.max((Math.floor(nowSrv() / 60) * 60 - ov.day_start) / 3600, 1 / 60);
  var hunting = chars.filter(function (c) { return c.state.type === 'hunt'; }).length;
  var online = chars.filter(function (c) { return c.state.type !== 'offline'; }).length;
  var flagged = chars.filter(function (c) { return c.light.level === 'red'; }).length;
  var deaths = sum(function (c) { return c.today.deaths; });
  var today = new Date(ov.day_start * 1000).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  var top = '<div class="page-head"><div><div class="eyebrow">' + esc(today) + '</div><h1 tabindex="-1">' + greeting(nowSrv()) + '</h1>' +
    '<div class="chips"><span class="chip">' + icon('layers') + plural(chars.length, 'character') + '</span>' +
    '<span class="chip"><i style="background:var(--good)"></i>' + online + ' online</span>' +
    '<span class="chip"><i style="background:' + css(STATE_COL.hunt) + '"></i>' + hunting + ' hunting</span>' +
    (flagged ? '<span class="chip warn">' + status('red') + plural(flagged, 'problem') + '</span>' : '') + '</div></div></div>';

  var hero = '<div class="kpi-row"><div class="card hero">' +
      '<div class="hero-top"><span class="kpi-ic big">' + icon('coins') + '</span><div><div class="eyebrow">Silver today</div><div class="small muted">all characters</div></div></div>' +
      '<div class="hero-fig">' + short(silver) + '</div>' +
      '<div class="hero-sub"><b>' + short(silver / hours) + '</b> per hour since midnight</div>' + shareBar(ov, visible) +
    '</div><div class="kpi-grid">' +
      kpi('spark', 'Experience', short(exp), short(exp / hours) + ' / hr') +
      kpi('scroll', 'Bounties', num(sum(function (c) { return c.pace.bounties.so_far; })), 'completed') +
      kpi('target', 'Kills', num(sum(function (c) { return c.today.kills; })), 'creatures searched') +
      kpi('clock', 'Hunting time', dur(sum(function (c) { return c.today.hunt_s; })), 'across ' + plural(chars.length, 'character')) +
      kpi('skull', 'Deaths', num(deaths), deaths ? 'today' : 'none today') +
    '</div></div>';

  // Per hour the script ran today (hunting, resting or idle), as the reports
  // count it; under ten minutes of that is too little to divide by
  var perHour = function (c, value) {
    var ran = c.today.hunt_s + c.today.rest_s + c.today.idle_s;
    return ran >= 600 ? short(value * 3600 / ran) : '--';
  };
  var rows = chars.map(function (c) {
    var t = c.today;
    return '<tr class="click" data-who="' + esc(c.id) + '"><td><a class="cell-ch" href="' + hrefFor(c.id) + '">' + avatar(c, 'xs') + '<b>' + esc(shown(c.name)) + '</b></a></td>' +
      '<td>' + short(c.pace.silver.so_far) + '</td><td>' + perHour(c, c.pace.silver.so_far) + '</td>' +
      '<td>' + short(c.pace.exp.so_far) + '</td><td>' + perHour(c, c.pace.exp.so_far) + '</td><td>' + num(c.pace.bounties.so_far) +
      '</td><td>' + num(t.kills) + '</td><td>' + dur(t.hunt_s) + '</td><td>' + (t.uptime_pct == null ? '--' : t.uptime_pct + '%') +
      '</td><td>' + t.deaths + '</td></tr>';
  }).join('');

  return top + hero +
    '<section><div class="sec-head"><h2>Characters</h2><span class="note">Star a character to keep it first</span>' +
      (hidden.length ? '<span class="note">' + plural(hidden.length, 'hidden character') + ' &middot; <button type="button" class="link-btn" data-unhide-all>Show ' +
        (hidden.length === 1 ? 'it' : 'them') + '</button></span>' : '') + '</div>' +
      (chars.length ? '<div class="grid g-cards">' + chars.map(function (c) { return card(c, ov, pinned(c.id)); }).join('') + '</div>'
        : '<div class="card empty">Every character is hidden. <button type="button" class="link-btn" data-unhide-all>Show them</button></div>') + '</section>' +
    (chars.length ? '<section class="card">' + head('Activity today', 'Hover a stretch for its times') + timeline(chars, ov.day_start, 'ov', width) + '</section>' : '') +
    (opts.daily ? '<section class="card">' + head('Experience by day', 'last ' + opts.daily.labels.length + ' days' + (hidden.length ? ', shown characters' : ', every character')) +
      barChart('ov-daily', opts.daily.labels, [{ name: 'Experience', color: '--k1', values: opts.daily.labels.map(function (_, i) {
        return chars.reduce(function (a, c) { var s = opts.daily.series[c.id]; return a + (s ? s.exp[i] : 0); }, 0); }) }], short, width, 'Experience by day, all shown characters') + '</section>' : '') +
    '<section class="card" id="alertsCard">' + head('Alerts', ov.alerts.filter(function (a) { return visible(a.id); }).length ? plural(ov.alerts.filter(function (a) { return visible(a.id); }).length, 'item') : '') +
      (opts.alertSettings ? alertSettingsHtml(opts.alertSettings, opts.alertSettingsOpen) : '') + alertsHtml(ov, visible, opts.dismissedCount || 0) + '</section>' +
    '<section>' +
      '<div class="card">' + head('Side by side', 'today') + scroll('Side by side, today') + '<table><thead><tr><th>Character</th><th>Silver</th><th title="Silver per hour the script ran today">Silver / hr</th><th>Exp</th>' +
      '<th title="Experience per hour the script ran today">Exp / hr</th><th>Bounties</th><th>Kills</th><th>Hunting</th><th>Uptime</th><th>Deaths</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    '</section>';
}

export function rangeTabs(ranges, range) {
  return Object.keys(ranges).map(function (k) {
    return '<button type="button" data-r="' + k + '" class="' + (k === range ? 'on' : '') + '" aria-pressed="' + (k === range) + '">' + esc(ranges[k]) + '</button>'; }).join('');
}

// ---------------- comparing characters ----------------
// names: id -> name; entry(id): its overview entry, if it has one today;
// hid: the hidden characters' ids, every one the database has (played today or not),
// each with a Show button, since the overview and the menu list only today's
export function comparePageHtml(d, range, names, entry, hid) {
  hid = hid || [];
  var shownHid = hid.length ? '<p class="small muted cmp-hidden">Hidden: ' + hid.map(function (id) {
    var name = esc(shown(names[id] || id));
    return name + ' <button type="button" class="link-btn" data-unhide="' + esc(id) + '" aria-label="Show ' + name + '">Show</button>';
  }).join(' &middot; ') + '</p>' : '';
  return '<div class="page-head"><div><div class="eyebrow">' + plural(d.characters, 'character') + (hid.length ? ' &middot; ' + hid.length + ' hidden' : '') + '</div>' +
    '<h1 tabindex="-1">Compare characters</h1><p class="small muted">Each character\'s income, shop stops, creatures and bounties side by side. Choose a column heading to sort by it.</p>' + shownHid + '</div>' +
    '<div class="tabs" id="cmpTabs" role="group" aria-label="Range">' + rangeTabs(DETAIL_RANGES, range) + '</div></div>' +
    '<div class="section-body">' + compareHtml(d, names, entry) + '</div>';
}

// ---------------- one character ----------------

// section: one of SECTIONS; data: that page's figures; filter: the history filter.
// Returns { bar, nav, label, body }: the insides of the bar and the page tabs,
// whose boxes stay put when only the page changes, and the page itself.
// ui: the reader's own state for the page (the Progress target)
export function detailHtml(c, range, width, section, data, filter, ui) {
  section = section || 'summary';
  var t = c.trend, rs = c.range_stats, b = c.bounty, mind = c.mind, enc = c.encumbrance;
  // The summary keeps its three ranges (its trends are built for them); the other pages take five
  var tabs = rangeTabs(section === 'summary' ? c.ranges : DETAIL_RANGES, range);
  var basis = t.hourly ? 'hours with ' + t.min_hunt_minutes + '+ min of hunting over the last ' + t.baseline_days + ' days'
                       : 'days with ' + (t.min_hunt_minutes / 60) + '+ hours of hunting over the last ' + t.baseline_days + ' days';
  var light = LIGHT[c.light.level] || LIGHT.gray;

  // The insides of the bar and of the page tabs; app.js keeps their boxes
  var bar = '<button type="button" id="back" class="back">' + icon('back') + '<span>Overview</span></button>' +
    '<span class="sb-sep">/</span><span class="sb-name">' + nameHtml(c.name) + '</span><span class="spacer"></span>' +
    (section === 'progress' ? '<span class="small muted">Pace from the last 7 days</span>' : '<div class="tabs" id="tabs" role="group" aria-label="Range">' + tabs + '</div>');
  var nav = Object.keys(SECTION_NAMES).map(function (k) {
    return '<li><a href="' + hrefFor(c.id, k) + '" data-who="' + esc(c.id) + '" data-sec="' + k + '"' + (k === section ? ' aria-current="page" class="on"' : '') + '>' +
      icon(sectionIcon(k)) + '<span>' + SECTION_NAMES[k] + '</span></a></li>';
  }).join('');
  var label = shown(c.name) + ' pages';
  if (section !== 'summary') {
    var slim = '<div class="card profile slim lv-' + esc(c.light.level) + '"><div class="profile-top">' + avatar(c) +
      '<div class="profile-id"><h1 class="ch-name" tabindex="-1">' + nameHtml(c.name) + ' <span class="page-of">' + SECTION_NAMES[section] + '</span></h1>' +
      '<div class="ch-meta">' + stateHtml(c.state) + (c.state.profile ? '<span class="tag">' + icon('map') + esc(c.state.profile) + '</span>' : '') + '</div></div>' +
      '<div class="health-mini">' + status(c.light.level) + '<span>' + light[1] + '</span></div></div></div>';
    var body = !data ? '<div class="card empty">Nothing to show.</div>'
      : section === 'income' ? incomeHtml(data) : section === 'hunting' ? huntingHtml(data) : section === 'bounties' ? bountiesHtml(data)
      : section === 'progress' ? progressHtml(data, width, ui) : historyHtml(data, filter || { type: 'all', q: '' });
    return { bar: bar, nav: nav, label: label, body: slim + '<div class="section-body">' + body + '</div>' };
  }

  var profile = '<div class="card profile lv-' + esc(c.light.level) + '">' +
      '<div class="profile-top">' + avatar(c, 'big') +
        '<div class="profile-id"><h1 class="ch-name" tabindex="-1">' + nameHtml(c.name) + '</h1>' +
          '<div class="ch-meta">' + stateHtml(c.state) +
          (c.state.profile ? '<span class="tag">' + icon('map') + esc(c.state.profile) + '</span>' : '') +
          (c.state.type === 'rest' && c.state.reason ? '<span class="small muted">resting: ' + esc(c.state.reason) + '</span>' : '') + '</div></div>' +
        '<div class="health"><div class="health-head">' + status(c.light.level) + '<span>' + light[1] + '</span></div>' +
          (reasonsHtml(c.light) || '<p class="small muted">Nothing unusual right now.</p>') + '</div>' +
      '</div>' +
      '<div class="tiles">' +
        tile('target', 'Last kill', '<span data-ago="' + (c.last_kill || '') + '"></span>', c.last_kill ? clock(c.last_kill) : 'none yet') +
        tile('scroll', 'Last bounty', '<span data-ago="' + (c.last_bounty || '') + '"></span>', c.last_bounty ? clock(c.last_bounty) : 'none yet') +
        tile('trend', 'Active bounty', b ? (b.need ? b.done + unit('/' + b.need) : esc(b.type)) : '--',
             b ? esc(b.target || b.type) + ' ' + DOT + ' ' + dur(b.age) + (b.typical ? ' (typ ' + dur(b.typical) + ')' : '') : 'none active', meter(b)) +
        (c.login ? tile('wifi', c.login.live ? 'This login' : 'Last login', short(c.login.silver) + unit(' silver'),
            short(c.login.silver_hr) + '/hr ' + DOT + ' ' + short(c.login.exp) + ' exp ' + DOT + ' ' + plural(c.login.deaths, 'death') + ' ' + DOT + ' since ' + stamp(c.login.since)) : '') +
        tile('bell', 'Crashes today', num(c.crashes.length), c.crashes.map(function (x) { return clock(x.at) + ' ' + esc(x.reason); }).join(', ') || 'none') +
      '</div>' +
      '<div class="divider"></div>' + head('Activity today') + timeline([c], c.day_start, 'det', width) +
    '</div>';

  var perf = '<section class="card">' + head('Performance', esc(c.label)) +
    '<div class="tiles perf">' +
      tile('coins', 'Silver', short(rs.silver), '<b>' + short(rs.silver_hr) + '</b> / hr ' + DOT + ' <b>' + short(rs.silver_hunt_hr) + '</b> / hunt hr', '', 'lead') +
      tile('spark', 'Experience', short(rs.exp), short(rs.exp_hr) + ' / hr ' + DOT + ' ' + short(rs.exp_hunt_hr) + ' / hunt hr') +
      tile('scroll', 'Bounties', num(rs.bounties), (rs.bounties_hunt_hr == null ? '--' : rs.bounties_hunt_hr) + ' / hunt hr ' + DOT + ' ' + rs.abandoned + ' abandoned') +
      tile('target', 'Kills', num(rs.kills), plural(rs.deaths, 'death')) +
      tile('layers', 'Task offers', num(c.offers.offered), c.offers.removed + ' removed ' + DOT + ' ' + c.offers.expedited + ' expedited') +
      tile('clock', 'Avg hunt / rest', dur(rs.hunt_avg) + unit(' / ') + dur(rs.rest_avg),
           rs.hunts + ' hunts ' + DOT + ' ' + (rs.uptime_pct == null ? '--' : rs.uptime_pct + '%') + ' hunting') +
    '</div>' +
    '<div class="sec-head inner"><h3>Trends</h3><span class="note">Typical = average of ' + esc(basis) + '</span></div>' +
    '<div class="grid g-charts">' + Object.keys(c.trends).map(function (k) {
      return '<div class="chart">' + trendChart(k, c.trends[k], t.labels, t.hourly, icon) + '</div>'; }).join('') + '</div></section>';

  var reasonRows = c.rest_reasons.length ? c.rest_reasons.map(function (r) {
    var hot = r.typical != null && r.today >= 3 && r.today >= r.typical * 2 + 1;
    return '<tr' + (hot ? ' class="mark"' : '') + '><td class="wrapcell">' + esc(r.reason) + (hot ? ' <span class="tag t-hot"><i></i>high</span>' : '') + '</td><td>' + r.today + '</td><td>' + (r.typical == null ? '--' : r.typical) + '</td></tr>'; }).join('')
    : '<tr><td colspan="3" class="muted">No rests yet today</td></tr>';
  var rest = '<section class="grid g-2">' +
    '<div class="card">' + head('Average rest', esc(c.label) + ' ' + DOT + ' time per step') + stepBar(c.steps) +
      '<div class="divider"></div>' + head('Rest reasons today', '', '', 3) +
      scroll('Rest reasons today') + '<table><thead><tr><th>Reason</th><th>Today</th><th>Typical by now</th></tr></thead><tbody>' + reasonRows + '</tbody></table></div></div>' +
    '<div class="card">' + head('Mind and load', 'today') + '<div class="tiles two">' +
      tile('brain', 'Mind at hunt start', mind.start_avg == null ? '--' : Math.round(mind.start_avg) + '%', 'average') +
      tile('brain', 'Mind at hunt end', mind.end_avg == null ? '--' : Math.round(mind.end_avg) + '%', plural(mind.samples, 'hunt')) +
      tile('rest', 'Absorbed per rest', mind.absorbed_per_rest == null ? '--' : num(mind.absorbed_per_rest), mind.absorbed_per_min == null ? 'field exp' : mind.absorbed_per_min + ' per minute of rest') +
      tile('bag', 'Encumbrance at start', enc.today == null ? '--' : Math.round(enc.today) + '%', enc.typical == null ? 'no baseline yet' : 'typical ' + Math.round(enc.typical) + '%') +
    '</div><p class="small muted note-p">Mind percentages need mind capacity, recorded from this update on.</p></div></section>';

  var grounds = c.grounds.length ? scroll('Hunting grounds') + '<table><thead><tr><th>Profile</th><th>Hours</th><th>Exp / hunt hr</th><th>Kills / hunt hr</th><th title="Silver from creatures per hour of hunting">Silver / hr</th><th>Deaths</th></tr></thead><tbody>' +
    c.grounds.map(function (g) {
      var cur = c.state.profile && g.profile === c.state.profile;
      return '<tr' + (cur ? ' class="mark"' : '') + '><td>' + esc(g.profile) + (cur ? ' <span class="tag t-live"><i></i>now</span>' : '') + '</td><td>' + g.hours + '</td><td>' + num(g.exp_hr) + '</td><td>' + g.kills_hr +
        '</td><td>' + short(g.silver_hr) + '</td><td>' + g.deaths + '</td></tr>'; }).join('') + '</tbody></table></div>'
    : '<div class="empty small">Needs at least an hour of hunting in a profile.</div>';
  var recent = c.recent_bounties.length ? scroll('Recent bounties') + '<table><thead><tr><th>Received</th><th class="l">Type</th><th class="l">Target</th><th class="l">Status</th><th>Took</th><th>Silver</th><th>Exp</th></tr></thead><tbody>' +
    c.recent_bounties.map(function (r) {
      return '<tr><td>' + clock(r.received) + '</td><td class="l">' + esc(r.type) + '</td><td class="l wrapcell">' + esc(r.target) + '</td><td class="l">' + statusTag(r.status) + '</td><td>' + dur(r.took) +
        '</td><td>' + short(r.silver) + '</td><td>' + short(r.exp) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    : '<div class="empty small">No bounties yet.</div>';
  var offers = c.offers.recent.length ? scroll('Task offers') + '<table><thead><tr><th>Offered</th><th class="l">Task</th><th class="l">Outcome</th><th class="l">Voucher</th></tr></thead><tbody>' +
    c.offers.recent.map(function (o) {
      return '<tr' + (o.outcome === 'removed' ? ' class="mark"' : '') + '><td>' + clock(o.at) + '</td><td class="l wrapcell">' + esc(o.task) + '</td><td class="l">' + statusTag(o.outcome) +
        '</td><td class="l">' + (o.expedited ? 'expedited' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
    : '<div class="empty small">No tasks offered in this range.</div>';

  return { bar: bar, nav: nav, label: label, body: profile + perf + rest +
    '<section class="card">' + head('Recent bounties') + recent + '</section>' +
    '<section class="card">' + head('Hunting grounds', 'last 30 days, best exp first') + grounds + '</section>' +
    '<section class="card">' + head('Task offers', esc(c.label) + ' ' + DOT + ' removed in bold') + offers + '</section>' };
}

// The sidebar's list of characters; hidden ones go in a group of their own
export function navHtml(ov, chars, who, hidden, hiddenOpen) {
  hidden = hidden || [];
  var link = function (c) {
    var on = c.id === who, lv = c.light.level;
    return '<a class="nav-ch' + (on ? ' on' : '') + '" data-who="' + esc(c.id) + '" href="' + hrefFor(c.id) + '"' + (on ? ' aria-current="page"' : '') + '>' +
      avatar(c, 'sm') + '<span class="nav-txt"><span class="nav-name">' + esc(shown(c.name)) + '</span>' +
      '<span class="nav-sub">' + esc(({ hunt: 'Hunting', rest: 'Resting', idle: 'Idle', dead: 'Dead', offline: 'Offline' })[c.state.type] || c.state.type) + ' ' + DOT + ' ' + short(c.pace.silver.so_far) + '</span></span>' +
      (lv === 'red' || lv === 'amber' ? status(lv, 'nav-flag') : '') + '</a>';
  };
  var shownChars = chars.filter(function (c) { return hidden.indexOf(c.id) < 0; });
  var hid = chars.filter(function (c) { return hidden.indexOf(c.id) >= 0; });
  return shownChars.map(link).join('') + (hid.length ? '<details class="nav-hidden"' + (hiddenOpen ? ' open' : '') + '><summary>' + icon('eyeoff') +
    '<span>Hidden</span><span class="count">' + hid.length + '</span></summary>' + hid.map(function (c) {
      return '<div class="nav-row">' + link(c) + '<button type="button" class="icon-btn sm" data-unhide="' + esc(c.id) + '" title="Show on the overview" aria-label="Show ' +
        esc(shown(c.name)) + ' on the overview">' + icon('eye') + '</button></div>';
    }).join('') + '</details>' : '');
}
