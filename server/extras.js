// Petites fonctions ajoutées ensemble :
//  - avis perso (« j'ai aimé » / « bof ») à la fin d'un film, qui nourrit les suggestions
//  - historique de la taille des médiathèques et prévision « disque plein dans N mois »
//  - journal des conversions (transcodage) par appareil et par cause, pour les éviter
//  - extrait de 10 s (GIF ou MP4) à partager
//  - sous-titres externes décalés (durée très différente de la vidéo)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { db, all, get, run } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS opinions (profile_id INTEGER, item_id INTEGER, liked INTEGER, at INTEGER, PRIMARY KEY(profile_id, item_id));
CREATE TABLE IF NOT EXISTS size_history (day TEXT PRIMARY KEY, bytes INTEGER, free INTEGER);
CREATE TABLE IF NOT EXISTS transcode_log (id INTEGER PRIMARY KEY, at INTEGER, device TEXT, reason TEXT, item_id INTEGER, codec TEXT, container TEXT);`);

// ------------------------------------------------------------------ avis
export function setOpinion(profileId, itemId, liked) {
  if (liked == null) run('DELETE FROM opinions WHERE profile_id = ? AND item_id = ?', profileId, itemId);
  else run('INSERT INTO opinions(profile_id, item_id, liked, at) VALUES(?, ?, ?, ?) ON CONFLICT(profile_id, item_id) DO UPDATE SET liked = excluded.liked, at = excluded.at', profileId, itemId, liked ? 1 : -1, Date.now());
}
export const opinionOf = (profileId, itemId) => { const r = get('SELECT liked FROM opinions WHERE profile_id = ? AND item_id = ?', profileId, itemId); return r ? r.liked : null; };
// Genres aimés / boudés par un profil : { Comédie: 2, Horreur: -1 }
export function genreTaste(profileId) {
  const taste = {};
  for (const r of all('SELECT o.liked, i.genres FROM opinions o JOIN items i ON i.id = o.item_id WHERE o.profile_id = ?', profileId)) {
    let g = []; try { g = JSON.parse(r.genres || '[]'); } catch { /* */ }
    for (const name of g) taste[name] = (taste[name] || 0) + r.liked;
  }
  return taste;
}
export const tasteScore = (taste, genres) => (genres || []).reduce((n, g) => n + (taste[g] || 0), 0);

// ------------------------------------------------------------------ stockage : relevé quotidien et prévision
export function recordSize() {
  const bytes = Number((get("SELECT SUM(size) s FROM items WHERE type IN ('movie','episode','clip','track','book','audiobook','photo')") || {}).s || 0);
  let free = null; try { const st = fs.statfsSync(config.dataDir); free = st.bavail * st.bsize; } catch { /* */ }
  run('INSERT INTO size_history(day, bytes, free) VALUES(?, ?, ?) ON CONFLICT(day) DO UPDATE SET bytes = excluded.bytes, free = excluded.free', new Date().toISOString().slice(0, 10), bytes, free);
}
// Croissance moyenne par jour sur 60 jours (régression linéaire) → jours avant disque plein
export function storageForecast() {
  const rows = all('SELECT * FROM size_history ORDER BY day DESC LIMIT 60').reverse();
  if (rows.length < 3) return { days: rows.length, perDay: null, fullIn: null };
  const xs = rows.map((r) => new Date(r.day).getTime() / 864e5), ys = rows.map((r) => r.bytes);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
  const last = rows[rows.length - 1];
  const fullIn = slope > 1e6 && last.free ? Math.round(last.free / slope) : null;
  return { days: n, perDay: Math.max(0, slope), perMonth: Math.max(0, slope) * 30, fullIn, free: last.free, bytes: last.bytes };
}

// ------------------------------------------------------------------ conversions évitables
export function logTranscode({ device, reason, itemId, codec, container }) {
  run('INSERT INTO transcode_log(at, device, reason, item_id, codec, container) VALUES(?, ?, ?, ?, ?, ?)', Date.now(), String(device || '').slice(0, 80), String(reason || '').slice(0, 120), itemId || null, codec || null, container || null);
  run('DELETE FROM transcode_log WHERE at < ?', Date.now() - 90 * 864e5);
}
export function transcodeSummary() {
  const since = Date.now() - 30 * 864e5;
  const byDevice = all('SELECT device, COUNT(*) n FROM transcode_log WHERE at > ? GROUP BY device ORDER BY n DESC LIMIT 8', since);
  const byReason = all('SELECT reason, codec, container, COUNT(*) n FROM transcode_log WHERE at > ? GROUP BY reason, codec, container ORDER BY n DESC LIMIT 8', since);
  const files = all('SELECT i.id, i.title, i.path, t.codec, t.container, COUNT(*) n FROM transcode_log t JOIN items i ON i.id = t.item_id WHERE t.at > ? GROUP BY i.id ORDER BY n DESC LIMIT 10', since);
  const advice = [];
  for (const r of byReason) {
    const hevc = /hevc|h\.?265/i.test(`${r.reason} ${r.codec}`), av1 = /av1/i.test(`${r.reason} ${r.codec}`), cont = /conteneur|avi|wmv|mkv/i.test(`${r.reason} ${r.container}`), audio = /audio|dts|truehd|ac3/i.test(r.reason);
    if (hevc || av1) advice.push({ reason: r.reason, n: r.n, tip: `Cet appareil ne lit pas le ${av1 ? 'AV1' : 'HEVC'}. Réencoder une fois en H.264 évite la conversion à chaque lecture.`, cmd: 'ffmpeg -i "FILM.mkv" -map 0 -c:v libx264 -crf 20 -preset slow -c:a copy -c:s copy "FILM.h264.mkv"' });
    else if (audio) advice.push({ reason: r.reason, n: r.n, tip: 'Le son n’est pas lu tel quel (DTS, TrueHD…). Ajouter une piste AAC garde la qualité et évite la conversion.', cmd: 'ffmpeg -i "FILM.mkv" -map 0 -c copy -map 0:a:0 -c:a:1 aac -b:a:1 256k "FILM.aac.mkv"' });
    else if (cont) advice.push({ reason: r.reason, n: r.n, tip: 'Le conteneur n’est pas lu par cet appareil : un simple remballage en MP4 suffit (sans réencoder).', cmd: 'ffmpeg -i "FILM.avi" -c copy -movflags +faststart "FILM.mp4"' });
  }
  return { byDevice, byReason, files, advice: advice.slice(0, 4) };
}

// ------------------------------------------------------------------ extrait à partager (10 s au plus, 480p)
export function makeClip(file, { start = 0, duration = 8, format = 'mp4' } = {}) {
  const dur = Math.min(15, Math.max(2, Number(duration) || 8));
  const st = Math.max(0, Number(start) || 0);
  const out = path.join(config.transcodeDir, `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format === 'gif' ? 'gif' : 'mp4'}`);
  const args = format === 'gif'
    ? ['-ss', String(st), '-t', String(dur), '-i', file, '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer', '-loop', '0', '-y', out]
    : ['-ss', String(st), '-t', String(dur), '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-y', out];
  return new Promise((resolve, reject) => {
    execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 120000 }, (err, _o, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'ffmpeg a échoué'));
      resolve(out);
    });
  });
}

// ------------------------------------------------------------------ sous-titres externes décalés
// Dernier horodatage d'un .srt / .vtt (lu par la fin) comparé à la durée de la vidéo
export function subtitleDrift(subPath, videoSeconds) {
  try {
    const st = fs.statSync(subPath);
    const fd = fs.openSync(subPath, 'r');
    const len = Math.min(st.size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    const txt = buf.toString('utf8');
    let last = 0;
    for (const m of txt.matchAll(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g)) last = Math.max(last, Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    if (!last || !videoSeconds) return null;
    const ratio = last / videoSeconds;
    if (ratio > 1.08 || ratio < 0.8) return { last, ratio };
    return null;
  } catch { return null; }
}
