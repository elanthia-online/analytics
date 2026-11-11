// Save the current view as a PNG. The content column is copied with every
// computed style written inline (so the current theme's colors are kept),
// given a title bar, wrapped in an SVG foreignObject, drawn onto a canvas and
// saved. If the browser refuses to read the canvas back, the SVG is saved.
function inlineStyles(src, dst) {
  var cs = getComputedStyle(src), text = '';
  for (var i = 0; i < cs.length; i++) text += cs[i] + ':' + cs.getPropertyValue(cs[i]) + ';';
  dst.setAttribute('style', text);
  for (var k = 0; k < src.children.length; k++) inlineStyles(src.children[k], dst.children[k]);
}
function saveBlob(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
}

// root: the element to save; title: what the image shows; name(ext): its file name
export function exportImage(root, title, name, done) {
  // A table that scrolls sideways is saved whole: the image widens by what it hides
  var scrolls = root.querySelectorAll('.scroll');
  var hidden = Array.prototype.reduce.call(scrolls, function (a, el) { return Math.max(a, el.scrollWidth - el.clientWidth); }, 0);
  var width = root.offsetWidth + hidden, pad = 28, headH = 64;
  try {
    var clone = root.cloneNode(true);
    inlineStyles(root, clone);
    Array.prototype.forEach.call(clone.querySelectorAll('.scroll'), function (n) { n.style.overflow = 'visible'; n.style.maxWidth = 'none'; });
    Array.prototype.forEach.call(clone.querySelectorAll('.no-export'), function (n) { n.parentNode.removeChild(n); });
    // Sticky and blurred bars draw wrongly (or not at all) inside foreignObject
    Array.prototype.forEach.call(clone.querySelectorAll('*'), function (n) {
      if (n.style.position === 'sticky' || n.style.position === 'fixed') n.style.position = 'static';
      n.style.backdropFilter = 'none'; n.style.webkitBackdropFilter = 'none';
      n.style.animation = 'none'; n.style.transition = 'none';
    });
    clone.style.cssText += ';margin:0;max-width:none;height:auto;min-height:0;width:' + width + 'px;padding-left:0;padding-right:0';
    var rs = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    var v = function (n) { return rs.getPropertyValue(n).trim(); };
    var bar = document.createElement('div');
    bar.setAttribute('style', 'display:flex;align-items:center;gap:12px;height:' + headH + 'px;font-family:' + body.fontFamily + ';color:' + v('--ink') +
      ';border-bottom:1px solid ' + v('--line') + ';margin-bottom:20px');
    bar.innerHTML = '<div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,' + v('--k1') + ',' + v('--k7') + ')"></div>' +
      '<div style="font-weight:700;font-size:15px;white-space:nowrap">GS4 Analytics</div><div style="color:' + v('--muted') + ';font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">' + title.replace(/[&<>"]/g, '') + '</div>' +
      '<div style="flex:1"></div><div style="color:' + v('--muted') + ';font-size:12px;white-space:nowrap">Saved ' + new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</div>';
    var page = document.createElement('div');
    var height = root.scrollHeight + headH + 20 + pad * 2;
    page.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    page.setAttribute('style', 'box-sizing:border-box;width:' + (width + pad * 2) + 'px;height:' + height + 'px;padding:' + (pad - 8) + 'px ' + pad + 'px ' + pad + 'px;background:' + body.backgroundColor);
    page.appendChild(bar);
    page.appendChild(clone);
    var W = width + pad * 2;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + height + '"><foreignObject x="0" y="0" width="100%" height="100%">' +
      new XMLSerializer().serializeToString(page) + '</foreignObject></svg>';
    var scale = Math.max(1, Math.min(2, 16000 / height)), img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(W * scale); canvas.height = Math.round(height * scale);
        var g = canvas.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          if (blob) { saveBlob(blob, name('png')); done(); } else { saveBlob(new Blob([svg], { type: 'image/svg+xml' }), name('svg')); done('Saved as SVG'); }
        }, 'image/png');
      } catch (e) { saveBlob(new Blob([svg], { type: 'image/svg+xml' }), name('svg')); done('Saved as SVG'); }
    };
    img.onerror = function () { done('Could not save'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch (e) { done('Could not save'); }
}
