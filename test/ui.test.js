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

test('the rest bar escapes step names, and a step named like a built-in still draws (#17, #36)', async () => {
  const { stepBar } = await import('../site/js/ui/charts.js');
  const html = stepBar({ 'x"><b id=pwn>hi</b><i x="': 60, constructor: 30, travel: 10 });
  assert.ok(!html.includes('<b id=pwn>') && !html.includes('id=pwn>hi'), 'no markup from a step name');
  assert.ok(html.includes('&quot;&gt;&lt;b id=pwn&gt;'), 'shown escaped');
  assert.ok(html.includes('background:var(--gray)'), 'an unknown step, constructor included, is gray');
});

test('DST: the timeline spans the real day, so a stretch sits on its clock hour (#27)', async () => {
  const { timeline, dayEnd, hourStart } = await import('../site/js/ui/charts.js');
  const t0 = Math.floor(new Date(2026, 10, 1).getTime() / 1000);        // the 25-hour fall-back day (New York)
  assert.equal(dayEnd(t0) - t0, 25 * 3600);
  const six = hourStart(t0, 18);
  const svg = timeline([{ name: 'April', timeline: [['hunt', six, six + 3600, '']] }], t0, 'a', 1000);
  const tick = svg.match(/<line x1="([\d.]+)"[^>]*\/><text[^>]*>18:00</)[1];
  const seg = svg.match(/class="seg s-hunt" x="([\d.]+)"/)[1];
  assert.ok(Math.abs(Number(tick) - Number(seg)) < 0.1, `18:00 tick at ${tick}, the stretch at ${seg}`);
  assert.equal(Number(svg.match(/data-t1="(\d+)"/)[1]), t0 + 25 * 3600, 'the now marker spans the same day');
});
