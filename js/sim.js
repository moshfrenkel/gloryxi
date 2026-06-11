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

export function simulateMatch(eloA, eloB, playersA) {
  const d = (eloA - eloB) / 400;
  const scoreA = poissonSample(expGoals(d));
  const scoreB = poissonSample(expGoals(-d));
  const scorers = [];
  if (playersA && playersA.length > 0) _sampleScorers(scoreA, playersA, scorers, 90);
  return { scoreA, scoreB, scorers, note: '', winnerIsA: scoreA > scoreB };
}

export function simulateKnockout(eloA, eloB, playersA) {
  const d = (eloA - eloB) / 400;
  let scoreA = poissonSample(expGoals(d));
  let scoreB = poissonSample(expGoals(-d));
  let note = '';
  const scorers = [];
  if (playersA && playersA.length > 0) _sampleScorers(scoreA, playersA, scorers, 90);

  if (scoreA === scoreB) {
    const etA = poissonSample(expGoals(d) * 0.33);
    const etB = poissonSample(expGoals(-d) * 0.33);
    scoreA += etA; scoreB += etB;
    if (playersA && playersA.length > 0 && etA > 0) _sampleScorers(etA, playersA, scorers, 120);
    if (scoreA === scoreB) {
      const penWinProbA = Math.min(Math.max(0.5 + d * 0.35, 0.25), 0.75);
      const winnerIsA = Math.random() < penWinProbA;
      const penA = winnerIsA ? (Math.random() < 0.5 ? 5 : 4) : (Math.random() < 0.5 ? 4 : 3);
      const penB = winnerIsA ? (Math.random() < 0.5 ? 4 : 3) : (Math.random() < 0.5 ? 5 : 4);
      return { scoreA, scoreB, scorers, note: `(pens ${penA}-${penB})`, winnerIsA };
    }
    note = '(a.e.t.)';
  }
  return { scoreA, scoreB, scorers, note, winnerIsA: scoreA > scoreB };
}

function _sampleScorers(numGoals, players, scorers, maxMinute) {
  const weights = players.map(p => {
    const posKey = p.p === 'GK' ? 'GK' : p.p === 'DF' ? 'DF' : p.p === 'FW' ? 'FW' : 'MF';
    return (p.r || 50) * (POS_GOAL_WEIGHT[posKey] || 1);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  for (let g = 0; g < numGoals; g++) {
    let rnd = Math.random() * totalWeight;
    let scorer = players[players.length - 1];
    for (let i = 0; i < players.length; i++) {
      rnd -= weights[i];
      if (rnd <= 0) { scorer = players[i]; break; }
    }
    scorers.push({ name: scorer.n || scorer.name || '?', minute: 1 + Math.floor(Math.random() * maxMinute) });
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
export function simulateTournament(xi, field2026) {
  const normXi  = _normaliseXi(xi);
  const players = _xiToPlayers(normXi);
  const userElo = computeTeamElo(normXi);

  // Insert user into a real 2026 group, replacing a bottom-half team
  const { groups, groupKey, replaced } = _placeUser(field2026);
  const getElo = t => t === 'USER_XI' ? userElo : (field2026.strengths[t] || 1700);

  const journey = [];
  const record  = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };

  // Full round-robin in ALL groups — the rest of the field is real, so the
  // bracket the user walks into is the one the actual results produce.
  const tables = {};
  for (const [key, members] of Object.entries(groups)) {
    const table = {};
    for (const t of members) table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };

    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const A = members[i], B = members[j];
      const userIsA = A === 'USER_XI', userIsB = B === 'USER_XI';
      const m = simulateMatch(getElo(A), getElo(B), userIsA ? players : null);
      _applyResult(table[A], table[B], m.scoreA, m.scoreB);

      if (userIsA || userIsB) {
        const sf = userIsA ? m.scoreA : m.scoreB;
        const sa = userIsA ? m.scoreB : m.scoreA;
        const opp = userIsA ? B : A;
        record.gf += sf; record.ga += sa;
        if (sf > sa) record.w++; else if (sf === sa) record.d++; else record.l++;
        let scorers = m.scorers;
        if (userIsB) { // resimulate scorers from user perspective (cheap: sample for sf goals)
          scorers = [];
          _sampleScorers(sf, players, scorers, 90);
        }
        journey.push({ stage: 'GROUP', opponent: opp, scoreFor: sf, scoreAgainst: sa, scorers, note: '' });
      }
    }
    tables[key] = Object.values(table).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || Math.random() - 0.5);
  }

  const rows = tables[groupKey];
  const rank = rows.findIndex(r => r.team === 'USER_XI') + 1;
  const groupTable = rows.map(r => ({ ...r }));
  const base = { groupKey, replaced, rank, groupTable };

  // 2026 format: top-2 advance + the 8 best thirds of 12 (real comparison)
  const thirds = Object.entries(tables)
    .map(([g, rws]) => ({ g, ...rws[2] }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || Math.random() - 0.5);
  const qualifiedThirds = thirds.slice(0, 8);
  const qualifiedThirdGroups = qualifiedThirds.map(t => t.g);

  const advanced = rank <= 2 || (rank === 3 && qualifiedThirdGroups.includes(groupKey));
  if (!advanced) return { journey, finalStage: 'GROUP_EXIT', record, ...base };

  // Seed map + third-slot allocation
  const seed = {};
  for (const [g, rws] of Object.entries(tables)) {
    seed['1' + g] = rws[0].team;
    seed['2' + g] = rws[1].team;
  }
  const thirdAlloc = _allocateThirds(qualifiedThirdGroups); // match -> group letter

  // Play the official bracket, match by match
  const winners = {};
  const playKnockout = (mnum, teamA, teamB, stage) => {
    const userInA = teamA === 'USER_XI', userInB = teamB === 'USER_XI';
    if (userInA || userInB) {
      const opp = userInA ? teamB : teamA;
      const m = simulateKnockout(userElo, getElo(opp), players);
      record.gf += m.scoreA; record.ga += m.scoreB;
      if (m.winnerIsA) record.w++;
      else if (m.note.startsWith('(pens')) record.d++;
      else record.l++;
      journey.push({
        stage, opponent: opp,
        scoreFor: m.scoreA, scoreAgainst: m.scoreB,
        scorers: m.scorers, note: m.note, winnerIsA: m.winnerIsA,
      });
      winners[mnum] = m.winnerIsA ? 'USER_XI' : opp;
      return m.winnerIsA;
    }
    const m = simulateKnockout(getElo(teamA), getElo(teamB), null);
    winners[mnum] = m.winnerIsA ? teamA : teamB;
    return true;
  };

  for (const x of BRACKET_R32) {
    const teamA = seed[x.a];
    const teamB = x.b.startsWith('3:')
      ? tables[thirdAlloc.get(x.m)][2].team
      : seed[x.b];
    const userAlive = playKnockout(x.m, teamA, teamB, 'R32');
    if (!userAlive) return { journey, finalStage: 'R32', record, ...base };
  }
  for (const x of BRACKET_LATER) {
    const userAlive = playKnockout(x.m, winners[x.a], winners[x.b], x.stage);
    if (!userAlive) return { journey, finalStage: x.stage, record, ...base };
  }
  return winners[104] === 'USER_XI'
    ? { journey, finalStage: 'CHAMPION', record, ...base }
    : { journey, finalStage: 'F', record, ...base };
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
    else if (val && typeof val === 'object') out[slot] = { name: val.n || val.name || slot, p: val.p || _slotToPos(slot), r: val.r || 50, sp: val.sp };
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
    n: p.name || slot, p: p.p || _slotToPos(slot), r: p.r || 50,
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
