// The Ruby-semantics helpers (aggregate/ruby.js). Every expected value here
// was printed by Ruby 4.0 (x.round(d), a / b, "#{f}"), so a change that
// drifts from Ruby fails here before it shows up as a parity diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rround, idiv, floatStr, median, sortBy, toI, toF } from '../site/js/aggregate/ruby.js';

test('rround is Float#round: half away from zero, with float.c round_half_up', () => {
  const ruby = [[1.005, 2, 1.01], [2.675, 2, 2.68], [1.015, 2, 1.02], [0.125, 2, 0.13], [-1.005, 2, -1.01],
    [-2.5, 0, -3], [2.5, 0, 3], [0.5, 0, 1], [-0.5, 0, -1], [1.45, 1, 1.5], [-1.45, 1, -1.5], [12.345, 1, 12.3],
    [99.995, 2, 100.0], [33.333333, 1, 33.3], [-0.05, 1, -0.1]];
  for (const [x, d, want] of ruby) assert.equal(rround(x, d), want, `${x}.round(${d})`);
  assert.equal(rround(null, 1), null);
});

test('idiv is Integer#/: floors toward negative infinity', () => {
  for (const [a, b, want] of [[-7, 2, -4], [7, -2, -4], [-7, -2, 3], [-1, 3, -1], [7, 2, 3]]) assert.equal(idiv(a, b), want, `${a} / ${b}`);
});

test('floatStr is Float#to_s for the values the alerts print', () => {
  for (const [f, want] of [[0, '0.0'], [1.5, '1.5'], [12, '12.0'], [-3, '-3.0'], [0.1 + 0.2, '0.30000000000000004']]) assert.equal(floatStr(f), want);
});

test('median: the middle value, or the mean of the two middle ones', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5.5, 1]), 3.25);
  assert.equal(median([]), null);
  assert.equal(median([null, 4]), 4);
});

test('sortBy: array keys compare element by element, strings by code unit, ties keep their order', () => {
  const list = [{ k: [1, 'b'], n: 1 }, { k: [0, 'z'], n: 2 }, { k: [1, 'a'], n: 3 }, { k: [1, 'b'], n: 4 }, { k: [1, 'B'], n: 5 }];
  assert.deepEqual(sortBy(list, (x) => x.k).map((x) => x.n), [2, 5, 3, 1, 4]);
  assert.deepEqual(sortBy(['b', 'a', 'c', 'a'], (x) => 0), ['b', 'a', 'c', 'a'], 'a full tie leaves the list as it was');
});

test('toI and toF are nil.to_i / to_f: nil and empty are 0, integers truncate', () => {
  assert.deepEqual([toI(null), toI(''), toI('12'), toI(3.9), toI(-3.9)], [0, 0, 12, 3, -3]);
  assert.deepEqual([toF(null), toF('1.5'), toF('x')], [0, 1.5, 0]);
});
