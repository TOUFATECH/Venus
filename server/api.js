// Routes de l'API
import fs from 'node:fs';
import { execFile } from 'node:child_process';
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
import { tmdbKey, testKey, searchTmdb, matchMovie, matchShow, downloadImage } from './metadata.js';
import {
  decide, startSession, sessions, servePlaylist, serveSegment, subtitleVtt, thumbnail, previewClip, QUALITIES, hw, channelSnapshot,
} from './stream.js';
import { detectHardware } from './hw.js';
import { probeLive } from './probe.js';
import { runtime, mountAdvice, gpuAdvice } from './env.js';
import { getSegments, scheduleSeason, segmentsPending } from './segments.js';
import { searchSubs, downloadSub, osOn, resetOsLogin } from './subtitles.js';
import { listBackups, makeBackup, scheduleRestore, backupPath } from './backup.js';
import { prepare as prepareDownload, listJobs, getJob, cancelJob, niceName } from './downloads.js';
import { notify, vapidPublicKey, savePushSub, removePushSub, pushCount, channels } from './notify.js';
import { control, deviceId, logActivity, recentActivity, heartbeat, stopHeartbeat, nowPlaying, tokenOfDevice, loginCode, useLoginCode, loginCodeActive } from './activity.js';
import { scheduleRatings, refreshRatings, omdbKey, simklId, ratingsPending } from './ratings.js';
import { wishlistOf, inWishlist, addWish, removeWish, runWatch, watchState, autoRequest, followMode, seerrLogin, listSeerrUsers, seerrUsers, linkSeerrUser, seerrUserOf } from './watch.js';
import { searchOnline, discover as discoverTitles, discoverAvailable, seerrOn, seerrStatus, seerrRequest, seerrTest, seerrConf, resolveTmdb, trailerFor } from './discover.js';
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
    // Détail des pistes, comme sur la fiche technique
    container: p.container || null, bitrate: p.bitrate || null,
    video: { codec: CODEC[p.video.codec] || String(p.video.codec || '').toUpperCase(), width: w, height: h, fps: p.video.fps || null,
      bits: p.video.bitDepth || (/10/.test(p.video.pixFmt || '') ? 10 : null), hdr: p.video.dovi ? 'Dolby Vision' : p.video.hdr ? (p.video.hdr === true ? 'HDR10' : String(p.video.hdr)) : null },
    tracks: p.audio.map((a) => ({ lang: a.lang, codec: CODEC[a.codec] || String(a.codec || '').toUpperCase(), profile: a.profile || '', channels: a.channels, title: a.title || '', isDefault: !!a.isDefault })),
    subtitles: p.subs.map((x) => ({ lang: x.lang, codec: CODEC[x.codec] || String(x.codec || '').toUpperCase(), forced: !!x.forced, title: x.title || '', external: !!x.external })),
  };
}
const CODEC = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4', eac3: 'E-AC3', ac3: 'AC3', dts: 'DTS', truehd: 'TrueHD', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
  subrip: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'VTT', vtt: 'VTT', hdmv_pgs_subtitle: 'PGS', dvd_subtitle: 'VobSub', mov_text: 'TX3G', srt: 'SRT' };

function card(i, prog) {
  return {
    id: i.id, type: i.type, title: i.title, originalTitle: i.original_title, year: i.year, poster: i.poster, backdrop: i.backdrop, logo: i.logo,
    still: i.still, age: i.age, cert: i.certification, vote: i.vote, genres: parseJson(i.genres, []),
    overview: i.overview, runtime: i.runtime || (i.duration ? Math.round(i.duration / 60) : null),
    season: i.season_num, episode: i.episode_num, showId: i.show_id, showTitle: i.show_title,
    progress: prog ? { position: prog.position, duration: prog.duration, watched: !!prog.watched } : undefined,
    added: i.added_at, category: i.category, released: i.release_date || null,
    popularity: i.popularity, group: i.grp,
    ratings: i.ratings ? parseJson(i.ratings, null) : null, trailer: i.trailer ? (parseJson(i.trailer, null) || {}).key || null : null,
    number: i.type === 'channel' ? channelNumber(i) : undefined,
  };
}

// Numéros de chaîne : numéro de la liste M3U (tvg-chno) sinon ordre des listes, sans doublon
let chanNums = null;
function channelNumber(i) {
  if (!chanNums) {
    chanNums = new Map();
    const rows = all("SELECT id, channel_num FROM items WHERE type='channel' ORDER BY library_id, episode_num");
    const used = new Set(rows.map((r) => r.channel_num).filter(Boolean));
    let n = 0;
    for (const r of rows) {
      if (r.channel_num) { chanNums.set(r.id, r.channel_num); continue; }
      do n++; while (used.has(n));
      chanNums.set(r.id, n);
    }
  }
  return chanNums.get(i.id) || null;
}
events.on('library', () => { chanNums = null; });

// État vu / en cours / non vu, par profil (films, clips, et séries épisode par épisode)
function statusIndex(pid) {
  const prog = new Map(all('SELECT item_id, position, duration, watched, updated_at FROM progress WHERE profile_id=?', pid).map((r) => [r.item_id, r]));
  const shows = new Map(all(`SELECT e.show_id AS sid, COUNT(*) AS total, MAX(p.updated_at) AS last,
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
    c.played = r && r.last ? r.last : null;
  } else if (c.type !== 'channel') {
    const p = idx.prog.get(c.id);
    c.status = !p ? 'unseen' : p.watched ? 'seen' : p.position > 0 ? 'progress' : 'unseen';
    if (p && !c.progress) c.progress = { position: p.position, duration: p.duration, watched: !!p.watched };
    c.played = p ? p.updated_at : null;
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

function prevEpisode(ep) {
  return get(`SELECT * FROM items WHERE type='episode' AND show_id=? AND
      (season_num < ? OR (season_num = ? AND episode_num < ?)) AND season_num > 0
      ORDER BY season_num DESC, episode_num DESC LIMIT 1`, ep.show_id, ep.season_num, ep.season_num, ep.episode_num);
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
  logActivity('login', `Nouvel appareil connecté avec le mot de passe (${deviceLabel(ctx.req.headers['user-agent'])})`, { device: deviceId(token) });
  setCookie(ctx.res, token);
  sendJson(ctx.res, { token });
});

// Connexion avec le code à 6 chiffres affiché dans le tableau de bord (il change à chaque connexion)
router.post('/api/login/code', async (ctx) => {
  const b = await readBody(ctx.req);
  const ip = ctx.req.socket.remoteAddress;
  checkRate(`login:${ip}`);
  if (!loginCodeActive()) throw new HttpError(401, 'Aucun code actif. Demandez à l’administrateur d’ouvrir le tableau de bord pour afficher un code.');
  if (!useLoginCode(b.code)) throw new HttpError(401, 'Code incorrect ou expiré');
  resetRate(`login:${ip}`);
  const token = createToken(ctx.req.headers['user-agent'] || '');
  logActivity('login', `Nouvel appareil connecté avec le code à 6 chiffres (${deviceLabel(ctx.req.headers['user-agent'])})`, { device: deviceId(token) });
  setCookie(ctx.res, token);
  sendJson(ctx.res, { token });
});

function deviceLabel(ua = '') {
  ua = String(ua || '');
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const tv = /SMART-TV|Tizen|Web0S|webOS|BRAVIA|AFT|Android TV|GoogleTV/i.test(ua) ? 'TV' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [tv, br, os && `sur ${os}`].filter(Boolean).join(' ') || 'appareil inconnu';
}

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
  // Commandes de l'administrateur pour cet appareil (pause, arrêt, message)
  const mine = ctx.auth.token, myProfile = ctx.auth.profile && ctx.auth.profile.id;
  const onCtl = (d) => { if (d.all || d.token === mine || (d.profileId && d.profileId === myProfile)) res.write(`event: control\ndata: ${JSON.stringify({ cmd: d.cmd, text: d.text, from: d.from, title: d.title, url: d.url })}\n\n`); };
  control.on('cmd', onCtl);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  ctx.req.on('close', () => { clearInterval(ping); events.off('library', onLib); control.off('cmd', onCtl); });
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
  // Tête d'affiche : ce qu'on regardait en dernier (épisode, film ou chaîne de TV)
  let heroResume = null;
  if (cont.length) {
    const c = cont[0];
    const pr = prog.find((x) => x.item_id === c.id || (c.type === 'episode' && x.show_id === c.showId));
    heroResume = { item: { ...c, heroResume: true }, at: pr ? pr.updated_at : 0 };
  }
  try {
    const lc = getSetting(`last_channel:${p.id}`, null);
    const ch = lc && get('SELECT * FROM items WHERE id = ? AND type = ?', lc.id, 'channel');
    if (ch && visible(p, ch) && (!heroResume || lc.at > heroResume.at) && Date.now() - lc.at < 30 * 864e5) heroResume = { item: { ...card(ch), heroResume: true, live: true }, at: lc.at };
  } catch { /* */ }

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

  // Rangées personnalisées : d'après ce que ce profil regarde
  const seenIds = new Set(); // titres (films / séries) déjà commencés ou vus
  for (const [iid, pr] of idx.prog) { if (pr.position > 0 || pr.watched) seenIds.add(iid); }
  for (const [sid] of idx.shows) { const r = idx.shows.get(sid); if (r && (r.seen || r.part)) seenIds.add(sid); }
  const unseen = base.filter((i) => i.type !== 'clip' && !seenIds.has(i.id));
  const credOf = new Map(base.map((i) => [i.id, parseJson(i.credits, null)]));
  const peopleOf = (i) => { const c = credOf.get(i.id); return c ? [...(c.directors || []), ...(c.cast || []).slice(0, 6)].map((x) => x.name) : []; };
  const lastSeen = all(`SELECT COALESCE(i.show_id, i.id) AS tid, MAX(pr.updated_at) AS t FROM progress pr JOIN items i ON i.id = pr.item_id
      WHERE pr.profile_id = ? AND i.type IN ('movie','episode') GROUP BY tid ORDER BY t DESC LIMIT 3`, p.id);
  const byId = new Map(base.map((i) => [i.id, i]));
  for (const ls of lastSeen.slice(0, 2)) {
    const ref = byId.get(ls.tid);
    if (!ref) continue;
    const g = parseJson(ref.genres, []), pp = new Set(peopleOf(ref)), col = (credOf.get(ref.id) || {}).collection;
    const sim = unseen.filter((i) => i.id !== ref.id).map((i) => {
      const c = credOf.get(i.id) || {};
      const s = parseJson(i.genres, []).filter((x) => g.includes(x)).length * 2 + peopleOf(i).filter((n) => pp.has(n)).length * 3
        + (col && c.collection && c.collection.id === col.id ? 8 : 0) + (i.type === ref.type ? 1 : 0) + (i.vote || 0) / 5;
      return { i, s };
    }).filter((x) => x.s >= 4).sort((a, b) => b.s - a.s).slice(0, 18);
    if (sim.length >= 3) rows.push({ id: `because:${ref.id}`, title: `Parce que vous avez regardé ${ref.title}`, items: sim.map((x) => C(x.i)) });
  }
  // L'acteur ou la réalisatrice qu'on regarde le plus, s'il reste des titres à découvrir
  const fav = new Map();
  for (const id of seenIds) { const it = byId.get(id); if (it) for (const n of peopleOf(it)) fav.set(n, (fav.get(n) || 0) + 1); }
  for (const [name] of [...fav].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    const withP = base.filter((i) => i.type !== 'clip' && peopleOf(i).includes(name));
    if (withP.length >= 3 && withP.some((i) => !seenIds.has(i.id))) {
      rows.push({ id: `person:${name}`, title: `Avec ${name}`, person: name, items: withP.sort((a, b) => (seenIds.has(a.id) - seenIds.has(b.id)) || (b.year || 0) - (a.year || 0)).map((i) => C(i)) });
      break;
    }
  }
  // Pépites jamais vues : les mieux notées qu'on n'a pas encore commencées
  const scoreOfItem = (i) => { const r = parseJson(i.ratings, null); return (r && r.score) || (i.vote ? i.vote * 10 : 0); };
  const gems = unseen.filter((i) => scoreOfItem(i) >= 74).sort((a, b) => scoreOfItem(b) - scoreOfItem(a)).slice(0, 18);
  if (gems.length >= 3) rows.push({ id: 'gems', title: 'Pépites que vous n’avez pas vues', items: gems.map((i) => C(i)) });
  // Courts : moins d'1 h 30
  const shorts = unseen.filter((i) => i.type === 'movie' && (i.runtime || (i.duration ? i.duration / 60 : 999)) <= 90).sort((a, b) => scoreOfItem(b) - scoreOfItem(a)).slice(0, 18);
  if (shorts.length >= 3) rows.push({ id: 'short', title: 'Moins d’1 h 30', items: shorts.map((i) => C(i)) });
  // Sagas : films d'une même collection, dans l'ordre de sortie (celles qu'on a commencées d'abord)
  const sagas = new Map();
  for (const i of base) { const c = credOf.get(i.id); if (i.type === 'movie' && c && c.collection) { if (!sagas.has(c.collection.id)) sagas.set(c.collection.id, { name: c.collection.name, list: [] }); sagas.get(c.collection.id).list.push(i); } }
  const sagaRows = [...sagas.values()].filter((x) => x.list.length >= 2)
    .map((x) => ({ ...x, started: x.list.some((i) => seenIds.has(i.id)), done: x.list.every((i) => seenIds.has(i.id)) }))
    .filter((x) => !x.done).sort((a, b) => b.started - a.started || b.list.length - a.list.length).slice(0, 2);
  for (const sg of sagaRows) {
    rows.push({ id: `saga:${sg.name}`, title: `Saga : ${sg.name.replace(/ - (Saga|Collection)$|^Saga /i, '')}`, items: sg.list.sort((a, b) => (a.release_date || String(a.year)).localeCompare(b.release_date || String(b.year))).map((i) => C(i)) });
  }

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
  let hero = seededShuffle(heroPool.length ? heroPool : base.filter((i) => i.type !== 'clip'), day + 7).slice(0, 6).map((i) => C(i));
  if (heroResume) {
    const r = heroResume.item;
    hero = [r, ...hero.filter((x) => x.id !== r.id && x.id !== r.showId)].slice(0, 6);
  }
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
  // Résolution du premier épisode d'une série, pour le filtre « 4K / HDR »
  const firstProbe = type === 'channel' ? new Map() : new Map(all(`SELECT show_id, probe FROM items WHERE type = 'episode' AND probe IS NOT NULL GROUP BY show_id`).map((r) => [r.show_id, r.probe]));
  const out = items.map((i) => {
    const c = withStatus(card(i), idx);
    if (type !== 'channel') {
      const m = mediaSummary(i.type === 'show' ? firstProbe.get(i.id) : i.probe);
      if (m) { c.res = m.resolution === '4K' ? '4K' : /1080/.test(m.resolution) ? '1080p' : /720/.test(m.resolution) ? '720p' : 'SD'; c.hdr = !!m.hdr; }
      const cr = parseJson(i.credits, null);
      if (cr) { c.studios = [...(cr.studios || []), ...(cr.networks || [])].slice(0, 6); c.people = [...(cr.directors || []), ...(cr.cast || []).slice(0, 8)].map((x) => x.name); }
      if (i.duration && !c.runtime) c.runtime = Math.round(i.duration / 60);
    }
    return c;
  });
  if (type === 'channel') out.sort((a, b) => (a.number || 0) - (b.number || 0));
  sendJson(ctx.res, out);
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
  out.imdbId = item.imdb_id;
  out.credits = parseJson(item.credits, null);
  out.trailerFull = parseJson(item.trailer, null);
  // Notes jamais récupérées (ou anciennes), ou distribution manquante : on les demande tout de suite,
  // elles seront là à la prochaine visite
  if (['movie', 'show'].includes(item.type) && (!item.ratings_at || Date.now() - item.ratings_at > 10 * 86400000 || (!item.credits && item.tmdb_id && tmdbKey()))) scheduleRatings([item.id], true);
  out.links = {
    senscritique: `https://www.senscritique.com/search?query=${encodeURIComponent(item.title)}`,
    imdb: item.imdb_id ? `https://www.imdb.com/fr/title/${item.imdb_id}/` : null,
    anilist: item.anilist_id ? `https://anilist.co/anime/${item.anilist_id}` : null,
    mal: item.mal_id ? `https://myanimelist.net/anime/${item.mal_id}` : null,
  };
  out.inList = !!get('SELECT 1 FROM mylist WHERE profile_id=? AND item_id=?', p.id, item.id);

  if (item.type !== 'show') {
    out.media = mediaSummary(item.probe);
    out.duration = item.duration;
    out.file = { name: path.basename(item.path || ''), size: item.size || null, container: out.media && out.media.container };
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
    out.totalDuration = eps.reduce((n, e) => n + (e.duration || 0), 0);
  }
  // Saga : les autres films de la même collection présents dans Venus
  const age = ageClause(p);
  if (out.credits && out.credits.collection) {
    const cid = out.credits.collection.id;
    const list = all(`SELECT i.* FROM items i WHERE i.type = 'movie' AND i.credits LIKE ? AND ${age.sql}`, `%"collection":{"id":${cid},%`, ...age.args)
      .sort((a, b) => (a.release_date || String(a.year)).localeCompare(b.release_date || String(b.year)));
    if (list.length > 1) out.saga = { name: out.credits.collection.name, items: list.map((x) => card(x)) };
  }
  // Titres similaires (genres communs)
  const genres = parseJson(item.genres, []);
  if (item.type === 'clip' || item.type === 'channel') {
    // Clips : les autres clips du même dossier d'abord, puis les plus récents
    const dir = path.dirname(item.path || '');
    out.similar = all(`SELECT * FROM items WHERE type = ? AND id != ? ORDER BY added_at DESC LIMIT 200`, item.type, item.id)
      .sort((a, b) => (path.dirname(b.path || '') === dir) - (path.dirname(a.path || '') === dir)).slice(0, 18).map((x) => card(x));
  } else if (genres.length) {
    const cands = all(`SELECT i.* FROM items i WHERE i.type IN ('movie','show') AND i.id != ? AND ${age.sql}`, item.id, ...age.args);
    out.similar = cands
      .map((c) => ({ c, s: parseJson(c.genres, []).filter((g) => genres.includes(g)).length + (c.type === item.type ? 0.5 : 0) }))
      .filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, 18).map((x) => card(x.c));
  } else out.similar = [];
  sendJson(ctx.res, out);
});

// À venir : épisodes sortis ces derniers jours dans la médiathèque, et prochains épisodes annoncés (TMDB)
router.get('/api/upcoming', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p, 's');
  const cat = ctx.url.searchParams.get('type') === 'anime' ? "s.category = 'anime'" : ctx.url.searchParams.get('type') === 'show' ? "COALESCE(s.category, 'show') = 'show'" : '1=1';
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const from = day(Date.now() - 14 * 86400000);
  const pm = new Map(all('SELECT item_id, position, duration, watched FROM progress WHERE profile_id=?', p.id).map((r) => [r.item_id, r]));
  const out = all(`SELECT e.*, s.title AS show_title, s.poster AS show_poster, s.backdrop AS show_backdrop, s.category AS cat FROM items e JOIN items s ON s.id = e.show_id
      WHERE e.type = 'episode' AND e.release_date >= ? AND ${cat} AND ${age.sql} ORDER BY e.release_date DESC LIMIT 120`, from, ...age.args)
    .map((e) => ({ date: e.release_date, id: e.id, showId: e.show_id, showTitle: e.show_title, season: e.season_num, episode: e.episode_num, title: e.title,
      still: e.still, backdrop: e.show_backdrop, poster: e.show_poster, overview: e.overview, inLibrary: true, category: e.cat, progress: pm.get(e.id) ? { ...pm.get(e.id), watched: !!pm.get(e.id).watched } : null }));
  const have = new Set(out.map((x) => `${x.showId}:${x.season}:${x.episode}`));
  const stale = [];
  for (const s of all(`SELECT s.* FROM items s WHERE s.type = 'show' AND s.credits IS NOT NULL AND ${cat} AND ${age.sql}`, ...age.args)) {
    const cr = parseJson(s.credits, {});
    if (cr.status === 'Returning Series' && (!s.ratings_at || Date.now() - s.ratings_at > 86400000)) stale.push(s.id);
    const n = cr.nextEpisode;
    if (!n || !n.date || n.date < from || have.has(`${s.id}:${n.season}:${n.episode}`)) continue;
    out.push({ date: n.date, id: null, showId: s.id, showTitle: s.title, season: n.season, episode: n.episode, title: n.title || '', backdrop: s.backdrop, poster: s.poster, inLibrary: false, category: s.category });
  }
  // Prochains épisodes : on rafraîchit en arrière-plan les séries en cours (une fois par jour)
  if (stale.length) scheduleRatings(stale.slice(0, 40));
  out.sort((a, b) => a.date.localeCompare(b.date) || a.showTitle.localeCompare(b.showTitle));
  sendJson(ctx.res, out);
});

// Statistiques personnelles : temps passé, genres, séries préférées, mois par mois, « votre année »
router.get('/api/stats', (ctx) => {
  const p = requireProfile(ctx);
  const year = Number(ctx.url.searchParams.get('year')) || new Date().getFullYear();
  const rows = all(`SELECT pr.position, pr.duration AS pdur, pr.watched, pr.updated_at, i.id, i.type, i.title, i.duration, i.runtime, i.genres, i.show_id, i.poster, i.credits, i.category,
      s.title AS show_title, s.poster AS show_poster, s.genres AS show_genres, s.credits AS show_credits, s.category AS show_cat
    FROM progress pr JOIN items i ON i.id = pr.item_id LEFT JOIN items s ON s.id = i.show_id WHERE pr.profile_id = ?`, p.id);
  const secs = (r) => (r.watched ? (r.duration || r.pdur || (r.runtime || 0) * 60) : (r.position || 0));
  const inYear = (r) => new Date(r.updated_at).getFullYear() === year;
  const sum = (list) => list.reduce((n, r) => n + secs(r), 0);
  const yr = rows.filter(inYear);
  const months = Array.from({ length: 12 }, (_, m) => ({ m, hours: Math.round(sum(yr.filter((r) => new Date(r.updated_at).getMonth() === m)) / 36) / 100 }));
  const genres = new Map(), people = new Map(), shows = new Map(), movies = [];
  for (const r of yr) {
    const t = secs(r);
    for (const g of parseJson(r.type === 'episode' ? r.show_genres : r.genres, [])) genres.set(g, (genres.get(g) || 0) + t);
    const cr = parseJson(r.type === 'episode' ? r.show_credits : r.credits, null);
    if (cr) for (const x of [...(cr.directors || []), ...(cr.cast || []).slice(0, 5)]) people.set(x.name, (people.get(x.name) || 0) + (r.type === 'episode' ? 0.2 : 1));
    if (r.type === 'episode') {
      const sh = shows.get(r.show_id) || { id: r.show_id, title: r.show_title, poster: r.show_poster, eps: 0, secs: 0, anime: r.show_cat === 'anime' };
      if (r.watched) sh.eps++;
      sh.secs += t; shows.set(r.show_id, sh);
    } else if (r.type === 'movie' && r.watched) movies.push({ id: r.id, title: r.title, poster: r.poster, at: r.updated_at });
  }
  const days = new Set(yr.map((r) => new Date(r.updated_at).toISOString().slice(0, 10)));
  // Plus longue série de jours consécutifs avec au moins une lecture
  let best = 0, cur = 0, prev = null;
  for (const d of [...days].sort()) { const t = Date.parse(d); cur = prev != null && t - prev === 864e5 ? cur + 1 : 1; best = Math.max(best, cur); prev = t; }
  const totalH = Math.round(sum(yr) / 36) / 100;
  const topGenres = [...genres].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, t]) => ({ name: g, hours: Math.round(t / 36) / 100 }));
  sendJson(ctx.res, {
    year, years: [...new Set(rows.map((r) => new Date(r.updated_at).getFullYear()))].sort((a, b) => b - a),
    totalHours: totalH, allTimeHours: Math.round(sum(rows) / 36) / 100,
    movies: movies.length, episodes: yr.filter((r) => r.type === 'episode' && r.watched).length, clips: yr.filter((r) => r.type === 'clip').length,
    days: days.size, streak: best, months, genres: topGenres,
    topShows: [...shows.values()].filter((x) => x.eps || x.secs >= 600).sort((a, b) => b.secs - a.secs).slice(0, 6).map((x) => ({ ...x, hours: Math.round(x.secs / 36) / 100 })),
    lastMovies: movies.sort((a, b) => b.at - a.at).slice(0, 6),
    person: [...people].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    bestMonth: months.reduce((a, b) => (b.hours > a.hours ? b : a), months[0]),
  });
});

// Titres de la médiathèque où apparaît une personne (distribution ou équipe)
router.get('/api/people', (ctx) => {
  const p = requireProfile(ctx);
  const name = String(ctx.url.searchParams.get('name') || '').trim();
  if (!name) return sendJson(ctx.res, []);
  const age = ageClause(p);
  const idx = statusIndex(p.id);
  const needle = `%"name":${JSON.stringify(name).replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = all(`SELECT i.* FROM items i WHERE i.type IN ('movie','show') AND i.credits LIKE ? ESCAPE '\\' AND ${age.sql} ORDER BY i.year DESC`, needle, ...age.args);
  sendJson(ctx.res, rows.map((i) => withStatus(card(i), idx)));
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
  // Série ajoutée à « Ma liste » : ses nouvelles saisons seront demandées à Seerr
  const it = get('SELECT type FROM items WHERE id = ?', id);
  const follows = !exists && it && it.type === 'show' && seerrOn() && followMode() !== 'off';
  if (follows) setTimeout(() => runWatch().catch(() => {}), 2000);
  sendJson(ctx.res, { inList: !exists, follows });
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

// Le lecteur signale ce qu'il joue (tableau de bord : lectures en cours)
router.post('/api/nowplaying', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  if (b.stop) { stopHeartbeat(ctx.auth.token); return sendJson(ctx.res, { ok: true }); }
  const item = get('SELECT i.*, s.title AS show_title, s.poster AS show_poster, s.backdrop AS show_backdrop FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id = ?', Number(b.itemId));
  if (!item) throw new HttpError(404, 'Introuvable');
  const label = item.type === 'episode' ? `${item.show_title} S${item.season_num}É${item.episode_num}` : item.title;
  heartbeat(ctx.auth.token, {
    itemId: item.id, label, title: item.title, showTitle: item.show_title || null, showId: item.show_id || null, type: item.type,
    season: item.season_num, episode: item.episode_num, poster: item.show_poster || item.poster, backdrop: item.still || item.backdrop || item.show_backdrop,
    profile: p.name, avatar: p.avatar, deviceName: deviceLabel(ctx.req.headers['user-agent']), ip: ctx.req.socket.remoteAddress,
    position: Math.max(0, Number(b.position) || 0), duration: Math.max(0, Number(b.duration) || 0), paused: !!b.paused, live: !!b.live,
    mode: String(b.mode || ''), quality: String(b.quality || ''), hw: b.hw ? String(b.hw) : null, sessionId: b.sessionId || null,
  });
  sendJson(ctx.res, { ok: true });
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

  const decision = decide(probe, { caps: b.caps, audioOrder, quality: b.preview ? '480p' : b.quality || 'auto', burnSub: b.preview ? null : burnIndex, maxBitrate: Number(b.maxBitrate) || 0 });
  decision.burnIndex = b.preview ? null : burnIndex;
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
  const prev = item.type === 'episode' ? prevEpisode(item) : null;
  if (item.type === 'episode') scheduleSeason(item.parent_id, true); // génériques prêts pour la suite
  sendJson(ctx.res, {
    itemId: item.id, type: item.type, mode: decision.mode, reason: decision.reason, url, sessionId, offset,
    hwLabel: decision.mode === 'transcode' ? hw.label : null,
    duration: probe.duration, title: item.show_title || item.title, showId: item.show_id || null, season: item.season_num ?? null,
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
    prev: prev ? { id: prev.id, title: prev.title, season: prev.season_num, episode: prev.episode_num } : null,
    segments: item.type === 'episode' ? getSegments(item) : { intro: null, credits: null },
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
  else if (!b.preview) setSetting(`last_channel:${p.id}`, { id: item.id, at: Date.now() });
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

// Fichier vidéo qui représente un titre : le film lui-même, ou le premier épisode d'une série / saison
function playableOf(item) {
  if (!item) return null;
  if (item.path && item.type !== 'channel') return item;
  if (item.type === 'show' || item.type === 'season') {
    const col = item.type === 'show' ? 'show_id' : 'parent_id';
    return get(`SELECT * FROM items WHERE type='episode' AND ${col} = ? AND path IS NOT NULL ORDER BY season_num = 0, season_num, episode_num LIMIT 1`, item.id) || null;
  }
  return null;
}

router.get('/api/items/:id/thumb', async (ctx) => {
  const item = playableOf(get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id)));
  if (!item) throw new HttpError(404, 'Introuvable');
  const file = await thumbnail(item, item.duration);
  sendFile(ctx.req, ctx.res, file, { cache: 'public, max-age=2592000, immutable' });
});

// Aperçu muet joué au survol d'une affiche
router.get('/api/items/:id/preview', async (ctx) => {
  const item = playableOf(get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id)));
  if (!item) throw new HttpError(404, 'Introuvable');
  const file = await previewClip(item);
  sendFile(ctx.req, ctx.res, file, { cache: 'public, max-age=2592000, immutable' });
});

const photoFetch = new Map();
router.get('/img/:name', async (ctx) => {
  const name = path.basename(ctx.params.name);
  // Photos des acteurs : récupérées chez TMDB à la première demande, puis gardées sur le serveur
  const m = /^t_w185_([\w.]+\.(?:jpg|png))$/.exec(name);
  if (m && !fs.existsSync(path.join(imagesDir, name))) {
    if (!photoFetch.has(name)) photoFetch.set(name, downloadImage(`/${m[1]}`, 'w185').finally(() => setTimeout(() => photoFetch.delete(name), 60000)));
    if (!(await photoFetch.get(name))) throw new HttpError(404, 'Photo indisponible');
  }
  const src = path.join(imagesDir, name);
  // Version réduite (affiches des grilles, vignettes) : faite une fois par ffmpeg, puis gardée
  const w = Number(ctx.url.searchParams.get('w'));
  if ([185, 342, 500, 780].includes(w) && /\.(jpe?g|png|webp)$/i.test(name) && fs.existsSync(src)) {
    const out = path.join(imagesDir, 'w', `${w}_${name.replace(/\.(png|webp)$/i, '.jpg')}`);
    if (!fs.existsSync(out)) {
      if (!resizing.has(out)) resizing.set(out, resizeImage(src, out, w).finally(() => resizing.delete(out)));
      const ok = await resizing.get(out);
      if (!ok) return sendFile(ctx.req, ctx.res, src, { cache: 'public, max-age=2592000, immutable' });
    }
    return sendFile(ctx.req, ctx.res, out, { cache: 'public, max-age=2592000, immutable' });
  }
  sendFile(ctx.req, ctx.res, src, { cache: 'public, max-age=2592000, immutable' });
});
const resizing = new Map();
function resizeImage(src, out, w) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale='min(${w},iw)':-2`, '-q:v', '4', '-y', `${out}.tmp.jpg`], { timeout: 20000 }, (err) => {
      if (err) { try { fs.unlinkSync(`${out}.tmp.jpg`); } catch { /* */ } return resolve(false); }
      try { fs.renameSync(`${out}.tmp.jpg`, out); resolve(true); } catch { resolve(false); }
    });
  });
}

// ------------------------------------------------------------------ nouveautés et demandes (Seerr)
router.get('/api/discover', async (ctx) => {
  requireProfile(ctx);
  const kind = ['movie', 'show', 'anime'].includes(ctx.url.searchParams.get('kind')) ? ctx.url.searchParams.get('kind') : 'movie';
  sendJson(ctx.res, { available: discoverAvailable(), sections: await discoverTitles(kind) });
});
router.get('/api/discover/status', async (ctx) => {
  requireProfile(ctx);
  if (!seerrOn()) return sendJson(ctx.res, { state: 'off' });
  const q = ctx.url.searchParams;
  const item = { type: q.get('type') === 'movie' ? 'movie' : 'tv', tmdbId: Number(q.get('tmdbId')) || null, anilistId: Number(q.get('anilistId')) || null, title: q.get('title') || '', original: q.get('original') || '' };
  const id = await resolveTmdb(item).catch(() => null);
  if (!id) return sendJson(ctx.res, { state: 'unknown' });
  try { sendJson(ctx.res, { tmdbId: id, ...(await seerrStatus(item.type, id)) }); } catch (e) { sendJson(ctx.res, { state: 'error', error: e.message }); }
});
router.post('/api/discover/request', async (ctx) => {
  const p = requireProfile(ctx);
  if (p.max_age != null) throw new HttpError(403, 'Les profils enfants ne peuvent pas faire de demande');
  if (!seerrOn()) throw new HttpError(400, 'Reliez Seerr dans Réglages pour demander un titre');
  const b = await readBody(ctx.req);
  const item = { type: b.type === 'movie' ? 'movie' : 'tv', tmdbId: Number(b.tmdbId) || null, anilistId: Number(b.anilistId) || null, title: b.title || '', original: b.original || '' };
  const id = await resolveTmdb(item);
  if (!id) throw new HttpError(404, 'Titre introuvable sur TMDB, Seerr ne peut pas le demander');
  try { sendJson(ctx.res, { tmdbId: id, ...(await seerrRequest(item.type, id, { userId: seerrUserOf(p.id) })) }); } catch (e) { throw new HttpError(502, e.message); }
});

// ------------------------------------------------------------------ téléchargements (regarder sans réseau)
router.get('/api/items/:id/download', (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  if (getSetting('allow_downloads', true) === false && !p.is_admin) throw new HttpError(403, 'Téléchargements désactivés par l’administrateur');
  const name = `${niceName(item)}${path.extname(item.path)}`;
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  sendFile(ctx.req, ctx.res, item.path, { cache: 'no-store' });
});
router.post('/api/items/:id/download', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  const targets = item.type === 'season' ? all("SELECT * FROM items WHERE type='episode' AND parent_id=? ORDER BY episode_num", item.id)
    : item.type === 'show' ? [] : [item];
  if (!targets.length || targets.some((t) => !t.path)) throw new HttpError(400, 'Rien à télécharger');
  sendJson(ctx.res, targets.map((t) => prepareDownload(t, b.quality, p.id)));
});
router.get('/api/downloads', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, listJobs(p.id)); });
router.get('/api/downloads/:job/file', (ctx) => {
  requireProfile(ctx);
  const j = getJob(ctx.params.job);
  if (!j || j.state !== 'ready') throw new HttpError(404, 'Pas encore prêt');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${j.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(j.name)}`);
  sendFile(ctx.req, ctx.res, j.file, { cache: 'no-store', type: 'video/mp4' });
});
router.del('/api/downloads/:job', (ctx) => { requireProfile(ctx); cancelJob(ctx.params.job); sendJson(ctx.res, { ok: true }); });

// ------------------------------------------------------------------ notifications sur cet appareil (Web Push)
router.get('/api/push/key', (ctx) => { requireProfile(ctx); sendJson(ctx.res, { key: vapidPublicKey() }); });
router.post('/api/push/subscribe', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  try { savePushSub(p.id, b.subscription, deviceLabel(ctx.req.headers['user-agent'])); } catch (e) { throw new HttpError(400, e.message); }
  sendJson(ctx.res, { ok: true });
});
router.post('/api/push/unsubscribe', async (ctx) => {
  requireProfile(ctx);
  const b = await readBody(ctx.req);
  removePushSub(String(b.endpoint || ''));
  sendJson(ctx.res, { ok: true });
});
router.post('/api/push/test', async (ctx) => {
  const p = requireProfile(ctx);
  const r = await notify({ title: 'Venus', body: `Les notifications fonctionnent sur cet appareil, ${p.name}.`, url: '/' }, { profileId: p.id });
  sendJson(ctx.res, r);
});
router.post('/api/admin/notify/test', async (ctx) => {
  requireAdmin(ctx);
  const r = await notify({ title: 'Test de Venus', body: 'Si vous lisez ceci, les notifications arrivent bien.', url: '/' });
  sendJson(ctx.res, r);
});

// ------------------------------------------------------------------ sous-titres en ligne (OpenSubtitles)
router.get('/api/items/:id/subtitles/search', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  if (!osOn()) return sendJson(ctx.res, { available: false, items: [] });
  const langs = ctx.url.searchParams.get('lang') || [p.subtitle_lang || 'fr', 'en'].filter((v, i, a) => a.indexOf(v) === i).join(',');
  try { sendJson(ctx.res, { available: true, items: await searchSubs(item.id, langs) }); } catch (e) { throw new HttpError(502, e.message); }
});
router.post('/api/items/:id/subtitles', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  const b = await readBody(ctx.req);
  try { sendJson(ctx.res, await downloadSub(item.id, b.fileId, b.lang)); } catch (e) { throw new HttpError(502, e.message); }
});

// Recherche : titres pas encore dans Venus (TMDB, ou Seerr sans clé TMDB)
router.get('/api/search/online', async (ctx) => {
  requireProfile(ctx);
  const q = ctx.url.searchParams.get('q') || '';
  if (!tmdbKey() && !seerrOn()) return sendJson(ctx.res, { available: false, items: [] });
  try { sendJson(ctx.res, { available: true, items: (await searchOnline(q)).filter((x) => !x.inLibrary) }); }
  catch (e) { sendJson(ctx.res, { available: true, items: [], error: e.message }); }
});

// ------------------------------------------------------------------ mes envies (favoris pas encore dans Venus)
router.get('/api/wishlist', async (ctx) => {
  const p = requireProfile(ctx);
  const list = wishlistOf(p.id);
  // État Seerr de chaque titre (demandé, en téléchargement, disponible…), en parallèle et mis en cache
  if (seerrOn()) await Promise.all(list.map(async (w) => { try { w.seerr = await seerrStatus(w.type, w.tmdbId); } catch (e) { w.seerr = { state: 'error', error: e.message }; } }));
  sendJson(ctx.res, { seerr: seerrOn(), auto: autoRequest(), follow: followMode(), kids: p.max_age != null, items: list });
});
router.get('/api/wishlist/has', async (ctx) => {
  const p = requireProfile(ctx);
  const q = ctx.url.searchParams;
  const item = { type: q.get('type') === 'movie' ? 'movie' : 'tv', tmdbId: Number(q.get('tmdbId')) || null, anilistId: Number(q.get('anilistId')) || null, title: q.get('title') || '', original: q.get('original') || '' };
  const id = item.tmdbId || await resolveTmdb(item).catch(() => null);
  sendJson(ctx.res, { tmdbId: id, inWishlist: id ? inWishlist(p.id, item.type, id) : false });
});
router.post('/api/wishlist', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = { type: b.type === 'movie' ? 'movie' : 'tv', tmdbId: Number(b.tmdbId) || null, anilistId: Number(b.anilistId) || null, title: b.title || '', original: b.original || '' };
  const id = item.tmdbId || await resolveTmdb(item).catch(() => null);
  if (!id) throw new HttpError(404, 'Titre introuvable sur TMDB');
  const r = await addWish(p, { ...b, type: item.type, tmdbId: id });
  sendJson(ctx.res, { tmdbId: id, ...r, auto: autoRequest() && seerrOn() && p.max_age == null });
});
router.del('/api/wishlist/:type/:tmdbId', (ctx) => {
  const p = requireProfile(ctx);
  sendJson(ctx.res, removeWish(p.id, ctx.params.type, Number(ctx.params.tmdbId)));
});

// ------------------------------------------------------------------ Seerr : connexion par compte, utilisateurs, suivi
router.post('/api/admin/seerr/login', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  let r;
  try { r = await seerrLogin({ url: b.url, method: b.method, user: b.user, password: b.password }); } catch (e) { throw new HttpError(400, e.message); }
  try { await seerrTest({ url: r.url, key: r.key }); } catch (e) { throw new HttpError(400, `Seerr : ${e.message}`); }
  setSetting('seerr_url', r.url); setSetting('seerr_key', r.key);
  logActivity('seerr', `Seerr relié avec le compte « ${r.user.name} »`);
  runWatch().catch(() => {});
  sendJson(ctx.res, { ok: true, user: r.user });
});
router.get('/api/admin/seerr/users', async (ctx) => {
  requireAdmin(ctx);
  if (!seerrOn()) throw new HttpError(400, 'Reliez d’abord Seerr');
  let users;
  try { users = await listSeerrUsers(); } catch (e) { throw new HttpError(502, e.message); }
  sendJson(ctx.res, { users, links: seerrUsers(), profiles: all('SELECT * FROM profiles ORDER BY id').map(publicProfile), auto: autoRequest(), follow: followMode(), watch: watchState });
});
router.put('/api/admin/seerr/users', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (b.profileId) linkSeerrUser(Number(b.profileId), b.seerrUserId ? Number(b.seerrUserId) : null);
  if (typeof b.auto === 'boolean') setSetting('seerr_auto', b.auto ? '1' : '0');
  if (['off', 'mylist', 'all'].includes(b.follow)) setSetting('seerr_follow', b.follow);
  sendJson(ctx.res, { ok: true, links: seerrUsers(), auto: autoRequest(), follow: followMode() });
});
router.post('/api/admin/seerr/sync', async (ctx) => {
  requireAdmin(ctx);
  if (!seerrOn()) throw new HttpError(400, 'Reliez d’abord Seerr');
  sendJson(ctx.res, { ...(await runWatch()) });
});
router.get('/api/discover/trailer', async (ctx) => {
  requireProfile(ctx);
  const q = ctx.url.searchParams;
  sendJson(ctx.res, { trailer: await trailerFor(q.get('type'), Number(q.get('tmdbId'))).catch(() => null) });
});

// ------------------------------------------------------------------ administration
router.get('/api/admin', (ctx) => {
  requireAdmin(ctx);
  const counts = Object.fromEntries(all('SELECT type, COUNT(*) n FROM items GROUP BY type').map((r) => [r.type, r.n]));
  sendJson(ctx.res, {
    version: config.version,
    hw: { type: hw.type, label: hw.label, tested: hw.tested, tonemap: hw.filters.has('zscale') || hw.filters.has('tonemap_vaapi') || hw.filters.has('tonemap_cuda') },
    sessions: [...sessions.values()].map((s) => s.info()),
    runtime: { kind: runtime.kind, unprivileged: runtime.unprivileged, canMount: runtime.canMount, mount: runtime.canMount && !runtime.unprivileged ? null : mountAdvice(), gpu: gpuAdvice() },
    scan: scanState,
    libraries: all('SELECT * FROM libraries').map(publicLibrary),
    counts,
    unmatched: all("SELECT id, type, title, year FROM items WHERE type IN ('movie','show') AND matched = -1 ORDER BY title LIMIT 200"),
    profiles: all('SELECT * FROM profiles ORDER BY id').map(publicProfile),
    devices: all('SELECT t.device, t.last_seen, p.name AS profile FROM tokens t LEFT JOIN profiles p ON p.id = t.profile_id ORDER BY t.last_seen DESC LIMIT 30'),
    settings: {
      serverName: getSetting('server_name', 'Venus'), tmdbConfigured: !!tmdbKey(), hwaccel: getSetting('hwaccel', 'auto'),
      maxSessions: getSetting('max_sessions', 6), scanInterval: getSetting('scan_interval', 60), detectSegments: String(getSetting('detect_segments', '1')) !== '0',
      kidsAllowUnrated: getSetting('kids_allow_unrated', false), metadataLang: getSetting('metadata_lang', 'fr-FR'),
      omdbConfigured: !!omdbKey(), simklConfigured: !!simklId(), seerrUrl: seerrConf().url, seerrConfigured: seerrOn(), seerrAuto: autoRequest(), seerrFollow: followMode(), opensubtitlesConfigured: osOn(), notify: { ...channels(), telegramToken: channels().telegramToken ? '••••' : '', discord: channels().discord ? '••••' : '', notifyNew: String(getSetting('notify_new', '1')) !== '0', push: pushCount() }, autoBackup: String(getSetting('auto_backup', '1')) !== '0', opensubtitlesUser: getSetting('opensubtitles_user', ''),
    },
    system: { cpus: os.cpus().length, load: os.loadavg()[0], memFree: os.freemem(), memTotal: os.totalmem(), uptime: process.uptime() },
  });
});

// Tableau de bord
const supervised = () => runtime.kind === 'docker' || !!process.env.INVOCATION_ID || !!process.env.VENUS_SUPERVISED || (!!process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME !== '0');
function diskOf(dir) {
  try { const st = fs.statfsSync(dir); return { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { return null; }
}
router.get('/api/admin/dashboard', (ctx) => {
  requireAdmin(ctx);
  const counts = Object.fromEntries(all('SELECT type, COUNT(*) n FROM items GROUP BY type').map((r) => [r.type, r.n]));
  const anime = get("SELECT COUNT(*) n FROM items WHERE type = 'show' AND category = 'anime'").n;
  const tot = get("SELECT SUM(size) size, SUM(duration) dur FROM items WHERE type IN ('movie','episode','clip')");
  // Disques : données de Venus et chaque médiathèque (un seul relevé par disque)
  const disks = [];
  const seen = new Set();
  for (const [name, dir] of [['Données de Venus', config.dataDir], ['Conversion', config.transcodeDir], ...all('SELECT name, path FROM libraries').map((l) => [l.name, l.path])]) {
    const d = dir && diskOf(dir);
    if (!d || !d.total) continue;
    const k = `${d.total}:${d.free}`;
    if (seen.has(k)) { const x = disks.find((y) => y.key === k); if (x && !x.names.includes(name)) x.names.push(name); continue; }
    seen.add(k);
    disks.push({ key: k, names: [name], total: d.total, free: d.free });
  }
  const tokens = all('SELECT t.token, t.device, t.created_at, t.last_seen, p.name AS profile, p.avatar FROM tokens t LEFT JOIN profiles p ON p.id = t.profile_id ORDER BY t.last_seen DESC LIMIT 40');
  const live = nowPlaying();
  const hlsById = new Map([...sessions.values()].map((x) => [x.id, x.info()]));
  sendJson(ctx.res, {
    server: {
      name: getSetting('server_name', 'Venus'), version: config.version, uptime: process.uptime(), node: process.version,
      os: `${os.type()} ${os.release()}`, platform: process.platform, arch: process.arch, host: os.hostname(), runtime: runtime.kind,
      canRestart: supervised(), hw: { type: hw.type, label: hw.label, tested: hw.tested },
    },
    counts: { movie: counts.movie || 0, show: (counts.show || 0) - anime, anime, episode: counts.episode || 0, clip: counts.clip || 0, channel: counts.channel || 0, season: counts.season || 0 },
    totals: { size: tot.size || 0, hours: Math.round((tot.dur || 0) / 3600) },
    playing: live.map((e) => ({ ...e, token: undefined, hls: e.sessionId ? hlsById.get(e.sessionId) || null : null })),
    transcodes: [...hlsById.values()].length,
    devices: tokens.map((t) => ({ id: deviceId(t.token), name: deviceLabel(t.device), profile: t.profile, avatar: t.avatar, created: t.created_at, lastSeen: t.last_seen, current: t.token === ctx.auth.token, playing: live.some((e) => e.token === t.token) })),
    tasks: {
      scan: scanState, ratings: ratingsPending(), segments: segmentsPending(),
      unmatched: get("SELECT COUNT(*) n FROM items WHERE type IN ('movie','show') AND matched = -1").n,
      noRatings: get("SELECT COUNT(*) n FROM items WHERE type IN ('movie','show') AND ratings_at IS NULL").n,
    },
    recent: all("SELECT * FROM items WHERE type IN ('movie','show','clip') ORDER BY added_at DESC LIMIT 12").map((i) => card(i)),
    activity: recentActivity(30),
    system: { cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || '', load: os.loadavg(), memFree: os.freemem(), memTotal: os.totalmem(), rss: process.memoryUsage().rss, disks },
    libraries: all('SELECT * FROM libraries').map((l) => ({ ...publicLibrary(l), items: get("SELECT COUNT(*) n FROM items WHERE library_id = ? AND type IN ('movie','show','clip','channel')", l.id).n })),
    loginCode: loginCode(),
  });
});
router.post('/api/admin/login-code', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, loginCode({ renew: true }));
});
// Commande envoyée à un appareil : pause, reprise, arrêt de la lecture, message
router.post('/api/admin/control', async (ctx) => {
  const p = requireAdmin(ctx);
  const b = await readBody(ctx.req);
  const cmd = ['pause', 'play', 'stop', 'message'].includes(b.cmd) ? b.cmd : null;
  if (!cmd) throw new HttpError(400, 'Commande inconnue');
  const text = String(b.text || '').trim().slice(0, 300);
  if (cmd === 'message' && !text) throw new HttpError(400, 'Message vide');
  if (b.all) {
    control.emit('cmd', { all: true, cmd, text, from: p.name });
    logActivity('message', `${p.name} a envoyé un message à tous les appareils`);
    return sendJson(ctx.res, { ok: true });
  }
  const token = tokenOfDevice(String(b.device || '')) || all('SELECT token FROM tokens').map((r) => r.token).find((t) => deviceId(t) === String(b.device || ''));
  if (!token) throw new HttpError(404, 'Appareil introuvable');
  if (!control.listenerCount('cmd')) throw new HttpError(409, 'Aucun appareil connecté pour le moment');
  control.emit('cmd', { token, cmd, text, from: p.name });
  if (cmd === 'stop') stopHeartbeat(token);
  logActivity(cmd === 'message' ? 'message' : 'control', cmd === 'message' ? `${p.name} a envoyé un message : « ${text} »` : `${p.name} : ${cmd === 'pause' ? 'pause' : cmd === 'play' ? 'reprise' : 'arrêt'} de la lecture sur un appareil`);
  sendJson(ctx.res, { ok: true });
});
// Déconnecter un appareil (il devra de nouveau saisir le mot de passe ou un code)
router.del('/api/admin/devices/:id', (ctx) => {
  const p = requireAdmin(ctx);
  const t = all('SELECT token FROM tokens').map((r) => r.token).find((x) => deviceId(x) === ctx.params.id);
  if (!t) throw new HttpError(404, 'Appareil introuvable');
  if (t === ctx.auth.token) throw new HttpError(400, 'C’est l’appareil que vous utilisez');
  control.emit('cmd', { token: t, cmd: 'stop', from: p.name });
  stopHeartbeat(t);
  run('DELETE FROM tokens WHERE token = ?', t);
  logActivity('device', `${p.name} a déconnecté un appareil`);
  sendJson(ctx.res, { ok: true });
});
// Qualité de la médiathèque : résolution, codec, HDR, débit, taille ; titres à améliorer
router.get('/api/admin/quality', (ctx) => {
  requireAdmin(ctx);
  const rows = all(`SELECT i.id, i.type, i.title, i.year, i.poster, i.size, i.probe, i.tmdb_id, i.show_id, i.duration FROM items i WHERE i.type IN ('movie','episode') AND i.probe IS NOT NULL`);
  const shows = new Map(all("SELECT id, title, year, poster, tmdb_id FROM items WHERE type = 'show'").map((r) => [r.id, r]));
  const groups = new Map();
  for (const r of rows) {
    const p = parseJson(r.probe, null);
    if (!p || !p.video) continue;
    const key = r.type === 'movie' ? `m${r.id}` : `s${r.show_id}`;
    const h = p.video.height || 0, w = p.video.width || 0;
    const res = w >= 3200 || h >= 1800 ? '4K' : w >= 1800 || h >= 1000 ? '1080p' : w >= 1200 || h >= 700 ? '720p' : 'SD';
    const codec = String(p.video.codec || '').toLowerCase();
    const g = groups.get(key) || { id: r.type === 'movie' ? r.id : r.show_id, type: r.type === 'movie' ? 'movie' : 'show', title: r.type === 'movie' ? r.title : (shows.get(r.show_id) || {}).title, year: r.type === 'movie' ? r.year : (shows.get(r.show_id) || {}).year,
      poster: r.type === 'movie' ? r.poster : (shows.get(r.show_id) || {}).poster, tmdbId: r.type === 'movie' ? r.tmdb_id : (shows.get(r.show_id) || {}).tmdb_id, files: 0, size: 0, res: {}, codecs: {}, hdr: 0, bitrate: 0, audio51: 0, dur: 0 };
    g.files++; g.size += r.size || 0; g.dur += r.duration || 0;
    g.res[res] = (g.res[res] || 0) + 1; g.codecs[codec] = (g.codecs[codec] || 0) + 1;
    if (p.video.hdr || p.video.dovi) g.hdr++;
    if ((p.audio || []).some((a) => a.channels >= 6)) g.audio51++;
    g.bitrate = Math.max(g.bitrate, p.bitrate || 0);
    groups.set(key, g);
  }
  const order = ['SD', '720p', '1080p', '4K'];
  const out = [...groups.values()].map((g) => {
    const res = Object.keys(g.res).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]; // la moins bonne
    const codec = Object.entries(g.codecs).sort((a, b) => b[1] - a[1])[0][0];
    const reasons = [];
    if (res === 'SD') reasons.push('Basse définition');
    else if (res === '720p') reasons.push('720p seulement');
    if (/mpeg4|mpeg2|msmpeg|wmv|vc1|xvid|divx|h263/.test(codec)) reasons.push(`Ancien codec (${codec.toUpperCase()})`);
    if (res === '1080p' && g.bitrate && g.bitrate < 2.2e6 && g.type === 'movie') reasons.push('Débit faible, image compressée');
    return { ...g, res, codec: codec.toUpperCase(), hdr: g.hdr > 0, surround: g.audio51 > 0, reasons, sizePerHour: g.dur ? g.size / (g.dur / 3600) : 0 };
  });
  const sum = (f) => out.reduce((n, x) => n + f(x), 0);
  sendJson(ctx.res, {
    items: out.sort((a, b) => b.reasons.length - a.reasons.length || order.indexOf(a.res) - order.indexOf(b.res) || String(a.title).localeCompare(String(b.title), 'fr')),
    summary: { total: out.length, size: sum((x) => x.size), byRes: Object.fromEntries(order.map((r) => [r, out.filter((x) => x.res === r).length])), hdr: out.filter((x) => x.hdr).length, toImprove: out.filter((x) => x.reasons.length).length,
      codecs: Object.entries(out.reduce((m, x) => { m[x.codec] = (m[x.codec] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]) },
    seerr: seerrOn(),
  });
});
// Demander une meilleure version (4K si Seerr a un serveur 4K, sinon nouvelle demande normale)
router.post('/api/admin/quality/request', async (ctx) => {
  const p = requireAdmin(ctx);
  if (!seerrOn()) throw new HttpError(400, 'Reliez Seerr dans Réglages');
  const b = await readBody(ctx.req);
  const type = b.type === 'movie' ? 'movie' : 'tv';
  try {
    const r = await seerrRequest(type, Number(b.tmdbId), { userId: seerrUserOf(p.id), is4k: !!b.is4k });
    logActivity('seerr', `${p.name} a demandé une meilleure version de « ${b.title || b.tmdbId} »${b.is4k ? ' en 4K' : ''}`);
    sendJson(ctx.res, r);
  } catch (e) { throw new HttpError(502, e.message); }
});

// Sauvegardes de la base
router.get('/api/admin/backups', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { items: listBackups(), auto: String(getSetting('auto_backup', '1')) !== '0', canRestart: supervised() });
});
router.post('/api/admin/backups', (ctx) => {
  const p = requireAdmin(ctx);
  const b = makeBackup({ manual: true });
  logActivity('server', `${p.name} a fait une sauvegarde de la base`);
  sendJson(ctx.res, b);
});
router.get('/api/admin/backups/:name', (ctx) => {
  requireAdmin(ctx);
  const f = backupPath(ctx.params.name);
  if (!/^venus-.*\.db$/.test(path.basename(f)) || !fs.existsSync(f)) throw new HttpError(404, 'Introuvable');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${path.basename(f)}"`);
  sendFile(ctx.req, ctx.res, f, { cache: 'no-store' });
});
router.post('/api/admin/backups/:name/restore', (ctx) => {
  const p = requireAdmin(ctx);
  try { scheduleRestore(ctx.params.name); } catch (e) { throw new HttpError(404, e.message); }
  makeBackup({ manual: true }); // l'état actuel est gardé, au cas où
  logActivity('server', `${p.name} restaure la sauvegarde ${ctx.params.name}`);
  sendJson(ctx.res, { ok: true, restarting: supervised() });
  if (supervised()) setTimeout(() => process.exit(75), 600);
});

router.post('/api/admin/restart', (ctx) => {
  const p = requireAdmin(ctx);
  if (!supervised()) throw new HttpError(400, 'Venus ne tourne pas comme un service : redémarrez-le à la main');
  logActivity('server', `${p.name} a redémarré le serveur`);
  sendJson(ctx.res, { ok: true });
  // Docker et systemd relancent Venus tout seuls
  setTimeout(() => process.exit(75), 600);
});

router.post('/api/admin/ratings/refresh', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { queued: refreshRatings({ force: true }) });
});

router.put('/api/admin/settings', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (b.tmdbKey !== undefined) {
    if (b.tmdbKey && !(await testKey(b.tmdbKey).catch(() => false))) throw new HttpError(400, 'Clé TMDB invalide');
    setSetting('tmdb_key', b.tmdbKey || '');
    if (b.tmdbKey) { run("UPDATE items SET matched = 0 WHERE type IN ('movie','show') AND matched <= 0"); scanAll(); }
  }
  let ratingsChanged = false;
  if (b.omdbKey !== undefined) {
    const k = String(b.omdbKey || '').trim();
    if (k) {
      const r = await fetch(`https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => null);
      if (!r || r.Response === 'False') throw new HttpError(400, r && r.Error ? `Clé OMDb refusée : ${r.Error}` : 'OMDb injoignable');
    }
    setSetting('omdb_key', k); ratingsChanged = true;
  }
  for (const [k, key] of [['ntfyServer', 'ntfy_server'], ['ntfyTopic', 'ntfy_topic'], ['discordWebhook', 'discord_webhook'], ['telegramToken', 'telegram_token'], ['telegramChat', 'telegram_chat'], ['publicUrl', 'public_url']]) {
    if (b[k] !== undefined) setSetting(key, String(b[k] || '').trim());
  }
  if (typeof b.notifyNew === 'boolean') setSetting('notify_new', b.notifyNew ? '1' : '0');
  if (typeof b.autoBackup === 'boolean') setSetting('auto_backup', b.autoBackup ? '1' : '0');
  if (b.opensubtitlesKey !== undefined) setSetting('opensubtitles_key', String(b.opensubtitlesKey || '').trim());
  if (b.opensubtitlesUser !== undefined) { setSetting('opensubtitles_user', String(b.opensubtitlesUser || '').trim()); resetOsLogin(); }
  if (b.opensubtitlesPass !== undefined && b.opensubtitlesPass !== '') { setSetting('opensubtitles_pass', String(b.opensubtitlesPass)); resetOsLogin(); }
  if (b.simklClientId !== undefined) { setSetting('simkl_client_id', String(b.simklClientId || '').trim()); ratingsChanged = true; }
  if (b.seerrUrl !== undefined || b.seerrKey !== undefined) {
    const conf = { url: String(b.seerrUrl ?? seerrConf().url).trim().replace(/\/+$/, ''), key: String(b.seerrKey ?? seerrConf().key).trim() };
    if (conf.url && !/^https?:\/\//.test(conf.url)) conf.url = `http://${conf.url}`;
    if (conf.url && conf.key) { try { await seerrTest(conf); } catch (e) { throw new HttpError(400, `Seerr : ${e.message}`); } }
    setSetting('seerr_url', conf.url); setSetting('seerr_key', conf.key);
  }
  if (ratingsChanged) refreshRatings({ force: true });
  if (b.serverName) setSetting('server_name', String(b.serverName).slice(0, 40));
  if (b.maxSessions) setSetting('max_sessions', Math.max(1, Math.min(20, Number(b.maxSessions))));
  if (typeof b.detectSegments === 'boolean') setSetting('detect_segments', b.detectSegments ? '1' : '0');
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

// Ce serveur peut-il monter lui-même un partage ? Sinon : conseil adapté (LXC Proxmox, Docker…)
router.get('/api/admin/network/capability', (ctx) => {
  requireAdmin(ctx);
  const blocked = !runtime.canMount || runtime.unprivileged;
  sendJson(ctx.res, { canMount: !blocked, advice: blocked ? mountAdvice() : null });
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
      await unmountRemote(id, remote);
      throw new HttpError(422, res.error);
    }
    const full = path.join(res.path, remote.sub);
    if (!fs.existsSync(full)) {
      run('DELETE FROM libraries WHERE id = ?', id);
      await unmountRemote(id, remote);
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
  if (lib && lib.remote) { await unmountRemote(lib.id, remoteOf(lib)); netState.delete(lib.id); }
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
  let asked = ctx.url.searchParams.get('path') || '/';
  // « start » : premier dossier pertinent qui existe sur ce système
  if (asked === 'start') {
    const home = os.homedir();
    const tries = process.platform === 'win32' ? ['/']
      : process.platform === 'darwin' ? [path.join(home, 'Movies'), '/Volumes', home]
        : ['/media', '/mnt', '/srv', home];
    asked = tries.find((t) => { try { return t === '/' || fs.statSync(t).isDirectory(); } catch { return false; } }) || '/';
  }
  // Windows : la racine liste les lecteurs (C:, D:…) et les dossiers de partage déjà connectés
  if (process.platform === 'win32' && (asked === '/' || asked === '\\' || asked === '')) {
    const drives = [];
    for (let c = 67; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; try { fs.accessSync(d); drives.push(d); } catch { /* lecteur absent */ } }
    return sendJson(ctx.res, { path: '/', parent: '/', dirs: drives, absolute: true });
  }
  const dir = path.resolve(asked);
  const exts = (ctx.url.searchParams.get('files') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  let files = [];
  if (exts.length) {
    try {
      files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && exts.includes(path.extname(e.name).slice(1).toLowerCase()))
        .map((e) => e.name).sort((a, b) => a.localeCompare(b));
    } catch { /* illisible : traité plus bas */ }
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name).sort((a, b) => a.localeCompare(b));
  } catch { throw new HttpError(400, 'Dossier illisible'); }
  const parent = path.dirname(dir);
  sendJson(ctx.res, { path: dir, parent: process.platform === 'win32' && parent === dir ? '/' : parent, dirs: entries, files });
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
