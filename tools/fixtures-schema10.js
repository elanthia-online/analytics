// Converts the parity fixtures from schema 9 to schema 10. Run once; a file
// already at schema 10 is left alone.
//
//   node tools/fixtures-schema10.js
//
// Schema 10 (analytics.lic in elanthia-online/scripts#2556 as of d18ceec8)
// adds RESOURCE readings to progress: resource_name, resource_weekly,
// resource_total, suffused, voln_favor, covert_arts_charges, shadow_essence,
// on the rows of the readings that showed them.
//
// No golden figure reads progress, so parity is unchanged. The readings are
// made up from each character's own rows, so a run always gives the same
// result: one on every row that already carries an EXPERIENCE reading (fame
// not null), as a rest script typing EXPERIENCE and RESOURCE together would
// give, with the weekly figure rising through the week and resetting.
import { readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

const FILES = ['afternoon', 'after-midnight'];
const SQL = await initSqlJs();
// A fixed resource per character: what their profession would show
const RESOURCE = { April: 'Lore Knowledge', Bebop: 'Grit', Leonardo: 'Devotion', Raphael: 'Guile', Splinter: 'Essence' };
const WEEK = 7 * 86_400;

for (const name of FILES) {
  const path = new URL(`../test/fixtures/${name}.db`, import.meta.url);
  const db = new SQL.Database(readFileSync(path));
  const rows = (sql, params = []) => {
    const st = db.prepare(sql); st.bind(params);
    const out = []; while (st.step()) out.push(st.getAsObject());
    st.free(); return out;
  };
  const version = rows("SELECT value FROM metadata WHERE key = 'schema_version'")[0]?.value;
  if (version === '10') { console.log(`${name}: already schema 10`); db.close(); continue; }
  if (version !== '9') throw new Error(`${name}: schema ${version}, expected 9`);

  db.run(`ALTER TABLE progress ADD COLUMN resource_name varchar(255); ALTER TABLE progress ADD COLUMN resource_weekly integer;
          ALTER TABLE progress ADD COLUMN resource_total integer; ALTER TABLE progress ADD COLUMN suffused integer;
          ALTER TABLE progress ADD COLUMN voln_favor integer; ALTER TABLE progress ADD COLUMN covert_arts_charges integer;
          ALTER TABLE progress ADD COLUMN shadow_essence integer;`);
  let readings = 0;
  for (const r of rows('SELECT game, character, timestamp FROM progress WHERE fame IS NOT NULL ORDER BY timestamp')) {
    const resource = RESOURCE[r.character] ?? 'Essence';
    const intoWeek = r.timestamp % WEEK; // seconds into the week the weekly cap counts
    const weekly = Math.min(50_000, Math.round(intoWeek / WEEK * 42_000));
    const total = Math.min(200_000, 60_000 + Math.round((r.timestamp % (30 * 86_400)) / 86_400) * 2_100);
    db.run(`UPDATE progress SET resource_name = ?, resource_weekly = ?, resource_total = ?, suffused = ?, voln_favor = ?
            WHERE game = ? AND character = ? AND timestamp = ?`,
    [resource, weekly, total, Math.round(total / 9), r.character === 'Leonardo' ? 180_000 : null, r.game, r.character, r.timestamp]);
    readings++;
  }
  db.run("UPDATE metadata SET value = '10' WHERE key = 'schema_version'");
  db.run('VACUUM');
  writeFileSync(path, db.export());
  db.close();
  console.log(`${name}: schema 10 (${readings} RESOURCE readings)`);
}
