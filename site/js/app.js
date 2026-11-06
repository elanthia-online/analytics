// The dashboard UI. Ported from the page analytics.lic served (Dashboard::PAGE)
// with as few changes as possible; what changed is the plumbing near the end:
// data comes from data.js (a database opened in this browser) instead of
// the script's /api/overview and /api/character. See docs/architecture.md.
import { Dashboard, LiveSource, FolderSource, FileSource, rememberSource, rememberedSource, savedFolder } from './data.js';

// Symbols are built from code points so this file stays plain ASCII
function U(code) { return String.fromCharCode(code); }
(function () {
  // Theme button: Auto (follow the system), Light, Dark, and round again
  var themeBtn = document.getElementById('theme'), THEMES = ['auto', 'light', 'dark'];
  var ICON = { auto: U(0x25D0), light: U(0x2600), dark: U(0x263E) };
  function showTheme() {
    var t = document.documentElement.getAttribute('data-theme') || 'auto';
    themeBtn.textContent = ICON[t] + ' ' + t.charAt(0).toUpperCase() + t.slice(1);
    themeBtn.setAttribute('aria-label', 'Theme: ' + t);
  }
  themeBtn.onclick = function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'auto';
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { if (next === 'auto') localStorage.removeItem('gs4a-theme'); else localStorage.setItem('gs4a-theme', next); } catch (e) {}
    showTheme();
  };
  showTheme();
})();
(function () {
  var who = decodeURIComponent(location.hash.slice(1)), range = 'daily';
  var ov = null, det = null, offset = 0, failed = 0, dash = null, feed = null, errorText = '';
  // Rest steps in a fixed order, each on its own categorical slot
  var STEP_ORDER = ['travel', 'selling', 'eloot', 'bounty', 'healing', 'spells', 'other scripts', 'waiting'];
  var STEP_COL = { travel: '--k1', selling: '--k2', eloot: '--k3', bounty: '--k4', healing: '--k5', spells: '--k6', 'other scripts': '--k7', waiting: '--gray' };
  var STEP_DARK_TEXT = { bounty: true };
  var STATE_COL = { hunt: '--st-hunt', rest: '--st-rest', idle: '--st-idle', dead: '--st-dead', offline: '--gray' };
  var STATE_NAME = { hunt: 'Hunting', rest: 'Resting', idle: 'Idle', dead: 'Dead', offline: 'Offline' };
  var LIGHT = { green: [U(0x2713), 'All normal'], amber: ['!', 'Needs a look'], red: ['!', 'Problem'], gray: [U(0x2013), 'Not running'] };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function css(v) { return 'var(' + v + ')'; }
  function num(n) { return n == null ? '--' : Math.round(n).toLocaleString('en-US'); }
  function short(n) {
    if (n == null) return '--';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K';
    if (a > 0 && a < 10 && a % 1) return s + a.toFixed(1);
    return s + Math.round(a).toLocaleString('en-US');
  }
  function dur(sec) {
    if (sec == null) return '--';
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + ':' + String(s).padStart(2, '0');
  }
  // A snapshot's clock stands still at the moment it was saved
  function nowSrv() { return feed && !feed.live && ov ? ov.generated_at : Date.now() / 1000 + offset; }
  function ago(ts) {
    if (!ts) return '--';
    var s = Math.max(0, nowSrv() - ts);
    if (s < 60) return Math.round(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function clock(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function stamp(ts) { return new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  // A change vs typical: arrow and sign, green when it's the good direction
  function delta(p, highBad, suffix) {
    if (p == null) return '';
    var r = Math.round(p);
    if (r === 0) return '<span class="delta flat">0%' + (suffix || '') + '</span>';
    var good = (r > 0) !== !!highBad;
    return '<span class="delta ' + (good ? 'good' : 'bad') + '">' + (r > 0 ? U(0x25B2) + ' +' : U(0x25BC) + ' ') + r + '%' + (suffix || '') + '</span>';
  }
  function status(level, cls) {
    var l = LIGHT[level] || LIGHT.gray;
    return '<span class="status s-' + esc(level) + (cls ? ' ' + cls : '') + '" title="' + l[1] + '" aria-label="' + l[1] + '">' + l[0] + '</span>';
  }
  function stateHtml(st) {
    return '<span class="state"><i style="background:' + css(STATE_COL[st.type] || '--gray') + '"></i>' + esc(STATE_NAME[st.type] || st.type) + '</span>' +
           '<span class="timer" data-since="' + (st.since || '') + '" data-type="' + esc(st.type) + '"></span>';
  }
  function initial(name) { return esc(String(name || '?').charAt(0).toUpperCase()); }
  function stat(lab, val, sub, cls) {
    return '<div' + (cls ? ' class="' + cls + '"' : '') + '><div class="stat-lab">' + lab + '</div><div class="stat-val">' + val + '</div>' +
           (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function reasonsHtml(light) {
    if (!light.reasons.length) return '';
    return '<ul class="reasons">' + light.reasons.map(function (r) { return '<li>' + status(r.level) + '<span>' + esc(r.text) + '</span></li>'; }).join('') + '</ul>';
  }
  // Clean axis steps (1, 2, 2.5, 5 x 10^n) so tick labels never repeat
  function nice(hi) {
    if (!(hi > 0)) return { max: 1, step: 0.25 };
    var raw = hi / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    return { max: step * Math.ceil(hi / step - 1e-9), step: step };
  }
  function bountyText(b) {
    if (!b) return 'None active';
    return esc(b.target || b.type) + (b.need ? ' ' + U(0x00B7) + ' ' + b.done + '/' + b.need : '');
  }
  function meter(b) {
    if (!b || !b.need) return '';
    return '<div class="meter" role="img" aria-label="' + b.done + ' of ' + b.need + '"><span style="width:' + Math.min(100, b.done * 100 / b.need) + '%"></span></div>';
  }

  // ---------------- timeline (shared) ----------------
  function timeline(chars, dayStart) {
    var multi = chars.length > 1;
    var longest = Math.max.apply(null, chars.map(function (c) { return String(c.name).length; }).concat([0]));
    var rowH = 30, barH = 16, L = multi ? Math.min(220, Math.max(70, Math.round(longest * 7.5 + 16))) : 0, W = 1000, R = 4, top = 2, n = chars.length, H = top + n * rowH + 20;
    var span = 86400, now = nowSrv();
    function x(t) { return L + (W - L - R) * Math.min(Math.max((t - dayStart) / span, 0), 1); }
    var svg = '';
    for (var h = 0; h <= 24; h += 3) {
      var hx = x(dayStart + h * 3600);
      svg += '<line x1="' + hx + '" x2="' + hx + '" y1="' + top + '" y2="' + (top + n * rowH) + '" stroke="var(--line)"/>' +
             '<text x="' + hx + '" y="' + (H - 4) + '" text-anchor="' + (h === 24 ? 'end' : h === 0 ? 'start' : 'middle') + '">' + (h === 24 ? '24' : String(h).padStart(2, '0')) + ':00</text>';
    }
    chars.forEach(function (c, i) {
      var y = top + i * rowH + (rowH - barH) / 2;
      if (multi) svg += '<text class="tl-name" x="0" y="' + (y + 12) + '">' + esc(c.name) + '</text>';
      svg += '<rect x="' + L + '" y="' + y + '" width="' + (W - L - R) + '" height="' + barH + '" rx="5" fill="var(--st-none)"/>';
      c.timeline.forEach(function (s) {
        var x1 = x(s[1]), x2 = x(s[2]);
        var tip = (STATE_NAME[s[0]] || s[0]) + ' ' + clock(s[1]) + ' ' + U(0x2013) + ' ' + clock(s[2]) + ' (' + dur(s[2] - s[1]) + ')' + (s[3] ? ' ' + U(0x00B7) + ' ' + s[3] : '');
        svg += '<rect x="' + x1.toFixed(1) + '" y="' + y + '" width="' + Math.max(1.2, x2 - x1).toFixed(1) + '" height="' + barH + '" fill="' + css(STATE_COL[s[0]] || '--gray') + '" data-tip="' + esc(tip) + '"/>';
      });
    });
    var nx = x(now);
    svg += '<line x1="' + nx + '" x2="' + nx + '" y1="' + top + '" y2="' + (top + n * rowH) + '" stroke="var(--ink)" stroke-width="1.5"/>' +
           '<circle cx="' + nx + '" cy="' + top + '" r="3" fill="var(--ink)"/>';
    var leg = ['hunt', 'rest', 'idle', 'dead'].map(function (k) {
      return '<span><i style="background:' + css(STATE_COL[k]) + '"></i>' + STATE_NAME[k] + '</span>'; }).join('') +
      '<span><i style="background:var(--st-none);box-shadow:inset 0 0 0 1px var(--line-2)"></i>No data</span>' +
      '<span><i style="background:var(--ink);width:2px;border-radius:0"></i>Now</span>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Activity today">' + svg + '</svg><div class="legend">' + leg + '</div>';
  }

  // ---------------- everyone ----------------
  // Pinned characters, saved in this browser, come first everywhere on the overview
  var pins = [];
  try { pins = JSON.parse(localStorage.getItem('gs4a-pins') || '[]') || []; } catch (e) { pins = []; }
  function pinned(id) { return pins.indexOf(id) >= 0; }
  function togglePin(id) {
    pins = pinned(id) ? pins.filter(function (p) { return p !== id; }) : pins.concat([id]);
    try { localStorage.setItem('gs4a-pins', JSON.stringify(pins)); } catch (e) {}
    renderOverview();
  }
  function ordered(list) {
    return list.filter(function (c) { return pinned(c.id); }).concat(list.filter(function (c) { return !pinned(c.id); }));
  }
  function paceKpi(lab, m) {
    // Three to a card leaves no room for words beside the number: the tooltip says what it compares
    var sub = m.pct == null ? 'no baseline yet' : '<span title="vs typical by now">' + delta(m.pct, false, '') + '</span>';
    return stat(lab, short(m.so_far), sub);
  }
  function card(c) {
    var on = pinned(c.id), b = c.bounty;
    return '<div class="card click" tabindex="0" data-who="' + esc(c.id) + '">' +
      '<div class="ch-head"><span class="avatar">' + initial(c.name) + '</span><div style="min-width:0">' +
        '<div class="ch-name">' + esc(c.name) + '</div><div class="ch-meta">' + stateHtml(c.state) + '</div></div>' +
        '<button class="pin no-export' + (on ? ' on' : '') + '" type="button" data-pin="' + esc(c.id) + '" title="' + (on ? 'Unpin' : 'Pin to the top') +
        '" aria-pressed="' + on + '">' + (on ? '&#9733;' : '&#9734;') + '</button></div>' +
      (c.light.reasons.length ? reasonsHtml(c.light)
        : '<ul class="reasons"><li>' + status(c.light.level) + '<span>' + LIGHT[c.light.level][1] + '</span></li></ul>') +
      '<div class="kpis">' + paceKpi('Silver today', c.pace.silver) + paceKpi('Exp today', c.pace.exp) + paceKpi('Bounties', c.pace.bounties) + '</div>' +
      '<div class="facts">' +
        '<div><div class="fact"><span>Active bounty</span><span>' + bountyText(b) + '</span></div>' + meter(b) + '</div>' +
        '<div class="fact"><span>Last kill</span><span data-ago="' + (c.last_kill || '') + '">' + ago(c.last_kill) + '</span></div>' +
        '<div class="fact"><span>Last bounty</span><span data-ago="' + (c.last_bounty || '') + '">' + ago(c.last_bounty) + '</span></div>' +
      '</div></div>';
  }
  function renderOverview() {
    if (!ov.characters.length) { $('overview').innerHTML = '<div class="card empty">No characters with data in the last day.</div>'; return; }
    var chars = ordered(ov.characters);
    var sum = function (f) { return chars.reduce(function (a, c) { return a + (f(c) || 0); }, 0); };
    var silver = sum(function (c) { return c.pace.silver.so_far; }), exp = sum(function (c) { return c.pace.exp.so_far; });
    var hours = Math.max((nowSrv() - ov.day_start) / 3600, 0.01);
    var hunting = chars.filter(function (c) { return c.state.type === 'hunt'; }).length;
    var online = chars.filter(function (c) { return c.state.type !== 'offline'; }).length;
    var deaths = sum(function (c) { return c.today.deaths; });
    var hero = '<div class="card hero">' +
      '<div class="hero-main"><div class="eyebrow">Silver today &middot; all characters</div><div class="hero-fig">' + short(silver) + '</div>' +
        '<div class="hero-sub">' + short(silver / hours) + ' per hour since midnight</div></div>' +
      '<div class="hero-stats">' +
        stat('Experience', short(exp), short(exp / hours) + ' / hr') +
        stat('Bounties', num(sum(function (c) { return c.pace.bounties.so_far; })), 'completed') +
        stat('Kills', num(sum(function (c) { return c.today.kills; })), 'creatures searched') +
        stat('Hunting time', dur(sum(function (c) { return c.today.hunt_s; })), 'across ' + plural(chars.length, 'character')) +
        stat('Deaths', num(deaths), deaths ? 'today' : 'none today') +
      '</div></div>';
    var rows = chars.map(function (c) {
      var t = c.today;
      return '<tr class="click" data-who="' + esc(c.id) + '"><td><b>' + esc(c.name) + '</b></td><td>' + short(c.pace.silver.so_far) + '</td><td>' + short(c.pace.exp.so_far) + '</td><td>' + num(c.pace.bounties.so_far) +
        '</td><td>' + num(t.kills) + '</td><td>' + dur(t.hunt_s) + '</td><td>' + (t.uptime_pct == null ? '--' : t.uptime_pct + '%') +
        '</td><td>' + t.deaths + '</td><td>' + c.crashes.length + '</td><td>' + t.item_rests + '</td></tr>';
    }).join('');
    var alerts = ov.alerts.length ? '<div class="alerts">' + ov.alerts.map(function (a) {
      return '<div class="alert" data-who="' + esc(a.id) + '">' + status(a.level) + '<span><b>' + esc(a.character) + '</b> &middot; ' + esc(a.text) + '</span></div>'; }).join('') + '</div>'
      : '<div class="empty">' + status('green') + ' Nothing to flag</div>';
    var today = new Date(ov.day_start * 1000).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('overview').innerHTML =
      '<div class="page-head"><div><h2>Today</h2><p>' + esc(today) + ' &middot; ' + plural(chars.length, 'character') + ', ' + online + ' online, ' + hunting + ' hunting</p></div></div>' +
      hero +
      '<section><div class="card-head"><h3>Characters</h3><span class="note">Pin with the star to keep a character first</span></div>' +
        '<div class="grid g-cards">' + chars.map(card).join('') + '</div></section>' +
      '<section class="card"><div class="card-head"><h3>Activity today</h3><span class="note">Hover a stretch for its times</span></div>' + timeline(chars, ov.day_start) + '</section>' +
      '<section class="grid g-split">' +
        '<div class="card"><div class="card-head"><h3>Alerts</h3></div>' + alerts + '</div>' +
        '<div class="card"><div class="card-head"><h3>Side by side</h3><span class="note">today</span></div><div class="scroll"><table><thead><tr><th>Character</th><th>Silver</th><th>Exp</th><th>Bounties</th>' +
        '<th>Kills</th><th>Hunting</th><th>Uptime</th><th>Deaths</th><th>Crashes</th><th title="Rests for the item limit">Items</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '</section>';
    bindWho($('overview'));
    Array.prototype.forEach.call($('overview').querySelectorAll('[data-pin]'), function (el) {
      el.onclick = function (e) { e.stopPropagation(); togglePin(el.getAttribute('data-pin')); };
    });
  }

  // ---------------- one character ----------------
  var FMT = { silver: short, exp: short, bounties: function (v) { return (Math.round(v * 10) / 10).toString(); }, kills: num,
              enc: function (v) { return Math.round(v) + '%'; }, mind: function (v) { return Math.round(v) + '%'; } };
  var PCT = { enc: true, mind: true };

  function trendChart(key, m, labels, hourly) {
    var fmtv = FMT[key], W = 420, H = 168, L = 46, R = 44, T = 14, B = 22, n = labels.length;
    var vals = m.values.filter(function (v) { return v != null; });
    if (!vals.length && !m.n) return '<div class="empty small">No data yet</div>';
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
    var svg = '';
    for (var g = 0; g <= hi + 1e-9; g += scale.step) {
      var gy = y(g);
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + (g === 0 ? 'var(--line-2)' : 'var(--line)') + '"/>' +
             '<text x="' + (L - 6) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + tick(g) + '</text>';
    }
    var band = m.n >= 5;
    if (band) {
      var top = y(m.mean + m.sd), bot = y(Math.max(0, m.mean - m.sd));
      svg += '<rect x="' + L + '" y="' + top + '" width="' + (W - L - R) + '" height="' + Math.max(0, bot - top) + '" fill="var(--k1)" opacity=".10"/>';
    }
    if (m.n >= 1) {
      var my = y(m.mean);
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + my + '" y2="' + my + '" stroke="var(--muted)" stroke-width="1"/>' +
             '<text x="' + (W - R + 4) + '" y="' + (my + 3.5) + '">typical</text>';
    }
    var path = '', area = '', pen = false, first = null, last = null;
    m.values.forEach(function (v, i) {
      if (v == null) { pen = false; return; }
      path += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true;
      if (first == null) first = i; last = i;
    });
    if (path) svg += '<path d="' + path + '" fill="none" stroke="var(--k1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var highBad = m.kind === 'avg';
    m.values.forEach(function (v, i) {
      if (v == null) return;
      var partial = i === m.partial_index;
      var tip = (hourly ? labels[i].slice(11) : labels[i].slice(5)) + ': ' + fmtv(v) +
        (band ? ' (' + (v >= m.mean ? '+' : '') + Math.round((v - m.mean) * 100 / (m.mean || 1)) + '% vs typical)' : '') + (partial ? ' ' + U(0x00B7) + ' still in progress' : '');
      svg += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="4" fill="' + (partial ? 'var(--surface)' : 'var(--k1)') + '" stroke="' + (partial ? 'var(--k1)' : 'var(--surface)') + '" stroke-width="2"/>' +
             '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="12" fill="transparent" data-tip="' + esc(tip) + '"/>';
    });
    if (last != null) {
      var ly = y(m.values[last]), above = ly - 8 >= T + 2, lx = x(last), text = fmtv(m.values[last]);
      // Near the right edge the label goes on the point's left so it isn't cut off
      var left = lx + 8 + String(text).length * 6.5 > W;
      svg += '<text class="lab" x="' + (left ? lx - 8 : lx + 8) + '" y="' + (above ? ly - 8 : ly + 16) + '"' + (left ? ' text-anchor="end"' : '') + '>' + esc(text) + '</text>';
    }
    var step = hourly ? 3 : (n > 10 ? 5 : 1);
    labels.forEach(function (lb, i) {
      if (i % step === 0) svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(hourly ? lb.slice(11, 13) : lb.slice(5)) + '</text>';
    });
    var foot = band ? 'Line = typical ' + fmtv(m.mean) + ', shaded = usual range, ' + m.n + ' samples' : 'Baseline building: ' + m.n + ' of 5 samples';
    var latest = last != null ? fmtv(m.values[last]) : '--';
    return '<div class="chart-head"><h4>' + esc(m.title.replace(/ \(%\)$/, '')) + '</h4>' + (band ? delta(m.vs_pct, highBad, ' vs typical') : '') + '</div>' +
      '<div class="chart-val">' + esc(latest) + '<span class="muted small" style="font-weight:500;letter-spacing:0"> ' + (hourly ? 'latest hour' : 'latest day') + '</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(m.title) + '">' + svg + '</svg>' +
      '<div class="chart-foot">' + foot + '</div>';
  }

  function stepBar(steps) {
    var keys = Object.keys(steps).filter(function (k) { return steps[k] > 0; }).sort(function (a, b) {
      var ia = STEP_ORDER.indexOf(a), ib = STEP_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    var total = keys.reduce(function (a, k) { return a + steps[k]; }, 0);
    if (!total) return '<div class="empty small">No step timing in this window yet.</div>';
    var bar = '<div class="segbar" role="img" aria-label="Average rest: ' + keys.map(function (k) { return k + ' ' + dur(steps[k]); }).join(', ') + '">' + keys.map(function (k) {
      var share = steps[k] * 100 / total, label = Math.round(share) + '%';
      return '<span class="' + (STEP_DARK_TEXT[k] ? 'dark' : '') + '" style="flex:' + steps[k] + ' 1 0;background:' + css(STEP_COL[k] || '--gray') + '" data-tip="' +
        esc(k + ' ' + U(0x00B7) + ' ' + dur(steps[k]) + ' (' + label + ')') + '">' + (share >= 9 ? label : '') + '</span>'; }).join('') + '</div>';
    var list = '<div class="steps">' + keys.map(function (k) {
      return '<div><i style="background:' + css(STEP_COL[k] || '--gray') + '"></i><span>' + esc(k) + '</span><b>' + dur(steps[k]) + '</b><span class="muted">' +
        Math.round(steps[k] * 100 / total) + '%</span></div>'; }).join('') + '</div>';
    return bar + list;
  }

  function statusTag(s) {
    var cls = s === 'completed' ? 't-ok' : (s === 'active' || s === 'open') ? 't-live' : 't-off';
    return '<span class="tag ' + cls + '"><i></i>' + esc(s) + '</span>';
  }

  function renderDetail() {
    var c = det, t = c.trend, rs = c.range_stats, b = c.bounty, mind = c.mind, enc = c.encumbrance;
    var tabs = Object.keys(c.ranges).map(function (k) {
      return '<button type="button" data-r="' + k + '" class="' + (k === range ? 'on' : '') + '">' + esc(c.ranges[k]) + '</button>'; }).join('');
    var basis = t.hourly ? 'hours with ' + t.min_hunt_minutes + '+ min of hunting over the last ' + t.baseline_days + ' days'
                         : 'days with ' + (t.min_hunt_minutes / 60) + '+ hours of hunting over the last ' + t.baseline_days + ' days';
    var light = LIGHT[c.light.level] || LIGHT.gray;

    var head = '<div class="crumb"><button type="button" id="back">Everyone</button><span>/</span><span>' + esc(c.name) + '</span></div>' +
      '<div class="card">' +
        '<div class="ch-head" style="align-items:flex-start;flex-wrap:wrap;gap:14px">' +
          '<span class="avatar big">' + initial(c.name) + '</span>' +
          '<div style="min-width:0;flex:1 1 260px"><div class="ch-name" style="font-size:26px;letter-spacing:-.02em">' + esc(c.name) + '</div>' +
            '<div class="ch-meta" style="margin-top:6px">' + stateHtml(c.state) +
            (c.state.profile ? '<span class="tag">' + esc(c.state.profile) + '</span>' : '') +
            (c.state.type === 'rest' && c.state.reason ? '<span class="small muted">resting: ' + esc(c.state.reason) + '</span>' : '') + '</div></div>' +
          '<div style="min-width:220px;flex:0 1 360px"><div class="small" style="display:flex;align-items:center;gap:8px;font-weight:650">' + status(c.light.level) + light[1] + '</div>' +
            reasonsHtml(c.light) + '</div>' +
        '</div>' +
        '<div class="tiles" style="margin-top:18px">' +
          stat('Last kill', '<span data-ago="' + (c.last_kill || '') + '">' + ago(c.last_kill) + '</span>', c.last_kill ? clock(c.last_kill) : 'none yet', 'tile') +
          stat('Last bounty', '<span data-ago="' + (c.last_bounty || '') + '">' + ago(c.last_bounty) + '</span>', c.last_bounty ? clock(c.last_bounty) : 'none yet', 'tile') +
          '<div class="tile"><div class="stat-lab">Active bounty</div><div class="stat-val">' + (b ? (b.need ? b.done + '<span class="muted" style="font-size:15px;font-weight:600">/' + b.need + '</span>' : esc(b.type)) : '--') + '</div>' +
            '<div class="stat-sub">' + (b ? esc(b.target || b.type) + ' ' + U(0x00B7) + ' ' + dur(b.age) + (b.typical ? ' (typ ' + dur(b.typical) + ')' : '') : 'none active') + '</div>' + meter(b) + '</div>' +
          (c.login ? stat(c.login.live ? 'This login' : 'Last login', short(c.login.silver) + '<span class="muted" style="font-size:13px;font-weight:600"> silver</span>',
            short(c.login.silver_hr) + '/hr ' + U(0x00B7) + ' ' + short(c.login.exp) + ' exp ' + U(0x00B7) + ' ' + plural(c.login.deaths, 'death') + ' ' + U(0x00B7) + ' since ' + stamp(c.login.since), 'tile') : '') +
          stat('Crashes today', num(c.crashes.length), c.crashes.map(function (x) { return clock(x.at) + ' ' + esc(x.reason); }).join(', ') || 'none', 'tile') +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="card-head" style="margin-bottom:8px"><h3>Activity today</h3></div>' + timeline([c], c.day_start) +
      '</div>';

    var perf = '<section class="card"><div class="card-head"><h3>Performance</h3><span class="note">' + esc(c.label) + '</span><span class="spacer"></span><div class="tabs" id="tabs">' + tabs + '</div></div>' +
      '<div class="tiles perf">' +
        stat('Silver', short(rs.silver), short(rs.silver_hr) + ' / hr ' + U(0x00B7) + ' ' + short(rs.silver_hunt_hr) + ' / hunt hr', 'tile lead') +
        stat('Experience', short(rs.exp), short(rs.exp_hr) + ' / hr ' + U(0x00B7) + ' ' + short(rs.exp_hunt_hr) + ' / hunt hr', 'tile') +
        stat('Bounties', num(rs.bounties), (rs.bounties_hunt_hr == null ? '--' : rs.bounties_hunt_hr) + ' / hunt hr ' + U(0x00B7) + ' ' + rs.abandoned + ' abandoned', 'tile') +
        stat('Kills', num(rs.kills), plural(rs.deaths, 'death'), 'tile') +
        stat('Task offers', num(c.offers.offered), c.offers.removed + ' removed ' + U(0x00B7) + ' ' + c.offers.expedited + ' expedited', 'tile') +
        stat('Avg hunt / rest', dur(rs.hunt_avg) + '<span class="muted" style="font-weight:600"> / </span>' + dur(rs.rest_avg),
             rs.hunts + ' hunts ' + U(0x00B7) + ' ' + (rs.uptime_pct == null ? '--' : rs.uptime_pct + '%') + ' hunting', 'tile') +
      '</div>' +
      '<div class="card-head" style="margin:22px 0 10px"><h3>Trends</h3><span class="note">Typical = average of ' + esc(basis) + '</span></div>' +
      '<div class="grid g-charts">' + Object.keys(c.trends).map(function (k) {
        return '<div class="chart">' + trendChart(k, c.trends[k], t.labels, t.hourly) + '</div>'; }).join('') + '</div></section>';

    var reasonRows = c.rest_reasons.length ? c.rest_reasons.map(function (r) {
      var hot = r.typical != null && r.today >= 3 && r.today >= r.typical * 2 + 1;
      return '<tr' + (hot ? ' class="mark"' : '') + '><td class="wrapcell">' + esc(r.reason) + '</td><td>' + r.today + '</td><td>' + (r.typical == null ? '--' : r.typical) + '</td></tr>'; }).join('')
      : '<tr><td colspan="3" class="muted">No rests yet today</td></tr>';
    var rest = '<section class="grid g-2">' +
      '<div class="card"><div class="card-head"><h3>Average rest</h3><span class="note">' + esc(c.label) + ' ' + U(0x00B7) + ' time per step</span></div>' + stepBar(c.steps) +
        '<div class="divider"></div><div class="card-head" style="margin-bottom:6px"><h3>Rest reasons today</h3></div>' +
        '<div class="scroll"><table><thead><tr><th>Reason</th><th>Today</th><th>Typical by now</th></tr></thead><tbody>' + reasonRows + '</tbody></table></div></div>' +
      '<div class="card"><div class="card-head"><h3>Mind and load</h3><span class="note">today</span></div><div class="tiles">' +
        stat('Mind at hunt start', mind.start_avg == null ? '--' : Math.round(mind.start_avg) + '%', 'average', 'tile') +
        stat('Mind at hunt end', mind.end_avg == null ? '--' : Math.round(mind.end_avg) + '%', plural(mind.samples, 'hunt'), 'tile') +
        stat('Absorbed per rest', mind.absorbed_per_rest == null ? '--' : num(mind.absorbed_per_rest), mind.absorbed_per_min == null ? 'field exp' : mind.absorbed_per_min + ' per minute of rest', 'tile') +
        stat('Encumbrance at start', enc.today == null ? '--' : Math.round(enc.today) + '%', enc.typical == null ? 'no baseline yet' : 'typical ' + Math.round(enc.typical) + '%', 'tile') +
      '</div><div class="small muted" style="margin-top:12px">Mind percentages need mind capacity, recorded from this update on.</div></div></section>';

    var grounds = c.grounds.length ? '<div class="scroll"><table><thead><tr><th>Profile</th><th>Hours</th><th>Exp / hunt hr</th><th>Kills / hunt hr</th><th>Creature silver / hr</th><th>Deaths</th></tr></thead><tbody>' +
      c.grounds.map(function (g) {
        var cur = c.state.profile && g.profile === c.state.profile;
        return '<tr' + (cur ? ' class="mark"' : '') + '><td>' + esc(g.profile) + (cur ? ' <span class="tag t-live"><i></i>now</span>' : '') + '</td><td>' + g.hours + '</td><td>' + num(g.exp_hr) + '</td><td>' + g.kills_hr +
          '</td><td>' + short(g.silver_hr) + '</td><td>' + g.deaths + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty small">Needs at least an hour of hunting in a profile.</div>';
    var recent = c.recent_bounties.length ? '<div class="scroll"><table><thead><tr><th>Received</th><th class="l">Type</th><th class="l">Target</th><th class="l">Status</th><th>Took</th><th>Silver</th><th>Exp</th></tr></thead><tbody>' +
      c.recent_bounties.map(function (r) {
        return '<tr><td>' + clock(r.received) + '</td><td class="l">' + esc(r.type) + '</td><td class="l wrapcell">' + esc(r.target) + '</td><td class="l">' + statusTag(r.status) + '</td><td>' + dur(r.took) +
          '</td><td>' + short(r.silver) + '</td><td>' + short(r.exp) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty small">No bounties yet.</div>';
    var offers = c.offers.recent.length ? '<div class="scroll"><table><thead><tr><th>Offered</th><th class="l">Task</th><th class="l">Outcome</th><th class="l">Voucher</th></tr></thead><tbody>' +
      c.offers.recent.map(function (o) {
        return '<tr' + (o.outcome === 'removed' ? ' class="mark"' : '') + '><td>' + clock(o.at) + '</td><td class="l wrapcell">' + esc(o.task) + '</td><td class="l">' + statusTag(o.outcome) +
          '</td><td class="l">' + (o.expedited ? 'expedited' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty small">No tasks offered in this range.</div>';

    $('detail').innerHTML = head + perf + rest +
      '<section class="card"><div class="card-head"><h3>Hunting grounds</h3><span class="note">last 30 days, best exp first</span></div>' + grounds + '</section>' +
      '<section class="grid g-2"><div class="card"><div class="card-head"><h3>Recent bounties</h3></div>' + recent + '</div>' +
      '<div class="card"><div class="card-head"><h3>Task offers</h3><span class="note">' + esc(c.label) + ' ' + U(0x00B7) + ' removed in bold</span></div>' + offers + '</div></section>';
    $('back').onclick = function () { setWho(''); };
    Array.prototype.forEach.call($('tabs').querySelectorAll('button'), function (bt) {
      bt.onclick = function () { range = bt.getAttribute('data-r'); loadDetail(); };
    });
  }

  // ---------------- hover tooltip ----------------
  var tipEl = $('tip');
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) { tipEl.style.display = 'none'; return; }
    tipEl.textContent = el.getAttribute('data-tip'); tipEl.style.display = 'block';
  });
  document.addEventListener('mousemove', function (e) {
    if (tipEl.style.display !== 'block') return;
    var w = tipEl.offsetWidth, x = e.clientX + 14, y = e.clientY + 16;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  });

  // ---------------- plumbing ----------------
  function bindWho(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-who]'), function (el) {
      el.onclick = function () { setWho(el.getAttribute('data-who')); };
      el.onkeydown = function (e) { if (e.key === 'Enter' && e.target === el) setWho(el.getAttribute('data-who')); };
    });
  }
  function setWho(name) {
    who = name; history.replaceState(null, '', name ? '#' + encodeURIComponent(name) : location.pathname);
    $('who').value = name; det = null; show(); if (name) loadDetail(); else if (ov) renderOverview(); window.scrollTo(0, 0);
  }
  function fillSelect() {
    var sel = $('who'), want = [''].concat(ov.names);
    var have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (have.join('|') !== want.join('|')) {
      sel.innerHTML = '<option value="">Everyone</option>' + ov.characters.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    }
    sel.value = who;
  }
  function show() {
    $('overview').hidden = !!who; $('detail').hidden = !who;
    if (who && !det) $('detail').innerHTML = '<div class="card empty">Loading ' + esc(who) + '...</div>';
  }
  function tick() {
    Array.prototype.forEach.call(document.querySelectorAll('.timer'), function (el) {
      var s = el.getAttribute('data-since'), off = el.getAttribute('data-type') === 'offline';
      var secs = s ? nowSrv() - Number(s) : 0;
      el.textContent = !s ? '' : off ? 'last seen ' + ago(Number(s)) : 'for ' + dur(secs);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ago]'), function (el) {
      var ts = Number(el.getAttribute('data-ago')); if (ts) el.textContent = ago(ts);
    });
    if (ov && feed) {
      $('statusText').textContent = failed ? 'Connection lost, retrying' :
        feed.live ? 'Live ' + U(0x00B7) + ' updated ' + Math.round(Date.now() / 1000 + offset - ov.generated_at) + 's ago'
                    : 'Snapshot ' + U(0x00B7) + ' as of ' + stamp(ov.generated_at);
      $('statusText').title = failed ? errorText : feed.label;
      $('liveDot').className = 'live' + (failed ? ' stale' : feed.live ? '' : ' snap');
    } else if (!ov) {
      $('statusText').textContent = 'No data source'; $('liveDot').className = 'live stale';
    }
  }
  function loadOverview() {
    if (!dash || !dash.source) return Promise.resolve();
    return dash.refresh().then(function (st) {
      feed = st; failed = 0; errorText = '';
      ov = dash.overview(); offset = ov.generated_at - Date.now() / 1000;
      fillSelect(); if (!who) renderOverview(); tick(); showWarning(st.warning);
    }).catch(function (e) {
      failed++; errorText = e && e.message ? e.message : String(e); tick();
      if (!ov) showSource(errorText);
    });
  }
  function loadDetail() {
    if (!who || !dash || !dash.conn) return;
    var d = null;
    try { d = dash.character(who, range); } catch (e) { d = null; }
    if (d) { det = d; renderDetail(); tick(); return; }
    if (!det) $('detail').innerHTML = '<div class="card empty">No data for ' + esc(who) + '. <button class="tool" id="back" type="button">Back to everyone</button></div>';
    var bk = $('back'); if (bk && !det) bk.onclick = function () { setWho(''); };
  }
  // Live sources are polled; a snapshot file is read once
  function refresh() { if (document.hidden || !feed || !feed.live) return; loadOverview().then(loadDetail); }

  // ----- where the data comes from ----------------------------------------
  function showWarning(text) { var el = $('warning'); el.hidden = !text; el.textContent = text || ''; }
  function showSource(error) {
    $('source').hidden = false;
    var el = $('sourceError'); el.hidden = !error; el.textContent = error || '';
  }
  function connect(source) {
    dash.setSource(source); feed = null; ov = null; det = null; failed = 0;
    $('overview').innerHTML = '<div class="card empty">Loading ' + esc(source.label) + '...</div>'; show();
    return loadOverview().then(function () {
      if (!ov) { $('overview').innerHTML = ''; return; }
      rememberSource(source); $('source').hidden = true; $('sourceError').hidden = true; loadDetail();
      $('footText').textContent = source.live ? 'Updates every 5 seconds ' + U(0x00B7) + ' Read only ' + U(0x00B7) + ' ' + source.label
                                              : 'Snapshot of ' + source.label + ' ' + U(0x00B7) + ' Read only';
    });
  }
  function connectLive(port) { return connect(new LiveSource(port)); }
  $('liveForm').onsubmit = function (e) { e.preventDefault(); connectLive($('port').value); };
  $('pickFile').onchange = function () { if (this.files.length) connect(new FileSource(this.files)); this.value = ''; };
  if (FolderSource.supported()) {
    $('pickFolder').onclick = function () {
      window.showDirectoryPicker({ id: 'gs4a', mode: 'read' }).then(function (dir) { connect(new FolderSource(dir)); })
        .catch(function (e) { if (e && e.name !== 'AbortError') showSource(e.message); });
    };
  } else {
    $('pickFolder').disabled = true;
    $('folderNote').textContent = 'Needs Chrome or Edge: this browser cannot keep a folder open.';
  }
  $('sourceBtn').onclick = function () { var s = $('source'); s.hidden = !s.hidden; if (!s.hidden) s.scrollIntoView({ block: 'nearest' }); };

  // A live source reconnects on its own; a folder needs one click to allow it again
  function restore() {
    var params = new URLSearchParams(location.search), saved = rememberedSource();
    if (params.has('live')) { $('port').value = params.get('live') || '8080'; return connectLive($('port').value); }
    if (saved && saved.kind === 'live') { $('port').value = saved.port; return connectLive(saved.port); }
    showSource();
    if (saved && saved.kind === 'folder' && FolderSource.supported()) {
      savedFolder().then(function (dir) {
        if (!dir) return;
        var btn = $('reFolder');
        btn.hidden = false; btn.textContent = 'Reopen ' + dir.name;
        btn.onclick = function () {
          dir.requestPermission({ mode: 'read' }).then(function (p) {
            if (p === 'granted') connect(new FolderSource(dir)); else showSource('Permission to read ' + dir.name + ' was not given.');
          });
        };
      });
    }
  }

  // ----- save the current view as a PNG -----------------------------------
  // The page is copied with every computed style written inline (so the
  // current theme's colors are kept), wrapped in an SVG foreignObject, drawn
  // onto a canvas and saved. If the browser refuses to read the canvas back,
  // the SVG itself is saved instead.
  function inlineStyles(src, dst) {
    var cs = getComputedStyle(src), text = '';
    for (var i = 0; i < cs.length; i++) text += cs[i] + ':' + cs.getPropertyValue(cs[i]) + ';';
    dst.setAttribute('style', text);
    for (var k = 0; k < src.children.length; k++) inlineStyles(src.children[k], dst.children[k]);
  }
  function exportName(ext) {
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    return 'gs4-analytics-' + (who ? who.replace(/[^\w-]+/g, '_') + '-' + range : 'everyone') + '-' + stamp + '.' + ext;
  }
  function saveBlob(blob, ext) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = exportName(ext);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }
  function exportImage() {
    var btn = $('export'), root = document.querySelector('.wrap');
    var width = root.offsetWidth, height = root.scrollHeight + 34;
    function finish(label) { btn.textContent = label || 'Save image'; btn.disabled = false; if (label) setTimeout(function () { btn.textContent = 'Save image'; }, 3000); }
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      var clone = root.cloneNode(true);
      inlineStyles(root, clone);
      var sel = clone.querySelector('select');
      if (sel) {
        var label = document.createElement('span');
        label.textContent = $('who').options[$('who').selectedIndex].text;
        label.setAttribute('style', 'color:' + getComputedStyle($('who')).color + ';font-size:13px;font-weight:600');
        sel.parentNode.replaceChild(label, sel);
      }
      Array.prototype.forEach.call(clone.querySelectorAll('.no-export'), function (n) { n.parentNode.removeChild(n); });
      // The copy keeps the page's measured height; let the wrapper size it instead
      clone.style.cssText += ';margin:0;max-width:none;height:auto;width:' + width + 'px';
      var top = clone.querySelector('.top');
      if (top) top.style.position = 'static';
      var foot = document.createElement('div');
      foot.setAttribute('style', 'text-align:right;font-size:12px;padding:0 16px;font-family:' + getComputedStyle(document.body).fontFamily + ';color:' + getComputedStyle(document.documentElement).getPropertyValue('--muted'));
      foot.textContent = 'GS4 Analytics - saved ' + new Date().toLocaleString();
      var page = document.createElement('div');
      page.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      page.setAttribute('style', 'width:' + width + 'px;height:' + height + 'px;background:' + getComputedStyle(document.body).backgroundColor);
      page.appendChild(clone);
      page.appendChild(foot);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject x="0" y="0" width="100%" height="100%">' +
        new XMLSerializer().serializeToString(page) + '</foreignObject></svg>';
      var scale = Math.max(1, Math.min(2, 16000 / height)), img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
          var g = canvas.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
          canvas.toBlob(function (blob) { if (blob) { saveBlob(blob, 'png'); finish(); } else { saveBlob(new Blob([svg], {type: 'image/svg+xml'}), 'svg'); finish('Saved as SVG'); } }, 'image/png');
        } catch (e) { saveBlob(new Blob([svg], {type: 'image/svg+xml'}), 'svg'); finish('Saved as SVG'); }
      };
      img.onerror = function () { finish('Could not save'); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) { finish('Could not save'); }
  }
  $('export').onclick = exportImage;

  $('who').onchange = function () { setWho(this.value); };
  $('home').onclick = function () { setWho(''); };
  show();
  window.initSqlJs({ locateFile: function (file) { return 'vendor/sql.js/' + file; } }).then(function (SQL) {
    dash = new Dashboard(SQL);
    restore();
  }).catch(function (e) { showSource('Could not start the database engine: ' + (e && e.message ? e.message : e)); });
  setInterval(refresh, 5000);
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', refresh);
})();
