// VF : quels titres ont une piste audio française, la demande de la version française à Radarr / Sonarr, et
// l'annonce quand elle arrive.
// - Détection : piste audio en français (langue fre / fra / fr…, ou nommée « VF », « Français », « French »)
//   d'après l'analyse des fichiers. Une série est « VF » quand tous ses épisodes analysés l'ont, « VF partielle »
//   sinon (12/24). Calculé en une requête et gardé tant que la médiathèque ne change pas.
// - Demande : « Chercher en VF » crée (une fois) dans Radarr / Sonarr un format « VF (Venus) » (audio français, ou
//   VF / VFF / TRUEFRENCH / FRENCH / MULTI dans le nom de la sortie) et une copie du profil de qualité du titre qui
//   préfère ce format ; le titre passe sur cette copie, puis la recherche est lancée. Les autres titres et tes
//   profils ne changent pas. Radarr / Sonarr remplacent le fichier quand une version française est trouvée.
// - Arrivée : quand un film passe en VF ou qu'une série gagne des épisodes en VF, notification, et l'évènement
//   rejoint le fil des arrivées (lu par Odin).
import { all, get, getSetting, setSetting, itemsVersion } from './db.js';
import { HttpError } from './http.js';
import { call, arrOn, arrGrab, forgetKnown } from './arr.js';
import { notify } from './notify.js';
import { pathFor } from './slugs.js';

const FR = `EXISTS(SELECT 1 FROM json_each(probe, '$.audio') a WHERE lower(json_extract(a.value, '$.lang')) IN ('fre', 'fra', 'fr', 'fr-fr', 'fr-ca', 'fr-be', 'fr-ch')
  OR json_extract(a.value, '$.title') LIKE '%VF%' OR json_extract(a.value, '$.title') LIKE '%fran%' OR json_extract(a.value, '$.title') LIKE '%french%')`;
const HAS_FR = `CASE WHEN json_valid(probe) AND ${FR} THEN 1 ELSE 0 END`;

let cache = { v: -1, shows: new Map(), movies: new Map() };
// Index des titres disponibles en VF (en cache)
export function vfIndex() {
  if (cache.v === itemsVersion) return cache;
  const shows = new Map(all(`SELECT show_id AS id, COUNT(*) AS n, SUM(${HAS_FR}) AS vf FROM items WHERE type = 'episode' AND probe IS NOT NULL AND show_id IS NOT NULL GROUP BY show_id`).map((r) => [r.id, { n: r.n, vf: r.vf }]));
  const movies = new Map(all(`SELECT id, ${HAS_FR} AS vf FROM items WHERE type IN ('movie', 'clip') AND probe IS NOT NULL`).map((r) => [r.id, !!r.vf]));
  cache = { v: itemsVersion, shows, movies };
  return cache;
}
/** État VF d'un titre : { state: 'vf' | 'partiel' | 'vo', vf, n } ; null tant que rien n'est analysé. */
export function vfOf(item) {
  const x = vfIndex();
  if (item.type === 'show') {
    const s = x.shows.get(item.id); if (!s) return null;
    return { state: s.vf === 0 ? 'vo' : s.vf >= s.n ? 'vf' : 'partiel', vf: s.vf, n: s.n };
  }
  const m = x.movies.get(item.id);
  return m == null ? null : { state: m ? 'vf' : 'vo' };
}
/** Épisodes d'une série avec ou sans VF (fiche : pastille par épisode). */
export const vfEpisodes = (showId) => new Set(all(`SELECT id FROM items WHERE show_id = ? AND type = 'episode' AND probe IS NOT NULL AND json_valid(probe) AND ${FR}`, showId).map((r) => r.id));

// ------------------------------------------------------------------ demande à Radarr / Sonarr
const FORMAT = 'VF (Venus)';
const FRENCH = 2; // identifiant de la langue française dans Radarr et Sonarr
const TITLE_RX = '\\b(VFF|VFQ|VFI|VF2|VF|TRUEFRENCH|FRENCH|MULTI)\\b';
// Crée une fois le format « VF (Venus) » dans Radarr / Sonarr
async function ensureFormat(app) {
  const list = await call(app, '/api/v3/customformat').catch((e) => { throw new HttpError(502, /404/.test(e.message) ? `${app === 'sonarr' ? 'Sonarr' : 'Radarr'} est trop ancien (formats personnalisés : Sonarr 4 ou Radarr 3 au moins)` : e.message); }) || [];
  const have = list.find((f) => f.name === FORMAT);
  if (have) return have.id;
  const made = await call(app, '/api/v3/customformat', { method: 'POST', body: { name: FORMAT, includeCustomFormatWhenRenaming: false, specifications: [
    { name: 'Audio français', implementation: 'LanguageSpecification', negate: false, required: false, fields: [{ name: 'value', value: FRENCH }] },
    { name: 'VF dans le nom', implementation: 'ReleaseTitleSpecification', negate: false, required: false, fields: [{ name: 'value', value: TITLE_RX }] },
  ] } });
  return made.id;
}
/** Copie du profil du titre qui préfère la VF (créée une fois par profil d'origine). */
async function vfProfile(app, baseId, formatId) {
  const profiles = await call(app, '/api/v3/qualityprofile') || [];
  const base = profiles.find((p) => p.id === baseId);
  if (!base) throw new HttpError(404, 'Profil de qualité du titre introuvable');
  if (/\+ VF$/.test(base.name)) return base.id;
  const name = `${base.name} + VF`;
  const items = (base.formatItems || []).filter((x) => x.format !== formatId).concat([{ format: formatId, name: FORMAT, score: 1000 }]);
  const want = { ...base, name, upgradeAllowed: true, formatItems: items, minFormatScore: 0, cutoffFormatScore: Math.max(1000, base.cutoffFormatScore || 0) };
  delete want.id;
  const exist = profiles.find((p) => p.name === name);
  if (exist) { await call(app, `/api/v3/qualityprofile/${exist.id}`, { method: 'PUT', body: { ...want, id: exist.id } }); return exist.id; }
  return (await call(app, '/api/v3/qualityprofile', { method: 'POST', body: want })).id;
}
// Texte simplifié pour comparer
const n = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** « Chercher en VF » : le titre passe sur le profil qui préfère la VF, puis Radarr / Sonarr le cherchent. */
export async function wantFrench(item) {
  const movie = item.type === 'movie', app = movie ? 'radarr' : 'sonarr', name = movie ? 'Radarr' : 'Sonarr';
  if (!['movie', 'show'].includes(item.type)) throw new HttpError(400, 'Seuls les films et les séries se demandent en VF');
  if (!arrOn(app)) throw new HttpError(400, `${name} n’est pas relié (Réglages → Demandes)`);
  const findIt = async () => {
    if (movie) { const l = await call(app, '/api/v3/movie') || []; return l.find((m) => (item.tmdb_id && m.tmdbId === Number(item.tmdb_id)) || (item.imdb_id && m.imdbId === item.imdb_id)) || l.find((m) => n(m.title) === n(item.title) && (!item.year || Math.abs((m.year || 0) - item.year) <= 1)); }
    const l = await call(app, '/api/v3/series') || [];
    return l.find((x) => (item.tvdb_id && x.tvdbId === Number(item.tvdb_id)) || (item.imdb_id && x.imdbId === item.imdb_id)) || l.find((x) => n(x.title) === n(item.title) || n(x.title) === n(item.original_title));
  };
  let it = await findIt(), added = false;
  if (!it) {
    // Pas encore suivi : ajouté d'abord (comme « Demander »)
    await arrGrab({ kind: movie ? 'movie' : item.category === 'anime' ? 'anime' : 'show', tmdb: movie ? Number(item.tmdb_id) || null : null, tvdb: !movie ? Number(item.tvdb_id) || null : null, imdb: item.imdb_id || null, title: item.title, year: item.year });
    forgetKnown(); it = await findIt(); added = true;
    if (!it) throw new HttpError(404, `${name} ne trouve pas ce titre`);
  }
  const formatId = await ensureFormat(app);
  const profileId = await vfProfile(app, it.qualityProfileId, formatId);
  if (it.qualityProfileId !== profileId) await call(app, `/api/v3/${movie ? 'movie' : 'series'}/${it.id}`, { method: 'PUT', body: { ...it, qualityProfileId: profileId, monitored: true } });
  await call(app, '/api/v3/command', { method: 'POST', body: movie ? { name: 'MoviesSearch', movieIds: [it.id] } : { name: 'SeriesSearch', seriesId: it.id } });
  const wanted = getSetting('vf_wanted', {}) || {}; wanted[item.id] = Date.now(); setSetting('vf_wanted', wanted);
  return { ok: true, app: name, added, text: `${name} cherche « ${item.title} » en version française${added ? ' (titre ajouté)' : ''}. Dès qu’elle arrive, elle remplace l’ancienne et tu es prévenu.` };
}

// ------------------------------------------------------------------ arrivée de la VF
const MAX_EVENTS = 300;
/** Compare l'état VF à la dernière vérification : nouveaux épisodes ou films en VF → notification + évènement. */
export async function checkVfArrivals() {
  const x = vfIndex(), before = getSetting('vf_seen', null);
  const now = {};
  for (const [id, s] of x.shows) now[`s${id}`] = s.vf;
  for (const [id, v] of x.movies) if (v) now[`m${id}`] = 1;
  setSetting('vf_seen', now);
  if (!before) return 0; // première fois : rien à annoncer
  const events = getSetting('vf_events', []) || [];
  const wanted = getSetting('vf_wanted', {}) || {};
  let count = 0;
  for (const [k, v] of Object.entries(now)) {
    const was = Number(before[k] || 0); if (v <= was) continue;
    const id = Number(k.slice(1)), it = get('SELECT id, title, type FROM items WHERE id = ?', id); if (!it) continue;
    const body = it.type === 'show' ? `« ${it.title} » : ${v - was} épisode${v - was > 1 ? 's' : ''} de plus en VF (${v} au total)` : `« ${it.title} » est disponible en VF`;
    events.push({ at: Date.now(), kind: 'vf', id, title: it.title, type: it.type, added: v - was, total: v, text: body });
    count++;
    // Titre tout nouveau : déjà annoncé comme arrivée ; on prévient pour la VF d'un titre déjà là (ou demandée)
    if ((k in before || wanted[id]) && String(getSetting('notify_vf', '1')) !== '0') await notify({ title: 'VF disponible', body, url: pathFor(id) || `/titre/${id}`, tag: `vf-${id}` }, { adminOnly: !wanted[id] }).catch(() => {});
    if (it.type === 'movie' && wanted[id]) delete wanted[id];
  }
  setSetting('vf_events', events.slice(-MAX_EVENTS)); setSetting('vf_wanted', wanted);
  return count;
}

/** Fil des arrivées depuis une date : épisodes, films et clips ajoutés, et VF arrivées (pour Odin). */
export function arrivals(since, limit = 100) {
  const eps = all(`SELECT e.id, e.season_num AS season, e.episode_num AS episode, e.title, e.added_at AS at, s.id AS showId, s.title AS show, s.category FROM items e JOIN items s ON s.id = e.show_id
    WHERE e.type = 'episode' AND e.added_at > ? ORDER BY e.added_at DESC LIMIT ?`, since, limit);
  const films = all(`SELECT id, title, year, type, added_at AS at FROM items WHERE type IN ('movie', 'show') AND added_at > ? ORDER BY added_at DESC LIMIT ?`, since, limit);
  const x = vfIndex();
  const out = [
    ...eps.map((e) => ({ kind: 'episode', at: e.at, id: e.id, showId: e.showId, show: e.show, anime: e.category === 'anime', season: e.season, episode: e.episode, title: e.title, path: pathFor(e.id, { play: true }) })),
    ...films.map((f) => ({ kind: f.type === 'show' ? 'show' : 'movie', at: f.at, id: f.id, title: f.title, year: f.year, vf: f.type === 'movie' ? x.movies.get(f.id) ?? null : null, path: pathFor(f.id) })),
    ...(getSetting('vf_events', []) || []).filter((v) => v.at > since).map((v) => ({ ...v, path: pathFor(v.id) })),
  ];
  // VF des épisodes ajoutés (une requête pour tous)
  const ids = out.filter((o) => o.kind === 'episode').map((o) => o.id);
  if (ids.length) {
    const fr = new Set(all(`SELECT id FROM items WHERE id IN (${ids.map(() => '?').join(',')}) AND probe IS NOT NULL AND json_valid(probe) AND ${FR}`, ...ids).map((r) => r.id));
    const probed = new Set(all(`SELECT id FROM items WHERE id IN (${ids.map(() => '?').join(',')}) AND probe IS NOT NULL`, ...ids).map((r) => r.id));
    for (const o of out) if (o.kind === 'episode') o.vf = probed.has(o.id) ? fr.has(o.id) : null;
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Un épisode précis d'une série : le dernier, le suivant à voir (profil), ou saison / épisode donnés. */
export function pickEpisode(showId, which, { season, episode, profileId } = {}) {
  const eps = all(`SELECT id, season_num AS season, episode_num AS episode, title FROM items WHERE show_id = ? AND type = 'episode' AND season_num > 0 ORDER BY season_num, episode_num`, showId);
  if (!eps.length) return null;
  if (which === 'last') return eps[eps.length - 1];
  if (which === 'first') return eps[0];
  if (which === 'exact') return eps.find((e) => e.season === season && e.episode === episode) || (season == null ? eps.find((e) => e.episode === episode) : null);
  // Suivant : après le dernier épisode vu (ou commencé) par ce profil
  const seen = profileId ? all(`SELECT p.item_id AS id, p.watched, p.position FROM progress p JOIN items i ON i.id = p.item_id WHERE p.profile_id = ? AND i.show_id = ?`, profileId, showId) : [];
  const done = new Map(seen.map((s) => [s.id, s]));
  let last = -1;
  eps.forEach((e, i) => { if (done.has(e.id)) last = i; });
  if (last >= 0 && !done.get(eps[last].id).watched) return eps[last];
  return eps[Math.min(eps.length - 1, last + 1)];
}
