// The theme picked with the Theme button, applied before the first paint.
// A classic (blocking) script in <head>, so the page never flashes the
// other theme.
try {
  var saved = localStorage.getItem('gs4a-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
} catch (e) { /* storage off */ }
