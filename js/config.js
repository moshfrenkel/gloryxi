/* Daily leaderboard backend (Supabase REST).
   The anon (public) key is safe to ship — Row-Level Security protects the table.
   Leave both empty to keep the leaderboard OFF (the app simply won't submit; no errors).
   Fill after creating the Supabase project. This is a plain (non-module) script so it
   sets a global the ES modules can read. */
window.GXI_CFG = {
  supaUrl: 'https://sqztsmwoanwvlwznbquu.supabase.co',
  supaKey: 'sb_publishable_WpJNhNoDtTylEriSFVWWJQ__m_bMhBZ' // publishable (public) key — safe to ship
};
