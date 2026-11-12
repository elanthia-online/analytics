// Sideways-scrolling strips (the range tabs on a phone, a character's page
// links, wide tables) fade at an edge that has more past it, so a phone
// reader can see there is more to scroll to. The fade is a CSS mask keyed on
// data-more ("l", "r" or "lr"), kept current as they scroll, resize and redraw.
var SELECTOR = '.tabs, .sub-nav, .scroll';

function mark(el) {
  var max = el.scrollWidth - el.clientWidth;
  var more = max > 1 ? (el.scrollLeft > 1 ? 'l' : '') + (el.scrollLeft < max - 1 ? 'r' : '') : '';
  if (more) el.setAttribute('data-more', more); else el.removeAttribute('data-more');
  // A strip seen for the first time shows its chosen tab or page
  if (!el._edgeSeen) {
    el._edgeSeen = true;
    var on = max > 1 && !el.classList.contains('scroll') && el.querySelector('button.on, a.on, [aria-current="page"]');
    if (on) {
      var a = on.getBoundingClientRect(), b = el.getBoundingClientRect();
      if (a.right > b.right || a.left < b.left) el.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
      mark(el);
    }
  }
}
var queued = false;
function update() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(function () { queued = false; document.querySelectorAll(SELECTOR).forEach(mark); });
}
export function watchEdges(root) {
  document.addEventListener('scroll', function (e) { if (e.target.matches && e.target.matches(SELECTOR)) mark(e.target); }, true);
  window.addEventListener('resize', update);
  new MutationObserver(update).observe(root, { childList: true, subtree: true });
  update();
}
