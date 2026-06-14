/* GloryXI — nation kit colours + jersey SVG.
   Shared by the in-app pitch (main.js) and the share canvas (share.js).
   Each kit: { primary, secondary, pattern, accent? }
   pattern: 'solid' | 'stripes' (vertical) | 'hoops' (horizontal) | 'sash' (diagonal)
   primary = body/base colour, secondary = stripe/trim/sleeve colour. */

export const KIT = {
  // ── South America ──
  'Argentina':        { primary: '#75AADB', secondary: '#FFFFFF', pattern: 'stripes' },
  'Brazil':           { primary: '#F7D914', secondary: '#1B7A3D', pattern: 'solid' },
  'Uruguay':          { primary: '#5EB6E4', secondary: '#0A2A66', pattern: 'solid' },
  'Colombia':         { primary: '#F4C430', secondary: '#0033A0', pattern: 'solid' },
  'Chile':            { primary: '#D52B1E', secondary: '#0033A0', pattern: 'solid' },
  'Peru':             { primary: '#FFFFFF', secondary: '#D52B1E', pattern: 'sash' },
  'Paraguay':         { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'stripes' },
  'Ecuador':          { primary: '#FFD100', secondary: '#003893', pattern: 'solid' },
  'Bolivia':          { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },

  // ── Europe ──
  'Italy':            { primary: '#1E50A2', secondary: '#FFFFFF', pattern: 'solid' },
  'West Germany':     { primary: '#FFFFFF', secondary: '#101010', pattern: 'solid' },
  'Germany':          { primary: '#FFFFFF', secondary: '#101010', pattern: 'solid' },
  'East Germany':     { primary: '#FFFFFF', secondary: '#1B7A3D', pattern: 'solid' },
  'Spain':            { primary: '#C8102E', secondary: '#0A2A66', pattern: 'solid' },
  'France':           { primary: '#1E3A8A', secondary: '#FFFFFF', pattern: 'solid', accent: '#D52B1E' },
  'England':          { primary: '#FFFFFF', secondary: '#0A2A66', pattern: 'solid' },
  'Netherlands':      { primary: '#F36C21', secondary: '#101010', pattern: 'solid' },
  'Portugal':         { primary: '#9E1B32', secondary: '#1B7A3D', pattern: 'solid' },
  'Soviet Union':     { primary: '#CC0000', secondary: '#FFFFFF', pattern: 'solid' },
  'Russia':           { primary: '#CC0000', secondary: '#FFFFFF', pattern: 'solid' },
  'Hungary':          { primary: '#CE2939', secondary: '#FFFFFF', pattern: 'solid', accent: '#1B7A3D' },
  'Sweden':           { primary: '#FFD100', secondary: '#0055A4', pattern: 'solid' },
  'Belgium':          { primary: '#C8102E', secondary: '#FFD100', pattern: 'solid', accent: '#101010' },
  'Croatia':          { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'hoops' },
  'Poland':           { primary: '#FFFFFF', secondary: '#D52B1E', pattern: 'solid' },
  'Denmark':          { primary: '#C8102E', secondary: '#FFFFFF', pattern: 'solid' },
  'Czechoslovakia':   { primary: '#C8102E', secondary: '#11457E', pattern: 'solid', accent: '#FFFFFF' },
  'Czech Republic':   { primary: '#C8102E', secondary: '#11457E', pattern: 'solid', accent: '#FFFFFF' },
  'Yugoslavia':       { primary: '#0A2A66', secondary: '#D52B1E', pattern: 'solid', accent: '#FFFFFF' },
  'Serbia':           { primary: '#0A2A66', secondary: '#D52B1E', pattern: 'solid', accent: '#FFFFFF' },
  'Serbia and Montenegro': { primary: '#0A2A66', secondary: '#D52B1E', pattern: 'solid', accent: '#FFFFFF' },
  'Austria':          { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'solid' },
  'Switzerland':      { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'solid' },
  'Scotland':         { primary: '#0A2A66', secondary: '#FFFFFF', pattern: 'solid' },
  'Wales':            { primary: '#C8102E', secondary: '#1B7A3D', pattern: 'solid' },
  'Northern Ireland': { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },
  'Republic of Ireland': { primary: '#169B62', secondary: '#FFFFFF', pattern: 'solid' },
  'Turkey':           { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'solid' },
  'Greece':           { primary: '#0D5EAF', secondary: '#FFFFFF', pattern: 'solid' },
  'Romania':          { primary: '#FFD100', secondary: '#0A2A66', pattern: 'solid', accent: '#D52B1E' },
  'Bulgaria':         { primary: '#FFFFFF', secondary: '#1B7A3D', pattern: 'solid', accent: '#D52B1E' },
  'Norway':           { primary: '#D52B1E', secondary: '#0A2A66', pattern: 'solid', accent: '#FFFFFF' },
  'Ukraine':          { primary: '#FFD100', secondary: '#0057B7', pattern: 'solid' },

  // ── Africa ──
  'Nigeria':          { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },
  'Cameroon':         { primary: '#1B7A3D', secondary: '#D52B1E', pattern: 'solid', accent: '#FFD100' },
  'Ghana':            { primary: '#FFFFFF', secondary: '#101010', pattern: 'solid' },
  'Senegal':          { primary: '#1B7A3D', secondary: '#D52B1E', pattern: 'solid', accent: '#FFD100' },
  'Morocco':          { primary: '#C8102E', secondary: '#1B7A3D', pattern: 'solid' },
  'Algeria':          { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },
  'Tunisia':          { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'solid' },
  'Egypt':            { primary: '#D52B1E', secondary: '#101010', pattern: 'solid', accent: '#FFFFFF' },
  'Ivory Coast':      { primary: '#F36C21', secondary: '#1B7A3D', pattern: 'solid' },
  'South Africa':     { primary: '#1B7A3D', secondary: '#FFD100', pattern: 'solid' },
  'DR Congo':         { primary: '#0057B7', secondary: '#FFD100', pattern: 'solid' },

  // ── Asia / Oceania ──
  'Japan':            { primary: '#11457E', secondary: '#FFFFFF', pattern: 'solid' },
  'South Korea':      { primary: '#C8102E', secondary: '#0A2A66', pattern: 'solid' },
  'North Korea':      { primary: '#C8102E', secondary: '#FFFFFF', pattern: 'solid' },
  'Iran':             { primary: '#FFFFFF', secondary: '#1B7A3D', pattern: 'solid', accent: '#D52B1E' },
  'Saudi Arabia':     { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },
  'Australia':        { primary: '#FFD100', secondary: '#1B7A3D', pattern: 'solid' },
  'China':            { primary: '#D52B1E', secondary: '#FFD100', pattern: 'solid' },
  'Qatar':            { primary: '#7A1531', secondary: '#FFFFFF', pattern: 'solid' },

  // ── North & Central America ──
  'United States':    { primary: '#FFFFFF', secondary: '#0A2A66', pattern: 'solid', accent: '#D52B1E' },
  'Mexico':           { primary: '#1B7A3D', secondary: '#D52B1E', pattern: 'solid', accent: '#FFFFFF' },
  'Canada':           { primary: '#D52B1E', secondary: '#FFFFFF', pattern: 'solid' },
  'Costa Rica':       { primary: '#C8102E', secondary: '#0A2A66', pattern: 'solid' },
  'Honduras':         { primary: '#FFFFFF', secondary: '#0A2A66', pattern: 'solid' },
  'El Salvador':      { primary: '#0A2A66', secondary: '#FFFFFF', pattern: 'solid' },
  'Panama':           { primary: '#C8102E', secondary: '#0A2A66', pattern: 'solid' },
  'Jamaica':          { primary: '#FFD100', secondary: '#101010', pattern: 'solid', accent: '#1B7A3D' },
  'Haiti':            { primary: '#0057B7', secondary: '#D52B1E', pattern: 'solid' },
  'Cuba':             { primary: '#C8102E', secondary: '#0A2A66', pattern: 'solid', accent: '#FFFFFF' },
  'Trinidad and Tobago': { primary: '#D52B1E', secondary: '#101010', pattern: 'solid' },
  'Curacao':          { primary: '#0033A0', secondary: '#FFD100', pattern: 'solid' },

  // ── more Europe ──
  'Iceland':          { primary: '#0A2A66', secondary: '#FFFFFF', pattern: 'solid', accent: '#D52B1E' },
  'Slovakia':         { primary: '#11457E', secondary: '#FFFFFF', pattern: 'solid', accent: '#D52B1E' },
  'Slovenia':         { primary: '#FFFFFF', secondary: '#0A2A66', pattern: 'solid', accent: '#1B7A3D' },
  'Bosnia and Herzegovina': { primary: '#FFD100', secondary: '#0A2A66', pattern: 'solid' },

  // ── more Asia / Africa ──
  'Iraq':             { primary: '#1B7A3D', secondary: '#FFFFFF', pattern: 'solid' },
  'Israel':           { primary: '#0038B8', secondary: '#FFFFFF', pattern: 'solid' },
  'Jordan':           { primary: '#C8102E', secondary: '#FFFFFF', pattern: 'solid', accent: '#101010' },
  'Kuwait':           { primary: '#0057B7', secondary: '#FFFFFF', pattern: 'solid' },
  'United Arab Emirates': { primary: '#FFFFFF', secondary: '#1B7A3D', pattern: 'solid', accent: '#D52B1E' },
  'Uzbekistan':       { primary: '#0099B5', secondary: '#FFFFFF', pattern: 'solid' },
  'Angola':           { primary: '#C8102E', secondary: '#101010', pattern: 'solid', accent: '#FFD100' },
  'Cape Verde':       { primary: '#0057B7', secondary: '#FFFFFF', pattern: 'solid' },
  'Togo':             { primary: '#1B7A3D', secondary: '#FFD100', pattern: 'solid', accent: '#D52B1E' },
  'New Zealand':      { primary: '#FFFFFF', secondary: '#101010', pattern: 'solid' },
  'Dutch East Indies': { primary: '#F36C21', secondary: '#101010', pattern: 'solid' },
  'Zaire':            { primary: '#1B7A3D', secondary: '#FFD100', pattern: 'solid' },
};

// teal/charcoal fallback so the game never breaks on an unmapped nation
export const KIT_FALLBACK = { primary: '#2BD4C0', secondary: '#211B14', pattern: 'solid' };

export function kitFor(country) {
  return KIT[country] || KIT_FALLBACK;
}

/* Build a jersey SVG string in nation colours.
   size = pixel width/height of the square viewBox-fit svg.
   The jersey is drawn inside a 100×100 coordinate space. */
export function jerseySVG(country, size = 46) {
  const k = kitFor(country);
  const body = k.primary;
  const trim = k.secondary;
  const accent = k.accent || k.secondary;
  // readable outline so a near-white kit still reads on dark chalk
  const stroke = 'rgba(16,16,16,0.55)';

  // shirt silhouette path (collar + sleeves + body) in a 100×100 box
  const shirt =
    'M50 8 ' +
    'L62 8 L70 12 L92 26 L84 44 L74 38 L74 90 L26 90 L26 38 L16 44 L8 26 L30 12 L38 8 Z';
  // collar V
  const collar = 'M38 8 L50 20 L62 8 L57 8 L50 14 L43 8 Z';

  let inner = '';
  if (k.pattern === 'stripes') {
    // vertical stripes (clipped to the shirt body)
    const w = 12;
    for (let xx = 30; xx < 74; xx += w * 2) {
      inner += `<rect x="${xx}" y="20" width="${w}" height="70" fill="${trim}"/>`;
    }
  } else if (k.pattern === 'hoops') {
    const h = 11;
    for (let yy = 26; yy < 90; yy += h * 2) {
      inner += `<rect x="20" y="${yy}" width="60" height="${h}" fill="${trim}"/>`;
    }
  } else if (k.pattern === 'sash') {
    inner += `<polygon points="20,90 20,72 70,20 84,32 34,90" fill="${trim}"/>`;
  }

  // sleeves trim + collar in secondary/accent for solid kits (gives life)
  const sleeves =
    `<path d="M30 12 L8 26 L16 44 L26 38 Z" fill="${accent}" opacity="0.95"/>` +
    `<path d="M70 12 L92 26 L84 44 L74 38 Z" fill="${accent}" opacity="0.95"/>`;

  return (
    `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="jersey-svg">` +
      `<defs><clipPath id="cp-${slug(country)}"><path d="${shirt}"/></clipPath></defs>` +
      `<path d="${shirt}" fill="${body}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<g clip-path="url(#cp-${slug(country)})">${inner}</g>` +
      sleeves +
      `<path d="${shirt}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="${collar}" fill="${trim}" stroke="${stroke}" stroke-width="1.5"/>` +
    `</svg>`
  );
}

function slug(s) { return String(s).replace(/[^A-Za-z0-9]/g, '') || 'x'; }
