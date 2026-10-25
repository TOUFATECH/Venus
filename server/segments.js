// Génériques (opening / ending) : où commencent et finissent-ils dans chaque épisode ?
//
// 1. Chapitres du fichier (fréquents dans les animés : « Opening », « OP », « Ending », « Générique »…)
// 2. Empreinte audio (chromaprint, comme Plex et Jellyfin) : le générique est la même musique d'un
//    épisode à l'autre. On compare le début (et la fin) de deux épisodes d'une même saison et on
//    cherche le plus long passage identique.
//
// L'analyse tourne en arrière-plan, une saison à la fois, et n'est faite qu'une fois par fichier.
import { spawn, execFile } from 'node:child_process';
import { config } from './config.js';
import { all, get, run, getSetting } from './db.js';

const SEC = 0.1238;              // durée d'un point d'empreinte chromaprint (11 025 Hz, trames de 4096, recouvrement 2/3)
const INTRO_MIN = 15, INTRO_MAX = 150;
const CREDITS_MIN = 15, CREDITS_MAX = 240;
const TAIL = 240;                // on cherche le générique de fin dans les 4 dernières minutes

run(`CREATE TABLE IF NOT EXISTS segments (
  item_id INTEGER PRIMARY KEY, mtime INTEGER,
  intro_start REAL, intro_end REAL, credits_start REAL, credits_end REAL,
  source TEXT, analyzed_at INTEGER
)`);

export function getSegments(item) {
  const r = get('SELECT * FROM segments WHERE item_id = ?', item.id);
  if (!r || r.mtime !== item.mtime) return { intro: null, credits: null };
  return {
    intro: r.intro_end > r.intro_start ? { start: r.intro_start, end: r.intro_end } : null,
    credits: r.credits_end > r.credits_start ? { start: r.credits_start, end: r.credits_end } : null,
  };
}

function save(ep, data, source) {
  const cur = get('SELECT * FROM segments WHERE item_id = ?', ep.id);
  const keep = cur && cur.mtime === ep.mtime ? cur : {};
  run(`INSERT INTO segments(item_id, mtime, intro_start, intro_end, credits_start, credits_end, source, analyzed_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(item_id) DO UPDATE SET mtime=excluded.mtime, intro_start=excluded.intro_start, intro_end=excluded.intro_end,
         credits_start=excluded.credits_start, credits_end=excluded.credits_end, source=excluded.source, analyzed_at=excluded.analyzed_at`,
  ep.id, ep.mtime,
  data.intro ? data.intro.start : keep.intro_start ?? null, data.intro ? data.intro.end : keep.intro_end ?? null,
  data.credits ? data.credits.start : keep.credits_start ?? null, data.credits ? data.credits.end : keep.credits_end ?? null,
  source, Date.now());
}

// ------------------------------------------------------------------ 1. chapitres
const INTRO_RE = /^\s*(op(ening)?\s*\d*|intro(duction)?|g[ée]n[ée]rique( de d[ée]but| d[’']ouverture)?|ouverture|opening credits|main titles?|theme song)\s*$/i;
const CREDITS_RE = /^\s*(ed|ending\s*\d*|end(ing)? ?credits|credits|outro|g[ée]n[ée]rique de fin|closing( credits)?)\s*$/i;

function chapters(file) {
  return new Promise((resolve) => {
    execFile(config.ffprobe, ['-v', 'error', '-show_chapters', '-print_format', 'json', file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      try {
        resolve((JSON.parse(out).chapters || []).map((c) => ({ start: Number(c.start_time), end: Number(c.end_time), title: (c.tags && (c.tags.title || c.tags.TITLE)) || '' })));
      } catch { resolve([]); }
    });
  });
}

export function segmentsFromChapters(list, duration) {
  const out = { intro: null, credits: null };
  for (const c of list) {
    const len = c.end - c.start;
    if (!c.title || !(len > 0)) continue;
    const generic = /^\s*g[ée]n[ée]rique\s*$/i.test(c.title);
    if (!out.intro && INTRO_RE.test(c.title) && !(generic && duration && c.start > duration * 0.5) && len >= 10 && len <= 240) out.intro = { start: c.start, end: c.end };
    else if (!out.credits && (CREDITS_RE.test(c.title) || (generic && duration && c.start > duration * 0.5)) && len >= 10 && len <= 420) out.credits = { start: c.start, end: c.end };
  }
  return out;
}

// ------------------------------------------------------------------ 2. empreinte audio
export function fingerprint(file, start, length) {
  return new Promise((resolve) => {
    const p = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, start)), '-i', file, '-t', String(length),
      '-vn', '-sn', '-dn', '-ac', '2', '-f', 'chromaprint', '-fp_format', 'raw', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), 180000);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 400) return resolve(null);
      const arr = new Uint32Array(buf.length >> 2);
      for (let i = 0; i < arr.length; i++) arr[i] = buf.readUInt32LE(i * 4);
      resolve(arr);
    });
  });
}

const popcount = (x) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

// Plus long passage commun entre deux empreintes (décalage quelconque). Renvoie les bornes dans a et dans b.
export function commonRun(a, b, { maxBits = 6, maxGap = 3.5, minLen = INTRO_MIN } = {}) {
  if (!a || !b || a.length < 50 || b.length < 50) return null;
  const index = new Map();
  for (let j = 0; j < b.length; j++) {
    let l = index.get(b[j]);
    if (!l) index.set(b[j], (l = []));
    if (l.length < 8) l.push(j);
  }
  const votes = new Map();
  for (let i = 0; i < a.length; i++) {
    const l = index.get(a[i]);
    if (l) for (const j of l) votes.set(j - i, (votes.get(j - i) || 0) + 1);
  }
  const shifts = new Set();
  [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).forEach(([s]) => { shifts.add(s - 1); shifts.add(s); shifts.add(s + 1); });
  const gap = Math.round(maxGap / SEC), min = Math.round(minLen / SEC);
  let best = null;
  for (const s of shifts) {
    let start = -1, last = -1;
    const consider = () => { if (start >= 0 && last - start >= min && (!best || last - start > best.aEnd - best.aStart)) best = { aStart: start, aEnd: last, shift: s }; };
    for (let i = Math.max(0, -s); i < a.length && i + s < b.length; i++) {
      if (popcount((a[i] ^ b[i + s]) >>> 0) <= maxBits) {
        if (start < 0 || i - last > gap) { consider(); start = i; }
        last = i;
      }
    }
    consider();
  }
  if (!best) return null;
  return {
    a: { start: best.aStart * SEC, end: (best.aEnd + 1) * SEC },
    b: { start: (best.aStart + best.shift) * SEC, end: (best.aEnd + best.shift + 1) * SEC },
  };
}

const introWindow = (ep) => Math.min(600, Math.max(150, (ep.duration || 1200) * 0.3));

async function analyzeSeason(seasonId) {
  const eps = all("SELECT id, path, duration, mtime FROM items WHERE type='episode' AND parent_id=? AND path IS NOT NULL ORDER BY episode_num", seasonId);
  if (!eps.length) return;
  const found = new Map(eps.map((e) => [e.id, { intro: null, credits: null, source: 'audio' }]));

  // Chapitres d'abord : immédiat et exact quand ils existent
  for (const ep of eps) {
    const s = segmentsFromChapters(await chapters(ep.path), ep.duration);
    if (s.intro || s.credits) Object.assign(found.get(ep.id), { intro: s.intro, credits: s.credits, source: 'chapters' });
  }

  // Empreintes audio entre épisodes voisins
  if (eps.length >= 2 && String(getSetting('detect_segments', '1')) !== '0') {
    const heads = [], tails = [];
    for (const ep of eps) {
      const f = found.get(ep.id);
      heads.push(f.intro ? null : await fingerprint(ep.path, 0, introWindow(ep)));
      // fin d'épisode, sans recouvrir la zone du générique de début (épisodes courts)
      const tailStart = Math.max(introWindow(ep), (ep.duration || 0) - TAIL);
      const tailLen = (ep.duration || 0) - tailStart;
      tails.push(f.credits || tailLen < 40 ? null : { start: tailStart, fp: await fingerprint(ep.path, tailStart, tailLen) });
    }
    for (let i = 0; i < eps.length; i++) {
      const f = found.get(eps[i].id);
      // on compare avec l'épisode suivant, sinon le précédent
      for (const j of [i + 1, i - 1, i + 2, i - 2]) {
        if (j < 0 || j >= eps.length) continue;
        if (!f.intro && heads[i] && heads[j]) {
          const r = commonRun(heads[i], heads[j], { minLen: INTRO_MIN });
          if (r && r.a.end - r.a.start <= INTRO_MAX) f.intro = { start: snap(r.a.start), end: r.a.end };
        }
        if (!f.credits && tails[i] && tails[j] && tails[i].fp && tails[j].fp) {
          const r = commonRun(tails[i].fp, tails[j].fp, { minLen: CREDITS_MIN });
          if (r && r.a.end - r.a.start <= CREDITS_MAX) f.credits = { start: tails[i].start + r.a.start, end: Math.min(eps[i].duration, tails[i].start + r.a.end) };
        }
        if (f.intro && f.credits) break;
      }
    }
  }
  for (const ep of eps) { const f = found.get(ep.id); save(ep, f, f.source); }
  const n = [...found.values()].filter((f) => f.intro || f.credits).length;
  if (n) console.log(`[génériques] saison ${seasonId} : ${n}/${eps.length} épisode(s) avec générique repéré`);
}
// Un générique qui commence dans les toutes premières secondes commence en fait au début
const snap = (t) => (t < 3 ? 0 : t);

// ------------------------------------------------------------------ file d'attente (une saison à la fois)
const queue = [];
let busy = false;
export const segmentsPending = () => queue.length;
export function scheduleSeason(seasonId, urgent = false) {
  if (!seasonId || queue.includes(seasonId)) return;
  if (urgent) queue.unshift(seasonId); else queue.push(seasonId);
  pump();
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    try { await analyzeSeason(id); } catch (e) { console.warn('[génériques]', e.message); }
  }
  busy = false;
}
// Saisons dont un épisode n'a pas encore été analysé (nouveaux fichiers, fichiers remplacés)
export function schedulePending() {
  const rows = all(`SELECT DISTINCT e.parent_id AS sid FROM items e LEFT JOIN segments s ON s.item_id = e.id
    WHERE e.type='episode' AND e.path IS NOT NULL AND e.parent_id IS NOT NULL AND (s.item_id IS NULL OR s.mtime IS NOT e.mtime)`);
  rows.forEach((r) => scheduleSeason(r.sid));
  return rows.length;
}
