// Routes de l'API
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Router, HttpError, readBody, sendJson, sendFile } from './http.js';
import { all, get, run, tx, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import {
  hashSecret, verifySecret, createToken, requireDevice, requireProfile, requireAdmin,
  isSetup, checkRate, resetRate, publicProfile,
} from './auth.js';
import { scanAll, scanState, watchLibraries, scheduleScan, events } from './scanner.js';
import { pipeline } from 'node:stream/promises';
import { tmdbKey, testKey, searchTmdb, matchMovie, matchShow } from './metadata.js';
import {
  decide, startSession, sessions, servePlaylist, serveSegment, subtitleVtt, thumbnail, QUALITIES, hw, channelSnapshot,
} from './stream.js';
import { detectHardware } from './hw.js';
import { probeLive } from './probe.js';
import { discover, listShares, mountRemote, unmountRemote, remoteOf, describe, netState, xtreamUrl } from './netshare.js';

export const router = new Router();
const imagesDir = path.join(config.dataDir, 'images');

// ------------------------------------------------------------------ utilitaires
const parseJson = (s, d) => { if (s == null) return d; try { return JSON.parse(s) ?? d; } catch { return d; } };

function ageClause(profile, alias = 'i') {
  if (!profile || profile.max_age == null) return { sql: '1=1', args: [] };
  const allowUnrated = getSetting('kids_allow_unrated', false);
  return {
    sql: `(${alias}.age <= ?${allowUnrated ? ` OR ${alias}.age IS NULL` : ''})`,
    args: [profile.max_age],
  };
}

function visible(profile, item) {
  if (!item) return false;
  if (!profile || profile.max_age == null) return true;
  const top = ['movie', 'show', 'clip', 'channel'].includes(item.type) ? item : get('SELECT age FROM items WHERE id=?', item.show_id);
  if (!top) return false;
  if (top.age == null) return getSetting('kids_allow_unrated', false);
  return top.age <= profile.max_age;
}

function mediaSummary(probeJson) {
  const p = parseJson(probeJson, null);
  if (!p || !p.video) return null;
  const h = p.video.height, w = p.video.width;
  const res = w >= 3200 || h >= 1800 ? '4K' : w >= 1800 || h >= 1000 ? 'HD 1080p' : w >= 1200 || h >= 700 ? 'HD 720p' : 'SD';
  const surround = p.audio.some((a) => a.channels >= 6);
  return {
    resolution: res, hdr: p.video.hdr ? (p.video.dovi ? 'Dolby Vision' : 'HDR') : null, codec: p.video.codec,
    surround: surround ? (p.audio.some((a) => /atmos/i.test(a.title) || a.profile === 'TrueHD Atmos') ? 'Dolby Atmos' : '5.1') : null,
    audio: [...new Set(p.audio.map((a) => a.lang))], subs: [...new Set(p.subs.map((s) => s.lang))],
  };
}

function card(i, prog) {
  return {
    id: i.id, type: i.type, title: i.title, originalTitle: i.original_title, year: i.year, poster: i.poster, backdrop: i.backdrop, logo: i.logo,
    still: i.still, age: i.age, cert: i.certification, vote: i.vote, genres: parseJson(i.genres, []),
    overview: i.overview, runtime: i.runtime || (i.duration ? Math.round(i.duration / 60) : null),
    season: i.season_num, episode: i.episode_num, showId: i.show_id, showTitle: i.show_title,
    progress: prog ? { position: prog.position, duration: prog.duration, watched: !!prog.watched } : undefined,
    added: i.added_at, category: i.category, released: i.release_date || null,
    popularity: i.popularity, group: i.grp,
  };
}

// État vu / en cours / non vu, par profil (films, clips, et séries épisode par épisode)
function statusIndex(pid) {
  const prog = new Map(all('SELECT item_id, position, duration, watched FROM progress WHERE profile_id=?', pid).map((r) => [r.item_id, r]));
  const shows = new Map(all(`SELECT e.show_id AS sid, COUNT(*) AS total,
      SUM(CASE WHEN p.watched = 1 THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN p.watched = 0 AND p.position > 0 THEN 1 ELSE 0 END) AS part
    FROM items e LEFT JOIN progress p ON p.item_id = e.id AND p.profile_id = ?
    WHERE e.type = 'episode' GROUP BY e.show_id`, pid).map((r) => [r.sid, r]));
  return { prog, shows };
}
function withStatus(c, idx) {
  if (c.type === 'show') {
    const r = idx.shows.get(c.id);
    const seen = r ? r.seen || 0 : 0, total = r ? r.total : 0;
    c.status = total && seen >= total ? 'seen' : seen || (r && r.part) ? 'progress' : 'unseen';
    c.unseen = Math.max(0, total - seen);
    c.episodes = total;
  } else if (c.type !== 'channel') {
    const p = idx.prog.get(c.id);
    c.status = !p ? 'unseen' : p.watched ? 'seen' : p.position > 0 ? 'progress' : 'unseen';
    if (p && !c.progress) c.progress = { position: p.position, duration: p.duration, watched: !!p.watched };
  }
  return c;
}

// Catégories présentes (pour la navigation)
const CATEGORY_SQL = `CASE WHEN i.type = 'movie' THEN 'movie' WHEN i.type = 'clip' THEN 'clip' WHEN i.type = 'channel' THEN 'channel'
  WHEN i.category = 'anime' THEN 'anime' ELSE 'show' END`;
const TOP_TYPES = "('movie','show','clip','channel')";

function progressMap(profileId, ids) {
  if (!ids.length) return new Map();
  const rows = all(`SELECT * FROM progress WHERE profile_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`, profileId, ...ids);
  return new Map(rows.map((r) => [r.item_id, r]));
}

function nextEpisode(ep) {
  return get(`SELECT * FROM items WHERE type='episode' AND show_id=? AND
      (season_num > ? OR (season_num = ? AND episode_num > ?)) AND season_num > 0
      ORDER BY season_num, episode_num LIMIT 1`, ep.show_id, ep.season_num, ep.season_num, ep.episode_num);
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `vn_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}`);
}

// ------------------------------------------------------------------ installation & connexion
router.get('/api/status', (ctx) => {
  sendJson(ctx.res, {
    setup: isSetup(), name: getSetting('server_name', 'Venus'), version: config.version,
    authenticated: !!ctx.auth, profile: publicProfile(ctx.auth?.profile),
  });
});

router.post('/api/setup', async (ctx) => {
  if (isSetup()) throw new HttpError(409, 'Déjà configuré');
  const b = await readBody(ctx.req);
  if (!b.password || String(b.password).length < 4) throw new HttpError(400, 'Mot de passe trop court (4 caractères minimum)');
  if (!b.name) throw new HttpError(400, 'Nom du profil requis');
  if (b.tmdbKey && !(await testKey(b.tmdbKey).catch(() => false))) throw new HttpError(400, 'Clé TMDB invalide');
  const token = tx(() => {
    setSetting('household_password', hashSecret(b.password));
    setSetting('server_name', b.serverName || 'Venus');
    if (b.tmdbKey) setSetting('tmdb_key', b.tmdbKey);
    const r = run('INSERT INTO profiles(name, avatar, pin_hash, is_admin, created_at) VALUES(?, ?, ?, 1, ?)',
      b.name, Number(b.avatar) || 0, b.pin ? hashSecret(b.pin) : null, Date.now());
    for (const [type, p, name] of [['movies', b.moviesPath ?? config.defaultMovies, 'Films'], ['shows', b.showsPath ?? config.defaultShows, 'Séries']]) {
      if (p) run('INSERT OR IGNORE INTO libraries(name, type, path) VALUES(?, ?, ?)', name, type, path.resolve(p));
    }
    // Dossiers Animés et Clips : ajoutés automatiquement s'ils sont montés
    for (const [type, p, name] of [['anime', config.defaultAnime, 'Animés'], ['clips', config.defaultClips, 'Clips']]) {
      if (fs.existsSync(p)) run('INSERT OR IGNORE INTO libraries(name, type, path) VALUES(?, ?, ?)', name, type, path.resolve(p));
    }
    const t = createToken(ctx.req.headers['user-agent'] || '');
    run('UPDATE tokens SET profile_id = ? WHERE token = ?', Number(r.lastInsertRowid), t);
    return t;
  });
  setCookie(ctx.res, token);
  watchLibraries();
  scanAll();
  sendJson(ctx.res, { token });
});

router.post('/api/login', async (ctx) => {
  const b = await readBody(ctx.req);
  const ip = ctx.req.socket.remoteAddress;
  checkRate(`login:${ip}`);
  if (!verifySecret(b.password || '', getSetting('household_password'))) throw new HttpError(401, 'Mot de passe incorrect');
  resetRate(`login:${ip}`);
  const token = createToken(ctx.req.headers['user-agent'] || '');
  setCookie(ctx.res, token);
  sendJson(ctx.res, { token });
});

router.post('/api/logout', (ctx) => {
  if (ctx.auth) run('DELETE FROM tokens WHERE token = ?', ctx.auth.token);
  ctx.res.setHeader('Set-Cookie', 'vn_token=; Path=/; Max-Age=0');
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ profils
router.get('/api/profiles', (ctx) => {
  requireDevice(ctx);
  sendJson(ctx.res, all('SELECT * FROM profiles ORDER BY is_admin DESC, id').map(publicProfile));
});

router.post('/api/profiles/:id/select', async (ctx) => {
  const auth = requireDevice(ctx);
  const b = await readBody(ctx.req);
  const p = get('SELECT * FROM profiles WHERE id = ?', Number(ctx.params.id));
  if (!p) throw new HttpError(404, 'Profil introuvable');
  if (p.pin_hash) {
    checkRate(`pin:${auth.token}`);
    if (!verifySecret(b.pin || '', p.pin_hash)) throw new HttpError(403, 'Code PIN incorrect');
    resetRate(`pin:${auth.token}`);
  }
  run('UPDATE tokens SET profile_id = ? WHERE token = ?', p.id, auth.token);
  sendJson(ctx.res, publicProfile(p));
});

router.post('/api/profiles/leave', (ctx) => {
  const auth = requireDevice(ctx);
  run('UPDATE tokens SET profile_id = NULL WHERE token = ?', auth.token);
  sendJson(ctx.res, { ok: true });
});

router.get('/api/me', (ctx) => sendJson(ctx.res, publicProfile(requireProfile(ctx))));

router.post('/api/profiles', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (!b.name) throw new HttpError(400, 'Nom requis');
  const r = run('INSERT INTO profiles(name, avatar, pin_hash, is_admin, max_age, created_at) VALUES(?, ?, ?, ?, ?, ?)',
    String(b.name).slice(0, 30), Number(b.avatar) || 0, b.pin ? hashSecret(b.pin) : null, b.isAdmin ? 1 : 0,
    b.maxAge == null || b.maxAge === '' ? null : Number(b.maxAge), Date.now());
  sendJson(ctx.res, publicProfile(get('SELECT * FROM profiles WHERE id = ?', Number(r.lastInsertRowid))));
});

router.put('/api/profiles/:id', async (ctx) => {
  const me = requireProfile(ctx);
  const id = Number(ctx.params.id);
  if (!me.is_admin && me.id !== id) throw new HttpError(403, 'Interdit');
  const b = await readBody(ctx.req);
  const p = get('SELECT * FROM profiles WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Profil introuvable');
  if (b.name != null) run('UPDATE profiles SET name = ? WHERE id = ?', String(b.name).slice(0, 30), id);
  if (b.avatar != null) run('UPDATE profiles SET avatar = ? WHERE id = ?', Number(b.avatar), id);
  if (b.pin !== undefined) run('UPDATE profiles SET pin_hash = ? WHERE id = ?', b.pin ? hashSecret(b.pin) : null, id);
  if (b.subtitleLang != null) run('UPDATE profiles SET subtitle_lang = ? WHERE id = ?', b.subtitleLang, id);
  if (b.audioLang != null) run('UPDATE profiles SET audio_lang = ? WHERE id = ?', b.audioLang, id);
  if (me.is_admin) {
    if (b.maxAge !== undefined) run('UPDATE profiles SET max_age = ? WHERE id = ?', b.maxAge == null || b.maxAge === '' ? null : Number(b.maxAge), id);
    if (b.isAdmin !== undefined && id !== me.id) run('UPDATE profiles SET is_admin = ? WHERE id = ?', b.isAdmin ? 1 : 0, id);
  }
  sendJson(ctx.res, publicProfile(get('SELECT * FROM profiles WHERE id = ?', id)));
});

router.del('/api/profiles/:id', (ctx) => {
  const me = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (id === me.id) throw new HttpError(400, 'Impossible de supprimer votre propre profil');
  run('DELETE FROM profiles WHERE id = ?', id);
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ catalogue
// Flux d'évènements (nouveaux médias détectés) : l'interface se met à jour toute seule
router.get('/api/events', (ctx) => {
  requireProfile(ctx);
  const res = ctx.res;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  const onLib = (d) => res.write(`event: library\ndata: ${JSON.stringify(d)}\n\n`);
  events.on('library', onLib);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  ctx.req.on('close', () => { clearInterval(ping); events.off('library', onLib); });
});

router.get('/api/categories', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const rows = all(`SELECT ${CATEGORY_SQL} AS cat, COUNT(*) AS n FROM items i WHERE i.type IN ${TOP_TYPES} AND ${age.sql} GROUP BY cat`, ...age.args);
  sendJson(ctx.res, Object.fromEntries(rows.map((r) => [r.cat, r.n])));
});

router.get('/api/home', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const idx = statusIndex(p.id);
  const rows = [];
  const C = (i, prog) => withStatus(card(i, prog), idx);
  const base = all(`SELECT i.* FROM items i WHERE i.type IN ('movie','show','clip') AND ${age.sql}`, ...age.args);
  const day = Math.floor(Date.now() / 864e5);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Reprendre la lecture, là où on s'est arrêté (+ épisode suivant d'une série en cours)
  const prog = all(`SELECT pr.*, i.type, i.show_id FROM progress pr JOIN items i ON i.id = pr.item_id
                    WHERE pr.profile_id = ? ORDER BY pr.updated_at DESC LIMIT 200`, p.id);
  const cont = []; const seenShows = new Set();
  for (const pr of prog) {
    if (cont.length >= 20) break;
    let it = get(`SELECT i.*, s.title AS show_title, s.backdrop AS show_backdrop, s.logo AS show_logo, s.poster AS show_poster
                  FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id = ?`, pr.item_id);
    if (!it || !visible(p, it)) continue;
    if (it.type === 'episode') {
      if (seenShows.has(it.show_id)) continue;
      seenShows.add(it.show_id);
      let progRow = pr;
      if (pr.watched) {
        const nx = nextEpisode(it);
        if (!nx) continue;
        it = { ...nx, show_title: it.show_title, show_backdrop: it.show_backdrop, show_logo: it.show_logo, show_poster: it.show_poster };
        progRow = get('SELECT * FROM progress WHERE profile_id=? AND item_id=?', p.id, nx.id) || null;
        if (Date.now() - pr.updated_at > 60 * 864e5) continue;
      } else if (pr.position < 15) continue;
      const c = card(it, progRow);
      c.backdrop = it.show_backdrop; c.logo = it.show_logo; c.poster = it.show_poster; c.next = !!pr.watched;
      cont.push(c);
    } else if (!pr.watched && pr.position > 15) {
      cont.push(card(it, pr));
    }
  }
  if (cont.length) rows.push({ id: 'continue', title: 'Reprendre la lecture', items: cont });

  // 2. Nouveaux épisodes : sortis ces 60 derniers jours (date TMDB), sinon ajoutés ces 30 derniers jours
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const freshEps = all(`SELECT e.*, s.title AS show_title, s.backdrop AS show_backdrop, s.poster AS show_poster, s.age AS show_age
      FROM items e JOIN items s ON s.id = e.show_id
      WHERE e.type = 'episode' AND ((e.release_date >= ? AND e.release_date <= ?) OR (e.release_date IS NULL AND e.added_at > ?))
      ORDER BY COALESCE(e.release_date, date(e.added_at / 1000, 'unixepoch')) DESC, e.season_num DESC, e.episode_num DESC`,
  since, today, Date.now() - 30 * 864e5);
  const newEps = []; const shown = new Set();
  for (const e of freshEps) {
    if (shown.has(e.show_id) || !visible(p, e)) continue;
    shown.add(e.show_id);
    const c = card(e, idx.prog.get(e.id));
    c.backdrop = e.show_backdrop || e.still; c.poster = e.show_poster; c.fresh = true;
    newEps.push(c);
    if (newEps.length >= 20) break;
  }
  if (newEps.length) rows.push({ id: 'new-episodes', title: 'Nouveaux épisodes', items: newEps });

  // 3. Nouveaux films (par date de sortie)
  const movies = base.filter((i) => i.type === 'movie');
  const relOf = (i) => i.release_date || (i.year ? `${i.year}-01-01` : '');
  const newMovies = [...movies].filter(relOf).sort((a, b) => relOf(b).localeCompare(relOf(a))).slice(0, 20);
  if (newMovies.length) rows.push({ id: 'new-movies', title: 'Nouveaux films', items: newMovies.map((i) => C(i)) });

  // 4. Derniers ajouts sur le serveur
  const byAdded = [...base].sort((a, b) => b.added_at - a.added_at);
  if (byAdded.length) rows.push({ id: 'recent', title: 'Derniers ajouts', items: byAdded.slice(0, 24).map((i) => C(i)) });

  const mine = all(`SELECT i.* FROM mylist m JOIN items i ON i.id = m.item_id WHERE m.profile_id = ? AND ${age.sql} ORDER BY m.added_at DESC`, p.id, ...age.args);
  if (mine.length) rows.push({ id: 'mylist', title: 'Ma liste', items: mine.map((i) => C(i)) });

  // 5. Populaires : popularité TMDB + ce que le foyer regarde le plus
  const plays = new Map(all(`SELECT COALESCE(i.show_id, i.id) AS tid, COUNT(*) AS n FROM progress pr JOIN items i ON i.id = pr.item_id GROUP BY tid`).map((r) => [r.tid, r.n]));
  const scored = base.filter((i) => i.type !== 'clip').map((i) => ({ i, s: Math.log10((i.popularity || 0) + 1) * 10 + (plays.get(i.id) || 0) * 6 + (i.vote || 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (scored.length >= 4) rows.push({ id: 'popular', title: 'Populaires', items: scored.slice(0, 20).map((x) => C(x.i)) });

  // 6. Au hasard : différent à chaque visite
  const rnd = [...base].sort(() => Math.random() - 0.5).slice(0, 20);
  if (rnd.length >= 4) rows.push({ id: 'random', title: 'Au hasard', items: rnd.map((i) => C(i)), shuffle: true });

  // 7. Par source
  const byCat = (cat) => base.filter((i) => (cat === 'movie' ? i.type === 'movie' : cat === 'clip' ? i.type === 'clip' : i.type === 'show' && (i.category || 'show') === cat));
  for (const [cat, title, path] of [['show', 'Séries', '/series'], ['anime', 'Animés', '/animes'], ['clip', 'Clips', '/clips']]) {
    const list = byCat(cat);
    if (list.length) rows.push({ id: `cat:${cat}`, title, more: path, items: seededShuffle(list, day + cat.length).slice(0, 24).map((i) => C(i)) });
  }
  const channels = all(`SELECT i.* FROM items i WHERE i.type = 'channel' AND ${age.sql} ORDER BY i.episode_num LIMIT 24`, ...age.args);
  if (channels.length) rows.push({ id: 'cat:channel', title: 'TV en direct', more: '/tv', style: 'channels', items: channels.map((i) => card(i)) });

  const top = base.filter((i) => i.vote >= 7.3).sort((a, b) => b.vote - a.vote);
  if (top.length >= 4) rows.push({ id: 'top', title: 'Les mieux notés', items: top.slice(0, 10).map((i) => C(i)) });

  const genres = new Map();
  for (const i of base) for (const g of parseJson(i.genres, [])) { if (!genres.has(g)) genres.set(g, []); genres.get(g).push(i); }
  for (const [g, list] of seededShuffle([...genres.entries()].filter(([, l]) => l.length >= 4), day).slice(0, 4)) {
    rows.push({ id: `g:${g}`, title: g, items: seededShuffle(list, day + g.length).slice(0, 24).map((i) => C(i)) });
  }

  const heroPool = base.filter((i) => i.backdrop && i.type !== 'clip');
  const hero = seededShuffle(heroPool.length ? heroPool : base.filter((i) => i.type !== 'clip'), day + 7).slice(0, 6).map((i) => C(i));
  sendJson(ctx.res, { hero, rows, empty: base.length === 0 && !channels.length, scanning: scanState.running });
});

// Bibliothèque d'une source, avec l'état vu / non vu pour le profil (filtres et tris côté interface)
router.get('/api/library', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const type = ctx.url.searchParams.get('type');
  const where = {
    movie: "i.type = 'movie'", show: "i.type = 'show' AND COALESCE(i.category, 'show') = 'show'", anime: "i.type = 'show' AND i.category = 'anime'",
    clip: "i.type = 'clip'", channel: "i.type = 'channel'",
  }[type] || "i.type IN ('movie','show','clip')";
  const items = all(`SELECT i.* FROM items i WHERE ${where} AND ${age.sql} ORDER BY ${type === 'channel' ? 'i.episode_num' : 'i.sort_title'}`, ...age.args);
  const idx = statusIndex(p.id);
  sendJson(ctx.res, items.map((i) => withStatus(card(i), idx)));
});

router.get('/api/items/:id', (ctx) => {
  const p = requireProfile(ctx);
  let item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  if (item.type === 'episode' || item.type === 'season') item = get('SELECT * FROM items WHERE id = ?', item.show_id);
  if (!visible(p, item)) throw new HttpError(403, 'Contenu non autorisé pour ce profil');
  const out = card(item);
  out.originalTitle = item.original_title;
  out.tagline = item.tagline;
  out.inList = !!get('SELECT 1 FROM mylist WHERE profile_id=? AND item_id=?', p.id, item.id);

  if (item.type === 'movie') {
    out.media = mediaSummary(item.probe);
    out.duration = item.duration;
    out.progress = get('SELECT position, duration, watched FROM progress WHERE profile_id=? AND item_id=?', p.id, item.id) || null;
  } else {
    const seasons = all("SELECT * FROM items WHERE type='season' AND show_id=? ORDER BY season_num = 0, season_num", item.id);
    const eps = all("SELECT * FROM items WHERE type='episode' AND show_id=? ORDER BY season_num, episode_num", item.id);
    const pm = progressMap(p.id, eps.map((e) => e.id));
    out.seasons = seasons.map((s) => ({
      id: s.id, number: s.season_num, title: s.title, poster: s.poster, overview: s.overview,
      episodes: eps.filter((e) => e.parent_id === s.id).map((e) => {
        const c = card(e, pm.get(e.id));
        c.duration = e.duration; c.episodeEnd = e.episode_end;
        return c;
      }),
    }));
    // Prochain épisode à regarder
    const watchedSorted = eps.filter((e) => pm.get(e.id)).sort((a, b) => pm.get(b.id).updated_at - pm.get(a.id).updated_at);
    let next = eps.find((e) => e.season_num > 0) || eps[0];
    if (watchedSorted.length) {
      const last = watchedSorted[0];
      const lp = pm.get(last.id);
      next = lp.watched ? nextEpisode(last) || last : last;
    }
    if (next) { const c = card(next, pm.get(next.id)); c.duration = next.duration; out.nextUp = c; }
    const firstEp = eps.find((e) => e.probe);
    out.media = firstEp ? mediaSummary(firstEp.probe) : null;
  }
  // Titres similaires (genres communs)
  const age = ageClause(p);
  const genres = parseJson(item.genres, []);
  if (genres.length) {
    const cands = all(`SELECT i.* FROM items i WHERE i.type IN ('movie','show') AND i.id != ? AND ${age.sql}`, item.id, ...age.args);
    out.similar = cands
      .map((c) => ({ c, s: parseJson(c.genres, []).filter((g) => genres.includes(g)).length + (c.type === item.type ? 0.5 : 0) }))
      .filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, 18).map((x) => card(x.c));
  } else out.similar = [];
  sendJson(ctx.res, out);
});

router.get('/api/mylist', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const idx = statusIndex(p.id);
  sendJson(ctx.res, all(`SELECT i.* FROM mylist m JOIN items i ON i.id = m.item_id WHERE m.profile_id = ? AND ${age.sql} ORDER BY m.added_at DESC`, p.id, ...age.args).map((i) => withStatus(card(i), idx)));
});

router.post('/api/items/:id/mylist', (ctx) => {
  const p = requireProfile(ctx);
  const id = Number(ctx.params.id);
  const exists = get('SELECT 1 FROM mylist WHERE profile_id=? AND item_id=?', p.id, id);
  if (exists) run('DELETE FROM mylist WHERE profile_id=? AND item_id=?', p.id, id);
  else run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', p.id, id, Date.now());
  sendJson(ctx.res, { inList: !exists });
});

router.post('/api/items/:id/watched', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  const targets = item.type === 'show' ? all("SELECT id, duration FROM items WHERE type='episode' AND show_id=?", item.id)
    : item.type === 'season' ? all("SELECT id, duration FROM items WHERE type='episode' AND parent_id=?", item.id) : [item];
  tx(() => {
    for (const t of targets) {
      if (b.watched === false) run('DELETE FROM progress WHERE profile_id=? AND item_id=?', p.id, t.id);
      else run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, 0, ?, 1, ?)
                ON CONFLICT(profile_id, item_id) DO UPDATE SET watched=1, position=0, updated_at=excluded.updated_at`, p.id, t.id, t.duration || 0, Date.now());
    }
  });
  sendJson(ctx.res, { ok: true });
});

router.post('/api/progress', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const id = Number(b.itemId);
  const pos = Math.max(0, Number(b.position) || 0);
  const dur = Math.max(0, Number(b.duration) || 0);
  if (!id) throw new HttpError(400, 'itemId requis');
  const watched = dur > 0 && pos / dur > 0.92 ? 1 : 0;
  run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, item_id) DO UPDATE SET position=excluded.position, duration=excluded.duration,
       watched=excluded.watched, updated_at=excluded.updated_at`,
  p.id, id, watched ? 0 : pos, dur, watched, Date.now());
  if (b.sessionId) sessions.get(b.sessionId)?.touch();
  sendJson(ctx.res, { watched: !!watched });
});

// ------------------------------------------------------------------ lecture
router.post('/api/play/:id', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = get(`SELECT i.*, s.title AS show_title, s.backdrop AS show_backdrop, s.logo AS show_logo
                    FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id = ?`, Number(ctx.params.id));
  if (item && item.type === 'channel') return playChannel(ctx, p, item, b);
  if (!item || !item.path) throw new HttpError(404, 'Média introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Contenu non autorisé pour ce profil');
  if (!fs.existsSync(item.path)) throw new HttpError(410, 'Fichier déplacé ou supprimé, relancez un scan');
  const probe = parseJson(item.probe, null);
  if (!probe) throw new HttpError(500, 'Fichier non analysé');

  // Choix des pistes par défaut selon les préférences du profil
  const langMatch = (l, pref) => l && pref && (l.startsWith(pref) || ({ fr: ['fre', 'fra'], en: ['eng'] }[pref] || []).includes(l));
  let audioOrder = Number.isInteger(b.audio) ? b.audio : null;
  if (audioOrder == null) {
    const pref = probe.audio.find((a) => langMatch(a.lang, p.audio_lang));
    audioOrder = pref ? pref.order : (probe.audio.find((a) => a.isDefault) || probe.audio[0] || { order: 0 }).order;
  }
  let subId = b.sub === undefined ? undefined : b.sub;
  if (subId === undefined) {
    const audio = probe.audio[audioOrder];
    const audioIsPref = audio && langMatch(audio.lang, p.audio_lang);
    // Sous-titres forcés si l'audio est dans la langue du profil, sinon sous-titres complets dans sa langue
    const textSubs = probe.subs.filter((s) => s.text && langMatch(s.lang, p.subtitle_lang));
    const pick = audioIsPref ? textSubs.find((s) => s.forced) : textSubs.find((s) => !s.forced) || textSubs[0];
    subId = pick ? pick.id : null;
  }
  const sub = subId ? probe.subs.find((s) => s.id === subId) : null;
  const burnIndex = sub && !sub.text && !sub.external ? sub.index : null;

  const decision = decide(probe, { caps: b.caps, audioOrder, quality: b.quality || 'auto', burnSub: burnIndex, maxBitrate: Number(b.maxBitrate) || 0 });
  decision.burnIndex = burnIndex;
  const progress = get('SELECT * FROM progress WHERE profile_id=? AND item_id=?', p.id, item.id);
  const resumeAt = progress && !progress.watched && progress.position > 20 ? Math.max(0, progress.position - 3) : 0;
  const start = b.start === 'resume' || b.start == null ? resumeAt : Math.max(0, Number(b.start) || 0);
  const token = ctx.auth.token;
  let url, sessionId = null, offset = 0;
  if (b.replace) sessions.get(b.replace)?.stop();
  if (decision.mode === 'direct') {
    url = `/api/stream/${item.id}/file?token=${encodeURIComponent(token)}`;
  } else {
    const s = startSession({ item, probe, decision, start, profileId: p.id, quality: b.quality || 'auto' });
    sessionId = s.id; offset = s.offset;
    url = `/api/hls/${s.id}/index.m3u8`;
  }

  const next = item.type === 'episode' ? nextEpisode(item) : null;
  sendJson(ctx.res, {
    itemId: item.id, type: item.type, mode: decision.mode, reason: decision.reason, url, sessionId, offset,
    hwLabel: decision.mode === 'transcode' ? hw.label : null,
    duration: probe.duration, title: item.show_title || item.title,
    subtitle: item.type === 'episode' ? `S${item.season_num} · É${item.episode_num} — ${item.title}` : (item.year ? String(item.year) : ''),
    backdrop: item.show_backdrop || item.backdrop || item.still, logo: item.show_logo || item.logo,
    startAt: start,
    audioOrder, subId: sub ? sub.id : null, quality: b.quality || 'auto',
    audio: probe.audio.map((a) => ({ order: a.order, lang: a.lang, codec: a.codec, channels: a.channels, title: a.title })),
    subs: probe.subs.map((s) => ({
      id: s.id, lang: s.lang, title: s.title, forced: s.forced, codec: s.codec, burn: !s.text,
      url: s.text ? `/api/subs/${item.id}/${s.id}.vtt?token=${encodeURIComponent(token)}` : null,
    })),
    qualities: Object.entries(QUALITIES).map(([id, q]) => ({ id, label: q.label })),
    video: probe.video ? { width: probe.video.width, height: probe.video.height, codec: probe.video.codec, hdr: probe.video.hdr } : null,
    next: next ? { id: next.id, title: next.title, season: next.season_num, episode: next.episode_num, still: next.still, overview: next.overview } : null,
  });
});

// TV en direct : le flux est relu par ffmpeg et servi en HLS (copie de la vidéo quand c'est possible)
async function playChannel(ctx, p, item, b) {
  if (!visible(p, item)) throw new HttpError(403, 'Contenu non autorisé pour ce profil');
  let probe = null;
  try { probe = await probeLive(item.stream_url); } catch { /* certains serveurs refusent l'analyse : on convertit */ }
  const caps = b.caps || {};
  let decision;
  if (probe && probe.video && probe.video.codec === 'h264' && probe.video.bitDepth <= 8) {
    decision = { mode: 'remux', reason: 'Direct', audio: probe.audio[0] || null, copyVideo: true };
  } else {
    decision = { mode: 'transcode', reason: probe ? `Codec ${probe.video ? probe.video.codec : 'inconnu'} converti` : 'Conversion', audio: probe ? probe.audio[0] || null : null, copyVideo: false, limitHeight: 1080, limitBitrate: 6e6 };
  }
  // Aperçu dans la page TV : petite image, faible débit si une conversion est nécessaire
  if (b.preview && !decision.copyVideo) Object.assign(decision, { limitHeight: 480, limitBitrate: 1.2e6 });
  void caps;
  if (b.replace) sessions.get(b.replace)?.stop();
  const s = startSession({ item, probe: probe || { video: null, audio: [], subs: [], bitrate: 0 }, decision, start: 0, profileId: p.id, quality: 'auto', live: true });
  sendJson(ctx.res, {
    itemId: item.id, type: 'channel', live: true, mode: decision.mode, reason: decision.reason, url: `/api/hls/${s.id}/index.m3u8`,
    sessionId: s.id, offset: 0, hwLabel: decision.mode === 'transcode' ? hw.label : null, duration: 0,
    title: item.title, subtitle: item.grp || 'TV en direct', backdrop: null, logo: item.poster, startAt: 0,
    audioOrder: 0, subId: null, quality: 'auto', audio: [], subs: [], qualities: [], video: probe && probe.video ? { width: probe.video.width, height: probe.video.height, codec: probe.video.codec } : null,
    next: null,
  });
}

router.get('/api/channels/:id/preview.jpg', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get("SELECT * FROM items WHERE id = ? AND type = 'channel'", Number(ctx.params.id));
  if (!item || !visible(p, item)) throw new HttpError(404, 'Chaîne introuvable');
  const file = await channelSnapshot(item);
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=60' });
});

router.get('/api/stream/:id/file', (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path) throw new HttpError(404, 'Introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Interdit');
  sendFile(ctx.req, ctx.res, item.path, { cache: 'private, max-age=3600' });
});

router.get('/api/hls/:sid/index.m3u8', (ctx) => servePlaylist(ctx.res, ctx.params.sid));
router.get('/api/hls/:sid/:seg', (ctx) => serveSegment(ctx.req, ctx.res, ctx.params.sid, ctx.params.seg));
router.post('/api/hls/:sid/ping', (ctx) => { sessions.get(ctx.params.sid)?.touch(); sendJson(ctx.res, { ok: sessions.has(ctx.params.sid) }); });
router.del('/api/hls/:sid', (ctx) => { sessions.get(ctx.params.sid)?.stop(); sendJson(ctx.res, { ok: true }); });

router.get('/api/subs/:id/:sub', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  const file = await subtitleVtt(item, parseJson(item.probe, { subs: [] }), ctx.params.sub.replace(/\.vtt$/, ''));
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=86400', type: 'text/vtt; charset=utf-8' });
});

router.get('/api/items/:id/thumb', async (ctx) => {
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path) throw new HttpError(404, 'Introuvable');
  const file = await thumbnail(item, item.duration);
  sendFile(ctx.req, ctx.res, file, { cache: 'public, max-age=2592000, immutable' });
});

router.get('/img/:name', (ctx) => {
  const name = path.basename(ctx.params.name);
  sendFile(ctx.req, ctx.res, path.join(imagesDir, name), { cache: 'public, max-age=2592000, immutable' });
});

// ------------------------------------------------------------------ administration
router.get('/api/admin', (ctx) => {
  requireAdmin(ctx);
  const counts = Object.fromEntries(all('SELECT type, COUNT(*) n FROM items GROUP BY type').map((r) => [r.type, r.n]));
  sendJson(ctx.res, {
    version: config.version,
    hw: { type: hw.type, label: hw.label, tested: hw.tested, tonemap: hw.filters.has('zscale') || hw.filters.has('tonemap_vaapi') || hw.filters.has('tonemap_cuda') },
    sessions: [...sessions.values()].map((s) => s.info()),
    scan: scanState,
    libraries: all('SELECT * FROM libraries').map(publicLibrary),
    counts,
    unmatched: all("SELECT id, type, title, year FROM items WHERE type IN ('movie','show') AND matched = -1 ORDER BY title LIMIT 200"),
    profiles: all('SELECT * FROM profiles ORDER BY id').map(publicProfile),
    devices: all('SELECT t.device, t.last_seen, p.name AS profile FROM tokens t LEFT JOIN profiles p ON p.id = t.profile_id ORDER BY t.last_seen DESC LIMIT 30'),
    settings: {
      serverName: getSetting('server_name', 'Venus'), tmdbConfigured: !!tmdbKey(), hwaccel: getSetting('hwaccel', 'auto'),
      maxSessions: getSetting('max_sessions', 6), scanInterval: getSetting('scan_interval', 60),
      kidsAllowUnrated: getSetting('kids_allow_unrated', false), metadataLang: getSetting('metadata_lang', 'fr-FR'),
    },
    system: { cpus: os.cpus().length, load: os.loadavg()[0], memFree: os.freemem(), memTotal: os.totalmem(), uptime: process.uptime() },
  });
});

router.put('/api/admin/settings', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (b.tmdbKey !== undefined) {
    if (b.tmdbKey && !(await testKey(b.tmdbKey).catch(() => false))) throw new HttpError(400, 'Clé TMDB invalide');
    setSetting('tmdb_key', b.tmdbKey || '');
    if (b.tmdbKey) { run("UPDATE items SET matched = 0 WHERE type IN ('movie','show') AND matched <= 0"); scanAll(); }
  }
  if (b.serverName) setSetting('server_name', String(b.serverName).slice(0, 40));
  if (b.maxSessions) setSetting('max_sessions', Math.max(1, Math.min(20, Number(b.maxSessions))));
  if (b.scanInterval) setSetting('scan_interval', Math.max(5, Number(b.scanInterval)));
  if (b.kidsAllowUnrated !== undefined) setSetting('kids_allow_unrated', !!b.kidsAllowUnrated);
  if (b.metadataLang) setSetting('metadata_lang', b.metadataLang);
  if (b.hwaccel) { setSetting('hwaccel', b.hwaccel); await detectHardware(); }
  if (b.password) {
    if (String(b.password).length < 4) throw new HttpError(400, 'Mot de passe trop court');
    setSetting('household_password', hashSecret(b.password));
  }
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ envoi de vidéos depuis l'application
const UPLOAD_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.srt', '.ass', '.ssa', '.vtt', '.jpg', '.jpeg', '.png']);
const safeSeg = (x) => String(x || '').normalize('NFC').replace(/[\u0000-\u001f<>:"|?*\\/]/g, ' ').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 150);

function diskInfo(l) {
  if (l.type === 'iptv') return { writable: false, free: null };
  let writable = false, free = null;
  try { fs.accessSync(l.path, fs.constants.W_OK); writable = true; } catch { /* lecture seule */ }
  try { const st = fs.statfsSync(l.path); free = st.bavail * st.bsize; } catch { /* inconnu */ }
  return { writable, free };
}

router.post('/api/admin/upload', async (ctx) => {
  requireAdmin(ctx);
  const q = ctx.url.searchParams;
  const lib = get('SELECT * FROM libraries WHERE id = ?', Number(q.get('library')));
  if (!lib || lib.type === 'iptv') throw new HttpError(400, 'Choisissez une source de vidéos');
  const name = safeSeg(q.get('name'));
  if (!name || !UPLOAD_EXT.has(path.extname(name).toLowerCase())) throw new HttpError(415, 'Type de fichier non pris en charge (vidéo, sous-titres ou image)');
  const root = path.resolve(lib.path);
  const folder = String(q.get('folder') || '').split('/').map(safeSeg).filter(Boolean).join(path.sep);
  const dir = path.resolve(root, folder);
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new HttpError(400, 'Dossier invalide');
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
  catch { throw new HttpError(403, 'Ce dossier est en lecture seule. Avec Docker, retirez « :ro » sur le volume de cette source.'); }
  const size = Number(ctx.req.headers['content-length'] || 0);
  try {
    const st = fs.statfsSync(dir);
    if (size && st.bavail * st.bsize < size + 256 * 1024 * 1024) throw new HttpError(507, 'Espace disque insuffisant sur le serveur');
  } catch (e) { if (e instanceof HttpError) throw e; }
  const target = path.join(dir, name);
  if (fs.existsSync(target) && q.get('overwrite') !== '1') throw new HttpError(409, `« ${name} » existe déjà dans ce dossier`);
  const tmp = `${target}.venus-part`;
  let received = 0;
  ctx.req.on('data', (c) => { received += c.length; });
  try {
    await pipeline(ctx.req, fs.createWriteStream(tmp));
    if (size && received !== size) throw new Error('incomplet');
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(499, 'Envoi interrompu');
  }
  scheduleScan(4000);
  sendJson(ctx.res, { ok: true, file: path.relative(root, target) });
});

// Ne jamais renvoyer de mot de passe à l'interface
const maskUrl = (u) => String(u).replace(/(password=)[^&]*/i, '$1••••').replace(/\/\/([^:/@]+):[^@/]+@/, '//$1:••••@');
function publicLibrary(l) {
  const r = remoteOf(l);
  const st = netState.get(l.id);
  const exists = l.type === 'iptv' && /^https?:/i.test(l.path) ? true : fs.existsSync(l.path) && (!r || !st || st.ok);
  return {
    id: l.id, name: l.name, type: l.type, path: l.type === 'iptv' ? maskUrl(l.path) : l.path, exists, ...diskInfo(l),
    network: r ? { proto: r.proto, address: describe(r), user: r.user || null, writable: !!r.writable, ok: st ? st.ok : null, error: st ? st.error : null } : null,
  };
}

// ------------------------------------------------------------------ partages réseau
router.get('/api/admin/network/discover', async (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, await discover({ force: ctx.url.searchParams.get('force') === '1' }));
});

router.post('/api/admin/network/shares', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (!b.host) throw new HttpError(400, 'Indiquez l’adresse de l’appareil');
  try { sendJson(ctx.res, await listShares({ proto: b.proto === 'nfs' ? 'nfs' : 'smb', host: b.host, user: b.user, pass: b.pass })); }
  catch (e) { throw new HttpError(422, e.message); }
});

const NAMES = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct' };

router.post('/api/admin/libraries', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (!NAMES[b.type]) throw new HttpError(400, 'Type de source invalide');
  const name = String(b.name || NAMES[b.type]).slice(0, 60);

  // Partage réseau (SMB / NFS) : Venus le monte lui-même
  if (b.remote && b.type !== 'iptv') {
    const r = b.remote;
    const remote = {
      proto: r.proto === 'nfs' ? 'nfs' : 'smb',
      host: String(r.host || '').trim().replace(/^(smb|nfs|cifs):\/\//i, '').replace(/^\\\\/, '').replace(/[\\/].*$/, ''),
      share: String(r.share || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      sub: String(r.sub || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.\.+/g, ''),
      user: r.user ? String(r.user).trim() : '', pass: r.pass ? String(r.pass) : '', domain: r.domain ? String(r.domain).trim() : '',
      writable: !!r.writable,
    };
    if (!remote.host || !remote.share) throw new HttpError(400, 'Choisissez un appareil et un partage');
    if (remote.proto === 'nfs' && !remote.share.startsWith('/')) remote.share = `/${remote.share}`;
    const dup = all('SELECT * FROM libraries WHERE remote IS NOT NULL').find((l) => { const x = remoteOf(l); return x && x.host === remote.host && x.share === remote.share && (x.sub || '') === remote.sub && l.type === b.type; });
    if (dup) throw new HttpError(409, 'Ce partage est déjà ajouté pour ce type de contenu');
    const placeholder = `pending:${Date.now()}:${Math.random()}`;
    const id = Number(run('INSERT INTO libraries(name, type, path, remote) VALUES(?, ?, ?, ?)', name, b.type, placeholder, JSON.stringify(remote)).lastInsertRowid);
    const res = await mountRemote(id, remote);
    if (!res.ok) {
      run('DELETE FROM libraries WHERE id = ?', id);
      await unmountRemote(id);
      throw new HttpError(422, res.error);
    }
    const full = path.join(res.path, remote.sub);
    if (!fs.existsSync(full)) {
      run('DELETE FROM libraries WHERE id = ?', id);
      await unmountRemote(id);
      throw new HttpError(400, `Le dossier « ${remote.sub} » n’existe pas dans ce partage`);
    }
    run('UPDATE libraries SET path = ?, remote = ? WHERE id = ?', full, JSON.stringify(remote), id);
    netState.set(id, { ok: true, error: null, at: Date.now() });
    scanAll();
    return sendJson(ctx.res, { ok: true, path: full });
  }

  let p = String(b.path || '').trim();
  if (b.type === 'iptv') {
    if (b.xtream) {
      const { server, user, pass } = b.xtream;
      if (!server || !user || !pass) throw new HttpError(400, 'Indiquez le serveur, l’identifiant et le mot de passe fournis par votre abonnement');
      p = xtreamUrl({ server, user, pass });
    } else if (!/^https?:\/\//i.test(p)) {
      p = path.resolve(p);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new HttpError(400, 'Indiquez l’adresse de la liste M3U (http…) ou le chemin d’un fichier .m3u');
    }
  } else {
    p = path.resolve(p);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new HttpError(400, 'Dossier introuvable');
  }
  if (get('SELECT 1 FROM libraries WHERE path = ?', p)) throw new HttpError(409, 'Cette source existe déjà');
  run('INSERT INTO libraries(name, type, path) VALUES(?, ?, ?)', name, b.type, p);
  watchLibraries();
  scanAll();
  sendJson(ctx.res, { ok: true });
});

router.post('/api/admin/libraries/:id/reconnect', async (ctx) => {
  requireAdmin(ctx);
  const lib = get('SELECT * FROM libraries WHERE id = ?', Number(ctx.params.id));
  const r = remoteOf(lib);
  if (!r) throw new HttpError(400, 'Ce n’est pas une source réseau');
  const res = await mountRemote(lib.id, r);
  netState.set(lib.id, { ok: res.ok, error: res.error || null, at: Date.now() });
  if (!res.ok) throw new HttpError(422, res.error);
  scanAll();
  sendJson(ctx.res, { ok: true });
});

router.del('/api/admin/libraries/:id', async (ctx) => {
  requireAdmin(ctx);
  const lib = get('SELECT * FROM libraries WHERE id = ?', Number(ctx.params.id));
  run('DELETE FROM libraries WHERE id = ?', Number(ctx.params.id));
  if (lib && lib.remote) { await unmountRemote(lib.id); netState.delete(lib.id); }
  watchLibraries();
  sendJson(ctx.res, { ok: true });
});

router.post('/api/admin/scan', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  scanAll({ force: !!b.force });
  sendJson(ctx.res, { ok: true });
});

router.get('/api/admin/fs', (ctx) => {
  requireAdmin(ctx);
  const dir = path.resolve(ctx.url.searchParams.get('path') || '/');
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name).sort((a, b) => a.localeCompare(b));
  } catch { throw new HttpError(400, 'Dossier illisible'); }
  sendJson(ctx.res, { path: dir, parent: path.dirname(dir), dirs: entries });
});

router.get('/api/admin/match/:id', async (ctx) => {
  requireAdmin(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  const qy = ctx.url.searchParams.get('q') || item.title;
  const year = Number(ctx.url.searchParams.get('year')) || null;
  sendJson(ctx.res, await searchTmdb(item.type, qy, year));
});

router.post('/api/admin/match/:id', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  if (item.type === 'movie') await matchMovie(item, Number(b.tmdbId));
  else await matchShow(item, Number(b.tmdbId));
  sendJson(ctx.res, { ok: true });
});
