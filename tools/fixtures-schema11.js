// Converts the parity fixtures from schema 10 to schema 11. Run once; a file
// already at schema 11 is left alone.
//
//   node tools/fixtures-schema11.js
//
// Schema 11 (analytics.lic in elanthia-online/scripts#2556 as of fcbb3c49)
// adds combat_stats: per cycle and creature kind, a character's own damage,
// hits, kills and assists, from Lich's combat tracker. The fixtures' play
// predates it, so the table is added empty, as an older character's would be;
// the sample (tools/build-sample.js) fills it for its own characters.
//
// No golden figure reads it, so parity is unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

const FILES = ['afternoon', 'after-midnight'];
const SQL = await initSqlJs();
// As analytics.lic's Sequel create_table writes it
const DDL = [
  'CREATE TABLE `combat_stats` (`game` varchar(255) NOT NULL, `character` varchar(255) NOT NULL, `cycle_id` varchar(255) NOT NULL, ' +
    '`start_time` integer NOT NULL, `creature` varchar(255) NOT NULL, `noun` varchar(255), `fought` integer DEFAULT (0), ' +
    '`kills` integer DEFAULT (0), `assists` integer DEFAULT (0), `damage` integer DEFAULT (0), `hits` integer DEFAULT (0), ' +
    '`kill_damage` integer DEFAULT (0), PRIMARY KEY (`game`, `character`, `cycle_id`, `creature`))',
  'CREATE INDEX `combat_stats_game_character_start_time_index` ON `combat_stats` (`game`, `character`, `start_time`)',
];

for (const name of FILES) {
  const path = new URL(`../test/fixtures/${name}.db`, import.meta.url);
  const db = new SQL.Database(readFileSync(path));
  const version = db.exec("SELECT value FROM metadata WHERE key = 'schema_version'")[0].values[0][0];
  if (version === '11') { console.log(`${name}.db: already schema 11`); db.close(); continue; }
  if (version !== '10') throw new Error(`${name}.db is schema ${version}, not 10`);
  for (const sql of DDL) db.run(sql);
  db.run("UPDATE metadata SET value = '11' WHERE key = 'schema_version'");
  db.run('VACUUM');
  writeFileSync(path, db.export());
  db.close();
  console.log(`${name}.db: schema 11`);
}
