# Decisions

Newest first. Each entry: the decision, why, and what was rejected.

## 2026-11-12: Site basics: a 404 page, canonical URLs, share previews, phone strips that scroll

**Decision.** `site/404.html`, which Pages serves for any missing path (so its links and
files are from the site root), and `tools/dev-server.js` serves it with a 404 the same way.
Every page has a canonical URL and a share preview (`og:*`, `twitter:card`); `robots.txt`
and a three-page `sitemap.xml`. The guide pages' h1 is the page's title, not the brand in
the header. On a phone the range tabs scroll sideways, and every strip or table that
scrolls fades at the edge with more (`ui/edges.js`, a CSS mask keyed on `data-more`,
removed from saved images).

**Why.** An audit against a web checklist. A wrong link gave a blank page; a shared guide
link had no preview; and on a 390px phone the range tabs ran off the screen with no
scrolling, so All Time couldn't be reached, while a table's hidden columns gave no sign.

**Rejected.** Wrapping the tabs onto two rows (a segmented control that breaks reads as
two controls), and loading sql.js only once a source is chosen: the engine is fetched with
the page, which makes connecting instant, and the first-visit page doesn't wait on it.

## 2026-11-11: Save one card as an image

**Decision.** Every card with a heading has a download arrow at its top right (a character's
card on the overview, beside pin and hide), saving that card alone, titled with the view and
the card. A table that scrolls sideways is saved whole, the image widened by what it hides.
Settings cards have none. *Save image* in the menu still saves the view.

**Why.** Players share one figure in Discord, and the whole view buried it.

**Rejected.** A menu of cards to pick from (the arrow is where the card is).

## 2026-11-10: The locksmith pool goes on Income

**Decision.** The Locksmith pool card is on a character's Income page beside the shop stops,
and on Compare after shops and towns.

**Why.** It is where the locksmith spending and pool stops already are; it was first built
on Hunting, next to boxes.

## 2026-11-10: Combat from Lich's own recorder, summed per cycle

**Decision.** Damage dealt and credited kills come from Lich's combat tracker and its
`Combat::Recorder`, run by analytics.lic itself (no `combat_stats.lic`). The recorder writes
every attack to its own file, `analytics-combat.db` in the character's data folder; the
script sums it once a minute into `combat_stats`, one row per cycle and creature kind, and
prunes the recorder's hunts three days after (every six hours, since a login can run for days). Schema 11.

**Why.** Telling a kill from an assist needs other players' attacks on the creature, which
only the recorder's `combat.attack` stream carries; its ownership rules (`attacks.ours`,
flare ownership, the window and last-hit kill credit) are checked against real logs
upstream, so they are reused, not copied. The page loads the whole database, so the
per-attack rows stay in the recorder's file, and the sums are per cycle rather than per
creature: about a hundred rows a day per character, against five thousand. A cycle's
start places it in a range, which is fine-grained enough, since a cycle is an hour or less.
The recorder names creatures as the game shows them, so the page files each under the
searched `kill_stats` name it ends with.

## 2026-11-08: The range tabs are counted as the reader chooses

**Decision.** Settings has a *Date ranges* card: today since midnight or the last 24 hours;
the week and month as whole days (the default), rolling 7 or 30 x 24 hours, or since they
began (the week on Monday or Sunday); the year since January 1 or the last 365 days. The
choice is kept with Display in `gs4a-display` and reaches the aggregation as data
(`{ now, ranges }`, `report.js` `windows(now, rules)`); the tabs are named for it. The
overview, its alerts and the menu always count today from midnight.

**Why.** Players asked whether the ranges roll or reset, and wanted both. With no rules
passed, `windows` is the text reports' `Report.windows` exactly, so parity holds. The
overview stays on the calendar day because its pace and alerts compare today with typical
days up to the same time of day, which a rolling 24 hours can't. Kills are stored per day,
so a range starting mid-day counts its first day by the nearest midnight (`windowDay`).

**Rejected.** Making the overview's today follow the choice (its pace and alerts would need
a typical "last 24 hours" to compare with), and the same choice in the script's text reports
(a reader's browser setting can't reach the script; it can be a script setting later).

## 2026-11-07: A Settings page, and a player changelog

**Decision.** Settings (`#settings`) is a page of its own, opened from the menu: Display
(totals or per hour on the cards, the figure beside each character in the menu), Date ranges
(2026-11-08), Alerts and what was dismissed today. `#alerts` opens it at Alerts. And
`site/guide/changes.html`, *What's changed*: the script and the dashboard together, newest
first, each item marked Script or Dashboard, with what to do; a player-visible change gets an
entry in the same PR (AGENTS.md).

**Why.** The alert settings were a panel at the bottom of the Alerts card that players
missed, and the display choices needed a home. Players had no way to see what changed
between versions without reading commits.

**Rejected.** A panel per card for its settings, and the changelog in the scripts repo (this
repo is the script's home).

## 2026-11-07: Dashboard alerts are tuned and dismissed in the browser

**Decision.** The overview's alerts can be turned off by kind, re-thresholded, and dismissed
for the rest of the day. The choices live in `localStorage` (`gs4a-alerts`,
`gs4a-dismissed`) and go into the aggregation as data (`buildOverview({ now, alerts,
dismissed })`), with the Ruby dashboard's thresholds as `ALERT_DEFAULTS`.

**Why.** Players asked for it. The page has no backend and never writes the database, so the
browser is the only place to keep a reader's choice, as it already is for pins, hidden
characters and targets. Built without settings, the overview is still the golden shape
exactly, so parity holds. The script's own in-game and Discord alerts stay in its settings
file; they're a different reader.

## 2026-11-07: Schema 10, again before the first release

**Decision.** The EXPERIENCE and RESOURCE readings the script stores are read from the game
text, each as a row of its own, and RESOURCE adds seven `progress` columns. That needs a new
schema version: a schema 9 file has no place for them.

**Why.** A night of real play showed infomon's timestamps can't say when EXPERIENCE was typed
(it stamps only values that changed), which lost every Death's Sting. The script's hook
already sees the output; reading it there is exact and still sends no command.

## 2026-11-06: More sample characters, built on top of the fixture

**Decision.** The sample data is no longer a byte copy of the parity fixture.
`tools/build-sample.js` (`npm run sample`) builds it from the fixture plus:
- **Karai**, past the level cap (training points and ascension), hunting at the sample's moment;
- **Casey**, around level 38, with a death in the week;
- **a week of history** for Bebop and Leonardo, ending where their own data starts.

All of it comes from a seeded PRNG, with fictional names. `test/demo.test.js` checks three
things: the file is exactly what the tool makes, every fixture row is in it unchanged, and
the added rows belong only to those four characters. The mock's `--demo` (and so the e2e
live checks and the screenshots) serves the sample.

The fixtures lost one row each from `progress`: a level-0 row. It came from a Leonardo cycle
whose total experience reads 1, which the golden figures keep, but no golden figure reads
`progress`.

**Why not add them to the fixtures.** The golden JSON came from the script's old Ruby
dashboard, which no longer exists. New characters there would change the overview's figures
with nothing left to check them against. Filling them in from the JS port itself would
make parity circular.

## 2026-11-06: Compare, longer ranges, sortable tables, bank checks, targets

**Decision.**
- **Compare.** A Compare page (`#compare`) puts each character's Income, shop stops,
  creatures and bounty types side by side, using the same builders as their own pages
  (`buildCompare`).
  - It covers every character in the database, not only today's, because a longer range
    should include an alt played last week. Hidden characters are left out.
- **This Year and All Time** on a character's pages after Summary, and on Compare. The
  Summary keeps its three ranges, because its trends and their baselines are parity-bound
  and built for those. Picking a longer range elsewhere shows the Summary for the month.
- **Sortable tables.** Every table on those pages sorts by a column (`sortTable`).
  - Each header is a button, and the sorted one carries `aria-sort`.
  - The order stays across live refreshes, and focus stays on the button.
- **Bank checks** on Income. They list listings whose `delta_silver` (the distance from the
  tracked total) isn't zero, because silver per hour counts those differences as income or
  spending without saying so.
- **Targets** on Progress: a level, training points past the cap, or ascension points,
  saved per browser with the experience at the time. The bar shows the way covered since
  then, and the ETA uses the 7-day pace (`targetEta`).

**Rejected.**
- Sorting in the browser's DOM. Rows are sorted as they're drawn, so a refresh keeps the
  order and the markup stays the same.
- A target bar from zero. It read 96% for a level that was days away.

## 2026-11-06: Detail pages for each character, and schema 8

**Decision.**
- **Character sub-pages.** A character has six pages, each with its own address
  (`#GS4%3AName/income`): Summary (the page as it was), Income, Hunting, Bounties, Progress
  and History.
  - They are real links with `aria-current`, so they can be bookmarked, Ctrl+clicked into a
    new tab, and followed by Back and Forward (navigation now pushes a history entry).
  - The range tabs apply to every page except Progress, which uses its own 7-day pace.
- **Progression from Lich's state (schema 8).** It comes from Rysk's `exphistory.lic`, but
  without a command: the `progress` table holds level, regular and ascension experience,
  training points, Death's Sting and Lumnis. The Lumnis cycle end, skill and ascension goals,
  and targets went to the roadmap.
- **Shop stops** are recorded by the script from the map's room tags, so eloot users get them
  with no change to eloot.
- **Hide a character.** Its card, its share of the totals and its alerts leave the overview,
  and it stays reachable from the sidebar's Hidden group.
- **The overview** gains experience by day for 28 days.

**Why sub-pages, not an "advanced" toggle.** A toggle would double the summary's length, and
on a phone it would bury today's view. Separate pages keep each one scannable, give screen
readers a clean heading structure, and can be linked to.

**Why no chart library.** Rysk's report loads Chart.js from a CDN. The CSP forbids that, and
vendoring it would add a 200 KB dependency that needs its own theming, high-contrast and
accessibility work. The charts here are small SVG builders that already have all of that,
so the new pages add two more of them (bars by day, labelled bars) instead.

**Rejected.**
- Refreshing a page while the reader types in its filter. The History filter redraws only
  its table, and `write()` puts focus and the caret back after a live refresh.
- Showing per-cycle fame and silver columns when no row has them. They appear only when
  the data does.

## 2026-11-06: Accessibility pass, and a high-contrast mode

**Decision.**
- **Measured, then fixed.** `tools/a11y.js` (`npm run a11y`, in CI) runs axe-core 4.14.0 at
  WCAG 2.2 A and AA plus best practices. It covers every view, the phone layout and the
  open drawer, in light, dark, and both high-contrast themes chosen on the page, and in the
  system's `prefers-contrast: more`.
- **Colour tokens are checked directly.** The same script checks the contrast of the
  tokens, because axe doesn't check SVG text, text on data colours, or borders and marks.
- **The baseline failed on:**
  - light `--muted` text: 3.7 to 4.15:1, now `#5f6878`, 5.0:1 or better;
  - white percentage labels on the rest-step bars, now a per-slot `--on-k*` colour;
  - heading order;
  - a missing h1 when choosing a new source;
  - an unnamed tooltip;
  - scroll areas a keyboard couldn't reach;
  - guide content outside a landmark.
- **Problems axe can't see, fixed too:**
  - Character cards, alerts, table names and the sidebar are real links.
  - Focus moves to the new view's heading, and the window title names it.
  - The closed phone drawer was reachable by Tab; the page behind the open one is now inert.
  - The theme switch is now real radio buttons.
  - Each chart has a data table; the timeline has a text summary; the change arrows aren't read aloud.
  - Animations used to loop forever (WCAG 2.2.2); now none runs longer than five seconds.
- **High contrast** is a toggle next to the theme. Left unset, it follows `prefers-contrast:
  more`, and it works with Light, Dark and Auto. `theme-init.js` sets `data-hc` before the
  first paint, and `display.js` runs the controls on every page, the guide included. It:
  - takes text, lines and borders to full strength;
  - drops the decorative washes and the blur behind the bars;
  - gives activity states a texture as well as a colour (resting 45 degrees, dead 135), the
    palette's documented accessibility channel.
- **High-contrast data colours.**
  - Light has its own steps, each 3:1 or better on white:
    `#1f5fb4 #c2410c #00806a #a66f00 #c0386f #006400 #5340c4 #c22d2d`.
  - These pass every check of the dataviz validator on a `#ffffff` surface, and the state
    trio (slots 1 to 3) also passes all pairs.
  - Dark keeps the validated dark steps, which already clear 3:1 on the darker surfaces.
    Brighter ones fail the validator's lightness band.
- **Forced colours** (Windows High Contrast) keep the data's colours and give everything
  else the system's.

**Rejected.**
- Driving high contrast from CSS media queries alone. Combined with the theme choice, that
  needs six copies of each rule, and a small script was already running before the first
  paint.
- A brighter dark high-contrast palette. It fails the validator's lightness band.

## 2026-11-06: A redesigned dashboard, with sample data built in

**Decision.** The page is no longer a port of the script's `PAGE`. It has a new shell,
split into modules:
- **Layout:** a sidebar with the characters (state, silver today and a flag), the data
  source, Save image, the guide and a three-way theme switch. On narrow screens the sidebar
  becomes a drawer.
- **First visit:** what the dashboard does, the three ways to connect your data, and
  *Explore sample data*.
- **Overview:** a silver hero with each character's share, KPI cards, character cards with
  a strip of the day's activity, alerts grouped by severity, and the comparison table.
- **Character page:** a sticky bar with the range tabs, and trend charts with smoothed
  lines (monotone, so they never overshoot), an area wash and a hover crosshair.
- **Motion:** views fade in once, skeletons show while loading, and both respect
  `prefers-reduced-motion`.
- **Link previews:** `og:` and `twitter:` meta tags, with `site/img/og.png` as the image.

The figures are unchanged: views read only the aggregation's JSON, and parity still holds.

The sample (`DemoSource`, `?demo`) is the synthetic fixture copied to `site/demo/`. It is
moved so its afternoon falls today at the same local time (`site/js/shift.js`, which the
mock server's `--demo` shares). It is a snapshot, so its clock stands still. A banner says
it is sample data, and the page never remembers it as the reader's source.

**Why.**
- The maintainers lifted the "keep the script's page" rule once the page left the script.
- A first-time visitor had nothing to look at without installing the script, so they get
  the sample to explore first.
- A five-second refresh used to rebuild the page, which reset hover, focus and animations
  every time. Writes are now skipped when nothing changed (`setHtml`), SVG ids come from
  the data, and clicks are delegated from the document.

**Rejected.**
- Web fonts. The CSP's `default-src 'none'` blocks them, and system fonts render the
  numbers well.
- Count-up animations on the figures. They would replay on every refresh that changed a
  number.
- Shifting the sample by the exact gap to now, as the mock does. A visit at 2am would then
  show a nearly empty day.

## 2026-11-06: The page says GS4; the data says GS3

**Decision.** Everything the page shows calls GemStone IV "GS4": character names, alerts,
the picker, the URL hash (`#GS4:Name`), the loading and error messages and the saved
image's file name. The database, the script, the figures and their ids keep `GS3`, which is
what Lich and the game servers use. `app.js` maps at the edges: `shown` and `shownId` for
display, `storedId` for a hash read back.

**Why.** Players know the game as GS4. Changing the stored code would put the script out of
step with Lich, and changing the figures' ids would break parity with the Ruby golden files
for a display choice. Nothing had been released, so no `#GS3:` links needed keeping (they
still resolve, since only GS4 is mapped back).

## 2026-11-06: Schema 7: no sessions table, no migrations before release

**Decision.** analytics.lic's schema 7 drops the `sessions` table (one row per character
per day) and the `session_id` column on cycles, bounties, bounty_offers, silver_events,
item_sales and bank_snapshots. The script has no migration code: a file with any other
`schema_version` is refused with a message, and the reader, the reports and the API refuse
it too (the API answers 503 with the reason). `KNOWN_SCHEMAS` is `['7']`. The parity fixtures
were converted to schema 7 in place.

**Why.**
- Nothing read `sessions` or `session_id`, here or in the script's reports. A day is the
  date of a row's own timestamp, and a cycle never spans midnight.
- "Session" meant a day there, while players mean a login, which `logins` records.
- Testers start with a fresh database before release, so this is the cheapest moment to
  change the schema. After release, a change like this needs a migration.

**Rejected.** Keeping `add_missing_columns` for pre-release databases. It only covered
added columns, and a half-migrated file is worse than a clear refusal.

## 2026-11-06: The player guide lives on the site; ideas live in docs/roadmap.md

**Decision.** How to install, run and configure analytics.lic is `site/guide/index.html`,
published at `https://analytics.elanthia.online/guide/`. The script's header is cut to what
it does, the fields the scripts repo reads (author, game, tags, required, version), a
three-line quick start, links to the guide and this repo, and its changelog. The settings
file the script writes keeps one line per setting and a link. The TODO list that sat
after the header is [roadmap.md](roadmap.md).

**Why.** The header had grown to hold the manual. A web page can be read before installing,
linked to, searched and kept current without a script release. The one-line settings list
stays in the YAML because people read it while editing, often offline.

**Rejected.**
- *Keep the manual in the header as well.* Two copies drift.
- *GitHub issues for every TODO item.* Issues notify watchers and imply someone is on it.
  The roadmap says where each item lives; open an issue when one is picked up.

## 2026-11-06: LAN mode is dropped

**Decision.** `;analytics --lan`, `serve ... lan` and `dashboard.lan` are refused with one
line pointing to the guide (`#lan`), and the server binds 127.0.0.1 only.

**Why.**
- The hosted page is https. Browsers block its fetches to `http://192.168.x.y` as mixed
  content, and only loopback is exempt.
- The API hands out the whole database. On the network, that's the whole database to anyone
  on it, where LAN mode used to expose only computed figures.

**Rejected.**
- *The script serves a copy of `site/` in LAN mode.* That brings back a page inside the
  script.
- *A LAN mode with a random token in the URL.* It still needs an http copy of the page,
  and a token in a URL ends up in histories and screenshots.

To see another computer's data, open a copy of its database as a file.

## 2026-11-06: The site has its own domain, analytics.elanthia.online

**Decision.** Pages serves the site at `https://analytics.elanthia.online/`, and the
script's API allows only that origin (plus local development origins and the player's
`allowed_origins`). `https://elanthia-online.github.io/analytics/` redirects there.

**Why.** Every Pages site in the organisation shares the `elanthia-online.github.io`
origin. Allowing it would let any of them read a running script's database through the
API, and their pages would share this page's `localStorage` and IndexedDB (including the
saved folder handle). An origin of its own isolates both.

**Rejected.** Allowing `elanthia-online.github.io` as well, for people with old links. The
redirect already covers them.

## 2026-11-06: The script serves the database; the browser computes the figures

**Decision.** analytics.lic exposes two routes, `/api/meta` (a change token) and `/api/db`
(a `serialize`d snapshot). All figures are computed in the browser with sql.js.

**Why.**
- It's one data path for all three sources: live, folder and file all end as a SQLite
  image.
- The dashboard can change without a script release.
- The script loses about 1,450 lines.
- The script, not the browser, reads its own WAL correctly, so the live source never
  sees stale data.

**Rejected.**
- *The script keeps computing figures and serves JSON.* Least work, but the logic would
  stay in the script, and the goal was to separate them.
- *A generic SQL endpoint.* Flexible, but it's an arbitrary-query surface on a local port.
  A read-only connection blocks writes but not expensive queries.
- *Only the browser reading the file.* Works in Chromium only. It has to rebuild the WAL
  itself (`wal.js`), and it can't be live in Firefox or Safari. Kept as a second source,
  not the main one.

## 2026-11-06: Keep the Ruby JSON shape, verified by golden fixtures

**Decision.** The JS aggregation returns exactly what `GS4Analytics::Dashboard` returned,
checked by `test/parity.test.js` against output generated from the real script.

**Why.** It lets the UI move over almost unchanged, and gives an objective oracle for a
550-line port. A rewrite into "nicer" shapes can come after, as its own change.

## 2026-11-06: Vendor sql.js, no CDN, no build step

**Decision.** `site/vendor/sql.js/` holds sql.js 1.15.2's browser build, with its MIT
license and checksums (`VERSION`). `npm run vendor` refreshes it, and
`npm run vendor -- --check` (CI) proves it matches `package.json`.

**Why.**
- A CDN would be a third-party origin with script execution on a page that reads a
  player's database.
- Vendoring keeps the CSP at `'self'`.
- No build step means what's in git is what's served.

## 2026-11-06: Simple GETs, a token in the query string

**Decision.** The page sends no custom request headers. Change detection polls a cheap
`/api/meta` and puts the token in `/api/db?token=` instead of using `If-None-Match`.

**Why.** Any non-safelisted header makes every poll a CORS-preflighted request.

## 2026-11-06: A snapshot file is shown as of its modification time

**Decision.** For the file source, `now` is the file's last-modified time. For live
sources it's the browser clock.

**Why.** Every figure is relative to now. Showing last week's backup against today's clock
would show everyone offline and today empty, which looks like a bug.

## 2026-11-06: Long ranges are rebuilt at most once a minute on an unchanged image

**Decision.** The This Year and All Time pages, and Compare on those ranges, are cached on
the database image and the minute (`LONG_RANGES` in `data.js`). Shorter ranges are still
rebuilt every second.

**Why.** On a live source the page refreshes every 5 seconds, and those ranges read all of
history: tens of milliseconds a refresh at twelve times the sample's size, and more for a
player with years of data. With nothing new written, the only thing that changes is how
long an open stretch has run, which those pages show to the minute anyway. A new write
changes the image and rebuilds them at once.

## 2026-11-06: A file source is read in the browser's zone, and says when that's wrong

**Decision.** Figures stay in the browser's zone. Schema 9 records the zone Lich ran in
(`metadata` `utc_offset` and `zone`, rewritten on every start), and the page warns when its
own offset at that moment differs (`zoneWarning` in `data.js`). It doesn't convert: the
warning says days can be a day off near midnight, and to open the file in a browser set to
the same zone.

**Why.** The live source can only be the same computer, so its zone always matches. A file
copied from another machine, or written by a Lich in WSL or a container on UTC, files kills
under that computer's dates while every timestamp is placed here. Converting would mean
reading every figure in another zone, which sql.js's `'localtime'` can't do. Recording the
zone cost one metadata row before the first release, and later it would have been a schema
change. Raised in #37. Comparing the offsets at the moment the script read its own means a
DST change since then is never taken for a different zone. The demo sample is moved into
the reader's zone, so its offset is rewritten to the reader's.

## 2026-11-06: Schema 9, before the first release

**Decision.** The script went to schema 9 for MahtraDR's review instead of adding the fixes
to schema 8: `progress` became `WITHOUT ROWID`, its EXPERIENCE readings are NULL unless
fresh, and a hunt stopped by hand is "hunt stopped", not a crash. The page admits only 9.
The Progress page takes the latest non-NULL value of each reading and says when it was
read. A Death's Sting stretch runs from the end of the `dead` cycle to the next None
reading; its level is the last reading between, or "not read".

**Why.** Nothing is released yet, so a schema change costs a fresh database and nothing
more, and the script has no migrations by design. Leaving old readings stamped on every row
made "fame now" and the sting's end look known when they weren't. A death is the real start
of a sting; the first reading that shows it can come hours later.
