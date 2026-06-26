/* GloryXI V2 — UI state machine.
   Flow: S1 sleeve → S2 auto-draw → S3 squad sheet (player-first picking, board drawer S4)
   → S5 vidiprinter → S6 back cover.
   Mechanics: auto-spin (no hold), pick any player then a free compatible slot,
   ratings always visible, one player per country, 1 team-skip + 1 year-skip. */

import { createTournament, mentalityAt, computeTeamScores, computeTeamElo, buildOpponentXiObject, matchProb, advanceProb, titleOdds, koMods } from './sim.js';
import { shareResult, shareStory } from './share.js';
import { t, getLang, setLang, applyStatic } from './i18n.js';
import { kitFor, jerseySVG } from './kits.js';
import { lbConfigured, getNick, setNick, submitDailyScore, fetchBoard, getLeagues, addLeague, removeLeague } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

const SLOTS = ['GK', 'RB', 'CB1', 'CB2', 'LB', 'CM1', 'CM2', 'RM', 'LM', 'ST1', 'ST2'];
const POS_SLOTS = {
  GK: ['GK'],
  DF: ['RB', 'CB1', 'CB2', 'LB'],
  MF: ['CM1', 'CM2', 'RM', 'LM'],
  FW: ['ST1', 'ST2'],
};
// reverse lookup slot → position group (used by the Sprint-3 swap eligibility)
const SLOT_POS_GROUP = Object.fromEntries(Object.entries(POS_SLOTS).flatMap(([pos, slots]) => slots.map(s => [s, pos])));
const SLOT_LABEL = {
  GK: 'GK', RB: 'RB', CB1: 'CB 1', CB2: 'CB 2', LB: 'LB',
  CM1: 'CM 1', CM2: 'CM 2', RM: 'RM', LM: 'LM', ST1: 'ST 1', ST2: 'ST 2',
};
const POS_ORDER = ['GK', 'DF', 'MF', 'FW'];
const posTitle = (pos) => t('pos_' + pos);

// board slot coordinates, % of pitch (x, y) — GK bottom, STs top
const SLOT_XY = {
  ST1: [36, 13], ST2: [64, 13],
  LM: [13, 38], CM1: [38, 42], CM2: [62, 42], RM: [87, 38],
  LB: [13, 66], CB1: [38, 70], CB2: [62, 70], RB: [87, 66],
  GK: [50, 90],
};

const S = {
  players: [], teams: {}, combos: [], field: null,
  squads: new Map(),          // "country|year" -> players array
  xi: {},                     // slot -> player object
  used: new Set(),            // countries used
  skips: { team: 1, year: 1 },
  draw: null,                 // { c, y }
  spinning: false,
  journey: null,
  feedQueue: [], feedIdx: 0, matchNo: 0, printing: false,
  challenges: [], challenge: null, challengeOk: null,
};

// ── analytics — anonymous counts only (Umami), never blocks gameplay ─────────
function track(name, data) {
  try { if (window.umami) window.umami.track(name, data); } catch (_) { /* ignore */ }
}
function bumpGamesPlayed() {
  let n = 1;
  try {
    n = (parseInt(localStorage.getItem('gxi_games'), 10) || 0) + 1;
    localStorage.setItem('gxi_games', String(n));
  } catch (_) { /* private mode — count as 1 */ }
  return n;
}
function gamesBucket(n) {
  return n <= 5 ? String(n) : n <= 10 ? '6-10' : n <= 20 ? '11-20' : '21+';
}

// ── data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  // content files change daily (challenges/articles/fixtures/results) — bust the
  // browser/CDN cache each load so edits show up immediately; the big static
  // files (players/teams/field) stay cacheable.
  const cb = '?v=' + Date.now();
  const [p, t, f, ch, ar, fx, rs] = await Promise.all([
    fetch('./data/players.json').then(r => r.json()),
    fetch('./data/teams.json').then(r => r.json()),
    fetch('./data/field2026.json').then(r => r.json()),
    fetch('./data/challenges.json' + cb).then(r => r.json()).catch(() => []),
    fetch('./data/articles.json' + cb).then(r => r.json()).catch(() => ({ articles: [] })),
    fetch('./data/fixtures.json' + cb).then(r => r.json()).catch(() => ({ fixtures: [] })),
    fetch('./data/results.json' + cb).then(r => r.json()).catch(() => ({ matches: [] })),
  ]);
  S.players = p;
  S.teams = t.teams;
  S.combos = t.combos;
  S.field = f;
  S.challenges = ch;
  S.articles = (ar && ar.articles) || [];
  S.fixtures = (fx && fx.fixtures) || [];
  S.results = (rs && rs.matches) || [];
  for (const pl of p) {
    const k = pl.c + '|' + pl.y;
    if (!S.squads.has(k)) S.squads.set(k, []);
    S.squads.get(k).push(pl);
  }
}

function flagSrc(country) {
  const t = S.teams[country];
  if (!t) return '';
  if (t.flagFile) return './flags/' + t.flagFile;
  return './flags/' + t.iso2 + '.svg';   // all flags self-hosted — no third-party requests
}

function makeFlag(country, cls) {
  const img = document.createElement('img');
  img.src = flagSrc(country);
  img.alt = country;
  if (cls) img.className = cls;
  img.draggable = false;
  img.onerror = function () { this.style.visibility = 'hidden'; };
  return img;
}

const PARTICLES = new Set(['van', 'de', 'der', 'den', 'di', 'da', 'dos', 'del', 'la', 'le', 'el']);
function surname(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  let i = parts.length - 1;
  while (i > 0 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(' ');
}

// ── screen switching ──────────────────────────────────────────────────────────
function show(id) {
  // leaving the result screen commits your run to the daily board (once, final name).
  if (id !== 's6') { const s6 = $('s6'); if (s6 && s6.classList.contains('active') && typeof flushPendingRun === 'function') flushPendingRun(); }
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}

// ── draw logic ────────────────────────────────────────────────────────────────
function freeSlots() { return SLOTS.filter(s => !S.xi[s]); }

function slotsForPos(pos) {
  return (POS_SLOTS[pos] || []).filter(s => !S.xi[s]);
}

// ── stage-2 challenge filters ─────────────────────────────────────────────────
// flt fields (challenges.json): nations [...] / years [...] / rpt (lift the
// one-country-once rule on short nation lists) / pos ["FW"] (only these natural
// positions, placeable in ANY slot) / cap {GK:65} (rating ceiling per slot
// group) / decades (draw serves missing decades until all 9 are covered) /
// slotEra {SLOT: decadeKey} (day 7 time-map: each listed slot accepts only that
// decade; unlisted slots stay free — draw steers to still-open decades) /
// wideNatural (RB/LB/RM/LM only accept players whose real positions include
// that exact slot) / legendPos, legendMin (hall-of-legends restrictions).
function challengeFlt() { return (S.challenge && S.challenge.flt) || null; }

const WIDE_SLOTS = ['RB', 'LB', 'RM', 'LM'];
const CAP_GROUP = (slot) => slot === 'GK' ? 'GK'
  : slot === 'RB' || slot === 'LB' || slot.startsWith('CB') ? 'DF'
  : slot.startsWith('ST') ? 'FW' : 'MF';
const decadeOf = (y) => y < 1940 ? 193 : Math.floor(y / 10);
const ALL_DECADES = 9; // 30s 50s 60s 70s 80s 90s 00s 10s 20s — no 1940s cups
const DECADE_LABEL = { 193: '30s', 195: '50s', 196: '60s', 197: '70s', 198: '80s', 199: '90s', 200: '00s', 201: '10s', 202: '20s' };

// ── "one nation per line" challenge (flt.lineNation) ─────────────────────────
// each formation line (GK/DF/MF/FW) locks to a SINGLE nation; a nation never
// repeats across lines; within a line every player is from a DIFFERENT World Cup.
// the line a player belongs to IS its position group (p.p), so all state is
// derived live from S.xi — no separate bookkeeping to keep in sync.
function lineNations() {                       // line(pos) -> locked nation (or undefined)
  const m = {};
  for (const s of SLOTS) { const p = S.xi[s]; if (p) m[p.p] = p.c; }
  return m;
}
function lineYears(pos, exceptSlot) {          // World Cup years already used in a line
  const ys = new Set();
  for (const s of POS_SLOTS[pos] || []) { if (s === exceptSlot) continue; const p = S.xi[s]; if (p) ys.add(p.y); }
  return ys;
}
function lineNationExcept(pos, slot) {         // a line's nation, ignoring one slot (for swaps)
  for (const s of POS_SLOTS[pos] || []) { if (s === slot) continue; const p = S.xi[s]; if (p) return p.c; }
  return null;
}
function otherLineNations(pos) {               // nations locked by the OTHER lines
  const set = new Set();
  for (const q of POS_ORDER) { if (q === pos) continue; const ln = lineNationExcept(q, null); if (ln) set.add(ln); }
  return set;
}
function placedNames() { return new Set(Object.values(S.xi).map(p => p.c + '|' + p.n)); }
// the line-completability oracle: max set of this nation's players in a position
// with DISTINCT years AND DISTINCT names (Kuhn's bipartite matching, years ↔ names).
// guarantees a chosen nation can actually fill a whole line from different cups.
function lineMatch(c, pos, exclYears, exclNames) {
  const adj = new Map();
  for (const p of S.players) {
    if (p.c !== c || p.p !== pos) continue;
    if (exclYears.has(p.y) || exclNames.has(p.c + '|' + p.n)) continue;
    if (!adj.has(p.y)) adj.set(p.y, []);
    adj.get(p.y).push(p.n);
  }
  const matchName = new Map(); let res = 0;
  const aug = (y, seen) => {
    for (const nm of adj.get(y) || []) {
      if (seen.has(nm)) continue; seen.add(nm);
      if (!matchName.has(nm) || aug(matchName.get(nm), seen)) { matchName.set(nm, y); return true; }
    }
    return false;
  };
  for (const y of adj.keys()) if (aug(y, new Set())) res++;
  return res;
}
// may player p be placed right now under the line-nation rules?
function lineSlotOK(p) {
  const pos = p.p, ln = lineNations();
  if (ln[pos]) { if (ln[pos] !== p.c) return false; }            // line locked → same nation only
  else if (Object.values(ln).includes(p.c)) return false;        // unlocked → nation must be free
  const usedY = lineYears(pos);
  if (usedY.has(p.y)) return false;                              // a different World Cup each time
  const open = (POS_SLOTS[pos] || []).filter(s => !S.xi[s]).length; // slots still to fill (incl. this one)
  const exclN = placedNames(); exclN.add(p.c + '|' + p.n);
  const rest = lineMatch(p.c, pos, new Set([...usedY, p.y]), exclN);
  return 1 + rest >= open;                                       // placing p must leave the line completable
}

// ── "one decade per line" challenge (flt.lineDecade) ─────────────────────────
// the parallel of lineNation, with DECADE in place of nation: each formation
// line (GK/DF/MF/FW) locks to the decade of its first-placed player; a decade
// never repeats across lines (four lines → four different decades); inside a
// line every player shares that decade (any nation, same World Cup is fine).
// the normal one-country-per-XI rule stays ON, so each line is a decade's worth
// of DIFFERENT nations. all state is derived live from S.xi.
function lineDecades() {                        // line(pos) -> locked decade (or undefined)
  const m = {};
  for (const s of SLOTS) { const p = S.xi[s]; if (p) m[p.p] = decadeOf(p.y); }
  return m;
}
function lineDecadeExcept(pos, slot) {          // a line's decade, ignoring one slot (for swaps)
  for (const s of POS_SLOTS[pos] || []) { if (s === slot) continue; const p = S.xi[s]; if (p) return decadeOf(p.y); }
  return null;
}
function otherLineDecades(pos) {                // decades locked by the OTHER lines
  const set = new Set();
  for (const q of POS_ORDER) { if (q === pos) continue; const ld = lineDecadeExcept(q, null); if (ld !== null) set.add(ld); }
  return set;
}
// may player p be placed right now under the line-decade rules?
function lineDecadeOK(p) {
  const pos = p.p, ld = lineDecades(), dec = decadeOf(p.y);
  if (ld[pos] !== undefined) { if (ld[pos] !== dec) return false; }  // line locked → same decade only
  else if (Object.values(ld).includes(dec)) return false;           // unlocked → decade must be free across lines
  const open = (POS_SLOTS[pos] || []).filter(s => !S.xi[s]).length;  // slots still to fill (incl. this one)
  const placed = placedNames(); let avail = 0; const seen = new Set();
  for (const q of S.players) {                                      // enough DISTINCT humans of this decade+pos left?
    if (q.p !== pos || decadeOf(q.y) !== dec) continue;
    const key = q.c + '|' + q.n;
    if (placed.has(key) || seen.has(key)) continue;
    seen.add(key); avail++;
  }
  return avail >= open;                                             // placing p must leave the line completable
}

// where may THIS player go right now — single source of truth for the draw
// validator, the squad sheet and the hall of legends
function eligibleSlots(p) {
  const f = challengeFlt();
  if (f && f.lineNation) return lineSlotOK(p) ? slotsForPos(p.p) : [];
  if (f && f.lineDecade) return lineDecadeOK(p) ? slotsForPos(p.p) : [];
  let slots;
  if (f && f.pos) {
    if (!f.pos.includes(p.p)) return [];
    slots = freeSlots(); // position-theme days: eligible players go anywhere
  } else slots = slotsForPos(p.p);
  if (f && f.cap) slots = slots.filter(s => { const cap = f.cap[CAP_GROUP(s)]; return cap == null || p.r <= cap; });
  if (f && f.wideNatural) slots = slots.filter(s => !WIDE_SLOTS.includes(s) || (p.sp && p.sp.split('/').includes(s)));
  // time-map days (day 7): each listed slot accepts ONLY its decade; unlisted slots (ST1/ST2) stay free
  if (f && f.slotEra) { const dec = decadeOf(p.y); slots = slots.filter(s => f.slotEra[s] == null || f.slotEra[s] === dec); }
  return slots;
}

// the drawn squad minus players already fielded; in challenge mode the same
// HUMAN is also blocked across years (rpt days: no Cruyff '74 next to Cruyff '78)
function availableSquad(c, y) {
  const squad = S.squads.get(c + '|' + y) || [];
  const placed = new Set(Object.values(S.xi));
  if (!S.challenge) return squad.filter(p => !placed.has(p));
  const names = new Set(Object.values(S.xi).map(p => p.c + '|' + p.n));
  return squad.filter(p => !placed.has(p) && !names.has(p.c + '|' + p.n));
}

function comboValid([c, y]) {
  const f = challengeFlt();
  if (f) {
    if (f.nations && !f.nations.includes(c)) return false;
    if (f.years && !f.years.includes(y)) return false;
    if (!f.rpt && !f.lineNation && S.used.has(c)) return false; // lineNation repeats a nation within a line — gated by eligibleSlots instead
  } else if (S.used.has(c)) return false;
  if (!S.squads.has(c + '|' + y)) return false;
  return availableSquad(c, y).some(p => eligibleSlots(p).length > 0);
}

function pickCombo(constraint) {
  // constraint: {keepYear} / {keepCountry} / null. Falls back to any valid combo.
  let pool = S.combos.filter(comboValid);
  const f = challengeFlt();
  if (f && f.decades) {
    const have = new Set(Object.values(S.xi).map(p => decadeOf(p.y)));
    if (have.size < ALL_DECADES) {
      const sub = pool.filter(([, y]) => !have.has(decadeOf(y)));
      if (sub.length) pool = sub;
    }
  }
  // time-map days: steer the reel to a decade that still has an open era-locked slot
  if (f && f.slotEra) {
    const need = new Set();
    for (const [slot, dec] of Object.entries(f.slotEra)) if (!S.xi[slot]) need.add(dec);
    if (need.size) {
      const sub = pool.filter(([, y]) => need.has(decadeOf(y)));
      if (sub.length) pool = sub;
    }
  }
  // lineNation: keep serving the current open line's nation (a new World Cup each
  // time) until that line is full, then the pool naturally opens a fresh nation
  if (f && f.lineNation) {
    const ln = lineNations();
    const openLine = POS_ORDER.find(pos => ln[pos] && (POS_SLOTS[pos] || []).some(s => !S.xi[s]));
    if (openLine) {
      const yrs = lineYears(openLine);
      const sub = pool.filter(([c, y]) => c === ln[openLine] && !yrs.has(y));
      if (sub.length) pool = sub;
    }
  }
  // lineDecade: while a locked line still has open slots, serve only its decade;
  // otherwise (opening a new line) steer to a decade no line has claimed yet
  if (f && f.lineDecade) {
    const ld = lineDecades();
    const openLine = POS_ORDER.find(pos => ld[pos] !== undefined && (POS_SLOTS[pos] || []).some(s => !S.xi[s]));
    if (openLine) {
      const sub = pool.filter(([, y]) => decadeOf(y) === ld[openLine]);
      if (sub.length) pool = sub;
    } else {
      const used = new Set(Object.values(ld));
      const sub = pool.filter(([, y]) => !used.has(decadeOf(y)));
      if (sub.length) pool = sub;
    }
  }
  if (constraint && constraint.notCountry) {
    const sub = pool.filter(([c]) => c !== constraint.notCountry);
    if (sub.length) pool = sub;
  }
  if (constraint && constraint.keepYear != null) {
    const sub = pool.filter(([, y]) => y === constraint.keepYear);
    if (sub.length) pool = sub;
  }
  if (constraint && constraint.keepCountry != null) {
    const sub = pool.filter(([c, y]) => c === constraint.keepCountry && y !== constraint.notYear);
    if (sub.length) pool = sub;
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// challenge mode: required nations are served by the draw. Each plan entry is
// {n: nation, at: pick number} — 'asap' fires on the next free draw, a number
// waits for that pick, 'mid' resolves to a surprise pick 5-8. The same nation
// may appear twice (e.g. Israel ×2): the one-country-once rule is bypassed for
// forced draws, and already-placed players are filtered out of the squad sheet.
function buildChallengePlan(c) {
  const ent = [];
  if (c && c.req) c.req.forEach((n, i) => {
    const at = c.reqAt ? c.reqAt[i] : 'asap';
    ent.push({ n, at: at === 'mid' ? 5 + Math.floor(Math.random() * 4) : at, done: false });
  });
  // reqAny: one forced draw from a SET of nations (player's pick decides which)
  if (c && c.reqAny) ent.push({ anyOf: c.reqAny, at: 5 + Math.floor(Math.random() * 4), done: false });
  return ent.length ? ent : null;
}

function _challengeComboValid([c, y]) {
  if (!S.squads.has(c + '|' + y)) return false;
  return availableSquad(c, y).some(p => eligibleSlots(p).length > 0);
}

function pickChallengeCombo() {
  const plan = S.challengePlan;
  if (!plan) return null;
  const pickNum = Object.keys(S.xi).length + 1;
  const due = plan.find(e => !e.done && (e.at === 'asap' || e.at <= pickNum));
  if (!due) return null;
  const pool = S.combos.filter(c => (due.n ? c[0] === due.n : due.anyOf.includes(c[0])) && _challengeComboValid(c));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── S2 auto-spin ──────────────────────────────────────────────────────────────
function startDraw(constraint) {
  const ll = $('legend-list');
  if (ll && ll.childElementCount) ll.innerHTML = '';
  const target = (constraint ? null : pickChallengeCombo()) || pickCombo(constraint);
  if (!target) { startTournament(); return; }
  S.draw = { c: target[0], y: target[1] };
  S.spinning = true;

  show('s2');
  $('s2-round').textContent = t('pick_of', Object.keys(S.xi).length + 1) + (S.challenge ? ' · DAILY #' + S.challenge.d : '');
  const stamp = $('draw-header');
  stamp.textContent = '';
  stamp.classList.remove('stamped');
  updateSkipBoxes(false);

  const yearEl = $('spin-year');
  const reel = $('flagreel');
  const track = $('flag-track');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CELL_H = 200;          // must match .flag-cell height in CSS
  const countries = Object.keys(S.teams);
  const years = [...new Set(S.combos.map(c => c[1]))];

  // build a vertical reel of random nation cells, landing on the real target.
  // the target cell sits well down the strip so the reel has room to scroll.
  const PAD_BEFORE = 18;       // random cells the reel travels past before landing
  const cells = [];
  for (let i = 0; i < PAD_BEFORE; i++) {
    cells.push(countries[Math.floor(Math.random() * countries.length)]);
  }
  const stopIndex = cells.length;     // index of the target cell
  cells.push(S.draw.c);
  // a few trailing cells so the window below the line isn't empty mid-spin
  for (let i = 0; i < 4; i++) {
    cells.push(countries[Math.floor(Math.random() * countries.length)]);
  }

  track.innerHTML = '';
  for (const c of cells) {
    const cell = document.createElement('div');
    cell.className = 'flag-cell';
    const img = document.createElement('img');
    img.src = flagSrc(c);
    img.alt = c;
    img.draggable = false;
    img.onerror = function () { this.style.visibility = 'hidden'; };
    const nm = document.createElement('div');
    nm.className = 'reel-nm';
    nm.textContent = c;
    cell.append(img, nm);
    track.appendChild(cell);
  }

  // reset reel to the top, then translateY down so the target lands on the line
  track.style.transition = 'none';
  track.style.transform = 'translateY(0)';
  void track.offsetHeight;     // reflow so the next transition takes effect
  const endY = -(stopIndex * CELL_H);

  yearEl.textContent = '––––';

  // year ticks random values while the reel spins, then pops in on lock
  let yTimer = null;
  if (!reduce) {
    yTimer = setInterval(() => {
      yearEl.textContent = years[Math.floor(Math.random() * years.length)];
    }, 90);
  }

  function land() {
    if (yTimer) clearInterval(yTimer);
    yearEl.textContent = S.draw.y;
    // year pops in with a scale bounce
    if (!reduce && yearEl.animate) {
      yearEl.animate(
        [{ transform: 'scale(.7)', opacity: 0.3 },
         { transform: 'scale(1.16)', opacity: 1 },
         { transform: 'scale(1)' }],
        { duration: 460, easing: 'cubic-bezier(.2,.9,.2,1.3)' });
    }
    stamp.textContent = S.draw.c + ' ' + S.draw.y;
    stamp.classList.add('stamped');
    S.spinning = false;
    updateSkipBoxes(true);
    setTimeout(() => { if (!S.spinning) showSquad(); }, 850);
  }

  if (reduce) {
    // instant land — no reel motion
    track.style.transform = 'translateY(' + endY + 'px)';
    land();
    return;
  }

  reel.classList.add('spinning');
  // smooth vertical reel, ~2.6s, cubic-bezier ease-out
  track.style.transition = 'transform 2.6s cubic-bezier(.12,.72,.1,1)';
  track.style.transform = 'translateY(' + endY + 'px)';

  setTimeout(() => {
    reel.classList.remove('spinning');
    // 170ms 6px overshoot bounce settle
    if (track.animate) {
      track.animate(
        [{ transform: 'translateY(' + (endY + 6) + 'px)' },
         { transform: 'translateY(' + endY + 'px)' }],
        { duration: 170, easing: 'ease-out' });
    }
    land();
  }, 2750);
}

function updateSkipBoxes(visible) {
  // lineNation: "other nation" is allowed only before a line's nation is chosen,
  // i.e. while the current draw is opening a NEW line — not while completing a
  // locked one (the line's nation is committed). "other year" stays normal.
  const f = challengeFlt();
  let teamLock = false;
  if (f && f.lineNation) {
    const ln = lineNations();
    teamLock = !!POS_ORDER.find(pos => ln[pos] && (POS_SLOTS[pos] || []).some(s => !S.xi[s]));
  }
  // lineDecade keeps the normal one-country rule, and the "other team" skip keeps
  // the drawn year (so the decade is preserved) — no extra team lock needed.
  for (const [key, ids] of [['team', ['btn-skip-team', 'btn-skip-team-s3']], ['year', ['btn-skip-year', 'btn-skip-year-s3']]]) {
    const gate = (key === 'team' && teamLock) ? false : S.skips[key] > 0;
    for (const id of ids) {
      const el = $(id);
      el.classList.toggle('avail', visible && gate);
      el.disabled = !(visible && gate);
    }
  }
}

function skip(kind) {
  if (S.skips[kind] <= 0 || S.spinning) return;
  S.skips[kind]--;
  const { c, y } = S.draw || {};
  if (kind === 'team') startDraw({ notCountry: c, keepYear: y });
  else startDraw({ keepCountry: c, notYear: y });
}

// ── S3 squad sheet ────────────────────────────────────────────────────────────
function showSquad() {
  const { c, y } = S.draw;
  show('s3');
  renderPips();
  $('round-label').textContent = t('pick_n', Object.keys(S.xi).length + 1);
  const flt = challengeFlt();
  if (flt && flt.lineNation) {
    const ln = lineNations();
    const he = getLang() === 'he';
    const fillPos = POS_ORDER.find(pos => ln[pos] === c && (POS_SLOTS[pos] || []).some(s => !S.xi[s]));
    $('round-label').textContent = fillPos
      ? (he ? 'משלים את ' : 'COMPLETING ') + posTitle(fillPos)
      : (he ? 'קו חדש, נבחרת חדשה' : 'NEW LINE, NEW NATION');
  }
  if (flt && flt.lineDecade) {
    const ld = lineDecades(), he = getLang() === 'he', dec = decadeOf(y);
    const fillPos = POS_ORDER.find(pos => ld[pos] === dec && (POS_SLOTS[pos] || []).some(s => !S.xi[s]));
    const lbl = DECADE_LABEL[dec] || '';
    $('round-label').textContent = fillPos
      ? (he ? 'משלים את ' : 'COMPLETING ') + posTitle(fillPos) + ' · ' + lbl
      : (he ? 'קו חדש, עשור חדש · ' : 'NEW LINE, NEW DECADE · ') + lbl;
  }
  $('squad-spine').textContent = (c + ' · ' + y).toUpperCase();
  const sf = $('squad-flag');
  sf.src = flagSrc(c);
  sf.onerror = function () { this.style.visibility = 'hidden'; };
  sf.style.visibility = '';
  $('squad-title').innerHTML = '';
  $('squad-title').append(c.toUpperCase() + ' ');
  const yr = document.createElement('span');
  yr.className = 'yr';
  yr.textContent = y;
  $('squad-title').appendChild(yr);
  updateSkipBoxes(true);
  updateBoardCount();
  renderDraftMeter();

  const list = $('player-list');
  list.innerHTML = '';
  const squad = availableSquad(c, y).slice().sort((a, b) => b.r - a.r);

  for (const pos of POS_ORDER) {
    const group = squad.filter(p => p.p === pos);
    if (!group.length) continue;
    const rule = document.createElement('div');
    rule.className = 'pos-rule';
    const lbl = document.createElement('span');
    lbl.className = 'pr-label';
    lbl.textContent = posTitle(pos);
    const n = document.createElement('span');
    n.className = 'pos-n';
    n.textContent = group.length;
    rule.append(lbl, n);
    list.appendChild(rule);

    for (const p of group) {
      const row = playerRow(p);
      row.style.animationDelay = Math.min(list.childElementCount * 18, 450) + 'ms';
      list.appendChild(row);
    }
  }
  list.scrollTop = 0;
}

function playerRow(p) {
  const row = document.createElement('div');
  row.className = 'player-row';
  const open = eligibleSlots(p);
  if (!open.length) row.classList.add('dim');

  const idBox = document.createElement('div');
  idBox.className = 'p-id';
  const nm = document.createElement('div');
  nm.className = 'p-name';
  nm.textContent = p.n.toUpperCase();
  const meta = document.createElement('div');
  meta.className = 'p-meta';
  const bits = [p.sp || p.p2 || p.p];
  if (p.club) bits.push(p.club);
  if (p.caps) bits.push(p.caps + ' ' + t('caps'));
  if (p.g) bits.push(p.g + ' ' + t('goals_m'));
  meta.textContent = bits.join(' · ');
  idBox.append(nm, meta);

  const r = document.createElement('div');
  r.className = 'p-rating';
  r.textContent = p.r;

  row.append(idBox, r);
  row.addEventListener('click', () => toggleSlotStrip(row, p));
  return row;
}

function toggleSlotStrip(row, p) {
  const existing = document.querySelector('.slot-strip');
  const wasMine = existing && existing.previousSibling === row;
  if (existing) existing.remove();
  document.querySelectorAll('.player-row.sel').forEach(el => el.classList.remove('sel'));
  if (wasMine) return;

  row.classList.add('sel');
  const strip = document.createElement('div');
  strip.className = 'slot-strip';
  const cap = document.createElement('span');
  cap.className = 't-cap';
  cap.textContent = t('place_at');
  strip.appendChild(cap);
  const f = challengeFlt();
  for (const slot of eligibleSlots(p)) {
    const b = document.createElement('button');
    b.className = 'slot-option';
    // dim slots outside the player's real positions (sp like "RB/CB") — placing
    // there still works but costs rating in the sim
    const token = slot === 'GK' ? 'GK' : slot.startsWith('CB') ? 'CB' : slot.startsWith('CM') ? 'CM' : slot.startsWith('ST') ? 'ST' : slot;
    if (p.sp && !p.sp.split('/').includes(token)) b.classList.add('off-pos');
    b.textContent = SLOT_LABEL[slot];
    if (f && f.slotEra && f.slotEra[slot] != null) b.textContent += ' · ' + DECADE_LABEL[f.slotEra[slot]];
    b.addEventListener('click', (e) => { e.stopPropagation(); place(p, slot); });
    strip.appendChild(b);
  }
  row.after(strip);
  strip.scrollIntoView({ block: 'nearest' });
}

function place(p, slot) {
  if (S.xi[slot]) return;
  if ($('s0').classList.contains('active')) track('legend_pick', { name: p.n });
  S.xi[slot] = p;
  S.used.add(p.c);
  if (S.challengePlan) {
    const e = S.challengePlan.find(x => !x.done && (x.n ? x.n === p.c : x.anyOf.includes(p.c)));
    if (e) e.done = true;
  }
  renderBoard();
  renderPips();
  updateBoardCount();
  renderDraftMeter();
  if (xiCount() >= 11) {
    if (S.jokerOffered) startTournament();
    else { S.jokerOffered = true; showJoker(); }
  } else startDraw(null);
}

function xiCount() { return SLOTS.filter(s => S.xi[s]).length; }

// ── Joker: swap one player for a fresh draw, or keep the XI ──────────────────
function showJoker() {
  show('s-joker');
  $('joker-sub').textContent = t('jk_sub1');
  document.querySelector('.joker-pitch').classList.remove('swap-mode');
  renderPitchInto('joker-slots', true);
  $('joker-swap').style.visibility = 'visible';
}

function enterSwapMode() {
  $('joker-sub').textContent = t('jk_sub2');
  document.querySelector('.joker-pitch').classList.add('swap-mode');
  $('joker-swap').style.visibility = 'hidden';
  renderPitchInto('joker-slots', true, (slot) => {
    const p = S.xi[slot];
    delete S.xi[slot];
    S.used.delete(p.c);
    renderPips();
    updateBoardCount();
    renderDraftMeter();
    startDraw(null);   // one fresh draw, normal rules, fills the vacated slot
  });
}

function renderPips() {
  const box = $('progress-pips');
  box.innerHTML = '';
  const filled = Object.keys(S.xi).length;
  for (let i = 0; i < 11; i++) {
    const d = document.createElement('div');
    d.className = 'pip' + (i < filled ? ' full' : '');
    box.appendChild(d);
  }
}

function updateBoardCount() {
  const n = Object.keys(S.xi).length + '/11';
  $('board-count').textContent = n;
  $('board-count-2').textContent = n;
}

// ── Sprint 1: live control meter on the squad sheet (move 1 lines + move 2 odds) ─
// Lines come straight from computeTeamScores (the same engine the result uses), so
// the weakest line ("soft belly") shows in coral the moment it appears. Title odds
// run the real Monte-Carlo on the current XI, gated to a near-full team (the call
// that matters) and debounced so rapid picks don't churn.
let _oddsTimer = null, _oddsSeq = 0;
function setOdd(id, p) {
  const el = $(id); if (!el) return;
  const pct = p * 100;
  el.textContent = pct >= 9.5 ? Math.round(pct) + '%' : pct >= 0.5 ? pct.toFixed(1) + '%' : '<1%';
}
function renderDraftMeter() {
  const meter = $('draft-meter'); if (!meter) return;
  const placed = xiCount();
  if (placed === 0) { meter.hidden = true; return; }
  meter.hidden = false;
  const sc = computeTeamScores(S.xi);
  const vals = { def: Math.round(sc.defense), mid: Math.round(sc.midfield), att: Math.round(sc.attack) };
  const minV = Math.min(vals.def, vals.mid, vals.att);
  let weakMarked = false;
  for (const key of ['def', 'mid', 'att']) {
    const cell = meter.querySelector('.dm-line[data-line="' + key + '"]'); if (!cell) continue;
    const v = vals[key];
    cell.querySelector('.dm-val').textContent = v;
    cell.querySelector('.dm-bar i').style.width = Math.min(v / 99 * 100, 100) + '%';
    const isWeak = !weakMarked && v === minV;   // only the single softest line wears the coral
    if (isWeak) weakMarked = true;
    cell.className = 'dm-line tier-' + statTier(v) + (isWeak ? ' dm-weak' : '');
  }
  const oddsBox = $('dm-odds'), building = $('dm-building');
  if (placed >= 8) {
    if (building) building.hidden = true;
    oddsBox.hidden = false;
    oddsBox.classList.add('dm-pending');
    const snapshot = { ...S.xi }, seq = ++_oddsSeq;
    if (_oddsTimer) clearTimeout(_oddsTimer);
    _oddsTimer = setTimeout(() => {
      const o = titleOdds(snapshot, S.field, undefined, 200);
      if (seq !== _oddsSeq) return;             // a newer pick already superseded this run
      setOdd('dm-champ', o.champion); setOdd('dm-final', o.final); setOdd('dm-qf', o.qf);
      oddsBox.classList.remove('dm-pending');
    }, 200);
  } else {
    oddsBox.hidden = true;
    if (building) building.hidden = false;
  }
}

// ── Sprint 1: decision room — opponent lines + YOUR live win/advance % ──────────
// The chance recomputes from the user's Elo at the CURRENT mentality (blend + tempo
// from mentalityAt) vs the opponent, using the same Poisson grid the engine samples.
function updateWinPct() {
  const ctx = S.tacCtx, el = $('tac-win-pct'), cap = $('tac-win-cap');
  if (!ctx || !el || !S.simXi) return;
  const m = mentalityAt(S.mentality);
  const uElo = computeTeamElo(S.simXi, { wa: m.wa, wd: m.wd, wm: m.wm });
  const isKO = ctx.stage !== 'GROUP';
  // early KO rounds carry the variance-schedule mods so the shown chance matches the engine
  const p = isKO ? advanceProb(uElo, ctx.oppElo, m.tempo, koMods(ctx.stage)) : matchProb(uElo, ctx.oppElo, m.tempo).win;
  el.textContent = Math.round(p * 100) + '%';
  el.className = 'tac-win-pct ' + (p >= 0.55 ? 'wp-fav' : p <= 0.40 ? 'wp-dog' : 'wp-even');
  if (cap) cap.textContent = isKO ? t('tac_advance') : t('tac_win');
}

// ── S4 board + S6 result pitch (shared renderer) ──────────────────────────────
const CODE3 = {
  'United States': 'USA', 'West Germany': 'FRG', 'East Germany': 'GDR',
  'Soviet Union': 'URS', 'South Korea': 'KOR', 'North Korea': 'PRK',
  'Northern Ireland': 'NIR', 'Republic of Ireland': 'IRL', 'South Africa': 'RSA',
  'Saudi Arabia': 'KSA', 'New Zealand': 'NZL', 'Costa Rica': 'CRC',
  'Czech Republic': 'CZE', 'Czechoslovakia': 'TCH', 'Yugoslavia': 'YUG',
  'Serbia and Montenegro': 'SCG', 'Dutch East Indies': 'DEI', 'DR Congo': 'COD',
  'El Salvador': 'SLV', 'Trinidad and Tobago': 'TRI', 'United Arab Emirates': 'UAE',
  'Bosnia and Herzegovina': 'BIH', 'Ivory Coast': 'CIV', 'Cape Verde': 'CPV',
};
function codeOf(c) { return CODE3[c] || c.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(); }

function renderPitchInto(containerId, withMeta, onSlotTap, showGoals) {
  const box = $(containerId);
  box.innerHTML = '';
  // per-slot goal tally — mirrors the share card, shown on the result pitch
  const goalsBySlot = {};
  if (showGoals && S.journey) {
    for (const m of (S.journey.journey || [])) for (const s of (m.scorers || [])) if (s.slot) goalsBySlot[s.slot] = (goalsBySlot[s.slot] || 0) + 1;
  }
  for (const slot of SLOTS) {
    const [x, y] = SLOT_XY[slot];
    const d = document.createElement('div');
    d.className = 'b-slot' + (S.xi[slot] ? ' filled' : '');
    d.dataset.slot = slot;
    d.style.left = x + '%';
    d.style.top = y + '%';
    if (onSlotTap && S.xi[slot]) d.addEventListener('click', () => onSlotTap(slot));

    const posEl = document.createElement('span');
    posEl.className = 'b-pos';
    posEl.textContent = SLOT_LABEL[slot];
    d.appendChild(posEl);

    if (S.xi[slot]) {
      const p = S.xi[slot];
      const f = document.createElement('div');
      f.className = 'b-fill';

      // the colored "magnet": nation-kit jersey, sits above the chalk
      const jersey = document.createElement('div');
      jersey.className = 'b-jersey';
      jersey.innerHTML = jerseySVG(p.c, 46);
      // small flag badge pinned on the jersey collar (nice touch, keeps makeFlag)
      const badge = makeFlag(p.c, 'b-flag-badge');
      jersey.appendChild(badge);
      // GOLD rating disc, pinned to the jersey (bottom-right) like tactics-B's magnet
      const r = document.createElement('div');
      r.className = 'b-r';
      r.textContent = p.r;
      jersey.appendChild(r);
      // goal tally — gold-ringed disc, top-left of the jersey (only on the result pitch)
      const g = goalsBySlot[slot] || 0;
      if (g > 0) {
        const gb = document.createElement('div');
        gb.className = 'b-goals';
        gb.textContent = g;
        gb.setAttribute('aria-label', (getLang() === 'he' ? 'שערים: ' : 'goals: ') + g);
        jersey.appendChild(gb);
      }
      f.appendChild(jersey);

      const nm = document.createElement('div');
      nm.className = 'b-name';
      nm.textContent = surname(p.n).toUpperCase();
      f.append(nm);
      if (withMeta) {
        const meta = document.createElement('div');
        meta.className = 'b-meta';
        meta.textContent = codeOf(p.c) + ' ' + String(p.y).slice(2);
        f.appendChild(meta);
      }
      d.appendChild(f);
    }
    box.appendChild(d);
  }
}

function renderBoard() { renderPitchInto('board-slots', false); }

// ── S0 hall of legends (captain's pick) ───────────────────────────────────────
const LEGEND_MIN_RATING = 92;

function showLegends() {
  show('s0');
  const list = $('legend-list');
  list.innerHTML = '';
  const f = challengeFlt();
  let cand = S.players;
  if (f) {
    if (f.nations) cand = cand.filter(p => f.nations.includes(p.c));
    if (f.years) cand = cand.filter(p => f.years.includes(p.y));
    if (f.legendPos) cand = cand.filter(p => p.p === f.legendPos);
    cand = cand.filter(p => eligibleSlots(p).length > 0); // pos/cap days drop unplaceable legends
  }
  let legends = cand.filter(p => p.r >= LEGEND_MIN_RATING);
  if (f && f.legendMin && legends.length) {
    const min = legends.reduce((m, p) => Math.min(m, p.r), 99);
    legends = legends.filter(p => p.r === min);
  } else if (f && legends.length < 6) {
    // a filtered day may starve the 92+ hall — fall back to the day's best
    legends = cand.slice().sort((a, b) => b.r - a.r).slice(0, 12);
  }
  legends = legends.slice().sort((a, b) => b.r - a.r);

  for (const pos of POS_ORDER) {
    const group = legends.filter(p => p.p === pos);
    if (!group.length) continue;
    const rule = document.createElement('div');
    rule.className = 'pos-rule';
    const lbl = document.createElement('span');
    lbl.className = 'pr-label';
    lbl.textContent = posTitle(pos);
    const n = document.createElement('span');
    n.className = 'pos-n';
    n.textContent = group.length;
    rule.append(lbl, n);
    list.appendChild(rule);
    for (const p of group) {
      const row = legendRow(p);
      row.style.animationDelay = Math.min(list.childElementCount * 14, 500) + 'ms';
      list.appendChild(row);
    }
  }
  list.scrollTop = 0;
}

function legendRow(p) {
  const row = playerRow(p);
  // add country+year to the meta line — legends come from everywhere
  const meta = row.querySelector('.p-meta');
  meta.textContent = (p.c + ' ' + p.y + ' · ' + meta.textContent).toUpperCase();
  return row;
}

// ── S-PICKYEAR (day 10): pick the World Cup your whole XI is drawn from ────────
// host nations are fixed historical facts — a memory aid only, on each tile
const WC_HOSTS = {
  1930: ['Uruguay', 'אורוגוואי'], 1934: ['Italy', 'איטליה'], 1938: ['France', 'צרפת'],
  1950: ['Brazil', 'ברזיל'], 1954: ['Switzerland', 'שווייץ'], 1958: ['Sweden', 'שוודיה'],
  1962: ['Chile', "צ'ילה"], 1966: ['England', 'אנגליה'], 1970: ['Mexico', 'מקסיקו'],
  1974: ['W. Germany', 'גרמניה'], 1978: ['Argentina', 'ארגנטינה'], 1982: ['Spain', 'ספרד'],
  1986: ['Mexico', 'מקסיקו'], 1990: ['Italy', 'איטליה'], 1994: ['USA', 'ארה״ב'],
  1998: ['France', 'צרפת'], 2002: ['Korea/Japan', 'קוריאה/יפן'], 2006: ['Germany', 'גרמניה'],
  2010: ['South Africa', 'דרום אפריקה'], 2014: ['Brazil', 'ברזיל'], 2018: ['Russia', 'רוסיה'],
  2022: ['Qatar', 'קטאר'], 2026: ['N. America', 'צפון אמריקה']
};

function showPickYear() {
  const grid = $('pickyear-grid');
  grid.innerHTML = '';
  const heIdx = getLang() === 'he' ? 1 : 0;
  // years come straight from the data, so the grid always matches what's drawable
  const years = [...new Set(S.players.map(p => p.y))].sort((a, b) => b - a);
  for (const y of years) {
    const host = WC_HOSTS[y];
    const btn = document.createElement('button');
    btn.className = 'pick-year';
    btn.setAttribute('role', 'listitem');
    const yr = document.createElement('span'); yr.className = 'py-year'; yr.textContent = y;
    const hs = document.createElement('span'); hs.className = 'py-host'; hs.textContent = host ? host[heIdx] : '';
    btn.append(yr, hs);
    btn.addEventListener('click', () => choosePickYear(y));
    grid.appendChild(btn);
  }
  show('s-pickyear');
}

function choosePickYear(y) {
  track('daily_pickyear', { day: 10, year: y });
  // clone the challenge so the injected filter never leaks onto the shared array entry.
  // no rpt: every World Cup has ≥13 nations, plenty for 11 distinct picks — one nation once.
  S.challenge = { ...S.challenge, flt: { years: [y] } };
  S.pickedYear = y;
  S.skips.year = 0;            // the year is locked — kill the "NEW YEAR" reroll
  if (seenHowto()) showLegends(); else showHowto(true);
}

// ── S5 tournament (vidiprinter) ───────────────────────────────────────────────
const stageName = (s) => t('st_' + s);
const stageVerdict = (s) => t('vd_' + s);

function startTournament() {
  // naming step first — the name follows the team everywhere
  if (!S.teamName) {
    show('s-name');
    setTimeout(() => $('team-name').focus(), 150);
    return;
  }
  runTournament();
}

function lockTeamName() {
  const raw = $('team-name').value.trim().toUpperCase().replace(/[<>]/g, '');
  S.teamName = raw || 'YOUR XI';
  runTournament();
}

function runTournament() {
  // build sim XI
  const xiSim = {};
  for (const slot of SLOTS) {
    const p = S.xi[slot];
    // carry g/caps/aw so the personal goal-tendency applies to the user's scorers
    xiSim[slot] = { n: surname(p.n).toUpperCase(), p: p.p, r: p.r, sp: p.sp, g: p.g, caps: p.caps, aw: p.aw };
  }
  S.simXi = xiSim; // kept so the decision room can recompute Elo/odds at any mentality
  // real 2026 squad for every opponent nation — powers opponent scorers + per-line averages
  const squads = {};
  for (const country of Object.values(S.field.groups).flat()) {
    const sq = S.squads.get(country + '|2026');
    if (sq && sq.length >= 11) squads[country] = sq;
  }
  // interactive per-match controller — the user picks a mentality before each match
  S.ctrl = createTournament(xiSim, S.field, squads);
  S.journey = null;
  if (typeof S.mentality !== 'number') S.mentality = 0.5; // default balanced; remembers last drag within a run

  show('s5');
  const feed = $('printer-feed');
  feed.innerHTML = '';
  addLine('faint', t('feed_open'));
  addLine('gold', t('takes_place', S.teamName, S.ctrl.replaced, S.ctrl.groupKey));

  // strength report — FIFA-style rating panel, so every defeat is explainable
  renderStrengthPanel(xiSim, S.ctrl.groupOpponents);

  S.matchNo = 0;
  S.printing = false;
  showTactics(true);
  updateTacticsBar(S.ctrl.next());
  const btn = $('btn-next-match');
  btn.disabled = false;
  btn.textContent = t('run_match', 1);
}

// ── per-match tactics bar (mentality slider + opponent strength read) ──────────
function showTactics(on) { const b = $('tactics-bar'); if (b) b.hidden = !on; }
function mentName(v) {
  const i = Math.round(Math.min(Math.max(v, 0), 1) * 4); // 0..4 → the 5 presets
  return t(['ment_bunker', 'ment_def', 'ment_bal', 'ment_atk', 'ment_allout'][i]);
}
function updateTacticsBar(ctx) {
  if (!ctx) { showTactics(false); S.tacCtx = null; return; }
  showTactics(true);
  S.tacCtx = ctx; // kept so the slider can recompute the live win% as it drags
  const nm = $('tac-opp-name'); if (nm) nm.textContent = ctx.opponent;
  const rd = $('tac-read');
  if (rd) { rd.textContent = t('read_' + ctx.read.label); rd.className = 'tac-read t-cap read-' + ctx.read.label; }
  // opponent's three lines (ATT/MID/DEF) from their real XI — exposed as ctx.oppXi
  const olEl = $('tac-opp-lines');
  if (olEl) {
    olEl.innerHTML = '';
    if (ctx.oppXi) {
      const osc = computeTeamScores(ctx.oppXi);
      [['sp_att', osc.attack], ['sp_mid', osc.midfield], ['sp_def', osc.defense]].forEach(([k, v]) => {
        const s = document.createElement('span'); s.className = 'tac-ol';
        const ik = document.createElement('i'); ik.className = 't-cap'; ik.textContent = t(k);
        const vv = document.createElement('b'); vv.textContent = Math.round(v);
        s.append(ik, vv); olEl.appendChild(s);
      });
    }
  }
  const sl = $('tac-slider');
  if (sl) { sl.value = Math.round(S.mentality * 100); sl.setAttribute('aria-valuetext', mentName(S.mentality)); }
  const cur = $('tac-current'); if (cur) cur.textContent = mentName(S.mentality);
  updateWinPct();
}

function addLine(cls, text) {
  const feed = $('printer-feed');
  const div = document.createElement('div');
  div.className = 'feed-line' + (cls ? ' ' + cls : '');
  div.textContent = text;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return div;
}

function typeLine(cls, html, cb) {
  // letter-by-letter print of plain text, then swap to styled html
  const feed = $('printer-feed');
  const div = document.createElement('div');
  div.className = 'feed-line' + (cls ? ' ' + cls : '');
  feed.appendChild(div);
  const plain = html.replace(/<[^>]+>/g, '');
  let i = 0;
  const t = setInterval(() => {
    i += 2;
    div.textContent = plain.slice(0, i);
    feed.scrollTop = feed.scrollHeight;
    if (i >= plain.length) {
      clearInterval(t);
      div.innerHTML = html;
      feed.scrollTop = feed.scrollHeight;
      if (cb) cb();
    }
  }, 14);
}

function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

function nextMatch() {
  if (S.printing) return;
  const ctrl = S.ctrl;
  const ctx = ctrl && ctrl.next();
  if (!ctx) { finishTournament(); return; }
  S.printing = true;
  const btn = $('btn-next-match');
  btn.disabled = true;
  showTactics(false); // lock the approach while the match prints

  const m = ctrl.play(mentalityAt(S.mentality));
  S.matchNo++;
  const stageTag = m.stage === 'GROUP' ? t('group_match', ctx.groupNo, ctrl.groupKey) : stageName(m.stage);
  const win = m.scoreFor > m.scoreAgainst || (m.note && m.note.startsWith('(pens') && m.winnerIsA);

  renderScoreboard(m, stageTag, () => {
    if (m.stage !== 'GROUP' && win) flashWin();
    const nextCtx = ctrl.next();
    const groupEnded = m.stage === 'GROUP' && (!nextCtx || nextCtx.stage !== 'GROUP');
    if (groupEnded) printGroupTable(ctrl.finish());
    if (!nextCtx) {
      const J = ctrl.finish();
      addLine('verdict', stageVerdict(J.finalStage));
      if (J.finalStage === 'CHAMPION') flashWin();
      btn.textContent = t('full_time');
    } else {
      updateTacticsBar(nextCtx);
      btn.textContent = nextCtx.stage === 'GROUP' ? t('run_match', nextCtx.groupNo) : t('play_stage', stageName(nextCtx.stage));
    }
    btn.disabled = false;
    S.printing = false;
  });
}

// FIFA-style team rating panel printed before the first match
function statTier(v) { return v >= 75 ? 'good' : v >= 60 ? 'mid' : 'low'; }

function renderStrengthPanel(xiSim, groupOpps) {
  const sc = computeTeamScores(xiSim);
  const elo = Math.round(computeTeamElo(xiSim));
  const stats = [
    { label: t('sp_att'), v: Math.round(sc.attack) },
    { label: t('sp_mid'), v: Math.round(sc.midfield) },
    { label: t('sp_def'), v: Math.round(sc.defense) },
  ];
  const weak = stats.reduce((a, b) => a.v <= b.v ? a : b);

  const panel = document.createElement('div');
  panel.className = 'strength-panel';

  const head = document.createElement('div');
  head.className = 'sp-head';
  const hLabel = document.createElement('span');
  hLabel.className = 'sp-title';
  hLabel.textContent = S.teamName;
  const ovr = document.createElement('span');
  ovr.className = 'sp-ovr';
  ovr.textContent = elo;
  const ovrCap = document.createElement('span');
  ovrCap.className = 'sp-ovr-cap';
  ovrCap.textContent = t('sp_elo');
  head.append(hLabel, ovr, ovrCap);
  panel.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'sp-stats';
  for (const st of stats) {
    const cell = document.createElement('div');
    cell.className = 'sp-stat tier-' + statTier(st.v) + (st === weak ? ' sp-weakest' : '');
    const num = document.createElement('div');
    num.className = 'sp-num';
    num.textContent = st.v;
    const bar = document.createElement('div');
    bar.className = 'sp-bar';
    const fill = document.createElement('i');
    fill.style.width = Math.min(st.v / 99 * 100, 100) + '%';
    bar.appendChild(fill);
    const lbl = document.createElement('div');
    lbl.className = 'sp-label';
    lbl.textContent = st.label + (st === weak ? t('weak_link') : '');
    cell.append(num, bar, lbl);
    grid.appendChild(cell);
  }
  panel.appendChild(grid);

  const oppsBox = document.createElement('div');
  oppsBox.className = 'sp-opps';
  groupOpps.forEach((o, i) => {
    const oe = Math.round(S.field.strengths[o] || 1700);
    const row = document.createElement('div');
    row.className = 'sp-opp';
    const mn = document.createElement('span');
    mn.className = 'sp-opp-m';
    mn.textContent = 'M' + (i + 1);
    row.appendChild(mn);
    row.appendChild(makeFlag(o));
    const nm = document.createElement('span');
    nm.className = 'sp-opp-n';
    nm.textContent = o.toUpperCase();
    const bar = document.createElement('div');
    bar.className = 'sp-opp-bar';
    const fill = document.createElement('i');
    const pct = Math.min(Math.max((oe - 1450) / 650 * 100, 6), 100); // span the real 1455–2085 field
    fill.style.width = pct + '%';
    if (oe >= elo) fill.classList.add('stronger');
    bar.appendChild(fill);
    const ev = document.createElement('span');
    ev.className = 'sp-opp-e';
    ev.textContent = oe;
    row.append(nm, bar, ev);
    // per-line averages for this opponent, from its real 2026 XI (request 3א)
    const sq = S.squads.get(o + '|2026');
    if (sq && sq.length >= 11) {
      const osc = computeTeamScores(buildOpponentXiObject(sq));
      const lines = document.createElement('div');
      lines.className = 'sp-opp-lines';
      [['ATT', osc.attack], ['MID', osc.midfield], ['DEF', osc.defense]].forEach(([k, v]) => {
        const s = document.createElement('span');
        s.className = 'sp-opp-line';
        const ik = document.createElement('i'); ik.textContent = k;
        s.append(ik, document.createTextNode(' ' + Math.round(v)));
        lines.appendChild(s);
      });
      row.appendChild(lines);
    }
    oppsBox.appendChild(row);
  });
  panel.appendChild(oppsBox);

  const feed = $('printer-feed');
  feed.appendChild(panel);
  feed.scrollTop = feed.scrollHeight;
}

// stadium scoreboard block: flags, codes, big counting score, scorers
function renderScoreboard(m, stageTag, cb) {
  const feed = $('printer-feed');
  const sb = document.createElement('div');
  sb.className = 'scoreboard';

  const stage = document.createElement('div');
  stage.className = 'sb-stage';
  stage.textContent = stageTag;
  sb.appendChild(stage);

  const row = document.createElement('div');
  row.className = 'sb-row';

  const mkSide = (label, country, lines) => {
    const side = document.createElement('div');
    side.className = 'sb-team';
    if (country) side.appendChild(makeFlag(country));
    else {
      const you = document.createElement('div');
      you.className = 'sb-you';
      you.textContent = 'XI';
      side.appendChild(you);
    }
    const code = document.createElement('div');
    code.className = 'sb-code';
    code.textContent = label;
    side.appendChild(code);
    if (lines) {
      const ovr = document.createElement('div'); ovr.className = 'sb-ovr-mini'; ovr.textContent = lines.ovr;
      const ln = document.createElement('div'); ln.className = 'sb-team-lines';
      ln.textContent = 'ATT ' + lines.att + ' · MID ' + lines.mid + ' · DEF ' + lines.def;
      side.append(ovr, ln);
    }
    return side;
  };
  // opponent per-line averages, shown under their name in EVERY match
  let oppLines = null;
  const oppSq = S.squads.get(m.opponent + '|2026');
  if (oppSq && oppSq.length >= 11) {
    const osc = computeTeamScores(buildOpponentXiObject(oppSq));
    oppLines = { ovr: Math.round((osc.attack + osc.midfield + osc.defense) / 3),
      att: Math.round(osc.attack), mid: Math.round(osc.midfield), def: Math.round(osc.defense) };
  }

  const scoreBox = document.createElement('div');
  scoreBox.className = 'sb-score';
  const sFor = document.createElement('span');
  const dash = document.createElement('span');
  dash.className = 'sb-dash';
  dash.textContent = '–';
  const sAg = document.createElement('span');
  sFor.textContent = '0';
  sAg.textContent = '0';
  scoreBox.append(sFor, dash, sAg);

  row.append(mkSide(S.teamName.length > 10 ? S.teamName.slice(0, 9) + '…' : S.teamName, null), scoreBox, mkSide(codeOf(m.opponent), m.opponent, oppLines));
  sb.appendChild(row);

  if (m.note) {
    const note = document.createElement('div');
    note.className = 'sb-note';
    note.textContent = m.note;
    sb.appendChild(note);
  }

  const scorersBox = document.createElement('div');
  scorersBox.className = 'sb-scorers';
  sb.appendChild(scorersBox);

  feed.appendChild(sb);
  feed.scrollTop = feed.scrollHeight;

  // count the score up like a stadium board
  const maxScore = Math.max(m.scoreFor, m.scoreAgainst);
  let step = 0;
  const t = setInterval(() => {
    step++;
    sFor.textContent = Math.min(step, m.scoreFor);
    sAg.textContent = Math.min(step, m.scoreAgainst);
    if (step >= maxScore) {
      clearInterval(t);
      sb.classList.add('sb-final');
      // two columns: your goals (with assists) on your side, the opponent's on theirs
      const mkGoals = (list, side) => {
        const col = document.createElement('div');
        col.className = 'sb-goal-col sb-goal-' + side;
        for (const sc of (list || [])) {
          const line = document.createElement('div');
          line.className = 'sb-goal';
          const min = document.createElement('span'); min.className = 'sb-min'; min.textContent = sc.minute + "'";
          const nm = document.createElement('span'); nm.className = 'sb-gname'; nm.textContent = sc.name;
          line.append(min, nm);
          if (sc.assist) { const a = document.createElement('span'); a.className = 'sb-assist'; a.textContent = sc.assist; line.appendChild(a); }
          col.appendChild(line);
        }
        return col;
      };
      scorersBox.append(mkGoals(m.scorers, 'you'), mkGoals(m.opponentScorers, 'opp'));
      feed.scrollTop = feed.scrollHeight;
      if (cb) cb();
    }
  }, maxScore > 0 ? 380 : 60);
}

function printGroupTable(J) {
  addLine('faint', t('final_table', J.groupKey));
  const name = (tm) => tm === 'USER_XI' ? S.teamName : tm.toUpperCase();
  J.groupTable.forEach((r, i) => {
    const gd = r.gf - r.ga;
    const line = ' ' + (i + 1) + '  ' + name(r.team).slice(0, 14).padEnd(15) +
      String(r.pts).padStart(2) + 'PTS  ' + (gd >= 0 ? '+' : '') + gd;
    addLine(r.team === 'USER_XI' ? 'gold' : 'faint', line);
  });
  const TH = { 1: t('through1'), 2: t('through2'), 3: t('through3') };
  if (J.finalStage !== 'GROUP_EXIT') addLine('gold', '— ' + (TH[J.rank] || t('through')) + ' —');
}

function flashWin() {
  const f = document.createElement('div');
  f.className = 'win-flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 650);
}

function finishTournament() {
  if (S.ctrl) S.journey = S.ctrl.finish();
  showTactics(false);
  showResult();
}

// ── stage-2 win conditions — checked from the journey + the XI ────────────────
const STAGE_RANK = { GROUP_EXIT: 0, R32: 1, R16: 2, QF: 3, SF: 4, F: 5, CHAMPION: 6 };

// ── GloryScore (move 5): one continuous score where the STAGE always dominates ──
// and the goal-difference only breaks ties WITHIN a stage. No leagues, no knockout
// streak bonus (Mosh dropped both — advancing already rewards depth). Met-the-rule
// stays a ✓ badge / late tiebreak, never overrides position. Computed entirely on
// the client from fields already stored per row (stage + gd) — no Supabase change.
const GLORY_PTS = { GROUP_EXIT: 0, R32: 10, R16: 25, QF: 50, SF: 90, F: 140, CHAMPION: 200 };
const gloryScore = (r) => (GLORY_PTS[r.stage] ?? 0) + (r.gd || 0);

// ── Day 9 "Worst Average": weakest XI that runs furthest. The board score scales
// GloryScore by how weak the XI is, so depth is still required (a weak side that
// loses early scores almost nothing) while a weak side that runs deep leaps over a
// strong one at the same stage. Every 40 average-rating points below 80 doubles the
// score; only this day scales — every other day stays plain GloryScore.
const WEAK_BASE = 80, WEAK_SPAN = 40;
const weaknessMult = (avg) => 1 + Math.max(0, WEAK_BASE - (avg || WEAK_BASE)) / WEAK_SPAN;
const boardScore = (r) => r.day === 9 ? Math.round(gloryScore(r) * weaknessMult(r.avg)) : gloryScore(r);

// "Your best today" — the day's top GloryScore, kept per ISO date in localStorage.
const GLORY_BEST_KEY = 'gxi_glory_best';
function gloryBest(date) {
  try { return (JSON.parse(localStorage.getItem(GLORY_BEST_KEY) || '{}')[date]) || 0; }
  catch (_) { return 0; }
}
function recordGloryBest(date, score) {
  try {
    const all = JSON.parse(localStorage.getItem(GLORY_BEST_KEY) || '{}');
    const prev = all[date] || 0;
    if (score > prev) { all[date] = score; localStorage.setItem(GLORY_BEST_KEY, JSON.stringify(all)); return { best: score, isNew: true, prev }; }
    return { best: prev, isNew: false, prev };
  } catch (_) { return { best: score, isNew: true }; }
}

function _goalsBySlot(J) {
  const g = {};
  for (const m of J.journey) for (const s of (m.scorers || [])) if (s.slot) g[s.slot] = (g[s.slot] || 0) + 1;
  return g;
}

// which of your players actually satisfied a goal-based daily challenge — for the share-card indicator
function _challengeSatisfiers(c, J) {
  if (!c || !c.win || !J) return [];
  const g = _goalsBySlot(J);
  const out = [], seen = new Set();
  const add = (slot) => {
    if (g[slot] && !seen.has(slot) && S.xi[slot]) {
      seen.add(slot);
      out.push({ name: surname(S.xi[slot].n).toUpperCase(), goals: g[slot] });
    }
  };
  for (const w of c.win) {
    if (w.k === 'scorerPos') Object.keys(g).forEach(s => { if (S.xi[s] && S.xi[s].p === w.pos) add(s); });
    else if (w.k === 'topScorer') { const mx = Math.max(0, ...Object.values(g)); Object.keys(g).forEach(s => { if (g[s] === mx) add(s); }); }
    else if (w.k === 'strikers') ['ST1', 'ST2'].forEach(add);
    else if (w.k === 'hatTrick') {
      for (const m of J.journey) { const per = {}; for (const sc of (m.scorers || [])) if (sc.slot && (per[sc.slot] = (per[sc.slot] || 0) + 1) >= 3) add(sc.slot); }
    }
  }
  return out;
}

function evalCond(w, J) {
  const journey = J.journey;
  switch (w.k) {
    case 'scorerPos':   // n goals by players of this natural position (day 4, 16)
      return journey.reduce((n, m) => n + (m.scorers || []).filter(s => s.p === w.pos).length, 0) >= (w.n || 1);
    case 'topScorer': { // your top scorer's position / rating ceiling (day 12, 25)
      const g = _goalsBySlot(J);
      const max = Math.max(0, ...Object.values(g));
      if (!max) return false;
      const tops = Object.keys(g).filter(s => g[s] === max).map(s => S.xi[s]).filter(Boolean);
      return tops.some(p => (!w.pos || p.p === w.pos) && (w.maxR == null || p.r <= w.maxR));
    }
    case 'rank1': return J.rank === 1;                                  // day 17
    case 'result':      // an exact score, optionally knockout-only (day 18, 31)
      return journey.some(m => m.scoreFor === w.gf && m.scoreAgainst === w.ga && (!w.ko || m.stage !== 'GROUP'));
    case 'hatTrick':    // 3+ goals by one player in one match (day 23)
      return journey.some(m => {
        const per = {};
        for (const s of (m.scorers || [])) if (s.slot && (per[s.slot] = (per[s.slot] || 0) + 1) >= 3) return true;
        return false;
      });
    case 'stage': return STAGE_RANK[J.finalStage] >= STAGE_RANK[w.min]; // day 24, 26
    case 'maxGA': return J.record.ga <= w.n && J.finalStage !== 'GROUP_EXIT'; // day 34
    case 'perfect':     // champion, all wins, none past 90 minutes (day 35)
      return J.finalStage === 'CHAMPION' && journey.every(m => !m.note && m.scoreFor > m.scoreAgainst);
    case 'champion': return J.finalStage === 'CHAMPION';                // day 39
    case 'strikers': {  // both STs at min rating, each with the goal quota (day 19)
      const g = _goalsBySlot(J);
      return ['ST1', 'ST2'].every(s => S.xi[s] && S.xi[s].r >= w.minR && (g[s] || 0) >= w.goals);
    }
    case 'decades':     // XI covers all 9 World Cup decades (legacy)
      return new Set(Object.values(S.xi).map(p => decadeOf(p.y))).size >= ALL_DECADES;
    case 'timeMap': {   // each era-locked slot holds a player of its decade (day 7)
      const f = challengeFlt();
      if (!f || !f.slotEra) return false;
      return Object.entries(f.slotEra).every(([s, dec]) => S.xi[s] && decadeOf(S.xi[s].y) === dec);
    }
    case 'anyNation':   // at least one player from this set (day 11)
      return Object.values(S.xi).some(p => w.nations.includes(p.c));
    default: return true;
  }
}

function evalChallenge(c, J) {
  let ok = null;
  if (c.req) {
    // count-based: the same nation may be required more than once (Israel ×2)
    const counts = {};
    Object.values(S.xi).forEach(p => { counts[p.c] = (counts[p.c] || 0) + 1; });
    const need = {};
    c.req.forEach(n => { need[n] = (need[n] || 0) + 1; });
    ok = Object.entries(need).every(([n, k]) => (counts[n] || 0) >= k);
  }
  if (c.win) {
    const all = c.win.every(w => evalCond(w, J));
    ok = ok === null ? all : ok && all;
  }
  // pure-filter days: surviving the restriction IS the challenge
  if (ok === null && c.flt) ok = true;
  return ok;
}

// ── the day's achievement dimension — the board ranks on the daily CHALLENGE ──
// (e.g. day 4 = defender goals), not a generic best run. Order everywhere:
// met-the-rule first, then this magnitude, then furthest, then goal-diff.
const MARK_METRIC = { 6: 'keeperRun', 9: 'lowAvg', 13: 'lowAvg', 19: 'mostGoals', 24: 'fewestTries', 30: 'mostGoals', 31: 'cleanest', 34: 'cleanest' };
const markMetric = (c) => (c && MARK_METRIC[c.d]) || 'furthest';
const shortStage = (s) => s === 'CHAMPION' ? t('rs_champ') : s === 'GROUP_EXIT' ? t('st_GROUP') : t('st_' + s);

function _posGoals(J, pos) { let n = 0; for (const m of J.journey) for (const s of (m.scorers || [])) if (s.p === pos) n++; return n; }

// the challenge objective drives the dimension; filter/social days fall back to the mark metric
function dayDimension(c) {
  const w = c && c.win && c.win[0];
  if (w) {
    if (w.k === 'scorerPos') return 'posGoals';
    if (w.k === 'strikers')  return 'strikerGoals';
    if (w.k === 'topScorer') return 'topGoals';
    if (w.k === 'hatTrick')  return 'hatTrick';
    if (w.k === 'maxGA')     return 'cleanest';
  }
  return markMetric(c);
}

// higher = better; stored as `sv`, used as the ranking magnitude right after "met the rule"
function challengeValue(c, J) {
  const R = J.record, g = _goalsBySlot(J);
  switch (dayDimension(c)) {
    case 'posGoals':     return _posGoals(J, c.win[0].pos);
    case 'strikerGoals': return (g.ST1 || 0) + (g.ST2 || 0);
    case 'topGoals':     return Math.max(0, 0, ...Object.values(g));
    case 'hatTrick':     { let mx = 0; for (const m of J.journey) { const per = {}; for (const s of (m.scorers || [])) if (s.slot) { per[s.slot] = (per[s.slot] || 0) + 1; if (per[s.slot] > mx) mx = per[s.slot]; } } return mx; }
    case 'cleanest':     return -R.ga;
    case 'keeperRun':    { const gk = S.xi.GK ? S.xi.GK.r : 65; return (STAGE_RANK[J.finalStage] ?? 0) * 100 + (65 - gk); }
    case 'lowAvg':       return -Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11);
    case 'mostGoals':    return R.gf;
    case 'fewestTries':  return -(S.tryNo || 0);
    default:             return 0;
  }
}

// localized compact display of the day's achievement, from a row-like {sv,ga,avg,gf,tries,gd}
function dimDetail(dim, r, he) {
  const sv = r.sv || 0;
  switch (dim) {
    case 'posGoals':     return sv + (he ? ' שערי מגן' : ' def goals');
    case 'strikerGoals': return sv + (he ? ' שערי חלוץ' : ' striker goals');
    case 'topGoals':     return sv + (he ? ' שערי המלך' : ' top-scorer goals');
    case 'hatTrick':     return (he ? 'שיא ' : 'best ') + sv + (he ? ' במשחק' : '/match');
    case 'cleanest':     return r.ga + (he ? ' ספיגות' : ' conceded');
    case 'keeperRun':    return (he ? 'שוער ' : 'keeper ') + (r.gk_r != null ? r.gk_r : '?');
    case 'lowAvg':       return (he ? 'ממוצע ' : 'avg ') + r.avg;
    case 'mostGoals':    return r.gf + (he ? ' שערים' : ' goals');
    case 'fewestTries':  return (r.tries || '?') + (he ? ' ניסיונות' : ' tries');
    default:             return '(' + (r.gd >= 0 ? '+' : '') + r.gd + ')';
  }
}

function challengeMark(c, J) {
  if (!c || !J) return '';
  const he = getLang() === 'he', R = J.record;
  const r = { sv: challengeValue(c, J), ga: R.ga, avg: Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11), gf: R.gf, tries: S.tryNo || 0, gd: R.gf - R.ga, gk_r: S.xi.GK ? S.xi.GK.r : null };
  // day 10: lead with the World Cup the player chose — that's the whole story
  const wc = (c.pickYear && c.flt && c.flt.years) ? t('picky_mark', c.flt.years[0]) + ' · ' : '';
  return wc + (he ? 'ההישג שלך: ' : 'YOUR MARK: ') + dimDetail(dayDimension(c), r, he) + ' · ' + shortStage(J.finalStage);
}

// human-readable evidence of HOW you met (or missed) a win-condition day — '' for filter/social days
function challengeProof(c, J) {
  if (!c || !c.win || !J) return '';
  const he = getLang() === 'he', ev = (en, h) => he ? h : en;
  const ok = S.challengeOk === true, w = c.win[0];
  const sat = _challengeSatisfiers(c, J);
  const name = sat[0] && sat[0].name;
  switch (w.k) {
    case 'scorerPos': return name ? ev(name + ' SCORED FROM THE BACK', name + ' כבש מההגנה') : ev('NO DEFENDER SCORED', 'אף מגן לא כבש');
    case 'topScorer': return ok ? ev((name || 'YOUR TOP SCORER') + ' LED THE SCORING', (name || 'מלך השערים') + ' הוביל בכיבושים') : ev("TOP SCORER DIDN'T FIT THE RULE", 'מלך השערים לא תאם את החוק');
    case 'rank1':     return ok ? ev('FINISHED TOP OF THE GROUP', 'סיימת ראשון בבית') : ev("DIDN'T TOP THE GROUP", 'לא סיימת ראשון בבית');
    case 'result':    return ok ? ev('WON ' + w.gf + '-' + w.ga + (w.ko ? ' IN THE KNOCKOUT' : ''), 'ניצחת ' + w.gf + '-' + w.ga + (w.ko ? ' בנוקאאוט' : '')) : ev('NO ' + w.gf + '-' + w.ga + (w.ko ? ' KNOCKOUT WIN' : ' WIN'), 'לא היה ניצחון ' + w.gf + '-' + w.ga);
    case 'stage':     return ok ? ev('REACHED THE ' + shortStage(w.min), 'הגעת ל' + shortStage(w.min)) : ev('FELL SHORT OF THE ' + shortStage(w.min), 'לא הגעת ל' + shortStage(w.min));
    case 'maxGA':     return ok ? ev('CONCEDED ONLY ' + J.record.ga, 'ספגת ' + J.record.ga + ' בלבד') : ev('CONCEDED ' + J.record.ga, 'ספגת ' + J.record.ga);
    case 'perfect':   return ok ? ev("7 WINS, ALL IN 90'", '7 ניצחונות, הכל בזמן חוקי') : ev('NOT A PERFECT RECORD', 'המאזן לא היה מושלם');
    case 'champion':  return ok ? ev('LIFTED THE CUP', 'הרמת את הגביע') : ev("DIDN'T WIN IT", 'לא זכית בגביע');
    case 'decades': { const cov = new Set(Object.values(S.xi).map(p => decadeOf(p.y))).size; return ok ? ev('ALL 9 DECADES COVERED', 'כל 9 העשורים כוסו') : ev(cov + ' OF 9 DECADES', cov + ' מתוך 9 עשורים'); }
    case 'timeMap':   return ok ? ev('TIME MAP COMPLETE — 9 DECADES', 'מפת הזמן הושלמה, 9 עשורים') : ev('TIME MAP INCOMPLETE', 'מפת הזמן לא הושלמה');
    case 'anyNation': { const hit = Object.values(S.xi).find(p => w.nations.includes(p.c)); return hit ? ev('FIELDED ' + hit.c.toUpperCase(), 'שיבצת את ' + hit.c) : ev('NO NATION PLAYING TODAY', 'אף נבחרת ששיחקה היום'); }
    case 'hatTrick':  return ok ? ev((name || 'A PLAYER') + ' SCORED A HAT-TRICK', (name || 'שחקן') + ' עשה שלושער') : ev('NO HAT-TRICK', 'לא היה שלושער');
    case 'strikers':  return ok ? ev('BOTH STRIKERS DELIVERED', 'שני החלוצים סיפקו') : ev('STRIKERS FELL SHORT', 'החלוצים לא סיפקו');
    default: return '';
  }
}

// ── daily leaderboard: build the submit row + the nickname / sent UI ──────────
function buildScoreRow(c, J) {
  const R = J.record;
  const avg = Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11);
  // your XI's best-placed scorer/assister in the FULL tournament ranking (name + count + rank)
  const ms = J.myBestScorer, ma = J.myBestAssister;
  return {
    day: c.d, game_date: c.date, nick: getNick(),
    team: (S.teamName || '').slice(0, 30),
    stage: J.finalStage, stage_rank: STAGE_RANK[J.finalStage] ?? 0,
    ok: S.challengeOk, metric: markMetric(c), sv: challengeValue(c, J),
    avg, gd: R.gf - R.ga, gf: R.gf, ga: R.ga, tries: S.tryNo || 0,
    gk_r: S.xi.GK ? S.xi.GK.r : null,
    top_scorer: ms ? String(ms.name).slice(0, 40) : null,
    top_scorer_g: ms ? ms.n : null,
    top_scorer_rank: ms ? ms.rank : null,
    top_assister: ma ? String(ma.name).slice(0, 40) : null,
    top_assist_a: ma ? ma.n : null,
    top_assist_rank: ma ? ma.rank : null,
    // day 10 only: the World Cup this run was built from (needs a wc_year column on the table)
    ...(c.pickYear && c.flt && c.flt.years ? { wc_year: c.flt.years[0] } : {}),
    // private leagues: the run counts for EVERY league you're in (parallel arrays).
    // never added for solo players, so their inserts are unaffected.
    ...(getLeagues().length ? { league_codes: getLeagues().map(l => l.code), league_names: getLeagues().map(l => l.name) } : {}),
  };
}

function markSent(nick) {
  $('lb-sent').textContent = t('lb_sent', nick);
  $('lb-sent').hidden = false; $('lb-change').hidden = false; $('lb-setnick').hidden = true;
}

// the board is a board of RUNS: every finished run is its own line. we remember the
// row ids this device created so we can highlight all of ours.
const MYROWS_KEY = 'gxi_my_rows';
function myRowIds(date) {
  try { const all = JSON.parse(localStorage.getItem(MYROWS_KEY) || '{}'); return new Set(all[date] || []); }
  catch (_) { return new Set(); }
}
function rememberMyRow(date, id) {
  try {
    const all = JSON.parse(localStorage.getItem(MYROWS_KEY) || '{}');
    const arr = all[date] || [];
    if (!arr.includes(id)) arr.push(id);
    all[date] = arr; localStorage.setItem(MYROWS_KEY, JSON.stringify(all));
  } catch (_) { /* private mode — skip */ }
}

// A finished run is submitted exactly ONCE, when you leave the result screen, using
// the final name you chose. So you can rename it freely after seeing your result and
// it still lands as a single line (the backend only allows inserts, not edits).
let lbSubmitPromise = null;
function flushPendingRun() {
  const p = S.lbPending;
  if (!p || S.lbSubmitted) return lbSubmitPromise || Promise.resolve();
  S.lbSubmitted = true;
  if (!p.name) return Promise.resolve();
  const row = { ...p.row, nick: p.name };
  lbSubmitPromise = submitDailyScore(row).then(rec => {
    if (rec && rec.id != null) { S.lbRowId = rec.id; rememberMyRow(p.date, rec.id); }
  });
  track('lb_submit', { day: p.day });
  return lbSubmitPromise;
}

function renderLeaderboardRow(c, J) {
  const row = $('lb-row');
  if (!row) return;
  if (!c || !lbConfigured()) { row.hidden = true; return; }   // feature off until backend configured
  row.hidden = false;
  $('lb-view').hidden = false;
  // snapshot the run now (survives a later resetGame); the name defaults to the XI you
  // played with and you can rename it before leaving the screen.
  S.lbRowId = null; S.lbSubmitted = false; lbSubmitPromise = null;
  const name = (S.teamName || getNick() || '').trim().slice(0, 20);
  S.lbPending = { row: buildScoreRow(c, J), date: c.date, day: c.d, name };
  if (name) { setNick(name); markSent(name); }
  else { $('lb-sent').hidden = true; $('lb-change').hidden = true; $('lb-setnick').hidden = false; $('lb-nick').value = ''; }
}

// ── in-app live leaderboard ───────────────────────────────────────────────────
// ranking order = met the daily rule, then the challenge magnitude (sv), then
// furthest, then goal-diff. Every finished RUN is its own line — play 100 times,
// get 100 lines, each ranked where it lands. No collapsing by name.
const okRank = (r) => r.ok === true ? 2 : r.ok === false ? 0 : 1;
// gate-first on challenge (win) days: meeting the daily rule is the price of entry,
// so every passer ranks above every non-passer regardless of how deep they ran —
// then GloryScore (stage dominates, gd breaks within-stage ties), then the day's
// special magnitude (sv), then raw goal-diff. On filter/social days ok is null for
// everyone, so okRank is inert and GloryScore leads exactly as before.
const lbCmp = (a, b) => okRank(b) - okRank(a) || boardScore(b) - boardScore(a) || (b.sv || 0) - (a.sv || 0) || b.gd - a.gd;
function rankBoard(rows) {
  const ranked = rows.filter(r => (r.nick || '').trim()).sort(lbCmp);
  return { ranked, count: ranked.length };
}
// board view pills: "everyone" + one pill per league you're in. S.boardView holds
// 'global' or a league code. With no leagues there's nothing to switch — pills hidden.
function renderBoardScopePills(leagues) {
  const el = $('board-scope'); if (!el) return;
  if (!leagues.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false; el.innerHTML = '';
  const mk = (view, label) => {
    const b = document.createElement('button');
    b.className = 'scope-btn' + (S.boardView === view ? ' on' : '');
    b.dir = 'auto'; b.textContent = label;
    b.addEventListener('click', () => { if (S.boardView !== view) { S.boardView = view; openBoard(S.boardChallenge); } });
    return b;
  };
  el.appendChild(mk('global', t('lg_global')));
  leagues.forEach(l => el.appendChild(mk(l.code, l.name)));
}

async function openBoard(c, ret) {
  if (!c || !lbConfigured()) return;
  if (ret) S.boardReturn = ret;
  S.boardChallenge = c;
  const leagues = getLeagues();
  // resolve the active view: a league you're still in, else everyone
  const viewing = (S.boardView && S.boardView !== 'global') ? leagues.find(l => l.code === S.boardView) : null;
  if (!viewing) S.boardView = 'global';
  renderBoardScopePills(leagues);
  $('board-title').textContent = viewing ? viewing.name : ('DAILY #' + c.d + ' · ' + chTitle(c));
  $('board-sub').textContent = viewing ? ('DAILY #' + c.d + ' · ' + c.date) : c.date;
  const bestToday = gloryBest(c.date), bestEl = $('board-best');
  if (bestEl) { if (bestToday > 0) { bestEl.textContent = t('gs_board_best', bestToday); bestEl.hidden = false; } else bestEl.hidden = true; }
  $('board-list').innerHTML = '';
  const st = $('board-state'); st.hidden = false; st.textContent = t('lb_loading');
  show('s-board');
  await flushPendingRun();   // make sure a just-finished run is in before we read the board
  const rows = await fetchBoard(c.date, viewing ? viewing.code : null);
  if (rows === null) { st.textContent = t('lb_error'); return; }
  const anyNamed = rows.some(r => (r.nick || '').trim());
  if (!anyNamed) {
    if (viewing) renderLeagueEmpty(st, viewing);   // friendly "invite the crew" state
    else st.textContent = t('lb_empty');
    return;
  }
  st.hidden = true;
  const ctx = { dim: dayDimension(c), he: getLang() === 'he', isWinDay: !!(c.win && c.win.length), myRows: myRowIds(c.date) };
  const list = $('board-list');
  const total = rows.filter(r => (r.nick || '').trim()).length;

  if (viewing) {
    // a single league's runs, as a flat board
    const { ranked } = rankBoard(rows);
    appendRunRows(list, ranked, ctx);
    appendFoot(list, t('lb_players', total));
    return;
  }

  // "everyone" view: solo players first, then private leagues competing (top-5)
  const hasCodes = (r) => Array.isArray(r.league_codes) && r.league_codes.length > 0;
  const { ranked: soloRanked } = rankBoard(rows.filter(r => !hasCodes(r)));
  appendSection(list, t('lg_sec_solo'));
  if (soloRanked.length) appendRunRows(list, soloRanked, ctx);
  else appendFoot(list, ctx.he ? 'אין עדיין משתתפים בודדים היום' : 'no solo players yet today');

  const leaguesAgg = aggregateLeagues(rows.filter(hasCodes));
  if (leaguesAgg.length) {
    appendSection(list, t('lg_sec_leagues'));
    appendLeagueRows(list, leaguesAgg, ctx.he);
  }
  appendFoot(list, t('lb_players', total));
}

// one finished RUN as a board row (shared by the global solo list and a league's own board)
function appendRunRows(list, ranked, ctx) {
  const { dim, he, isWinDay, myRows } = ctx;
  let dividerShown = false;
  ranked.forEach((r, i) => {
    if (isWinDay && !dividerShown && r.ok === false) {
      const dv = document.createElement('li'); dv.className = 'board-divider t-cap';
      dv.textContent = he ? 'מתחת לקו · לא עמדו באתגר היום' : 'below the line · missed today’s rule';
      list.appendChild(dv); dividerShown = true;
    }
    const mine = r.id != null && myRows.has(r.id);
    const li = document.createElement('li');
    li.className = 'board-li' + (mine ? ' me' : '');
    const rank = document.createElement('span'); rank.className = 'b-rank'; rank.textContent = i + 1;
    const nick = document.createElement('span'); nick.className = 'b-nick'; nick.dir = 'auto'; nick.textContent = r.nick;
    if (mine) { const you = document.createElement('span'); you.className = 'b-you t-cap'; you.textContent = ' ' + t('lb_you'); nick.appendChild(you); }
    // GloryScore is the headline number (also the sort key); stage/detail sit below it
    const glory = document.createElement('span'); glory.className = 'b-glory'; glory.textContent = boardScore(r);
    const det = document.createElement('span'); det.className = 'b-det';
    det.textContent = shortStage(r.stage) + ' · ' + dimDetail(dim, r, he)
      + (r.ok === true ? ' ✓' : r.ok === false ? ' ✗' : '')
      + (r.tries ? ' · ' + t('gs_try', r.tries) : '');
    li.append(rank, nick, glory, det);
    // day 10: show which World Cup this run was drawn from
    if (r.wc_year) {
      const wc = document.createElement('span'); wc.className = 'b-wc';
      wc.textContent = t('picky_mark', r.wc_year);
      li.appendChild(wc);
    }
    if (r.top_scorer) {
      const sc = document.createElement('span'); sc.className = 'b-scorer';
      const place = (rk) => rk ? (he ? ' · מקום ' : ' · #') + rk : '';
      let s = (he ? 'מלך השערים ' : 'Top scorer ') + r.top_scorer + place(r.top_scorer_rank) + (r.top_scorer_g != null ? ' (' + r.top_scorer_g + ')' : '');
      if (r.top_assister) s += '  ·  ' + (he ? 'בישולים ' : 'Assists ') + r.top_assister + place(r.top_assist_rank) + (r.top_assist_a != null ? ' (' + r.top_assist_a + ')' : '');
      sc.textContent = s;
      li.appendChild(sc);
    }
    list.appendChild(li);
  });
}
function appendSection(list, label) { const h = document.createElement('li'); h.className = 'board-section t-cap'; h.textContent = label; list.appendChild(h); }
function appendFoot(list, txt) { const foot = document.createElement('li'); foot.className = 'board-foot t-cap'; foot.textContent = txt; list.appendChild(foot); }

// group the day's league runs by league, score each = sum of its best-5 players' runs.
// each row carries parallel league_codes[]/league_names[]; a run feeds every league on it.
function aggregateLeagues(rows) {
  const byCode = new Map();
  for (const r of rows) {
    const codes = Array.isArray(r.league_codes) ? r.league_codes : [];
    const names = Array.isArray(r.league_names) ? r.league_names : [];
    const nick = (r.nick || '').trim();
    const sc = boardScore(r);
    codes.forEach((code, idx) => {
      if (!code) return;
      let g = byCode.get(code);
      if (!g) { g = { code, name: '', best: new Map() }; byCode.set(code, g); }
      if (!g.name && names[idx]) g.name = names[idx];
      if (!nick) return;
      if (!g.best.has(nick) || sc > g.best.get(nick)) g.best.set(nick, sc);   // best run per member
    });
  }
  const out = [];
  for (const g of byCode.values()) {
    const top5 = [...g.best.values()].sort((a, b) => b - a).slice(0, 5);
    out.push({ code: g.code, name: g.name || g.code, members: g.best.size, score: top5.reduce((s, x) => s + x, 0) });
  }
  return out.sort((a, b) => b.score - a.score || b.members - a.members);
}
function appendLeagueRows(list, leagues, he) {
  const mineCodes = new Set(getLeagues().map(l => l.code));
  leagues.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = 'board-li league-li' + (mineCodes.has(g.code) ? ' me' : '');
    const rank = document.createElement('span'); rank.className = 'b-rank'; rank.textContent = i + 1;
    const nick = document.createElement('span'); nick.className = 'b-nick'; nick.dir = 'auto'; nick.textContent = g.name;
    const glory = document.createElement('span'); glory.className = 'b-glory'; glory.textContent = g.score;
    const det = document.createElement('span'); det.className = 'b-det';
    det.textContent = t('lg_members', g.members) + ' · ' + t('lg_top5');
    li.append(rank, nick, glory, det);
    list.appendChild(li);
  });
}

// ── private league: create / join / share ─────────────────────────────────────
// A league is a shared { code, name }. The code travels in the invite link and in
// each score row; the board filters by it. No accounts, no backend beyond one column.
function makeLeagueCode() {
  let s = '';
  while (s.length < 5) s += Math.random().toString(36).slice(2);
  return s.slice(0, 5);
}
function leagueLink(lg) {
  return location.origin + location.pathname + '?liga=' + encodeURIComponent(lg.code) + '&ln=' + encodeURIComponent(lg.name);
}
function shareLeague(lg) {
  const msg = t('lg_invite', lg.name) + '\n' + leagueLink(lg);
  track('league_share', { code: lg.code });
  if (navigator.share) navigator.share({ text: msg }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
function lgBtn(cls, label, onClick) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label;
  b.addEventListener('click', onClick); return b;
}
function copyLeagueLink(lg, btn) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(leagueLink(lg)).then(() => { btn.textContent = t('lg_copied'); setTimeout(() => { btn.textContent = t('lg_copy'); }, 1600); }).catch(() => {});
}
// jump straight into today's challenge — same path as the daily list's PLAY button.
function startTodayChallenge() {
  const c = todayChallenge();
  if (!c) { showDaily(); return; }
  const done = dailyDone();
  if (c.oneShot && done[c.d]) { showDaily(); return; }   // the final: already played
  track('daily_play', { day: c.d, via: 'league' });
  resetGame();
  S.challenge = c;
  S.challengePlan = buildChallengePlan(c);
  bumpTries(c);
  if (c.pickYear) showPickYear();
  else if (seenHowto()) showLegends(); else showHowto(true);
}
// the name + create form (used for the first league and for "new league")
function buildCreateForm(capLabel) {
  const wrap = document.createElement('div'); wrap.className = 'dl-create';
  const cap = document.createElement('div'); cap.className = 't-cap dl-cap'; cap.textContent = capLabel; wrap.appendChild(cap);
  const inp = document.createElement('input');
  inp.className = 'dl-input'; inp.type = 'text'; inp.maxLength = 40; inp.dir = 'auto'; inp.placeholder = t('lg_name_ph');
  wrap.appendChild(inp);
  const create = lgBtn('dl-btn dl-share', t('lg_create'), () => {
    const name = inp.value.trim(); if (!name) { inp.focus(); return; }
    const code = makeLeagueCode();
    addLeague(code, name);
    track('league_create', { code });
    S.boardView = code;
    renderLeaguePanel();
    shareLeague({ code, name });
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create.click(); } });
  wrap.appendChild(create);
  return wrap;
}
// the create/manage card on the daily screen — lists every league you're in
// friendly empty state for a league with no runs yet today: invite + play
function renderLeagueEmpty(st, lg) {
  st.hidden = false; st.innerHTML = '';
  const msg = document.createElement('p'); msg.className = 'be-msg'; msg.textContent = t('lg_empty_cta'); st.appendChild(msg);
  const share = document.createElement('button'); share.type = 'button'; share.className = 'be-btn be-share'; share.textContent = t('lg_share'); share.addEventListener('click', () => shareLeague(lg)); st.appendChild(share);
  const play = document.createElement('button'); play.type = 'button'; play.className = 'be-btn'; play.textContent = t('lg_play'); play.addEventListener('click', startTodayChallenge); st.appendChild(play);
}
// your name on every league table — set/change it here so boards aren't full of dupes
function promptNick() {
  const v = (prompt(t('lg_name_prompt'), getNick()) || '').trim();
  if (v) { setNick(v); renderLeaguePanel(); }
}
function buildWhoLine() {
  const who = document.createElement('div'); who.className = 'dl-who';
  const nick = getNick();
  if (nick) {
    const lbl = document.createElement('span'); lbl.className = 'dl-who-lbl'; lbl.textContent = t('lg_playing_as') + ' ';
    const val = document.createElement('span'); val.className = 'dl-who-nick'; val.dir = 'auto'; val.textContent = nick;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'dl-who-edit'; edit.textContent = t('lg_change_name'); edit.addEventListener('click', promptNick);
    who.append(lbl, val, edit);
  } else {
    who.appendChild(lgBtn('dl-btn dl-setname', t('lg_set_name'), promptNick));
  }
  return who;
}
function renderLeaguePanel() {
  const host = $('daily-league'); if (!host) return;
  if (!lbConfigured()) { host.hidden = true; return; }
  host.hidden = false; host.innerHTML = '';
  const leagues = getLeagues();
  if (leagues.length) {
    host.appendChild(lgBtn('dl-btn dl-share dl-play', t('lg_play'), startTodayChallenge));
    host.appendChild(buildWhoLine());
    const cap = document.createElement('div'); cap.className = 't-cap dl-cap'; cap.textContent = t('lg_your'); host.appendChild(cap);
    leagues.forEach(lg => {
      const card = document.createElement('div'); card.className = 'dl-league';
      const nm = document.createElement('div'); nm.className = 'dl-name'; nm.dir = 'auto'; nm.textContent = lg.name; card.appendChild(nm);
      const row = document.createElement('div'); row.className = 'dl-row';
      row.appendChild(lgBtn('dl-btn dl-share', t('lg_share'), () => shareLeague(lg)));
      row.appendChild(lgBtn('dl-btn', t('lg_copy'), (e) => copyLeagueLink(lg, e.currentTarget)));
      card.appendChild(row);
      card.appendChild(lgBtn('dl-leave', t('lg_leave'), () => {
        if (confirm(t('lg_leave_q'))) { removeLeague(lg.code); if (S.boardView === lg.code) S.boardView = 'global'; renderLeaguePanel(); }
      }));
      host.appendChild(card);
    });
    host.appendChild(buildCreateForm(t('lg_add_another')));
  } else {
    host.appendChild(buildCreateForm(t('lg_create_h')));
  }
}
// join from a shared invite link: ?liga=<code>&ln=<name> — adds to your leagues
function joinLeagueFromQuery() {
  try {
    const p = new URLSearchParams(location.search);
    const code = p.get('liga'); if (!code) return false;
    addLeague(code, p.get('ln') || code);
    S.boardView = code;
    track('league_join', { code });
    history.replaceState(null, '', location.origin + location.pathname);
    return true;
  } catch (_) { return false; }
}

// ── S6 back cover ─────────────────────────────────────────────────────────────
function showResult() {
  const J = S.journey;
  const evt = { stage: J.finalStage, games_played: gamesBucket(bumpGamesPlayed()) };
  if (S.challenge) {
    evt.daily = S.challenge.d;
    S.challengeOk = evalChallenge(S.challenge, J);
    if (S.challengeOk !== null) evt.daily_ok = S.challengeOk;
    if (S.challenge.tries && S.tryNo) evt.tries = S.tryNo;
    try {
      const done = dailyDone();
      const prev = done[S.challenge.d];
      // a later failed replay must not erase an earlier success
      if (!prev || !prev.ok || S.challengeOk) done[S.challenge.d] = { s: J.finalStage, ok: S.challengeOk, n: S.tryNo || undefined };
      localStorage.setItem('gxi_daily_done', JSON.stringify(done));
    } catch (_) { /* ok */ }
  }
  track('game_complete', evt);
  document.querySelector('#s6 .verdict-kicker').textContent =
    S.challenge
      ? ('DAILY #' + S.challenge.d + ' · ' + chTitle(S.challenge)
        + (S.challengeOk === true ? ' ✓' : S.challengeOk === false ? ' ✗' : '')
        + (S.challenge.tries && S.tryNo ? ' · ' + t('try_n', S.tryNo) : ''))
      : t('s6_kicker');
  // achievement line — proof of HOW you met the rule + the day's mark (best-of-the-day)
  const proofEl = $('verdict-proof');
  if (S.challenge) {
    const proof = challengeProof(S.challenge, J), mark = challengeMark(S.challenge, J);
    const tick = S.challengeOk === true ? '✓ ' : S.challengeOk === false ? '✗ ' : '';
    const parts = [];
    if (proof) parts.push(tick + proof);
    else if (S.challengeOk === true) parts.push('✓');
    if (mark) parts.push(mark);
    proofEl.textContent = parts.join('   ·   ');
    proofEl.hidden = parts.length === 0;
    proofEl.classList.toggle('miss', S.challengeOk === false);
  } else proofEl.hidden = true;
  renderLeaderboardRow(S.challenge, J);
  show('s6');
  const s6 = $('s6');
  s6.classList.toggle('champion', J.finalStage === 'CHAMPION');

  $('verdict-stage').textContent = stageVerdict(J.finalStage);
  const R = J.record;
  $('verdict-record').textContent = t('record', R.w, R.d, R.l, R.gf, R.ga);
  const avg = Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11);
  const wcYear = (S.challenge && S.challenge.pickYear && S.challenge.flt && S.challenge.flt.years) ? S.challenge.flt.years[0] : null;
  $('verdict-avg').textContent = wcYear ? t('avg_rating_wc', avg, wcYear) : t('avg_rating', avg);
  // GloryScore + "your best today" — every run is a score that can be beaten (move 5)
  const dayN = S.challenge ? S.challenge.d : 0;
  const gScore = boardScore({ stage: J.finalStage, gd: R.gf - R.ga, day: dayN, avg });
  const { best, isNew } = recordGloryBest(_todayIso(), gScore);
  const gEl = $('verdict-glory');
  if (gEl) {
    gEl.innerHTML = '';
    const lab = document.createElement('span'); lab.className = 'vg-lab t-cap'; lab.textContent = t('gs_label');
    const val = document.createElement('b'); val.className = 'vg-val'; val.textContent = gScore;
    const bst = document.createElement('span'); bst.className = 'vg-best t-cap' + (isNew ? ' vg-new' : '');
    bst.textContent = isNew ? t('gs_new') : t('gs_best', best);
    gEl.append(lab, val, bst);
    // Day 9 "Worst Average": surface the weakness multiplier so the boost is visible,
    // not silent — otherwise the player sees only a bigger number with no reason why.
    if (dayN === 9) {
      const he = getLang() === 'he';
      const mult = weaknessMult(avg);
      const base = gloryScore({ stage: J.finalStage, gd: R.gf - R.ga });
      const chip = document.createElement('span');
      chip.className = 'vg-mult t-cap' + (mult > 1 ? ' vg-mult-on' : '');
      chip.textContent = mult > 1
        ? (he ? 'בונוס הרכב חלש  ' + base + ' ×' + mult.toFixed(2) + ' = ' + gScore
              : 'WEAK-XI BONUS  ' + base + ' ×' + mult.toFixed(2) + ' = ' + gScore)
        : (he ? 'אין בונוס חולשה (ממוצע 80+)' : 'NO WEAK-XI BONUS (AVG 80+)');
      gEl.append(chip);
    }
    gEl.hidden = false;
  }
  const sl = $('scoring-link'); if (sl) sl.hidden = false;
  document.querySelector('#s6 .tracklist-label').textContent = S.teamName;

  renderPitchInto('result-slots', true, null, true);
  const ach = tourneyAchievement(J);
  const badge = $('tourney-badge');
  if (badge) {
    if (ach) { badge.textContent = ach; badge.hidden = false; } else badge.hidden = true;
  }
  renderGoalKing(J);

  // Sprint 3: the "almost" framing + swap CTA — only when you didn't lift the cup
  const champ = J.finalStage === 'CHAMPION';
  const lossBox = $('loss-summary'), swapBtn = $('btn-swap'), againBtn = $('btn-again');
  if (!champ) {
    $('loss-peak').textContent = lossPeakLine(J);
    $('loss-weak').textContent = lossWeakLine();
    if (lossBox) lossBox.hidden = false;
    // run-it-back is offered only until the same-team replay cap is reached
    if (swapBtn) swapBtn.hidden = !canReplay();
    if (againBtn) againBtn.textContent = t('sw_newteam');
  } else {
    if (lossBox) lossBox.hidden = true;
    if (swapBtn) swapBtn.hidden = true;
    if (againBtn) againBtn.textContent = t('again');
  }
}

// tournament Golden Boot / Playmaker (ALL teams) — always fully open
function teamLabel(tm) { return tm === 'USER_XI' ? (S.teamName || t('lb_you')) : tm.toUpperCase(); }
function renderGoalKing(J) {
  const el = $('result-scorers');
  if (!el) return;
  const scorers = J.topScorers || [], assisters = J.topAssisters || [];
  el.innerHTML = '';
  if (!scorers.length) { el.hidden = true; return; }
  el.hidden = false;

  const head = document.createElement('div');
  head.className = 'rs-head t-cap';
  head.textContent = t('tourney_stars');
  el.appendChild(head);

  const body = document.createElement('div'); body.className = 'rs-body';
  const mkCol = (title, rows, cls, key) => {
    const col = document.createElement('div'); col.className = 'rs-col';
    const h = document.createElement('div'); h.className = 'rs-h t-cap'; h.textContent = title;
    col.appendChild(h);
    rows.forEach((s, i) => {
      const r = document.createElement('div'); r.className = 'rs-row' + (i === 0 ? ' rs-top' : '') + (s.team === 'USER_XI' ? ' rs-mine' : '');
      const rk = document.createElement('span'); rk.className = 'rs-rank'; rk.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'rs-name'; nm.textContent = s.name;
      const tm = document.createElement('span'); tm.className = 'rs-team'; tm.textContent = teamLabel(s.team);
      const v = document.createElement('span'); v.className = 'rs-val ' + cls; v.textContent = s[key];
      r.append(rk, nm, tm, v);
      col.appendChild(r);
    });
    return col;
  };
  body.appendChild(mkCol(t('top_scorers'), scorers.slice(0, 10), 'rs-goals', 'goals'));
  if (assisters.length) body.appendChild(mkCol(t('top_assists'), assisters.slice(0, 10), 'rs-assists', 'assists'));
  el.appendChild(body);
}

// if one of YOUR players finished top-3 in tournament goals or assists, return a badge line
function tourneyAchievement(J) {
  const ord = ['1st', '2nd', '3rd'];
  const scan = (list, kind) => {
    for (let i = 0; i < Math.min(3, (list || []).length); i++) {
      if (list[i].team === 'USER_XI') return { name: list[i].name, rank: i, kind, n: list[i][kind === 'scorer' ? 'goals' : 'assists'] };
    }
    return null;
  };
  const s = scan(J.topScorers, 'scorer'), a = scan(J.topAssisters, 'assist');
  const pick = (s && (!a || s.rank <= a.rank)) ? s : a;
  if (!pick) return null;
  const he = getLang() === 'he';
  const label = pick.kind === 'scorer'
    ? (he ? 'מלך השערים' : 'TOP SCORER') : (he ? 'מלך הבישולים' : 'TOP ASSISTS');
  const place = he ? ['ה-1', 'ה-2', 'ה-3'][pick.rank] : ord[pick.rank];
  return he
    ? `${pick.name}, מקום ${place} ב${label} של הטורניר`
    : `${pick.name} — ${place} in tournament ${label.toLowerCase()}`;
}

// ── Sprint 3: the "almost" loss screen + swap-one-player-and-replay ────────────
// The narrative is always the honest output of the sim — never inflated. Peak-End:
// the last 10 seconds of a run become the emotional hook + a one-tap path to save
// the XI you built instead of starting from scratch (loss-aversion / endowment).
const fmtPct = (p) => { const v = p * 100; return v >= 9.5 ? Math.round(v) + '%' : v >= 0.5 ? v.toFixed(1) + '%' : '<1%'; };

function lossPeakLine(J) {
  const he = getLang() === 'he', ev = (en, h) => he ? h : en;
  if (J.finalStage === 'GROUP_EXIT') {
    const r = J.rank || 3, ord = r === 1 ? 'ST' : r === 2 ? 'ND' : r === 3 ? 'RD' : 'TH';
    return ev('OUT IN THE GROUP STAGE · FINISHED ' + r + ord + ' · A WHISKER FROM THE KNOCKOUTS',
              'נפילה בשלב הבתים, מקום ' + r + ' בבית. צעד אחד מהנוקאאוט.');
  }
  const userMatches = J.journey.filter(m => m.opponent);
  const last = userMatches[userMatches.length - 1];
  if (!last) return '';
  const opp = String(last.opponent).toUpperCase();
  const score = last.scoreFor + (he ? ':' : '-') + last.scoreAgainst;
  const onPens = /pen/i.test(last.note || ''), aet = /a\.e\.t/i.test(last.note || '');
  const tail = onPens ? ev(' ON PENALTIES', ' בפנדלים') : aet ? ev(' AFTER EXTRA TIME', ' בהארכה') : '';
  if (J.finalStage === 'F') {
    return ev('RUNNERS-UP · LOST THE FINAL ' + score + tail + ' TO ' + opp + ' · ONE GAME FROM IT ALL',
              'סגנית אלופה. הפסד בגמר ' + score + tail + ' ל' + opp + '. משחק אחד מהכל.');
  }
  const NEXT_EN = { R32: 'THE LAST 16', R16: 'THE QUARTERS', QF: 'THE SEMIS', SF: 'THE FINAL' };
  const NEXT_HE = { R32: 'שמינית הגמר', R16: 'רבע הגמר', QF: 'חצי הגמר', SF: 'הגמר' };
  const close = onPens || aet || Math.abs(last.scoreFor - last.scoreAgainst) <= 1;
  const stageTxt = shortStage(J.finalStage);
  const closeTail = close
    ? ev(' · A KICK FROM ' + (NEXT_EN[J.finalStage] || 'THE NEXT ROUND'), '. נשימה מ' + (NEXT_HE[J.finalStage] || 'השלב הבא') + '.')
    : '';
  return ev('OUT IN ' + stageTxt.toUpperCase() + ' · ' + score + tail + ' TO ' + opp + closeTail,
            'יציאה ב' + stageTxt + ', ' + score + tail + ' ל' + opp + closeTail);
}

// run-it-back: a finished team may be swapped & replayed at most this many times,
// so a run isn't ground up to a win by re-rolling one upgrade after another.
// Two attempts total with one team = the initial run + one swap-replay.
const MAX_SWAP_REPLAYS = 1;
const canReplay = () => (S.swapCount || 0) < MAX_SWAP_REPLAYS;

function lossWeakLine() {
  const he = getLang() === 'he', ev = (en, h) => he ? h : en;
  const sc = computeTeamScores(S.xi);
  const lines = [[t('sp_def'), sc.defense], [t('sp_mid'), sc.midfield], [t('sp_att'), sc.attack]];
  const weak = lines.reduce((a, b) => a[1] <= b[1] ? a : b);
  const head = ev('SOFT BELLY: ' + weak[0] + ' (' + Math.round(weak[1]) + ')',
                  'הבטן הרכה: ' + weak[0] + ' (' + Math.round(weak[1]) + ')');
  return head + (canReplay()
    ? ev(' · SWAP ONE & RUN IT BACK', '. החלף אחד, רוץ שוב.')
    : ev(' · NO REPLAYS LEFT — NEW XI', '. נגמרו הניסיונות, הרכב חדש.'));
}

// default swap target = the lowest-rated player in the weakest line
function weakestSlot() {
  const sc = computeTeamScores(S.xi);
  const groups = [
    [sc.defense, ['GK', 'RB', 'CB1', 'CB2', 'LB']],
    [sc.midfield, ['CM1', 'CM2', 'RM', 'LM']],
    [sc.attack, ['ST1', 'ST2']],
  ];
  groups.sort((a, b) => a[0] - b[0]);
  let best = null, bestR = Infinity;
  for (const s of groups[0][1]) { const p = S.xi[s]; if (p && p.r < bestR) { bestR = p.r; best = s; } }
  return best || SLOTS.find(s => S.xi[s]) || 'GK';
}

// is player p a legal replacement for an OCCUPIED slot (same rules as the draft,
// minus the "slot is free" check) — honours the active daily's challenge filters
function swapEligible(p, slot, usedCountries, usedNames) {
  const f = challengeFlt();
  if (f && f.lineNation) {                                       // line-nation day: stay in the line's nation + a fresh cup
    const pos = SLOT_POS_GROUP[slot];
    if (p.p !== pos) return false;
    if (usedNames.has(p.c + '|' + p.n)) return false;
    const lnOther = lineNationExcept(pos, slot);
    if (lnOther) { if (p.c !== lnOther) return false; }          // multi-player line → must match its nation
    else if (otherLineNations(pos).has(p.c)) return false;       // single-player line (GK) → just no cross-line dup
    if (lnOther && lineYears(pos, slot).has(p.y)) return false;  // a different World Cup within the line
    return true;
  }
  if (f && f.lineDecade) {                                       // line-decade day: replacement stays in the line's decade
    const pos = SLOT_POS_GROUP[slot];
    if (p.p !== pos) return false;
    if (usedCountries.has(p.c)) return false;                    // one country per XI still holds
    if (usedNames.has(p.c + '|' + p.n)) return false;           // never the same human twice
    const dec = decadeOf(p.y), ldOther = lineDecadeExcept(pos, slot);
    if (ldOther !== null) { if (dec !== ldOther) return false; } // multi-player line → must match its decade
    else if (otherLineDecades(pos).has(dec)) return false;      // single-player line (GK) → no cross-line decade dup
    return true;
  }
  if (f && f.pos) { if (!f.pos.includes(p.p)) return false; }   // pos-theme day: themed position, any slot
  else if (SLOT_POS_GROUP[slot] !== p.p) return false;          // normal: player's group must own this slot
  if (!(f && f.rpt) && usedCountries.has(p.c)) return false;    // one player per country (rpt lifts it)
  if (usedNames.has(p.c + '|' + p.n)) return false;             // never the same human twice
  if (f && f.cap) { const cap = f.cap[CAP_GROUP(slot)]; if (cap != null && p.r > cap) return false; }
  if (f && f.wideNatural && WIDE_SLOTS.includes(slot)) { if (!(p.sp && p.sp.split('/').includes(slot))) return false; }
  if (f && f.slotEra && f.slotEra[slot] != null) { if (decadeOf(p.y) !== f.slotEra[slot]) return false; }
  return true;
}

// draw 3 eligible alternatives for a slot, biased to feel like an upgrade (rating ≥
// current preferred) but still a small RANDOM draw — not a free-choice shop (Mosh)
function drawSwapOptions(slot) {
  const cur = S.xi[slot];
  const usedCountries = new Set(), usedNames = new Set();
  for (const s of SLOTS) {
    if (s === slot || !S.xi[s]) continue;
    usedCountries.add(S.xi[s].c); usedNames.add(S.xi[s].c + '|' + S.xi[s].n);
  }
  const pool = (S.players || []).filter(p =>
    !(p.c === cur.c && p.n === cur.n) && swapEligible(p, slot, usedCountries, usedNames));
  if (!pool.length) return [];
  const better = pool.filter(p => p.r >= cur.r);
  const base = better.length >= 3 ? better : pool;
  const sorted = base.slice().sort((a, b) => b.r - a.r);
  const topN = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.4)));
  const picks = [], bag = topN.slice();
  while (picks.length < 3 && bag.length) picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  return picks;
}

function showSwap() {
  if (!canReplay()) return; // cap enforced in logic too, not only by hiding the button
  show('s-swap');
  const he = getLang() === 'he';
  const sc = computeTeamScores(S.xi);
  const lines = [[t('sp_def'), sc.defense], [t('sp_mid'), sc.midfield], [t('sp_att'), sc.attack]];
  const weak = lines.reduce((a, b) => a[1] <= b[1] ? a : b);
  $('swap-sub').textContent = he
    ? 'הבטן הרכה: ' + weak[0] + ' (' + Math.round(weak[1]) + '). שדרג אחד, רוץ שוב עם אותה קבוצה.'
    : 'SOFT BELLY: ' + weak[0] + ' (' + Math.round(weak[1]) + '). UPGRADE ONE, REPLAY THE SAME XI.';
  renderPitchInto('swap-slots', true, selectSwapSlot);
  selectSwapSlot(weakestSlot());
}

let _swapOddsSeq = 0;
function selectSwapSlot(slot) {
  S.swapSlot = slot;
  document.querySelectorAll('#swap-slots .b-slot').forEach(el => el.classList.toggle('swap-target', el.dataset.slot === slot));
  const cur = S.xi[slot]; if (!cur) return;
  const he = getLang() === 'he';
  $('swap-pick-label').textContent = (he ? 'מחליפים: ' : 'REPLACING: ') + surname(cur.n).toUpperCase() + ' (' + cur.r + ') · ' + posTitle(cur.p);
  const opts = drawSwapOptions(slot);
  const box = $('swap-options'); box.innerHTML = '';
  if (!opts.length) {
    const none = document.createElement('div'); none.className = 'swap-none t-cap';
    none.textContent = he ? 'אין חלופה כשירה לעמדה הזו' : 'NO ELIGIBLE ALTERNATIVE HERE';
    box.appendChild(none); return;
  }
  const groupKey = { GK: 'defense', DF: 'defense', MF: 'midfield', FW: 'attack' }[SLOT_POS_GROUP[slot]];
  const lineCap = { defense: t('sp_def'), midfield: t('sp_mid'), attack: t('sp_att') }[groupKey];
  const curLine = computeTeamScores(S.xi)[groupKey];
  const cards = [];
  opts.forEach(opt => {
    const cand = { ...S.xi, [slot]: opt };
    const newLine = computeTeamScores(cand)[groupKey];
    const dLine = Math.round(newLine - curLine);
    const card = document.createElement('button'); card.className = 'swap-opt';
    const top = document.createElement('div'); top.className = 'so-top';
    top.appendChild(makeFlag(opt.c, 'so-flag'));
    const nm = document.createElement('span'); nm.className = 'so-name'; nm.textContent = surname(opt.n).toUpperCase();
    const rt = document.createElement('span'); rt.className = 'so-rate'; rt.textContent = opt.r;
    top.append(nm, rt);
    const line = document.createElement('div'); line.className = 'so-line';
    line.innerHTML = '<i>' + lineCap + '</i> ' + Math.round(curLine) + ' → ' + Math.round(newLine)
      + ' <em class="' + (dLine >= 0 ? 'up' : 'dn') + '">' + (dLine >= 0 ? '+' : '') + dLine + '</em>';
    const odds = document.createElement('div'); odds.className = 'so-odds';
    odds.innerHTML = '<i>' + t('dm_champ') + '</i> <span class="so-odds-v t-cap">' + (he ? 'מחשב…' : 'computing…') + '</span>';
    card.append(top, line, odds);
    card.addEventListener('click', () => applySwap(slot, opt));
    box.appendChild(card);
    cards.push({ cand, oddsEl: odds.querySelector('.so-odds-v') });
  });
  // odds delta — the deeper signal; computed just after the cards paint
  const seq = ++_swapOddsSeq;
  setTimeout(() => {
    if (seq !== _swapOddsSeq) return;
    const curO = titleOdds(S.xi, S.field, undefined, 160).champion;
    cards.forEach(c => {
      const o = titleOdds(c.cand, S.field, undefined, 160).champion;
      const d = Math.round((o - curO) * 100);
      c.oddsEl.textContent = fmtPct(curO) + ' → ' + fmtPct(o);
      c.oddsEl.classList.add(o >= curO ? 'up' : 'dn');
    });
  }, 40);
}

function applySwap(slot, opt) {
  S.xi[slot] = opt;
  S.used = new Set(SLOTS.filter(s => S.xi[s]).map(s => S.xi[s].c));
  S.tryNo = (S.tryNo || 0) + 1; // each run-it-back is a fresh attempt on the board
  S.swapCount = (S.swapCount || 0) + 1; // same-team replays used, capped by MAX_SWAP_REPLAYS
  track('swap_replay', { slot });
  runTournament(); // same XI + one upgrade, straight back into the tournament
}

// ── reset ─────────────────────────────────────────────────────────────────────
function resetGame() {
  S.xi = {};
  S.used = new Set();
  S.jokerOffered = false;
  S.teamName = '';
  const tn = $('team-name');
  if (tn) tn.value = '';
  S.skips = { team: 1, year: 1 };
  S.draw = null;
  S.journey = null;
  S.ctrl = null;
  S.tryNo = 0;
  S.swapCount = 0;
  S.lbRowId = null;
  S.spinning = false;
  S.feedIdx = 0; S.matchNo = 0; S.printing = false;
  showTactics(false);
  $('s6').classList.remove('champion');
  renderBoard();
  renderPips();
  updateBoardCount();
  renderDraftMeter();
}

// ── how-to overlay (3 steps, first run + on demand) ──────────────────────────
const HT_KEYS = [['ht1_t', 'ht1_b'], ['ht2_t', 'ht2_b'], ['ht3_t', 'ht3_b']];
let htStep = 0, htFromStart = false;

function seenHowto() { try { return localStorage.getItem('gxi_howto') === '1'; } catch (_) { return true; } }

function showHowto(fromStart) {
  htFromStart = fromStart;
  htStep = 0;
  renderHowto();
  show('s-howto');
}

function renderHowto() {
  for (let i = 1; i <= 3; i++) {
    $('ht-art-' + i).style.display = (i === htStep + 1) ? '' : 'none';
    $('htd-' + i).classList.toggle('on', i <= htStep + 1);
  }
  $('ht-step').textContent = (htStep + 1) + ' / 3';
  $('ht-title').textContent = t(HT_KEYS[htStep][0]);
  $('ht-body').textContent = t(HT_KEYS[htStep][1]);
  $('ht-next').textContent = htStep < 2 ? t('ht_next') : (htFromStart ? t('ht_start') : t('ht_back'));
}

function htNext() {
  if (htStep < 2) { htStep++; renderHowto(); return; }
  try { localStorage.setItem('gxi_howto', '1'); } catch (_) { /* ok */ }
  track('howto_done');
  if (htFromStart) showLegends(); else show('s1');
}

// ── explainer / how-it-works screen (meters, odds, tactics, end, GloryScore) ───
const GUIDE = [
  { key: 'game',
    svg: '<svg viewBox="0 0 130 46" aria-hidden="true"><rect x="6" y="9" width="26" height="18" fill="none" stroke="#2BD4C0" stroke-width="1.5"/><rect x="10" y="13" width="18" height="10" fill="#2BD4C0" opacity=".7"/><text x="52" y="24" font-family="Anton,Arial Narrow" font-size="16" fill="#F5C518">2026</text><path d="M96 14 h26 M96 14 l-9 36 h44 z" fill="none" stroke="#EDE8DF" stroke-width="1.3"/><circle cx="109" cy="30" r="3" fill="#2BD4C0"/></svg>',
    he: { t: 'המשחק', b: 'מגרילים מדינה ושנה, בוחרים שחקן אחד מהסגל לעמדה פנויה, וחוזרים 11 פעם. אז משחקים את מונדיאל 2026 המלא: שלב בתים, ואז נוקאאוט עד הגמר.' },
    en: { t: 'THE GAME', b: 'You draw a nation and a year, pick one player into an open slot, eleven times over. Then you play the full 2026 World Cup: a group stage, then knockout all the way to the final.' } },
  { key: 'meter',
    svg: '<svg viewBox="0 0 130 46" aria-hidden="true"><g font-family="Anton,Arial Narrow" font-size="8" fill="#8A8378"><text x="4" y="14">DEF</text><text x="4" y="27">MID</text><text x="4" y="40">ATT</text></g><rect x="30" y="8" width="96" height="6" fill="rgba(237,232,223,.14)"/><rect x="30" y="8" width="74" height="6" fill="#2BD4C0"/><rect x="30" y="21" width="96" height="6" fill="rgba(237,232,223,.14)"/><rect x="30" y="21" width="60" height="6" fill="#F5C518"/><rect x="30" y="34" width="96" height="6" fill="rgba(237,232,223,.14)"/><rect x="30" y="34" width="40" height="6" fill="#FF9F6E"/></svg>',
    he: { t: 'מד החוזק', b: 'בזמן הבחירה אתה רואה שלושה קווים, הגנה קישור והתקפה, שמתעדכנים בכל שיבוץ. הקו הכי חלש מסומן בכתום, זו הבטן הרכה. שדרוג הקו החלש מזיז את התוצאות יותר מחיזוק הקו החזק.' },
    en: { t: 'THE STRENGTH METER', b: 'As you pick, three lines — defence, midfield and attack — update with every player. The weakest is flagged in coral, your soft belly. Upgrading the weak line moves results more than strengthening the strong one.' } },
  { key: 'tactics',
    svg: '<svg viewBox="0 0 130 46" aria-hidden="true"><rect x="8" y="20" width="114" height="6" rx="3" fill="none"/><line x1="10" y1="23" x2="120" y2="23" stroke="#FF9F6E" stroke-width="5" stroke-linecap="round"/><line x1="44" y1="23" x2="120" y2="23" stroke="#8A8378" stroke-width="5" stroke-linecap="round"/><line x1="86" y1="23" x2="120" y2="23" stroke="#2BD4C0" stroke-width="5" stroke-linecap="round"/><circle cx="86" cy="23" r="9" fill="#EDE8DF" stroke="#2BD4C0" stroke-width="3"/><g font-family="Anton,Arial Narrow" font-size="7" fill="#8A8378"><text x="8" y="40">BUNKER</text><text x="98" y="40">ALL-OUT</text></g></svg>',
    he: { t: 'סרגל הטקטיקה', b: 'לפני כל משחק אתה בוחר גישה, מבונקר ועד התקפי-מאד, והאחוז זז בזמן אמת.' },
    en: { t: 'THE TACTICS BAR', b: 'Before each match you choose an approach, from bunker to all-out, and the chance moves live.' } },
  { key: 'end',
    svg: '<svg viewBox="0 0 130 46" aria-hidden="true"><path d="M40 14 a18 18 0 1 1 -6 22" fill="none" stroke="#2BD4C0" stroke-width="2"/><path d="M40 8 l2 9 l-9 -1 z" fill="#2BD4C0"/><path d="M90 32 a18 18 0 1 1 6 -22" fill="none" stroke="#F5C518" stroke-width="2"/><path d="M90 38 l-2 -9 l9 1 z" fill="#F5C518"/><text x="56" y="28" font-family="Anton,Arial Narrow" font-size="14" fill="#EDE8DF">↻</text></svg>',
    he: { t: 'סוף הריצה', b: 'אהבת את הנבחרת שלך והפסדת? אתה יכול להחליף שחקן אחד ולשחק שוב עם אותה קבוצה.' },
    en: { t: 'END OF THE RUN', b: 'Loved your XI but lost? You can swap one player and play again with the same team.' } },
  { key: 'score', score: true,
    svg: '<svg viewBox="0 0 130 46" aria-hidden="true"><g fill="none" stroke="#F5C518" stroke-width="2"><path d="M8 40 h16 v-8 h16 v-9 h16 v-9 h16 v-9 h16"/></g><circle cx="24" cy="32" r="2.5" fill="#2BD4C0"/><circle cx="56" cy="23" r="2.5" fill="#2BD4C0"/><circle cx="88" cy="14" r="2.5" fill="#2BD4C0"/><polygon points="112,5 114,10 119,10 115,13 117,18 112,15 107,18 109,13 105,10 110,10" fill="#F5C518"/></svg>',
    he: { t: 'הניקוד היומי', b: 'הניקוד בטבלה היומית מורכב מהשלב אליו הגעת, פלוס הפרש השערים. כל ריצה היא שורה שכולם רואים, והשיא שלך היום נשמר ומסומן כשאתה שובר אותו.' },
    en: { t: 'GloryScore', b: 'Your daily-board score is the stage you reached plus your goal difference. Every run is its own line everyone sees, and "your best today" is saved and flagged when you beat it.' } },
];

function buildScoreTable(he) {
  const wrap = document.createElement('div'); wrap.className = 'guide-score';
  for (const [st, pts] of [['R32', 10], ['R16', 25], ['QF', 50], ['SF', 90], ['F', 140], ['CHAMPION', 200]]) {
    const r = document.createElement('div'); r.className = 'gsc-row' + (st === 'CHAMPION' ? ' gsc-champ' : '');
    const a = document.createElement('span'); a.className = 'gsc-stage'; a.textContent = shortStage(st);
    const b = document.createElement('b'); b.className = 'gsc-pts'; b.textContent = pts;
    r.append(a, b); wrap.appendChild(r);
  }
  const gd = document.createElement('div'); gd.className = 'gsc-gd';
  gd.textContent = he ? '+ הפרש השערים (שובר שוויון בתוך השלב)' : '+ goal difference (breaks ties within a stage)';
  const ex = document.createElement('div'); ex.className = 'gsc-ex';
  ex.textContent = he
    ? 'דוגמה: רבע גמר עם הפרש +6 שווה 56. אלוף עם +9 שווה 209. השלב תמיד מנצח, רבע (50) גובר על שמינית (25) בכל מקרה.'
    : 'Example: a QF run at +6 is 56. Champion at +9 is 209. The stage always wins — a QF (50) beats an R16 (25) every time.';
  wrap.append(gd, ex);
  return wrap;
}

function renderGuide() {
  const box = $('guide-sections'); if (!box) return;
  const he = getLang() === 'he';
  $('guide-kicker').textContent = t('guide_kicker');
  $('guide-title').innerHTML = t('guide_title');
  $('guide-back-label').textContent = t('guide_back');
  box.innerHTML = '';
  GUIDE.forEach((s, i) => {
    const sec = document.createElement('div'); sec.className = 'guide-sec'; sec.id = 'guide-' + s.key;
    const head = document.createElement('div'); head.className = 'guide-sec-head';
    const num = document.createElement('span'); num.className = 'guide-num'; num.textContent = i + 1;
    const ttl = document.createElement('h3'); ttl.className = 'guide-h'; ttl.textContent = s[he ? 'he' : 'en'].t;
    head.append(num, ttl);
    const art = document.createElement('div'); art.className = 'guide-art'; art.innerHTML = s.svg;
    const body = document.createElement('p'); body.className = 'guide-b'; body.textContent = s[he ? 'he' : 'en'].b;
    sec.append(head, art, body);
    if (s.score) sec.appendChild(buildScoreTable(he));
    box.appendChild(sec);
  });
}

function showGuide(anchor, ret) {
  S.guideReturn = ret || 's1';
  renderGuide();
  show('s-guide');
  const sc = $('guide-scroll'); if (sc) sc.scrollTop = 0;
  if (anchor) { const el = $('guide-' + anchor); if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }
}

// ── language ──────────────────────────────────────────────────────────────────
function updateLangButton() {
  $('lang-label').textContent = getLang() === 'he' ? 'English' : 'עברית';
}

// ── daily challenge (stage 1: honor system, locked by device date) ───────────
function _todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayChallenge() {
  return (S.challenges || []).find(c => c.date === _todayIso()) || null;
}
function dailyDone() {
  try { return JSON.parse(localStorage.getItem('gxi_daily_done') || '{}'); } catch (_) { return {}; }
}
// local attempt counter (day 24): counts runs until the day is beaten, then freezes
function bumpTries(c) {
  if (!c.tries) { S.tryNo = 0; return; }
  let n = 1;
  try {
    const all = JSON.parse(localStorage.getItem('gxi_daily_tries') || '{}');
    const prev = dailyDone()[c.d];
    n = (all[c.d] || 0) + ((prev && prev.ok) ? 0 : 1);
    all[c.d] = n;
    localStorage.setItem('gxi_daily_tries', JSON.stringify(all));
  } catch (_) { /* private mode — count this run as the first */ }
  S.tryNo = n;
}

function chTitle(c) { return getLang() === 'he' ? c.t_he : c.t_en; }
function chDesc(c)  { return getLang() === 'he' ? c.x_he : c.x_en; }
function chGist(c)  { return (getLang() === 'he' ? c.g_he : c.g_en) || ''; }

function updateDailyBtn() {
  const c = todayChallenge();
  const btn = $('daily-btn');
  const start = $('btn-start');
  // when today's challenge is live it becomes the hero CTA and KICK OFF steps back,
  // so newcomers land on the fun mode first.
  if (c) {
    btn.hidden = false;
    $('daily-btn-label').textContent = t('daily_btn', c.d);
    $('daily-btn-kicker').textContent = t('daily_kicker');
    if (start) { start.classList.remove('slab-hot'); start.classList.add('slab-line'); }
  } else {
    btn.hidden = true;
    if (start) { start.classList.add('slab-hot'); start.classList.remove('slab-line'); }
  }
  // direct link to today's leaderboard from home — no need to play first
  const bl = $('home-board-link');
  if (bl) {
    const ok = !!(c && lbConfigured());
    bl.hidden = !ok;
    if (ok) bl.innerHTML = t('lb_today'); // lb_today is a trusted static string (contains &#8594;)
  }
}

function showDaily() {
  const list = $('daily-list');
  list.innerHTML = '';
  $('daily-board-link').hidden = !(lbConfigured() && todayChallenge());
  const iso = _todayIso();
  const done = dailyDone();
  let todayRow = null;

  for (const c of S.challenges) {
    const isToday = c.date === iso;
    const isPast = c.date < iso;
    const isTomorrow = !isPast && !isToday && S.challenges.find(x => x.date > iso) === c;
    const row = document.createElement('div');
    row.className = 'daily-row' + (isToday ? ' today' : isPast ? ' past' : ' locked');

    const dn = document.createElement('div');
    dn.className = 'daily-dn';
    dn.textContent = String(c.d).padStart(2, '0');
    const body = document.createElement('div');
    body.className = 'daily-body';
    const tEl = document.createElement('div');
    tEl.className = 'daily-t';
    tEl.textContent = (isToday || isPast || isTomorrow) ? chTitle(c) : '· · · · · · · ·';
    const tag = document.createElement('span');
    tag.className = 'daily-tag t-cap';
    tag.textContent = isToday ? t('daily_today')
      : isPast ? (done[c.d] ? t('daily_done') : t('daily_missed'))
      : isTomorrow ? t('daily_tmrw') : t('daily_locked');
    if (isToday || (isPast && done[c.d])) tag.classList.add('hot');
    body.append(tEl);

    if (isToday) {
      const x = document.createElement('div');
      x.className = 'daily-x';
      x.textContent = chDesc(c);
      body.appendChild(x);
      // how today's board ranks you — the gate note only where meeting the rule actually gates
      const rk = document.createElement('div');
      rk.className = 'daily-rank';
      rk.textContent = (c.win && c.win.length) ? t('rank_gate') : t('rank_far');
      body.appendChild(rk);
      const play = document.createElement('button');
      play.id = 'daily-play';
      play.className = 'slab slab-hot daily-play';
      if (c.oneShot && done[c.d]) {
        // the final: one attempt, ever — the button stays as a tombstone
        play.textContent = t('daily_oneshot');
        play.disabled = true;
      } else {
        play.textContent = t('daily_play');
        play.addEventListener('click', () => {
          track('daily_play', { day: c.d });
          resetGame();
          S.challenge = c;
          S.challengePlan = buildChallengePlan(c);
          bumpTries(c);
          if (c.pickYear) showPickYear();
          else if (seenHowto()) showLegends(); else showHowto(true);
        });
      }
      body.appendChild(play);
      todayRow = row;
    }
    row.append(dn, body, tag);
    list.appendChild(row);
  }
  show('s-daily');
  if (todayRow) todayRow.scrollIntoView({ block: 'center' });
}

// ── Dante's daily story ───────────────────────────────────────────────────────
let curArticle = null;
// articles published as of today, newest first; same-date ties break by array
// order (the later entry is the fresher one — e.g. today's match report on top)
function publishedArticles() {
  const iso = _todayIso();
  return (S.articles || [])
    .map((a, idx) => ({ a, idx }))
    .filter(o => o.a.date <= iso)
    .sort((x, y) => y.a.date.localeCompare(x.a.date) || (y.idx - x.idx))
    .map(o => o.a);
}
function latestArticle() {
  const pub = publishedArticles();
  if (pub.length) return pub[0];
  // before any story's date: fall back to the soonest upcoming one
  return (S.articles || []).slice().sort((x, y) => x.date.localeCompare(y.date))[0] || null;
}
// home button shows the latest story's curiosity hook, not a generic "today's story"
function updateStoryBtn() {
  const a = latestArticle();
  curArticle = a;
  const btn = $('story-btn');
  if (!btn) return;
  if (!a) { btn.hidden = true; return; }
  btn.hidden = false;
  const he = getLang() === 'he';
  $('story-btn-kicker').textContent = t('story_kicker_line');
  $('story-btn-hook').textContent = (he ? a.hook_he : a.hook_en) || (he ? a.t_he : a.t_en);
  $('story-btn-cta-label').textContent = t('story_read');
}
// the archive hub: today's featured story on top + earlier ones as cards below
function openStoriesHub() {
  const pub = publishedArticles();
  if (!pub.length) { if (curArticle) openStory(curArticle); return; }
  const he = getLang() === 'he';
  const sc = document.querySelector('.stories-scroll');
  if (sc) { sc.dir = he ? 'rtl' : 'ltr'; sc.scrollTop = 0; }
  $('stories-back-top-label').textContent = t('story_back');
  $('stories-kicker').textContent = t('story_kicker_line');
  const feat = pub[0];
  $('stories-feat-kicker').textContent = t('story_today');
  $('stories-feat-hook').textContent = (he ? feat.hook_he : feat.hook_en) || (he ? feat.t_he : feat.t_en);
  const fimg = $('stories-feat-img'); fimg.src = feat.hero; fimg.alt = '';
  $('stories-feat-title').textContent = he ? feat.t_he : feat.t_en;
  $('stories-feat-dek').textContent = he ? feat.dek_he : feat.dek_en;
  $('stories-feat-cta').textContent = t('story_read');
  $('stories-feat').onclick = () => { openStory(feat); track('story_open', { date: feat.date, via: 'hub' }); };
  const rest = pub.slice(1);
  const list = $('stories-list'); list.innerHTML = '';
  $('stories-arch-label').hidden = rest.length === 0;
  $('stories-arch-label').textContent = t('stories_arch');
  for (const a of rest) {
    const card = document.createElement('button');
    card.className = 'story-mini';
    const thumb = document.createElement('img');
    thumb.src = a.hero; thumb.alt = ''; thumb.className = 'sm-thumb'; thumb.draggable = false;
    const txt = document.createElement('div'); txt.className = 'sm-txt';
    const hk = document.createElement('span'); hk.className = 'sm-hook';
    hk.textContent = (he ? a.hook_he : a.hook_en) || (he ? a.t_he : a.t_en);
    const ti = document.createElement('span'); ti.className = 'sm-title'; ti.textContent = he ? a.t_he : a.t_en;
    txt.appendChild(hk); txt.appendChild(ti);
    card.appendChild(thumb); card.appendChild(txt);
    card.onclick = () => { openStory(a); track('story_open', { date: a.date, via: 'hub_card' }); };
    list.appendChild(card);
  }
  show('s-stories');
}
// back from the reader: to the hub if there's an archive, else home
function backFromReader() { if (publishedArticles().length) openStoriesHub(); else show('s1'); }
function openStory(a) {
  if (!a) return;
  curArticle = a;
  const he = getLang() === 'he';
  const sc = document.querySelector('.story-scroll');
  if (sc) { sc.dir = he ? 'rtl' : 'ltr'; sc.style.textAlign = 'start'; }
  $('story-kicker').textContent = t('story_today');
  $('story-back-top-label').textContent = t('story_back');
  $('story-title').textContent = he ? a.t_he : a.t_en;
  $('story-dek').textContent = he ? a.dek_he : a.dek_en;
  $('story-by').textContent = t('story_by', a.by);
  const img = $('story-hero-img'); img.src = a.hero; img.alt = '';
  const body = $('story-body'); body.innerHTML = '';
  (he ? a.body_he : a.body_en).forEach(par => { const p = document.createElement('p'); p.textContent = par; body.appendChild(p); });
  const dyk = he ? a.dyk_he : a.dyk_en;
  if (dyk) { $('story-dyk').hidden = false; $('story-dyk-k').textContent = t('dyk_label'); $('story-dyk-p').textContent = dyk; }
  else { $('story-dyk').hidden = true; }
  $('story-disc').textContent = t('story_disclaimer', a.by);
  $('story-src-label').textContent = t('sources_label');
  const ul = $('story-src-list'); ul.innerHTML = '';
  (a.sources || []).forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
  $('story-back-label').textContent = t('story_back');
  $('story-share-label').textContent = t('story_share');
  $('story-share-cta-label').textContent = t('story_share_cta');
  if (sc) sc.scrollTop = 0;
  show('s-story');
}

// share the article that's open — native sheet, clipboard fallback with brief "copied" feedback
function doShareStory(btnId, normalLabel) {
  if (!curArticle) return;
  const btn = $(btnId);
  shareStory(curArticle, getLang()).then(res => {
    track('story_share', { date: curArticle.date, result: res });
    if (res === 'copied' && btn) {
      const label = btn.querySelector('span');
      const prev = label ? label.textContent : '';
      if (label) label.textContent = t('story_copied');
      btn.classList.add('copied');
      setTimeout(() => { if (label) label.textContent = t(normalLabel); btn.classList.remove('copied'); }, 1800);
    }
  }).catch(console.error);
}

// deep link: a shared #story=<slug> link opens that article straight away
function openStoryFromHash() {
  const m = (location.hash || '').match(/^#story=(.+)$/);
  if (!m) return false;
  const slug = decodeURIComponent(m[1]);
  const a = (S.articles || []).find(x => x.slug === slug);
  if (!a) return false;
  curArticle = a;
  openStory(a);
  track('story_open', { date: a.date, via: 'link' });
  return true;
}

// ── today's live fixtures card (home) ─────────────────────────────────────────
function _slateIso(f) {
  const h = parseInt(String(f.time_il).slice(0, 2), 10);
  if (h < 6) { const d = new Date(f.date_il + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  return f.date_il;
}
function todayMatches() {
  const iso = _todayIso();
  return (S.fixtures || []).filter(f => _slateIso(f) === iso).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
}
function resultFor(id) { return (S.results || []).find(r => r.id === id) || null; }
function _crescent() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', '8'); s.setAttribute('height', '8'); s.setAttribute('viewBox', '0 0 8 8'); s.setAttribute('aria-hidden', 'true');
  s.classList.add('ts-cres');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M5.6 1 A3 3 0 1 0 5.6 7 A2.3 2.3 0 1 1 5.6 1Z'); p.setAttribute('fill', 'currentColor');
  s.appendChild(p); return s;
}
function _stripItem(f, tieFix) {
  const it = document.createElement('span');
  it.className = 'ts-item' + (tieFix && (f.home + ' - ' + f.away) === tieFix ? ' tie' : '');
  const teams = document.createElement('span'); teams.textContent = f.home + ' — ' + f.away;
  it.appendChild(teams);
  const res = resultFor(f.id);
  const sc = document.createElement('span'); sc.className = 'ts-sc';
  if (res) { it.classList.add('played'); sc.textContent = res.ft[0] + '-' + res.ft[1]; }
  else { if (f.after_midnight) it.appendChild(_crescent()); sc.textContent = f.time_il; }
  it.appendChild(sc);
  return it;
}
function renderTodayCard() {
  const card = $('today-card'); if (!card) return;
  const ms = todayMatches();
  if (!ms.length) { card.hidden = true; return; }
  card.hidden = false;
  const track = $('today-card-list'); track.innerHTML = '';
  const tieFix = curArticle && curArticle.fixture;
  // two passes = a seamless marquee loop (the @keyframes translate spans one copy)
  for (let pass = 0; pass < 2; pass++) for (const f of ms) track.appendChild(_stripItem(f, tieFix));
}

// ── boot ──────────────────────────────────────────────────────────────────────
let boardReturn = 's3';
function wire() {
  $('btn-start').addEventListener('click', () => {
    track('game_start');
    resetGame();
    S.challenge = null;
    S.challengePlan = null;
    if (seenHowto()) showLegends(); else showHowto(true);
  });
  $('daily-btn').addEventListener('click', showDaily);
  $('daily-close').addEventListener('click', () => show('s1'));
  $('story-btn').addEventListener('click', () => { openStoriesHub(); track('stories_open'); });
  $('story-back').addEventListener('click', backFromReader);
  $('story-back-top').addEventListener('click', backFromReader);
  $('stories-back-top').addEventListener('click', () => show('s1'));
  $('story-share').addEventListener('click', () => doShareStory('story-share', 'story_share'));
  $('story-share-cta').addEventListener('click', () => doShareStory('story-share-cta', 'story_share_cta'));
  window.addEventListener('hashchange', openStoryFromHash);
  $('howto-link').addEventListener('click', () => { track('guide_open', { from: 'home' }); showGuide(null, 's1'); });
  $('guide-back').addEventListener('click', () => show(S.guideReturn || 's1'));
  $('scoring-link').addEventListener('click', () => { track('guide_open', { from: 'result' }); showGuide('score', 's6'); });
  $('ht-next').addEventListener('click', htNext);
  $('btn-lang').addEventListener('click', () => {
    const to = getLang() === 'he' ? 'en' : 'he';
    setLang(to);
    updateLangButton();
    updateDailyBtn();
    updateStoryBtn();
    if ($('s-stories').classList.contains('active')) openStoriesHub();
    else if ($('s-story').classList.contains('active') && curArticle) openStory(curArticle);
    if ($('s-guide').classList.contains('active')) renderGuide();
    track('lang_switch', { to });
  });
  $('btn-skip-team').addEventListener('click', () => skip('team'));
  $('btn-skip-year').addEventListener('click', () => skip('year'));
  $('btn-skip-team-s3').addEventListener('click', () => skip('team'));
  $('btn-skip-year-s3').addEventListener('click', () => skip('year'));
  $('board-toggle').addEventListener('click', () => { boardReturn = 's3'; renderBoard(); show('s4'); });
  $('joker-swap').addEventListener('click', enterSwapMode);
  $('joker-keep').addEventListener('click', startTournament);
  $('btn-name-lock').addEventListener('click', lockTeamName);
  $('team-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') lockTeamName(); });
  $('board-close').addEventListener('click', () => show(boardReturn));
  $('btn-next-match').addEventListener('click', nextMatch);
  const tacSlider = $('tac-slider');
  if (tacSlider) tacSlider.addEventListener('input', () => {
    S.mentality = Math.min(Math.max((+tacSlider.value || 0) / 100, 0), 1);
    const cur = $('tac-current'); if (cur) cur.textContent = mentName(S.mentality);
    tacSlider.setAttribute('aria-valuetext', mentName(S.mentality));
    updateWinPct(); // the chance moves live as you drag — the heart of the decision room
  });
  $('group-cta').addEventListener('click', () => track('group_join', { from: 'result' }));
  $('daily-group-link').addEventListener('click', () => track('group_join', { from: 'board' }));
  $('btn-again').addEventListener('click', () => { resetGame(); show('s1'); });
  $('btn-swap').addEventListener('click', () => { track('swap_open'); showSwap(); });
  $('swap-cancel').addEventListener('click', () => show('s6')); // return to the existing result (don't re-arm the board submit)
  $('lb-save').addEventListener('click', () => {
    const v = setNick($('lb-nick').value);
    if (!v) { $('lb-nick').focus(); return; }
    // stage the final name; the run is submitted once when you leave the screen.
    if (S.lbPending && !S.lbSubmitted) S.lbPending.name = v;
    else if (S.challenge && S.journey && !S.lbSubmitted) S.lbPending = { row: buildScoreRow(S.challenge, S.journey), date: S.challenge.date, day: S.challenge.d, name: v };
    markSent(v);
  });
  $('lb-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lb-save').click(); } });
  $('lb-change').addEventListener('click', () => {
    $('lb-sent').hidden = true; $('lb-change').hidden = true;
    $('lb-setnick').hidden = false; $('lb-nick').value = getNick();
    $('lb-nick').focus(); $('lb-nick').select();
  });
  // closing the tab on the result screen still commits the run (keepalive insert).
  window.addEventListener('pagehide', () => { flushPendingRun(); });
  $('lb-view').addEventListener('click', () => openBoard(S.challenge, 's6'));
  $('daily-board-link').addEventListener('click', () => openBoard(todayChallenge(), 's-daily'));
  $('home-board-link').addEventListener('click', () => { openBoard(todayChallenge(), 's1'); track('board_open', { from: 'home' }); });
  $('board-back').addEventListener('click', () => show(S.boardReturn || 's1'));
  $('btn-share').addEventListener('click', () => {
    track('share', { stage: S.journey ? S.journey.finalStage : 'unknown', daily: S.challenge ? S.challenge.d : undefined });
    const daily = S.challenge ? { day: S.challenge.d, title: chTitle(S.challenge), gist: chGist(S.challenge), ok: S.challengeOk, tries: S.challenge.tries ? S.tryNo : 0, proof: challengeProof(S.challenge, S.journey), mark: challengeMark(S.challenge, S.journey), year: (S.challenge.pickYear && S.challenge.flt && S.challenge.flt.years) ? S.challenge.flt.years[0] : null } : null;
    shareResult(S.xi, S.journey, SLOTS, SLOT_LABEL, surname, flagSrc, S.teamName, daily, tourneyAchievement(S.journey)).catch(console.error);
  });
}

applyStatic();
// test hook: lets the E2E driver start any day's challenge regardless of date
window.__gxiPlayDay = (d, opts) => {
  const c = (S.challenges || []).find(x => x.d === d);
  if (!c) return false;
  resetGame();
  S.challenge = c;
  S.challengePlan = buildChallengePlan(c);
  bumpTries(c);
  if (c.pickYear) {
    const y = (opts && opts.year) || 1998;
    S.challenge = { ...c, flt: { years: [y] } };
    S.pickedYear = y;
    S.skips.year = 0;
  }
  showLegends();
  return true;
};
// test hook: open the day-10 World Cup picker screen (the step __gxiPlayDay skips)
window.__gxiPickYear = () => {
  const c = (S.challenges || []).find(x => x.d === 10);
  if (!c) return false;
  resetGame();
  S.challenge = c;
  S.challengePlan = buildChallengePlan(c);
  bumpTries(c);
  showPickYear();
  return true;
};
// test hook: evaluate a challenge against a synthetic journey + XI
window.__gxiEvalWin = (c, J, xi) => {
  const keep = S.xi;
  if (xi) S.xi = xi;
  const r = evalChallenge(c, J);
  S.xi = keep;
  return r;
};
// test hook: proof + mark strings (both languages) for a synthetic challenge/journey/XI
window.__gxiProofMark = (c, J, xi, ok, tryNo) => {
  const keep = { xi: S.xi, ch: S.challenge, ok: S.challengeOk, tn: S.tryNo };
  if (xi) S.xi = xi;
  S.challenge = c; S.challengeOk = ok; S.tryNo = tryNo || 0;
  const cur = getLang();
  setLang('en'); const en = { proof: challengeProof(c, J), mark: challengeMark(c, J) };
  setLang('he'); const he = { proof: challengeProof(c, J), mark: challengeMark(c, J) };
  setLang(cur);
  Object.assign(S, { xi: keep.xi, challenge: keep.ch, challengeOk: keep.ok, tryNo: keep.tn });
  return { en, he };
};

// test hook: open the daily board for a given challenge (the driver stubs fetch with
// synthetic rows so the GloryScore ranking/render can be verified without a live write)
window.__gxiOpenBoard = (c) => openBoard(c, 's1');

loadData()
  .then(() => {
    wire(); updateLangButton(); updateDailyBtn(); updateStoryBtn();
    const joined = joinLeagueFromQuery();
    renderLeaguePanel();
    if (openStoryFromHash()) { /* a #story= link wins */ }
    else if (joined) show('s-daily');   // land an invited friend on today's challenge
    else show('s1');
  })
  .catch(err => {
    console.error('load failed', err);
    document.querySelector('#loading .load-cap').textContent = t('load_fail');
  });
