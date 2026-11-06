# frozen_string_literal: true

# Builds the parity fixtures: a synthetic analytics database per scenario,
# plus what analytics.lic's own Ruby dashboard (GS4Analytics::Dashboard)
# returns for it. The JS port in site/js/aggregate must give the same JSON.
#
#   TZ=America/New_York BUNDLE_GEMFILE=<scripts checkout>/Gemfile \
#     bundle exec ruby tools/gen-fixtures.rb <scripts checkout>/scripts/analytics.lic
#
# The data is made up (seeded PRNG), never copied from a real database.
# The clock is frozen per scenario, so the output is the same on every run
# in the same TZ. Commit the files it writes under test/fixtures/.

require 'json'
require 'tmpdir'
require 'fileutils'
require 'date'
require 'digest'

lic_path = ARGV[0] or abort 'usage: gen-fixtures.rb <path to analytics.lic>'
abort 'set TZ (e.g. TZ=America/New_York) so the fixtures are reproducible' if ENV['TZ'].to_s.empty?
OUT_DIR = File.expand_path('../test/fixtures', __dir__)

# ---- the clock ---------------------------------------------------------------
# Time.now and Date.today are separate clocks in Ruby; both are frozen.
$frozen = nil
class << Time
  alias_method :real_now, :now
  def now(...) = $frozen ? Time.at($frozen) : real_now(...)
end
class << Date
  alias_method :real_today, :today
  def today(...) = $frozen ? Time.at($frozen).to_date : real_today(...)
end

# ---- Lich stand-ins (the subset analytics.lic needs to load) ---------------
DATA_DIR = Dir.mktmpdir('analytics-fixtures')
at_exit { FileUtils.rm_rf(DATA_DIR) }
LOG = []
def respond(text = '') = LOG << text.to_s
def echo(*texts) = LOG.concat(texts.map(&:to_s))
def before_dying(&) = nil
def fput(*) = nil
def pause(*) = nil

module XMLData
  def self.game = 'GS3'
  def self.name = 'Splinter'
  def self.room_id = 0
end

class Script
  Current = Struct.new(:name, :vars)
  def self.running?(*) = false
  def self.current = Current.new('analytics', [''])
end

module UserVars
  def self.op = {}
end

class HookSet
  def add(*, **) = nil
  def remove(*) = nil
end
DownstreamHook = HookSet.new
UpstreamHook = HookSet.new

module Lich
  def self.open_sequel_sqlite(path) = Sequel.sqlite(path, timeout: 5000)

  module Messaging
    def self.msg(*) = nil
  end
end

source = File.read(lic_path).gsub("\r\n", "\n")
cut = source.index(/^# =+\n# Entry point/) or abort 'analytics.lic: entry point marker not found'
$VERBOSE = nil
eval(source[0...cut], TOPLEVEL_BINDING, lic_path)
A = GS4Analytics

# ---- seeding -----------------------------------------------------------------

# Writes rows straight into the v6 schema that Database.connect! created
class Seeder
  REASONS = ['Too many items', 'encumbered.', 'Mind full', 'Low mana', 'wounded'].freeze
  BOUNTY_TYPES = { 'cull' => 1800, 'gem' => 2400, 'heirloom' => 3000, 'skin' => 2100 }.freeze
  CREATURES = %w[kobold troll hobgoblin].freeze

  def initialize(db, now, seed)
    @db = db
    @now = now
    @rng = Random.new(seed)
    @n = 0
  end

  def id(prefix) = format('%s-%06d', prefix, @n += 1)
  def rand(range = nil) = range ? @rng.rand(range) : @rng.rand

  def session(game, char, day)
    @sessions ||= {}
    @sessions[[game, char, day]] ||= begin
      sid = id('s')
      @db[:sessions].insert(session_id: sid, game: game, character: char, start_date: day.to_s,
                            midnight_timestamp: A::Util.midnight(day), start_time: A::Util.midnight(day) + 3600)
      sid
    end
  end

  def cycle(game, char, type, start, finish, profile: nil, reason: nil, exp: nil, field: nil, enc: nil)
    @db[:cycles].insert(
      cycle_id: (cid = id('c')), session_id: session(game, char, Time.at(start).to_date), game: game, character: char,
      cycle_type: type, start_time: start, end_time: finish, duration_seconds: finish && finish - start,
      profile: profile, trigger_script: type == 'hunt' ? 'bigshot' : nil, rest_reason: reason,
      exp_total_start: exp&.first, exp_total_end: finish && exp&.last,
      exp_field_start: field&.[](0), exp_field_end: finish && field&.[](1), exp_field_max: field&.[](2),
      encumbrance_start: enc
    )
    cid
  end

  def bank(game, char, at, delta)
    @bank ||= Hash.new(1_000_000)
    @bank[[game, char]] += delta
    @db[:bank_snapshots].insert(snapshot_id: id('b'), session_id: session(game, char, Time.at(at).to_date), game: game,
                                character: char, timestamp: at, bank_name: '__total__', balance: @bank[[game, char]],
                                delta_silver: delta, snapshot_type: 'listing')
  end

  def kills(game, char, day, profile, creature, count, silver, last_at)
    @db[:kill_stats].insert_conflict(target: %i[game character date profile creature],
                                     update: { kill_count: Sequel[:kill_stats][:kill_count] + count,
                                               total_silver: Sequel[:kill_stats][:total_silver] + silver,
                                               last_kill_at: last_at })
                    .insert(game: game, character: char, date: day.to_s, profile: profile, creature: creature,
                            kill_count: count, total_silver: silver, last_kill_at: last_at)
  end

  def bounty(game, char, type, received, completed, status: 'completed', creature: 'kobold', area: 'the Crags', need: 12)
    @db[:bounties].insert(bounty_id: id('q'), session_id: session(game, char, Time.at(received).to_date), game: game,
                          character: char, received_time: received, completed_time: completed, bounty_type: type,
                          creature: creature, area: area, count_required: need,
                          count_completed: status == 'completed' ? need : rand(0..need - 1),
                          silver_reward: status == 'completed' ? rand(500..3000) : nil,
                          exp_reward: status == 'completed' ? rand(800..2000) : nil, status: status)
  end

  def offer(game, char, at, outcome, expedited: false, vouchers: nil, type: 'cull')
    @db[:bounty_offers].insert(offer_id: id('o'), session_id: session(game, char, Time.at(at).to_date), game: game,
                               character: char, offered_at: at, ended_at: at + 60, assignment: "#{type}_assignment",
                               town: "Wehnimer's Landing", bounty_type: outcome == 'removed' ? nil : type,
                               creature: 'kobold', area: 'the Crags', count: 12, expedited: expedited,
                               vouchers_left: vouchers, outcome: outcome)
  end

  def login(game, char, started, last_seen)
    @db[:logins].insert(game: game, character: char, started_at: started, first_seen: started, last_seen: last_seen)
  end

  # A day of hunt / rest loops from +from+ until +to+ (or until +budget+
  # hunting seconds), with the money, kills, steps and bounties around them
  def day_of_hunting(game, char, from, to, profile:, reasons: REASONS, enc: 20.0, mind_start: 100)
    t = from
    exp = (@exp ||= Hash.new(5_000_000))
    day = Time.at(from).to_date
    while t < to - 600
      hunt = [rand(1800..3300), to - t - 300].min
      break if hunt < 60

      x0 = exp[[game, char]]
      x1 = x0 + rand(3_000..9_000)
      exp[[game, char]] = x1
      cycle(game, char, 'hunt', t, t + hunt, profile: profile, exp: [x0, x1], field: [mind_start, rand(600..900), 800],
                                             enc: (enc + rand(-3.0..3.0)).round(1))
      creature = CREATURES[rand(CREATURES.size)]
      kills(game, char, day, profile, creature, rand(20..40), rand(2_000..6_000), t + hunt - rand(10..120))
      t += hunt
      rest = [rand(300..900), to - t].min
      break if rest < 30

      rid = cycle(game, char, 'rest', t, t + rest, profile: profile, reason: reasons[rand(reasons.size)],
                                                    exp: [x1, x1], field: [rand(600..900), mind_start, 800])
      @db[:rest_steps].insert(cycle_id: rid, game: game, character: char, step: 'travel', seconds: rand(60.0..180.0).round(1), rest_start: t)
      @db[:rest_steps].insert(cycle_id: rid, game: game, character: char, step: 'selling', seconds: rand(30.0..120.0).round(1), rest_start: t)
      @db[:rest_steps].insert(cycle_id: rid, game: game, character: char, step: 'bounty', seconds: rand(10.0..60.0).round(1), rest_start: t) if rand < 0.5
      bank(game, char, t + rest - 5, rand(8_000..30_000))
      if rand < 0.6
        type = BOUNTY_TYPES.keys[rand(BOUNTY_TYPES.size)]
        took = BOUNTY_TYPES[type] + rand(-300..300)
        bounty(game, char, type, t + rest - took, t + rest - 10) if t + rest - took > from
      end
      offer(game, char, t + 30, rand < 0.25 ? 'removed' : 'accepted', expedited: rand < 0.2, vouchers: rand(0..5)) if rand < 0.5
      t += rest
    end
    t
  end
end

def seed(db, now)
  s = Seeder.new(db, now, 20_261_104)
  today = Time.at(now).to_date
  midnight = A::Util.midnight(today)

  # GS3:Splinter: a month of steady hunting, and a rough today
  29.downto(1) do |ago|
    next if [5, 12, 13].include?(ago) # days off

    start = A::Util.midnight(today - ago) + (8 * 3600) + s.rand(0..1800)
    finish = ago == 9 ? start + 5400 : start + (6 * 3600) # day 9 is too short to count as typical
    s.day_of_hunting('GS3', 'Splinter', start, finish, profile: 'splinter_crags', reasons: ['encumbered.', 'Mind full', 'Low mana'])
  end
  if now - midnight > 3 * 3600
    t = s.day_of_hunting('GS3', 'Splinter', midnight + (8 * 3600), [now - 1500, midnight + (8 * 3600)].max,
                         profile: 'splinter_crags', reasons: ['Too many items', 'Too many items', 'encumbered.'], enc: 45.0)
    s.cycle('GS3', 'Splinter', 'rest', t, now - 1500, reason: 'unhandled exit') if t < now - 1560
  end
  # hunting now, with the last kill 16 minutes ago
  s.cycle('GS3', 'Splinter', 'hunt', now - 1500, nil, profile: 'splinter_crags', exp: [9_000_000, nil], field: [200, nil, 800], enc: 47.5)
  s.kills('GS3', 'Splinter', today, 'splinter_crags', 'troll', 3, 400, now - 1000)
  s.bounty('GS3', 'Splinter', 'cull', now - 7200, nil, status: 'active', creature: 'troll', need: 15)
  s.bounty('GS3', 'Splinter', 'gem', now - (3 * 86_400), nil, status: 'abandoned', creature: 'blue sapphire', area: 'Solhaven')
  s.bounty('GS3', 'Splinter', 'skin', now - (2 * 86_400), nil, status: 'expired')
  s.offer('GS3', 'Splinter', now - 900, 'removed', expedited: true, vouchers: 2, type: 'gem')
  s.login('GS3', 'Splinter', midnight - (20 * 86_400), midnight - (19 * 86_400))
  s.login('GS3', 'Splinter', [midnight + (7 * 3600), now - 1800].min, now - 30)

  # GS3:April: died today, recovered, now idle for 20 minutes
  10.downto(1) do |ago|
    start = A::Util.midnight(today - ago) + (13 * 3600)
    s.day_of_hunting('GS3', 'April', start, start + (3 * 3600), profile: 'april_hunt', mind_start: 750)
  end
  if now - midnight > 4 * 3600
    t = s.day_of_hunting('GS3', 'April', midnight + 3600, midnight + (3 * 3600), profile: 'april_hunt', mind_start: 760)
    s.cycle('GS3', 'April', 'dead', t, t + 600)
    s.cycle('GS3', 'April', 'rest', t + 600, t + 900, reason: 'idle recovery')
  end
  s.cycle('GS3', 'April', 'idle', now - 1200, nil)
  s.login('GS3', 'April', midnight - 3600, now - 600)

  # GS3:Leonardo: little history, dead right now
  s.day_of_hunting('GS3', 'Leonardo', A::Util.midnight(today - 2) + (10 * 3600), A::Util.midnight(today - 2) + (12 * 3600), profile: 'leonardo_ta_vaalor')
  s.cycle('GS3', 'Leonardo', 'hunt', now - 2400, now - 300, profile: 'leonardo_ta_vaalor', exp: [1, 2000])
  s.cycle('GS3', 'Leonardo', 'dead', now - 300, nil)

  # GS3:Bebop: idle for 10 minutes (amber, not red), starting hunts with a near-full mind
  if now - midnight > 6 * 3600
    s.day_of_hunting('GS3', 'Bebop', midnight + (2 * 3600), now - 900, profile: 'bebop_hunt', mind_start: 760)
  end
  s.cycle('GS3', 'Bebop', 'idle', now - 600, nil)

  # GSF:Splinter: the same name in another game, offline since yesterday evening
  5.downto(1) do |ago|
    start = A::Util.midnight(today - ago) + (18 * 3600)
    s.day_of_hunting('GSF', 'Splinter', start, start + (2 * 3600) + 600, profile: 'splinter_platinum')
  end
  s.login('GSF', 'Splinter', A::Util.midnight(today - 1) + (18 * 3600), A::Util.midnight(today - 1) + (20 * 3600))

  # GS3:Raphael: only old data, so not on the overview (but in the labels)
  s.day_of_hunting('GS3', 'Raphael', A::Util.midnight(today - 40) + (9 * 3600), A::Util.midnight(today - 40) + (11 * 3600), profile: 'raphael_x')
end

SCENARIOS = {
  # mid-afternoon on the Wednesday after the US DST change, so the 30-day
  # baseline crosses a 25-hour day
  'afternoon' => [2026, 11, 4, 15, 37, 0],
  # five minutes after midnight: today has almost nothing yet
  'after-midnight' => [2026, 11, 5, 0, 5, 0]
}.freeze

FileUtils.mkdir_p(OUT_DIR)
lic_sha = Digest::SHA256.file(lic_path).hexdigest
SCENARIOS.each do |name, parts|
  $frozen = nil
  now = Time.new(*parts).to_i
  $frozen = now
  path = File.join(OUT_DIR, "#{name}.db")
  [path, "#{path}-wal", "#{path}-shm"].each { |f| FileUtils.rm_f(f) }
  A::Database.connect!(path)
  seed(A::Database.db, now)

  # Read back through the script's own dashboard (it reads the open connection)
  dash = A::Dashboard
  dash.instance_variable_set(:@cache, {})
  overview = dash.overview
  characters = {}
  ids = overview['names'] + ['GS3:Nobody', 'gs3:splinter']
  ids.each do |id|
    characters[id] = %w[daily weekly monthly bogus].to_h { |range| [range, dash.character(id, range)] }
  end
  A::Database.close # also checkpoints the WAL into the file
  golden = { 'scenario' => name, 'now' => now, 'tz' => ENV.fetch('TZ'), 'overview' => overview, 'characters' => characters }
  File.write(File.join(OUT_DIR, "#{name}.json"), "#{JSON.pretty_generate(golden)}\n")
  [path, "#{path}-wal", "#{path}-shm"].drop(1).each { |f| FileUtils.rm_f(f) }
  puts "#{name}: #{overview['characters'].size} characters, #{File.size(path)} bytes"
end

File.write(File.join(OUT_DIR, 'source.json'), "#{JSON.pretty_generate(
  'generator' => 'tools/gen-fixtures.rb', 'analytics_lic_sha256' => lic_sha,
  'schema_version' => A::Database::SCHEMA_VERSION, 'tz' => ENV.fetch('TZ'),
  'note' => 'Golden output of GS4Analytics::Dashboard for synthetic data. Regenerate when analytics.lic changes.'
)}\n")
