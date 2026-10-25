// Sous-titres en ligne (OpenSubtitles.com) : recherche par film / épisode et langue, téléchargement,
// enregistrement à côté des données de Venus (le fichier vidéo n'est jamais modifié).
// Clé API gratuite (opensubtitles.com, « API consumers »). Un compte (gratuit) permet plus de téléchargements par jour.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { get, run, getSetting } from './db.js';

const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'Venus v1.0';
export const subsDir = path.join(config.dataDir, 'subs');
const ISO3 = { fr: 'fre', en: 'eng', es: 'spa', de: 'ger', it: 'ita', pt: 'por', 'pt-br': 'por', ja: 'jpn', ar: 'ara', nl: 'dut', ru: 'rus', zh: 'chi', 'zh-cn': 'chi', ko: 'kor', pl: 'pol', tr: 'tur', sv: 'swe' };
export const osKey = () => getSetting('opensubtitles_key', '') || process.env.OPENSUBTITLES_API_KEY || '';
export const osOn = () => !!osKey();

let token = null, tokenAt = 0, baseUrl = API;
async function os(pathname, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Api-Key': osKey(), 'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${auth ? baseUrl : API}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error(j.message || 'Clé OpenSubtitles refusée');
  if (res.status === 406 || res.status === 429) throw new Error(j.message || 'Limite de téléchargements atteinte pour aujourd’hui');
  if (!res.ok) throw new Error(j.message || `OpenSubtitles ${res.status}`);
  return j;
}
async function login() {
  const user = getSetting('opensubtitles_user', ''), pass = getSetting('opensubtitles_pass', '');
  if (!user || !pass) return false;
  if (token && Date.now() - tokenAt < 12 * 3600000) return true;
  const j = await os('/login', { method: 'POST', body: { username: user, password: pass } });
  token = j.token; tokenAt = Date.now();
  if (j.base_url) baseUrl = `https://${String(j.base_url).replace(/^https?:\/\//, '')}/api/v1`;
  return true;
}
export function resetOsLogin() { token = null; }

// Recherche pour un film ou un épisode de la médiathèque
export async function searchSubs(itemId, languages = 'fr,en') {
  const item = get('SELECT * FROM items WHERE id = ?', itemId);
  if (!item) throw new Error('Introuvable');
  const show = item.show_id ? get('SELECT * FROM items WHERE id = ?', item.show_id) : null;
  const q = new URLSearchParams({ languages });
  if (item.type === 'episode') {
    if (show && show.tmdb_id) q.set('parent_tmdb_id', show.tmdb_id); else if (show && show.imdb_id) q.set('parent_imdb_id', show.imdb_id.replace(/^tt/, '')); else q.set('query', show ? show.title : item.title);
    q.set('season_number', item.season_num); q.set('episode_number', item.episode_num);
  } else if (item.imdb_id) q.set('imdb_id', item.imdb_id.replace(/^tt/, ''));
  else if (item.tmdb_id) q.set('tmdb_id', item.tmdb_id);
  else { q.set('query', item.title); if (item.year) q.set('year', item.year); }
  q.set('order_by', 'download_count');
  const j = await os(`/subtitles?${q}`);
  const base = path.basename(item.path || '', path.extname(item.path || '')).toLowerCase();
  return (j.data || []).map((d) => {
    const a = d.attributes || {};
    const f = (a.files || [])[0] || {};
    const release = a.release || f.file_name || '';
    // Même « release » que le fichier vidéo : synchronisation presque certaine
    const match = base && release && base.replace(/[^a-z0-9]/g, '').includes(release.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18));
    return { fileId: f.file_id, lang: a.language, release, downloads: a.download_count || 0, hearingImpaired: !!a.hearing_impaired, trusted: !!a.from_trusted, rating: a.ratings || 0, match: !!match, fps: a.fps || null };
  }).filter((x) => x.fileId).sort((a, b) => b.match - a.match || b.trusted - a.trusted || b.downloads - a.downloads).slice(0, 30);
}

// Téléchargement : le fichier .srt est ajouté aux sous-titres du titre
export async function downloadSub(itemId, fileId, lang) {
  const item = get('SELECT * FROM items WHERE id = ?', itemId);
  if (!item) throw new Error('Introuvable');
  await login().catch(() => false);
  const j = await os('/download', { method: 'POST', body: { file_id: Number(fileId), sub_format: 'srt' }, auth: !!token });
  if (!j.link) throw new Error(j.message || 'Téléchargement refusé');
  const res = await fetch(j.link, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const l3 = ISO3[String(lang || '').toLowerCase()] || String(lang || 'und').slice(0, 3);
  const dir = path.join(subsDir, String(item.id));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${l3}.${fileId}.srt`);
  fs.writeFileSync(file, buf);
  const probe = JSON.parse(item.probe || '{"subs":[]}');
  probe.subs = (probe.subs || []).filter((s) => s.path !== file);
  const sub = { id: `o${fileId}`, path: file, codec: 'subrip', lang: l3, title: 'OpenSubtitles', forced: false, isDefault: false, text: true, external: true, online: true };
  probe.subs.push(sub);
  run('UPDATE items SET probe = ? WHERE id = ?', JSON.stringify(probe), item.id);
  return { sub, remaining: j.remaining ?? null };
}

// Sous-titres déjà téléchargés pour un titre (gardés lors d'une nouvelle analyse du fichier)
export function downloadedSubs(itemId) {
  const dir = path.join(subsDir, String(itemId));
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.srt')); } catch { return []; }
  return files.map((f) => { const [lang, id] = f.split('.'); return { id: `o${id}`, path: path.join(dir, f), codec: 'subrip', lang, title: 'OpenSubtitles', forced: false, isDefault: false, text: true, external: true, online: true }; });
}
