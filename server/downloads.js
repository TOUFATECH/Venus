// Téléchargements pour regarder sans réseau : le fichier d'origine, ou une version légère (720p / 480p)
// préparée en arrière-plan (H.264 + AAC stéréo, MP4 lisible partout : téléphone, tablette, VLC).
// Les versions légères sont gardées 7 jours puis effacées.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { get } from './db.js';

export const dlDir = path.join(config.dataDir, 'cache', 'downloads');
fs.mkdirSync(dlDir, { recursive: true });
const QUAL = { '720p': { h: 720, crf: 23, ab: '128k' }, '480p': { h: 480, crf: 25, ab: '96k' } };
const jobs = new Map(); // id -> job
const queue = [];
let running = null;

const safeName = (s) => String(s || 'video').normalize('NFC').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
export function niceName(item) {
  if (item.type === 'episode') {
    const show = get('SELECT title FROM items WHERE id = ?', item.show_id);
    return safeName(`${show ? show.title : ''} S${String(item.season_num).padStart(2, '0')}E${String(item.episode_num).padStart(2, '0')} ${item.title || ''}`);
  }
  return safeName(`${item.title}${item.year ? ` (${item.year})` : ''}`);
}

function publicJob(j) {
  let size = null;
  try { if (j.state === 'ready') size = fs.statSync(j.file).size; } catch { /* */ }
  return { id: j.id, itemId: j.itemId, title: j.title, poster: j.poster, quality: j.quality, state: j.state, progress: Math.round(j.progress), error: j.error, size, at: j.at, name: j.name };
}
export const listJobs = (profileId) => [...jobs.values()].filter((j) => j.profileId === profileId).sort((a, b) => b.at - a.at).map(publicJob);
export const getJob = (id) => jobs.get(id) || null;

export function prepare(item, quality, profileId) {
  const q = QUAL[quality] ? quality : '720p';
  const existing = [...jobs.values()].find((j) => j.itemId === item.id && j.quality === q && j.state !== 'error');
  if (existing) { existing.profileId = existing.profileId || profileId; return publicJob(existing); }
  const id = crypto.randomBytes(6).toString('hex');
  const show = item.show_id ? get('SELECT poster FROM items WHERE id = ?', item.show_id) : null;
  const file = path.join(dlDir, `${item.id}-${q}-${Math.floor(item.mtime || 0)}.mp4`);
  const j = { id, itemId: item.id, path: item.path, duration: item.duration || 0, title: niceName(item), name: `${niceName(item)} [${q}].mp4`, poster: item.poster || (show && show.poster),
    quality: q, file, state: fs.existsSync(file) ? 'ready' : 'queued', progress: fs.existsSync(file) ? 100 : 0, error: null, at: Date.now(), profileId };
  jobs.set(id, j);
  if (j.state === 'queued') { queue.push(j); pump(); }
  return publicJob(j);
}

function pump() {
  if (running || !queue.length) return;
  const j = queue.shift();
  if (j.state === 'cancelled') return pump();
  running = j;
  j.state = 'working';
  const q = QUAL[j.quality];
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', j.path,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    '-vf', `scale=-2:'min(${q.h},ih)',format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q.crf), '-profile:v', 'high', '-level', '4.1',
    '-c:a', 'aac', '-ac', '2', '-b:a', q.ab, '-movflags', '+faststart', '-y', `${j.file}.part.mp4`];
  const p = spawn(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  j.proc = p;
  let err = '';
  p.stdout.on('data', (b) => {
    const m = /out_time_(?:us|ms)=(\d+)/.exec(String(b));
    if (m && j.duration) j.progress = Math.min(99, (Number(m[1]) / 1e6 / j.duration) * 100);
  });
  p.stderr.on('data', (b) => { err += b; if (err.length > 2000) err = err.slice(-2000); });
  p.on('close', (code) => {
    running = null;
    if (j.state === 'cancelled') { try { fs.unlinkSync(`${j.file}.part.mp4`); } catch { /* */ } }
    else if (code === 0) { fs.renameSync(`${j.file}.part.mp4`, j.file); j.state = 'ready'; j.progress = 100; }
    else { j.state = 'error'; j.error = err.trim().split('\n').pop() || `ffmpeg ${code}`; try { fs.unlinkSync(`${j.file}.part.mp4`); } catch { /* */ } }
    pump();
  });
}

export function cancelJob(id) {
  const j = jobs.get(id);
  if (!j) return;
  if (j.state === 'working' && j.proc) { j.state = 'cancelled'; j.proc.kill('SIGKILL'); }
  else j.state = 'cancelled';
  jobs.delete(id);
}

// Ménage : versions légères de plus de 7 jours
setInterval(() => {
  let files = [];
  try { files = fs.readdirSync(dlDir); } catch { return; }
  for (const f of files) {
    const fp = path.join(dlDir, f);
    try { if (Date.now() - fs.statSync(fp).mtimeMs > 7 * 86400000 && ![...jobs.values()].some((j) => j.file === fp && j.state === 'working')) fs.unlinkSync(fp); } catch { /* */ }
  }
  for (const [id, j] of jobs) if (j.state === 'ready' && !fs.existsSync(j.file)) jobs.delete(id);
}, 6 * 3600000).unref();
