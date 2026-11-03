// Trakt (app.trakt.tv) : affiches, fonds et logos des films, séries et animés, plus la note Trakt.
// Identifiant client gratuit : créez une application sur trakt.tv/oauth/applications (aucune connexion de compte).
// Les images sont téléchargées une fois sur le serveur, comme celles de TMDB.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getSetting } from './db.js';

const API = 'https://api.trakt.tv';
const imagesDir = path.join(config.dataDir, 'images');
export const traktId = () => String(getSetting('trakt_client_id', '') || process.env.TRAKT_CLIENT_ID || '').trim();
// Source des affiches : tmdb (Trakt seulement si TMDB n'en a pas) | trakt (Trakt d'abord)
export const posterSource = () => String(getSetting('poster_source', 'tmdb'));

async function traktGet(pathname, params = {}, id = traktId()) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const res = await fetch(u, {
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': id, 'User-Agent': 'Venus/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Identifiant client Trakt refusé');
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000)); return traktGet(pathname, params, id); }
  if (!res.ok) throw new Error(`Trakt ${res.status}`);
  return res.json();
}

export async function testTrakt(id) {
  await traktGet('/movies/trending', { limit: 1 }, id);
  return true;
}

// Trouve le titre chez Trakt (par identifiant TMDB, puis IMDb, puis titre + année)
export async function traktFind(item) {
  if (!traktId()) return null;
  const type = item.type === 'movie' ? 'movie' : 'show';
  const pick = (list) => (list || []).find((x) => x && x[type]) ? (list || []).find((x) => x && x[type])[type] : null;
  let m = null;
  if (item.tmdb_id) m = pick(await traktGet(`/search/tmdb/${item.tmdb_id}`, { type, extended: 'full,images' }));
  if (!m && item.imdb_id) m = pick(await traktGet(`/search/imdb/${item.imdb_id}`, { type, extended: 'full,images' }));
  if (!m && item.title) {
    const list = await traktGet(`/search/${type}`, { query: item.original_title || item.title, years: item.year || undefined, extended: 'full,images', limit: 5 });
    m = pick(list);
  }
  if (!m) return null;
  const first = (a) => { const v = Array.isArray(a) ? a[0] : a; return v ? (/^https?:/.test(v) ? v : `https://${String(v).replace(/^\/+/, '')}`) : null; };
  const im = m.images || {};
  return {
    ids: m.ids || {},
    rating: m.rating ? { v: Math.round(m.rating * 10) / 10, max: 10, votes: m.votes || null, url: `https://trakt.tv/${type === 'movie' ? 'movies' : 'shows'}/${(m.ids && m.ids.slug) || ''}` } : null,
    poster: first(im.poster), fanart: first(im.fanart), logo: first(im.logo), thumb: first(im.thumb),
    posters: (im.poster || []).map((v) => first([v])), fanarts: (im.fanart || []).map((v) => first([v])),
  };
}

// Télécharge une image Trakt dans le dossier des images ; renvoie son nom (ou null)
export async function downloadTraktImage(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)trakt\.tv$/.test(u.hostname)) return null; // seules les images de Trakt
  const ext = /\.webp(\?|$)/i.test(u.pathname) ? '.webp' : /\.png(\?|$)/i.test(u.pathname) ? '.png' : '.jpg';
  const name = `k_${crypto.createHash('sha1').update(u.href).digest('hex').slice(0, 20)}${ext}`;
  const dest = path.join(imagesDir, name);
  if (fs.existsSync(dest)) return name;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': 'Venus/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') || 'image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500 || buf.length > 15e6) return null;
    fs.writeFileSync(dest + '.tmp', buf);
    fs.renameSync(dest + '.tmp', dest);
    return name;
  } catch { return null; }
}
