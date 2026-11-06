// Rapport hebdomadaire de l'administrateur et vérification des fichiers.
//  - rapport : nouveautés, temps regardé par profil, espace disque, échecs des tâches ; envoyé par notification
//    (et par e-mail si le serveur d'e-mails est réglé). Aussi lisible dans Serveur → Tâches.
//  - intégrité : chaque vidéo est lue par ffmpeg (décodage rapide, sans sortie) pour repérer les fichiers abîmés
//    ou incomplets ; les problèmes sont gardés dans la table file_checks et signalés.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { db, all, get, run, getSetting, setSetting } from './db.js';
import { notify } from './notify.js';
import { sendMail, smtpConf } from './smtp.js';
import { listTasks } from './tasks.js';
import { twofaEmail } from './twofa.js';

db.exec(`CREATE TABLE IF NOT EXISTS file_checks (item_id INTEGER PRIMARY KEY, checked_at INTEGER, mtime INTEGER, ok INTEGER, error TEXT)`);

const fmtGo = (b) => `${(b / 1e9).toFixed(1).replace('.', ',')} Go`;
const fmtH = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };

export function weeklyReport() {
  const since = Date.now() - 7 * 864e5;
  const added = all("SELECT title, type FROM items WHERE added_at > ? AND type IN ('movie','show') AND version_of IS NULL ORDER BY added_at DESC", since);
  const eps = get("SELECT COUNT(*) n FROM items WHERE added_at > ? AND type = 'episode'", since).n;
  const day = new Date(since).toISOString().slice(0, 10);
  const time = all('SELECT p.name, SUM(w.seconds) s FROM watch_time w JOIN profiles p ON p.id = w.profile_id WHERE w.day >= ? GROUP BY p.name ORDER BY s DESC', day);
  let disk = null; try { const st = fs.statfsSync(config.dataDir); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* */ }
  const failed = listTasks().filter((t) => t.lastError);
  const broken = all('SELECT COUNT(*) n FROM file_checks WHERE ok = 0').n;
  const lines = [];
  lines.push(added.length || eps ? `Nouveautés : ${added.length} titre${added.length > 1 ? 's' : ''}${eps ? ` et ${eps} épisode${eps > 1 ? 's' : ''}` : ''}${added.length ? ` (${added.slice(0, 5).map((a) => a.title).join(', ')}${added.length > 5 ? '…' : ''})` : ''}.` : 'Aucune nouveauté cette semaine.');
  lines.push(time.length ? `Temps regardé : ${time.map((t) => `${t.name} ${fmtH(t.s)}`).join(', ')}.` : 'Personne n’a regardé Venus cette semaine.');
  if (disk) lines.push(`Disque de Venus : ${fmtGo(disk.free)} libres sur ${fmtGo(disk.total)}${disk.free / disk.total < 0.1 ? ' — attention, presque plein' : ''}.`);
  if (failed.length) lines.push(`Tâches en échec : ${failed.map((t) => t.label).join(', ')}.`);
  if (broken) lines.push(`${broken} fichier${broken > 1 ? 's' : ''} vidéo abîmé${broken > 1 ? 's' : ''} (Réglages → Bibliothèques → Fichiers abîmés).`);
  return { lines, text: lines.join('\n') };
}

export async function sendWeeklyReport() {
  const r = weeklyReport();
  await notify({ title: 'Venus, cette semaine', body: r.lines.slice(0, 2).join(' '), url: '/dashboard', tag: 'weekly' }, { adminOnly: true });
  const to = twofaEmail();
  if (to && smtpConf().host) {
    try { await sendMail({ to, subject: `Venus : rapport de la semaine`, text: r.text, html: `<h2>Venus, cette semaine</h2><ul>${r.lines.map((l) => `<li>${l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</li>`).join('')}</ul>` }); } catch (e) { console.warn('[rapport] e-mail :', e.message); }
  }
  setSetting('last_report', Date.now());
  return r.text;
}

// Lecture rapide de chaque vidéo par ffmpeg : erreurs de décodage = fichier abîmé. 30 fichiers par passage.
function checkOne(file) {
  return new Promise((resolve) => {
    execFile(config.ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-t', '600', '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { timeout: 120000, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      const msg = String(stderr || '').trim().split('\n').pop() || '';
      if (!err) return resolve({ ok: true });
      if (err.killed) return resolve({ ok: true }); // trop long : on ne conclut rien
      resolve({ ok: false, error: (msg || err.message).slice(0, 200) });
    });
  });
}
export async function checkFiles(limit = 30) {
  const rows = all(`SELECT i.id, i.path, i.mtime FROM items i LEFT JOIN file_checks c ON c.item_id = i.id
    WHERE i.type IN ('movie','episode','clip') AND i.path IS NOT NULL AND i.path NOT LIKE 'http%' AND (c.item_id IS NULL OR c.mtime != i.mtime OR c.checked_at < ?) ORDER BY c.checked_at IS NOT NULL, i.added_at DESC LIMIT ?`, Date.now() - 90 * 864e5, limit);
  let bad = 0;
  for (const r of rows) {
    if (!fs.existsSync(r.path)) continue;
    const res = await checkOne(r.path);
    run('INSERT INTO file_checks(item_id, checked_at, mtime, ok, error) VALUES(?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET checked_at = excluded.checked_at, mtime = excluded.mtime, ok = excluded.ok, error = excluded.error', r.id, Date.now(), r.mtime || 0, res.ok ? 1 : 0, res.error || null);
    if (!res.ok) bad++;
  }
  const total = all('SELECT COUNT(*) n FROM file_checks WHERE ok = 0')[0].n;
  if (bad && getSetting('broken_notified', 0) < Date.now() - 864e5) { setSetting('broken_notified', Date.now()); notify({ title: 'Fichiers vidéo abîmés', body: `${total} fichier${total > 1 ? 's' : ''} ne se lisent pas correctement`, url: '/reglages', tag: 'broken' }, { adminOnly: true }); }
  return `${rows.length} fichier(s) vérifié(s), ${bad} problème(s) trouvé(s), ${total} au total`;
}
export const brokenFiles = () => all('SELECT c.*, i.title, i.type, i.path, s.title AS show_title, i.season_num, i.episode_num FROM file_checks c JOIN items i ON i.id = c.item_id LEFT JOIN items s ON s.id = i.show_id WHERE c.ok = 0 ORDER BY c.checked_at DESC');
