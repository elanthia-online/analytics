# Changes analytics.lic needs

Status: **done** in elanthia-online/scripts@0b41f063, the commit after `63fcad62`, on PR
elanthia-online/scripts#2556. The parity fixtures were generated from `63fcad62`, the
last commit with the Ruby figures (`test/fixtures/source.json` has its hash), so they are
the frozen baseline from here on.

Where the change differs from the plan below:
- The module kept the name `Dashboard`.
- `/index.html` redirects as well as `/`.
- A second `Origin` header gets a 400, like a second `Host`.
- The `VACUUM INTO` fallback is real code, used when the sqlite3 gem has no
  `Database#serialize`, and a spec covers it.
- All API reads share one `Monitor`, so the API connection's pool only ever makes one
  connection (`data_version` is only comparable on one connection).
- `VERSION` is a constant, and a spec keeps it equal to the header's `version:` line.
- The header and the settings file's comment now point to the guide (`site/guide/`), and
  the TODO list moved to [roadmap.md](roadmap.md).

The plan as written follows.

Written against `scripts/analytics.lic` at
`63fcad62` on the `feat/analytics-script` branch (elanthia-online/scripts#2556, still a
draft). Line numbers below are at that commit.

**Goal:** the script stops rendering the dashboard and stops computing its figures. It
keeps the small local HTTP server and uses it only to hand the browser the database
([api.md](api.md)). Everything the page shows is computed in this repo
(`site/js/aggregate/`), checked against the Ruby it replaces by
`test/parity.test.js`.

Net effect on the script: about 1,450 lines out (the `Dashboard` module's figures and the
800-line `PAGE` heredoc), about 150 in.

## 1. Replace the `Dashboard` module (lines 3449–4897)

### Remove

| What | Lines | Why it can go |
|---|---|---|
| `RANGES`, `CACHE_SECS`, `IDLE_WARN`, `STALE_OPEN`, `NO_KILL_WARN`, `DAY_HUNT`, `HOUR_HUNT`, `BASE_DAYS`, `MIN_SAMPLES`, `CRASH_REASONS`, `WHO` | 3457–3467, 3478 | Only the dashboard's figures used them; they now live in `site/js/aggregate/overview.js` |
| `memo`, `overview`, `character`, `@cache`, `@lock` | 3476–3530 | Caching of figures that are no longer computed here |
| `local`, `day`, `tod`, `build_overview`, `overview_data`, `build_status`, `pace_for`, `reason_rows_for`, `bounty_for`, `lights` | 3536–3816 | Ported to `site/js/aggregate/overview.js` |
| `range_figures`, `hunting_grounds`, `recent_bounties`, `login_figures`, `offers_for`, `trends_for` | 3818–4014 | Ported to `site/js/aggregate/character.js` |
| `PAGE` | 4098–4896 | Moved to `site/` (`index.html`, `css/dashboard.css`, `js/app.js`) |

Before deleting, check that nothing outside the module uses these. At `63fcad62`, the
only uses outside `Dashboard` are `Dashboard.start/stop/running?/port` in the CLI (lines
4940, 4948, 5042–5052). `IDLE_WARN` has a twin in the cycle manager that stays.
`Report.labels`, `Report.short_profile`, `Report.login_for`, `Report.figures` and
`Util.bounty_target` / `offer_label` stay too, because the text reports use them.

### Keep, with changes

`start`, `stop`, `running?`, `port`, `serve`, `read_head`, `allowed_host?`,
`decode_params`, `reply` (lines 3482–4096) stay, with the request limits and the
Host-header check unchanged. They change as follows.

**Rename** the module to `DashboardApi` (or keep `Dashboard`, it doesn't matter) and add:

```ruby
API_VERSION = 1
SITE_URL    = 'https://analytics.elanthia.online/' # overridable, see section 3
# Pages that may read the API: this project's site, and any page served from
# this computer (development, or a copy of the site). Origins are scheme+host+port.
ALLOWED_ORIGINS = [%r{\Ahttps://analytics\.elanthia\.online\z}, %r{\Ahttp://(localhost|127\.0\.0\.1|\[::1\]):\d+\z}].freeze
```

**`read_head`** must also return the `Origin` header. It's parsed exactly like `Host`,
including refusing a second one.

**`serve`** becomes:

```ruby
def serve(client)
  request, host, origin = Timeout.timeout(5) { read_head(client) }
  return reply(client, 400, 'text/plain', 'Bad request') unless request

  verb, target = request.split
  return reply(client, 403, 'text/plain', 'Forbidden') unless allowed_host?(host)
  return reply(client, 403, 'text/plain', 'Forbidden', origin) if origin && !allowed_origin?(origin)
  return preflight(client, origin) if verb == 'OPTIONS'
  return reply(client, 405, 'text/plain', 'Method not allowed', origin) unless verb == 'GET'

  case target.to_s.split('?', 2).first
  when '/'         then redirect(client, "#{site_url}?live=#{@port}")
  when '/api/meta' then reply(client, 200, 'application/json', JSON.generate(meta), origin)
  when '/api/db'
    token, image = snapshot
    reply(client, 200, 'application/vnd.sqlite3', image, origin, 'X-Analytics-Token' => token)
  else reply(client, 404, 'text/plain', 'Not found', origin)
  end
rescue Timeout::Error ... # unchanged
```

`OPTIONS` is now answered, with no data, for older Chromium's Private Network Access
preflight. Every other verb but GET still gets `405`.

**`reply`** gains `origin` and extra headers. Changes:

- `Access-Control-Allow-Origin: <origin>`, `Vary: Origin` and
  `Access-Control-Expose-Headers: X-Analytics-Token`, only when `allowed_origin?(origin)`.
- Binary bodies: `body.dup.force_encoding(Encoding::UTF_8)` must not run on the database
  image. Use `body.b` and `bytesize` for `/api/db`.
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. No page is
  served any more, so the old `script-src` / `style-src` / `img-src` allowances go.
- Add `Cross-Origin-Resource-Policy: cross-origin`.
- Status texts: add `204 No Content` and `302 Found`.

**New helpers:**

```ruby
def allowed_origin?(origin)
  (ALLOWED_ORIGINS + Settings.current.dig(:dashboard, :allowed_origins).to_a.map { |o| /\A#{Regexp.escape(o)}\z/ })
    .any? { |re| re.match?(origin) }
end

def preflight(client, origin)
  # Access-Control-Allow-Methods: GET, Access-Control-Allow-Private-Network: true,
  # Access-Control-Max-Age: 600 (plus the CORS headers above for an allowed origin)
end

def meta
  token, image = snapshot
  { 'app' => 'analytics', 'api' => API_VERSION, 'script_version' => VERSION,
    'schema_version' => Database::SCHEMA_VERSION, 'token' => token,
    'now' => Time.now.to_i, 'db_bytes' => image.bytesize }
end

# [token, image]: the database as one committed snapshot, rebuilt only when
# another connection has committed since the last one
def snapshot
  @lock.synchronize do
    conn = (@api_conn ||= Database.open_reader(Database.file)) # its own connection, see below
    version = conn.fetch('PRAGMA data_version').first.values.first
    if @snapshot.nil? || @snapshot[0] != version
      image = conn.synchronize { |raw| raw.serialize('main') }
      @snapshot = [version, "#{@boot_id}.#{version}", image]
    end
    @snapshot.drop(1)
  end
end
```

There is no `VERSION` constant at `63fcad62`; the version is only in the header's
`version: 1.0.0` line (line 15). Add `VERSION = '1.0.0'` to `GS4Analytics` and keep it in
step with the header, or read the header line at load time. `securerandom` is already
required (line 90).

Notes on `snapshot`:

- **It needs its own connection.** `Database.reader` (line 594) returns the collector's
  writer connection `@db` while the collector runs. `PRAGMA data_version` doesn't change
  for a connection's own commits, so with the writer connection the token would never
  move. `Database.open_reader(path)` (line 951) already opens a separate connection
  through `Lich.open_sequel_sqlite`, but it's under `private` (line 944). Move it above
  `private`, or add a public `Database.api_reader` that calls it. Keep the connection in
  the module, and disconnect it in `stop`.
- `@boot_id = SecureRandom.hex(4)` in `start`, so a restarted server never repeats an old
  token with different data.
- `@lock` stays a `Monitor` (several tabs, several request threads).
- **Verified** with sqlite3 gem 2.10.2 (what lich-5's `Gemfile.lock` pins):
  - `serialize('main')` on a read-only connection returns every committed row, including
    ones only in the `-wal` file.
  - It excludes a transaction still open.
  - `data_version` changes only when another connection commits.
  - sql.js opens the image.
- If `serialize` turns out to be missing on some Lich install (an older sqlite3 gem),
  fall back to `VACUUM INTO` a temp file (as `Database.backup` already does, line 922),
  read it, and delete it.

## 2. CLI (lines 4904–5093)

- `start_dashboard` (line 5041) prints the URL to open, not `http://localhost:PORT`:
  `Dashboard at https://analytics.elanthia.online/?live=8080 (reads this
  computer's analytics.lic on port 8080)`. The `302` on `/` means the old
  `http://localhost:8080` keeps working.
- `status` (line 5050) prints the same URL.
- **`lan`:** the hosted https page can't reach a LAN address (mixed content), and
  `/api/db` would give the whole database to the network. Make `lan` / `--lan` / `dashboard:
  lan: true` refuse with one line: `[analytics] The dashboard now runs in your browser and
  reads this computer only; lan is no longer supported. See <site>/#lan.` Then start in
  localhost mode. Alternatives are in [open-questions.md](open-questions.md).
- `USAGE` (line 4911): drop `[lan]` and `--lan`.

## 3. Settings

`DEFAULTS[:dashboard]` (line 323) becomes:

```ruby
dashboard: { port: 8080, site_url: 'https://analytics.elanthia.online/', allowed_origins: [] }
```

- `site_url`: where `/` redirects and what the CLI prints. A player using a fork of this
  site (or a copy served from their own computer) changes it here.
- `allowed_origins`: extra page origins allowed to read the API, e.g.
  `https://someone.github.io` for a fork. Exact origins only, no wildcards.
- `lan`: removed. An existing `lan: true` in a player's YAML is ignored with the message
  above.

Update the settings help text in the `Settings::HEADER` comment (lines 426–434) to match.

## 4. The header block and help (lines 1–95)

- Line 8: "a live web dashboard" → "a live web dashboard (hosted at
  https://analytics.elanthia.online/, reading this computer's data)".
- Lines 19–20: the `--dashboard` / `serve` lines lose `[lan]`.
- The ideas list (lines 65–78) mentions dashboard features. Those are now issues on
  this repo; leave a pointer instead.
- Keep the header under 20,000 bytes and ASCII-only, as now.

## 5. Specs (`spec/scripts/analytics/`)

**Delete** the figure-level dashboard examples in `analytics_spec.rb` (`describe
'Dashboard'`, line 653 on):

- characters by game and name
- every section of the overview
- 24/7/30 trend labels
- detail with rest steps
- pins
- theme toggle
- save-image button
- the JSON API

Also delete the matching keys in the driver's `dashboard` scenario (lines 417–484) and the
`'dashboard'` slices in the `offers` and `session_report` scenarios (lines 1261, 1408). This
repo's `test/parity.test.js` covers what they covered.

**Keep**, retargeted at the new routes:

- the Host-header table (`local_hosts`, `lan_hosts` → only the localhost table)
- every `split_headers` case (cut-off lines, two Host headers, long cookies, too many
  headers, long request line)
- `http_missing` 404 and `http_post` 405

**Add:**

| Example | Checks |
|---|---|
| meta | `GET /api/meta` → `app`, `api == 1`, `schema_version`, a token |
| db image | `GET /api/db` → `application/vnd.sqlite3`; the body opens with `SQLite3::Database.new` from a temp file and has the seeded rows |
| WAL rows included | rows written by the collector and not yet checkpointed are in the image |
| token moves | a write from another connection changes the token; no write keeps it, and the image is not rebuilt (same object) |
| CORS allowed | `Origin: https://analytics.elanthia.online` → that `Access-Control-Allow-Origin`, `Vary: Origin` |
| CORS refused | `Origin: https://evil.example` → 403, no CORS headers. Also `https://elanthia-online.github.io`: the old address only redirects now, and other org sites live there |
| no Origin | a request with no Origin (curl, the script's own checks) → 200 without CORS headers |
| preflight | `OPTIONS` → 204 with `Access-Control-Allow-Private-Network: true` and no body |
| redirect | `GET /` → 302 to `site_url?live=PORT` |
| lan refused | `serve 9000 lan` logs the "no longer supported" line and binds 127.0.0.1 |
| headers | every response has `nosniff`, `no-store`, and the new CSP |

`tools/mock-server.js` in this repo answers all of these the same way. It's a quick
reference for expected values.

## 6. PR #2556 description and version

- The summary's "a live read-only web dashboard" and the security bullet about the
  dashboard (no password, Host check, CSP) need rewording for the API.
- `Settings` table: `dashboard` row → `port`, `site_url`, `allowed_origins`.
- The script is pre-release (`v1.0.0` in every commit title so far), so this can ship as
  part of 1.0.0. If 1.0.0 has merged by then, it's a minor bump: the dashboard moves, and
  `lan` goes away.

## 7. Order of work

1. This repo first: publish the site and confirm it works against `tools/mock-server.js`
   (done locally; see the README).
2. Script: sections 1–3 and 5 in one commit
   (`feat(analytics): v1.0.0 serve the database to the hosted dashboard`), then section 4
   and 6 with it or right after.
3. Re-run `tools/gen-fixtures.rb` against the commit **before** step 2, which is the last
   one with the Ruby figures. Keep those fixtures as the parity baseline. After step 2
   the generator can't run any more, because there's no Ruby dashboard left to compare
   against. From then on the fixtures are frozen and this repo's JS is the reference.
4. Manual check in a real Lich session:
   - `;analytics --dashboard`, open the printed URL in Chrome and allow the
     local-network prompt.
   - Watch it update while hunting.
   - Then try Firefox, and Safari if anyone has a Mac (see
     [open-questions.md](open-questions.md)).

## Schema 8 (2026-11-06)

For the character detail pages; analytics.lic as of elanthia-online/scripts@7bfc369a.

- `progress`: a new table, written by `ProgressManager`. Level, regular and ascension
  experience, `until_next`, fame, deeds, long-term exp, Death's Sting, unspent PTP, MTP and
  ATP (from the `PTPs/MTPs` line of `EXPERIENCE` output that passes anyway), and Lumnis, RPA
  and Fash'lo'nae from the `mindState` bar. A row when a milestone changes, experience at
  most every 5 minutes, at least hourly. No game command is sent.
- `cycles`: `exp_regular_start`/`_end` and `exp_asc_start`/`_end` beside the total, since
  post-cap training points count regular experience only.
- `vendor_visits`: `spent`, `room_id` and `town`, and the rows are now recorded by the script
  itself (`ShopWatcher`, setting `track_shops`, on by default). Entering a room the map tags
  as a shop, bank or locksmith opens a visit; leaving it closes it, with the silver read
  meanwhile. It works with any selling script, eloot included; `record_vendor_visit` is used
  only with `track_shops` off.
- `SCHEMA_VERSION` 8; `KNOWN_SCHEMAS` is `['8']`. A schema 7 file is refused (no migrations
  before release).


## Schema 9 (2026-11-06)

From MahtraDR's reviews of elanthia-online/scripts#2556 and of this repo (analytics.lic as
of elanthia-online/scripts@1a03e72e, da37cb4b for the sting row and 8798c180 for the zone). Still before the first
release, so the schema changed rather than gaining a migration.

- `progress` is a `WITHOUT ROWID` table: its primary key `(game, character, timestamp)` is
  the row, with no separate rowid and index to store.
- `progress` readings are honest about their age. Fame, deeds, long-term exp and Death's
  Sting come only from `EXPERIENCE` output, so a row carries them only when a reading
  arrived since the row before (`Experience.updated_at`), and NULL otherwise. The reading
  present when the script starts (infomon keeps it across logins) doesn't count as new.
  Training points are written once, on the row after the `PTPs/MTPs` line, then cleared.
  When the game says "You feel the sting of a recent death slowly fade away." a row with
  `deaths_sting = 'None'` (and no other reading) is written at that moment. Experience moving
  alone waits for the hourly heartbeat.
- Fame on a cycle (`fame_start`/`fame_end`) is taken only from a reading less than two
  minutes old at that moment.
- A hunt that goes idle without a rest is recorded as `rest_reason = 'hunt stopped'` (was
  `'unhandled exit'`, which the page counted as a crash). Stopping the hunting script by hand
  is the usual cause.
- A sale made during a shop visit records the shop's room tag (`gemshop`, `furrier`,
  `pawnshop`, ...) as `vendor_type` and the speaker as `vendor_name`, instead of the first
  word of the sale line. Visits record the town as the location of the nearest room the map
  tags `town`.
- New spending: warehouse storage fees paid from hand (`vendor_type = 'warehouse'`). A
  locksmith quote counts only when it's told to you, and coins a fossil charm returns only
  when they're returned to you: another player's in the same room were counted before.
- `metadata` records the zone Lich runs in: `utc_offset` (seconds) and `zone`, with
  `updated_at` the moment they were read, written on every start in the same transaction as
  the schema version (elanthia-online/scripts@8798c180). `kill_stats.date` and the reports'
  days are that computer's dates; the page warns when its own offset at that moment differs.
- `SCHEMA_VERSION` 9; `KNOWN_SCHEMAS` is `['9']`. A schema 8 file is refused. The fixtures
  were converted by `tools/fixtures-schema9.js`.

The page: the Progress page shows the latest of each reading wherever it is, and when it was
read; Death's Sting stretches run from the death (the end of the `dead` cycle) to the next
None; a hunt ended "hunt stopped" is shown as is, not as a crash.

### Setting: `dashboard.autostart` (2026-11-07)

elanthia-online/scripts@64be5f3e. Off by default. When on, starting `;analytics` also
serves the API on `dashboard.port`, as `--dashboard` does, unless it already runs in this
session or another session answers `/api/meta` on that port as analytics.lic. No API change.

## Schema 10 (2026-11-07)

elanthia-online/scripts@d18ceec8, from an audit of a night of real schema 9 play and two
player requests. Still before the first release.

- **EXPERIENCE is read from its own text.** Freshness came from infomon's timestamp for
  total experience, which infomon moves only when the value changes, so after a death (same
  total, only the sting moved) the reading was lost: four real deaths left no sting row.
  The progress hook now reads the block itself (Fame line to "Exp until lvl" / "Exp to next
  TP", anchored like Lich's parser) and writes each reading as its own row at the moment it
  was shown. Cycle fame uses the same reading time.
- **RESOURCE** is read the same way into new `progress` columns: `resource_name`,
  `resource_weekly`, `resource_total`, `suffused`, `voln_favor`, `covert_arts_charges`,
  `shadow_essence`. The guide asks players to have their rest script type `EXPERIENCE` and
  `RESOURCE`.
- **Floor coins**: "You gather the remaining N coins." is `source_category = 'floor'`.
- **Shop stops** where silver was only paid out, all for something other than the room's
  tag, are named by what it was paid for (a priestess in a room tagged locksmith pool).
- **Reasons**: a rest straight after a death is `after death`; a hunt cut at midnight is
  `midnight`.
- **Settings** (no schema effect): a global `<Lich data>/analytics.yaml` with the defaults
  and a per-character file of blank overrides, each setting commented on its own line.
- `SCHEMA_VERSION` 10; `KNOWN_SCHEMAS` is `['10']`.

The page: Progress shows the latest resources; Death's Sting stretches start at the dead
cycle's start (a potion can cure the sting before the dead cycle ends); Income has
"Coins off the floor" and Consignment as their own sources.

## Schema 11 (2026-11-10)

elanthia-online/scripts@29181ae2, from a player request: each character's damage and kills
per creature, for characters hunting together, and the locksmith pool's depth. Still before the
first release.

- **combat_stats**: per cycle and creature kind, `fought`, `kills`, `assists`, `damage`,
  `hits`, `kill_damage`, with the cycle's `start_time`. Summed from Lich's
  `Combat::Recorder`, which the script runs with the combat tracker (setting `combat`, on
  by default) and which keeps its own `analytics-combat.db` per character.
- **pool_depth**: each time the locksmith pool lists the character's boxes (`ASK <worker> FOR
  RETURN`, as eloot does), `boxes` and `waiting`, with the worker and town; a box turned away
  for a full pool is a row with `full = 1` and no count. Only the character's own list (by
  name) and refusal (straight after its own offer).
- `SCHEMA_VERSION` 11; `KNOWN_SCHEMAS` is `['11']`. The fixtures are converted by
  `tools/fixtures-schema11.js` (both tables added empty).

The page: a Combat card on Hunting, a Locksmith pool card on Income, and both sections on Compare.

