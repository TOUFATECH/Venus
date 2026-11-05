// Corbeille : une vidéo supprimée depuis Venus n'est pas effacée tout de suite. Ses fichiers (et sous-titres,
// images, .nfo à côté) sont déplacés dans un dossier « .corbeille » à la racine de la bibliothèque (même disque :
// instantané, pas de copie), et gardés 7 jours. On peut les restaurer d'un clic ; passé le délai, une tâche les efface.
import fs from 'node:fs';
import path from 'node:path';
import { db, all, get, run } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY, library_id INTEGER, title TEXT, kind TEXT, files TEXT, size INTEGER DEFAULT 0, deleted_at INTEGER, by_name TEXT)`);

export const TRASH_DIR = '.corbeille';
export const KEEP_DAYS = 7;
const SIDE_EXT = /\.(srt|vtt|ass|ssa|sub|idx|nfo|jpg|jpeg|png|webp|txt)$/i;

// Déplace un fichier (et ses compagnons) dans la corbeille de sa bibliothèque ; renvoie [{from, to, size}]
export function moveToTrash(file, libRoot) {
  const root = path.resolve(libRoot);
  if (!path.resolve(file).startsWith(root + path.sep)) throw Object.assign(new Error('Fichier hors de la bibliothèque'), { status: 400 });
  const bin = path.join(root, TRASH_DIR, String(Date.now()));
  fs.mkdirSync(bin, { recursive: true });
  const dir = path.dirname(file), base = path.basename(file, path.extname(file));
  const moved = [];
  const mv = (src) => {
    const dest = path.join(bin, path.basename(src));
    let size = 0; try { size = fs.statSync(src).size; } catch { return; }
    try { fs.renameSync(src, dest); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(src, dest); fs.rmSync(src, { force: true }); // autre disque : copie puis suppression
    }
    moved.push({ from: src, to: dest, size });
  };
  mv(file);
  try { for (const f of fs.readdirSync(dir)) if ((f.startsWith(`${base}.`) || f.startsWith(`${base}-`)) && SIDE_EXT.test(f)) mv(path.join(dir, f)); } catch { /* */ }
  // Dossier devenu vide (ou ne contenant plus que des images / .nfo) : retiré, jamais la racine
  let d = dir;
  while (d.startsWith(root + path.sep) && d !== root) {
    let rest; try { rest = fs.readdirSync(d); } catch { break; }
    if (rest.some((f) => !SIDE_EXT.test(f) || fs.statSync(path.join(d, f)).isDirectory())) break;
    fs.rmSync(d, { recursive: true, force: true });
    d = path.dirname(d);
  }
  return moved;
}

export function recordTrash({ libraryId, title, kind, files, byName }) {
  const size = files.reduce((n, f) => n + (f.size || 0), 0);
  run('INSERT INTO trash(library_id, title, kind, files, size, deleted_at, by_name) VALUES(?, ?, ?, ?, ?, ?, ?)', libraryId, title, kind, JSON.stringify(files), size, Date.now(), byName || null);
}

export const listTrash = () => all('SELECT t.*, l.name AS library FROM trash t LEFT JOIN libraries l ON l.id = t.library_id ORDER BY t.deleted_at DESC').map((t) => ({ ...t, files: JSON.parse(t.files || '[]'), expires: t.deleted_at + KEEP_DAYS * 864e5 }));

// Restaure les fichiers à leur place (l'analyse suivante les remet dans Venus)
export function restoreTrash(id) {
  const t = get('SELECT * FROM trash WHERE id = ?', Number(id));
  if (!t) throw Object.assign(new Error('Introuvable dans la corbeille'), { status: 404 });
  const files = JSON.parse(t.files || '[]');
  let back = 0;
  for (const f of files) {
    if (!fs.existsSync(f.to)) continue;
    fs.mkdirSync(path.dirname(f.from), { recursive: true });
    try { fs.renameSync(f.to, f.from); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(f.to, f.from); fs.rmSync(f.to, { force: true }); }
    back++;
  }
  cleanupBin(files);
  run('DELETE FROM trash WHERE id = ?', t.id);
  return back;
}

function cleanupBin(files) {
  for (const f of files) { try { const d = path.dirname(f.to); if (path.basename(path.dirname(d)) === TRASH_DIR && !fs.readdirSync(d).length) fs.rmdirSync(d); } catch { /* */ } }
}

// Efface pour de bon une entrée (ou toutes celles qui ont dépassé le délai)
export function purgeTrash(id = null) {
  const rows = id ? all('SELECT * FROM trash WHERE id = ?', Number(id)) : all('SELECT * FROM trash WHERE deleted_at < ?', Date.now() - KEEP_DAYS * 864e5);
  let freed = 0;
  for (const t of rows) {
    const files = JSON.parse(t.files || '[]');
    for (const f of files) { try { freed += fs.statSync(f.to).size; } catch { /* */ } fs.rmSync(f.to, { force: true }); }
    cleanupBin(files);
    run('DELETE FROM trash WHERE id = ?', t.id);
  }
  return { count: rows.length, freed };
}
