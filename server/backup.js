// Sauvegardes de la base (profils, vus, listes, envies, réglages) : une par nuit, les 10 dernières gardées.
// Faites avec « VACUUM INTO » : copie cohérente même pendant que Venus fonctionne.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, getSetting, setSetting } from './db.js';

export const backupsDir = path.join(config.dataDir, 'backups');
const KEEP = 10;

export function listBackups() {
  let files = [];
  try { files = fs.readdirSync(backupsDir).filter((f) => /^venus-.*\.db$/.test(f)); } catch { return []; }
  return files.map((f) => { const st = fs.statSync(path.join(backupsDir, f)); return { name: f, size: st.size, at: st.mtimeMs, manual: f.includes('-manuel') }; })
    .sort((a, b) => b.at - a.at);
}

export function makeBackup({ manual = false } = {}) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = path.join(backupsDir, `venus-${stamp}${manual ? '-manuel' : ''}.db`);
  try { fs.unlinkSync(file); } catch { /* */ }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  setSetting('last_backup', Date.now());
  // Les plus anciennes sont supprimées
  for (const b of listBackups().slice(KEEP)) { try { fs.unlinkSync(path.join(backupsDir, b.name)); } catch { /* */ } }
  return listBackups()[0];
}

export function scheduleRestore(name) {
  const f = path.join(backupsDir, path.basename(name));
  if (!fs.existsSync(f)) throw new Error('Sauvegarde introuvable');
  fs.writeFileSync(path.join(backupsDir, 'restore.pending'), path.basename(name));
}
export const backupPath = (name) => path.join(backupsDir, path.basename(name));

// Une fois par jour (vérifié toutes les heures), de préférence la nuit
export function startBackups() {
  const tick = () => {
    if (String(getSetting('auto_backup', '1')) === '0') return;
    const last = Number(getSetting('last_backup', 0));
    const h = new Date().getHours();
    if (Date.now() - last > 26 * 3600000 || (Date.now() - last > 20 * 3600000 && h >= 2 && h <= 6)) {
      try { makeBackup(); console.log('  ✓ Sauvegarde de la base faite'); } catch (e) { console.warn('[sauvegarde]', e.message); }
    }
  };
  setTimeout(tick, 5 * 60000).unref();
  setInterval(tick, 3600000).unref();
}
