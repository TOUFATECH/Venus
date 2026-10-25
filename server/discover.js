// Nouveautés (films, séries, animés sortis ou à venir) et demandes de téléchargement via Seerr
// (Seerr = Overseerr / Jellyseerr réunis). Seerr transmet la demande à Radarr / Sonarr, qui lancent
// la recherche et le téléchargement automatiquement ; Venus affiche ensuite la progression.
import { all, get, getSetting } from './db.js';
import { tmdb, tmdbKey, lang } from './metadata.js';
import { anilist, pickTrailer } from './ratings.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p';
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ------------------------------------------------------------------ Seerr
export const seerrConf = () => ({ url: String(getSetting('seerr_url', '') || '').replace(/\/+$/, ''), key: getSetting('seerr_key', '') || '' });
export const seerrOn = () => { const c = seerrConf(); return !!(c.url && c.key); };

export async function seerr(path, { method = 'GET', body, conf = seerrConf(), asUser = null } = {}) {
  if (!conf.url || !conf.key) throw new Error('Seerr n’est pas configuré');
  const res = await fetch(`${conf.url}/api/v1${path}`, {
    method, headers: { 'X-Api-Key': conf.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(asUser ? { 'X-API-User': String(asUser) } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Clé API Seerr refusée');
  if (!res.ok) {
    let msg = `Seerr ${res.status}`;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch { /* */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export async function seerrTest(conf) {
  const st = await seerr('/status', { conf });
  await seerr('/auth/me', { conf }); // vérifie la clé
  return { version: st && st.version };
}

// Statut Seerr : 1 inconnu, 2 en attente, 3 en cours, 4 partiellement disponible, 5 disponible
export const SEERR_STATUS = { 2: 'pending', 3: 'processing', 4: 'partial', 5: 'available', 6: 'blocked', 7: 'deleted' };
export function mediaState(info) {
  if (!info) return { state: 'none' };
  const dl = (info.downloadStatus || []).concat(info.downloadStatus4k || []);
  const size = dl.reduce((n, x) => n + (x.size || 0), 0), left = dl.reduce((n, x) => n + (x.sizeLeft || 0), 0);
  return {
    state: SEERR_STATUS[info.status] || 'none',
    downloading: dl.length > 0,
    progress: size ? Math.round(((size - left) / size) * 100) : null,
    eta: dl.map((x) => x.estimatedCompletionTime).filter(Boolean).sort()[0] || null,
  };
}

export async function seerrStatus(type, tmdbId) {
  return cached(`st:${type}:${tmdbId}`, 45000, async () => {
    const d = await seerr(`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`);
    return mediaState(d && d.mediaInfo);
  });
}

export async function seerrRequest(type, tmdbId, { userId = null, seasons = null, is4k = false } = {}) {
  let body;
  if (type === 'movie') body = { mediaType: 'movie', mediaId: Number(tmdbId) };
  else {
    let list = seasons;
    if (!list) {
      const d = await seerr(`/tv/${tmdbId}`);
      list = (d.seasons || []).map((s) => s.seasonNumber).filter((n) => n > 0);
    }
    body = { mediaType: 'tv', mediaId: Number(tmdbId), seasons: list.length ? list : 'all' };
  }
  // La demande est faite au nom de l'utilisateur Seerr relié au profil (quotas, historique)
  if (userId) body.userId = Number(userId);
  if (is4k) body.is4k = true;
  await seerr('/request', { method: 'POST', body });
  cache.delete(`st:${type}:${tmdbId}`);
  return seerrStatus(type, tmdbId);
}

// ------------------------------------------------------------------ titres déjà dans la bibliothèque
export function libraryIndex() {
  const byTmdb = new Map(), byName = new Map();
  for (const r of all("SELECT id, type, tmdb_id, title, original_title, anilist_id FROM items WHERE type IN ('movie','show')")) {
    if (r.tmdb_id) byTmdb.set(`${r.type === 'movie' ? 'movie' : 'tv'}:${r.tmdb_id}`, r.id);
    if (r.anilist_id) byTmdb.set(`al:${r.anilist_id}`, r.id);
    for (const t of [r.title, r.original_title]) if (t) byName.set(t.toLowerCase(), r.id);
  }
  return { byTmdb, byName };
}

// ------------------------------------------------------------------ listes
const fromTmdb = (x, type) => ({
  key: `${type}:${x.id}`, source: 'tmdb', type, tmdbId: x.id,
  title: x.title || x.name || '', original: x.original_title || x.original_name || '',
  overview: x.overview || '', date: x.release_date || x.first_air_date || null,
  poster: x.poster_path ? `${TMDB_IMG}/w342${x.poster_path}` : null,
  backdrop: x.backdrop_path ? `${TMDB_IMG}/w1280${x.backdrop_path}` : null,
  score: x.vote_count > 3 ? Math.round(x.vote_average * 10) : null,
  anime: x.original_language === 'ja' && (x.genre_ids || []).includes(16),
});

async function tmdbList(path, type, params = {}) {
  if (tmdbKey()) {
    const d = await tmdb(path, { language: lang(), region: lang().split('-')[1] || 'FR', ...params });
    return (d.results || []).map((x) => fromTmdb(x, type));
  }
  // Pas de clé TMDB : Seerr sait parcourir TMDB lui-même
  const map = { '/movie/now_playing': '/discover/movies', '/movie/upcoming': '/discover/movies/upcoming', '/trending/movie/week': '/discover/trending',
    '/tv/on_the_air': '/discover/tv', '/trending/tv/week': '/discover/trending', '/tv/airing_today': '/discover/tv/upcoming' };
  if (!seerrOn() || !map[path]) return [];
  const d = await seerr(`${map[path]}?page=1&language=${lang().split('-')[0]}`);
  return (d.results || []).filter((x) => !x.mediaType || x.mediaType === type).map((x) => ({
    ...fromTmdb({ ...x, poster_path: x.posterPath, backdrop_path: x.backdropPath, vote_average: x.voteAverage, vote_count: x.voteCount, release_date: x.releaseDate, first_air_date: x.firstAirDate, original_language: x.originalLanguage, genre_ids: x.genreIds }, type),
    seerr: mediaState(x.mediaInfo),
  }));
}

const SEASON = (d = new Date()) => ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][d.getMonth()];
function nextSeason(d = new Date()) {
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const s = SEASON(d), i = order.indexOf(s);
  let y = d.getFullYear(); if (d.getMonth() === 11) y += 1;
  return i === 3 ? { season: 'WINTER', year: y + (d.getMonth() === 11 ? 0 : 1) } : { season: order[i + 1], year: y };
}
const ANIME_LIST = `query ($season: MediaSeason, $year: Int, $sort: [MediaSort], $status: MediaStatus) { Page(perPage: 24) {
  media(type: ANIME, season: $season, seasonYear: $year, sort: $sort, status: $status, isAdult: false, format_in: [TV, TV_SHORT, MOVIE, ONA]) {
    id idMal format averageScore popularity siteUrl episodes nextAiringEpisode { episode airingAt }
    title { romaji english native } description(asHtml: false) startDate { year month day }
    coverImage { extraLarge large } bannerImage trailer { id site } } } }`;
const fromAnilist = (m) => ({
  key: `al:${m.id}`, source: 'anilist', type: m.format === 'MOVIE' ? 'movie' : 'tv', anilistId: m.id, tmdbId: null, anime: true,
  title: m.title.english || m.title.romaji, original: m.title.romaji || m.title.native || '',
  overview: String(m.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  date: m.startDate && m.startDate.year ? [m.startDate.year, m.startDate.month, m.startDate.day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, '0') : n)).join('-') : null,
  poster: m.coverImage && (m.coverImage.extraLarge || m.coverImage.large), backdrop: m.bannerImage || null,
  score: m.averageScore || null, url: m.siteUrl,
  next: m.nextAiringEpisode ? { episode: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
  trailer: m.trailer && m.trailer.site === 'youtube' ? { site: 'youtube', key: m.trailer.id } : null,
});
async function animeList(vars) {
  const d = await anilist(ANIME_LIST, vars);
  return ((d && d.Page && d.Page.media) || []).map(fromAnilist);
}

export async function discover(kind) {
  const sections = await cached(`disc:${kind}:${tmdbKey() ? 1 : 0}:${seerrOn() ? 1 : 0}`, 3600000, async () => {
    const safe = async (title, fn) => { try { return { title, items: await fn() }; } catch (e) { return { title, items: [], error: e.message }; } };
    if (kind === 'movie') {
      return Promise.all([
        safe('Au cinéma en ce moment', () => tmdbList('/movie/now_playing', 'movie')),
        safe('Bientôt au cinéma', () => tmdbList('/movie/upcoming', 'movie')),
        safe('Tendances de la semaine', () => tmdbList('/trending/movie/week', 'movie')),
      ]);
    }
    if (kind === 'show') {
      return Promise.all([
        safe('Nouveaux épisodes cette semaine', () => tmdbList('/tv/on_the_air', 'tv')),
        safe('Diffusés aujourd’hui', () => tmdbList('/tv/airing_today', 'tv')),
        safe('Tendances de la semaine', () => tmdbList('/trending/tv/week', 'tv')),
      ]);
    }
    const now = new Date(), ns = nextSeason(now);
    return Promise.all([
      safe('Cette saison', () => animeList({ season: SEASON(now), year: now.getFullYear() + (now.getMonth() === 11 ? 1 : 0), sort: ['POPULARITY_DESC'] })),
      safe('En diffusion, les plus suivis', () => animeList({ status: 'RELEASING', sort: ['TRENDING_DESC'] })),
      safe('La saison prochaine', () => animeList({ season: ns.season, year: ns.year, sort: ['POPULARITY_DESC'] })),
    ]);
  });
  // Sites injoignables : on ne garde pas l'échec en mémoire, on réessaiera à la prochaine visite
  if (sections.every((x) => x.error || !x.items.length)) cache.delete(`disc:${kind}:${tmdbKey() ? 1 : 0}:${seerrOn() ? 1 : 0}`);
  // Ce qui est déjà dans la bibliothèque (calculé à chaque fois : la bibliothèque bouge)
  const idx = libraryIndex();
  return sections.map((s) => ({
    ...s,
    items: s.items.map((x) => ({
      ...x,
      inLibrary: idx.byTmdb.get(x.key) || (x.anilistId && idx.byTmdb.get(`al:${x.anilistId}`)) || idx.byName.get(String(x.title).toLowerCase()) || idx.byName.get(String(x.original).toLowerCase()) || null,
    })),
  }));
}

// Animé AniList → fiche TMDB (nécessaire pour Seerr)
export async function resolveTmdb(item) {
  if (item.tmdbId) return item.tmdbId;
  return cached(`res:${item.anilistId}`, 86400000, async () => {
    for (const q of [item.title, item.original].filter(Boolean)) {
      if (tmdbKey()) {
        const d = await tmdb(`/search/${item.type === 'movie' ? 'movie' : 'tv'}`, { query: q });
        const hit = (d.results || []).find((x) => (x.genre_ids || []).includes(16)) || (d.results || [])[0];
        if (hit) return hit.id;
      } else if (seerrOn()) {
        const d = await seerr(`/search?query=${encodeURIComponent(q)}&page=1`);
        const hit = (d.results || []).find((x) => x.mediaType === (item.type === 'movie' ? 'movie' : 'tv'));
        if (hit) return hit.id;
      }
    }
    return null;
  });
}

export async function trailerFor(type, tmdbId) {
  if (!tmdbKey()) return null;
  return cached(`tr:${type}:${tmdbId}`, 86400000, async () => {
    const d = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}/videos`, { include_video_language: `${lang().split('-')[0]},en,null` });
    return pickTrailer(d.results);
  });
}

export function discoverAvailable() {
  return { tmdb: !!tmdbKey(), seerr: seerrOn(), anime: true };
}
export const libraryItem = (id) => get('SELECT id FROM items WHERE id = ?', id);

// ------------------------------------------------------------------ recherche en ligne (titres pas encore dans Venus)
export async function searchOnline(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  return cached(`search:${q.toLowerCase()}`, 600000, async () => {
    let list = [];
    if (tmdbKey()) {
      const d = await tmdb('/search/multi', { query: q, language: lang(), include_adult: 'false' });
      list = (d.results || []).filter((x) => (x.media_type === 'movie' || x.media_type === 'tv') && (x.poster_path || x.backdrop_path)).map((x) => fromTmdb(x, x.media_type));
    } else if (seerrOn()) {
      const d = await seerr(`/search?query=${encodeURIComponent(q)}&page=1&language=${lang().split('-')[0]}`);
      list = (d.results || []).filter((x) => x.mediaType === 'movie' || x.mediaType === 'tv').map((x) => ({
        ...fromTmdb({ ...x, poster_path: x.posterPath, backdrop_path: x.backdropPath, vote_average: x.voteAverage, vote_count: x.voteCount, release_date: x.releaseDate, first_air_date: x.firstAirDate, original_language: x.originalLanguage, genre_ids: x.genreIds }, x.mediaType),
        seerr: mediaState(x.mediaInfo),
      }));
    }
    const lib = libraryIndex();
    return list.slice(0, 20).map((x) => ({ ...x, inLibrary: lib.byTmdb.get(`${x.type}:${x.tmdbId}`) || null }));
  });
}
