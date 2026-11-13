// Plusieurs versions d'un même film (4K et 1080p, version longue…) : une seule affiche dans les listes,
// et le choix de la version sur la fiche. Regroupées par identifiant TMDB, sinon par titre + année
// dans un même dossier (« Film (2010) - 4K.mkv » et « Film (2010) - 1080p.mkv »).
import path from 'node:path';
import { all, run, tx } from './db.js';

// Lecture JSON tolérante
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
// Qualité d'une version (définition, HDR, débit) pour choisir la meilleure
const quality = (r) => { const p = parseJson(r.probe) || {}; const v = p.video || {}; return [(v.height || 0) * (v.hdr ? 1.05 : 1), p.bitrate || 0, -r.id]; };
// La version a est-elle meilleure que b ?
const better = (a, b) => { const qa = quality(a), qb = quality(b); for (let i = 0; i < qa.length; i++) if (qa[i] !== qb[i]) return qa[i] > qb[i] ? a : b; return a; };

// Regroupe les versions d'un même film sous la meilleure
export function groupVersions() {
  const rows = all("SELECT id, tmdb_id, title, year, path, probe, version_of FROM items WHERE type = 'movie' AND path IS NOT NULL");
  const groups = new Map();
  for (const r of rows) {
    const k = r.tmdb_id ? `t${r.tmdb_id}` : `d${path.dirname(r.path)}|${String(r.title || '').toLowerCase()}|${r.year || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  tx(() => {
    for (const list of groups.values()) {
      const primary = list.reduce((a, b) => better(a, b));
      for (const r of list) {
        const want = list.length > 1 && r.id !== primary.id ? primary.id : null;
        if ((r.version_of ?? null) !== want) run('UPDATE items SET version_of = ? WHERE id = ?', want, r.id);
      }
    }
  });
}

// Nom lisible d'une version : « 4K HDR · HEVC · 58 Go », plus l'indication du nom de fichier (« Version longue »)
export function versionLabel(r) {
  const p = parseJson(r.probe) || {};
  const v = p.video || {};
  const res = v.width >= 3200 || v.height >= 1800 ? '4K' : v.width >= 1800 || v.height >= 1000 ? '1080p' : v.width >= 1200 || v.height >= 700 ? '720p' : v.height ? `${v.height}p` : '';
  const hdr = v.dovi ? 'Dolby Vision' : v.hdr ? 'HDR' : '';
  const codec = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' }[v.codec] || (v.codec || '').toUpperCase();
  const base = path.basename(r.path || '', path.extname(r.path || ''));
  const tag = (/\s-\s([^-]{2,40})$/.exec(base) || [])[1] || (/(extended|director'?s cut|version longue|remastered|imax|unrated|theatrical)/i.exec(base) || [])[1] || '';
  const gb = !r.size ? '' : r.size >= 1e9 ? `${(r.size / 1e9).toFixed(r.size > 1e10 ? 0 : 1).replace('.', ',')} Go` : `${Math.max(1, Math.round(r.size / 1e6))} Mo`;
  return { quality: [res, hdr].filter(Boolean).join(' '), detail: [tag, codec, gb].filter(Boolean).join(' · ') };
}
