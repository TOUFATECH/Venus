// Noms lisibles dans l'adresse, sur le modèle du rangement des fichiers :
//   films    Inception.2010            séries   Breaking.Bad
//   saisons  Breaking.Bad.S01          épisodes Breaking.Bad.S01E02
//   clips    Daft.Punk.Around.The.World chaînes  France.24
// Deux titres identiques : le second reçoit son numéro (Dune.2021~851).
import { all } from './db.js';

const pad = (n) => String(n ?? 0).padStart(2, '0');
export function cleanName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/['’`´"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '');
}

function baseSlug(i, showTitles) {
  const show = i.show_id ? showTitles.get(i.show_id) : null;
  switch (i.type) {
    case 'movie': return cleanName(`${i.title}${i.year ? ` ${i.year}` : ''}`);
    case 'season': return `${cleanName(show || i.title)}.S${pad(i.season_num)}`;
    case 'episode': return `${cleanName(show || i.title)}.S${pad(i.season_num)}E${pad(i.episode_num)}${i.episode_end ? `-E${pad(i.episode_end)}` : ''}`;
    case 'clip': return cleanName(i.original_title ? `${i.original_title} ${i.title}` : i.title);
    default: return cleanName(i.title);
  }
}

let bySlug = new Map(), byId = new Map(), builtAt = 0, sig = '';
function ensure() {
  const now = Date.now();
  if (now - builtAt < 3000 && byId.size) return;
  builtAt = now;
  const [r] = all('SELECT COUNT(*) AS n, MAX(id) AS m, TOTAL(LENGTH(title)) AS t, TOTAL(year) AS y, TOTAL(LENGTH(original_title)) AS o FROM items');
  const s = `${r.n}:${r.m}:${r.t}:${r.y}:${r.o}`;
  if (s === sig && byId.size) return;
  sig = s;
  const rows = all('SELECT id, type, title, original_title, year, show_id, season_num, episode_num, episode_end FROM items ORDER BY id');
  const showTitles = new Map(rows.filter((x) => x.type === 'show').map((x) => [x.id, x.title]));
  bySlug = new Map(); byId = new Map();
  for (const i of rows) {
    let slug = baseSlug(i, showTitles) || String(i.id);
    if (bySlug.has(slug.toLowerCase())) slug = `${slug}~${i.id}`;
    bySlug.set(slug.toLowerCase(), i.id);
    byId.set(i.id, slug);
  }
}
export function slugFor(id) { ensure(); return byId.get(id) || String(id); }
export function resolveSlug(slug) {
  const s = String(slug || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  ensure();
  const tilde = /~(\d+)$/.exec(s);
  return bySlug.get(s.toLowerCase()) || (tilde ? Number(tilde[1]) : null);
}
// Après une modification du titre (correction d'identification, nouvel épisode…)
export function refreshSlugs() { sig = ''; builtAt = 0; }
