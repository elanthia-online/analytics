# frozen_string_literal: true

# Writes test/fixtures/script-written.db with the real analytics.lic: a
# four-day, two-character (Splinter, April) sequence played through the
# script's own managers (game-text hooks, CycleManager transitions,
# BountyManager, ProgressManager, ShopWatcher, bank parsing, CombatManager),
# with the clock faked so the data spans days. On the way: a crash mid-hunt,
# a hunt stopped by hand, a death, a login past midnight, the locksmith pool
# full, task offers sent back and expedited, and Splinter hunting at the end.
# From MahtraDR's 2026-11-13 audit (its seam probe, make_real_db2.rb).
#
# Run it again after a change to what the script writes, from a checkout of
# elanthia-online/scripts (for its Gemfile: sequel, sqlite3):
#
#   TZ=America/New_York bundle exec ruby /path/to/analytics/tools/script-written-db.rb \
#     scripts/analytics.lic /tmp/out 1794448800
#   sqlite3 /tmp/out/analytics.db 'PRAGMA wal_checkpoint(TRUNCATE)'
#   cp /tmp/out/analytics.db /path/to/analytics/test/fixtures/script-written.db
#
# The last argument is the day to end on (any time that day). It prints JSON
# whose "anchor" is the moment the play ended: test/script-written.test.js's
# `now`. The stand-ins for Lich follow the script's spec driver
# (spec/scripts/analytics/analytics_driver.rb). Every name is fictional.

require 'json'
require 'tmpdir'
require 'fileutils'
require 'stringio'

lic_path, out_dir, anchor = ARGV
require 'sqlite3'
abort 'usage: script-written-db.rb <analytics.lic> <out_dir> <day_unix>' unless anchor
FileUtils.rm_rf(out_dir)
FileUtils.mkdir_p(out_dir)
DATA_DIR = out_dir

# ---- fake clock ----------------------------------------------------------------
$fake = nil
module FakeClock
  def now(*args, **kw)
    $fake ? Time.at($fake) : super
  end
end
Time.singleton_class.prepend(FakeClock)
module FakeToday
  def today(*args, **kw)
    $fake ? Time.at($fake).to_date : super
  end
end
require 'date'
Date.singleton_class.prepend(FakeToday)
def at!(t) = ($fake = t)
def adv(s) = ($fake += s)

OUT = []
def respond(text = '') = OUT << text.to_s
def echo(*texts) = texts.each { |text| OUT << "echo: #{text}" }
def before_dying(&) = nil
def fput(*) = nil
def checkdead = false
def checkright = nil
def checkleft = nil
def waitrt? = nil
def waitcastrt? = nil
def pause(*) = nil

$game = 'GS3'
$name = 'Splinter'
module XMLData
  def self.game = $game
  def self.name = $name
  def self.room_id = $room_id || 0
  def self.level = $level
  def self.lumnis = $lumnis
  def self.rpa = $rpa
  def self.fashlonae = nil
end

class Script
  Current = Struct.new(:name, :vars)
  def self.running?(name) = ($running ||= []).include?(name.to_s)
  def self.current = Current.new('analytics', [''])
  def self.start(*) = nil
  def self.run(*) = nil
  def self.pause(*) = nil
  def self.unpause(*) = nil
end

module UserVars
  def self.op = { 'profile_current' => $profile }
end

class HookSet
  def initialize = @hooks = {}
  def add(name, action, **) = @hooks[name] = action
  def remove(name) = @hooks.delete(name)
  def run(line) = @hooks.values.reduce(line) { |text, hook| text && hook.call(text) }
  def names = @hooks.keys
end
DownstreamHook = HookSet.new
UpstreamHook = HookSet.new

module Char
  def self.percent_encumbrance = $enc || 10.0
end

module Experience
  def self.txp = $exp + $axp
  def self.exp = $exp
  def self.axp = $axp
  def self.until_next = 2500
  def self.deeds = $deeds
  def self.lte = 59
  def self.deaths_sting = $sting || 'None'
  def self.fxp_current = $fxp
  def self.fxp_max = 1200
  def self.fame = $fame
  def self.updated_at = $read_at
end

$bank_lines = []
$lich_char_regex = Regexp.union(',', ';')

module Lich
  def self.open_sequel_sqlite(path) = Sequel.sqlite(path, timeout: 5000)

  module Messaging
    def self.msg(type, text) = OUT << "msg[#{type}]: #{text}"
  end

  module Util
    def self.quiet_command_xml(*)
      $bank_lines
    end
  end
end

class TaskStub
  attr_reader :type, :creature, :town, :requirements

  def initialize(type, creature, area, number, item = nil)
    @type = type
    @creature = creature
    @town = area
    @requirements = { area: area, number: number, type => item }.compact
  end

  def none? = type == :none
end

module Bounty
  def self.task = $task

  class Parser
    TOWN = /task here from the town of (?<town>[^.]+)\./
    MATCHERS = {
      creature_assignment: /It appears they have a creature problem/,
      gem_assignment: /The local gem dealer, (?<npc_name>[^,]+), has an order/
    }.freeze

    def initialize(description) = @description = description

    def parse
      MATCHERS.each do |type, regex|
        next unless (found = regex.match(@description))

        needs = found.named_captures.transform_keys(&:to_sym)
        town = @description[TOWN, :town]
        needs[:town] = town if town
        return { type: type, requirements: needs, town: town }.compact
      end
    end
  end
end

ShopRoom = Struct.new(:id, :tags, :location, :title)
ROOMS = {
  10 => ShopRoom.new(10, ['town square'], "Wehnimer's Landing", '[Town Square]'),
  20 => ShopRoom.new(20, ['gemshop'], "Wehnimer's Landing", '[Gems]'),
  25 => ShopRoom.new(25, ['pawnshop'], "Wehnimer's Landing", '[Pawn]'),
  30 => ShopRoom.new(30, ['locksmith pool', 'locksmith'], "Wehnimer's Landing", '[Pool]'),
  40 => ShopRoom.new(40, ['bank'], "Wehnimer's Landing", '[Bank]'),
  99 => ShopRoom.new(99, [], 'the Crags', '[Crags]')
}.freeze
class Room
  def self.current = ROOMS[$room_id]
end

source = File.read(lic_path).gsub("\r\n", "\n")
cut = source.index(/^# =+\n# Entry point/) or abort 'entry point marker not found'
$VERBOSE = nil
eval(source[0...cut], TOPLEVEL_BINDING, lic_path)
A = GS4Analytics

# ---- helpers ---------------------------------------------------------------------
def feed(*lines)
  lines.each { |line| DownstreamHook.run(line) }
  A::BountyManager.send(:drain_events)
  A::Database.flush
end

def settle = A::Database.flush

def prompt = '<prompt time="1">&gt;</prompt>'

def kill(creature, silver, box: false)
  lines = ["You search the #{creature}."]
  lines << "He had #{silver} silvers on him." if silver.positive?
  lines << 'He carried a corroded brass strongbox on him!' if box
  lines << prompt
  feed(*lines)
end

def told(words) = "<clearStream id='bounty'/><pushStream id='bounty'/>The taskmaster told you:  \"#{words}\""

CREATURE_OFFER = "Hmm, I've got a task here from the town of Wehnimer's Landing.  It appears they have a creature problem they'd like you to solve.  " \
                 "Go report to one of the Wehnimer's Landing gate guards to find out more.  Be sure to ASK about BOUNTIES."

def deposit(amount, total)
  "You deposit #{amount} silvers into your account.  The teller carefully records the transaction and says, " \
    "\"Thank you, #{$name}.  This brings your total to #{total} silvers.  Have a nice day!\""
end

def bank_listing(banks)
  total = banks.values.sum
  fmt = ->(n) { n.to_s.reverse.scan(/\d{1,3}/).join(',').reverse }
  ['You currently have the following amounts on deposit:', '<output class="mono"/>'] +
    banks.map { |name, bal| "      #{name}: #{fmt.call(bal)}" } +
    ["                          Total: #{fmt.call(total)}", '<output class=""/>']
end

def cm = A::CycleManager
def tr(state) = cm.send(:transition_to, state)

def start_char(game, name, profile, login_at, state)
  $game = game
  $name = name
  $profile = profile
  who = A::Who.current
  cfg = A::Settings.load(who)
  cfg = cfg.merge(rest_script: 'my_rest', death_script: 'deathwatch', track_shops: true, parse_bank: true, parse_sales: true)
  A::Settings.instance_variable_set(:@current, cfg)
  $exp, $axp, $fame, $deeds, $fxp, $level, $sting, $lumnis = state.values_at(:exp, :axp, :fame, :deeds, :fxp, :level, :sting, :lumnis)
  A::Database.async { A::Database.record_login(who, login_at, Time.now.to_i) }
  A::SilverManager.start(who)
  A::ProgressManager.start(who)
  A::ProgressManager.instance_variable_get(:@thread)&.kill
  A::ShopWatcher.start(who)
  $running = []
  A::CycleManager.start(who, cfg)
  cm.instance_variable_set(:@running, false)
  cm.instance_variable_get(:@thread)&.kill
  bm = A::BountyManager
  bm.instance_variable_set(:@who, who)
  bm.instance_variable_set(:@hunt_script, cfg[:hunt_script])
  bm.instance_variable_set(:@events, Queue.new)
  bm.send(:clear_tracking)
  bm.send(:reconcile_offers)
  bm.send(:reconcile_active_bounties)
  bm.send(:install_hook)
  A::ProgressManager.check(now: Time.now.to_i)
  settle
  [who, cfg]
end

def stop_char(state)
  tr(:idle) unless cm.current_state == :idle
  A::ProgressManager.stop(now: Time.now.to_i)
  A::ShopWatcher.stop(now: Time.now.to_i)
  DownstreamHook.remove('GS4Analytics::BountyManager')
  cm.send(:end_current_cycle)
  A::SilverManager.stop
  settle
  state.merge!(exp: $exp, axp: $axp, fame: $fame, deeds: $deeds, fxp: $fxp, level: $level, sting: $sting, lumnis: $lumnis)
end

def gain(exp, axp: 0, fame: 3)
  $exp += exp
  $axp += axp
  $fame += fame
  $fxp = [$fxp + exp / 4, 1200].min
end

def tick_shop = A::ShopWatcher.tick(Time.now.to_i)

def progress_tick = A::ProgressManager.check(now: Time.now.to_i)

# One hunt: kills every ~3 minutes for +minutes+, a cull bounty worked through it
def hunt(minutes, creature:, silver:, bounty: nil, rest_reason: 'Too many items', die: false)
  $room_id = 99
  tick_shop
  $running = ['bigshot']
  $rest_reason = nil
  tr(:hunt)
  if bounty
    $task = TaskStub.new(:cull, bounty[:creature], bounty[:area], bounty[:count])
    A::BountyManager.send(:check_task)
    settle
  end
  left = bounty && bounty[:count]
  (minutes / 3).times do |i|
    adv(180)
    kill(creature, silver + (i * 7 % 50), box: (i % 5).zero?)
    if $midhunt && i == 5
      # Mid-hunt: what a live reader sees while the collector runs (open cycle, open bounty)
      A::Database.flush
      snap = File.join(DATA_DIR, 'snap_mid')
      FileUtils.mkdir_p(snap)
      %w[analytics.db analytics.db-wal].each { |f| FileUtils.cp(File.join(DATA_DIR, f), snap) if File.exist?(File.join(DATA_DIR, f)) }
      puts JSON.generate('midhunt_now' => $fake)
      $stdout.flush
      exit!(0)
    end
    gain(450, axp: 60)
    $enc = 10 + (i * 3)
    progress_tick
    if left&.positive?
      left -= 1
      $task = left.zero? ? TaskStub.new(:guard, '', '', nil) : TaskStub.new(:cull, bounty[:creature], bounty[:area], left)
      A::BountyManager.send(:check_task)
      settle
    end
  end
  adv(60)
  if die
    $running = ['deathwatch']
    $sting = 'Heavy'
    tr(:dead)
    settle
    adv(600)
    $running = []
    tr(:idle)
    adv(1800)
    $sting = 'None'
    progress_tick
  else
    $rest_reason = rest_reason
    $running = ['my_rest']
    tr(:rest)
  end
  settle
end

# The rest after a hunt: gem shop sale, pawnshop sale, locksmith pool, bank deposit, bounty turn-in
def rest_trip(sale:, pawn:, pool_fee:, deposit_amt:, bank_total_after:, bounty_reward: nil)
  cm.instance_variable_get(:@rest_steps)['travel'] += 95.0
  $room_id = 10
  adv(40)
  tick_shop
  $room_id = 20
  adv(30)
  tick_shop
  adv(20)
  feed('The <pushBold/><a exist="1" noun="Kahlyr">jeweler Kahlyr</a><popBold/> takes the <a exist="2" noun="opal">black opal</a>, ' \
       "gives it a careful examination and hands you #{sale} silver for it.")
  adv(40)
  $room_id = 25
  tick_shop
  adv(15)
  feed("The pawnbroker takes your <a exist=\"4\" noun=\"crystal\">ayanad crystal</a>, glances at it briefly, then hands you #{pawn} silver coins.")
  adv(25)
  $room_id = 30
  tick_shop
  adv(20)
  feed("Jyhm takes your strongbox and says, \"Your tip of #{pool_fee / 2} silvers has been recorded, and the #{pool_fee - pool_fee / 2} silvers fee has been collected.\"")
  cm.instance_variable_get(:@rest_steps)['selling'] += 150.0
  adv(60)
  $room_id = 40
  tick_shop
  adv(15)
  feed(deposit(deposit_amt, bank_total_after))
  adv(30)
  $room_id = 10
  tick_shop
  if bounty_reward
    $task = TaskStub.new(:taskmaster, '', '', nil)
    A::BountyManager.send(:check_task)
    adv(60)
    feed("[You have earned #{bounty_reward[:bp]} bounty points, #{bounty_reward[:exp]} experience points, and #{bounty_reward[:silver]} silver.]")
    gain(bounty_reward[:exp], fame: 50)
    # The next offer, kept
    adv(20)
    feed(told(CREATURE_OFFER))
    $task = nil
  end
  cm.instance_variable_get(:@rest_steps)['waiting'] += 60.0
  adv(300)
  progress_tick
  $running = []
  tr(:idle)
  settle
end


# ---- extensions for round 11 (schema 11 tables) --------------------------------
ROOMS2 = ROOMS.merge(
  50 => ShopRoom.new(50, ['furrier'], "Wehnimer's Landing", '[Furs]'),
  60 => ShopRoom.new(60, ['consignment'], "Wehnimer's Landing", '[Consign]')
).freeze
class Room
  def self.current = ROOMS2[$room_id]
  def self.[](id) = ROOMS2[id]
end

# EXPERIENCE as the game sends it (layout from the spec's 'progress' scenario; numbers ours)
def experience_lines
  fmt = ->(n) { n.to_s.reverse.scan(/\d{1,3}/).join(',').reverse }
  ['<output class="mono"/>', '', "          Level: #{$level}                         Fame: #{fmt.call($fame)}",
   "     Experience: #{fmt.call($exp)}             Field Exp: #{$fxp}/1200", "  Ascension Exp: #{fmt.call($axp)}          Recent Deaths: 1",
   "      Total Exp: #{fmt.call($exp + $axp)}         Death's Sting: #{$sting}", "  Long-Term Exp: 61                  Deeds: #{$deeds}",
   '     Exp to next TP: 1,500']
end

def resource_lines(name, weekly, total)
  fmt = ->(n) { n.to_s.reverse.scan(/\d{1,3}/).join(',').reverse }
  ['<output class="mono"/>', 'Health: 280/<pushBold/>300<popBold/>     Mana: 40/80     Stamina: 120/120     Spirit: 10/10',
   "#{name}: #{fmt.call(weekly)}/50,000 (Weekly)           #{fmt.call(total)}/200,000 (Total)", "Suffused #{name}: 4,321",
   'Voln Favor: 98,765', '<prompt time="1">&gt;</prompt>']
end

def type_experience(with_resource: nil)
  $read_at = Time.now
  feed(*experience_lines)
  feed('<output class="mono"/>       PTPs/MTPs: 36/0                        ATPs: 6')
  adv(1)
  feed(*resource_lines(*with_resource)) if with_resource
  progress_tick
  settle
end

def pool_list(boxes, waiting)
  lines = ["The worker says, \"#{$name}, here's the list of boxes we have for you.\"", '', '<output class="mono"/>']
  boxes.times do |i|
    lines << " #{i + 1}.  A scratched white oak box about #{i + 1} minutes ago for 750 silvers."
    lines << (i < waiting ? '     It is waiting to be worked on.' : '     It has been opened.')
    lines << ''
  end
  lines << '<prompt time="1">&gt;</prompt>'
  feed(*lines)
end

def pool_full
  feed('You want a locksmith to open a riveted white oak trunk for a tip of 750 silvers.  There is also a fee of 1,803 silvers ' \
       'due up front, totaling 2,553 silvers.  You will need that amount on you or in a local bank.',
       'The worker says, "Sorry, we\'re already holding as many boxes for you as we can."')
end

# A combat recorder file in the layout Lich's Combat::Recorder writes (columns from the spec's 'combat' scenario)
RECORDERS = {}
def recorder_for(who)
  RECORDERS[who.to_s] ||= begin
    path = File.join(DATA_DIR, who.game, who.name, 'analytics-combat.db')
    FileUtils.mkdir_p(File.dirname(path))
    rec = SQLite3::Database.new(path)
    rec.execute_batch(<<~SQL)
      CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, character TEXT, source TEXT, started_at REAL NOT NULL, ended_at REAL);
      CREATE TABLE IF NOT EXISTS creatures (id INTEGER PRIMARY KEY, session_id INTEGER, exist_id INTEGER, noun TEXT, name TEXT, first_seen REAL,
                              last_seen REAL, killed_at REAL, killed_by_attack_id INTEGER, kill_credit TEXT);
      CREATE TABLE IF NOT EXISTS attacks (id INTEGER PRIMARY KEY, session_id INTEGER, creature_id INTEGER, ours INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS flares (id INTEGER PRIMARY KEY, attack_id INTEGER, ours INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS resolutions (id INTEGER PRIMARY KEY, attack_id INTEGER);
      CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY, attack_id INTEGER, flare_id INTEGER, session_id INTEGER, creature_id INTEGER, damage INTEGER);
      CREATE TABLE IF NOT EXISTS statuses (id INTEGER PRIMARY KEY, session_id INTEGER, creature_id INTEGER);
    SQL
    rec.execute('INSERT OR IGNORE INTO sessions (id, character, source, started_at) VALUES (1, ?, ?, ?)', [who.name, 'live', Time.now.to_f])
    { path: path, db: rec, exist: (rec.get_first_value('SELECT MAX(exist_id) FROM creatures') || 1000) }
  end
end

# One creature fought: we hit it +hits+ times for +each+; ours=false -> someone else killed it (assist)
def fight(who, name, hits:, each:, ours: true)
  r = recorder_for(who)
  db = r[:db]
  r[:exist] += 1
  t = Time.now.to_f
  db.execute('INSERT INTO creatures (session_id, exist_id, noun, name, first_seen, last_seen) VALUES (1, ?, ?, ?, ?, ?)',
             [r[:exist], name.split.last, name, t - 20, t])
  cid = db.last_insert_row_id
  last = nil
  hits.times do
    db.execute('INSERT INTO attacks (session_id, creature_id, ours) VALUES (1, ?, 1)', [cid])
    last = db.last_insert_row_id
    db.execute('INSERT INTO hits (attack_id, session_id, creature_id, damage) VALUES (?, 1, ?, ?)', [last, cid, each])
  end
  unless ours
    db.execute('INSERT INTO attacks (session_id, creature_id, ours) VALUES (1, ?, 0)', [cid])
    last = db.last_insert_row_id
    db.execute('INSERT INTO hits (attack_id, session_id, creature_id, damage) VALUES (?, 1, ?, 99)', [last, cid])
  end
  db.execute('UPDATE creatures SET killed_at = ?, killed_by_attack_id = ?, kill_credit = ? WHERE id = ?', [t, last, 'crit', cid])
end

def rollup(who)
  r = recorder_for(who)
  m = A::CombatManager
  m.instance_variable_set(:@mark, m.instance_variable_get(:@mark) || 0.0)
  m.rollup(r[:path], who)
  settle
end

def hunt2(minutes, who:, creature:, rec_name:, silver:, bounty: nil, rest_reason: 'Too many items', die: false, stop_by_hand: false, crash: false)
  $room_id = 99
  tick_shop
  $running = ['bigshot']
  $rest_reason = nil
  tr(:hunt)
  if bounty
    $task = TaskStub.new(:cull, bounty[:creature], bounty[:area], bounty[:count])
    A::BountyManager.send(:check_task)
    settle
  end
  left = bounty && bounty[:count]
  (minutes / 3).times do |i|
    adv(180)
    fight(who, rec_name, hits: 3 + (i % 3), each: 40 + i, ours: i % 4 != 3)
    kill(creature, silver + (i * 7 % 50), box: (i % 5).zero?) if i % 4 != 3
    feed('You gather the remaining 37 coins.') if i == 2
    gain(450, axp: 60)
    $enc = 10 + (i * 3)
    progress_tick
    if left&.positive?
      left -= 1
      $task = left.zero? ? TaskStub.new(:guard, '', '', nil) : TaskStub.new(:cull, bounty[:creature], bounty[:area], left)
      A::BountyManager.send(:check_task)
      settle
    end
    yield(i) if block_given?
  end
  rollup(who)
  adv(60)
  return if crash
  if die
    $running = ['deathwatch']
    $sting = 'Heavy'
    tr(:dead)
    settle
    adv(120)
    type_experience # read while dead: the sting
    adv(480)
    $running = []
    tr(:idle)
    adv(1800)
    $sting = 'None'
    feed('You feel the sting of a recent death slowly fade away.')
    progress_tick
  elsif stop_by_hand
    cm.instance_variable_set(:@last_bigshot_status, :hunting)
    $running = []
    tr(:idle)
  else
    $rest_reason = rest_reason
    $running = ['my_rest']
    tr(:rest)
  end
  settle
end

def rest_trip2(sale:, pawn:, pool_fee:, deposit_amt:, bank_total_after:, bounty_reward: nil, pool: nil, offers: false, experience: nil)
  cm.instance_variable_get(:@rest_steps)['travel'] += 95.0
  $room_id = 10; adv(40); tick_shop
  $room_id = 20; adv(30); tick_shop; adv(20)
  feed('The <pushBold/><a exist="1" noun="Kahlyr">jeweler Kahlyr</a><popBold/> takes the <a exist="2" noun="opal">black opal</a>, ' \
       "gives it a careful examination and hands you #{sale} silver for it.")
  adv(40)
  $room_id = 50; tick_shop; adv(15)
  feed('The furrier takes your <a exist="9" noun="pelt">kobold pelt</a>, glances at it briefly, then hands you 210 silver coins.')
  adv(25)
  $room_id = 25; tick_shop; adv(15)
  feed("The pawnbroker takes your <a exist=\"4\" noun=\"crystal\">ayanad crystal</a>, glances at it briefly, then hands you #{pawn} silver coins.")
  adv(25)
  $room_id = 30; tick_shop; adv(20)
  feed("Jyhm takes your strongbox and says, \"Your tip of #{pool_fee / 2} silvers has been recorded, and the #{pool_fee - pool_fee / 2} silvers fee has been collected.\"")
  if pool
    adv(5)
    pool_list(*pool)
    adv(5)
    pool_full if pool[0] >= 6
  end
  cm.instance_variable_get(:@rest_steps)['selling'] += 150.0
  adv(60)
  $room_id = 40; tick_shop; adv(15)
  feed(deposit(deposit_amt, bank_total_after))
  adv(30)
  $room_id = 10; tick_shop
  if experience
    type_experience(with_resource: experience)
  end
  if bounty_reward
    $task = TaskStub.new(:taskmaster, '', '', nil)
    A::BountyManager.send(:check_task)
    adv(60)
    feed("[You have earned #{bounty_reward[:bp]} bounty points, #{bounty_reward[:exp]} experience points, and #{bounty_reward[:silver]} silver.]")
    gain(bounty_reward[:exp], fame: 50)
    adv(20)
    if offers
      # a bandit task sent back, then an expedited reassignment, then the kept creature task (lines from the spec's 'offers' scenario)
      malcrith = '<pushBold/><a exist="23813302" noun="Malcrith">Malcrith</a><popBold/>'
      removed = "#{malcrith} says, \"Very well <a exist=\"-1\" noun=\"#{$name}\">#{$name}</a>, I have removed you from your current assignment.\""
      bandit = "Hmm, I've got a task here from the town of Wehnimer's Landing.  It appears they have a bandit problem they'd like you to solve.  " \
               "Go report to one of the Wehnimer's Landing gate guards to find out more.  Be sure to ASK about BOUNTIES."
      feed(told(bandit)); adv(10); feed(removed); adv(10)
      feed(told(CREATURE_OFFER)); adv(10)
      feed(removed, "#{malcrith} says, \"Very well, #{$name}.  I'll expedite your task reassignment.\"",
           '[You have 8132 expedited task reassignment vouchers remaining.]')
      adv(10)
    end
    feed(told(CREATURE_OFFER))
    $task = nil
  end
  cm.instance_variable_get(:@rest_steps)['waiting'] += 60.0
  adv(300)
  progress_tick
  $running = []
  tr(:idle)
  settle
end

# A crash: the managers die where they stand (no end_current_cycle, no ProgressManager.stop)
def crash_char
  DownstreamHook.remove('GS4Analytics::BountyManager')
  %w[GS4Analytics::SilverManager GS4Analytics::ProgressManager].each { |h| DownstreamHook.remove(h) }
  settle
end

# ---- the play --------------------------------------------------------------------
A::Database.connect!
anchor = anchor.to_i
mid = Time.at(anchor).to_date.then { |d| Time.local(d.year, d.month, d.day).to_i }

chars = {
  ['GS3', 'Splinter'] => { exp: 7_600_000, axp: 2_140_000, fame: 1_000_000, deeds: 12, fxp: 0, level: 100, sting: 'None', lumnis: nil,
                           bank: { "Wehnimer's Landing": 5_000_000, 'Icemule Trace': 1_500_000 }, profile: 'splinter_crags', creature: 'kobold',
                           rec: 'greater kobold', resource: 'Essence' },
  ['GS3', 'April'] => { exp: 2_310_000, axp: 0, fame: 300_000, deeds: 5, fxp: 0, level: 47, sting: 'None', lumnis: 7,
                        bank: { "Wehnimer's Landing": 400_000 }, profile: 'april_trolls', creature: 'troll',
                        rec: 'cave troll', resource: 'Devotion' }
}
SUMMARY = { crash_cycle: nil, stopped: nil, midnight: [] }

days = [3, 2, 1, 0]
days.each do |ago|
  chars.each_with_index do |((game, name), st), ci|
    day0 = mid - (ago * 86_400)
    start = day0 + (8 * 3600) + (ci * 4 * 3600)
    at!(start)
    $room_id = 10
    who, = start_char(game, name, st[:profile], start, st)
    adv(5)
    if ago == days.first
      $bank_lines = bank_listing(st[:bank])
      A::SilverManager.take_baseline_now
      settle
      adv(10)
      type_experience(with_resource: [st[:resource], 1000, 60_000])
    end
    total = A::Database.latest_balances(who)['__total__']
    adv(60)
    feed(told(CREATURE_OFFER)) if ago == days.first
    adv(30)
    bounty = { creature: st[:creature], area: "Wehnimer's Landing", count: 8 + ci }
    # April on day 1-ago: crashes mid-hunt; the next login closes the open cycle
    if ago == 1 && ci == 1
      hunt2(45, who: who, creature: st[:creature], rec_name: st[:rec], silver: 150, bounty: bounty, crash: true)
      SUMMARY[:crash_cycle] = cm.current_cycle_id
      crash_char
      st.merge!(exp: $exp, axp: $axp, fame: $fame, deeds: $deeds, fxp: $fxp, level: $level, sting: $sting, lumnis: $lumnis)
      # the crashed login was last seen 2 minutes before the crash (the collector touches it every minute)
      A::Database.async { A::Database.touch_login(who, A::Database.one('SELECT MAX(started_at) AS s FROM logins WHERE game = ? AND character = ?', *who)['s'], Time.now.to_i - 120) }
      settle
      # Lich comes back 20 minutes later: a new login
      adv(1200)
      who, = start_char(game, name, st[:profile], Time.now.to_i, st)
      adv(30)
      total = A::Database.latest_balances(who)['__total__']
    end
    dep = 4000 + (ago * 1000) + (ci * 333)
    unless ago == 1 && ci == 1
      hunt2(45, who: who, creature: st[:creature], rec_name: st[:rec], silver: 100 + (ci * 50), bounty: bounty)
      total += dep
      rest_trip2(sale: 1_250 + ago, pawn: 77, pool_fee: 300, deposit_amt: dep, bank_total_after: total,
                 bounty_reward: { bp: 900 + ci, exp: 1000, silver: 8_890 + (ago * 10) },
                 pool: [3 + ago + ci * 3, 2], offers: ago == 2, experience: [st[:resource], 5000 * (4 - ago), 60_000 + 3000 * (4 - ago)])
      adv(30)
    end
    die = ago == 2 && ci.zero?
    stop = ago.zero? && ci.zero?
    bounty = { creature: st[:creature], area: "Wehnimer's Landing", count: 5 }
    hunt2(30, who: who, creature: st[:creature], rec_name: st[:rec], silver: 90, bounty: bounty, rest_reason: 'wounded', die: die, stop_by_hand: stop)
    SUMMARY[:stopped] = A::Database.one("SELECT cycle_id, rest_reason FROM cycles WHERE game = ? AND character = ? AND cycle_type = 'hunt' ORDER BY start_time DESC LIMIT 1", *who) if stop
    unless die || stop
      dep2 = 2500 + (ci * 111)
      total += dep2
      rest_trip2(sale: 900, pawn: 50, pool_fee: 200, deposit_amt: dep2, bank_total_after: total,
                 bounty_reward: { bp: 700, exp: 800, silver: 5_000 })
    end
    adv(60)
    st[:bank][:"Wehnimer's Landing"] = total - st[:bank].except(:"Wehnimer's Landing").values.sum
    feed(*bank_listing(st[:bank]))
    adv(120)
    # April, two days ago: plays on past midnight (a login over midnight)
    if ago == 2 && ci == 1
      at!(day0 + 86_400 - 1800) # 23:30
      $room_id = 99
      $running = ['bigshot']
      tr(:hunt)
      6.times do |i|
        adv(600)
        fight(who, st[:rec], hits: 4, each: 50)
        kill(st[:creature], 120)
        gain(400)
        if Time.now.to_i >= day0 + 86_400 && SUMMARY[:midnight].empty?
          cm.send(:roll_over_midnight)
          settle
          SUMMARY[:midnight] << Time.now.to_i
        end
      end
      rollup(who)
      $rest_reason = 'Too many items'
      $running = ['my_rest']
      tr(:rest)
      adv(300)
      $running = []
      tr(:idle)
      adv(60)
      settle
    end
    stop_char(st)
    RECORDERS.delete(who.to_s)&.then { |r| r[:db].close }
    A::CombatManager.instance_variable_set(:@mark, nil)
  end
end
# Splinter logs in once more and hunts now (an open cycle at the anchor), so the site shows a live character
at!($fake + 600)
st = chars[['GS3', 'Splinter']]
$room_id = 10
who, = start_char('GS3', 'Splinter', st[:profile], Time.now.to_i, st)
$room_id = 99
$running = ['bigshot']
tr(:hunt)
4.times { adv(180); kill('kobold', 111); gain(300); progress_tick }
A::Database.async { A::Database.touch_login(who, A::Database.one('SELECT MAX(started_at) AS s FROM logins WHERE character = ?', 'Splinter')['s'], Time.now.to_i) }
A::Database.flush
final = $fake + 30
A::Database.close

puts JSON.generate('anchor' => final, 'mid' => mid, 'out' => out_dir, 'summary' => SUMMARY, 'log' => OUT.grep(/ERROR/).first(20))
