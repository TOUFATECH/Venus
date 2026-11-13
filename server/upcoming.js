// « À venir » (Films, Séries, Animés) : ce qui sort ou se diffuse autour d'aujourd'hui, jour par jour,
// que ce soit déjà sur le NAS ou pas. Chaque titre absent peut être mis en favori (il est alors demandé à
// Radarr / Sonarr, qui le téléchargent dès sa sortie) ou téléchargé directement.
//
// Sources, toutes gratuites et sans clé :
//  - séries : les épisodes du NAS, le guide TVmaze des séries du NAS, le calendrier de Sonarr,
//    et le programme TVmaze (États-Unis, France, plateformes de streaming) pour les autres séries ;
//  - animés : la même chose, et le programme de diffusion d'AniList pour les animés de la saison ;
//  - films : le calendrier et les suggestions de Radarr (tendances, populaires), et TMDB si une clé est donnée.
import { db, all, get, run } from './db.js';
import { getJson, CINEMETA } from './posters.js';
import { traktId, traktGet } from './trakt.js';
import { anilist } from './ratings.js';
import { tmdb, tmdbKey, lang } from './metadata.js';
import { arrOn, call as arrCall, arrKnown, arrGrab, arrRemove } from './arr.js';
import { logActivity } from './activity.js';
import { notify } from './notify.js';
import { acquireOn, fromWish, addWant, cancelFor, kickSearch, wantById, searchWant } from './acquire/engine.js';

const TVMAZE = process.env.VENUS_TVMAZE_API || 'https://api.tvmaze.com';
const DAY = 864e5;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const safe = async (fn, fallback = []) => { try { return await fn(); } catch (e) { console.warn('[à venir]', e.message); return fallback; } };

// ------------------------------------------------------------------ favoris des titres pas encore sur le NAS
db.exec(`CREATE TABLE IF NOT EXISTS wanted (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,                 -- tmdb:123 (film), tvdb:456 (série), al:789 (animé AniList), name:titre
  kind TEXT NOT NULL,                -- movie | show | anime
  title TEXT, year INTEGER, poster TEXT, image TEXT, date TEXT,
  tmdb_id INTEGER, tvdb_id INTEGER, anilist_id INTEGER,
  added_at INTEGER, sent_at INTEGER, error TEXT,
  PRIMARY KEY (profile_id, key)
)`);
try { db.exec('ALTER TABLE wanted ADD COLUMN notified_at INTEGER'); } catch { /* déjà là */ }
// venus_added = 1 : Venus l'a ajouté à Radarr / Sonarr (rien sur le NAS avant) → retiré des favoris, il est supprimé
for (const c of ['venus_added INTEGER', 'arr_id INTEGER', 'arr_app TEXT']) { try { db.exec(`ALTER TABLE wanted ADD COLUMN ${c}`); } catch { /* déjà là */ } }
// Un favori est arrivé sur le NAS : notification (téléphone, application ouverte) à la personne qui l'a demandé
export async function wantedArrivals() {
  const lib = libIndex();
  const byImdb = new Map(all("SELECT id, imdb_id FROM items WHERE imdb_id IS NOT NULL AND type IN ('movie','show')").map((r) => [r.imdb_id, r.id]));
  let n = 0;
  for (const w of all('SELECT * FROM wanted WHERE notified_at IS NULL')) {
    const id = (/^imdb:/.test(w.key) && byImdb.get(w.key.slice(5))) || (w.kind === 'movie' ? lib.movie : lib.show).get(norm(w.title));
    if (!id) continue;
    run('UPDATE wanted SET notified_at = ? WHERE profile_id = ? AND key = ?', Date.now(), w.profile_id, w.key);
    await notify({ title: 'Votre favori est arrivé', body: `« ${w.title} » est maintenant sur le NAS`, url: `/titre/${id}`, tag: `wanted-${id}` }, { profileId: w.profile_id }).catch(() => {});
    n++;
  }
  return n ? `${n} favori(s) arrivé(s), notification envoyée` : 'Aucun nouveau favori arrivé';
}

export const wantedKeys = (profileId) => new Set(all('SELECT key FROM wanted WHERE profile_id = ?', profileId).map((r) => r.key));
export function wantedOf(profileId) {
  const lib = libIndex();
  return all('SELECT * FROM wanted WHERE profile_id = ? ORDER BY added_at DESC', profileId).map((r) => ({
    key: r.key, kind: r.kind, title: r.title, year: r.year, poster: r.poster, image: r.image, date: r.date,
    tmdb: r.tmdb_id, tvdb: r.tvdb_id, anilist: r.anilist_id, added: r.added_at, sent: r.sent_at, error: r.error, venusAdded: !!r.venus_added,
    nas: (r.kind === 'movie' ? lib.movie : lib.show).get(norm(r.title)) || null,
  }));
}
const appOf = (kind) => (kind === 'movie' ? 'radarr' : 'sonarr');
// Le numéro TMDB d'un titre de « À venir » (séries TVmaze / animés AniList n'en ont pas toujours) : TMDB, par le titre
async function tmdbOf(w) {
  if (w.tmdb) return Number(w.tmdb);
  if (!tmdbKey()) return null;
  const type = w.kind === 'movie' ? 'movie' : 'tv';
  if (w.tvdb) { const d = await tmdb(`/find/${w.tvdb}`, { external_source: 'tvdb_id' }).catch(() => null); const hit = d?.tv_results?.[0]; if (hit) return hit.id; }
  if (/^imdb:/.test(w.key)) { const d = await tmdb(`/find/${w.key.slice(5)}`, { external_source: 'imdb_id' }).catch(() => null); const hit = (type === 'movie' ? d?.movie_results : d?.tv_results)?.[0]; if (hit) return hit.id; }
  const d = await tmdb(`/search/${type}`, { query: w.title, ...(w.year ? { [type === 'movie' ? 'year' : 'first_air_date_year']: w.year } : {}) }).catch(() => null);
  const res = d?.results || [];
  return (w.kind === 'anime' ? res.find((x) => (x.genre_ids || []).includes(16)) : null)?.id ?? res[0]?.id ?? null;
}
/** Médias automatiques de Venus allumés : le titre passe directement au moteur (recherche, filtre, téléchargement). */
async function sendNative(profile, w, { now = false } = {}) {
  const tmdbId = await tmdbOf(w);
  const type = w.kind === 'movie' ? 'movie' : 'tv';
  let r;
  if (tmdbId) {
    run('UPDATE wanted SET tmdb_id = ? WHERE key = ? AND tmdb_id IS NULL', tmdbId, w.key);
    r = await fromWish(profile, { type, title: w.title, tmdbId, date: w.date, anime: w.kind === 'anime' });
  } else if (w.kind === 'movie') {
    r = { state: 'processing', id: addWant({ kind: 'movie', title: w.title, year: w.year, date: w.date, profileId: profile.id }) };
  } else throw new Error('Série introuvable dans TMDB (clé TMDB manquante ?) : le moteur de Venus ne peut pas lister ses épisodes');
  if (r.state === 'kids') return null;
  run('UPDATE wanted SET sent_at = ?, error = NULL, venus_added = 1, arr_app = ? WHERE key = ?', Date.now(), 'venus', w.key);
  logActivity('request', `${profile.name} a demandé « ${w.title} » (médias automatiques de Venus)`);
  // « Télécharger » : un film est cherché tout de suite ; sinon la recherche part dans quelques secondes, par lots
  if (now && type === 'movie' && tmdbId) { const id = get('SELECT id FROM media_wants WHERE show_key = ?', `movie:${tmdbId}`)?.id; if (id) return { ...r, title: w.title, search: await searchWant(wantById(id)).catch((e) => ({ ok: false, why: e.message })) }; }
  kickSearch();
  return { ...r, title: w.title, engine: 'venus' };
}
// Envoi au moteur de Venus, sinon à Radarr / Sonarr (profils adultes seulement)
async function send(profile, w) {
  if (profile.max_age != null) return null;
  if (acquireOn()) {
    try { return await sendNative(profile, w); } catch (e) { run('UPDATE wanted SET error = ? WHERE profile_id = ? AND key = ?', String(e.message).slice(0, 200), profile.id, w.key); return { error: e.message }; }
  }
  if (!arrOn(appOf(w.kind))) return null;
  try {
    const r = await arrGrab({ kind: w.kind, tmdb: w.tmdb, tvdb: w.tvdb, imdb: /^imdb:/.test(w.key) ? w.key.slice(5) : null, title: w.title, year: w.year });
    run('UPDATE wanted SET sent_at = ?, error = NULL WHERE profile_id = ? AND key = ?', Date.now(), profile.id, w.key);
    // Ajouté par Venus (pas déjà suivi par Radarr / Sonarr) : on le note pour pouvoir le retirer plus tard
    if (r && r.added && r.arrId) run('UPDATE wanted SET venus_added = 1, arr_id = ?, arr_app = ? WHERE key = ?', r.arrId, appOf(w.kind), w.key);
    logActivity('request', `${profile.name} a demandé « ${r.title} »${r.already ? ' (déjà demandé)' : ''}`);
    return r;
  } catch (e) {
    run('UPDATE wanted SET error = ? WHERE profile_id = ? AND key = ?', String(e.message).slice(0, 200), profile.id, w.key);
    return { error: e.message };
  }
}
export async function addWanted(profile, w, { download = true } = {}) {
  run(`INSERT INTO wanted(profile_id, key, kind, title, year, poster, image, date, tmdb_id, tvdb_id, anilist_id, added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, key) DO UPDATE SET title = excluded.title, poster = COALESCE(excluded.poster, poster), image = COALESCE(excluded.image, image), date = COALESCE(excluded.date, date)`,
  profile.id, w.key, w.kind, String(w.title || '').slice(0, 300), w.year || null, w.poster || null, w.image || null, w.date || null, w.tmdb || null, w.tvdb || null, w.anilist || null, Date.now());
  // Déjà sur le NAS (au moins un épisode, ou le film) : le favori ne télécharge rien et ne supprimera rien
  const lib = libIndex();
  const onNas = (w.kind === 'movie' ? (w.tmdb && lib.tmdbMovie.get(Number(w.tmdb))) || lib.movie.get(norm(w.title)) : lib.show.get(norm(w.title))) || null;
  // Un autre profil l'a déjà fait ajouter par Venus : même suivi
  const other = get('SELECT venus_added, arr_id, arr_app FROM wanted WHERE key = ? AND venus_added = 1 LIMIT 1', w.key);
  if (other) run('UPDATE wanted SET venus_added = 1, arr_id = ?, arr_app = ? WHERE profile_id = ? AND key = ?', other.arr_id, other.arr_app, profile.id, w.key);
  const sent = download && !onNas && !other ? await send(profile, w) : null;
  return { wanted: true, sent, nas: !!onNas };
}
// Retiré des favoris : si Venus l'avait fait télécharger (rien sur le NAS avant) et que plus personne ne l'a en
// favori, Radarr / Sonarr l'oublient : téléchargements en cours annulés et fichiers supprimés du NAS.
export async function removeWanted(profileId, key) {
  const row = get('SELECT * FROM wanted WHERE profile_id = ? AND key = ?', profileId, key);
  run('DELETE FROM wanted WHERE profile_id = ? AND key = ?', profileId, key);
  // Moteur de Venus : plus personne ne le veut (ni dans « À venir », ni en ♡) → recherches arrêtées, téléchargements annulés
  if (row && row.arr_app === 'venus' && !get('SELECT 1 FROM wanted WHERE key = ?', key)) {
    const t = row.kind === 'movie' ? 'movie' : 'tv';
    if (!row.tmdb_id) return { wanted: false, removed: false, cancelled: row.kind === 'movie' ? await cancelFor(`movie:${row.title}`).catch(() => null) : null };
    if (get('SELECT 1 FROM wishlist WHERE media_type = ? AND tmdb_id = ?', t, row.tmdb_id)) return { wanted: false, removed: false };
    return { wanted: false, removed: false, cancelled: await cancelFor(`${t}:${row.tmdb_id}`).catch(() => null) };
  }
  if (!row || !row.venus_added || !row.arr_id || get('SELECT 1 FROM wanted WHERE key = ?', key)) return { wanted: false, removed: false };
  try {
    const removed = await arrRemove(row.arr_app || appOf(row.kind), row.arr_id);
    if (removed) logActivity('request', `« ${row.title} » retiré des favoris : supprimé de ${row.arr_app === 'radarr' ? 'Radarr' : 'Sonarr'} et du NAS`);
    return { wanted: false, removed };
  } catch (e) { return { wanted: false, removed: false, error: e.message }; }
}
export async function grab(profile, w) {
  if (acquireOn()) {
    if (profile.max_age != null) throw Object.assign(new Error('Un profil enfant ne lance pas de téléchargement'), { status: 403 });
    return sendNative(profile, w, { now: true });
  }
  if (!arrOn(appOf(w.kind))) throw Object.assign(new Error(`${w.kind === 'movie' ? 'Radarr' : 'Sonarr'} n’est pas relié (Réglages → Demandes)`), { status: 400 });
  const r = await arrGrab({ kind: w.kind, tmdb: w.tmdb, tvdb: w.tvdb, imdb: /^imdb:/.test(w.key) ? w.key.slice(5) : null, title: w.title, year: w.year });
  logActivity('request', `${profile.name} a demandé « ${r.title} »${r.already ? ' (déjà demandé)' : ''}`);
  return r;
}

// ------------------------------------------------------------------ ce qui est sur le NAS
function libIndex() {
  const movie = new Map(), show = new Map(), anime = new Map(), tmdbMovie = new Map();
  for (const r of all("SELECT id, type, title, original_title, category, tmdb_id FROM items WHERE type IN ('movie','show')")) {
    const m = r.type === 'movie' ? movie : show;
    for (const t of [r.title, r.original_title]) if (t) { m.set(norm(t), r.id); if (r.category === 'anime') anime.set(norm(t), r.id); }
    if (r.type === 'movie' && r.tmdb_id) tmdbMovie.set(r.tmdb_id, r.id);
  }
  return { movie, show, anime, tmdbMovie };
}
const pick = (images, type) => ((images || []).find((i) => i.coverType === type) || {}).remoteUrl || null;

// ------------------------------------------------------------------ séries et animés
async function tvmazeDay(date) {
  return cached(`tvm:${date}`, 6 * 3600e3, async () => {
    const lists = await Promise.all([`${TVMAZE}/schedule?country=US&date=${date}`, `${TVMAZE}/schedule?country=FR&date=${date}`, `${TVMAZE}/schedule/web?date=${date}`]
      .map((u) => safe(() => getJson(u), [])));
    return lists.flat().filter(Boolean).map((e) => ({ ...e, show: e.show || (e._embedded && e._embedded.show) })).filter((e) => e.show);
  });
}
const ANIME_Q = `query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
  airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode airingAt
    media { id isAdult popularity format episodes countryOfOrigin title { romaji english } coverImage { extraLarge large } bannerImage description(asHtml: false) } } } }`;
async function anilistWeek(from, to) {
  return cached(`al:${iso(from)}:${iso(to)}`, 3 * 3600e3, async () => {
    const out = [];
    for (let page = 1; page <= 6; page++) {
      const d = await anilist(ANIME_Q, { from: Math.floor(from / 1000), to: Math.floor(to / 1000), page });
      const pg = d && d.Page;
      if (!pg) break;
      out.push(...pg.airingSchedules);
      if (!pg.pageInfo.hasNextPage) break;
    }
    return out;
  });
}

const isAnimeShow = (s) => (s.genres || []).includes('Anime') || (s.type === 'Animation' && (s.language === 'Japanese' || ((s.network || s.webChannel || {}).country || {}).code === 'JP'));

export async function upcomingShows(profile, kind, ageSql) {
  const now = Date.now();
  const from = now - 7 * DAY, to = now + 30 * DAY;
  const lib = libIndex();
  const libNames = kind === 'anime' ? lib.anime : lib.show;
  const known = await safe(() => arrKnown(), { series: new Set(), seriesNames: new Set() });
  const out = new Map(); // clé : série + épisode (évite les doublons entre les sources)
  const add = (e) => {
    const k = `${norm(e.show)}|${e.season ?? ''}|${e.episode}`;
    const prev = out.get(k);
    if (prev) { for (const f of ['image', 'poster', 'epId', 'nas', 'tvdb', 'anilist', 'at', 'epTitle', 'overview']) if (prev[f] == null && e[f] != null) prev[f] = e[f]; prev.arr = prev.arr || e.arr; return; }
    out.set(k, e);
  };
  const cat = kind === 'anime' ? "s.category = 'anime'" : "COALESCE(s.category, 'show') = 'show'";
  // 1. Épisodes arrivés sur le NAS ces derniers jours
  const pm = new Map(all('SELECT item_id, watched FROM progress WHERE profile_id = ?', profile.id).map((r) => [r.item_id, r]));
  for (const e of all(`SELECT e.id, e.show_id, e.season_num, e.episode_num, e.title, e.still, e.release_date, s.title AS show_title, s.backdrop, s.poster FROM items e JOIN items s ON s.id = e.show_id
      WHERE e.type = 'episode' AND e.release_date >= ? AND e.release_date <= ? AND ${cat} AND ${ageSql.sql} ORDER BY e.release_date DESC LIMIT 200`, iso(from), iso(to), ...ageSql.args)) {
    add({ date: e.release_date, show: e.show_title, season: e.season_num, episode: e.episode_num, epTitle: e.title, image: e.still || e.backdrop, poster: e.poster,
      nas: e.show_id, epId: e.id, seen: !!(pm.get(e.id) && pm.get(e.id).watched), kind, pop: 1e9 });
  }
  // 2. Prochains épisodes des séries du NAS (guide TVmaze gardé dans la fiche)
  const have = new Set(all(`SELECT e.show_id || ':' || e.season_num || ':' || e.episode_num AS k FROM items e JOIN items s ON s.id = e.show_id WHERE e.type = 'episode' AND ${cat}`).map((r) => r.k));
  for (const s of all(`SELECT s.id, s.title, s.backdrop, s.poster, s.guide_eps FROM items s WHERE s.type = 'show' AND s.guide_eps IS NOT NULL AND ${cat} AND ${ageSql.sql}`, ...ageSql.args)) {
    let g = []; try { g = JSON.parse(s.guide_eps); } catch { /* */ }
    for (const e of g) {
      if (!e.air || e.air < iso(from) || e.air > iso(to) || have.has(`${s.id}:${e.s}:${e.n}`)) continue;
      add({ date: e.air, show: s.title, season: e.s, episode: e.n, epTitle: e.title, image: e.still || s.backdrop, poster: s.poster, nas: s.id, epId: null, kind, pop: 1e8 });
    }
  }
  // 3. Calendrier de Sonarr (séries suivies, qu'elles soient déjà sur le NAS ou pas)
  if (arrOn('sonarr')) {
    const cal = await safe(() => cached(`son:${iso(now)}`, 15 * 60e3, () => arrCall('sonarr', `/api/v3/calendar?start=${iso(from)}&end=${iso(to)}&includeSeries=true&unmonitored=true`)), []);
    for (const e of cal || []) {
      const sr = e.series || {};
      const anime = sr.seriesType === 'anime';
      if ((kind === 'anime') !== anime || !e.airDate) continue;
      add({ date: e.airDate, at: e.airDateUtc ? Date.parse(e.airDateUtc) : null, show: sr.title || e.title, season: e.seasonNumber, episode: e.episodeNumber, epTitle: e.title && !/^TBA$/i.test(e.title) ? e.title : null,
        image: pick(sr.images, 'fanart') || pick(e.images, 'screenshot'), poster: pick(sr.images, 'poster'), nas: libNames.get(norm(sr.title)) || null, tvdb: sr.tvdbId || null, arr: true, kind, year: sr.year, pop: 5e7, overview: strip(e.overview) });
    }
  }
  // 4a. Séries : programme TVmaze (hier → dans 7 jours)
  if (kind === 'show') {
    const days = []; for (let d = -1; d <= 7; d++) days.push(iso(now + d * DAY));
    const lists = [];
    for (let i = 0; i < days.length; i += 3) lists.push(...await Promise.all(days.slice(i, i + 3).map(tvmazeDay)));
    for (const e of lists.flat()) {
      const s = e.show;
      if (!['Scripted', 'Animation', 'Documentary'].includes(s.type) || isAnimeShow(s)) continue;
      const nas = libNames.get(norm(s.name)) || null;
      const tvdb = s.externals && s.externals.thetvdb;
      const arr = !!(tvdb && known.series.has(tvdb)) || known.seriesNames.has(norm(s.name));
      if (!nas && !arr && (s.weight || 0) < 80) continue; // seulement les séries suivies par beaucoup de monde
      add({ date: e.airdate, at: e.airstamp ? Date.parse(e.airstamp) : null, show: s.name, season: e.season, episode: e.number, epTitle: e.name && !/^(episode \d+|TBA)$/i.test(e.name) ? e.name : null,
        image: e.image ? e.image.original || e.image.medium : null, poster: s.image ? s.image.original || s.image.medium : null, nas, tvdb: tvdb || null, arr, kind,
        year: Number((s.premiered || '').slice(0, 4)) || null, pop: s.weight || 0, network: (s.network || s.webChannel || {}).name || null, overview: strip(s.summary), genres: s.genres || [] });
    }
  }
  // 4b. Animés : programme de diffusion AniList (hier → dans 7 jours)
  if (kind === 'anime') {
    const sched = await safe(() => anilistWeek(now - DAY, now + 7 * DAY), []);
    for (const a of sched) {
      const m = a.media;
      if (!m || m.isAdult || !['TV', 'TV_SHORT', 'ONA'].includes(m.format)) continue;
      const title = m.title.english || m.title.romaji;
      const nas = libNames.get(norm(title)) || libNames.get(norm(m.title.romaji)) || lib.show.get(norm(title)) || lib.show.get(norm(m.title.romaji)) || null;
      const arr = known.seriesNames.has(norm(title)) || known.seriesNames.has(norm(m.title.romaji));
      if (!nas && !arr && (m.popularity || 0) < 15000) continue;
      // Animés : numéro d'épisode continu ; on le rattache à l'épisode Sonarr ou NAS du même jour s'il existe
      const at = a.airingAt * 1000;
      const sameDay = [...out.values()].find((x) => (norm(x.show) === norm(title) || norm(x.show) === norm(m.title.romaji)) && x.date === iso(at));
      if (sameDay) { sameDay.image = sameDay.image || m.bannerImage; sameDay.anilist = m.id; sameDay.at = sameDay.at || at; continue; }
      add({ date: iso(at), at, show: title, season: null, episode: a.episode, epTitle: null, image: m.bannerImage || null, poster: m.coverImage && (m.coverImage.extraLarge || m.coverImage.large),
        nas, anilist: m.id, arr, kind, pop: m.popularity || 0, total: m.episodes || null, overview: strip(m.description).slice(0, 400) });
    }
  }
  // 5. Prochain épisode annoncé par TMDB (séries du NAS, si une clé TMDB est donnée)
  for (const s of all(`SELECT s.id, s.title, s.backdrop, s.poster, s.credits FROM items s WHERE s.type = 'show' AND s.credits IS NOT NULL AND ${cat} AND ${ageSql.sql}`, ...ageSql.args)) {
    let cr = {}; try { cr = JSON.parse(s.credits); } catch { /* */ }
    const n = cr.nextEpisode;
    if (!n || !n.date || n.date < iso(from) || n.date > iso(to) || have.has(`${s.id}:${n.season}:${n.episode}`)) continue;
    add({ date: n.date, show: s.title, season: n.season, episode: n.episode, epTitle: n.title || null, image: s.backdrop, poster: s.poster, nas: s.id, kind, pop: 1e8 });
  }
  const entries = [...out.values()].map((e) => ({ ...e, key: e.tvdb ? `tvdb:${e.tvdb}` : e.anilist ? `al:${e.anilist}` : `name:${norm(e.show)}` }));
  return finish(profile, entries, kind);
}

// ------------------------------------------------------------------ films
const TMDB_IMG = 'https://image.tmdb.org/t/p';
export async function upcomingMovies(profile) {
  const now = Date.now();
  const from = now - 21 * DAY, to = now + 180 * DAY;
  const lib = libIndex();
  const known = await safe(() => arrKnown(), { movies: new Set() });
  const out = new Map();
  const add = (m) => {
    const k = m.tmdb ? `tmdb:${m.tmdb}` : `name:${norm(m.title)}`;
    const prev = out.get(k);
    if (prev) { for (const f of ['image', 'poster', 'overview', 'imdb']) if (!prev[f] && m[f]) prev[f] = m[f]; prev.arr = prev.arr || m.arr; prev.pop = Math.max(prev.pop || 0, m.pop || 0); return; }
    out.set(k, { ...m, key: k });
  };
  // La date qui compte : la prochaine sortie (cinéma, numérique, DVD) dans la période, sinon la plus récente
  const when = (m) => {
    const ev = [['digitalRelease', 'Sortie numérique'], ['physicalRelease', 'Sortie DVD / Blu-ray'], ['inCinemas', 'Au cinéma']]
      .map(([f, label]) => (m[f] ? { date: iso(Date.parse(m[f])), label } : null)).filter((x) => x && x.date >= iso(from) && x.date <= iso(to));
    ev.sort((a, b) => (a.date >= iso(now)) - (b.date >= iso(now)) || (a.date >= iso(now) ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    return ev.find((x) => x.date >= iso(now)) || ev[0] || null;
  };
  const nasOf = (m) => (m.tmdb && lib.tmdbMovie.get(m.tmdb)) || lib.movie.get(norm(m.title)) || null;
  if (arrOn('radarr')) {
    // Films suivis par Radarr (demandés, pas forcément sortis)
    const cal = await safe(() => cached(`rad:${iso(now)}`, 15 * 60e3, () => arrCall('radarr', `/api/v3/calendar?start=${iso(from)}&end=${iso(to)}&unmonitored=true`)), []);
    for (const m of cal || []) {
      const w = when(m); if (!w) continue;
      add({ date: w.date, release: w.label, title: m.title, year: m.year, tmdb: m.tmdbId, imdb: m.imdbId, image: pick(m.images, 'fanart'), poster: pick(m.images, 'poster') || m.remotePoster,
        overview: strip(m.overview), arr: true, pop: 5e7, genres: m.genres || [] });
    }
    // Suggestions de Radarr : tendances et films populaires (sa base TMDB, sans clé)
    const disc = await safe(() => cached('rad:disc', 6 * 3600e3, () => arrCall('radarr', '/api/v3/importlist/movie?includeRecommendations=true&includeTrending=true&includePopular=true')), []);
    for (const m of disc || []) {
      if (m.isExcluded) continue;
      const w = when(m); if (!w) continue;
      add({ date: w.date, release: w.label, title: m.title, year: m.year, tmdb: m.tmdbId, imdb: m.imdbId, image: pick(m.images, 'fanart'), poster: pick(m.images, 'poster') || m.remotePoster,
        overview: strip(m.overview), arr: !!m.isExisting || known.movies.has(m.tmdbId), pop: (m.isTrending ? 2000 : 0) + (m.isPopular ? 1000 : 0) + (m.popularity || (m.ratings && m.ratings.tmdb && m.ratings.tmdb.votes) || 0), genres: m.genres || [] });
    }
  }
  if (tmdbKey()) {
    const region = lang().split('-')[1] || 'FR';
    const lists = await Promise.all(['/movie/upcoming', '/movie/now_playing'].flatMap((p) => [1, 2].map((page) => safe(() => cached(`tmdb:${p}:${page}`, 6 * 3600e3, () => tmdb(p, { language: lang(), region, page })), {}))));
    for (const d of lists) for (const x of (d && d.results) || []) {
      if (!x.release_date || x.release_date < iso(from) || x.release_date > iso(to)) continue;
      add({ date: x.release_date, release: 'Au cinéma', title: x.title, year: Number(x.release_date.slice(0, 4)), tmdb: x.id, image: x.backdrop_path ? `${TMDB_IMG}/w780${x.backdrop_path}` : null,
        poster: x.poster_path ? `${TMDB_IMG}/w342${x.poster_path}` : null, overview: x.overview, arr: known.movies.has(x.id), pop: x.popularity || 0 });
    }
  }
  // Sans Radarr ni clé TMDB : Trakt (si son identifiant client est renseigné), puis Cinemeta (Stremio, sans clé)
  if (out.size < 12 && traktId()) {
    const fx = (d) => iso(d);
    const cal = await safe(() => cached(`trakt:cal:${iso(now)}`, 6 * 3600e3, () => traktGet(`/calendars/all/movies/${fx(now - 7 * DAY)}/33`, { extended: 'full,images' })), []);
    const ant = await safe(() => cached('trakt:anticipated', 12 * 3600e3, () => traktGet('/movies/anticipated', { extended: 'full,images', limit: 100 })), []);
    const imgOf = (a) => { const v = Array.isArray(a) ? a[0] : a; return v ? (/^https?:/.test(v) ? v : `https://${String(v).replace(/^\/+/, '')}`) : null; };
    for (const x of [...(cal || []), ...(ant || [])]) {
      const m = x.movie || x; const date = x.released || m.released;
      if (!m || !m.title || !date || date < iso(from) || date > iso(to)) continue;
      const im = m.images || {};
      add({ date, release: 'Sortie', title: m.title, year: m.year, tmdb: m.ids && m.ids.tmdb, imdb: m.ids && m.ids.imdb, image: imgOf(im.fanart), poster: imgOf(im.poster),
        overview: m.overview || null, arr: false, pop: (x.list_count || 0) + (m.votes || 0), genres: m.genres || [] });
    }
  }
  if (out.size < 12) for (const m of await safe(() => cinemetaUpcoming(from, to), [])) add(m);
  const entries = [...out.values()].map((m) => ({ ...m, kind: 'movie', nas: nasOf(m) }));
  return finish(profile, entries, 'movie');
}

// Films annoncés, d'après Cinemeta (catalogue public de Stremio, sans clé) : films de cette année et de la
// suivante, classés par popularité ; la date de sortie vient de leur fiche (gardée 24 h)
async function cinemetaUpcoming(from, to) {
  const years = [...new Set([new Date(from).getUTCFullYear(), new Date().getUTCFullYear(), new Date(to).getUTCFullYear()])];
  const metas = [];
  for (const y of years) for (const skip of [0, 100, 200]) {
    const d = await safe(() => cached(`cm:${y}:${skip}`, 12 * 3600e3, () => getJson(`${CINEMETA}/catalog/movie/year/genre=${y}${skip ? `&skip=${skip}` : ''}.json`)), null);
    const list = (d && d.metas) || [];
    metas.push(...list.map((m, i) => ({ ...m, rank: metas.length + i })));
    if (list.length < 50) break;
  }
  const seen = new Set();
  const todo = metas.filter((m) => m && m.id && /^tt\d+$/.test(m.id) && !seen.has(m.id) && seen.add(m.id));
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < Math.min(todo.length, 240)) {
      const m = todo[i++];
      let released = m.released;
      if (!released) {
        const full = await safe(() => cached(`cm:meta:${m.id}`, 24 * 3600e3, () => getJson(`${CINEMETA}/meta/movie/${m.id}.json`)), null);
        const fm = full && full.meta;
        if (fm) { released = fm.released; m.background = m.background || fm.background; m.description = m.description || fm.description; m.genres = m.genres || fm.genres; }
      }
      const date = released ? iso(Date.parse(released)) : null;
      if (!date || date < iso(from) || date > iso(to)) continue;
      out.push({ date, release: 'Sortie', title: m.name, year: Number(date.slice(0, 4)), imdb: m.id, image: m.background || null, poster: m.poster || null,
        overview: m.description || null, arr: false, pop: 1e5 - m.rank, genres: m.genres || [] });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ------------------------------------------------------------------ mise en forme commune
function finish(profile, all_, kind) {
  // Profils enfants : seulement ce qui est déjà sur le NAS (et autorisé pour leur âge)
  const entries = profile.max_age != null ? all_.filter((e) => e.nas) : all_;
  const wanted = wantedKeys(profile.id);
  const byVenus = new Set(all('SELECT key FROM wanted WHERE profile_id = ? AND venus_added = 1', profile.id).map((r) => r.key));
  for (const e of entries) { e.wanted = wanted.has(e.key); if (byVenus.has(e.key)) e.venusAdded = true; }
  entries.sort((a, b) => (a.at || Date.parse(`${a.date}T12:00:00Z`)) - (b.at || Date.parse(`${b.date}T12:00:00Z`)) || (b.pop || 0) - (a.pop || 0));
  // Propositions : les titres les plus suivis qui ne sont ni sur le NAS ni déjà demandés (un par titre)
  const seen = new Set();
  const suggestions = [];
  for (const e of [...entries].filter((x) => !x.nas && !x.arr).sort((a, b) => (b.pop || 0) - (a.pop || 0))) {
    const k = kind === 'movie' ? e.key : norm(e.show);
    if (seen.has(k)) continue;
    seen.add(k);
    suggestions.push(e);
    if (suggestions.length >= 24) break;
  }
  const app = appOf(kind);
  return { entries, suggestions, arr: arrOn(app), app: app === 'radarr' ? 'Radarr' : 'Sonarr', tmdb: !!tmdbKey(), kids: profile.max_age != null };
}

// Préparation en arrière-plan (au démarrage puis toutes les 6 h) : l'onglet « À venir » s'ouvre tout de suite
export async function warmUpcoming() {
  const now = Date.now();
  for (let d = -1; d <= 7; d++) await safe(() => tvmazeDay(iso(now + d * DAY)), []);
  await safe(() => anilistWeek(now - DAY, now + 7 * DAY), []);
}
