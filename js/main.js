/* GloryXI V2 — UI state machine.
   Flow: S1 sleeve → S2 auto-draw → S3 squad sheet (player-first picking, board drawer S4)
   → S5 vidiprinter → S6 back cover.
   Mechanics: auto-spin (no hold), pick any player then a free compatible slot,
   ratings always visible, one player per country, 1 team-skip + 1 year-skip. */

import { simulateTournament, computeTeamScores, computeTeamElo } from './sim.js';
import { shareResult } from './share.js';

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
const POS_TITLE = { GK: 'GOALKEEPERS', DF: 'DEFENDERS', MF: 'MIDFIELDERS', FW: 'FORWARDS' };

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
};

// ── data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  const [p, t, f] = await Promise.all([
    fetch('./data/players.json').then(r => r.json()),
    fetch('./data/teams.json').then(r => r.json()),
    fetch('./data/field2026.json').then(r => r.json()),
  ]);
  S.players = p;
  S.teams = t.teams;
  S.combos = t.combos;
  S.field = f;
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
  return 'https://flagcdn.com/' + t.iso2 + '.svg';
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

function comboValid([c, y]) {
  if (S.used.has(c)) return false;
  const squad = S.squads.get(c + '|' + y);
  if (!squad) return false;
  return squad.some(p => slotsForPos(p.p).length > 0);
}

function pickCombo(constraint) {
  // constraint: {keepYear} / {keepCountry} / null. Falls back to any valid combo.
  let pool = S.combos.filter(comboValid);
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

// ── S2 auto-spin ──────────────────────────────────────────────────────────────
function startDraw(constraint) {
  const ll = $('legend-list');
  if (ll && ll.childElementCount) ll.innerHTML = '';
  const target = pickCombo(constraint);
  if (!target) { startTournament(); return; }
  S.draw = { c: target[0], y: target[1] };
  S.spinning = true;

  show('s2');
  $('s2-round').textContent = 'PICK ' + (Object.keys(S.xi).length + 1) + ' OF 11';
  const stamp = $('draw-header');
  stamp.textContent = '';
  stamp.classList.remove('stamped');
  updateSkipBoxes(false);

  const flagEl = $('spin-flag');
  const yearEl = $('spin-year');
  flagEl.classList.add('spin-blur');
  flagEl.onerror = function () { this.style.visibility = 'hidden'; };

  const countries = Object.keys(S.teams);
  const years = [...new Set(S.combos.map(c => c[1]))];

  let elapsed = 0;
  let interval = 65;
  const totalFast = 1100;     // fast phase ms

  function tick() {
    elapsed += interval;
    const done = elapsed >= totalFast + 700;
    if (done) {
      // lock on target
      flagEl.style.visibility = '';
      flagEl.src = flagSrc(S.draw.c);
      flagEl.classList.remove('spin-blur');
      yearEl.textContent = S.draw.y;
      stamp.textContent = S.draw.c + ' ' + S.draw.y;
      stamp.classList.add('stamped');
      S.spinning = false;
      updateSkipBoxes(true);
      setTimeout(() => { if (!S.spinning) showSquad(); }, 850);
      return;
    }
    // decelerate after fast phase
    if (elapsed > totalFast) interval = Math.min(interval * 1.35, 320);
    const rc = countries[Math.floor(Math.random() * countries.length)];
    flagEl.style.visibility = '';
    flagEl.src = flagSrc(rc);
    yearEl.textContent = years[Math.floor(Math.random() * years.length)];
    setTimeout(tick, interval);
  }
  setTimeout(tick, interval);
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
  $('round-label').textContent = 'PICK ' + (Object.keys(S.xi).length + 1) + '/11';
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
  const squad = (S.squads.get(c + '|' + y) || []).slice()
    .sort((a, b) => b.r - a.r);

  for (const pos of POS_ORDER) {
    const group = squad.filter(p => p.p === pos);
    if (!group.length) continue;
    const rule = document.createElement('div');
    rule.className = 'pos-rule';
    const lbl = document.createElement('span');
    lbl.className = 'pr-label';
    lbl.textContent = POS_TITLE[pos];
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
  const open = slotsForPos(p.p);
  if (!open.length) row.classList.add('dim');

  const idBox = document.createElement('div');
  idBox.className = 'p-id';
  const nm = document.createElement('div');
  nm.className = 'p-name';
  nm.textContent = p.n.toUpperCase();
  const meta = document.createElement('div');
  meta.className = 'p-meta';
  const bits = [p.p2 || p.p];
  if (p.club) bits.push(p.club);
  if (p.caps) bits.push(p.caps + ' caps');
  if (p.g) bits.push(p.g + ' goals');
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
  cap.textContent = 'PLACE AT';
  strip.appendChild(cap);
  for (const slot of slotsForPos(p.p)) {
    const b = document.createElement('button');
    b.className = 'slot-option';
    b.textContent = SLOT_LABEL[slot];
    b.addEventListener('click', (e) => { e.stopPropagation(); place(p, slot); });
    strip.appendChild(b);
  }
  row.after(strip);
  strip.scrollIntoView({ block: 'nearest' });
}

function place(p, slot) {
  if (S.xi[slot]) return;
  S.xi[slot] = p;
  S.used.add(p.c);
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
  $('joker-sub').textContent = 'YOUR XI IS COMPLETE. SWAP ONE PLAYER FOR A FRESH DRAW — OR TRUST YOUR BOARD.';
  document.querySelector('.joker-pitch').classList.remove('swap-mode');
  renderPitchInto('joker-slots', true);
  $('joker-swap').style.visibility = 'visible';
}

function enterSwapMode() {
  $('joker-sub').textContent = 'TAP THE PLAYER YOU WANT TO REPLACE.';
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
      f.appendChild(makeFlag(p.c));
      const nm = document.createElement('div');
      nm.className = 'b-name';
      nm.textContent = surname(p.n).toUpperCase();
      const r = document.createElement('div');
      r.className = 'b-r';
      r.textContent = p.r;
      f.append(nm, r);
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
  const legends = S.players
    .filter(p => p.r >= LEGEND_MIN_RATING)
    .sort((a, b) => b.r - a.r);

  for (const pos of POS_ORDER) {
    const group = legends.filter(p => p.p === pos);
    if (!group.length) continue;
    const rule = document.createElement('div');
    rule.className = 'pos-rule';
    const lbl = document.createElement('span');
    lbl.className = 'pr-label';
    lbl.textContent = POS_TITLE[pos];
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
const STAGE_NAME = {
  GROUP: 'GROUP', R32: 'ROUND OF 32', R16: 'ROUND OF 16',
  QF: 'QUARTER-FINAL', SF: 'SEMI-FINAL', F: 'THE FINAL',
};
const STAGE_VERDICT = {
  GROUP_EXIT: 'OUT — GROUP STAGE', R32: 'OUT — ROUND OF 32', R16: 'OUT — ROUND OF 16',
  QF: 'OUT — QUARTER-FINAL', SF: 'OUT — SEMI-FINAL', F: 'BEATEN FINALISTS',
  CHAMPION: 'CHAMPIONS OF THE WORLD',
};

function startTournament() {
  // build sim XI
  const xiSim = {};
  for (const slot of SLOTS) {
    const p = S.xi[slot];
    xiSim[slot] = { n: surname(p.n).toUpperCase(), p: p.p, r: p.r };
  }
  S.journey = simulateTournament(xiSim, S.field);

  show('s5');
  const feed = $('printer-feed');
  feed.innerHTML = '';
  addLine('faint', '— RESULTS SERVICE OPEN —');
  const J0 = S.journey;
  addLine('gold', 'YOU TAKE ' + J0.replaced.toUpperCase() + "'S PLACE — GROUP " + J0.groupKey);

  // strength report — FIFA-style rating panel, so every defeat is explainable
  const groupOpps = J0.journey.filter(m => m.stage === 'GROUP').map(m => m.opponent);
  renderStrengthPanel(xiSim, groupOpps);

  S.feedIdx = 0;
  S.matchNo = 0;
  S.printing = false;
  const btn = $('btn-next-match');
  btn.disabled = false;
  btn.textContent = 'RUN MATCH 1';
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
  const stageTag = m.stage === 'GROUP' ? 'GROUP MATCH ' + S.matchNo + ' · GROUP ' + J.groupKey : STAGE_NAME[m.stage] || m.stage;
  const win = m.scoreFor > m.scoreAgainst || (m.note && m.note.startsWith('(pens') && m.winnerIsA);

  renderScoreboard(m, stageTag, () => {
    if (m.stage !== 'GROUP' && win) flashWin();
    const last = S.feedIdx >= J.journey.length;
    if (last) {
      if (m.stage === 'GROUP') printGroupTable(J);
      addLine('verdict', STAGE_VERDICT[J.finalStage] || J.finalStage);
      if (J.finalStage === 'CHAMPION') flashWin();
      btn.textContent = 'FULL TIME';
    } else {
      const nm = J.journey[S.feedIdx];
      btn.textContent = nm.stage === 'GROUP' ? 'RUN MATCH ' + (S.matchNo + 1) : 'PLAY ' + (STAGE_NAME[nm.stage] || nm.stage);
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
    { label: 'ATT', v: Math.round(sc.attack) },
    { label: 'MID', v: Math.round(sc.midfield) },
    { label: 'DEF', v: Math.round(sc.defense) },
  ];
  const weak = stats.reduce((a, b) => a.v <= b.v ? a : b);

  const panel = document.createElement('div');
  panel.className = 'strength-panel';

  const head = document.createElement('div');
  head.className = 'sp-head';
  const hLabel = document.createElement('span');
  hLabel.className = 'sp-title';
  hLabel.textContent = 'YOUR XI';
  const ovr = document.createElement('span');
  ovr.className = 'sp-ovr';
  ovr.textContent = elo;
  const ovrCap = document.createElement('span');
  ovrCap.className = 'sp-ovr-cap';
  ovrCap.textContent = 'SQUAD ELO';
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
    lbl.textContent = st.label + (st === weak ? ' · WEAK LINK' : '');
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

  row.append(mkSide('YOU', null), scoreBox, mkSide(codeOf(m.opponent), m.opponent));
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
  addLine('faint', '— FINAL TABLE · GROUP ' + J.groupKey + ' —');
  const name = t => t === 'USER_XI' ? 'YOUR XI' : t.toUpperCase();
  J.groupTable.forEach((r, i) => {
    const gd = r.gf - r.ga;
    const line = ' ' + (i + 1) + '  ' + name(r.team).slice(0, 14).padEnd(15) +
      String(r.pts).padStart(2) + 'PTS  ' + (gd >= 0 ? '+' : '') + gd;
    addLine(r.team === 'USER_XI' ? 'gold' : 'faint', line);
  });
  const TH = { 1: 'THROUGH AS GROUP WINNERS', 2: 'THROUGH AS RUNNERS-UP', 3: 'THROUGH — ONE OF THE BEST THIRDS' };
  if (J.finalStage !== 'GROUP_EXIT') addLine('gold', '— ' + (TH[J.rank] || 'THROUGH') + ' —');
}

function flashWin() {
  const f = document.createElement('div');
  f.className = 'win-flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 650);
}

function finishTournament() { showResult(); }

// ── S6 back cover ─────────────────────────────────────────────────────────────
function showResult() {
  const J = S.journey;
  show('s6');
  const s6 = $('s6');
  s6.classList.toggle('champion', J.finalStage === 'CHAMPION');

  $('verdict-stage').textContent = STAGE_VERDICT[J.finalStage] || J.finalStage;
  const R = J.record;
  $('verdict-record').textContent = R.w + 'W ' + R.d + 'D ' + R.l + 'L   ·   GOALS ' + R.gf + '–' + R.ga;
  const avg = Math.round(SLOTS.reduce((s, k) => s + S.xi[k].r, 0) / 11);
  $('verdict-avg').textContent = 'AVERAGE RATING ' + avg + ' · 1930—2026';

  renderPitchInto('result-slots', true);
}

// ── reset ─────────────────────────────────────────────────────────────────────
function resetGame() {
  S.xi = {};
  S.used = new Set();
  S.jokerOffered = false;
  S.skips = { team: 1, year: 1 };
  S.draw = null;
  S.journey = null;
  S.spinning = false;
  S.feedIdx = 0; S.matchNo = 0; S.printing = false;
  $('s6').classList.remove('champion');
  renderBoard();
  renderPips();
  updateBoardCount();
}

// ── boot ──────────────────────────────────────────────────────────────────────
let boardReturn = 's3';
function wire() {
  $('btn-start').addEventListener('click', () => { resetGame(); showLegends(); });
  $('legend-skip').addEventListener('click', () => startDraw(null));
  $('btn-skip-team').addEventListener('click', () => skip('team'));
  $('btn-skip-year').addEventListener('click', () => skip('year'));
  $('btn-skip-team-s3').addEventListener('click', () => skip('team'));
  $('btn-skip-year-s3').addEventListener('click', () => skip('year'));
  $('board-toggle').addEventListener('click', () => { boardReturn = 's3'; renderBoard(); show('s4'); });
  $('joker-swap').addEventListener('click', enterSwapMode);
  $('joker-keep').addEventListener('click', startTournament);
  $('board-close').addEventListener('click', () => show(boardReturn));
  $('btn-next-match').addEventListener('click', nextMatch);
  $('btn-again').addEventListener('click', () => { resetGame(); show('s1'); });
  $('btn-share').addEventListener('click', () => {
    shareResult(S.xi, S.journey, SLOTS, SLOT_LABEL, surname, flagSrc).catch(console.error);
  });
}

loadData()
  .then(() => { wire(); show('s1'); })
  .catch(err => {
    console.error('load failed', err);
    document.querySelector('#loading .load-cap').textContent = 'LOAD FAILED — REFRESH';
  });
