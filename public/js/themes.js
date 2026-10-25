// Thèmes « planètes » : chaque planète du système solaire change les couleurs, le nom affiché
// et le logo (une planète dont la surface tourne). Choix mémorisé sur cet appareil.

export const PLANETS = {
  mercure: { name: 'Mercure', accent: '#d2c4b3', accent2: '#9c8c7e', dir: 'diag',
    bands: ['#ddd6cc', '#bdb3a7', '#d3cabe', '#a69a8c', '#c7bcae', '#91857a', '#c0b4a6', '#7c7065'], surface: 'craters', fx: '#f3eee6' },
  venus: { name: 'Venus', accent: '#f4cf9c', accent2: '#e3907a', dir: 'diag',
    bands: ['#fce9cb', '#f0c08b', '#fde5c3', '#e79f7b', '#f7d2a3', '#d88469', '#efbb88', '#b9634f'], surface: 'clouds', fx: '#fff4e2' },
  terre: { name: 'Terre', accent: '#86cdf6', accent2: '#68d29c', dir: 'diag',
    bands: ['#7fc4ef', '#3d8fd1', '#5aaee6', '#2f76bd', '#4b9ddd', '#2a69ad', '#3f8bcf', '#1f4f8a'], surface: 'continents', fx: '#ffffff' },
  mars: { name: 'Mars', accent: '#ff9a6e', accent2: '#d5583b', dir: 'diag',
    bands: ['#f6b48c', '#de7a52', '#eea079', '#c9603f', '#e48c64', '#b44f33', '#d97a55', '#8f3a24'], surface: 'craters', fx: '#ffd9c2' },
  jupiter: { name: 'Jupiter', accent: '#f3c48f', accent2: '#c97c50', dir: 'flat',
    bands: ['#f6e3c6', '#d9a774', '#f2dcbc', '#b97a52', '#efd2ad', '#c58a5c', '#ead0ae', '#9c5f3f'], surface: 'spot', fx: '#c4553c' },
  saturne: { name: 'Saturne', accent: '#f1d99f', accent2: '#c9a766', dir: 'flat', ring: true,
    bands: ['#f7ebc9', '#e2c98f', '#f3e3b7', '#d3b479', '#efdcaa', '#c9a86b', '#e8d29d', '#a98a52'], surface: 'stripes', fx: '#fff6dc' },
  uranus: { name: 'Uranus', accent: '#97e6ec', accent2: '#58bcc7', dir: 'flat',
    bands: ['#d2f6f7', '#a6e6ea', '#c1f0f2', '#8fd8de', '#b3eaee', '#7ccbd3', '#a4e1e6', '#5fb1bb'], surface: 'stripes', fx: '#f2ffff' },
  neptune: { name: 'Neptune', accent: '#8eb0ff', accent2: '#4f68e3', dir: 'flat',
    bands: ['#8fb2ff', '#4f74e6', '#7798f7', '#3c5bd1', '#6a8cf0', '#3350c2', '#5c7de6', '#25399a'], surface: 'spot', fx: '#1d2c7a' },
  pluton: { name: 'Pluton', accent: '#efcdb9', accent2: '#bd8d7c', dir: 'diag',
    bands: ['#f3e2d6', '#d8b8a5', '#efd8c9', '#c6a08c', '#e8cdbb', '#b48b78', '#dfc1ae', '#8f6a5a'], surface: 'heart', fx: '#fbf1ea' },
};
export const DEFAULT_PLANET = 'venus';
const KEY = 'vn_theme';

export function currentPlanet() {
  try { const v = localStorage.getItem(KEY); if (v && PLANETS[v]) return v; } catch { /* */ }
  return DEFAULT_PLANET;
}
export const planet = () => PLANETS[currentPlanet()];
export const brandName = () => planet().name.toUpperCase();

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
    <radialGradient id="pn${n}" gradientUnits="userSpaceOnUse" cx="66" cy="28" r="46"><stop offset="0" stop-color="#0d1016" stop-opacity=".97"/><stop offset=".52" stop-color="#0d1016" stop-opacity=".9"/><stop offset=".74" stop-color="#0d1016" stop-opacity=".35"/><stop offset="1" stop-color="#0d1016" stop-opacity="0"/></radialGradient>
    <radialGradient id="pl${n}" gradientUnits="userSpaceOnUse" cx="19" cy="22" r="22"><stop offset="0" stop-color="#fffaf0" stop-opacity=".55"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></radialGradient>
    <clipPath id="pd${n}"><circle cx="30" cy="34" r="24"/></clipPath>
  </defs>
  ${ringBack}
  <g clip-path="url(#pd${n})">
    <rect width="64" height="64" fill="url(#pb${n})"/>
    <g class="spin">${surface(t)}</g>
    <rect width="64" height="64" fill="url(#pl${n})"/>
    <rect width="64" height="64" fill="url(#pn${n})"/>
  </g>
  ${ringFront}
  <path d="M53 4.5l1.3 4.2 4.2 1.3-4.2 1.3-1.3 4.2-1.3-4.2-4.2-1.3 4.2-1.3z" fill="${t.fx === '#1d2c7a' || t.fx === '#c4553c' ? '#fff1d6' : t.fx}"/>
</svg>`;
}

// Applique les couleurs du thème (variables CSS) et le nom
export function applyTheme(id = currentPlanet()) {
  const t = PLANETS[id] || PLANETS[DEFAULT_PLANET];
  const r = document.documentElement.style;
  r.setProperty('--sulfur', t.accent);
  r.setProperty('--dawn', t.accent2);
  r.setProperty('--planet-bands', `linear-gradient(${t.dir === 'flat' ? 180 : 172}deg, ${t.bands.map((c, i) => `${c} ${Math.round((i / (t.bands.length - 1)) * 100)}%`).join(', ')})`);
  document.documentElement.dataset.planet = id;
  document.querySelectorAll('.boot-word').forEach((e) => { e.textContent = t.name.toUpperCase(); });
}

export function setPlanet(id) {
  if (!PLANETS[id]) return;
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  applyTheme(id);
  window.dispatchEvent(new CustomEvent('vn:theme', { detail: id }));
}
