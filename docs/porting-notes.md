# Porting notes: Ruby dashboard → JS

The figures were ported from `GS4Analytics::Dashboard` in analytics.lic
(elanthia-online/scripts#2556, `63fcad62`). Read this before changing anything in
`site/js/aggregate/`.

## The parity harness

- `tools/gen-fixtures.rb` loads the real analytics.lic, with the clock frozen and a fixed
  `TZ`, and seeds a synthetic database through the script's own schema code (schema 6; the fixtures have been converted forward since, to schema 11 now, by `tools/fixtures-schema*.js`; see `test/fixtures/source.json`). It
  then writes what the Ruby dashboard returned to `test/fixtures/<scenario>.json`, next to
  `<scenario>.db`.
- `test/parity.test.js` opens each `.db` with sql.js and runs the JS at the same `now`.
  It compares against the JSON for the overview and every character in every range,
  including an unknown id, a case-folded id and a bogus range.
- Scenarios:
  - `afternoon`: 15:37 on the Wednesday after the US DST change, so baselines cross a
    25-hour day.
  - `after-midnight`: 00:05, when today has almost nothing and open cycles cross midnight.
- The fixture characters cover:
  - red: idle, dead, no kills while hunting
  - amber: idle, stuck bounty, item-limit rests, unusual rest reasons, high
    encumbrance, near-full mind, deaths, crash and idle recovery
  - an offline character, the same name in two games, and a character with only
    old data
- **Never** build fixtures from a real database. They're committed to a public repo.
- The parity fixtures were seeded by `gen-fixtures.rb` with some values the script has never
  written (offers `accepted`, snapshots `listing`, a `selling` rest step, `cull_assignment`)
  and none it writes now (offers `open`/`removed`/`completed`/`expired`, `hunt stopped`,
  `crashed`, coins off the `floor`, shop types from room tags, combat and pool rows). They stay
  as they are, for the golden figures. `test/fixtures/script-written.db` covers the rest: a
  four-day, two-character database written by analytics.lic itself (the 2026-11-13 audit's
  seam probe), whose pages `test/script-written.test.js` checks against plain SQL.

How they were generated (historical: the script no longer computes the figures, so this can't be run again):

```bash
TZ=America/New_York BUNDLE_GEMFILE=~/scripts/Gemfile \
  bundle exec ruby tools/gen-fixtures.rb ~/scripts/scripts/analytics.lic
npm test
```

`test/fixtures/source.json` records the SHA-256 of the `analytics.lic` the fixtures came
from. The script stopped computing figures (see [script-changes.md](script-changes.md)), so
the generator can't run any more. The fixtures are the frozen baseline, and changes to
figures are deliberate: update the golden JSON in the same commit and say why.

The harness was mutation-checked. Changing the rounding of absorbed-per-rest, the baseline
length, the mind threshold, or Ruby float formatting in alert text each fails between 5 and
9 tests. A threshold moved within the gap no fixture lands in (idle 470 vs 480) still passes
unnoticed. Add a fixture case at a boundary if one starts to matter.

## Ruby semantics to keep (`site/js/aggregate/ruby.js`)

| Ruby | Trap in JS | Helper |
|---|---|---|
| `nil.to_i == 0`, `"12".to_i == 12` | `Number(undefined)` is `NaN` | `toI`, `toF` |
| `Float#round(n)`: half away from zero, with Ruby's correction for representation error | `Math.round` rounds half toward +∞; `toFixed` returns a string and has its own errors | `rround` |
| `Integer#/` truncates (`since / 60`) | `/` gives a fraction | `idiv` |
| `"#{1.0}"` is `"1.0"` | `` `${1.0}` `` is `"1"` | `floatStr` (alert text shows the typical rest count this way) |
| `0` and `""` are truthy | both are falsy | write `!= null`, never `x ||` or `x &&`, on a value from the database |
| `Hash.new { |h, k| h[k] = … }` | `Map#get` returns `undefined` | `autoMap(make).fetch(key)` |
| `to_h` over rows: the last row wins | same with `new Map(rows)` | — |
| `casecmp?` on the character id | — | lower-case both sides |
| `sort_by` is **not stable** | `Array#sort` is | `sortBy` is stable. The parity test compares lists Ruby sorts by `sort_by` with their tied runs normalised |
| `String#<=>` compares bytes | `localeCompare` is locale-aware | `sortBy` uses `<` / `>` |

## Time

- `Date.today` and `Time.now` are two clocks in Ruby. In JS there is one `now` argument
  and everything is derived from it (`time.js`).
- Days are `{ y, m, d }` (Ruby `Date`). `midnight(day)` is `new Date(y, m-1, d)`, as
  `Time.new(y, m, d)` is in Ruby. Both follow DST the same way.
- `Report.windows` subtracts `6 * 86_400` and `29 * 86_400` seconds from midnight for
  "this week" and "this month", rather than whole calendar days. That's kept as is (it
  shifts an hour across DST). Changing it is a behaviour change, not a port fix.
- `hourLabel` builds hour buckets with `new Date(y, m-1, d, h)`, matching
  `Time.new(y, m, d, h).strftime('%Y-%m-%d %H')`. On a spring-forward day both repeat
  the 03 label, and on a fall-back day the two real 01:00 hours share one 01 bucket.
  Kept as in Ruby.

## Intentional differences on DST days

These depart from the Ruby dashboard on purpose. The parity fixtures avoid DST days, so
the goldens are unchanged; `test/details.test.js` covers each.

- **Pace "by this time".** Ruby measured now as `now - midnight` but bucketed earlier
  days by wall-clock time of day, so on the 25-hour fall-back day each baseline day
  counted an extra hour (and today looked behind), and on spring-forward one hour less.
  The page measures now on the wall clock too (`clockSeconds`). The repeated 01:00 hour on
  fall-back day stays ambiguous.
- **Hourly buckets on DST days (declined, issue #36 N3).** The hour labels follow Ruby
  (above): on a fall-back day the two real 01:00 hours share one bucket. On Lord Howe,
  where the clocks move half an hour, the repeated half hour lands in a shared bucket in
  the same way, and the audit's probe found that day's hourly figures short (23,000
  against 24,000). Keying buckets by UTC hour would fix both, at the cost of hours that
  no longer read as clock hours; one day a year doesn't justify it. The rolling "Last 24
  Hours" chart is the exception, below.
- **Date-keyed windows on the detail pages.** The week and month windows start an hour
  either side of midnight across DST (above). For `kill_stats`, keyed by date, that hour
  was a whole extra day: for six days after spring-forward "This Week" counted eight days
  of kills. The detail pages (`details.js`) and the character summary (`character.js`,
  since the rolling ranges) take the day the window means (`windowDay`), so the two agree.
  The summary's kills are a parity figure; the fixtures avoid DST days, so the goldens
  didn't move.

## Intentional differences in the figures

- **Per hour on the Summary** (2026-11-13). Ruby's dashboard divided a range's silver
  and experience by the hours since the range began, logged out or not; the overview's
  cards and the guide divide by the hours the script ran in it (hunting, resting and idle,
  the stretch still going counted up to now, to the minute). On the fixtures the two
  differed up to 8 times over. The Summary now counts as the cards do, under ten minutes
  of that shows `--`, and `test/fixtures/departures.json` lists each golden figure that
  moved, as [Ruby, now]. `test/parity.test.js` checks that file still names Ruby's value,
  and that each card's figure is its Summary's.

## Intentional differences from the script

- `Report.login_for` checked whether the collector was running in the same process and,
  if so, used the collector's own login time. The page has no such process. It reads the
  `logins` table only, where the collector refreshes `last_seen` every minute, so "live"
  means seen in the last 3 minutes, as the table branch always did.
- A database without `bounty_offers` (before schema 6) shows no offers instead of failing.
- BLOB cells are decoded as UTF-8 text (`db.js`). The script stores text as UTF-8
  (`Util.norm`), but a row from an old version could be a BLOB.

## Memory

A sql.js `Database` lives on the WASM heap. `Dashboard` in `data.js` closes the previous
image whenever it opens a new one, and builds the overview and character view of one
refresh from the same image (`memo`). A polling loop that forgets to close leaks the
whole database every 5 seconds.
