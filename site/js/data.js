// Where the database comes from, and the views built from it.
//
// Three sources, all ending in the same place: a SQLite image (Uint8Array)
// opened with sql.js and handed to the aggregation layer.
//   live   - analytics.lic's local API (docs/api.md), polled every few seconds
//   folder - the folder holding analytics.db, re-read every few seconds
//            (Chromium's File System Access API; WAL applied in wal.js)
//   file   - a single file picked once (a backup, or a copy someone sent)
//   demo   - the sample database shipped with the site (made-up characters),
//            moved to today; never remembered as the reader's own source
import { Conn } from './db.js';
import { readLive, applyWal } from './wal.js';
import { shiftTimes, sameTimeToday } from './shift.js';
import { buildOverview, buildCharacter, KNOWN_SCHEMAS, buildIncome, buildHunting, buildBounties, buildHistory, buildDaily, buildProgress, buildReconciliation, buildCompare } from './aggregate/index.js';
import { labels } from './aggregate/report.js';

export const DB_NAME = 'analytics.db';
export const API_VERSION = 1;
const DEFAULT_PORT = 8080;

// ---- sources ----------------------------------------------------------------

// analytics.lic's dashboard API on this computer. Requests are plain GETs
// with no custom headers, so the browser never sends a CORS preflight.
export class LiveSource {
  constructor(port = DEFAULT_PORT) {
    this.kind = 'live';
    this.port = Number(port) || DEFAULT_PORT;
    this.base = `http://127.0.0.1:${this.port}`;
    this.token = null;
    this.live = true;
  }

  get label() { return `analytics.lic on port ${this.port}`; }

  // The last image didn't open: ask for it again next time (see Dashboard.refresh)
  forget() { this.token = null; this.bytes = null; }

  // { bytes, changed, asOf, meta } or throws
  async load() {
    const meta = await getJson(`${this.base}/api/meta`);
    if (meta.app !== 'analytics') throw new Error(`Port ${this.port} is not an analytics.lic dashboard`);
    if (Number(meta.api) !== API_VERSION) {
      throw new Error(`analytics.lic speaks dashboard API ${meta.api}; this page speaks ${API_VERSION}. Update ${Number(meta.api) > API_VERSION ? 'this page (reload)' : 'the script'}.`);
    }
    if (meta.token === this.token && this.bytes) return { bytes: this.bytes, changed: false, asOf: meta.now, meta };
    const response = await fetch(`${this.base}/api/db?token=${encodeURIComponent(meta.token)}`, { cache: 'no-store' });
    if (!response.ok) throw await answerError(response, 'for the database');
    this.bytes = new Uint8Array(await response.arrayBuffer());
    // The image can be newer than the token that asked for it; it says which it is
    this.token = response.headers.get('X-Analytics-Token') || meta.token;
    return { bytes: this.bytes, changed: true, asOf: meta.now, meta };
  }
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    // A refused local-network permission looks the same to the page as nothing listening
    throw new Error('Could not reach analytics.lic. Check that it is running with ;analytics --dashboard (or ;analytics serve), ' +
      'and that your browser let this site reach this computer: Chrome and Edge ask once, and the answer is under ' +
      'site settings, Local network access. See the guide: guide/#connect');

  }
  if (!response.ok) throw await answerError(response);
  return response.json();
}

// What a failed answer says. analytics.lic answers 503 with the reason it
// can't serve the database (made by another build, not created yet), which
// tells the player what to do; a 500 is its own error, logged in the game.
async function answerError(response, what = '') {
  let text = '';
  try { text = (await response.text()).trim().slice(0, 400); } catch { /* no body */ }
  if (response.status === 503 && text) return new Error(`analytics.lic can't serve the database: ${text}`);
  if (response.status === 500) return new Error('analytics.lic hit an error answering (500). The game window shows what it was.');
  return new Error(`analytics.lic answered ${response.status}${what ? ` ${what}` : ''}${text ? `: ${text}` : ''}`);
}

// The folder that holds analytics.db (Lich's data directory). Re-reading it
// needs no new dialog; after a reload the browser asks once to allow it.
export class FolderSource {
  constructor(dir) {
    this.kind = 'folder';
    this.dir = dir;
    this.live = true;
    this.stamp = null;
  }

  get label() { return `${this.dir.name}/${DB_NAME}`; }

  static supported() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window; }

  async load() {
    const stamp = await this.fileStamp();
    if (stamp === this.stamp && this.bytes) return { bytes: this.bytes, changed: false, asOf: nowSeconds() };
    const { bytes } = await readLive(this.dir, DB_NAME);
    this.bytes = bytes;
    this.stamp = stamp;
    return { bytes, changed: true, asOf: nowSeconds() };
  }

  // Size and time of both files: unchanged means nothing to re-read
  async fileStamp() {
    const parts = [];
    for (const name of [DB_NAME, `${DB_NAME}-wal`]) {
      try {
        const file = await (await this.dir.getFileHandle(name)).getFile();
        parts.push(`${file.size}@${file.lastModified}`);
      } catch (error) {
        if (error && error.name === 'NotFoundError' && name !== DB_NAME) parts.push('-');
        else if (error && error.name === 'NotFoundError') throw new Error(`There is no ${DB_NAME} in "${this.dir.name}". Pick the folder that holds it (Lich's data folder).`);
        else throw error;
      }
    }
    return parts.join('|');
  }
}

// One file (optionally with its -wal beside it), read once. Its "now" is
// when it was last written, so a snapshot reads as of that moment.
export class FileSource {
  constructor(files) {
    const list = [...files];
    this.kind = 'file';
    this.live = false;
    // The main file: not the -wal beside it, nor the -shm (a shared-memory index, never a database)
    this.main = list.find((f) => !/-(?:wal|shm)$/.test(f.name)) || list[0];
    this.wal = list.find((f) => f !== this.main && f.name.endsWith('-wal')) || null;
  }

  get label() { return this.main.name; }

  forget() { this.bytes = null; }

  async load() {
    if (this.bytes) return { bytes: this.bytes, changed: false, asOf: this.asOf };
    const main = new Uint8Array(await this.main.arrayBuffer());
    const wal = this.wal ? new Uint8Array(await this.wal.arrayBuffer()) : null;
    this.bytes = applyWal(main, wal).bytes;
    this.asOf = Math.floor(Math.max(this.main.lastModified, this.wal?.lastModified ?? 0) / 1000);
    return { bytes: this.bytes, changed: true, asOf: this.asOf };
  }
}

// The site's sample database (site/demo/, built by tools/build-sample.js from
// the synthetic test fixture plus more made-up characters), moved so its afternoon is today's. A snapshot: its clock stands
// at the sample's moment, so the day always looks the same.
export class DemoSource {
  constructor(SQL) {
    this.kind = 'demo';
    this.live = false;
    this.SQL = SQL;
  }

  get label() { return 'sample data'; }

  async load() {
    if (this.bytes) return { bytes: this.bytes, changed: false, asOf: this.asOf };
    const [meta, raw] = await Promise.all([
      fetch('demo/sample.json').then((r) => { if (!r.ok) throw new Error(`The sample data is missing (${r.status})`); return r.json(); }),
      fetch('demo/sample.db').then((r) => { if (!r.ok) throw new Error(`The sample data is missing (${r.status})`); return r.arrayBuffer(); }),
    ]);
    const delta = sameTimeToday(meta.now, meta.tz);
    // Opened only to move it, then closed: sql.js memory is not garbage collected
    const db = new this.SQL.Database(new Uint8Array(raw));
    try {
      shiftTimes(db, delta, meta.now, meta.tz);
      this.bytes = db.export();
    } finally {
      db.close();
    }
    this.asOf = meta.now + delta;
    return { bytes: this.bytes, changed: true, asOf: this.asOf };
  }
}

// A refresh overtaken by a newer one, or by a change of source
function superseded() {
  const error = new Error('superseded');
  error.superseded = true;
  return error;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---- the open database and the views over it --------------------------------



// analytics.lic records the zone its Lich runs in (metadata utc_offset and
// zone, read at updated_at). Days here are this browser's, and kill_stats.date
// is that computer's date, so a different zone moves days. The offsets are
// compared at the moment the script read its own, so DST alone never differs.
export function zoneWarning(conn) {
  let row = null;
  try { row = conn.one("SELECT value, updated_at FROM metadata WHERE key = 'utc_offset'"); } catch { return null; }
  if (!row || row.value == null || row.updated_at == null || !/^-?\d+$/.test(String(row.value))) return null;
  const theirs = Number(row.value), ours = -new Date(Number(row.updated_at) * 1000).getTimezoneOffset() * 60;
  if (theirs === ours) return null;
  const utc = (s) => `UTC${s < 0 ? '\u2212' : '+'}${Math.floor(Math.abs(s) / 3600)}${Math.abs(s) % 3600 ? ':' + String(Math.abs(s) % 3600 / 60).padStart(2, '0') : ''}`;
  const name = conn.metadata('zone');
  const apart = Math.abs(theirs - ours) / 3600;
  return `This database was written by a Lich running at ${utc(theirs)}${name ? ` (${name})` : ''}, and this browser is at ${utc(ours)}. ` +
    `Days here are this browser's, but kills are kept by that computer's dates, ${apart} hour${apart === 1 ? '' : 's'} apart, ` +
    'so kills can show on the day before or after the one they were made on, as much as a whole day\'s worth. ' +
    'Open it in a browser set to the same zone for exact days.';
}

const LONG_RANGES = new Set(['ytd', 'total']);
export class Dashboard {
  constructor(SQL) {
    this.SQL = SQL;
    this.source = null;
    this.db = null;
    this.version = 0;
    this.generation = 0; // counts refreshes, so an overtaken one is ignored
    this.cache = new Map();
  }

  setSource(source) {
    this.source = source;
    this.close();
  }

  close() {
    // sql.js memory is not garbage collected: free the old image explicitly
    this.db?.close();
    this.db = null;
    this.cache.clear();
  }

  // Loads the source again (cheap when nothing changed). Returns a status
  // { asOf, live, warning } for the header.
  //
  // A load that finishes after the source was switched, or after a newer
  // refresh started, is thrown away (error.superseded): it must never land
  // on the source that replaced it.
  async refresh() {
    const source = this.source;
    if (!source) throw new Error('No data source chosen');
    const generation = ++this.generation;
    const stale = () => this.source !== source || generation !== this.generation;
    let loaded;
    try {
      loaded = await source.load();
    } catch (error) {
      throw stale() ? superseded() : error;
    }
    if (stale()) throw superseded();
    const { bytes, changed, asOf } = loaded;
    if (changed || !this.db) {
      let db = null;
      try {
        db = new this.SQL.Database(bytes);
        const conn = new Conn(db);
        if (!conn.tableExists('cycles')) throw new Error('That file is not an analytics.lic database (it has no cycles table).');
        this.close();
        this.db = db;
        this.conn = conn;
        this.schema = conn.metadata('schema_version');
        this.version++;
      } catch (error) {
        // Not adopted: freed now (WASM memory is never collected), and the
        // source forgets it, so a live one asks for the image again
        if (db && db !== this.db) db.close();
        source.forget?.();
        if (/not a database|file is encrypted|malformed/i.test(error.message)) {
          throw new Error("That file isn't an analytics.lic database (it isn't an SQLite database at all).");
        }
        throw error;
      }
    }
    this.asOf = asOf;
    const warning = [
      this.schema && !KNOWN_SCHEMAS.includes(String(this.schema))
        ? `This database is schema ${this.schema}; this page was checked against ${KNOWN_SCHEMAS.join(', ')}. Some figures may be missing or wrong.`
        : null,
      zoneWarning(this.conn),
    ].filter(Boolean).join(' ') || null;
    return { asOf, live: this.source.live, warning, label: this.source.label, kind: this.source.kind };
  }

  // The time the views are computed at: the real clock for a live source,
  // the file's own time for a snapshot
  now() {
    return this.source?.live ? nowSeconds() : this.asOf;
  }

  // Built at most once per database image and second, so the overview and
  // the character view of one refresh share their work
  // A long range (This Year, All Time) is kept for up to a minute while the
  // image is unchanged: it reads all of history, and a refresh with nothing new
  // would rebuild it every 5 seconds for figures that differ only by an open
  // stretch's last seconds.
  memo(key, build, range) {
    const now = this.now();
    const when = LONG_RANGES.has(range) ? `m${Math.floor(now / 60)}` : now;
    const full = `${this.version}|${when}|${key}`;
    if (!this.cache.has(full)) {
      if (this.cache.size > 50) this.cache.clear();
      this.cache.set(full, build(now));
    }
    return this.cache.get(full);
  }

  // The reader's alert settings and today's dismissals (app.js keeps them in
  // the browser); the overview and character views are built with them
  // How the reader counts each range (Settings > Date ranges); every ranged
  // view is built with them
  setRanges(rules) {
    this.ranges = rules;
    this.rangeKey = JSON.stringify(rules || {});
  }

  setAlerts(prefs) {
    this.alertPrefs = { alerts: prefs.alerts || {}, dismissed: [...(prefs.dismissed || [])].sort() };
    this.alertKey = JSON.stringify(this.alertPrefs);
  }

  overview() {
    const prefs = this.alertPrefs || { alerts: {}, dismissed: [] };
    return this.memo(`overview|${this.alertKey || ''}`, (now) => buildOverview(this.conn, { now, ...prefs }));
  }

  character(who, range) {
    const prefs = this.alertPrefs || { alerts: {}, dismissed: [] };
    // The range figures (per hour and the rest) are taken to the minute, like the
    // overview's: a refresh with nothing new leaves the page alone until it turns
    return this.memo(`char|${who}|${range}|${this.alertKey || ''}|${this.rangeKey || ''}`,
      (now) => buildCharacter(this.conn, this.overview(), who, range, { now: Math.floor(now / 60) * 60, ...prefs, ranges: this.ranges }));
  }

  // One of a character's detail pages (aggregate/details.js). The section
  // comes from the URL, so it is matched against the known pages one by one,
  // never used to look a function up: a name like "constructor" would find one.
  details(who, section, range) {
    let build;
    switch (section) {
      case 'progress':
        return this.memo(`progress|${who}`, (now) => ({ progress: buildProgress(this.conn, who, { now }), daily: buildDaily(this.conn, [who], { now }) }));
      case 'income':
        return this.memo(`income|${who}|${range}|${this.rangeKey || ''}`, (now) => ({ ...buildIncome(this.conn, who, range, { now, ranges: this.ranges }),
          reconciliation: buildReconciliation(this.conn, who, range, { now, ranges: this.ranges }) }), range);
      case 'hunting': build = buildHunting; break;
      case 'bounties': build = buildBounties; break;
      case 'history': build = buildHistory; break;
      default: return null;
    }
    return this.memo(`${section}|${who}|${range}|${this.rangeKey || ''}`, (now) => build(this.conn, who, range, { now, ranges: this.ranges }), range);
  }

  // Every character in the database (not only today's), with its name
  characterNames() {
    return this.memo('names', () => Object.fromEntries(labels(this.conn)));
  }

  // The Compare page, for these characters
  compare(ids, range) {
    return this.memo(`compare|${ids.join(',')}|${range}|${this.rangeKey || ''}`, (now) => buildCompare(this.conn, ids, range, { now, ranges: this.ranges }), range);
  }

  // Experience by day for the last four weeks, per character
  daily(ids) {
    return this.memo(`daily|${ids.join(',')}`, (now) => buildDaily(this.conn, ids, { now }));
  }
}

// ---- remembering the source ---------------------------------------------------

const STORE = 'gs4a-source';

export function rememberSource(source) {
  if (source.kind === 'demo') return; // sample characters are never the reader's own
  try {
    if (source.kind === 'live') localStorage.setItem(STORE, JSON.stringify({ kind: 'live', port: source.port }));
    else localStorage.setItem(STORE, JSON.stringify({ kind: source.kind }));
  } catch { /* storage off */ }
  if (source.kind === 'folder') saveHandle(source.dir).catch(() => {});
}

export function rememberedSource() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
}

// A folder handle can be kept in IndexedDB (not localStorage) across reloads
function idb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('gs4a', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('handles');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function saveHandle(handle) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'folder');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function savedFolder() {
  try {
    const db = await idb();
    const handle = await new Promise((resolve, reject) => {
      const get = db.transaction('handles').objectStore('handles').get('folder');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}
