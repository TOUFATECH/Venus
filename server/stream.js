// Moteur de lecture : lecture directe (0 % CPU), remux HLS (copie vidéo), ou transcodage HLS matériel.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
    this.dir = path.join(config.transcodeDir, this.id);
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
      const { width, height } = targetSize(probe.video || { width: 1280, height: 720 }, decision.limitHeight);
      const bitrate = targetBitrate(probe, height, decision.limitBitrate);
      this.pipelines = videoPipelines({ width, height, bitrate, src: probe.video || {}, burnIndex: decision.burnIndex })
        .map((p) => ({ ...p, audioArgs }));
      this.target = { width, height, bitrate };
    }
  }

  start() {
    const p = this.pipelines[this.pipelineIdx];
    this.pipelineName = p.name;
    const live = this.live;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...p.input,
      ...(live ? NET_INPUT(this.input) : []),
      ...(!live && this.offset > 0 ? ['-ss', String(this.offset)] : []),
      '-fflags', live ? '+genpts+discardcorrupt' : '+genpts',
      '-analyzeduration', live ? '4M' : '20M', '-probesize', live ? '4M' : '20M',
      '-i', this.input,
      ...p.video, ...p.audioArgs,
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-max_muxing_queue_size', '2048', '-avoid_negative_ts', 'make_zero',
      '-f', 'hls', '-hls_time', String(config.segmentSeconds),
      ...(live
        ? ['-hls_list_size', '8', '-hls_flags', 'delete_segments+temp_file+independent_segments+omit_endlist']
        : ['-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'temp_file+independent_segments']),
      ...(this.fmp4 ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'] : ['-hls_segment_type', 'mpegts']),
      '-hls_segment_filename', path.join(this.dir, this.fmp4 ? 'seg%05d.m4s' : 'seg%05d.ts'),
      path.join(this.dir, 'index.m3u8'),
    ];
    this.startedAt = Date.now();
    this.proc = spawn(config.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr.on('data', (d) => { this.log = (this.log + d).slice(-4000); });
    this.proc.on('exit', (code, signal) => {
      if (this.killed) return;
      if (code !== 0 && signal == null) {
        const produced = this.segmentCount();
        if (produced === 0 && this.pipelineIdx < this.pipelines.length - 1) {
          console.warn(`[transcodage] échec du mode "${p.name}", repli sur le suivant…\n${this.log.slice(-600)}`);
          this.pipelineIdx++;
          this.log = '';
          for (const f of fs.readdirSync(this.dir)) fs.rmSync(path.join(this.dir, f), { force: true });
          return this.start();
        }
        this.failed = this.log.slice(-800) || `ffmpeg code ${code}`;
        console.warn(`[transcodage] erreur : ${this.failed}`);
      }
      this.exited = true;
    });
  }

  segmentCount() {
    try { return fs.readdirSync(this.dir).filter((f) => /^seg\d+\.(ts|m4s)$/.test(f)).length; } catch { return 0; }
  }

  touch(segIndex) {
    this.lastAccess = Date.now();
    if (segIndex != null) this.lastSeg = Math.max(segIndex, this.lastSeg);
  }

  // Évite de transcoder tout le film d'avance : économise CPU/GPU et disque
  throttle() {
    if (this.exited || !this.proc || this.decision.copyVideo || this.live) return;
    // Windows ne connaît pas SIGSTOP/SIGCONT (Node y tuerait ffmpeg) : pas de mise en pause là-bas
    if (process.platform === 'win32') return;
    const ahead = this.segmentCount() - this.lastSeg;
    try {
      if (!this.paused && ahead > MAX_AHEAD) { this.proc.kill('SIGSTOP'); this.paused = true; }
      else if (this.paused && ahead < RESUME_AT) { this.proc.kill('SIGCONT'); this.paused = false; }
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
      pipeline: this.pipelineName, reason: this.decision.reason, paused: this.paused, offset: this.offset,
      target: this.target || null, quality: this.quality,
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
    if (s.failed) throw new HttpError(502, s.live ? 'Cette chaîne ne répond pas pour le moment' : 'La conversion de la vidéo a échoué');
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
    if (s.paused && process.platform !== 'win32') { try { s.proc.kill('SIGCONT'); s.paused = false; } catch { /* */ } }
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
export function thumbnail(item, duration) {
  const name = `th_${item.id}_${item.mtime}.jpg`;
  const out = path.join(thumbs, name);
  if (fs.existsSync(out)) return Promise.resolve(out);
  return new Promise((resolve, reject) => {
    const job = () => {
      thumbBusy++;
      const at = Math.max(1, Math.floor((duration || 600) * 0.2));
      execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', item.path, '-frames:v', '1',
        '-vf', 'scale=480:-2', '-q:v', '5', '-y', out], { timeout: 60000 }, (err) => {
        thumbBusy--;
        const next = thumbQueue.shift(); if (next) next();
        if (err || !fs.existsSync(out)) reject(new HttpError(404, 'Vignette indisponible')); else resolve(out);
      });
    };
    if (thumbBusy < 2) job(); else thumbQueue.push(job);
  });
}

// ---------------------------------------------------------------- aperçus des chaînes TV (image actuelle, cache 2 min)
const liveShots = path.join(config.dataDir, 'cache', 'live');
fs.mkdirSync(liveShots, { recursive: true });
const shotInflight = new Map();
let shotBusy = 0;
const shotQueue = [];
export function channelSnapshot(item) {
  const out = path.join(liveShots, `ch_${item.id}.jpg`);
  try { if (Date.now() - fs.statSync(out).mtimeMs < 120000) return Promise.resolve(out); } catch { /* pas encore de capture */ }
  if (shotInflight.has(out)) return shotInflight.get(out);
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
    if (shotBusy < 3) job(); else shotQueue.push(job);
  });
  shotInflight.set(out, p);
  return p;
}

export { hw };
