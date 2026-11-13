// Lumières synchronisées avec l'image (Philips Hue en local, WLED).
// Le lecteur échantillonne la couleur dominante de la vidéo et l'envoie ici ;
// ce module la transmet aux ampoules, en limitant la cadence pour ne pas saturer le pont.
import { getSetting, setSetting } from './db.js';

const DEFAULTS = { enabled: false, hueBridge: '', hueUser: '', hueLights: [], wled: [], brightness: 70, restore: true };
const TIMEOUT = 2500;

// Réglages des lumières, complétés par les valeurs par défaut
export const lightsConf = () => ({ ...DEFAULTS, ...(getSetting('lights', null) || {}) });
// Enregistre les réglages des lumières
export function saveLights(patch) {
  const cur = lightsConf();
  const next = { ...cur };
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.hueBridge !== undefined) next.hueBridge = checkHost(patch.hueBridge, true);
  if (patch.hueLights !== undefined) next.hueLights = [...new Set((Array.isArray(patch.hueLights) ? patch.hueLights : []).map((x) => String(x).replace(/[^\w-]/g, '').slice(0, 20)).filter(Boolean))].slice(0, 50);
  if (patch.wled !== undefined) next.wled = [...new Set((Array.isArray(patch.wled) ? patch.wled : String(patch.wled).split(/[\s,;]+/)).map((h) => checkHost(h, true)).filter(Boolean))].slice(0, 20);
  if (patch.brightness !== undefined) next.brightness = Math.min(100, Math.max(5, Math.round(Number(patch.brightness) || 70)));
  if (patch.restore !== undefined) next.restore = !!patch.restore;
  if (patch.hueUser !== undefined) next.hueUser = String(patch.hueUser || '').slice(0, 80);
  if (next.hueBridge !== cur.hueBridge) next.hueUser = patch.hueUser !== undefined ? next.hueUser : '';
  setSetting('lights', next);
  return next;
}

// Une adresse d'appareil domestique : IP privée ou nom local, port facultatif. Rien d'autre
// pour que Venus ne serve jamais de passerelle vers Internet.
export function checkHost(raw, allowEmpty = false) {
  const h = String(raw || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!h) { if (allowEmpty) return ''; throw new Error('Adresse manquante'); }
  const m = h.match(/^([a-z0-9.-]+)(?::(\d{2,5}))?$/i);
  if (!m) throw new Error(`Adresse invalide : ${h}`);
  const host = m[1].toLowerCase();
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  let ok;
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    ok = a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  } else ok = host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home') || !host.includes('.');
  if (!ok) throw new Error(`Seuls les appareils du réseau local sont acceptés (${host})`);
  return m[2] ? `${host}:${m[2]}` : host;
}

// Requête vers une lampe ou un pont (délai court)
async function http(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* texte brut */ }
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return json;
}

// ------------------------------------------------------------------ Philips Hue (API locale v1)
export async function huePair(bridge) {
  const host = checkHost(bridge);
  const res = await http(`http://${host}/api`, { method: 'POST', body: JSON.stringify({ devicetype: 'venus#serveur' }) });
  const first = Array.isArray(res) ? res[0] : null;
  if (first && first.success && first.success.username) {
    saveLights({ hueBridge: host, hueUser: first.success.username });
    return { paired: true };
  }
  const err = first && first.error ? first.error : {};
  if (err.type === 101) return { paired: false, pressButton: true, message: 'Appuyez sur le bouton du pont Hue, puis réessayez dans les 30 secondes.' };
  throw new Error(err.description || 'Réponse inattendue du pont');
}

// Lampes Philips Hue disponibles sur le pont
export async function hueLights() {
  const c = lightsConf();
  if (!c.hueBridge || !c.hueUser) return [];
  const res = await http(`http://${c.hueBridge}/api/${encodeURIComponent(c.hueUser)}/lights`);
  if (Array.isArray(res) && res[0] && res[0].error) throw new Error(res[0].error.description || 'Pont Hue : accès refusé (à réappairer)');
  return Object.entries(res || {}).map(([id, l]) => ({ id, name: l.name || `Lampe ${id}`, on: !!(l.state && l.state.on), color: !!(l.state && (l.state.xy || l.state.hue !== undefined)), selected: c.hueLights.includes(id) }));
}

// RVB (0-255) → xy dans le gamut Hue, luminosité 1-254
export function rgbToXy(r, g, b) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  const s = X + Y + Z;
  if (!s) return [0.3127, 0.329];
  return [Number((X / s).toFixed(4)), Number((Y / s).toFixed(4))];
}

// ------------------------------------------------------------------ WLED (API JSON)
export async function wledInfo(host) {
  const h = checkHost(host);
  const info = await http(`http://${h}/json/info`);
  if (!info || typeof info !== 'object' || info.leds === undefined) throw new Error('Ce n’est pas un appareil WLED');
  return { host: h, name: info.name || 'WLED', leds: info.leds && info.leds.count, version: info.ver || '' };
}

// ------------------------------------------------------------------ envoi des couleurs
let last = 0, pending = null, timer = null, failures = 0;
// État des lumières pour les réglages
export const lightsStatus = () => {
  const c = lightsConf();
  return { enabled: c.enabled, brightness: c.brightness, restore: c.restore, hueBridge: c.hueBridge, huePaired: !!c.hueUser, hueLights: c.hueLights, wled: c.wled, targets: (c.hueUser ? c.hueLights.length : 0) + c.wled.length, failures, session: !!session };
};
// Les lumières sont-elles prêtes (activées et au moins une lampe) ?
export const lightsReady = () => { const s = lightsStatus(); return s.enabled && s.targets > 0; };

// Envoie une couleur à toutes les lampes choisies
async function push(color) {
  const c = lightsConf();
  const bri = Math.max(1, Math.round(254 * (c.brightness / 100) * (color.bri ?? 1)));
  const jobs = [];
  if (c.hueUser && c.hueBridge) {
    const xy = rgbToXy(color.r, color.g, color.b);
    for (const id of c.hueLights) {
      jobs.push(http(`http://${c.hueBridge}/api/${encodeURIComponent(c.hueUser)}/lights/${encodeURIComponent(id)}/state`, { method: 'PUT', body: JSON.stringify({ on: true, bri, xy, transitiontime: color.fast ? 1 : 3 }) }));
    }
  }
  for (const h of c.wled) {
    jobs.push(http(`http://${h}/json/state`, { method: 'POST', body: JSON.stringify({ on: true, bri, transition: color.fast ? 1 : 3, seg: [{ col: [[color.r, color.g, color.b]] }] }) }));
  }
  const res = await Promise.allSettled(jobs);
  const bad = res.filter((r) => r.status === 'rejected').length;
  failures = bad ? failures + bad : 0;
  return { sent: res.length - bad, failed: bad };
}

// Au plus 4 envois par seconde ; la dernière couleur reçue l'emporte.
export function setColor(color) {
  const col = { r: clamp8(color.r), g: clamp8(color.g), b: clamp8(color.b), bri: color.bri == null ? 1 : Math.min(1, Math.max(0.05, Number(color.bri) || 1)), fast: !!color.fast };
  pending = col;
  const wait = Math.max(0, 250 - (Date.now() - last));
  if (timer) return Promise.resolve({ queued: true });
  return new Promise((resolve) => {
    timer = setTimeout(async () => {
      timer = null; last = Date.now();
      const c = pending; pending = null;
      try { resolve(await push(c)); } catch (e) { resolve({ sent: 0, failed: 1, error: e.message }); }
    }, wait);
  });
}
// Valeur bornée entre 0 et 255
const clamp8 = (v) => Math.min(255, Math.max(0, Math.round(Number(v) || 0)));

// ------------------------------------------------------------------ session : mémoriser puis restaurer l'état des lampes
let session = null;
// Début de lecture : mémorise l'état des lampes pour le rétablir à la fin
export async function startSession(profileId) {
  const c = lightsConf();
  if (!lightsReady()) return { active: false };
  if (session) { session.profileId = profileId; session.at = Date.now(); return { active: true }; }
  session = { profileId, at: Date.now(), hue: {}, wled: {} };
  if (c.restore) {
    if (c.hueUser && c.hueBridge) {
      try {
        const all = await http(`http://${c.hueBridge}/api/${encodeURIComponent(c.hueUser)}/lights`);
        for (const id of c.hueLights) { const s = all && all[id] && all[id].state; if (s) session.hue[id] = { on: !!s.on, bri: s.bri, xy: s.xy, ct: s.ct }; }
      } catch (e) { console.warn('[lumières] état Hue illisible :', e.message); }
    }
    for (const h of c.wled) {
      try { const s = await http(`http://${h}/json/state`); if (s) session.wled[h] = { on: !!s.on, bri: s.bri, ps: s.ps }; } catch (e) { console.warn('[lumières] état WLED illisible :', e.message); }
    }
  }
  return { active: true };
}
// Fin de lecture : les lampes reviennent comme avant
export async function endSession() {
  const s = session;
  session = null;
  if (timer) { clearTimeout(timer); timer = null; pending = null; }
  if (!s) return { restored: 0 };
  const c = lightsConf();
  const jobs = [];
  if (c.restore) {
    for (const [id, st] of Object.entries(s.hue)) {
      const body = st.on ? { on: true, bri: st.bri, transitiontime: 10, ...(st.xy ? { xy: st.xy } : st.ct ? { ct: st.ct } : {}) } : { on: false, transitiontime: 10 };
      jobs.push(http(`http://${c.hueBridge}/api/${encodeURIComponent(c.hueUser)}/lights/${encodeURIComponent(id)}/state`, { method: 'PUT', body: JSON.stringify(body) }));
    }
    for (const [h, st] of Object.entries(s.wled)) {
      jobs.push(http(`http://${h}/json/state`, { method: 'POST', body: JSON.stringify(st.on ? { on: true, bri: st.bri, transition: 10, ...(st.ps > 0 ? { ps: st.ps } : {}) } : { on: false, transition: 10 }) }));
    }
  }
  const res = await Promise.allSettled(jobs);
  return { restored: res.filter((r) => r.status === 'fulfilled').length };
}
// Lecture qui pilote les lumières en ce moment
export const sessionInfo = () => (session ? { profileId: session.profileId, since: session.at } : null);

// Une session oubliée (onglet fermé sans prévenir) est rendue aux lampes après 3 min sans couleur.
export function reapSessions() {
  if (session && Date.now() - last > 180_000 && Date.now() - session.at > 180_000) endSession().catch(() => {});
}

// Test depuis les réglages : un violet Venus pendant 2 s, puis retour à l'état d'avant.
export async function testLights() {
  if (!lightsReady()) throw new Error('Aucune lampe configurée');
  await startSession(0);
  const r = await push({ r: 120, g: 60, b: 230, bri: 1, fast: true });
  setTimeout(() => endSession().catch(() => {}), 2000);
  if (!r.sent) throw new Error(r.error || 'Aucune lampe n’a répondu');
  return r;
}
