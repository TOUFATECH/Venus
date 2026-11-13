// Analyse des scènes d'une vidéo : changements de plan et volume sonore, seconde par seconde.
// Sert au « Précédemment dans… » automatique (résumé de l'épisode d'avant), aux meilleurs moments à
// partager, et aux chapitres générés pour les fichiers qui n'en ont pas.
//
// Une seule passe ffmpeg, sur les images-clés seulement (10 à 20 fois plus rapide qu'un décodage complet :
// les encodeurs placent déjà une image-clé à chaque changement de plan), en basse priorité, un fichier à la fois.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { config } from './config.js';
import { all, get, run } from './db.js';
import { getSegments } from './segments.js';

run(`CREATE TABLE IF NOT EXISTS scenes (item_id INTEGER PRIMARY KEY, mtime INTEGER, data TEXT, analyzed_at INTEGER)`);
const cacheDir = path.join(config.dataDir, 'cache', 'scenes');
fs.mkdirSync(cacheDir, { recursive: true });

// Lit des sous-titres WebVTT (début, fin, texte)
const parseVtt = (txt) => {
  const out = [];
  const T = (s) => { const m = /(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/.exec(s); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : null; };
  for (const block of txt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    const start = T(a), end = T(b);
    if (start != null && text) out.push({ start, end: end ?? start + 2, text });
  }
  return out;
};

// ---------------------------------------------------------------- analyse
export function getScenes(item) {
  const r = get('SELECT * FROM scenes WHERE item_id = ?', item.id);
  if (!r || r.mtime !== item.mtime) return null;
  try { return JSON.parse(r.data); } catch { return null; }
}
const inflight = new Map();
// Analyse les plans et le volume d'une vidéo avec ffmpeg
export function analyzeScenes(item) {
  const have = getScenes(item);
  if (have) return Promise.resolve(have);
  if (!item.path || !fs.existsSync(item.path)) return Promise.reject(new Error('Fichier introuvable'));
  if (inflight.has(item.id)) return inflight.get(item.id);
  const p = new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostats', '-skip_frame', 'nokey', '-threads', '2', '-i', item.path,
      '-filter_complex', "[0:v:0]scale=160:-2,select='gt(scene,0.45)',showinfo[v];[0:a:0]aresample=8000,astats=metadata=1:reset=8,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level[a]",
      '-map', '[v]', '-map', '[a]', '-f', 'null', '-'];
    const pr = spawn(config.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    try { process.platform !== 'win32' && execFile('renice', ['-n', '15', '-p', String(pr.pid)], () => {}); } catch { /* */ }
    const cuts = [], loud = [];
    let buf = '', lastPts = null;
    const onLine = (l) => {
      const rms = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(l);
      if (rms) { if (lastPts != null) { const v = rms[1] === '-inf' ? -90 : Math.max(-90, Number(rms[1])); loud.push([Math.round(lastPts * 10) / 10, Math.round(v)]); lastPts = null; } return; }
      const pts = /pts_time:\s*([\d.]+)/.exec(l);
      if (!pts) return;
      if (l.includes('Parsed_showinfo')) cuts.push(Math.round(Number(pts[1]) * 10) / 10);
      else if (l.includes('Parsed_ametadata')) lastPts = Number(pts[1]);
    };
    pr.stderr.on('data', (d) => { buf += d; const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); });
    const kill = setTimeout(() => { try { pr.kill('SIGKILL'); } catch { /* */ } }, 20 * 60000);
    pr.on('error', (e) => { clearTimeout(kill); inflight.delete(item.id); reject(e); });
    pr.on('close', (code) => {
      clearTimeout(kill); inflight.delete(item.id);
      if (code !== 0 && !loud.length && !cuts.length) return reject(new Error(`Analyse impossible (ffmpeg ${code})`));
      // Volume par seconde (moyenne des ~1 s de mesures), coupures dédoublonnées
      const perSec = new Map();
      for (const [t, v] of loud) { const s = Math.floor(t); const c = perSec.get(s) || [0, 0]; c[0] += v; c[1]++; perSec.set(s, c); }
      const data = {
        duration: Number(item.duration) || (perSec.size ? Math.max(...perSec.keys()) + 1 : 0),
        cuts: [...new Set(cuts)].sort((a, b) => a - b),
        loud: [...perSec].sort((a, b) => a[0] - b[0]).map(([s, c]) => [s, Math.round(c[0] / c[1])]),
      };
      run('INSERT INTO scenes(item_id, mtime, data, analyzed_at) VALUES(?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET mtime = excluded.mtime, data = excluded.data, analyzed_at = excluded.analyzed_at', item.id, item.mtime, JSON.stringify(data), Date.now());
      resolve(data);
    });
  });
  inflight.set(item.id, p);
  return p;
}

// File d'attente (un fichier à la fois) : épisodes et films récents d'abord
const queue = [];
let busy = false;
// Nombre de vidéos en attente d'analyse
export const scenesPending = () => queue.length;
// Ajoute une vidéo à la file d'analyse des scènes
export function scheduleScenes(itemId, urgent = false) {
  if (!itemId || queue.includes(itemId)) return;
  if (urgent) queue.unshift(itemId); else queue.push(itemId);
  pump();
}
// Traite la file d'analyse, une vidéo à la fois
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    const it = get('SELECT * FROM items WHERE id = ?', id);
    if (!it || !it.path) continue;
    try { await analyzeScenes(it); } catch (e) { console.warn('[scènes]', it.title, ':', e.message); }
  }
  busy = false;
}
// Ajoute à la file les épisodes pas encore analysés
export function schedulePendingScenes(limit = 200) {
  const rows = all(`SELECT i.id FROM items i LEFT JOIN scenes s ON s.item_id = i.id
    WHERE i.type IN ('episode', 'movie') AND i.path IS NOT NULL AND (s.item_id IS NULL OR s.mtime IS NOT i.mtime)
    ORDER BY i.added_at DESC LIMIT ?`, limit);
  rows.forEach((r) => scheduleScenes(r.id));
  return rows.length;
}

// ---------------------------------------------------------------- scènes et scores
const loudAt = (data, t) => { const r = data.loud.find((x) => x[0] === Math.floor(t)); return r ? r[1] : -60; };
/** Découpe en scènes (entre deux coupures), avec volume moyen, pic, et nombre de coupures proches (action) */
export function sceneList(data, { minLen = 2 } = {}) {
  const d = data.duration || (data.loud.length ? data.loud[data.loud.length - 1][0] + 1 : 0);
  const bounds = [0, ...data.cuts.filter((c) => c > 0 && c < d), d];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    if (end - start < minLen) { if (out.length) out[out.length - 1].end = end; continue; }
    const vals = data.loud.filter((x) => x[0] >= start && x[0] < end).map((x) => x[1]);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -60;
    const peak = vals.length ? Math.max(...vals) : -60;
    out.push({ start, end, avg, peak });
  }
  // Densité de coupures autour de chaque scène (une scène d'action = beaucoup de plans courts)
  for (const s of out) s.cutsAround = data.cuts.filter((c) => c >= s.start - 15 && c <= s.end + 15).length;
  return out;
}
// Valeur médiane d'une liste
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Fenêtres « fortes » : volume au-dessus de la normale et plans rapprochés, loin des génériques, espacées */
export function highlights(item, data, { count = 5, length = 8, dialogues = [] } = {}) {
  const seg = getSegments(item);
  const d = data.duration || 0;
  if (d && d < length * 3) length = Math.max(3, Math.floor(d / 3)); // très courte vidéo : extraits plus courts
  const strict = (t) => (seg.intro && t >= seg.intro.start - 2 && t <= seg.intro.end + 2) || (seg.credits && t >= seg.credits.start - 2) || t < 5 || t > d - length - 2;
  const loose = (t) => t < 1 || t > d - length;
  const base = median(data.loud.map((x) => x[1]));
  const collect = (banned) => {
    const out = [];
    for (const [t, v] of data.loud) {
      if (banned(t)) continue;
      const cutsN = data.cuts.filter((c) => c >= t - 6 && c <= t + 6).length;
      const talk = dialogues.some((x) => x.start >= t - 1 && x.start <= t + length);
      out.push({ t, score: (v - base) + cutsN * 1.5 + (talk ? 1 : 0) });
    }
    return out;
  };
  // Hors intro et générique de préférence ; si tout y passe (intro mal repérée, vidéo courte), on garde tout
  let cand = collect(strict);
  if (!cand.length) cand = collect(loose);
  cand.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cand) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.t - c.t) < Math.max(90, d / 12))) continue;
    // Début de l'extrait sur la coupure précédente la plus proche (plan entier)
    const cut = [...data.cuts].reverse().find((x) => x <= c.t && x >= c.t - 4);
    picked.push({ t: c.t, start: Math.max(0, cut != null ? cut : c.t - 1), score: Math.round(c.score * 10) / 10 });
  }
  return picked.sort((a, b) => a.start - b.start).map((p) => ({ start: Math.round(p.start * 10) / 10, end: Math.round((p.start + length) * 10) / 10, score: p.score }));
}

// ---------------------------------------------------------------- chapitres générés
const FILLER = /^(oui|non|ok|d'accord|hein|quoi|merci|allez|bon|ah|oh|eh|hé|hm+|euh|viens|attends|allô|salut|bonjour|au revoir|pardon|désolé|s'il te plaît|s'il vous plaît)\W*$/i;
// Titre de chapitre tiré des dialogues
function titleFrom(lines) {
  // La réplique la plus « parlante » : 3 à 9 mots, pas un simple « oui », avec si possible un nom propre
  let best = null, bs = -1;
  for (const l of lines) {
    const words = l.text.split(/\s+/);
    if (words.length < 3 || words.length > 9 || FILLER.test(l.text)) continue;
    const proper = words.slice(1).filter((w) => /^[A-ZÀ-Ý][a-zà-ÿ]{2,}/.test(w)).length;
    const s = proper * 3 + (l.text.endsWith('!') ? 1 : 0) + (l.text.endsWith('?') ? 0.5 : 0) + Math.min(words.length, 7) / 7;
    if (s > bs) { bs = s; best = l.text; }
  }
  return best ? `« ${best.replace(/^[-–—]\s*/, '').replace(/[.…]+$/, '')} »` : null;
}
/** Chapitres pour un fichier qui n'en a pas : frontières sur les coupures « calmes », titres d'après les dialogues */
export function generatedChapters(data, dialogues = []) {
  const d = data.duration || 0;
  if (!d || d < 8 * 60 || data.cuts.length < 6) return [];
  const want = Math.max(4, Math.min(12, Math.round(d / (d > 4800 ? 600 : 420))));
  const minGap = d / (want * 1.8);
  // Score de frontière : coupure précédée d'un passage calme (changement de lieu / de scène), loin des bords
  const cands = data.cuts.filter((c) => c > 90 && c < d - 90).map((c) => {
    const before = [loudAt(data, c - 3), loudAt(data, c - 2), loudAt(data, c - 1)];
    const after = [loudAt(data, c + 1), loudAt(data, c + 2)];
    const quiet = -(before.reduce((a, b) => a + b, 0) / 3);
    const jump = after.reduce((a, b) => a + b, 0) / 2 - before.reduce((a, b) => a + b, 0) / 3;
    const noTalk = dialogues.some((x) => x.start < c && x.end > c) ? -6 : 0;
    return { c, s: quiet / 10 + Math.abs(jump) / 6 + noTalk };
  }).sort((a, b) => b.s - a.s);
  const bounds = [];
  for (const x of cands) {
    if (bounds.length >= want - 1) break;
    if (bounds.some((b) => Math.abs(b - x.c) < minGap)) continue;
    bounds.push(x.c);
  }
  bounds.sort((a, b) => a - b);
  const starts = [0, ...bounds];
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? d;
    const lines = dialogues.filter((x) => x.start >= start && x.start < Math.min(end, start + 90));
    const t = titleFrom(lines);
    return { start, end, title: t || `Chapitre ${i + 1}`, generated: true };
  });
}

// ---------------------------------------------------------------- « Précédemment dans… »
/** Dialogues d'un épisode (depuis un sous-titre texte déjà converti en VTT), sinon [] */
export async function dialoguesOf(item, subtitleVtt) {
  try {
    const probe = JSON.parse(item.probe || '{}');
    const subs = (probe.subs || []).filter((s) => s.text && !s.forced);
    const sub = subs.find((s) => /^fr/.test(s.lang || '')) || subs.find((s) => /^(en|ja|jp)/.test(s.lang || '')) || subs[0];
    if (!sub) return [];
    const file = await subtitleVtt(item, probe, sub.id);
    return parseVtt(fs.readFileSync(file, 'utf8'));
  } catch { return []; }
}
/** Choix des extraits du résumé : moments forts répartis sur l'épisode, puis sa toute fin (le suspense) */
export function recapPlan(item, data, dialogues, { total = 30 } = {}) {
  const d = data.duration || 0;
  if (!d) return [];
  const seg = getSegments(item);
  const endAt = seg.credits ? seg.credits.start : d;
  const clipLen = 4.5;
  const n = Math.max(3, Math.round((total - 7) / clipLen));
  const picks = highlights(item, data, { count: n + 2, length: clipLen, dialogues });
  // Un extrait par tranche de l'épisode, pour suivre l'histoire dans l'ordre
  const slots = Array.from({ length: n }, (_v, i) => [i * endAt / n, (i + 1) * endAt / n]);
  const chosen = [];
  for (const [a, b] of slots) {
    const inSlot = picks.filter((p) => p.start >= a && p.start < b && !chosen.includes(p)).sort((x, y) => y.score - x.score)[0];
    if (inSlot) chosen.push(inSlot);
  }
  if (chosen.length < 3) for (const p of picks) if (!chosen.includes(p) && chosen.length < n) chosen.push(p);
  const out = chosen.sort((a, b) => a.start - b.start).map((p) => ({ start: p.start, len: clipLen }));
  // Dernière minute avant le générique : le moment de suspense
  const tailStart = Math.max(0, endAt - 7);
  if (!out.some((x) => x.start > tailStart - 10)) out.push({ start: tailStart, len: 7 });
  return out;
}
/** Fichier MP4 du résumé (mis en cache) : extraits enchaînés avec fondus, 720p */
export function buildRecap(item, plan) {
  const out = path.join(cacheDir, `recap_${item.id}_${item.mtime}.mp4`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (!plan.length) return Promise.reject(new Error('Rien à résumer'));
  if (inflight.has(out)) return inflight.get(out);
  const inputs = plan.flatMap((p) => ['-ss', String(p.start), '-t', String(p.len), '-i', item.path]);
  const fade = 0.35;
  const chain = plan.map((p, i) => `[${i}:v:0]scale=-2:720,fps=25,format=yuv420p,fade=t=in:st=0:d=${fade},fade=t=out:st=${(p.len - fade).toFixed(2)}:d=${fade},setpts=PTS-STARTPTS[v${i}];[${i}:a:0]aresample=48000,afade=t=in:st=0:d=${fade},afade=t=out:st=${(p.len - fade).toFixed(2)}:d=${fade},asetpts=PTS-STARTPTS[a${i}]`).join(';');
  const concat = `${plan.map((_p, i) => `[v${i}][a${i}]`).join('')}concat=n=${plan.length}:v=1:a=1[v][a]`;
  const args = ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', `${chain};${concat}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', `${out}.tmp.mp4`];
  const p = new Promise((resolve, reject) => {
    execFile(config.ffmpeg, args, { timeout: 10 * 60000 }, (err, _o, stderr) => {
      inflight.delete(out);
      if (err) { fs.rmSync(`${out}.tmp.mp4`, { force: true }); return reject(new Error(`Montage impossible : ${String(stderr).trim().split('\n').pop() || err.message}`)); }
      fs.renameSync(`${out}.tmp.mp4`, out);
      resolve(out);
    });
  });
  inflight.set(out, p);
  return p;
}
/** Ménage : résumés de plus de 30 jours, et de fichiers disparus */
export function cleanRecaps() {
  let n = 0;
  for (const f of fs.readdirSync(cacheDir)) {
    const m = /^recap_(\d+)_(\d+)\.mp4$/.exec(f);
    const p = path.join(cacheDir, f);
    try {
      const it = m ? get('SELECT mtime FROM items WHERE id = ?', Number(m[1])) : null;
      if (!m || !it || String(it.mtime) !== m[2] || Date.now() - fs.statSync(p).mtimeMs > 30 * 864e5) { fs.rmSync(p, { force: true }); n++; }
    } catch { /* */ }
  }
  return n;
}
export { parseVtt };
