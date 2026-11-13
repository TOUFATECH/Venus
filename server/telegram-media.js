// Fiches Telegram des nouveautés : pour chaque film, série ou animé, un message avec l'affiche, le résumé, la date
// de sortie et l'état, mis à jour au fil de l'eau (un seul message par titre, pas de rafale) :
//   ⬇️ En cours de téléchargement (42 %, reste 12 min)  →  📦 Téléchargé, arrive dans Venus  →  ✅ Disponible sur Venus
// Les téléchargements viennent de la file de Radarr / Sonarr ; l'arrivée, de l'analyse des dossiers de Venus.
import fs from 'node:fs';
import path from 'node:path';
import { db, all, get, run, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { arrOn, call as arrCall } from './arr.js';

const imagesDir = path.join(config.dataDir, 'images');
const API = process.env.VENUS_TELEGRAM_API || 'https://api.telegram.org';
db.exec(`CREATE TABLE IF NOT EXISTS tg_posts (
  key TEXT PRIMARY KEY, chat TEXT, message_id INTEGER, photo INTEGER DEFAULT 0, state TEXT, caption TEXT, info TEXT, created_at INTEGER, updated_at INTEGER
)`);

// Réglages Telegram
const conf = () => ({ token: getSetting('telegram_token', ''), chat: getSetting('telegram_chat', ''), publicUrl: String(getSetting('public_url', '') || '').replace(/\/+$/, '') });
// Les fiches Telegram des nouveautés sont-elles activées ?
export const tgMediaOn = () => { const c = conf(); return !!(c.token && c.chat) && String(getSetting('tg_media', '1')) !== '0'; };
// Le suivi des téléchargements sur Telegram est-il activé ?
const tgDownloadsOn = () => tgMediaOn() && String(getSetting('tg_downloads', '1')) !== '0';
// Titre simplifié pour comparer
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// Échappe un texte pour le HTML de Telegram
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Lecture JSON tolérante
const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
// Date lisible en français
const fmtDate = (iso) => { if (!iso) return null; const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); return Number.isNaN(+d) ? null : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };

// ------------------------------------------------------------------ API Telegram
async function tg(method, body, file = null) {
  const c = conf();
  let opts;
  if (file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) if (v != null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    fd.append('photo', new Blob([fs.readFileSync(file)]), path.basename(file));
    opts = { method: 'POST', body: fd };
  } else opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(`${API}/bot${c.token}/${method}`, { ...opts, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 429 && j.parameters && j.parameters.retry_after) { await new Promise((r) => setTimeout(r, (j.parameters.retry_after + 1) * 1000)); return tg(method, body, file); }
  if (!j.ok) throw new Error(j.description || `Telegram ${res.status}`);
  return j.result;
}

// ------------------------------------------------------------------ légende
const STATE = {
  downloading: (i) => `⬇️ <b>En cours de téléchargement</b>${i.progress != null ? ` : ${i.progress} %` : ''}${i.eta ? ` · reste ${i.eta}` : ''}`,
  downloaded: () => '📦 <b>Téléchargé</b> : arrive dans Venus',
  available: () => '✅ <b>Disponible sur Venus</b>',
};
// Texte de la fiche Telegram d'un titre
function caption(i) {
  const icon = i.kind === 'movie' ? '🎬' : i.kind === 'anime' ? '🌸' : '📺';
  const lines = [`${icon} <b>${esc(i.title)}</b>${i.year ? ` (${i.year})` : ''}`];
  const meta = [i.kind === 'movie' ? 'Film' : i.kind === 'anime' ? 'Animé' : 'Série', ...(i.genres || []).slice(0, 3)].filter(Boolean).join(' · ');
  lines.push(esc(meta));
  const rel = fmtDate(i.release);
  if (rel) lines.push(`📅 ${i.kind === 'movie' ? 'Sortie' : 'Diffusion'} : ${rel}`);
  if (i.episodes && i.episodes.length) lines.push(`🎞️ ${esc(epList(i.episodes))}`);
  lines.push(STATE[i.state](i));
  const url = i.url && conf().publicUrl ? `${conf().publicUrl}${i.url}` : null;
  const tail = url ? `\n\n<a href="${esc(url)}">▶️ Ouvrir dans Venus</a>` : '';
  const head = lines.join('\n');
  // Légende de photo : 1 024 caractères au plus (balises comprises) ; le résumé est coupé proprement
  const room = 1000 - head.length - tail.length - 4;
  let ov = String(i.overview || '').replace(/\s+/g, ' ').trim();
  if (ov.length > room) ov = `${ov.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '')}…`;
  return `${head}${ov && room > 40 ? `\n\n<i>${esc(ov)}</i>` : ''}${tail}`;
}
// « S1 É1-É3, S2 É1 »
function epList(eps) {
  const by = new Map();
  for (const e of eps) { if (!by.has(e.s)) by.set(e.s, new Set()); by.get(e.s).add(e.e); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([s, set]) => {
    const n = [...set].sort((a, b) => a - b);
    const parts = []; let a = n[0], b = n[0];
    for (const x of n.slice(1)) { if (x === b + 1) b = x; else { parts.push(a === b ? `É${a}` : `É${a}-É${b}`); a = b = x; } }
    parts.push(a === b ? `É${a}` : `É${a}-É${b}`);
    return `${s == null ? '' : `S${s} `}${parts.join(', ')}`;
  }).join(' · ');
}

// Envoie la fiche, ou met à jour celle déjà envoyée pour ce titre
async function upsert(key, info, posterFile, posterUrl) {
  const c = conf();
  const prev = get('SELECT * FROM tg_posts WHERE key = ?', key);
  // Fiche « disponible » de plus de 12 h (nouvel épisode la semaine suivante…) : nouveau message
  const fresh = prev && !(prev.state === 'available' && Date.now() - prev.updated_at > 12 * 3600e3);
  if (fresh) {
    // Déjà « disponible » : la file de Radarr / Sonarr ne la fait pas revenir en arrière
    if (prev.state === 'available' && info.state && info.state !== 'available') return;
    const old = parse(prev.info, {});
    const clean = Object.fromEntries(Object.entries(info).filter(([k, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length && k !== 'episodes') && !(v == null && !['progress', 'eta'].includes(k))));
    const merged = { ...old, ...clean, episodes: mergeEps(old.episodes, info.episodes) };
    const cap = caption(merged);
    if (cap === prev.caption) return;
    try {
      if (prev.photo) await tg('editMessageCaption', { chat_id: prev.chat, message_id: prev.message_id, caption: cap, parse_mode: 'HTML' });
      else await tg('editMessageText', { chat_id: prev.chat, message_id: prev.message_id, text: cap, parse_mode: 'HTML', disable_web_page_preview: true });
      run('UPDATE tg_posts SET state = ?, caption = ?, info = ?, updated_at = ? WHERE key = ?', merged.state, cap, JSON.stringify(merged), Date.now(), key);
      return;
    } catch (e) { if (!/not found|can't be edited|message to edit/i.test(e.message)) throw e; } // message supprimé : on en renvoie un
  }
  const cap = caption(info);
  let msg, photo = 1;
  try {
    if (posterFile && fs.existsSync(posterFile)) msg = await tg('sendPhoto', { chat_id: c.chat, caption: cap, parse_mode: 'HTML' }, posterFile);
    else if (posterUrl) msg = await tg('sendPhoto', { chat_id: c.chat, photo: posterUrl, caption: cap, parse_mode: 'HTML' });
    else throw new Error('pas d’affiche');
  } catch (e) {
    if (/chat not found|unauthorized|bot was blocked/i.test(e.message)) throw e;
    msg = await tg('sendMessage', { chat_id: c.chat, text: cap, parse_mode: 'HTML', disable_web_page_preview: true }); photo = 0;
  }
  run('INSERT OR REPLACE INTO tg_posts(key, chat, message_id, photo, state, caption, info, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    key, String(c.chat), msg.message_id, photo, info.state, cap, JSON.stringify(info), Date.now(), Date.now());
}
// Fusionne deux listes d'épisodes sans doublon
function mergeEps(a = [], b = []) {
  const seen = new Set(), out = [];
  for (const e of [...(a || []), ...(b || [])]) { const k = `${e.s}:${e.e}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out;
}
// Clé unique d'un titre (type + titre simplifié)
const keyOf = (kind, title) => `${kind === 'movie' ? 'm' : 's'}:${norm(title)}`;

// ------------------------------------------------------------------ téléchargements (file de Radarr / Sonarr)
const pick = (images, t) => ((images || []).find((x) => x.coverType === t) || {}).remoteUrl || null;
let lastQueue = new Map(); // clé → info (pour repérer ceux qui viennent de finir)
// Suit les téléchargements de Radarr / Sonarr et met à jour les fiches Telegram
export async function pollDownloads() {
  if (!tgDownloadsOn()) return 'Fiches Telegram désactivées';
  const now = new Map();
  for (const app of ['radarr', 'sonarr']) {
    if (!arrOn(app)) continue;
    let q;
    try { q = await arrCall(app, `/api/v3/queue?pageSize=100&${app === 'radarr' ? 'includeMovie=true' : 'includeSeries=true&includeEpisode=true'}`); } catch { continue; }
    for (const r of (q && q.records) || []) {
      const m = r.movie || r.series;
      if (!m) continue;
      const kind = app === 'radarr' ? 'movie' : m.seriesType === 'anime' ? 'anime' : 'show';
      const key = keyOf(kind, m.title);
      const size = r.size || 0, left = r.sizeleft || 0;
      const cur = now.get(key) || {
        kind, title: m.title, year: m.year || null, genres: (m.genres || []).slice(0, 3), overview: m.overview || '',
        release: app === 'radarr' ? (m.digitalRelease || m.inCinemas || m.physicalRelease || null) : (r.episode && r.episode.airDate) || m.firstAired || null,
        poster: m.remotePoster || pick(m.images, 'poster'), episodes: [], size: 0, left: 0, eta: null, imported: true,
      };
      cur.size += size; cur.left += left;
      if (r.episode) cur.episodes.push({ s: r.episode.seasonNumber, e: r.episode.episodeNumber });
      if (r.timeleft && r.timeleft !== '00:00:00' && (!cur.eta || r.timeleft > cur.eta)) cur.eta = r.timeleft;
      if (r.trackedDownloadState !== 'importPending' && r.trackedDownloadState !== 'importing' && !(size && left === 0)) cur.imported = false;
      now.set(key, cur);
    }
  }
  for (const [key, i] of now) {
    const progress = i.size ? Math.round(((i.size - i.left) / i.size) * 100) : null;
    // Mise à jour tous les 25 % (Telegram limite les modifications)
    const bucket = progress == null ? 0 : Math.floor(progress / 25) * 25;
    const state = i.imported ? 'downloaded' : 'downloading';
    const eta = i.eta ? i.eta.replace(/^00:/, '').replace(/^(\d+):(\d+):\d+$/, (_, h, m) => `${Number(h)} h ${m}`).replace(/^(\d+):\d+$/, (_, m) => `${Number(m)} min`) : null;
    try { await upsert(key, { ...i, state, progress: state === 'downloading' ? bucket : null, eta: state === 'downloading' ? eta : null, url: null }, null, i.poster); } catch (e) { console.warn('[telegram]', e.message); }
  }
  // Disparus de la file sans être encore dans Venus : téléchargés, en cours d'import
  for (const [key] of lastQueue) {
    if (now.has(key)) continue;
    const p = get('SELECT state FROM tg_posts WHERE key = ?', key);
    if (p && p.state === 'downloading') { try { await upsert(key, { state: 'downloaded', progress: null, eta: null }, null, null); } catch (e) { console.warn('[telegram]', e.message); } }
  }
  lastQueue = now;
  return `${now.size} téléchargement(s) suivi(s)`;
}

// ------------------------------------------------------------------ arrivées dans Venus
export async function announceArrivals() {
  if (!tgMediaOn()) return 'Fiches Telegram désactivées';
  const since = Number(getSetting('tg_arrivals_at', 0)) || Date.now() - 3600e3;
  const until = Date.now() - 2 * 60e3; // on laisse 2 min à l'affiche et au résumé pour arriver
  if (until <= since) return 'Rien de nouveau';
  let n = 0;
  // Grosse arrivée (première analyse d'une bibliothèque…) : un seul message récapitulatif au lieu d'une rafale
  const movies = all("SELECT id, title FROM items WHERE type = 'movie' AND added_at > ? AND added_at <= ?", since, until);
  const shows = all("SELECT DISTINCT s.id, s.title FROM items e JOIN items s ON s.id = e.show_id WHERE e.type = 'episode' AND e.added_at > ? AND e.added_at <= ?", since, until);
  if (movies.length + shows.length > 12) {
    const names = [...movies, ...shows].map((x) => x.title);
    const c = conf();
    await tg('sendMessage', { chat_id: c.chat, parse_mode: 'HTML', disable_web_page_preview: true,
      text: `🍿 <b>${names.length} nouveautés dans Venus</b>\n${movies.length} film(s), ${shows.length} série(s) ou animé(s)\n\n${esc(names.slice(0, 40).join(' · '))}${names.length > 40 ? ` et ${names.length - 40} autres` : ''}` });
    setSetting('tg_arrivals_at', until);
    return `Récapitulatif de ${names.length} nouveautés envoyé`;
  }
  // Films (et films d'animation)
  for (const m of all("SELECT * FROM items WHERE type = 'movie' AND added_at > ? AND added_at <= ? ORDER BY added_at LIMIT 30", since, until)) {
    await post(m, { kind: m.category === 'anime' ? 'anime' : 'movie', episodes: null }); n++;
  }
  // Séries et animés : épisodes arrivés, regroupés par série
  const byShow = new Map();
  for (const e of all("SELECT id, show_id, season_num, episode_num FROM items WHERE type = 'episode' AND added_at > ? AND added_at <= ? ORDER BY added_at LIMIT 500", since, until)) {
    if (!byShow.has(e.show_id)) byShow.set(e.show_id, []);
    byShow.get(e.show_id).push({ s: e.season_num, e: e.episode_num });
  }
  for (const [showId, eps] of byShow) {
    const s = get('SELECT * FROM items WHERE id = ?', showId);
    if (!s) continue;
    await post(s, { kind: s.category === 'anime' ? 'anime' : 'show', episodes: eps.slice(0, 60) }); n++;
  }
  setSetting('tg_arrivals_at', until);
  return n ? `${n} fiche(s) envoyée(s) sur Telegram` : 'Rien de nouveau';
}
// Publie ou met à jour la fiche Telegram d'un titre
async function post(it, { kind, episodes }) {
  const info = {
    kind, title: it.title, year: it.year || null, genres: parse(it.genres, []).slice(0, 3), overview: it.overview || '',
    release: it.release_date || null, state: 'available', progress: null, eta: null, episodes, url: `/titre/${it.id}`,
  };
  const file = it.poster && !/^https?:/.test(it.poster) ? path.join(imagesDir, path.basename(it.poster)) : null;
  try { await upsert(keyOf(kind, it.title), info, file, /^https?:/.test(it.poster || '') ? it.poster : null); } catch (e) { console.warn('[telegram]', e.message); }
}

// Exemple (Réglages → Notifications) : la fiche du dernier film ou de la dernière série arrivés
export async function sendSample() {
  const c = conf();
  if (!c.token || !c.chat) throw new Error('Renseignez le bot et la discussion Telegram');
  const it = get("SELECT * FROM items WHERE type IN ('movie','show') AND poster IS NOT NULL ORDER BY added_at DESC LIMIT 1") || get("SELECT * FROM items WHERE type IN ('movie','show') ORDER BY added_at DESC LIMIT 1");
  if (!it) throw new Error('La médiathèque est vide');
  const kind = it.type === 'movie' ? 'movie' : it.category === 'anime' ? 'anime' : 'show';
  const info = { kind, title: it.title, year: it.year, genres: parse(it.genres, []).slice(0, 3), overview: it.overview, release: it.release_date, state: 'available', url: `/titre/${it.id}`, episodes: null };
  const file = it.poster && !/^https?:/.test(it.poster) ? path.join(imagesDir, path.basename(it.poster)) : null;
  const cap = caption(info);
  if (file && fs.existsSync(file)) await tg('sendPhoto', { chat_id: c.chat, caption: cap, parse_mode: 'HTML' }, file);
  else await tg('sendMessage', { chat_id: c.chat, text: cap, parse_mode: 'HTML', disable_web_page_preview: true });
  return { ok: true, title: it.title };
}
// Ménage : fiches de plus de 60 jours oubliées
export const pruneTgPosts = () => run('DELETE FROM tg_posts WHERE updated_at < ?', Date.now() - 60 * 864e5);
