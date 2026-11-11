// Converts the parity fixtures from schema 10 to schema 11. Run once; a file
// already at schema 11 is left alone.
//
//   node tools/fixtures-schema11.js
//
// Schema 11 (analytics.lic in elanthia-online/scripts#2556 as of 29181ae2)
// adds combat_stats (per cycle and creature kind, a character's own damage,
// hits, kills and assists, from Lich's combat tracker) and pool_depth (how
// many of a character's boxes the locksmith pool held each time it listed
// them, and each box it turned away). The fixtures' play predates both, so
// the tables are added empty; the sample (tools/build-sample.js) fills them
// for its own characters. A file already at 11 gets any table it lacks.
//
// No golden figure reads them, so parity is unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

const FILES = ['afternoon', 'after-midnight'];
const SQL = await initSqlJs();
// As analytics.lic's Sequel create_table writes it
const DDL = [
  ['combat_stats',
  'CREATE TABLE `combat_stats` (`game` varchar(255) NOT NULL, `character` varchar(255) NOT NULL, `cycle_id` varchar(255) NOT NULL, ' +
    '`start_time` integer NOT NULL, `creature` varchar(255) NOT NULL, `noun` varchar(255), `fought` integer DEFAULT (0), ' +
    '`kills` integer DEFAULT (0), `assists` integer DEFAULT (0), `damage` integer DEFAULT (0), `hits` integer DEFAULT (0), ' +
    '`kill_damage` integer DEFAULT (0), PRIMARY KEY (`game`, `character`, `cycle_id`, `creature`))',
  'CREATE INDEX `combat_stats_game_character_start_time_index` ON `combat_stats` (`game`, `character`, `start_time`)'],
  ['pool_depth',
  'CREATE TABLE `pool_depth` (`game` varchar(255) NOT NULL, `character` varchar(255) NOT NULL, `timestamp` integer NOT NULL, ' +
    '`full` integer DEFAULT (0) NOT NULL, `town` varchar(255), `npc` varchar(255), `boxes` integer, `waiting` integer, ' +
    'PRIMARY KEY (`game`, `character`, `timestamp`, `full`))'],
];

for (const name of FILES) {
  const path = new URL(`../test/fixtures/${name}.db`, import.meta.url);
  const db = new SQL.Database(readFileSync(path));
  const version = db.exec("SELECT value FROM metadata WHERE key = 'schema_version'")[0].values[0][0];
  if (version !== '10' && version !== '11') throw new Error(`${name}.db is schema ${version}, not 10 or 11`);
  const have = (t) => db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${t}'`).length > 0;
  const missing = DDL.filter(([table]) => !have(table));
  if (version === '11' && !missing.length) { console.log(`${name}.db: already schema 11`); db.close(); continue; }
  for (const [, ...sqls] of missing) for (const sql of sqls) db.run(sql);
  db.run("UPDATE metadata SET value = '11' WHERE key = 'schema_version'");
  db.run('VACUUM');
  writeFileSync(path, db.export());
  db.close();
  console.log(`${name}.db: schema 11 (added ${missing.map(([t]) => t).join(', ')})`);
}
