// The dashboard: the shell (sidebar, drawer, theme), where the data comes
// from, and putting the views on the page. The views themselves are in ui/;
// data.js opens the database and the aggregation layer computes the figures.
// See docs/architecture.md.
import { Dashboard, LiveSource, FolderSource, FileSource, DemoSource, rememberSource, rememberedSource, savedFolder } from './data.js';
import { DOT, $, esc, dur, ago, stamp, clockState, nowSrv, shownId, storedId, shown, setHtml } from './ui/util.js';
import { overviewHtml, detailHtml, navHtml } from './ui/views.js';
import { icon, hydrate } from './ui/icons.js';
import { nowMarkers } from './ui/charts.js';
import { exportImage } from './ui/export.js';

hydrate();

// ---------------- theme: Auto (follow the system), Light, Dark ----------------
(function () {
  var group = $('theme');
  function current() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
  function showTheme() {
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-t') === current();
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
  }
  group.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-t]'); if (!b) return;
    var next = b.getAttribute('data-t');
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { if (next === 'auto') localStorage.removeItem('gs4a-theme'); else localStorage.setItem('gs4a-theme', next); } catch (e2) {}
    showTheme();
  });
  showTheme();
})();

// ---------------- the drawer (phones and narrow windows) ----------------
var app = document.querySelector('.app');
function drawer(open) {
  app.classList.toggle('open', open); $('scrim').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
  if (open) $('side').focus(); else if (document.activeElement && $('side').contains(document.activeElement)) $('menuBtn').focus();
}
$('menuBtn').onclick = function () { drawer(true); };
$('sideClose').onclick = function () { drawer(false); };
$('scrim').onclick = function () { drawer(false); };
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && app.classList.contains('open')) drawer(false); });

// ---------------- state ----------------
var who = storedId(decodeURIComponent(location.hash.slice(1))); // the database id; the URL shows it as players know it
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
function enter(el, view) {
  if (lastView === view) return;
  lastView = view;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  setTimeout(function () { el.classList.remove('enter'); }, 900);
}
function skeleton(kind) {
  var b = function (cls) { return '<div class="skel ' + cls + '"></div>'; };
  if (kind === 'detail') return '<div class="skel-wrap" aria-busy="true" aria-label="Loading">' + b('s-bar') + '<div class="card">' + b('s-title') + b('s-line') + '<div class="skel-row">' + b('s-tile') + b('s-tile') + b('s-tile') + b('s-tile') + '</div></div>' +
    '<div class="card"><div class="skel-row">' + b('s-chart') + b('s-chart') + b('s-chart') + '</div></div></div>';
  return '<div class="skel-wrap" aria-busy="true" aria-label="Loading">' + b('s-eyebrow') + b('s-title') + '<div class="skel-row">' + b('s-hero') + b('s-hero') + '</div>' +
    '<div class="skel-row">' + b('s-card') + b('s-card') + b('s-card') + '</div></div>';
}
function renderOverview() {
  if (!ov) return;
  if (setHtml($('overview'), overviewHtml(ov, ordered(ov.characters), pinned, chartWidth()))) tick();
  if (!who && !sourceOpen) enter($('overview'), 'overview');
}
function renderNav() {
  if (!ov) { setHtml($('navChars'), ''); $('navCount').textContent = ''; return; }
  setHtml($('navChars'), navHtml(ov, ordered(ov.characters), who));
  $('navCount').textContent = ov.characters.length;
  var on = !who && !sourceOpen;
  $('navOverview').classList.toggle('on', on);
  if (on) $('navOverview').setAttribute('aria-current', 'page'); else $('navOverview').removeAttribute('aria-current');
}
function renderDetail() {
  if (!det) return;
  if (setHtml($('detail'), detailHtml(det, range, chartWidth()))) tick();
  enter($('detail'), 'detail:' + who);
}
// The width a full-card chart gets: the content column less the card's padding
function chartWidth() { return Math.round(($('content').clientWidth || 1000) - (window.innerWidth <= 640 ? 32 + 40 : 72 + 42)); }
var resizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () { if (who) renderDetail(); else renderOverview(); }, 150);
});
function viewTitle() { return who ? shown(det ? det.name : shownId(who)) + (det ? ' ' + DOT + ' ' + det.label : '') : 'Everyone ' + DOT + ' Today'; }

// ---------------- clicks, all delegated (views are redrawn as data changes) ----------------
document.addEventListener('click', function (e) {
  var t = e.target;
  var pin = t.closest('[data-pin]');
  if (pin) { e.stopPropagation(); togglePin(pin.getAttribute('data-pin')); return; }
  var tab = t.closest('#tabs button[data-r]');
  if (tab) { range = tab.getAttribute('data-r'); loadDetail(); return; }
  if (t.closest('#back')) { setWho(''); return; }
  var w = t.closest('[data-who]');
  if (w) { setWho(w.getAttribute('data-who')); }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var el = e.target;
  if (el.matches && el.matches('[data-who][tabindex]')) { e.preventDefault(); setWho(el.getAttribute('data-who')); }
});
$('navOverview').onclick = function () { setWho(''); };
$('home').onclick = function () { setWho(''); };

function setWho(name) {
  who = name; sourceOpen = false;
  history.replaceState(null, '', location.pathname + location.search + (name ? '#' + encodeURIComponent(shownId(name)) : ''));
  det = null; drawer(false); show();
  if (name) loadDetail(); else if (ov) renderOverview();
  renderNav(); window.scrollTo(0, 0);
}
function show() {
  var connected = !!ov;
  $('source').hidden = booting || (connected && !sourceOpen);
  $('source').classList.toggle('compact', connected);
  $('overview').hidden = connected ? (!!who || sourceOpen) : !booting;
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
    renderNav(); if (!who) renderOverview(); show(); tick(); showWarning(st.warning);
  }).catch(function (e) {
    failed++; errorText = e && e.message ? e.message : String(e); tick();
    if (!ov) showSource(errorText);
  });
}
function loadDetail() {
  if (!who || !dash || !dash.conn || !ov) return;
  var d = null;
  try { d = dash.character(who, range); } catch (e) { d = null; }
  if (d) { det = d; renderDetail(); tick(); return; }
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
    rememberSource(source); show(); loadDetail();
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
  return 'gs4-analytics-' + (who ? shownId(who).replace(/[^\w-]+/g, '_') + '-' + range : 'everyone') + '-' + when + '.' + ext;
}
$('export').onclick = function () {
  var btn = $('export'), label = $('exportLabel');
  if (!ov) return;
  btn.disabled = true; label.textContent = 'Saving...';
  exportImage($(who ? 'detail' : 'overview'), viewTitle(), exportName, function (msg) {
    btn.disabled = false; label.textContent = msg || 'Saved';
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
