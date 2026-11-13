// Distribution et équipe sans clé TMDB, et filmographie d'une personne.
//  - Films et séries : fiche Cinemeta (catalogue public, à partir de l'identifiant IMDb trouvé sans clé) :
//    acteurs avec leur rôle et leur photo, réalisation, scénario, note IMDb.
//  - Séries (si Cinemeta n'a rien) : TVmaze (acteurs, personnages, photos, créateurs).
//  - Filmographie d'un acteur (films et séries hors de la médiathèque) : Wikidata, avec les affiches de Cinemeta.
import { getJson, findImdb, CINEMETA } from './posters.js';
import { run } from './db.js';

const TVMAZE = process.env.VENUS_TVMAZE_API || 'https://api.tvmaze.com';
const photo = (p) => (p ? `t_w185_${String(p).replace(/^\//, '').replace(/[^\w.]/g, '')}` : null);
// Retire les personnes en double
const uniq = (list) => { const s = new Set(); return list.filter((p) => p && p.name && !s.has(p.name) && s.add(p.name)); };

// Distribution et équipe d'un titre sans clé TMDB
export async function freeCredits(item, imdb) {
  const kind = item.type === 'movie' ? 'movie' : 'tv';
  let id = imdb || item.imdb_id || null;
  if (!id) {
    const f = await findImdb(kind, item.original_title || item.title, item.year).catch(() => null)
      || (item.original_title && item.original_title !== item.title ? await findImdb(kind, item.title, item.year).catch(() => null) : null);
    id = f && f.imdbId;
  }
  let credits = null, rating = null;
  if (id) {
    const d = await getJson(`${CINEMETA}/meta/${kind === 'movie' ? 'movie' : 'series'}/${id}.json`).catch(() => null);
    const m = d && d.meta;
    if (m) {
      const castRaw = Array.isArray(m.credits_cast) && m.credits_cast.length ? m.credits_cast : (m.cast || []).map((name) => ({ name }));
      const crew = Array.isArray(m.credits_crew) ? m.credits_crew : [];
      const by = (re, fallback) => uniq(crew.filter((p) => re.test(p.job || '')).map((p) => ({ name: p.name, photo: photo(p.profile_path) }))).slice(0, 6)
        .concat(crew.length ? [] : (fallback || []).map((name) => ({ name, photo: null })));
      credits = {
        cast: uniq(castRaw.map((p) => ({ name: p.name, role: p.character || '', photo: photo(p.profile_path) }))).slice(0, 30),
        directors: by(/^Director$/, m.director), writers: by(/^(Screenplay|Writer|Story|Novel|Author)$/, m.writer).slice(0, 4), creators: [],
        composers: by(/^(Original Music Composer|Music)$/).slice(0, 2), studios: [], networks: [], countries: m.country ? String(m.country).split(/,\s*/) : [], tags: [], status: m.status || null,
      };
      if (!credits.cast.length && !credits.directors.length) credits = null;
      const r = parseFloat(m.imdbRating);
      if (r) rating = { v: r, max: 10, url: `https://www.imdb.com/fr/title/${id}/` };
    }
  }
  // Séries : TVmaze en secours
  if (!credits && kind === 'tv') {
    let tvm = item.tvmaze_id;
    if (!tvm) { const s = await getJson(`${TVMAZE}/singlesearch/shows?q=${encodeURIComponent(item.title)}`).catch(() => null); tvm = s && s.id; if (tvm) run('UPDATE items SET tvmaze_id = ? WHERE id = ?', tvm, item.id); }
    if (tvm) {
      const s = await getJson(`${TVMAZE}/shows/${tvm}?embed[]=cast&embed[]=crew`).catch(() => null);
      const e = (s && s._embedded) || {};
      const cast = (e.cast || []).map((c) => ({ name: c.person && c.person.name, role: c.character && c.character.name || '', photo: c.person && c.person.image ? c.person.image.medium || c.person.image.original : null }));
      const crew = e.crew || [];
      credits = {
        cast: uniq(cast).slice(0, 30), directors: [], writers: [], composers: [], studios: [], countries: [], tags: [],
        creators: uniq(crew.filter((c) => /Creator|Developer/i.test(c.type)).map((c) => ({ name: c.person.name, photo: c.person.image ? c.person.image.medium : null }))).slice(0, 4),
        networks: s && (s.network || s.webChannel) ? [(s.network || s.webChannel).name] : [], status: s && s.status === 'Running' ? 'Returning Series' : s ? s.status : null,
      };
      if (!credits.cast.length && !credits.creators.length) credits = null;
      if (!id && s && s.externals && s.externals.imdb) id = s.externals.imdb;
    }
  }
  return credits || id ? { credits, imdb: id || null, rating } : null;
}

// ------------------------------------------------------------------ filmographie (Wikidata)
const cache = new Map();
// Filmographie d'une personne (en cache)
export async function filmography(name) {
  const key = String(name || '').trim();
  if (!key) return [];
  const c = cache.get(key);
  if (c && Date.now() - c.at < 7 * 864e5) return c.list;
  // Œuvres (films, séries) dont la personne est actrice (P161), réalisatrice (P57) ou créatrice (P170/P58)
  const lit = JSON.stringify(key);
  const q = `SELECT ?w ?title ?date ?imdb ?type WHERE {
    ?p rdfs:label ${lit}@en . ?p wdt:P31 wd:Q5 .
    { ?w wdt:P161 ?p } UNION { ?w wdt:P57 ?p } UNION { ?w wdt:P170 ?p } UNION { ?w wdt:P58 ?p }
    ?w wdt:P345 ?imdb .
    VALUES ?type { wd:Q11424 wd:Q24869 wd:Q5398426 wd:Q506240 wd:Q202866 wd:Q63952888 wd:Q1259759 wd:Q581714 }
    ?w wdt:P31 ?type .
    OPTIONAL { ?w wdt:P577 ?date }
    OPTIONAL { ?w rdfs:label ?title FILTER(LANG(?title) = "fr") }
  } LIMIT 300`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Venus/1.0 (serveur multimédia personnel)' }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const d = await res.json();
  const SERIES = new Set(['Q5398426', 'Q63952888', 'Q1259759', 'Q581714']);
  const byImdb = new Map();
  for (const b of (d.results && d.results.bindings) || []) {
    const imdb = b.imdb.value;
    if (!/^tt\d+$/.test(imdb)) continue;
    const date = b.date ? b.date.value.slice(0, 10) : null;
    const prev = byImdb.get(imdb);
    if (prev) { if (date && (!prev.date || date < prev.date)) prev.date = date; if (!prev.title && b.title) prev.title = b.title.value; continue; }
    byImdb.set(imdb, { imdb, title: b.title ? b.title.value : null, date, kind: SERIES.has(b.type.value.split('/').pop()) ? 'show' : 'movie' });
  }
  // Titre manquant en français : celui de Cinemeta (et l'affiche)
  const list = [...byImdb.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 60);
  await Promise.all(list.map(async (x) => {
    x.poster = `https://images.metahub.space/poster/medium/${x.imdb}/img`;
    if (!x.title) {
      const m = await getJson(`${CINEMETA}/meta/${x.kind === 'movie' ? 'movie' : 'series'}/${x.imdb}.json`).catch(() => null);
      x.title = m && m.meta ? m.meta.name : null;
    }
    x.year = x.date ? Number(x.date.slice(0, 4)) : null;
  }));
  const out = list.filter((x) => x.title);
  cache.set(key, { at: Date.now(), list: out });
  // 500 personnes gardées au plus : les plus anciennes sortent en premier
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  return out;
}

// ------------------------------------------------------------------ photo d'une personne (acteur, réalisateur, équipe)
// Quand la fiche n'a pas de photo : TVmaze (acteurs et équipes de séries), sinon Wikidata / Wikimedia Commons
// (photo libre de droits). Résultat gardé 30 jours, y compris « pas de photo ».
import { db as _db, get as _get } from './db.js';
_db.exec('CREATE TABLE IF NOT EXISTS person_photos (name TEXT PRIMARY KEY, url TEXT, at INTEGER)');
const FILM_JOBS = ['Q33999', 'Q10800557', 'Q10798782', 'Q2405480', 'Q2526255', 'Q28389', 'Q3282637', 'Q36834', 'Q3455803', 'Q1053574', 'Q222344', 'Q245068'];
const pending = new Map();
// Photo d'une personne (en cache)
export function personPhoto(name) {
  const key = String(name || '').trim().slice(0, 120);
  if (!key) return Promise.resolve(null);
  const row = _get('SELECT url, at FROM person_photos WHERE name = ?', key);
  if (row && Date.now() - row.at < 30 * 864e5) return Promise.resolve(row.url || null);
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    let url = null;
    try {
      const list = await getJson(`${TVMAZE}/search/people?q=${encodeURIComponent(key)}`);
      const hit = (list || []).find((x) => x.person && x.person.image && norm(x.person.name) === norm(key));
      if (hit) url = hit.person.image.medium || hit.person.image.original;
    } catch { /* */ }
    if (!url) {
      try {
        const lit = JSON.stringify(key);
        const q = `SELECT ?img WHERE { { ?p rdfs:label ${lit}@en } UNION { ?p rdfs:label ${lit}@fr } ?p wdt:P31 wd:Q5 ; wdt:P18 ?img ; wdt:P106 ?job . VALUES ?job { ${FILM_JOBS.map((j) => `wd:${j}`).join(' ')} } } LIMIT 1`;
        const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Venus/1.0 (serveur multimédia personnel)' }, signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const d = await res.json();
          const b = d.results && d.results.bindings && d.results.bindings[0];
          if (b) url = `${b.img.value.replace(/^http:/, 'https:')}?width=300`;
        }
      } catch { /* */ }
    }
    run('INSERT OR REPLACE INTO person_photos(name, url, at) VALUES(?, ?, ?)', key, url, Date.now());
    return url;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
// Texte simplifié pour comparer des noms
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
