// Chaînes France Télévisions (Mayotte La 1ère et les autres La 1ère) : jeton toujours frais.
// Les listes publiques (ParaTV) contiennent des adresses France TV signées d'un jeton qui expire au bout de
// quelques heures ; quand la liste n'a pas été régénérée à temps, la chaîne reste noire (« Accès refusé »).
// Venus demande alors lui-même un nouveau jeton au service de France TV (celui qu'utilise france.tv) et le met
// à la place de l'ancien. Le navigateur passe par le relais (qui sert la liste rafraîchie) ; ffmpeg (aperçus,
// conversion, enregistrement) lit une copie rafraîchie de la liste, écrite dans le cache de Venus.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const AUTH = process.env.VENUS_FTV_AUTH || 'https://hdfauth.ftven.fr/esi/TA';
/** Liste France TV venant de ParaTV (ou adresse France TV directe). */
export const isFtv = (u) => /\/ParaTV\/[^/]+\/streams\/francetv\//i.test(String(u || '')) || /^https:\/\/[a-z0-9-]+\.ftven\.fr\//i.test(String(u || ''));
// https://simulcast-b.ftven.fr/<jeton>/simulcast/… ; jeton = base64 de « exp=…~acl=…~hmac=… »
const SIGNED = /https:\/\/([a-z0-9-]+\.ftven\.fr)\/([A-Za-z0-9_=-]{24,})\/([^\s"]+)/gi;
export function tokenExp(tok) {
  try { const m = /exp=(\d{9,})/.exec(Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')); return m ? Number(m[1]) * 1000 : 0; } catch { return 0; }
}
const DIR = path.join(config.dataDir, 'cache', 'ftv');
export const isFtvFile = (p) => typeof p === 'string' && p.startsWith(DIR + path.sep);
/** Options ffmpeg pour lire la copie rafraîchie : le fichier local, puis seulement des adresses web. */
export const FTV_ARGS = ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-user_agent', BROWSER];

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': BROWSER }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} : ${r.status}`);
  return r.text();
}
/** Nouveau jeton pour une adresse France TV (non signée). */
export async function freshToken(unsigned) {
  const t = await get(`${AUTH}?format=json&url=${encodeURIComponent(unsigned)}`);
  let u = '';
  try { u = JSON.parse(t).url || ''; } catch { u = t.trim(); }
  SIGNED.lastIndex = 0;
  const m = SIGNED.exec(u);
  if (!m) throw new Error('France TV n’a pas donné de jeton');
  return m[2];
}

const cache = new Map(); // adresse → { text, exp, hosts }
const pending = new Map();
/** Liste de la chaîne avec un jeton valable (au moins 2 min). */
export async function ftvPlaylist(url) {
  const c = cache.get(url);
  if (c && c.exp - Date.now() > 120e3) return c;
  if (pending.has(url)) return pending.get(url);
  const job = (async () => {
    let text = await get(url);
    SIGNED.lastIndex = 0;
    const first = SIGNED.exec(text);
    if (!first) { const r = { text, exp: Date.now() + 300e3, hosts: [] }; cache.set(url, r); return r; }
    let tok = first[2], exp = tokenExp(tok);
    if (exp - Date.now() < 120e3) {
      // Jeton périmé (liste pas régénérée à temps) : on en demande un neuf
      tok = await freshToken(`https://${first[1]}/${first[3]}`);
      exp = tokenExp(tok) || Date.now() + 3600e3;
    }
    const hosts = new Set();
    text = text.replace(SIGNED, (_, h, _t, rest) => { hosts.add(h); return `https://${h}/${tok}/${rest}`; });
    const r = { text, exp, hosts: [...hosts] };
    cache.set(url, r);
    return r;
  })().finally(() => pending.delete(url));
  pending.set(url, job);
  return job;
}

/** Adresse à donner à ffmpeg : la liste d'origine, ou pour France TV une copie au jeton frais. */
export async function liveSource(url) {
  if (!isFtv(url)) return url;
  try {
    const { text } = await ftvPlaylist(url);
    // Seulement des lignes HLS et des adresses France TV en https (jamais d'autre fichier du serveur)
    const safe = text.split(/\r?\n/).filter((l) => !l.trim() || (l.startsWith('#') && !/URI="(?!https:\/\/[a-z0-9-]+\.ftven\.fr\/)/i.test(l)) || /^https:\/\/[a-z0-9-]+\.ftven\.fr\/\S+$/i.test(l.trim())).join('\n');
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.m3u8`);
    fs.writeFileSync(file, safe);
    return file;
  } catch (e) { console.warn('[France TV]', e.message); return url; }
}
