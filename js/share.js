/* GloryXI share card — TV broadcast lineup graphic, 1080×1350.
   Chalkboard pitch, 11 nation-kit jerseys with name + rating, verdict header. */

import { kitFor } from './kits.js';

const INK = '#101010', BONE = '#EDE8DF', HOT = '#2BD4C0', GOLD = '#F5C518', GREY = '#8a857c';

const STAGE_VERDICT = {
  GROUP_EXIT: 'OUT — GROUP STAGE', R32: 'OUT — ROUND OF 32', R16: 'OUT — ROUND OF 16',
  QF: 'OUT — QUARTER-FINAL', SF: 'OUT — SEMI-FINAL', F: 'BEATEN FINALISTS',
  CHAMPION: 'CHAMPIONS OF THE WORLD',
};

// plate centers, % of pitch area — GK bottom, STs top (matches the in-app board)
const XY = {
  ST1: [33, 12], ST2: [67, 12],
  LM: [14, 36], CM1: [38, 42], CM2: [62, 42], RM: [86, 36],
  LB: [14, 64], CB1: [38, 70], CB2: [62, 70], RB: [86, 64],
  GK: [50, 90],
};

const CODE = (c) => ({
  'United States': 'USA', 'West Germany': 'FRG', 'East Germany': 'GDR',
  'Soviet Union': 'URS', 'South Korea': 'KOR', 'North Korea': 'PRK',
  'Northern Ireland': 'NIR', 'Republic of Ireland': 'IRL', 'South Africa': 'RSA',
  'Saudi Arabia': 'KSA', 'New Zealand': 'NZL', 'Costa Rica': 'CRC',
  'Czech Republic': 'CZE', 'Czechoslovakia': 'TCH', 'Yugoslavia': 'YUG',
  'Serbia and Montenegro': 'SCG', 'Dutch East Indies': 'DEI', 'DR Congo': 'COD',
  'El Salvador': 'SLV', 'Trinidad and Tobago': 'TRI', 'United Arab Emirates': 'UAE',
  'Bosnia and Herzegovina': 'BIH', 'Ivory Coast': 'CIV', 'Cape Verde': 'CPV',
}[c] || c.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase());

async function loadAnton() {
  try { await Promise.race([document.fonts.load('80px Anton'), new Promise(r => setTimeout(r, 1200))]); }
  catch (e) { /* fallback fonts are fine */ }
}

/* Draw a nation-kit jersey "magnet" centred at (cx, cy), `w` wide.
   Uses the shared KIT map so the share card matches the in-app pitch. */
function drawJersey(x, cx, cy, w, country) {
  const k = kitFor(country);
  const body = k.primary, trim = k.secondary, accent = k.accent || k.secondary;
  const s = w / 100;               // scale from the 100-unit jersey design
  const X = (u) => cx + (u - 50) * s;
  const Y = (u) => cy + (u - 50) * s;

  // shirt silhouette (collar + sleeves + body)
  const shirt = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(X(50), Y(8));
    ctx.lineTo(X(62), Y(8)); ctx.lineTo(X(70), Y(12)); ctx.lineTo(X(92), Y(26));
    ctx.lineTo(X(84), Y(44)); ctx.lineTo(X(74), Y(38)); ctx.lineTo(X(74), Y(90));
    ctx.lineTo(X(26), Y(90)); ctx.lineTo(X(26), Y(38)); ctx.lineTo(X(16), Y(44));
    ctx.lineTo(X(8), Y(26)); ctx.lineTo(X(30), Y(12)); ctx.lineTo(X(38), Y(8));
    ctx.closePath();
  };

  // soft drop shadow — the magnet floats above the chalk
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowBlur = 16; x.shadowOffsetX = 6; x.shadowOffsetY = 9;
  x.fillStyle = body;
  shirt(x); x.fill();
  x.restore();

  // pattern, clipped to the shirt
  x.save();
  shirt(x); x.clip();
  if (k.pattern === 'stripes') {
    x.fillStyle = trim;
    for (let u = 30; u < 74; u += 24) x.fillRect(X(u), Y(20), 12 * s, 70 * s);
  } else if (k.pattern === 'hoops') {
    x.fillStyle = trim;
    for (let u = 26; u < 90; u += 22) x.fillRect(X(20), Y(u), 60 * s, 11 * s);
  } else if (k.pattern === 'sash') {
    x.fillStyle = trim;
    x.beginPath();
    x.moveTo(X(20), Y(90)); x.lineTo(X(20), Y(72)); x.lineTo(X(70), Y(20));
    x.lineTo(X(84), Y(32)); x.lineTo(X(34), Y(90));
    x.closePath(); x.fill();
  }
  x.restore();

  // sleeves accent
  x.fillStyle = accent;
  x.beginPath();
  x.moveTo(X(30), Y(12)); x.lineTo(X(8), Y(26)); x.lineTo(X(16), Y(44)); x.lineTo(X(26), Y(38)); x.closePath(); x.fill();
  x.beginPath();
  x.moveTo(X(70), Y(12)); x.lineTo(X(92), Y(26)); x.lineTo(X(84), Y(44)); x.lineTo(X(74), Y(38)); x.closePath(); x.fill();

  // outline + collar
  x.strokeStyle = 'rgba(16,16,16,0.6)'; x.lineWidth = Math.max(2, 2.5 * s);
  shirt(x); x.stroke();
  x.fillStyle = trim;
  x.beginPath();
  x.moveTo(X(38), Y(8)); x.lineTo(X(50), Y(20)); x.lineTo(X(62), Y(8));
  x.lineTo(X(57), Y(8)); x.lineTo(X(50), Y(14)); x.lineTo(X(43), Y(8));
  x.closePath(); x.fill();
}

export async function shareResult(xi, J, SLOTS, SLOT_LABEL, surname, flagSrc, teamName, daily) {
  teamName = (teamName || 'YOUR XI').toUpperCase();
  await loadAnton();
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const champion = J.finalStage === 'CHAMPION';
  const verdict = STAGE_VERDICT[J.finalStage] || J.finalStage;
  // per-slot goal tally from the journey — for the scorer ball on each jersey
  const goalsBySlot = {};
  for (const m of (J.journey || [])) for (const s of (m.scorers || [])) if (s.slot) goalsBySlot[s.slot] = (goalsBySlot[s.slot] || 0) + 1;

  // background — warm-charcoal slate with a soft vignette (chalkboard)
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2A221A');
  bg.addColorStop(0.5, '#211B14');
  bg.addColorStop(1, '#15110B');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const vig = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  x.fillStyle = vig;
  x.fillRect(0, 0, W, H);

  // header
  x.textAlign = 'left';
  x.fillStyle = champion ? GOLD : HOT;
  x.font = '600 28px "Space Grotesk", sans-serif';
  x.fillText(teamName + '   ·   F I N A L   R E S U L T', 60, 78);
  x.fillStyle = champion ? GOLD : BONE;
  x.font = '84px Anton, "Arial Narrow", sans-serif';
  x.fillText(verdict, 60, 165, W - 120);
  const R = J.record;
  x.fillStyle = BONE;
  x.font = '30px "Courier New", monospace';
  x.fillText(`${R.w}W ${R.d}D ${R.l}L   GOALS ${R.gf}-${R.ga}`, 60, 215);

  // daily challenge strip — full-width gold bar: day + name + gist + proof of HOW + the day's mark
  const tickMark = daily ? (daily.ok === true ? ' ✓' : daily.ok === false ? ' ✗' : '') : '';
  const rows = [];
  if (daily) {
    rows.push({ s: 'DAILY #' + daily.day + ' · ' + daily.title + tickMark, f: '30px Anton, "Arial Narrow", sans-serif' });
    const g2 = (daily.gist || '') + (daily.tries ? '  ·  ATTEMPT ' + daily.tries : '');
    if (g2.trim()) rows.push({ s: g2, f: '600 25px "Space Grotesk", "Segoe UI", sans-serif' });
    if (daily.proof) rows.push({ s: tickMark.trim() + '  ' + daily.proof, f: '800 24px "Space Grotesk", "Segoe UI", sans-serif' });
    if (daily.mark) rows.push({ s: daily.mark, f: '800 24px "Space Grotesk", "Segoe UI", sans-serif' });
  }
  const stripH = daily ? (18 + rows.length * 30 + 8) : 0;
  if (daily) {
    const sy = 238;
    x.fillStyle = GOLD;
    x.fillRect(60, sy, W - 120, stripH);
    x.fillStyle = INK;
    x.textAlign = 'center';
    rows.forEach((r, i) => { x.font = r.f; x.fillText(r.s, W / 2, sy + 32 + i * 30, W - 110); });
    x.textAlign = 'left';
  }

  // pitch zone — a coach's dark slate with chalk-drawn lines (shifted under daily strip)
  const PX = 60, PW = W - 120;
  const PY = daily ? (238 + stripH + 23) : 260;
  const PH = daily ? (1180 - PY) : 920;
  // slate panel: faint dark-green hint over the charcoal
  const slate = x.createLinearGradient(PX, PY, PX, PY + PH);
  slate.addColorStop(0, 'rgba(47,143,74,0.10)');
  slate.addColorStop(0.5, 'rgba(33,27,20,0.55)');
  slate.addColorStop(1, 'rgba(47,143,74,0.10)');
  x.fillStyle = '#1B160F';
  x.fillRect(PX, PY, PW, PH);
  x.fillStyle = slate;
  x.fillRect(PX, PY, PW, PH);
  // chalk lines — soft bone strokes, slightly rough
  x.strokeStyle = 'rgba(237,232,223,0.82)';
  x.lineWidth = 3; x.lineCap = 'round';
  x.strokeRect(PX, PY, PW, PH);
  x.beginPath(); x.moveTo(PX, PY + PH / 2); x.lineTo(PX + PW, PY + PH / 2); x.stroke();
  x.beginPath(); x.arc(PX + PW / 2, PY + PH / 2, 95, 0, Math.PI * 2); x.stroke();
  x.strokeRect(PX + PW * 0.24, PY, PW * 0.52, 105);
  x.strokeRect(PX + PW * 0.24, PY + PH - 105, PW * 0.52, 105);
  // centre spot + penalty spots in chalk
  x.fillStyle = 'rgba(237,232,223,0.7)';
  [[PX + PW / 2, PY + PH / 2], [PX + PW / 2, PY + 72], [PX + PW / 2, PY + PH - 72]].forEach(([sx, sy]) => {
    x.beginPath(); x.arc(sx, sy, 4, 0, Math.PI * 2); x.fill();
  });

  // jersey magnets — one per slot, in nation kit colours, with name + rating
  const JW = 96;                       // jersey width
  for (const slot of SLOTS) {
    const p = xi[slot];
    const [cx, cy] = XY[slot];
    const px = PX + PW * cx / 100;
    const py = PY + PH * cy / 100;
    const jcy = py - 14;               // jersey sits a touch above the label

    // the colored jersey (with soft drop shadow, drawn inside)
    drawJersey(x, px, jcy, JW, p.c);

    // name pill under the jersey
    const name = surname(p.n).toUpperCase();
    x.font = '32px Anton, "Arial Narrow", sans-serif';
    const nw = Math.min(x.measureText(name).width, 190);
    const pillW = Math.max(nw + 26, 88), pillH = 38;
    const pillY = jcy + JW / 2 + 4;
    x.fillStyle = 'rgba(16,14,10,0.88)';
    x.fillRect(px - pillW / 2, pillY, pillW, pillH);
    x.strokeStyle = 'rgba(237,232,223,0.45)'; x.lineWidth = 1.5;
    x.strokeRect(px - pillW / 2, pillY, pillW, pillH);
    x.fillStyle = BONE;
    x.textAlign = 'center';
    x.fillText(name, px, pillY + 28, pillW - 16);

    // meta line under the name
    x.font = '600 17px "Space Grotesk", sans-serif';
    x.fillStyle = GREY;
    x.fillText(CODE(p.c) + ' ' + String(p.y).slice(2).padStart(2, '0') + ' · ' + SLOT_LABEL[slot].replace(' ', ''), px, pillY + pillH + 18);

    // rating chip pinned at the jersey's top-right
    const chipR = 23;
    const chipX = px + JW / 2 - 8, chipY = jcy - JW / 2 + 12;
    x.fillStyle = champion ? GOLD : HOT;
    x.beginPath(); x.arc(chipX, chipY, chipR, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(16,16,16,0.6)'; x.lineWidth = 2;
    x.beginPath(); x.arc(chipX, chipY, chipR, 0, Math.PI * 2); x.stroke();
    x.fillStyle = INK;
    x.font = '28px Anton, "Arial Narrow", sans-serif';
    x.fillText(String(p.r), chipX, chipY + 10);
    x.textAlign = 'left';

    // scorer ball — top-left of the jersey, white football + a gold goal-count tab
    const goals = goalsBySlot[slot] || 0;
    if (goals > 0) {
      const bR = 19, bx = px - JW / 2 + 8, by = jcy - JW / 2 + 14;
      x.fillStyle = '#f4f4f4';
      x.beginPath(); x.arc(bx, by, bR, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#111'; x.lineWidth = 2.5;
      x.beginPath(); x.arc(bx, by, bR, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#111';
      [[0, -7], [7, 3], [-7, 3], [4, 9], [-4, 9]].forEach(([dx, dy]) => { x.beginPath(); x.arc(bx + dx, by + dy, 2.3, 0, Math.PI * 2); x.fill(); });
      // goal-count tab, bottom-right of the ball
      const tx = bx + bR - 1, ty = by + bR - 1;
      x.fillStyle = INK;
      x.beginPath(); x.arc(tx, ty, 13, 0, Math.PI * 2); x.fill();
      x.strokeStyle = GOLD; x.lineWidth = 2;
      x.beginPath(); x.arc(tx, ty, 13, 0, Math.PI * 2); x.stroke();
      x.fillStyle = GOLD;
      x.font = '700 16px "Space Grotesk", sans-serif';
      x.textAlign = 'center';
      x.fillText(String(goals), tx, ty + 5);
      x.textAlign = 'left';
    }
  }

  // footer
  const avg = Math.round(SLOTS.reduce((s, k) => s + xi[k].r, 0) / 11);
  x.fillStyle = champion ? GOLD : HOT;
  x.font = '600 30px "Space Grotesk", sans-serif';
  x.fillText('AVERAGE RATING  ' + avg, 60, H - 92);
  x.fillStyle = GREY;
  x.font = '24px "Space Grotesk", sans-serif';
  x.fillText('Every nation · every year · 1930—2026', 60, H - 54);
  x.fillStyle = champion ? GOLD : BONE;
  x.font = '600 26px "Space Grotesk", sans-serif';
  x.textAlign = 'right';
  x.fillText('Build yours ▸ moshfrenkel.github.io/gloryxi', W - 60, H - 92);
  x.textAlign = 'left';

  // export
  window.__shareCanvas = cv; // test hook for the E2E driver
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  const file = new File([blob], 'gloryxi.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'GloryXI',
        text: (daily ? 'GloryXI Daily #' + daily.day + ' · ' + daily.title + (daily.ok === true ? ' ✓' : daily.ok === false ? ' ✗' : '')
          + (daily.tries ? (daily.ok === true ? ' in ' + daily.tries + (daily.tries === 1 ? ' try' : ' tries') : ' · attempt ' + daily.tries) : '')
          + (daily.mark ? '\n' + daily.mark : '') + '\n' : '') +
          teamName + ' — ' + verdict + '. Build your own all-time XI: https://moshfrenkel.github.io/gloryxi/',
      });
      return;
    } catch (e) { /* cancelled — fall through to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gloryxi.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
