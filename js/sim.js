/**
 * sim.js — GloryXI simulation engine (V3 tournament logic)
 * Pure functions, ES module, no DOM, no JSON imports at module load.
 *
 * Public API:
 *   computeTeamScores(xi)               → line scores + weak-line gate
 *   computeTeamElo(xi)                  → number
 *   simulateMatch(eloA, eloB, playersA) → group match
 *   simulateKnockout(eloA, eloB, playersA) → with a.e.t./pens
 *   simulateTournament(xi, field2026)   → journey (real group, ranked advance, bracket-shaped KO)
 *   selftest(n)                         → calibration table
 */

// Calibrated 2026-06-10: avg99 wins ≥60%, avg50 wins <0.5%, avg80 QF+ >50%
const ELO_BASE  = 1150;
const ELO_SCALE = 12;
const EXP_COEF  = 0.50;

// ─── 2.1 Team scores ──────────────────────────────────────────────────────────
export function computeTeamScores(xi) {
  // Slot values may be plain ratings or player objects {n, p, r}
  const r = {};
  for (const slot of ['GK','RB','CB1','CB2','LB','CM1','CM2','RM','LM','ST1','ST2']) {
    const v = xi[slot];
    r[slot] = typeof v === 'number' ? v
      : (v && typeof v === 'object' && typeof v.r === 'number') ? v.r
      : 50;
  }
  const { GK, RB, CB1, CB2, LB, CM1, CM2, RM, LM, ST1, ST2 } = r;

  const defense  = 0.35 * GK + 0.65 * ((RB + CB1 + CB2 + LB) / 4);
  const midfield = (CM1 + CM2 + RM + LM) / 4;
  const attack   = 0.6 * ((ST1 + ST2) / 2) + 0.4 * midfield;

  const gate = Math.min(defense, midfield, attack);
  const defenseEff  = 0.75 * defense  + 0.25 * gate;
  const midfieldEff = 0.75 * midfield + 0.25 * gate;
  const attackEff   = 0.75 * attack   + 0.25 * gate;
  const avgRating = (GK + RB + CB1 + CB2 + LB + CM1 + CM2 + RM + LM + ST1 + ST2) / 11;

  return { defense, midfield, attack, defenseEff, midfieldEff, attackEff, avgRating };
}

export function computeTeamElo(xi) {
  const { attackEff, defenseEff } = computeTeamScores(xi);
  return ELO_BASE + ELO_SCALE * (0.5 * attackEff + 0.5 * defenseEff);
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

// ─── 2.4 Tournament (V3: real group play, ranked advancement, bracket-shaped KO) ─
export function simulateTournament(xi, field2026) {
  const normXi  = _normaliseXi(xi);
  const players = _xiToPlayers(normXi);
  const userElo = computeTeamElo(normXi);

  // Insert user into a real 2026 group, replacing a bottom-half team
  const { groups, groupKey, replaced } = _placeUser(field2026);
  const getElo = t => t === 'USER_XI' ? userElo : (field2026.strengths[t] || 1700);

  // Full round-robin in the user's group (6 matches), real table
  const members = groups[groupKey];
  const table = {};
  for (const t of members) table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };

  const journey = [];
  const record  = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };

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

  const rows = Object.values(table).sort((a, b) =>
    b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  const rank = rows.findIndex(r => r.team === 'USER_XI') + 1;
  const userRow = rows[rank - 1];
  const groupTable = rows.map(r => ({ ...r }));

  // 2026 format: top-2 advance + best 8 of 12 thirds
  let advanced = rank <= 2;
  if (rank === 3) {
    advanced = Math.random() < (userRow.pts >= 5 ? 0.9 : userRow.pts >= 4 ? 0.65 : userRow.pts === 3 ? 0.35 : 0.05);
  }
  const base = { groupKey, replaced, rank, groupTable };
  if (!advanced) return { journey, finalStage: 'GROUP_EXIT', record, ...base };

  // Qualify the other groups (Elo + noise), build pools
  const winners = [], runners = [], thirds = [];
  rows.forEach((r, idx) => {
    if (r.team === 'USER_XI') return;
    if (idx === 0) winners.push(r.team);
    else if (idx === 1) runners.push(r.team);
    else if (idx === 2 && Math.random() < 0.6) thirds.push(r.team);
  });
  for (const [k, mem] of Object.entries(groups)) {
    if (k === groupKey) continue;
    const sorted = mem.slice().sort((a, b) =>
      ((field2026.strengths[b] || 1700) + Math.random() * 140) -
      ((field2026.strengths[a] || 1700) + Math.random() * 140));
    winners.push(sorted[0]);
    runners.push(sorted[1]);
    if (Math.random() < 8 / 12) thirds.push(sorted[2]);
  }

  // Bracket-realistic opponent selection:
  // - R32 pairing follows your group rank (winners meet thirds, runners meet runners).
  // - The deeper the round, the more surviving opponents skew elite (Elo-weighted),
  //   mirroring a real bracket where favourites converge on the semis.
  const qualifiers = [
    ...winners.map(t => ({ t, tier: 'W' })),
    ...runners.map(t => ({ t, tier: 'R' })),
    ...thirds.map(t => ({ t, tier: 'T' })),
  ];
  const TIER_PREF = {
    R32: rank === 1 ? { W: 0.3, R: 1.5, T: 6 } : rank === 2 ? { W: 0.6, R: 5, T: 1.5 } : { W: 6, R: 1.5, T: 0.3 },
    R16: { W: 1, R: 1, T: 0.7 },
    QF:  { W: 2, R: 1, T: 0.4 },
    SF:  { W: 3, R: 0.8, T: 0.2 },
    F:   { W: 4, R: 0.6, T: 0.1 },
  };
  const ELO_BETA = { R32: 0, R16: 0.35, QF: 0.7, SF: 1.1, F: 1.4 };

  const pickOpponent = (stage) => {
    if (!qualifiers.length) return 'Unknown';
    const pref = TIER_PREF[stage], beta = ELO_BETA[stage];
    const weights = qualifiers.map(q =>
      (pref[q.tier] || 1) * Math.exp(beta * ((field2026.strengths[q.t] || 1700) - 1800) / 100));
    let r = Math.random() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < qualifiers.length; i++) {
      r -= weights[i];
      if (r <= 0) return qualifiers.splice(i, 1)[0].t;
    }
    return qualifiers.pop().t;
  };

  for (const stage of ['R32', 'R16', 'QF', 'SF', 'F']) {
    const oppName = pickOpponent(stage);
    const m = simulateKnockout(userElo, getElo(oppName), players);
    record.gf += m.scoreA; record.ga += m.scoreB;
    if (m.winnerIsA) record.w++;
    else if (m.note.startsWith('(pens')) record.d++;
    else record.l++;

    journey.push({
      stage, opponent: oppName,
      scoreFor: m.scoreA, scoreAgainst: m.scoreB,
      scorers: m.scorers, note: m.note, winnerIsA: m.winnerIsA,
    });
    if (!m.winnerIsA) return { journey, finalStage: stage, record, ...base };
  }
  return { journey, finalStage: 'CHAMPION', record, ...base };
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
    else if (val && typeof val === 'object') out[slot] = { name: val.n || val.name || slot, p: val.p || _slotToPos(slot), r: val.r || 50 };
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
  console.log(`\n10k tournaments: ${Date.now() - t1}ms (target: <1000ms)`);

  const win99 = results.avg99.counts.CHAMPION / n;
  const win50 = results.avg50.counts.CHAMPION / n;
  const qf80  = (results.avg80.counts.QF + results.avg80.counts.SF + results.avg80.counts.F + results.avg80.counts.CHAMPION) / n;
  console.log('\nTarget checks:');
  console.log(`  avg99 win rate: ${(win99 * 100).toFixed(1)}% (need >=60%)`);
  console.log(`  avg50 win rate: ${(win50 * 100).toFixed(1)}% (need <0.5%)`);
  console.log(`  avg80 QF+ rate: ${(qf80 * 100).toFixed(1)}% (need >50%)`);
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
