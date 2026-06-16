/* Daily leaderboard client — submits a finished daily-challenge score to Supabase.
   Anonymous: a self-chosen nickname + the game result only. No PII, no tracking.
   Fully optional: if config.js isn't filled, every function is a safe no-op. */

const NICK_KEY = 'gxi_nick';
const cfg = () => (window.GXI_CFG || {});

export function lbConfigured() { const c = cfg(); return !!(c.supaUrl && c.supaKey); }
export function getNick() { try { return localStorage.getItem(NICK_KEY) || ''; } catch (_) { return ''; } }
export function setNick(n) {
  const v = (n || '').trim().slice(0, 20);
  try { localStorage.setItem(NICK_KEY, v); } catch (_) { /* ok */ }
  return v;
}

// read today's board (anon select); returns array of rows, or null if off/unreachable
export async function fetchBoard(gameDate) {
  const c = cfg();
  if (!c.supaUrl || !c.supaKey) return null;
  try {
    const url = c.supaUrl.replace(/\/+$/, '') + '/rest/v1/daily_scores?game_date=eq.' + encodeURIComponent(gameDate) + '&select=*';
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
