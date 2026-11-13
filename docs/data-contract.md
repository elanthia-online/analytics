# What the site reads from analytics.db

The database is analytics.lic's, and the script owns its schema (`Database.create_schema`).
The site reads it and never writes. The script has no migrations: it refuses to open a
file whose `schema_version` isn't its own, and the player starts a fresh database. This page lists what the
aggregation depends on, so a schema change in the script can be checked against it.

Checked against schema version **11** (`metadata.schema_version`). `KNOWN_SCHEMAS` in
`site/js/aggregate/index.js` lists the versions the page loads without a warning.

The fixtures can't be regenerated any more (`tools/gen-fixtures.rb` needs the Ruby
dashboard, which the script no longer has). They were generated at schema 6, converted
to schema 7, then to schema 8 by `tools/fixtures-schema8.js` and to schema 9 by
`tools/fixtures-schema9.js`, then to schema 10 by `tools/fixtures-schema10.js` and to schema 11 by `tools/fixtures-schema11.js`, as `test/fixtures/source.json` records. To admit a new schema version: convert the fixture databases to its shape the same
way (leaving the golden JSON alone, and filling only columns and tables no golden figure
reads), run `npm test`, and add the version only if parity still passes. Rebuild
`site/demo/sample.db` afterwards with `npm run sample` (`test/demo.test.js` checks it). A change to a
column listed below also needs the aggregation updated in the same change.

Every row carries `game` and `character`; a character's id is `game:character`. GemStone IV
is `GS3` there, as Lich and the game servers call it. The page shows it as GS4 (names, the
URL hash, the saved image's file name) and maps back at its edges (`shown`, `shownId` and
`storedId` in `site/js/ui/util.js`); the figures and their ids keep `GS3`.

| Table | Columns used | For |
|---|---|---|
| `cycles` | `game`, `character`, `cycle_type` (`hunt`/`rest`/`idle`/`dead`), `start_time`, `end_time` (NULL while open), `duration_seconds`, `rest_reason` (on a hunt, why it ended; `hunt stopped` for one that ended with no rest; `crashed` on any cycle the script found still open at its next start, unless it had a reason), `profile`, `exp_total_start`, `exp_total_end`, `exp_field_start`, `exp_field_end`, `exp_field_max`, `encumbrance_start`; and for the detail pages `cycle_id`, `fame_start`, `fame_end`, `exp_asc_start`, `exp_asc_end` (schema 8) | State, timeline, today's figures, pace, trends, hunting grounds, labels; History; experience by day, regular and ascension apart |
| `bank_snapshots` | `game`, `character`, `timestamp`, `bank_name` (`'__total__'` rows only), `delta_silver` | Silver: pace, range totals, trends, login figures; labels |
| `kill_stats` | `game`, `character`, `date` (local `YYYY-MM-DD`), `profile`, `kill_count`, `total_silver`, `last_kill_at` | Kills, last kill, hunting grounds |
| `bounties` | `game`, `character`, `bounty_type`, `creature`, `area`, `status` (`active`/`completed`/`abandoned`/`expired`), `received_time`, `completed_time`, `count_required`, `count_completed`, `silver_reward`, `exp_reward` | Active bounty, typical durations, range totals, recent bounties, trends |
| `bounty_offers` | `game`, `character`, `offered_at`, `outcome`, `expedited`, `vouchers_left`, `bounty_type`, `creature`, `area`, `assignment`, `town`, `description`, `rowid` | Task offers. Optional: an older database without the table shows none |
| `rest_steps` | `game`, `character`, `cycle_id`, `step`, `seconds`, `rest_start` | Average rest breakdown |
| `logins` | `game`, `character`, `started_at`, `last_seen` | "This login" figures. Optional (`loginFor` tolerates its absence) |
| `metadata` | `key = 'schema_version'`; from schema 9 `utc_offset` (seconds east of UTC) and `zone` (its name), with `updated_at` the moment they were read | The compatibility warning; the warning that a file was written in another zone (`zoneWarning`). Without them the zone is unknown and nothing is shown |

The character detail pages and Compare read more tables and columns; they're listed
[below](#the-character-detail-pages-and-compare-sitejsaggregatedetailsjs).

The mock server's demo mode shifts every table's timestamps. Schema 7 dropped the `sessions` table (one row per character per day) and every
`session_id` column: nothing read them, and a day is the date of a row's own timestamp.

## Conventions the figures rely on

- Timestamps are unix seconds (integers). `kill_stats.date` is the **local** date at the
  Lich computer when the kill was recorded.
- `delta_silver` on `__total__` rows is the change since the previous total. Summing it
  over a range gives silver in and out for the range.
- A cycle is "open" while `end_time` is NULL. An open cycle older than 2 hours
  (`STALE_OPEN`) means the character isn't running any more.
- `duration_seconds < 10` hunts are noise and are excluded everywhere.
- Booleans (`bounty_offers.expedited`) are stored by Sequel as `1`/`0`. `'t'`/`'1'` are
  accepted too.

### The character detail pages and Compare (`site/js/aggregate/details.js`)

New figures, not ports of the Ruby dashboard; `test/details.test.js` checks them against
independent queries. Every table and column here is optional: an older database shows an
empty section, never an error.

| Table | Columns used | For |
|---|---|---|
| `silver_events` | `source_category` (`sale`/`box`/`bounty`/`expense`, and from schema 10 `floor` for coins picked up), `vendor_type`, `amount`, `timestamp`. From schema 9 a sale's `vendor_type` is the shop's room tag (`gemshop`, `furrier`, `pawnshop`, ...) when it happened during a shop visit, and an expense's is its kind (`warehouse` among them) | Income: where silver came from, what was spent |
| `item_sales` | `item_name`, `total_price`, `vendor_type`, `timestamp` | Income: best sellers |
| `vendor_visits` | `vendor` (the room tag), `start_time`, `duration_seconds`, `silver`, and from schema 8 `spent`, `town` | Income: shops and stops, by town |
| `kill_stats` | `creature`, `kill_count`, `total_silver`, `boxes`, `profile`, `last_kill_at`, `date` | Hunting; Income's coins on creatures |
| `pool_depth` (schema 11) | `timestamp`, `full` (1: a box turned away, no count), `town`, `boxes`, `waiting` | Income's and Compare's Locksmith pool |
| `combat_stats` (schema 11) | `creature`, `start_time` (the cycle's), `fought`, `kills`, `assists`, `damage`, `hits`, `kill_damage`; `kill_stats.creature` to file a recorder's name ("cadaverous tatterdemalion ghast") under the searched one it ends with | Hunting's Combat card; Compare's Combat |
| `bounties` | `bp_reward` as well as the columns above | Bounties: points each and an hour |
| `bank_snapshots` | `cycle_id`; and `snapshot_type`, `balance`, `delta_silver` on `'__total__'` rows that aren't `deposit`, `withdraw` or `unstated` | History: silver per cycle; Income's bank checks (a listing's `delta_silver` is how far it was from the tracked total) |
| `progress` (schema 8; WITHOUT ROWID from 9) | `timestamp`, `level`, `exp`, `ascension_exp`, `lumnis`, `rpa` on every row; `fame`, `deeds`, `long_term_exp`, `deaths_sting` only on a row an EXPERIENCE reading came before, and `ptp`, `mtp`, `atp` only on the row after they were shown (schema 9; NULL means "not read", never zero) | Progress: level or training points, ascension points, pace and ETAs, the latest of each reading and when it was read, Lumnis share |
| `progress` (schema 10) | `resource_name`, `resource_weekly`, `resource_total`, `suffused`, `voln_favor`, `covert_arts_charges`, `shadow_essence`: a RESOURCE reading, on its own row | Progress: the latest resources, and when they were read |
| `progress` and `cycles` | `deaths_sting` readings (a `'None'` row is written when the sting wears off; from schema 10 each EXPERIENCE reading is its own row at the moment it was shown), and the start of each `dead` cycle | Death's Sting: each stretch from the death to the next None, its level the last reading between |

