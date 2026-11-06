// The theme and contrast picked on the page, applied before the first paint.
// A classic (blocking) script in <head>, so the page never flashes the other
// theme. display.js has the controls; it repeats applyContrast's rule.
(function () {
  var root = document.documentElement;
  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var theme = get('gs4a-theme');
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  // High contrast: chosen on the page ("more" or "off"), or else the system's prefers-contrast
  var more = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null;
  function applyContrast() {
    var pick = get('gs4a-contrast');
    var on = pick === 'more' || (pick !== 'off' && !!(more && more.matches));
    if (on) root.setAttribute('data-hc', ''); else root.removeAttribute('data-hc');
  }
  applyContrast();
  if (more && more.addEventListener) more.addEventListener('change', applyContrast);
})();
