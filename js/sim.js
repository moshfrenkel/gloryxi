/**
 * sim.js — GloryXI simulation engine (V4: positional weights + real 2026 bracket)
 * Pure functions, ES module, no DOM, no JSON imports at module load.
 *
 * Public API:
 *   computeTeamScores(xi)               → line scores + weak-line gate
 *   computeTeamElo(xi)                  → number
 *   simulateMatch(eloA, eloB, playersA) → group match
 *   simulateKnockout(eloA, eloB, playersA) → with a.e.t./pens
 *   simulateTournament(xi, field2026)   → journey (all 12 groups simulated, official bracket)
 *   selftest(n)                         → calibration table
 */

// Recalibrated 2026-06-11 (difficulty pass, Mosh option B): a championship
// should be an event, not a routine. Targets vs the REAL 2026 field:
// savvy XI (legend95+avg75) ≈ 8-10% champion, uniform85 ≈ 18-20%,
// casual (legend95+avg65) ≈ 1%, uniform60 ≈ 0.2%.
// Previous values (1150 / 12) made avg75 = Argentina-level → 27% champion.
const ELO_BASE  = 1213;
const ELO_SCALE = 10;
const EXP_COEF  = 0.50;

// ─── 2.1 Team scores ──────────────────────────────────────────────────────────
// Positional importance in 4-4-2, grounded in plus-minus rating literature
// (Kharrat/McHale/Peña), market-value-by-position data (CIES/Transfermarkt) and
// goals-prevented analysis (Anderson & Sally): the spine (ST > CM > CB) carries
// more outcome variance than wide slots; GK has a high ceiling but is one slot.
const SLOT_TYPE   = { GK: 'GK', RB: 'FB', LB: 'FB', CB1: 'CB', CB2: 'CB', CM1: 'CM', CM2: 'CM', RM: 'WM', LM: 'WM', ST1: 'ST', ST2: 'ST' };
const SLOT_WEIGHT = { GK: 1.00, FB: 0.85, CB: 1.05, CM: 1.10, WM: 0.85, ST: 1.15 };
const CONTRIB = {
  GK: { d: 1.00, m: 0.00, a: 0.00 },
  CB: { d: 0.90, m: 0.10, a: 0.00 },
  FB: { d: 0.70, m: 0.25, a: 0.05 },
  CM: { d: 0.25, m: 0.60, a: 0.15 },
  WM: { d: 0.15, m: 0.55, a: 0.30 },
  ST: { d: 0.05, m: 0.15, a: 0.80 },
};

// ─── Assist sampling (cosmetic attribution only — never touches scores) ─────────
// The creative ('a') component lifted straight from CONTRIB, reused as the
// assister-draw weight by slot type: {GK:0,CB:0,FB:0.05,CM:0.15,WM:0.30,ST:0.80}.
const ASSIST_PROB = 0.75;
const ASSIST_EPS  = 0.02;
const ASSIST_WEIGHT = Object.fromEntries(Object.entries(CONTRIB).map(([k, v]) => [k, v.a]));
// Out-of-position retention: share of rating kept when a player's natural role
// group differs from the slot's role group. GK is unique in both directions;
// adjacent roles transfer best (DF↔MF, MF→FW).
const OOP_RETENTION = {
  GK: { GK: 1.00, DF: 0.50, MF: 0.40, FW: 0.35 },
  DF: { GK: 0.35, DF: 1.00, MF: 0.78, FW: 0.60 },
  MF: { GK: 0.30, DF: 0.80, MF: 1.00, FW: 0.82 },
  FW: { GK: 0.25, DF: 0.50, MF: 0.75, FW: 1.00 },
};
// Within-group refinement when the player's real positions (sp, e.g. "RB/CB"
// from per-match data / Wikidata) are known: exact slot keeps 100%, the
// mirrored flank (RB↔LB, RM↔LM) keeps 92%, any other in-group slot 88%.
const SLOT_TOKEN = { GK: 'GK', RB: 'RB', LB: 'LB', CB1: 'CB', CB2: 'CB', CM1: 'CM', CM2: 'CM', RM: 'RM', LM: 'LM', ST1: 'ST', ST2: 'ST' };
const MIRROR_TOKEN = { RB: 'LB', LB: 'RB', RM: 'LM', LM: 'RM' };

export function computeTeamScores(xi) {
  // Slot values may be plain ratings or player objects {n, p, r}
  const acc = { d: { n: 0, w: 0 }, m: { n: 0, w: 0 }, a: { n: 0, w: 0 } };
  let effSum = 0;
  for (const slot of ['GK','RB','CB1','CB2','LB','CM1','CM2','RM','LM','ST1','ST2']) {
    const v = xi[slot];
    const slotGroup = _slotToPos(slot);
    const r = typeof v === 'number' ? v
      : (v && typeof v === 'object' && typeof v.r === 'number') ? v.r
      : 50;
    const natural = (v && typeof v === 'object' && v.p) ? v.p : slotGroup;
    let retention = (OOP_RETENTION[natural] || OOP_RETENTION.MF)[slotGroup] || 1;
    const spRaw = (v && typeof v === 'object') ? v.sp : null;
    const sp = typeof spRaw === 'string' ? spRaw.split('/') : Array.isArray(spRaw) ? spRaw : null;
    if (sp && sp.length) {
      const token = SLOT_TOKEN[slot];
      if (sp.includes(token)) retention = Math.max(retention, 1);
      else if (natural === slotGroup) {
        retention = (MIRROR_TOKEN[token] && sp.includes(MIRROR_TOKEN[token])) ? 0.92 : 0.88;
      }
    }
    const eff = r * retention;
    effSum += eff;

    const t = SLOT_TYPE[slot];
    const w = SLOT_WEIGHT[t];
    const c = CONTRIB[t];
    acc.d.n += w * c.d * eff; acc.d.w += w * c.d;
    acc.m.n += w * c.m * eff; acc.m.w += w * c.m;
    acc.a.n += w * c.a * eff; acc.a.w += w * c.a;
  }
  const defense  = acc.d.n / acc.d.w;
  const midfield = acc.m.n / acc.m.w;
  const attack   = acc.a.n / acc.a.w;

  // Weakest-link gate (Anderson & Sally: upgrading the worst line moves
  // results more than upgrading the best one).
  const gate = Math.min(defense, midfield, attack);
  const defenseEff  = 0.75 * defense  + 0.25 * gate;
  const midfieldEff = 0.75 * midfield + 0.25 * gate;
  const attackEff   = 0.75 * attack   + 0.25 * gate;
  const avgRating = effSum / 11;

  return { defense, midfield, attack, defenseEff, midfieldEff, attackEff, avgRating };
}

export function computeTeamElo(xi) {
  const { attackEff, defenseEff, midfieldEff } = computeTeamScores(xi);
  return ELO_BASE + ELO_SCALE * (0.40 * attackEff + 0.35 * defenseEff + 0.25 * midfieldEff);
}

// ─── Poisson ──────────────────────────────────────────────────────────────────
function poissonSample(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function expGoals(d) {
  return Math.min(Math.max(1.35 * Math.pow(10, EXP_COEF * d), 0.2), 4.5);
}

// ─── 2.3 Matches ──────────────────────────────────────────────────────────────
const POS_GOAL_WEIGHT = { GK: 0.05, DF: 0.7, MF: 2.5, FW: 5 };

// ─── Personal goal-tendency multiplier (empirical-Bayes shrinkage) ──────────────
// Nudges a player's scorer-draw weight up/down by their historical goals-per-cap
// RELATIVE to a position baseline, with heavy Bayesian shrinkage so tiny 3-7 game
// samples cannot dominate. Lives ONLY inside the _sampleScorers weights array, so
// it changes only WHO scores among an XI — never how many goals, never the score.
// Uniform/selftest XIs carry no g/caps (g=0,caps=0 → posterior==prior → 1.0 exactly),
// so calibration bands are mathematically untouched.
const TEND_PRIOR_GPC = { FW: 0.262, MF: 0.082, DF: 0.030 }; // pooled goals/cap (caps>=1)
const TEND_K = { FW: 8, MF: 12, DF: 20 };                   // position-specific prior strength
const TEND_SENS = 0.55, TEND_MIN = 0.75, TEND_MAX = 1.70;
const AW_BOOST = { GoldenBoot: 0.18, GoldenBall: 0.10 };    // GoldenGlove intentionally ignored
// For 2026 squads (caps=0, g = CAREER goals on a different scale): boost players who
// have actually scored, vs the per-position median career-goal count (from players.json).
const CAREER_GOAL_MED = { FW: 5, MF: 2, DF: 1 };
const CAREER_SMOOTH = 2, CAREER_SENS = 0.32;

function _goalTendency(p) {
  const pos = p.p;
  const prior = TEND_PRIOR_GPC[pos];
  if (pos === 'GK' || !prior) return 1;
  const g = p.g || 0, c = p.caps || 0;
  // No tournament appearances (caps=0): 2026 squads + uniform/selftest XIs. Here g is
  // CAREER goals, so boost players who actually score vs the position's career median.
  // g=0 (incl. every uniform/selftest player) stays EXACTLY neutral → result bands untouched.
  if (c === 0) {
    const med = CAREER_GOAL_MED[pos];
    if (g === 0 || !med) return 1;
    return Math.min(Math.max(Math.pow((g + CAREER_SMOOTH) / (med + CAREER_SMOOTH), CAREER_SENS), TEND_MIN), TEND_MAX);
  }
  const k = TEND_K[pos];
  const post = (g + k * prior) / (c + k);
  let mul = Math.pow(post / prior, TEND_SENS);
  let aw = 0;
  for (const a of (p.aw || [])) aw += (AW_BOOST[a] || 0);
  mul *= (1 + aw);
  return Math.min(Math.max(mul, TEND_MIN), TEND_MAX);
}

export function simulateMatch(eloA, eloB, playersA, playersB) {
  const d = (eloA - eloB) / 400;
  const scoreA = poissonSample(expGoals(d));
  const scoreB = poissonSample(expGoals(-d));
  const scorers = [];
  const scorersB = [];
  if (playersA && playersA.length > 0) _sampleScorers(scoreA, playersA, scorers, 90);
  if (playersB && playersB.length > 0) _sampleScorers(scoreB, playersB, scorersB, 90);
  return { scoreA, scoreB, scorers, scorersB, note: '', winnerIsA: scoreA > scoreB };
}

export function simulateKnockout(eloA, eloB, playersA, playersB) {
  const d = (eloA - eloB) / 400;
  let scoreA = poissonSample(expGoals(d));
  let scoreB = poissonSample(expGoals(-d));
  let note = '';
  const scorers = [];
  const scorersB = [];
  if (playersA && playersA.length > 0) _sampleScorers(scoreA, playersA, scorers, 90);
  if (playersB && playersB.length > 0) _sampleScorers(scoreB, playersB, scorersB, 90);

  if (scoreA === scoreB) {
    const etA = poissonSample(expGoals(d) * 0.33);
    const etB = poissonSample(expGoals(-d) * 0.33);
    scoreA += etA; scoreB += etB;
    if (playersA && playersA.length > 0 && etA > 0) _sampleScorers(etA, playersA, scorers, 120);
    if (playersB && playersB.length > 0 && etB > 0) _sampleScorers(etB, playersB, scorersB, 120);
    if (scoreA === scoreB) {
      const penWinProbA = Math.min(Math.max(0.5 + d * 0.35, 0.25), 0.75);
      const winnerIsA = Math.random() < penWinProbA;
      // loser must always score fewer than the winner — a drawn shootout is impossible
      const winPens = Math.random() < 0.5 ? 5 : 4;
      const losePens = winPens - (Math.random() < 0.5 ? 1 : 2);
      const penA = winnerIsA ? winPens : losePens;
      const penB = winnerIsA ? losePens : winPens;
      return { scoreA, scoreB, scorers, scorersB, note: `(pens ${penA}-${penB})`, winnerIsA };
    }
    note = '(a.e.t.)';
  }
  return { scoreA, scoreB, scorers, scorersB, note, winnerIsA: scoreA > scoreB };
}

function _sampleScorers(numGoals, players, scorers, maxMinute) {
  const weights = players.map(p => {
    const posKey = p.p === 'GK' ? 'GK' : p.p === 'DF' ? 'DF' : p.p === 'FW' ? 'FW' : 'MF';
    return (p.r || 50) * (POS_GOAL_WEIGHT[posKey] || 1) * _goalTendency(p);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  for (let g = 0; g < numGoals; g++) {
    let rnd = Math.random() * totalWeight;
    let scorerIndex = players.length - 1;
    let scorer = players[scorerIndex];
    for (let i = 0; i < players.length; i++) {
      rnd -= weights[i];
      if (rnd <= 0) { scorer = players[i]; scorerIndex = i; break; }
    }

    // Cosmetic assist draw: a second weighted pick from the SAME XI, excluding
    // the scorer, weighted by each slot's creative ('a') contribution + EPS.
    // ~75% of goals get an assist; the rest are solo / rebounds / penalties.
    let assist = null, assistSlot = null;
    if (Math.random() < ASSIST_PROB) {
      let tot = 0;
      for (let k = 0; k < players.length; k++) {
        if (k === scorerIndex) continue;
        const tp = SLOT_TYPE[players[k].slot] || 'CM';
        tot += (players[k].r || 50) * ((ASSIST_WEIGHT[tp] || 0) + ASSIST_EPS);
      }
      if (tot > 0) {
        let r2 = Math.random() * tot;
        for (let k = 0; k < players.length; k++) {
          if (k === scorerIndex) continue;
          const tp = SLOT_TYPE[players[k].slot] || 'CM';
          r2 -= (players[k].r || 50) * ((ASSIST_WEIGHT[tp] || 0) + ASSIST_EPS);
          if (r2 <= 0) { assist = players[k].n || players[k].name || null; assistSlot = players[k].slot; break; }
        }
      }
    }

    scorers.push({ name: scorer.n || scorer.name || '?', minute: 1 + Math.floor(Math.random() * maxMinute), p: scorer.p, slot: scorer.slot, assist, assistSlot });
  }
  scorers.sort((a, b) => a.minute - b.minute);
}

// ─── 2.4 Official 2026 bracket ────────────────────────────────────────────────
// Verified 2026-06-11 against two independent sources (Wikipedia "2026 FIFA
// World Cup knockout stage" + Sky Sports full 104-match schedule). Slots:
// '1A' = Group A winner, '2A' = runner-up, '3:ABCDF' = best-third slot whose
// allowed groups are A/B/C/D/F.
const BRACKET_R32 = [
  { m: 73, a: '2A', b: '2B' },
  { m: 74, a: '1E', b: '3:ABCDF' },
  { m: 75, a: '1F', b: '2C' },
  { m: 76, a: '1C', b: '2F' },
  { m: 77, a: '1I', b: '3:CDFGH' },
  { m: 78, a: '2E', b: '2I' },
  { m: 79, a: '1A', b: '3:CEFHI' },
  { m: 80, a: '1L', b: '3:EHIJK' },
  { m: 81, a: '1D', b: '3:BEFIJ' },
  { m: 82, a: '1G', b: '3:AEHIJ' },
  { m: 83, a: '2K', b: '2L' },
  { m: 84, a: '1H', b: '2J' },
  { m: 85, a: '1B', b: '3:EFGIJ' },
  { m: 86, a: '1J', b: '2H' },
  { m: 87, a: '1K', b: '3:DEIJL' },
  { m: 88, a: '2D', b: '2G' },
];
const BRACKET_LATER = [
  { m: 89,  a: 74, b: 77, stage: 'R16' },
  { m: 90,  a: 73, b: 75, stage: 'R16' },
  { m: 91,  a: 76, b: 78, stage: 'R16' },
  { m: 92,  a: 79, b: 80, stage: 'R16' },
  { m: 93,  a: 83, b: 84, stage: 'R16' },
  { m: 94,  a: 81, b: 82, stage: 'R16' },
  { m: 95,  a: 86, b: 88, stage: 'R16' },
  { m: 96,  a: 85, b: 87, stage: 'R16' },
  { m: 97,  a: 89, b: 90, stage: 'QF' },
  { m: 98,  a: 93, b: 94, stage: 'QF' },
  { m: 99,  a: 91, b: 92, stage: 'QF' },
  { m: 100, a: 95, b: 96, stage: 'QF' },
  { m: 101, a: 97, b: 98, stage: 'SF' },
  { m: 102, a: 99, b: 100, stage: 'SF' },
  { m: 104, a: 101, b: 102, stage: 'F' },
];

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Assign the 8 qualified third-place groups to the 8 third-slots, honouring
// each slot's allowed-groups set (backtracking; FIFA's sets are built so a
// valid assignment exists for every qualifying combination).
function _allocateThirds(qualifiedGroups) {
  const slots = BRACKET_R32
    .filter(x => x.b.startsWith('3:'))
    .map(x => ({ m: x.m, allowed: x.b.slice(2) }));
  slots.sort((x, y) =>
    [...x.allowed].filter(g => qualifiedGroups.includes(g)).length -
    [...y.allowed].filter(g => qualifiedGroups.includes(g)).length);

  const assigned = new Map();
  const used = new Set();
  const bt = (i) => {
    if (i === slots.length) return true;
    const opts = _shuffle(qualifiedGroups.filter(g => slots[i].allowed.includes(g) && !used.has(g)));
    for (const g of opts) {
      used.add(g); assigned.set(slots[i].m, g);
      if (bt(i + 1)) return true;
      used.delete(g); assigned.delete(slots[i].m);
    }
    return false;
  };
  if (!bt(0)) {
    assigned.clear(); used.clear();
    for (const s of slots) {
      const g = qualifiedGroups.find(x => !used.has(x) && s.allowed.includes(x))
             || qualifiedGroups.find(x => !used.has(x));
      used.add(g); assigned.set(s.m, g);
    }
  }
  return assigned; // matchNumber -> group letter
}

// ─── 2.5 Tournament (V4: all 12 groups simulated, official knockout bracket) ──
export function simulateTournament(xi, field2026, squads) {
  const normXi  = _normaliseXi(xi);
  const players = _xiToPlayers(normXi);
  const userElo = computeTeamElo(normXi);

  // Insert user into a real 2026 group, replacing a bottom-half team
  const { groups, groupKey, replaced } = _placeUser(field2026);
  const getElo = t => t === 'USER_XI' ? userElo : (field2026.strengths[t] || 1700);

  // Memoised opponent-XI cache. When squads is undefined (e.g. selftest), this is
  // null for every opponent and the whole opponent-scorers feature is inert →
  // _sampleScorers for B never runs → RNG stream + bands identical to today.
  const _oppXiCache = new Map();
  const oppPlayers = team => {
    if (team === 'USER_XI') return players;
    if (!squads || !squads[team]) return null;
    if (!_oppXiCache.has(team)) _oppXiCache.set(team, buildOpponentXi(squads[team]));
    return _oppXiCache.get(team);
  };
  const oppXiObject = team => {
    if (!squads || !squads[team]) return null;
    return buildOpponentXiObject(squads[team]);
  };

  const journey = [];
  const record  = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };

  // Tournament-wide scorer/assist tally across ALL matches & teams (Golden Boot /
  // Playmaker). Inert without squads (selftest): opponent scorer lists are empty,
  // so nothing accumulates and behaviour is unchanged.
  const tally = {};
  const _bump = (name, team, key) => {
    const k = name + '|' + team;
    (tally[k] || (tally[k] = { name, team, goals: 0, assists: 0 }))[key]++;
  };
  const _tallyGoals = (list, team) => {
    for (const s of (list || [])) {
      _bump(s.name, team, 'goals');
      if (s.assist) _bump(s.assist, team, 'assists');
    }
  };

  // Full round-robin in ALL groups — the rest of the field is real, so the
  // bracket the user walks into is the one the actual results produce.
  const tables = {};
  for (const [key, members] of Object.entries(groups)) {
    const table = {};
    for (const t of members) table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };

    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const A = members[i], B = members[j];
      const userIsA = A === 'USER_XI', userIsB = B === 'USER_XI';
      // playersA is always the side credited as scoreA; pass user XI for the user's
      // own goals and the opponent's XI (if available) for the opponent's goals.
      const oppTeam = userIsA ? B : userIsB ? A : null;
      // sample scorers for BOTH sides of EVERY match → tournament-wide tables
      const playersA = A === 'USER_XI' ? players : oppPlayers(A);
      const playersB = B === 'USER_XI' ? players : oppPlayers(B);
      const m = simulateMatch(getElo(A), getElo(B), playersA, playersB);
      _applyResult(table[A], table[B], m.scoreA, m.scoreB);
      _tallyGoals(m.scorers, A);
      _tallyGoals(m.scorersB, B);

      if (userIsA || userIsB) {
        const sf = userIsA ? m.scoreA : m.scoreB;
        const sa = userIsA ? m.scoreB : m.scoreA;
        const opp = oppTeam;
        record.gf += sf; record.ga += sa;
        if (sf > sa) record.w++; else if (sf === sa) record.d++; else record.l++;
        // User scorers are always whichever side the user was on; opponent scorers
        // are the other side. simulateMatch already sampled both correctly.
        const scorers = userIsA ? m.scorers : m.scorersB;
        const opponentScorers = (userIsA ? m.scorersB : m.scorers) || [];
        const entry = { stage: 'GROUP', opponent: opp, scoreFor: sf, scoreAgainst: sa, scorers, opponentScorers, note: '' };
        const oppXi = oppXiObject(opp);
        if (oppXi) entry.opponentXi = oppXi;
        journey.push(entry);
      }
    }
    tables[key] = Object.values(table).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || Math.random() - 0.5);
  }

  const rows = tables[groupKey];
  const rank = rows.findIndex(r => r.team === 'USER_XI') + 1;
  const groupTable = rows.map(r => ({ ...r }));
  const base = { groupKey, replaced, rank, groupTable };
  // tournament Golden Boot / Playmaker — full ranked tally (sliced to 10 for display)
  const _ranked = (key) => Object.values(tally).filter(x => x[key] > 0)
    .sort((a, b) => b[key] - a[key] || (b.goals + b.assists) - (a.goals + a.assists));
  // best-placed player from YOUR XI in the FULL tournament ranking (name + count + rank)
  const _myBest = (list, key) => {
    const i = list.findIndex(s => s.team === 'USER_XI');
    return i < 0 ? null : { name: list[i].name, n: list[i][key], rank: i + 1 };
  };
  const finish = (extra) => {
    const sc = _ranked('goals'), as = _ranked('assists');
    return {
      journey, record, ...base, ...extra,
      topScorers: sc.slice(0, 10), topAssisters: as.slice(0, 10),
      myBestScorer: _myBest(sc, 'goals'), myBestAssister: _myBest(as, 'assists'),
    };
  };

  // 2026 format: top-2 advance + the 8 best thirds of 12 (real comparison)
  const thirds = Object.entries(tables)
    .map(([g, rws]) => ({ g, ...rws[2] }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || Math.random() - 0.5);
  const qualifiedThirds = thirds.slice(0, 8);
  const qualifiedThirdGroups = qualifiedThirds.map(t => t.g);

  const advanced = rank <= 2 || (rank === 3 && qualifiedThirdGroups.includes(groupKey));
  if (!advanced) return finish({ finalStage: 'GROUP_EXIT' });

  // Seed map + third-slot allocation
  const seed = {};
  for (const [g, rws] of Object.entries(tables)) {
    seed['1' + g] = rws[0].team;
    seed['2' + g] = rws[1].team;
  }
  const thirdAlloc = _allocateThirds(qualifiedThirdGroups); // match -> group letter

  // Play the official bracket. Every match is fully sampled so the scorer tables
  // span all teams; once the user is out we keep simulating the rest (only when
  // squads exist — selftest takes the fast early-exit to stay cheap). Calibration is
  // distribution-equivalent (not RNG-bit-identical): scorer/assist sampling shifts
  // the random stream but never feeds expGoals/poisson, so match results are unchanged.
  const winners = {};
  let userFinalStage = null;
  const playKnockout = (mnum, teamA, teamB, stage) => {
    const userInA = teamA === 'USER_XI', userInB = teamB === 'USER_XI';
    if (userInA || userInB) {
      const opp = userInA ? teamB : teamA;
      // user always modelled as side A (userElo vs opp) — preserves calibration
      const m = simulateKnockout(userElo, getElo(opp), players, oppPlayers(opp));
      _tallyGoals(m.scorers, 'USER_XI');
      _tallyGoals(m.scorersB, opp);
      record.gf += m.scoreA; record.ga += m.scoreB;
      if (m.winnerIsA) record.w++;
      else if (m.note.startsWith('(pens')) record.d++;
      else record.l++;
      const entry = {
        stage, opponent: opp,
        scoreFor: m.scoreA, scoreAgainst: m.scoreB,
        scorers: m.scorers, opponentScorers: m.scorersB || [],
        note: m.note, winnerIsA: m.winnerIsA,
      };
      const oppXi = oppXiObject(opp);
      if (oppXi) entry.opponentXi = oppXi;
      journey.push(entry);
      winners[mnum] = m.winnerIsA ? 'USER_XI' : opp;
      if (!m.winnerIsA && userFinalStage === null) userFinalStage = stage;
      return;
    }
    const m = simulateKnockout(getElo(teamA), getElo(teamB), oppPlayers(teamA), oppPlayers(teamB));
    _tallyGoals(m.scorers, teamA);
    _tallyGoals(m.scorersB, teamB);
    winners[mnum] = m.winnerIsA ? teamA : teamB;
  };

  for (const x of BRACKET_R32) {
    const teamA = seed[x.a];
    const teamB = x.b.startsWith('3:')
      ? tables[thirdAlloc.get(x.m)][2].team
      : seed[x.b];
    playKnockout(x.m, teamA, teamB, 'R32');
    if (userFinalStage && !squads) return finish({ finalStage: userFinalStage });
  }
  for (const x of BRACKET_LATER) {
    playKnockout(x.m, winners[x.a], winners[x.b], x.stage);
    if (userFinalStage && !squads) return finish({ finalStage: userFinalStage });
  }
  const finalStage = winners[104] === 'USER_XI' ? 'CHAMPION' : (userFinalStage || 'F');
  return finish({ finalStage });
}

function _applyResult(rowA, rowB, sa, sb) {
  rowA.p++; rowB.p++;
  rowA.gf += sa; rowA.ga += sb;
  rowB.gf += sb; rowB.ga += sa;
  if (sa > sb)      { rowA.w++; rowB.l++; rowA.pts += 3; }
  else if (sa < sb) { rowB.w++; rowA.l++; rowB.pts += 3; }
  else              { rowA.d++; rowB.d++; rowA.pts++; rowB.pts++; }
}

function _placeUser(field2026) {
  const groups = {};
  for (const [k, mem] of Object.entries(field2026.groups)) groups[k] = [...mem];

  // candidates: bottom-half Elo teams
  const all = Object.entries(field2026.strengths).sort((a, b) => a[1] - b[1]);
  const weak = new Set(all.slice(0, Math.ceil(all.length / 2)).map(e => e[0]));
  const candidates = [];
  for (const [k, mem] of Object.entries(groups)) {
    mem.forEach((t, i) => { if (weak.has(t)) candidates.push({ k, i, t }); });
  }
  const pick = candidates.length
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : { k: Object.keys(groups)[0], i: 3, t: groups[Object.keys(groups)[0]][3] };
  groups[pick.k][pick.i] = 'USER_XI';
  return { groups, groupKey: pick.k, replaced: pick.t };
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function _normaliseXi(xi) {
  const out = {};
  for (const [slot, val] of Object.entries(xi)) {
    if (typeof val === 'number') out[slot] = { name: slot, p: _slotToPos(slot), r: val };
    else if (val && typeof val === 'object') out[slot] = { name: val.n || val.name || slot, p: val.p || _slotToPos(slot), r: val.r || 50, sp: val.sp, g: val.g, caps: val.caps, aw: val.aw };
    else out[slot] = { name: slot, p: _slotToPos(slot), r: 50 };
  }
  return out;
}

function _slotToPos(slot) {
  if (slot === 'GK') return 'GK';
  if (slot === 'RB' || slot.startsWith('CB') || slot === 'LB') return 'DF';
  if (slot.startsWith('CM') || slot === 'RM' || slot === 'LM') return 'MF';
  if (slot.startsWith('ST')) return 'FW';
  return 'MF';
}

function _xiToPlayers(normXi) {
  return Object.entries(normXi).map(([slot, p]) => ({
    n: p.name || slot, p: p.p || _slotToPos(slot), r: p.r || 50, slot,
    g: p.g, caps: p.caps, aw: p.aw,
  }));
}

// ─── Opponent XI builder (display + scorer naming only; never feeds match math) ─
// Converts a nation's 26-man squad (the players.json subset for one nation) into
// a real 4-4-2 XI of 11 player objects, best-by-position with sp-token slot
// refinement — identical positional logic to the user XI, so per-line averages
// render the same way for both sides. Pure: never reads JSON. The opponent's
// computeTeamScores/Elo is NEVER fed into expGoals/poissonSample — only its
// CALIBRATED Elo (field2026.strengths) decides results — so difficulty and the
// selftest bands cannot move.
const _OPP_FILL_ORDER = ['GK', 'ST1', 'ST2', 'CB1', 'CB2', 'RB', 'LB', 'CM1', 'CM2', 'RM', 'LM'];

function _slotFit(player, slot) {
  const slotGroup = _slotToPos(slot);
  const natural = player.p || slotGroup;
  let retention = (OOP_RETENTION[natural] || OOP_RETENTION.MF)[slotGroup] || 1;
  const spRaw = player.sp;
  const sp = typeof spRaw === 'string' ? spRaw.split('/') : Array.isArray(spRaw) ? spRaw : null;
  if (sp && sp.length) {
    const token = SLOT_TOKEN[slot];
    if (sp.includes(token)) retention = Math.max(retention, 1);
    else if (natural === slotGroup) {
      retention = (MIRROR_TOKEN[token] && sp.includes(MIRROR_TOKEN[token])) ? 0.92 : 0.88;
    }
  }
  return (player.r || 50) * retention;
}

// Returns the slot→player map (so callers can run computeTeamScores for per-line
// opponent averages), or null if squad is null/empty.
export function buildOpponentXiObject(squad) {
  if (!squad || !squad.length) return null;
  const pool = squad.map(p => ({
    n: p.n || p.name, p: p.p, r: typeof p.r === 'number' ? p.r : 50,
    sp: p.sp, g: p.g, caps: p.caps, aw: p.aw,
  }));
  const used = new Set();
  const out = {};
  for (const slot of _OPP_FILL_ORDER) {
    let best = -1, bestFit = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const fit = _slotFit(pool[i], slot);
      if (fit > bestFit) { bestFit = fit; best = i; }
    }
    if (best < 0) continue; // thin squad (never happens for the 48 real nations)
    used.add(best);
    const pl = pool[best];
    out[slot] = { name: pl.n || slot, p: pl.p || _slotToPos(slot), r: pl.r, sp: pl.sp, g: pl.g, caps: pl.caps, aw: pl.aw };
  }
  return out;
}

// Returns the flat 11-player array {n,p,r,sp,slot,g,caps,aw} ready for both
// display and _sampleScorers. Null if squad is null/empty.
export function buildOpponentXi(squad) {
  const obj = buildOpponentXiObject(squad);
  if (!obj) return null;
  return Object.entries(obj).map(([slot, p]) => ({
    n: p.name || slot, p: p.p || _slotToPos(slot), r: p.r || 50,
    sp: p.sp, slot, g: p.g, caps: p.caps, aw: p.aw,
  }));
}

// ─── selftest ─────────────────────────────────────────────────────────────────
export function selftest(n = 2000) {
  const tiers = [
    { label: 'avg50', rating: 50 }, { label: 'avg65', rating: 65 },
    { label: 'avg80', rating: 80 }, { label: 'avg92', rating: 92 },
    { label: 'avg99', rating: 99 },
  ];
  const mockField = _buildMockField();
  const results = {};

  for (const { label, rating } of tiers) {
    const xi = _makeUniformXi(rating);
    const counts = { GROUP_EXIT: 0, R32: 0, R16: 0, QF: 0, SF: 0, F: 0, CHAMPION: 0 };
    const t0 = Date.now();
    for (let i = 0; i < n; i++) counts[simulateTournament(xi, mockField).finalStage]++;
    results[label] = { counts, winPct: (counts.CHAMPION / n * 100).toFixed(1), elapsed: Date.now() - t0 };
  }

  console.log('\n=== GloryXI sim.selftest() ===');
  console.log(['Tier', 'GRP', 'R32', 'R16', 'QF', 'SF', 'F', 'CHAMP', 'Win%', 'ms/1k'].join('\t'));
  for (const { label } of tiers) {
    const { counts, winPct, elapsed } = results[label];
    console.log([label, counts.GROUP_EXIT, counts.R32, counts.R16, counts.QF, counts.SF, counts.F, counts.CHAMPION, winPct + '%', Math.round(elapsed / (n / 1000)) + 'ms'].join('\t'));
  }

  const xi80 = _makeUniformXi(80);
  const t1 = Date.now();
  for (let i = 0; i < 10000; i++) simulateTournament(xi80, mockField);
  console.log(`\n10k tournaments: ${Date.now() - t1}ms (target: <10000ms)`);

  const win99 = results.avg99.counts.CHAMPION / n;
  const win50 = results.avg50.counts.CHAMPION / n;
  const qf80  = (results.avg80.counts.QF + results.avg80.counts.SF + results.avg80.counts.F + results.avg80.counts.CHAMPION) / n;
  console.log('\nTarget checks (post 2026-06-11 difficulty pass):');
  console.log(`  avg99 win rate: ${(win99 * 100).toFixed(1)}% (need >=30%)`);
  console.log(`  avg50 win rate: ${(win50 * 100).toFixed(1)}% (need <0.1%)`);
  console.log(`  avg80 QF+ rate: ${(qf80 * 100).toFixed(1)}% (need >35%)`);
  return results;
}

function _buildMockField() {
  const TIERS = [
    { base: 2000, spread: 40 }, { base: 1850, spread: 40 },
    { base: 1750, spread: 40 }, { base: 1650, spread: 40 },
  ];
  const tierArrays = [];
  const strengths = {};
  for (let t = 0; t < 4; t++) {
    const arr = [];
    for (let i = 0; i < 12; i++) {
      const name = `T${t + 1}_${String.fromCharCode(65 + i)}`;
      strengths[name] = TIERS[t].base + Math.round((i / 11 - 0.5) * 2 * TIERS[t].spread);
      arr.push(name);
    }
    tierArrays.push(arr);
  }
  const groups = {};
  'ABCDEFGHIJKL'.split('').forEach((L, g) => {
    groups[L] = [tierArrays[0][g], tierArrays[1][g], tierArrays[2][g], tierArrays[3][g]];
  });
  return { groups, strengths };
}

function _makeUniformXi(rating) {
  const xi = {};
  for (const s of ['GK','RB','CB1','CB2','LB','CM1','CM2','RM','LM','ST1','ST2']) {
    xi[s] = { name: s, p: _slotToPos(s), r: rating };
  }
  return xi;
}
