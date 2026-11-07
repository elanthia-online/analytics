// Builds the site's sample data (site/demo/sample.db) from the parity fixture
// test/fixtures/afternoon.db, plus more made-up characters and history.
//
//   npm run sample            (writes site/demo/sample.db)
//   npm run sample -- --check (fails if the committed file is out of date)
//
// The fixture's rows are copied unchanged; test/demo.test.js checks that. The
// parity fixtures themselves stay as they are: their golden JSON came from the
// script's old Ruby dashboard and can't be made again, so new characters go
// only into the sample. Everything added is synthetic, from a seeded PRNG, with
// fictional names:
//   Karai     a new character past the level cap (training points, ascension), hunting now
//   Casey     a new character around level 38, with a death in the week
//   Bebop and Leonardo get the week before the fixture's own days, ending where they start
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { EXP_FOR_LEVEL, CAP_EXP, levelOf } from '../site/js/aggregate/details.js';

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const midnightOf = (ts) => { const d = new Date(ts * 1000); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000); };

const PEOPLE = [
  { name: 'Karai', profile: 'karai_ashfall', area: 'the Ashfall', town: "Wehnimer's Landing", days: 8,
    creatures: ['cinder wraith', 'ashen skulker', 'storm griffin'], exp0: CAP_EXP + 3_650_000, asc0: 1_880_000, fame0: 2_400_000,
    perHunt: [9000, 14000], ascShare: 0.32, bank0: 48_000_000, lumnisDays: 3, unspent: { ptp: 36, mtp: 12, atp: 3 }, nowHunting: true },
  { name: 'Casey', profile: 'casey_graveyard', area: 'the Graveyard', town: "Wehnimer's Landing", days: 8,
    creatures: ['skeletal soldier', 'ghoul', 'phantom'], exp0: 1_480_000, asc0: 0, fame0: 180_000,
    perHunt: [2800, 4600], ascShare: 0, bank0: 640_000, death: 3, unspent: { ptp: 4, mtp: 7, atp: null } },
  // The fixture's own characters, back-filled for the week before their first day
  { name: 'Bebop', backfill: true, profile: 'bebop_hunt', area: 'the Crags', town: "Wehnimer's Landing", days: 6,
    creatures: ['troll', 'kobold', 'hobgoblin'], perHunt: [3000, 5200], ascShare: 0.08 },
  { name: 'Leonardo', backfill: true, profile: 'leonardo_ta_vaalor', area: 'Ta\'Vaalor', town: "Ta'Vaalor", days: 5,
    creatures: ['kobold', 'hobgoblin'], perHunt: [2600, 4400], ascShare: 0.06 },
];
const REASONS = ['encumbered.', 'Too many items', 'Mind full', 'Low mana'];
const GEMS = [['uncut ruby', 'ruby'], ['blue sapphire', 'sapphire'], ['star emerald', 'emerald'], ['pink pearl', 'pearl'], ['tigerfang crystal', 'crystal']];
const LOOT = [['steel longsword', 'longsword'], ['reinforced leather', 'leather'], ['small wooden shield', 'shield']];
const TYPES = ['cull', 'gem', 'skin', 'heirloom'];

export function buildSample(SQL, fixture, now) {
  const db = new SQL.Database(fixture);
  const rand = prng(20261106);
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let n = 0;
  const id = (p) => `${p}-x-${String(++n).padStart(6, '0')}`;
  const run = (sql, v) => db.run(sql, v);
  const one = (sql, v) => { const st = db.prepare(sql); st.bind(v); const r = st.step() ? st.getAsObject() : null; st.free(); return r; };
  const today = midnightOf(now);

  for (const who of PEOPLE) {
    const G = 'GS3', C = who.name;
    // Where the character starts: a new one from its own figures, a back-filled one
    // so that its last added day ends exactly where the fixture's first begins
    let firstDay, exp, asc, fame, bank, endAt;
    if (who.backfill) {
      const first = one('SELECT start_time, exp_regular_start AS r, exp_asc_start AS a FROM cycles WHERE game = ? AND character = ? ORDER BY start_time LIMIT 1', [G, C]);
      const firstBank = one("SELECT balance, delta_silver FROM bank_snapshots WHERE game = ? AND character = ? AND bank_name = '__total__' ORDER BY timestamp LIMIT 1", [G, C]);
      endAt = midnightOf(first.start_time);
      firstDay = endAt - who.days * 86400;
      // Worked out after the days are generated (see shift below)
      exp = 0; asc = 0; fame = null; bank = 0;
      who.target = { r: first.r, a: first.a, bank: firstBank.balance - (firstBank.delta_silver || 0) };
    } else {
      firstDay = today - (who.days - 1) * 86400;
      endAt = now;
      exp = who.exp0; asc = who.asc0; fame = who.fame0; bank = who.bank0;
    }
    const rows = { cycles: [], kills: new Map(), banks: [], events: [], sales: [], visits: [], steps: [], bounties: [], offers: [], progress: [], logins: [] };
    let bounty = null, lastProgress = 0, sting = null;
    // Rows as schema 9 writes them: the EXPERIENCE readings (fame, deeds, long-term
    // exp, Death's Sting) only on a row a reading came before (fresh: typed at
    // login and after a death), the training points once, and a None row when
    // the sting fades
    const progress = (at, force, fresh = false) => {
      const lumnis = (t) => (who.lumnisDays && t < firstDay + who.lumnisDays * 86400 ? 1 : null);
      if (sting && at >= sting) {
        rows.progress.push({ at: sting, exp, asc, fame: null, sting: 'None', fresh: false, lumnis: lumnis(sting) });
        sting = null;
      }
      if (!force && at - lastProgress < 3600) return;
      lastProgress = at;
      rows.progress.push({ at, exp, asc, fame: fresh ? fame : null, sting: fresh ? (sting ? 'Light' : 'None') : null, fresh, lumnis: lumnis(at) });
    };

    for (let d = 0; d < who.days; d++) {
      const day = firstDay + d * 86400, isToday = day === today;
      // Today's play starts early enough to have happened by the sample's afternoon
      let at = day + between(8, isToday ? 10 : 13) * 3600 + between(0, 59) * 60;
      const sessionEnd = isToday ? (who.nowHunting ? now : Math.min(now - 2 * 3600, at + 3 * 3600)) : Math.min(endAt, at + between(3, 6) * 3600);
      if (at >= sessionEnd) continue;
      const loginAt = at - 300;
      progress(at, true, true); // EXPERIENCE at login
      while (at < sessionEnd) {
        // A hunt
        const huntLen = between(35, 55) * 60, open = who.nowHunting && isToday && at + huntLen > sessionEnd;
        const end = open ? null : Math.min(at + huntLen, sessionEnd);
        const gain = between(...who.perHunt), ascGain = Math.round(gain * who.ascShare);
        const cid = id('c');
        const regGain = gain - ascGain;
        rows.cycles.push({ cid, type: 'hunt', start: at, end, reason: null, r0: exp, r1: open ? null : exp + regGain, a0: asc, a1: open ? null : asc + ascGain,
          f0: fame, f1: fame == null || open ? null : fame + between(200, 900), field: [between(0, 200), open ? null : between(600, 1100)], enc: [between(10, 25), open ? null : between(30, 55)] });
        const stop = end || now;
        let kills = Math.round((stop - at) / between(35, 55)), silver = 0;
        for (let k = 0; k < kills; k++) {
          const creature = pick(who.creatures), key = `${localDate(at)}|${creature}`, s = between(40, 320);
          const row = rows.kills.get(key) || { date: localDate(at), creature, count: 0, silver: 0, boxes: 0, last: 0 };
          row.count += 1; row.silver += s; row.boxes += rand() < 0.08 ? 1 : 0; row.last = Math.max(row.last, at + Math.round((stop - at) * (k + 1) / kills));
          rows.kills.set(key, row); silver += s;
        }
        if (bounty) bounty.done = Math.min(bounty.need, bounty.done + Math.round(kills / 3));
        if (open) break;
        exp += regGain; asc += ascGain; if (fame != null) fame = rows.cycles.at(-1).f1;
        at = end;
        progress(at);
        if (at >= sessionEnd) break;
        // Casey's death, once, mid-week
        if (who.death && d === who.days - 1 - who.death && !sting) {
          const dead = between(6, 11) * 60;
          rows.cycles.push({ cid: id('c'), type: 'dead', start: at, end: at + dead, reason: null, r0: exp, r1: exp, a0: asc, a1: asc, f0: fame, f1: fame, field: [0, 0], enc: [40, 40] });
          sting = at + dead + between(3, 5) * 3600;
          at += dead; progress(at, true, true); // EXPERIENCE after the death
        }
        // A rest: selling, the bank, maybe a bounty
        const restLen = Math.min(between(5, 12) * 60, sessionEnd - at), rid = id('c');
        if (restLen < 60) break;
        rows.cycles.push({ cid: rid, type: 'rest', start: at, end: at + restLen, reason: pick(REASONS), r0: exp, r1: exp, a0: asc, a1: asc, f0: fame, f1: fame, field: [900, 300], enc: [50, 10] });
        let t = at + between(40, 90), take = silver;
        const shop = (vendor, type, npc, goods, lo, hi, count) => {
          const start = t; let got = 0;
          for (let i = 0; i < count; i++) {
            const [item, noun] = pick(goods), price = between(lo, hi);
            t += between(3, 6); got += price;
            rows.events.push({ cid: rid, at: t, cat: 'sale', amount: price, vt: type, vn: npc });
            rows.sales.push({ at: t, item, noun, price, vt: type, vn: npc });
          }
          t += between(5, 15);
          rows.visits.push({ cid: rid, vendor, start, end: t, silver: got, spent: 0 });
          t += between(20, 50); take += got;
        };
        shop('gemshop', 'jeweler', 'Ragnoz', GEMS, who.name === 'Karai' ? 2500 : 600, who.name === 'Karai' ? 9000 : 2600, between(1, 5));
        if (rand() < 0.5) shop('pawnshop', 'pawnbroker', 'Nilandia', LOOT, 200, 1400, between(1, 2));
        if (bounty && bounty.done >= bounty.need) {
          const reward = between(800, 2600);
          rows.events.push({ cid: rid, at: t, cat: 'bounty', amount: reward, vt: null, vn: null, bt: bounty.type });
          bounty.completed = t; bounty.silver = reward; bounty.exp = between(900, 1500); bounty.bp = between(450, 950); take += reward;
          bounty = null; t += 30;
        }
        if (!bounty && rand() < 0.7) {
          const type = pick(TYPES), b = { bid: id('q'), type, creature: type === 'gem' ? pick(GEMS)[0] : pick(who.creatures), need: between(12, 20), done: 0, received: t, status: 'active' };
          rows.bounties.push(b); bounty = b;
          rows.offers.push({ at: t - 20, ended: null, type, creature: b.creature, outcome: 'open', bid: b.bid, expedited: rand() < 0.15 });
        }
        // Everything banked in one deposit, tracked through the teller
        const bstart = Math.min(t, at + restLen - 20);
        rows.visits.push({ cid: rid, vendor: 'bank', start: bstart, end: bstart + 12, silver: 0, spent: 0 });
        bank += take;
        rows.banks.push({ cid: rid, at: bstart + 10, balance: bank, delta: take, type: 'deposit' });
        const steps = { travel: restLen * 0.4, selling: restLen * 0.35, bounty: restLen * 0.1, waiting: restLen * 0.15 };
        for (const [step, secs] of Object.entries(steps)) rows.steps.push({ cid: rid, step, secs: Math.round(secs * 10) / 10, start: at });
        at += restLen;
        progress(at);
      }
      // A BANK ACCOUNT listing at the end of each day's play: it matches, but for one day a week
      if (!(isToday && who.nowHunting)) rows.banks.push({ cid: null, at: Math.min(at, sessionEnd) - 5, balance: bank + (d === 2 ? 15_000 : 0), delta: d === 2 ? 15_000 : 0, type: 'bank_account' });
      if (d === 2) bank += 15_000;
      rows.logins.push({ start: loginAt, last: isToday && who.nowHunting ? now - 30 : Math.min(at, sessionEnd) + 60 });
    }
    // A bounty still open at the end of the data stays active; one never finished before a back-filled day ends, expired
    for (const b of rows.bounties) if (b.status === 'active' && b.completed) b.status = 'completed';
    for (const b of rows.bounties) if (b.status === 'active' && who.backfill) b.status = 'expired';
    // An offer ends as the script ends it: completed with its bounty, expired
    // when the bounty did, and open while the task is still held
    const byId = new Map(rows.bounties.map((b) => [b.bid, b]));
    for (const o of rows.offers) {
      const b = byId.get(o.bid);
      if (b.status === 'completed') { o.outcome = 'completed'; o.ended = b.completed; }
      else if (b.status === 'expired') { o.outcome = 'expired'; o.ended = b.received + 3600; }
    }

    // A back-filled character's added days end where its own data starts
    let dr = 0, da = 0, db0 = 0;
    if (who.backfill) {
      dr = who.target.r - exp; da = who.target.a - asc; db0 = who.target.bank - bank;
    }
    const R = (v) => (v == null ? null : v + dr), A = (v) => (v == null ? null : v + da);

    for (const c of rows.cycles) {
      const t0 = c.r0 == null ? null : R(c.r0) + A(c.a0), t1 = c.r1 == null ? null : R(c.r1) + A(c.a1);
      run(`INSERT INTO cycles (cycle_id, game, character, cycle_type, start_time, end_time, duration_seconds, profile, trigger_script, rest_reason,
           exp_total_start, exp_total_end, exp_field_start, exp_field_end, exp_field_max, fame_start, fame_end, encumbrance_start, encumbrance_end,
           exp_regular_start, exp_regular_end, exp_asc_start, exp_asc_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.cid, G, C, c.type, c.start, c.end, c.end == null ? null : c.end - c.start, who.profile, c.type === 'hunt' ? 'bigshot' : null, c.reason,
        t0, t1, c.field[0], c.field[1], 1100, c.f0, c.f1, c.enc[0], c.enc[1], R(c.r0), R(c.r1), A(c.a0), A(c.a1)]);
    }
    for (const k of rows.kills.values()) {
      run('INSERT INTO kill_stats (game, character, date, profile, creature, kill_count, total_silver, boxes, last_kill_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [G, C, k.date, who.profile, k.creature, k.count, k.silver, k.boxes, k.last]);
    }
    for (const b of rows.banks) {
      run('INSERT INTO bank_snapshots (snapshot_id, cycle_id, game, character, timestamp, bank_name, balance, delta_silver, snapshot_type) VALUES (?,?,?,?,?,?,?,?,?)',
        [id('b'), b.cid, G, C, b.at, '__total__', b.balance + db0, b.delta, b.type]);
    }
    for (const e of rows.events) {
      run('INSERT INTO silver_events (event_id, cycle_id, game, character, timestamp, source_category, amount, vendor_type, vendor_name, bounty_type) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id('ev'), e.cid, G, C, e.at, e.cat, e.amount, e.vt, e.vn, e.bt || null]);
    }
    for (const s of rows.sales) {
      run('INSERT INTO item_sales (sale_id, game, character, timestamp, item_name, item_noun, quantity, unit_price, total_price, vendor_type, vendor_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id('sale'), G, C, s.at, s.item, s.noun, 1, s.price, s.price, s.vt, s.vn]);
    }
    for (const v of rows.visits) {
      run('INSERT INTO vendor_visits (visit_id, game, character, cycle_id, vendor, start_time, end_time, duration_seconds, silver, spent, room_id, town) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id('visit'), G, C, v.cid, v.vendor, v.start, v.end, v.end - v.start, v.silver, v.spent, 0, who.town]);
    }
    for (const s of rows.steps) {
      run('INSERT INTO rest_steps (cycle_id, game, character, step, seconds, rest_start) VALUES (?,?,?,?,?,?)', [s.cid, G, C, s.step, s.secs, s.start]);
    }
    for (const b of rows.bounties) {
      run(`INSERT INTO bounties (bounty_id, game, character, received_time, completed_time, bounty_type, creature, area, count_required, count_completed,
           silver_reward, exp_reward, bp_reward, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.bid, G, C, b.received, b.completed || null, b.type, b.creature, b.type === 'gem' ? 'Solhaven' : who.area, b.need, b.done,
        b.silver || null, b.exp || null, b.bp || null, b.status]);
    }
    for (const o of rows.offers) {
      run(`INSERT INTO bounty_offers (offer_id, game, character, offered_at, ended_at, assignment, town, bounty_type, creature, area, count, expedited,
           vouchers_left, outcome, bounty_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id('o'), G, C, o.at, o.ended, `${o.type === 'gem' ? 'gem' : 'creature'}_assignment`, who.town, o.type, o.creature, who.area, 15,
        o.expedited ? 1 : 0, o.expedited ? between(1, 40) : null, o.outcome, o.bid]);
    }
    for (const l of rows.logins) {
      run('INSERT OR REPLACE INTO logins (game, character, started_at, first_seen, last_seen) VALUES (?,?,?,?,?)', [G, C, l.start, l.start, l.last]);
    }
    let tpWritten = false;
    for (const p of rows.progress) {
      const e = R(p.exp), a = A(p.asc), level = levelOf(e), capped = level >= 100;
      const tp = p.fresh && !tpWritten ? who.unspent : null;
      if (tp) tpWritten = true;
      run(`INSERT OR REPLACE INTO progress (game, character, timestamp, level, exp, ascension_exp, until_next, fame, deeds, long_term_exp, deaths_sting,
           ptp, mtp, atp, lumnis, rpa, fashlonae) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [G, C, p.at, level, e, a, capped ? 2500 - ((e - CAP_EXP) % 2500) : EXP_FOR_LEVEL[level + 1] - e, p.fame,
        p.fresh ? (who.backfill ? 9 : who.name === 'Karai' ? 212 : 31) : null, p.fresh ? between(0, 90) : null, p.sting,
        tp?.ptp ?? null, tp?.mtp ?? null, tp?.atp ?? null, p.lumnis, null, null]);
    }
  }
  db.run('VACUUM');
  const out = db.export();
  db.close();
  return out;
}

// Run from the command line
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.TZ !== 'America/New_York') {
    console.error('run with TZ=America/New_York (npm run sample does), the fixture\'s time zone');
    process.exit(1);
  }
  const SQL = await initSqlJs();
  const meta = JSON.parse(readFileSync(new URL('../site/demo/sample.json', import.meta.url)));
  const bytes = buildSample(SQL, readFileSync(new URL('../test/fixtures/afternoon.db', import.meta.url)), meta.now);
  const path = new URL('../site/demo/sample.db', import.meta.url);
  if (process.argv.includes('--check')) {
    const same = Buffer.from(bytes).equals(readFileSync(path));
    console.log(same ? 'site/demo/sample.db is up to date' : 'site/demo/sample.db is out of date: run npm run sample');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(path, bytes);
  console.log(`site/demo/sample.db: ${bytes.length} bytes`);
}
