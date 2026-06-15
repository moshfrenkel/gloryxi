/* GloryXI i18n — English default, Hebrew opt-in via the globe button.
   Layout never flips; only text changes. Player/nation names and the
   share card stay English (data + brand). */

const LS_KEY = 'gxi_lang';

const D = {
  // S1 sleeve
  loading:    { en: 'LOADING SQUADS', he: 'טוען סגלים' },
  s1q:        { en: 'CAN YOU WIN<br>IT ALL IN 2026?', he: 'תיקח את הגביע<br>ב-2026?' },
  s1tag:      { en: 'BUILD YOUR ALL-TIME XI.<br>SURVIVE THE TOURNAMENT.', he: 'מרכיבים נבחרת־על מכל הזמנים.<br>שורדים את הטורניר.' },
  kickoff:    { en: 'KICK OFF', he: 'שריקת פתיחה' },
  howto_link: { en: 'HOW TO PLAY', he: 'איך משחקים?' },
  footer:     { en: 'Not affiliated with FIFA · Data: Fjelstul World Cup Database (CC-BY-SA 4.0) · No player photos<br>No cookies · anonymous counts; opt-in nickname + result on the daily board (EU server, deleted after the tournament) · no identifying personal data',
                he: 'ללא קשר לפיפ"א · נתונים: Fjelstul World Cup Database (CC-BY-SA 4.0) · בלי תמונות שחקנים<br>בלי עוגיות · ספירות אנונימיות, ובבחירתך כינוי + תוצאה לטבלה היומית (שרת באירופה, נמחק בסוף הטורניר) · בלי מידע אישי מזהה' },
  a11y_link:  { en: 'Accessibility statement', he: 'הצהרת נגישות' },

  // S-STORY — Dante's daily article
  story_today: { en: "TODAY'S STORY", he: 'כתבת היום' },
  story_kicker_line: { en: 'DANTE OLIVERA · THE DAILY STORY', he: 'דאנטה אוליברה · הסיפור היומי' },
  stories_arch: { en: "MORE FROM DANTE'S NOTEBOOK", he: 'עוד מהיומן של דאנטה' },
  story_read:  { en: 'READ', he: 'קרא' },
  story_back:  { en: 'BACK', he: 'חזרה' },
  story_share: { en: 'SHARE', he: 'שתף' },
  story_share_cta: { en: 'SHARE THIS STORY', he: 'שתפו את הסיפור' },
  story_copied: { en: 'LINK COPIED', he: 'הקישור הועתק' },
  story_by:    { en: (n) => 'By ' + n + ' · GloryXI', he: (n) => 'מאת ' + n + ' · GloryXI' },
  dyk_label:   { en: 'DID YOU KNOW?', he: 'הידעת?' },
  sources_label: { en: 'SOURCES', he: 'מקורות' },
  today_title: { en: 'TODAY AT THE MONDIAL', he: 'היום במונדיאל' },
  story_disclaimer: { en: (n) => 'Written by ' + n + ", GloryXI's AI reporter. May contain inaccuracies, always worth cross-checking the sources below.",
                      he: (n) => 'נכתב על ידי ' + n + ', כתב ה-AI של GloryXI. עלול להכיל אי-דיוקים, תמיד כדאי להצליב מול המקורות למטה.' },

  // daily leaderboard
  lb_label:   { en: "JOIN TODAY'S BOARD — PICK A NICKNAME", he: 'הצטרף לטבלה של היום, בחר כינוי' },
  lb_ph:      { en: 'Your nickname', he: 'הכינוי שלך' },
  lb_save:    { en: 'ADD ME TO THE BOARD', he: 'תוסיפו אותי לטבלה' },
  lb_note:    { en: "Saved only if you choose to enter: a nickname + your result, shown on the daily board to all players (EU server). Pick a name that doesn't identify you. No tracking. Deleted when the tournament ends.",
                he: 'נשמרים רק אם תבחר להיכנס: כינוי + התוצאה, שמוצגים בטבלה היומית לכל השחקנים (שרת באירופה). בחר כינוי שלא מזהה אותך. בלי מעקב. נמחק בסוף הטורניר.' },
  lb_sent:    { en: (n) => 'ON THE DAILY BOARD AS ' + n, he: (n) => 'נשלחת לטבלה היומית בתור ' + n },
  lb_change:  { en: 'change nickname', he: 'שנה כינוי' },
  lb_today:   { en: "TODAY'S BOARD &#8594;", he: 'הטבלה של היום &#8592;' },
  lb_view:    { en: 'SEE THE DAILY BOARD &#8594;', he: 'לטבלה היומית &#8592;' },
  lb_board_title: { en: 'DAILY BOARD', he: 'הטבלה היומית' },
  lb_loading: { en: 'Loading the board…', he: 'טוען את הטבלה…' },
  lb_empty:   { en: 'No scores yet today. Be the first on the board.', he: 'עוד אין תוצאות היום. היה הראשון על הלוח.' },
  lb_error:   { en: 'Board unavailable right now. Try again later.', he: 'הטבלה לא זמינה כרגע. נסה שוב מאוחר יותר.' },
  lb_you:     { en: 'YOU', he: 'אתה' },
  lb_players: { en: (n) => n + (n === 1 ? ' player today' : ' players today'), he: (n) => n + ' שחקנים שיחקו היום' },

  // How-to overlay
  ht_title:   { en: 'HOW TO PLAY', he: 'איך משחקים' },
  ht1_t:      { en: 'THE DRAW', he: 'ההגרלה' },
  ht1_b:      { en: 'We draw you a nation and a year — say BRAZIL 1970. That squad is on the table.', he: 'מגרילים לך מדינה ושנה, נגיד ברזיל 1970. הסגל הזה מונח על השולחן.' },
  ht2_t:      { en: 'PICK YOUR XI', he: 'בוחרים נבחרת' },
  ht2_b:      { en: 'Pick ONE player for one position. Then a fresh draw. 11 draws, 11 players — each nation only once.', he: 'בוחרים שחקן אחד לעמדה אחת, ואז הגרלה חדשה. ככה 11 פעמים. כל מדינה רק פעם אחת.' },
  ht3_t:      { en: 'THE TOURNAMENT', he: 'הטורניר' },
  ht3_b:      { en: 'Your all-time XI enters the real 2026 tournament, match by match. The goal: win it all.', he: 'הנבחרת שלך נכנסת לטורניר 2026 האמיתי, משחק אחרי משחק. המטרה: לקחת את הגביע.' },
  ht_next:    { en: 'NEXT', he: 'הבא' },
  ht_start:   { en: 'FIRST UP: PICK YOUR LEGEND', he: 'קודם כל: בוחרים אגדה' },
  ht_back:    { en: 'GOT IT', he: 'הבנתי' },

  // S0 hall of legends
  s0_kicker:  { en: 'STEP 1 · YOUR LEGEND', he: 'שלב 1 · האגדה שלך' },
  s0_title:   { en: 'HALL OF<br>LEGENDS', he: 'היכל<br>האגדות' },
  s0_sub:     { en: 'PICK ONE ALL-TIME GREAT — HE GOES STRAIGHT INTO YOUR TEAM.<br>THE OTHER 10? RANDOM DRAWS. GOOD LUCK.', he: 'בחר גדול אחד מכל הזמנים, הוא נכנס ישר להרכב שלך.<br>את עשרת הבאים תקבל בהגרלות. בהצלחה.' },

  // S2 draw
  s2_spine:   { en: 'THE DRAW', he: 'ההגרלה' },
  s2_hint:    { en: 'DRAWING YOUR NATION AND YEAR…', he: 'מגרילים לך מדינה ושנה...' },
  skip_team:  { en: 'NEW NATION', he: 'מדינה אחרת' },
  skip_year:  { en: 'NEW YEAR', he: 'שנה אחרת' },

  // S3 squad sheet
  s3_hint:    { en: 'TAP A PLAYER, THEN TAP A POSITION', he: 'לוחצים על שחקן, ואז על עמדה' },
  place_at:   { en: 'PLACE AT', he: 'שבץ בעמדה' },
  caps:       { en: 'caps', he: 'הופעות' },
  goals_m:    { en: 'goals', he: 'שערים' },
  pos_GK:     { en: 'GOALKEEPERS', he: 'שוערים' },
  pos_DF:     { en: 'DEFENDERS', he: 'מגינים' },
  pos_MF:     { en: 'MIDFIELDERS', he: 'קשרים' },
  pos_FW:     { en: 'FORWARDS', he: 'חלוצים' },
  board_see:  { en: 'SEE MY TEAM SO FAR', he: 'צפה בנבחרת שלי' },

  // S4 board
  s4_head:    { en: 'MY TEAM — 4·4·2', he: 'הנבחרת שלי — 4·4·2' },
  s4_close:   { en: 'BACK TO THE SQUAD', he: 'חזרה לסגל' },

  // Joker
  jk_kicker:  { en: 'SURPRISE — THE JOKER', he: 'הפתעה — הג\'וקר' },
  jk_title:   { en: 'ONE LAST CALL,<br>GAFFER', he: 'החלטה אחרונה,<br>המאמן' },
  jk_sub1:    { en: 'YOUR XI IS COMPLETE. SWAP ONE PLAYER FOR A FRESH DRAW — OR TRUST YOUR BOARD.', he: 'ההרכב מלא. אפשר להחליף שחקן אחד בהגרלה חדשה, או לסמוך על מה שיש.' },
  jk_sub2:    { en: 'TAP THE PLAYER YOU WANT TO REPLACE.', he: 'לחץ על השחקן שאתה רוצה להחליף.' },
  jk_swap:    { en: 'SWAP ONE', he: 'החלף אחד' },
  jk_keep:    { en: 'PLAY', he: 'שחק' },

  // Name screen
  nm_kicker:  { en: 'FINAL TOUCH', he: 'נגיעה אחרונה' },
  nm_title:   { en: 'NAME<br>YOUR XI', he: 'תן שם<br>לנבחרת' },
  nm_hint:    { en: 'THIS GOES ON THE SCOREBOARD — AND ON THE SHARE CARD.', he: 'השם יופיע על לוח התוצאות ועל תמונת השיתוף.' },
  nm_ph:      { en: 'THE INVINCIBLES', he: 'הבלתי מנוצחים' },
  nm_lock:    { en: 'LOCK IT IN', he: 'נעל את השם' },

  // S5 tournament
  s5_kicker:  { en: 'RESULTS SERVICE', he: 'שירות התוצאות' },
  s5_title:   { en: 'THE&nbsp;TOURNAMENT', he: 'הטורניר' },
  s5_hint:    { en: 'TAP THE BUTTON TO PLAY EACH MATCH', he: 'לוחצים על הכפתור לשחק כל משחק' },
  feed_open:  { en: '— RESULTS SERVICE OPEN —', he: '— שירות התוצאות פתוח —' },
  run_match:  { en: (n) => 'RUN MATCH ' + n, he: (n) => 'שחק משחק ' + n },
  play_stage: { en: (s) => 'PLAY ' + s, he: (s) => 'שחק את ' + s },
  full_time:  { en: 'FULL TIME', he: 'שריקת סיום' },
  takes_place:{ en: (t, r, g) => t + ' TAKES ' + r.toUpperCase() + "'S PLACE — GROUP " + g,
                he: (t, r, g) => t + ' נכנסת במקום ' + r + ' — בית ' + g },
  group_match:{ en: (n, g) => 'GROUP MATCH ' + n + ' · GROUP ' + g, he: (n, g) => 'משחק בתים ' + n + ' · בית ' + g },
  final_table:{ en: (g) => '— FINAL TABLE · GROUP ' + g + ' —', he: (g) => '— טבלה סופית · בית ' + g + ' —' },
  through1:   { en: 'THROUGH AS GROUP WINNERS', he: 'עולים כמנצחי הבית' },
  through2:   { en: 'THROUGH AS RUNNERS-UP', he: 'עולים ממקום שני' },
  through3:   { en: 'THROUGH — ONE OF THE BEST THIRDS', he: 'עולים כאחת השלישיות הטובות' },
  through:    { en: 'THROUGH', he: 'עולים שלב' },

  // strength panel
  sp_elo:     { en: 'SQUAD ELO', he: 'דירוג הנבחרת' },
  sp_att:     { en: 'ATT', he: 'התקפה' },
  sp_mid:     { en: 'MID', he: 'קישור' },
  sp_def:     { en: 'DEF', he: 'הגנה' },
  weak_link:  { en: ' · WEAK LINK', he: ' · החוליה החלשה' },
  top_scorers: { en: 'TOP SCORERS', he: 'מלך השערים' },
  top_assists: { en: 'TOP ASSISTS', he: 'מלך הבישולים' },
  tourney_stars: { en: 'TOURNAMENT STARS', he: 'כוכבי הטורניר' },

  // stages + verdicts
  st_GROUP:   { en: 'GROUP', he: 'שלב הבתים' },
  st_R32:     { en: 'ROUND OF 32', he: '32 האחרונות' },
  st_R16:     { en: 'ROUND OF 16', he: 'שמינית הגמר' },
  st_QF:      { en: 'QUARTER-FINAL', he: 'רבע הגמר' },
  st_SF:      { en: 'SEMI-FINAL', he: 'חצי הגמר' },
  st_F:       { en: 'THE FINAL', he: 'הגמר' },
  vd_GROUP_EXIT: { en: 'OUT — GROUP STAGE', he: 'הודחתם בשלב הבתים' },
  vd_R32:     { en: 'OUT — ROUND OF 32', he: 'הודחתם ב-32 האחרונות' },
  vd_R16:     { en: 'OUT — ROUND OF 16', he: 'הודחתם בשמינית הגמר' },
  vd_QF:      { en: 'OUT — QUARTER-FINAL', he: 'הודחתם ברבע הגמר' },
  vd_SF:      { en: 'OUT — SEMI-FINAL', he: 'הודחתם בחצי הגמר' },
  vd_F:       { en: 'BEATEN FINALISTS', he: 'הפסדתם בגמר' },
  vd_CHAMPION:{ en: 'CHAMPIONS OF THE WORLD', he: 'אלופי העולם!' },

  // S6 back cover
  s6_kicker:  { en: 'FINAL RESULT', he: 'התוצאה הסופית' },
  record:     { en: (w, d, l, gf, ga) => w + 'W ' + d + 'D ' + l + 'L   ·   GOALS ' + gf + '–' + ga,
                he: (w, d, l, gf, ga) => w + ' נצ\' · ' + d + ' תיקו · ' + l + ' הפ\'   ·   שערים ' + gf + '–' + ga },
  avg_rating: { en: (v) => 'AVERAGE RATING ' + v + ' · 1930—2026', he: (v) => 'דירוג ממוצע ' + v + ' · 1930—2026' },
  xi_label:   { en: 'YOUR ALL-TIME XI', he: 'נבחרת העל שלך' },
  share:      { en: 'SHARE', he: 'שתף' },
  again:      { en: 'PLAY AGAIN', he: 'עוד משחק' },

  // daily challenge
  daily_btn:  { en: (n) => 'DAILY CHALLENGE · DAY ' + n, he: (n) => 'האתגר היומי · יום ' + n },
  daily_title:{ en: 'THE DAILY CHALLENGE', he: 'האתגר היומי' },
  daily_big:  { en: 'ONE A DAY.<br>UNTIL THE FINAL.', he: 'אחד ביום.<br>עד הגמר.' },
  daily_sub:  { en: '39 DAYS · ONLY TODAY IS OPEN · PROOF GOES TO THE GROUP', he: '39 ימים · רק היום פתוח · ההוכחה בקבוצה' },
  daily_play: { en: 'PLAY TODAY\'S CHALLENGE', he: 'שחק את האתגר של היום' },
  daily_today:{ en: 'TODAY', he: 'היום' },
  daily_tmrw: { en: 'TOMORROW', he: 'מחר' },
  daily_done: { en: 'PLAYED', he: 'שוחק' },
  daily_missed:{ en: 'MISSED', he: 'הוחמץ' },
  daily_locked:{ en: 'LOCKED', he: 'נעול' },
  daily_back: { en: 'BACK', he: 'חזרה' },
  daily_oneshot: { en: 'ONE SHOT — ALREADY PLAYED', he: 'ניסיון אחד, וכבר שיחקת' },
  try_n:      { en: (n) => 'ATTEMPT ' + n, he: (n) => 'ניסיון ' + n },

  // daily achievement "mark" — the metric that defines best-of-the-day
  rs_champ:   { en: 'CHAMPION', he: 'אלוף' },
  mk_far:     { en: (st, gd) => 'YOUR MARK: ' + st + ' (' + gd + ')',      he: (st, gd) => 'ההישג שלך: ' + st + ' (' + gd + ')' },
  mk_lowavg:  { en: (a, st) => 'YOUR MARK: AVG ' + a + ' → ' + st,         he: (a, st) => 'ההישג שלך: ממוצע ' + a + ' → ' + st },
  mk_clean:   { en: (g, st) => 'YOUR MARK: CONCEDED ' + g + ' · ' + st,     he: (g, st) => 'ההישג שלך: ' + g + ' ספיגות · ' + st },
  mk_goals:   { en: (g, st) => 'YOUR MARK: ' + g + ' GOALS · ' + st,        he: (g, st) => 'ההישג שלך: ' + g + ' שערים · ' + st },
  mk_tries:   { en: (n, st) => 'YOUR MARK: ' + st + (n === 1 ? ' IN 1 TRY' : ' IN ' + n + ' TRIES'), he: (n, st) => 'ההישג שלך: ' + st + ' ב-' + n + (n === 1 ? ' ניסיון' : ' ניסיונות') },

  // group invite
  grp_kick:   { en: 'THE DRESSING ROOM', he: 'חדר ההלבשה' },
  grp_main:   { en: 'WON? CRASHED OUT? THE GROUP WANTS PROOF.', he: 'ניצחת? הודחת? בקבוצה רוצים לראות הוכחות.' },
  grp_btn:    { en: 'JOIN THE WHATSAPP GROUP', he: 'לקבוצת הוואטסאפ של המשחק' },
  grp_board:  { en: 'THE GROUP &#8594;', he: 'לקבוצה &#8594;' },

  // misc
  pick_of:    { en: (n) => 'PICK ' + n + ' OF 11', he: (n) => 'בחירה ' + n + ' מתוך 11' },
  pick_n:     { en: (n) => 'PICK ' + n + '/11', he: (n) => 'בחירה ' + n + '/11' },
  load_fail:  { en: 'LOAD FAILED — REFRESH', he: 'הטעינה נכשלה — רענן' },
};

let lang = 'en';
try { if (localStorage.getItem(LS_KEY) === 'he') lang = 'he'; } catch (_) { /* default en */ }

export function getLang() { return lang; }

export function setLang(l) {
  lang = l === 'he' ? 'he' : 'en';
  try { localStorage.setItem(LS_KEY, lang); } catch (_) { /* ok */ }
  document.documentElement.setAttribute('data-lang', lang);
  document.documentElement.lang = lang; // a11y: screen readers announce in the right language
  applyStatic();
}

export function t(key, ...args) {
  const e = D[key];
  if (!e) return key;
  const v = e[lang] || e.en;
  return typeof v === 'function' ? v(...args) : v;
}

/* static HTML: elements carry data-i18n="key" (innerHTML — some hold <br>),
   inputs carry data-i18n-ph="key" for the placeholder */
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
}

document.documentElement.setAttribute('data-lang', lang);
document.documentElement.lang = lang;
