/* ================================================================
   RETRO HOOPS — game.js
   Modular vanilla JS. No external dependencies.
   Sections:
     1. CONFIG / CONSTANTS
     2. DATA MODELS
     3. STATE MANAGEMENT
     4. ECONOMY / SIMULATION MATH
     5. SEASON / SCHEDULE
     6. TEXT SIM ENGINE
     7. UI RENDERING ENGINE
     8. EVENT BINDING
     9. CANVAS GAMEPLAY ENGINE
     10. INPUT LISTENERS
     11. BOOTSTRAP
   ================================================================ */

/* ================================================================
   1. CONFIG / CONSTANTS
   ================================================================ */
const Config = {
  BASE_SALARY_CAP: 150_000_000,      // Base Salary Cap, exact per spec
  CAP_INCREASE_COST_CC: 100,         // Increase Salary Cap costs exactly 100 CC
  CAP_INCREASE_AMOUNT: 25_000_000,   // ...and expands total cap by $25M
  MAX_UPGRADE_LEVEL: 10,             // Stadium / Facilities / Rehab cap at level 10
  CHAMPIONSHIP_BONUS_CC: 10,         // Finals win CC bonus
  DRAFT_PICK_CC_VALUE: { 1: 3, 2: 2, 3: 1 }, // Selling R1/R2/R3 picks for CC
  SEASON_REGULAR_WEEKS: 14,          // 14 regular-season games
  ROSTER_SIZE: 8,                    // 5 starters + 3 bench, exact per spec
  STARTER_COUNT: 5,
  PEAK_CONTRACT_AGE: 27,             // Age at which contract value peaks
  MAX_CONTRACT: 35_000_000,          // Ceiling for a prime 5-star veteran
  MIN_CONTRACT: 500_000,
  DIFFICULTY_MODS: {                 // AI strength multiplier per difficulty
    easy: 0.85,
    medium: 1.0,
    hard: 1.15,
    extreme: 1.3,
  },
  SAVE_KEY: 'retroHoopsSave_v1',
};

/* ================================================================
   2. DATA MODELS
   ================================================================ */
const Data = (() => {

  const FIRST_NAMES = [
    'Marcus','Tyrese','Jaylen','Devin','Trey','Cole','Andre','Malik','Jordan','DeShawn',
    'Reggie','Caleb','Isaiah','Quentin','Darius','Elijah','Xavier','Brock','Cameron','Tyler',
    'Anthony','Bryce','Curtis','Donte','Emmanuel',
  ];
  const LAST_NAMES = [
    'Carter','Boswell','Mitchell','Harrington','Vance','Rivers','Okafor','Sanders','Pruitt','Holloway',
    'Webb','Donovan','Brennan','Castillo','Faulkner','Greer','Hawkins','Lassiter','Monroe','Pierce',
    'Quincy','Ramsey','Stockton','Whitfield','Yancy',
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  function generateName() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }

  // Fictional opponent franchises (avoids real-league branding; abbreviations
  // mirror the style requested in the brief: e.g. BOS / MIA / NYK).
  const OPPONENTS = [
    { abbr: 'BOS', name: 'Boston Bolts', conf: 'A' },
    { abbr: 'MIA', name: 'Miami Mist', conf: 'A' },
    { abbr: 'NYK', name: 'New York Knights', conf: 'A' },
    { abbr: 'LAX', name: 'LA Lasers', conf: 'A' },
    { abbr: 'CHI', name: 'Chicago Cinders', conf: 'A' },
    { abbr: 'DAL', name: 'Dallas Dust Devils', conf: 'N' },
    { abbr: 'PHX', name: 'Phoenix Phantoms', conf: 'N' },
    { abbr: 'DEN', name: 'Denver Drifters', conf: 'N' },
    { abbr: 'TOR', name: 'Toronto Talons', conf: 'N' },
    { abbr: 'SEA', name: 'Seattle Surge', conf: 'N' },
  ];

  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

  // Positional attribute bias keeps guards quick/shooty and bigs strong/defensive.
  const POSITION_BIAS = {
    PG: { speed: 10, shooting: 4, three: 6, defense: -4, rebounding: -14 },
    SG: { speed: 6, shooting: 8, three: 8, defense: -2, rebounding: -10 },
    SF: { speed: 2, shooting: 2, three: 2, defense: 2, rebounding: 0 },
    PF: { speed: -4, shooting: -2, three: -4, defense: 6, rebounding: 8 },
    C: { speed: -10, shooting: -6, three: -10, defense: 8, rebounding: 14 },
  };

  // Build a single player. `overallTarget` (0-99) seeds attribute variance.
  function generatePlayer(position, overallTarget, ageOverride) {
    const bias = POSITION_BIAS[position] || {};
    const attrs = {};
    ['speed', 'shooting', 'three', 'defense', 'rebounding'].forEach((key) => {
      const variance = randInt(-12, 12);
      attrs[key] = clamp(Math.round(overallTarget + (bias[key] || 0) + variance), 25, 99);
    });
    const player = {
      id: uid(),
      name: generateName(),
      pos: position,
      age: ageOverride != null ? ageOverride : randInt(20, 34),
      attrs,
      morale: randInt(55, 85),
      level: 1,
      xp: 0,
      stats: { games: 0, points: 0, rebounds: 0, assists: 0 },
      retired: false,
    };
    player.contract = Economy.computeContractCost(player);
    return player;
  }

  // Full 8-man roster: 5 starters (one per position) + 3 bench.
  function generateStartingRoster() {
    const roster = [];
    POSITIONS.forEach((pos) => roster.push(generatePlayer(pos, randInt(58, 78))));
    for (let i = 0; i < 3; i++) {
      roster.push(generatePlayer(pick(POSITIONS), randInt(42, 64)));
    }
    return roster;
  }

  function generateFreeAgents(count = 5) {
    const agents = [];
    for (let i = 0; i < count; i++) {
      agents.push(generatePlayer(pick(POSITIONS), randInt(45, 80)));
    }
    return agents;
  }

  // Hireable staff pool. Boosts are flat additions to team off/def ratings.
  // Regenerated on demand (Staff Hires "REFRESH") rather than a fixed roster.
  function generateStaffPool(count = 4) {
    const roles = ['Head', 'Offense', 'Defense'];
    const pool = [];
    for (let i = 0; i < count; i++) {
      const role = pick(roles);
      const talentTier = randInt(3, 8);
      const cost = talentTier * 10 + randInt(0, 10);
      let boost, talent;
      if (role === 'Head') {
        const b = Math.round(talentTier * 0.6);
        boost = { off: b, def: b };
        talent = `Program Builder (+${b} OFF / +${b} DEF)`;
      } else if (role === 'Offense') {
        boost = { off: talentTier };
        talent = `Offensive Coordinator (+${talentTier} OFF)`;
      } else {
        boost = { def: talentTier };
        talent = `Defensive Coordinator (+${talentTier} DEF)`;
      }
      pool.push({ id: uid(), name: generateName(), role, talent, boost, cost });
    }
    return pool;
  }

  const ACHIEVEMENTS = [
    { id: 'first_win', name: 'First Win', desc: 'Win your first game.' },
    { id: 'win_streak_5', name: 'On Fire', desc: 'Win 5 games in a row.' },
    { id: 'fan_fav', name: 'Fan Favorite', desc: 'Reach 90% Fan Support.' },
    { id: 'five_star_player', name: 'Superstar', desc: 'Develop a 5-star player.' },
    { id: 'champion', name: 'Champion', desc: 'Win a Championship.' },
    { id: 'dynasty', name: 'Dynasty', desc: 'Win 3 Championships.' },
    { id: 'full_stadium', name: 'Sold Out', desc: 'Max out Stadium level.' },
    { id: 'cap_max', name: 'Big Spender', desc: 'Increase the salary cap 3 times.' },
  ];

  return {
    OPPONENTS, POSITIONS, ACHIEVEMENTS,
    pick, randInt, clamp, uid, generateName,
    generatePlayer, generateStartingRoster, generateFreeAgents, generateStaffPool,
  };
})();

/* ================================================================
   3. ECONOMY / SIMULATION MATH
   All of Retro Bowl's bracket-style economy rules, ported 1:1.
   ================================================================ */
const Economy = (() => {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function overallOf(player) {
    const a = player.attrs;
    return (a.speed + a.shooting + a.three + a.defense + a.rebounding) / 5;
  }

  // 0-99 overall -> 1-5 stars. 1-20=1★ ... 81-99=5★.
  function starRating(player) {
    return clamp(Math.ceil(overallOf(player) / 20), 1, 5);
  }

  function starString(n) {
    n = clamp(Math.round(n), 1, 5);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  /* ---- Coaching Credit (CC) bracket engine ----
     Tied directly to current Fan Support %:
       0-32%   -> 1 CC
       33-65%  -> 2 CC
       66-100% -> 3 CC
     Plus a flat Championship Bonus, applied by the caller. */
  function calcPostGameCC(fanSupportPct, isChampionshipWin) {
    let cc;
    if (fanSupportPct <= 32) cc = 1;
    else if (fanSupportPct <= 65) cc = 2;
    else cc = 3;
    if (isChampionshipWin) cc += Config.CHAMPIONSHIP_BONUS_CC;
    return cc;
  }

  // Selling a draft pick for instant CC (R1=3, R2=2, R3=1).
  function draftPickSellValue(round) {
    return Config.DRAFT_PICK_CC_VALUE[round] || 0;
  }

  /* ---- Stadium buffer & fan popularity decay ----
     Stadium level (1-10) cushions losses and amplifies win gains.
     Diminishing returns are applied to gains as fanSupport climbs
     toward 100% (the closer to full, the smaller each % gain). */
  function applyPostGameFanChange(team, won) {
    const t = (team.stadiumLevel - 1) / (Config.MAX_UPGRADE_LEVEL - 1); // 0..1
    let pct;
    if (won) {
      const basePct = 5 + 3 * t; // +5% (lvl1) .. +8% (lvl10)
      pct = basePct * (1 - team.fanSupport / 100); // diminishing returns near 100%
    } else {
      pct = -(10 - 8 * t); // -10% (lvl1) .. -2% (lvl10), flat (no cushion math needed near 0)
    }
    team.fanSupport = clamp(team.fanSupport + pct, 0, 100);
  }

  function applyMoraleChange(team, won) {
    const delta = won ? Data.randInt(2, 6) : -Data.randInt(2, 8);
    team.morale = clamp(team.morale + delta, 0, 100);
    team.roster.forEach((p) => {
      p.morale = clamp(p.morale + Math.round(delta * 0.6), 0, 100);
    });
  }

  // CC cost to upgrade a facility from its current level to the next.
  // Scales linearly with level so later levels cost progressively more.
  function getUpgradeCost(level, ccPerLevel) {
    return level * ccPerLevel;
  }

  function upgradeStadium(team) {
    if (team.stadiumLevel >= Config.MAX_UPGRADE_LEVEL) return false;
    const cost = getUpgradeCost(team.stadiumLevel, 15);
    if (team.cc < cost) return false;
    team.cc -= cost;
    team.stadiumLevel += 1;
    // Flat fan boost on upgrade, with diminishing returns as popularity climbs.
    const flatBoost = 3 * (1 - team.fanSupport / 100);
    team.fanSupport = clamp(team.fanSupport + flatBoost, 0, 100);
    return true;
  }

  function upgradeFacilities(team) {
    if (team.facilitiesLevel >= Config.MAX_UPGRADE_LEVEL) return false;
    const cost = getUpgradeCost(team.facilitiesLevel, 12);
    if (team.cc < cost) return false;
    team.cc -= cost;
    team.facilitiesLevel += 1;
    return true;
  }

  function upgradeRehab(team) {
    if (team.rehabLevel >= Config.MAX_UPGRADE_LEVEL) return false;
    const cost = getUpgradeCost(team.rehabLevel, 10);
    if (team.cc < cost) return false;
    team.cc -= cost;
    team.rehabLevel += 1;
    return true;
  }

  /* ---- Salary cap & contract cost scaling matrix ----
     Contract cost is a function of (overall rating) x (age curve),
     peaking near PEAK_CONTRACT_AGE for a 5-star veteran at MAX_CONTRACT. */
  function computeContractCost(player) {
    const overall = overallOf(player); // 0-99
    const base = (overall / 99) * Config.MAX_CONTRACT;
    const ageDelta = Math.abs(player.age - Config.PEAK_CONTRACT_AGE);
    const ageMultiplier = Math.max(0.15, 1 - ageDelta * 0.035); // decline away from prime
    let cost = base * ageMultiplier;
    cost = clamp(cost, Config.MIN_CONTRACT, Config.MAX_CONTRACT);
    return Math.round(cost / 100000) * 100000; // round to nearest $100K
  }

  function getTotalCap(team) {
    return Config.BASE_SALARY_CAP + team.capIncreases * Config.CAP_INCREASE_AMOUNT;
  }

  function getCapUsed(team) {
    return team.roster.reduce((sum, p) => sum + p.contract, 0);
  }

  function getCapRoom(team) {
    return getTotalCap(team) - getCapUsed(team);
  }

  function increaseSalaryCap(team) {
    if (team.cc < Config.CAP_INCREASE_COST_CC) return false;
    team.cc -= Config.CAP_INCREASE_COST_CC;
    team.capIncreases += 1;
    return true;
  }

  /* ---- End-of-season wear-and-tear decay ----
     Stadium, Facilities and Rehab all lose a level every offseason,
     forcing continual CC investment to maintain progression. */
  function endOfSeasonDecay(team) {
    team.stadiumLevel = Math.max(1, team.stadiumLevel - 1);
    team.facilitiesLevel = Math.max(1, team.facilitiesLevel - 1);
    team.rehabLevel = Math.max(1, team.rehabLevel - 1);
  }

  /* ---- Player XP / level-up ----
     Facilities level speeds up XP gain. Once a player is already
     maxed at 5 stars, further level-ups grant the TEAM +1 CC instead
     of an attribute point (per spec). */
  function grantXP(player, amount, team) {
    const facilitiesBonus = 1 + (team.facilitiesLevel - 1) * 0.05;
    player.xp += amount * facilitiesBonus;
    const xpNeeded = player.level * 50;
    if (player.xp < xpNeeded) return null;

    player.xp -= xpNeeded;
    player.level += 1;

    if (starRating(player) >= 5) {
      team.cc += 1;
      return { type: 'cc', player, amount: 1 };
    }
    const keys = ['speed', 'shooting', 'three', 'defense', 'rebounding'];
    const key = Data.pick(keys);
    const gain = Data.randInt(1, 3);
    player.attrs[key] = clamp(player.attrs[key] + gain, 1, 99);
    return { type: 'attr', player, key, amount: gain };
  }

  // Team-wide offense/defense ratings (0-99), built from starters' attrs,
  // weighted by what matters on each side of the ball, plus staff boosts.
  function teamOffenseRating(team) {
    const starters = team.roster.filter((p) => team.starterIds.includes(p.id));
    if (!starters.length) return 40;
    const avg = starters.reduce((s, p) => s + (p.attrs.shooting * 0.4 + p.attrs.three * 0.35 + p.attrs.speed * 0.25), 0) / starters.length;
    const staffBoost = team.staff && team.staff.offense ? team.staff.offense.boost.off || 0 : 0;
    const headBoost = team.staff && team.staff.head ? team.staff.head.boost.off || 0 : 0;
    return clamp(avg + staffBoost + headBoost, 1, 99);
  }

  function teamDefenseRating(team) {
    const starters = team.roster.filter((p) => team.starterIds.includes(p.id));
    if (!starters.length) return 40;
    const avg = starters.reduce((s, p) => s + (p.attrs.defense * 0.6 + p.attrs.rebounding * 0.4), 0) / starters.length;
    const staffBoost = team.staff && team.staff.defense ? team.staff.defense.boost.def || 0 : 0;
    const headBoost = team.staff && team.staff.head ? team.staff.head.boost.def || 0 : 0;
    return clamp(avg + staffBoost + headBoost, 1, 99);
  }

  return {
    overallOf, starRating, starString,
    calcPostGameCC, draftPickSellValue,
    applyPostGameFanChange, applyMoraleChange,
    upgradeStadium, upgradeFacilities, upgradeRehab, getUpgradeCost,
    computeContractCost, getTotalCap, getCapUsed, getCapRoom, increaseSalaryCap,
    endOfSeasonDecay, grantXP,
    teamOffenseRating, teamDefenseRating,
  };
})();

/* ================================================================
   4. STATE MANAGEMENT
   Single global mutable state object + localStorage persistence +
   the view-visibility router used by the UI engine.
   ================================================================ */
const State = (() => {
  let state = null;
  let currentView = 'view-main-menu';

  function newGame() {
    const roster = Data.generateStartingRoster();
    const team = {
      name: 'Retro Hoops',
      abbr: 'RH',
      roster,
      starterIds: roster.slice(0, Config.STARTER_COUNT).map((p) => p.id),
      morale: 70,
      fanSupport: 50,
      wins: 0,
      losses: 0,
      winStreak: 0,
      cc: 20,
      capIncreases: 0,
      stadiumLevel: 1,
      facilitiesLevel: 1,
      rehabLevel: 1,
      staff: { head: null, offense: null, defense: null },
      draftPicks: { 1: 1, 2: 1, 3: 1 },
      uniform: 'home',
    };

    const opponents = Data.OPPONENTS.map((o) => ({ ...o, wins: 0, losses: 0 }));

    state = {
      team,
      opponents,
      market: { freeAgents: Data.generateFreeAgents(5), staffPool: Data.generateStaffPool(4) },
      season: {
        year: 1,
        weekIndex: 0,        // index into schedule[]
        schedule: Season.generateSchedule(),
      },
      settings: { quarterLength: 3, difficulty: 'medium', camZoom: false, soundFx: true, autosave: true },
      hof: {
        finalsWon: 0,
        achievementsUnlocked: [],
        records: { topScorer: null, topRebounder: null, topAssister: null },
        legends: [],
      },
      uiSelectedPlayerId: null,
    };
    save();
    return state;
  }

  // Backfills fields added after a save was made, so old localStorage saves
  // don't crash on missing nested objects.
  function normalizeState(s) {
    if (!s) return s;
    if (!s.team.staff) s.team.staff = { head: null, offense: null, defense: null };
    if (s.team.staff.head === undefined) s.team.staff.head = null;
    if (!s.market.staffPool) s.market.staffPool = Data.generateStaffPool(4);
    if (!s.settings) s.settings = {};
    if (s.settings.camZoom === undefined) s.settings.camZoom = false;
    if (s.settings.soundFx === undefined) s.settings.soundFx = true;
    if (s.settings.autosave === undefined) s.settings.autosave = true;
    return s;
  }

  function save() {
    if (state && state.settings && state.settings.autosave === false) return;
    try {
      localStorage.setItem(Config.SAVE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — fail silently, game still runs in-memory */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(Config.SAVE_KEY);
      if (!raw) return false;
      state = normalizeState(JSON.parse(raw));
      return true;
    } catch (e) {
      return false;
    }
  }

  function reset() {
    try { localStorage.removeItem(Config.SAVE_KEY); } catch (e) { /* noop */ }
    return newGame();
  }

  function get() { return state; }

  // ---- View router ----
  function showView(viewId) {
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    currentView = viewId;
    UI.onShowView(viewId);
  }

  function getCurrentView() { return currentView; }

  return { newGame, save, load, reset, get, showView, getCurrentView };
})();

/* ================================================================
   5. SEASON / SCHEDULE
   ================================================================ */
const Season = (() => {
  // 14 regular-season weeks + 1 Finals week, alternating home/away,
  // cycling through the opponent pool.
  function generateSchedule() {
    const schedule = [];
    const pool = Data.OPPONENTS.slice();
    for (let i = 0; i < pool.length; i++) {
      const j = Math.floor(Math.random() * pool.length);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let week = 0; week < Config.SEASON_REGULAR_WEEKS; week++) {
      const opp = pool[week % pool.length];
      schedule.push({
        week: week + 1,
        oppAbbr: opp.abbr,
        oppName: opp.name,
        home: week % 2 === 0,
        played: false,
        result: null,
        homeScore: null,
        awayScore: null,
        isFinals: false,
      });
    }
    schedule.push({
      week: Config.SEASON_REGULAR_WEEKS + 1,
      oppAbbr: 'ALL-STAR',
      oppName: 'Championship Opponent',
      home: true,
      played: false,
      result: null,
      homeScore: null,
      awayScore: null,
      isFinals: true,
    });
    return schedule;
  }

  function getCurrentGame() {
    const s = State.get().season;
    return s.schedule[s.weekIndex] || null;
  }

  function isSeasonComplete() {
    const s = State.get().season;
    return s.weekIndex >= s.schedule.length;
  }

  // Standings combine the player's franchise with all fictional opponents.
  function getStandings() {
    const { team, opponents } = State.get();
    const rows = [{ abbr: team.abbr, name: team.name, wins: team.wins, losses: team.losses, isSelf: true }];
    opponents.forEach((o) => rows.push({ abbr: o.abbr, name: o.name, wins: o.wins, losses: o.losses, isSelf: false }));
    rows.sort((a, b) => {
      const pctA = a.wins / Math.max(1, a.wins + a.losses);
      const pctB = b.wins / Math.max(1, b.wins + b.losses);
      return pctB - pctA;
    });
    return rows;
  }

  // Same as getStandings but scoped to one conference ('A' or 'N'). The
  // player's own franchise has no stored conf field, so it's always treated
  // as conference 'A'.
  function getConferenceStandings(conf) {
    const { team, opponents } = State.get();
    const rows = [];
    if (conf === 'A') rows.push({ abbr: team.abbr, name: team.name, wins: team.wins, losses: team.losses, isSelf: true });
    opponents.filter((o) => o.conf === conf).forEach((o) => rows.push({ abbr: o.abbr, name: o.name, wins: o.wins, losses: o.losses, isSelf: false }));
    rows.sort((a, b) => {
      const pctA = a.wins / Math.max(1, a.wins + a.losses);
      const pctB = b.wins / Math.max(1, b.wins + b.losses);
      return pctB - pctA;
    });
    return rows;
  }

  // Other league games happen "off-screen" each week to keep standings alive.
  function simulateOtherGames() {
    const { opponents } = State.get();
    opponents.forEach((o) => {
      if (Math.random() < 0.5) o.wins += 1; else o.losses += 1;
    });
  }

  function markWeekPlayed(homeScore, awayScore) {
    const game = getCurrentGame();
    if (!game) return;
    game.played = true;
    game.homeScore = homeScore;
    game.awayScore = awayScore;
    const won = game.home ? homeScore > awayScore : awayScore > homeScore;
    game.result = won ? 'W' : 'L';
  }

  function advanceWeek() {
    const s = State.get().season;
    s.weekIndex += 1;
    simulateOtherGames();
    if (isSeasonComplete()) startNewSeason();
  }

  // Offseason: age roster, decay facilities, handle retirements + a simple
  // auto-draft using banked draft picks, reset records & schedule.
  function startNewSeason() {
    const { team, season, hof } = State.get();
    Economy.endOfSeasonDecay(team);

    team.roster.forEach((p) => { p.age += 1; });

    // Retirement: players 38+ retire; notable ones (4-5 star) join the HOF legends list.
    const retirees = team.roster.filter((p) => p.age >= 38);
    retirees.forEach((p) => {
      if (Economy.starRating(p) >= 4) hof.legends.push({ name: p.name, pos: p.pos, stars: Economy.starRating(p), careerPoints: p.stats.points });
    });
    team.roster = team.roster.filter((p) => p.age < 38);

    // Auto-draft: spend banked picks on fresh rookies, then reset pick counts for the new year.
    ['1', '2', '3'].forEach((round) => {
      const count = team.draftPicks[round] || 0;
      const overallTarget = round === '1' ? Data.randInt(55, 75) : round === '2' ? Data.randInt(42, 60) : Data.randInt(30, 48);
      for (let i = 0; i < count; i++) {
        if (team.roster.length < Config.ROSTER_SIZE) {
          team.roster.push(Data.generatePlayer(Data.pick(Data.POSITIONS), overallTarget, Data.randInt(19, 22)));
        }
      }
    });
    team.draftPicks = { 1: 1, 2: 1, 3: 1 };

    // Refill starters if depleted by retirement/trades.
    while (team.starterIds.length < Config.STARTER_COUNT && team.roster.length > team.starterIds.length) {
      const bench = team.roster.find((p) => !team.starterIds.includes(p.id));
      if (!bench) break;
      team.starterIds.push(bench.id);
    }
    team.starterIds = team.starterIds.filter((id) => team.roster.some((p) => p.id === id));

    team.wins = 0;
    team.losses = 0;
    team.winStreak = 0;
    season.year += 1;
    season.weekIndex = 0;
    season.schedule = generateSchedule();
    State.get().opponents.forEach((o) => { o.wins = 0; o.losses = 0; });
    State.get().market.freeAgents = Data.generateFreeAgents(5);

    UI.toast(`SEASON ${season.year} BEGINS!`);
  }

  return { generateSchedule, getCurrentGame, isSeasonComplete, getStandings, getConferenceStandings, markWeekPlayed, advanceWeek, startNewSeason };
})();

/* ================================================================
   6. TEXT SIM ENGINE
   Shared possession-resolution math used by:
     - the instant "Quick Sim Game" button
     - the "Sim Quarter" fast-forward inside the canvas game
     - AI-controlled defensive possessions during manual play
   ================================================================ */
const Sim = (() => {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const AVG_POSSESSION_SECONDS = 18;

  // Resolve one possession given attacking/defending ratings (0-99).
  // Returns a structured outcome plus a human-readable log line.
  function simulatePossession(offRating, defRating, offName, defName, diffMod) {
    diffMod = diffMod || 1;
    const edge = clamp((offRating - defRating) * diffMod, -60, 60);
    const scoreChance = clamp(0.46 + edge / 240, 0.22, 0.78);
    const turnoverChance = clamp(0.12 - edge / 600, 0.04, 0.22);
    const threeChance = 0.32; // fraction of made shots that are 3-pointers

    const roll = Math.random();
    if (roll < turnoverChance) {
      return { scored: false, points: 0, turnover: true, log: `${offName} turns it over.` };
    }
    if (roll < turnoverChance + scoreChance) {
      const isThree = Math.random() < threeChance;
      const points = isThree ? 3 : 2;
      return { scored: true, points, turnover: false, log: `${offName} scores a ${points}-pointer!` };
    }
    // Missed shot -> rebound battle (slightly favors the defense).
    const offenseGetsBall = Math.random() < clamp(0.28 + edge / 400, 0.12, 0.45);
    return {
      scored: false, points: 0, turnover: false, missed: true,
      reboundBy: offenseGetsBall ? 'offense' : 'defense',
      log: `${offName} misses — rebound ${offenseGetsBall ? offName : defName}.`,
    };
  }

  // Resolve a manual, player-timed shot attempt (from the canvas shot meter).
  // `accuracy` is 0-1, 1 being a perfect-timed release.
  function resolveUserShot(shooter, defRating, isThree, accuracy) {
    const shootSkill = isThree ? shooter.attrs.three : shooter.attrs.shooting;
    const base = clamp(0.35 + (shootSkill - defRating) / 200, 0.15, 0.85);
    const finalChance = clamp(base * (0.5 + accuracy * 0.6), 0.05, 0.95);
    const made = Math.random() < finalChance;
    return { made, points: made ? (isThree ? 3 : 2) : 0 };
  }

  // Simulate an entire game instantly (used by Quick Sim).
  function simulateGame(homeOffRating, homeDefRating, awayOffRating, awayDefRating, homeName, awayName, quarterMinutes, diffMod) {
    const totalSeconds = quarterMinutes * 60 * 4;
    let elapsed = 0;
    let homeScore = 0;
    let awayScore = 0;
    let possession = 'home';
    const log = [];

    while (elapsed < totalSeconds) {
      const offRating = possession === 'home' ? homeOffRating : awayOffRating;
      const defRating = possession === 'home' ? awayDefRating : homeDefRating;
      const offName = possession === 'home' ? homeName : awayName;
      const defName = possession === 'home' ? awayName : homeName;
      const outcome = simulatePossession(offRating, defRating, offName, defName, possession === 'home' ? 1 : diffMod);

      if (outcome.scored) {
        if (possession === 'home') homeScore += outcome.points; else awayScore += outcome.points;
        log.push(outcome.log);
        possession = possession === 'home' ? 'away' : 'home';
      } else if (outcome.turnover) {
        log.push(outcome.log);
        possession = possession === 'home' ? 'away' : 'home';
      } else {
        log.push(outcome.log);
        if (outcome.reboundBy === 'defense') possession = possession === 'home' ? 'away' : 'home';
        // offensive rebound: same team keeps possession
      }
      elapsed += AVG_POSSESSION_SECONDS + Data.randInt(-4, 4);
    }
    return { homeScore, awayScore, log };
  }

  // Spread a final score across the 5 starters as a lightweight box score,
  // weighted by shooting/rebounding/speed attrs, and grant small XP.
  function distributeBoxScoreStats(team, pointsScored) {
    const starters = team.roster.filter((p) => team.starterIds.includes(p.id));
    if (!starters.length) return;
    const shootWeights = starters.map((p) => p.attrs.shooting + p.attrs.three);
    const totalWeight = shootWeights.reduce((a, b) => a + b, 0) || 1;
    const reboundsTotal = Data.randInt(32, 46);
    const assistsTotal = Data.randInt(14, 26);
    const reboundWeights = starters.map((p) => p.attrs.rebounding);
    const totalReboundWeight = reboundWeights.reduce((a, b) => a + b, 0) || 1;
    const assistWeights = starters.map((p) => p.attrs.speed);
    const totalAssistWeight = assistWeights.reduce((a, b) => a + b, 0) || 1;

    const events = [];
    starters.forEach((p, i) => {
      const pts = Math.round((shootWeights[i] / totalWeight) * pointsScored);
      const reb = Math.round((reboundWeights[i] / totalReboundWeight) * reboundsTotal);
      const ast = Math.round((assistWeights[i] / totalAssistWeight) * assistsTotal);
      p.stats.games += 1;
      p.stats.points += pts;
      p.stats.rebounds += reb;
      p.stats.assists += ast;
      const xpEvent = Economy.grantXP(p, pts + reb * 0.5 + ast * 0.5, team);
      if (xpEvent) events.push({ player: p, ...xpEvent });
    });
    return events;
  }

  return { simulatePossession, resolveUserShot, simulateGame, distributeBoxScoreStats };
})();

/* ================================================================
   ACHIEVEMENTS — evaluated against current state on each HOF render
   and right after a game finishes.
   ================================================================ */
const Achievements = (() => {
  const CHECKS = {
    first_win: (s) => s.team.wins >= 1,
    win_streak_5: (s) => s.team.winStreak >= 5,
    fan_fav: (s) => s.team.fanSupport >= 90,
    five_star_player: (s) => s.team.roster.some((p) => Economy.starRating(p) >= 5),
    champion: (s) => s.hof.finalsWon >= 1,
    dynasty: (s) => s.hof.finalsWon >= 3,
    full_stadium: (s) => s.team.stadiumLevel >= Config.MAX_UPGRADE_LEVEL,
    cap_max: (s) => s.team.capIncreases >= 3,
  };

  function checkAll() {
    const s = State.get();
    const unlocked = s.hof.achievementsUnlocked;
    Data.ACHIEVEMENTS.forEach((a) => {
      if (!unlocked.includes(a.id) && CHECKS[a.id] && CHECKS[a.id](s)) {
        unlocked.push(a.id);
        UI.toast(`ACHIEVEMENT UNLOCKED: ${a.name}`);
      }
    });
    updateRecords(s);
  }

  function updateRecords(s) {
    const allKnown = s.team.roster.concat(s.hof.legends.map((l) => ({ name: l.name, stats: { points: l.careerPoints || 0, rebounds: 0, assists: 0 } })));
    let topScorer = null, topRebounder = null, topAssister = null;
    allKnown.forEach((p) => {
      const stats = p.stats || { points: 0, rebounds: 0, assists: 0 };
      if (!topScorer || stats.points > topScorer.value) topScorer = { name: p.name, value: stats.points };
      if (!topRebounder || stats.rebounds > topRebounder.value) topRebounder = { name: p.name, value: stats.rebounds };
      if (!topAssister || stats.assists > topAssister.value) topAssister = { name: p.name, value: stats.assists };
    });
    s.hof.records = { topScorer, topRebounder, topAssister };
  }

  return { checkAll };
})();

/* ================================================================
   GAME FLOW — ties Economy + Sim + Season together once a game
   (quick-simmed or played on the court) produces a final score.
   ================================================================ */
const GameFlow = (() => {
  function finalizeGame(homeScore, awayScore) {
    const s = State.get();
    const team = s.team;
    const game = Season.getCurrentGame();
    const won = homeScore > awayScore; // user team is always "home" in our model
    const isFinals = !!(game && game.isFinals);

    team.wins += won ? 1 : 0;
    team.losses += won ? 0 : 1;
    team.winStreak = won ? (team.winStreak || 0) + 1 : 0;

    const ccAwarded = Economy.calcPostGameCC(team.fanSupport, won && isFinals);
    team.cc += ccAwarded;
    Economy.applyPostGameFanChange(team, won);
    Economy.applyMoraleChange(team, won);
    if (won && isFinals) s.hof.finalsWon += 1;

    Sim.distributeBoxScoreStats(team, homeScore); // homeScore is always the user team's points

    Season.markWeekPlayed(homeScore, awayScore);
    Achievements.checkAll();
    Season.advanceWeek();
    State.save();

    return { won, ccAwarded, isFinals };
  }

  return { finalizeGame };
})();

/* ================================================================
   7. UI RENDERING ENGINE
   Pure DOM-writing functions. Nothing here mutates game state —
   it only reads State.get() and paints the current view.
   ================================================================ */
const UI = (() => {
  let toastTimer = null;
  let selectedPlayerId = null;

  function $(id) { return document.getElementById(id); }
  function fmtMoney(n) { return `$${(n / 1_000_000).toFixed(1)}M`; }
  function fmtPercent(n) { return `${Math.round(n)}%`; }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Keeps every header's CC readout (id="header-cc" plus any .cc-live span)
  // in sync without re-rendering whole views.
  function syncHeaderCC() {
    const cc = State.get().team.cc;
    document.querySelectorAll('.cc-live').forEach((el) => { el.textContent = cc; });
  }

  /* ---------------- PROCEDURAL PIXEL-FACE PORTRAITS ----------------
     Deterministic per-id "face": a flat-color circle + a hair arc, picked
     by hashing the id so the same player/coach always renders the same
     face across re-renders, with zero image/font assets. */
  const SKIN_TONES = ['#e8b48c', '#c68863', '#a8693f', '#8a5430', '#5c3a22'];
  const HAIR_COLORS = ['#1a1a1a', '#3b2a1a', '#5c4326', '#7a7a7a', '#000000'];

  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function pixelFaceHTML(seed) {
    const h = hashStr(String(seed));
    const skin = SKIN_TONES[h % SKIN_TONES.length];
    const hair = HAIR_COLORS[Math.floor(h / SKIN_TONES.length) % HAIR_COLORS.length];
    return `<div class="pixel-face" style="background:${skin}"><div class="pixel-face-hair" style="background:${hair}"></div></div>`;
  }

  /* ---------------- INFO BADGE TOOLTIPS ---------------- */
  const INFO_TEXT = {
    frontoffice: 'Upgrade your stadium, facilities and rehab center, hire staff, and manage your salary cap.',
    freeagents: 'Sign available free agents to your roster. Capped by your salary cap room.',
    staffhires: 'Hire coaches to permanently boost your team offense and/or defense rating.',
    roster: 'Tap a player card to view full attributes and take actions like Meeting, Trade, or Bench.',
    league: 'View standings by conference, the full season schedule, or the playoff bracket.',
    hof: 'Track your franchise achievements, championships, player records, and retired legends.',
    draft: 'Sell your owned draft picks for instant Coaching Credits. Tap the badge to sell your lowest-round pick.',
    difficulty: 'Higher difficulty makes opposing teams play tougher offense and defense.',
  };

  function showInfo(key) {
    if (INFO_TEXT[key]) toast(INFO_TEXT[key]);
  }

  /* ---------------- MAIN MENU ---------------- */
  function renderMainMenu() {
    const s = State.get();
    const team = s.team;
    $('team-name-display').textContent = team.name.toUpperCase();
    $('header-cc').textContent = team.cc;
    $('year-badge').textContent = `Y${s.season.year}`;
    $('stat-morale').textContent = fmtPercent(team.morale);
    $('stat-fans').textContent = fmtPercent(team.fanSupport);
    $('fan-meter-fill').style.width = `${Math.max(0, Math.min(100, team.fanSupport))}%`;
    $('stat-off-stars').textContent = Economy.starString(Math.ceil(Economy.teamOffenseRating(team) / 20));
    const defStars = Math.max(1, Math.min(5, Math.ceil(Economy.teamDefenseRating(team) / 20)));
    const defIcon = $('stat-def-icon');
    defIcon.className = defStars >= 4 ? 'def-good' : defStars <= 2 ? 'def-bad' : 'def-mid';

    // Schedule strip
    const track = $('schedule-track');
    track.innerHTML = '';
    s.season.schedule.forEach((g, idx) => {
      const pill = document.createElement('div');
      pill.className = 'week-pill';
      if (idx === s.season.weekIndex) pill.classList.add('is-current');
      if (g.played) pill.classList.add('is-played');
      const dotClass = idx === s.season.weekIndex ? 'dot-current' : !g.played ? 'dot-future' : g.result === 'W' ? 'dot-win' : 'dot-loss';
      pill.innerHTML = `
        <span class="wk-info-top">
          <span class="wk-num">${g.isFinals ? 'FINALS' : 'WEEK ' + g.week}</span>
          <span class="wk-opp">${g.home ? 'vs' : 'at'} ${g.oppAbbr}</span>
        </span>
        <span class="wk-dot ${dotClass}"></span>
        <span class="wk-result">${g.played ? `${g.result} ${g.homeScore}-${g.awayScore}` : ''}</span>
      `;
      track.appendChild(pill);
    });
    const current = track.children[s.season.weekIndex];
    if (current) current.scrollIntoView({ inline: 'center', block: 'nearest' });

    // Standings
    const list = $('standings-list');
    list.innerHTML = '';
    Season.getStandings().forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'standings-row' + (row.isSelf ? ' is-self' : '');
      div.innerHTML = `<span class="standings-name">${row.name.toUpperCase()}</span><span>${row.wins}</span><span>${row.losses}</span><span>0</span>`;
      list.appendChild(div);
    });
  }

  /* ---------------- OPTIONS (formerly Settings) ----------------
     Each cycle-able setting is described once here: its value list,
     how to read/write it on state, and how to label the current
     value. cycleOption() (in Events) just advances to the next value. */
  const OPTION_CYCLES = {
    quarterLength: { values: [2, 3, 5], get: (s) => s.settings.quarterLength, set: (s, v) => { s.settings.quarterLength = v; }, label: (v) => `${v} MIN` },
    difficulty: { values: ['easy', 'medium', 'hard', 'extreme'], get: (s) => s.settings.difficulty, set: (s, v) => { s.settings.difficulty = v; }, label: (v) => v.toUpperCase() },
    camZoom: { values: [false, true], get: (s) => s.settings.camZoom, set: (s, v) => { s.settings.camZoom = v; }, label: (v) => (v ? 'ON' : 'OFF') },
    soundFx: { values: [true, false], get: (s) => s.settings.soundFx, set: (s, v) => { s.settings.soundFx = v; }, label: (v) => (v ? 'ON' : 'OFF') },
    autosave: { values: [true, false], get: (s) => s.settings.autosave, set: (s, v) => { s.settings.autosave = v; }, label: (v) => (v ? 'ON' : 'OFF') },
    uniform: { values: ['home', 'away'], get: (s) => s.team.uniform, set: (s, v) => { s.team.uniform = v; }, label: (v) => v.toUpperCase() },
  };

  function renderSettings() {
    const s = State.get();
    Object.keys(OPTION_CYCLES).forEach((key) => {
      const btn = $(`opt-${key}`);
      if (btn) btn.textContent = OPTION_CYCLES[key].label(OPTION_CYCLES[key].get(s));
    });
  }

  function cycleOption(key) {
    const cfg = OPTION_CYCLES[key];
    if (!cfg) return;
    const s = State.get();
    const current = cfg.get(s);
    const idx = cfg.values.indexOf(current);
    const next = cfg.values[(idx + 1) % cfg.values.length];
    cfg.set(s, next);
    State.save();
    renderSettings();
  }

  /* ---------------- SHARED CARD/ROW BUILDERS ---------------- */
  function listRowHTML(name, sub, actionHTML) {
    return `<div class="list-row"><div class="list-row-info"><span class="list-row-name">${name}</span><span class="list-row-sub">${sub}</span></div>${actionHTML || ''}</div>`;
  }

  // Generic player card used by Roster (click-to-open-detail) and the Free
  // Agents marketplace grid (cost label + SIGN button instead).
  function playerCardHTML(p, opts) {
    opts = opts || {};
    const stars = Economy.starRating(p);
    const moraleIcon = p.morale >= 70 ? '\u{1F642}' : p.morale >= 40 ? '\u{1F610}' : '\u{1F641}';
    return `
      <div class="player-card${opts.isStarter ? ' is-starter' : ''}" data-player-id="${p.id}">
        ${opts.showMorale ? `<span class="player-card-morale-icon">${moraleIcon}</span>` : ''}
        <div class="player-card-portrait">${pixelFaceHTML(p.id)}</div>
        <span class="player-card-pos">${p.pos}</span>
        <div class="player-card-info">
          <span class="player-card-name">${p.name}</span>
          <span class="player-card-stars">${Economy.starString(stars)}</span>
        </div>
        ${opts.costLabel ? `<span class="player-card-cost">${opts.costLabel}</span>` : ''}
        ${opts.actionHTML || ''}
      </div>
    `;
  }

  function staffHireCardHTML(coach, team) {
    const isHired = ['head', 'offense', 'defense'].some((r) => team.staff[r] && team.staff[r].id === coach.id);
    return `
      <div class="player-card">
        <div class="player-card-portrait">${pixelFaceHTML(coach.id)}</div>
        <span class="player-card-pos">${coach.role.toUpperCase()}</span>
        <div class="player-card-info">
          <span class="player-card-name">${coach.name}</span>
          <span class="player-card-stars">${coach.talent}</span>
        </div>
        <span class="player-card-cost">${coach.cost} CC</span>
        <button class="mini-btn player-card-action" data-hire-staff="${coach.id}" ${isHired || team.cc < coach.cost ? 'disabled' : ''}>${isHired ? 'HIRED' : 'HIRE'}</button>
      </div>
    `;
  }

  function staffCardHTML(role, coach) {
    const roleLabel = `${role.toUpperCase()} COACH`;
    const portrait = coach ? pixelFaceHTML(coach.id) : '<div class="pixel-face" style="background:var(--color-shadow)"></div>';
    const name = coach ? coach.name : 'VACANT';
    return `<div class="staff-mini-card"><div class="staff-mini-portrait">${portrait}</div><div class="staff-mini-info"><span class="staff-mini-role">${roleLabel}</span><span class="staff-mini-name">${name}</span></div></div>`;
  }

  /* ---------------- FRONT OFFICE ---------------- */
  function renderFrontOffice() {
    const s = State.get();
    const team = s.team;

    $('bar-cap-fill').style.width = `${Math.min(100, (Economy.getCapUsed(team) / Economy.getTotalCap(team)) * 100)}%`;

    [['stadium', team.stadiumLevel, 15], ['facilities', team.facilitiesLevel, 12], ['rehab', team.rehabLevel, 10]].forEach(([key, level, ccPerLevel]) => {
      const cost = Economy.getUpgradeCost(level, ccPerLevel);
      const maxed = level >= Config.MAX_UPGRADE_LEVEL;
      $(`bar-${key}-fill`).style.width = `${(level / Config.MAX_UPGRADE_LEVEL) * 100}%`;
      $(`cost-${key}`).textContent = maxed ? 'MAX' : cost;
      const costBtn = document.querySelector(`[data-upgrade="${key}"]`);
      if (costBtn) costBtn.disabled = maxed || team.cc < cost;
    });

    $('btn-increase-cap').disabled = team.cc < Config.CAP_INCREASE_COST_CC;

    $('staff-cards').innerHTML = ['head', 'offense', 'defense'].map((role) => staffCardHTML(role, team.staff[role])).join('');

    $('draft-badge-value').textContent = `${team.draftPicks[1] || 0}-${team.draftPicks[2] || 0}-${team.draftPicks[3] || 0}`;
  }

  /* ---------------- FREE AGENTS / STAFF HIRES MARKETPLACES ---------------- */
  function renderFreeAgents() {
    const s = State.get();
    const team = s.team;
    $('fa-current-list').innerHTML = team.roster.length
      ? team.roster.map((p) => listRowHTML(`${p.pos} — ${p.name}`, `${Economy.starString(Economy.starRating(p))} · ${fmtMoney(p.contract)}`)).join('')
      : listRowHTML('Empty roster', 'Sign a free agent to get started.');
    $('fa-available-grid').innerHTML = s.market.freeAgents.length
      ? s.market.freeAgents.map((p) => playerCardHTML(p, {
          costLabel: fmtMoney(p.contract),
          actionHTML: `<button class="mini-btn player-card-action" data-sign-fa="${p.id}" ${Economy.getCapRoom(team) < p.contract ? 'disabled' : ''}>SIGN</button>`,
        })).join('')
      : '<div class="list-row"><span class="list-row-sub">No free agents available.</span></div>';
  }

  function renderStaffHires() {
    const s = State.get();
    const team = s.team;
    $('staff-current-list').innerHTML = ['head', 'offense', 'defense'].map((role) =>
      listRowHTML(`${role.toUpperCase()} COACH`, team.staff[role] ? `${team.staff[role].name} — ${team.staff[role].talent}` : 'Vacant')
    ).join('');
    $('staff-available-grid').innerHTML = s.market.staffPool.length
      ? s.market.staffPool.map((coach) => staffHireCardHTML(coach, team)).join('')
      : '<div class="list-row"><span class="list-row-sub">No coaches available.</span></div>';
  }

  /* ---------------- ROSTER ---------------- */
  let rosterFilterStartersOnly = false;

  function toggleRosterFilter() {
    rosterFilterStartersOnly = !rosterFilterStartersOnly;
    renderRoster();
  }

  function renderRoster() {
    const s = State.get();
    const team = s.team;
    $('roster-subtitle').textContent = `PLAYERS ${team.roster.length}/${Config.ROSTER_SIZE}`;
    $('roster-stat-morale').textContent = fmtPercent(team.morale);
    $('roster-off-stars').textContent = Economy.starString(Math.ceil(Economy.teamOffenseRating(team) / 20));
    const defStars = Math.max(1, Math.min(5, Math.ceil(Economy.teamDefenseRating(team) / 20)));
    const defIcon = $('roster-def-icon');
    defIcon.className = defStars >= 4 ? 'def-good' : defStars <= 2 ? 'def-bad' : 'def-mid';
    $('roster-cap-title').textContent = `SALARY CAP — ${fmtMoney(Economy.getCapRoom(team))} ROOM`;
    $('roster-cap-fill').style.width = `${Math.min(100, (Economy.getCapUsed(team) / Economy.getTotalCap(team)) * 100)}%`;

    const filterBtn = $('btn-roster-filter');
    if (filterBtn) filterBtn.classList.toggle('nav-btn-primary', rosterFilterStartersOnly);

    const players = rosterFilterStartersOnly ? team.roster.filter((p) => team.starterIds.includes(p.id)) : team.roster;
    $('roster-cards').innerHTML = players.length
      ? players.map((p) => playerCardHTML(p, { showMorale: true, isStarter: team.starterIds.includes(p.id) })).join('')
      : '<div class="list-row"><span class="list-row-sub">Empty — sign a Free Agent.</span></div>';
  }

  /* ---------------- PLAYER DETAIL OVERLAY ---------------- */
  function openPlayerDetail(playerId) {
    selectedPlayerId = playerId;
    const team = State.get().team;
    const p = team.roster.find((pl) => pl.id === playerId);
    if (!p) return;

    $('pd-name').textContent = p.name;
    $('pd-meta').textContent = `${p.pos} · AGE ${p.age}`;
    $('pd-stars').textContent = Economy.starString(Economy.starRating(p));

    const attrs = $('pd-attributes');
    attrs.innerHTML = '';
    [['speed', 'SPEED'], ['shooting', 'SHOOTING'], ['three', '3-POINTER'], ['defense', 'DEFENSE'], ['rebounding', 'REBOUNDING']].forEach(([key, label]) => {
      const val = p.attrs[key];
      const row = document.createElement('div');
      row.className = 'pd-attr-row';
      row.innerHTML = `
        <div class="pd-attr-label"><span>${label}</span><span>${val}</span></div>
        <div class="pd-attr-bar"><div class="pd-attr-fill" style="width:${val}%"></div></div>
      `;
      attrs.appendChild(row);
    });

    $('pd-stats').innerHTML = `
      <div>PTS<span>${p.stats.points}</span></div>
      <div>REB<span>${p.stats.rebounds}</span></div>
      <div>AST<span>${p.stats.assists}</span></div>
      <div>GP<span>${p.stats.games}</span></div>
    `;
    $('pd-contract').textContent = `Contract: ${fmtMoney(p.contract)} · Morale: ${p.morale}%`;
    $('pd-btn-bench').textContent = team.starterIds.includes(p.id) ? 'BENCH' : 'UNBENCH';
    $('overlay-player-detail').classList.add('active');
  }

  function closePlayerDetail() {
    $('overlay-player-detail').classList.remove('active');
    selectedPlayerId = null;
  }

  function getSelectedPlayerId() { return selectedPlayerId; }

  /* ---------------- LEAGUE & STANDINGS ---------------- */
  let leagueTab = 'view';
  function setLeagueTab(tab) { leagueTab = tab; renderLeague(); }

  function standingsRowsHTML(rows) {
    return rows.map((row) => `<div class="standings-row${row.isSelf ? ' is-self' : ''}"><span class="standings-name">${row.name.toUpperCase()}</span><span>${row.wins}</span><span>${row.losses}</span><span>0</span></div>`).join('');
  }
  function tieredConfColumnHTML(conf, title) {
    const rows = Season.getConferenceStandings(conf);
    const tiers = [['DIVISION LEADER', rows.slice(0, 1)], ['WILD CARD', rows.slice(1, 3)], ['IN THE HUNT', rows.slice(3)]];
    const body = tiers.map(([label, group]) => (group.length ? `<div class="standings-tier-label">${label}</div>${standingsRowsHTML(group)}` : '')).join('');
    return `<div class="standings-box" style="height:100%"><div class="standings-title"><span>${title}</span></div><div class="standings-header"><span></span><span>W</span><span>L</span><span>T</span></div><div class="standings-list">${body}</div></div>`;
  }
  function confColumnHTML(conf, title) {
    const rows = Season.getConferenceStandings(conf);
    return `<div class="standings-box" style="height:100%"><div class="standings-title"><span>${title}</span></div><div class="standings-header"><span></span><span>W</span><span>L</span><span>T</span></div><div class="standings-list">${standingsRowsHTML(rows)}</div></div>`;
  }
  function scheduleListHTML() {
    const s = State.get();
    return s.season.schedule.map((g) => {
      const label = g.isFinals ? 'FINALS' : `WEEK ${g.week}`;
      const opp = `${g.home ? 'vs' : 'at'} ${g.oppAbbr}`;
      const sub = g.played ? `${opp} — ${g.result} ${g.homeScore}-${g.awayScore}` : opp;
      return listRowHTML(label, sub);
    }).join('');
  }
  function playoffsHTML() {
    const s = State.get();
    const finals = s.season.schedule.find((g) => g.isFinals);
    const body = !finals
      ? listRowHTML('No playoff data', 'Complete the regular season to unlock the Finals.')
      : listRowHTML('FINALS', finals.played ? `${finals.result} ${finals.homeScore}-${finals.awayScore}` : `${finals.home ? 'vs' : 'at'} ${finals.oppName}`);
    return `<div class="titled-box" style="height:100%"><span class="titled-box-title"><span>CHAMPIONSHIP</span></span><div class="hof-list">${body}</div></div>`;
  }
  function renderLeague() {
    const content = $('league-content');
    document.querySelectorAll('#league-tabs .tab-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.leagueTab === leagueTab));
    if (leagueTab === 'view') content.innerHTML = `<div class="league-conf-grid">${tieredConfColumnHTML('A', 'CONFERENCE A')}${tieredConfColumnHTML('N', 'CONFERENCE N')}</div>`;
    else if (leagueTab === 'confA') content.innerHTML = confColumnHTML('A', 'CONFERENCE A');
    else if (leagueTab === 'confN') content.innerHTML = confColumnHTML('N', 'CONFERENCE N');
    else if (leagueTab === 'schedule') content.innerHTML = `<div class="titled-box" style="height:100%"><span class="titled-box-title"><span>SEASON SCHEDULE</span></span><div class="hof-list">${scheduleListHTML()}</div></div>`;
    else if (leagueTab === 'playoffs') content.innerHTML = playoffsHTML();
  }

  /* ---------------- HALL OF FAME ---------------- */
  let hofTab = 'achievements';
  function setHofTab(tab) { hofTab = tab; renderHOF(); }

  function hofAchievementsHTML(s) {
    return Data.ACHIEVEMENTS.map((a) => {
      const unlocked = s.hof.achievementsUnlocked.includes(a.id);
      return listRowHTML(`${unlocked ? '✓' : '☐'} ${a.name}`, a.desc);
    }).join('');
  }
  function hofChampionshipsHTML(s) {
    if (!s.hof.finalsWon) return listRowHTML('No championships yet', 'Win the Finals to add a banner.');
    return Array.from({ length: s.hof.finalsWon }, (_, i) => listRowHTML(`🏆 Championship #${i + 1}`, 'Retro Hoops Champion')).join('');
  }
  function hofRecordsHTML(s) {
    const r = s.hof.records;
    return [
      listRowHTML('Career Points', r.topScorer ? `${r.topScorer.name} — ${r.topScorer.value}` : '—'),
      listRowHTML('Career Rebounds', r.topRebounder ? `${r.topRebounder.name} — ${r.topRebounder.value}` : '—'),
      listRowHTML('Career Assists', r.topAssister ? `${r.topAssister.name} — ${r.topAssister.value}` : '—'),
    ].join('');
  }
  function hofLegendsHTML(s) {
    return s.hof.legends.length
      ? s.hof.legends.map((l) => listRowHTML(`${l.name} (${l.pos})`, Economy.starString(l.stars))).join('')
      : listRowHTML('No legends retired yet', 'Veteran players retire here over time.');
  }
  function renderHOF() {
    const s = State.get();
    document.querySelectorAll('#hof-tabs .tab-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.hofTab === hofTab));
    const pct = Math.round((s.hof.achievementsUnlocked.length / Data.ACHIEVEMENTS.length) * 100);
    const titles = {
      achievements: `— ACHIEVEMENTS ${pct}% —`,
      championships: `— ${s.hof.finalsWon} CHAMPIONSHIP${s.hof.finalsWon === 1 ? '' : 'S'} —`,
      records: '— CAREER RECORDS —',
      legends: '— RETIRED LEGENDS —',
    };
    const bodies = { achievements: hofAchievementsHTML, championships: hofChampionshipsHTML, records: hofRecordsHTML, legends: hofLegendsHTML };
    $('hof-box-title').textContent = titles[hofTab];
    $('hof-list').innerHTML = bodies[hofTab](s);
  }

  /* ---------------- PRE-GAME ---------------- */
  function renderPregame() {
    const s = State.get();
    const game = Season.getCurrentGame();
    $('matchup-home-name').textContent = s.team.name.toUpperCase();
    $('matchup-away-name').textContent = game ? (game.isFinals ? 'CHAMPIONSHIP OPPONENT' : game.oppName.toUpperCase()) : 'SEASON COMPLETE';

    document.querySelectorAll('#uniform-row .choice-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.uniform === s.team.uniform);
    });
    $('uniform-preview').style.background = s.team.uniform === 'home' ? 'var(--color-home)' : 'var(--color-away)';

    const lineup = $('lineup-quick');
    lineup.innerHTML = '';
    s.team.roster.filter((p) => s.team.starterIds.includes(p.id)).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.dataset.playerId = p.id;
      row.innerHTML = `<div class="list-row-info"><span class="list-row-name">${p.pos} — ${p.name}</span><span class="list-row-sub">${Economy.starString(Economy.starRating(p))}</span></div><span class="mini-btn">SWAP</span>`;
      lineup.appendChild(row);
    });

    $('btn-tipoff').disabled = !game;
    $('btn-quicksim-game').disabled = !game;
  }

  /* ---------------- GAME HUD ---------------- */
  function updateGameHUD(homeScore, awayScore, clockSeconds, quarter) {
    $('hud-score-home').textContent = homeScore;
    $('hud-score-away').textContent = awayScore;
    const mins = Math.floor(clockSeconds / 60);
    const secs = Math.floor(clockSeconds % 60);
    $('hud-clock').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    $('hud-quarter').textContent = `Q${quarter}`;
  }

  function pushGameLog(text) {
    const log = $('game-log');
    const div = document.createElement('div');
    div.textContent = text;
    log.appendChild(div);
    while (log.children.length > 8) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function clearGameLog() { $('game-log').innerHTML = ''; }

  function updatePlayerCallout(entity) {
    const card = $('game-stat-callout');
    if (!entity || !entity.player) { card.classList.remove('active'); return; }
    const p = entity.player;
    $('gsc-name').textContent = p.name.toUpperCase();
    $('gsc-pos').textContent = p.pos;
    $('gsc-pts').textContent = p.stats.points;
    $('gsc-reb').textContent = p.stats.rebounds;
    $('gsc-ast').textContent = p.stats.assists;
    card.classList.add('active');
  }

  /* ---------------- ROUTER HOOK ---------------- */
  function onShowView(viewId) {
    syncHeaderCC();
    switch (viewId) {
      case 'view-main-menu': renderMainMenu(); break;
      case 'view-settings': renderSettings(); break;
      case 'view-frontoffice': renderFrontOffice(); break;
      case 'view-roster': renderRoster(); break;
      case 'view-freeagents': renderFreeAgents(); break;
      case 'view-staffhires': renderStaffHires(); break;
      case 'view-league': renderLeague(); break;
      case 'view-hof': renderHOF(); break;
      case 'view-pregame': renderPregame(); break;
      default: break;
    }
  }

  function renderActiveSubview() { onShowView(State.getCurrentView()); }

  return {
    toast, syncHeaderCC, showInfo, renderMainMenu, renderSettings, cycleOption,
    renderFrontOffice, renderFreeAgents, renderStaffHires,
    renderRoster, toggleRosterFilter,
    openPlayerDetail, closePlayerDetail, getSelectedPlayerId,
    renderLeague, setLeagueTab, renderHOF, setHofTab,
    renderPregame, updateGameHUD, pushGameLog, clearGameLog, updatePlayerCallout,
    onShowView, renderActiveSubview, fmtMoney, fmtPercent,
  };
})();

/* ================================================================
   8. EVENT BINDING
   Wires every button/click in the DOM to State/Economy/Sim/Season.
   Uses event delegation on document.body so dynamically injected
   rows (roster, free agents, staff, draft picks...) work for free.
   ================================================================ */
const Events = (() => {
  function bind() {
    document.body.addEventListener('click', handleClick);
  }

  function handleClick(e) {
    const target = e.target;

    // --- Navigation ---
    const navBtn = target.closest('[data-route]');
    if (navBtn) { State.showView(navBtn.dataset.route); return; }

    const backBtn = target.closest('[data-back]');
    if (backBtn) { State.showView(backBtn.dataset.back); return; }

    // --- Info badges (must be checked before any container they sit inside,
    // e.g. the draft badge, so the "i" tap doesn't fall through to it) ---
    const infoBtn = target.closest('[data-info]');
    if (infoBtn) { UI.showInfo(infoBtn.dataset.info); return; }

    // --- Options: cycling value buttons ---
    const cycleBtn = target.closest('[data-cycle]');
    if (cycleBtn) { UI.cycleOption(cycleBtn.dataset.cycle); return; }

    if (target.id === 'btn-exit-game') {
      if (confirm('Reset your franchise and start a brand new save?')) {
        State.reset();
        State.showView('view-main-menu');
        UI.toast('NEW FRANCHISE STARTED');
      }
      return;
    }
    if (target.id === 'btn-exhibition') { doExhibitionGame(); return; }

    // --- Front Office: upgrades ---
    const upgradeBtn = target.closest('[data-upgrade]');
    if (upgradeBtn) {
      const team = State.get().team;
      const kind = upgradeBtn.dataset.upgrade;
      const fn = { stadium: Economy.upgradeStadium, facilities: Economy.upgradeFacilities, rehab: Economy.upgradeRehab }[kind];
      if (fn && fn(team)) { State.save(); UI.renderFrontOffice(); UI.toast(`${kind.toUpperCase()} UPGRADED`); }
      return;
    }
    if (target.id === 'btn-increase-cap') {
      const team = State.get().team;
      if (Economy.increaseSalaryCap(team)) {
        State.save(); UI.renderFrontOffice();
        UI.toast('SALARY CAP INCREASED +$25M');
      }
      return;
    }

    // --- Front Office: draft pick badge (sell the lowest-round owned pick) ---
    const draftBadge = target.closest('#draft-badge');
    if (draftBadge) {
      const team = State.get().team;
      const round = [1, 2, 3].find((r) => (team.draftPicks[r] || 0) > 0);
      if (round) {
        team.draftPicks[round] -= 1;
        const value = Economy.draftPickSellValue(round);
        team.cc += value;
        State.save(); UI.renderFrontOffice();
        UI.toast(`SOLD R${round} PICK FOR ${value} CC`);
      } else {
        UI.toast('NO DRAFT PICKS TO SELL');
      }
      return;
    }

    // --- Free Agents marketplace ---
    const signBtn = target.closest('[data-sign-fa]');
    if (signBtn) {
      const s = State.get();
      const team = s.team;
      const agent = s.market.freeAgents.find((p) => p.id === signBtn.dataset.signFa);
      if (agent && Economy.getCapRoom(team) >= agent.contract) {
        if (team.roster.length >= Config.ROSTER_SIZE) {
          // Cut the lowest-overall bench player to make room.
          const bench = team.roster.filter((p) => !team.starterIds.includes(p.id));
          const cut = bench.sort((a, b) => Economy.overallOf(a) - Economy.overallOf(b))[0];
          if (cut) team.roster = team.roster.filter((p) => p.id !== cut.id);
        }
        team.roster.push(agent);
        s.market.freeAgents = s.market.freeAgents.filter((p) => p.id !== agent.id);
        State.save(); UI.renderFreeAgents();
        UI.toast(`SIGNED ${agent.name}`);
      }
      return;
    }
    if (target.id === 'btn-refresh-fa') {
      const s = State.get();
      const team = s.team;
      const cost = 5;
      if (team.cc < cost) { UI.toast('NOT ENOUGH CC'); return; }
      team.cc -= cost;
      s.market.freeAgents = Data.generateFreeAgents(5);
      State.save(); UI.renderFreeAgents();
      UI.toast('FREE AGENT POOL REFRESHED');
      return;
    }

    // --- Staff Hires marketplace ---
    const hireBtn = target.closest('[data-hire-staff]');
    if (hireBtn) {
      const s = State.get();
      const team = s.team;
      const coach = s.market.staffPool.find((c) => c.id === hireBtn.dataset.hireStaff);
      if (coach && team.cc >= coach.cost) {
        team.cc -= coach.cost;
        team.staff[coach.role.toLowerCase()] = coach;
        State.save(); UI.renderStaffHires(); UI.renderFrontOffice();
        UI.toast(`HIRED ${coach.name}`);
      }
      return;
    }
    if (target.id === 'btn-refresh-staff') {
      const s = State.get();
      const team = s.team;
      const cost = 5;
      if (team.cc < cost) { UI.toast('NOT ENOUGH CC'); return; }
      team.cc -= cost;
      s.market.staffPool = Data.generateStaffPool(4);
      State.save(); UI.renderStaffHires();
      UI.toast('STAFF POOL REFRESHED');
      return;
    }

    // --- Roster ---
    if (target.id === 'btn-roster-filter') { UI.toggleRosterFilter(); return; }
    const playerCard = target.closest('.player-card[data-player-id]');
    if (playerCard) { UI.openPlayerDetail(playerCard.dataset.playerId); return; }

    // --- League & Standings tabs ---
    const leagueTabBtn = target.closest('[data-league-tab]');
    if (leagueTabBtn) { UI.setLeagueTab(leagueTabBtn.dataset.leagueTab); return; }

    // --- Hall of Fame tabs ---
    const hofTabBtn = target.closest('[data-hof-tab]');
    if (hofTabBtn) { UI.setHofTab(hofTabBtn.dataset.hofTab); return; }

    // --- Pregame: lineup quick-swap ---
    const lineupRow = target.closest('#lineup-quick .list-row');
    if (lineupRow) {
      swapStarterWithBestBench(lineupRow.dataset.playerId);
      UI.renderPregame();
      return;
    }

    // --- Player detail overlay ---
    if (target.id === 'player-detail-close' || target.id === 'overlay-player-detail') {
      UI.closePlayerDetail();
      return;
    }
    if (target.id === 'pd-btn-meeting') { doMeeting(); return; }
    if (target.id === 'pd-btn-trade') { doTrade(); return; }
    if (target.id === 'pd-btn-bench') { doBenchToggle(); return; }

    // --- Pregame: uniform + actions ---
    const uniformBtn = target.closest('[data-uniform]');
    if (uniformBtn) {
      State.get().team.uniform = uniformBtn.dataset.uniform;
      State.save();
      UI.renderPregame();
      return;
    }
    if (target.id === 'btn-quicksim-game') { doQuickSimGame(); return; }
    if (target.id === 'btn-tipoff') { CourtEngine.start(); return; }

    // --- In-game ---
    if (target.id === 'btn-quicksim-quarter') { CourtEngine.quickSimQuarter(); return; }
    if (target.id === 'btn-exit-court') { CourtEngine.exitToMenu(); return; }
  }

  function swapStarterWithBestBench(starterId) {
    const team = State.get().team;
    const bench = team.roster.filter((p) => !team.starterIds.includes(p.id));
    const best = bench.sort((a, b) => Economy.overallOf(b) - Economy.overallOf(a))[0];
    if (!best) return;
    team.starterIds = team.starterIds.map((id) => (id === starterId ? best.id : id));
    State.save();
  }

  function doMeeting() {
    const team = State.get().team;
    const id = UI.getSelectedPlayerId();
    const p = team.roster.find((pl) => pl.id === id);
    const cost = 10;
    if (!p || team.cc < cost) { UI.toast('NOT ENOUGH CC'); return; }
    team.cc -= cost;
    p.morale = Math.min(100, p.morale + Data.randInt(10, 20));
    State.save();
    UI.openPlayerDetail(id);
    UI.renderFrontOffice();
    UI.toast(`MEETING HELD WITH ${p.name}`);
  }

  function doTrade() {
    const team = State.get().team;
    const id = UI.getSelectedPlayerId();
    const p = team.roster.find((pl) => pl.id === id);
    if (!p) return;
    const stars = Economy.starRating(p);
    const round = stars >= 4 ? 1 : stars >= 2 ? 2 : 3;
    team.draftPicks[round] = (team.draftPicks[round] || 0) + 1;
    team.roster = team.roster.filter((pl) => pl.id !== p.id);
    team.starterIds = team.starterIds.filter((sid) => sid !== p.id);
    State.save();
    UI.closePlayerDetail();
    UI.renderRoster();
    UI.toast(`TRADED ${p.name} FOR AN R${round} PICK`);
  }

  function doBenchToggle() {
    const team = State.get().team;
    const id = UI.getSelectedPlayerId();
    if (!id) return;
    if (team.starterIds.includes(id)) {
      team.starterIds = team.starterIds.filter((sid) => sid !== id);
    } else if (team.starterIds.length < Config.STARTER_COUNT) {
      team.starterIds.push(id);
    } else {
      UI.toast('BENCH A STARTER FIRST');
      return;
    }
    State.save();
    UI.openPlayerDetail(id);
    UI.renderRoster();
  }

  function doQuickSimGame() {
    const s = State.get();
    const team = s.team;
    const game = Season.getCurrentGame();
    if (!game) return;
    const diffMod = Config.DIFFICULTY_MODS[s.settings.difficulty] || 1;
    const result = Sim.simulateGame(
      Economy.teamOffenseRating(team), Economy.teamDefenseRating(team),
      40 + Math.random() * 30, 40 + Math.random() * 30,
      team.name, game.oppName, s.settings.quarterLength, diffMod,
    );
    const { won, ccAwarded } = GameFlow.finalizeGame(result.homeScore, result.awayScore);
    UI.toast(`FINAL: ${result.homeScore}-${result.awayScore} (${won ? 'W' : 'L'}) · +${ccAwarded} CC`);
    State.showView('view-main-menu');
  }

  // Exhibition games are off-the-books: simulated against a random opponent,
  // no effect on the season schedule, standings, or CC — just for fun/practice.
  function doExhibitionGame() {
    const s = State.get();
    const team = s.team;
    const opp = Data.pick(Data.OPPONENTS);
    const diffMod = Config.DIFFICULTY_MODS[s.settings.difficulty] || 1;
    const result = Sim.simulateGame(
      Economy.teamOffenseRating(team), Economy.teamDefenseRating(team),
      40 + Math.random() * 30, 40 + Math.random() * 30,
      team.name, opp.name, s.settings.quarterLength, diffMod,
    );
    const won = result.homeScore > result.awayScore;
    UI.toast(`EXHIBITION FINAL vs ${opp.abbr}: ${result.homeScore}-${result.awayScore} (${won ? 'W' : 'L'})`);
  }

  return { bind };
})();

/* ================================================================
   9. CANVAS GAMEPLAY ENGINE
   2D arcade court. State machine:
     TIPOFF -> USER_OFFENSE <-> AI_OFFENSE -> (SHOT_METER) -> RESOLVE
     -> next possession ... -> QUARTER_BREAK -> ... -> GAMEOVER
   ================================================================ */
const CourtEngine = (() => {
  let canvas, ctx;
  let bgCanvas, bgCtx; // offscreen cache for the static arena (crowd/floor/hoops) — re-rendered only on resize
  let W = 960, H = 540;
  let raf = null;
  let lastTs = 0;

  let homeTeam, oppName, diffMod, quarterSeconds;
  let runtime = null; // per-game runtime state, built in start()

  const COURT_MARGIN = 40;

  function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    bgCanvas = document.createElement('canvas');
    bgCtx = bgCanvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = canvas.width = Math.max(640, Math.floor(rect.width));
    H = canvas.height = Math.max(360, Math.floor(rect.height));
    bgCanvas.width = W;
    bgCanvas.height = H;
    renderArenaBackground();
  }

  // Formation spots: x = lateral spread (across court width H), y = depth from own
  // basket (0 = frontcourt/at the rim, 1 = backcourt/deep). Home attacks the right
  // hoop, away attacks the left hoop — see makeSquad's depth mapping below.
  const FORMATION = {
    PG: { x: 0.5, y: 0.78 }, SG: { x: 0.22, y: 0.65 }, SF: { x: 0.78, y: 0.65 },
    PF: { x: 0.32, y: 0.42 }, C: { x: 0.68, y: 0.42 },
  };

  function makeSquad(team, isHome) {
    const starters = team ? team.roster.filter((p) => team.starterIds.includes(p.id)) : null;
    return Data.POSITIONS.map((pos, i) => {
      const base = FORMATION[pos];
      const player = starters ? starters.find((p) => p.pos === pos) || starters[i] : null;
      const depthX = isHome ? (1 - base.y) * W : base.y * W;
      const lateralY = base.x * H;
      return {
        pos,
        player,
        isHome,
        x: depthX,
        y: lateralY,
        targetX: depthX,
        targetY: lateralY,
        color: isHome ? '#2f6fed' : '#ff5f4d',
      };
    });
  }

  function start() {
    const s = State.get();
    homeTeam = s.team;
    const game = Season.getCurrentGame();
    if (!game) { UI.toast('SEASON COMPLETE'); return; }
    oppName = game.isFinals ? 'Championship Opponent' : game.oppName;
    diffMod = Config.DIFFICULTY_MODS[s.settings.difficulty] || 1;
    quarterSeconds = s.settings.quarterLength * 60;

    const homeSquad = makeSquad(homeTeam, true);
    const awaySquad = makeSquad(null, false);

    runtime = {
      homeScore: 0, awayScore: 0, quarter: 1, clock: quarterSeconds,
      possession: 'home',
      homeSquad, awaySquad,
      ballHandler: homeSquad[0],
      controlledIndex: 0,
      phase: 'TIPOFF',
      phaseTimer: 1.0,
      shotMeter: { needlePos: 0, dir: 1, isThree: false },
      keys: {},
    };

    UI.clearGameLog();
    UI.pushGameLog('Tip-off!');
    UI.updatePlayerCallout(runtime.ballHandler);
    State.showView('view-game');
    resize();
    lastTs = performance.now();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function exitToMenu() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (runtime) endGame();
    State.showView('view-main-menu');
  }

  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    draw();
    if (runtime && runtime.phase !== 'GAMEOVER') raf = requestAnimationFrame(loop);
  }

  /* ---- Update ---- */
  function update(dt) {
    if (!runtime) return;
    moveFormations(dt);

    switch (runtime.phase) {
      case 'TIPOFF':
        runtime.phaseTimer -= dt;
        if (runtime.phaseTimer <= 0) setPhase(runtime.possession === 'home' ? 'USER_OFFENSE' : 'AI_OFFENSE');
        break;
      case 'USER_OFFENSE':
        runtime.clock -= dt;
        applyUserMovement(dt);
        checkQuarterClock();
        break;
      case 'AI_OFFENSE':
        runtime.clock -= dt;
        runtime.phaseTimer -= dt;
        if (runtime.phaseTimer <= 0) resolveAIPossession();
        checkQuarterClock();
        break;
      case 'SHOT_METER':
        updateShotMeter(dt);
        break;
      case 'RESOLVE':
        runtime.phaseTimer -= dt;
        if (runtime.phaseTimer <= 0) setPhase(runtime.possession === 'home' ? 'USER_OFFENSE' : 'AI_OFFENSE');
        break;
      case 'QUARTER_BREAK':
        runtime.phaseTimer -= dt;
        if (runtime.phaseTimer <= 0) startNextQuarter();
        break;
      default: break;
    }

    UI.updateGameHUD(runtime.homeScore, runtime.awayScore, Math.max(0, runtime.clock), runtime.quarter);
  }

  function checkQuarterClock() {
    if (runtime.clock <= 0) {
      runtime.clock = 0;
      if (runtime.quarter >= 4) { endGame(); return; }
      setPhase('QUARTER_BREAK');
      runtime.phaseTimer = 2.0;
    }
  }

  function startNextQuarter() {
    runtime.quarter += 1;
    runtime.clock = quarterSeconds;
    setPhase('TIPOFF');
    runtime.phaseTimer = 1.0;
    UI.pushGameLog(`Quarter ${runtime.quarter} begins.`);
  }

  function setPhase(phase) {
    runtime.phase = phase;
    if (phase === 'AI_OFFENSE') runtime.phaseTimer = 1.0 + Math.random() * 1.5;
    document.getElementById('shot-meter').classList.toggle('active', phase === 'SHOT_METER');
  }

  // Smoothly drift non-controlled players toward formation spots, offense/defense mirrored by possession.
  function moveFormations(dt) {
    const speed = 90 * dt;
    [...runtime.homeSquad, ...runtime.awaySquad].forEach((entity) => {
      const isControlled = runtime.possession === 'home' && entity.isHome && entity === runtime.ballHandler;
      if (isControlled) return;
      const base = FORMATION[entity.pos];
      const onOffense = (entity.isHome && runtime.possession === 'home') || (!entity.isHome && runtime.possession === 'away');
      const depthFrac = onOffense ? base.y : 1 - base.y * 0.6;
      const tx = entity.isHome ? (1 - depthFrac) * W : depthFrac * W;
      const ty = base.x * H;
      entity.x += (tx - entity.x) * Math.min(1, speed / 40);
      entity.y += (ty - entity.y) * Math.min(1, speed / 40);
    });
  }

  function applyUserMovement(dt) {
    const handler = runtime.ballHandler;
    if (!handler || !handler.isHome) return;
    const speed = 160 * dt;
    const k = runtime.keys;
    let dx = 0, dy = 0;
    if (k['arrowleft'] || k['a']) dx -= 1;
    if (k['arrowright'] || k['d']) dx += 1;
    if (k['arrowup'] || k['w']) dy -= 1;
    if (k['arrowdown'] || k['s']) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      handler.x = Math.min(W - COURT_MARGIN, Math.max(COURT_MARGIN, handler.x + (dx / len) * speed));
      handler.y = Math.min(H - COURT_MARGIN, Math.max(COURT_MARGIN, handler.y + (dy / len) * speed));
    }
  }

  function passToNearestTeammate() {
    if (runtime.phase !== 'USER_OFFENSE') return;
    const handler = runtime.ballHandler;
    let best = null, bestDist = Infinity;
    runtime.homeSquad.forEach((p) => {
      if (p === handler) return;
      const d = Math.hypot(p.x - handler.x, p.y - handler.y);
      if (d < bestDist) { bestDist = d; best = p; }
    });
    if (best) {
      runtime.ballHandler = best;
      UI.pushGameLog(`Pass to ${best.player ? best.player.name : best.pos}.`);
      UI.updatePlayerCallout(best);
    }
  }

  function openShotMeter() {
    if (runtime.phase !== 'USER_OFFENSE') return;
    const handler = runtime.ballHandler;
    // Home attacks the right hoop (high x), away attacks the left hoop (low x).
    const threePtLineX = handler.isHome ? W * 0.55 : W * 0.45; // rough arc threshold
    runtime.shotMeter.isThree = handler.isHome ? handler.x > threePtLineX : handler.x < threePtLineX;
    runtime.shotMeter.needlePos = 0;
    runtime.shotMeter.dir = 1;
    setPhase('SHOT_METER');
  }

  function updateShotMeter(dt) {
    const m = runtime.shotMeter;
    m.needlePos += m.dir * dt * 1.4; // full sweep ~0.7s one-way
    if (m.needlePos >= 1) { m.needlePos = 1; m.dir = -1; }
    if (m.needlePos <= 0) { m.needlePos = 0; m.dir = 1; }
    document.getElementById('shot-meter-needle').style.left = `${m.needlePos * 100}%`;
  }

  function lockShotMeter() {
    if (runtime.phase !== 'SHOT_METER') return;
    const m = runtime.shotMeter;
    // Sweet spot defined visually at 62%-80% (see .shot-meter-sweetspot in CSS).
    const sweetCenter = 0.71, sweetWidth = 0.18;
    const distFromCenter = Math.abs(m.needlePos - sweetCenter);
    const accuracy = Math.max(0, 1 - distFromCenter / (sweetWidth * 1.5));

    const shooter = runtime.ballHandler.player;
    const defenderRating = 45 + Math.random() * 20; // simplified on-ball defender strength
    const outcome = shooter
      ? Sim.resolveUserShot(shooter, defenderRating, m.isThree, accuracy)
      : Sim.resolveUserShot({ attrs: { shooting: 55, three: 45 } }, defenderRating, m.isThree, accuracy);

    if (outcome.made) {
      runtime.homeScore += outcome.points;
      UI.pushGameLog(`${shooter ? shooter.name : 'Player'} scores ${outcome.points}! (${(accuracy * 100).toFixed(0)}% timing)`);
      grantShooterXP(shooter, outcome.points);
      switchPossession();
    } else {
      const offenseRebounds = Math.random() < 0.25;
      UI.pushGameLog(`${shooter ? shooter.name : 'Player'} misses. ${offenseRebounds ? 'Offensive board!' : 'Defensive rebound.'}`);
      if (!offenseRebounds) switchPossession();
    }
    setPhase('RESOLVE');
    runtime.phaseTimer = 0.8;
  }

  function grantShooterXP(shooter, points) {
    if (!shooter) return;
    shooter.stats.points += points;
    shooter.stats.games = shooter.stats.games || 0;
    Economy.grantXP(shooter, points, homeTeam);
  }

  function switchPossession() {
    runtime.possession = runtime.possession === 'home' ? 'away' : 'home';
    runtime.ballHandler = runtime.possession === 'home' ? runtime.homeSquad[0] : runtime.awaySquad[0];
    UI.updatePlayerCallout(runtime.ballHandler);
  }

  // AI possessions (opponent has the ball) auto-resolve via the shared text-sim engine.
  function resolveAIPossession() {
    const offRating = 40 + Math.random() * 35;
    const defRating = Economy.teamDefenseRating(homeTeam);
    const outcome = Sim.simulatePossession(offRating, defRating, oppName, homeTeam.name, diffMod);
    UI.pushGameLog(outcome.log);
    if (outcome.scored) {
      runtime.awayScore += outcome.points;
      switchPossession();
    } else if (outcome.turnover) {
      switchPossession();
    } else if (outcome.reboundBy === 'defense') {
      switchPossession();
    } else {
      runtime.phaseTimer = 1.0; // offensive rebound, AI keeps possession briefly
    }
    if (runtime.possession === 'home') setPhase('USER_OFFENSE');
    else setPhase('AI_OFFENSE');
  }

  // Fast-forwards the remainder of the current quarter via the text sim engine.
  function quickSimQuarter() {
    if (!runtime || runtime.phase === 'GAMEOVER') return;
    const homeOff = Economy.teamOffenseRating(homeTeam);
    const homeDef = Economy.teamDefenseRating(homeTeam);
    let elapsed = 0;
    const remaining = Math.max(0, runtime.clock);
    while (elapsed < remaining) {
      const offRating = runtime.possession === 'home' ? homeOff : 40 + Math.random() * 35;
      const defRating = runtime.possession === 'home' ? (40 + Math.random() * 35) : homeDef;
      const offName = runtime.possession === 'home' ? homeTeam.name : oppName;
      const defName = runtime.possession === 'home' ? oppName : homeTeam.name;
      const outcome = Sim.simulatePossession(offRating, defRating, offName, defName, diffMod);
      if (outcome.scored) {
        if (runtime.possession === 'home') runtime.homeScore += outcome.points; else runtime.awayScore += outcome.points;
        switchPossession();
      } else if (outcome.turnover) {
        switchPossession();
      } else if (outcome.reboundBy === 'defense') {
        switchPossession();
      }
      UI.pushGameLog(outcome.log);
      elapsed += 16 + Math.random() * 6;
    }
    runtime.clock = 0;
    if (runtime.quarter >= 4) { endGame(); return; }
    setPhase('QUARTER_BREAK');
    runtime.phaseTimer = 1.5;
  }

  function endGame() {
    if (!runtime || runtime.phase === 'GAMEOVER') return;
    runtime.phase = 'GAMEOVER';
    const { won, ccAwarded } = GameFlow.finalizeGame(runtime.homeScore, runtime.awayScore);
    UI.pushGameLog(`FINAL: ${runtime.homeScore}-${runtime.awayScore}`);
    UI.toast(`${won ? 'WIN' : 'LOSS'} ${runtime.homeScore}-${runtime.awayScore} · +${ccAwarded} CC`);
    setTimeout(() => State.showView('view-main-menu'), 1600);
  }

  /* ---- Draw ----
     The arena (crowd, wood floor, paint, hoops) never changes shape between
     frames, so it's rendered once into bgCanvas (on init/resize) and just
     blitted here. Only players/ball/labels are redrawn every frame. */
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgCanvas, 0, 0);
    if (!runtime) return;
    drawSquad(runtime.awaySquad);
    drawSquad(runtime.homeSquad);
    drawBall();
    drawActionLabels();
  }

  function renderArenaBackground() {
    if (!bgCtx) return;
    const g = bgCtx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#181024';
    g.fillRect(0, 0, W, H);
    drawCrowdDots(g);

    const fx = COURT_MARGIN, fy = COURT_MARGIN, fw = W - COURT_MARGIN * 2, fh = H - COURT_MARGIN * 2;
    drawFloor(g, fx, fy, fw, fh);
    drawCenterLogo(g, fx, fy, fw, fh);

    g.strokeStyle = '#f4e3c1';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(W / 2, fy);
    g.lineTo(W / 2, fy + fh);
    g.stroke();
    g.beginPath();
    g.arc(W / 2, H / 2, 40, 0, Math.PI * 2);
    g.stroke();
    g.strokeRect(fx, fy, fw, fh);

    [0, 1].forEach((end) => drawHoopEnd(g, end));
  }

  // Deterministic pseudo-random crowd dot pattern — same seed every render, so it
  // doesn't shimmer/flicker when re-rendered (e.g. on resize).
  function drawCrowdDots(g) {
    const colors = ['#ff5f4d', '#ffcc33', '#2f6fed', '#5fd97a', '#c95fff', '#f4e3c1'];
    let seed = 7;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const gap = 7, size = 4;
    for (let y = 2; y < H; y += gap) {
      for (let x = 2; x < W; x += gap) {
        if (rand() < 0.5) {
          g.fillStyle = colors[Math.floor(rand() * colors.length)];
          g.fillRect(x, y, size, size);
        }
      }
    }
  }

  function drawFloor(g, fx, fy, fw, fh) {
    g.fillStyle = '#c89a5c';
    g.fillRect(fx, fy, fw, fh);
    const plank = 18;
    let row = 0;
    for (let y = fy; y < fy + fh; y += plank) {
      const h = Math.min(plank, fy + fh - y);
      if (row % 2 === 1) {
        g.fillStyle = 'rgba(150,105,55,0.28)';
        g.fillRect(fx, y, fw, h);
      }
      g.strokeStyle = 'rgba(90,58,20,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fx, y);
      g.lineTo(fx + fw, y);
      g.stroke();
      row++;
    }
  }

  function drawCenterLogo(g, fx, fy, fw, fh) {
    g.save();
    g.globalAlpha = 0.25;
    g.fillStyle = '#2f6fed';
    g.beginPath();
    g.arc(fx + fw / 2, fy + fh / 2, 58, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.55;
    g.fillStyle = '#f4e3c1';
    g.font = 'bold 36px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('RH', fx + fw / 2, fy + fh / 2 + 2);
    g.restore();
  }

  // end 0 = left hoop (away attacks this one), end 1 = right hoop (home attacks this one).
  function drawHoopEnd(g, end) {
    const hoopX = end === 0 ? COURT_MARGIN : W - COURT_MARGIN;
    const dir = end === 0 ? 1 : -1; // points from the hoop into the court
    const paintW = 110, paintH = 140;
    const paintX = end === 0 ? COURT_MARGIN : W - COURT_MARGIN - paintW;
    const paintY = H / 2 - paintH / 2;

    g.fillStyle = 'rgba(120,70,200,0.3)';
    g.fillRect(paintX, paintY, paintW, paintH);
    g.strokeStyle = '#f4e3c1';
    g.lineWidth = 3;
    g.strokeRect(paintX, paintY, paintW, paintH);

    g.beginPath();
    g.arc(hoopX, H / 2, 110, end === 0 ? -Math.PI / 2 : Math.PI / 2, end === 0 ? Math.PI / 2 : Math.PI * 1.5);
    g.stroke();

    const backboardX = end === 0 ? COURT_MARGIN - 8 : W - COURT_MARGIN + 8;
    g.fillStyle = '#e8e8e8';
    g.fillRect(backboardX - 3, H / 2 - 26, 6, 52);
    g.strokeStyle = '#333';
    g.lineWidth = 1;
    g.strokeRect(backboardX - 3, H / 2 - 26, 6, 52);

    const rimX = hoopX + dir * 14;
    g.fillStyle = '#ff5f4d';
    g.beginPath();
    g.arc(rimX, H / 2, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,95,77,0.6)';
    g.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(rimX, H / 2 + i * 5);
      g.lineTo(rimX + dir * 12, H / 2 + i * 3);
      g.stroke();
    }
  }

  function drawSquad(squad) {
    squad.forEach((entity) => drawPlayerSprite(entity));
  }

  // Chunky multi-block sprite (shadow + shorts + jersey + head) instead of a
  // flat circle, plus a highlight ring on whoever currently has the ball.
  function drawPlayerSprite(entity) {
    const { x, y, color } = entity;
    const isBall = entity === runtime.ballHandler;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shadeColor(color, -40);
    ctx.fillRect(x - 6, y + 2, 12, 8);

    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y - 9, 16, 11);

    ctx.fillStyle = '#e3ab7a';
    ctx.beginPath();
    ctx.arc(x, y - 14, 6, 0, Math.PI * 2);
    ctx.fill();

    if (isBall) {
      ctx.strokeStyle = '#ffcc33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(entity.pos, x, y - 2);
  }

  function shadeColor(hex, amt) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + amt, gC = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); gC = Math.max(0, Math.min(255, gC)); b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${gC},${b})`;
  }

  function drawBall() {
    const handler = runtime.ballHandler;
    if (!handler) return;
    const bob = Math.sin(performance.now() / 150) * 2;
    ctx.beginPath();
    ctx.arc(handler.x + 14, handler.y - 6 + bob, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#e8772e';
    ctx.fill();
    ctx.strokeStyle = '#8a3d10';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Hoop Land-style floating contextual labels: "STEAL" when a defender is
  // crowding the ball handler, "OPEN" for an unguarded teammate.
  function drawActionLabels() {
    if (runtime.phase !== 'USER_OFFENSE') return;
    const handler = runtime.ballHandler;
    if (!handler) return;
    const defenders = handler.isHome ? runtime.awaySquad : runtime.homeSquad;
    let nearestDef = null, nearestDefDist = Infinity;
    defenders.forEach((d) => {
      const dist = Math.hypot(d.x - handler.x, d.y - handler.y);
      if (dist < nearestDefDist) { nearestDefDist = dist; nearestDef = d; }
    });
    if (nearestDef && nearestDefDist < 55) {
      drawFloatingLabel(nearestDef.x, nearestDef.y - 28, 'STEAL!', '#ff5f4d');
    }

    const teammates = handler.isHome ? runtime.homeSquad : runtime.awaySquad;
    teammates.forEach((t) => {
      if (t === handler) return;
      const closestDef = defenders.reduce((best, d) => Math.min(best, Math.hypot(d.x - t.x, d.y - t.y)), Infinity);
      if (closestDef > 90) drawFloatingLabel(t.x, t.y - 28, 'OPEN', '#45d483');
    });
  }

  function drawFloatingLabel(x, y, text, color) {
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2, y - 12, w, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  return { init, start, exitToMenu, quickSimQuarter, passToNearestTeammate, openShotMeter, lockShotMeter, getRuntime: () => runtime, setKey: (k, v) => { if (runtime) runtime.keys[k] = v; } };
})();

/* ================================================================
   10. INPUT LISTENERS — keyboard only, scoped to the active game view
   ================================================================ */
const Input = (() => {
  function bind() {
    window.addEventListener('keydown', (e) => {
      if (State.getCurrentView() !== 'view-game') return;
      const key = e.key.toLowerCase();
      CourtEngine.setKey(key, true);
      if (key === 'x') CourtEngine.passToNearestTeammate();
      if (key === 'z' || key === ' ') {
        e.preventDefault();
        const runtime = CourtEngine.getRuntime();
        if (runtime && runtime.phase === 'USER_OFFENSE') CourtEngine.openShotMeter();
        else if (runtime && runtime.phase === 'SHOT_METER') CourtEngine.lockShotMeter();
      }
    });
    window.addEventListener('keyup', (e) => {
      CourtEngine.setKey(e.key.toLowerCase(), false);
    });
  }
  return { bind };
})();

/* ================================================================
   11. BOOTSTRAP
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  if (!State.load()) State.newGame();
  CourtEngine.init();
  Events.bind();
  Input.bind();
  State.showView('view-main-menu');
});
