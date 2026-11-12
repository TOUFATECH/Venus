// Enregistrements de la TV en direct (DVR), comme Jellyfin : un programme du guide, une émission à
// chaque diffusion (« série »), ou un créneau libre. ffmpeg copie le flux tel quel (pas de conversion),
// avec une marge avant et après. Les fichiers vont dans le dossier des enregistrements et apparaissent
// dans TV → Enregistrements, lisibles comme n'importe quelle vidéo.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { liveSource } from './ftv.js';
import { db, all, get, run, getSetting } from './db.js';
import { NET_INPUT, probeFile } from './probe.js';
import { programsBetween } from './epg.js';
import { logActivity } from './activity.js';
import { notify } from './notify.js';
import { emitHook } from './webhooks.js';

// Anciens enregistrements : le logo de la chaîne servait de vignette ; il passe en logo, la vignette vient de la vidéo
try { db.exec("UPDATE items SET logo = COALESCE(logo, poster), poster = NULL WHERE category = 'recording' AND poster IS NOT NULL"); } catch { /* */ }
db.exec(`CREATE TABLE IF NOT EXISTS recordings (id INTEGER PRIMARY KEY, channel_id INTEGER, profile_id INTEGER, title TEXT, sub TEXT, descr TEXT,
  start INTEGER, stop INTEGER, status TEXT, path TEXT, item_id INTEGER, rule_id INTEGER, error TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS record_rules (id INTEGER PRIMARY KEY, channel_id INTEGER, title TEXT, profile_id INTEGER, new_only INTEGER DEFAULT 0, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_rec_start ON recordings(status, start);`);

export const dvrDir = () => path.resolve(String(getSetting('dvr_path', '') || path.join(config.dataDir, 'recordings')));
const pad = () => ({ before: Number(getSetting('dvr_pre', 2)) * 60000, after: Number(getSetting('dvr_post', 5)) * 60000 });
const running = new Map(); // id → processus ffmpeg
const safe = (s) => String(s || 'Enregistrement').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

export function schedule({ channelId, title, sub = null, descr = null, start, stop, profileId = null, ruleId = null }) {
  if (!(stop > start) || stop < Date.now()) throw Object.assign(new Error('Ce programme est déjà terminé'), { status: 400 });
  if (stop - start > 12 * 3600e3) throw Object.assign(new Error('12 heures au plus par enregistrement'), { status: 400 });
  const dup = get("SELECT id FROM recordings WHERE channel_id = ? AND start = ? AND status IN ('scheduled','recording')", channelId, start);
  if (dup) return dup.id;
  const r = run("INSERT INTO recordings(channel_id, profile_id, title, sub, descr, start, stop, status, rule_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)",
    channelId, profileId, title, sub, descr, start, stop, ruleId, Date.now());
  return Number(r.lastInsertRowid);
}

export function cancel(id) {
  const r = get('SELECT * FROM recordings WHERE id = ?', Number(id));
  if (!r) return false;
  if (r.status === 'recording') { running.get(r.id)?.kill('SIGINT'); return true; } // arrêt propre : le début est gardé
  if (r.status === 'scheduled') run("UPDATE recordings SET status = 'cancelled' WHERE id = ?", r.id);
  else { if (r.path) fs.rmSync(r.path, { force: true }); if (r.item_id) run('DELETE FROM items WHERE id = ?', r.item_id); run('DELETE FROM recordings WHERE id = ?', r.id); }
  return true;
}

// Bibliothèque « Enregistrements » (créée au premier enregistrement) : les fichiers y sont rangés comme des clips
function dvrLibrary() {
  const dir = dvrDir();
  fs.mkdirSync(dir, { recursive: true });
  let lib = get('SELECT * FROM libraries WHERE path = ?', dir);
  if (!lib) { const r = run("INSERT INTO libraries(name, type, path) VALUES('Enregistrements', 'clips', ?)", dir); lib = get('SELECT * FROM libraries WHERE id = ?', Number(r.lastInsertRowid)); }
  return lib;
}

const starting = new Set();
async function start(rec) {
  if (starting.has(rec.id)) return;
  starting.add(rec.id);
  try { await startNow(rec); } finally { starting.delete(rec.id); }
}
async function startNow(rec) {
  const ch = get('SELECT * FROM items WHERE id = ?', rec.channel_id);
  if (!ch || !ch.stream_url) { run("UPDATE recordings SET status = 'failed', error = ? WHERE id = ?", 'Chaîne introuvable', rec.id); return; }
  const lib = dvrLibrary();
  const when = new Date(rec.start);
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}h${String(when.getMinutes()).padStart(2, '0')}`;
  const file = path.join(lib.path, safe(rec.title), `${safe(rec.title)}${rec.sub ? ` - ${safe(rec.sub)}` : ''} (${stamp}).ts`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seconds = Math.max(30, Math.round((rec.stop + pad().after - Date.now()) / 1000));
  const src = await liveSource(ch.stream_url); // France TV : jeton frais
  const args = ['-hide_banner', '-loglevel', 'error', ...NET_INPUT(src), '-i', src, '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-c', 'copy', '-t', String(seconds), '-f', 'mpegts', '-y', file];
  const p = spawn(config.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  running.set(rec.id, p);
  run("UPDATE recordings SET status = 'recording', path = ? WHERE id = ?", file, rec.id);
  logActivity('record', `Enregistrement de « ${rec.title} » sur ${ch.title}`);
  console.log(`[dvr] début : ${rec.title} (${ch.title})`);
  p.on('close', async (code) => {
    running.delete(rec.id);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size < 512 * 1024) {
      run("UPDATE recordings SET status = 'failed', error = ? WHERE id = ?", (err.trim().split('\n').pop() || `ffmpeg a quitté (${code})`).slice(0, 300), rec.id);
      fs.rmSync(file, { force: true });
      console.warn(`[dvr] échec : ${rec.title} ${err.slice(-200)}`);
      return;
    }
    // La vidéo rejoint la médiathèque (rubrique Enregistrements)
    let probe = null;
    try { probe = await probeFile(file); } catch { /* */ }
    const st = fs.statSync(file);
    // Vignette = une image de l'enregistrement (pas le logo de la chaîne, gardé à part pour l'afficher à côté du nom)
    const r = run(`INSERT OR IGNORE INTO items(library_id, type, category, title, original_title, sort_title, overview, path, size, mtime, duration, probe, logo, added_at, matched, release_date)
      VALUES(?, 'clip', 'recording', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    lib.id, rec.sub ? `${rec.title} — ${rec.sub}` : rec.title, ch.title, String(rec.title).toLowerCase(), rec.descr, file, st.size, Math.floor(st.mtimeMs), probe ? probe.duration : null, probe ? JSON.stringify(probe) : null, ch.poster, Date.now(), new Date(rec.start).toISOString().slice(0, 10));
    const item = get('SELECT id FROM items WHERE path = ?', file);
    run("UPDATE recordings SET status = 'done', item_id = ? WHERE id = ?", item ? item.id : null, rec.id);
    logActivity('record', `« ${rec.title} » enregistré`);
    notify({ title: 'Enregistrement terminé', body: `« ${rec.title} » est prêt à regarder`, url: item ? `/lecture/${item.id}` : '/tv', tag: `rec-${rec.id}` }, rec.profile_id ? { profileId: rec.profile_id } : {});
    emitHook('recording.done', { title: rec.title, channel: ch.title, itemId: item ? item.id : null });
    void r;
  });
}

// Règles « série » : chaque diffusion à venir d'une émission (même titre, même chaîne) est programmée
export function applyRules() {
  const rules = all('SELECT * FROM record_rules');
  if (!rules.length) return 0;
  let n = 0;
  const progs = programsBetween(Date.now(), Date.now() + 4 * 86400e3, [...new Set(rules.map((r) => r.channel_id))]);
  for (const rule of rules) {
    for (const p of progs.filter((x) => x.channel === rule.channel_id && x.title.toLowerCase() === rule.title.toLowerCase())) {
      if (rule.new_only && p.sub && get("SELECT 1 FROM recordings WHERE rule_id = ? AND sub = ? AND status IN ('done','recording','scheduled')", rule.id, p.sub)) continue;
      if (get("SELECT 1 FROM recordings WHERE channel_id = ? AND start = ? AND status != 'cancelled'", p.channel, p.start)) continue;
      try { schedule({ channelId: p.channel, title: p.title, sub: p.sub, descr: p.descr, start: p.start, stop: p.stop, profileId: rule.profile_id, ruleId: rule.id }); n++; } catch { /* */ }
    }
  }
  return n;
}

// Toutes les 20 secondes : démarre ce qui doit l'être (avec la marge avant le début)
export function startDvr() {
  // Enregistrements interrompus par un redémarrage : marqués en échec
  run("UPDATE recordings SET status = 'failed', error = 'Venus a redémarré pendant l’enregistrement' WHERE status = 'recording'");
  const tick = () => {
    const now = Date.now();
    for (const r of all("SELECT * FROM recordings WHERE status = 'scheduled' AND start - ? <= ?", pad().before, now)) {
      if (r.stop + pad().after < now) { run("UPDATE recordings SET status = 'failed', error = 'Heure dépassée (Venus était arrêté)' WHERE id = ?", r.id); continue; }
      start(r).catch((e) => console.warn("[enregistrement]", e.message));
    }
  };
  setInterval(tick, 20000).unref();
  setTimeout(tick, 5000).unref();
}

export const listRecordings = () => all(`SELECT r.*, c.title AS channel_title, c.poster AS channel_logo FROM recordings r LEFT JOIN items c ON c.id = r.channel_id
  WHERE r.status != 'cancelled' ORDER BY CASE r.status WHEN 'recording' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, CASE WHEN r.status IN ('recording','scheduled') THEN r.start ELSE -r.start END LIMIT 500`);
export const listRules = () => all('SELECT r.*, c.title AS channel_title FROM record_rules r LEFT JOIN items c ON c.id = r.channel_id ORDER BY r.title');
export function addRule({ channelId, title, profileId, newOnly = false }) {
  const ex = get('SELECT id FROM record_rules WHERE channel_id = ? AND lower(title) = lower(?)', channelId, title);
  const id = ex ? ex.id : Number(run('INSERT INTO record_rules(channel_id, title, profile_id, new_only, created_at) VALUES(?, ?, ?, ?, ?)', channelId, title, profileId, newOnly ? 1 : 0, Date.now()).lastInsertRowid);
  applyRules();
  return id;
}
export function removeRule(id) {
  run("UPDATE recordings SET status = 'cancelled' WHERE rule_id = ? AND status = 'scheduled'", Number(id));
  run('DELETE FROM record_rules WHERE id = ?', Number(id));
}
