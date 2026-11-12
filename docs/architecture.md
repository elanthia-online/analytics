# Architecture

```
 Lich (player's computer)                          Browser (same computer)
 ┌────────────────────────────┐                    ┌───────────────────────────────────────┐
 │ analytics.lic              │                    │ https://analytics.elanthia.online/     │
 │  collector ──writes──┐     │                    │        (static files, GitHub Pages)    │
 │                      ▼     │   GET /api/meta    │                                        │
 │   DATA_DIR/analytics.db ◄──┼── GET /api/db ─────┤  data.js   LiveSource / FolderSource / │
 │   (+ analytics.db-wal)     │   127.0.0.1:8080   │            FileSource ─► SQLite image  │
 │                      ▲     │                    │  sql.js    opens the image (WASM)      │
 │  API: serialize ─────┘     │                    │  aggregate/ figures (pure functions)   │
 └────────────────────────────┘                    │  ui/       renders the views           │
            ▲                                       └──────────────┬────────────────────────┘
            └──── or: the browser reads the folder / a file ───────┘
```

## Layers

| Layer | Files | Rule |
|---|---|---|
| Source | `site/js/data.js` (`LiveSource`, `FolderSource`, `FileSource`, `DemoSource`), `site/js/wal.js`, `site/js/shift.js` | Produces a complete SQLite image (`Uint8Array`) and the moment it describes. Knows nothing about figures |
| Engine | `site/vendor/sql.js/` | sql.js 1.15.2, vendored (see the decisions log). One `Database` per image. The previous one is `close()`d, because WASM memory is not garbage collected |
| Aggregation | `site/js/aggregate/*.js` | Pure functions of `(conn, now)`. No DOM, no `fetch`, no `Date.now()`, so Node tests run them unchanged. Output JSON has exactly the shape the Ruby dashboard returned |
| UI | `site/index.html`, `site/css/dashboard.css`, `site/js/app.js` (shell, sources, state), `site/js/ui/` (`views.js`, `sections.js`, `parts.js`, `charts.js`, `util.js`, `icons.js`, `export.js`), `site/js/display.js`, `site/js/theme-init.js` | Views are functions from the aggregation's JSON to HTML strings. They never query the database. `app.js` puts them on the page through `setHtml`, which skips a write when nothing changed |

The aggregation JSON stays exactly what the Ruby code produced, so the Ruby output stays
the test oracle. The UI was redesigned on top of that JSON (decisions.md, 2026-11-06) and
reads nothing else. Change the shape only after the parity baseline is retired (see
[porting-notes.md](porting-notes.md)), and then change `site/js/ui/` in the same commit.

## Sources

| | Live (script API) | Folder | File |
|---|---|---|---|
| Needs | analytics.lic with `--dashboard` or `serve` | Chromium (File System Access API) | Any modern browser |
| Updates | every 5 s, re-downloads only when the token changes | every 5 s, re-reads only when size/mtime changes | never (pick again) |
| WAL | the script's `serialize` already includes it | `wal.js` applies committed frames | `wal.js`, if the `-wal` file is picked too |
| "Now" | the browser clock | the browser clock | the file's last-modified time (a snapshot) |
| Permission prompt | Local Network Access, once per site (Chromium) | read access to the folder, once per session | none |

`now` matters more than it looks. Almost every figure is relative to it: "today", idle
and dead timers, pace by time of day, whether a login is live. A snapshot is shown as of
when it was written, so last week's backup reads as last week and doesn't show everyone
offline.

## Time zones

Figures use the viewer's time zone. SQLite's `'localtime'` in sql.js and the JS `Date`
calendar math both follow the browser, so SQL day buckets and JS midnights agree. The
Ruby dashboard used the Lich computer's zone. They're the same zone whenever the
browser and Lich run on the same computer, which is the only setup the live source
allows.

A file source has no such guarantee. `kill_stats.date` is the Lich process's own local
date, written as text, while every timestamp is placed in the browser's zone. A `.db`
copied from another machine, or written by a Lich running with a different `TZ` (a VPS,
WSL or a container set to UTC), files kills under that computer's dates: with zones hours apart, a whole day's kills can
land on the next or previous day here (the kills keep only a date), and every
day bucket shifts by the zone difference. Before schema 9 the database didn't record the
zone it was written in, so the page couldn't know. From schema 9 the script records
its offset and zone name in `metadata` on every start, and the page shows a warning when
this browser's offset at that moment differs. Open such a file in a browser set to the same
zone as the Lich that wrote it.

## Security model

- The site is static and has no backend. A database the player opens never leaves their
  browser. Nothing in this repo sends it anywhere.
- CSP (a `<meta>` tag, because Pages can't set headers):
  - `script-src 'self' 'wasm-unsafe-eval'`, so no inline script
  - `connect-src 'self' http://127.0.0.1:* http://localhost:*`
  - `style-src` keeps `'unsafe-inline'`, because the charts and the save-image copy rely on
    style attributes.
- The script's API is the trust boundary. Its rules (Host check against DNS rebinding,
  exact-origin CORS, read-only, localhost-only) are in [api.md](api.md).
- Everything rendered from the database goes through `esc()` (`site/js/ui/util.js`), as in
  the original page. Game text is attacker-influenced (other players' names, NPC speech), so
  keep it that way.

## No build step

`site/` is published as is. Native ES modules, no bundler, no npm packages at runtime. A
contributor can open `site/` with any static server (`npm run serve`) and see exactly what
Pages serves. The dev dependencies are sql.js (the Node tests and the vendored copy),
Playwright (the end-to-end check, the accessibility check and the screenshots) and
axe-core (the accessibility check). None of them is loaded by the page except the vendored
sql.js.
