// Reading a live SQLite database from its files: the main file plus the
// committed frames of its write-ahead log (the -wal file next to it).
//
// While analytics.lic runs, recent commits live only in analytics.db-wal
// until SQLite checkpoints them into analytics.db. A browser can't take
// part in SQLite's locking, so instead of opening the files we rebuild the
// database as of its last commit: every page from the last valid commit in
// the WAL, laid over the main file. Format: https://sqlite.org/fileformat2.html#walformat

const WAL_MAGIC = 0x377f0682; // | 1 when the checksums are big-endian
const WAL_HEADER = 32;
const FRAME_HEADER = 24;

function checksum(bytes, offset, length, s0, s1, bigEndian) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = offset; i < offset + length; i += 8) {
    s0 = (s0 + view.getUint32(i, !bigEndian) + s1) >>> 0;
    s1 = (s1 + view.getUint32(i + 4, !bigEndian) + s0) >>> 0;
  }
  return [s0, s1];
}

// The WAL header's salts, which change each time the log restarts, or null
// for a missing or unusable log
export function walSalt(wal) {
  if (!wal || wal.length < WAL_HEADER) return null;
  const view = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
  if ((view.getUint32(0) & 0xfffffffe) !== WAL_MAGIC) return null;
  return `${view.getUint32(16)}:${view.getUint32(20)}`;
}

// The database image as of the last commit in +wal+ (or +main+ unchanged
// when the log is empty, missing, or from an older generation). Frames after
// the last commit belong to a transaction still in progress and are left out.
export function applyWal(main, wal) {
  if (!wal || wal.length < WAL_HEADER) return { bytes: main, frames: 0 };
  const view = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
  const magic = view.getUint32(0);
  if ((magic & 0xfffffffe) !== WAL_MAGIC) return { bytes: main, frames: 0 };
  const bigEndian = (magic & 1) === 1;
  const pageSize = view.getUint32(8);
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) return { bytes: main, frames: 0 };
  const salt1 = view.getUint32(16);
  const salt2 = view.getUint32(20);
  let [s0, s1] = checksum(wal, 0, 24, 0, 0, bigEndian);
  if (s0 !== view.getUint32(24) || s1 !== view.getUint32(28)) return { bytes: main, frames: 0 };

  const committed = new Map();
  let pending = new Map();
  let dbPages = 0;
  let frames = 0;
  for (let at = WAL_HEADER; at + FRAME_HEADER + pageSize <= wal.length; at += FRAME_HEADER + pageSize) {
    // A frame from an earlier generation of the log, or a torn write, ends it
    if (view.getUint32(at + 8) !== salt1 || view.getUint32(at + 12) !== salt2) break;
    [s0, s1] = checksum(wal, at, 8, s0, s1, bigEndian);
    [s0, s1] = checksum(wal, at + FRAME_HEADER, pageSize, s0, s1, bigEndian);
    if (s0 !== view.getUint32(at + 16) || s1 !== view.getUint32(at + 20)) break;

    pending.set(view.getUint32(at), at + FRAME_HEADER);
    const commitSize = view.getUint32(at + 4); // database size in pages, on a commit frame only
    if (commitSize) {
      for (const [page, offset] of pending) committed.set(page, offset);
      pending = new Map();
      dbPages = commitSize;
      frames++;
    }
  }
  if (!dbPages) return { bytes: main, frames: 0 };

  const out = new Uint8Array(dbPages * pageSize);
  out.set(main.subarray(0, Math.min(main.length, out.length)));
  for (const [page, offset] of committed) {
    if (page <= dbPages) out.set(wal.subarray(offset, offset + pageSize), (page - 1) * pageSize);
  }
  return { bytes: out, frames };
}

// Reads a consistent image from a directory handle (File System Access API)
// that holds +name+ and maybe +name+-wal. A checkpoint can rewrite the main
// file while we read it; the pages it copies are still in the WAL, which we
// lay on top, as long as the log didn't restart in between. So: read the
// WAL's salt, the main file, then the WAL, and go again if the salt moved.
export async function readLive(dir, name, { tries = 4 } = {}) {
  const read = async (fileName) => {
    try {
      const handle = await dir.getFileHandle(fileName);
      const file = await handle.getFile();
      return { bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified };
    } catch (error) {
      if (error && error.name === 'NotFoundError') return null;
      throw error;
    }
  };
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const before = walSalt((await read(`${name}-wal`))?.bytes);
      const main = await read(name);
      if (!main) throw new Error(`${name} is not in that folder`);
      const wal = await read(`${name}-wal`);
      if (walSalt(wal?.bytes) !== before) continue; // the log restarted mid-read
      const { bytes, frames } = applyWal(main.bytes, wal?.bytes);
      return { bytes, frames, modified: Math.max(main.modified, wal?.modified ?? 0) };
    } catch (error) {
      // Chrome refuses to read a file that changed after getFile(); try again
      if (error && error.name !== 'NotReadableError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('The database kept changing while it was read; try again');
}
