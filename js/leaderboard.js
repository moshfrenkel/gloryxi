/* Daily leaderboard client — submits a finished daily-challenge score to Supabase.
   Anonymous: a self-chosen nickname + the game result only. No PII, no tracking.
   Fully optional: if config.js isn't filled, every function is a safe no-op. */

const NICK_KEY = 'gxi_nick';
const LEAGUE_KEY = 'gxi_league';
const cfg = () => (window.GXI_CFG || {});

export function lbConfigured() { const c = cfg(); return !!(c.supaUrl && c.supaKey); }
export function getNick() { try { return localStorage.getItem(NICK_KEY) || ''; } catch (_) { return ''; } }
export function setNick(n) {
  const v = (n || '').trim().slice(0, 20);
  try { localStorage.setItem(NICK_KEY, v); } catch (_) { /* ok */ }
  return v;
}

// ── private league membership (you can be in several at once) ─────────────────
// A league is a shared { code, name }: the code travels in the invite link and in
// each score row (league_codes[] column); names cached locally + sent for display.
// A single run counts for EVERY league you're in.
const LEAGUES_KEY = 'gxi_leagues';
export function getLeagues() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEAGUES_KEY) || 'null');
    if (Array.isArray(raw)) return raw.filter(x => x && x.code);
    // migrate the old single-league key, if present
    const old = JSON.parse(localStorage.getItem(LEAGUE_KEY) || 'null');
    if (old && old.code) { const a = [old]; try { localStorage.setItem(LEAGUES_KEY, JSON.stringify(a)); } catch (_) {} return a; }
    return [];
  } catch (_) { return []; }
}
export function addLeague(code, name) {
  const c = String(code || '').trim().slice(0, 24);
  const n = String(name || '').trim().slice(0, 40) || c;
  if (!c) return getLeagues();
  const all = getLeagues();
  const i = all.findIndex(l => l.code === c);
  if (i >= 0) all[i] = { code: c, name: n }; else all.push({ code: c, name: n });
  try { localStorage.setItem(LEAGUES_KEY, JSON.stringify(all)); } catch (_) { /* ok */ }
  return all;
}
export function removeLeague(code) {
  const all = getLeagues().filter(l => l.code !== code);
  try { localStorage.setItem(LEAGUES_KEY, JSON.stringify(all)); } catch (_) { /* ok */ }
  return all;
}

// read today's board (anon select); returns array of rows, or null if off/unreachable.
// pass a leagueCode to fetch only that private league's rows (server-side filter).
export async function fetchBoard(gameDate, leagueCode) {
  const c = cfg();
  if (!c.supaUrl || !c.supaKey) return null;
  try {
    let url = c.supaUrl.replace(/\/+$/, '') + '/rest/v1/daily_scores?game_date=eq.' + encodeURIComponent(gameDate);
    if (leagueCode) url += '&league_codes=cs.' + encodeURIComponent('{' + leagueCode + '}');   // array contains
    url += '&select=*';
    const r = await fetch(url, { headers: { apikey: c.supaKey, Authorization: 'Bearer ' + c.supaKey } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

// fire-and-forget insert; never throws, never blocks gameplay.
// returns the created row (with its id) so the caller can rename it in place, or null.
export async function submitDailyScore(row) {
  const c = cfg();
  if (!c.supaUrl || !c.supaKey || !row || !row.nick) return null;
  try {
    const r = await fetch(c.supaUrl.replace(/\/+$/, '') + '/rest/v1/daily_scores', {
      method: 'POST',
      headers: {
        'apikey': c.supaKey,
        'Authorization': 'Bearer ' + c.supaKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(row),
      keepalive: true,
    });
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (_) { return null; }
}
