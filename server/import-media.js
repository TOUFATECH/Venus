// Import depuis Plex ou Jellyfin (et Emby) : épisodes et films déjà vus, et lectures en cours, vers un profil
// Venus. Les fichiers sont retrouvés d'abord par leur nom (mêmes fichiers sur le NAS), puis par leurs
// identifiants TMDB / IMDb, puis par le nom de la série et le numéro de l'épisode.
import path from 'node:path';
import { all, get, run, tx } from './db.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const base = (p) => path.basename(String(p || '').replace(/\\/g, '/')).toLowerCase();

function cleanUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Adresse du serveur manquante');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const x = new URL(s);
  if (!/^https?:$/.test(x.protocol)) throw new Error('Adresse invalide');
  return x.toString().replace(/\/+$/, '');
}
async function getJson(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
  if (res.status === 401 || res.status === 403) throw new Error('Clé ou jeton refusé par le serveur');
  if (!res.ok) throw new Error(`Le serveur a répondu ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- Jellyfin / Emby
const jfHeaders = (token) => ({ 'X-Emby-Token': token, Authorization: `MediaBrowser Token="${token}"` });
async function jellyfinCheck(url, token) {
  const info = await getJson(`${url}/System/Info`, jfHeaders(token));
  const users = await getJson(`${url}/Users`, jfHeaders(token));
  return { server: `${info.ProductName || 'Jellyfin'} ${info.Version || ''}`.trim(), name: info.ServerName || '', users: (users || []).map((u) => ({ id: u.Id, name: u.Name })) };
}
async function jellyfinItems(url, token, user) {
  const q = (extra) => getJson(`${url}/Users/${encodeURIComponent(user)}/Items?Recursive=true&Fields=ProviderIds,Path,UserData&${extra}`, jfHeaders(token)).then((d) => d.Items || []);
  const [played, resum, series] = await Promise.all([
    q('IncludeItemTypes=Movie,Episode&Filters=IsPlayed'), q('IncludeItemTypes=Movie,Episode&Filters=IsResumable'), q('IncludeItemTypes=Series'),
  ]);
  const seriesBy = new Map(series.map((s) => [s.Id, s]));
  const toEntry = (x, watched) => {
    const ser = x.SeriesId ? seriesBy.get(x.SeriesId) : null;
    const pi = (x.ProviderIds || {}), si = ser ? ser.ProviderIds || {} : {};
    const ud = x.UserData || {};
    return {
      type: x.Type === 'Episode' ? 'episode' : 'movie', title: x.Name, file: x.Path, watched,
      position: watched ? 0 : Math.round((ud.PlaybackPositionTicks || 0) / 1e7), at: Date.parse(ud.LastPlayedDate) || null,
      tmdb: pi.Tmdb, imdb: pi.Imdb, show: x.SeriesName || (ser && ser.Name), showTmdb: si.Tmdb, showImdb: si.Imdb, season: x.ParentIndexNumber, episode: x.IndexNumber,
    };
  };
  return [...played.map((x) => toEntry(x, true)), ...resum.map((x) => toEntry(x, false))];
}

// ---------------------------------------------------------------- Plex
const plexHeaders = (token) => ({ 'X-Plex-Token': token, 'X-Plex-Product': 'Venus', 'X-Plex-Client-Identifier': 'venus-import' });
async function plexCheck(url, token) {
  const d = await getJson(`${url}/`, plexHeaders(token));
  const mc = d.MediaContainer || {};
  return { server: `Plex ${mc.version || ''}`.trim(), name: mc.friendlyName || '', users: [] };
}
async function plexItems(url, token) {
  const secs = ((await getJson(`${url}/library/sections`, plexHeaders(token))).MediaContainer || {}).Directory || [];
  const out = [];
  const guid = (x, k) => { const g = (x.Guid || []).map((y) => y.id).find((y) => y.startsWith(`${k}://`)); return g ? g.slice(k.length + 3) : null; };
  for (const s of secs.filter((x) => x.type === 'movie' || x.type === 'show')) {
    const type = s.type === 'movie' ? 1 : 4;
    const shows = new Map();
    if (type === 4) {
      // Identifiants des séries (pour retrouver les épisodes dont le fichier a changé de nom)
      const sh = ((await getJson(`${url}/library/sections/${s.key}/all?type=2&includeGuids=1`, plexHeaders(token))).MediaContainer || {}).Metadata || [];
      for (const x of sh) shows.set(String(x.ratingKey), { tmdb: guid(x, 'tmdb'), imdb: guid(x, 'imdb') });
    }
    for (let start = 0; start < 200000; start += 2000) {
      const mc = (await getJson(`${url}/library/sections/${s.key}/all?type=${type}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=2000`, plexHeaders(token))).MediaContainer || {};
      const list = mc.Metadata || [];
      for (const x of list) {
        const watched = (x.viewCount || 0) > 0;
        const position = !watched && x.viewOffset ? Math.round(x.viewOffset / 1000) : 0;
        if (!watched && !position) continue;
        const part = x.Media && x.Media[0] && x.Media[0].Part && x.Media[0].Part[0];
        const sh = shows.get(String(x.grandparentRatingKey)) || {};
        out.push({
          type: type === 1 ? 'movie' : 'episode', title: x.title, file: part && part.file, watched, position, at: x.lastViewedAt ? x.lastViewedAt * 1000 : null,
          tmdb: guid(x, 'tmdb'), imdb: guid(x, 'imdb'), show: x.grandparentTitle, showTmdb: sh.tmdb, showImdb: sh.imdb, season: x.parentIndex, episode: x.index,
        });
      }
      if (list.length < 2000) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- commun
export async function checkSource(kind, url, token) {
  const u = cleanUrl(url);
  if (!token) throw new Error(kind === 'plex' ? 'Jeton Plex manquant' : 'Clé d’API manquante');
  return kind === 'plex' ? plexCheck(u, token) : jellyfinCheck(u, token);
}

/** Importe dans le profil pid ; renvoie les comptes et quelques titres non retrouvés */
export async function importSource(kind, url, token, user, pid) {
  const u = cleanUrl(url);
  const entries = kind === 'plex' ? await plexItems(u, token) : await jellyfinItems(u, token, user);
  // Index des éléments Venus
  const byFile = new Map(), movieBy = new Map(), showBy = new Map();
  for (const it of all("SELECT id, type, path, title, tmdb_id, imdb_id, duration FROM items WHERE type IN ('movie', 'episode', 'show')")) {
    if (it.path && it.type !== 'show') byFile.set(base(it.path), it);
    const m = it.type === 'movie' ? movieBy : it.type === 'show' ? showBy : null;
    if (!m) continue;
    if (it.tmdb_id) m.set(`tmdb:${it.tmdb_id}`, it);
    if (it.imdb_id) m.set(`imdb:${it.imdb_id}`, it);
    m.set(`name:${norm(it.title)}`, it);
  }
  const episodeOf = (show, s, e) => (show && s != null && e != null ? get("SELECT id, duration FROM items WHERE type = 'episode' AND show_id = ? AND season_num = ? AND episode_num = ?", show.id, s, e) : null);
  let watched = 0, resumed = 0, matched = 0;
  const missing = [];
  tx(() => {
    for (const x of entries) {
      let it = x.file ? byFile.get(base(x.file)) : null;
      if (!it && x.type === 'movie') it = (x.tmdb && movieBy.get(`tmdb:${x.tmdb}`)) || (x.imdb && movieBy.get(`imdb:${x.imdb}`)) || movieBy.get(`name:${norm(x.title)}`) || null;
      if (!it && x.type === 'episode') {
        const show = (x.showTmdb && showBy.get(`tmdb:${x.showTmdb}`)) || (x.showImdb && showBy.get(`imdb:${x.showImdb}`)) || showBy.get(`name:${norm(x.show)}`) || null;
        it = episodeOf(show, x.season, x.episode);
      }
      if (!it) { if (missing.length < 30) missing.push(x.type === 'episode' ? `${x.show} S${String(x.season).padStart(2, '0')}E${String(x.episode).padStart(2, '0')}` : x.title); continue; }
      matched++;
      const cur = get('SELECT watched, position, updated_at FROM progress WHERE profile_id = ? AND item_id = ?', pid, it.id);
      if (x.watched) {
        if (cur && cur.watched) continue;
        run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, 0, ?, 1, ?)
             ON CONFLICT(profile_id, item_id) DO UPDATE SET watched = 1, position = 0`, pid, it.id, it.duration || 0, x.at || Date.now());
        watched++;
      } else if (x.position >= 30 && (!cur || (!cur.watched && cur.position < x.position))) {
        run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, ?, ?, 0, ?)
             ON CONFLICT(profile_id, item_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`, pid, it.id, x.position, it.duration || 0, x.at || Date.now());
        resumed++;
      }
    }
  });
  return { total: entries.length, watched, resumed, already: matched - watched - resumed, notFound: entries.length - matched, missing };
}
