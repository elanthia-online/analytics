// The theme (Auto, Light, Dark) and high-contrast controls. Any page can have
// several sets (the sidebar, the first-visit header, the guide); they stay in
// step. theme-init.js applies the saved choices before the first paint.
import { hydrate } from './ui/icons.js';

var root = document.documentElement;
var more = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null;
function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function set(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {} }

function theme() { return root.getAttribute('data-theme') || 'auto'; }
function systemMore() { return !!(more && more.matches); }
function contrastOn() { return root.hasAttribute('data-hc'); }

function applyContrast() {
  var pick = get('gs4a-contrast');
  var on = pick === 'more' || (pick !== 'off' && systemMore());
  if (on) root.setAttribute('data-hc', ''); else root.removeAttribute('data-hc');
}

function show() {
  Array.prototype.forEach.call(document.querySelectorAll('.theme-seg input'), function (input) { input.checked = input.value === theme(); });
  Array.prototype.forEach.call(document.querySelectorAll('.contrast-btn'), function (btn) {
    btn.setAttribute('aria-pressed', String(contrastOn()));
    var st = btn.querySelector('.state-txt');
    if (st) st.textContent = contrastOn() ? 'On' : 'Off';
  });
}

document.addEventListener('change', function (e) {
  var input = e.target.closest && e.target.closest('.theme-seg input');
  if (!input) return;
  var next = input.value;
  if (next === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', next);
  set('gs4a-theme', next === 'auto' ? null : next);
  show();
});
document.addEventListener('click', function (e) {
  if (!e.target.closest || !e.target.closest('.contrast-btn')) return;
  // Saved only when it differs from what the system asks for, so a later
  // change to the system setting is followed again
  var want = !contrastOn();
  set('gs4a-contrast', want === systemMore() ? null : want ? 'more' : 'off');
  applyContrast(); show();
});
if (more && more.addEventListener) more.addEventListener('change', function () { applyContrast(); show(); });

hydrate();
show();
