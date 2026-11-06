// Thèmes « planètes » : chaque planète du système solaire change les couleurs, le nom affiché
// et le logo (une planète dont la surface tourne). Choix mémorisé sur cet appareil.

export const PLANETS = {
  mercure: { night: '#101113', deep: '#18191d', raise: '#24262b', glow: '#b9b0a4', name: 'Mercure', accent: '#dccdb9', accent2: '#9c8c7e', dir: 'diag',
    bands: ['#ddd6cc', '#bdb3a7', '#d3cabe', '#a69a8c', '#c7bcae', '#91857a', '#c0b4a6', '#7c7065'], surface: 'craters', fx: '#f3eee6' },
  venus: { night: '#120e0d', deep: '#1c1615', raise: '#29201e', glow: '#e3907a', name: 'Venus', accent: '#f4cf9c', accent2: '#e3907a', dir: 'diag',
    bands: ['#fce9cb', '#f0c08b', '#fde5c3', '#e79f7b', '#f7d2a3', '#d88469', '#efbb88', '#b9634f'], surface: 'clouds', fx: '#fff4e2' },
  terre: { night: '#06101c', deep: '#0c1929', raise: '#14253a', glow: '#3d8fd1', name: 'Terre', accent: '#86cdf6', accent2: '#68d29c', dir: 'diag',
    bands: ['#7fc4ef', '#3d8fd1', '#5aaee6', '#2f76bd', '#4b9ddd', '#2a69ad', '#3f8bcf', '#1f4f8a'], surface: 'continents', fx: '#ffffff' },
  mars: { night: '#140b09', deep: '#201311', raise: '#2d1b17', glow: '#d5583b', name: 'Mars', accent: '#ff9a6e', accent2: '#d5583b', dir: 'diag',
    bands: ['#f6b48c', '#de7a52', '#eea079', '#c9603f', '#e48c64', '#b44f33', '#d97a55', '#8f3a24'], surface: 'craters', fx: '#ffd9c2' },
  jupiter: { night: '#120e0a', deep: '#1d1711', raise: '#2a2119', glow: '#c97c50', name: 'Jupiter', accent: '#f3c48f', accent2: '#c97c50', dir: 'flat',
    bands: ['#f6e3c6', '#d9a774', '#f2dcbc', '#b97a52', '#efd2ad', '#c58a5c', '#ead0ae', '#9c5f3f'], surface: 'spot', fx: '#c4553c' },
  saturne: { night: '#11100a', deep: '#1c1a11', raise: '#28251a', glow: '#c9a766', name: 'Saturne', accent: '#f1d99f', accent2: '#c9a766', dir: 'flat', ring: true,
    bands: ['#f7ebc9', '#e2c98f', '#f3e3b7', '#d3b479', '#efdcaa', '#c9a86b', '#e8d29d', '#a98a52'], surface: 'stripes', fx: '#fff6dc' },
  uranus: { night: '#061314', deep: '#0c1d20', raise: '#14292d', glow: '#58bcc7', name: 'Uranus', accent: '#97e6ec', accent2: '#58bcc7', dir: 'flat',
    bands: ['#d2f6f7', '#a6e6ea', '#c1f0f2', '#8fd8de', '#b3eaee', '#7ccbd3', '#a4e1e6', '#5fb1bb'], surface: 'stripes', fx: '#f2ffff' },
  neptune: { night: '#080b1c', deep: '#0f1430', raise: '#192046', glow: '#5c6cff', name: 'Neptune', accent: '#9db8ff', accent2: '#6f7dff', dir: 'flat',
    bands: ['#8fb2ff', '#4f74e6', '#7798f7', '#3c5bd1', '#6a8cf0', '#3350c2', '#5c7de6', '#25399a'], surface: 'spot', fx: '#1d2c7a' },
  pluton: { night: '#130e10', deep: '#1d1619', raise: '#2a2024', glow: '#c99a8a', name: 'Pluton', accent: '#f2c9b8', accent2: '#c98f86', dir: 'diag',
    bands: ['#f3e2d6', '#d8b8a5', '#efd8c9', '#c6a08c', '#e8cdbb', '#b48b78', '#dfc1ae', '#8f6a5a'], surface: 'heart', fx: '#fbf1ea' },
  // Noir et blanc : trois planètes monochromes. Noir (noir pur, idéal sur écran OLED), Blanc (clair),
  // et TV, le mélange des deux (fond noir, menu et boutons blancs, gros contours de sélection lisibles de loin)
  noir: { night: '#000000', deep: '#0b0b0b', raise: '#171717', glow: '#bdbdbd', name: 'Noir', accent: '#ffffff', accent2: '#9a9a9a', dir: 'diag', mono: true,
    bands: ['#5a5a5a', '#2b2b2b', '#4a4a4a', '#1c1c1c', '#3c3c3c', '#141414', '#303030', '#050505'], surface: 'craters', fx: '#d9d9d9' },
  blanc: { night: '#f3f3f3', deep: '#ffffff', raise: '#e6e6e6', glow: '#9a9a9a', name: 'Blanc', accent: '#111111', accent2: '#5c5c5c', dir: 'diag', mono: true, light: true,
    bands: ['#ffffff', '#e9e9e9', '#fafafa', '#d6d6d6', '#f2f2f2', '#c8c8c8', '#ececec', '#b4b4b4'], surface: 'clouds', fx: '#ffffff' },
  tv: { night: '#050505', deep: '#121212', raise: '#1f1f1f', glow: '#ffffff', name: 'TV', accent: '#ffffff', accent2: '#b5b5b5', dir: 'flat', mono: true,
    bands: ['#ffffff', '#111111', '#f2f2f2', '#1a1a1a', '#e6e6e6', '#0d0d0d', '#d9d9d9', '#000000'], surface: 'stripes', fx: '#ffffff' },
  // « Verre » (inspiré de Free My TV) : surfaces en verre dépoli, clair le jour et sombre la nuit, au rythme du soleil
  verre: { night: '#0b0b0d', deep: '#1c1c1e', raise: '#2c2c2e', glow: '#8fb8ff', name: 'Verre', brand: 'Venus', accent: '#2997ff', accent2: '#5e5ce6', dir: 'diag', glass: true,
    bands: ['#ffffff', '#e4ecf7', '#f6f8fc', '#cddcf0', '#eef3fa', '#b9cbe6', '#e2eaf6', '#9fb4d6'], surface: 'clouds', fx: '#ffffff' },
};
export const DEFAULT_PLANET = 'venus';
const KEY = 'vn_theme';

export function currentPlanet() {
  try { const v = localStorage.getItem(KEY); if (v && PLANETS[v]) return v; } catch { /* */ }
  return DEFAULT_PLANET;
}
export const planet = () => PLANETS[currentPlanet()];
export const brandName = () => (planet().brand || planet().name).toUpperCase();

// Surface qui défile : les motifs sont dessinés deux fois (période de 48) pour une rotation sans couture
function surface(t) {
  const twice = (f) => f(0) + f(48);
  const fx = t.fx;
  switch (t.surface) {
    case 'clouds': return twice((o) => `<path d="M${o - 2} 25c9-4 17 3 26-1s18-3 22 1" stroke="${fx}" stroke-opacity=".5" stroke-width="2" fill="none"/><path d="M${o - 2} 41c8 3 16-4 25 0s16 3 23-1" stroke="${fx}" stroke-opacity=".35" stroke-width="1.5" fill="none"/><path d="M${o + 8} 50c6-2 12 1 18-1" stroke="${fx}" stroke-opacity=".3" stroke-width="1.2" fill="none"/>`);
    case 'continents': return twice((o) => `<path d="M${o + 6} 22c4-3 10-2 12 2s-1 8 2 11-2 7-6 6-5-5-8-6-4-9 0-13z" fill="#5cc48a"/><path d="M${o + 28} 38c3-2 8-1 9 3s-3 6-6 5-5-6-3-8z" fill="#7fd29b"/><path d="M${o + 33} 18c3 0 6 2 5 4s-5 2-6 0 0-4 1-4z" fill="#4fb07c"/><path d="M${o} 30c7-2 14 1 20-1" stroke="${fx}" stroke-opacity=".7" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M${o + 22} 47c6-2 12 0 18-2" stroke="${fx}" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round" fill="none"/>`);
    case 'craters': return twice((o) => `<circle cx="${o + 10}" cy="26" r="3.2" fill="#000" fill-opacity=".14"/><circle cx="${o + 24}" cy="40" r="4.5" fill="#000" fill-opacity=".12"/><circle cx="${o + 36}" cy="22" r="2.2" fill="#000" fill-opacity=".16"/><circle cx="${o + 16}" cy="49" r="2.6" fill="#000" fill-opacity=".12"/><circle cx="${o + 41}" cy="44" r="1.8" fill="${fx}" fill-opacity=".35"/>`);
    case 'spot': return twice((o) => `<ellipse cx="${o + 22}" cy="40" rx="6" ry="3.4" fill="${fx}" fill-opacity=".85"/><ellipse cx="${o + 22}" cy="40" rx="3" ry="1.5" fill="#fff" fill-opacity=".18"/><path d="M${o} 28c10-1 20 1 30 0s14 1 18 0" stroke="#fff" stroke-opacity=".25" stroke-width="1.3" fill="none"/>`);
    case 'stripes': return twice((o) => `<path d="M${o} 27c12-1 24 1 36 0s8 1 12 0" stroke="${fx}" stroke-opacity=".45" stroke-width="1.6" fill="none"/><path d="M${o} 43c10 1 22-1 32 0s12 0 16 0" stroke="#000" stroke-opacity=".1" stroke-width="2" fill="none"/><ellipse cx="${o + 30}" cy="35" rx="5" ry="1.4" fill="${fx}" fill-opacity=".35"/>`);
    case 'heart': return twice((o) => `<path d="M${o + 22} 46c-6-4-10-8-10-12a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 4-4 8-10 12z" fill="${fx}" fill-opacity=".8"/><circle cx="${o + 40}" cy="25" r="2.4" fill="#000" fill-opacity=".12"/>`);
    default: return '';
  }
}

// Seconde couche, plus rapide : nuages, courants, vents (donne du relief à la rotation)
function weather(t) {
  const twice = (f) => f(0) + f(48);
  const c = t.surface === 'spot' && t.fx === '#1d2c7a' ? '#ffffff' : t.surface === 'spot' ? '#fff6e8' : t.fx;
  switch (t.surface) {
    case 'continents': return twice((o) => `<path d="M${o + 2} 19c6-2 11 1 16-1" stroke="#fff" stroke-opacity=".85" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M${o + 20} 33c5-1 9 1 13 0" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M${o + 6} 52c7-2 12 0 17-1" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round" fill="none"/>`);
    case 'clouds': return twice((o) => `<path d="M${o} 33c10-3 20 2 30-1s14-1 18 1" stroke="${c}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M${o + 10} 18c8-2 14 1 20 0" stroke="${c}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round" fill="none"/>`);
    case 'spot': case 'stripes': return twice((o) => `<path d="M${o} 22c12 1 24-1 36 0s8 0 12 0" stroke="${c}" stroke-opacity=".28" stroke-width="1.4" fill="none"/><path d="M${o + 4} 48c10-1 20 1 30 0" stroke="${c}" stroke-opacity=".22" stroke-width="1.2" fill="none"/>`);
    default: return '';
  }
}

let markN = 0;
export function planetMarkup(id = currentPlanet()) {
  const t = PLANETS[id] || PLANETS[DEFAULT_PLANET];
  const n = ++markN;
  const [x1, y1, x2, y2] = t.dir === 'flat' ? [30, 8, 30, 60] : [22, 4, 36, 60];
  const stops = t.bands.map((c, i) => `<stop offset="${(i / (t.bands.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  const ringBack = t.ring ? `<ellipse cx="30" cy="34" rx="31" ry="8" transform="rotate(-16 30 34)" fill="none" stroke="${t.bands[3]}" stroke-opacity=".55" stroke-width="3.2"/>` : '';
  const ringFront = t.ring ? `<path d="M-0.4 41.6A31 8 -16 0 0 59.8 24.4" transform="rotate(0)" fill="none" stroke="${t.bands[1]}" stroke-width="3.2" stroke-linecap="round"/>` : '';
  return `<svg class="mark planet-${id}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="pb${n}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>
    <radialGradient id="pn${n}" gradientUnits="userSpaceOnUse" cx="66" cy="28" r="46"><stop offset="0" stop-color="${t.night}" stop-opacity=".97"/><stop offset=".52" stop-color="${t.night}" stop-opacity=".9"/><stop offset=".74" stop-color="${t.night}" stop-opacity=".35"/><stop offset="1" stop-color="${t.night}" stop-opacity="0"/></radialGradient>
    <radialGradient id="pa${n}" gradientUnits="userSpaceOnUse" cx="30" cy="34" r="31"><stop offset=".72" stop-color="${t.bands[0]}" stop-opacity=".55"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="pl${n}" gradientUnits="userSpaceOnUse" cx="19" cy="22" r="22"><stop offset="0" stop-color="#fffaf0" stop-opacity=".55"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></radialGradient>
    <clipPath id="pd${n}"><circle cx="30" cy="34" r="24"/></clipPath>
  </defs>
  <circle class="atmo" cx="30" cy="34" r="31" fill="url(#pa${n})"/>
  <g class="body">
  ${ringBack}
  <g clip-path="url(#pd${n})">
    <rect width="64" height="64" fill="url(#pb${n})"/>
    <g class="spin">${surface(t)}</g>
    <g class="spin2">${weather(t)}</g>
    <rect width="64" height="64" fill="url(#pl${n})"/>
    <rect width="64" height="64" fill="url(#pn${n})"/>
  </g>
  ${ringFront}
  </g>
  <path class="twinkle" d="M53 4.5l1.3 4.2 4.2 1.3-4.2 1.3-1.3 4.2-1.3-4.2-4.2-1.3 4.2-1.3z" fill="${t.fx === '#1d2c7a' || t.fx === '#c4553c' ? '#fff1d6' : t.fx}"/>
</svg>`;
}

// Applique les couleurs du thème (variables CSS) et le nom
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`; };
const trip = (hex) => rgb(hex).join(' ');
// Toutes les couleurs de l'application pour une planète : fonds teintés, accent, textes secondaires, bordures
const GLASS = {
  day: { '--night': '#f2f2f5', '--deep': '#ffffff', '--raise': '#e8e8ed', '--paper': '#1d1d1f', '--haze': '#5f5f66', '--dim': '#8a8a90',
    '--sulfur': '#0071e3', '--dawn': '#5e5ce6', '--glow': '#0071e3', '--tint': '#7aa7e6', '--edge': 'rgb(0 0 0 / .1)' },
  night: { '--night': '#0b0b0d', '--deep': '#1c1c1e', '--raise': '#2c2c2e', '--paper': '#f5f5f7', '--haze': '#a1a1a8', '--dim': '#6e6e75',
    '--sulfur': '#2997ff', '--dawn': '#5e5ce6', '--glow': '#2997ff', '--tint': '#5a7fb8', '--edge': 'rgb(255 255 255 / .1)' },
};
export function themeVars(id, glassState = glassNow().state) {
  const t = PLANETS[id] || PLANETS[DEFAULT_PLANET];
  if (t.glass) {
    const g = GLASS[glassState] || GLASS.night;
    return { ...g, '--night-rgb': trip(g['--night']), '--deep-rgb': trip(g['--deep']), '--raise-rgb': trip(g['--raise']), '--sulfur-rgb': trip(g['--sulfur']),
      '--planet-bands': `linear-gradient(172deg, ${t.bands.map((c, i) => `${c} ${Math.round((i / (t.bands.length - 1)) * 100)}%`).join(', ')})` };
  }
  if (t.light) {
    // Thème clair : textes foncés sur fond blanc
    return {
      '--night': t.night, '--deep': t.deep, '--raise': t.raise,
      '--night-rgb': trip(t.night), '--deep-rgb': trip(t.deep), '--raise-rgb': trip(t.raise),
      '--sulfur': t.accent, '--sulfur-rgb': trip(t.accent), '--dawn': t.accent2, '--glow': t.glow, '--tint': '#7a7a7a',
      '--paper': '#111111', '--haze': '#4f4f4f', '--dim': '#7d7d7d', '--edge': 'rgb(0 0 0 / .12)',
      '--planet-bands': `linear-gradient(172deg, ${t.bands.map((c, i) => `${c} ${Math.round((i / (t.bands.length - 1)) * 100)}%`).join(', ')})`,
    };
  }
  const paper = t.mono ? '#f2f2f2' : mix('#eceae4', t.accent, 0.08);
  return {
    '--night': t.night, '--deep': t.deep, '--raise': t.raise,
    '--night-rgb': trip(t.night), '--deep-rgb': trip(t.deep), '--raise-rgb': trip(t.raise),
    '--sulfur': t.accent, '--sulfur-rgb': trip(t.accent), '--dawn': t.accent2, '--glow': t.glow, '--tint': t.accent,
    '--paper': paper, '--haze': t.mono ? '#a8a8a8' : mix('#a6a9b0', t.accent, 0.16), '--dim': t.mono ? '#727272' : mix('#6e727c', t.accent, 0.14),
    '--edge': `rgb(${trip(mix('#eceae4', t.accent, 0.4))} / .12)`,
    '--planet-bands': `linear-gradient(${t.dir === 'flat' ? 180 : 172}deg, ${t.bands.map((c, i) => `${c} ${Math.round((i / (t.bands.length - 1)) * 100)}%`).join(', ')})`,
  };
}

// ---------------------------------------------------------------- jour et nuit du thème Verre
// Lever et coucher du soleil calculés sur l'appareil (formule de la NOAA), à partir du fuseau horaire :
// pas de géolocalisation demandée, rien n'est envoyé.
const TZ = {
  'Europe/Paris': [48.86, 2.35], 'Europe/Brussels': [50.85, 4.35], 'Europe/Zurich': [46.2, 6.15], 'Europe/Luxembourg': [49.61, 6.13], 'Europe/Monaco': [43.73, 7.42],
  'Europe/London': [51.5, -0.12], 'Europe/Madrid': [40.42, -3.7], 'Europe/Lisbon': [38.72, -9.14], 'Europe/Berlin': [52.52, 13.4], 'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9],
  'Indian/Mayotte': [-12.78, 45.23], 'Indian/Reunion': [-20.88, 55.45], 'Indian/Comoro': [-11.7, 43.26], 'Indian/Antananarivo': [-18.88, 47.5], 'Indian/Mauritius': [-20.16, 57.5],
  'America/Martinique': [14.6, -61.07], 'America/Guadeloupe': [16.24, -61.53], 'America/Cayenne': [4.93, -52.33], 'America/Miquelon': [47.1, -56.38], 'America/Port-au-Prince': [18.54, -72.34],
  'America/Montreal': [45.5, -73.57], 'America/Toronto': [43.65, -79.38], 'America/New_York': [40.71, -74.0], 'America/Chicago': [41.88, -87.63], 'America/Los_Angeles': [34.05, -118.24],
  'Pacific/Noumea': [-22.27, 166.44], 'Pacific/Tahiti': [-17.53, -149.57], 'Pacific/Wallis': [-13.28, -176.17],
  'Africa/Algiers': [36.75, 3.06], 'Africa/Casablanca': [33.57, -7.59], 'Africa/Tunis': [36.8, 10.18], 'Africa/Dakar': [14.69, -17.44], 'Africa/Abidjan': [5.36, -4.01],
  'Africa/Douala': [4.05, 9.7], 'Africa/Kinshasa': [-4.32, 15.31], 'Africa/Libreville': [0.39, 9.45], 'Africa/Bamako': [12.64, -8.0], 'Africa/Djibouti': [11.59, 43.15],
};
function coords() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* */ }
  if (TZ[tz]) return TZ[tz];
  // Inconnu : longitude déduite du décalage horaire, latitude moyenne
  return [tz.startsWith('Australia') || tz.startsWith('America/Argentina') ? -30 : 40, -new Date().getTimezoneOffset() / 4];
}
// Heures (ms) du lever et du coucher du soleil pour le jour de `date`
function sunTimes(date, [lat, lon]) {
  const rad = Math.PI / 180;
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
  const g = (2 * Math.PI / 365) * (day - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
  const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  if (cosH > 1) return { rise: midnight + 864e5, set: midnight + 864e5 }; // nuit polaire
  if (cosH < -1) return { rise: midnight - 1, set: midnight + 864e5 }; // jour polaire
  const ha = Math.acos(cosH) / rad;
  const rise = midnight + (720 - 4 * (lon + ha) - eqt) * 60000;
  const set = midnight + (720 - 4 * (lon - ha) - eqt) * 60000;
  return { rise, set };
}
export const glassMode = () => { try { return localStorage.getItem('vn_glass_mode') || 'auto'; } catch { return 'auto'; } };
// État actuel (jour / nuit) et heure du prochain changement
export function glassNow() {
  const mode = glassMode();
  if (mode === 'day' || mode === 'night') return { state: mode, next: 0 };
  const now = Date.now(), c = coords();
  const today = sunTimes(new Date(now), c), tomorrow = sunTimes(new Date(now + 864e5), c);
  if (now < today.rise) return { state: 'night', next: today.rise };
  if (now < today.set) return { state: 'day', next: today.set };
  return { state: 'night', next: tomorrow.rise };
}
export function sunInfo() { const t = sunTimes(new Date(), coords()); return t; }
export function setGlassMode(m) { try { localStorage.setItem('vn_glass_mode', m); } catch { /* */ } applyTheme(); }

// En plein jour, les fonds et traits clairs prévus pour le sombre sont convertis en foncés (feuille générée une fois)
let lightSheet = null;
function lightOverrides() {
  if (lightSheet) return lightSheet;
  const out = [];
  const re = /rgba\(\s*(236\s*,\s*234\s*,\s*228|255\s*,\s*255\s*,\s*255)\s*,\s*([.\d]+)\s*\)/g;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { if (r.type === CSSRule.MEDIA_RULE || r.type === CSSRule.SUPPORTS_RULE) { /* sous-règles */ walk(r.cssRules); } continue; }
      if (!r.selectorText || /\.player|\.p-|\.boot|\.mini|\.party|\.react|\.shot|\.bar\b|\.hero-bg|\.face/.test(r.selectorText)) continue; // sur image : on garde le clair
      const decl = [];
      for (let i = 0; i < r.style.length; i++) {
        const prop = r.style[i]; const val = r.style.getPropertyValue(prop);
        if (/^(background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|box-shadow|outline|outline-color|color)$/.test(prop) && /rgba\(\s*236/.test(val)) {
          decl.push(`${prop}: ${val.replace(re, (m, c, a) => `rgba(29, 29, 31, ${Math.min(1, Number(a) * 0.9)})`)}`);
        }
      }
      if (decl.length) out.push(`${r.selectorText.split(',').map((x) => `html[data-tone="light"] ${x.trim()}`).join(', ')} { ${decl.join('; ')} }`);
    }
  };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* feuille externe */ } }
  lightSheet = document.createElement('style');
  lightSheet.id = 'glass-light';
  lightSheet.textContent = out.join('\n');
  document.head.append(lightSheet);
  return lightSheet;
}

let glassTimer = null;
export function applyTheme(id = currentPlanet()) {
  const t = PLANETS[id] || PLANETS[DEFAULT_PLANET];
  const r = document.documentElement.style;
  clearTimeout(glassTimer);
  const g = t.glass ? glassNow() : null;
  if (g) {
    document.documentElement.dataset.glass = g.state;
    try { localStorage.setItem('vn_glass', `${g.state}|${g.next || 0}`); } catch { /* */ }
    // Bascule toute seule au lever / coucher du soleil
    if (g.next) glassTimer = setTimeout(() => applyTheme(), Math.min(2 ** 31 - 1, Math.max(1000, g.next - Date.now() + 1000)));
  } else {
    delete document.documentElement.dataset.glass;
    try { localStorage.removeItem('vn_glass'); } catch { /* */ }
  }
  // Clair ou sombre (Verre le jour, Blanc) : les traits et fonds prévus pour le sombre passent en foncé
  const light = (g && g.state === 'day') || !!t.light;
  document.documentElement.dataset.tone = light ? 'light' : 'dark';
  if (light) lightOverrides();
  try { localStorage.setItem('vn_tone', light ? 'light' : 'dark'); } catch { /* */ }
  const vars = themeVars(id, g ? g.state : undefined);
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
  // Gardé pour le prochain démarrage : appliqué avant le premier affichage (index.html)
  try { localStorage.setItem('vn_theme_vars', Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')); } catch { /* */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--night']);
  document.documentElement.dataset.planet = id;
}

// Changement de planète : une onde de la couleur de la planète part de l'endroit touché et recouvre l'écran
export function setPlanet(id, origin = null) {
  if (!PLANETS[id]) return;
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (origin && !reduce) {
    const b = origin.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = PLANETS[id];
    const w = document.createElement('div');
    w.className = 'planet-warp';
    Object.assign(w.style, { left: `${x}px`, top: `${y}px`, width: `${R * 2}px`, height: `${R * 2}px`, marginLeft: `${-R}px`, marginTop: `${-R}px`,
      background: t.glass ? 'radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(200,215,240,.7) 30%, transparent 70%)' : `radial-gradient(circle, ${t.accent} 0%, ${t.accent2} 22%, ${t.night} 58%, transparent 70%)` });
    document.body.append(w);
    setTimeout(() => w.remove(), 1300);
  }
  applyTheme(id);
  window.dispatchEvent(new CustomEvent('vn:theme', { detail: id }));
}
