// Envies et suivi automatique avec Seerr
//
//  - « Mes envies » : un film, une série ou un animé pas encore dans Venus (à venir ou déjà sorti), ajouté en favori
//    depuis Nouveautés. Il est demandé à Seerr tout de suite (Radarr / Sonarr le cherchent et le téléchargent,
//    même s'il ne sort que dans plusieurs mois). Quand il arrive dans Venus, il passe tout seul dans « Ma liste ».
//  - Suivi des séries : pour les séries de « Ma liste » et des envies (ou toutes celles de la médiathèque, au choix),
//    chaque nouvelle saison annoncée est demandée à Seerr automatiquement.
//  - Chaque profil peut être relié à son compte Seerr : les demandes sont faites à son nom (quotas, historique).
import { db, all, get, run, getSetting, setSetting } from './db.js';
import { seerr, seerrOn, seerrConf, seerrRequest, mediaState, libraryIndex } from './discover.js';
import { logActivity } from './activity.js';
import { notify } from './notify.js';

db.exec(`CREATE TABLE IF NOT EXISTS wishlist (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,          -- movie | tv
  tmdb_id INTEGER NOT NULL,
  title TEXT, original TEXT, poster TEXT, backdrop TEXT, date TEXT, overview TEXT, anime INTEGER DEFAULT 0,
  added_at INTEGER, requested_at INTEGER, error TEXT,
  PRIMARY KEY (profile_id, media_type, tmdb_id)
)`);

// ------------------------------------------------------------------ réglages
export const autoRequest = () => String(getSetting('seerr_auto', '1')) !== '0';
export const followMode = () => getSetting('seerr_follow', 'mylist'); // off | mylist | all
export function seerrUsers() { const m = getSetting('seerr_users', {}); return m && typeof m === 'object' ? m : {}; }
export const seerrUserOf = (profileId) => seerrUsers()[String(profileId)] || null;
export function linkSeerrUser(profileId, seerrUserId) {
  const m = seerrUsers();
  if (seerrUserId) m[String(profileId)] = Number(seerrUserId); else delete m[String(profileId)];
  setSetting('seerr_users', m);
}

// ------------------------------------------------------------------ connexion avec un compte Seerr (sans copier la clé API)
// On se connecte comme dans l'interface de Seerr (compte local, Jellyfin/Emby ou Plex), puis on lit la clé API
// dans les réglages de Seerr (compte administrateur nécessaire). Le mot de passe n'est jamais enregistré.
export async function seerrLogin({ url, method = 'local', user, password, plexToken }) {
  url = String(url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Adresse de Seerr invalide (ex. http://192.168.1.20:5055)');
  const path = method === 'plex' ? '/auth/plex' : method === 'jellyfin' ? '/auth/jellyfin' : '/auth/local';
  const body = method === 'plex' ? { authToken: plexToken } : method === 'jellyfin' ? { username: user, password } : { email: user, password };
  let res;
  try {
    res = await fetch(`${url}/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch { throw new Error(`Seerr injoignable à ${url}. Vérifiez l’adresse et le port (5055 par défaut).`); }
  if (res.status === 401 || res.status === 403) throw new Error('Identifiant ou mot de passe refusé par Seerr');
  if (!res.ok) throw new Error(`Seerr a répondu ${res.status}`);
  const me = await res.json().catch(() => ({}));
  const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Seerr n’a pas ouvert de session');
  const st = await fetch(`${url}/api/v1/settings/main`, { headers: { Cookie: cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  fetch(`${url}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {});
  if (st.status === 403 || st.status === 401) throw new Error(`Le compte « ${me.displayName || user} » n’est pas administrateur de Seerr : utilisez un compte administrateur, ou collez la clé API.`);
  if (!st.ok) throw new Error(`Impossible de lire la clé API (Seerr ${st.status})`);
  const main = await st.json();
  if (!main.apiKey) throw new Error('Seerr n’a pas donné de clé API');
  return { url, key: main.apiKey, user: { id: me.id, name: me.displayName || me.email || user } };
}

export async function listSeerrUsers() {
  const d = await seerr('/user?take=200&skip=0&sort=displayname');
  return (d.results || []).map((u) => ({ id: u.id, name: u.displayName || u.username || u.plexUsername || u.jellyfinUsername || u.email, email: u.email || null, avatar: u.avatar || null, requests: u.requestCount || 0 }));
}

// ------------------------------------------------------------------ envies
const row = (r) => ({
  type: r.media_type, tmdbId: r.tmdb_id, title: r.title, original: r.original, poster: r.poster, backdrop: r.backdrop,
  date: r.date, overview: r.overview, anime: !!r.anime, added: r.added_at, requested: r.requested_at, error: r.error,
});
export const wishlistOf = (profileId) => all('SELECT * FROM wishlist WHERE profile_id = ? ORDER BY added_at DESC', profileId).map(row);
export const inWishlist = (profileId, type, tmdbId) => !!get('SELECT 1 FROM wishlist WHERE profile_id=? AND media_type=? AND tmdb_id=?', profileId, type, tmdbId);

export async function addWish(profile, x) {
  const type = x.type === 'movie' ? 'movie' : 'tv';
  run(`INSERT INTO wishlist(profile_id, media_type, tmdb_id, title, original, poster, backdrop, date, overview, anime, added_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id, media_type, tmdb_id) DO UPDATE SET title=excluded.title, poster=COALESCE(excluded.poster, poster), date=excluded.date`,
  profile.id, type, x.tmdbId, String(x.title || '').slice(0, 300), x.original || null, x.poster || null, x.backdrop || null, x.date || null,
  String(x.overview || '').slice(0, 2000) || null, x.anime ? 1 : 0, Date.now());
  // Profils enfants : l'envie est notée, un adulte décide de la demande
  let request = null;
  if (seerrOn() && autoRequest() && profile.max_age == null) request = await requestWish(profile.id, type, x.tmdbId);
  return { inWishlist: true, request };
}
export function removeWish(profileId, type, tmdbId) {
  run('DELETE FROM wishlist WHERE profile_id=? AND media_type=? AND tmdb_id=?', profileId, type === 'movie' ? 'movie' : 'tv', tmdbId);
  return { inWishlist: false };
}

async function requestWish(profileId, type, tmdbId) {
  try {
    const st = mediaState((await seerr(`/${type}/${tmdbId}`)).mediaInfo);
    let out = st;
    // Déjà demandé, en cours ou disponible : rien à faire (pas de doublon dans Seerr)
    if (st.state === 'none' || st.state === 'deleted') {
      out = await seerrRequest(type, tmdbId, { userId: seerrUserOf(profileId) });
      const w = get('SELECT title FROM wishlist WHERE profile_id=? AND media_type=? AND tmdb_id=?', profileId, type, tmdbId);
      const p = get('SELECT name FROM profiles WHERE id=?', profileId);
      logActivity('seerr', `${p ? p.name : 'Un profil'} a demandé « ${w ? w.title : tmdbId} » à Seerr`);
    }
    // Ajouté aussi à la liste de suivi du compte Seerr de la personne, s'il est relié
    const uid = seerrUserOf(profileId);
    if (uid) seerr('/watchlist', { method: 'POST', body: { tmdbId: Number(tmdbId), mediaType: type }, asUser: uid }).catch(() => {});
    run('UPDATE wishlist SET requested_at=?, error=NULL WHERE profile_id=? AND media_type=? AND tmdb_id=?', Date.now(), profileId, type, tmdbId);
    return out;
  } catch (e) {
    run('UPDATE wishlist SET error=? WHERE profile_id=? AND media_type=? AND tmdb_id=?', e.message.slice(0, 200), profileId, type, tmdbId);
    return { state: 'error', error: e.message };
  }
}

// ------------------------------------------------------------------ tâche de fond (toutes les 6 h, et au démarrage)
let running = false;
export const watchState = { lastRun: null, requested: 0, followed: 0, error: null };

export async function runWatch() {
  if (running) return watchState;
  running = true;
  watchState.error = null;
  let requested = 0;
  try {
    const lib = libraryIndex();
    // 1. Envies : arrivées dans Venus → « Ma liste » ; jamais demandées (ou en erreur) → nouvel essai
    for (const w of all('SELECT w.*, p.max_age FROM wishlist w JOIN profiles p ON p.id = w.profile_id')) {
      const itemId = lib.byTmdb.get(`${w.media_type}:${w.tmdb_id}`);
      if (itemId) {
        const fresh = !get('SELECT 1 FROM mylist WHERE profile_id=? AND item_id=?', w.profile_id, itemId);
        run('INSERT OR IGNORE INTO mylist(profile_id, item_id, added_at) VALUES(?,?,?)', w.profile_id, itemId, Date.now());
        if (fresh) notify({ title: 'Votre envie est arrivée', body: `« ${w.title} » est maintenant dans Venus`, url: `/titre/${itemId}`, tag: `wish-${itemId}` }, { profileId: w.profile_id }).catch(() => {});
        if (w.media_type === 'movie') run('DELETE FROM wishlist WHERE profile_id=? AND media_type=? AND tmdb_id=?', w.profile_id, w.media_type, w.tmdb_id);
        continue;
      }
      if (seerrOn() && autoRequest() && w.max_age == null && (!w.requested_at || w.error)) { await requestWish(w.profile_id, w.media_type, w.tmdb_id); requested++; }
    }
    // 2. Séries suivies : chaque nouvelle saison annoncée est demandée
    const mode = seerrOn() ? followMode() : 'off';
    if (mode !== 'off') {
      const ids = new Map(); // tmdb -> { maxLib, profileId }
      const libShows = mode === 'all'
        ? all("SELECT id, tmdb_id FROM items WHERE type='show' AND tmdb_id IS NOT NULL")
        : all("SELECT DISTINCT i.id, i.tmdb_id, m.profile_id FROM mylist m JOIN items i ON i.id = m.item_id WHERE i.type='show' AND i.tmdb_id IS NOT NULL");
      for (const s of libShows) {
        const max = get("SELECT MAX(season_num) n FROM items WHERE type='season' AND show_id=?", s.id).n || 0;
        ids.set(s.tmdb_id, { max, profileId: s.profile_id || null });
      }
      for (const w of all("SELECT tmdb_id, profile_id FROM wishlist WHERE media_type='tv'")) if (!ids.has(w.tmdb_id)) ids.set(w.tmdb_id, { max: 0, profileId: w.profile_id });
      watchState.followed = ids.size;
      for (const [tmdbId, info] of ids) {
        try { requested += await followShow(tmdbId, info); } catch (e) { watchState.error = e.message; }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    watchState.requested += requested;
  } catch (e) { watchState.error = e.message; }
  watchState.lastRun = Date.now();
  running = false;
  return watchState;
}

async function followShow(tmdbId, { max, profileId }) {
  const d = await seerr(`/tv/${tmdbId}`);
  const info = d.mediaInfo || {};
  const covered = new Set();
  for (const s of info.seasons || []) if (s.status > 1) covered.add(s.seasonNumber);
  for (const r of info.requests || []) if (r.status !== 3) for (const s of r.seasons || []) covered.add(s.seasonNumber);
  // Saisons annoncées (avec une date, ou déjà commencées), plus récentes que ce qu'on a déjà, pas encore demandées
  const todo = (d.seasons || [])
    .filter((s) => s.seasonNumber > 0 && s.seasonNumber > max && !covered.has(s.seasonNumber) && (s.airDate || (s.episodeCount || 0) > 0))
    .map((s) => s.seasonNumber);
  if (!todo.length) return 0;
  await seerrRequest('tv', tmdbId, { userId: profileId ? seerrUserOf(profileId) : null, seasons: todo });
  logActivity('seerr', `Nouvelle saison de « ${d.name || tmdbId} » demandée à Seerr (saison ${todo.join(', ')})`);
  return 1;
}

export function startWatch() {
  setTimeout(() => runWatch().catch(() => {}), 3 * 60000).unref();
  setInterval(() => runWatch().catch(() => {}), 6 * 3600000).unref();
}
export const seerrConfigured = () => !!seerrConf().url;
