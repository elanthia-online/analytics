// Converts the parity fixtures from schema 7 to schema 8, and fills the
// tables the character detail pages read with synthetic rows. Run once;
// a file already at schema 8 is left alone.
//
//   node tools/fixtures-schema8.js
//
// The fixtures' golden JSON is frozen (it came from the script's old Ruby
// dashboard), so nothing an existing figure reads is touched: only new
// columns and the tables no golden figure reads (silver_events, item_sales,
// vendor_visits, progress, kill_stats.boxes, bounties.bp_reward). The rows
// are made up from a seeded PRNG and the fixture's own cycles, so running
// this on the schema 7 files always gives the same result.
import { readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

const FILES = ['afternoon', 'after-midnight'];
const SQL = await initSqlJs();

// mulberry32: small, seeded, the same everywhere
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEMS = ['uncut ruby', 'blue sapphire', 'star emerald', 'pink pearl', 'tigerfang crystal', 'piece of golden amber', 'dark red-green bloodstone'];
const SKINS = ['troll scalp', 'kobold ear', 'cave bear claw', 'hobgoblin hide'];
const ITEMS = ['steel longsword', 'reinforced leather', 'ora-edged dagger', 'small wooden shield'];
const SHOPS = [['gemshop', 'jeweler', 'Ragnoz', GEMS, [800, 4500]], ['furrier', 'furrier', 'Tipp', SKINS, [60, 400]],
  ['pawnshop', 'pawnbroker', 'Nilandia', ITEMS, [150, 1600]]];
const TOWNS = { GS3: "Wehnimer's Landing", GSF: 'Icemule Trace' };

for (const name of FILES) {
  const path = new URL(`../test/fixtures/${name}.db`, import.meta.url);
  const db = new SQL.Database(readFileSync(path));
  const rows = (sql, params = []) => {
    const st = db.prepare(sql); st.bind(params);
    const out = []; while (st.step()) out.push(st.getAsObject());
    st.free(); return out;
  };
  const version = rows("SELECT value FROM metadata WHERE key = 'schema_version'")[0]?.value;
  if (version === '8') { console.log(`${name}: already schema 8`); db.close(); continue; }
  if (version !== '7') throw new Error(`${name}: schema ${version}, expected 7`);
  const rand = prng(name === 'afternoon' ? 8001 : 8002);
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  let n = 0;
  const id = (p) => `${p}-s8-${String(++n).padStart(6, '0')}`;

  db.run(`ALTER TABLE cycles ADD COLUMN exp_regular_start integer; ALTER TABLE cycles ADD COLUMN exp_regular_end integer;
          ALTER TABLE cycles ADD COLUMN exp_asc_start integer; ALTER TABLE cycles ADD COLUMN exp_asc_end integer;
          ALTER TABLE vendor_visits ADD COLUMN spent integer; ALTER TABLE vendor_visits ADD COLUMN room_id integer;
          ALTER TABLE vendor_visits ADD COLUMN town varchar(255);
          CREATE TABLE progress (game varchar(255) NOT NULL, character varchar(255) NOT NULL, timestamp integer NOT NULL,
            level integer, exp integer, ascension_exp integer, until_next integer, fame integer, deeds integer,
            long_term_exp integer, deaths_sting varchar(255), ptp integer, mtp integer, atp integer, lumnis integer,
            rpa double precision, fashlonae integer, PRIMARY KEY (game, character, timestamp));
          UPDATE metadata SET value = '8' WHERE key = 'schema_version';`);

  // Regular and ascension experience: a fixed share of each character's total
  const share = {};
  for (const c of rows('SELECT DISTINCT game, character FROM cycles')) share[`${c.game}:${c.character}`] = 0.05 + rand() * 0.07;
  for (const [who, f] of Object.entries(share)) {
    const [game, character] = who.split(':');
    db.run(`UPDATE cycles SET exp_asc_start = CAST(exp_total_start * ? AS integer), exp_asc_end = CAST(exp_total_end * ? AS integer)
            WHERE game = ? AND character = ?`, [f, f, game, character]);
  }
  db.run('UPDATE cycles SET exp_regular_start = exp_total_start - exp_asc_start, exp_regular_end = exp_total_end - exp_asc_end');

  // Boxes on about one kill in twelve; bounty points on completed bounties
  for (const k of rows('SELECT rowid, kill_count FROM kill_stats')) {
    db.run('UPDATE kill_stats SET boxes = ? WHERE rowid = ?', [Math.round(k.kill_count * (0.05 + rand() * 0.06)), k.rowid]);
  }
  for (const b of rows("SELECT rowid FROM bounties WHERE status = 'completed'")) {
    db.run('UPDATE bounties SET bp_reward = ? WHERE rowid = ?', [between(380, 950), b.rowid]);
  }

  // Silver: box coins during hunts, bounty rewards, and a selling trip in each rest
  const ins = (sql, v) => db.run(sql, v);
  for (const b of rows("SELECT game, character, completed_time, silver_reward, bounty_type FROM bounties WHERE status = 'completed' AND silver_reward > 0")) {
    ins('INSERT INTO silver_events (event_id, game, character, timestamp, source_category, amount, bounty_type) VALUES (?,?,?,?,?,?,?)',
      [id('ev'), b.game, b.character, b.completed_time, 'bounty', b.silver_reward, b.bounty_type]);
  }
  for (const c of rows("SELECT cycle_id, game, character, cycle_type, start_time, end_time FROM cycles WHERE end_time IS NOT NULL AND cycle_type IN ('hunt', 'rest') ORDER BY start_time")) {
    const town = TOWNS[c.game] || "Wehnimer's Landing";
    if (c.cycle_type === 'hunt') {
      if (rand() < 0.45) {
        ins('INSERT INTO silver_events (event_id, cycle_id, game, character, timestamp, source_category, amount) VALUES (?,?,?,?,?,?,?)',
          [id('ev'), c.cycle_id, c.game, c.character, c.start_time + Math.round((c.end_time - c.start_time) * rand()), 'box', between(120, 1400)]);
      }
      continue;
    }
    let at = c.start_time + between(30, 90);
    for (const [vendor, type, npc, goods, [lo, hi]] of SHOPS) {
      if (vendor !== 'gemshop' && rand() < 0.5) continue;
      const start = at; let silver = 0;
      for (let i = between(1, vendor === 'gemshop' ? 6 : 3); i > 0; i--) {
        const item = goods[Math.floor(rand() * goods.length)], price = between(lo, hi);
        at += between(2, 6); silver += price;
        ins('INSERT INTO silver_events (event_id, cycle_id, game, character, timestamp, source_category, amount, vendor_type, vendor_name) VALUES (?,?,?,?,?,?,?,?,?)',
          [id('ev'), c.cycle_id, c.game, c.character, at, 'sale', price, type, npc]);
        ins('INSERT INTO item_sales (sale_id, game, character, timestamp, item_name, item_noun, quantity, unit_price, total_price, vendor_type, vendor_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [id('sale'), c.game, c.character, at, item, item.split(' ').pop(), 1, price, price, type, npc]);
      }
      at += between(4, 20);
      ins('INSERT INTO vendor_visits (visit_id, game, character, cycle_id, vendor, start_time, end_time, duration_seconds, silver, spent, room_id, town) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id('visit'), c.game, c.character, c.cycle_id, vendor, start, at, at - start, silver, 0, 0, town]);
      at += between(20, 60);
    }
    if (rand() < 0.15) { // the locksmith pool
      const start = at, fee = between(150, 900);
      at += between(40, 120);
      ins('INSERT INTO silver_events (event_id, cycle_id, game, character, timestamp, source_category, amount, vendor_type, vendor_name) VALUES (?,?,?,?,?,?,?,?,?)',
        [id('ev'), c.cycle_id, c.game, c.character, at, 'expense', fee, 'locksmith pool', 'Jaston']);
      ins('INSERT INTO vendor_visits (visit_id, game, character, cycle_id, vendor, start_time, end_time, duration_seconds, silver, spent, room_id, town) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id('visit'), c.game, c.character, c.cycle_id, 'locksmith pool', start, at, at - start, 0, fee, 0, town]);
    }
    const start = Math.min(at + 15, c.end_time - 5);
    if (start > at) {
      ins('INSERT INTO vendor_visits (visit_id, game, character, cycle_id, vendor, start_time, end_time, duration_seconds, silver, spent, room_id, town) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id('visit'), c.game, c.character, c.cycle_id, 'bank', start, start + 12, 12, 0, 0, 0, town]);
    }
  }

  // Progress: hourly while each character has cycles, following its experience
  const LEVELS = [0, 2500, 5000, 10000, 17500, 27500, 40000, 55000, 72500, 92500, 115000, 140000, 167000, 197500, 230000, 265000,
    302000, 341000, 382000, 425000, 470000, 517000, 566000, 617000, 670000, 725000, 781500, 839500, 899000, 960000, 1022500,
    1086500, 1152000, 1219000, 1287500, 1357500, 1429000, 1502000, 1576500, 1652500, 1730000, 1808500, 1888000, 1968500,
    2050000, 2132500, 2216000, 2300500, 2386000, 2472500, 2560000, 2648000, 2736500, 2825500, 2915000, 3005000, 3095500,
    3186500, 3278000, 3370000, 3462500, 3555500, 3649000, 3743000, 3837500, 3932500, 4028000, 4124000, 4220500, 4317500,
    4415000, 4513000, 4611500, 4710500, 4810000, 4910000, 5010500, 5111500, 5213000, 5315000, 5417500, 5520500, 5624000,
    5728000, 5832500, 5937500, 6043000, 6149000, 6255500, 6362500, 6470000, 6578000, 6686500, 6795500, 6905000, 7015000,
    7125500, 7236500, 7348000, 7460000, 7572500];
  for (const c of rows('SELECT DISTINCT game, character FROM cycles WHERE exp_regular_end > 1000')) {
    const cy = rows('SELECT start_time, end_time, exp_regular_end, exp_asc_end, fame_end FROM cycles WHERE game = ? AND character = ? AND exp_regular_end IS NOT NULL ORDER BY end_time', [c.game, c.character]);
    let next = cy[0].end_time, sting = 'None', deeds = between(3, 40), fame = cy[0].fame_end || between(100000, 900000);
    const lumnisUntil = cy[0].end_time + 3 * 86400;
    for (const row of cy) {
      if (row.end_time < next) continue;
      const exp = row.exp_regular_end, level = LEVELS.findIndex((v) => v > exp) - 1;
      if (rand() < 0.01) sting = 'Light'; else if (sting !== 'None' && rand() < 0.3) sting = 'None';
      if (rand() < 0.02) deeds += 1;
      fame = row.fame_end || fame + between(50, 400);
      ins(`INSERT OR REPLACE INTO progress (game, character, timestamp, level, exp, ascension_exp, until_next, fame, deeds, long_term_exp,
           deaths_sting, ptp, mtp, atp, lumnis, rpa, fashlonae) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.game, c.character, row.end_time, level, exp, row.exp_asc_end, LEVELS[level + 1] - exp, fame, deeds, between(0, 80),
        sting, null, null, null, row.end_time < lumnisUntil ? 1 : null, null, null]);
      next = row.end_time + 3600;
    }
  }

  db.run('VACUUM');
  writeFileSync(path, db.export());
  const count = (t) => rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;
  console.log(`${name}: schema 8; silver_events ${count('silver_events')}, item_sales ${count('item_sales')}, vendor_visits ${count('vendor_visits')}, progress ${count('progress')}`);
  db.close();
}
