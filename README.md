# GS4 Analytics dashboard

A web dashboard for [`analytics.lic`](https://github.com/elanthia-online/scripts/pull/2556),
the Lich5 script that records your Gemstone IV hunting: hunt and rest cycles, silver,
experience, kills, bounties and task offers. It is published at
**https://analytics.elanthia.online/**.

The page runs entirely in your browser. It opens your `analytics.db` with
[sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly) and works out
every figure locally. Your data is never uploaded anywhere.

> **Status:** the site is built and tested against a stand-in for the script
> (`tools/mock-server.js`). analytics.lic still serves its own built-in dashboard; the
> changes it needs to serve this one instead are written up in
> [docs/script-changes.md](docs/script-changes.md).

## Using it

Open the page and choose where the data comes from:

| Source | How | Live? | Browsers |
|---|---|---|---|
| **analytics.lic** | Run `;analytics --dashboard` (or `;analytics serve`) in Lich, then *Connect* (port 8080 unless you changed it). The script prints a link that connects for you | Yes, updates every 5 seconds | Chrome, Edge, Firefox. Safari unverified |
| **Database folder** | *Choose folder* and pick Lich's data folder, the one containing `analytics.db`. No server needed | Yes, re-reads every 5 seconds | Chrome, Edge |
| **A file** | *Choose file* and pick a copy or backup of `analytics.db` (add `analytics.db-wal` too for the very latest) | No, shown as of when the file was saved | Any modern browser |

The page remembers your choice. A live connection reconnects by itself. A folder needs one
click to allow access again after the browser restarts.

Chrome and Edge ask once whether this site may *access other apps and services on this
device*. Allow it, because that's how the page reaches analytics.lic on `127.0.0.1`.

## What's here

```
site/                 the published site, served as is (no build step)
  index.html          page shell and Content-Security-Policy
  css/dashboard.css   styles (from the script's page)
  js/app.js           UI (from the script's page) + source chooser
  js/data.js          sources (live API, folder, file) and the open database
  js/wal.js           rebuilds a live database from analytics.db + analytics.db-wal
  js/db.js            row access over sql.js
  js/aggregate/       every figure: a port of the script's Ruby dashboard
  vendor/sql.js/      sql.js 1.15.2 browser build, MIT, with checksums
test/                 node --test suites and the parity fixtures
tools/                dev server, mock analytics.lic API, e2e check, fixture generator
docs/                 working docs: start at docs/README.md
```

## Development

Needs Node 22 or newer. No other runtime dependencies.

```bash
npm install                 # sql.js, for the tests
npm test                    # parity with the Ruby dashboard + WAL reader (TZ is pinned by the script)
npm run serve               # site/ on http://localhost:8000
npm run mock -- --demo      # a stand-in analytics.lic API on 127.0.0.1:8080, data moved to "now"
npm run e2e                 # Chromium against the mock: live, detail, file and error paths
```

Then open http://localhost:8000/?live=8080.

- `npm run e2e` needs Playwright's Chromium (`npx playwright install chromium` if you don't
  have it).
- `npm run vendor` refreshes `site/vendor/sql.js` after a sql.js version bump.

`tools/gen-fixtures.rb` rebuilds the parity fixtures from a scripts checkout. See
[docs/porting-notes.md](docs/porting-notes.md).

## Publishing

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `main`,
after the tests pass. The repository's Pages source must be set to **GitHub Actions**
(Settings → Pages). The custom domain `analytics.elanthia.online` is set there as
well, not with a `CNAME` file: an Actions deploy ignores one. DNS is a CNAME record to
`elanthia-online.github.io`, and the domain is verified for the organisation.
`https://elanthia-online.github.io/analytics/` redirects to it.

## License

Not chosen yet. See [docs/open-questions.md](docs/open-questions.md). The vendored sql.js is
MIT licensed (`site/vendor/sql.js/LICENSE`).
