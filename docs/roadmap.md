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
| Compare selling locations across characters: silver a minute by town and shop | site | Schema 8 records each shop stop with its town (`vendor_visits`); a character's Income page has it per character already |
| Cross-character comparisons of creatures and bounty types | site | From `kill_stats` and `bounties`; each character's Hunting and Bounties pages have them per character |
| Searchable history across characters and over kills, bounties and silver too | site | A character's History page filters its cycles by type and text already |
| Custom date ranges and a year view; sortable rankings | site | The aggregation takes `now` and a range today; a custom range is a new range kind |
| Customizable layouts | site | Per-browser, in `localStorage` like the theme and pins |
| Bank reconciliation: show when a `BANK ACCOUNT` listing differs from the tracked total, and by how much | site | The listing row's `delta_silver` is that difference already |

## Recording (the script)

| Idea | Where | Notes |
|---|---|---|
| `;analytics report rest`: rest-step times and reasons per range | script | Or retire the text reports in favour of the site; see open-questions.md #10 |
| Other spending: shop purchases, deed and resurrection costs | both | Locksmith, locksmith pool and priestess are recorded (`silver_events`, `source_category = 'expense'`) |
| Locker notes, and a net worth beyond bank balances | both | |
| Per-character Discord destinations | script | discordhook has one webhook |
| Alerts for unexpected disconnects; a disarmed-weapon alert without `weapon_loadout` set up | script | |
| Settings layered global -> game -> character, not only per character | script | |
| A data retention policy (pruning old rows), alongside `maintenance compact` and `backup` | script | Also the simplest answer to open-questions.md #8 (database size) |
| Error counts and recent errors in `;analytics status` | script | |

## Progression (from Rysk's exphistory.lic)

A player's `exphistory.lic` (2026-11-06) tracks long-term progression. Schema 8 took the parts
Lich already knows without a command: level, regular and ascension experience, unspent training
points, deeds, Death's Sting and Lumnis (the `progress` table, and a character's Progress page).
These are the rest, which need more than that:

| Idea | Where | Notes |
|---|---|---|
| The Lumnis cycle's end time, and experience per Lumnis cycle as the leveling pace | both | Needs a quiet `LUMNIS INFO`, at most hourly once the known end has passed. analytics.lic sends no command for this yet, so this is a design decision first |
| Targets with ETAs: reach level N, or N training points past the cap | site | Per browser, like pins. The Progress page has the pace and the maths |
| Post-cap skill goals ("303 Dodging") and ascension (ATP) goals, with ETAs at an absorption setting | both | Needs `SKILLS BASE`, `ASC EXP` and `ASC INFO` snapshots, and each profession's training cost tables. Large; exphistory.lic does it well, so consider leaving it there |
| Read exphistory.lic's CSV to fill in experience history from before analytics.lic ran | site | One more source in the page, read once like a file |

## Done

- Character pages: Income, Hunting, Bounties, Progress and History (2026-11-06; see decisions.md)
- Shop, bank and locksmith stops recorded from the map's room tags, with the town (schema 8)
- Death's Sting, with how long each stretch lasted (schema 8, the Progress page)
- Hiding characters from the overview

