# What the site reads from analytics.db

The database is analytics.lic's, and the script owns its schema (`Database.create_schema`
/ `add_missing_columns`). The site reads it and never writes. This page lists what the
aggregation depends on, so a schema change in the script can be checked against it.

Checked against schema version **6** (`metadata.schema_version`). `KNOWN_SCHEMAS` in
`site/js/aggregate/index.js` lists the versions the page loads without a warning. Add a
version there only after running the parity tests against fixtures generated at that
version.

Every row carries `game` and `character`; a character's id is `game:character`.

| Table | Columns used | For |
|---|---|---|
| `cycles` | `game`, `character`, `cycle_type` (`hunt`/`rest`/`idle`/`dead`), `start_time`, `end_time` (NULL while open), `duration_seconds`, `rest_reason`, `profile`, `exp_total_start`, `exp_total_end`, `exp_field_start`, `exp_field_end`, `exp_field_max`, `encumbrance_start` | State, timeline, today's figures, pace, trends, hunting grounds, labels |
| `bank_snapshots` | `game`, `character`, `timestamp`, `bank_name` (`'__total__'` rows only), `delta_silver` | Silver: pace, range totals, trends, login figures; labels |
| `kill_stats` | `game`, `character`, `date` (local `YYYY-MM-DD`), `profile`, `kill_count`, `total_silver`, `last_kill_at` | Kills, last kill, hunting grounds |
| `bounties` | `game`, `character`, `bounty_type`, `creature`, `area`, `status` (`active`/`completed`/`abandoned`/`expired`), `received_time`, `completed_time`, `count_required`, `count_completed`, `silver_reward`, `exp_reward` | Active bounty, typical durations, range totals, recent bounties, trends |
| `bounty_offers` | `game`, `character`, `offered_at`, `outcome`, `expedited`, `vouchers_left`, `bounty_type`, `creature`, `area`, `assignment`, `town`, `description`, `rowid` | Task offers. Optional: an older database without the table shows none |
| `rest_steps` | `game`, `character`, `cycle_id`, `step`, `seconds`, `rest_start` | Average rest breakdown |
| `logins` | `game`, `character`, `started_at`, `last_seen` | "This login" figures. Optional (`loginFor` tolerates its absence) |
| `metadata` | `key = 'schema_version'` | The compatibility warning |

Not read: `sessions`, `silver_events`, `item_sales`, `vendor_visits`. They're stored for
future reports, and the mock server's demo mode shifts their timestamps.

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
