// Converts the parity fixtures from schema 8 to schema 9. Run once; a file
// already at schema 9 is left alone.
//
//   node tools/fixtures-schema9.js
//
// Schema 9 (analytics.lic in elanthia-online/scripts#2556 as of 1a03e72e):
// - progress is a WITHOUT ROWID table (its primary key is the row).
// - progress rows carry the EXPERIENCE readings (fame, deeds, long_term_exp,
//   deaths_sting) only when a reading arrived since the row before, the
//   training points (ptp, mtp, atp) only on the row after they were shown,
//   and a row with deaths_sting 'None' alone when the sting wears off.
// - bounties has an index on (game, character, received_time). The schema 8
//   conversion missed it; results are the same, query plans aren't.
// - metadata records the zone Lich ran in: utc_offset (seconds) and zone,
//   read at updated_at. The fixtures were made in America/New_York, so the
//   offset is New York's at the schema_version row's time. A file already at
//   schema 9 without them gets them added.
//
// No golden figure reads progress (it was filled with synthetic rows by
// tools/fixtures-schema8.js), so parity is unchanged. Which rows keep their
// readings is decided from the rows themselves, so a run always gives the same
// result: each character's first row, every row where the sting changes, and
// every sixth row after those (as if EXPERIENCE had been typed then).
import { readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

const FILES = ['afternoon', 'after-midnight'];
const SQL = await initSqlJs();
const READINGS = ['fame', 'deeds', 'long_term_exp', 'deaths_sting'];

for (const name of FILES) {
  const path = new URL(`../test/fixtures/${name}.db`, import.meta.url);
  const db = new SQL.Database(readFileSync(path));
  const rows = (sql, params = []) => {
    const st = db.prepare(sql); st.bind(params);
    const out = []; while (st.step()) out.push(st.getAsObject());
    st.free(); return out;
  };
  const version = rows("SELECT value FROM metadata WHERE key = 'schema_version'")[0]?.value;
  // The zone, as analytics.lic writes it on every start (record_zone)
  const addZone = () => {
    if (rows("SELECT 1 FROM metadata WHERE key = 'utc_offset'").length) return false;
    const at = rows("SELECT updated_at FROM metadata WHERE key = 'schema_version'")[0].updated_at;
    const offset = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
      .formatToParts(new Date(at * 1000)).find((p) => p.type === 'timeZoneName').value.replace(/^GMT/, '').replace(/^([+-])(\d\d):(\d\d)$/, (_, s, h, m) => `${s}${h * 3600 + m * 60}`) || 0);
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })
      .formatToParts(new Date(at * 1000)).find((p) => p.type === 'timeZoneName').value;
    db.run('INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?), (?, ?, ?)', ['utc_offset', String(offset), at, 'zone', zone, at]);
    return true;
  };
  if (version === '9') {
    const added = addZone();
    if (added) { db.run('VACUUM'); writeFileSync(path, db.export()); }
    console.log(`${name}: already schema 9${added ? ', zone added' : ''}`);
    db.close();
    continue;
  }
  if (version !== '8') throw new Error(`${name}: schema ${version}, expected 8`);

  db.run(`CREATE TABLE progress9 (game varchar(255) NOT NULL, character varchar(255) NOT NULL, timestamp integer NOT NULL,
            level integer, exp integer, ascension_exp integer, until_next integer, fame integer, deeds integer,
            long_term_exp integer, deaths_sting varchar(255), ptp integer, mtp integer, atp integer, lumnis integer,
            rpa double precision, fashlonae integer, PRIMARY KEY (game, character, timestamp)) WITHOUT ROWID;
          INSERT INTO progress9 SELECT game, character, timestamp, level, exp, ascension_exp, until_next, fame, deeds,
            long_term_exp, deaths_sting, ptp, mtp, atp, lumnis, rpa, fashlonae FROM progress;
          DROP TABLE progress;
          ALTER TABLE progress9 RENAME TO progress;
          CREATE INDEX IF NOT EXISTS bounties_game_character_received_time_index ON bounties (game, character, received_time);`);

  let readings = 0, cleared = 0, faded = 0;
  for (const c of rows('SELECT DISTINCT game, character FROM progress ORDER BY 1, 2')) {
    const list = rows('SELECT timestamp, deaths_sting FROM progress WHERE game = ? AND character = ? ORDER BY timestamp', [c.game, c.character]);
    let prev = null, since = 0;
    list.forEach((r, i) => {
      const where = [c.game, c.character, r.timestamp];
      const stingChanged = i > 0 && r.deaths_sting !== prev;
      if (stingChanged && r.deaths_sting === 'None') {
        // the sting wore off: a None, and no other reading
        db.run('UPDATE progress SET fame = NULL, deeds = NULL, long_term_exp = NULL WHERE game = ? AND character = ? AND timestamp = ?', where);
        faded++; since = 0;
      } else if (i === 0 || stingChanged || ++since >= 6) {
        readings++; since = 0;
        // the training points, shown once with the character's first reading
        if (i === 0) db.run('UPDATE progress SET ptp = 12, mtp = 4, atp = CASE WHEN ascension_exp > 0 THEN 1 END WHERE game = ? AND character = ? AND timestamp = ?', where);
      } else {
        db.run(`UPDATE progress SET ${READINGS.map((k) => `${k} = NULL`).join(', ')} WHERE game = ? AND character = ? AND timestamp = ?`, where);
        cleared++;
      }
      prev = r.deaths_sting;
    });
  }
  db.run("UPDATE metadata SET value = '9' WHERE key = 'schema_version'");
  addZone();
  db.run('VACUUM');
  writeFileSync(path, db.export());
  db.close();
  console.log(`${name}: schema 9 (${readings} rows keep their readings, ${cleared} lose them, ${faded} sting fades)`);
}
