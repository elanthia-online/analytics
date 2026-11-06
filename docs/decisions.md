# Decisions

Newest first. Each entry: the decision, why, and what was rejected.

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
