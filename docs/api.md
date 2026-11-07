# Dashboard API (analytics.lic → this site)

Status: **implemented** in analytics.lic at elanthia-online/scripts@0b41f063 (PR
elanthia-online/scripts#2556). Checked against the real script: this site's files served at
`https://analytics.elanthia.online` (by Playwright, so the real origin, CSP and CORS apply)
read a copy of a real database live, picked up new writes by themselves, and every
response carried the site's `Access-Control-Allow-Origin`. `tools/mock-server.js` still
implements it for the tests: when this page and the mock disagree, fix the page. When the
mock and this document disagree, fix the mock, and the script. What the script needs to change
is in [script-changes.md](script-changes.md).

API version: **1**. The site refuses any other version, with a message saying which side
to update.

## Design

The script no longer serves a page or computes any figures. It hands the browser a
consistent copy of its SQLite database, and the browser does everything else
(`site/js/aggregate/`). The API therefore has two read-only routes:

| Route | Answer |
|---|---|
| `GET /api/meta` | A small JSON object: who is answering, and a change token |
| `GET /api/db?token=T` | The database, as one SQLite file image |

The page polls `/api/meta` every 5 seconds and fetches `/api/db` only when the token
has changed. `/` and `/index.html` redirect to the hosted page (see below), and anything
else answers 404.

Errors, all with the CORS headers below so the page can read them:

| Status | When | Body |
|---|---|---|
| `400` | A cut-off request line, a second `Host` or `Origin` header, more than 100 headers | `Bad request` |
| `403` | A `Host` other than this computer, or an `Origin` not allowed | `Forbidden` |
| `404` | Any other path | `Not found` |
| `405` | Any method but `GET` (and the preflight `OPTIONS`) | `Method not allowed` |
| `500` | An error in the script while answering; it is logged in the game window | `Internal error` |
| `503` | The script can't serve the database: none yet, or one made by another build | The reason, which the page shows. It includes the database's path on this computer |

## `GET /api/meta`

```json
{
  "app": "analytics",
  "api": 1,
  "script_version": "1.1.0",
  "schema_version": "9",
  "token": "k3j2a1.42",
  "now": 1793997420,
  "db_bytes": 413696
}
```

| Field | Meaning |
|---|---|
| `app` | Always `"analytics"`. The page checks it, so a different server on the port is reported as such |
| `api` | This document's version. Bump it on any incompatible change |
| `script_version` | The script's version, shown in diagnostics |
| `schema_version` | `metadata.schema_version`. The page warns about versions it hasn't been checked against |
| `token` | Opaque. It changes whenever the database has changed (see "Change token"). Equal tokens mean equal data |
| `now` | The script's clock (unix seconds). Not used for figures, which use the browser's clock, but kept for diagnosing clock skew |
| `db_bytes` | Size of the image `/api/db` would send. Informational |

## `GET /api/db?token=T`

- `200`, `Content-Type: application/vnd.sqlite3`, the body a complete SQLite database file:
  every committed transaction, nothing uncommitted, with no `-wal` needed beside it.
- `X-Analytics-Token: <token of this image>`, listed in `Access-Control-Expose-Headers`.
- The `token` query parameter is only there to keep caches from reusing an old body. The
  server may send a newer image than the token named; the page reads the token from the
  next `/api/meta`.
- The server caches the image per token, so several open tabs don't each make a copy.

### Why a query parameter and not `If-None-Match`

`If-None-Match` is not a CORS-safelisted request header. Sending it would turn every poll
into a preflighted request (an extra `OPTIONS` round trip). Every request the page makes
is a "simple" GET with no custom headers, so the browser never sends a preflight. The
cheap `/api/meta` poll gives the same saving as a 304.

## Change token

The token must change whenever any connection, in this Lich process or another one,
commits to the database. The specified implementation:

- Open a **dedicated read-only connection** for the API. It must not be the collector's
  writer connection: `PRAGMA data_version` doesn't move for a connection's own commits.
- `token = "#{boot_id}.#{data_version}"`, where `boot_id` is random per server start
  (so a restarted server never repeats a token with different data) and `data_version`
  is `PRAGMA data_version` read on that connection at request time.

Verified with sqlite3 gem 2.10.2 (the version in lich-5's `Gemfile.lock`): `data_version`
stays the same while another connection has a transaction open and changes when it
commits.

## Snapshot

The image is `SQLite3::Database#serialize('main')` on the dedicated connection, which
copies the database as seen by one read transaction: the main file plus every committed
WAL frame. With sqlite3 gem 2.10.2 this was verified to return 200 rows that existed only
in the `-wal` file (the main file had none yet), and to leave out a transaction still
open. sql.js opens the result directly, even though its header still says WAL mode.

`VACUUM INTO` a temporary file (as `;analytics maintenance backup` already does) works too
and gives a smaller file. But it writes to disk and takes longer, so it's the fallback if
`serialize` is unavailable.

Cost: one copy of the database in memory per change (the database was 0.3–0.4 MB in
testing). See [open-questions.md](open-questions.md) for what happens if a database grows
past what is comfortable to re-send.

## CORS and who may read it

A page served by the hosted site (`https://analytics.elanthia.online`) reads an API on
`http://127.0.0.1:<port>`. That's cross-origin, so the response has to allow it.

- If the request's `Origin` is allowed, answer with `Access-Control-Allow-Origin: <that
  origin>` and `Vary: Origin`. Otherwise send no CORS headers, and the browser hides the
  response from the page.
- Allowed origins:
  - `https://analytics.elanthia.online`
  - `http://localhost:<any port>`, `http://127.0.0.1:<any port>`, `http://[::1]:<any port>`
    (development, and a copy of the site served on this computer)
  - anything the player adds in `analytics.yaml` (`dashboard.allowed_origins`), for a fork
    hosted elsewhere.
- A request with an `Origin` header that is not allowed gets `403`. Browsers send
  `Origin` on cross-origin fetches, so a page on any other site can't read the
  database or even get a 200 from it.
- The site has its own domain on purpose. `https://elanthia-online.github.io` is shared by
  every Pages site in the organisation; allowing it would let any of them read the API.
  It now only redirects to the custom domain, so it is **not** allowed. A fork hosted
  elsewhere is added through `allowed_origins`.

### The Host check stays

The existing DNS-rebinding defence stays as it is: in localhost mode, any `Host` other
than `localhost`, `127.0.0.1` or `[::1]` (with any port) gets `403`. Without it, a hostile
page could point its own hostname at 127.0.0.1. Its requests would then be same-origin to
the browser, and CORS would not apply at all.

### Preflight and Private / Local Network Access

- The page never triggers a CORS preflight (see above).
- Chromium's **Local Network Access** (formerly Private Network Access) asks the player,
  once per site, to allow a public site to reach devices on their computer or network.
  The page can't avoid this prompt and doesn't need any header for it.
- Older Chromium builds that ran the Private Network Access preflight may still send an
  `OPTIONS` request with `Access-Control-Request-Private-Network: true`. Answer it with
  `204` plus:
  - `Access-Control-Allow-Origin` (allowed origins only)
  - `Access-Control-Allow-Methods: GET`
  - `Access-Control-Allow-Private-Network: true`
  - `Access-Control-Max-Age: 600`

  It carries no data.
- `http://127.0.0.1` and `http://localhost` count as "potentially trustworthy", so an https
  page can fetch them without a mixed-content block in Chromium and Firefox. **Safari has
  not been checked.** See [open-questions.md](open-questions.md).

## `GET /` and `GET /index.html`

`302` to `https://analytics.elanthia.online/?live=<port>`, so the URL the script
prints when it starts the server (and old bookmarks of `http://localhost:8080`) open the
hosted page already connected.

## Other headers on every response

- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Cross-Origin-Resource-Policy: cross-origin`, so the responses stay readable if the page
  ever turns on cross-origin isolation
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, since the API
  serves no page any more
- `Connection: close`, as today

The existing request limits stay as they are: request line, header line and header
count, the 5-second read timeout, a 400 for a cut-off line, and a 400 for a second
`Host` header.

## LAN mode (dropped)

`lan` is refused with a line pointing to the guide, and the server binds this computer
only (decisions.md). The reasons it didn't carry over:

- The hosted page is https. A fetch from it to `http://192.168.x.y:8080` is mixed content
  and is blocked, because only loopback addresses are exempt.
- In LAN mode `/api/db` would hand the whole database to anyone on the network. Today
  LAN mode exposes only the computed figures.

To view another computer's data, copy its `analytics.db` (or a backup) and open it as a
file.
