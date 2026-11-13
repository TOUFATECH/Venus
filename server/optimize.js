// Versions optimisées : pour les vidéos qui doivent être converties à chaque lecture (HEVC, 10 bits, son DTS / AC3…),
// Venus prépare à l'avance une copie H.264 + AAC (1080p au plus) que tous les navigateurs et l'iPhone lisent tels
// quels. La lecture démarre alors tout de suite, sans conversion et sans faire chauffer le serveur.
//
// Activé tout seul (mode « auto ») quand :
//  - il y a de la place : au moins 50 Go et 15 % libres sur le disque des données, et les copies ne prennent
//    jamais plus de 25 % de la place libre (200 Go au plus) ;
//  - et le matériel le permet : avec une carte graphique, dès que personne ne regarde rien ; sans carte graphique,
//    seulement la nuit (1 h → 7 h) et quand personne ne regarde rien.
// Une copie en cours s'arrête dès qu'une lecture commence (elle reprendra plus tard).
// Les copies inutiles (vidéo supprimée, plus regardée depuis 60 jours) sont effacées ; les plus anciennes aussi
// quand la place vient à manquer.
import fs from 'node:fs';
import path from 'node:path';
import { db, all, get, run, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { hw, videoPipelines } from './hw.js';
import { probeFile } from './probe.js';
import { sessions } from './stream.js';
import { logActivity } from './activity.js';
import { spawnLow } from './nice.js';

export const OPT_DIR = path.join(config.dataDir, 'optimized');
fs.mkdirSync(OPT_DIR, { recursive: true });
db.exec(`CREATE TABLE IF NOT EXISTS optimized (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  path TEXT NOT NULL, mtime INTEGER, size INTEGER, probe TEXT, created_at INTEGER, used_at INTEGER
)`);

const GB = 1024 ** 3;
export const optMode = () => getSetting('optimize_mode', 'auto'); // auto | on | off
// Lecture JSON tolérante (null si invalide)
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
// Place occupée par les copies optimisées
const dirSize = () => (all('SELECT COALESCE(SUM(size), 0) AS n FROM optimized')[0] || { n: 0 }).n;
// Espace total et libre du disque des données
function disk() { try { const st = fs.statfsSync(config.dataDir); return { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { return null; } }

// Une vidéo mérite une copie si la plupart des appareils doivent la convertir
const WEB_AUDIO = new Set(['aac', 'mp3', 'opus']);
// Cette vidéo doit-elle être convertie sur la plupart des appareils (et mérite une copie) ?
export function needsOptimizing(probe) {
  const v = probe && probe.video;
  if (!v || v.dovi) return false;
  if (v.hdr && !hw.filters.has('tonemap') && !hw.filters.has('tonemap_cuda') && !hw.filters.has('tonemap_vaapi')) return false;
  const a = probe.audio[0];
  return v.codec !== 'h264' || v.bitDepth > 8 || !!v.hdr || !!(a && !WEB_AUDIO.has(a.codec));
}

// Copie disponible pour une vidéo (et toujours à jour)
export function optimizedFor(item) {
  const o = get('SELECT * FROM optimized WHERE item_id = ?', item.id);
  if (!o) return null;
  if (o.mtime !== (item.mtime || 0) || !fs.existsSync(o.path)) { drop(item.id); return null; }
  return { path: o.path, probe: parse(o.probe) };
}
// Note la dernière utilisation d'une copie optimisée
export const markUsed = (itemId) => run('UPDATE optimized SET used_at = ? WHERE item_id = ?', Date.now(), itemId);
// Supprime la copie optimisée d'une vidéo
function drop(itemId) {
  const o = get('SELECT path FROM optimized WHERE item_id = ?', itemId);
  if (o) { try { fs.rmSync(o.path, { force: true }); } catch { /* */ } }
  run('DELETE FROM optimized WHERE item_id = ?', itemId);
}

// ------------------------------------------------------------------ conditions
export function optStatus() {
  const d = disk();
  const used = dirSize();
  const budget = d ? Math.min(200 * GB, Math.max(0, (d.free + used) * 0.25)) : 0;
  const roomy = !!d && d.free >= 50 * GB && d.free / d.total >= 0.15;
  const hour = new Date().getHours();
  const gpu = hw.type !== 'none';
  const night = hour >= 1 && hour < 7;
  const busy = sessions.size > 0;
  const mode = optMode();
  let state, why;
  if (mode === 'off') { state = 'off'; why = 'Désactivé dans les réglages'; }
  else if (mode === 'auto' && !roomy) { state = 'waiting'; why = `Pas assez de place (il faut 50 Go et 15 % libres${d ? ` ; ${Math.round(d.free / GB)} Go libres` : ''})`; }
  else if (used >= budget && mode === 'auto') { state = 'waiting'; why = 'Place réservée aux copies atteinte'; }
  else if (mode === 'auto' && !gpu && !night) { state = 'waiting'; why = 'Sans carte graphique : seulement la nuit (1 h → 7 h)'; }
  else if (busy) { state = 'waiting'; why = 'Une lecture est en cours'; }
  else { state = 'ready'; why = gpu ? `Avec ${hw.label}` : night ? 'Avec le processeur (la nuit)' : 'Avec le processeur'; }
  return { mode, state, why, gpu: gpu ? hw.label : null, used, budget, count: all('SELECT COUNT(*) n FROM optimized')[0].n, free: d ? d.free : null, current: current ? { title: current.title, pct: current.pct } : null, queue: queueLen };
}

// ------------------------------------------------------------------ file d'attente
let current = null, queueLen = 0;
// Vidéos à optimiser en priorité (les plus regardées récemment)
function candidates() {
  const since = Date.now() - 30 * 864e5;
  const ids = [];
  // 1. Les vidéos qui ont été converties récemment (les plus souvent d'abord)
  for (const r of all('SELECT item_id, COUNT(*) n FROM transcode_log WHERE at > ? AND item_id IS NOT NULL GROUP BY item_id ORDER BY n DESC LIMIT 60', since)) ids.push(r.item_id);
  // 2. Films en cours, et les deux épisodes suivants des séries en cours
  for (const r of all(`SELECT p.item_id, i.type, i.parent_id, i.show_id, i.season_num, i.episode_num FROM progress p JOIN items i ON i.id = p.item_id
      WHERE p.watched = 0 AND p.updated_at > ? ORDER BY p.updated_at DESC LIMIT 40`, since)) {
    ids.push(r.item_id);
    if (r.type === 'episode') {
      for (const n of all(`SELECT id FROM items WHERE type = 'episode' AND show_id = ? AND (season_num > ? OR (season_num = ? AND episode_num > ?)) ORDER BY season_num, episode_num LIMIT 2`, r.show_id, r.season_num, r.season_num, r.episode_num)) ids.push(n.id);
    }
  }
  for (const r of all(`SELECT p.item_id, i.show_id, i.season_num, i.episode_num FROM progress p JOIN items i ON i.id = p.item_id
      WHERE p.watched = 1 AND i.type = 'episode' AND p.updated_at > ? ORDER BY p.updated_at DESC LIMIT 20`, since)) {
    for (const n of all(`SELECT id FROM items WHERE type = 'episode' AND show_id = ? AND (season_num > ? OR (season_num = ? AND episode_num > ?)) ORDER BY season_num, episode_num LIMIT 2`, r.show_id, r.season_num, r.season_num, r.episode_num)) ids.push(n.id);
  }
  const seen = new Set(), out = [];
  for (const id of ids) {
    if (seen.has(id)) continue; seen.add(id);
    const it = get("SELECT id, title, path, mtime, probe, type FROM items WHERE id = ? AND type IN ('movie','episode') AND path IS NOT NULL", id);
    if (!it || get('SELECT 1 FROM optimized WHERE item_id = ? AND mtime = ?', id, it.mtime || 0)) continue;
    if (getSetting(`opt_fail:${id}`, 0) > 2) continue; // trois échecs : on n'insiste pas
    if (!needsOptimizing(parse(it.probe))) continue;
    out.push(it);
  }
  return out;
}

// Lance ffmpeg pour préparer une copie optimisée
function encode(item, probe) {
  return new Promise((resolve, reject) => {
    const v = probe.video;
    const height = Math.min(1080, v.height);
    const width = Math.max(2, Math.round((v.width * height) / v.height / 2) * 2);
    const bitrate = Math.min(height >= 1000 ? 7e6 : 4e6, (v.bitrate || probe.bitrate || 8e6) * 1.1);
    const pipelines = videoPipelines({ width, height, bitrate, src: v });
    // Avec carte graphique : on essaie la carte d'abord ; le processeur seulement la nuit (ou si forcé)
    const allowed = pipelines.filter((p) => p.name !== 'cpu' || hw.type === 'none' || optMode() === 'on' || (new Date().getHours() >= 1 && new Date().getHours() < 7));
    const out = path.join(OPT_DIR, `${item.id}_${item.mtime || 0}.mp4`);
    const tmp = `${out}.part.mp4`;
    // Toutes les pistes audio (4 au plus), en AAC stéréo : le choix de la langue reste possible
    const audio = probe.audio.slice(0, 4).flatMap((a, i) => ['-map', `0:${a.index}`, `-c:a:${i}`, a.codec === 'aac' && a.channels <= 2 ? 'copy' : 'aac', ...(a.codec === 'aac' && a.channels <= 2 ? [] : [`-ac:a:${i}`, '2', `-b:a:${i}`, '192k'])]);
    let idx = 0;
    const tryNext = () => {
      const p = allowed[idx];
      if (!p) return reject(new Error('Aucun encodeur n’a fonctionné'));
      // Pas de découpage en segments ici : on retire les options d'images-clés forcées propres au HLS
      const video = p.video.filter((x, i, a) => !['-force_key_frames', '-forced-idr'].includes(x) && !['-force_key_frames', '-forced-idr'].includes(a[i - 1]));
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...p.input, '-i', item.path, ...video, ...audio,
        '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp];
      const proc = spawnLow(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      current.proc = proc;
      let log = '';
      proc.stderr.on('data', (d) => { log = (log + d).slice(-2000); });
      proc.stdout.on('data', (d) => {
        const m = /out_time_ms=(\d+)/.exec(String(d));
        if (m && probe.duration) current.pct = Math.min(99, Math.round((Number(m[1]) / 1e6 / probe.duration) * 100));
      });
      proc.on('exit', (code) => {
        if (current && current.stopped) { fs.rmSync(tmp, { force: true }); return reject(Object.assign(new Error('Arrêté : une lecture a commencé'), { stopped: true })); }
        if (code === 0) { fs.renameSync(tmp, out); return resolve(out); }
        fs.rmSync(tmp, { force: true });
        console.warn(`[versions optimisées] ${p.name} a échoué : ${log.slice(-300)}`);
        idx++; tryNext();
      });
    };
    tryNext();
  });
}

// Une passe : copie les vidéos en attente tant que les conditions le permettent
let running = false;
// Une passe : prépare les copies en attente tant que les conditions le permettent
export async function runOptimize({ max = 50 } = {}) {
  if (running) return 'Déjà en cours';
  running = true;
  let done = 0;
  try {
    cleanup();
    const list = candidates();
    queueLen = list.length;
    for (const item of list) {
      if (done >= max || optStatus().state !== 'ready') break;
      const probe = parse(item.probe);
      current = { id: item.id, title: item.title, pct: 0, stopped: false };
      try {
        const out = await encode(item, probe);
        const p2 = await probeFile(out);
        const size = fs.statSync(out).size;
        run('INSERT OR REPLACE INTO optimized(item_id, path, mtime, size, probe, created_at) VALUES(?, ?, ?, ?, ?, ?)', item.id, out, item.mtime || 0, size, JSON.stringify(p2), Date.now());
        done++; queueLen--;
      } catch (e) {
        if (e.stopped) break;
        setSetting(`opt_fail:${item.id}`, Number(getSetting(`opt_fail:${item.id}`, 0)) + 1);
      } finally { current = null; }
    }
  } finally { running = false; current = null; }
  if (done) logActivity('task', `${done} version(s) optimisée(s) préparée(s)`);
  return done ? `${done} vidéo(s) préparée(s)` : optStatus().why;
}

// Une lecture commence : la copie en cours s'arrête pour laisser toute la puissance à la lecture
export function pauseForPlayback() {
  if (current && current.proc && !current.stopped) { current.stopped = true; try { current.proc.kill('SIGKILL'); } catch { /* */ } }
}

// Ménage : copies orphelines, inutilisées depuis 60 jours, ou au-delà de la place réservée
export function cleanup() {
  for (const o of all('SELECT o.item_id, o.path, o.mtime, i.mtime AS imtime FROM optimized o LEFT JOIN items i ON i.id = o.item_id')) {
    if (o.imtime == null || o.imtime !== o.mtime || !fs.existsSync(o.path)) drop(o.item_id);
  }
  for (const o of all('SELECT item_id FROM optimized WHERE COALESCE(used_at, created_at) < ?', Date.now() - 60 * 864e5)) drop(o.item_id);
  const st = optStatus();
  if (st.used > st.budget) {
    let over = st.used - st.budget;
    for (const o of all('SELECT item_id, size FROM optimized ORDER BY COALESCE(used_at, created_at)')) { if (over <= 0) break; drop(o.item_id); over -= o.size || 0; }
  }
  // Fichiers temporaires restés après un arrêt brutal
  for (const f of fs.readdirSync(OPT_DIR)) if (f.endsWith('.part.mp4')) fs.rmSync(path.join(OPT_DIR, f), { force: true });
}
// Supprime toutes les copies optimisées
export function clearAll() { for (const o of all('SELECT item_id FROM optimized')) drop(o.item_id); return { ok: true }; }
