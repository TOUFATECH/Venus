// Odin dans Venus : Venus peut être relié à Odin (l'assistant de la maison, où Venus s'appelle « Freyja »).
// - la mascotte d'Odin se promène dans Venus et explique chaque page (sans Odin relié, elle explique quand même) ;
// - « Demande à Odin » transmet ta question à Odin (adresse + jeton Bearer d'Odin, gardés côté serveur, jamais
//   envoyés au navigateur) ; Odin répond en texte.
// Le jeton est chiffré comme les autres secrets (db.js). Les réponses d'Odin ne déclenchent rien dans Venus.
import { getSetting, setSetting } from './db.js';

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
export function odinConf() {
  return { url: clean(getSetting('odin_url', '') || process.env.ODIN_URL || ''), token: String(getSetting('odin_token', '') || process.env.ODIN_TOKEN || '').trim() };
}
export function odinLinked() { const c = odinConf(); return Boolean(c.url && c.token); }

/** Adresse acceptée : http(s) seulement, sans identifiants dans l'URL. */
export function validOdinUrl(u) {
  if (!u) return '';
  let x; try { x = new URL(clean(u)); } catch { throw Object.assign(new Error('Adresse d’Odin invalide'), { status: 400 }); }
  if (!/^https?:$/.test(x.protocol) || x.username || x.password) throw Object.assign(new Error('Adresse d’Odin invalide (http ou https, sans identifiant)'), { status: 400 });
  return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, '')}`;
}
export function saveOdin({ url, token }) {
  if (url !== undefined) setSetting('odin_url', validOdinUrl(url));
  if (token !== undefined) setSetting('odin_token', String(token || '').trim());
}

/** Odin répond-il ? (sans jeton : seulement « joignable ») */
export async function odinPing(fetchImpl = fetch) {
  const { url } = odinConf();
  if (!url) return false;
  try { const r = await fetchImpl(`${url}/`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(4000) }); return r.status < 500; } catch { return false; }
}

/** Pose une question à Odin. `page` dit où l'on est dans Venus (Odin s'en sert pour répondre juste). */
export async function askOdin(text, page = '', fetchImpl = fetch) {
  const { url, token } = odinConf();
  if (!url || !token) throw Object.assign(new Error('Odin n’est pas relié : Réglages → Odin'), { status: 400 });
  const q = String(text || '').trim().slice(0, 2000);
  if (!q) throw Object.assign(new Error('Question vide'), { status: 400 });
  const where = String(page || '').replace(/[^\p{L}\p{N} /._-]/gu, '').slice(0, 120);
  const r = await fetchImpl(`${url}/api/ask`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: `Depuis Venus (Freyja)${where ? `, page ${where}` : ''} : ${q}` }),
    signal: AbortSignal.timeout(115_000),
  });
  if (r.status === 401) throw Object.assign(new Error('Odin refuse le jeton : recopie-le dans Réglages → Odin'), { status: 502 });
  if (!r.ok) throw Object.assign(new Error(`Odin ne répond pas (${r.status})`), { status: 502 });
  return (await r.text()).slice(0, 8000);
}
