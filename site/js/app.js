// The dashboard: the shell (sidebar, drawer, theme), where the data comes
// from, and putting the views on the page. The views themselves are in ui/;
// data.js opens the database and the aggregation layer computes the figures.
// See docs/architecture.md.
import { Dashboard, LiveSource, FolderSource, FileSource, DemoSource, rememberSource, rememberedSource, savedFolder } from './data.js';
import { DOT, $, esc, dur, ago, stamp, clockState, nowSrv, shownId, storedId, shown, setHtml, plural } from './ui/util.js';
import { overviewHtml, detailHtml, navHtml, comparePageHtml } from './ui/views.js';
import { sortState } from './ui/parts.js';
import { SECTION_NAMES, historyRows } from './ui/sections.js';
import { SECTIONS, RANGES, DETAIL_RANGES } from './aggregate/index.js';
import { icon } from './ui/icons.js';
import { nowMarkers, openTables } from './ui/charts.js';
import './display.js'; // the theme and contrast controls (and the icons in the static HTML)
import { exportImage } from './ui/export.js';


// ---------------- the drawer (phones and narrow windows) ----------------
var app = document.querySelector('.app');
function drawer(open) {
  app.classList.toggle('open', open); $('scrim').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
  // While the drawer is open, the page behind it can't be reached
  document.querySelector('.main').inert = open;
  if (open) $('side').focus(); else if (document.activeElement && $('side').contains(document.activeElement)) $('menuBtn').focus();
}
$('menuBtn').onclick = function () { drawer(true); };
$('sideClose').onclick = function () { drawer(false); };
$('scrim').onclick = function () { drawer(false); };
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && app.classList.contains('open')) drawer(false); });

// ---------------- state ----------------
// The URL hash names the character as players know it, and the page:
// #GS4%3ASplinter (its summary) or #GS4%3ASplinter/income
// #compare is the Compare page
function readHash() {
  var text = decodeURIComponent(location.hash.slice(1)), at = text.lastIndexOf('/');
  if (text === 'compare') return ['', 'summary', 'compare'];
  var sec = at > 0 ? text.slice(at + 1) : '';
  if (SECTIONS.indexOf(sec) < 0) sec = 'summary'; else text = text.slice(0, at);
  return [storedId(text), sec, null];
}
var initial = readHash();
var who = initial[0], section = initial[1], page = initial[2]; // who is the database id
// The range the summary uses: it has no year or all-time view, so those show the month
function summaryRange() { return RANGES[range] ? range : 'monthly'; }
// Progress targets, per character, saved in this browser; and a target being typed
var targets = {};
try { targets = JSON.parse(localStorage.getItem('gs4a-targets') || '{}') || {}; } catch (e) { targets = {}; }
var targetDraft = {};
var range = 'daily', ov = null, det = null, failed = 0, dash = null, feed = null, errorText = '', sourceOpen = false;
var lastView = null;
// While a remembered or linked source connects, the page shows a loading
// state rather than flashing the first-visit page
var params = new URLSearchParams(location.search), saved = rememberedSource();
var booting = params.has('demo') || params.has('live') || !!(saved && saved.kind === 'live');

// Pinned characters, saved in this browser, come first everywhere
var pins = [];
try { pins = JSON.parse(localStorage.getItem('gs4a-pins') || '[]') || []; } catch (e) { pins = []; }
function pinned(id) { return pins.indexOf(id) >= 0; }
// Hidden characters: left out of the overview (and its totals), kept in the sidebar's Hidden group
var hidden = [];
try { hidden = JSON.parse(localStorage.getItem('gs4a-hidden') || '[]') || []; } catch (e) { hidden = []; }
function setHidden(list) {
  hidden = list;
  try { if (hidden.length) localStorage.setItem('gs4a-hidden', JSON.stringify(hidden)); else localStorage.removeItem('gs4a-hidden'); } catch (e) {}
  renderOverview(); renderNav();
}
var hiddenOpen = false;
var histFilter = { type: 'all', q: '' };
function togglePin(id) {
  pins = pinned(id) ? pins.filter(function (p) { return p !== id; }) : pins.concat([id]);
  try { localStorage.setItem('gs4a-pins', JSON.stringify(pins)); } catch (e) {}
  renderOverview(); renderNav();
}
function ordered(list) {
  return list.filter(function (c) { return pinned(c.id); }).concat(list.filter(function (c) { return !pinned(c.id); }));
}

// ---------------- rendering ----------------
// A view fades in when it first appears, not on every refresh
// A page of the same character only cross-fades its content
function enter(el, view) {
  var soft = el.id === 'detailBody', cls = soft ? 'enter-soft' : 'enter';
  if (lastView === view && !soft) return;
  lastView = view;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  setTimeout(function () { el.classList.remove(cls); }, soft ? 300 : 900);
}
function skeleton(kind) {
  var b = function (cls) { return '<div class="skel ' + cls + '"></div>'; };
  if (kind === 'detail') return '<div class="skel-wrap" aria-busy="true" aria-label="Loading">' + b('s-bar') + '<div class="card">' + b('s-title') + b('s-line') + '<div class="skel-row">' + b('s-tile') + b('s-tile') + b('s-tile') + b('s-tile') + '</div></div>' +
    '<div class="card"><div class="skel-row">' + b('s-chart') + b('s-chart') + b('s-chart') + '</div></div></div>';
  return '<div class="skel-wrap" aria-busy="true" aria-label="Loading">' + b('s-eyebrow') + b('s-title') + '<div class="skel-row">' + b('s-hero') + b('s-hero') + '</div>' +
    '<div class="skel-row">' + b('s-card') + b('s-card') + b('s-card') + '</div></div>';
}
// Writes a view, putting focus (and the caret in a text field) back where it was
function write(el, html) {
  var a = document.activeElement, id = a && el.contains(a) ? a.id : '';
  var caret = id && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  var changed = setHtml(el, html);
  if (changed && id && $(id)) { $(id).focus({ preventScroll: true }); if (caret) try { $(id).setSelectionRange(caret[0], caret[1]); } catch (e) {} }
  return changed;
}
function renderOverview() {
  if (!ov) return;
  var shownChars = ordered(ov.characters).filter(function (c) { return hidden.indexOf(c.id) < 0; });
  var daily = dash && dash.conn ? dash.daily(shownChars.map(function (c) { return c.id; })) : null;
  if (write($('overview'), overviewHtml(ov, shownChars, pinned, chartWidth(), { hidden: hidden.filter(function (id) { return ov.names.indexOf(id) >= 0; }), daily: daily }))) tick();
  if (!who && !sourceOpen) enter($('overview'), 'overview');
}
function renderNav() {
  if (!ov) { setHtml($('navChars'), ''); $('navCount').textContent = ''; return; }
  write($('navChars'), navHtml(ov, ordered(ov.characters), who, hidden, hiddenOpen));
  $('navCount').textContent = ov.characters.length;
  var on = !who && !page && !sourceOpen, cmp = !!page && !sourceOpen;
  $('navOverview').classList.toggle('on', on);
  if (on) $('navOverview').setAttribute('aria-current', 'page'); else $('navOverview').removeAttribute('aria-current');
  $('navCompare').classList.toggle('on', cmp);
  if (cmp) $('navCompare').setAttribute('aria-current', 'page'); else $('navCompare').removeAttribute('aria-current');
}
var sdata = null; // the current section's figures
// The character view is two parts: the bar and page tabs (head), written in
// place, and the page (body). Switching pages on the same character redraws
// and fades in only the body, so the bar and tabs never move.
function renderDetail() {
  if (!det) return;
  var el = $('detail');
  if (!$('detailBar') || !el.contains($('detailBar'))) {
    el.innerHTML = '<div class="detail-head"><div class="subbar no-export" id="detailBar"></div>' +
      '<nav class="sub-nav no-export" id="detailTabs"><ul></ul></nav></div><div id="detailBody"></div>';
    el._html = null;
  }
  var parts = detailHtml(det, section === 'summary' ? summaryRange() : range, chartWidth(), section, sdata, histFilter,
    { target: targets[who] || null, draft: targetDraft[who] || null });
  $('detailTabs').setAttribute('aria-label', parts.label);
  var a = write($('detailBar'), parts.bar), n = write($('detailTabs').firstChild, parts.nav), b = write($('detailBody'), parts.body);
  a = a || n;
  if (a || b) tick();
  var view = 'detail:' + who;
  if (lastView !== view) enter(el, view);
  else if (lastSection !== section) enter($('detailBody'), view);
  lastSection = section;
}
var lastSection = null;
// The width a full-card chart gets: the content column less the card's padding
function chartWidth() { return Math.round(($('content').clientWidth || 1000) - (window.innerWidth <= 640 ? 32 + 40 : 72 + 42)); }
var resizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () { if (who) renderDetail(); else renderOverview(); }, 150);
});
function viewTitle() {
  var label = sdata && sdata.label ? sdata.label : det ? det.label : '';
  if (page) return 'Compare characters ' + DOT + ' ' + (DETAIL_RANGES[range] || '');
  return who ? shown(det ? det.name : shownId(who)) + (section !== 'summary' ? ' ' + DOT + ' ' + SECTION_NAMES[section] : '') + (label && section !== 'progress' ? ' ' + DOT + ' ' + label : '')
    : 'Everyone ' + DOT + ' Today';
}

// Messages for screen readers (the status region in index.html)
function announce(text) { var el = $('announce'); el.textContent = ''; setTimeout(function () { el.textContent = text; }, 50); }

// ---------------- clicks, all delegated (views are redrawn as data changes) ----------------
document.addEventListener('click', function (e) {
  var t = e.target;
  // A character link opened in a new tab or window is left to the browser
  if ((e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) && t.closest('a[href^="#"]')) return;
  var pin = t.closest('[data-pin]');
  if (pin) { e.stopPropagation(); togglePin(pin.getAttribute('data-pin')); return; }
  var hide = t.closest('[data-hide]');
  if (hide) {
    var id = hide.getAttribute('data-hide'), name = shown((ov.characters.find(function (c) { return c.id === id; }) || {}).name || id);
    setHidden(hidden.concat([id]));
    announce(name + ' hidden. It is in the Hidden group of the menu.');
    var next = document.querySelector('#overview .ch-link') || $('content');
    next.focus({ preventScroll: true });
    return;
  }
  var unhide = t.closest('[data-unhide]');
  if (unhide) { var uid = unhide.getAttribute('data-unhide'); setHidden(hidden.filter(function (h) { return h !== uid; })); announce('Shown on the overview again'); return; }
  if (t.closest('[data-unhide-all]')) { setHidden([]); announce('Every character is shown again'); return; }
  var tab = t.closest('#tabs button[data-r], #cmpTabs button[data-r]');
  if (tab) { range = tab.getAttribute('data-r'); if (page) renderCompare(); else loadDetail(); return; }
  var sort = t.closest('[data-sort]');
  if (sort) {
    var key = sort.getAttribute('data-sort'), colN = Number(sort.getAttribute('data-col')), was = sortState[key];
    // The same column again flips it; a new one starts highest first (A to Z for text)
    sortState[key] = { col: colN, dir: was && was.col === colN ? (was.dir === 'asc' ? 'desc' : 'asc') : sort.getAttribute('data-text') === '1' ? 'asc' : 'desc' };
    if (page) renderCompare(); else renderDetail();
    return;
  }
  if (t.closest('[data-target-clear]')) { saveTarget(null); announce('Target cleared'); return; }
  if (t.closest('#back')) { setWho(''); return; }
  var w = t.closest('[data-who]');
  if (w) { e.preventDefault(); setWho(w.getAttribute('data-who'), true, w.getAttribute('data-sec') || 'summary'); }
});
// The history page's filter: only its table is redrawn, so typing is never interrupted
function filterHistory() {
  if (!sdata || section !== 'history' || !$('histBody')) return;
  var rows = historyRows(sdata.cycles, histFilter);
  $('histBody').innerHTML = rows.html; $('histCount').textContent = plural(rows.count, 'row');
}
document.addEventListener('input', function (e) {
  if (e.target.id === 'histQ') { histFilter.q = e.target.value; filterHistory(); }
  // A target being typed survives a live refresh of the page
  if (e.target.id === 'targetValue') (targetDraft[who] = targetDraft[who] || {}).value = e.target.value;
});
document.addEventListener('change', function (e) {
  if (e.target.id === 'histType') { histFilter.type = e.target.value; filterHistory(); }
  if (e.target.id === 'targetKind') { (targetDraft[who] = targetDraft[who] || {}).kind = e.target.value; renderDetail(); }
});
// A chart's data table stays open (or closed) across redraws
document.addEventListener('toggle', function (e) {
  var d = e.target;
  if (d.matches && d.matches('details.chart-table')) openTables[d.getAttribute('data-k')] = d.open;
  if (d.matches && d.matches('details.nav-hidden')) hiddenOpen = d.open;
}, true);
$('navOverview').onclick = function (e) { e.preventDefault(); setWho('', true); };
$('navCompare').onclick = function (e) { e.preventDefault(); openCompare(true); };

// ---------------- the Compare page ----------------
function openCompare(focus) {
  page = 'compare'; who = ''; section = 'summary'; det = null; sdata = null; sourceOpen = false;
  if (location.hash !== '#compare') history[focus ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + '#compare');
  drawer(false); show(); renderCompare(); renderNav(); setTitle(); window.scrollTo(0, 0);
  if (focus) { var h = document.querySelector('#compare h1'); if (h) h.focus({ preventScroll: true }); }
}
function renderCompare() {
  if (!page || !dash || !dash.conn || !ov) return;
  if (!DETAIL_RANGES[range]) range = 'daily';
  var names = dash.characterNames();
  var ids = Object.keys(names).filter(function (id) { return hidden.indexOf(id) < 0; });
  var entry = function (id) { return ov.characters.find(function (c) { return c.id === id; }); };
  if (write($('compare'), comparePageHtml(dash.compare(ids, range), range, names, entry, Object.keys(names).length - ids.length))) tick();
  enter($('compare'), 'compare');
}

// ---------------- Progress targets ----------------
function saveTarget(t) {
  if (t) targets[who] = t; else delete targets[who];
  delete targetDraft[who];
  try { if (Object.keys(targets).length) localStorage.setItem('gs4a-targets', JSON.stringify(targets)); else localStorage.removeItem('gs4a-targets'); } catch (e) {}
  renderDetail();
}
document.addEventListener('submit', function (e) {
  if (e.target.id !== 'targetForm') return;
  e.preventDefault();
  var value = Math.floor(Number($('targetValue').value));
  if (!(value > 0)) { $('targetValue').focus(); return; }
  var kind = $('targetKind').value, p = sdata && sdata.progress;
  // Where it starts from, so its bar shows the way covered since
  saveTarget({ kind: kind, value: value, from: p ? (kind === 'atp' ? p.ascension_exp : p.exp) : null });
  announce('Target set');
});
$('home').onclick = function () { setWho('', true); };

// focus: when the reader picked the view, move to its heading so a screen
// reader announces it and the keyboard starts there
function setWho(name, focus, sec) {
  var same = name === who && !!name;
  page = null;
  who = name; sourceOpen = false; section = name ? sec || 'summary' : 'summary';
  // A page the reader chose is a new history entry, so Back returns to where they were
  var url = location.pathname + location.search + (name ? '#' + encodeURIComponent(shownId(name)) + (section !== 'summary' ? '/' + section : '') : '');
  if (url !== location.pathname + location.search + location.hash) history[focus ? 'pushState' : 'replaceState'](null, '', url);
  if (!same) { det = null; lastView = null; }
  sdata = null; drawer(false); show();
  if (name) loadDetail(); else if (ov) renderOverview();
  renderNav(); setTitle();
  // A new page of the same character keeps the tabs where the reader clicked them
  var tabs = same && document.querySelector('#detail .sub-nav');
  if (!tabs) window.scrollTo(0, 0);
  else {
    var bar = document.querySelector('#detail .subbar'), under = bar ? bar.getBoundingClientRect().bottom : 0;
    var top = tabs.getBoundingClientRect().top;
    if (top < under) window.scrollBy(0, top - under); // scrolled past the tabs: bring them back under the bar
  }
  if (focus) {
    var h = document.querySelector((name ? '#detail' : '#overview') + ' h1');
    if (h) h.focus({ preventScroll: true }); else $('content').focus({ preventScroll: true });
  }
}
// Back, Forward, or an address typed with a different #...: show that page
function followUrl() {
  var want = readHash();
  if (want[2] === 'compare') { if (page !== 'compare') openCompare(false); return; }
  if (want[0] !== who || want[1] !== section || page) setWho(want[0], false, want[1]);
}
window.addEventListener('popstate', followUrl);
window.addEventListener('hashchange', followUrl);
function setTitle() {
  if (page) { document.title = 'Compare ' + DOT + ' GS4 Analytics'; return; }
  document.title = (who ? shown(det ? det.name : shownId(who)) + ' ' + DOT + ' ' + (section !== 'summary' ? SECTION_NAMES[section] + ' ' + DOT + ' ' : '') : ov && !sourceOpen ? 'Overview ' + DOT + ' ' : '') + 'GS4 Analytics';
}
function show() {
  var connected = !!ov;
  $('source').hidden = booting || (connected && !sourceOpen);
  $('source').classList.toggle('compact', connected);
  $('overview').hidden = connected ? (!!who || !!page || sourceOpen) : !booting;
  $('compare').hidden = !connected || !page || sourceOpen;
  $('detail').hidden = !connected || !who || sourceOpen;
  if (who && !det && connected && !sourceOpen) setHtml($('detail'), skeleton('detail'));
  $('banner').hidden = !(feed && feed.kind === 'demo') || sourceOpen;
  document.body.classList.toggle('is-landing', !connected);
}

// ---------------- hover tooltip ----------------
var tipEl = $('tip');
document.addEventListener('mouseover', function (e) {
  var el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!el) { tipEl.classList.remove('on'); return; }
  tipEl.textContent = el.getAttribute('data-tip'); tipEl.classList.add('on');
});
document.addEventListener('mousemove', function (e) {
  if (!tipEl.classList.contains('on')) return;
  var w = tipEl.offsetWidth, h = tipEl.offsetHeight, x = e.clientX + 14, y = e.clientY - h - 12;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (y < 8) y = e.clientY + 18;
  tipEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
});

// ---------------- timers and status ----------------
function tick() {
  nowMarkers();
  Array.prototype.forEach.call(document.querySelectorAll('.timer'), function (el) {
    var s = el.getAttribute('data-since'), off = el.getAttribute('data-type') === 'offline';
    var secs = s ? nowSrv() - Number(s) : 0;
    el.textContent = !s ? '' : off ? 'last seen ' + ago(Number(s)) : 'for ' + dur(secs);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ago]'), function (el) {
    var ts = Number(el.getAttribute('data-ago')); el.textContent = ts ? ago(ts) : '--';
  });
  var text, cls, sub = '';
  if (ov && feed) {
    text = failed ? 'Connection lost, retrying' :
      feed.kind === 'demo' ? 'Sample data ' + DOT + ' as of ' + stamp(ov.generated_at) :
      feed.live ? 'Live ' + DOT + ' updated ' + Math.round(Date.now() / 1000 + clockState.offset - ov.generated_at) + 's ago'
                : 'Snapshot ' + DOT + ' as of ' + stamp(ov.generated_at);
    cls = failed ? 'stale' : feed.kind === 'demo' ? 'demo' : feed.live ? '' : 'snap';
    sub = feed.kind === 'demo' ? 'made-up characters' : feed.label;
    $('statusText').title = failed ? errorText : feed.label;
  } else {
    text = 'Not connected'; cls = 'off';
  }
  $('statusText').textContent = text; $('statusMini').textContent = failed ? 'Retrying' : !ov ? 'Not connected' : feed && feed.kind === 'demo' ? 'Sample' : feed && feed.live ? 'Live' : 'Snapshot';
  $('sourceLabel').textContent = sub;
  $('liveDot').className = 'live ' + cls; $('liveDotMini').className = 'live ' + cls;
}

// ---------------- loading ----------------
function loadOverview() {
  if (!dash || !dash.source) return Promise.resolve();
  return dash.refresh().then(function (st) {
    feed = st; failed = 0; errorText = '';
    ov = dash.overview();
    clockState.offset = ov.generated_at - Date.now() / 1000;
    clockState.frozen = feed.live ? null : ov.generated_at;
    renderNav(); if (page) renderCompare(); else if (!who) renderOverview(); show(); tick(); showWarning(st.warning);
  }).catch(function (e) {
    failed++; errorText = e && e.message ? e.message : String(e); tick();
    if (!ov) showSource(errorText);
  });
}
function loadDetail() {
  if (!who || !dash || !dash.conn || !ov) return;
  var d = null;
  try { d = dash.character(who, summaryRange()); } catch (e) { d = null; }
  if (d) {
    det = d;
    try { sdata = section !== 'summary' ? dash.details(who, section, range) : null; } catch (e) { sdata = null; }
    renderDetail(); tick(); setTitle(); return;
  }
  if (!det) {
    setHtml($('detail'), '<div class="card empty big">' + icon('pulse', 'empty-ic') + '<h3>No data for ' + esc(shownId(who)) + '</h3>' +
      '<p class="muted">This database has nothing recorded for that character.</p><button class="btn" id="back" type="button">' + icon('back') + 'Back to everyone</button></div>');
  }
}
// Live sources are polled; a snapshot is read once
function refresh() { if (document.hidden || !feed || !feed.live) return; loadOverview().then(loadDetail); }

// ---------------- where the data comes from ----------------
function showWarning(text) { var el = $('warning'); el.hidden = !text; el.textContent = text || ''; }
function showSource(error) {
  sourceOpen = !!ov; show();
  var el = $('sourceError'); el.hidden = !error; el.textContent = error || '';
  if (error) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function connect(source) {
  booting = false;
  dash.setSource(source); feed = null; ov = null; det = null; failed = 0; sourceOpen = false; lastView = null;
  $('sourceError').hidden = true;
  $('source').hidden = true;
  $('overview').hidden = false;
  setHtml($('overview'), skeleton('overview'));
  return loadOverview().then(function () {
    if (!ov) { setHtml($('overview'), ''); show(); return; }
    rememberSource(source); show(); loadDetail(); setTitle();
    announce(source.kind === 'demo' ? 'Showing sample data' : 'Connected to ' + source.label);
    // A shared ?demo link must not win over the reader's own source on the next visit
    if (source.kind !== 'demo' && params.has('demo')) {
      params.delete('demo');
      var q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
    $('footText').textContent = source.kind === 'demo' ? 'Sample data, made-up characters' :
      source.live ? 'Updates every 5 seconds ' + DOT + ' Read only ' + DOT + ' ' + source.label : 'Snapshot of ' + source.label + ' ' + DOT + ' Read only';
  });
}
function connectLive(port) { return connect(new LiveSource(port)); }
function connectDemo() { return connect(new DemoSource(dash.SQL)); }

$('liveForm').onsubmit = function (e) { e.preventDefault(); connectLive($('port').value); };
$('pickFile').onchange = function () { if (this.files.length) connect(new FileSource(this.files)); this.value = ''; };
$('demoBtn').onclick = function () { if (dash) connectDemo(); };
$('connectBtn').onclick = function () { $('connect').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('port').focus({ preventScroll: true }); };
$('bannerConnect').onclick = function () { sourceOpen = true; show(); renderNav(); drawer(false); window.scrollTo(0, 0); };
$('sourceBtn').onclick = function () { sourceOpen = !sourceOpen || !ov; show(); renderNav(); drawer(false); window.scrollTo(0, 0); };
$('sourceClose').onclick = function () { sourceOpen = false; show(); renderNav(); if (who) loadDetail(); else renderOverview(); };
if (FolderSource.supported()) {
  $('pickFolder').onclick = function () {
    window.showDirectoryPicker({ id: 'gs4a', mode: 'read' }).then(function (dir) { connect(new FolderSource(dir)); })
      .catch(function (e) { if (e && e.name !== 'AbortError') showSource(e.message); });
  };
} else {
  $('pickFolder').disabled = true;
  $('folderNote').textContent = 'Needs Chrome or Edge: this browser cannot keep a folder open.';
}

// A live source reconnects on its own; a folder needs one click to allow it again
function restore() {
  booting = false;
  if (params.has('demo')) return connectDemo();
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

// ---------------- save the current view as a PNG ----------------
function exportName(ext) {
  var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var when = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  if (page) return 'gs4-analytics-compare-' + range + '-' + when + '.' + ext;
  return 'gs4-analytics-' + (who ? shownId(who).replace(/[^\w-]+/g, '_') + (section !== 'summary' ? '-' + section : '') + (section !== 'progress' ? '-' + range : '') : 'everyone') + '-' + when + '.' + ext;
}
$('export').onclick = function () {
  var btn = $('export'), label = $('exportLabel');
  if (!ov) return;
  btn.disabled = true; label.textContent = 'Saving...';
  exportImage($(page ? 'compare' : who ? 'detail' : 'overview'), viewTitle(), exportName, function (msg) {
    btn.disabled = false; label.textContent = msg || 'Saved'; announce(msg || 'Image saved');
    setTimeout(function () { label.textContent = 'Save image'; }, 2500);
  });
};

// ---------------- start ----------------
if (booting) setHtml($('overview'), skeleton(who ? 'detail' : 'overview'));
show(); tick();
window.initSqlJs({ locateFile: function (file) { return 'vendor/sql.js/' + file; } }).then(function (SQL) {
  dash = new Dashboard(SQL);
  restore();
}).catch(function (e) { booting = false; showSource('Could not start the database engine: ' + (e && e.message ? e.message : e)); });
setInterval(refresh, 5000);
setInterval(tick, 1000);
document.addEventListener('visibilitychange', refresh);
