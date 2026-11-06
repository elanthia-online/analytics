# AGENTS.md

Guidance for coding agents (and humans) working in this repo. `CLAUDE.md` points here.

## What this is

A static site (GitHub Pages, no build step) that opens an analytics.lic SQLite database in
the browser with sql.js and renders the hunting dashboard. analytics.lic lives in
elanthia-online/scripts (`scripts/analytics.lic`, PR elanthia-online/scripts#2556). It
writes the database and serves it over a small local API ([docs/api.md](docs/api.md));
[docs/script-changes.md](docs/script-changes.md) records how the script was changed for that.

`site/guide/` is the player documentation for the script. The script's header links to
it, so keep it in step with the script: a new setting, command or report belongs in the
guide in the same change that adds it. Ideas not built yet go in
[docs/roadmap.md](docs/roadmap.md).

Read [docs/README.md](docs/README.md) first; it indexes the working docs.

## Commands

```bash
npm test                 # always: parity + WAL suites (pins TZ=America/New_York)
npm run e2e              # after any change under site/ (Chromium + mock API)
npm run a11y             # after any change under site/: axe-core on every view and theme, plus the colour tokens
npm run vendor -- --check
npm run serve            # http://localhost:8000
npm run mock -- --demo   # stand-in script API on 127.0.0.1:8080
npm run screenshots      # README images (docs/images/) and site/img/og.png
```

Run `npm test` and `npm run e2e` before saying a change works. A static read is not
verification.

## Rules

- **Aggregation is pure.** `site/js/aggregate/` takes `(conn, now)` and returns JSON. It
  never touches the DOM, `fetch`, `localStorage` or `Date.now()`. Time comes in as `now`.
  Days come from `time.js`.
- **Parity is the contract.** The JSON shape and values match what the Ruby
  `GS4Analytics::Dashboard` produced (`test/fixtures/*.json`). If a change alters a figure
  on purpose, regenerate or hand-edit the golden files in the same commit and say why
  in the message. Never loosen `test/parity.test.js` to make a failure go away.
- **Ruby semantics** (`nil.to_i`, `Float#round`, integer division, truthy `0`, unstable
  `sort_by`) have helpers in `aggregate/ruby.js`. Use them; see
  [docs/porting-notes.md](docs/porting-notes.md). On database values, write `x != null`,
  never `x ||` or `x &&`.
- **The UI is its own design now** (no longer the script's `PAGE`; see decisions.md).
  `site/js/ui/views.js` and `charts.js` turn the aggregation's JSON into HTML strings, and
  `app.js` owns the shell, the sources and the state. Pass everything from the database
  through `esc()`, since game text is player-controlled. Write views through `setHtml`, so a
  refresh that changes nothing leaves hover and focus alone. Keep SVG ids derived from the
  data, never a counter, for the same reason. Clicks are delegated from `document`,
  because views are redrawn as the data changes.
- **Colours come from the tokens** in `dashboard.css`. Data colours are the validated
  palette: categorical slots `--k1..--k8` in a fixed order, activity states `--st-*`, and
  status colours that always come with an icon or a label. A new data colour needs the
  dataviz validator run again in both themes.
- **Accessibility is checked, not hoped for.** `npm run a11y` (CI runs it) must stay clean:
  axe-core at WCAG 2.2 AA on every view in light, dark and both high-contrast themes, and
  the contrast of the colour tokens themselves (text 4.5:1, borders and marks 3:1). New
  colours go in every theme block, high contrast included. Characters open through real
  links (`hrefFor`), so a keyboard reaches them and Ctrl+click opens a new tab; status
  icons carry `role="img"` and a label; every chart has a data table; nothing moves for
  more than five seconds.
- **The sample data is the fixture.** `site/demo/sample.db` is a byte copy of
  `test/fixtures/afternoon.db` (`test/demo.test.js` checks it). Regenerate both together.
  The demo is never remembered as a reader's source, and the page labels it on every view.
- **No inline script, no CDN, no new runtime dependency.** The CSP in `site/index.html` is
  `script-src 'self' 'wasm-unsafe-eval'`. If a change needs a looser CSP, that's a design
  discussion, not a fix.
- **Close sql.js databases.** WASM memory is not garbage collected. `Dashboard` in
  `data.js` owns the open image. Don't open others on a timer.
- **No real player data in the repo**, ever. That covers fixtures, screenshots and issue
  text. Fixtures come from `tools/gen-fixtures.rb` (seeded, synthetic). Their characters
  are April, Bebop, Leonardo, Raphael and Splinter; keep sample names obviously fictional,
  never names that could be someone's character. `npm run screenshots` retakes the README
  images (`docs/images/`) from those fixtures.
- **The script's API is specified here.** `tools/mock-server.js` must match
  [docs/api.md](docs/api.md). Change the doc, the mock and the page together, and bump
  `API_VERSION` (`data.js`, the mock, the doc) for anything incompatible.
- Keep `docs/` current: record decisions in `decisions.md` and unknowns in
  `open-questions.md`. Update `script-changes.md` whenever the API changes.

## Conventions

- Conventional commit titles, as in the other elanthia-online repos:
  `feat(site): ...`, `fix(aggregate): ...`, `docs: ...`, `test: ...`, `chore(vendor): ...`.
- Refer to issues and PRs in other repos as `elanthia-online/scripts#2556`. A bare `#2556`
  links to this repo.
- Node 22+, ES modules everywhere (`"type": "module"`).
- Line length about 120. No formatter is enforced yet; match the surrounding code.

## Related repos

- elanthia-online/scripts: `scripts/analytics.lic`, which produces the database. Its specs
  are in `spec/scripts/analytics/`.
- elanthia-online/lich-5: the runtime (`Lich.open_sequel_sqlite`, and the bundled
  `sqlite3`/`sequel` gem versions in `Gemfile.lock`).
