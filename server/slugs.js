// Noms lisibles dans l'adresse, sur le modèle du rangement des fichiers :
//   films    inception-2010            séries   breaking-bad
//   saisons  breaking-bad/S01          épisodes breaking-bad/S01E02
//   clips    daft-punk-around-the-world chaînes  france-24
// Deux titres identiques : le second reçoit son numéro (dune-2021~851).
// Les anciennes adresses en Majuscules.Avec.Des.Points restent comprises (comparaison sans casse ni ponctuation).
import { all, itemsVersion } from './db.js';

// Nombre sur deux chiffres (01, 02…)
const pad = (n) => String(n ?? 0).padStart(2, '0');
// Un titre devient une adresse lisible : minuscules, sans accents, mots séparés par des tirets
//   « Sword of the Demon Hunter - Kijin Gentosho » → sword-of-the-demon-hunter-kijin-gentosho
export function cleanName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`´"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// Adresse lisible de base d'un titre (« inception-2010 », « breaking-bad/S01E02 »)
function baseSlug(i, showTitles) {
  const show = i.show_id ? showTitles.get(i.show_id) : null;
  switch (i.type) {
    case 'movie': return cleanName(`${i.title}${i.year ? ` ${i.year}` : ''}`);
    case 'season': return `${cleanName(show || i.title)}-s${pad(i.season_num)}`;
    case 'episode': return `${cleanName(show || i.title)}-s${pad(i.season_num)}e${pad(i.episode_num)}${i.episode_end ? `-e${pad(i.episode_end)}` : ''}`;
    case 'clip': return cleanName(i.original_title ? `${i.original_title} ${i.title}` : i.title);
    case 'extra': return cleanName(`bonus ${i.title}`);
    case 'track': return cleanName(`${i.original_title || ''} ${i.title}`);
    default: return cleanName(i.title);
  }
}

let bySlug = new Map(), byId = new Map(), builtAt = 0, sig = '', checkedV = -1;
// Recalcule les adresses lisibles quand la bibliothèque change (doublons numérotés)
function ensure() {
  const now = Date.now();
  // Rien n'a été écrit dans la table des titres depuis la dernière vérification : rien à refaire. (Avant, toutes
  // les 3 secondes, la table entière était relue pour le savoir : 45 ms par requête avec 40 000 titres.)
  if (byId.size && (checkedV === itemsVersion || now - builtAt < 3000)) return;
  builtAt = now;
  checkedV = itemsVersion;
  const [r] = all('SELECT COUNT(*) AS n, MAX(id) AS m, TOTAL(LENGTH(title)) AS t, TOTAL(year) AS y, TOTAL(LENGTH(original_title)) AS o FROM items');
  const s = `${r.n}:${r.m}:${r.t}:${r.y}:${r.o}`;
  if (s === sig && byId.size) return;
  sig = s;
  // Les titres principaux passent en premier : ils gardent le nom sans numéro (les autres versions et les bonus reçoivent « ~numéro »)
  const rows = all(`SELECT id, type, category, title, original_title, year, show_id, season_num, episode_num, episode_end FROM items
    ORDER BY (type IN ('movie','show','channel','book','audiobook') AND version_of IS NULL) DESC, type = 'extra', id`);
  const showTitles = new Map(rows.filter((x) => x.type === 'show').map((x) => [x.id, x.title]));
  bySlug = new Map(); byId = new Map(); meta = new Map();
  for (const i of rows) {
    let slug = baseSlug(i, showTitles) || String(i.id);
    if (bySlug.has(slug.toLowerCase())) slug = `${slug}~${i.id}`;
    bySlug.set(slug.toLowerCase(), i.id);
    byId.set(i.id, slug);
    meta.set(i.id, { type: i.type, category: i.category, show: i.show_id, s: i.season_num, e: i.episode_num, end: i.episode_end });
  }
}
let meta = new Map();
// Adresse affichée dans le navigateur, rangée comme les dossiers :
//   films/Inception.2010 (fiche et lecture : même adresse)   séries/Breaking.Bad/S01E02   animes/Frieren/S01E02   clips/Daft.Punk.Around.The.World
// Les autres (chaînes, livres…) gardent /titre/… et /lecture/…
export function pathFor(id, { play = false } = {}) {
  ensure();
  const m = meta.get(id);
  const slug = byId.get(id) || String(id);
  if (!m) return play ? `/lecture/${slug}` : `/titre/${slug}`;
  const showCat = (sid) => (meta.get(sid) || {}).category === 'anime' ? 'animes' : 'series';
  if (m.type === 'movie') return `/films/${slug}`;
  if (m.type === 'clip' && m.category !== 'recording') return `/clips/${slug}`;
  if (m.type === 'show') return `/${m.category === 'anime' ? 'animes' : 'series'}/${slug}`;
  if (m.type === 'season' && m.show) return `/${showCat(m.show)}/${byId.get(m.show) || m.show}`;
  if (m.type === 'episode' && m.show) {
    const ep = `S${pad(m.s)}E${pad(m.e)}${m.end ? `-E${pad(m.end)}` : ''}`;
    return play ? `/${showCat(m.show)}/${byId.get(m.show) || m.show}/${ep}` : `/${showCat(m.show)}/${byId.get(m.show) || m.show}`;
  }
  return play ? `/lecture/${slug}` : `/titre/${slug}`;
}
// Épisode à partir de l'adresse /series/Breaking.Bad/S01E02
export function resolveEpisode(showSlug, ep) {
  const sid = resolveSlug(showSlug);
  const mm = /^S(\d{1,3})E(\d{1,4})/i.exec(String(ep || ''));
  if (!sid || !mm) return null;
  ensure();
  for (const [id, m] of meta) if (m.type === 'episode' && m.show === sid && m.s === Number(mm[1]) && m.e === Number(mm[2])) return id;
  return null;
}
// Adresse lisible d'un titre
export function slugFor(id) { ensure(); return byId.get(id) || String(id); }
// Titre correspondant à une adresse lisible (anciennes adresses comprises)
export function resolveSlug(slug) {
  const s = String(slug || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  ensure();
  const tilde = /~(\d+)$/.exec(s);
  // Les anciennes adresses (Breaking.Bad.S01E02) et les liens recopiés à la main passent par le même nettoyage
  const base = tilde ? s.slice(0, tilde.index) : s;
  return bySlug.get(s.toLowerCase()) || bySlug.get(cleanName(base)) || (tilde ? Number(tilde[1]) : null);
}
// Après une modification du titre (correction d'identification, nouvel épisode…)
export function refreshSlugs() { sig = ''; builtAt = 0; checkedV = -1; }
