// Routes de l'API
import fs from 'node:fs';
import crypto from 'node:crypto';
import { channelCat, neverHide, CATEGORIES } from './channel-cats.js';
import { checkSource, importSource } from './import-media.js';
import { remoteStatus, startRemote } from './remote-access.js';
import { startLink, pollLink, unlink, linkState, importTrakt, traktWatched, setTraktPush, traktSecret } from './trakt-sync.js';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Router, HttpError, readBody, sendJson, sendFile } from './http.js';
import { db, all, get, run, tx, itemsVersion, getSetting, setSetting } from './db.js';
import { slugFor, resolveSlug, cleanName, pathFor, resolveEpisode } from './slugs.js';
import { V, validate, passwordProblem, logSecurity, securityLog, listBans, unbanIp, banIp, attemptStats, isSecure, httpsMode } from './security.js';
import { twofaOn, startChallenge, verifyChallenge, resendChallenge, twofaEmail, twofaStats, maskEmail } from './twofa.js';
import { sendMail, smtpConf, smtpOn } from './smtp.js';
import { lastAudit, runSecurityAudit } from './audit.js';
import { config } from './config.js';
import {
  hashSecret, verifySecret, createToken, requireDevice, requireProfile, requireAdmin,
  isSetup, checkRate, failRate, resetRate, publicProfile, needsRehash, revokeToken, revokeOtherTokens, setTokenProfile, sessionCookie,
} from './auth.js';
import { scanAll, scanState, watchLibraries, events } from './scanner.js';
import { tmdbKey, testKey, searchTmdb, matchMovie, matchShow, downloadImage, tmdb, applyCustom } from './metadata.js';
import { saveRemoteImage, freePosterCandidates, fillMissingPosters, fillMissingBackdrops, fillSeasonPosters, testSources, redoFreePosters } from './posters.js';
import { findTrailerFor } from './youtube.js';
import { guideFor, ensureGuide } from './guide.js';
import { checkChannels, checkState, channelHealth, FREE_TV, IPTV_WORLD, IPTV_WORLD_DEFAULT, iptvWorldLists, iptvListName, reportChannelFailure } from './free-tv.js';
import { canRelay, startRelay, stopRelay, holdRelay, servePlaylistRelay, serveSegmentRelay } from './relay.js';
import { arrConf, arrOn, saveArr, arrOptions, arrSearch, arrAdd, arrQueue, lidarrSearch, lidarrAddAlbum, lidarrAddArtist, lidarrKnown } from './arr.js';
import { runMusicMeta, musicMetaStatus, albumMeta, discographyOf, musicUpcoming, nasAlbums } from './music-meta.js';
import { runBooksMeta, booksMetaStatus, bibliographyOf, booksUpcoming } from './books-meta.js';
import { booksConf, booksOn, saveBooksApp, booksTest, booksSearch, booksAdd } from './books-arr.js';
import { filmography, personPhoto } from './credits-free.js';
import { checkNas, nasHealth } from './nas-health.js';
import { sendSample } from './telegram-media.js';
import { createInvite, inviteFor, markUsed as markInviteUsed, listInvites, cancelInvites, baseUrl, EMAIL_RE } from './invites.js';
import { describe as describeShare } from './netshare.js';
import { optimizedFor, markUsed, pauseForPlayback, optStatus, runOptimize, clearAll as clearOptimized } from './optimize.js';
import { upcomingMovies, upcomingShows, wantedOf, addWanted, removeWanted, grab } from './upcoming.js';
import { checkUpdate, runUpdate, localCommit, updaterInfo, setUpdatePrefs } from './update.js';
import { duplicateGroups, renamePlan, applyRenames, removeEmptyDirs } from './library-tools.js';
import { moveToTrash, recordTrash, listTrash, restoreTrash, purgeTrash, KEEP_DAYS } from './trash.js';
import { brokenFiles, weeklyReport } from './reports.js';
import { setOpinion, opinionOf, genreTaste, tasteScore, storageForecast, logTranscode, transcodeSummary, makeClip, subtitleDrift } from './extras.js';
import {
  decide, startSession, sessions, servePlaylist, serveSegment, subtitleVtt, thumbnail, previewClip, QUALITIES, hw, channelSnapshot, warmSnapshots, transcodePlace,
} from './stream.js';
import { detectHardware } from './hw.js';
import { probeLive, readChapters, cachedProbe } from './probe.js';
import { runTask, listTasks } from './tasks.js';
import { versionLabel } from './versions.js';
import { permsOf, accessProblem, libraryClause, validPerms } from './perms.js';
import { logLines, logText } from './logbuf.js';
import { createApiKey, listApiKeys, revokeApiKey } from './apikeys.js';
import { HOOK_EVENTS, listHooks, saveHooks, testHook, emitHook } from './webhooks.js';
import { programsBetween, programById, nowNext, epgState } from './epg.js';
import { lyricsOf, epubPackage, cbzPages } from './media.js';
import { zipRead } from './zip.js';
import { schedule as scheduleRecording, cancel as cancelRecording, listRecordings, listRules, addRule, removeRule, dvrDir } from './dvr.js';
import { traktId, testTrakt, posterSource, traktFind, downloadTraktImage } from './trakt.js';
import { ensureTrickplay, trickplayInfo, trickplaySheet, trickplayMode, removeTrickplay } from './trickplay.js';
import { runtime, mountAdvice, gpuAdvice } from './env.js';
import { getSegments, scheduleSeason, segmentsPending } from './segments.js';
import { setSubtitleVtt, scheduleDialogues, searchDialogues, dialogueStats } from './dialogues.js';
import { transcribeStatus, downloadModel, requestSubtitles, jobOf, MODELS } from './transcribe.js';
import { lightsStatus, lightsReady, saveLights, huePair, hueLights, wledInfo, setColor, startSession as lightsStart, endSession as lightsEnd, testLights } from './lights.js';
import { getScenes, analyzeScenes, scheduleScenes, highlights as sceneHighlights, generatedChapters, dialoguesOf, recapPlan, buildRecap } from './scenes.js';
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
  // Les autres versions d'un même film n'apparaissent pas dans les listes (choix sur la fiche) ;
  // bibliothèques limitées pour certains profils
  const lib = libraryClause(profile, alias);
  if (!profile || profile.max_age == null) return { sql: `${alias}.version_of IS NULL AND ${lib.sql}`, args: lib.args };
  const allowUnrated = getSetting('kids_allow_unrated', false);
  return {
    sql: `${alias}.version_of IS NULL AND ${lib.sql} AND (${alias}.age <= ?${allowUnrated ? ` OR ${alias}.age IS NULL` : ''})`,
    args: [...lib.args, profile.max_age],
  };
}

// Images et extraits d'un titre : réservés au profil qui a le droit de voir ce titre (âge, bibliothèques).
// Le profil vient du jeton de l'appareil (cookie ou en-tête), comme pour la lecture.
function requireVisible(ctx, item, msg = 'Introuvable') {
  const p = requireProfile(ctx);
  if (!item || !visible(p, item)) throw new HttpError(404, msg);
  return p;
}
const uiPrefsOf = (p) => { try { return JSON.parse((p && p.ui_prefs) || '{}') || {}; } catch { return {}; } };
function visible(profile, item) {
  if (!item) return false;
  const r = permsOf(profile);
  if (!r.admin && Array.isArray(r.libraries) && item.library_id != null && !r.libraries.includes(item.library_id)) return false;
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

const today = () => new Date().toISOString().slice(0, 10);
export function addWatchTime(pid, seconds) {
  if (!(seconds > 0)) return;
  run('INSERT INTO watch_time(profile_id, day, seconds) VALUES(?, ?, ?) ON CONFLICT(profile_id, day) DO UPDATE SET seconds = seconds + excluded.seconds', pid, today(), seconds);
}
export const watchedToday = (pid) => Number((get('SELECT seconds FROM watch_time WHERE profile_id = ? AND day = ?', pid, today()) || {}).seconds || 0);
// Limite quotidienne (profils enfants) : minutes restantes, ou null si pas de limite
export function dailyLeft(p) {
  const r = permsOf(p);
  if (r.admin || !r.dailyMinutes) return null;
  return Math.max(0, Math.round(r.dailyMinutes - watchedToday(p.id) / 60));
}

// Séries : nombre d'épisodes arrivés ces 7 derniers jours (pastille « +2 nouveaux » sur l'affiche)
let freshCache = { at: 0, v: -1, map: new Map() };
function freshEpisodes() {
  if (freshCache.v !== itemsVersion || Date.now() - freshCache.at > 600e3) {
    freshCache = { at: Date.now(), v: itemsVersion, map: new Map(all("SELECT show_id, COUNT(*) n FROM items WHERE type = 'episode' AND added_at > ? GROUP BY show_id", Date.now() - 7 * 864e5).map((r) => [r.show_id, r.n])) };
  }
  return freshCache.map;
}
function card(i, prog) {
  return {
    newEps: i.type === 'show' ? freshEpisodes().get(i.id) || undefined : undefined,
    id: i.id, slug: slugFor(i.id), path: pathFor(i.id), type: i.type, title: i.title, originalTitle: i.original_title, year: i.year, poster: i.poster, backdrop: i.backdrop, logo: i.logo,
    still: i.still, age: i.age, cert: i.certification, vote: i.vote, genres: parseJson(i.genres, []),
    overview: i.overview, runtime: i.runtime || (i.duration ? Math.round(i.duration / 60) : null),
    season: i.season_num, episode: i.episode_num, showId: i.show_id, showTitle: i.show_title,
    progress: prog ? { position: prog.position, duration: prog.duration, watched: !!prog.watched, asleep: !!prog.asleep || undefined } : undefined,
    added: i.added_at, category: i.category, released: i.release_date || null,
    popularity: i.popularity, group: i.grp,
    ratings: i.ratings ? parseJson(i.ratings, null) : null, trailer: i.trailer ? (parseJson(i.trailer, null) || {}).key || null : null, // { none: … } = déjà cherché sans succès
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
const CATEGORY_SQL = `CASE WHEN i.type = 'movie' THEN 'movie' WHEN i.type = 'clip' AND i.category = 'recording' THEN 'recording' WHEN i.type = 'clip' THEN 'clip' WHEN i.type = 'channel' THEN 'channel'
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

function setCookie(ctx, token) {
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, isSecure(ctx.req)));
}

// ------------------------------------------------------------------ installation & connexion
function elsewhereOf(auth) {
  if (!auth || !auth.profile || !auth.token) return null;
  const me = deviceId(auth.token);
  const e = nowPlaying().filter((x) => x.profile === auth.profile.name && x.device !== me && !x.live && x.duration > 0).sort((a, b) => b.seen - a.seen)[0];
  if (!e) return null;
  return { itemId: e.itemId, title: e.showTitle || e.title, sub: e.showTitle ? `S${e.season} É${e.episode}` : null, device: e.deviceName, position: e.position, duration: e.duration, ago: Date.now() - e.seen, paused: !!e.paused };
}
router.get('/api/status', (ctx) => {
  if (ctx.auth && ctx.auth.via === 'header') setCookie(ctx, ctx.auth.token);
  sendJson(ctx.res, {
    // Version : seulement pour un appareil connecté (inutile à l'écran de connexion, utile à un curieux)
    setup: isSetup(), name: getSetting('server_name', 'Venus'), version: ctx.auth ? config.version : undefined,
    loginMessage: String(getSetting('login_message', '') || '') || null, customCss: !!getSetting('custom_css', ''),
    authenticated: !!ctx.auth, profile: publicProfile(ctx.auth?.profile),
    // Lecture en cours de ce profil sur un autre appareil (« Vous regardiez X sur la télé il y a 2 min »)
    elsewhere: elsewhereOf(ctx.auth),
  });
});

router.post('/api/setup', async (ctx) => {
  if (isSetup()) throw new HttpError(409, 'Déjà configuré');
  const b = validate(await readBody(ctx.req), {
    password: V.str({ max: 200, trim: false, label: 'Mot de passe' }), name: V.str({ min: 1, max: 30, label: 'Nom du profil' }),
    serverName: V.str({ max: 40 }), avatar: V.int({ min: 0, max: 50 }), pin: V.pin(), tmdbKey: V.str({ max: 300 }),
    moviesPath: V.str({ max: 1000 }), showsPath: V.str({ max: 1000 }),
  }, { required: ['password', 'name'] });
  const weak = passwordProblem(b.password);
  if (weak) throw new HttpError(400, weak);
  if (!b.pin) throw new HttpError(400, 'Code PIN de l’administrateur obligatoire (4 à 8 chiffres)');
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
    setTokenProfile(t, Number(r.lastInsertRowid));
    return t;
  });
  logSecurity('installation', ctx.ip, 'Venus installé, profil administrateur créé', 'info');
  setCookie(ctx, token);
  watchLibraries();
  scanAll();
  sendJson(ctx.res, { token });
});

function issueToken(ctx, how) {
  const token = createToken(ctx.req.headers['user-agent'] || '');
  logActivity('login', `Nouvel appareil connecté ${how} (${deviceLabel(ctx.req.headers['user-agent'])})`, { device: deviceId(token) });
  logSecurity('connexion', ctx.ip, `Nouvel appareil connecté ${how} (${deviceLabel(ctx.req.headers['user-agent'])})`, 'info');
  emitHook('login.new_device', { how, device: deviceLabel(ctx.req.headers['user-agent']), ip: ctx.ip });
  setCookie(ctx, token);
  return token;
}
router.post('/api/login', async (ctx) => {
  const b = validate(await readBody(ctx.req, 4096), { password: V.str({ max: 200, trim: false, label: 'Mot de passe' }) }, { required: ['password'] });
  checkRate('login', ctx.ip);
  const stored = getSetting('household_password');
  if (!verifySecret(b.password, stored)) { failRate('login', ctx.ip, 'Mot de passe du foyer incorrect'); throw new HttpError(401, 'Mot de passe incorrect'); }
  resetRate('login', ctx.ip);
  if (needsRehash(stored)) setSetting('household_password', hashSecret(b.password));
  // Retenu pour l'audit de sécurité (le mot de passe lui-même n'est jamais gardé en clair)
  const weak = !!passwordProblem(b.password);
  if (weak !== !!getSetting('password_weak', false)) setSetting('password_weak', weak);
  // Double authentification : code envoyé par e-mail avant d'ouvrir la session
  if (twofaOn()) {
    const c = await startChallenge(ctx.ip, deviceLabel(ctx.req.headers['user-agent']));
    return sendJson(ctx.res, { twofa: true, ...c }, 202);
  }
  sendJson(ctx.res, { token: issueToken(ctx, 'avec le mot de passe') });
});
router.post('/api/login/verify', async (ctx) => {
  const b = validate(await readBody(ctx.req, 4096), { challenge: V.str({ max: 64 }), code: V.str({ max: 6, pattern: /^\d{6}$/, label: 'Code' }) }, { required: ['challenge', 'code'] });
  checkRate('2fa', ctx.ip);
  try { verifyChallenge(b.challenge, b.code, ctx.ip); } catch (e) { if (e.status === 401) failRate('2fa', ctx.ip, `Code e-mail faux : ${e.message.toLowerCase()}`); throw e; }
  resetRate('2fa', ctx.ip);
  sendJson(ctx.res, { token: issueToken(ctx, 'avec le mot de passe et le code reçu par e-mail') });
});
router.post('/api/login/resend', async (ctx) => {
  const b = validate(await readBody(ctx.req, 4096), { challenge: V.str({ max: 64 }) }, { required: ['challenge'] });
  sendJson(ctx.res, await resendChallenge(b.challenge, ctx.ip), 202);
});

// Connexion avec le code à 6 chiffres affiché dans le tableau de bord (il change à chaque connexion)
router.post('/api/login/code', async (ctx) => {
  const b = validate(await readBody(ctx.req, 4096), { code: V.str({ max: 12, label: 'Code' }) }, { required: ['code'] });
  checkRate('code', ctx.ip);
  if (!loginCodeActive()) throw new HttpError(401, 'Aucun code actif. Demandez à l’administrateur d’ouvrir le tableau de bord pour afficher un code.');
  if (!useLoginCode(b.code)) { failRate('code', ctx.ip, 'Code de connexion à 6 chiffres incorrect'); throw new HttpError(401, 'Code incorrect ou expiré'); }
  resetRate('code', ctx.ip);
  sendJson(ctx.res, { token: issueToken(ctx, 'avec le code à 6 chiffres') });
});

function deviceLabel(ua = '') {
  ua = String(ua || '');
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const tv = /SMART-TV|Tizen|Web0S|webOS|BRAVIA|AFT|Android TV|GoogleTV/i.test(ua) ? 'TV' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [tv, br, os && `sur ${os}`].filter(Boolean).join(' ') || 'appareil inconnu';
}

router.post('/api/logout', (ctx) => {
  if (ctx.auth) revokeToken(ctx.auth.token);
  ctx.res.setHeader('Set-Cookie', 'vn_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ profils
router.get('/api/profiles', (ctx) => {
  requireDevice(ctx);
  sendJson(ctx.res, all('SELECT * FROM profiles ORDER BY is_admin DESC, id').map(publicProfile));
});

router.post('/api/profiles/:id/select', async (ctx) => {
  const auth = requireDevice(ctx);
  const b = validate(await readBody(ctx.req, 4096), { pin: V.str({ max: 8, label: 'Code PIN' }) });
  const p = get('SELECT * FROM profiles WHERE id = ?', Number(ctx.params.id));
  if (!p) throw new HttpError(404, 'Profil introuvable');
  const why = accessProblem(p, ctx.ip);
  if (why) throw new HttpError(403, why);
  if (p.pin_hash) {
    checkRate(`pin:${p.id}`, ctx.ip);
    if (!verifySecret(b.pin || '', p.pin_hash)) { failRate(`pin:${p.id}`, ctx.ip, `Code PIN faux pour le profil « ${p.name} »`); throw new HttpError(403, 'Code PIN incorrect'); }
    resetRate(`pin:${p.id}`, ctx.ip);
    if (needsRehash(p.pin_hash)) run('UPDATE profiles SET pin_hash = ? WHERE id = ?', hashSecret(b.pin), p.id);
  }
  setTokenProfile(auth.token, p.id);
  sendJson(ctx.res, publicProfile(p));
});

router.post('/api/profiles/leave', (ctx) => {
  const auth = requireDevice(ctx);
  setTokenProfile(auth.token, null);
  sendJson(ctx.res, { ok: true });
});

router.get('/api/me', (ctx) => sendJson(ctx.res, publicProfile(requireProfile(ctx))));

router.post('/api/profiles', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 8192), { name: V.str({ min: 1, max: 30, label: 'Nom' }), avatar: V.int({ min: 0, max: 50 }), pin: V.pin(), isAdmin: V.bool(), maxAge: V.nullable(V.int({ min: 0, max: 21, label: 'Âge maximum' })) }, { required: ['name'] });
  // Un nouvel administrateur doit être protégé par un code PIN
  if (b.isAdmin && !b.pin) throw new HttpError(400, 'Un profil administrateur doit avoir un code PIN');
  const r = run('INSERT INTO profiles(name, avatar, pin_hash, is_admin, max_age, created_at) VALUES(?, ?, ?, ?, ?, ?)',
    b.name, b.avatar || 0, b.pin ? hashSecret(b.pin) : null, b.isAdmin ? 1 : 0, b.maxAge ?? null, Date.now());
  logSecurity('profil', ctx.ip, `${me.name} a créé le profil « ${b.name} »${b.isAdmin ? ' (administrateur)' : ''}`, 'info');
  sendJson(ctx.res, publicProfile(get('SELECT * FROM profiles WHERE id = ?', Number(r.lastInsertRowid))));
});

// ------------------------------------------------------------------ comptes par invitation (e-mail) — voir invites.js
router.get('/api/admin/invites', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { invites: listInvites(), smtp: smtpOn(), emails: Object.fromEntries(all('SELECT id, email FROM profiles WHERE email IS NOT NULL').map((r) => [r.id, r.email])) });
});
router.post('/api/admin/invites', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 8192), {
    name: V.str({ min: 1, max: 30, label: 'Nom' }), email: V.str({ max: 200, pattern: EMAIL_RE, label: 'Adresse e-mail' }),
    isAdmin: V.bool(), maxAge: V.nullable(V.int({ min: 0, max: 21, label: 'Âge maximum' })), profileId: V.int({ min: 1 }),
  }, { required: ['email'] });
  checkRate('invite-send', ctx.ip);
  let p;
  if (b.profileId) {
    p = get('SELECT * FROM profiles WHERE id = ?', b.profileId);
    if (!p) throw new HttpError(404, 'Profil introuvable');
  } else {
    if (!b.name) throw new HttpError(400, 'Nom obligatoire');
    if (get('SELECT 1 FROM profiles WHERE lower(email) = lower(?)', b.email)) throw new HttpError(409, 'Un compte utilise déjà cette adresse e-mail');
    const r = run('INSERT INTO profiles(name, avatar, is_admin, max_age, email, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      b.name, Math.floor(Math.random() * 12), b.isAdmin ? 1 : 0, b.maxAge ?? null, b.email, Date.now());
    p = get('SELECT * FROM profiles WHERE id = ?', Number(r.lastInsertRowid));
    logSecurity('profil', ctx.ip, `${me.name} a invité « ${b.name} » (${b.email})${b.isAdmin ? ' comme administrateur' : ''}`, 'info');
  }
  run('UPDATE profiles SET email = ? WHERE id = ?', b.email, p.id);
  const r = await createInvite(p, b.email, me.name, baseUrl(ctx.req));
  sendJson(ctx.res, { profile: publicProfile(p), ...r });
});
router.del('/api/admin/invites/:id', (ctx) => { requireAdmin(ctx); cancelInvites(Number(ctx.params.id)); sendJson(ctx.res, { ok: true }); });
// Page publique du lien reçu : qui est invité, par quel serveur
router.get('/api/invite/:token', (ctx) => {
  checkRate('invite', ctx.ip);
  const r = inviteFor(ctx.params.token);
  if (!r) { failRate('invite', ctx.ip, 'Lien d’invitation invalide ou expiré'); throw new HttpError(404, 'Ce lien d’invitation n’est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau à l’administrateur.'); }
  sendJson(ctx.res, { name: r.profile.name, avatar: r.profile.avatar, email: r.inv.email, by: r.inv.created_by, server: getSetting('server_name', 'Venus'), admin: !!r.profile.is_admin, kid: r.profile.max_age != null, expiresAt: r.inv.expires_at });
});
// La personne prépare son compte : l'appareil est connecté sur son profil, sans le mot de passe du foyer
router.post('/api/invite/:token/accept', async (ctx) => {
  checkRate('invite', ctx.ip);
  const r = inviteFor(ctx.params.token);
  if (!r) { failRate('invite', ctx.ip, 'Lien d’invitation invalide ou expiré'); throw new HttpError(404, 'Ce lien d’invitation n’est plus valable.'); }
  const b = validate(await readBody(ctx.req, 8192), {
    name: V.str({ min: 1, max: 30, label: 'Nom' }), avatar: V.int({ min: 0, max: 50 }), pin: V.nullable(V.pin()),
    subtitleLang: V.str({ max: 8, pattern: /^[a-z]{2,3}(-[a-z]{2,4})?$|^none$/i }), audioLang: V.str({ max: 8, pattern: /^[a-z]{2,3}(-[a-z]{2,4})?$/i }),
  }, { required: ['name'] });
  const p = r.profile;
  if (p.is_admin && !b.pin) throw new HttpError(400, 'Un compte administrateur doit avoir un code PIN (4 à 8 chiffres)');
  resetRate('invite', ctx.ip);
  tx(() => {
    run('UPDATE profiles SET name = ?, avatar = COALESCE(?, avatar), pin_hash = ?, subtitle_lang = COALESCE(?, subtitle_lang), audio_lang = COALESCE(?, audio_lang) WHERE id = ?',
      b.name, b.avatar ?? null, b.pin ? hashSecret(b.pin) : null, b.subtitleLang ?? null, b.audioLang ?? null, p.id);
    markInviteUsed(ctx.params.token);
  });
  const token = issueToken(ctx, `avec l’invitation de ${r.inv.created_by}`);
  setTokenProfile(token, p.id);
  logSecurity('profil', ctx.ip, `« ${b.name} » a préparé son compte avec le lien d’invitation`, 'info');
  notify({ title: 'Invitation acceptée', body: `${b.name} a préparé son compte sur Venus.`, url: '/reglages?onglet=famille', tag: 'invite' }, { adminOnly: true }).catch(() => {});
  sendJson(ctx.res, { token, profile: publicProfile(get('SELECT * FROM profiles WHERE id = ?', p.id)) });
});

router.put('/api/profiles/:id', async (ctx) => {
  const me = requireProfile(ctx);
  const id = Number(ctx.params.id);
  if (!me.is_admin && me.id !== id) throw new HttpError(403, 'Interdit');
  const b = validate(await readBody(ctx.req, 8192), {
    name: V.str({ min: 1, max: 30, label: 'Nom' }), avatar: V.int({ min: 0, max: 50 }), pin: V.nullable(V.pin()),
    subtitleLang: V.str({ max: 8, pattern: /^[a-z]{2,3}(-[a-z]{2,4})?$|^none$/i }), audioLang: V.str({ max: 8, pattern: /^[a-z]{2,3}(-[a-z]{2,4})?$/i }),
    maxAge: V.nullable(V.int({ min: 0, max: 21 })), isAdmin: V.bool(), perms: (v) => validPerms(v),
    email: V.nullable(V.str({ max: 200, pattern: EMAIL_RE, label: 'Adresse e-mail' })),
  });
  const p = get('SELECT * FROM profiles WHERE id = ?', id);
  if (b.email !== undefined && (me.is_admin || me.id === id)) run('UPDATE profiles SET email = ? WHERE id = ?', b.email || null, id);
  if (!p) throw new HttpError(404, 'Profil introuvable');
  if (b.name != null) run('UPDATE profiles SET name = ? WHERE id = ?', b.name, id);
  if (b.avatar != null) run('UPDATE profiles SET avatar = ? WHERE id = ?', b.avatar, id);
  if (b.pin !== undefined) {
    // Un administrateur garde toujours un code PIN
    if (!b.pin && p.is_admin && all('SELECT 1 FROM profiles WHERE is_admin = 1').length) throw new HttpError(400, 'Un profil administrateur doit garder un code PIN');
    run('UPDATE profiles SET pin_hash = ? WHERE id = ?', b.pin ? hashSecret(b.pin) : null, id);
    logSecurity('pin', ctx.ip, `Code PIN du profil « ${p.name} » ${b.pin ? 'modifié' : 'retiré'} par ${me.name}`, 'info');
  }
  if (b.subtitleLang != null) run('UPDATE profiles SET subtitle_lang = ? WHERE id = ?', b.subtitleLang, id);
  if (b.audioLang != null) run('UPDATE profiles SET audio_lang = ? WHERE id = ?', b.audioLang, id);
  if (me.is_admin) {
    if (b.maxAge !== undefined) run('UPDATE profiles SET max_age = ? WHERE id = ?', b.maxAge, id);
    if (b.perms !== undefined) {
      run('UPDATE profiles SET perms = ? WHERE id = ?', JSON.stringify(b.perms), id);
      logSecurity('droits', ctx.ip, `${me.name} a changé les droits du profil « ${p.name} »`, 'info');
    }
    if (b.isAdmin !== undefined && id !== me.id) {
      if (b.isAdmin && !p.pin_hash && !b.pin) throw new HttpError(400, 'Donnez d’abord un code PIN à ce profil : un administrateur doit en avoir un');
      run('UPDATE profiles SET is_admin = ? WHERE id = ?', b.isAdmin ? 1 : 0, id);
      logSecurity('droits', ctx.ip, `${me.name} a ${b.isAdmin ? 'donné' : 'retiré'} les droits d’administrateur ${b.isAdmin ? 'à' : 'au profil'} « ${p.name} »`, 'warn');
    }
  } else if (b.maxAge !== undefined || b.isAdmin !== undefined || b.perms !== undefined) {
    logSecurity('droits', ctx.ip, `« ${me.name} » a tenté de changer ses propres droits`, 'warn');
    throw new HttpError(403, 'Réservé à l’administrateur');
  }
  sendJson(ctx.res, publicProfile(get('SELECT * FROM profiles WHERE id = ?', id)));
});

router.del('/api/profiles/:id', (ctx) => {
  const me = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (id === me.id) throw new HttpError(400, 'Impossible de supprimer votre propre profil');
  const gone = get('SELECT name FROM profiles WHERE id = ?', id);
  run('DELETE FROM profiles WHERE id = ?', id);
  if (gone) logSecurity('profil', ctx.ip, `${me.name} a supprimé le profil « ${gone.name} »`, 'info');
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
  // Appareils connectés en ce moment (pour « Envoyer vers la télé ») : un par appareil, avec son nom et son profil
  const connKey = deviceId(mine);
  connected.set(connKey, { token: mine, profileId: myProfile, name: deviceLabel(ctx.auth.device), tv: /TV|Tizen|WebOS|BRAVIA|Silk|CrKey/i.test(ctx.auth.device || ''), since: Date.now() });
  const onCtl = (d) => { if (d.except && deviceId(d.except) === deviceId(mine)) return; if (d.all || (d.token && deviceId(d.token) === deviceId(mine)) || (d.profileId && d.profileId === myProfile)) res.write(`event: control\ndata: ${JSON.stringify({ cmd: d.cmd, text: d.text, from: d.from, title: d.title, url: d.url, at: Date.now() })}\n\n`); };
  control.on('cmd', onCtl);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  ctx.req.on('close', () => { clearInterval(ping); events.off('library', onLib); control.off('cmd', onCtl); if (connected.get(connKey)?.token === mine) connected.delete(connKey); });
});
const connected = new Map(); // deviceId → appareil avec l'application ouverte
// Autres appareils ouverts avec le même profil (ou n'importe quel profil pour l'administrateur) : « Envoyer vers »
router.get('/api/devices/open', (ctx) => {
  const p = requireProfile(ctx);
  const me = deviceId(ctx.auth.token);
  const list = [...connected.entries()].filter(([k, d]) => k !== me && (p.is_admin || d.profileId === p.id))
    .map(([k, d]) => ({ id: k, name: d.name, tv: d.tv, playing: nowPlaying().some((e) => deviceId(e.token) === k) }));
  sendJson(ctx.res, list.sort((a, b) => Number(b.tv) - Number(a.tv)));
});
// Lancer une vidéo sur un autre appareil (la télé du salon depuis le téléphone)
router.post('/api/devices/:id/open', async (ctx) => {
  const p = requireProfile(ctx);
  const b = validate(await readBody(ctx.req, 2048), { itemId: V.int({ min: 1 }), path: V.str({ max: 300 }) }, {});
  const d = connected.get(String(ctx.params.id));
  if (!d) throw new HttpError(404, 'Cet appareil n’est plus ouvert');
  if (!p.is_admin && d.profileId !== p.id) throw new HttpError(403, 'Interdit');
  const url = b.itemId ? pathFor(Number(b.itemId), { play: true }) : String(b.path || '/');
  if (!/^\/(?!\/)[\w.%/-]*(\?[\w=&%.-]*)?$/.test(url)) throw new HttpError(400, 'Adresse invalide');
  control.emit('cmd', { token: d.token, cmd: 'open', url, from: p.name, text: b.itemId ? (get('SELECT title FROM items WHERE id = ?', Number(b.itemId)) || {}).title : '' });
  logActivity('control', `${p.name} a envoyé une vidéo vers ${d.name}`);
  sendJson(ctx.res, { ok: true });
});

router.get('/api/categories', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const rows = all(`SELECT ${CATEGORY_SQL} AS cat, COUNT(*) AS n FROM items i WHERE i.type IN ${TOP_TYPES} AND ${age.sql} GROUP BY cat`, ...age.args);
  // Musique, photos, livres
  const lib = libraryClause(p);
  rows.push(...all(`SELECT CASE WHEN i.type = 'track' THEN 'music' WHEN i.type = 'photo' THEN 'photo' ELSE 'book' END AS cat, COUNT(*) AS n FROM items i
    WHERE (i.type = 'photo' OR i.type IN ('book','audiobook') OR (i.type = 'track' AND i.category = 'music')) AND ${lib.sql} GROUP BY cat`, ...lib.args));
  // Une bibliothèque Musique ou Livres encore vide : la section reste visible (avec son message d'accueil)
  for (const l of all("SELECT DISTINCT type FROM libraries WHERE type IN ('music','books')")) rows.push({ cat: `${l.type === 'books' ? 'book' : 'music'}_lib`, n: 1 });
  sendJson(ctx.res, Object.fromEntries(rows.map((r) => [r.cat, r.n])));
});

const HERO_MIX = [['anime', 5], ['movie', 3], ['show', 2]];
// Ordre d'affichage : mélangé pour que les animés ne se suivent pas tous
const HERO_ORDER = ['anime', 'movie', 'anime', 'show', 'anime', 'movie', 'anime', 'show', 'anime', 'movie'];
// Seules les sorties de l'année (film sorti, ou dernier épisode diffusé, il y a moins de douze mois) et présentes sur
// le NAS ; s'il y en a moins de trois, les arrivées les plus récentes complètent pour que l'accueil ne soit pas vide.
function newHero(base) {
  const lastEp = new Map(all("SELECT show_id, MAX(added_at) AS at FROM items WHERE type = 'episode' GROUP BY show_id").map((r) => [r.show_id, r.at]));
  const lastAir = new Map(all("SELECT show_id, MAX(release_date) AS d FROM items WHERE type = 'episode' AND release_date IS NOT NULL GROUP BY show_id").map((r) => [r.show_id, r.d]));
  const freshness = (i) => Math.max(i.added_at || 0, (i.type === 'show' && lastEp.get(i.id)) || 0);
  const dateOf = (i) => (i.type === 'show' && lastAir.get(i.id)) || i.release_date || (i.year ? `${i.year}-07-01` : '');
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const recent = (i) => dateOf(i) >= cutoff;
  const kind = (i) => (i.type === 'movie' ? 'movie' : i.type === 'show' ? (i.category === 'anime' ? 'anime' : 'show') : null);
  const pools = { anime: [], movie: [], show: [] };
  const old = { anime: [], movie: [], show: [] };
  for (const i of base) { const k = kind(i); if (k && !i.version_of) (recent(i) ? pools : old)[k].push(i); }
  // La sortie la plus récente d'abord ; à égalité, la dernière arrivée, puis celle qui a une image de fond
  for (const k of Object.keys(pools)) pools[k].sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || freshness(b) - freshness(a) || (!!b.backdrop - !!a.backdrop));
  if (Object.values(pools).reduce((n, l) => n + l.length, 0) < 3) {
    for (const k of Object.keys(old)) { old[k].sort((a, b) => freshness(b) - freshness(a)); pools[k].push(...old[k]); }
  }
  const tagOf = (i, k) => (k === 'movie' ? 'Nouveau film' : k === 'anime' ? (lastEp.get(i.id) > (i.added_at || 0) ? 'Nouvel épisode' : 'Nouvel animé') : (lastEp.get(i.id) > (i.added_at || 0) ? 'Nouvel épisode' : 'Nouvelle série'));
  const want = Object.fromEntries(HERO_MIX);
  const taken = Object.fromEntries(HERO_MIX.map(([k, n]) => [k, pools[k].slice(0, n)]));
  // Places laissées libres par une catégorie trop courte : données aux autres, les plus récents d'abord
  let missing = HERO_MIX.reduce((n, [k]) => n + (want[k] - taken[k].length), 0);
  const extra = Object.keys(pools).flatMap((k) => pools[k].slice(taken[k].length).map((i) => ({ i, k }))).sort((a, b) => freshness(b.i) - freshness(a.i));
  for (const { i, k } of extra) { if (missing <= 0) break; taken[k].push(i); missing--; }
  const out = [];
  const cursor = { anime: 0, movie: 0, show: 0 };
  for (const k of HERO_ORDER) { const it = taken[k][cursor[k]++]; if (it) out.push({ item: it, tag: tagOf(it, k) }); }
  for (const k of Object.keys(taken)) for (const it of taken[k].slice(cursor[k])) out.push({ item: it, tag: tagOf(it, k) });
  return out.slice(0, 10);
}

// Bloc « Ce soir » des thèmes Lagon et Océan : ce qui sort aujourd'hui et demain, la prochaine sortie musicale,
// la dernière chaîne regardée avec son programme, et qui est là ce soir
router.get('/api/home/tonight', async (ctx) => {
  const p = requireProfile(ctx);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = today.toISOString().slice(0, 10), to = new Date(today.getTime() + 2 * 864e5).toISOString().slice(0, 10);
  const safe = (f) => f().catch(() => ({ entries: [] }));
  const [shows, anime] = await Promise.all([safe(() => upcomingShows(p, 'show', ageClause(p, 's'))), safe(() => upcomingShows(p, 'anime', ageClause(p, 's')))]);
  const label = (e) => `${new Date(`${e.date}T12:00:00`).toDateString() === new Date().toDateString() ? 'Aujourd’hui' : 'Demain'}${e.at ? ` ${new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  const soon = [...shows.entries, ...anime.entries].filter((e) => e.date >= from && e.date < to)
    .sort((a, b) => (b.nas ? 2 : b.arr || b.wanted ? 1 : 0) - (a.nas ? 2 : a.arr || a.wanted ? 1 : 0) || (a.at || 0) - (b.at || 0) || (b.pop || 0) - (a.pop || 0))
    .slice(0, 3).map((e) => ({ title: e.show, sub: `${e.season ? `S${e.season} ` : ''}É${e.episode}${e.network ? ` · ${e.network}` : ''}`, when: label(e), poster: e.poster || e.image || null, kind: e.kind, nas: !!e.nas, requested: !!(e.arr || e.wanted), showId: e.nas || null }));
  const mu = musicUpcoming();
  const album = mu.upcoming[0] ? { title: mu.upcoming[0].title, artist: mu.upcoming[0].artist, date: mu.upcoming[0].date, cover: mu.upcoming[0].cover, requested: !!mu.upcoming[0].requested, slug: mu.upcoming[0].artistSlug } : null;
  // Dernière chaîne : ce qui passe maintenant et ensuite
  let live = null;
  const lc = getSetting(`last_channel:${p.id}`, null);
  const ch = lc ? get('SELECT * FROM items WHERE id = ? AND type = ?', lc.id, 'channel') : null;
  if (ch && visible(p, ch)) {
    const nn = nowNext([ch.id])[ch.id] || [];
    live = { id: ch.id, title: ch.title, logo: ch.poster, path: `/tv/${channelNumber(ch)}-${slugFor(ch.id)}`, now: nn[0] ? { title: nn[0].title, start: nn[0].start, stop: nn[0].stop } : null, next: nn[1] ? { title: nn[1].title, start: nn[1].start } : null };
  }
  const people = all('SELECT id, name, avatar, max_age FROM profiles ORDER BY id').map((x) => ({ id: x.id, name: x.name, avatar: x.avatar, kids: x.max_age != null && x.max_age <= 12 }));
  sendJson(ctx.res, { soon, album, live, people });
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
  const cont = [], stale = []; const seenShows = new Set(); const STALE_MS = 21 * 864e5; // au-delà de 3 semaines : « vous aviez laissé »
  for (const pr of prog) {
    if (cont.length >= 20) break;
    let it = get(`SELECT i.*, s.title AS show_title, s.backdrop AS show_backdrop, s.logo AS show_logo, s.poster AS show_poster
                  FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id = ?`, pr.item_id);
    if (!it || !visible(p, it)) continue;
    if (['book', 'audiobook', 'track', 'photo'].includes(it.type)) continue; // livres et musique : dans leurs pages
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
      (Date.now() - pr.updated_at > STALE_MS ? stale : cont).push(c);
    } else if (!pr.watched && pr.position > 15) {
      (Date.now() - pr.updated_at > STALE_MS ? stale : cont).push(card(it, pr));
    }
  }
  if (cont.length) rows.push({ id: 'continue', title: 'Reprendre la lecture', items: cont });
  if (stale.length) rows.push({ id: 'stale', title: 'Vous aviez laissé…', hint: 'Reprendre, ou retirer d’un clic', items: stale.slice(0, 12), stale: true });
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
  // Vos enregistrements TV terminés : regardables tout de suite (vignette de l'enregistrement, nom de la chaîne)
  try {
    const recs = all(`SELECT i.* FROM recordings r JOIN items i ON i.id = r.item_id WHERE r.status = 'done' AND (r.profile_id IS NULL OR r.profile_id = ? OR ?) ORDER BY r.start DESC LIMIT 12`, p.id, p.is_admin ? 1 : 0);
    if (recs.length) rows.push({ id: 'recordings', title: 'Vos enregistrements', items: recs.map((i) => C(i)) });
  } catch { /* table absente : pas encore d'enregistrement */ }

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
  const usedBecause = new Set();
  for (const ls of lastSeen.slice(0, 3)) {
    const ref = byId.get(ls.tid);
    if (!ref) continue;
    const g = parseJson(ref.genres, []), pp = new Set(peopleOf(ref)), col = (credOf.get(ref.id) || {}).collection;
    const sim = unseen.filter((i) => i.id !== ref.id).map((i) => {
      const c = credOf.get(i.id) || {};
      const s = parseJson(i.genres, []).filter((x) => g.includes(x)).length * 2 + peopleOf(i).filter((n) => pp.has(n)).length * 3
        + (col && c.collection && c.collection.id === col.id ? 8 : 0) + (i.type === ref.type ? 1 : 0) + (i.vote || 0) / 5
        // Animé pour un animé, même époque
        + ((i.category === 'anime') === (ref.category === 'anime') ? 2 : -2) + (i.year && ref.year && Math.abs(i.year - ref.year) <= 5 ? 1 : 0);
      return { i, s };
    }).filter((x) => x.s >= 4 && !usedBecause.has(x.i.id)).sort((a, b) => b.s - a.s).slice(0, 18);
    // Une rangée par titre regardé (3 au plus), sans répéter les mêmes propositions
    if (sim.length >= 2) { sim.forEach((x) => usedBecause.add(x.i.id)); rows.push({ id: `because:${ref.id}`, title: `Parce que vous avez regardé ${ref.title}`, items: sim.map((x) => C(x.i)) }); }
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
  // Les avis « j'ai aimé / bof » font remonter les genres aimés et descendre les autres
  const taste = genreTaste(p.id);
  const gems = unseen.filter((i) => scoreOfItem(i) >= 74).sort((a, b) => (scoreOfItem(b) + 4 * tasteScore(taste, parseJson(b.genres, []))) - (scoreOfItem(a) + 4 * tasteScore(taste, parseJson(a.genres, [])))).slice(0, 18);
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

  // À la une : les nouveautés qui défilent en haut de l'accueil — 3 films, 5 animés et 2 séries, les plus
  // récemment arrivés (pour une série ou un animé : son dernier épisode ajouté). Une catégorie qui en a moins
  // laisse sa place aux autres.
  // L'affiche à la une ne montre que des sorties ; la lecture en cours a sa rangée « Reprendre » et le bloc « Ce soir »
  const hero = newHero(base).map((x) => ({ ...C(x.item), heroTag: x.tag }));
  const resume = heroResume ? heroResume.item : null;
  // Administrateur sans clé TMDB : l'accueil le lui rappelle (sans elle, pas d'affiches ni de résumés)
  const noPosters = !!p.is_admin && !tmdbKey() && base.some((i) => i.type === 'movie' || i.type === 'show') && !base.some((i) => i.poster);
  sendJson(ctx.res, { hero, resume, rows, empty: base.length === 0 && !channels.length, scanning: scanState.running, noPosters });
});

// Bibliothèque d'une source, avec l'état vu / non vu pour le profil (filtres et tris côté interface)
const libraryCache = new Map();
router.get('/api/library', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const type = ctx.url.searchParams.get('type');
  const where = {
    movie: "i.type = 'movie'", show: "i.type = 'show' AND COALESCE(i.category, 'show') = 'show'", anime: "i.type = 'show' AND i.category = 'anime'",
    clip: "i.type = 'clip' AND COALESCE(i.category, 'clip') != 'recording'", channel: "i.type = 'channel'", recording: "i.type = 'clip' AND i.category = 'recording'",
  }[type] || "i.type IN ('movie','show','clip')";
  // Les cartes (sans l'état vu / non vu, propre à chaque profil) sont gardées en mémoire tant que la table
  // des titres ne change pas : avec 2 000 films, les reconstruire à chaque visite prenait plusieurs centaines de ms
  const key = `${type}|${age.sql}|${age.args.join(',')}`;
  let base = libraryCache.get(key);
  if (!base || base.v !== itemsVersion) {
    const items = all(`SELECT i.* FROM items i WHERE ${where} AND ${age.sql} ORDER BY ${type === 'channel' ? 'i.episode_num' : 'i.sort_title'}`, ...age.args);
    // Résolution du premier épisode d'une série, pour le filtre « 4K / HDR »
    const firstProbe = type === 'channel' ? new Map() : new Map(all(`SELECT show_id, probe FROM items WHERE type = 'episode' AND probe IS NOT NULL GROUP BY show_id`).map((r) => [r.show_id, r.probe]));
    const cards = items.map((i) => {
      const c = card(i);
      if (type !== 'channel') {
        const m = mediaSummary(i.type === 'show' ? firstProbe.get(i.id) : i.probe);
        if (m) { c.res = m.resolution === '4K' ? '4K' : /1080/.test(m.resolution) ? '1080p' : /720/.test(m.resolution) ? '720p' : 'SD'; c.hdr = !!m.hdr; }
        const cr = parseJson(i.credits, null);
        if (cr) { c.studios = [...(cr.studios || []), ...(cr.networks || [])].slice(0, 6); c.people = [...(cr.directors || []), ...(cr.cast || []).slice(0, 8)].map((x) => x.name); }
        if (i.duration && !c.runtime) c.runtime = Math.round(i.duration / 60);
      }
      return c;
    });
    if (type === 'channel') {
      // État de la chaîne d'après la dernière vérification (images reçues ou non)
      const health = new Map(items.map((i) => [i.id, i]));
      for (const c of cards) {
        const i = health.get(c.id);
        c.cat = channelCat(c.title, c.group);
        // Mayotte La 1ère et les autres La 1ère restent toujours visibles (programmes parfois non diffusés sur Internet)
        if (i && i.ch_ok === 0) { if (neverHide(c.title)) c.flaky = i.ch_error || 'Aucune image reçue'; else { c.down = true; c.downWhy = i.ch_error || 'Aucune image reçue'; } }
      }
      // Mayotte La 1ère en tête de la liste
      const pin = (c) => (/mayotte/i.test(c.title) && neverHide(c.title) ? 0 : 1);
      cards.sort((a, b) => pin(a) - pin(b) || (a.number || 0) - (b.number || 0));
      // Captures de toutes les chaînes préparées d'avance : la mosaïque s'affiche d'un coup
      warmSnapshots(cards.filter((c) => !c.down).map((c) => health.get(c.id)));
    }
    base = { v: itemsVersion, cards };
    if (libraryCache.size > 24) libraryCache.clear();
    libraryCache.set(key, base);
  }
  const idx = statusIndex(p.id);
  if (type === 'channel') {
    // Favoris du profil : jamais cachés, marqués « fav »
    const favs = new Set(channelFavs(p.id));
    const recent = new Map((getSetting(`tv_recent:${p.id}`, []) || []).map((id, i) => [id, i]));
    return sendJson(ctx.res, base.cards.map((c) => { const x = { ...c }; if (recent.has(c.id)) x.recent = recent.get(c.id); if (favs.has(c.id)) { x.fav = true; if (x.down) { x.flaky = x.downWhy; delete x.down; delete x.downWhy; } } return x; }));
  }
  sendJson(ctx.res, base.cards.map((c) => withStatus({ ...c }, idx)));
});

router.get('/api/items/:id', async (ctx) => {
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
  // Qui l'a déjà vu dans la maison (avatars sur la fiche)
  out.opinion = opinionOf(p.id, item.id);
  // Provenance des infos et du visuel (pour l'écran « À propos »)
  const custom = parseJson(item.custom, null);
  out.provenance = {
    info: custom && Object.keys(custom).some((k) => !['poster', 'backdrop', 'logo'].includes(k)) ? 'Modifié à la main' : item.tmdb_id ? 'TMDB' : item.nfo ? 'Fichier .nfo' : 'Nom du fichier',
    poster: !item.poster ? null : custom && custom.poster ? 'Choisie à la main' : String(item.poster).startsWith('l_') ? 'Image dans le dossier' : String(item.poster).startsWith('k_') ? 'Trakt' : String(item.poster).startsWith('p_') ? 'Service gratuit (IMDb, Cinemeta, site TMDB, IMP Awards, Wikipédia, iTunes, TVmaze)' : 'TMDB',
    file: item.path || null, folder: item.path ? path.dirname(item.path) : null,
  };
  // Emplacement sur le NAS (administrateurs) : dossier de la série / de chaque saison, ou fichier du film, clip, épisode.
  // Pour un partage réseau, le chemin est aussi donné comme sur le NAS (\\192.168.1.20\Séries\…).
  if (p.is_admin) {
    const lib = item.library_id ? get('SELECT name, path, remote FROM libraries WHERE id = ?', item.library_id) : null;
    const nasPath = (x) => {
      if (!x || !lib || !lib.remote) return null;
      const r = parseJson(lib.remote, null);
      const base = r ? describeShare(r) : null;
      if (!base || !x.startsWith(lib.path)) return null;
      const rest = x.slice(lib.path.length).replace(/^[\\/]+/, '');
      return r.proto === 'nfs' ? `${base}/${rest}` : `${base}\\${rest.replace(/\//g, '\\')}`;
    };
    const common = (list) => {
      if (!list.length) return null;
      let pre = path.dirname(list[0]);
      for (const f of list) while (pre && !(`${f}`.startsWith(pre + path.sep) || f === pre)) { const up = path.dirname(pre); if (up === pre) { pre = ''; break; } pre = up; }
      return pre || null;
    };
    const loc = { library: lib ? lib.name : null, items: [] };
    if (item.type === 'show') {
      const eps = all("SELECT path, season_num FROM items WHERE show_id = ? AND type = 'episode' AND path IS NOT NULL", item.id);
      const dir = common(eps.map((e) => e.path));
      if (dir) {
        // Le dossier commun est celui d'une saison quand il n'y en a qu'une : on remonte au dossier de la série
        const showDir = /^(saison|season|s)\s*\d+$/i.test(path.basename(dir)) ? path.dirname(dir) : dir;
        loc.items.push({ label: 'Dossier de la série', path: showDir, nas: nasPath(showDir) });
        const seasons = new Map();
        for (const e of eps) { const k = e.season_num; if (!seasons.has(k)) seasons.set(k, []); seasons.get(k).push(e.path); }
        for (const [n, files] of [...seasons.entries()].sort((a, b) => a[0] - b[0])) {
          const sd = common(files) || path.dirname(files[0]);
          if (sd !== showDir) loc.items.push({ label: n === 0 ? 'Bonus' : `Saison ${n}`, path: sd, nas: nasPath(sd), count: files.length });
        }
      }
    } else if (item.path) {
      loc.items.push({ label: 'Fichier', path: item.path, nas: nasPath(item.path), size: item.size || null });
      loc.items.push({ label: 'Dossier', path: path.dirname(item.path), nas: nasPath(path.dirname(item.path)) });
    }
    if (loc.items.length) out.location = loc;
  }
  // Sous-titres externes dont la durée ne colle pas à la vidéo (probablement pour une autre version)
  if (item.type !== 'show' && item.probe) {
    const pr = parseJson(item.probe, null);
    if (pr && pr.duration) out.subWarnings = (pr.subs || []).filter((x) => x.external && x.path).map((x) => { const d = subtitleDrift(x.path, pr.duration); return d ? { file: path.basename(x.path), lang: x.lang, ratio: d.ratio } : null; }).filter(Boolean);
  }
  out.watchedBy = item.type === 'show'
    ? all(`SELECT DISTINCT pf.id, pf.name, pf.avatar FROM progress pr JOIN items e ON e.id = pr.item_id JOIN profiles pf ON pf.id = pr.profile_id WHERE e.show_id = ? AND pr.watched = 1 ORDER BY pf.name`, item.id)
    : all('SELECT pf.id, pf.name, pf.avatar FROM progress pr JOIN profiles pf ON pf.id = pr.profile_id WHERE pr.item_id = ? AND pr.watched = 1 ORDER BY pf.name', item.id);
  // Notes jamais récupérées (ou anciennes), ou distribution manquante : on les demande tout de suite,
  // elles seront là à la prochaine visite
  if (['movie', 'show'].includes(item.type) && (!item.ratings_at || Date.now() - item.ratings_at > 10 * 86400000 || (!item.credits && (tmdbKey() ? item.tmdb_id : Date.now() - item.ratings_at > 864e5)))) scheduleRatings([item.id], true);
  out.links = {
    senscritique: `https://www.senscritique.com/search?query=${encodeURIComponent(item.title)}`,
    imdb: item.imdb_id ? `https://www.imdb.com/fr/title/${item.imdb_id}/` : null,
    anilist: item.anilist_id ? `https://anilist.co/anime/${item.anilist_id}` : null,
    mal: item.mal_id ? `https://myanimelist.net/anime/${item.mal_id}` : null,
  };
  out.inList = !!get('SELECT 1 FROM mylist WHERE profile_id=? AND item_id=?', p.id, item.id);

  // Bonus (making-of, scènes coupées, bandes-annonces…) rangés avec le titre
  const KIND_LABEL = { extra: 'Bonus', featurette: 'Making-of', behindthescenes: 'Coulisses', deleted: 'Scène coupée', interview: 'Interview', scene: 'Scène', short: 'Court métrage', trailer: 'Bande-annonce', other: 'Bonus' };
  const owners = item.type === 'movie' ? all("SELECT id FROM items WHERE type='movie' AND (id = ? OR version_of = ? OR id = ?)", item.version_of || item.id, item.version_of || item.id, item.id).map((r) => r.id) : [item.id];
  const extras = all(`SELECT * FROM items WHERE type = 'extra' AND parent_id IN (${owners.map(() => '?').join(',') || 'NULL'}) ORDER BY category = 'trailer' DESC, sort_title`, ...owners);
  if (extras.length) out.extras = extras.map((x) => ({ ...card(x), kind: x.category, kindLabel: KIND_LABEL[x.category] || 'Bonus', duration: x.duration }));
  // Versions d'un même film (4K, 1080p, version longue)
  if (item.type === 'movie') {
    const pid = item.version_of || item.id;
    const vers = all("SELECT id, path, size, probe FROM items WHERE type = 'movie' AND (id = ? OR version_of = ?) ORDER BY id = ? DESC", pid, pid, pid);
    if (vers.length > 1) out.versions = vers.map((v) => ({ id: v.id, ...versionLabel(v), primary: v.id === pid }));
  }

  if (item.type !== 'show') {
    out.media = mediaSummary(item.probe);
    out.duration = item.duration;
    out.file = { name: path.basename(item.path || ''), size: item.size || null, container: out.media && out.media.container };
    out.progress = get('SELECT position, duration, watched, updated_at AS updated, device FROM progress WHERE profile_id=? AND item_id=?', p.id, item.id) || null;
  } else {
    const seasons = all("SELECT * FROM items WHERE type='season' AND show_id=? ORDER BY season_num = 0, season_num", item.id);
    const eps = all("SELECT * FROM items WHERE type='episode' AND show_id=? ORDER BY season_num, episode_num", item.id);
    const pm = progressMap(p.id, eps.map((e) => e.id));
    const today = new Date().toISOString().slice(0, 10);
    // Sans données TMDB : guide des épisodes de TVmaze (sans clé), attendu au plus 3,5 s
    const noTmdb = !seasons.some((s) => parseJson(s.tmdb_eps, []).length);
    // Guide TVmaze aussi quand des saisons entières manquent (TMDB ne donne que leur nombre d'épisodes)
    const tmdbMissingSeasons = parseJson(item.tmdb_seasons, []).some((x) => x.n > 0 && !seasons.some((s) => s.season_num === x.n) && x.count > 0);
    const guide = noTmdb || tmdbMissingSeasons ? await guideFor(item.id).catch(() => []) : [];
    out.seasons = seasons.map((s) => {
      const list = eps.filter((e) => e.parent_id === s.id);
      // Épisodes déjà diffusés (d'après TMDB, sinon TVmaze) mais absents des dossiers
      const have = new Set(list.flatMap((e) => { const a = []; for (let n = e.episode_num; n <= (e.episode_end || e.episode_num); n++) a.push(n); return a; }));
      // Diffusés mais absents, et à venir (date future ou pas encore fixée) : tous les épisodes de la saison apparaissent
      let missing = parseJson(s.tmdb_eps, []).filter((x) => x.n && !have.has(x.n))
        .map((x) => ({ number: x.n, title: x.title, air: x.air, overview: x.overview, still: x.still ? `https://image.tmdb.org/t/p/w300${x.still}` : null, future: !x.air || x.air > today }));
      if (!missing.length && guide.length && s.season_num > 0) {
        const g = guide.filter((x) => x.s === s.season_num);
        // Numérotation compatible seulement (les animés numérotés en continu, 1 à 153, ne sont pas comparés)
        const maxHave = Math.max(0, ...have);
        if (g.length && maxHave <= g.length + 1) {
          missing = g.filter((x) => !have.has(x.n))
            .map((x) => ({ number: x.n, title: x.title, air: x.air, still: x.still, source: 'tvmaze', future: !x.air || x.air > today }));
        }
      }
      return {
        id: s.id, number: s.season_num, title: s.title, poster: s.poster, overview: s.overview,
        episodes: list.map((e) => {
          const c = card(e, pm.get(e.id));
          c.duration = e.duration; c.episodeEnd = e.episode_end;
          return c;
        }),
        missing,
      };
    });
    const haveSeasons = new Set(seasons.map((s) => s.season_num));
    out.missingSeasons = parseJson(item.tmdb_seasons, []).filter((x) => x.n > 0 && !haveSeasons.has(x.n) && x.count > 0 && x.air && x.air <= today)
      .map((x) => ({ number: x.n, title: x.name, count: x.count, air: x.air }));
    if (!out.missingSeasons.length && guide.length) {
      // Saisons entières absentes, d'après TVmaze ; pas pour les séries numérotées en continu (une seule saison locale très longue)
      const localMax = Math.max(0, ...eps.map((e) => e.episode_num || 0));
      const firstGuide = guide.filter((x) => x.s === 1).length;
      if (!(seasons.length === 1 && localMax > firstGuide + 1)) {
        const bySeason = new Map();
        for (const x of guide) if (x.air && x.air <= today) { const b = bySeason.get(x.s) || { count: 0, air: x.air }; b.count++; bySeason.set(x.s, b); }
        out.missingSeasons = [...bySeason].filter(([n]) => !haveSeasons.has(n)).map(([n, b]) => ({ number: n, title: `Saison ${n}`, count: b.count, air: b.air, source: 'tvmaze' }));
      }
    }
    // Saisons entières absentes des dossiers : montrées comme les autres, tous leurs épisodes « manquants »
    // (titres et dates d'après TVmaze quand il les a, sinon numérotés d'après TMDB)
    // (à part : la liste « seasons » ne contient que ce qui est dans les dossiers, pour le lecteur et les compteurs)
    out.absentSeasons = [];
    if (out.missingSeasons.length) {
      for (const ms of out.missingSeasons) {
        const g = guide.filter((x) => x.s === ms.number);
        const list = g.length ? g.map((x) => ({ number: x.n, title: x.title, air: x.air, still: x.still, future: !x.air || x.air > today }))
          : Array.from({ length: ms.count || 0 }, (_v, i) => ({ number: i + 1, title: null, air: null, future: false }));
        out.absentSeasons.push({ id: `absente-${ms.number}`, number: ms.number, title: ms.title || `Saison ${ms.number}`, poster: null, overview: null, episodes: [], missing: list, absent: true });
      }
    }
    // Prochain épisode à regarder
    const watchedSorted = eps.filter((e) => pm.get(e.id)).sort((a, b) => pm.get(b.id).updated_at - pm.get(a.id).updated_at);
    let next = eps.find((e) => e.season_num > 0) || eps[0];
    if (watchedSorted.length) {
      const last = watchedSorted[0];
      const lp = pm.get(last.id);
      next = lp.watched ? nextEpisode(last) || last : last;
    }
    if (next) { const c = card(next, pm.get(next.id)); c.duration = next.duration; out.nextUp = c; }
    // Mode anti-spoiler du profil : au-delà de l'épisode à suivre, titres, résumés et vignettes sont masqués
    if (next && uiPrefsOf(p).spoilerGuard) {
      const after = (s, e) => s > next.season_num || (s === next.season_num && e > next.episode_num);
      for (const s of out.seasons) {
        for (const e of s.episodes) if (e.season > 0 && after(e.season, e.episode)) { e.title = `Épisode ${e.episode}`; e.overview = null; e.still = null; e.hidden = true; }
        for (const m of s.missing || []) if (s.number > 0 && after(s.number, m.number)) { m.title = null; m.overview = null; m.still = null; m.hidden = true; }
        if (s.number > next.season_num) s.overview = null;
      }
      for (const s of out.absentSeasons || []) if (s.number > next.season_num) for (const m of s.missing) { m.title = null; m.still = null; m.hidden = true; }
      out.spoilerGuard = true;
    }
    const lastP = get('SELECT pr.updated_at AS updated, pr.device FROM progress pr JOIN items e ON e.id = pr.item_id WHERE pr.profile_id = ? AND e.show_id = ? ORDER BY pr.updated_at DESC LIMIT 1', p.id, item.id);
    if (lastP) out.lastWatch = lastP;
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
  } else {
    // Plus de ce genre : genres communs, mêmes acteurs, même réalisation, même catégorie (animé / série / film)
    const cr = parseJson(item.credits, {}) || {};
    const castNames = (cr.cast || []).slice(0, 10).map((x) => x.name);
    const dirNames = [...(cr.directors || []), ...(cr.creators || [])].map((x) => x.name);
    const cands = all(`SELECT i.* FROM items i WHERE i.type IN ('movie','show') AND i.id != ? AND ${age.sql}`, item.id, ...age.args);
    const scored = cands.map((c) => {
      const g = parseJson(c.genres, []).filter((x) => genres.includes(x)).length;
      const cc = parseJson(c.credits, {}) || {};
      const shared = (cc.cast || []).filter((x) => castNames.includes(x.name)).length;
      const sameDir = [...(cc.directors || []), ...(cc.creators || [])].some((x) => dirNames.includes(x.name));
      return { c, s: g + shared * 1.5 + (sameDir ? 2 : 0) + (c.type === item.type ? 0.5 : 0) + ((c.category === 'anime') === (item.category === 'anime') ? 0.5 : -1), g, shared, cc };
    });
    out.similar = scored.filter((x) => x.g >= 1 || x.shared >= 1).sort((a, b) => b.s - a.s).slice(0, 18).map((x) => card(x.c));
    // Avec les mêmes acteurs : une rangée par acteur principal présent dans d'autres titres de la médiathèque
    out.withCast = castNames.slice(0, 5).map((name) => ({
      name, role: ((cr.cast || []).find((x) => x.name === name) || {}).role || '', photo: ((cr.cast || []).find((x) => x.name === name) || {}).photo || null,
      items: scored.filter((x) => (x.cc.cast || []).some((p) => p.name === name) || (x.cc.directors || []).some((p) => p.name === name)).sort((a, b) => (b.c.year || 0) - (a.c.year || 0)).slice(0, 18).map((x) => card(x.c)),
    })).filter((r) => r.items.length).slice(0, 3);
  }
  sendJson(ctx.res, out);
});

// À venir : films, séries, animés qui sortent autour d'aujourd'hui, sur le NAS ou pas (voir upcoming.js)
router.get('/api/upcoming', async (ctx) => {
  const p = requireProfile(ctx);
  const type = ctx.url.searchParams.get('type');
  const out = type === 'movie' ? await upcomingMovies(p) : await upcomingShows(p, type === 'anime' ? 'anime' : 'show', ageClause(p, 's'));
  // Séries du NAS dont le guide n'a jamais été lu : on le récupère en arrière-plan pour la prochaine visite
  if (type !== 'movie') {
    const stale = all("SELECT id FROM items WHERE type = 'show' AND (guide_at IS NULL OR guide_at < ?) LIMIT 20", Date.now() - 3 * 864e5).map((r) => r.id);
    if (stale.length) setTimeout(() => { (async () => { for (const id of stale) await ensureGuide(id).catch(() => {}); })(); }, 50);
    // Prochains épisodes annoncés par TMDB : séries en cours rafraîchies une fois par jour
    const old = all("SELECT id FROM items WHERE type = 'show' AND credits LIKE '%Returning Series%' AND (ratings_at IS NULL OR ratings_at < ?) LIMIT 40", Date.now() - 864e5).map((r) => r.id);
    if (old.length) scheduleRatings(old);
  }
  sendJson(ctx.res, out);
});
// Calendrier « À venir » à ajouter au téléphone (abonnement iCal) : lien secret par profil, sans connexion
const icalTokens = () => { const m = getSetting('ical_tokens', {}); return m && typeof m === 'object' ? m : {}; };
function icalTokenFor(pid, reset = false) {
  const m = icalTokens();
  let tok = Object.keys(m).find((k) => m[k] === pid);
  if (tok && reset) { delete m[tok]; tok = null; }
  if (!tok) { tok = crypto.randomBytes(18).toString('base64url'); m[tok] = pid; setSetting('ical_tokens', m); }
  return tok;
}
const calLink = (ctx, tok) => `${ctx.req.headers['x-forwarded-proto'] === 'https' || ctx.req.socket.encrypted ? 'https' : 'http'}://${String(ctx.req.headers.host || 'localhost').replace(/[^\w.:[\]-]/g, '')}/cal/${tok}.ics`;
router.get('/api/calendar/link', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, { url: calLink(ctx, icalTokenFor(p.id)) }); });
router.post('/api/calendar/link/reset', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, { url: calLink(ctx, icalTokenFor(p.id, true)) }); });
router.get('/cal/:file', async (ctx) => {
  const tok = String(ctx.params.file || '').replace(/\.ics$/, '');
  const pid = icalTokens()[tok];
  const p = pid ? get('SELECT * FROM profiles WHERE id = ?', pid) : null;
  if (!p) throw new HttpError(404, 'Calendrier introuvable');
  const parts = await Promise.all([upcomingShows(p, 'show', ageClause(p, 's')), upcomingShows(p, 'anime', ageClause(p, 's')), upcomingMovies(p)].map((x) => x.catch((e) => { console.warn('[calendrier]', e.message); return { entries: [] }; })));
  const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  const d8 = (iso) => iso.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Venus//A venir//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`${getSetting('server_name', 'Venus')} — À venir`)}`, 'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  const seen = new Set();
  for (const e of parts.flatMap((x) => x.entries || [])) {
    if (!(e.nas || e.arr || e.wanted)) continue; // seulement ce qui vous concerne : NAS, demandé, favori
    const title = e.kind === 'movie' ? `${e.title}${e.release ? ` (${e.release.toLowerCase()})` : ''}` : `${e.show} ${e.season != null ? `S${e.season}É${e.episode}` : `épisode ${e.episode}`}`;
    const uid = `${e.key}-${e.season ?? ''}-${e.episode ?? ''}-${e.date}@venus`;
    if (seen.has(uid)) continue; seen.add(uid);
    lines.push('BEGIN:VEVENT', `UID:${esc(uid)}`, `DTSTAMP:${stamp}`);
    if (e.at) { const t = new Date(e.at).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); lines.push(`DTSTART:${t}`, 'DURATION:PT1H'); }
    else { const next = new Date(`${e.date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); lines.push(`DTSTART;VALUE=DATE:${d8(e.date)}`, `DTEND;VALUE=DATE:${d8(next.toISOString().slice(0, 10))}`); }
    lines.push(`SUMMARY:${esc(title)}`, `DESCRIPTION:${esc([e.epTitle, e.nas ? 'Sur le NAS' : e.arr ? 'Demandé : téléchargé dès sa sortie' : 'Favori', e.overview].filter(Boolean).join(' — ').slice(0, 600))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const body = lines.map((l) => (l.length > 74 ? l.match(/.{1,73}/gu).join('\r\n ') : l)).join('\r\n');
  ctx.res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=1800', 'Content-Disposition': 'inline; filename="venus-a-venir.ics"' });
  ctx.res.end(body);
});

// Favori d'un titre pas encore sur le NAS (envoyé à Radarr / Sonarr pour le téléchargement), ou téléchargement direct
const wantedBody = async (ctx) => {
  const b = validate(await readBody(ctx.req, 16384), {
    key: V.str({ max: 200 }), kind: V.oneOf(['movie', 'show', 'anime']), title: V.str({ max: 300 }), year: V.int({ min: 1880, max: 2200 }),
    poster: V.str({ max: 1000 }), image: V.str({ max: 1000 }), date: V.str({ max: 20 }), tmdb: V.int({ min: 1, max: 1e9 }), tvdb: V.int({ min: 1, max: 1e9 }), anilist: V.int({ min: 1, max: 1e9 }), download: V.bool(),
  }, { required: ['key', 'kind', 'title'] });
  for (const f of ['poster', 'image']) if (b[f] && !/^https:\/\//i.test(b[f])) b[f] = null;
  return b;
};
router.get('/api/wanted', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, wantedOf(p.id)); });
router.post('/api/wanted', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await wantedBody(ctx);
  sendJson(ctx.res, await addWanted(p, b, { download: b.download !== false }));
});
router.del('/api/wanted', async (ctx) => {
  const p = requireProfile(ctx);
  const r = await removeWanted(p.id, String(ctx.url.searchParams.get('key') || ''));
  if (r.removed) setTimeout(() => scanAll(), 5000); // fichiers supprimés : la médiathèque se met à jour
  sendJson(ctx.res, r);
});
router.post('/api/wanted/grab', async (ctx) => {
  const p = arrUser(ctx);
  const b = await wantedBody(ctx);
  try { sendJson(ctx.res, await grab(p, b)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(e.status || 502, e.message); }
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
    topShows: [...shows.values()].filter((x) => !x.anime && (x.eps || x.secs >= 600)).sort((a, b) => b.secs - a.secs).slice(0, 6).map((x) => ({ ...x, hours: Math.round(x.secs / 36) / 100 })),
    lastMovies: movies.sort((a, b) => b.at - a.at).slice(0, 6),
    person: [...people].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    bestMonth: months.reduce((a, b) => (b.hours > a.hours ? b : a), months[0]),
    // Répartition par genre de contenu, jour de la semaine (lundi = 0) et heure de la journée
    byKind: ['movie', 'show', 'anime', 'clip'].map((k) => ({ kind: k, hours: Math.round(sum(yr.filter((r) => (k === 'movie' ? r.type === 'movie' : k === 'clip' ? r.type === 'clip' : r.type === 'episode' && ((r.show_cat === 'anime') === (k === 'anime'))))) / 36) / 100 })),
    weekdays: Array.from({ length: 7 }, (_, w) => ({ w, hours: Math.round(sum(yr.filter((r) => (new Date(r.updated_at).getDay() + 6) % 7 === w)) / 36) / 100 })),
    // Rétrospective : l'animé le plus regardé, et les séries / animés terminés cette année (tous leurs épisodes vus)
    completedShows: (() => {
      const ids = [...shows.keys()];
      if (!ids.length) return [];
      const tot = new Map(all(`SELECT show_id AS s, COUNT(*) AS n FROM items WHERE type = 'episode' AND season_num > 0 AND show_id IN (${ids.map(() => '?').join(',')}) GROUP BY show_id`, ...ids).map((r) => [r.s, r.n]));
      const seen = new Map(all(`SELECT i.show_id AS s, COUNT(*) AS n, MAX(pr.updated_at) AS last FROM progress pr JOIN items i ON i.id = pr.item_id WHERE pr.profile_id = ? AND pr.watched = 1 AND i.type = 'episode' AND i.season_num > 0 GROUP BY i.show_id`, p.id).map((r) => [r.s, r]));
      return ids.filter((id) => tot.get(id) && seen.get(id) && seen.get(id).n >= tot.get(id) && new Date(seen.get(id).last).getFullYear() === year)
        .map((id) => { const x = shows.get(id); return { id, title: x.title, poster: x.poster, anime: x.anime, episodes: tot.get(id) }; });
    })(),
    hoursOfDay: Array.from({ length: 24 }, (_, hr) => ({ h: hr, hours: Math.round(sum(yr.filter((r) => new Date(r.updated_at).getHours() === hr)) / 36) / 100 })),
    // Calendrier : minutes regardées chaque jour de l'année (temps réel de lecture, sinon reconstitué)
    calendar: (() => {
      const m = new Map(all('SELECT day, seconds FROM watch_time WHERE profile_id = ? AND day LIKE ?', p.id, `${year}-%`).map((r) => [r.day, Math.round(r.seconds / 60)]));
      if (!m.size) for (const r of yr) { const k = new Date(r.updated_at).toISOString().slice(0, 10); m.set(k, (m.get(k) || 0) + Math.round(secs(r) / 60)); }
      return Object.fromEntries(m);
    })(),
    topAnime: [...shows.values()].filter((x) => x.anime && (x.eps || x.secs >= 600)).sort((a, b) => b.secs - a.secs).slice(0, 6).map((x) => ({ ...x, hours: Math.round(x.secs / 36) / 100 })),
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

// Filmographie d'une personne hors de la médiathèque (Wikidata), avec ce qui est déjà sur le NAS et les favoris
// Photo d'une personne sans photo dans la fiche (lot de noms, réponses gardées en mémoire du serveur)
router.get('/api/people/photos', async (ctx) => {
  requireProfile(ctx);
  const names = String(ctx.url.searchParams.get('names') || '').split('|').map((n) => n.trim()).filter(Boolean).slice(0, 24);
  const out = {};
  await Promise.all(names.map(async (n) => { out[n] = await personPhoto(n).catch(() => null); }));
  sendJson(ctx.res, out);
});
router.get('/api/people/films', async (ctx) => {
  const p = requireProfile(ctx);
  const name = String(ctx.url.searchParams.get('name') || '').trim().slice(0, 120);
  if (!name) return sendJson(ctx.res, { items: [] });
  let list = [];
  try { list = await filmography(name); } catch (e) { return sendJson(ctx.res, { items: [], error: `Filmographie indisponible pour l’instant (Wikidata ne répond pas : ${e.message})` }); }
  const byImdb = new Map(all("SELECT id, imdb_id FROM items WHERE imdb_id IS NOT NULL AND type IN ('movie','show')").map((r) => [r.imdb_id, r.id]));
  const byTitle = new Map(all("SELECT id, type, title, year FROM items WHERE type IN ('movie','show')").map((r) => [`${r.type}|${String(r.title).toLowerCase()}|${r.year || ''}`, r.id]));
  const wanted = new Set(all('SELECT key FROM wanted WHERE profile_id = ?', p.id).map((r) => r.key));
  const kids = p.max_age != null;
  const items = list.map((x) => ({ ...x, key: `imdb:${x.imdb}`, nas: byImdb.get(x.imdb) || byTitle.get(`${x.kind}|${String(x.title).toLowerCase()}|${x.year || ''}`) || null, wanted: wanted.has(`imdb:${x.imdb}`) }))
    .filter((x) => !kids || x.nas);
  sendJson(ctx.res, { items, radarr: arrOn('radarr'), sonarr: arrOn('sonarr'), kids });
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

// ------------------------------------------------------------------ « Nouveau » : demandes à Radarr / Sonarr
// Profils enfants exclus ; les autres peuvent demander. L'administrateur règle les services.
const arrUser = (ctx) => { const p = requireProfile(ctx); if (p.max_age != null && p.max_age <= 12) throw new HttpError(403, 'Pas de demandes pour un profil enfant'); return p; };
const arrLimiter = new Map();
router.get('/api/arr/status', (ctx) => { arrUser(ctx); sendJson(ctx.res, { radarr: arrOn('radarr'), sonarr: arrOn('sonarr'), lidarr: arrOn('lidarr'), books: booksOn(), booksApp: booksConf().app }); });
router.get('/api/arr/search', async (ctx) => {
  arrUser(ctx);
  const kind = ['movie', 'show', 'anime'].includes(ctx.url.searchParams.get('kind')) ? ctx.url.searchParams.get('kind') : 'movie';
  sendJson(ctx.res, await arrSearch(kind, ctx.url.searchParams.get('q')));
});
router.post('/api/arr/add', async (ctx) => {
  const p = arrUser(ctx);
  const last = arrLimiter.get(p.id) || 0;
  if (Date.now() - last < 2000) throw new HttpError(429, 'Un instant…');
  arrLimiter.set(p.id, Date.now());
  const b = validate(await readBody(ctx.req, 2048), { kind: V.str({ max: 10 }), id: V.int({ min: 1, max: 1e9 }) }, { required: ['kind', 'id'] });
  if (!['movie', 'show', 'anime'].includes(b.kind)) throw new HttpError(400, 'Type inconnu');
  const r = await arrAdd(b.kind, b.id);
  logActivity('request', `${p.name} a demandé « ${r.title} »${r.already ? ' (déjà demandé)' : ''}`);
  sendJson(ctx.res, r);
});
router.get('/api/arr/queue', async (ctx) => { arrUser(ctx); sendJson(ctx.res, await arrQueue()); });
// ------------------------------------------------------------------ performances : carte graphique, mémoire, versions optimisées, NAS
function hostGpuHint() {
  // /sys est visible dans le conteneur : une carte présente sur la machine mais pas transmise à Docker se voit ici
  if (hw.type !== 'none') return null;
  try {
    const cards = fs.readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n));
    for (const c of cards) {
      const v = fs.readFileSync(`/sys/class/drm/${c}/device/vendor`, 'utf8').trim();
      const name = { '0x8086': 'Intel', '0x1002': 'AMD', '0x10de': 'NVIDIA' }[v];
      if (name) return `Une carte graphique ${name} est présente sur la machine mais n’est pas transmise à Venus : lancez « bash update.sh » dans le dossier de Venus pour l’activer.`;
    }
  } catch { /* pas de /sys */ }
  return null;
}
router.get('/api/admin/perf', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { hw: { type: hw.type, label: hw.label, tested: hw.tested, hint: hostGpuHint() }, transcode: transcodePlace(), optimize: optStatus(), nas: nasHealth() });
});
router.post('/api/admin/perf/optimize', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  if (['auto', 'on', 'off'].includes(b.mode)) setSetting('optimize_mode', b.mode);
  if (b.clear) clearOptimized();
  if (b.run) runOptimize().catch(() => {});
  sendJson(ctx.res, optStatus());
});
router.post('/api/admin/notify/telegram-sample', async (ctx) => {
  requireAdmin(ctx);
  try { sendJson(ctx.res, await sendSample()); } catch (e) { throw new HttpError(400, `Telegram : ${e.message}`); }
});
router.post('/api/admin/perf/nas', async (ctx) => { requireAdmin(ctx); sendJson(ctx.res, await checkNas()); });

router.get('/api/admin/arr', (ctx) => {
  requireAdmin(ctx);
  const view = (app) => { const c = arrConf(app); return { url: c.url, keySet: !!c.key, profile: c.profile, metaProfile: c.metaProfile, root: c.root, animeRoot: c.animeRoot, on: arrOn(app) }; };
  sendJson(ctx.res, { radarr: view('radarr'), sonarr: view('sonarr'), lidarr: view('lidarr'), books: booksConf() });
});
router.put('/api/admin/arr/:app', async (ctx) => {
  requireAdmin(ctx);
  const app = ctx.params.app;
  if (!['radarr', 'sonarr', 'lidarr'].includes(app)) throw new HttpError(404, 'Service inconnu');
  const b = validate(await readBody(ctx.req, 4096), { url: V.str({ max: 300 }), key: V.str({ max: 100 }), profile: V.int({ min: 0, max: 1e6 }), metaProfile: V.int({ min: 0, max: 1e6 }), root: V.str({ max: 500 }), animeRoot: V.str({ max: 500 }), remove: V.bool() });
  if (b.remove) { saveArr(app, { url: '', key: null, profile: 0, root: '', animeRoot: '' }); sendJson(ctx.res, { ok: true }); return; }
  // Test avant d'enregistrer : adresse et clé doivent répondre
  const cur = arrConf(app);
  const conf = { ...cur, url: b.url !== undefined ? String(b.url).trim().replace(/\/+$/, '') : cur.url, key: b.key || cur.key };
  const opts = await arrOptions(app, conf);
  saveArr(app, b);
  sendJson(ctx.res, { ok: true, ...opts });
});
router.get('/api/admin/arr/:app/options', async (ctx) => {
  requireAdmin(ctx);
  if (!['radarr', 'sonarr', 'lidarr'].includes(ctx.params.app)) throw new HttpError(404, 'Service inconnu');
  sendJson(ctx.res, await arrOptions(ctx.params.app));
});
// Application de livres (LazyLibrarian ou Bookshelf) : réglages, test, recherche, demande
router.put('/api/admin/books-app', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 4096), { app: V.str({ max: 20 }), url: V.str({ max: 300 }), key: V.str({ max: 100 }), profile: V.int({ min: 0, max: 1e6 }), metaProfile: V.int({ min: 0, max: 1e6 }), root: V.str({ max: 500 }), remove: V.bool() });
  if (b.remove) { saveBooksApp({ remove: true }); sendJson(ctx.res, { ok: true }); return; }
  if (b.url !== undefined || b.key) {
    const cur = booksConf();
    const app = b.app || cur.app;
    const test = await booksTest({ app, url: b.url !== undefined ? String(b.url).trim().replace(/\/+$/, '') : cur.url, key: b.key || undefined });
    saveBooksApp(b);
    sendJson(ctx.res, { ok: true, ...test });
    return;
  }
  saveBooksApp(b);
  sendJson(ctx.res, { ok: true, ...booksConf() });
});
router.get('/api/admin/books-app/options', async (ctx) => { requireAdmin(ctx); sendJson(ctx.res, await booksTest()); });
// Reconnaissance musique et livres : état et lancement à la main
router.get('/api/admin/music-meta', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, musicMetaStatus()); });
router.post('/api/admin/music-meta/run', async (ctx) => { requireAdmin(ctx); const b = await readBody(ctx.req, 256).catch(() => ({})); runMusicMeta({ force: !!b.force }).catch((e) => console.warn('[musique]', e.message)); sendJson(ctx.res, { started: true }); });
router.put('/api/admin/music-meta', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 1024), { acoustidKey: V.str({ max: 100 }) });
  if (b.acoustidKey !== undefined) setSetting('acoustid_key', String(b.acoustidKey).trim());
  sendJson(ctx.res, musicMetaStatus());
});
router.get('/api/admin/books-meta', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, booksMetaStatus()); });
router.post('/api/admin/books-meta/run', async (ctx) => { requireAdmin(ctx); const b = await readBody(ctx.req, 256).catch(() => ({})); runBooksMeta({ force: !!b.force }).catch((e) => console.warn('[livres]', e.message)); sendJson(ctx.res, { started: true }); });

// Musique : recherche et demandes Lidarr
router.get('/api/music/search', async (ctx) => { arrUser(ctx); sendJson(ctx.res, await lidarrSearch(ctx.url.searchParams.get('q'))); });
router.post('/api/music/request', async (ctx) => {
  const p = arrUser(ctx);
  const b = validate(await readBody(ctx.req, 2048), { album: V.str({ max: 60 }), artist: V.str({ max: 60 }) });
  if (!b.album && !b.artist) throw new HttpError(400, 'Album ou artiste requis');
  const r = b.album ? await lidarrAddAlbum(b.album) : await lidarrAddArtist(b.artist);
  logActivity('request', `${p.name} a demandé « ${r.title} » (musique)${r.already ? ' (déjà demandé)' : ''}`);
  sendJson(ctx.res, r);
});
// Livres : recherche et demandes (LazyLibrarian / Bookshelf)
router.get('/api/books/search', async (ctx) => { arrUser(ctx); sendJson(ctx.res, await booksSearch(ctx.url.searchParams.get('q'))); });
router.post('/api/books/request', async (ctx) => {
  const p = arrUser(ctx);
  const b = validate(await readBody(ctx.req, 2048), { id: V.str({ max: 80 }), title: V.str({ max: 300 }), author: V.str({ max: 200 }), isbn: V.str({ max: 20 }) });
  const r = await booksAdd(b);
  logActivity('request', `${p.name} a demandé « ${r.title} » (livre)${r.already ? ' (déjà demandé)' : ''}`);
  sendJson(ctx.res, r);
});

// Vérification des chaînes de TV en direct : état, et lancement à la main (toutes ou une seule)
router.get('/api/admin/channels/health', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { ...channelHealth(), check: checkState, down: all("SELECT id, title, ch_error AS error, ch_checked AS checked FROM items WHERE type = 'channel' AND ch_ok = 0 ORDER BY episode_num LIMIT 300") });
});
router.post('/api/admin/channels/check', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096).catch(() => ({})) || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite).slice(0, 50) : null;
  if (ids && ids.length) { await checkChannels({ ids }); sendJson(ctx.res, { ...checkState }); return; }
  checkChannels().catch(() => {});
  sendJson(ctx.res, { started: true, ...checkState });
});
// Bande-annonce à la demande (sans clé TMDB) : recherche YouTube côté serveur, mémorisée
const trailerLimiter = new Map();
router.post('/api/items/:id/trailer', async (ctx) => {
  requireProfile(ctx);
  const id = Number(ctx.params.id);
  const last = trailerLimiter.get(id) || 0;
  if (Date.now() - last < 5000) throw new HttpError(429, 'Un instant…');
  trailerLimiter.set(id, Date.now());
  const key = await findTrailerFor(id);
  sendJson(ctx.res, { trailer: key });
});
router.post('/api/items/:id/watched', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  const targets = item.type === 'show' ? all("SELECT id, duration FROM items WHERE type='episode' AND show_id=?", item.id)
    : item.type === 'season' ? all("SELECT id, duration FROM items WHERE type='episode' AND parent_id=?", item.id) : [item];
  traktWatched(p.id, targets.map((t) => t.id), b.watched !== false);
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
  const b = validate(await readBody(ctx.req, 8192), { itemId: V.int({ min: 1 }), position: V.num({ min: 0, max: 1e6 }), duration: V.num({ min: 0, max: 1e6 }), sessionId: V.str({ max: 64 }), watched: V.bool(), idle: V.num({ min: 0, max: 1e7 }), activePos: V.num({ min: 0, max: 1e6 }) }, { required: ['itemId'] });
  const id = Number(b.itemId);
  let pos = Math.max(0, Number(b.position) || 0);
  const dur = Math.max(0, Number(b.duration) || 0);
  if (!id) throw new HttpError(400, 'itemId requis');
  // Endormi devant l'écran : aucun geste depuis longtemps alors que la vidéo défile → la reprise se fait au
  // dernier geste (moins une minute), pas là où la vidéo s'est arrêtée toute seule
  const sleepMin = Number(getSetting('sleep_rewind_min', 45)) || 45;
  const asleep = Number(b.idle) >= sleepMin * 60 && Number.isFinite(Number(b.activePos)) && pos - Number(b.activePos) > 300;
  if (asleep) pos = Math.max(0, Number(b.activePos) - 60);
  const watched = !asleep && dur > 0 && pos / dur > 0.92 ? 1 : 0;
  // Vu jusqu'au bout pour la première fois : envoyé à Trakt (si le profil a relié son compte)
  if (watched) {
    const was = get('SELECT watched FROM progress WHERE profile_id = ? AND item_id = ?', p.id, id);
    if (!was || !was.watched) traktWatched(p.id, [id], true);
    // Épisode terminé : le « Précédemment dans… » du suivant se prépare tout de suite
    const ep = get("SELECT * FROM items WHERE id = ? AND type = 'episode'", id);
    if (ep && nextEpisode(ep)) prepareRecap(ep).catch(() => {});
  }
  // Temps réellement regardé (pour la limite quotidienne) : l'écart depuis la dernière position, borné à 2 min par envoi
  try { const prev = get('SELECT position, updated_at FROM progress WHERE profile_id = ? AND item_id = ?', p.id, id); if (prev && pos > prev.position) addWatchTime(p.id, Math.min(120, pos - prev.position)); } catch (e) { console.warn('[progression] temps d’écran :', e.message); }
  run(`INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at, device, asleep) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, item_id) DO UPDATE SET position=excluded.position, duration=excluded.duration,
       watched=excluded.watched, updated_at=excluded.updated_at, device=excluded.device, asleep=excluded.asleep`,
  p.id, id, watched ? 0 : pos, dur, watched, Date.now(), deviceLabel(ctx.auth && ctx.auth.device), asleep ? 1 : 0);
  if (b.sessionId) sessions.get(b.sessionId)?.touch();
  sendJson(ctx.res, { watched: !!watched, asleep, position: pos });
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
    profile: p.name, avatar: p.avatar, deviceName: deviceLabel(ctx.req.headers['user-agent']), ip: ctx.ip,
    position: Math.max(0, Number(b.position) || 0), duration: Math.max(0, Number(b.duration) || 0), paused: !!b.paused, live: !!b.live,
    mode: String(b.mode || ''), quality: String(b.quality || ''), hw: b.hw ? String(b.hw) : null, sessionId: b.sessionId || null,
  });
  sendJson(ctx.res, { ok: true });
});

// Adresse lisible (#/lecture/Breaking.Bad.S01E02) → numéro du titre
router.get('/api/resolve', (ctx) => {
  requireProfile(ctx);
  const q = new URL(ctx.req.url, 'http://x').searchParams;
  // /series/Breaking.Bad/S01E02 : la série puis l'épisode
  const id = q.get('ep') ? resolveEpisode(q.get('slug'), q.get('ep')) : resolveSlug(q.get('slug'));
  if (!id) throw new HttpError(404, 'Vidéo introuvable : elle a peut-être été renommée ou supprimée');
  sendJson(ctx.res, { id, slug: slugFor(id) });
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
  if (!probe.chaptersChecked) {
    probe.chapters = await readChapters(item.path, probe.duration); probe.chaptersChecked = true;
    run('UPDATE items SET probe = ? WHERE id = ?', JSON.stringify(probe), item.id);
  }
  if (!b.preview) ensureTrickplay(item, true);

  // Choix des pistes par défaut selon les préférences du profil
  const langMatch = (l, pref) => l && pref && (l.startsWith(pref) || ({ fr: ['fre', 'fra'], en: ['eng'] }[pref] || []).includes(l));
  // Choix mémorisé pour cette série (VO sous-titrée choisie sur l'épisode 1 : gardée pour les suivants, par profil)
  const showKey = item.show_id || (item.type === 'show' ? item.id : null);
  const remembered = showKey && !b.preview ? get('SELECT * FROM track_prefs WHERE profile_id = ? AND show_id = ?', p.id, showKey) : null;
  let audioOrder = Number.isInteger(b.audio) ? b.audio : null;
  if (audioOrder == null && remembered && remembered.audio_lang) { const m = probe.audio.find((a) => langMatch(a.lang, remembered.audio_lang)); if (m) audioOrder = m.order; }
  if (audioOrder == null) {
    const pref = probe.audio.find((a) => langMatch(a.lang, p.audio_lang));
    audioOrder = pref ? pref.order : (probe.audio.find((a) => a.isDefault) || probe.audio[0] || { order: 0 }).order;
  }
  let subId = b.sub === undefined ? undefined : b.sub;
  if (subId === undefined && remembered && remembered.sub_mode) {
    if (remembered.sub_mode === 'none') subId = null;
    else { const m = probe.subs.find((x) => x.text && langMatch(x.lang, remembered.sub_lang) && (remembered.sub_mode === 'forced' ? x.forced : !x.forced)) || probe.subs.find((x) => langMatch(x.lang, remembered.sub_lang)); if (m) subId = m.id; }
  }
  if (subId === undefined) {
    const audio = probe.audio[audioOrder];
    const audioIsPref = audio && langMatch(audio.lang, p.audio_lang);
    // Sous-titres forcés si l'audio est dans la langue du profil, sinon sous-titres complets dans sa langue
    const textSubs = probe.subs.filter((s) => s.text && langMatch(s.lang, p.subtitle_lang));
    const pick = audioIsPref ? textSubs.find((s) => s.forced) : textSubs.find((s) => !s.forced) || textSubs[0];
    subId = pick ? pick.id : null;
  }
  // Choix explicite de l'utilisateur : mémorisé pour la série
  if (showKey && !b.preview && (Number.isInteger(b.audio) || b.sub !== undefined)) try {
    const a = Number.isInteger(b.audio) ? probe.audio.find((x) => x.order === b.audio) : null;
    const sb = b.sub ? probe.subs.find((x) => x.id === b.sub) : null;
    run(`INSERT INTO track_prefs(profile_id, show_id, audio_lang, sub_lang, sub_mode, updated_at) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, show_id) DO UPDATE SET audio_lang = COALESCE(excluded.audio_lang, audio_lang), sub_lang = CASE WHEN excluded.sub_mode IS NULL THEN sub_lang ELSE excluded.sub_lang END, sub_mode = COALESCE(excluded.sub_mode, sub_mode), updated_at = excluded.updated_at`,
    p.id, showKey, a ? a.lang || null : null, sb ? sb.lang || null : null, b.sub === undefined ? null : b.sub === null ? 'none' : sb && sb.forced ? 'forced' : 'full', Date.now());
  } catch (e) { console.warn('[lecture] mémoire des pistes :', e.message); }
  const sub = subId ? probe.subs.find((s) => s.id === subId) : null;
  const burnIndex = sub && !sub.text && !sub.external ? sub.index : null;

  let decision = decide(probe, { caps: b.caps, audioOrder, quality: b.preview ? 'auto' : b.quality || 'auto', burnSub: b.preview ? null : burnIndex, maxBitrate: Number(b.maxBitrate) || 0 });
  // Version optimisée prête (H.264 + AAC) : lue telle quelle au lieu d'être convertie
  let playItem = item, playProbe = probe, optimized = false;
  if (decision.mode === 'transcode' && burnIndex == null && (b.preview || !b.quality || b.quality === 'auto') && audioOrder < 4) {
    const o = optimizedFor(item);
    if (o && o.probe) {
      const d2 = decide(o.probe, { caps: b.caps, audioOrder, quality: 'auto', maxBitrate: Number(b.maxBitrate) || 0 });
      if (d2.mode !== 'transcode') { decision = { ...d2, reason: 'Version optimisée' }; playItem = { ...item, path: o.path }; playProbe = o.probe; optimized = true; markUsed(item.id); }
    }
  }
  if (!b.preview) pauseForPlayback(); // la préparation des versions optimisées laisse la place à la lecture
  if (decision.mode === 'transcode' && !b.preview && !item.stream_url) { try { logTranscode({ device: deviceLabel(ctx.req.headers['user-agent']), reason: decision.reason, itemId: item.id, codec: probe.video && probe.video.codec, container: path.extname(item.path || '').slice(1) }); } catch (e) { console.warn('[lecture] journal des conversions :', e.message); } }
  decision.burnIndex = b.preview ? null : burnIndex;
  if (!b.preview && dailyLeft(p) === 0) throw new HttpError(403, 'Temps d’écran du jour épuisé pour ce profil. On se retrouve demain !');
  if (decision.mode === 'transcode' && !b.preview && !permsOf(p).transcode) throw new HttpError(403, 'Cette vidéo doit être convertie pour cet appareil, ce qui n’est pas autorisé pour ce profil. Essayez sur un autre appareil ou demandez à l’administrateur.');
  // Aperçu (affiche d'accueil) : lecture directe quand c'est possible ; sinon petite conversion légère
  // Aperçu du bandeau d'accueil : bonne qualité dès le lancement (1080p au plus), les vignettes restent légères
  if (b.preview && decision.mode === 'transcode') Object.assign(decision, b.hero ? { limitHeight: 1080, limitBitrate: 6e6 } : { limitHeight: 480, limitBitrate: 1.2e6 });
  const progress = get('SELECT * FROM progress WHERE profile_id=? AND item_id=?', p.id, item.id);
  const resumeAt = progress && !progress.watched && progress.position > 20 ? Math.max(0, progress.position - 3) : 0;
  const start = b.start === 'resume' || b.start == null ? resumeAt : Math.max(0, Number(b.start) || 0);
  const resumeAsleep = !!(progress && progress.asleep && (b.start === 'resume' || b.start == null) && resumeAt > 0);
  const token = ctx.auth.token;
  let url, sessionId = null, offset = 0;
  if (b.replace) sessions.get(b.replace)?.stop();
  if (decision.mode === 'direct') {
    url = `/api/stream/${item.id}/file?token=${encodeURIComponent(token)}${optimized ? '&v=opt' : ''}`;
  } else {
    const s = startSession({ item: playItem, probe: playProbe, decision, start, profileId: p.id, quality: b.quality || 'auto' });
    sessionId = s.id; offset = s.offset;
    url = `/api/hls/${s.id}/index.m3u8`;
  }

  const next = item.type === 'episode' ? nextEpisode(item) : null;
  const prev = item.type === 'episode' ? prevEpisode(item) : null;
  if (item.type === 'episode') scheduleSeason(item.parent_id, true); // génériques prêts pour la suite
  if (!b.preview) { scheduleScenes(item.id, true); scheduleDialogues(item.id, true); } // scènes et dialogues : « Précédemment », moments forts, chapitres, recherche
  // Fichier sans chapitres : chapitres générés d'après les scènes et les dialogues
  let chapters = probe.chapters || [];
  if (chapters.length < 2 && !b.preview) { const g = await chaptersFor(item, probe).catch(() => []); if (g.length) chapters = g; }
  sendJson(ctx.res, {
    itemId: item.id, slug: slugFor(item.id), path: pathFor(item.id, { play: true }), type: item.type, mode: decision.mode, reason: decision.reason, url, sessionId, offset,
    hwLabel: decision.mode === 'transcode' ? hw.label : null,
    duration: probe.duration, title: item.show_title || item.title, showId: item.show_id || null, season: item.season_num ?? null,
    subtitle: item.type === 'episode' ? `S${item.season_num} · É${item.episode_num} — ${item.title}` : (item.year ? String(item.year) : ''),
    backdrop: item.show_backdrop || item.backdrop || item.still, logo: item.show_logo || item.logo,
    startAt: start, resumeAsleep,
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
    chapters,
    trickplay: trickplayPublic(item),
  });
});

// Vignettes de la barre de progression : description des planches (null tant qu'elles se préparent)
function trickplayPublic(item) {
  const t = trickplayInfo(item);
  return t ? { interval: t.interval, width: t.width, height: t.height, cols: t.cols, rows: t.rows, count: t.count, sheets: t.sheets, url: `/api/items/${item.id}/trickplay/` } : null;
}
router.get('/api/items/:id/trickplay', (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  const t = trickplayPublic(item);
  if (!t) ensureTrickplay(item, true);
  sendJson(ctx.res, { ready: !!t, trickplay: t, mode: trickplayMode() });
});
router.get('/api/items/:id/trickplay/:n', (ctx) => {
  const n = Number(String(ctx.params.n).replace(/\.jpg$/, ''));
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new HttpError(400, 'Planche invalide');
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  requireVisible(ctx, item, 'Vignettes pas encore prêtes');
  const file = item && trickplaySheet(item, n);
  if (!file) throw new HttpError(404, 'Vignettes pas encore prêtes');
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=2592000, immutable' });
});

// La chaîne n'a pas démarré chez quelqu'un : retest immédiat, cachée si elle échoue encore
router.post('/api/channels/:id/failed', async (ctx) => {
  const p = requireProfile(ctx);
  const id = Number(ctx.params.id);
  const r = await reportChannelFailure(id);
  const it = get("SELECT title FROM items WHERE id = ? AND type = 'channel'", id);
  // Favori, ou La 1ère : la chaîne reste dans la liste même si elle ne répond pas pour le moment
  const keep = (it && neverHide(it.title)) || channelFavs(p.id).includes(id);
  sendJson(ctx.res, { ok: true, hidden: r && !r.ok && !keep, keep: !!(r && !r.ok && keep), error: r && !r.ok ? r.error : null });
});

// ---------------------------------------------------------------- chaînes du monde (iptv-org) : listes choisies
router.get('/api/admin/iptv-org', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { lists: iptvWorldLists(), defaults: IPTV_WORLD_DEFAULT, added: !!get('SELECT 1 FROM libraries WHERE path = ?', IPTV_WORLD) });
});
router.put('/api/admin/iptv-org', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req);
  const lists = [...new Set((Array.isArray(b.lists) ? b.lists : []).map(iptvListName).filter(Boolean))].slice(0, 40);
  if (!lists.length) throw new HttpError(400, 'Choisissez au moins une liste (pays, langue ou catégorie)');
  setSetting('iptvorg_lists', lists);
  if (!get('SELECT 1 FROM libraries WHERE path = ?', IPTV_WORLD)) run('INSERT INTO libraries(name, type, path) VALUES(?, ?, ?)', 'Chaînes du monde (iptv-org)', 'iptv', IPTV_WORLD);
  scanAll();
  sendJson(ctx.res, { ok: true, lists });
});

// ---------------------------------------------------------------- import depuis Plex / Jellyfin / Emby
router.post('/api/admin/import/check', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  const kind = b.kind === 'plex' ? 'plex' : 'jellyfin';
  try { sendJson(ctx.res, await checkSource(kind, b.url, String(b.token || '').trim())); } catch (e) { throw new HttpError(400, `${kind === 'plex' ? 'Plex' : 'Jellyfin'} : ${e.message}`); }
});
router.post('/api/admin/import/run', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  const kind = b.kind === 'plex' ? 'plex' : 'jellyfin';
  const prof = get('SELECT id, name FROM profiles WHERE id = ?', Number(b.profileId));
  if (!prof) throw new HttpError(400, 'Choisissez le profil Venus qui reçoit l’historique');
  if (kind !== 'plex' && !b.user) throw new HttpError(400, 'Choisissez l’utilisateur Jellyfin');
  try {
    const r = await importSource(kind, b.url, String(b.token || '').trim(), String(b.user || ''), prof.id);
    logActivity('admin', `Import ${kind === 'plex' ? 'Plex' : 'Jellyfin'} → ${prof.name} : ${r.watched} vus, ${r.resumed} en cours`);
    sendJson(ctx.res, r);
  } catch (e) { throw new HttpError(400, `${kind === 'plex' ? 'Plex' : 'Jellyfin'} : ${e.message}`); }
});

// ---------------------------------------------------------------- accès hors de la maison (tunnel Cloudflare, Tailscale)
router.get('/api/admin/remote', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, remoteStatus(ctx.req)); });
router.post('/api/admin/remote', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  const mode = ['quick', 'token', 'off'].includes(b.mode) ? b.mode : 'off';
  try {
    const r = await startRemote(mode, b.token);
    logActivity('admin', mode === 'off' ? 'Accès hors de la maison coupé' : `Accès hors de la maison activé (${mode === 'quick' ? 'lien rapide' : 'tunnel Cloudflare'})`);
    sendJson(ctx.res, { ...r, ...remoteStatus(ctx.req), running: r.running, url: r.url, connected: r.connected, error: r.error });
  } catch (e) { throw new HttpError(400, e.message); }
});

// ---------------------------------------------------------------- synchronisation Trakt (par profil)
router.get('/api/trakt', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, linkState(p.id)); });
router.post('/api/trakt/link', async (ctx) => { const p = requireProfile(ctx); try { sendJson(ctx.res, await startLink(p.id)); } catch (e) { throw new HttpError(400, e.message); } });
router.post('/api/trakt/link/poll', async (ctx) => {
  const p = requireProfile(ctx);
  const r = await pollLink(p.id);
  // Compte relié : l'historique Trakt arrive dans Venus en arrière-plan
  if (r.linked) importTrakt(p.id).catch((e) => console.warn('[trakt] premier import :', e.message));
  sendJson(ctx.res, r);
});
router.del('/api/trakt/link', async (ctx) => { const p = requireProfile(ctx); await unlink(p.id); sendJson(ctx.res, { ok: true }); });
router.post('/api/trakt/import', async (ctx) => { const p = requireProfile(ctx); try { sendJson(ctx.res, await importTrakt(p.id)); } catch (e) { throw new HttpError(400, e.message); } });
router.put('/api/trakt', async (ctx) => { const p = requireProfile(ctx); const b = await readBody(ctx.req); setTraktPush(p.id, b.push !== false); sendJson(ctx.res, linkState(p.id)); });

// ---------------------------------------------------------------- chaînes favorites (par profil)
const channelFavs = (pid) => { const v = getSetting(`tv_favs:${pid}`, []); return Array.isArray(v) ? v.map(Number).filter(Boolean) : []; };
router.get('/api/channels/favorites', (ctx) => { const p = requireProfile(ctx); sendJson(ctx.res, { ids: channelFavs(p.id), categories: CATEGORIES }); });
router.post('/api/channels/:id/favorite', async (ctx) => {
  const p = requireProfile(ctx);
  const id = Number(ctx.params.id), b = await readBody(ctx.req);
  const ch = get("SELECT * FROM items WHERE id = ? AND type = 'channel'", id);
  if (!ch || !visible(p, ch)) throw new HttpError(404, 'Chaîne introuvable');
  const list = channelFavs(p.id).filter((x) => x !== id);
  if (b.on !== false) list.push(id);
  setSetting(`tv_favs:${p.id}`, list.slice(-500));
  sendJson(ctx.res, { ok: true, fav: b.on !== false, ids: list });
});
// Les favoris en liste M3U (VLC, Kodi, une autre application IPTV…)
const m3uEsc = (s) => String(s || '').replace(/[\r\n"]/g, ' ').trim();
router.get('/api/channels/favorites.m3u', (ctx) => {
  const p = requireProfile(ctx);
  const ids = channelFavs(p.id);
  const rows = ids.length ? all(`SELECT * FROM items WHERE type = 'channel' AND id IN (${ids.map(() => '?').join(',')})`, ...ids).filter((c) => visible(p, c) && c.stream_url) : [];
  rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const out = ['#EXTM3U'];
  for (const c of rows) {
    let o = {}; try { o = JSON.parse(c.stream_opts || '{}') || {}; } catch { /* */ }
    const logo = /^https?:\/\//i.test(c.poster || '') ? c.poster : '';
    out.push(`#EXTINF:-1 tvg-id="${m3uEsc(c.key)}" tvg-chno="${channelNumber(c) || ''}" tvg-logo="${m3uEsc(logo)}" group-title="${m3uEsc(channelCat(c.title, c.grp))}",${m3uEsc(c.title)}`);
    if (o.ua) out.push(`#EXTVLCOPT:http-user-agent=${m3uEsc(o.ua)}`);
    if (o.referer) out.push(`#EXTVLCOPT:http-referrer=${m3uEsc(o.referer)}`);
    out.push(c.stream_url);
  }
  ctx.res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Content-Disposition': 'attachment; filename="venus-chaines-favorites.m3u"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end(out.join('\n') + '\n');
});
// Importer une liste M3U dans les favoris : chaque chaîne de la liste déjà connue de Venus (même adresse ou même nom) devient favorite
router.post('/api/channels/favorites/import', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req, 2 * 1024 * 1024);
  const text = String(b.m3u || '');
  if (!/#EXTM3U|#EXTINF/i.test(text)) throw new HttpError(400, 'Ce fichier n’est pas une liste M3U');
  const key = (t) => String(t || '').replace(/^\d+\.\s*/, '').replace(/\s*[[(].*?[\])]/g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  const chans = all("SELECT * FROM items WHERE type = 'channel'").filter((c) => visible(p, c));
  const byUrl = new Map(chans.map((c) => [c.stream_url, c.id])), byName = new Map(chans.map((c) => [key(c.title), c.id]));
  const list = channelFavs(p.id);
  let name = null, found = 0, missing = 0;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('#EXTINF')) name = l.slice(l.lastIndexOf(',') + 1);
    else if (l && !l.startsWith('#')) {
      const id = byUrl.get(l) || (name && byName.get(key(name)));
      if (id) { if (!list.includes(id)) list.push(id); found++; } else missing++;
      name = null;
    }
  }
  setSetting(`tv_favs:${p.id}`, list.slice(-500));
  sendJson(ctx.res, { ok: true, found, missing, ids: list });
});
// TV en direct : le flux est relu par ffmpeg et servi en HLS (copie de la vidéo quand c'est possible)
// Dernières chaînes regardées par profil (12 au plus, la plus récente d'abord)
function rememberRecentChannel(pid, id) {
  const list = (getSetting(`tv_recent:${pid}`, []) || []).filter((x) => x !== id);
  setSetting(`tv_recent:${pid}`, [id, ...list].slice(0, 12));
}
async function playChannel(ctx, p, item, b) {
  if (!visible(p, item)) throw new HttpError(403, 'Contenu non autorisé pour ce profil');
  // Chaîne déjà au format web (HLS) : relayée telle quelle, sans ffmpeg = démarrage quasi instantané.
  // Sauf si on la sait en HEVC / AC-3 (illisible par le navigateur), ou si le relais vient d'échouer (noRelay).
  const known = cachedProbe(item.stream_url);
  const webOk = !known || ((!known.video || known.video.codec === 'h264') && !(known.audio || []).some((a) => /^(ac3|eac3|dts|truehd|mp2)$/i.test(a.codec || '')));
  // Zapping instantané : chaîne voisine préparée d'avance (relais seulement : jamais de conversion pour rien)
  if (b.warm && (b.noRelay || !canRelay(item.stream_url) || !webOk)) return sendJson(ctx.res, { mode: 'none' });
  if (!b.warm) rememberRecentChannel(p.id, item.id);
  if (!b.noRelay && canRelay(item.stream_url) && webOk) {
    if (!known) probeLive(item.stream_url).catch(() => {}); // pour la prochaine fois
    if (b.replace) { sessions.get(b.replace)?.stop(); stopRelay(b.replace); }
    const rl = startRelay(item);
    if (!b.preview) setSetting(`last_channel:${p.id}`, { id: item.id, at: Date.now() });
    return sendJson(ctx.res, {
      itemId: item.id, slug: slugFor(item.id), path: `/tv/${channelNumber(item)}-${slugFor(item.id)}`, type: 'channel', live: true, mode: 'relay', reason: 'Direct (relais)', url: rl.url,
      sessionId: rl.id, offset: 0, hwLabel: null, duration: 0, title: item.title, subtitle: item.grp || 'TV en direct', backdrop: null, logo: item.poster, startAt: 0,
      audioOrder: 0, subId: null, quality: 'auto', audio: [], subs: [], qualities: [], video: known && known.video ? { width: known.video.width, height: known.video.height, codec: known.video.codec } : null,
      next: null,
    });
  }
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
  if (b.preview && !decision.copyVideo) Object.assign(decision, b.hero ? { limitHeight: 720, limitBitrate: 3.5e6 } : { limitHeight: 480, limitBitrate: 1.2e6 });
  else if (!b.preview) setSetting(`last_channel:${p.id}`, { id: item.id, at: Date.now() });
  void caps;
  if (b.replace) sessions.get(b.replace)?.stop();
  const s = startSession({ item, probe: probe || { video: null, audio: [], subs: [], bitrate: 0 }, decision, start: 0, profileId: p.id, quality: 'auto', live: true });
  sendJson(ctx.res, {
    itemId: item.id, slug: slugFor(item.id), path: `/tv/${channelNumber(item)}-${slugFor(item.id)}`, type: 'channel', live: true, mode: decision.mode, reason: decision.reason, url: `/api/hls/${s.id}/index.m3u8`,
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
  // Jamais plus de 2,5 s d'attente : sinon « 204 » (pas encore d'image), la page redemande plus tard
  const file = await channelSnapshot(item, { maxWait: 2500, urgent: true });
  if (!file) { ctx.res.writeHead(204, { 'Cache-Control': 'no-store', 'Retry-After': '15' }); return void ctx.res.end(); }
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=60' });
});

router.get('/api/stream/:id/file', (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path) throw new HttpError(404, 'Introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Interdit');
  const o = ctx.url.searchParams.get('v') === 'opt' ? optimizedFor(item) : null;
  sendFile(ctx.req, ctx.res, o ? o.path : item.path, { cache: 'private, max-age=3600' });
});

// Épisode suivant préparé à l'avance : début du fichier lu (le NAS se réveille et le garde en cache), chapitres lus
const prepared = new Map();
router.post('/api/items/:id/prepare', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path || !visible(p, item)) throw new HttpError(404, 'Introuvable');
  if (Date.now() - (prepared.get(item.id) || 0) < 600000) return sendJson(ctx.res, { ok: true, cached: true });
  prepared.set(item.id, Date.now());
  const o = optimizedFor(item);
  const warm = (file, bytes) => new Promise((resolve) => {
    let n = 0;
    const st = fs.createReadStream(file, { start: 0, end: bytes - 1, highWaterMark: 1 << 20 });
    st.on('data', (c) => { n += c.length; }); st.on('end', () => resolve(n)); st.on('error', () => resolve(0));
  });
  const read = await warm(o ? o.path : item.path, 24 * 1024 * 1024);
  const probe = parseJson(item.probe, null);
  if (probe && !probe.chaptersChecked) {
    try { probe.chapters = await readChapters(item.path, probe.duration); probe.chaptersChecked = true; run('UPDATE items SET probe = ? WHERE id = ?', JSON.stringify(probe), item.id); } catch { /* */ }
  }
  sendJson(ctx.res, { ok: true, read, optimized: !!o });
});

// Relais des chaînes (voir relay.js)
router.get('/api/live/:rid/pl.m3u8', (ctx) => servePlaylistRelay(ctx, ctx.params.rid));
router.get('/api/live/:rid/seg', (ctx) => serveSegmentRelay(ctx, ctx.params.rid));
// Pause sur une chaîne : Venus continue d'enregistrer (direct différé) ; reprise ou retour au direct
router.del('/api/live/:rid', (ctx) => { requireDevice(ctx); stopRelay(ctx.params.rid); sendJson(ctx.res, { ok: true }); });
router.post('/api/live/:rid/hold', async (ctx) => { requireDevice(ctx); const b = await readBody(ctx.req); sendJson(ctx.res, { ok: holdRelay(ctx.params.rid, b.on !== false) }); });
router.get('/api/hls/:sid/index.m3u8', (ctx) => servePlaylist(ctx.res, ctx.params.sid));
router.get('/api/hls/:sid/:seg', (ctx) => serveSegment(ctx.req, ctx.res, ctx.params.sid, ctx.params.seg));
router.post('/api/hls/:sid/ping', (ctx) => { requireDevice(ctx); sessions.get(ctx.params.sid)?.touch(); sendJson(ctx.res, { ok: sessions.has(ctx.params.sid) }); });
router.del('/api/hls/:sid', (ctx) => { requireDevice(ctx); sessions.get(ctx.params.sid)?.stop(); sendJson(ctx.res, { ok: true }); });

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
  const asked = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  requireVisible(ctx, asked);
  const item = playableOf(asked);
  if (!item) throw new HttpError(404, 'Introuvable');
  const file = await thumbnail(item, item.duration, { big: ctx.url.searchParams.get('size') === 'big' });
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=2592000, immutable' });
});

// Aperçu muet joué au survol d'une affiche
router.get('/api/items/:id/preview', async (ctx) => {
  const asked = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  requireVisible(ctx, asked);
  const item = playableOf(asked);
  if (!item) throw new HttpError(404, 'Introuvable');
  const file = await previewClip(item, { hd: ctx.url.searchParams.get('hd') === '1' });
  sendFile(ctx.req, ctx.res, file, { cache: 'private, max-age=2592000, immutable' });
});

const photoFetch = new Map();
router.get('/img/:name', async (ctx) => {
  requireDevice(ctx); // images et aperçus réservés aux appareils connectés (cookie de session)
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
  if ([185, 342, 500, 780, 1280].includes(w) && /\.(jpe?g|png|webp)$/i.test(name) && fs.existsSync(src)) {
    // WebP quand le navigateur le prend (30 à 50 % plus léger) et que ffmpeg sait le faire
    const webp = /image\/webp/.test(ctx.req.headers.accept || '') && await webpOk();
    ctx.res.setHeader('Vary', 'Accept');
    const out = path.join(imagesDir, 'w', `${w}_${name.replace(/\.(jpe?g|png|webp)$/i, webp ? '.webp' : '.jpg')}`);
    if (!fs.existsSync(out)) {
      if (!resizing.has(out)) resizing.set(out, resizeImage(src, out, w, webp).finally(() => resizing.delete(out)));
      const ok = await resizing.get(out);
      if (!ok) return sendFile(ctx.req, ctx.res, src, { cache: 'public, max-age=2592000, immutable' });
    }
    return sendFile(ctx.req, ctx.res, out, { cache: 'public, max-age=2592000, immutable' });
  }
  sendFile(ctx.req, ctx.res, src, { cache: 'public, max-age=2592000, immutable' });
});
const resizing = new Map();
let webpCheck = null;
const webpOk = () => (webpCheck ||= new Promise((resolve) => execFile(config.ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10000 }, (e, out) => resolve(!e && /libwebp/.test(String(out))))));
function resizeImage(src, out, w, webp = false) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.tmp.${webp ? 'webp' : 'jpg'}`;
    execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale='min(${w},iw)':-2`, ...(webp ? ['-c:v', 'libwebp', '-quality', '78', '-compression_level', '4'] : ['-q:v', '4']), '-y', tmp], { timeout: 20000 }, (err) => {
      if (err) { try { fs.unlinkSync(tmp); } catch { /* */ } return resolve(false); }
      try { fs.renameSync(tmp, out); resolve(true); } catch { resolve(false); }
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
  if (!permsOf(p).download) throw new HttpError(403, 'Les téléchargements ne sont pas autorisés pour ce profil');
  if (getSetting('allow_downloads', true) === false && !p.is_admin) throw new HttpError(403, 'Téléchargements désactivés par l’administrateur');
  const name = `${niceName(item)}${path.extname(item.path)}`;
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  sendFile(ctx.req, ctx.res, item.path, { cache: 'no-store' });
});
router.post('/api/items/:id/download', async (ctx) => {
  const p = requireProfile(ctx);
  if (!permsOf(p).download) throw new HttpError(403, 'Les téléchargements ne sont pas autorisés pour ce profil');
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
  const p = requireProfile(ctx);
  const j = getJob(ctx.params.job);
  if (!j || j.state !== 'ready' || (j.profileId !== p.id && !p.is_admin)) throw new HttpError(404, 'Pas encore prêt');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${j.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(j.name)}`);
  sendFile(ctx.req, ctx.res, j.file, { cache: 'no-store', type: 'video/mp4' });
});
router.del('/api/downloads/:job', (ctx) => {
  const p = requireProfile(ctx);
  const j = getJob(ctx.params.job);
  if (j && j.profileId !== p.id && !p.is_admin) throw new HttpError(403, 'Ce téléchargement appartient à un autre profil');
  cancelJob(ctx.params.job); sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ notifications sur cet appareil (Web Push)
router.get('/api/push/key', (ctx) => { requireProfile(ctx); sendJson(ctx.res, { key: vapidPublicKey() }); });
router.post('/api/push/subscribe', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req, 8192);
  const sub = b.subscription;
  if (!sub || typeof sub !== 'object' || !sub.keys || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw new HttpError(400, 'Abonnement aux notifications invalide');
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
  const b = validate(await readBody(ctx.req, 32768), {
    type: V.oneOf(['movie', 'tv', 'show']), tmdbId: V.int({ min: 1, max: 1e9 }), anilistId: V.int({ min: 1, max: 1e9 }), title: V.str({ max: 300 }), original: V.str({ max: 300 }),
    poster: V.str({ max: 1000 }), backdrop: V.str({ max: 1000 }), date: V.str({ max: 20 }), overview: V.str({ max: 5000 }), anime: V.bool(),
  });
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
      maxSessions: getSetting('max_sessions', 6), scanInterval: getSetting('scan_interval', 60), detectSegments: String(getSetting('detect_segments', '1')) !== '0', trickplay: trickplayMode(),
      kidsAllowUnrated: getSetting('kids_allow_unrated', false), metadataLang: getSetting('metadata_lang', 'fr-FR'),
      omdbConfigured: !!omdbKey(), simklConfigured: !!simklId(), traktConfigured: !!traktId(), traktSecretConfigured: !!traktSecret(), posterSource: posterSource(), seerrUrl: seerrConf().url, seerrConfigured: seerrOn(), seerrAuto: autoRequest(), seerrFollow: followMode(), opensubtitlesConfigured: osOn(), notify: { ...channels(), telegramToken: channels().telegramToken ? '••••' : '', discord: channels().discord ? '••••' : '', notifyNew: String(getSetting('notify_new', '1')) !== '0', tgMedia: String(getSetting('tg_media', '1')) !== '0', tgDownloads: String(getSetting('tg_downloads', '1')) !== '0', notifyEpisodes: String(getSetting('notify_episodes', '1')) !== '0', push: pushCount() }, autoBackup: String(getSetting('auto_backup', '1')) !== '0', backupCopyDir: getSetting('backup_copy_dir', ''), postersFree: getSetting('posters_free', '1') !== '0', opensubtitlesUser: getSetting('opensubtitles_user', ''),
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
    counts: { movie: counts.movie || 0, show: (counts.show || 0) - anime, anime, episode: counts.episode || 0, clip: counts.clip || 0, channel: counts.channel || 0, season: counts.season || 0, track: counts.track || 0, photo: counts.photo || 0, book: (counts.book || 0) + (counts.audiobook || 0) },
    totals: { size: tot.size || 0, hours: Math.round((tot.dur || 0) / 3600) },
    playing: live.map((e) => ({ ...e, token: undefined, hls: e.sessionId ? hlsById.get(e.sessionId) || null : null })),
    transcodes: [...hlsById.values()].length,
    forecast: storageForecast(),
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
    // Le message va aux AUTRES appareils : celui qui l'écrit ne le reçoit pas.
    const others = [...connected.keys()].filter((k) => k !== deviceId(ctx.auth.token)).length;
    control.emit('cmd', { all: true, except: ctx.auth.token, cmd, text, from: p.name });
    logActivity('message', `${p.name} a envoyé un message à tous les appareils`);
    return sendJson(ctx.res, { ok: true, sent: others });
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
// Supprimer une vidéo (administrateur) : le fichier et ses sous-titres / images à côté sont effacés du disque,
// puis retirés de Venus. Film, clip, épisode, saison entière ou série entière.
const SIDE_EXT = /\.(srt|ass|ssa|vtt|sub|idx|sup|nfo|jpe?g|png|webp|txt)$/i;
function filesOfItem(it) {
  if (it.type === 'show') return all("SELECT * FROM items WHERE show_id = ? AND type = 'episode' AND path IS NOT NULL", it.id);
  if (it.type === 'season') return all("SELECT * FROM items WHERE parent_id = ? AND type = 'episode' AND path IS NOT NULL", it.id);
  return it.path ? [it] : [];
}
function removeFileWithSides(file, libRoot) {
  let freed = 0;
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  try { freed += fs.statSync(file).size; } catch { /* déjà absent */ }
  fs.rmSync(file, { force: true });
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${base}.`) || f.startsWith(`${base}-`)) {
        if (SIDE_EXT.test(f)) { const fp = path.join(dir, f); try { freed += fs.statSync(fp).size; } catch { /* */ } fs.rmSync(fp, { force: true }); }
      }
    }
  } catch { /* */ }
  // Dossiers devenus vides (ou ne contenant plus que des images / .nfo) : supprimés, jamais la racine de la bibliothèque
  let d = dir;
  const root = path.resolve(libRoot || '/');
  while (d.startsWith(root + path.sep) && d !== root) {
    let rest;
    try { rest = fs.readdirSync(d); } catch { break; }
    if (rest.some((f) => !SIDE_EXT.test(f) || fs.statSync(path.join(d, f)).isDirectory())) break;
    fs.rmSync(d, { recursive: true, force: true });
    d = path.dirname(d);
  }
  return freed;
}
router.post('/api/admin/items/:id/delete', async (ctx) => {
  const p = requireAdmin(ctx);
  const it = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!it) throw new HttpError(404, 'Vidéo introuvable');
  if (it.type === 'channel') throw new HttpError(400, 'Les chaînes se retirent avec leur liste M3U (Réglages, Bibliothèques)');
  const files = filesOfItem(it);
  let b = {}; try { b = await readBody(ctx.req, 2048); } catch { b = {}; }
  let freed = 0, deleted = 0;
  const errors = [], trashed = [];
  for (const f of files) {
    const lib = get('SELECT * FROM libraries WHERE id = ?', f.library_id);
    try {
      // Corbeille (7 jours) plutôt qu'effacement immédiat ; « définitif » ou fichier hors bibliothèque : suppression directe
      if (!b.permanent && lib && lib.path && path.resolve(f.path).startsWith(path.resolve(lib.path) + path.sep)) {
        const moved = moveToTrash(f.path, lib.path);
        freed += moved.reduce((n, m) => n + m.size, 0);
        trashed.push(...moved);
      } else freed += removeFileWithSides(f.path, lib && lib.path);
      run('DELETE FROM items WHERE id = ?', f.id); removeTrickplay(f.id);
      deleted++;
    } catch (e) {
      errors.push(/EROFS|EACCES|EPERM/.test(e.code || '') ? `${path.basename(f.path)} : dossier en lecture seule (partage réseau ou droits insuffisants)` : `${path.basename(f.path)} : ${e.message}`);
    }
  }
  // Saisons et séries devenues vides
  run("DELETE FROM items WHERE type='season' AND NOT EXISTS (SELECT 1 FROM items e WHERE e.parent_id = items.id)");
  run("DELETE FROM items WHERE type='show' AND NOT EXISTS (SELECT 1 FROM items s WHERE s.parent_id = items.id)");
  if (!files.length && it.type !== 'show' && it.type !== 'season') { run('DELETE FROM items WHERE id = ?', it.id); deleted++; }
  if (trashed.length) recordTrash({ libraryId: files[0] && files[0].library_id, title: it.type === 'episode' ? `${it.title}` : it.title, kind: it.type, files: trashed, byName: p.name });
  if (deleted) {
    logActivity('delete', `${p.name} a supprimé ${it.type === 'show' ? `la série « ${it.title} »` : it.type === 'season' ? `une saison (${deleted} épisodes)` : `« ${it.title} »`}`);
    events.emit('library', { added: [] });
  }
  if (!deleted && errors.length) throw new HttpError(403, errors[0]);
  sendJson(ctx.res, { deleted, freed, errors, trashed: trashed.length > 0, gone: !get('SELECT 1 FROM items WHERE id = ?', it.id) });
});

// ------------------------------------------------------------------ sécurité (administrateur)
router.get('/api/admin/security', (ctx) => {
  requireAdmin(ctx);
  const sc = smtpConf();
  const devices = all('SELECT t.token, t.device, t.created_at, t.last_seen, p.name AS profile FROM tokens t LEFT JOIN profiles p ON p.id = t.profile_id ORDER BY t.last_seen DESC LIMIT 100')
    .map((t) => ({ id: deviceId(t.token), name: deviceLabel(t.device), profile: t.profile, created: t.created_at, lastSeen: t.last_seen, current: t.token === ctx.auth.key }));
  sendJson(ctx.res, {
    log: securityLog(Number(ctx.url.searchParams.get('limit')) || 200),
    bans: listBans(), attempts: attemptStats(), devices,
    twofa: { mode: getSetting('twofa_mode', 'off'), active: twofaOn(), email: twofaEmail(), verified: !!getSetting('smtp_verified', false), disabledByEnv: process.env.VENUS_DISABLE_2FA === '1', ...twofaStats() },
    smtp: { host: sc.host, port: sc.port, secure: sc.secure, user: sc.user, from: sc.from, passSet: !!sc.pass },
    https: { mode: httpsMode(), secure: isSecure(ctx.req), port: Number(process.env.HTTPS_PORT || getSetting('https_port', 8920)) || null },
    adminsWithoutPin: all('SELECT name FROM profiles WHERE is_admin = 1 AND pin_hash IS NULL').map((x) => x.name),
    audit: lastAudit(),
  });
});
router.post('/api/admin/security/unban', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 4096), { ip: V.str({ max: 60, pattern: /^[\da-f.:]+$/i, label: 'Adresse IP' }) }, { required: ['ip'] });
  unbanIp(b.ip);
  logSecurity('deblocage', ctx.ip, `${me.name} a débloqué l’adresse ${b.ip}`, 'info');
  sendJson(ctx.res, { ok: true });
});
router.post('/api/admin/security/ban', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 4096), { ip: V.str({ max: 60, pattern: /^[\da-f.:]+$/i, label: 'Adresse IP' }), hours: V.int({ min: 0, max: 24 * 365 }) }, { required: ['ip'] });
  if (b.ip === ctx.ip) throw new HttpError(400, 'C’est votre propre adresse');
  banIp(b.ip, b.hours ? b.hours * 3600e3 : Infinity, `bloquée à la main par ${me.name}`);
  sendJson(ctx.res, { ok: true });
});
router.post('/api/admin/security/test-email', async (ctx) => {
  requireAdmin(ctx);
  checkRate('join', ctx.ip);
  const to = twofaEmail() || smtpConf().from;
  if (!to) throw new HttpError(400, 'Indiquez l’adresse e-mail de l’administrateur');
  try {
    await sendMail({ to, subject: `${getSetting('server_name', 'Venus')} : e-mail de test`, text: 'Le serveur d’e-mails de Venus fonctionne. Vous pouvez activer la double authentification.' });
  } catch (e) { setSetting('smtp_verified', false); throw new HttpError(502, `Envoi impossible : ${e.message}`); }
  setSetting('smtp_verified', true);
  sendJson(ctx.res, { ok: true, to: maskEmail(to) });
});
router.post('/api/admin/security/audit', async (ctx) => { requireAdmin(ctx); sendJson(ctx.res, await runSecurityAudit()); });
router.post('/api/admin/security/logout-others', (ctx) => {
  const me = requireAdmin(ctx);
  revokeOtherTokens(ctx.auth.token);
  logSecurity('deconnexion', ctx.ip, `${me.name} a déconnecté tous les autres appareils`, 'warn');
  sendJson(ctx.res, { ok: true });
});
router.del('/api/admin/security/log', (ctx) => {
  const me = requireAdmin(ctx);
  run('DELETE FROM security_log');
  logSecurity('journal', ctx.ip, `${me.name} a vidé le journal de sécurité`, 'warn');
  sendJson(ctx.res, { ok: true });
});

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

// ------------------------------------------------------------------ modifier les infos d'un titre (comme Jellyfin)
const EDIT_SCHEMA = {
  title: V.str({ min: 1, max: 200, label: 'Titre' }), originalTitle: V.nullable(V.str({ max: 200 })), year: V.nullable(V.int({ min: 1880, max: 2200, label: 'Année' })),
  overview: V.nullable(V.str({ max: 5000, trim: false })), tagline: V.nullable(V.str({ max: 300 })), genres: V.list(V.str({ min: 1, max: 40 }), { max: 12 }),
  age: V.nullable(V.int({ min: 0, max: 21, label: 'Âge minimum' })),
};
const editable = (id) => {
  const it = get('SELECT * FROM items WHERE id = ?', Number(id));
  if (!it || !['movie', 'show', 'clip', 'episode', 'season', 'extra'].includes(it.type)) throw new HttpError(404, 'Introuvable');
  return it;
};
router.get('/api/admin/items/:id/edit', async (ctx) => {
  requireAdmin(ctx);
  const it = editable(ctx.params.id);
  const custom = parseJson(it.custom, {}) || {};
  const out = {
    id: it.id, type: it.type, custom: Object.keys(custom),
    fields: { title: it.title, originalTitle: it.original_title, year: it.year, overview: it.overview, tagline: it.tagline, genres: parseJson(it.genres, []), age: it.age },
    current: { poster: it.poster, backdrop: it.backdrop, logo: it.logo },
    nfo: !!it.nfo, images: { poster: [], backdrop: [], logo: [] },
  };
  // Images proposées : TMDB (toutes langues utiles) puis Trakt
  if (['movie', 'show'].includes(it.type) && it.tmdb_id && tmdbKey()) {
    try {
      const im = await tmdb(`/${it.type === 'movie' ? 'movie' : 'tv'}/${it.tmdb_id}/images`, { include_image_language: `${(getSetting('metadata_lang', 'fr-FR') || 'fr').split('-')[0]},en,null` });
      const map = (list, size) => (list || []).slice(0, 40).map((x) => ({ src: 'tmdb', ref: x.file_path, preview: `https://image.tmdb.org/t/p/${size}${x.file_path}`, lang: x.iso_639_1 || null, w: x.width, h: x.height }));
      out.images.poster = map(im.posters, 'w342'); out.images.backdrop = map(im.backdrops, 'w780'); out.images.logo = map(im.logos, 'w300');
    } catch { /* TMDB injoignable */ }
  }
  if (['movie', 'show'].includes(it.type) && traktId()) {
    try {
      const t = await traktFind(it);
      if (t) {
        for (const u of t.posters || []) out.images.poster.push({ src: 'trakt', ref: u, preview: u });
        for (const u of t.fanarts || []) out.images.backdrop.push({ src: 'trakt', ref: u, preview: u });
        if (t.logo) out.images.logo.push({ src: 'trakt', ref: t.logo, preview: t.logo });
      }
    } catch { /* */ }
  }
  // Sources gratuites (sans clé) : site de TMDB, IMP Awards, iTunes / TVmaze
  if (['movie', 'show'].includes(it.type) && out.images.poster.length < 4) {
    try {
      const free = await freePosterCandidates(it.type, it.title, it.year);
      for (const c of free) if (!out.images.poster.some((x) => x.ref === c.url)) out.images.poster.push({ src: 'free', ref: c.url, preview: c.url, label: c.source });
    } catch { /* */ }
  }
  sendJson(ctx.res, out);
});
router.put('/api/admin/items/:id/edit', async (ctx) => {
  const me = requireAdmin(ctx);
  const it = editable(ctx.params.id);
  const b = validate(await readBody(ctx.req, 32 * 1024), EDIT_SCHEMA);
  const custom = parseJson(it.custom, {}) || {};
  for (const k of Object.keys(EDIT_SCHEMA)) if (b[k] !== undefined) custom[k] = k === 'genres' ? (b.genres || []).map((g) => g.trim()) : b[k];
  run('UPDATE items SET custom = ? WHERE id = ?', JSON.stringify(custom), it.id);
  applyCustom(it.id);
  logActivity('edit', `${me.name} a modifié les infos de « ${b.title || it.title} »`);
  sendJson(ctx.res, { ok: true });
});
router.post('/api/admin/items/:id/image', async (ctx) => {
  requireAdmin(ctx);
  const it = editable(ctx.params.id);
  const b = validate(await readBody(ctx.req, 8192), { kind: V.oneOf(['poster', 'backdrop', 'logo']), src: V.oneOf(['tmdb', 'trakt', 'url', 'free', 'none']), ref: V.str({ max: 2000 }) }, { required: ['kind', 'src'] });
  let name = null;
  if (b.src === 'url' || b.src === 'free') {
    // Adresse donnée par l'administrateur (ou proposée par une source gratuite) : image vérifiée avant copie
    name = await saveRemoteImage(b.ref, { any: b.src === 'url' });
    if (!name) throw new HttpError(400, 'Cette adresse ne donne pas une image lisible (JPEG, PNG ou WebP, HTTPS, 8 Mo au plus)');
  } else if (b.src === 'tmdb') {
    if (!/^\/[\w.-]+\.(jpg|png|svg|webp)$/i.test(b.ref || '')) throw new HttpError(400, 'Image invalide');
    name = await downloadImage(b.ref, b.kind === 'backdrop' ? 'w1280' : b.kind === 'logo' ? 'w500' : 'w500');
  } else if (b.src === 'trakt') name = await downloadTraktImage(b.ref);
  if (b.src !== 'none' && !name) throw new HttpError(502, 'Image impossible à récupérer');
  const custom = parseJson(it.custom, {}) || {};
  custom[b.kind] = name;
  run('UPDATE items SET custom = ? WHERE id = ?', JSON.stringify(custom), it.id);
  applyCustom(it.id);
  sendJson(ctx.res, { ok: true, image: name });
});
// Revenir aux infos d'origine (TMDB / .nfo) : les modifications faites à la main sont oubliées
router.post('/api/admin/items/:id/reset', async (ctx) => {
  requireAdmin(ctx);
  const it = editable(ctx.params.id);
  run('UPDATE items SET custom = NULL WHERE id = ?', it.id);
  if (it.type === 'movie' && it.tmdb_id && tmdbKey()) await matchMovie(it, it.tmdb_id).catch(() => {});
  else if (it.type === 'show' && it.tmdb_id && tmdbKey()) await matchShow(it, it.tmdb_id).catch(() => {});
  sendJson(ctx.res, { ok: true });
});

const SETTINGS_SCHEMA = {
  tmdbKey: V.str({ max: 400 }), omdbKey: V.str({ max: 100 }), simklClientId: V.str({ max: 200 }),
  traktClientId: V.str({ max: 200, pattern: /^[\w-]*$/, label: 'Client ID Trakt' }),
  traktClientSecret: V.str({ max: 200, pattern: /^[\w-]*$/, label: 'Client Secret Trakt' }), posterSource: V.oneOf(['tmdb', 'trakt']),
  ntfyServer: V.url({ label: 'Serveur ntfy' }), ntfyTopic: V.str({ max: 100, pattern: /^[\w-]+$/, label: 'Sujet ntfy' }),
  discordWebhook: V.url({ https: true, label: 'Webhook Discord' }), telegramToken: V.str({ max: 100, pattern: /^\d+:[\w-]+$/, label: 'Jeton Telegram' }),
  telegramChat: V.str({ max: 40, pattern: /^-?\d+$|^@\w+$/, label: 'Discussion Telegram' }), publicUrl: V.url({ label: 'Adresse publique' }),
  notifyNew: V.bool(), tgMedia: V.bool(), tgDownloads: V.bool(), notifyEpisodes: V.bool(), autoBackup: V.bool(), backupCopyDir: V.str({ max: 1000 }), postersFree: V.bool(), detectSegments: V.bool(), kidsAllowUnrated: V.bool(),
  opensubtitlesKey: V.str({ max: 200 }), opensubtitlesUser: V.str({ max: 100 }), opensubtitlesPass: V.str({ max: 200, trim: false }),
  seerrUrl: V.str({ max: 500 }), seerrKey: V.str({ max: 300 }),
  serverName: V.str({ max: 40 }), maxSessions: V.int({ min: 1, max: 20 }), scanInterval: V.int({ min: 5, max: 10080 }),
  metadataLang: V.str({ max: 10, pattern: /^[a-z]{2}(-[A-Z]{2})?$/ }), hwaccel: V.oneOf(['auto', 'nvenc', 'vaapi', 'qsv', 'amf', 'videotoolbox', 'v4l2m2m', 'none']),
  password: V.str({ max: 200, trim: false, label: 'Mot de passe' }), logoutOthers: V.bool(),
  // Sécurité
  smtpHost: V.str({ max: 200, pattern: /^[\w.-]+$/, label: 'Serveur d’e-mails' }), smtpPort: V.int({ min: 1, max: 65535 }),
  smtpSecure: V.oneOf(['auto', 'tls', 'starttls', 'none']), smtpUser: V.str({ max: 200 }), smtpPass: V.str({ max: 300, trim: false }),
  smtpFrom: V.email({ label: 'Expéditeur' }), twofaEmail: V.email({ label: 'Adresse de l’administrateur' }), twofaMode: V.oneOf(['off', 'new_device']),
  forceHttps: V.oneOf(['off', 'remote', 'all']),
  trickplay: V.oneOf(['auto', 'play', 'off']),
};
router.put('/api/admin/settings', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 64 * 1024), SETTINGS_SCHEMA);
  // Serveur d'e-mails et double authentification
  for (const [k, key] of [['smtpHost', 'smtp_host'], ['smtpPort', 'smtp_port'], ['smtpSecure', 'smtp_secure'], ['smtpUser', 'smtp_user'], ['smtpFrom', 'smtp_from'], ['twofaEmail', 'twofa_email']]) {
    if (b[k] !== undefined) setSetting(key, b[k]);
  }
  if (b.smtpPass) setSetting('smtp_pass', b.smtpPass);
  if (b.twofaMode !== undefined) {
    if (b.twofaMode !== 'off' && (!smtpOn() || !twofaEmail())) throw new HttpError(400, 'Configurez d’abord le serveur d’e-mails et l’adresse de l’administrateur, puis envoyez un e-mail de test');
    if (b.twofaMode !== 'off' && !getSetting('smtp_verified', false)) throw new HttpError(400, 'Envoyez d’abord un e-mail de test réussi : sans lui, vous risqueriez de ne plus pouvoir vous connecter');
    setSetting('twofa_mode', b.twofaMode);
    logSecurity('2fa', ctx.ip, `Double authentification par e-mail ${b.twofaMode === 'off' ? 'désactivée' : 'activée'}`, 'warn');
  }
  if (b.smtpHost !== undefined || b.smtpPort !== undefined || b.smtpUser !== undefined || b.smtpPass || b.smtpFrom !== undefined || b.smtpSecure !== undefined) setSetting('smtp_verified', false);
  if (b.forceHttps !== undefined) { setSetting('force_https', b.forceHttps); logSecurity('https', ctx.ip, `HTTPS obligatoire : ${b.forceHttps}`, 'info'); }
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
  if (typeof b.tgMedia === 'boolean') setSetting('tg_media', b.tgMedia ? '1' : '0');
  if (typeof b.tgDownloads === 'boolean') setSetting('tg_downloads', b.tgDownloads ? '1' : '0');
  if (typeof b.notifyEpisodes === 'boolean') setSetting('notify_episodes', b.notifyEpisodes ? '1' : '0');
  if (typeof b.autoBackup === 'boolean') setSetting('auto_backup', b.autoBackup ? '1' : '0');
  if (typeof b.postersFree === 'boolean') setSetting('posters_free', b.postersFree ? '1' : '0');
  if (b.backupCopyDir !== undefined) {
    // Second emplacement des sauvegardes (NAS, disque externe) : doit exister et être accessible en écriture
    const dir = String(b.backupCopyDir || '').trim();
    if (dir) { try { fs.accessSync(dir, fs.constants.W_OK); if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch { throw new HttpError(400, `Dossier de copie des sauvegardes introuvable ou non modifiable : ${dir}`); } }
    setSetting('backup_copy_dir', dir);
  }
  if (b.opensubtitlesKey !== undefined) setSetting('opensubtitles_key', String(b.opensubtitlesKey || '').trim());
  if (b.opensubtitlesUser !== undefined) { setSetting('opensubtitles_user', String(b.opensubtitlesUser || '').trim()); resetOsLogin(); }
  if (b.opensubtitlesPass !== undefined && b.opensubtitlesPass !== '') { setSetting('opensubtitles_pass', String(b.opensubtitlesPass)); resetOsLogin(); }
  if (b.simklClientId !== undefined) { setSetting('simkl_client_id', String(b.simklClientId || '').trim()); ratingsChanged = true; }
  if (b.traktClientId !== undefined) {
    const id = String(b.traktClientId || '').trim();
    if (id) { try { await testTrakt(id); } catch (e) { throw new HttpError(400, e.message === 'Identifiant client Trakt refusé' ? e.message : `Trakt injoignable (${e.message})`); } }
    setSetting('trakt_client_id', id); ratingsChanged = true;
  }
  if (b.traktClientSecret !== undefined) setSetting('trakt_client_secret', String(b.traktClientSecret || '').trim());
  if (b.posterSource) { setSetting('poster_source', b.posterSource); ratingsChanged = true; }
  if (b.seerrUrl !== undefined || b.seerrKey !== undefined) {
    const conf = { url: String(b.seerrUrl ?? seerrConf().url).trim().replace(/\/+$/, ''), key: String(b.seerrKey ?? seerrConf().key).trim() };
    if (conf.url && !/^https?:\/\//.test(conf.url)) conf.url = `http://${conf.url}`;
    if (conf.url && conf.key) { try { await seerrTest(conf); } catch (e) { throw new HttpError(400, `Seerr : ${e.message}`); } }
    setSetting('seerr_url', conf.url); setSetting('seerr_key', conf.key);
  }
  if (ratingsChanged) refreshRatings({ force: true });
  if (b.serverName) setSetting('server_name', String(b.serverName).slice(0, 40));
  if (b.maxSessions) setSetting('max_sessions', b.maxSessions);
  if (typeof b.detectSegments === 'boolean') setSetting('detect_segments', b.detectSegments ? '1' : '0');
  if (b.trickplay) { setSetting('trickplay', b.trickplay); if (b.trickplay === 'auto') runTask('trickplay').catch(() => {}); }
  if (b.scanInterval) setSetting('scan_interval', b.scanInterval);
  if (b.kidsAllowUnrated !== undefined) setSetting('kids_allow_unrated', !!b.kidsAllowUnrated);
  if (b.metadataLang) setSetting('metadata_lang', b.metadataLang);
  if (b.hwaccel) { setSetting('hwaccel', b.hwaccel); await detectHardware(); }
  if (b.password) {
    const weak = passwordProblem(b.password);
    if (weak) throw new HttpError(400, weak);
    setSetting('household_password', hashSecret(b.password));
    setSetting('password_weak', false);
    // Les autres appareils devront se reconnecter avec le nouveau mot de passe
    if (b.logoutOthers !== false) revokeOtherTokens(ctx.auth.token);
    logSecurity('mot-de-passe', ctx.ip, 'Mot de passe du foyer changé ; autres appareils déconnectés', 'warn');
  }
  sendJson(ctx.res, { ok: true });
});

// Espace libre et droits d'écriture d'une bibliothèque (affichés dans Réglages)
function diskInfo(l) {
  if (l.type === 'iptv') return { writable: false, free: null };
  let writable = false, free = null;
  try { fs.accessSync(l.path, fs.constants.W_OK); writable = true; } catch { /* lecture seule */ }
  try { const st = fs.statfsSync(l.path); free = st.bavail * st.bsize; } catch { /* inconnu */ }
  return { writable, free };
}

// Ne jamais renvoyer de mot de passe à l'interface
const maskUrl = (u) => String(u).replace(/(password=)[^&]*/i, '$1••••').replace(/\/\/([^:/@]+):[^@/]+@/, '//$1:••••@');
function publicLibrary(l) {
  const r = remoteOf(l);
  const st = netState.get(l.id);
  const exists = l.type === 'iptv' && (/^https?:/i.test(l.path) || l.path === FREE_TV || l.path === IPTV_WORLD) ? true : fs.existsSync(l.path) && (!r || !st || st.ok);
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

const NAMES = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct', music: 'Musique', photos: 'Photos', books: 'Livres' };

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
    // Nom d'appareil ou adresse IP seulement : rien d'autre ne doit atteindre la commande de montage
    if (!/^[A-Za-z0-9._-]{1,253}$/.test(remote.host)) throw new HttpError(400, 'Adresse de l’appareil invalide');
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
    } else if (p === FREE_TV || p === IPTV_WORLD) {
      // Listes construites par Venus (chaînes gratuites, chaînes du monde)
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
    // Un dossier vide (/media sur une machine neuve) n'aide pas : on prend le premier qui contient des sous-dossiers
    const useful = (t) => { try { return fs.readdirSync(t, { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith('.')); } catch { return false; } };
    asked = tries.find(useful) || '/';
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

// ------------------------------------------------------------------ collections et listes de lecture (comme Jellyfin)
// Sagas : regroupées automatiquement d'après TMDB (Harry Potter, Star Wars…). Collections : faites à la main par
// l'administrateur, visibles par tous. Listes de lecture : propres à chaque profil, dans l'ordre choisi, lues à la suite.
function sagas(p) {
  const age = ageClause(p);
  const map = new Map();
  for (const i of all(`SELECT i.* FROM items i WHERE i.type = 'movie' AND i.credits LIKE '%"collection":{%' AND ${age.sql}`, ...age.args)) {
    const c = (parseJson(i.credits, {}) || {}).collection;
    if (!c || !c.id) continue;
    if (!map.has(c.id)) map.set(c.id, { id: `s${c.id}`, name: String(c.name || '').replace(/ - (Saga|Collection)$|^Saga /i, ''), auto: true, items: [] });
    map.get(c.id).items.push(i);
  }
  return [...map.values()].filter((x) => x.items.length > 1).map((x) => ({ ...x, items: x.items.sort((a, b) => (a.release_date || String(a.year)).localeCompare(b.release_date || String(b.year))) }));
}
const coverOf = (items) => {
  const pics = [...new Set(items.map((i) => i.poster || i.show_poster).filter(Boolean))];
  const b = items.map((i) => i.backdrop || i.show_backdrop).find(Boolean) || null;
  return { poster: pics[0] || null, backdrop: b, posters: pics.slice(0, 4) };
};
function collectionItems(cid, p) {
  const age = ageClause(p);
  return all(`SELECT i.* FROM collection_items c JOIN items i ON i.id = c.item_id WHERE c.collection_id = ? AND ${age.sql} ORDER BY c.pos, i.sort_title`, cid, ...age.args);
}
function playlistOf(id, p) {
  const pl = get('SELECT * FROM playlists WHERE id = ?', Number(id));
  if (!pl || pl.profile_id !== p.id) throw new HttpError(404, 'Liste introuvable');
  return pl;
}
function playlistItems(pid, p) {
  return all('SELECT i.*, s.title AS show_title, s.poster AS show_poster, s.backdrop AS show_backdrop FROM playlist_items x JOIN items i ON i.id = x.item_id LEFT JOIN items s ON s.id = i.show_id WHERE x.playlist_id = ? ORDER BY x.pos', pid).filter((i) => visible(p, i));
}
// Un titre ajouté à une liste : film, épisode, clip ; une série ou une saison ajoute tous ses épisodes dans l'ordre
function playableIds(item) {
  if (['movie', 'episode', 'clip', 'extra'].includes(item.type)) return [item.version_of || item.id];
  if (item.type === 'show') return all("SELECT id FROM items WHERE type = 'episode' AND show_id = ? ORDER BY season_num = 0, season_num, episode_num", item.id).map((r) => r.id);
  if (item.type === 'season') return all("SELECT id FROM items WHERE type = 'episode' AND parent_id = ? ORDER BY episode_num", item.id).map((r) => r.id);
  return [];
}
const plCard = (i, pm) => { const c = card(i, pm && pm.get(i.id)); if (i.type === 'episode') c.showTitle = i.show_title; c.duration = i.duration; return c; };

router.get('/api/collections', (ctx) => {
  const p = requireProfile(ctx);
  const auto = sagas(p).map((x) => ({ id: x.id, name: x.name, auto: true, count: x.items.length, ...coverOf(x.items) }));
  const manual = all('SELECT * FROM collections ORDER BY name').map((c) => { const items = collectionItems(c.id, p); return { id: c.id, name: c.name, overview: c.overview, auto: false, count: items.length, ...coverOf(items) }; })
    .filter((c) => c.count || p.is_admin);
  const playlists = all('SELECT * FROM playlists WHERE profile_id = ? ORDER BY updated_at DESC', p.id).map((pl) => { const items = playlistItems(pl.id, p); return { id: pl.id, name: pl.name, count: items.length, duration: items.reduce((n, i) => n + (i.duration || 0), 0), ...coverOf(items) }; });
  sendJson(ctx.res, { collections: [...manual, ...auto.sort((a, b) => a.name.localeCompare(b.name, 'fr'))], playlists });
});
router.get('/api/collections/:id', (ctx) => {
  const p = requireProfile(ctx);
  const raw = String(ctx.params.id);
  const idx = statusIndex(p.id);
  if (/^s\d+$/.test(raw)) {
    const x = sagas(p).find((y) => y.id === raw);
    if (!x) throw new HttpError(404, 'Collection introuvable');
    return sendJson(ctx.res, { id: x.id, name: x.name, auto: true, editable: false, ...coverOf(x.items), items: x.items.map((i) => withStatus(card(i), idx)) });
  }
  const c = get('SELECT * FROM collections WHERE id = ?', Number(raw));
  if (!c) throw new HttpError(404, 'Collection introuvable');
  const items = collectionItems(c.id, p);
  sendJson(ctx.res, { id: c.id, name: c.name, overview: c.overview, auto: false, editable: !!p.is_admin, ...coverOf(items), items: items.map((i) => withStatus(card(i), idx)) });
});
router.post('/api/admin/collections', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 8192), { name: V.str({ min: 1, max: 80, label: 'Nom' }), overview: V.nullable(V.str({ max: 1000 })), itemId: V.int({ min: 1 }) }, { required: ['name'] });
  const r = run('INSERT INTO collections(name, overview, created_at) VALUES(?, ?, ?)', b.name, b.overview || null, Date.now());
  if (b.itemId) run('INSERT OR IGNORE INTO collection_items(collection_id, item_id, pos) VALUES(?, ?, 0)', Number(r.lastInsertRowid), b.itemId);
  sendJson(ctx.res, { id: Number(r.lastInsertRowid) });
});
router.put('/api/admin/collections/:id', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 64 * 1024), { name: V.str({ min: 1, max: 80, label: 'Nom' }), overview: V.nullable(V.str({ max: 1000 })), order: V.list(V.int({ min: 1 }), { max: 2000 }) });
  const c = get('SELECT * FROM collections WHERE id = ?', Number(ctx.params.id));
  if (!c) throw new HttpError(404, 'Collection introuvable');
  if (b.name) run('UPDATE collections SET name = ? WHERE id = ?', b.name, c.id);
  if (b.overview !== undefined) run('UPDATE collections SET overview = ? WHERE id = ?', b.overview, c.id);
  if (b.order) tx(() => b.order.forEach((id, i) => run('UPDATE collection_items SET pos = ? WHERE collection_id = ? AND item_id = ?', i, c.id, id)));
  sendJson(ctx.res, { ok: true });
});
router.del('/api/admin/collections/:id', (ctx) => {
  requireAdmin(ctx);
  run('DELETE FROM collections WHERE id = ?', Number(ctx.params.id));
  sendJson(ctx.res, { ok: true });
});
router.post('/api/admin/collections/:id/items', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 4096), { itemId: V.int({ min: 1 }), remove: V.bool() }, { required: ['itemId'] });
  const c = get('SELECT * FROM collections WHERE id = ?', Number(ctx.params.id));
  if (!c) throw new HttpError(404, 'Collection introuvable');
  const it = get('SELECT * FROM items WHERE id = ?', b.itemId);
  if (!it || !['movie', 'show', 'clip'].includes(it.type)) throw new HttpError(400, 'Seuls les films, séries et clips vont dans une collection');
  if (b.remove) run('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?', c.id, it.version_of || it.id);
  else run('INSERT OR IGNORE INTO collection_items(collection_id, item_id, pos) VALUES(?, ?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM collection_items WHERE collection_id = ?))', c.id, it.version_of || it.id, c.id);
  sendJson(ctx.res, { ok: true, name: c.name });
});

router.get('/api/playlists/:id', (ctx) => {
  const p = requireProfile(ctx);
  const pl = playlistOf(ctx.params.id, p);
  const items = playlistItems(pl.id, p);
  const pm = progressMap(p.id, items.map((i) => i.id));
  sendJson(ctx.res, { id: pl.id, name: pl.name, ...coverOf(items), duration: items.reduce((n, i) => n + (i.duration || 0), 0), items: items.map((i) => plCard(i, pm)) });
});
router.post('/api/playlists', async (ctx) => {
  const p = requireProfile(ctx);
  const b = validate(await readBody(ctx.req, 4096), { name: V.str({ min: 1, max: 80, label: 'Nom' }), itemId: V.int({ min: 1 }) }, { required: ['name'] });
  if (get('SELECT COUNT(*) AS n FROM playlists WHERE profile_id = ?', p.id).n >= 200) throw new HttpError(400, '200 listes au plus');
  const r = run('INSERT INTO playlists(profile_id, name, created_at, updated_at) VALUES(?, ?, ?, ?)', p.id, b.name, Date.now(), Date.now());
  const id = Number(r.lastInsertRowid);
  let added = 0;
  if (b.itemId) { const it = get('SELECT * FROM items WHERE id = ?', b.itemId); if (it && visible(p, it)) added = addToPlaylist(id, playableIds(it)); }
  sendJson(ctx.res, { id, added });
});
function addToPlaylist(pid, ids) {
  let n = 0;
  tx(() => { for (const id of ids) { const r = run('INSERT OR IGNORE INTO playlist_items(playlist_id, item_id, pos) VALUES(?, ?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM playlist_items WHERE playlist_id = ?))', pid, id, pid); n += r.changes; } });
  run('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), pid);
  return n;
}
router.put('/api/playlists/:id', async (ctx) => {
  const p = requireProfile(ctx);
  const pl = playlistOf(ctx.params.id, p);
  const b = validate(await readBody(ctx.req, 64 * 1024), { name: V.str({ min: 1, max: 80, label: 'Nom' }), order: V.list(V.int({ min: 1 }), { max: 5000 }) });
  if (b.name) run('UPDATE playlists SET name = ? WHERE id = ?', b.name, pl.id);
  if (b.order) tx(() => b.order.forEach((id, i) => run('UPDATE playlist_items SET pos = ? WHERE playlist_id = ? AND item_id = ?', i, pl.id, id)));
  run('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), pl.id);
  sendJson(ctx.res, { ok: true });
});
router.del('/api/playlists/:id', (ctx) => {
  const p = requireProfile(ctx);
  const pl = playlistOf(ctx.params.id, p);
  run('DELETE FROM playlists WHERE id = ?', pl.id);
  sendJson(ctx.res, { ok: true });
});
router.post('/api/playlists/:id/items', async (ctx) => {
  const p = requireProfile(ctx);
  const pl = playlistOf(ctx.params.id, p);
  const b = validate(await readBody(ctx.req, 4096), { itemId: V.int({ min: 1 }), remove: V.bool() }, { required: ['itemId'] });
  const it = get('SELECT * FROM items WHERE id = ?', b.itemId);
  if (!it || !visible(p, it)) throw new HttpError(404, 'Introuvable');
  if (b.remove) { run('DELETE FROM playlist_items WHERE playlist_id = ? AND item_id = ?', pl.id, it.id); return sendJson(ctx.res, { ok: true, removed: 1 }); }
  const ids = playableIds(it);
  if (!ids.length) throw new HttpError(400, 'Ce titre ne peut pas aller dans une liste de lecture');
  if (get('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?', pl.id).n + ids.length > 5000) throw new HttpError(400, '5 000 vidéos au plus par liste');
  sendJson(ctx.res, { ok: true, added: addToPlaylist(pl.id, ids), name: pl.name });
});

// ------------------------------------------------------------------ administration avancée (comme Jellyfin)
// Tâches planifiées
router.get('/api/admin/tasks', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, listTasks()); });
router.post('/api/admin/tasks/:id/run', (ctx) => {
  const me = requireAdmin(ctx);
  const id = String(ctx.params.id);
  if (!listTasks().some((t) => t.id === id)) throw new HttpError(404, 'Tâche inconnue');
  runTask(id).catch(() => {});
  logActivity('task', `${me.name} a lancé « ${listTasks().find((t) => t.id === id).label} »`);
  sendJson(ctx.res, { ok: true });
});
// Journal du serveur
router.get('/api/admin/logs', (ctx) => {
  requireAdmin(ctx);
  const u = ctx.url.searchParams;
  if (u.get('download') === '1') {
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="venus-${new Date().toISOString().slice(0, 10)}.log"`, 'Cache-Control': 'no-store' });
    return ctx.res.end(logText());
  }
  const level = ['all', 'warn', 'error'].includes(u.get('level')) ? u.get('level') : 'all';
  sendJson(ctx.res, logLines({ level, q: String(u.get('q') || '').slice(0, 100), limit: 800 }));
});
// Clés API
router.get('/api/admin/apikeys', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, listApiKeys()); });
router.post('/api/admin/apikeys', async (ctx) => {
  const me = requireAdmin(ctx);
  if (ctx.auth.via === 'apikey') throw new HttpError(403, 'Une clé API ne peut pas créer d’autres clés');
  const b = validate(await readBody(ctx.req, 2048), { name: V.str({ min: 1, max: 60, label: 'Nom' }) }, { required: ['name'] });
  if (listApiKeys().length >= 50) throw new HttpError(400, '50 clés au plus');
  const key = createApiKey(b.name);
  logSecurity('cle-api', ctx.ip, `${me.name} a créé la clé API « ${b.name} »`, 'warn');
  sendJson(ctx.res, { key });
});
router.del('/api/admin/apikeys/:id', (ctx) => {
  const me = requireAdmin(ctx);
  if (!revokeApiKey(ctx.params.id)) throw new HttpError(404, 'Clé introuvable');
  logSecurity('cle-api', ctx.ip, `${me.name} a supprimé une clé API`, 'info');
  sendJson(ctx.res, { ok: true });
});
// Webhooks
const HOOK_SCHEMA = { name: V.str({ max: 60 }), url: V.url({ label: 'Adresse' }), secret: V.str({ max: 200, trim: false }), events: V.list(V.oneOf(Object.keys(HOOK_EVENTS)), { max: 20 }), enabled: V.bool() };
router.get('/api/admin/webhooks', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { events: HOOK_EVENTS, hooks: listHooks().map((h) => ({ ...h, secret: h.secret ? '••••' : '' })) }); });
router.post('/api/admin/webhooks', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 8192), HOOK_SCHEMA, { required: ['url', 'events'] });
  const list = listHooks();
  if (list.length >= 20) throw new HttpError(400, '20 webhooks au plus');
  const h = { id: crypto.randomBytes(6).toString('hex'), name: b.name || new URL(b.url).hostname, url: b.url, secret: b.secret || '', events: b.events, enabled: b.enabled !== false, lastAt: null, lastError: null };
  saveHooks([...list, h]);
  sendJson(ctx.res, { id: h.id });
});
router.put('/api/admin/webhooks/:id', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 8192), HOOK_SCHEMA);
  const list = listHooks();
  const h = list.find((x) => x.id === ctx.params.id);
  if (!h) throw new HttpError(404, 'Webhook introuvable');
  for (const k of ['name', 'url', 'events', 'enabled']) if (b[k] !== undefined) h[k] = b[k];
  if (b.secret !== undefined && b.secret !== '••••') h.secret = b.secret;
  saveHooks(list);
  sendJson(ctx.res, { ok: true });
});
router.del('/api/admin/webhooks/:id', (ctx) => {
  requireAdmin(ctx);
  saveHooks(listHooks().filter((x) => x.id !== ctx.params.id));
  sendJson(ctx.res, { ok: true });
});
router.post('/api/admin/webhooks/:id/test', async (ctx) => {
  requireAdmin(ctx);
  const h = listHooks().find((x) => x.id === ctx.params.id);
  if (!h) throw new HttpError(404, 'Webhook introuvable');
  try { const st = await testHook(h); sendJson(ctx.res, { ok: true, status: st }); } catch (e) { throw new HttpError(400, `Échec : ${e.message}`); }
});
// Personnalisation : message sur la page de connexion, CSS personnalisé
router.get('/api/admin/branding', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { loginMessage: getSetting('login_message', '') || '', customCss: getSetting('custom_css', '') || '' }); });
router.put('/api/admin/branding', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 120 * 1024), { loginMessage: V.str({ max: 1000, trim: false }), customCss: V.str({ max: 100000, trim: false }) });
  if (b.customCss !== undefined && /<\/?\s*(script|style)|javascript:|expression\s*\(|@import/i.test(b.customCss)) throw new HttpError(400, 'CSS refusé : pas de balises, de javascript: ni de @import');
  if (b.loginMessage !== undefined) setSetting('login_message', b.loginMessage.trim());
  if (b.customCss !== undefined) setSetting('custom_css', b.customCss);
  sendJson(ctx.res, { ok: true });
});
export const customCss = () => String(getSetting('custom_css', '') || '');

// ------------------------------------------------------------------ guide des programmes (EPG) et enregistrements
router.get('/api/epg', (ctx) => {
  const p = requireProfile(ctx);
  const u = ctx.url.searchParams;
  const from = Math.max(Date.now() - 12 * 3600e3, Number(u.get('from')) || Date.now() - 30 * 60000);
  const to = Math.min(from + 12 * 3600e3, Number(u.get('to')) || from + 4 * 3600e3);
  const age = ageClause(p);
  const chans = all(`SELECT i.* FROM items i WHERE i.type = 'channel' AND ${age.sql} ORDER BY COALESCE(i.channel_num, i.episode_num)`, ...age.args);
  const progs = programsBetween(from, to, chans.map((c) => c.id));
  const recs = new Map(all("SELECT channel_id, start, id, status FROM recordings WHERE status IN ('scheduled','recording') AND stop > ?", from).map((r) => [`${r.channel_id}:${r.start}`, r]));
  const by = {};
  const rems = new Map(all('SELECT id, channel_id, start FROM tv_reminders WHERE profile_id = ? AND start > ?', p.id, from).map((r) => [`${r.channel_id}:${r.start}`, r.id]));
  for (const x of progs) { const r = recs.get(`${x.channel}:${x.start}`); (by[x.channel] ||= []).push({ ...x, rec: r ? { id: r.id, status: r.status } : null, rem: rems.get(`${x.channel}:${x.start}`) || null }); }
  sendJson(ctx.res, { from, to, now: Date.now(), state: { last: epgState().last, sources: epgState().sources.length }, channels: chans.map((c) => ({ id: c.id, title: c.title, logo: c.poster, number: channelNumber(c), group: c.grp })), programs: by });
});
// ---------------------------------------------------------------- rappels de programmes (notification 5 min avant)
db.exec(`CREATE TABLE IF NOT EXISTS tv_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id INTEGER, start INTEGER, stop INTEGER, title TEXT, notified INTEGER DEFAULT 0, UNIQUE(profile_id, channel_id, start))`);
router.get('/api/epg/reminders', (ctx) => {
  const p = requireProfile(ctx);
  sendJson(ctx.res, all('SELECT r.id, r.channel_id AS channel, r.start, r.stop, r.title, i.title AS channelTitle FROM tv_reminders r LEFT JOIN items i ON i.id = r.channel_id WHERE r.profile_id = ? AND r.stop > ? ORDER BY r.start', p.id, Date.now()));
});
router.post('/api/epg/reminders', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const pr = programById(Number(b.programId));
  if (!pr) throw new HttpError(404, 'Programme introuvable');
  if (pr.start < Date.now() - 60000) throw new HttpError(400, 'Ce programme a déjà commencé');
  run('INSERT INTO tv_reminders(profile_id, channel_id, start, stop, title) VALUES(?, ?, ?, ?, ?) ON CONFLICT(profile_id, channel_id, start) DO UPDATE SET title = excluded.title, notified = 0', p.id, pr.channel, pr.start, pr.stop, pr.title);
  const r = get('SELECT id FROM tv_reminders WHERE profile_id = ? AND channel_id = ? AND start = ?', p.id, pr.channel, pr.start);
  sendJson(ctx.res, { ok: true, id: r.id });
});
router.del('/api/epg/reminders/:id', (ctx) => {
  const p = requireProfile(ctx);
  run('DELETE FROM tv_reminders WHERE id = ? AND profile_id = ?', Number(ctx.params.id), p.id);
  sendJson(ctx.res, { ok: true });
});
export async function sendTvReminders() {
  const now = Date.now();
  run('DELETE FROM tv_reminders WHERE stop < ?', now - 3600e3);
  for (const r of all('SELECT r.*, i.title AS ch, i.id AS cid FROM tv_reminders r LEFT JOIN items i ON i.id = r.channel_id WHERE r.notified = 0 AND r.start <= ? AND r.stop > ?', now + 5 * 60000, now)) {
    run('UPDATE tv_reminders SET notified = 1 WHERE id = ?', r.id);
    const mins = Math.max(0, Math.round((r.start - now) / 60000));
    const item = r.cid ? get('SELECT * FROM items WHERE id = ?', r.cid) : null;
    await notify({ title: mins ? `Dans ${mins} min sur ${r.ch}` : `Ça commence sur ${r.ch}`, body: r.title, url: item ? `/tv/${channelNumber(item)}-${slugFor(item.id)}` : '/tv?vue=guide', tag: `rappel-${r.id}` }, { profileId: r.profile_id }).catch(() => {});
  }
}
// Réglages de l'interface qui suivent le profil (thème, apparence des sous-titres, mode nuit)
const UI_PREFS = { spoilerGuard: 'bool', theme: /^[a-z]{2,20}$/, themeAuto: /^(off|sun|system)$/, subSize: /^(small|medium|large|xlarge)$/, subColor: /^(white|yellow|cyan|green)$/, subStyle: /^(text|soft|box)$/, subPos: /^(normal|high|top)$/, nightMode: 'bool' };
router.put('/api/profile/ui-prefs', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req, 4096);
  let cur = {}; try { cur = JSON.parse(get('SELECT ui_prefs FROM profiles WHERE id = ?', p.id).ui_prefs || '{}') || {}; } catch { /* */ }
  for (const [k, rule] of Object.entries(UI_PREFS)) {
    if (!(k in b)) continue;
    const v = b[k];
    if (rule === 'bool' ? typeof v === 'boolean' : typeof v === 'string' && rule.test(v)) cur[k] = v;
  }
  run('UPDATE profiles SET ui_prefs = ? WHERE id = ?', JSON.stringify(cur), p.id);
  sendJson(ctx.res, { ok: true, uiPrefs: cur });
});
router.get('/api/epg/now', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const ids = all(`SELECT i.id FROM items i WHERE i.type = 'channel' AND ${age.sql}`, ...age.args).map((r) => r.id);
  sendJson(ctx.res, nowNext(ids));
});
router.get('/api/recordings', (ctx) => {
  const p = requireProfile(ctx);
  const list = listRecordings().filter((r) => p.is_admin || !r.profile_id || r.profile_id === p.id);
  const itemOf = (id) => (id ? get('SELECT duration FROM items WHERE id = ?', id) : null);
  const prog = (id) => (id ? get('SELECT position, duration, watched FROM progress WHERE profile_id = ? AND item_id = ?', p.id, id) : null);
  sendJson(ctx.res, { recordings: list.map((r) => ({ id: r.id, channel: r.channel_title, logo: r.channel_logo, channelId: r.channel_id, title: r.title, sub: r.sub, descr: r.descr, start: r.start, stop: r.stop, status: r.status, error: r.error, itemId: r.item_id, ruleId: r.rule_id, duration: (itemOf(r.item_id) || {}).duration || null, progress: prog(r.item_id) })), rules: listRules(), dir: p.is_admin ? dvrDir() : null });
});
router.post('/api/recordings', async (ctx) => {
  const p = requireProfile(ctx);
  if (!p.is_admin && getSetting('dvr_everyone', true) === false) throw new HttpError(403, 'Seul l’administrateur peut programmer des enregistrements');
  const b = validate(await readBody(ctx.req, 8192), { programId: V.int({ min: 1 }), series: V.bool(), channelId: V.int({ min: 1 }), title: V.str({ max: 200 }), start: V.int({ min: 0, max: 1e14 }), stop: V.int({ min: 0, max: 1e14 }) });
  let prog;
  if (b.programId) { prog = programById(b.programId); if (!prog) throw new HttpError(404, 'Programme introuvable (guide mis à jour ?)'); }
  else {
    if (!b.channelId || !b.start || !b.stop) throw new HttpError(400, 'Chaîne, début et fin obligatoires');
    prog = { channel: b.channelId, title: b.title || 'Enregistrement', start: b.start, stop: b.stop };
  }
  const ch = get("SELECT * FROM items WHERE id = ? AND type = 'channel'", prog.channel);
  if (!ch || !visible(p, ch)) throw new HttpError(404, 'Chaîne introuvable');
  if (b.series) { const id = addRule({ channelId: ch.id, title: prog.title, profileId: p.id }); return sendJson(ctx.res, { ok: true, ruleId: id }); }
  const id = scheduleRecording({ channelId: ch.id, title: prog.title, sub: prog.sub || null, descr: prog.descr || null, start: prog.start, stop: prog.stop, profileId: p.id });
  sendJson(ctx.res, { ok: true, id });
});
router.del('/api/recordings/:id', (ctx) => {
  const p = requireProfile(ctx);
  const r = get('SELECT * FROM recordings WHERE id = ?', Number(ctx.params.id));
  if (!r || (!p.is_admin && r.profile_id && r.profile_id !== p.id)) throw new HttpError(404, 'Enregistrement introuvable');
  cancelRecording(r.id);
  sendJson(ctx.res, { ok: true });
});
router.del('/api/recordings/rules/:id', (ctx) => {
  const p = requireProfile(ctx);
  const r = get('SELECT * FROM record_rules WHERE id = ?', Number(ctx.params.id));
  if (!r || (!p.is_admin && r.profile_id !== p.id)) throw new HttpError(404, 'Règle introuvable');
  removeRule(r.id);
  sendJson(ctx.res, { ok: true });
});
router.get('/api/admin/livetv', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { epg: epgState(), dvrPath: dvrDir(), pre: Number(getSetting('dvr_pre', 2)), post: Number(getSetting('dvr_post', 5)), everyone: getSetting('dvr_everyone', true) !== false });
});
router.put('/api/admin/livetv', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 16 * 1024), { epgUrls: V.str({ max: 8000 }), dvrPath: V.str({ max: 1000 }), pre: V.int({ min: 0, max: 30 }), post: V.int({ min: 0, max: 120 }), everyone: V.bool() });
  if (b.epgUrls !== undefined) {
    const list = b.epgUrls.split(/\s+/).filter(Boolean);
    if (list.some((u) => !/^https?:\/\/\S+$/i.test(u) && !path.isAbsolute(u))) throw new HttpError(400, 'Adresses http(s):// ou chemins de fichiers, une par ligne');
    setSetting('epg_urls', list.join('\n'));
  }
  if (b.dvrPath !== undefined && b.dvrPath.trim()) {
    const dir = path.resolve(b.dvrPath.trim());
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch { throw new HttpError(400, 'Dossier impossible à créer ou en lecture seule'); }
    setSetting('dvr_path', dir);
  }
  if (b.pre !== undefined) setSetting('dvr_pre', b.pre);
  if (b.post !== undefined) setSetting('dvr_post', b.post);
  if (b.everyone !== undefined) setSetting('dvr_everyone', b.everyone);
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ musique, photos, livres
const libOk = (p) => libraryClause(p);
const normTitle = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const trackOut = (t, pm) => ({ id: t.id, title: t.title, artist: t.original_title, album: t.grp, albumKey: t.key, disc: t.season_num, track: t.episode_num, year: t.year, duration: t.duration, cover: t.poster,
  progress: pm && pm.get(t.id) ? { position: pm.get(t.id).position, watched: !!pm.get(t.id).watched } : null });
router.get('/api/music', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  const tracks = all(`SELECT * FROM items i WHERE i.type = 'track' AND i.category = 'music' AND ${lib.sql} ORDER BY i.original_title, i.grp, i.season_num, i.episode_num`, ...lib.args);
  const albums = new Map(), artists = new Map();
  for (const t of tracks) {
    const a = albums.get(t.key) || { key: t.key, slug: cleanName(`${t.original_title} ${t.grp}`), album: t.grp, artist: t.original_title, year: t.year, cover: t.poster, count: 0, duration: 0, added: 0 };
    a.count++; a.duration += t.duration || 0; a.added = Math.max(a.added, t.added_at || 0); a.year = a.year || t.year; a.cover = a.cover || t.poster;
    albums.set(t.key, a);
    const ar = artists.get(t.original_title) || { name: t.original_title, albums: new Set(), count: 0, cover: t.poster };
    ar.albums.add(t.key); ar.count++; artists.set(t.original_title, ar);
  }
  // Fiches MusicBrainz déjà trouvées : date exacte, type (album, EP…), pochette, nombre de titres attendus
  const metas = new Map(all("SELECT key, date, type, cover, tracks, mb_rg FROM music_albums WHERE status = 'ok'").map((m) => [m.key, m]));
  for (const a of albums.values()) {
    const m = metas.get(a.key);
    if (!m) continue;
    let n = 0; try { n = JSON.parse(m.tracks || '[]').length; } catch { /* */ }
    Object.assign(a, { date: m.date, type: m.type, cover: a.cover || m.cover, year: a.year || (m.date ? Number(m.date.slice(0, 4)) : null), expected: n || null, mbId: m.mb_rg });
  }
  const up = musicUpcoming();
  sendJson(ctx.res, {
    albums: [...albums.values()].sort((a, b) => a.artist.localeCompare(b.artist, 'fr') || (a.year || 0) - (b.year || 0)),
    artists: [...artists.values()].map((a) => ({ name: a.name, slug: cleanName(a.name), albums: a.albums.size, count: a.count, cover: a.cover })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    recent: [...albums.values()].sort((a, b) => b.added - a.added).slice(0, 20),
    tracks: tracks.length > 3000 ? [] : tracks.map((t) => trackOut(t)), total: tracks.length,
    upcoming: up.upcoming.length, missing: up.missing.length, lidarr: arrOn('lidarr'),
  });
});
// À venir et sorties récentes absentes du NAS, pour tous les artistes de la bibliothèque
router.get('/api/music/upcoming', async (ctx) => {
  requireProfile(ctx);
  const up = musicUpcoming();
  const known = await lidarrKnown();
  const mark = (r) => ({ ...r, requested: known.albums.has(r.id) });
  sendJson(ctx.res, { upcoming: up.upcoming.map(mark), missing: up.missing.map(mark), artists: up.artists, pending: up.pending, lidarr: arrOn('lidarr'), status: musicMetaStatus() });
});
router.get('/api/music/album', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  let key = String(ctx.url.searchParams.get('key') || '').slice(0, 500);
  // Adresse lisible : /musique/album/Daft.Punk.Discovery
  const slug = String(ctx.url.searchParams.get('slug') || '').toLowerCase();
  if (slug) { const hit = all("SELECT DISTINCT key, original_title, grp FROM items WHERE type = 'track' AND category = 'music'").find((r) => cleanName(`${r.original_title} ${r.grp}`).toLowerCase() === slug); key = hit ? hit.key : ''; }
  const tracks = all(`SELECT * FROM items i WHERE i.type = 'track' AND i.category = 'music' AND i.key = ? AND ${lib.sql} ORDER BY i.season_num, i.episode_num, i.sort_title`, key, ...lib.args);
  if (!tracks.length) throw new HttpError(404, 'Album introuvable');
  const t0 = tracks[0];
  // Fiche MusicBrainz : date, type, et titres de l'album que le NAS n'a pas
  const meta = albumMeta(key);
  let mb = null;
  if (meta && meta.status === 'ok') {
    const have = new Set(tracks.map((t) => normTitle(t.title)));
    const missing = meta.tracks.filter((x) => !have.has(normTitle(x.title)));
    mb = { id: meta.mb_rg, title: meta.title, date: meta.date, type: meta.type, expected: meta.tracks.length, missing: missing.length <= meta.tracks.length - 1 ? missing : [], artistId: meta.mb_artist };
  }
  sendJson(ctx.res, { mb, lidarr: arrOn('lidarr'), key, slug: cleanName(`${t0.original_title} ${t0.grp}`), artistSlug: cleanName(t0.original_title), album: t0.grp, artist: t0.original_title, year: tracks.map((t) => t.year).find(Boolean) || null, cover: tracks.map((t) => t.poster).find(Boolean) || null,
    genres: [...new Set(tracks.flatMap((t) => parseJson(t.genres, [])))].slice(0, 5), duration: tracks.reduce((n, t) => n + (t.duration || 0), 0), tracks: tracks.map((t) => trackOut(t)) });
});
router.get('/api/music/artist', async (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  let name = String(ctx.url.searchParams.get('name') || '').slice(0, 300);
  const slug = String(ctx.url.searchParams.get('slug') || '').toLowerCase();
  if (slug) { const hit = all("SELECT DISTINCT original_title FROM items WHERE type = 'track' AND category = 'music'").find((r) => cleanName(r.original_title).toLowerCase() === slug); name = hit ? hit.original_title : ''; }
  const tracks = all(`SELECT * FROM items i WHERE i.type = 'track' AND i.category = 'music' AND i.original_title = ? AND ${lib.sql} ORDER BY i.year, i.grp, i.season_num, i.episode_num`, name, ...lib.args);
  if (!tracks.length) throw new HttpError(404, 'Artiste introuvable');
  const albums = new Map();
  for (const t of tracks) { const a = albums.get(t.key) || { key: t.key, slug: cleanName(`${t.original_title} ${t.grp}`), album: t.grp, artist: t.original_title, year: t.year, cover: t.poster, count: 0 }; a.count++; albums.set(t.key, a); }
  // Discographie complète (MusicBrainz) croisée avec le NAS, et ce que Lidarr suit déjà
  const disco = discographyOf(name, nasAlbums().filter((a) => a.artist === name));
  const known = await lidarrKnown();
  sendJson(ctx.res, { name, slug: cleanName(name), albums: [...albums.values()], tracks: tracks.map((t) => trackOut(t)), lidarr: arrOn('lidarr'),
    info: disco ? { mbId: disco.mbId, type: disco.type, country: disco.country, begin: disco.begin, status: disco.status, followed: known.artists.has(disco.mbId) } : null,
    discography: disco ? disco.releases.map((r) => ({ ...r, requested: !!r.id && known.albums.has(r.id) })) : null });
});
// Lecture audio : fichier tel quel quand le navigateur sait le lire, sinon conversion en MP3 à la volée
const NATIVE_AUDIO = new Set(['.mp3', '.m4a', '.aac', '.m4b', '.wav', '.flac', '.ogg', '.oga', '.opus']);
router.get('/api/audio/:id', (ctx) => {
  const p = requireProfile(ctx);
  const t = get("SELECT * FROM items WHERE id = ? AND type IN ('track','audiobook')", Number(ctx.params.id));
  if (!t || !t.path || !visible(p, t)) throw new HttpError(404, 'Introuvable');
  const ext = path.extname(t.path).toLowerCase();
  const force = ctx.url.searchParams.get('mp3') === '1';
  if (!force && NATIVE_AUDIO.has(ext)) return sendFile(ctx.req, ctx.res, t.path, { cache: 'private, max-age=3600' });
  const start = Math.max(0, Number(ctx.url.searchParams.get('t')) || 0);
  ctx.res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  const ff = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...(start ? ['-ss', String(start)] : []), '-i', t.path, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '256k', '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  ff.stdout.pipe(ctx.res);
  ctx.req.on('close', () => ff.kill('SIGKILL'));
});
router.get('/api/lyrics/:id', (ctx) => {
  const p = requireProfile(ctx);
  const t = get("SELECT * FROM items WHERE id = ? AND type = 'track'", Number(ctx.params.id));
  if (!t || !visible(p, t)) throw new HttpError(404, 'Introuvable');
  sendJson(ctx.res, lyricsOf(t) || { synced: null, plain: null });
});

// Photos : albums = dossiers
router.get('/api/photos', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  const rows = all(`SELECT i.key, i.grp, COUNT(*) AS n, MAX(i.release_date) AS last, MIN(i.id) AS first FROM items i WHERE i.type = 'photo' AND ${lib.sql} GROUP BY i.key ORDER BY last DESC`, ...lib.args);
  const covers = new Map(all(`SELECT i.key, i.id FROM items i WHERE i.type = 'photo' AND ${lib.sql} GROUP BY i.key HAVING i.release_date = MAX(i.release_date)`, ...lib.args).map((r) => [r.key, r.id]));
  sendJson(ctx.res, rows.map((r) => ({ key: r.key, slug: cleanName(r.key), name: r.grp, count: r.n, last: r.last, cover: covers.get(r.key) || r.first })));
});
router.get('/api/photos/album', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  let key = String(ctx.url.searchParams.get('key') || '').slice(0, 1000);
  const slug = String(ctx.url.searchParams.get('slug') || '').toLowerCase();
  if (slug) { const hit = all("SELECT DISTINCT key FROM items WHERE type = 'photo'").find((r) => cleanName(r.key).toLowerCase() === slug); key = hit ? hit.key : ''; }
  const list = all(`SELECT i.id, i.title, i.release_date, i.size, i.path FROM items i WHERE i.type = 'photo' AND i.key = ? AND ${lib.sql} ORDER BY i.release_date, i.sort_title`, key, ...lib.args);
  if (!list.length) throw new HttpError(404, 'Album introuvable');
  // Administrateurs : emplacement de l'album et de chaque photo sur le NAS
  const admin = !!p.is_admin;
  sendJson(ctx.res, { key, slug: cleanName(key), name: path.basename(key) || key, folder: admin && list[0].path ? path.dirname(list[0].path) : null,
    photos: list.map((x) => ({ id: x.id, title: x.title, date: x.release_date, size: x.size, path: admin ? x.path : undefined })) });
});
const photoCache = path.join(config.dataDir, 'cache', 'photos');
router.get('/api/photo/:id', async (ctx) => {
  const it = get("SELECT * FROM items WHERE id = ? AND type = 'photo'", Number(ctx.params.id));
  requireVisible(ctx, it, 'Photo introuvable');
  if (!it.path || !fs.existsSync(it.path)) throw new HttpError(404, 'Photo introuvable');
  const w = Number(ctx.url.searchParams.get('w')) || 0;
  const ext = path.extname(it.path).toLowerCase();
  // Les formats que les navigateurs ne lisent pas (HEIC, TIFF) sont toujours convertis
  if (!w && ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) return sendFile(ctx.req, ctx.res, it.path, { cache: 'private, max-age=86400' });
  const size = [320, 640, 1280, 2048].find((x) => x >= (w || 2048)) || 2048;
  const out = path.join(photoCache, `${it.id}_${it.mtime}_${size}.jpg`);
  if (!fs.existsSync(out)) {
    if (!resizing.has(out)) resizing.set(out, resizeImage(it.path, out, size).finally(() => resizing.delete(out)));
    if (!(await resizing.get(out))) throw new HttpError(415, 'Format de photo non pris en charge');
  }
  sendFile(ctx.req, ctx.res, out, { cache: 'private, max-age=2592000, immutable' });
});

// Livres : EPUB lu chapitre par chapitre, CBZ page par page, PDF par le lecteur du navigateur
router.get('/api/books', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  const list = all(`SELECT i.* FROM items i WHERE i.type IN ('book','audiobook') AND ${lib.sql} ORDER BY i.original_title, i.sort_title`, ...lib.args);
  const pm = progressMap(p.id, list.map((b) => b.id));
  const books = list.map((b) => ({ id: b.id, type: b.type, format: b.category, title: b.title, author: b.original_title, year: b.year, cover: b.poster, duration: b.duration, size: b.size, overview: b.overview ? String(b.overview).slice(0, 300) : null,
    progress: pm.get(b.id) ? { position: pm.get(b.id).position, duration: pm.get(b.id).duration, watched: !!pm.get(b.id).watched, updated: pm.get(b.id).updated_at } : null }));
  // Compatibilité : la liste seule quand on le demande (anciens clients)
  if (ctx.url.searchParams.get('flat') === '1') { sendJson(ctx.res, books); return; }
  const photos = new Map(all("SELECT name, photo, status FROM book_authors").map((a) => [a.name, a]));
  const authors = new Map();
  for (const b of books) { if (!b.author) continue; const a = authors.get(b.author) || { name: b.author, slug: cleanName(b.author), count: 0, cover: b.cover, photo: (photos.get(b.author) || {}).photo || null, known: (photos.get(b.author) || {}).status === 'ok' }; a.count++; a.cover = a.cover || b.cover; authors.set(b.author, a); }
  const up = booksUpcoming();
  sendJson(ctx.res, { books, authors: [...authors.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')), upcoming: up.upcoming.length, missing: up.missing.length, request: booksOn() });
});
router.get('/api/books/upcoming', (ctx) => {
  requireProfile(ctx);
  sendJson(ctx.res, { ...booksUpcoming(), request: booksOn(), status: booksMetaStatus() });
});
router.get('/api/books/author', (ctx) => {
  const p = requireProfile(ctx);
  const lib = libOk(p);
  const slug = String(ctx.url.searchParams.get('slug') || '').toLowerCase();
  const name = String(ctx.url.searchParams.get('name') || '') || (all("SELECT DISTINCT original_title FROM items WHERE type IN ('book','audiobook') AND original_title IS NOT NULL").map((r) => r.original_title).find((n) => cleanName(n).toLowerCase() === slug) || '');
  if (!name) throw new HttpError(404, 'Auteur introuvable');
  const mine = all(`SELECT i.id, i.title, i.original_title AS author, i.year, i.poster, i.overview, i.path, i.mtime FROM items i WHERE i.type IN ('book','audiobook') AND i.original_title = ? AND ${lib.sql}`, name, ...lib.args);
  const bib = bibliographyOf(name, mine);
  sendJson(ctx.res, { ...bib, books: mine.map((b) => ({ id: b.id, title: b.title, year: b.year, cover: b.poster, slug: slugFor(b.id) })), request: booksOn() });
});
const bookOf = (ctx) => {
  const p = requireProfile(ctx);
  const b = get("SELECT * FROM items WHERE id = ? AND type IN ('book','audiobook')", Number(ctx.params.id));
  if (!b || !visible(p, b) || !b.path || !fs.existsSync(b.path)) throw new HttpError(404, 'Livre introuvable');
  return { p, b };
};
router.get('/api/books/:id', (ctx) => {
  const { p, b } = bookOf(ctx);
  const out = { id: b.id, slug: slugFor(b.id), type: b.type, format: b.category, title: b.title, author: b.original_title, overview: b.overview, cover: b.poster, duration: b.duration };
  const pr = get('SELECT position, duration, watched FROM progress WHERE profile_id = ? AND item_id = ?', p.id, b.id);
  out.progress = pr || null;
  if (b.category === 'epub') {
    const pk = epubPackage(b.path);
    out.chapters = pk.spine.length;
    const nav = [...pk.manifest.values()].find((x) => /nav/.test(x.props));
    out.toc = [];
    try {
      if (nav) {
        const html = zipRead(b.path, nav.href).toString('utf8');
        const dir = path.posix.dirname(nav.href);
        for (const m of html.matchAll(/<a\s[^>]*href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
          const href = path.posix.normalize(`${dir === '.' ? '' : `${dir}/`}${decodeURIComponent(m[1])}`);
          const i = pk.spine.indexOf(href);
          if (i >= 0) out.toc.push({ title: m[2].replace(/<[^>]+>/g, '').trim().slice(0, 120), chapter: i });
        }
      }
    } catch { /* table des matières absente */ }
  }
  if (b.category === 'cbz') out.pages = cbzPages(b.path).length;
  if (b.type === 'audiobook') {
    const parts = b.path.toLowerCase().endsWith('.m4b') ? [b] : all("SELECT * FROM items WHERE type = 'track' AND parent_id = ? ORDER BY season_num, episode_num, sort_title, path", b.id);
    out.parts = parts.map((t) => ({ id: t.id, title: t.title, duration: t.duration }));
  }
  sendJson(ctx.res, out);
});
// Les pages des livres sont affichées dans un cadre de Venus : leurs propres scripts sont désactivés
const bookHeaders = (res, type) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'; sandbox allow-same-origin");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
};
const MIME = { '.xhtml': 'application/xhtml+xml; charset=utf-8', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
router.get('/api/books/:id/chapter/:n', (ctx) => {
  const { b } = bookOf(ctx);
  if (b.category !== 'epub') throw new HttpError(400, 'Pas un EPUB');
  const pk = epubPackage(b.path);
  const n = Number(ctx.params.n);
  const href = pk.spine[n];
  if (!href) throw new HttpError(404, 'Chapitre introuvable');
  // Redirection vers le fichier du chapitre : ses liens relatifs (images, styles) fonctionnent tels quels
  ctx.res.writeHead(302, { Location: `/api/books/${b.id}/res/${href.split('/').map(encodeURIComponent).join('/')}` });
  ctx.res.end();
});
router.get('/api/books/:id/page/:n', (ctx) => {
  const { b } = bookOf(ctx);
  if (b.category !== 'cbz') throw new HttpError(400, 'Pas une bande dessinée');
  const name = cbzPages(b.path)[Number(ctx.params.n)];
  if (!name) throw new HttpError(404, 'Page introuvable');
  const data = zipRead(b.path, name);
  bookHeaders(ctx.res, MIME[path.extname(name).toLowerCase()] || 'image/jpeg');
  ctx.res.end(data);
});
router.get('/api/books/:id/file', (ctx) => {
  const { b } = bookOf(ctx);
  if (b.category !== 'pdf' && ctx.url.searchParams.get('download') !== '1') throw new HttpError(400, 'Ouvrez ce livre dans le lecteur');
  if (b.category === 'pdf') { ctx.res.setHeader('X-Frame-Options', 'SAMEORIGIN'); ctx.res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-same-origin"); }
  sendFile(ctx.req, ctx.res, b.path, { cache: 'private, max-age=3600', type: b.category === 'pdf' ? 'application/pdf' : undefined });
});
router.get('/api/books/:id/res/*', (ctx) => {
  const { b } = bookOf(ctx);
  if (b.category !== 'epub') throw new HttpError(400, 'Pas un EPUB');
  let name;
  name = path.posix.normalize(String(ctx.params.rest));
  if (name.startsWith('..') || name.includes('\0')) throw new HttpError(400, 'Chemin invalide');
  const data = zipRead(b.path, name);
  if (!data) throw new HttpError(404, 'Introuvable dans le livre');
  bookHeaders(ctx.res, MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');
  ctx.res.end(data);
});

// ---------------------------------------------------------------- affiches manquantes (Réglages → Affiches)
router.get('/api/admin/posters', (ctx) => {
  requireAdmin(ctx);
  const missing = all("SELECT id, type, title, year, category, matched, poster_tried FROM items WHERE type IN ('movie','show') AND version_of IS NULL AND poster IS NULL ORDER BY added_at DESC LIMIT 500");
  const total = get("SELECT COUNT(*) n FROM items WHERE type IN ('movie','show') AND version_of IS NULL").n;
  sendJson(ctx.res, { total, missing: missing.map((i) => ({ ...i, slug: slugFor(i.id), path: pathFor(i.id) })), tmdb: !!tmdbKey(), free: getSetting('posters_free', '1') !== '0' });
});
router.post('/api/admin/posters/run', async (ctx) => {
  requireAdmin(ctx);
  // Lancement à la main : on redonne leur chance aux titres déjà cherchés sans succès
  run("UPDATE items SET poster_tried = 0 WHERE poster IS NULL AND type IN ('movie','show')");
  run("UPDATE items SET backdrop_tried = 0 WHERE backdrop IS NULL AND type = 'show'");
  run("UPDATE items SET poster_tried = 0 WHERE type = 'season'");
  const n = await fillMissingPosters();
  fillMissingBackdrops().catch(() => {});
  fillSeasonPosters().catch(() => {});
  sendJson(ctx.res, { found: n });
});
// Oublier les affiches trouvées sans clé (ancienne correspondance trop large) et les rechercher strictement
router.post('/api/admin/posters/redo', async (ctx) => {
  requireAdmin(ctx);
  const n = redoFreePosters();
  runTask('posters').catch(() => {});
  sendJson(ctx.res, { reset: n });
});
router.get('/api/admin/posters/test', async (ctx) => {
  requireAdmin(ctx);
  const title = String(ctx.url.searchParams.get('title') || 'Inception').slice(0, 120);
  const year = Number(ctx.url.searchParams.get('year')) || null;
  const type = ['movie', 'show', 'anime'].includes(ctx.url.searchParams.get('type')) ? ctx.url.searchParams.get('type') : 'movie';
  sendJson(ctx.res, { title, year, type, tmdbKey: !!tmdbKey(), results: await testSources(title, year, type) });
});
// Propositions d'affiches pour un titre (sources gratuites + TMDB si clé), pour « Choisir une affiche »
router.get('/api/admin/posters/:id/candidates', async (ctx) => {
  requireAdmin(ctx);
  const it = editable(ctx.params.id);
  const q = String(ctx.url.searchParams.get('q') || it.title).slice(0, 200);
  const year = Number(ctx.url.searchParams.get('year')) || it.year || null;
  const out = [];
  if (tmdbKey()) {
    try {
      const r = await searchTmdb(it.type === 'movie' ? 'movie' : 'tv', q, year);
      for (const x of (r || []).slice(0, 6)) if (x.poster) out.push({ url: x.poster.replace(/\/w\d+\//, '/w500/'), source: 'TMDB', title: x.title, year: x.year });
    } catch { /* */ }
  }
  try { for (const c of await freePosterCandidates(it.type, q, year)) out.push(c); } catch { /* */ }
  sendJson(ctx.res, out);
});

// ---------------------------------------------------------------- mise à jour de Venus
router.get('/api/admin/update', async (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { ...(await checkUpdate(ctx.url.searchParams.get('force') === '1')), updater: updaterInfo() }); });
router.put('/api/admin/update/prefs', async (ctx) => {
  requireAdmin(ctx);
  const b = validate(await readBody(ctx.req), { night: V.bool(), notify: V.bool() });
  sendJson(ctx.res, setUpdatePrefs(b));
});
router.post('/api/admin/update', async (ctx) => {
  const me = requireAdmin(ctx);
  const r = await runUpdate();
  logActivity('server', `${me.name} a lancé la mise à jour de Venus`);
  sendJson(ctx.res, r);
});

// ---------------------------------------------------------------- médiathèque : doublons et renommage
router.get('/api/admin/duplicates', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, duplicateGroups()); });
router.get('/api/admin/rename', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { plan: renamePlan() }); });
router.post('/api/admin/rename', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = validate(await readBody(ctx.req, 64 * 1024), { ids: (v) => { if (!Array.isArray(v) || v.length > 2000 || !v.every((x) => Number.isInteger(x) && x > 0)) throw new HttpError(400, 'Liste invalide'); return v; } }, { required: ['ids'] });
  const r = applyRenames(b.ids);
  for (const l of all('SELECT path FROM libraries WHERE type IN (\'movies\',\'shows\',\'anime\')')) { try { removeEmptyDirs(l.path); } catch { /* */ } }
  logActivity('edit', `${me.name} a renommé ${r.done} fichier(s)`);
  sendJson(ctx.res, r);
});

// ---------------------------------------------------------------- export / import complet (base + images), pour changer de machine
router.get('/api/admin/export', (ctx) => {
  requireAdmin(ctx);
  const dir = config.dataDir;
  const snap = path.join(dir, 'backups', 'export-tmp.db');
  fs.mkdirSync(path.dirname(snap), { recursive: true });
  try { fs.unlinkSync(snap); } catch { /* */ }
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  const stamp = new Date().toISOString().slice(0, 10);
  ctx.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="venus-export-${stamp}.tar.gz"`, 'Cache-Control': 'no-store' });
  // tar : base (sous le nom venus.db), images, sous-titres récupérés, CSS perso. Jamais les vidéos ni les clés TLS.
  const args = ['-czf', '-', '-C', dir, '--transform', 's|^backups/export-tmp.db$|venus.db|', 'backups/export-tmp.db', ...['images', 'subs'].filter((d) => fs.existsSync(path.join(dir, d)))];
  const t = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  t.stdout.pipe(ctx.res);
  t.on('close', () => { try { fs.unlinkSync(snap); } catch { /* */ } });
  ctx.req.on('close', () => { try { t.kill(); } catch { /* */ } });
});
router.post('/api/admin/import', async (ctx) => {
  const me = requireAdmin(ctx);
  const dir = config.dataDir, tmp = path.join(dir, 'backups', `import-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, 'import.tar.gz');
  await new Promise((resolve, reject) => { let n = 0; const w = fs.createWriteStream(file); ctx.req.on('data', (c) => { n += c.length; if (n > 4 * 1024 ** 3) { w.destroy(); reject(new HttpError(413, 'Archive trop grosse (4 Go au plus)')); } }); ctx.req.pipe(w); w.on('finish', resolve); w.on('error', reject); });
  // Contenu vérifié avant d'extraire : fichiers et dossiers ordinaires seulement (aucun lien qui mènerait hors
  // du dossier, aucun chemin absolu ni « .. »), 20 Go décompressés au plus
  const listing = await new Promise((resolve) => { let out = ''; const t = spawn('tar', ['-tvzf', file], { stdio: ['ignore', 'pipe', 'ignore'] }); t.stdout.on('data', (d) => { if (out.length < 5e6) out += d; }); t.on('close', (code) => resolve(code === 0 ? out : null)); });
  const entries = (listing || '').split('\n').filter(Boolean);
  const unsafe = !listing || entries.some((l) => !/^[-d]/.test(l) || /(^|\s)(\/|\.\.\/)|\/\.\.(\/|$)/.test(l.split(/\s+/).slice(5).join(' ')));
  const total = entries.reduce((n, l) => n + (Number(l.split(/\s+/)[2]) || 0), 0);
  if (unsafe || total > 20 * 1024 ** 3) { fs.rmSync(tmp, { recursive: true, force: true }); throw new HttpError(400, unsafe ? 'Archive refusée : elle contient des liens ou des chemins non autorisés' : 'Archive trop grosse une fois décompressée'); }
  const r = await new Promise((resolve) => { const t = spawn('tar', ['-xzf', file, '-C', tmp, '--no-same-owner', '--no-same-permissions'], { stdio: 'ignore' }); t.on('close', (code) => resolve(code)); });
  if (r !== 0 || !fs.existsSync(path.join(tmp, 'venus.db'))) { fs.rmSync(tmp, { recursive: true, force: true }); throw new HttpError(400, 'Archive illisible : attendu un export Venus (.tar.gz)'); }
  // Images et sous-titres : ajoutés sans écraser ; base : restaurée au prochain démarrage (comme une sauvegarde)
  for (const sub of ['images', 'subs']) {
    const src = path.join(tmp, sub); if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (const f of fs.readdirSync(src)) { try { if (!fs.lstatSync(path.join(src, f)).isFile() || !/^[\w.-]+$/.test(f)) continue; fs.copyFileSync(path.join(src, f), path.join(dir, sub, f), fs.constants.COPYFILE_EXCL); } catch { /* déjà là */ } }
  }
  const name = `venus-import-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`;
  fs.copyFileSync(path.join(tmp, 'venus.db'), path.join(dir, 'backups', name));
  fs.rmSync(tmp, { recursive: true, force: true });
  makeBackup({ manual: true });
  scheduleRestore(name);
  logActivity('server', `${me.name} a importé une archive Venus`);
  sendJson(ctx.res, { ok: true, restarting: supervised() });
});

// ---------------------------------------------------------------- état du serveur (outil de surveillance : réponse minimale sans session)
router.get('/api/health', (ctx) => {
  // Sans session : seulement « en marche » (ni nom, ni version, ni disque, qui aideraient un curieux)
  if (!ctx.auth) return sendJson(ctx.res, { ok: true });
  let disk = null;
  try { const st = fs.statfsSync(config.dataDir); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* */ }
  sendJson(ctx.res, { ok: true, name: getSetting('server_name', 'Venus'), version: config.version, uptime: Math.round(process.uptime()), scanning: scanState.running, lastScan: scanState.lastScan || null, playing: nowPlaying().length, disk });
});
// Nombre de lectures en cours (badge de l'administrateur)
router.get('/api/admin/live', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { playing: nowPlaying().length, devices: connected.size }); });

// ---------------------------------------------------------------- corbeille
router.get('/api/admin/trash', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { items: listTrash(), keepDays: KEEP_DAYS }); });
router.post('/api/admin/trash/:id/restore', async (ctx) => {
  const me = requireAdmin(ctx);
  const n = restoreTrash(ctx.params.id);
  logActivity('edit', `${me.name} a restauré une vidéo depuis la corbeille`);
  scanAll().catch(() => {});
  sendJson(ctx.res, { restored: n });
});
router.del('/api/admin/trash/:id', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, purgeTrash(ctx.params.id)); });
router.del('/api/admin/trash', (ctx) => { const me = requireAdmin(ctx); let count = 0, freed = 0; for (const t of listTrash()) { const r = purgeTrash(t.id); count += r.count; freed += r.freed; } logActivity('delete', `${me.name} a vidé la corbeille`); sendJson(ctx.res, { count, freed }); });

// « Retirer de Reprendre » : oublie la progression (le film ou la série ne sont pas marqués vus)
router.post('/api/items/:id/forget', (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Introuvable');
  if (item.type === 'show') run("DELETE FROM progress WHERE profile_id = ? AND item_id IN (SELECT id FROM items WHERE show_id = ?) AND watched = 0", p.id, item.id);
  else if (item.type === 'episode') run("DELETE FROM progress WHERE profile_id = ? AND item_id IN (SELECT id FROM items WHERE show_id = ?) AND watched = 0", p.id, item.show_id);
  else run('DELETE FROM progress WHERE profile_id = ? AND item_id = ? AND watched = 0', p.id, item.id);
  sendJson(ctx.res, { ok: true });
});

// ---------------------------------------------------------------- « un jour comme aujourd'hui » : films sortis à la même date
router.get('/api/today', (ctx) => {
  const p = requireProfile(ctx);
  const age = ageClause(p);
  const md = new Date().toISOString().slice(5, 10);
  const rows = all(`SELECT i.* FROM items i WHERE i.type = 'movie' AND i.version_of IS NULL AND i.release_date IS NOT NULL AND substr(i.release_date, 6, 5) = ? AND ${age.sql} ORDER BY i.release_date LIMIT 12`, md, ...age.args);
  const y = new Date().getFullYear();
  sendJson(ctx.res, rows.filter((i) => visible(p, i)).map((i) => ({ ...card(i), yearsAgo: y - Number(i.release_date.slice(0, 4)) })));
});

router.get('/api/admin/broken', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, brokenFiles()); });
router.get('/api/admin/report', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, weeklyReport()); });
// Nouveautés depuis la dernière visite de l'administrateur (journal des changements, montré une fois)
router.get('/api/admin/changelog', async (ctx) => {
  requireAdmin(ctx);
  const seen = String(getSetting('changelog_seen', '') || '');
  const local = (await localCommit()) || '';
  if (!local || seen === local) return sendJson(ctx.res, { items: [], commit: local.slice(0, 7) });
  // Messages des commits installés depuis le dernier vu (via GitHub, résultat en cache)
  let items = [];
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.VENUS_REPO || 'TOUFATECH/Venus'}/commits?sha=${encodeURIComponent(local)}&per_page=30`, { headers: { 'User-Agent': 'Venus/1.0', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) { const list = await r.json(); const idx = seen ? list.findIndex((c) => c.sha === seen || c.sha.startsWith(seen)) : Math.min(list.length, 8); items = (idx === -1 ? list.slice(0, 8) : list.slice(0, idx)).map((c) => ({ title: String(c.commit.message || '').split('\n')[0], body: String(c.commit.message || '').split('\n').slice(2).join('\n').trim(), date: c.commit.author?.date })); }
  } catch { /* hors ligne : rien à montrer */ }
  sendJson(ctx.res, { items, commit: local.slice(0, 7) });
});
router.post('/api/admin/changelog/seen', async (ctx) => { requireAdmin(ctx); setSetting('changelog_seen', (await localCommit()) || ''); sendJson(ctx.res, { ok: true }); });

// ---------------------------------------------------------------- avis perso, prévision de stockage, conversions, extraits
router.post('/api/items/:id/opinion', async (ctx) => {
  const p = requireProfile(ctx);
  const b = validate(await readBody(ctx.req, 1024), { liked: V.nullable(V.bool()) }, {});
  if (!get('SELECT 1 FROM items WHERE id = ?', Number(ctx.params.id))) throw new HttpError(404, 'Introuvable');
  setOpinion(p.id, Number(ctx.params.id), b.liked);
  sendJson(ctx.res, { ok: true });
});
router.get('/api/admin/storage', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, storageForecast()); });
router.get('/api/admin/transcodes', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, transcodeSummary()); });
// Extrait de quelques secondes (GIF ou MP4 480p) : fichier temporaire, servi une fois
const clipLimiter = new Map();
// ---------------------------------------------------------------- film pour tout le monde (les personnes présentes)
// Titres que personne (parmi les présents) n'a vus, permis au plus jeune, et qui plaisent à chacun :
// l'affinité de chaque personne vient de ses avis (♥) et des genres qu'elle regarde le plus
function tasteOf(profileId) {
  const t = { ...genreTaste(profileId) };
  for (const r of all(`SELECT i.genres, s.genres AS sg FROM progress pr JOIN items i ON i.id = pr.item_id LEFT JOIN items s ON s.id = i.show_id WHERE pr.profile_id = ? AND (pr.watched = 1 OR pr.position > 600) ORDER BY pr.updated_at DESC LIMIT 400`, profileId)) {
    for (const g of parseJson(r.sg || r.genres, [])) t[g] = (t[g] || 0) + 0.5;
  }
  const max = Math.max(1, ...Object.values(t));
  for (const k of Object.keys(t)) t[k] /= max;
  return t;
}
router.get('/api/together', (ctx) => {
  const me = requireProfile(ctx);
  const ids = [...new Set(String(ctx.url.searchParams.get('profiles') || '').split(',').map(Number).filter(Boolean))];
  const profiles = ids.length ? all(`SELECT * FROM profiles WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [me];
  if (!profiles.length) throw new HttpError(400, 'Choisissez au moins une personne');
  const kind = ctx.url.searchParams.get('kind') === 'show' ? 'show' : 'movie';
  const tastes = profiles.map((p) => ({ p, t: tasteOf(p.id) }));
  const seen = new Set(all(`SELECT DISTINCT COALESCE(i.show_id, i.item_id) AS id FROM (SELECT pr.item_id, it.show_id FROM progress pr JOIN items it ON it.id = pr.item_id WHERE pr.profile_id IN (${profiles.map(() => '?').join(',')}) AND (pr.watched = 1 OR pr.position > 300)) i`, ...profiles.map((p) => p.id)).map((r) => r.id));
  const kids = profiles.some((p) => p.is_kids);
  const maxMin = Number(ctx.url.searchParams.get('max')) || (kids ? 130 : 999);
  const items = all(`SELECT * FROM items WHERE type = ? AND version_of IS NULL`, kind).filter((i) => !seen.has(i.id) && profiles.every((p) => visible(p, i)));
  const scored = items.map((i) => {
    const genres = parseJson(i.genres, []);
    const aff = tastes.map(({ t }) => (genres.length ? genres.reduce((n, g) => n + (t[g] || 0), 0) / Math.min(3, genres.length) : 0.2));
    const min = Math.min(...aff), sum = aff.reduce((a, b) => a + b, 0) / aff.length;
    const runtime = i.runtime || (i.duration ? Math.round(i.duration / 60) : 0);
    if (kind === 'movie' && runtime && runtime > maxMin) return null;
    const score = sum * 2 + min * 3 + (i.vote || 0) / 10 + (i.popularity ? Math.min(1, Math.log10(1 + i.popularity) / 3) : 0);
    // Pourquoi : les genres partagés par le plus de monde
    const liked = genres.map((g) => [g, tastes.filter(({ t }) => (t[g] || 0) >= 0.3).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const why = liked.map(([g, n]) => (n === tastes.length && tastes.length > 1 ? `${g} : plaît à tout le monde` : n > 1 ? `${g} : plaît à ${n} d’entre vous` : `${g}`));
    return { item: card(i), score, why };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  sendJson(ctx.res, { profiles: profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, kids: !!p.is_kids })), kids, results: scored.slice(0, 24) });
});

// ---------------------------------------------------------------- recherche dans les dialogues
setSubtitleVtt(subtitleVtt);
router.get('/api/dialogues', (ctx) => {
  const p = requireProfile(ctx);
  const q = String(ctx.url.searchParams.get('q') || '').slice(0, 200);
  const hits = searchDialogues(q, { limit: Number(ctx.url.searchParams.get('limit')) || 30 });
  const ids = [...new Set(hits.map((h) => h.itemId))];
  const items = new Map(ids.length ? all(`SELECT i.*, s.title AS show_title FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id IN (${ids.map(() => '?').join(',')})`, ...ids).filter((i) => visible(p, i)).map((i) => [i.id, card(i)]) : []);
  const out = [];
  for (const id of ids) {
    const it = items.get(id);
    if (!it) continue;
    out.push({ item: it, lines: hits.filter((h) => h.itemId === id).map((h) => ({ start: h.start, stop: h.stop, text: h.text })) });
  }
  sendJson(ctx.res, { results: out, ...dialogueStats() });
});

// ---------------------------------------------------------------- sous-titres générés (reconnaissance vocale sur le serveur)
router.get('/api/admin/transcribe', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { ...transcribeStatus(), libretranslateUrl: getSetting('libretranslate_url', '') }); });
router.put('/api/admin/transcribe', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  if (b.model && MODELS[b.model]) setSetting('whisper_model', b.model);
  if (b.libretranslateUrl !== undefined) { const u = String(b.libretranslateUrl || '').trim(); if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, 'Adresse LibreTranslate invalide'); setSetting('libretranslate_url', u); }
  if (b.libretranslateKey !== undefined) setSetting('libretranslate_key', String(b.libretranslateKey || '').trim());
  sendJson(ctx.res, transcribeStatus());
});
router.post('/api/admin/transcribe/model', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 1024);
  const m = MODELS[b.model] ? b.model : 'small';
  downloadModel(m).then(() => logActivity('admin', `Modèle de reconnaissance vocale « ${m} » téléchargé`)).catch((e) => console.warn('[whisper]', e.message));
  sendJson(ctx.res, { started: true });
});
// Un profil demande des sous-titres pour un titre (film ou épisode)
router.post('/api/items/:id/subtitles/generate', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path) throw new HttpError(404, 'Vidéo introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Interdit');
  try {
    const job = requestSubtitles(item.id, { lang: 'fr', onDone: () => { scheduleDialogues(item.id, true); notify({ title: 'Sous-titres prêts', body: `« ${item.title} » : sous-titres générés, à choisir dans le lecteur.`, url: pathFor(item.show_id || item.id), tag: `subs-${item.id}` }, { profileId: p.id }).catch(() => {}); } });
    sendJson(ctx.res, { id: job.id, phase: job.phase, pct: job.pct, error: job.error });
  } catch (e) { throw new HttpError(400, e.message); }
});
router.get('/api/items/:id/subtitles/generate', (ctx) => {
  requireProfile(ctx);
  const j = jobOf(Number(ctx.params.id));
  sendJson(ctx.res, j ? { id: j.id, phase: j.phase, pct: j.pct, error: j.error, done: !!j.result, sub: j.result ? j.result.sub : null } : { none: true });
});

// ---------------------------------------------------------------- lumières synchronisées (Hue, WLED)
router.get('/api/lights', (ctx) => { requireProfile(ctx); const s = lightsStatus(); sendJson(ctx.res, { enabled: s.enabled, targets: s.targets, ready: lightsReady() }); });
router.post('/api/lights/color', async (ctx) => {
  requireProfile(ctx);
  if (!lightsReady()) throw new HttpError(409, 'Aucune lampe configurée');
  const b = await readBody(ctx.req, 512);
  const r = await setColor({ r: b.r, g: b.g, b: b.b, bri: b.bri, fast: !!b.fast });
  sendJson(ctx.res, r);
});
router.post('/api/lights/session', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req, 256);
  sendJson(ctx.res, b.action === 'stop' ? await lightsEnd() : await lightsStart(p.id));
});
router.get('/api/admin/lights', (ctx) => { requireAdmin(ctx); sendJson(ctx.res, lightsStatus()); });
router.put('/api/admin/lights', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 8192);
  try { saveLights(b); } catch (e) { throw new HttpError(400, e.message); }
  logActivity('admin', 'Réglages des lumières modifiés');
  sendJson(ctx.res, lightsStatus());
});
router.post('/api/admin/lights/hue/pair', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 1024);
  try { sendJson(ctx.res, await huePair(b.bridge)); } catch (e) { throw new HttpError(400, `Pont Hue injoignable : ${e.message}`); }
});
router.get('/api/admin/lights/hue/lights', async (ctx) => {
  requireAdmin(ctx);
  try { sendJson(ctx.res, { lights: await hueLights() }); } catch (e) { throw new HttpError(400, e.message); }
});
router.post('/api/admin/lights/wled/check', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 1024);
  try { sendJson(ctx.res, await wledInfo(b.host)); } catch (e) { throw new HttpError(400, `WLED injoignable : ${e.message}`); }
});
router.post('/api/admin/lights/test', async (ctx) => {
  requireAdmin(ctx);
  try { sendJson(ctx.res, await testLights()); } catch (e) { throw new HttpError(400, e.message); }
});

// ---------------------------------------------------------------- scènes : « Précédemment dans… », meilleurs moments, chapitres
const chapterCache = new Map();
async function chaptersFor(item, probe) {
  const key = `${item.id}:${item.mtime}`;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const data = getScenes(item);
  if (!data) return [];
  const dialogues = await dialoguesOf(item, subtitleVtt);
  const out = generatedChapters({ ...data, duration: data.duration || (probe && probe.duration) || 0 }, dialogues);
  chapterCache.set(key, out);
  if (chapterCache.size > 300) chapterCache.delete(chapterCache.keys().next().value);
  return out;
}
/** Résumé de l'épisode « ep » (pour qui va regarder le suivant) : analyse si besoin, puis montage. Renvoie le fichier. */
async function prepareRecap(ep) {
  const data = await analyzeScenes(ep);
  const dialogues = await dialoguesOf(ep, subtitleVtt);
  const plan = recapPlan(ep, data, dialogues);
  return buildRecap(ep, plan);
}
const recapJobs = new Map();
// Le résumé à montrer avant l'épisode :id (celui de l'épisode précédent). 202 tant qu'il se prépare.
router.get('/api/items/:id/recap', async (ctx) => {
  const p = requireProfile(ctx);
  const ep = get("SELECT * FROM items WHERE id = ? AND type = 'episode'", Number(ctx.params.id));
  if (!ep) throw new HttpError(404, 'Épisode introuvable');
  if (!visible(p, ep)) throw new HttpError(403, 'Interdit');
  const prev = prevEpisode(ep);
  if (!prev || !prev.path || !fs.existsSync(prev.path)) return sendJson(ctx.res, { available: false, reason: 'Pas d’épisode précédent' });
  const file = path.join(config.dataDir, 'cache', 'scenes', `recap_${prev.id}_${prev.mtime}.mp4`);
  const info = () => ({ prev: { id: prev.id, title: prev.title, season: prev.season_num, episode: prev.episode_num }, url: `/api/items/${ep.id}/recap.mp4` });
  if (fs.existsSync(file)) return sendJson(ctx.res, { available: true, ready: true, ...info() });
  if (ctx.url.searchParams.get('build') === '0') return sendJson(ctx.res, { available: true, ready: false, ...info() });
  if (!recapJobs.has(prev.id)) {
    recapJobs.set(prev.id, { at: Date.now(), error: null });
    prepareRecap(prev).then(() => recapJobs.delete(prev.id)).catch((e) => { recapJobs.set(prev.id, { at: Date.now(), error: e.message }); setTimeout(() => recapJobs.delete(prev.id), 600000); });
  }
  const job = recapJobs.get(prev.id);
  if (job && job.error) return sendJson(ctx.res, { available: false, reason: job.error });
  ctx.res.statusCode = 202;
  sendJson(ctx.res, { available: true, ready: false, since: job ? job.at : Date.now(), ...info() });
});
router.get('/api/items/:id/recap.mp4', (ctx) => {
  const p = requireProfile(ctx);
  const ep = get("SELECT * FROM items WHERE id = ? AND type = 'episode'", Number(ctx.params.id));
  if (!ep || !visible(p, ep)) throw new HttpError(404, 'Introuvable');
  const prev = prevEpisode(ep);
  const file = prev && path.join(config.dataDir, 'cache', 'scenes', `recap_${prev.id}_${prev.mtime}.mp4`);
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Résumé pas encore prêt');
  sendFile(ctx.req, ctx.res, file, { type: 'video/mp4', cache: 'private, max-age=86400' });
});
// Meilleurs moments d'un film ou d'un épisode (extraits de 8 s à partager)
router.get('/api/items/:id/highlights', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path) throw new HttpError(404, 'Vidéo introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Interdit');
  let data = getScenes(item);
  if (!data) {
    if (ctx.url.searchParams.get('wait') === '1') data = await analyzeScenes(item);
    else { scheduleScenes(item.id, true); ctx.res.statusCode = 202; return sendJson(ctx.res, { ready: false, moments: [] }); }
  }
  const dialogues = await dialoguesOf(item, subtitleVtt);
  const moments = sceneHighlights(item, data, { count: Number(ctx.url.searchParams.get('n')) || 5, length: 8, dialogues })
    .map((m) => ({ ...m, line: (dialogues.find((x) => x.start >= m.start - 1 && x.start <= m.end) || {}).text || null }));
  sendJson(ctx.res, { ready: true, moments });
});

router.get('/api/items/:id/clip', async (ctx) => {
  const p = requireProfile(ctx);
  const item = get('SELECT * FROM items WHERE id = ?', Number(ctx.params.id));
  if (!item || !item.path || item.stream_url) throw new HttpError(404, 'Vidéo introuvable');
  if (!visible(p, item)) throw new HttpError(403, 'Interdit');
  const last = clipLimiter.get(p.id) || 0;
  if (Date.now() - last < 15000) throw new HttpError(429, 'Un extrait à la fois : réessayez dans quelques secondes');
  clipLimiter.set(p.id, Date.now());
  const format = ctx.url.searchParams.get('format') === 'gif' ? 'gif' : 'mp4';
  const file = await makeClip(item.path, { start: Number(ctx.url.searchParams.get('start')) || 0, duration: Number(ctx.url.searchParams.get('duration')) || 8, format });
  const name = `${String(item.title || 'extrait').replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '_') || 'extrait'}-${Math.floor(Number(ctx.url.searchParams.get('start')) || 0)}s.${format}`;
  logActivity('edit', `${p.name} a partagé un extrait de « ${item.title} »`);
  sendFile(ctx.req, ctx.res, file, { type: format === 'gif' ? 'image/gif' : 'video/mp4', download: name, cache: 'no-store' });
  ctx.res.on('close', () => setTimeout(() => fs.rmSync(file, { force: true }), 5000));
});
