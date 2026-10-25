// Métadonnées TMDB (affiches, résumés en français, classification d'âge, logos)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, getSetting } from './db.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const imagesDir = path.join(config.dataDir, 'images');

export function tmdbKey() { return getSetting('tmdb_key') || config.tmdbKey || ''; }
export const lang = () => getSetting('metadata_lang', 'fr-FR');
const region = () => (lang().split('-')[1] || 'FR').toUpperCase();

export async function tmdb(endpoint, params = {}) {
  const key = tmdbKey();
  if (!key) throw new Error('Clé TMDB manquante');
  const url = new URL(API + endpoint);
  const headers = { Accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // jeton v4
  else url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`TMDB ${res.status} ${endpoint}`);
    return res.json();
  }
  throw new Error('TMDB : trop de requêtes');
}

export async function testKey(key) {
  const url = new URL(API + '/configuration');
  const headers = {};
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; else url.searchParams.set('api_key', key);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  return res.ok;
}

// Téléchargement et mise en cache local des images (l'interface ne dépend plus d'internet ensuite)
export async function downloadImage(tmdbPath, size) {
  if (!tmdbPath) return null;
  const name = `t_${size}_${tmdbPath.replace(/^\//, '').replace(/[^\w.]/g, '')}`;
  const dest = path.join(imagesDir, name);
  if (fs.existsSync(dest)) return name;
  try {
    const res = await fetch(`${IMG}/${size}${tmdbPath}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest + '.tmp', buf);
    fs.renameSync(dest + '.tmp', dest);
    return name;
  } catch { return null; }
}

export function copyLocalImage(src) {
  try {
    const st = fs.statSync(src);
    const h = crypto.createHash('sha1').update(src + st.mtimeMs).digest('hex').slice(0, 16);
    const name = `l_${h}${path.extname(src).toLowerCase()}`;
    const dest = path.join(imagesDir, name);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    return name;
  } catch { return null; }
}

// Classifications -> âge minimum
const AGE = {
  FR: { U: 0, TP: 0, '10': 10, '12': 12, '16': 16, '18': 18 },
  US: { G: 0, PG: 8, 'PG-13': 13, R: 17, 'NC-17': 18, 'TV-Y': 0, 'TV-Y7': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 14, 'TV-MA': 17 },
  DE: { '0': 0, '6': 6, '12': 12, '16': 16, '18': 18 },
  GB: { U: 0, PG: 8, '12': 12, '12A': 12, '15': 15, '18': 18 },
};
function toAge(country, cert) {
  if (!cert) return null;
  const c = cert.trim().toUpperCase();
  if (AGE[country] && AGE[country][c] != null) return AGE[country][c];
  const n = parseInt(c.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n <= 21 ? n : null;
}
function pickCert(list, getCert) {
  const order = [region(), 'FR', 'US', 'GB', 'DE'];
  for (const country of order) {
    const entry = list.find((e) => e.iso_3166_1 === country);
    const cert = entry && getCert(entry);
    if (cert) { const age = toAge(country, cert); if (age != null) return { cert, age, country }; }
  }
  return null;
}

function pickLogo(images) {
  const logos = (images && images.logos) || [];
  const l = lang().split('-')[0];
  return (logos.find((x) => x.iso_639_1 === l) || logos.find((x) => x.iso_639_1 === 'en') || logos[0] || {}).file_path;
}

function similarity(a, b) {
  const n = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return n(a) === n(b) ? 1 : 0;
}
function bestResult(results, title, year, dateField) {
  if (!results || !results.length) return null;
  const scored = results.slice(0, 10).map((r, i) => {
    const y = Number((r[dateField] || '').slice(0, 4));
    let score = 10 - i + Math.min(5, Math.log10((r.popularity || 0) + 1) * 2);
    if (year && y === year) score += 12; else if (year && Math.abs(y - year) === 1) score += 6;
    if (similarity(r.title || r.name, title) || similarity(r.original_title || r.original_name, title)) score += 10;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

export async function matchMovie(item, forcedId) {
  let id = forcedId;
  if (!id) {
    let s = await tmdb('/search/movie', { query: item.title, year: item.year, language: lang(), include_adult: 'false' });
    if (!s.results.length && item.year) s = await tmdb('/search/movie', { query: item.title, language: lang() });
    const best = bestResult(s.results, item.title, item.year, 'release_date');
    if (!best) { run('UPDATE items SET matched = -1 WHERE id = ?', item.id); return false; }
    id = best.id;
  }
  const d = await tmdb(`/movie/${id}`, {
    language: lang(), append_to_response: 'release_dates,images',
    include_image_language: `${lang().split('-')[0]},en,null`,
  });
  const cert = pickCert(d.release_dates?.results || [], (e) => (e.release_dates || []).map((x) => x.certification).find(Boolean));
  const [poster, backdrop, logo] = await Promise.all([
    item.poster?.startsWith('l_') ? item.poster : downloadImage(d.poster_path, 'w500'),
    item.backdrop?.startsWith('l_') ? item.backdrop : downloadImage(d.backdrop_path, 'w1280'),
    downloadImage(pickLogo(d.images), 'w500'),
  ]);
  run(`UPDATE items SET tmdb_id=?, title=?, original_title=?, sort_title=?, year=?, overview=?, tagline=?, poster=?, backdrop=?, logo=?,
       age=?, certification=?, vote=?, genres=?, runtime=?, release_date=?, popularity=?, matched=1 WHERE id=?`,
  d.id, d.title || item.title, d.original_title || null, (d.title || item.title).toLowerCase(),
  Number((d.release_date || '').slice(0, 4)) || item.year, d.overview || null, d.tagline || null,
  poster, backdrop, logo, d.adult ? 18 : cert?.age ?? null, cert?.cert ?? null, d.vote_average || null,
  JSON.stringify((d.genres || []).map((g) => g.name)), d.runtime || null, d.release_date || null, d.popularity || null, item.id);
  return true;
}

export async function matchShow(show, forcedId) {
  let id = forcedId;
  if (!id) {
    let s = await tmdb('/search/tv', { query: show.title, first_air_date_year: show.year, language: lang() });
    if (!s.results.length && show.year) s = await tmdb('/search/tv', { query: show.title, language: lang() });
    const best = bestResult(s.results, show.title, show.year, 'first_air_date');
    if (!best) { run('UPDATE items SET matched = -1 WHERE id = ?', show.id); return false; }
    id = best.id;
  }
  const d = await tmdb(`/tv/${id}`, {
    language: lang(), append_to_response: 'content_ratings,images',
    include_image_language: `${lang().split('-')[0]},en,null`,
  });
  const cert = pickCert(d.content_ratings?.results || [], (e) => e.rating);
  const [poster, backdrop, logo] = await Promise.all([
    show.poster?.startsWith('l_') ? show.poster : downloadImage(d.poster_path, 'w500'),
    show.backdrop?.startsWith('l_') ? show.backdrop : downloadImage(d.backdrop_path, 'w1280'),
    downloadImage(pickLogo(d.images), 'w500'),
  ]);
  run(`UPDATE items SET tmdb_id=?, title=?, original_title=?, sort_title=?, year=?, overview=?, tagline=?, poster=?, backdrop=?, logo=?,
       age=?, certification=?, vote=?, genres=?, release_date=?, popularity=?, matched=1 WHERE id=?`,
  d.id, d.name || show.title, d.original_name || null, (d.name || show.title).toLowerCase(),
  Number((d.first_air_date || '').slice(0, 4)) || show.year, d.overview || null, d.tagline || null,
  poster, backdrop, logo, cert?.age ?? null, cert?.cert ?? null, d.vote_average || null,
  JSON.stringify((d.genres || []).map((g) => g.name)), d.first_air_date || null, d.popularity || null, show.id);

  // Saisons et épisodes
  const seasons = all("SELECT * FROM items WHERE type='season' AND show_id=?", show.id);
  for (const season of seasons) {
    let sd;
    try { sd = await tmdb(`/tv/${d.id}/season/${season.season_num}`, { language: lang() }); } catch { continue; }
    const sPoster = await downloadImage(sd.poster_path, 'w500');
    run('UPDATE items SET title=?, overview=?, poster=COALESCE(?, poster), matched=1 WHERE id=?',
      sd.name || season.title, sd.overview || null, sPoster, season.id);
    const eps = all("SELECT * FROM items WHERE type='episode' AND parent_id=?", season.id);
    for (const ep of eps) {
      const e = (sd.episodes || []).find((x) => x.episode_number === ep.episode_num);
      if (!e) continue;
      const still = await downloadImage(e.still_path, 'w500');
      run('UPDATE items SET title=?, overview=?, still=COALESCE(?, still), vote=?, runtime=?, year=?, release_date=?, matched=1 WHERE id=?',
        e.name || ep.title, e.overview || null, still, e.vote_average || null, e.runtime || null,
        Number((e.air_date || '').slice(0, 4)) || null, e.air_date || null, ep.id);
    }
  }
  return true;
}

export async function searchTmdb(type, query, year) {
  const s = await tmdb(type === 'movie' ? '/search/movie' : '/search/tv', {
    query, language: lang(), [type === 'movie' ? 'year' : 'first_air_date_year']: year,
  });
  return (s.results || []).slice(0, 12).map((r) => ({
    id: r.id, title: r.title || r.name, year: Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
    overview: r.overview, poster: r.poster_path ? `${IMG}/w185${r.poster_path}` : null,
  }));
}

// Récupère les métadonnées manquantes (appelé après chaque scan)
export async function refreshMissing(onProgress) {
  if (!tmdbKey()) return;
  const pending = all("SELECT * FROM items WHERE type IN ('movie','show') AND matched = 0");
  let done = 0;
  const queue = [...pending];
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try { it.type === 'movie' ? await matchMovie(it) : await matchShow(it); }
      catch (e) { console.warn(`[métadonnées] ${it.title}: ${e.message}`); }
      onProgress && onProgress(++done, pending.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // Episodes ajoutés plus tard à une série déjà identifiée
  const shows = all("SELECT DISTINCT s.* FROM items s JOIN items e ON e.show_id = s.id WHERE s.type='show' AND s.matched=1 AND e.type='episode' AND e.matched=0");
  for (const s of shows) { try { await matchShow(s, s.tmdb_id); } catch (e) { console.warn(e.message); } }
}

export function itemById(id) { return get('SELECT * FROM items WHERE id = ?', id); }
