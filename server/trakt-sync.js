// Synchronisation avec Trakt, par profil : chaque personne relie son propre compte Trakt.
// - Ce qui est vu dans Venus est envoyé dans l'historique Trakt (et retiré si on le décoche).
// - L'historique Trakt (films et épisodes vus, lectures en cours) est importé dans Venus, puis toutes les 6 h.
// Liaison sans mot de passe : Venus affiche un code à saisir sur trakt.tv/activate (« device code »).
// Il faut le « Client ID » et le « Client Secret » de l'application Trakt (Réglages → Notes des sites).
import { all, get, run, tx, getSetting, setSetting } from './db.js';
import { traktId } from './trakt.js';

const API = process.env.VENUS_TRAKT_API || 'https://api.trakt.tv';
const UA = 'Venus/1.0 (mediatheque personnelle)';
export const traktSecret = () => String(getSetting('trakt_client_secret', '') || process.env.TRAKT_CLIENT_SECRET || '').trim();
export const traktSyncReady = () => !!(traktId() && traktSecret());
const authOf = (pid) => getSetting(`trakt_auth:${pid}`, null);
const saveAuth = (pid, a) => setSetting(`trakt_auth:${pid}`, a);

async function call(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': traktId(), 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

// ---------------------------------------------------------------- liaison du compte
const pending = new Map(); // profil → { device_code, interval, expires }
export async function startLink(pid) {
  if (!traktSyncReady()) throw new Error('Trakt n’est pas configuré : ajoutez le Client ID et le Client Secret dans Réglages → Notes des sites');
  const r = await call('/oauth/device/code', { method: 'POST', body: { client_id: traktId() } });
  if (r.status !== 200 || !r.data) throw new Error(`Trakt a refusé la demande (${r.status})`);
  pending.set(pid, { code: r.data.device_code, interval: r.data.interval || 5, expires: Date.now() + (r.data.expires_in || 600) * 1000 });
  return { code: r.data.user_code, url: r.data.verification_url || 'https://trakt.tv/activate', expiresIn: r.data.expires_in || 600, interval: r.data.interval || 5 };
}
/** Le code a-t-il été saisi sur trakt.tv ? { linked } | { pending } | { expired } */
export async function pollLink(pid) {
  const p = pending.get(pid);
  if (!p) return { expired: true };
  if (Date.now() > p.expires) { pending.delete(pid); return { expired: true }; }
  const r = await call('/oauth/device/token', { method: 'POST', body: { code: p.code, client_id: traktId(), client_secret: traktSecret() } });
  if (r.status === 200 && r.data && r.data.access_token) {
    pending.delete(pid);
    const me = await call('/users/settings', { token: r.data.access_token }).catch(() => null);
    saveAuth(pid, { access: r.data.access_token, refresh: r.data.refresh_token, expires: Date.now() + (r.data.expires_in || 7776000) * 1000, user: me && me.data && me.data.user ? me.data.user.username : null, linkedAt: Date.now() });
    return { linked: true };
  }
  if (r.status === 400) return { pending: true };          // pas encore saisi
  if (r.status === 429) return { pending: true, slowDown: true };
  pending.delete(pid);
  return { expired: r.status === 410, denied: r.status === 418, error: r.status };
}
export async function unlink(pid) {
  const a = authOf(pid);
  saveAuth(pid, null);
  if (a && a.access) await call('/oauth/revoke', { method: 'POST', body: { token: a.access, client_id: traktId(), client_secret: traktSecret() } }).catch(() => {});
}
export function linkState(pid) {
  const a = authOf(pid);
  return { ready: traktSyncReady(), linked: !!(a && a.access), user: a ? a.user : null, lastImport: a ? a.lastImport || null : null, lastPush: a ? a.lastPush || null : null, imported: a ? a.imported || null : null };
}
// Jeton valable (renouvelé avant son expiration)
async function token(pid) {
  const a = authOf(pid);
  if (!a || !a.access) return null;
  if (a.expires && Date.now() > a.expires - 3 * 864e5 && a.refresh) {
    const r = await call('/oauth/token', { method: 'POST', body: { refresh_token: a.refresh, client_id: traktId(), client_secret: traktSecret(), redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' } });
    if (r.status === 200 && r.data && r.data.access_token) { Object.assign(a, { access: r.data.access_token, refresh: r.data.refresh_token, expires: Date.now() + (r.data.expires_in || 7776000) * 1000 }); saveAuth(pid, a); }
    else if (r.status === 401 || r.status === 400) { saveAuth(pid, null); return null; } // accès retiré sur trakt.tv
  }
  return a.access;
}

// ---------------------------------------------------------------- identifiants Trakt d'un élément Venus
const idsOf = (it) => {
  const ids = {};
  if (it.tmdb_id) ids.tmdb = Number(it.tmdb_id);
  if (it.imdb_id) ids.imdb = it.imdb_id;
  return Object.keys(ids).length ? ids : null;
};
function historyBody(rows) {
  const movies = [], shows = new Map();
  for (const r of rows) {
    const it = get('SELECT * FROM items WHERE id = ?', r.itemId);
    if (!it) continue;
    const at = new Date(r.at || Date.now()).toISOString();
    if (it.type === 'movie') { const ids = idsOf(it); if (ids) movies.push({ ids, watched_at: at }); continue; }
    if (it.type !== 'episode' || !it.show_id || it.season_num == null || it.episode_num == null) continue;
    const sh = get('SELECT * FROM items WHERE id = ?', it.show_id);
    const ids = sh && idsOf(sh);
    if (!ids) continue;
    if (!shows.has(sh.id)) shows.set(sh.id, { ids, seasons: new Map() });
    const s = shows.get(sh.id);
    if (!s.seasons.has(it.season_num)) s.seasons.set(it.season_num, []);
    s.seasons.get(it.season_num).push({ number: it.episode_num, watched_at: at });
  }
  return {
    movies,
    shows: [...shows.values()].map((s) => ({ ids: s.ids, seasons: [...s.seasons].map(([number, episodes]) => ({ number, episodes })) })),
  };
}

// ---------------------------------------------------------------- envoi de ce qui est vu
const queue = new Map(); // profil → { add: Map(itemId → at), remove: Set(itemId) }
let flushT = null;
/** Appelé quand un film ou un épisode est vu (watched = true) ou décoché (false) dans Venus */
export function traktWatched(pid, itemIds, watched) {
  const a = authOf(pid);
  if (!a || !a.access || a.push === false) return;
  if (!queue.has(pid)) queue.set(pid, { add: new Map(), remove: new Set() });
  const q = queue.get(pid);
  for (const id of itemIds) { if (watched) { q.add.set(id, Date.now()); q.remove.delete(id); } else { q.remove.add(id); q.add.delete(id); } }
  clearTimeout(flushT);
  flushT = setTimeout(() => flushTrakt().catch((e) => console.warn('[trakt] envoi :', e.message)), Number(process.env.VENUS_TRAKT_FLUSH_MS || 20000));
}
export async function flushTrakt() {
  for (const [pid, q] of [...queue]) {
    queue.delete(pid);
    const t = await token(pid);
    if (!t) continue;
    if (q.add.size) {
      const body = historyBody([...q.add].map(([itemId, at]) => ({ itemId, at })));
      if (body.movies.length || body.shows.length) await call('/sync/history', { method: 'POST', body, token: t });
    }
    if (q.remove.size) {
      const body = historyBody([...q.remove].map((itemId) => ({ itemId })));
      for (const m of body.movies) delete m.watched_at;
      for (const s of body.shows) for (const se of s.seasons) for (const e of se.episodes) delete e.watched_at;
      if (body.movies.length || body.shows.length) await call('/sync/history/remove', { method: 'POST', body, token: t });
    }
    const a = authOf(pid); if (a) { a.lastPush = Date.now(); saveAuth(pid, a); }
  }
}

// ---------------------------------------------------------------- import de l'historique Trakt
export async function importTrakt(pid) {
  const t = await token(pid);
  if (!t) throw new Error('Compte Trakt non relié');
  const [mv, sh, pb] = await Promise.all([
    call('/sync/watched/movies', { token: t }), call('/sync/watched/shows', { token: t }), call('/sync/playback', { token: t }).catch(() => ({ data: [] })),
  ]);
  if (mv.status !== 200 || sh.status !== 200) throw new Error(`Trakt a refusé la lecture de l’historique (${mv.status})`);
  const movieBy = new Map(), showBy = new Map();
  for (const it of all("SELECT id, type, tmdb_id, imdb_id, duration FROM items WHERE type IN ('movie', 'show')")) {
    const m = it.type === 'movie' ? movieBy : showBy;
    if (it.tmdb_id) m.set(`tmdb:${it.tmdb_id}`, it);
    if (it.imdb_id) m.set(`imdb:${it.imdb_id}`, it);
  }
  const find = (m, ids) => (ids && ((ids.tmdb && m.get(`tmdb:${ids.tmdb}`)) || (ids.imdb && m.get(`imdb:${ids.imdb}`)))) || null;
  const already = new Set(all('SELECT item_id FROM progress WHERE profile_id = ? AND watched = 1', pid).map((r) => r.item_id));
  let movies = 0, episodes = 0, resumed = 0;
  const mark = (id, duration, at) => {
    if (already.has(id)) return false;
    run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, 0, ?, 1, ?)
         ON CONFLICT(profile_id, item_id) DO UPDATE SET watched = 1, position = 0, updated_at = MAX(progress.updated_at, excluded.updated_at)`, pid, id, duration || 0, at || Date.now());
    already.add(id); return true;
  };
  tx(() => {
    for (const x of mv.data || []) { const it = find(movieBy, x.movie && x.movie.ids); if (it && mark(it.id, it.duration, Date.parse(x.last_watched_at) || null)) movies++; }
    for (const x of sh.data || []) {
      const show = find(showBy, x.show && x.show.ids);
      if (!show) continue;
      const eps = new Map(all("SELECT id, season_num, episode_num, duration FROM items WHERE type = 'episode' AND show_id = ?", show.id).map((e) => [`${e.season_num}x${e.episode_num}`, e]));
      for (const se of x.seasons || []) for (const e of se.episodes || []) {
        const ep = eps.get(`${se.number}x${e.number}`);
        if (ep && mark(ep.id, ep.duration, Date.parse(e.last_watched_at) || null)) episodes++;
      }
    }
    // Lectures en cours sur Trakt : reprise au même endroit (si rien de plus récent dans Venus)
    for (const x of pb.data || []) {
      let it = null;
      if (x.type === 'movie') it = find(movieBy, x.movie && x.movie.ids);
      else if (x.type === 'episode' && x.show && x.episode) {
        const show = find(showBy, x.show.ids);
        if (show) it = get("SELECT id, duration FROM items WHERE type = 'episode' AND show_id = ? AND season_num = ? AND episode_num = ?", show.id, x.episode.season, x.episode.number);
      }
      if (!it || !it.duration || already.has(it.id)) continue;
      const pos = Math.round((Number(x.progress) || 0) / 100 * it.duration);
      if ((Number(x.progress) || 0) < 2 || pos < 1) continue; // à peine commencé
      const cur = get('SELECT position FROM progress WHERE profile_id = ? AND item_id = ?', pid, it.id);
      if (cur && cur.position >= pos) continue;
      run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, ?, ?, 0, ?)
           ON CONFLICT(profile_id, item_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`, pid, it.id, pos, it.duration, Date.parse(x.paused_at) || Date.now());
      resumed++;
    }
  });
  const a = authOf(pid);
  if (a) { a.lastImport = Date.now(); a.imported = { movies, episodes, resumed }; saveAuth(pid, a); }
  return { movies, episodes, resumed };
}
/** Toutes les 6 h : nouvel import pour chaque profil relié */
export async function traktSyncAll() {
  for (const p of all('SELECT id FROM profiles')) {
    const a = authOf(p.id);
    if (!a || !a.access) continue;
    if (a.lastImport && Date.now() - a.lastImport < 5.5 * 3600e3) continue;
    await importTrakt(p.id).catch((e) => console.warn(`[trakt] import du profil ${p.id} :`, e.message));
  }
}
export function setTraktPush(pid, on) { const a = authOf(pid); if (a) { a.push = !!on; saveAuth(pid, a); } }
