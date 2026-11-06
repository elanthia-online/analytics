// applyWal must rebuild what an open SQLite connection would see: committed
// transactions in the -wal file included, an uncommitted one left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { applyWal, walSalt } from '../site/js/wal.js';

const SQL = await initSqlJs();
const dir = mkdtempSync(join(tmpdir(), 'wal-test-'));
execFileSync('python3', [new URL('./wal-writer.py', import.meta.url).pathname, dir]);
const file = (name) => new Uint8Array(readFileSync(join(dir, name)));
const count = (bytes) => {
  const db = new SQL.Database(bytes);
  try { return db.exec('SELECT COUNT(*) FROM t')[0].values[0][0]; } finally { db.close(); }
};
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('the main file alone misses what is still in the WAL', () => {
  assert.equal(count(file('snap.db')), 1);
});

test('committed WAL frames are applied, the open transaction is not', () => {
  const { bytes, frames } = applyWal(file('snap.db'), file('snap.db-wal'));
  assert.equal(count(bytes), 501);
  assert.ok(frames >= 500);
});

test('once the transaction commits, it is included', () => {
  assert.equal(count(applyWal(file('snap.db'), file('after.db-wal')).bytes), 802);
});

test('a missing, empty or foreign WAL leaves the main file as it is', () => {
  const main = file('snap.db');
  assert.equal(applyWal(main, null).bytes, main);
  assert.equal(applyWal(main, new Uint8Array(0)).bytes, main);
  assert.equal(applyWal(main, new Uint8Array(4096).fill(7)).bytes, main);
  assert.equal(walSalt(new Uint8Array(10)), null);
});

test('a torn last frame ends the log at the commit before it', () => {
  const wal = file('after.db-wal');
  const torn = wal.slice(0, wal.length - 100); // cut into the last frame
  assert.equal(count(applyWal(file('snap.db'), torn).bytes), 501);
  const flipped = wal.slice();
  flipped[flipped.length - 50] ^= 0xff; // corrupt the last frame's page
  assert.equal(count(applyWal(file('snap.db'), flipped).bytes), 501);
});
