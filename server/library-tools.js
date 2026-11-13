// Outils de médiathèque (Réglages → Médiathèque) :
//  - doublons : films présents plusieurs fois (même fiche TMDB ou même titre + année), avec la place récupérable
//  - renommage : proposer des noms de fichiers et de dossiers lisibles et standards après identification,
//    puis renommer d'un clic ; la base suit les fichiers (chemins mis à jour, rien n'est ré-analysé)
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx } from './db.js';
import { versionLabel } from './versions.js';

const VIDEO_SIDES = /\.(srt|vtt|ass|ssa|sub|idx|nfo|jpg|jpeg|png|webp)$/i;
// Nom de fichier sûr : pas de séparateur ni de caractères interdits sous Windows, pas de point final
export const safeName = (s) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 150) || 'Sans titre';

// ------------------------------------------------------------------ doublons
export function duplicateGroups() {
  const rows = all(`SELECT id, title, year, path, size, probe, version_of, poster, tmdb_id FROM items WHERE type = 'movie' AND path IS NOT NULL AND (version_of IS NOT NULL OR id IN (SELECT version_of FROM items WHERE version_of IS NOT NULL)) ORDER BY title`);
  const groups = new Map();
  for (const r of rows) {
    const k = r.version_of || r.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const main = list.find((r) => r.id === k) || list[0];
    const versions = list.map((r) => ({ id: r.id, path: r.path, size: r.size || 0, primary: r.id === main.id, ...versionLabel(r), file: path.basename(r.path) }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || b.size - a.size);
    out.push({ id: main.id, title: main.title, year: main.year, poster: main.poster, versions, recoverable: versions.filter((v) => !v.primary).reduce((n, v) => n + v.size, 0) });
  }
  return { groups: out, recoverable: out.reduce((n, g) => n + g.recoverable, 0) };
}

// ------------------------------------------------------------------ renommage
function movieTarget(it) {
  const base = `${safeName(it.title)}${it.year ? ` (${it.year})` : ''}`;
  const ext = path.extname(it.path);
  // Qualité dans le nom seulement quand le film existe en plusieurs versions (4K et 1080p côte à côte)
  const multi = get('SELECT 1 FROM items WHERE version_of = ? LIMIT 1', it.id);
  const label = multi ? versionLabel(it) : { quality: '' };
  const tag = label.quality ? ` - ${label.quality}` : '';
  return { dir: base, file: `${base}${tag}${ext}` };
}
function episodeTarget(ep, show, seasonNum) {
  const sBase = `${safeName(show.title)}${show.year ? ` (${show.year})` : ''}`;
  const code = `S${String(seasonNum).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`;
  const ext = path.extname(ep.path);
  const name = ep.title && !/^épisode \d+$/i.test(ep.title) ? ` - ${safeName(ep.title)}` : '';
  return { dir: path.join(sBase, seasonNum === 0 ? 'Specials' : `Saison ${String(seasonNum).padStart(2, '0')}`), file: `${sBase} - ${code}${name}${ext}` };
}

// Propositions : chaque fichier dont le nom ou le dossier ne suit pas le modèle
export function renamePlan({ limit = 300 } = {}) {
  const libs = new Map(all('SELECT id, path, type FROM libraries').map((l) => [l.id, l]));
  const plan = [];
  const consider = (it, target, libRoot) => {
    if (!libRoot || !it.path.startsWith(libRoot)) return;
    const to = path.join(libRoot, target.dir, target.file);
    if (to === it.path) return;
    if (plan.length < limit) plan.push({ id: it.id, type: it.type, title: it.title, from: path.relative(libRoot, it.path), to: path.relative(libRoot, to), exists: fs.existsSync(to) });
  };
  for (const it of all("SELECT * FROM items WHERE type = 'movie' AND matched = 1 AND path IS NOT NULL AND version_of IS NULL")) {
    const lib = libs.get(it.library_id);
    if (lib && lib.type === 'movies') consider(it, movieTarget(it), lib.path);
  }
  for (const ep of all(`SELECT e.*, s.title AS show_title, s.year AS show_year, se.season_num AS snum FROM items e JOIN items s ON s.id = e.show_id JOIN items se ON se.id = e.parent_id WHERE e.type = 'episode' AND s.matched = 1 AND e.path IS NOT NULL`)) {
    const lib = libs.get(ep.library_id);
    if (lib && ['shows', 'anime'].includes(lib.type)) consider(ep, episodeTarget(ep, { title: ep.show_title, year: ep.show_year }, ep.snum ?? ep.season_num ?? 1), lib.path);
  }
  return plan;
}

// Renomme les fichiers choisis (et leurs fichiers compagnons : sous-titres, .nfo, images) ; la base suit
export function applyRenames(ids) {
  const plan = renamePlan({ limit: 5000 }).filter((p) => ids.includes(p.id) && !p.exists);
  const libs = new Map(all('SELECT id, path FROM libraries').map((l) => [l.id, l.path]));
  let done = 0; const errors = [];
  for (const p of plan) {
    const it = get('SELECT * FROM items WHERE id = ?', p.id);
    if (!it) continue;
    const root = libs.get(it.library_id);
    const from = it.path, to = path.join(root, p.to);
    if (!from.startsWith(root) || !to.startsWith(root)) continue; // jamais hors de la bibliothèque
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      // Fichiers compagnons : même nom de base, autre extension (Film.fr.srt → Nouveau.fr.srt)
      const dir = path.dirname(from), base = path.basename(from, path.extname(from)), nb = path.basename(to, path.extname(to));
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base) && f !== path.basename(from) && VIDEO_SIDES.test(f)) { try { fs.renameSync(path.join(dir, f), path.join(path.dirname(to), nb + f.slice(base.length))); } catch { /* */ } }
      }
      tx(() => {
        run('UPDATE items SET path = ? WHERE id = ?', to, it.id);
        run('UPDATE items SET path = REPLACE(path, ?, ?) WHERE type = ? AND path LIKE ?', from, to, 'extra', `${from}%`);
      });
      // Dossier d'origine vide : supprimé
      try { if (dir !== path.dirname(to) && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* */ }
      done++;
    } catch (e) { errors.push(`${p.from} : ${e.message}`); }
  }
  return { done, errors };
}

export function removeEmptyDirs(root) {
  // Nettoyage des dossiers vides laissés par les renommages (un niveau à la fois, jamais la racine)
  let n = 0;
  const walk = (d, depth) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
    if (depth > 0) { try { if (!fs.readdirSync(d).length) { fs.rmdirSync(d); n++; } } catch { /* */ } }
  };
  walk(root, 0);
  return n;
}

