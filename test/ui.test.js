// The view helpers that build HTML from data. They run in Node too, since
// nothing here touches the DOM until it's called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTable } from '../site/js/ui/parts.js';

test('sortTable escapes headings, labels and the caption: they are plain text, never markup', () => {
  const html = sortTable('t', 'A <i>table</i>', [
    { h: '<script>alert(1)</script>', v: (r) => r.n, c: (r) => String(r.n) },
    { h: 'Name "quoted"', text: true, v: (r) => r.s, c: (r) => r.s },
  ], [{ n: 2, s: 'b' }, { n: 1, s: 'a' }], { col: 0, dir: 'desc' });
  assert.ok(!html.includes('<script>') && !html.includes('<i>'), 'no markup from headings or the label');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the heading, escaped');
  assert.ok(html.includes('sorted by &lt;script&gt;'), 'the caption names the column, escaped');
  assert.ok(html.indexOf('<td>2</td>') < html.indexOf('<td>1</td>'), 'and still sorts');
});
