/* GloryXI share card — TV broadcast lineup graphic, 1080×1350.
   Blueprint pitch, 4-4-2 name plates with ratings, verdict header. */

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

export async function shareResult(xi, J, SLOTS, SLOT_LABEL, surname, flagSrc, teamName, daily) {
  teamName = (teamName || 'YOUR XI').toUpperCase();
  await loadAnton();
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const champion = J.finalStage === 'CHAMPION';
  const verdict = STAGE_VERDICT[J.finalStage] || J.finalStage;

  // background
  x.fillStyle = INK;
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

  // daily challenge strip — full-width gold bar: day + name + the gist of the rule
  if (daily) {
    const sy = 238, sh = 84;
    x.fillStyle = GOLD;
    x.fillRect(60, sy, W - 120, sh);
    x.fillStyle = INK;
    x.textAlign = 'center';
    x.font = '30px Anton, "Arial Narrow", sans-serif';
    x.fillText('DAILY #' + daily.day + ' · ' + daily.title + (daily.ok === true ? ' ✓' : daily.ok === false ? ' ✗' : ''), W / 2, sy + 35, W - 160);
    x.font = '600 26px "Space Grotesk", "Segoe UI", sans-serif';
    x.fillText((daily.gist || '') + (daily.tries ? '  ·  ATTEMPT ' + daily.tries : ''), W / 2, sy + 68, W - 160);
    x.textAlign = 'left';
  }

  // pitch zone — real grass with TV mowing stripes (shifted down under the daily strip)
  const PX = 60, PY = daily ? 345 : 260, PW = W - 120, PH = daily ? 835 : 920;
  const STRIPES = 9;
  for (let i = 0; i < STRIPES; i++) {
    x.fillStyle = i % 2 ? '#287D40' : '#2F8F4A';
    x.fillRect(PX, PY + PH * i / STRIPES, PW, PH / STRIPES + 1);
  }
  x.strokeStyle = 'rgba(255,255,255,0.92)';
  x.lineWidth = 2.5;
  x.strokeRect(PX, PY, PW, PH);
  // halfway + circle + boxes
  x.beginPath(); x.moveTo(PX, PY + PH / 2); x.lineTo(PX + PW, PY + PH / 2); x.stroke();
  x.beginPath(); x.arc(PX + PW / 2, PY + PH / 2, 95, 0, Math.PI * 2); x.stroke();
  x.strokeRect(PX + PW * 0.24, PY, PW * 0.52, 105);
  x.strokeRect(PX + PW * 0.24, PY + PH - 105, PW * 0.52, 105);

  // plates
  for (const slot of SLOTS) {
    const p = xi[slot];
    const [cx, cy] = XY[slot];
    const px = PX + PW * cx / 100;
    const py = PY + PH * cy / 100;

    const name = surname(p.n).toUpperCase();
    x.font = '38px Anton, "Arial Narrow", sans-serif';
    const nw = Math.min(x.measureText(name).width, 210);
    const plateW = Math.max(nw + 46, 150), plateH = 96;

    // plate
    x.fillStyle = 'rgba(16,16,16,0.9)';
    x.fillRect(px - plateW / 2, py - plateH / 2, plateW, plateH);
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1.5;
    x.strokeRect(px - plateW / 2, py - plateH / 2, plateW, plateH);

    // name
    x.fillStyle = BONE;
    x.textAlign = 'center';
    x.fillText(name, px, py - 8, plateW - 30);
    // meta
    x.font = '600 19px "Space Grotesk", sans-serif';
    x.fillStyle = GREY;
    x.fillText(CODE(p.c) + ' ' + String(p.y).slice(2).padStart(2, '0') + " · " + SLOT_LABEL[slot].replace(' ', ''), px, py + 22);
    // rating chip
    x.fillStyle = champion ? GOLD : HOT;
    x.fillRect(px + plateW / 2 - 27, py - plateH / 2 - 21, 54, 42);
    x.fillStyle = INK;
    x.font = '30px Anton, "Arial Narrow", sans-serif';
    x.fillText(String(p.r), px + plateW / 2, py - plateH / 2 + 11);
    x.textAlign = 'left';
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
          + (daily.tries ? (daily.ok === true ? ' in ' + daily.tries + (daily.tries === 1 ? ' try' : ' tries') : ' · attempt ' + daily.tries) : '') + '\n' : '') +
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
