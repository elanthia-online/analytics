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
| Searchable history across characters and over kills, bounties and silver too | site | A character's History page filters its cycles by type and text already |
| Custom date ranges (from and to dates) | site | The pages after Summary have This Year and All Time already; a custom range is a new range kind for the aggregation |
| Customizable layouts | site | Per-browser, in `localStorage` like the theme and pins |

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
| Post-cap skill goals ("303 Dodging") and ascension (ATP) goals, with ETAs at an absorption setting | both | Needs `SKILLS BASE`, `ASC EXP` and `ASC INFO` snapshots, and each profession's training cost tables. Large; exphistory.lic does it well, so consider leaving it there |

## Done

- Character pages: Income, Hunting, Bounties, Progress and History (2026-11-06; see decisions.md)
- Shop, bank and locksmith stops recorded from the map's room tags, with the town (schema 8)
- Death's Sting, with how long each stretch lasted (schema 8, the Progress page)
- Hiding characters from the overview
- Compare page: every character's income, shop stops by town, creatures and bounty types side by side (2026-11-06)
- This Year and All Time on a character's pages and Compare; sortable tables
- Bank checks: listings that found the banks off from the tracked total, on Income
- Targets with ETAs on the Progress page (level, training points past the cap, ascension points)

