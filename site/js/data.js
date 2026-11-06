// Where the database comes from, and the views built from it.
//
// Three sources, all ending in the same place: a SQLite image (Uint8Array)
// opened with sql.js and handed to the aggregation layer.
//   live   - analytics.lic's local API (docs/api.md), polled every few seconds
//   folder - the folder holding analytics.db, re-read every few seconds
//            (Chromium's File System Access API; WAL applied in wal.js)
//   file   - a single file picked once (a backup, or a copy someone sent)
import { Conn } from './db.js';
import { readLive, applyWal } from './wal.js';
import { buildOverview, buildCharacter, KNOWN_SCHEMAS } from './aggregate/index.js';

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

  // { bytes, changed, asOf, meta } or throws
  async load() {
    const meta = await getJson(`${this.base}/api/meta`);
    if (meta.app !== 'analytics') throw new Error(`Port ${this.port} is not an analytics.lic dashboard`);
    if (Number(meta.api) !== API_VERSION) {
      throw new Error(`analytics.lic speaks dashboard API ${meta.api}; this page speaks ${API_VERSION}. Update ${Number(meta.api) > API_VERSION ? 'this page (reload)' : 'the script'}.`);
    }
    if (meta.token === this.token && this.bytes) return { bytes: this.bytes, changed: false, asOf: meta.now, meta };
    const response = await fetch(`${this.base}/api/db?token=${encodeURIComponent(meta.token)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`analytics.lic answered ${response.status} for the database`);
    this.bytes = new Uint8Array(await response.arrayBuffer());
    this.token = meta.token;
    return { bytes: this.bytes, changed: true, asOf: meta.now, meta };
  }
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new Error('Could not reach analytics.lic. Is it running with --dashboard (or ;analytics serve)?');
  }
  if (!response.ok) throw new Error(`analytics.lic answered ${response.status}`);
  return response.json();
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
    this.main = list.find((f) => !f.name.endsWith('-wal')) || list[0];
    this.wal = list.find((f) => f !== this.main && f.name.endsWith('-wal')) || null;
  }

  get label() { return this.main.name; }

  async load() {
    if (this.bytes) return { bytes: this.bytes, changed: false, asOf: this.asOf };
    const main = new Uint8Array(await this.main.arrayBuffer());
    const wal = this.wal ? new Uint8Array(await this.wal.arrayBuffer()) : null;
    this.bytes = applyWal(main, wal).bytes;
    this.asOf = Math.floor(Math.max(this.main.lastModified, this.wal?.lastModified ?? 0) / 1000);
    return { bytes: this.bytes, changed: true, asOf: this.asOf };
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---- the open database and the views over it --------------------------------

export class Dashboard {
  constructor(SQL) {
    this.SQL = SQL;
    this.source = null;
    this.db = null;
    this.version = 0;
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
  async refresh() {
    if (!this.source) throw new Error('No data source chosen');
    const { bytes, changed, asOf } = await this.source.load();
    if (changed || !this.db) {
      const db = new this.SQL.Database(bytes);
      const conn = new Conn(db);
      if (!conn.tableExists('cycles')) {
        db.close();
        throw new Error('That file is not an analytics.lic database (it has no cycles table).');
      }
      this.close();
      this.db = db;
      this.conn = conn;
      this.schema = conn.metadata('schema_version');
      this.version++;
    }
    this.asOf = asOf;
    const warning = this.schema && !KNOWN_SCHEMAS.includes(String(this.schema))
      ? `This database is schema ${this.schema}; this page was checked against ${KNOWN_SCHEMAS.join(', ')}. Some figures may be missing or wrong.`
      : null;
    return { asOf, live: this.source.live, warning, label: this.source.label, kind: this.source.kind };
  }

  // The time the views are computed at: the real clock for a live source,
  // the file's own time for a snapshot
  now() {
    return this.source?.live ? nowSeconds() : this.asOf;
  }

  // Built at most once per database image and second, so the overview and
  // the character view of one refresh share their work
  memo(key, build) {
    const now = this.now();
    const full = `${this.version}|${now}|${key}`;
    if (!this.cache.has(full)) {
      if (this.cache.size > 50) this.cache.clear();
      this.cache.set(full, build(now));
    }
    return this.cache.get(full);
  }

  overview() {
    return this.memo('overview', (now) => buildOverview(this.conn, { now }));
  }

  character(who, range) {
    return this.memo(`char|${who}|${range}`, (now) => buildCharacter(this.conn, this.overview(), who, range, { now }));
  }
}

// ---- remembering the source ---------------------------------------------------

const STORE = 'gs4a-source';

export function rememberSource(source) {
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
