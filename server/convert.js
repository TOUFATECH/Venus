// Compression des vidéos pour gagner de la place sur le NAS : une copie H.264 + AAC de bonne qualité est écrite
// à côté de l'original (« Film.venus.mp4 »), lue directement par tous les appareils. L'original reste tant que
// l'utilisateur n'a pas validé la copie ; à la validation, il part dans la corbeille de la bibliothèque (7 jours)
// et la copie prend son nom. On peut ne garder que certaines langues audio (français, anglais…).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { db, all, get, run, getSetting, setSetting } from './db.js';
import { hw, videoPipelines } from './hw.js';
import { probeFile } from './probe.js';
import { logActivity } from './activity.js';
import { notify } from './notify.js';
import { recordTrash, TRASH_DIR } from './trash.js';
import { needsOptimizing } from './optimize.js';
import { sessions } from './stream.js';
import { spawnLow } from './nice.js';

db.exec(`CREATE TABLE IF NOT EXISTS conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, src_path TEXT NOT NULL, out_path TEXT, status TEXT NOT NULL DEFAULT 'queued',
  pct INTEGER DEFAULT 0, opts TEXT, size_before INTEGER, size_after INTEGER, probe TEXT, error TEXT, encoder TEXT,
  queued_at INTEGER, started_at INTEGER, done_at INTEGER, validated_at INTEGER, by_name TEXT);
CREATE INDEX IF NOT EXISTS idx_conv_item ON conversions(item_id, status)`);

export const SUFFIX = '.venus.mp4';
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

// ------------------------------------------------------------------ réglages et profils
// Un seul profil pour l'instant, « Universel » : H.264 8 bits lu partout sans conversion, qualité quasi
// indiscernable de l'original (CRF 20 sur processeur), plafonds de débit selon la définition.
export const PROFILE = { crf: 20, caps: { 2160: 20e6, 1440: 14e6, 1080: 10e6, 720: 6e6, 480: 3e6 } };
export function convertSettings() {
  const s = getSetting('convert_opts', null) || {};
  return {
    maxHeight: [0, 1080, 720].includes(s.maxHeight) ? s.maxHeight : 1080, // 0 = définition d'origine
    langs: Array.isArray(s.langs) ? s.langs : [],                           // vide = toutes les langues
    stereo: !!s.stereo,                                                      // false = garde le 5.1 (en AAC)
    subs: s.subs !== false,                                                  // sous-titres texte conservés
    encoder: ['auto', 'cpu', 'gpu'].includes(s.encoder) ? s.encoder : 'auto',
    night: !!s.night,                                                        // seulement entre 1 h et 7 h
  };
}
export function saveConvertSettings(patch) {
  const cur = convertSettings();
  const next = { ...cur };
  if (patch.maxHeight !== undefined) next.maxHeight = [0, 1080, 720].includes(Number(patch.maxHeight)) ? Number(patch.maxHeight) : cur.maxHeight;
  if (patch.langs !== undefined) next.langs = (Array.isArray(patch.langs) ? patch.langs : []).map((l) => String(l).toLowerCase().slice(0, 3)).filter(Boolean).slice(0, 8);
  if (patch.stereo !== undefined) next.stereo = !!patch.stereo;
  if (patch.subs !== undefined) next.subs = !!patch.subs;
  if (patch.encoder !== undefined && ['auto', 'cpu', 'gpu'].includes(patch.encoder)) next.encoder = patch.encoder;
  if (patch.night !== undefined) next.night = !!patch.night;
  setSetting('convert_opts', next);
  return next;
}
const capFor = (h) => (h >= 2000 ? PROFILE.caps[2160] : h >= 1300 ? PROFILE.caps[1440] : h >= 1000 ? PROFILE.caps[1080] : h >= 700 ? PROFILE.caps[720] : PROFILE.caps[480]);

// Taille attendue après compression (estimation : le CRF s'adapte au contenu, un animé descend bien plus bas)
export function estimate(probe, opts = convertSettings()) {
  const v = probe && probe.video; if (!v || !probe.duration) return null;
  const h = opts.maxHeight && v.height > opts.maxHeight ? opts.maxHeight : v.height;
  const srcV = v.bitrate || Math.max(0, (probe.bitrate || 0) - (probe.audio || []).reduce((n, a) => n + (a.bitrate || 0), 0));
  const scaled = srcV * ((h * h) / (v.height * v.height || 1));
  // Déjà en H.264 : gain seulement si le débit dépasse nettement le plafond (remux Blu-ray) ; sinon rien à gagner.
  // HEVC/AV1 : à qualité égale le H.264 ne fait pas mieux que l'original, le gain vient du plafond et de la définition.
  // MPEG-2/MPEG-4/VC-1 : vieux codecs peu efficaces, le H.264 divise la taille par deux.
  const cap = capFor(h);
  let video;
  if (v.codec === 'h264') video = scaled > cap * 1.3 || h < v.height ? Math.min(cap, scaled * 0.7) : scaled;
  else if (['hevc', 'av1', 'vp9'].includes(v.codec)) video = Math.min(cap, scaled * 1.0);
  else video = Math.min(cap, scaled * 0.5);
  video = Math.max(1.2e6, video);
  const kept = keptAudio(probe, opts);
  const audio = kept.reduce((n, a) => n + (opts.stereo || a.channels <= 2 ? 192e3 : a.channels <= 6 ? 384e3 : 512e3), 0);
  return { bytes: Math.round(((video + audio) * probe.duration) / 8), height: h, videoBitrate: Math.round(video) };
}
// Pistes audio gardées selon les langues choisies (toutes si rien ne correspond)
export function keptAudio(probe, opts) {
  const list = (probe && probe.audio) || [];
  if (!opts.langs || !opts.langs.length) return list.slice(0, 8);
  const want = new Set(opts.langs.map(norm3));
  const kept = list.filter((a) => want.has(norm3(a.lang)));
  return (kept.length ? kept : list).slice(0, 8);
}
const norm3 = (l) => { const x = String(l || '').toLowerCase(); return { fr: 'fre', fra: 'fre', en: 'eng', ja: 'jpn', de: 'ger', deu: 'ger', es: 'spa', it: 'ita', pt: 'por', ar: 'ara', ko: 'kor', zh: 'chi', zho: 'chi', und: 'und', '': 'und' }[x] || x; };

// ------------------------------------------------------------------ propositions
export function reasonFor(probe, opts = convertSettings()) {
  const v = probe && probe.video; if (!v) return null;
  const why = [];
  if (v.codec !== 'h264') why.push(`vidéo ${String(v.codec || '').toUpperCase()}`);
  if (v.bitDepth > 8) why.push(`${v.bitDepth} bits`);
  if (v.hdr) why.push('HDR');
  const a = (probe.audio || [])[0];
  if (a && !['aac', 'mp3', 'opus'].includes(a.codec)) why.push(`son ${String(a.codec || '').toUpperCase()}`);
  const est = estimate(probe, opts);
  const size = probe.size || 0;
  const gain = est && size ? 1 - est.bytes / size : 0;
  if (gain >= 0.25) why.push(`${Math.round(gain * 100)} % de place à gagner`);
  if (!needsOptimizing(probe) && gain < 0.25) return null;
  return { why, gain, est };
}
export function suggestions({ limit = 200, libraryId = null } = {}) {
  const done = new Set(all("SELECT item_id FROM conversions WHERE status IN ('queued','running','done','validated')").map((r) => r.item_id));
  const failed = new Map(all("SELECT item_id, COUNT(*) n FROM conversions WHERE status = 'failed' GROUP BY item_id").map((r) => [r.item_id, r.n]));
  const opts = convertSettings();
  const out = [];
  const rows = all(`SELECT i.id, i.title, i.type, i.year, i.poster, i.probe, i.size, i.path, i.mtime, i.library_id, i.show_id, i.season_num, i.episode_num, s.title AS show_title
    FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.type IN ('movie','episode') AND i.path IS NOT NULL AND i.version_of IS NULL${libraryId ? ' AND i.library_id = ?' : ''} ORDER BY i.size DESC`, ...(libraryId ? [libraryId] : []));
  let totalGain = 0;
  for (const r of rows) {
    if (done.has(r.id) || (failed.get(r.id) || 0) >= 2 || path.basename(r.path).endsWith(SUFFIX)) continue;
    const probe = parse(r.probe); if (!probe) continue;
    probe.size = probe.size || r.size;
    const why = reasonFor(probe, opts); if (!why) continue;
    totalGain += Math.max(0, (r.size || 0) - (why.est ? why.est.bytes : 0));
    if (out.length < limit) out.push({ id: r.id, title: r.title, type: r.type, year: r.year, poster: r.poster, show: r.show_title, season: r.season_num, episode: r.episode_num, size: r.size, estimated: why.est ? why.est.bytes : null, height: why.est ? why.est.height : null, gain: why.gain, why: why.why, audio: (probe.audio || []).map((a) => ({ lang: a.lang || 'und', codec: a.codec, channels: a.channels, title: a.title || null })) });
  }
  return { items: out, total: rows.length, totalGain };
}

// ------------------------------------------------------------------ file d'attente
export function queue(itemIds, opts = {}, byName = null) {
  const base = convertSettings();
  const o = { maxHeight: opts.maxHeight !== undefined ? Number(opts.maxHeight) : base.maxHeight, langs: Array.isArray(opts.langs) ? opts.langs.map(norm3) : base.langs, stereo: opts.stereo !== undefined ? !!opts.stereo : base.stereo, subs: opts.subs !== undefined ? !!opts.subs : base.subs };
  let n = 0;
  for (const id of itemIds) {
    const it = get("SELECT id, path, size FROM items WHERE id = ? AND type IN ('movie','episode') AND path IS NOT NULL", id);
    if (!it || get("SELECT 1 FROM conversions WHERE item_id = ? AND status IN ('queued','running','done')", id)) continue;
    run('INSERT INTO conversions(item_id, src_path, status, opts, size_before, queued_at, by_name) VALUES(?,?,?,?,?,?,?)', id, it.path, 'queued', JSON.stringify(o), it.size || 0, Date.now(), byName);
    n++;
  }
  if (n) setTimeout(() => runConversions().catch(() => {}), 50);
  return n;
}
export function cancel(id) {
  const c = get('SELECT * FROM conversions WHERE id = ?', id); if (!c) return false;
  if (c.status === 'running' && current && current.id === c.id) { current.cancelled = true; try { current.proc.kill('SIGKILL'); } catch { /* */ } }
  else if (c.status === 'queued') run("DELETE FROM conversions WHERE id = ?", id);
  else if (c.status === 'done' || c.status === 'failed') { if (c.out_path) try { fs.rmSync(c.out_path, { force: true }); } catch { /* */ } run('DELETE FROM conversions WHERE id = ?', id); }
  return true;
}
export const conversionFor = (itemId) => { const c = get("SELECT * FROM conversions WHERE item_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1", itemId); return c && c.out_path && fs.existsSync(c.out_path) ? { ...c, probe: parse(c.probe), opts: parse(c.opts) } : null; };
export function convertStatus() {
  const rows = all(`SELECT c.*, i.title, i.type, i.poster, i.show_id, i.season_num, i.episode_num, s.title AS show_title FROM conversions c JOIN items i ON i.id = c.item_id LEFT JOIN items s ON s.id = i.show_id
    WHERE c.status IN ('queued','running','done','failed') OR c.validated_at > ? ORDER BY CASE c.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'done' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END, c.id DESC LIMIT 300`, Date.now() - 7 * 864e5);
  const list = rows.map((c) => ({ id: c.id, itemId: c.item_id, title: c.title, type: c.type, poster: c.poster, show: c.show_title, season: c.season_num, episode: c.episode_num, status: c.status, pct: c.status === 'running' && current && current.id === c.id ? current.pct : c.pct, sizeBefore: c.size_before, sizeAfter: c.size_after, error: c.error, encoder: c.encoder, opts: parse(c.opts), queuedAt: c.queued_at, doneAt: c.done_at, validatedAt: c.validated_at, speed: current && current.id === c.id ? current.speed : null }));
  const saved = get("SELECT COALESCE(SUM(size_before - size_after), 0) n FROM conversions WHERE status = 'validated'").n;
  const pending = get("SELECT COALESCE(SUM(size_before - size_after), 0) n FROM conversions WHERE status = 'done'").n;
  return { list, running: !!current, saved, pending, paused: pausedUntil > Date.now() || !!(current && current.held), settings: convertSettings(), hw: hw.label, cpu: os.cpus().length };
}

// ------------------------------------------------------------------ encodage
let current = null, running = false, pausedUntil = 0;
function tune(p, { kbit, crf }) {
  // Les options propres au découpage HLS sont retirées ; la qualité passe en mode « constante » là où l'encodeur le permet
  const strip = new Set(['-force_key_frames', '-forced-idr', '-g', '-keyint_min']);
  const video = [];
  for (let i = 0; i < p.video.length; i++) { if (strip.has(p.video[i])) { i++; continue; } video.push(p.video[i]); }
  const drop = (names) => { for (let i = video.length - 1; i >= 0; i--) if (names.includes(video[i])) video.splice(i, 2); };
  const setArg = (name, value) => { const i = video.indexOf(name); if (i >= 0) video[i + 1] = value; else video.push(name, value); };
  if (p.name === 'cpu') { setArg('-preset', os.cpus().length >= 8 ? 'slow' : os.cpus().length >= 4 ? 'medium' : 'fast'); setArg('-crf', String(crf)); setArg('-level:v', '4.2'); }
  else if (p.name.startsWith('nvenc')) { setArg('-preset', 'p6'); drop(['-b:v']); video.push('-rc', 'vbr', '-cq', String(crf), '-b:v', '0', '-tune', 'hq', '-spatial-aq', '1', '-temporal-aq', '1'); }
  else if (p.name.startsWith('qsv')) { drop(['-b:v', '-maxrate', '-bufsize', '-look_ahead']); setArg('-preset', 'slower'); video.push('-global_quality', String(crf + 1), '-look_ahead', '1'); }
  else if (p.name.startsWith('vaapi')) { drop(['-b:v', '-maxrate', '-bufsize']); video.push('-rc_mode', 'CQP', '-qp', String(crf), '-compression_level', '1'); }
  else if (p.name === 'amf') { drop(['-b:v', '-maxrate', '-bufsize']); setArg('-quality', 'quality'); setArg('-rc', 'cqp'); video.push('-qp_i', String(crf), '-qp_p', String(crf + 2)); }
  else if (p.name === 'videotoolbox') { drop(['-b:v', '-maxrate', '-bufsize']); video.push('-q:v', '62'); }
  // Plafond de débit pour les pics (sinon un plan très chargé peut dépasser ce que l'appareil lit en direct)
  if (!video.includes('-maxrate')) video.push('-maxrate', `${Math.round(kbit * 1.4)}k`, '-bufsize', `${kbit * 2}k`);
  return video;
}
function audioArgs(probe, o) {
  const kept = keptAudio(probe, o);
  return kept.flatMap((a, i) => {
    const ch = o.stereo ? Math.min(2, a.channels || 2) : Math.min(6, a.channels || 2);
    const copy = a.codec === 'aac' && (a.channels || 2) <= ch;
    return ['-map', `0:${a.index}`, `-c:a:${i}`, copy ? 'copy' : 'aac', ...(copy ? [] : [`-ac:a:${i}`, String(ch), `-b:a:${i}`, ch >= 6 ? '384k' : '192k']), `-metadata:s:a:${i}`, `language=${norm3(a.lang)}`, ...(a.title ? [`-metadata:s:a:${i}`, `title=${a.title}`] : []), ...(i === 0 ? [`-disposition:a:${i}`, 'default'] : [`-disposition:a:${i}`, '0'])];
  });
}
function subArgs(probe, o) {
  if (!o.subs) return ['-sn'];
  const subs = (probe.subs || probe.subtitles || []).filter((s) => !s.external && TEXT_SUBS.has(String(s.codec || '').toLowerCase())).slice(0, 8);
  if (!subs.length) return ['-sn'];
  return subs.flatMap((s, i) => ['-map', `0:${s.index}`, `-c:s:${i}`, 'mov_text', `-metadata:s:s:${i}`, `language=${norm3(s.lang)}`, ...(s.title ? [`-metadata:s:s:${i}`, `title=${s.title}`] : [])]);
}
// Quelqu'un regarde : une session de lecture vivante (touchée depuis moins de 90 s)
const watching = () => [...sessions.values()].some((x) => !x.exited && Date.now() - x.lastAccess < 90e3);
// La compression se met en pause (SIGSTOP) pendant toute lecture et repart ensuite, sans perdre son travail
function holdWhileWatching(proc) {
  if (process.platform === 'win32') return; // pas de SIGSTOP : la conversion y continue en priorité basse
  const iv = setInterval(() => {
    if (proc.exitCode != null || proc.signalCode || !current || current.proc !== proc) return clearInterval(iv);
    const busy = watching() || pausedUntil > Date.now();
    try {
      if (busy && !current.held) { proc.kill('SIGSTOP'); current.held = true; }
      else if (!busy && current.held) { proc.kill('SIGCONT'); current.held = false; }
    } catch { /* processus terminé */ }
  }, 3000);
  proc.on('exit', () => clearInterval(iv));
}
function encode(c, item, probe, o) {
  return new Promise((resolve, reject) => {
    const v = probe.video;
    const height = o.maxHeight && v.height > o.maxHeight ? o.maxHeight : v.height;
    const width = Math.max(2, Math.round((v.width * height) / v.height / 2) * 2);
    const cap = capFor(height);
    const kbit = Math.round(cap / 1000);
    const set = convertSettings();
    let pipelines = videoPipelines({ width, height, bitrate: cap, src: v });
    if (set.encoder === 'cpu' || hw.type === 'none') pipelines = pipelines.filter((p) => p.name === 'cpu');
    else if (set.encoder === 'gpu') pipelines = pipelines.filter((p) => p.name !== 'cpu').concat(pipelines.filter((p) => p.name === 'cpu'));
    const ext = path.extname(item.path);
    const out = path.join(path.dirname(item.path), `${path.basename(item.path, ext)}${SUFFIX}`);
    const tmp = `${out}.part`;
    const audio = audioArgs(probe, o), subs = subArgs(probe, o);
    let idx = 0;
    const tryNext = () => {
      const p = pipelines[idx];
      if (!p) return reject(new Error('Aucun encodeur n’a fonctionné'));
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...p.input, '-i', item.path, ...tune(p, { kbit, crf: PROFILE.crf }), ...audio, ...subs,
        '-dn', '-map_metadata', '0', '-map_chapters', '0', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', tmp];
      const proc = spawnLow(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      current.proc = proc; current.encoder = p.name; const t0 = Date.now();
      holdWhileWatching(proc);
      let log = '';
      proc.stderr.on('data', (d) => { log = (log + d).slice(-2000); });
      proc.stdout.on('data', (d) => {
        const m = /out_time_ms=(\d+)/.exec(String(d));
        if (m && probe.duration) { const s = Number(m[1]) / 1e6; current.pct = Math.min(99, Math.round((s / probe.duration) * 100)); current.speed = Number((s / Math.max(1, (Date.now() - t0) / 1000)).toFixed(2)); run('UPDATE conversions SET pct = ? WHERE id = ?', current.pct, c.id); }
      });
      proc.on('exit', (code) => {
        if (current && (current.cancelled || current.paused)) { fs.rmSync(tmp, { force: true }); return reject(Object.assign(new Error(current.cancelled ? 'Annulée' : 'Interrompue : une lecture a commencé'), { cancelled: current.cancelled, paused: current.paused })); }
        if (code === 0) { fs.renameSync(tmp, out); return resolve({ out, encoder: p.name }); }
        fs.rmSync(tmp, { force: true });
        console.warn(`[compression] ${p.name} a échoué sur ${item.title} : ${log.slice(-300)}`);
        idx++; tryNext();
      });
    };
    tryNext();
  });
}
const nightOk = () => { const h = new Date().getHours(); return h >= 1 && h < 7; };
// Une conversion à la fois, jamais pendant une lecture ; la nuit seulement si demandé
export async function runConversions() {
  if (running) return 'Déjà en cours';
  running = true;
  let done = 0;
  try {
    for (;;) {
      if (pausedUntil > Date.now() || watching()) break;
      if (convertSettings().night && !nightOk()) break;
      const c = get("SELECT * FROM conversions WHERE status = 'queued' ORDER BY id LIMIT 1");
      if (!c) break;
      const item = get('SELECT * FROM items WHERE id = ?', c.item_id);
      const probe = item && parse(item.probe);
      if (!item || !item.path || !fs.existsSync(item.path) || !probe || !probe.video) { run("UPDATE conversions SET status = 'failed', error = ? WHERE id = ?", 'Fichier ou analyse introuvable', c.id); continue; }
      // Place libre à côté de l'original : au moins l'estimation + 10 %
      const est = estimate(probe, parse(c.opts) || convertSettings());
      try { const st = fs.statfsSync(path.dirname(item.path)); const free = st.bavail * st.bsize; if (est && free < est.bytes * 1.1) { run("UPDATE conversions SET status = 'failed', error = ? WHERE id = ?", `Pas assez de place libre à côté du fichier (${Math.round(free / 1e9)} Go)`, c.id); continue; } } catch { /* système de fichiers sans statfs */ }
      run("UPDATE conversions SET status = 'running', started_at = ?, pct = 0 WHERE id = ?", Date.now(), c.id);
      current = { id: c.id, itemId: item.id, title: item.title, pct: 0, speed: null, cancelled: false, paused: false, proc: null };
      try {
        const { out, encoder } = await encode(c, item, probe, parse(c.opts) || convertSettings());
        const p2 = await probeFile(out);
        const size = fs.statSync(out).size;
        if (!p2 || !p2.video || !p2.duration || Math.abs(p2.duration - probe.duration) > Math.max(3, probe.duration * 0.02)) { fs.rmSync(out, { force: true }); throw new Error('La copie est incomplète (durée différente de l’original)'); }
        run("UPDATE conversions SET status = 'done', out_path = ?, size_after = ?, probe = ?, encoder = ?, done_at = ?, pct = 100 WHERE id = ?", out, size, JSON.stringify(p2), encoder, Date.now(), c.id);
        done++;
        const gain = Math.max(0, (c.size_before || 0) - size);
        notify({ title: 'Vidéo compressée', body: `« ${item.title} » : ${fmtGo(c.size_before)} → ${fmtGo(size)} (${Math.round((gain / Math.max(1, c.size_before)) * 100)} % de place). Vérifiez-la, puis validez pour supprimer l’original.`, url: `/titre/${item.id}`, tag: 'venus-convert' }, { adminOnly: true }).catch(() => {});
      } catch (e) {
        if (e.paused) { run("UPDATE conversions SET status = 'queued', pct = 0 WHERE id = ?", c.id); break; }
        if (e.cancelled) { run('DELETE FROM conversions WHERE id = ?', c.id); continue; }
        run("UPDATE conversions SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 300), c.id);
      } finally { current = null; }
    }
  } finally { running = false; current = null; }
  if (done) logActivity('task', `${done} vidéo(s) compressée(s), en attente de validation`);
  return done ? `${done} vidéo(s) compressée(s)` : 'Rien en attente';
}
const fmtGo = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} Go` : `${Math.round(b / 1e6)} Mo`);
// Une lecture commence : la conversion en cours est suspendue tout de suite (elle reprendra là où elle en était
// dès que plus personne ne regarde, voir holdWhileWatching) ; rien ne démarre pendant ce délai
export function pauseConversions(ms = 2 * 60e3) {
  pausedUntil = Date.now() + ms;
  if (current && current.proc && !current.held && process.platform !== 'win32') { try { current.proc.kill('SIGSTOP'); current.held = true; } catch { /* */ } }
  setTimeout(() => { if (pausedUntil <= Date.now()) runConversions().catch(() => {}); }, ms + 1000).unref();
}

// ------------------------------------------------------------------ validation : la copie remplace l'original
export async function validate(id, { purge = false, byName = null } = {}) {
  const c = get('SELECT * FROM conversions WHERE id = ?', id);
  if (!c || c.status !== 'done') throw Object.assign(new Error('Cette conversion n’est pas prête'), { status: 400 });
  const item = get('SELECT * FROM items WHERE id = ?', c.item_id);
  if (!item || !fs.existsSync(c.out_path)) throw Object.assign(new Error('Copie introuvable'), { status: 404 });
  const lib = item.library_id ? get('SELECT * FROM libraries WHERE id = ?', item.library_id) : null;
  const ext = path.extname(item.path);
  const finalPath = path.join(path.dirname(item.path), `${path.basename(item.path, ext)}.mp4`);
  // 1. L'original : corbeille de la bibliothèque (7 jours, restaurable) ou suppression immédiate
  if (fs.existsSync(item.path)) {
    if (purge || !lib) fs.rmSync(item.path, { force: true });
    else {
      const bin = path.join(path.resolve(lib.path), TRASH_DIR, String(Date.now()));
      fs.mkdirSync(bin, { recursive: true });
      const dest = path.join(bin, path.basename(item.path));
      try { fs.renameSync(item.path, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(item.path, dest); fs.rmSync(item.path, { force: true }); }
      recordTrash({ libraryId: lib.id, title: `${item.title} (original avant compression)`, kind: item.type, files: [{ from: item.path, to: dest, size: c.size_before || 0 }], byName });
    }
  }
  // 2. La copie prend le nom de l'original (en .mp4) : Radarr/Sonarr, les sous-titres externes et les .nfo la retrouvent
  if (c.out_path !== finalPath) fs.renameSync(c.out_path, finalPath);
  const st = fs.statSync(finalPath);
  run('UPDATE items SET path = ?, size = ?, mtime = ?, probe = ? WHERE id = ?', finalPath, st.size, Math.floor(st.mtimeMs), c.probe, item.id);
  // Une entrée créée par l'analyse pour la copie elle-même disparaît
  for (const dup of all('SELECT id FROM items WHERE path IN (?, ?) AND id != ?', c.out_path, finalPath, item.id)) run('DELETE FROM items WHERE id = ?', dup.id);
  run('DELETE FROM optimized WHERE item_id = ?', item.id);
  run("UPDATE conversions SET status = 'validated', out_path = ?, validated_at = ?, by_name = COALESCE(?, by_name) WHERE id = ?", finalPath, Date.now(), byName, c.id);
  logActivity('admin', `${byName || 'Admin'} a validé la compression de « ${item.title} » (${fmtGo(c.size_before || 0)} → ${fmtGo(st.size)})`);
  arrRescan(item).catch(() => {});
  return { ok: true, path: finalPath, saved: Math.max(0, (c.size_before || 0) - st.size) };
}
// Radarr / Sonarr relisent le dossier : ils voient le nouveau fichier au lieu de croire l'original perdu
let arrCall = null;
export const setArrCall = (fn) => { arrCall = fn; };
async function arrRescan(item) {
  if (!arrCall) return;
  if (item.type === 'movie' && item.tmdb_id) {
    const list = await arrCall('radarr', `/api/v3/movie?tmdbId=${item.tmdb_id}`).catch(() => null);
    const m = Array.isArray(list) ? list[0] : null;
    if (m) await arrCall('radarr', '/api/v3/command', { method: 'POST', body: { name: 'RescanMovie', movieId: m.id } }).catch(() => {});
  } else if (item.type === 'episode' && item.show_id) {
    const show = get('SELECT tmdb_id, title FROM items WHERE id = ?', item.show_id);
    if (!show || !show.tmdb_id) return;
    const list = await arrCall('sonarr', '/api/v3/series').catch(() => null);
    const s = Array.isArray(list) ? list.find((x) => x.tmdbId === show.tmdb_id) : null;
    if (s) await arrCall('sonarr', '/api/v3/command', { method: 'POST', body: { name: 'RescanSeries', seriesId: s.id } }).catch(() => {});
  }
}
// Au démarrage : fichiers temporaires abandonnés, conversions « en cours » d'un arrêt brutal remises en attente
export function recoverConversions() {
  run("UPDATE conversions SET status = 'queued', pct = 0 WHERE status = 'running'");
  for (const c of all("SELECT out_path, src_path FROM conversions WHERE status IN ('queued')")) {
    const tmp = `${path.join(path.dirname(c.src_path), path.basename(c.src_path, path.extname(c.src_path)))}${SUFFIX}.part`;
    try { fs.rmSync(tmp, { force: true }); } catch { /* */ }
  }
  for (const c of all("SELECT id, out_path FROM conversions WHERE status = 'done'")) if (!c.out_path || !fs.existsSync(c.out_path)) run("UPDATE conversions SET status = 'failed', error = 'Copie disparue' WHERE id = ?", c.id);
}
