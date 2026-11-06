# Roadmap

Ideas not built yet. Most came from a player's design notes (2026-11-05); the list moved here from the TODO block
in `analytics.lic` (elanthia-online/scripts#2556), which now links to this file.

Each item says where the work is:
- **site**: this repo only (`site/`)
- **script**: `analytics.lic` in elanthia-online/scripts
- **both**: the script records something new and the site shows it. Change the schema notes in
  [data-contract.md](data-contract.md) with it.

Nothing here is promised or scheduled. When an item is picked up, open an issue for it and link it here.

## Dashboard

| Idea | Where | Notes |
|---|---|---|
| Show the current rest step (selling, travelling, healing, banking) as the live state, not only "rest" | both | The script times rest steps already (`rest_steps`), but only writes them when the rest ends; the live step would need a column or a small table updated as it changes |
| Compare selling locations: sales by town and vendor | site | `item_sales` and `silver_events` have the vendor; the town needs the room, which isn't stored yet |
| Cross-character comparisons of creatures and bounty types | site | From `kill_stats` and `bounties` |
| Searchable history: filter cycles, kills, bounties, deaths and silver by character, profile, date and type | site | Everything is in the database the page already has |
| Custom date ranges and a year view; sortable rankings | site | The aggregation takes `now` and a range today; a custom range is a new range kind |
| Customizable layouts | site | Per-browser, in `localStorage` like the theme and pins |
| Bank reconciliation: show when a `BANK ACCOUNT` listing differs from the tracked total, and by how much | site | The listing row's `delta_silver` is that difference already |

## Recording (the script)

| Idea | Where | Notes |
|---|---|---|
| `;analytics report rest`: rest-step times and reasons per range | script | Or retire the text reports in favour of the site; see open-questions.md #10 |
| Death's Sting: record its level from `EXPERIENCE` and the time to recover | both | It's a penalty level (None, Light, Moderate, Sharp), not a silver cost |
| Other spending: shop purchases, deed and resurrection costs | both | Locksmith, locksmith pool and priestess are recorded (`silver_events`, `source_category = 'expense'`) |
| Locker notes, and a net worth beyond bank balances | both | |
| Per-character Discord destinations | script | discordhook has one webhook |
| Alerts for unexpected disconnects; a disarmed-weapon alert without `weapon_loadout` set up | script | |
| Settings layered global -> game -> character, not only per character | script | |
| A data retention policy (pruning old rows), alongside `maintenance compact` and `backup` | script | Also the simplest answer to open-questions.md #8 (database size) |
| Error counts and recent errors in `;analytics status` | script | |
