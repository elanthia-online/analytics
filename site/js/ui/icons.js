// A small line-icon set (24x24, drawn with currentColor) so the page needs no
// icon font or image requests. icon() returns markup; hydrate() fills the
// <i data-icon="name"> placeholders in the static HTML.
var P = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  coins: '<ellipse cx="9" cy="6.5" rx="5.5" ry="2.5"/><path d="M3.5 6.5v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4"/><path d="M9.5 15.5c.5 1.2 2.8 2 5 2 3 0 5.5-1.1 5.5-2.5v-4c0-1.4-2.5-2.5-5.5-2.5"/><path d="M9.5 15.5v3c.5 1.2 2.8 2 5 2 3 0 5.5-1.1 5.5-2.5v-3"/>',
  spark: '<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z"/><path d="M19 17v4M17 19h4"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2.5 2.5 0 0 1-5 0v-1H4v1a2.5 2.5 0 0 0 2.5 2.5H14"/><path d="M7 4a2 2 0 0 0-2 2v11"/><path d="M9 9h4M9 12.5h4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  skull: '<path d="M12 3.5a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.3 3 5.3v3.2h9v-3.2c1.7-1 3-2.7 3-5.3A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M10.5 19.5v-2M13.5 19.5v-2"/>',
  plug: '<path d="M9 3v4.5M15 3v4.5"/><path d="M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 13h6M9 16.5h4"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  download: '<path d="M12 3.5v11.5M7 10.5l5 5 5-5"/><path d="M4.5 20.5h15"/>',
  book: '<path d="M3.5 5h5a3.5 3.5 0 0 1 3.5 3.5V20a2.5 2.5 0 0 0-2.5-2.5H3.5z"/><path d="M20.5 5h-5A3.5 3.5 0 0 0 12 8.5V20a2.5 2.5 0 0 1 2.5-2.5h6z"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
  arrow: '<path d="M5 12h13.5M13 6l6 6-6 6"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
  shield: '<path d="M12 3l7.5 2.8v5.7c0 4.4-3.2 8.2-7.5 9-4.3-.8-7.5-4.6-7.5-9V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  pulse: '<path d="M3 12h3.8l2.7-7 5 14 2.7-7H21"/>',
  trend: '<path d="M3.5 17l5.5-5.5 4 4 7.5-7.5"/><path d="M15 8h5.5v5.5"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  play: '<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z"/>',
  sparkles: '<path d="M10 3.5l1.8 4.7 4.7 1.8-4.7 1.8L10 16.5l-1.8-4.7L3.5 10l4.7-1.8z"/><path d="M18 14l.9 2.1 2.1.9-2.1.9L18 20l-.9-2.1-2.1-.9 2.1-.9z"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  map: '<path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
  layers: '<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M3.5 12L12 16.5 20.5 12"/><path d="M3.5 16L12 20.5 20.5 16"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3 3 0 0 0 7 17.5a2.5 2.5 0 0 0 5 .5V5.8A2 2 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3 3 3 0 0 1-2.5 4.7 2.5 2.5 0 0 1-5 .5"/>',
  rest: '<path d="M4 18.5h16"/><path d="M5.5 18.5v-6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6"/><path d="M8 10.5V8a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 8v2.5"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 7.3A16.6 16.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a7.5 7.5 0 0 1 11 0M9.5 16a3 3 0 0 1 5 0"/><circle cx="12" cy="19" r=".8"/>'
};

export function icon(name, cls) {
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
}

export function hydrate(root) {
  Array.prototype.forEach.call((root || document).querySelectorAll('i[data-icon]'), function (el) {
    el.outerHTML = icon(el.getAttribute('data-icon'), el.className);
  });
}
