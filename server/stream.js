// Moteur de lecture : lecture directe (0 % CPU), remux HLS (copie vidéo), ou transcodage HLS matériel.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config.js';
import { hw, videoPipelines } from './hw.js';
import { NET_INPUT } from './probe.js';
import { getSetting } from './db.js';
import { HttpError } from './http.js';

export const QUALITIES = {
  auto: { label: 'Auto', height: 2160, bitrate: 20e6 },
  original: { label: 'Originale', height: 0, bitrate: 0 },
  '1080p': { label: '1080p', height: 1080, bitrate: 8e6 },
  '720p': { label: '720p', height: 720, bitrate: 4e6 },
  '480p': { label: '480p', height: 480, bitrate: 1.5e6 },
  '360p': { label: '360p (data mobile)', height: 360, bitrate: 0.7e6 },
};

// ---------------------------------------------------------------- décision de lecture
export function decide(probe, { caps = {}, audioOrder = 0, quality = 'auto', burnSub = null, maxBitrate = 0 }) {
  const v = probe.video;
  const audio = probe.audio[audioOrder] || probe.audio[0] || null;
  const q = QUALITIES[quality] || QUALITIES.auto;
  const capVideo = new Set(caps.video || ['h264']);
  const capAudio = new Set(caps.audio || ['aac', 'mp3']);
  const capCont = new Set(caps.containers || ['mp4']);
  let limitBitrate = q.bitrate || 0;
  if (maxBitrate > 0) limitBitrate = limitBitrate ? Math.min(limitBitrate, maxBitrate) : maxBitrate;
  const limitHeight = q.height || 0;

  if (!v) return { mode: 'transcode', reason: 'Audio seul', audio, copyVideo: false };

  const tooBig = (limitHeight && v.height > limitHeight * 1.15) || (limitBitrate && probe.bitrate > limitBitrate * 1.15);
  const videoOk = capVideo.has(v.codec) && !(v.codec === 'h264' && v.bitDepth > 8) && !(v.hdr && !caps.hdr) && !(v.dovi && !caps.dovi);
  const audioOk = !audio || capAudio.has(audio.codec) || (audio.codec === 'aac' && audio.channels <= 2);
  const containerOk = capCont.has(probe.container);
  const firstAudio = !audio || audio.order === 0 || probe.audio.length === 1;
  const burn = burnSub != null;

  if (videoOk && audioOk && containerOk && firstAudio && !tooBig && !burn) {
    return { mode: 'direct', reason: 'Lecture directe', audio };
  }
  // Copie du flux vidéo (quasi gratuit) : seul le conteneur et/ou l'audio changent
  const canCopyHls = v.codec === 'h264' || (v.codec === 'hevc' && capVideo.has('hevc') && caps.hevcHls);
  if (videoOk && canCopyHls && !tooBig && !burn) {
    return { mode: 'remux', reason: !containerOk ? 'Conteneur adapté' : 'Piste audio adaptée', audio, copyVideo: true };
  }
  const why = !videoOk ? `Codec ${v.codec}${v.hdr ? ' HDR' : ''} non pris en charge` : tooBig ? 'Qualité réduite' : burn ? 'Sous-titres incrustés' : 'Conversion';
  return { mode: 'transcode', reason: why, audio, copyVideo: false, limitHeight, limitBitrate };
}

function targetSize(v, limitHeight) {
  let h = v.height, w = v.width;
  const maxH = limitHeight || 2160;
  if (h > maxH) { w = Math.round((w * maxH) / h); h = maxH; }
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w), height: even(h) };
}
function targetBitrate(probe, height, limit) {
  const base = height >= 2000 ? 20e6 : height >= 1000 ? 8e6 : height >= 700 ? 4e6 : height >= 470 ? 1.6e6 : 0.8e6;
  let b = base;
  const src = probe.video?.bitrate || probe.bitrate;
  if (src) b = Math.min(b, src * 1.1);
  if (limit) b = Math.min(b, limit);
  return Math.max(400e3, Math.round(b));
}

// ---------------------------------------------------------------- dossier des conversions
// En mémoire vive quand c'est possible (plus rapide, n'use pas le disque), sinon sur le disque.
// La mémoire est utilisée seulement s'il y reste au moins 1,5 Go de libre.
// need : place estimée pour toute la lecture (débit × durée restante)
export function sessionRoot(need = 0) {
  const fast = config.fastTranscodeDir;
  if (fast) {
    try {
      const st = fs.statfsSync(fast);
      if (st.bavail * st.bsize >= Math.max(1.5 * 1024 ** 3, need + 0.5 * 1024 ** 3)) { fs.mkdirSync(fast, { recursive: true }); return fast; }
    } catch { /* absent : disque */ }
  }
  return config.transcodeDir;
}
export function transcodePlace() {
  const fast = config.fastTranscodeDir;
  let ram = null;
  if (fast) { try { const st = fs.statfsSync(fast); ram = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { /* */ } }
  return { ram, using: sessionRoot() === fast ? 'ram' : 'disk' };
}

// ---------------------------------------------------------------- sessions HLS
export const sessions = new Map();
const MAX_AHEAD = 40;  // segments d'avance avant de mettre ffmpeg en pause (≈ 2 min 40)
const RESUME_AT = 18;

class HlsSession {
  constructor({ item, probe, decision, start, profileId, quality, live = false }) {
    this.live = live;
    this.input = live ? item.stream_url : item.path;
    this.id = crypto.randomBytes(18).toString('base64url');
    this.item = item; this.probe = probe; this.decision = decision; this.quality = quality;
    this.offset = Math.max(0, Math.floor(start || 0));
    this.profileId = profileId;
    // Place nécessaire : débit de sortie × durée restante (les directs : 30 min glissantes)
    const outRate = decision.copyVideo ? (probe.bitrate || 20e6) : targetBitrate(probe, targetSize(probe.video || { width: 1280, height: 720 }, decision.limitHeight).height, decision.limitBitrate) + 2e5;
    const secs = live ? 1800 : Math.max(60, (probe.duration || 7200) - this.offset);
    this.dir = path.join(sessionRoot((outRate / 8) * secs * 1.15), this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.lastAccess = Date.now();
    this.lastSeg = 0;
    this.paused = false;
    this.exited = false;
    this.failed = null;
    this.pipelineIdx = 0;
    this.log = '';
    this.fmp4 = decision.copyVideo && probe.video?.codec === 'hevc';
    this.buildPipelines();
  }

  buildPipelines() {
    const { probe, decision } = this;
    const audio = decision.audio;
    const audioArgs = [];
    if (!audio && this.live) {
      audioArgs.push('-map', '0:a:0?', '-c:a', 'aac', '-ac', '2', '-b:a', '160k');
    } else if (audio) {
      audioArgs.push('-map', `0:${audio.index}`);
      if (audio.codec === 'aac' && audio.channels <= 2) audioArgs.push('-c:a', 'copy');
      else audioArgs.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-af', 'aresample=async=1:first_pts=0');
    }
    if (decision.copyVideo) {
      this.pipelines = [{ name: 'copie', input: [], video: ['-map', '0:v:0', '-c:v', 'copy', ...(this.fmp4 ? ['-tag:v', 'hvc1'] : [])], audioArgs }];
    } else {
      const src = probe.video || { width: 1280, height: 720 };
      const { width, height } = targetSize(src, decision.limitHeight);
      const bitrate = targetBitrate(probe, height, decision.limitBitrate);
      this.pipelines = videoPipelines({ width, height, bitrate, src: probe.video || {}, burnIndex: decision.burnIndex })
        .map((p) => ({ ...p, audioArgs }));
      this.target = { width, height, bitrate };
      // Processeur seul (pas de carte, ou repli) en qualité automatique : on vise une définition qu'il tient en
      // temps réel (4K ou HDR à convertir au processeur : l'image finirait figée). Une qualité choisie à la main est respectée.
      if (this.quality === 'auto' || !this.quality) {
        const cores = os.cpus().length, hdr = !!src.hdr;
        const cap = hdr ? (cores >= 12 ? 1080 : cores >= 6 ? 720 : 480) : (cores >= 8 ? 1080 : cores >= 4 ? 720 : 480);
        if (height > cap) {
          const t = targetSize(src, cap), b = targetBitrate(probe, t.height, decision.limitBitrate);
          const cpu = videoPipelines({ width: t.width, height: t.height, bitrate: b, src: probe.video || {}, burnIndex: decision.burnIndex }).find((p) => p.name === 'cpu');
          this.pipelines = this.pipelines.map((p) => (p.name === 'cpu' && cpu ? { ...cpu, audioArgs, target: t } : p));
          if (this.pipelines[0] && this.pipelines[0].name === 'cpu') this.target = { ...t, bitrate: b };
        }
      }
    }
  }

  start() {
    const p = this.pipelines[this.pipelineIdx];
    this.pipelineName = p.name;
    if (p.target) this.target = { ...p.target, bitrate: this.target ? this.target.bitrate : 0 };
    const live = this.live;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...p.input,
      ...(live ? NET_INPUT(this.input) : []),
      ...(!live && this.offset + this.resumeOffset() > 0 ? ['-ss', String(this.offset + this.resumeOffset())] : []),
      '-fflags', live ? '+genpts+discardcorrupt' : '+genpts',
      // Direct : analyse courte (le codec est déjà connu grâce à l'analyse gardée en mémoire) = démarrage plus rapide
      '-analyzeduration', live ? (this.probe && this.probe.video ? '1500000' : '3M') : '20M', '-probesize', live ? (this.probe && this.probe.video ? '1500000' : '3M') : '20M',
      '-i', this.input,
      ...p.video, ...p.audioArgs,
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-max_muxing_queue_size', '2048', '-avoid_negative_ts', 'make_zero',
      // Direct : segments de 2 s (le premier d'1 s) pour que l'image arrive vite
      '-f', 'hls', '-hls_time', String(live ? 2 : config.segmentSeconds),
      ...(live
        ? ['-hls_init_time', '1', '-hls_list_size', '10', '-hls_flags', `delete_segments+temp_file+independent_segments+omit_endlist${this.restarts ? '+append_list+discont_start' : ''}`]
        : ['-hls_list_size', '0', '-hls_playlist_type', 'event', ...(this.resumedAt ? ['-start_number', String(this.resumedAt)] : []),
          '-hls_flags', `temp_file+independent_segments${this.resumedAt ? '+append_list+discont_start' : ''}`]),
      ...(this.fmp4 ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'] : ['-hls_segment_type', 'mpegts']),
      '-hls_segment_filename', path.join(this.dir, this.fmp4 ? 'seg%05d.m4s' : 'seg%05d.ts'),
      path.join(this.dir, 'index.m3u8'),
    ];
    this.startedAt = Date.now();
    this.proc = spawn(config.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr.on('data', (d) => { this.log = (this.log + d).slice(-4000); });
    this.proc.on('exit', (code, signal) => {
      if (this.killed) return;
      // Direct : la chaîne a coupé (fin de flux, coupure réseau) alors qu'elle marchait → ffmpeg repart tout
      // seul et la liste continue (même numérotation, discontinuité signalée) : l'image ne reste pas figée
      if (this.live && this.segmentCount() > 0 && (this.restarts || 0) < 30 && Date.now() - this.lastAccess < 60000) {
        if (Date.now() - this.startedAt > 300000) this.restarts = 0; // a bien tourné 5 min : compteur remis à zéro
        this.restarts = (this.restarts || 0) + 1;
        console.warn(`[direct] ${this.item.title} : flux coupé, reprise ${this.restarts}${this.log ? ` (${this.log.trim().split('\n').pop().slice(0, 160)})` : ''}`);
        this.log = '';
        return void setTimeout(() => { if (!this.killed) this.start(); }, Math.min(10000, 1000 * this.restarts));
      }
      if (code !== 0 || signal != null) {
        const produced = this.segmentCount();
        if (produced === 0 && this.pipelineIdx < this.pipelines.length - 1) {
          console.warn(`[transcodage] échec du mode "${p.name}", repli sur le suivant…\n${this.log.slice(-600)}`);
          this.pipelineIdx++;
          this.log = '';
          for (const f of fs.readdirSync(this.dir)) fs.rmSync(path.join(this.dir, f), { force: true });
          return this.start();
        }
        // ffmpeg a lâché en plein film (image abîmée, encodeur matériel qui décroche, piste qui change…) alors que
        // des segments existent déjà : on reprend juste après le dernier segment écrit, dans la même liste
        // (discontinuité signalée au lecteur), au besoin avec l'encodeur suivant. L'image ne reste pas figée.
        const noSpace = /No space left|ENOSPC/i.test(this.log);
        if (!this.live && !noSpace && produced > (this.resumedAt || 0) && (this.resumes || 0) < 4 && Date.now() - this.lastAccess < 120000) {
          this.resumes = (this.resumes || 0) + 1;
          const same = produced > (this.resumedAt || 0) + 2; // a bien avancé : on garde l'encodeur, sinon on passe au suivant
          if (!same && this.pipelineIdx < this.pipelines.length - 1) this.pipelineIdx++;
          console.warn(`[transcodage] ${this.item.title} : interruption au segment ${produced}, reprise ${this.resumes}${same ? '' : ` avec « ${this.pipelines[this.pipelineIdx].name} »`} (${this.log.trim().split('\n').pop().slice(0, 160)})`);
          this.resumedAt = produced;
          this.log = '';
          return this.start();
        }
        this.failed = noSpace ? 'Plus de place sur le disque de conversion' : this.log.slice(-800) || `ffmpeg code ${code}`;
        console.warn(`[transcodage] erreur : ${this.failed}`);
      }
      this.exited = true;
    });
  }

  // Reprise après une interruption : durée déjà écrite (somme des segments de la liste)
  resumeOffset() {
    if (!this.resumedAt) return 0;
    try {
      const txt = fs.readFileSync(path.join(this.dir, 'index.m3u8'), 'utf8');
      let t = 0; for (const m of txt.matchAll(/#EXTINF:([\d.]+)/g)) t += Number(m[1]);
      return t;
    } catch { return this.resumedAt * config.segmentSeconds; }
  }

  segmentCount() {
    try { return fs.readdirSync(this.dir).filter((f) => /^seg\d+\.(ts|m4s)$/.test(f)).length; } catch { return 0; }
  }

  touch(segIndex) {
    this.lastAccess = Date.now();
    if (segIndex != null) this.lastSeg = Math.max(segIndex, this.lastSeg);
  }

  // Vitesse de conversion par rapport au temps réel, et conseil de qualité si elle ne suit pas
  // (mesurée sur la conversion en cours, hors temps passé en pause volontaire quand on a de l'avance)
  pace() {
    if (this.live || this.decision.copyVideo || this.exited || !this.proc) return { speed: null, slow: false, suggest: null };
    const wall = (Date.now() - this.startedAt) / 1000 - (this.pausedFor || 0) / 1000;
    const made = Math.max(0, this.segmentCount() - (this.resumedAt || 0)) * config.segmentSeconds;
    const ahead = this.segmentCount() - this.lastSeg;
    if (wall < 20) return { speed: null, slow: false, suggest: null };
    const speed = Number((made / wall).toFixed(2));
    const slow = speed < 0.9 && ahead < 12;
    const h = this.target ? this.target.height : 0;
    const suggest = slow ? (h > 1080 ? '1080p' : h > 720 ? '720p' : h > 480 ? '480p' : h > 360 ? '360p' : null) : null;
    return { speed, slow, suggest, height: h };
  }

  // Évite de transcoder tout le film d'avance : économise CPU/GPU et disque
  throttle() {
    if (this.exited || !this.proc || this.decision.copyVideo || this.live) return;
    // Windows ne connaît pas SIGSTOP/SIGCONT (Node y tuerait ffmpeg) : pas de mise en pause là-bas
    if (process.platform === 'win32') return;
    const ahead = this.segmentCount() - this.lastSeg;
    try {
      if (!this.paused && ahead > MAX_AHEAD) { this.proc.kill('SIGSTOP'); this.paused = true; this.pausedAt = Date.now(); }
      else if (this.paused && ahead < RESUME_AT) { this.proc.kill('SIGCONT'); this.paused = false; this.pausedFor = (this.pausedFor || 0) + (Date.now() - (this.pausedAt || Date.now())); }
    } catch { /* processus terminé */ }
  }

  stop() {
    this.killed = true;
    try { if (this.paused && process.platform !== 'win32') this.proc.kill('SIGCONT'); this.proc.kill('SIGKILL'); } catch { /* déjà arrêté */ }
    setTimeout(() => fs.rmSync(this.dir, { recursive: true, force: true }), 500);
    sessions.delete(this.id);
  }

  info() {
    return {
      id: this.id, item: this.item.title, itemId: this.item.id, profileId: this.profileId, mode: this.decision.mode,
      pipeline: this.pipelineName, reason: this.decision.reason, paused: this.paused, offset: this.offset, resumes: this.resumes || 0,
      target: this.target || null, quality: this.quality, pace: this.pace(),
    };
  }
}

export function startSession(opts) {
  const max = Number(getSetting('max_sessions', 6));
  // Une seule session par profil et par média : on remplace l'ancienne
  for (const s of sessions.values()) {
    if (opts.replace && s.id === opts.replace) s.stop();
  }
  if (sessions.size >= max) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (oldest && Date.now() - oldest.lastAccess > 30000) oldest.stop();
    else throw new HttpError(503, 'Trop de lectures simultanées, réessayez dans un instant');
  }
  const s = new HlsSession(opts);
  sessions.set(s.id, s);
  s.start();
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.lastAccess > 120000) { s.stop(); continue; }
    s.throttle();
  }
}, 3000).unref();

export function stopAllSessions() { for (const s of sessions.values()) s.stop(); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function servePlaylist(res, sid) {
  const s = sessions.get(sid);
  if (!s) throw new HttpError(404, 'Session expirée');
  s.touch();
  const file = path.join(s.dir, 'index.m3u8');
  const deadline = Date.now() + 45000;
  // Démarrage dès le premier segment prêt
  while (Date.now() < deadline) {
    if (s.failed) throw new HttpError(502, s.live ? 'Cette chaîne ne répond pas pour le moment' : s.failed === 'Plus de place sur le disque de conversion' ? s.failed : 'La conversion de la vidéo a échoué');
    if (fs.existsSync(file) && (s.segmentCount() >= 1 || s.exited)) break;
    await wait(150);
  }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new HttpError(504, 'Préparation trop longue'); }
  // Démarrer au début (et non au "direct") tant que la conversion est en cours
  if (!s.live && !text.includes('#EXT-X-START')) text = text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(text);
}

export async function serveSegment(req, res, sid, name) {
  const s = sessions.get(sid);
  if (!s) throw new HttpError(404, 'Session expirée');
  if (!/^(seg\d{5}\.(ts|m4s)|init\.mp4)$/.test(name)) throw new HttpError(400, 'Segment invalide');
  const idx = name.startsWith('seg') ? parseInt(name.slice(3, 8), 10) : 0;
  s.touch(idx);
  const file = path.join(s.dir, name);
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(file)) {
    if (s.paused && process.platform !== 'win32') { try { s.proc.kill('SIGCONT'); s.paused = false; s.pausedFor = (s.pausedFor || 0) + (Date.now() - (s.pausedAt || Date.now())); } catch { /* */ } }
    if (s.exited || Date.now() > deadline) throw new HttpError(404, 'Segment indisponible');
    await wait(100);
  }
  const buf = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': name.endsWith('.ts') ? 'video/mp2t' : 'video/mp4',
    'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600', 'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

// ---------------------------------------------------------------- sous-titres -> WebVTT
const subsCache = path.join(config.dataDir, 'cache', 'subs');
fs.mkdirSync(subsCache, { recursive: true });
const inflight = new Map();

function isUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

export function subtitleVtt(item, probe, subId) {
  const sub = probe.subs.find((s) => s.id === subId);
  if (!sub) throw new HttpError(404, 'Sous-titre introuvable');
  if (!sub.text) throw new HttpError(415, 'Sous-titre image : incrustation nécessaire');
  const out = path.join(subsCache, `${item.id}_${subId}_${item.mtime}.vtt`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (inflight.has(out)) return inflight.get(out);
  const p = new Promise((resolve, reject) => {
    let args;
    if (sub.external) {
      const charenc = isUtf8(fs.readFileSync(sub.path)) ? [] : ['-sub_charenc', 'CP1252'];
      args = ['-hide_banner', '-loglevel', 'error', ...charenc, '-i', sub.path, '-f', 'webvtt', '-y', out + '.tmp'];
    } else {
      args = ['-hide_banner', '-loglevel', 'error', '-i', item.path, '-map', `0:${sub.index}`, '-f', 'webvtt', '-y', out + '.tmp'];
    }
    execFile(config.ffmpeg, args, { timeout: 300000 }, (err, _o, stderr) => {
      inflight.delete(out);
      if (err) return reject(new HttpError(500, `Conversion des sous-titres impossible : ${String(stderr).slice(0, 200)}`));
      fs.renameSync(out + '.tmp', out);
      resolve(out);
    });
  });
  inflight.set(out, p);
  return p;
}

// ---------------------------------------------------------------- vignettes d'épisodes
const thumbs = path.join(config.dataDir, 'images');
let thumbBusy = 0;
const thumbQueue = [];
// big : image en 1280 px (fond de la fiche et de l'accueil quand il n'y a pas d'image de fond officielle)
export function thumbnail(item, duration, { big = false } = {}) {
  const name = `th${big ? 'b' : ''}_${item.id}_${item.mtime}.jpg`;
  const out = path.join(thumbs, name);
  if (fs.existsSync(out)) return Promise.resolve(out);
  return new Promise((resolve, reject) => {
    const job = () => {
      thumbBusy++;
      const at = Math.max(1, Math.floor((duration || 600) * 0.2));
      // Grande image : au lieu de l'image pile à 20 %, ffmpeg choisit la plus représentative (ni noire, ni floue
      // de mouvement) parmi 2 s de vidéo (filtre thumbnail), pour un fond net et parlant
      const vf = big ? `thumbnail=50,scale=1280:-2` : 'scale=480:-2';
      execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), ...(big ? ['-t', '2.5'] : []), '-i', item.path, '-frames:v', '1',
        '-vf', vf, '-q:v', big ? '2' : '5', '-y', out], { timeout: 60000 }, (err) => {
        thumbBusy--;
        const next = thumbQueue.shift(); if (next) next();
        if (err || !fs.existsSync(out)) reject(new HttpError(404, 'Vignette indisponible')); else resolve(out);
      });
    };
    if (thumbBusy < 2) job(); else thumbQueue.push(job);
  });
}

// ---------------------------------------------------------------- aperçu vidéo au survol (12 s, 360p, sans son)
// Petit MP4 H.264 lisible partout, fabriqué une seule fois puis gardé en cache.
const previews = path.join(config.dataDir, 'cache', 'previews');
fs.mkdirSync(previews, { recursive: true });
const previewInflight = new Map();
let previewBusy = 0;
const previewQueue = [];
// hd : version pour le grand bandeau de l'accueil (jusqu'en 1080p, 20 s, bonne qualité dès la première image)
export function previewClip(item, { hd = false } = {}) {
  const out = path.join(previews, `pv${hd ? 'hd' : ''}_${item.id}_${item.mtime || 0}.mp4`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (previewInflight.has(out)) return previewInflight.get(out);
  const p = new Promise((resolve, reject) => {
    const job = () => {
      previewBusy++;
      const dur = item.duration || 600;
      const at = Math.max(0, Math.floor(dur * (item.type === 'clip' ? 0.3 : 0.22)));
      const tmp = `${out}.part.mp4`;
      const vf = hd ? "scale=-2:'min(1080,ih)':flags=lanczos,fps=24,format=yuv420p" : 'scale=-2:360:flags=fast_bilinear,fps=24,format=yuv420p';
      execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', item.path, '-t', hd ? '20' : '12', '-an', '-sn', '-dn',
        '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', hd ? '20' : '30', ...(hd ? ['-maxrate', '8M', '-bufsize', '16M'] : []),
        '-movflags', '+faststart', '-y', tmp], { timeout: hd ? 240000 : 90000 }, (err) => {
        previewBusy--;
        const next = previewQueue.shift(); if (next) next();
        previewInflight.delete(out);
        try { if (!err) fs.renameSync(tmp, out); else fs.rmSync(tmp, { force: true }); } catch { /* */ }
        if (err || !fs.existsSync(out)) reject(new HttpError(404, 'Aperçu indisponible')); else resolve(out);
      });
    };
    if (previewBusy < 2) job(); else if (previewQueue.length < 6) previewQueue.push(job); else reject(new HttpError(503, 'Occupé'));
  });
  previewInflight.set(out, p);
  return p;
}

// ---------------------------------------------------------------- aperçus des chaînes TV (image actuelle, cache 2 min)
const liveShots = path.join(config.dataDir, 'cache', 'live');
fs.mkdirSync(liveShots, { recursive: true });
const shotInflight = new Map();
let shotBusy = 0;
const shotQueue = [];
// maxWait : la page n'attend pas plus longtemps la première capture (null = pas encore prête). Une image qui
// attendrait 15 s occuperait une des 6 connexions du navigateur vers Venus : à plusieurs, elles bloquaient la page.
export function channelSnapshot(item, { wait = false, maxWait = 0, urgent = false } = {}) {
  const out = path.join(liveShots, `ch_${item.id}.jpg`);
  // Une capture existe : elle part tout de suite (même ancienne) ; on la rafraîchit en arrière-plan si elle a plus de 3 min
  let age = Infinity; try { age = Date.now() - fs.statSync(out).mtimeMs; } catch { /* pas encore de capture */ }
  if (age < 180000) return Promise.resolve(out);
  if (age < Infinity && !wait) { if (!shotInflight.has(out)) captureShot(item, out).catch(() => {}); return Promise.resolve(out); }
  const p = captureShot(item, out, urgent);
  if (!maxWait) return p;
  p.catch(() => {});
  return Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), maxWait))]);
}
const SHOT_QUEUE_MAX = 40;
function captureShot(item, out, urgent = false) {
  if (shotInflight.has(out)) return shotInflight.get(out);
  // File pleine : on ne garde que les demandes de la page (les préparations d'avance attendront la prochaine fois)
  if (shotBusy >= 4 && shotQueue.length >= SHOT_QUEUE_MAX && !urgent) return Promise.reject(new HttpError(503, 'Occupé'));
  const p = new Promise((resolve, reject) => {
    const job = () => {
      shotBusy++;
      execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...NET_INPUT(item.stream_url).filter((x, i, a) => !/reconnect/.test(x) && !/reconnect/.test(a[i - 1] || '')),
        '-analyzeduration', '3M', '-probesize', '3M', '-i', item.stream_url, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '6', '-y', out + '.tmp.jpg'],
      { timeout: 15000 }, (err) => {
        shotBusy--; shotInflight.delete(out);
        const next = shotQueue.shift(); if (next) next();
        if (err || !fs.existsSync(out + '.tmp.jpg')) {
          try { fs.statSync(out); return resolve(out); } catch { return reject(new HttpError(404, 'Aperçu indisponible')); } // ancienne capture
        }
        fs.renameSync(out + '.tmp.jpg', out);
        resolve(out);
      });
    };
    // Retirée de la file (trop de demandes) : la promesse échoue et la chaîne pourra être redemandée
    job.drop = () => { shotInflight.delete(out); reject(new HttpError(503, 'Occupé')); };
    if (shotBusy < 4) job();
    else if (urgent) { shotQueue.unshift(job); if (shotQueue.length > SHOT_QUEUE_MAX) shotQueue.pop().drop(); }
    else shotQueue.push(job);
  });
  shotInflight.set(out, p);
  return p;
}
// Page TV ouverte : on prépare les captures de toutes les chaînes d'avance (au plus une fois toutes les 3 min)
let warmAt = 0;
export function warmSnapshots(items) {
  if (Date.now() - warmAt < 180000) return; warmAt = Date.now();
  // Les 40 premières seulement : avec des centaines de chaînes, ffmpeg tournerait sans arrêt et ralentirait la chaîne regardée
  for (const it of items.filter((i) => i.stream_url).slice(0, SHOT_QUEUE_MAX)) channelSnapshot(it, { wait: true }).catch(() => {});
}

export { hw };
