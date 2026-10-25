// Notes (TMDB, IMDb, Rotten Tomatoes, Metacritic, AniList, MyAnimeList, Simkl) et bandes-annonces.
//
// Sources :
//  - TMDB (clé facultative déjà utilisée pour les affiches) : note, identifiant IMDb, bande-annonce YouTube
//  - AniList (gratuit, sans clé) : note des animés, identifiant MyAnimeList, bande-annonce
//  - MyAnimeList, via Jikan (gratuit, sans clé)
//  - OMDb (clé gratuite) : notes IMDb, Rotten Tomatoes et Metacritic
//  - Simkl (identifiant client gratuit)
// SensCritique n'a pas d'API publique : l'interface propose un lien vers sa recherche.
//
// Tout est récupéré en arrière-plan, un titre à la fois, et rafraîchi tous les 10 jours.
import { all, get, run, getSetting } from './db.js';
import { tmdb, tmdbKey, lang } from './metadata.js';

const DAY = 86400000;
const UA = { 'User-Agent': 'Venus/1.0 (serveur multimédia personnel)', Accept: 'application/json' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export const omdbKey = () => getSetting('omdb_key', '') || process.env.OMDB_API_KEY || '';
export const simklId = () => getSetting('simkl_client_id', '') || process.env.SIMKL_CLIENT_ID || '';

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) { await wait(2500); return getJson(url, opts); }
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ bandes-annonces (YouTube)
export function pickTrailer(videos = []) {
  const yt = videos.filter((v) => v.site === 'YouTube' && v.key);
  const lng = lang().split('-')[0];
  const score = (v) => (v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 2 : 0) + (v.iso_639_1 === lng ? 3 : v.iso_639_1 === 'en' ? 1 : 0) + (v.official ? 1 : 0);
  const best = yt.filter((v) => ['Trailer', 'Teaser'].includes(v.type)).sort((a, b) => score(b) - score(a))[0];
  return best ? { site: 'youtube', key: best.key, name: best.name || '' } : null;
}

// ------------------------------------------------------------------ AniList (GraphQL, sans clé)
const ANILIST_Q = `query ($search: String) { Page(perPage: 6) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
  id idMal averageScore meanScore popularity siteUrl seasonYear format startDate { year }
  title { romaji english native } trailer { id site } } } }`;
export async function anilist(query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) { await wait(4000); return anilist(query, variables); }
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  return (await res.json()).data;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function findAnime(item) {
  for (const q of [item.original_title, item.title].filter(Boolean)) {
    const d = await anilist(ANILIST_Q, { search: q });
    const list = (d && d.Page && d.Page.media) || [];
    const wantMovie = item.type === 'movie';
    const fit = list.filter((m) => (wantMovie ? m.format === 'MOVIE' : m.format !== 'MOVIE'));
    const byYear = fit.find((m) => item.year && Math.abs((m.seasonYear || (m.startDate && m.startDate.year) || 0) - item.year) <= 1);
    const byName = fit.find((m) => [m.title.romaji, m.title.english, m.title.native].some((t) => norm(t) === norm(q)));
    const m = byYear || byName || (fit.length ? fit[0] : null);
    if (m) return m;
  }
  return null;
}

// ------------------------------------------------------------------ distribution, équipe, studios
// Photos : chemins TMDB, téléchargés à la demande par /img (nom « t_w185_… »)
const photo = (p) => (p ? `t_w185_${p.replace(/^\//, '').replace(/[^\w.]/g, '')}` : null);
const uniq = (a) => [...new Map(a.filter((x) => x && x.name).map((x) => [x.name, x])).values()];
export function creditsOf(d, kind) {
  const c = (kind === 'tv' ? d.aggregate_credits : d.credits) || d.credits || {};
  const cast = (c.cast || []).slice(0, 30).map((p) => ({
    name: p.name, role: p.character || (p.roles || []).map((r) => r.character).filter(Boolean).slice(0, 2).join(', ') || '',
    photo: photo(p.profile_path), eps: p.total_episode_count || undefined,
  }));
  const crew = c.crew || [];
  const jobs = (p) => p.job ? [p.job] : (p.jobs || []).map((j) => j.job);
  const by = (re) => uniq(crew.filter((p) => jobs(p).some((j) => re.test(j)))).slice(0, 6).map((p) => ({ name: p.name, photo: photo(p.profile_path) }));
  const kw = (d.keywords && (d.keywords.keywords || d.keywords.results)) || [];
  return {
    cast,
    directors: by(/^Director$/),
    writers: by(/^(Screenplay|Writer|Story|Novel|Original Story|Author|Original Concept)$/),
    creators: (d.created_by || []).map((p) => ({ name: p.name, photo: photo(p.profile_path) })),
    composers: by(/^(Original Music Composer|Music)$/).slice(0, 2),
    studios: (d.production_companies || []).map((x) => x.name).slice(0, 6),
    networks: (d.networks || []).map((x) => x.name).slice(0, 4),
    countries: (d.production_countries || []).map((x) => x.iso_3166_1),
    tags: kw.map((k) => k.name).slice(0, 12),
    status: d.status || null,
    nextEpisode: d.next_episode_to_air ? { date: d.next_episode_to_air.air_date, season: d.next_episode_to_air.season_number, episode: d.next_episode_to_air.episode_number, title: d.next_episode_to_air.name } : null,
    budget: d.budget || null, revenue: d.revenue || null,
  };
}

// ------------------------------------------------------------------ collecte pour un titre
const isAnime = (item, d) => item.category === 'anime' || !!(d && d.original_language === 'ja' && (d.genres || []).some((g) => g.id === 16));

export async function enrich(item) {
  const r = {};
  let trailer = parseJson(item.trailer, null);
  let imdb = item.imdb_id || null, anilistId = item.anilist_id || null, malId = item.mal_id || null;
  let ok = false, d = null, credits = null;
  const kind = item.type === 'movie' ? 'movie' : 'tv';

  if (tmdbKey() && item.tmdb_id) {
    try {
      d = await tmdb(`/${kind}/${item.tmdb_id}`, { language: lang(), append_to_response: `videos,external_ids,keywords,${kind === 'tv' ? 'aggregate_credits' : 'credits'}`, include_video_language: `${lang().split('-')[0]},en,null` });
      ok = true;
      credits = creditsOf(d, kind);
      if (d.vote_count > 0) r.tmdb = { v: Math.round(d.vote_average * 10) / 10, max: 10, votes: d.vote_count, url: `https://www.themoviedb.org/${kind}/${item.tmdb_id}` };
      imdb = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || imdb;
      trailer = pickTrailer(d.videos && d.videos.results) || trailer;
    } catch { /* TMDB injoignable : on garde le reste */ }
  }

  if (isAnime(item, d)) {
    try {
      const m = anilistId ? null : await findAnime(item);
      if (m) { anilistId = m.id; malId = m.idMal || malId; if (!trailer && m.trailer && m.trailer.site === 'youtube') trailer = { site: 'youtube', key: m.trailer.id, name: '' }; }
      if (anilistId) {
        const one = m || (await anilist('query ($id: Int) { Media(id: $id) { id idMal averageScore meanScore siteUrl trailer { id site } } }', { id: anilistId })).Media;
        const sc = one.averageScore || one.meanScore;
        if (sc) r.anilist = { v: sc, max: 100, url: one.siteUrl || `https://anilist.co/anime/${anilistId}` };
        malId = one.idMal || malId;
        ok = true;
      }
    } catch { /* */ }
    if (malId) {
      try {
        await wait(400); // Jikan : 3 requêtes par seconde au plus
        const j = (await getJson(`https://api.jikan.moe/v4/anime/${malId}`)).data;
        if (j && j.score) r.mal = { v: j.score, max: 10, votes: j.scored_by || null, url: j.url || `https://myanimelist.net/anime/${malId}` };
        ok = true;
      } catch { /* */ }
    }
  }

  const ok_ = omdbKey();
  if (ok_ && (imdb || !tmdbKey())) {
    try {
      const u = new URL('https://www.omdbapi.com/');
      u.searchParams.set('apikey', ok_);
      if (imdb) u.searchParams.set('i', imdb);
      else { u.searchParams.set('t', item.original_title || item.title); if (item.year) u.searchParams.set('y', item.year); u.searchParams.set('type', item.type === 'movie' ? 'movie' : 'series'); }
      const o = await getJson(u);
      if (o.Response !== 'False') {
        ok = true;
        imdb = imdb || o.imdbID || null;
        const iv = parseFloat(o.imdbRating);
        if (iv) r.imdb = { v: iv, max: 10, votes: Number(String(o.imdbVotes || '').replace(/\D/g, '')) || null, url: `https://www.imdb.com/fr/title/${imdb}/` };
        for (const x of o.Ratings || []) {
          if (x.Source === 'Rotten Tomatoes') r.rt = { v: parseInt(x.Value, 10), max: 100, url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(item.original_title || item.title)}` };
          if (x.Source === 'Metacritic') r.mc = { v: parseInt(x.Value, 10), max: 100, url: `https://www.metacritic.com/search/${encodeURIComponent(item.original_title || item.title)}/` };
        }
      }
    } catch { /* */ }
  }

  if (simklId() && imdb) {
    try {
      const u = new URL('https://api.simkl.com/ratings');
      u.searchParams.set('imdb', imdb); u.searchParams.set('fields', 'simkl,ext'); u.searchParams.set('client_id', simklId());
      const s = await getJson(u);
      const sk = s && (s.simkl || (Array.isArray(s) && s[0] && s[0].simkl));
      if (sk && sk.rating) r.simkl = { v: sk.rating, max: 10, votes: sk.votes || null, url: s.link ? (String(s.link).startsWith('http') ? s.link : `https://simkl.com${s.link}`) : 'https://simkl.com' };
      const mal = s && (s.MAL || s.mal);
      if (!r.mal && mal && mal.rating) r.mal = { v: mal.rating, max: 10, votes: mal.votes || null, url: malId ? `https://myanimelist.net/anime/${malId}` : 'https://myanimelist.net' };
      if (!r.imdb && s && (s.IMDB || s.imdb) && (s.IMDB || s.imdb).rating) { const x = s.IMDB || s.imdb; r.imdb = { v: x.rating, max: 10, votes: x.votes || null, url: `https://www.imdb.com/fr/title/${imdb}/` }; }
      ok = true;
    } catch { /* */ }
  }

  // Sans TMDB : la note déjà connue (fichier .nfo, ancienne analyse) reste affichée
  if (!r.tmdb && item.vote) r.tmdb = { v: Math.round(item.vote * 10) / 10, max: 10, url: item.tmdb_id ? `https://www.themoviedb.org/${kind}/${item.tmdb_id}` : null };
  const vals = Object.values(r).map((x) => (x.v / x.max) * 100).filter((x) => x > 0);
  r.score = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

  run('UPDATE items SET ratings=?, ratings_at=?, imdb_id=?, anilist_id=?, mal_id=?, trailer=?, credits=COALESCE(?, credits) WHERE id=?',
    JSON.stringify(r), ok || Object.keys(r).filter((k) => k !== 'score').length > 1 ? Date.now() : null, imdb, anilistId, malId, trailer ? JSON.stringify(trailer) : null,
    credits ? JSON.stringify(credits) : null, item.id);
  return r;
}

// ------------------------------------------------------------------ file d'attente
const queue = [];
let busy = false;
export const ratingsPending = () => queue.length + (busy ? 1 : 0);
export function scheduleRatings(ids, urgent = false) {
  for (const id of ids) if (!queue.includes(id)) (urgent ? queue.unshift(id) : queue.push(id));
  pump();
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const it = get('SELECT * FROM items WHERE id = ?', queue.shift());
    if (!it) continue;
    try { await enrich(it); } catch (e) { console.warn('[notes]', it.title, e.message); }
    await wait(350);
  }
  busy = false;
}
// Titres jamais notés, ou notés il y a plus de 10 jours
export function refreshRatings({ force = false } = {}) {
  const rows = all(`SELECT id FROM items WHERE type IN ('movie','show') AND (? OR ratings_at IS NULL OR ratings_at < ?)
    ORDER BY ratings_at IS NOT NULL, added_at DESC`, force ? 1 : 0, Date.now() - 10 * DAY);
  scheduleRatings(rows.map((r) => r.id));
  return rows.length;
}
