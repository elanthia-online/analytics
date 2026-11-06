// A thin read-only connection over a sql.js Database, with the two calls
// the aggregation uses: all() for every row and one() for the first.
// Rows are plain objects keyed by column name, like analytics.lic's
// Database.reader rows.

const decoder = new TextDecoder();

// A string the game sent as raw bytes can be stored as a BLOB; read it as text
function cell(value) {
  return value instanceof Uint8Array ? decoder.decode(value) : value;
}

export class Conn {
  constructor(db) {
    this.db = db;
  }

  all(sql, ...params) {
    const stmt = this.db.prepare(sql);
    try {
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        for (const key of Object.keys(row)) row[key] = cell(row[key]);
        rows.push(row);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  one(sql, ...params) {
    return this.all(sql, ...params)[0] ?? null;
  }

  tableExists(name) {
    return !!this.one("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", name);
  }

  metadata(key) {
    if (!this.tableExists('metadata')) return null;
    return this.one('SELECT value FROM metadata WHERE key = ?', key)?.value ?? null;
  }
}

// Opens a database image (Uint8Array) with an initialised sql.js module.
// The caller owns the result and must close() it: sql.js memory lives on
// the WASM heap and is not garbage collected.
export function openImage(SQL, bytes) {
  return new SQL.Database(bytes);
}
