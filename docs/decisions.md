# Decisions

Newest first. Each entry: the decision, why, and what was rejected.

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
