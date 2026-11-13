// Vignettes d'aperçu de la barre de progression (« trickplay ») :
// une image toutes les 10 secondes, rangées par planches de 10 × 10 en JPEG.
// ffmpeg ne décode que les images clés (-skip_frame nokey) : quelques dizaines de secondes par film, sans carte graphique.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, getSetting } from './db.js';
import { sessions } from './stream.js';

const root = path.join(config.dataDir, 'cache', 'trickplay');
fs.mkdirSync(root, { recursive: true });
const COLS = 10, ROWS = 10, WIDTH = 240;
const queue = [];
const inflight = new Map();
let busy = false;

export const trickplayMode = () => String(getSetting('trickplay', 'auto')); // auto (fond + lecture) | play (à la lecture) | off
const dirOf = (item) => path.join(root, `${item.id}_${item.mtime || 0}`);
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function layout(item) {
  const probe = parseJson(item.probe) || {};
  const dur = Number(item.duration || probe.duration) || 0;
  const v = probe.video || {};
  if (!dur || dur < 60 || !v.width || !v.height) return null;
  const interval = Math.max(10, Math.ceil(dur / 1000)); // 1 000 vignettes au plus
  const h = Math.max(2, 2 * Math.round((WIDTH * v.height) / v.width / 2));
  return { interval, width: WIDTH, height: h, cols: COLS, rows: ROWS, count: Math.max(1, Math.round(dur / interval)) };
}

export function trickplayInfo(item) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(item), 'meta.json'), 'utf8')); } catch { return null; }
}
export function trickplaySheet(item, n) {
  const f = path.join(dirOf(item), `sheet_${String(n).padStart(3, '0')}.jpg`);
  return fs.existsSync(f) ? f : null;
}

function generate(item) {
  const lay = layout(item);
  if (!lay || !item.path || !fs.existsSync(item.path)) return Promise.resolve(null);
  const dir = dirOf(item);
  const tmp = `${dir}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  return new Promise((resolve) => {
    execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-threads', '2', '-skip_frame', 'nokey', '-i', item.path,
      '-an', '-sn', '-dn', '-vf', `fps=1/${lay.interval},scale=${lay.width}:${lay.height}:flags=fast_bilinear,tile=${COLS}x${ROWS}`,
      '-q:v', '6', path.join(tmp, 'sheet_%03d.jpg')], { timeout: 30 * 60000 }, (err) => {
      const sheets = fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => f.endsWith('.jpg')).sort() : [];
      if (err || !sheets.length) { fs.rmSync(tmp, { recursive: true, force: true }); return resolve(null); }
      // ffmpeg numérote à partir de 1 : on renumérote à partir de 0
      sheets.forEach((f, i) => fs.renameSync(path.join(tmp, f), path.join(tmp, `sheet_${String(i).padStart(3, '0')}.jpg`)));
      const meta = { ...lay, sheets: sheets.length, count: Math.min(lay.count, sheets.length * COLS * ROWS) };
      fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta));
      // Anciennes versions (fichier remplacé) supprimées
      for (const d of fs.readdirSync(root)) if (d.startsWith(`${item.id}_`) && d !== path.basename(dir) && !d.endsWith('.tmp')) fs.rmSync(path.join(root, d), { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      resolve(meta);
    });
  });
}

function pump() {
  if (busy || !queue.length) return;
  const { item, resolve } = queue.shift();
  busy = true;
  generate(item).then(resolve, () => resolve(null)).finally(() => { busy = false; inflight.delete(item.id); pump(); });
}

// Demande les vignettes d'un titre ; urgent = le titre est en cours de lecture (passe devant la file)
export function ensureTrickplay(item, urgent = false) {
  if (trickplayMode() === 'off' || !layout(item)) return null;
  const ready = trickplayInfo(item);
  if (ready) return Promise.resolve(ready);
  if (inflight.has(item.id)) {
    if (urgent) { const i = queue.findIndex((q) => q.item.id === item.id); if (i > 0) queue.unshift(...queue.splice(i, 1)); }
    return inflight.get(item.id);
  }
  const p = new Promise((resolve) => { const job = { item, resolve }; if (urgent) queue.unshift(job); else queue.push(job); });
  inflight.set(item.id, p);
  pump();
  return p;
}

// Tâche de fond : prépare les vignettes des titres qui n'en ont pas, quand personne ne regarde un film converti
export async function trickplayBackfill(progress) {
  if (trickplayMode() !== 'auto') return 'Désactivé (Réglages → Lecture)';
  const rows = all("SELECT id, path, mtime, duration, probe FROM items WHERE type IN ('movie','episode','clip') AND path IS NOT NULL AND probe IS NOT NULL ORDER BY added_at DESC");
  const todo = rows.filter((r) => !trickplayInfo(r) && layout(r));
  let done = 0;
  for (const r of todo) {
    // Laisse la place aux lectures en cours qui convertissent
    while ([...sessions.values()].some((s) => !s.exited && !s.paused)) await new Promise((res) => setTimeout(res, 60000));
    const fresh = get('SELECT id, path, mtime, duration, probe FROM items WHERE id = ?', r.id);
    if (fresh) await ensureTrickplay(fresh);
    done++; progress(done / todo.length);
  }
  return todo.length ? `${done} titre(s) préparé(s)` : 'Tout est déjà prêt';
}

export function removeTrickplay(id) {
  for (const d of fs.readdirSync(root)) if (d.startsWith(`${id}_`)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
}
