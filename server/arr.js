// Radarr (films) et Sonarr (séries et animés) : depuis l'onglet « Nouveau », on cherche un titre et on clique
// « Ajouter » ; Venus l'ajoute directement dans Radarr ou Sonarr, qui le téléchargent tout seuls. Quand le
// fichier arrive dans les dossiers, Venus le détecte comme d'habitude.
// Réglages : adresse et clé API de chacun, profil de qualité et dossier de destination (choisis dans des listes).
import { all, getSetting, setSetting } from './db.js';
import { HttpError } from './http.js';

const KINDS = { radarr: 'radarr', sonarr: 'sonarr', lidarr: 'lidarr', bookshelf: 'bookshelf' };
const NAMES = { radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr', bookshelf: 'Bookshelf' };
const API = (app) => (app === 'lidarr' || app === 'bookshelf' ? '/api/v1' : '/api/v3');
export function arrConf(app) {
  return {
    url: String(getSetting(`${app}_url`, '') || '').replace(/\/+$/, ''),
    key: String(getSetting(`${app}_key`, '') || ''),
    profile: Number(getSetting(`${app}_profile`, 0)) || null,
    metaProfile: Number(getSetting(`${app}_meta_profile`, 0)) || null,
    root: String(getSetting(`${app}_root`, '') || ''),
    animeRoot: String(getSetting(`${app}_anime_root`, '') || ''),
  };
}
export const arrOn = (app) => { const c = arrConf(app); return !!(c.url && c.key); };
export const appFor = (kind) => (kind === 'movie' ? 'radarr' : 'sonarr');

export function saveArr(app, { url, key, profile, metaProfile, root, animeRoot }) {
  if (!KINDS[app]) throw new HttpError(400, 'Service inconnu');
  if (url !== undefined) {
    const u = String(url).trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new HttpError(400, 'Adresse invalide (ex. http://192.168.1.20:7878)');
    setSetting(`${app}_url`, u);
  }
  if (key) setSetting(`${app}_key`, String(key).trim().slice(0, 100));
  if (key === null) setSetting(`${app}_key`, '');
  if (profile !== undefined) setSetting(`${app}_profile`, Number(profile) || 0);
  if (metaProfile !== undefined) setSetting(`${app}_meta_profile`, Number(metaProfile) || 0);
  if (root !== undefined) setSetting(`${app}_root`, String(root || '').slice(0, 500));
  if (animeRoot !== undefined) setSetting(`${app}_anime_root`, String(animeRoot || '').slice(0, 500));
}

export async function call(app, path, { method = 'GET', body = null, conf = null } = {}) {
  const c = conf || arrConf(app);
  if (!c.url || !c.key) throw new HttpError(400, `${NAMES[app]} n’est pas relié (Réglages → Demandes)`);
  let res;
  try {
    res = await fetch(`${c.url}${path}`, { method, headers: { 'X-Api-Key': c.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: 'manual' });
  } catch (e) { throw new HttpError(502, `${NAMES[app]} injoignable : ${e.cause && e.cause.code ? e.cause.code : e.message}`); }
  if (res.status === 401) throw new HttpError(502, 'Clé API refusée');
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const msg = Array.isArray(data) ? data.map((x) => x.errorMessage).filter(Boolean).join(' ; ') : data && (data.message || data.error);
    throw new HttpError(res.status === 400 ? 400 : 502, msg || `Erreur ${res.status}`);
  }
  return data;
}

// Test de connexion + listes pour les réglages
export async function arrOptions(app, conf = null) {
  const base = API(app);
  const [status, profiles, roots, metas] = await Promise.all([
    call(app, `${base}/system/status`, { conf }), call(app, `${base}/qualityprofile`, { conf }), call(app, `${base}/rootfolder`, { conf }),
    app === 'lidarr' || app === 'bookshelf' ? call(app, `${base}/metadataprofile`, { conf }).catch(() => []) : Promise.resolve(null),
  ]);
  return {
    version: status && status.version, name: status && status.appName,
    profiles: (profiles || []).map((p) => ({ id: p.id, name: p.name })),
    metaProfiles: metas ? metas.map((p) => ({ id: p.id, name: p.name })) : undefined,
    roots: (roots || []).map((r) => ({ path: r.path, free: r.freeSpace || null })),
  };
}

const posterOf = (x) => x.remotePoster || ((x.images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || null;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Recherche : films dans Radarr, séries et animés dans Sonarr. Indique ce qui est déjà demandé ou déjà dans Venus.
export async function arrSearch(kind, q) {
  const app = appFor(kind);
  const term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return [];
  const list = await call(app, `/api/v3/${app === 'radarr' ? 'movie' : 'series'}/lookup?term=${encodeURIComponent(term)}`);
  const venus = new Set(all(`SELECT title, year FROM items WHERE type = ?`, kind === 'movie' ? 'movie' : 'show').map((i) => `${norm(i.title)}|${i.year || ''}`));
  return (list || []).slice(0, 30).map((x) => ({
    kind, app,
    id: app === 'radarr' ? x.tmdbId : x.tvdbId,
    title: x.title, year: x.year || null, overview: x.overview ? String(x.overview).slice(0, 400) : null,
    poster: posterOf(x), network: x.network || x.studio || null, seasons: x.statistics ? x.statistics.seasonCount : (x.seasons || []).filter((s) => s.seasonNumber > 0).length || null,
    runtime: x.runtime || null, genres: (x.genres || []).slice(0, 3),
    requested: !!x.id, // déjà présent dans Radarr / Sonarr
    inVenus: venus.has(`${norm(x.title)}|${x.year || ''}`),
    animeHint: app === 'sonarr' && (x.seriesType === 'anime' || (x.genres || []).includes('Anime')),
  })).filter((x) => x.id);
}

// Ajout dans Radarr / Sonarr, avec recherche immédiate du téléchargement
export async function arrAdd(kind, id) {
  const app = appFor(kind);
  const c = arrConf(app);
  const opts = await arrOptions(app);
  const profile = c.profile && opts.profiles.some((p) => p.id === c.profile) ? c.profile : (opts.profiles[0] || {}).id;
  const root = (kind === 'anime' && c.animeRoot) || c.root || (opts.roots[0] || {}).path;
  if (!profile || !root) throw new HttpError(400, 'Choisissez un profil de qualité et un dossier dans Réglages → Demandes');
  if (app === 'radarr') {
    const m = await call(app, `/api/v3/movie/lookup/tmdb?tmdbId=${Number(id)}`);
    if (!m) throw new HttpError(404, 'Film introuvable');
    if (m.id) return { already: true, title: m.title };
    const added = await call(app, '/api/v3/movie', { method: 'POST', body: { ...m, qualityProfileId: profile, rootFolderPath: root, monitored: true, minimumAvailability: 'released', addOptions: { searchForMovie: true } } });
    return { added: true, title: added.title, arrId: added.id };
  }
  const found = await call(app, `/api/v3/series/lookup?term=${encodeURIComponent(`tvdb:${Number(id)}`)}`);
  const sr = (found || [])[0];
  if (!sr) throw new HttpError(404, 'Série introuvable');
  if (sr.id) return { already: true, title: sr.title };
  const added = await call(app, '/api/v3/series', { method: 'POST', body: {
    ...sr, qualityProfileId: profile, languageProfileId: 1, rootFolderPath: root, monitored: true, seasonFolder: true,
    // Toutes les saisons, et les suivantes dès qu'elles sont annoncées
    monitorNewItems: 'all',
    seriesType: kind === 'anime' ? 'anime' : 'standard',
    addOptions: { monitor: 'all', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
  } });
  return { added: true, title: added.title, arrId: added.id };
}

// Retire un film / une série ajouté(e) par Venus : téléchargements en cours annulés, fichiers supprimés
export async function arrRemove(app, arrId) {
  const id = Number(arrId);
  if (!arrOn(app) || !id) return false;
  const field = app === 'radarr' ? 'movieId' : 'seriesId';
  try {
    for (let page = 1; page <= 10; page++) {
      const q = await call(app, `/api/v3/queue?page=${page}&pageSize=200`);
      const recs = (q && q.records) || [];
      for (const r of recs.filter((x) => x[field] === id)) await call(app, `/api/v3/queue/${r.id}?removeFromClient=true&blocklist=false`, { method: 'DELETE' }).catch(() => {});
      if (recs.length < 200) break;
    }
  } catch { /* file d'attente illisible : on supprime quand même */ }
  await call(app, app === 'radarr' ? `/api/v3/movie/${id}?deleteFiles=true&addImportExclusion=false` : `/api/v3/series/${id}?deleteFiles=true&addImportListExclusion=false`, { method: 'DELETE' });
  forgetKnown();
  return true;
}

// Téléchargements en cours dans Radarr, Sonarr et Lidarr
export async function arrQueue() {
  const out = [];
  for (const app of ['radarr', 'sonarr', 'lidarr']) {
    if (!arrOn(app)) continue;
    try {
      const q = await call(app, `${API(app)}/queue?pageSize=50&${app === 'radarr' ? 'includeMovie=true' : app === 'lidarr' ? 'includeArtist=true&includeAlbum=true' : 'includeSeries=true&includeEpisode=true'}`);
      for (const r of (q && q.records) || []) {
        const size = r.size || 0, left = r.sizeleft || 0;
        const media = r.movie || r.series || (r.album ? { title: r.album.title, year: r.album.releaseDate ? Number(String(r.album.releaseDate).slice(0, 4)) : null, images: r.album.images } : {});
        out.push({
          app, title: media.title || r.title, year: media.year || null, poster: posterOf(media),
          episode: r.episode ? `S${r.episode.seasonNumber} É${r.episode.episodeNumber}` : r.artist ? r.artist.artistName : null,
          progress: size ? Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100))) : 0,
          status: r.trackedDownloadState === 'importPending' ? 'Import en cours' : r.status === 'paused' ? 'En pause' : r.status === 'queued' ? 'En attente' : r.errorMessage ? 'Problème' : 'Téléchargement',
          timeleft: r.timeleft || null,
        });
      }
    } catch { /* service injoignable : on montre l'autre */ }
  }
  return out;
}

// ------------------------------------------------------------------ pour « À venir »
// Ce que Radarr et Sonarr connaissent déjà (gardé 5 min) : sert à marquer « demandé » sans redemander.
const known = { at: 0, movies: new Set(), series: new Set(), seriesNames: new Set() };
export async function arrKnown() {
  if (Date.now() - known.at < 300000) return known;
  known.at = Date.now();
  if (arrOn('radarr')) try { known.movies = new Set((await call('radarr', '/api/v3/movie') || []).map((m) => m.tmdbId)); } catch { /* */ }
  if (arrOn('sonarr')) try {
    const list = await call('sonarr', '/api/v3/series') || [];
    known.series = new Set(list.map((x) => x.tvdbId));
    known.seriesNames = new Set(list.map((x) => norm(x.title)));
  } catch { /* */ }
  return known;
}
export const forgetKnown = () => { known.at = 0; lk.at = 0; };

// Ajout à partir de ce qu'on sait du titre : identifiant TMDB (film), TVDB (série), sinon recherche par nom
export async function arrGrab({ kind, tmdb = null, tvdb = null, imdb = null, title = '', year = null }) {
  if (kind === 'movie') {
    let id = tmdb;
    if (!id && imdb) { const l = await call('radarr', `/api/v3/movie/lookup?term=${encodeURIComponent(`imdb:${imdb}`)}`) || []; id = l[0] && l[0].tmdbId; }
    if (!id && title) {
      const list = await call('radarr', `/api/v3/movie/lookup?term=${encodeURIComponent(title)}`) || [];
      const hit = list.find((m) => norm(m.title) === norm(title) && (!year || Math.abs((m.year || 0) - year) <= 1)) || list[0];
      id = hit && hit.tmdbId;
    }
    if (!id) throw new HttpError(404, 'Film introuvable dans Radarr');
    const r = await arrAdd('movie', id); forgetKnown(); return r;
  }
  let id = tvdb;
  if (!id && imdb) { const l = await call('sonarr', `/api/v3/series/lookup?term=${encodeURIComponent(`imdb:${imdb}`)}`).catch(() => []) || []; id = l[0] && l[0].tvdbId; }
  if (!id && title) {
    const list = await call('sonarr', `/api/v3/series/lookup?term=${encodeURIComponent(title)}`) || [];
    const anime = (x) => x.seriesType === 'anime' || (x.genres || []).includes('Anime');
    const same = list.filter((x) => norm(x.title) === norm(title) || norm(x.title).startsWith(norm(title)));
    const hit = (kind === 'anime' ? same.find(anime) || list.find(anime) : null) || same[0] || list[0];
    id = hit && hit.tvdbId;
  }
  if (!id) throw new HttpError(404, 'Série introuvable dans Sonarr');
  const r = await arrAdd(kind === 'anime' ? 'anime' : 'show', id); forgetKnown(); return r;
}

// ------------------------------------------------------------------ Lidarr (musique)
// Recherche d'artistes et d'albums ; indique ce qui est déjà suivi dans Lidarr et ce qui est déjà sur le NAS.
export async function lidarrSearch(q) {
  const term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return { artists: [], albums: [] };
  const [artists, albums] = await Promise.all([
    call('lidarr', `/api/v1/artist/lookup?term=${encodeURIComponent(term)}`).catch(() => []),
    call('lidarr', `/api/v1/album/lookup?term=${encodeURIComponent(term)}`).catch(() => []),
  ]);
  const nasArtists = new Set(all("SELECT DISTINCT original_title AS a FROM items WHERE type = 'track' AND category = 'music'").map((r) => norm(r.a)));
  const nasAlbums = new Set(all("SELECT DISTINCT key FROM items WHERE type = 'track' AND category = 'music'").map((r) => r.key));
  const img = (x) => ((x.images || []).find((i) => i.coverType === 'poster' || i.coverType === 'cover') || {}).remoteUrl || ((x.images || [])[0] || {}).remoteUrl || null;
  return {
    artists: (artists || []).slice(0, 12).map((a) => ({ mbId: a.foreignArtistId, name: a.artistName, type: a.artistType || null, overview: a.overview ? String(a.overview).slice(0, 300) : null, poster: img(a), requested: !!a.id, inVenus: nasArtists.has(norm(a.artistName)), genres: (a.genres || []).slice(0, 3) })).filter((a) => a.mbId),
    albums: (albums || []).slice(0, 20).map((b) => ({ mbId: b.foreignAlbumId, title: b.title, artist: b.artist ? b.artist.artistName : null, artistMbId: b.artist ? b.artist.foreignArtistId : null, date: b.releaseDate || null, type: b.albumType || null, poster: img(b), requested: !!b.id, inVenus: b.artist ? nasAlbums.has(`${b.artist.artistName}|${b.title}`.toLowerCase()) : false })).filter((b) => b.mbId),
  };
}
async function lidarrDefaults() {
  const c = arrConf('lidarr');
  const opts = await arrOptions('lidarr');
  const profile = c.profile && opts.profiles.some((p) => p.id === c.profile) ? c.profile : (opts.profiles[0] || {}).id;
  const meta = c.metaProfile && (opts.metaProfiles || []).some((p) => p.id === c.metaProfile) ? c.metaProfile : ((opts.metaProfiles || [])[0] || {}).id;
  const root = c.root || (opts.roots[0] || {}).path;
  if (!profile || !root) throw new HttpError(400, 'Choisissez un profil de qualité et un dossier dans Réglages → Demandes (Lidarr)');
  return { profile, meta, root };
}
// Un album (identifiant MusicBrainz du groupe de sorties) : l'artiste est créé au besoin, sans suivre ses autres albums
export async function lidarrAddAlbum(mbRgId) {
  const list = await call('lidarr', `/api/v1/album/lookup?term=${encodeURIComponent(`lidarr:${mbRgId}`)}`) || [];
  const album = list.find((b) => b.foreignAlbumId === mbRgId) || list[0];
  if (!album) throw new HttpError(404, 'Album introuvable dans Lidarr');
  if (album.id) return { already: true, title: album.title };
  const { profile, meta, root } = await lidarrDefaults();
  const body = { ...album, monitored: true, addOptions: { searchForNewAlbum: true },
    artist: { ...album.artist, qualityProfileId: profile, metadataProfileId: meta, rootFolderPath: root, monitored: true, monitorNewItems: 'none', addOptions: { monitor: 'none', searchForMissingAlbums: false } } };
  const added = await call('lidarr', '/api/v1/album', { method: 'POST', body });
  forgetKnown();
  return { added: true, title: added.title, arrId: added.id };
}
// Un artiste entier : tous ses albums, et les suivants dès leur annonce
export async function lidarrAddArtist(mbId) {
  const list = await call('lidarr', `/api/v1/artist/lookup?term=${encodeURIComponent(`lidarr:${mbId}`)}`) || [];
  const artist = list.find((a) => a.foreignArtistId === mbId) || list[0];
  if (!artist) throw new HttpError(404, 'Artiste introuvable dans Lidarr');
  if (artist.id) return { already: true, title: artist.artistName };
  const { profile, meta, root } = await lidarrDefaults();
  const added = await call('lidarr', '/api/v1/artist', { method: 'POST', body: { ...artist, qualityProfileId: profile, metadataProfileId: meta, rootFolderPath: root, monitored: true, monitorNewItems: 'all', addOptions: { monitor: 'all', searchForMissingAlbums: true } } });
  forgetKnown();
  return { added: true, title: added.artistName, arrId: added.id };
}
// Ce que Lidarr suit déjà (identifiants MusicBrainz), gardé 5 min
const lk = { at: 0, albums: new Set(), artists: new Set() };
export async function lidarrKnown() {
  if (!arrOn('lidarr')) return lk;
  if (Date.now() - lk.at < 300000) return lk;
  lk.at = Date.now();
  try { lk.artists = new Set((await call('lidarr', '/api/v1/artist') || []).map((a) => a.foreignArtistId)); } catch { /* */ }
  try { lk.albums = new Set((await call('lidarr', '/api/v1/album') || []).filter((b) => b.monitored).map((b) => b.foreignAlbumId)); } catch { /* */ }
  return lk;
}
