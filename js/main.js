/* GloryXI V2 — UI state machine.
   Flow: S1 sleeve → S2 auto-draw → S3 squad sheet (player-first picking, board drawer S4)
   → S5 vidiprinter → S6 back cover.
   Mechanics: auto-spin (no hold), pick any player then a free compatible slot,
   ratings always visible, one player per country, 1 team-skip + 1 year-skip. */

import { simulateTournament, computeTeamScores, computeTeamElo } from './sim.js';
import { shareResult } from './share.js';
import { t, getLang, setLang, applyStatic } from './i18n.js';
import { kitFor, jerseySVG } from './kits.js';
import { lbConfigured, getNick, setNick, submitDailyScore, fetchBoard } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

const SLOTS = ['GK', 'RB', 'CB1', 'CB2', 'LB', 'CM1', 'CM2', 'RM', 'LM', 'ST1', 'ST2'];
const POS_SLOTS = {
  GK: ['GK'],
  DF: ['RB', 'CB1', 'CB2', 'LB'],
  MF: ['CM1', 'CM2', 'RM', 'LM'],
  FW: ['ST1', 'ST2'],
};
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
  const [p, t, f, ch] = await Promise.all([
    fetch('./data/players.json').then(r => r.json()),
    fetch('./data/teams.json').then(r => r.json()),
    fetch('./data/field2026.json').then(r => r.json()),
    fetch('./data/challenges.json').then(r => r.json()).catch(() => []),
  ]);
  S.players = p;
  S.teams = t.teams;
  S.combos = t.combos;
  S.field = f;
  S.challenges = ch;
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
// wideNatural (RB/LB/RM/LM only accept players whose real positions include
// that exact slot) / legendPos, legendMin (hall-of-legends restrictions).
function challengeFlt() { return (S.challenge && S.challenge.flt) || null; }

const WIDE_SLOTS = ['RB', 'LB', 'RM', 'LM'];
const CAP_GROUP = (slot) => slot === 'GK' ? 'GK'
  : slot === 'RB' || slot === 'LB' || slot.startsWith('CB') ? 'DF'
  : slot.startsWith('ST') ? 'FW' : 'MF';
const decadeOf = (y) => y < 1940 ? 193 : Math.floor(y / 10);
const ALL_DECADES = 9; // 30s 50s 60s 70s 80s 90s 00s 10s 20s — no 1940s cups

// where may THIS player go right now — single source of truth for the draw
// validator, the squad sheet and the hall of legends
function eligibleSlots(p) {
  const f = challengeFlt();
  let slots;
  if (f && f.pos) {
    if (!f.pos.includes(p.p)) return [];
    slots = freeSlots(); // position-theme days: eligible players go anywhere
  } else slots = slotsForPos(p.p);
  if (f && f.cap) slots = slots.filter(s => { const cap = f.cap[CAP_GROUP(s)]; return cap == null || p.r <= cap; });
  if (f && f.wideNatural) slots = slots.filter(s => !WIDE_SLOTS.includes(s) || (p.sp && p.sp.split('/').includes(s)));
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
    if (!f.rpt && S.used.has(c)) return false;
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
  for (const [key, ids] of [['team', ['btn-skip-team', 'btn-skip-team-s3']], ['year', ['btn-skip-year', 'btn-skip-year-s3']]]) {
    for (const id of ids) {
      const el = $(id);
      el.classList.toggle('avail', visible && S.skips[key] > 0);
      el.disabled = !(visible && S.skips[key] > 0);
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
  for (const slot of eligibleSlots(p)) {
    const b = document.createElement('button');
    b.className = 'slot-option';
    // dim slots outside the player's real positions (sp like "RB/CB") — placing
    // there still works but costs rating in the sim
    const token = slot === 'GK' ? 'GK' : slot.startsWith('CB') ? 'CB' : slot.startsWith('CM') ? 'CM' : slot.startsWith('ST') ? 'ST' : slot;
    if (p.sp && !p.sp.split('/').includes(token)) b.classList.add('off-pos');
    b.textContent = SLOT_LABEL[slot];
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

function renderPitchInto(containerId, withMeta, onSlotTap) {
  const box = $(containerId);
  box.innerHTML = '';
  for (const slot of SLOTS) {
    const [x, y] = SLOT_XY[slot];
    const d = document.createElement('div');
    d.className = 'b-slot' + (S.xi[slot] ? ' filled' : '');
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
    xiSim[slot] = { n: surname(p.n).toUpperCase(), p: p.p, r: p.r, sp: p.sp };
  }
  S.journey = simulateTournament(xiSim, S.field);

  show('s5');
  const feed = $('printer-feed');
  feed.innerHTML = '';
  addLine('faint', t('feed_open'));
  const J0 = S.journey;
  addLine('gold', t('takes_place', S.teamName, J0.replaced, J0.groupKey));

  // strength report — FIFA-style rating panel, so every defeat is explainable
  const groupOpps = J0.journey.filter(m => m.stage === 'GROUP').map(m => m.opponent);
  renderStrengthPanel(xiSim, groupOpps);

  S.feedIdx = 0;
  S.matchNo = 0;
  S.printing = false;
  const btn = $('btn-next-match');
  btn.disabled = false;
  btn.textContent = t('run_match', 1);
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
  const J = S.journey;
  if (S.feedIdx >= J.journey.length) { finishTournament(); return; }
  S.printing = true;
  const btn = $('btn-next-match');
  btn.disabled = true;

  const m = J.journey[S.feedIdx];
  S.feedIdx++;
  S.matchNo++;
  const stageTag = m.stage === 'GROUP' ? t('group_match', S.matchNo, J.groupKey) : stageName(m.stage);
  const win = m.scoreFor > m.scoreAgainst || (m.note && m.note.startsWith('(pens') && m.winnerIsA);

  renderScoreboard(m, stageTag, () => {
    if (m.stage !== 'GROUP' && win) flashWin();
    const last = S.feedIdx >= J.journey.length;
    if (last) {
      if (m.stage === 'GROUP') printGroupTable(J);
      addLine('verdict', stageVerdict(J.finalStage));
      if (J.finalStage === 'CHAMPION') flashWin();
      btn.textContent = t('full_time');
    } else {
      const nm = J.journey[S.feedIdx];
      btn.textContent = nm.stage === 'GROUP' ? t('run_match', S.matchNo + 1) : t('play_stage', stageName(nm.stage));
      if (m.stage === 'GROUP' && nm.stage !== 'GROUP') printGroupTable(J);
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
    const pct = Math.min(Math.max((oe - 1600) / 500 * 100, 6), 100);
    fill.style.width = pct + '%';
    if (oe >= elo) fill.classList.add('stronger');
    bar.appendChild(fill);
    const ev = document.createElement('span');
    ev.className = 'sp-opp-e';
    ev.textContent = oe;
    row.append(nm, bar, ev);
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

  const mkSide = (label, country) => {
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
    return side;
  };

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

  row.append(mkSide(S.teamName.length > 10 ? S.teamName.slice(0, 9) + '…' : S.teamName, null), scoreBox, mkSide(codeOf(m.opponent), m.opponent));
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
      for (const sc of (m.scorers || [])) {
        const line = document.createElement('div');
        line.className = 'sb-goal';
        line.textContent = sc.minute + "'  " + sc.name;
        scorersBox.appendChild(line);
      }
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

function finishTournament() { showResult(); }

// ── stage-2 win conditions — checked from the journey + the XI ────────────────
const STAGE_RANK = { GROUP_EXIT: 0, R32: 1, R16: 2, QF: 3, SF: 4, F: 5, CHAMPION: 6 };

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
    case 'decades':     // XI covers all 9 World Cup decades (day 7)
      return new Set(Object.values(S.xi).map(p => decadeOf(p.y))).size >= ALL_DECADES;
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
const MARK_METRIC = { 6: 'cleanest', 9: 'lowAvg', 13: 'lowAvg', 19: 'mostGoals', 24: 'fewestTries', 30: 'mostGoals', 31: 'cleanest', 34: 'cleanest' };
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
    case 'lowAvg':       return (he ? 'ממוצע ' : 'avg ') + r.avg;
    case 'mostGoals':    return r.gf + (he ? ' שערים' : ' goals');
    case 'fewestTries':  return (r.tries || '?') + (he ? ' ניסיונות' : ' tries');
    default:             return '(' + (r.gd >= 0 ? '+' : '') + r.gd + ')';
  }
}

function challengeMark(c, J) {
  if (!c || !J) return '';
  const he = getLang() === 'he', R = J.record;
  const r = { sv: challengeValue(c, J), ga: R.ga, avg: Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11), gf: R.gf, tries: S.tryNo || 0, gd: R.gf - R.ga };
  return (he ? 'ההישג שלך: ' : 'YOUR MARK: ') + dimDetail(dayDimension(c), r, he) + ' · ' + shortStage(J.finalStage);
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
  return {
    day: c.d, game_date: c.date, nick: getNick(),
    team: (S.teamName || '').slice(0, 30),
    stage: J.finalStage, stage_rank: STAGE_RANK[J.finalStage] ?? 0,
    ok: S.challengeOk, metric: markMetric(c), sv: challengeValue(c, J),
    avg, gd: R.gf - R.ga, gf: R.gf, ga: R.ga, tries: S.tryNo || 0,
  };
}

function markSent(nick) {
  $('lb-sent').textContent = t('lb_sent', nick);
  $('lb-sent').hidden = false; $('lb-setnick').hidden = true;
}

function renderLeaderboardRow(c, J) {
  const row = $('lb-row');
  if (!row) return;
  if (!c || !lbConfigured()) { row.hidden = true; return; }   // feature off until backend configured
  row.hidden = false;
  $('lb-view').hidden = false;
  const nick = getNick();
  if (nick) { submitDailyScore(buildScoreRow(c, J)); markSent(nick); }
  else { $('lb-sent').hidden = true; $('lb-setnick').hidden = false; $('lb-nick').value = ''; }
}

// ── in-app live leaderboard ───────────────────────────────────────────────────
// ranking order = met the daily rule, then the challenge magnitude (sv), then
// furthest, then goal-diff. So the board is the DAILY-CHALLENGE board, not a generic run.
const okRank = (r) => r.ok === true ? 2 : r.ok === false ? 0 : 1;
const lbCmp = (a, b) => okRank(b) - okRank(a) || (b.sv || 0) - (a.sv || 0) || b.stage_rank - a.stage_rank || b.gd - a.gd;
function rankBoard(rows) {
  const best = new Map();
  for (const r of rows) { const k = (r.nick || '').trim().toLowerCase(); if (!k) continue; if (!best.has(k) || lbCmp(r, best.get(k)) < 0) best.set(k, r); }
  return { ranked: [...best.values()].sort(lbCmp), count: best.size };
}
async function openBoard(c, ret) {
  if (!c || !lbConfigured()) return;
  S.boardReturn = ret || 's1';
  $('board-title').textContent = 'DAILY #' + c.d + ' · ' + chTitle(c);
  $('board-sub').textContent = c.date;
  $('board-list').innerHTML = '';
  const st = $('board-state'); st.hidden = false; st.textContent = t('lb_loading');
  show('s-board');
  const rows = await fetchBoard(c.date);
  if (rows === null) { st.textContent = t('lb_error'); return; }
  const { ranked, count } = rankBoard(rows);
  if (!ranked.length) { st.textContent = t('lb_empty'); return; }
  st.hidden = true;
  const dim = dayDimension(c), he = getLang() === 'he';
  const me = getNick().trim().toLowerCase();
  const list = $('board-list');
  ranked.forEach((r, i) => {
    const mine = me && (r.nick || '').trim().toLowerCase() === me;
    const li = document.createElement('li');
    li.className = 'board-li' + (mine ? ' me' : '');
    const rank = document.createElement('span'); rank.className = 'b-rank'; rank.textContent = i + 1;
    const nick = document.createElement('span'); nick.className = 'b-nick'; nick.dir = 'auto'; nick.textContent = r.nick;
    if (mine) { const you = document.createElement('span'); you.className = 'b-you t-cap'; you.textContent = ' ' + t('lb_you'); nick.appendChild(you); }
    const det = document.createElement('span'); det.className = 'b-det';
    det.textContent = shortStage(r.stage) + ' · ' + dimDetail(dim, r, he) + (r.ok === true ? ' ✓' : r.ok === false ? ' ✗' : '');
    li.append(rank, nick, det);
    list.appendChild(li);
  });
  const foot = document.createElement('li'); foot.className = 'board-foot t-cap'; foot.textContent = t('lb_players', count);
  list.appendChild(foot);
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
  $('verdict-avg').textContent = t('avg_rating', avg);
  document.querySelector('#s6 .tracklist-label').textContent = S.teamName;

  renderPitchInto('result-slots', true);
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
  S.tryNo = 0;
  S.spinning = false;
  S.feedIdx = 0; S.matchNo = 0; S.printing = false;
  $('s6').classList.remove('champion');
  renderBoard();
  renderPips();
  updateBoardCount();
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
  if (!c) { btn.hidden = true; return; }
  btn.hidden = false;
  $('daily-btn-label').textContent = t('daily_btn', c.d);
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
          if (seenHowto()) showLegends(); else showHowto(true);
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
  $('howto-link').addEventListener('click', () => showHowto(false));
  $('ht-next').addEventListener('click', htNext);
  $('btn-lang').addEventListener('click', () => {
    const to = getLang() === 'he' ? 'en' : 'he';
    setLang(to);
    updateLangButton();
    updateDailyBtn();
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
  $('group-cta').addEventListener('click', () => track('group_join', { from: 'result' }));
  $('daily-group-link').addEventListener('click', () => track('group_join', { from: 'board' }));
  $('btn-again').addEventListener('click', () => { resetGame(); show('s1'); });
  $('lb-save').addEventListener('click', () => {
    const v = setNick($('lb-nick').value);
    if (!v) { $('lb-nick').focus(); return; }
    if (S.challenge && S.journey) { submitDailyScore(buildScoreRow(S.challenge, S.journey)); track('lb_submit', { day: S.challenge.d }); }
    markSent(v);
  });
  $('lb-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lb-save').click(); } });
  $('lb-view').addEventListener('click', () => openBoard(S.challenge, 's6'));
  $('daily-board-link').addEventListener('click', () => openBoard(todayChallenge(), 's-daily'));
  $('board-back').addEventListener('click', () => show(S.boardReturn || 's1'));
  $('btn-share').addEventListener('click', () => {
    track('share', { stage: S.journey ? S.journey.finalStage : 'unknown', daily: S.challenge ? S.challenge.d : undefined });
    const daily = S.challenge ? { day: S.challenge.d, title: chTitle(S.challenge), gist: chGist(S.challenge), ok: S.challengeOk, tries: S.challenge.tries ? S.tryNo : 0, proof: challengeProof(S.challenge, S.journey), mark: challengeMark(S.challenge, S.journey) } : null;
    shareResult(S.xi, S.journey, SLOTS, SLOT_LABEL, surname, flagSrc, S.teamName, daily).catch(console.error);
  });
}

applyStatic();
// test hook: lets the E2E driver start any day's challenge regardless of date
window.__gxiPlayDay = (d) => {
  const c = (S.challenges || []).find(x => x.d === d);
  if (!c) return false;
  resetGame();
  S.challenge = c;
  S.challengePlan = buildChallengePlan(c);
  bumpTries(c);
  showLegends();
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

loadData()
  .then(() => { wire(); updateLangButton(); updateDailyBtn(); show('s1'); })
  .catch(err => {
    console.error('load failed', err);
    document.querySelector('#loading .load-cap').textContent = t('load_fail');
  });
