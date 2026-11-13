// Venus · Médias automatiques — le moteur qui relie tout (dans Odin : Freyja → Hnoss · Demandes,
// Gersemi · Films, Hildisvíni · Séries, Musique, Sjöfn · Livres et livres audio, Fólkvangr · Téléchargements).
//
//   ♡ favori (ou demande) → envie → recherche dans TES sources → meilleure version (VF / MULTI, puis qualité)
//   → téléchargement (moteur de Venus ou client existant) → rangement dans la médiathèque → analyse de Venus
//   → plus tard : recherche d'une meilleure version (VF arrivée, meilleure qualité), nouveaux épisodes.
//
// Tout est gardé dans la base PostgreSQL de Venus (tables media_*). Rien n'est cherché ailleurs que dans les
// sources que tu as ajoutées ; un profil enfant ne déclenche jamais de téléchargement (un adulte décide).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, all, get, run, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { best, libraryName, parseRelease, DEFAULT_PROFILE, profileFor, cleanCategories, CATEGORIES } from './release.js';
import { client as externalClient } from './sources.js';
import { bygulSearch, countGrab, sourcesHealth } from './bygul.js';

db.exec(`CREATE TABLE IF NOT EXISTS media_wants (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, original TEXT, year INTEGER, season INTEGER, episode INTEGER,
  tmdb_id INTEGER, show_key TEXT, artist TEXT, author TEXT, anime INTEGER DEFAULT 0, release_date TEXT, profile_id INTEGER,
  status TEXT DEFAULT 'attente', progress INTEGER DEFAULT 0, score INTEGER, cible INTEGER DEFAULT 0, file TEXT,
  grab TEXT, tried TEXT, last_search INTEGER, next_search INTEGER, note TEXT, added_at INTEGER, done_at INTEGER,
  UNIQUE (kind, show_key, season, episode)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_media_wants_status ON media_wants(status)');
db.exec(`CREATE TABLE IF NOT EXISTS media_log (id INTEGER PRIMARY KEY, at INTEGER, want_id INTEGER, text TEXT)`);

// ---------------------------------------------------------------- réglages
// lots : combien d'envies cherchées par passage, et la pause entre deux recherches (pour ne pas saturer les sources)
const LOTS = { taille: 10, pauseS: 4, ameliorations: 5 };
export const acquireConf = () => ({
  on: String(getSetting('acquire_on', '0')) === '1', client: getSetting('acquire_client', null),
  profil: { ...DEFAULT_PROFILE, ...(getSetting('acquire_profile', {}) || {}) },
  categories: cleanCategories(getSetting('acquire_categories', {}) || {}),
  lots: { ...LOTS, ...(getSetting('acquire_lots', {}) || {}), parMinute: Number(getSetting('bygul_rpm', 10)) || 10 },
  roots: getSetting('acquire_roots', {}) || {}, upgrade: String(getSetting('acquire_upgrade', '1')) !== '0', keepSeeding: String(getSetting('acquire_seed', '1')) !== '0',
});
/** Les filtres de chaque catégorie tels qu'appliqués (départ + réglages). */
export const filtersView = () => { const c = acquireConf().categories; return Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, { ...profileFor(KIND_OF_CAT[k], c), reglee: !!c[k] }])); };
const KIND_OF_CAT = { films: { kind: 'movie' }, animation: { kind: 'movie', anime: true }, series: { kind: 'episode' }, animes: { kind: 'episode', anime: true }, musique: { kind: 'album' }, livres: { kind: 'book' }, livres_audio: { kind: 'audiobook' } };
export const acquireOn = () => acquireConf().on;
export function saveAcquire(b) {
  if (b.on !== undefined) setSetting('acquire_on', b.on ? '1' : '0');
  if (b.profil) setSetting('acquire_profile', { ...acquireConf().profil, ...b.profil });
  if (b.roots) setSetting('acquire_roots', { ...acquireConf().roots, ...b.roots });
  if (b.upgrade !== undefined) setSetting('acquire_upgrade', b.upgrade ? '1' : '0');
  if (b.keepSeeding !== undefined) setSetting('acquire_seed', b.keepSeeding ? '1' : '0');
  if (b.client !== undefined) setSetting('acquire_client', b.client);
  if (b.categories) {
    // null pour une catégorie = retour au filtre de départ
    const cur = acquireConf().categories, next = { ...cur };
    for (const [k, v] of Object.entries(b.categories)) { if (!CATEGORIES[k]) throw new Error(`catégorie inconnue : ${k}`); if (v === null) delete next[k]; else next[k] = { ...(cur[k] || {}), ...v, ...(v.langues ? { langues: { ...(cur[k]?.langues || {}), ...v.langues } } : {}) }; }
    setSetting('acquire_categories', cleanCategories(next));
  }
  if (b.lots) {
    const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d), cur = acquireConf().lots;
    setSetting('acquire_lots', { taille: n(b.lots.taille, 1, 100, cur.taille), pauseS: n(b.lots.pauseS, 0, 120, cur.pauseS), ameliorations: n(b.lots.ameliorations, 0, 50, cur.ameliorations) });
    // Limite par défaut de chaque source (recherches par minute), la source peut avoir la sienne
    if (b.lots.parMinute !== undefined) setSetting('bygul_rpm', n(b.lots.parMinute, 1, 120, 10));
  }
}
export const listSources = () => sourcesHealth();
export function addSource({ name, kind, url, key }) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new Error('Adresse invalide (ex. http://192.168.1.20:9117/api/v2.0/indexers/x/results/torznab)');
  if (!['torznab', 'newznab'].includes(kind)) throw new Error('Type de source : torznab ou newznab');
  const r = run('INSERT INTO media_sources(name, kind, url, key, enabled, added_at) VALUES(?, ?, ?, ?, 1, ?)', String(name || 'Source').slice(0, 80), kind, u, String(key || '').slice(0, 200), Date.now());
  return r.lastInsertRowid;
}
export const removeSource = (id) => run('DELETE FROM media_sources WHERE id = ?', Number(id));

// ---------------------------------------------------------------- journal
const log = (wantId, text) => { run('INSERT INTO media_log(at, want_id, text) VALUES(?, ?, ?)', Date.now(), wantId, String(text).slice(0, 500)); };
export const recentLog = (n = 60) => all('SELECT l.*, w.title, w.kind, w.season, w.episode FROM media_log l LEFT JOIN media_wants w ON w.id = l.want_id ORDER BY l.id DESC LIMIT ?', n);

// ---------------------------------------------------------------- envies
const rowOf = (w) => w && ({ ...w, grab: w.grab ? JSON.parse(w.grab) : null, tried: w.tried ? JSON.parse(w.tried) : [] });
export const wantsList = (where = '1=1', ...p) => all(`SELECT * FROM media_wants WHERE ${where} ORDER BY added_at DESC`, ...p).map(rowOf);
export const wantById = (id) => rowOf(get('SELECT * FROM media_wants WHERE id = ?', id));
/** Ajoute une envie (sans doublon). kind : movie | episode | album | book | audiobook */
export function addWant(w) {
  const key = w.showKey ?? (w.kind === 'movie' ? `movie:${w.tmdbId ?? w.title}` : w.kind === 'album' ? `album:${w.artist}|${w.title}` : `${w.kind}:${w.author ?? ''}|${w.title}`);
  const season = w.kind === 'episode' ? w.season : -1, episode = w.kind === 'episode' ? w.episode : -1;
  const have = get('SELECT id FROM media_wants WHERE kind = ? AND show_key = ? AND season = ? AND episode = ?', w.kind, key, season, episode);
  if (have) return have.id;
  const r = run(`INSERT INTO media_wants(kind, title, original, year, season, episode, tmdb_id, show_key, artist, author, anime, release_date, profile_id, status, added_at, next_search)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, w.kind, String(w.title).slice(0, 300), w.original ?? null, w.year ?? null, season, episode, w.tmdbId ?? null, key,
  w.artist ?? null, w.author ?? null, w.anime ? 1 : 0, w.date ?? null, w.profileId ?? null, w.date && w.date > today() ? 'pas_sorti' : 'attente', Date.now(), 0);
  log(r.lastInsertRowid, `Ajouté : ${label(w)}`);
  return r.lastInsertRowid;
}
const today = () => new Date().toISOString().slice(0, 10);
export const label = (w) => (w.kind === 'episode' ? `${w.title} S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}` : w.kind === 'album' ? `${w.artist} — ${w.title}` : w.kind === 'book' || w.kind === 'audiobook' ? `${w.title}${w.author ? ` (${w.author})` : ''}` : `${w.title}${w.year ? ` (${w.year})` : ''}`);
export function removeWant(id) { run('DELETE FROM media_wants WHERE id = ?', Number(id)); }
/**
 * Retiré des favoris / de « À venir » (et plus personne ne le veut) : les recherches s'arrêtent, les téléchargements
 * en cours sont annulés (fichiers partiels supprimés). Ce qui est déjà rangé dans la médiathèque n'est pas touché.
 */
export async function cancelFor(showKey, deps = defaultDeps) {
  const l = wantsList('show_key = ?', showKey); if (!l.length) return { cancelled: 0 };
  const ids = new Set(l.filter((w) => w.status === 'telechargement' && w.grab?.id).map((w) => w.grab.id));
  for (const id of ids) {
    // Une saison complète partagée avec une autre envie encore voulue n'est pas annulée
    if (get("SELECT 1 FROM media_wants WHERE show_key <> ? AND status = 'telechargement' AND grab LIKE ?", showKey, `%${String(id).replace(/[%_]/g, '')}%`)) continue;
    await deps.engine().remove(id, true).catch(() => {});
  }
  run('DELETE FROM media_wants WHERE show_key = ?', showKey);
  log(null, `Retiré : ${l[0].title} (${l.length} envie(s) arrêtée(s)${ids.size ? `, ${ids.size} téléchargement(s) annulé(s)` : ''})`);
  return { cancelled: l.length, downloads: ids.size };
}

/** Une envie de Venus (♡ « Mes envies ») → envies du moteur : le film, ou chaque épisode déjà diffusé de la série. */
export async function fromWish(profile, x, deps = defaultDeps) {
  if (profile?.max_age != null) return { state: 'kids' };
  if (x.type === 'movie') { addWant({ kind: 'movie', title: x.title, original: x.original, year: x.date ? Number(x.date.slice(0, 4)) : null, tmdbId: x.tmdbId, date: x.date, anime: x.anime, profileId: profile?.id }); return { state: 'processing' }; }
  const n = await followShow({ tmdbId: x.tmdbId, title: x.title, original: x.original, anime: x.anime, profileId: profile?.id }, deps).catch((e) => { log(null, `${x.title} : épisodes introuvables (${e.message})`); return 0; });
  return { state: 'processing', episodes: n };
}
/** Les épisodes diffusés d'une série (TMDB) qui ne sont pas encore dans Venus deviennent des envies. */
export async function followShow(s, deps = defaultDeps) {
  const d = await deps.tmdb(`/tv/${s.tmdbId}`); let n = 0;
  const key = `tv:${s.tmdbId}`, have = deps.episodesInLibrary(s.tmdbId);
  for (const se of (d.seasons || []).filter((x) => x.season_number > 0)) {
    const sd = await deps.tmdb(`/tv/${s.tmdbId}/season/${se.season_number}`);
    for (const ep of sd.episodes || []) {
      if (!ep.air_date || ep.air_date > today() || have.has(`${se.season_number}:${ep.episode_number}`)) continue;
      const before = get('SELECT id FROM media_wants WHERE kind = ? AND show_key = ? AND season = ? AND episode = ?', 'episode', key, se.season_number, ep.episode_number);
      if (!before) { addWant({ kind: 'episode', title: s.title || d.name, original: s.original || d.original_name, season: se.season_number, episode: ep.episode_number, tmdbId: s.tmdbId, showKey: key, anime: s.anime, date: ep.air_date, profileId: s.profileId }); n++; }
    }
  }
  return n;
}

// ---------------------------------------------------------------- recherche et choix
const nextDelay = (w) => { const age = Date.now() - (w.added_at || Date.now()); return age < 864e5 ? 3600e3 : age < 7 * 864e5 ? 6 * 3600e3 : 24 * 3600e3; };
/** Cherche une envie dans les sources ; prend la meilleure version (ou une meilleure que celle qu'on a). */
export async function searchWant(w, deps = defaultDeps) {
  const conf = acquireConf();
  if (!deps.hasSources()) return { ok: false, why: 'aucune source : ajoute une source dans Bygul (Réglages → Médias automatiques)' };
  const want = { kind: w.kind, title: w.title, original: w.original, year: w.year, season: w.season, episode: w.episode, artist: w.artist, author: w.author, anime: !!w.anime };
  const queries = [want, ...(w.original && w.original !== w.title ? [{ ...want, searchTitle: w.original }] : [])];
  let results = [], errors = [];
  for (const q of queries) { const r = await deps.search(q); results = results.concat(r.results); errors = errors.concat(r.errors); }
  const seen = new Set(); results = results.filter((r) => { const k = r.infohash || r.link; if (seen.has(k)) return false; seen.add(k); return true; });
  const deja = w.status === 'range' ? (w.score ?? 0) : null;
  const b = best(want, results, profileFor(want, conf.categories), deja, w.tried || []);
  run('UPDATE media_wants SET last_search = ?, next_search = ? WHERE id = ?', Date.now(), Date.now() + nextDelay(w), w.id);
  if (!b.pick) {
    const why = results.length ? `${results.length} résultat(s), aucun ne convient (${[...new Set(b.rejected.map((x) => x.why))].slice(0, 3).join(' ; ')})` : errors.length ? `sources en panne : ${errors.slice(0, 2).join(' ; ')}` : 'rien trouvé pour l’instant';
    if (w.status !== 'range') run('UPDATE media_wants SET status = ?, note = ? WHERE id = ?', 'pas_trouve', why, w.id);
    return { ok: false, why };
  }
  await grab(w, b.pick, deps);
  return { ok: true, pick: b.pick };
}
export async function grab(w, pick, deps = defaultDeps) {
  const tag = `venus-${w.id}-${crypto.randomBytes(3).toString('hex')}`;
  const engine = deps.engine();
  const id = await engine.add(pick.r, tag, deps.downloadDir(w));
  countGrab(pick.r.sourceId);
  const g = { at: Date.now(), engine: engine.name, id: id || pick.r.infohash || null, tag, title: pick.r.title, link: pick.r.link, score: pick.score, cible: pick.cible, indexer: pick.r.indexer, upgrade: w.status === 'range' };
  run('UPDATE media_wants SET status = ?, progress = 0, grab = ?, note = NULL WHERE id = ?', 'telechargement', JSON.stringify(g), w.id);
  // Une saison complète choisie pour un épisode : les autres épisodes voulus de cette saison la suivent
  if (w.kind === 'episode' && pick.p.pack) run("UPDATE media_wants SET status = 'telechargement', grab = ? WHERE kind = 'episode' AND show_key = ? AND season = ? AND id <> ? AND status IN ('attente','pas_trouve')", JSON.stringify({ ...g, pack: true }), w.show_key, w.season, w.id);
  log(w.id, `${g.upgrade ? 'Meilleure version' : 'Téléchargement'} : ${pick.r.title} (note ${pick.score}${pick.cible ? ', qualité visée' : ''})`);
}

// ---------------------------------------------------------------- suivi des téléchargements et rangement
const EXEC = /\.(exe|scr|bat|cmd|msi|com|vbs|vbe|js|jse|wsf|jar|apk|lnk|ps1|pif|hta|cpl|dll|sh|run|bin|app|dmg|deb|rpm)$/i;
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv)$/i, AUDIO = /\.(flac|mp3|m4a|aac|ogg|opus|wav|alac)$/i, BOOK = /\.(epub|pdf|mobi|azw3?|cbz|cbr)$/i, AUDIOBOOK = /\.(m4b|mp3|m4a|aac|ogg|opus)$/i;
function filesUnder(p) {
  let st; try { st = fs.statSync(p); } catch { return []; }
  if (st.isFile()) return [{ path: p, size: st.size }];
  const out = []; const walk = (d, depth) => { let names = []; try { names = fs.readdirSync(d); } catch { return; } for (const n of names) { const f = path.join(d, n); let s; try { s = fs.statSync(f); } catch { continue; } if (s.isDirectory()) { if (depth < 4) walk(f, depth + 1); } else out.push({ path: f, size: s.size }); } };
  walk(p, 0); return out;
}
/** Place un fichier dans la médiathèque : lien dur si possible (le partage continue), sinon copie. */
function place(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.venus-part`;
  try { fs.linkSync(src, tmp); } catch { fs.copyFileSync(src, tmp); }
  fs.renameSync(tmp, dest);
}
/** Range les fichiers d'un téléchargement fini pour les envies qui l'attendent. */
export function importDone(item, wants, deps = defaultDeps) {
  const conf = acquireConf(), all0 = filesUnder(item.path), files = all0.filter((f) => !/sample/i.test(f.path));
  const done = [];
  // Un fichier exécutable dans un téléchargement de média = piège : rien n'est rangé, le téléchargement est supprimé,
  // la version est notée « essayée » et une autre sera cherchée.
  const exe = all0.find((f) => EXEC.test(f.path));
  if (exe) {
    for (const w of wants) { run('UPDATE media_wants SET status = ?, tried = ?, grab = NULL, next_search = 0, note = ? WHERE id = ?', w.file ? 'range' : 'attente', JSON.stringify([...(w.tried || []), w.grab?.link].filter(Boolean)), `fichier exécutable bloqué (${path.basename(exe.path)}) : une autre version sera cherchée`, w.id); log(w.id, `Fichier exécutable bloqué, téléchargement supprimé : ${path.basename(exe.path)}`); }
    if (item.id) deps.engine().remove(item.id, true).catch(() => {});
    return done;
  }
  for (const w of wants) {
    const root = deps.rootFor(w); if (!root) { run('UPDATE media_wants SET status = ?, note = ? WHERE id = ?', 'erreur', 'aucun dossier de médiathèque pour ce type (Réglages → Médias automatiques)', w.id); continue; }
    const want = { kind: w.kind, title: w.title, year: w.year, season: w.season, episode: w.episode, artist: w.artist, author: w.author };
    let chosen = [];
    if (w.kind === 'movie') chosen = files.filter((f) => VIDEO.test(f.path)).sort((a, b) => b.size - a.size).slice(0, 1);
    else if (w.kind === 'episode') { const v = files.filter((f) => VIDEO.test(f.path)); chosen = v.filter((f) => { const p = parseRelease(path.basename(f.path)); return p.season === w.season && p.episodes.includes(w.episode); }).slice(0, 1); if (!chosen.length && v.length === 1 && !w.grab?.pack) chosen = v; }
    else if (w.kind === 'album') chosen = files.filter((f) => AUDIO.test(f.path) || /\.(jpg|png|cue|log)$/i.test(f.path));
    else if (w.kind === 'audiobook') chosen = files.filter((f) => AUDIOBOOK.test(f.path) || /\.(jpg|png)$/i.test(f.path));
    else chosen = files.filter((f) => BOOK.test(f.path)).sort((a, b) => b.size - a.size).slice(0, 1);
    if (!chosen.length) { run('UPDATE media_wants SET status = ?, note = ? WHERE id = ?', 'erreur', 'téléchargement fini mais aucun fichier qui convient dedans', w.id); log(w.id, 'Aucun fichier qui convient dans le téléchargement'); continue; }
    const p = parseRelease(w.grab?.title || item.name);
    let first = null;
    if (w.kind === 'album' || w.kind === 'audiobook') {
      const dir = path.join(root, libraryName(want, p, ''));
      for (const f of chosen) { const d = path.join(dir, path.basename(f.path)); place(f.path, d); first ??= d; }
    } else {
      const dest = path.join(root, libraryName(want, p, path.extname(chosen[0].path)));
      // Une meilleure version remplace l'ancienne (gardée 7 jours dans la corbeille de Venus)
      if (w.file && w.file !== dest && fs.existsSync(w.file)) deps.trash(w.file, root);
      place(chosen[0].path, dest); first = dest;
      // Sous-titres à côté (même nom)
      for (const s of files.filter((f) => /\.(srt|ass|vtt)$/i.test(f.path) && (w.kind === 'movie' || parseRelease(path.basename(f.path)).episodes.includes(w.episode)))) { try { place(s.path, dest.replace(/\.[^.]+$/, `${/\.fr|french|vf/i.test(s.path) ? '.fr' : ''}${path.extname(s.path)}`)); } catch { /* déjà là */ } }
    }
    run('UPDATE media_wants SET status = ?, progress = 100, file = ?, score = ?, cible = ?, done_at = ?, note = NULL, next_search = ? WHERE id = ?', 'range', first, w.grab?.score ?? null, w.grab?.cible ? 1 : 0, Date.now(), Date.now() + 7 * 864e5, w.id);
    log(w.id, `Rangé dans la médiathèque : ${first}`);
    done.push({ w, file: first });
  }
  if (done.length) deps.scan();
  if (!conf.keepSeeding && item.id) deps.engine().remove(item.id).catch(() => {});
  return done;
}
/** Un passage : progression des téléchargements, rangement de ceux qui sont finis. */
export async function poll(deps = defaultDeps) {
  const active = wantsList("status = 'telechargement'"); if (!active.length) return { active: 0 };
  const items = await deps.engine().list();
  const byKey = new Map(); for (const it of items) { if (it.id) byKey.set(String(it.id).toLowerCase(), it); for (const t of it.tags || []) byKey.set(t, it); }
  const groups = new Map();
  for (const w of active) {
    const it = byKey.get(w.grab?.tag) || (w.grab?.id && byKey.get(String(w.grab.id).toLowerCase())); if (!it) continue;
    if (it.failed) { run('UPDATE media_wants SET status = ?, tried = ?, grab = NULL, next_search = 0, note = ? WHERE id = ?', w.score ? 'range' : 'attente', JSON.stringify([...(w.tried || []), w.grab.link]), 'téléchargement en échec : une autre version sera cherchée', w.id); log(w.id, `Échec du téléchargement : ${w.grab.title}`); continue; }
    if (!it.done) { run('UPDATE media_wants SET progress = ? WHERE id = ?', it.progress, w.id); continue; }
    const k = it.id || it.name; groups.set(k, { it, wants: [...(groups.get(k)?.wants || []), w] });
  }
  let n = 0; for (const { it, wants } of groups.values()) n += importDone(it, wants, deps).length;
  return { active: active.length, imported: n };
}
/** Un passage : cherche ce qui manque (et les meilleures versions), sans tout chercher à la fois. */
export async function searchDue(deps = defaultDeps, limit = null) {
  const conf = acquireConf(), now = Date.now(); limit ??= conf.lots.taille;
  run("UPDATE media_wants SET status = 'attente' WHERE status = 'pas_sorti' AND release_date <= ?", today());
  const due = wantsList("status IN ('attente','pas_trouve') AND (next_search IS NULL OR next_search <= ?)", now).slice(0, limit);
  if (conf.upgrade) due.push(...wantsList("status = 'range' AND cible = 0 AND kind IN ('movie','episode') AND (next_search IS NULL OR next_search <= ?) AND done_at > ?", now, now - 60 * 864e5).slice(0, conf.lots.ameliorations));
  const out = [];
  // Par lots : une envie après l'autre, avec une pause, pour ne pas saturer les sources. Le reste attend le passage suivant.
  for (const [i, w] of due.entries()) {
    if (i && conf.lots.pauseS) await deps.sleep(conf.lots.pauseS * 1000);
    // Les autres épisodes d'une saison déjà prise en entier ne sont pas recherchés
    const fresh = wantById(w.id); if (!fresh || (fresh.status === 'telechargement' && w.status !== 'telechargement')) continue;
    try { out.push({ id: w.id, ...(await searchWant(fresh, deps)) }); } catch (e) { log(w.id, `Recherche impossible : ${e.message}`); }
  }
  return out;
}

// ---------------------------------------------------------------- dépendances réelles (remplaçables dans les tests)
export const defaultDeps = {
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  hasSources: () => !!get('SELECT 1 FROM media_sources WHERE enabled = 1 LIMIT 1'),
  search: (want) => bygulSearch(want),
  tmdb: async (p) => (await import('../metadata.js')).tmdb(p),
  episodesInLibrary: (tmdbId) => new Set(all("SELECT e.season_num s, e.episode_num e FROM items e JOIN items s ON s.id = e.show_id WHERE s.tmdb_id = ? AND e.type = 'episode'", tmdbId).map((r) => `${r.s}:${r.e}`)),
  engine: () => {
    const c = acquireConf().client;
    if (c && c.type && c.type !== 'venus') { const x = externalClient(c); return { name: c.type, ...x }; }
    return { name: 'venus', ...nativeEngine() };
  },
  downloadDir: () => getSetting('acquire_download_dir', '') || path.join(config.dataDir, 'telechargements'),
  rootFor: (w) => {
    const r = acquireConf().roots, type = w.kind === 'movie' ? 'movies' : w.kind === 'episode' ? (w.anime ? 'anime' : 'shows') : w.kind === 'album' ? 'music' : w.kind === 'audiobook' ? 'audiobooks' : 'books';
    return r[type] || get('SELECT path FROM libraries WHERE type = ? ORDER BY id LIMIT 1', type)?.path || null;
  },
  trash: (file, root) => { import('../trash.js').then((t) => t.moveToTrash(file, root)).catch(() => {}); },
  scan: () => { import('../scanner.js').then((s) => s.scheduleScan(4000)).catch(() => {}); },
};
let native = null;
export const setNativeEngine = (f) => { native = f; };
const nativeEngine = () => { if (!native) throw new Error('Le moteur de téléchargement de Venus (Fólkvangr) n’est pas chargé'); return native(); };

// ---------------------------------------------------------------- tâche de fond
let timers = [], looking = false, kickTimer = null;
const look = async () => {
  if (!acquireOn() || looking) return; looking = true;
  try { await searchDue(); } catch (e) { console.warn('[médias] recherche :', e.message); } finally { looking = false; }
};
/** Une envie vient d'arriver (♡, À venir, Télécharger) : la recherche part dans quelques secondes, sans attendre le passage. */
export function kickSearch(delay = 5000) {
  if (kickTimer) return; kickTimer = setTimeout(() => { kickTimer = null; look(); }, delay); kickTimer.unref?.();
}
export function startAcquire() {
  const tick = async () => { if (!acquireOn()) return; try { await poll(); } catch (e) { console.warn('[médias] suivi :', e.message); } };
  timers = [setInterval(tick, 60000), setInterval(look, 15 * 60000), setTimeout(look, 90000)];
  for (const t of timers) t.unref?.();
}

/** L'état d'une envie de « Mes envies » pour l'écran (même forme que l'état Seerr : state, downloading, progress). */
export function wishState(type, tmdbId) {
  const l = type === 'movie' ? wantsList('show_key = ?', `movie:${tmdbId}`) : wantsList('show_key = ?', `tv:${tmdbId}`);
  if (!l.length) return { state: 'none' };
  const dl = l.filter((w) => w.status === 'telechargement');
  if (dl.length) return { state: 'processing', downloading: true, progress: Math.round(dl.reduce((a, w) => a + (w.progress || 0), 0) / dl.length) };
  if (l.every((w) => w.status === 'range')) return { state: 'available' };
  if (l.some((w) => w.status === 'range')) return { state: 'partial' };
  if (l.some((w) => w.status === 'erreur')) return { state: 'error', error: l.find((w) => w.status === 'erreur').note };
  return { state: 'processing' };
}

/** Téléchargement choisi à la main dans Bygul : une envie est créée (ou reprise) puis le résultat est téléchargé. */
export async function grabManual(b, deps = defaultDeps) {
  const want = { kind: b.kind, title: b.name || b.title, year: b.year, season: b.season, episode: b.episode };
  const id = addWant({ ...want, showKey: b.kind === 'episode' ? `manuel:${(b.name || b.title).toLowerCase()}` : undefined });
  const w = wantById(id);
  await grab(w, { r: { title: b.title, link: b.link, sourceId: b.sourceId, infohash: /btih:([a-f0-9]{40})/i.exec(b.link)?.[1]?.toLowerCase() }, score: 0, cible: false, p: parseRelease(b.title) }, deps);
  return { ok: true, id };
}
