// Bygul · Sources (dans Odin : Freyja → Bygul ; recodé d'après les idées de Prowlarr). Une seule liste de sources
// (indexeurs Torznab / Newznab) pour tout le bloc Médias : Gersemi (films), Hildisvíni (séries), la musique,
// Sjöfn (livres) et Hnoss (demandes) cherchent à travers Bygul.
//   - test d'une source (connexion, ce qu'elle sait chercher : films, séries, musique, livres)
//   - priorité, activer / couper ; santé : une source en panne est mise en pause (de plus en plus longtemps),
//     puis réessayée toute seule ; statistiques (recherches, téléchargements, temps de réponse, échecs)
//   - recherche à la main dans toutes les sources
// Jamais de contournement de captcha ni de lecture des pages des sites : seulement les API des sources que TU ajoutes.
import { db, all, get, run, getSetting } from '../db.js';
import { searchIndexer, CATS } from './sources.js';
import { score, profileFor } from './release.js';

db.exec(`CREATE TABLE IF NOT EXISTS media_sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, key TEXT, enabled INTEGER DEFAULT 1, added_at INTEGER)`);
for (const [c, d] of [['priority', 'INTEGER DEFAULT 25'], ['kinds', 'TEXT'], ['fails', 'INTEGER DEFAULT 0'], ['paused_until', 'INTEGER'], ['last_error', 'TEXT'], ['last_ok', 'INTEGER'], ['queries', 'INTEGER DEFAULT 0'], ['grabs', 'INTEGER DEFAULT 0'], ['total_ms', 'INTEGER DEFAULT 0'], ['caps', 'TEXT'], ['rpm', 'INTEGER'], ['origin', 'TEXT']]) db.exec(`ALTER TABLE media_sources ADD COLUMN ${c} ${d}`);

// Limite de requêtes : au plus « rpm » recherches par minute et par source (réglable par source ; 10 par défaut).
// Une source à sa limite fait attendre la recherche (jusqu'à 20 s), sinon elle est sautée cette fois-ci.
const recent = new Map();
export const rpmOf = (s) => Math.max(1, Math.min(120, Number(s.rpm) || Number(getSetting('bygul_rpm', 10)) || 10));
/** Attente (ms) avant de pouvoir interroger cette source, et réservation du créneau si 0. Pur sauf la mémoire des créneaux. */
export function slotWait(s, now = Date.now()) {
  const l = (recent.get(s.id) || []).filter((x) => x > now - 60e3), max = rpmOf(s);
  if (l.length < max) { l.push(now); recent.set(s.id, l); return 0; }
  recent.set(s.id, l); return l[0] + 60e3 - now;
}
export const resetSlots = () => recent.clear();
const PAUSE = (fails) => Math.min(24 * 3600e3, 5 * 60e3 * 2 ** Math.max(0, fails - 1));
const KIND_OF = { movie: 'films', episode: 'series', season: 'series', album: 'musique', book: 'livres', audiobook: 'livres' };

/** Les sources avec leur santé et leurs statistiques (sans la clé). */
export function sourcesHealth(now = Date.now()) {
  return all('SELECT id, name, kind, url, enabled, priority, rpm, origin, kinds, fails, paused_until, last_error, last_ok, queries, grabs, total_ms, caps, added_at FROM media_sources ORDER BY priority ASC, id ASC').map((s) => ({
    ...s, enabled: !!s.enabled, kinds: s.kinds ? JSON.parse(s.kinds) : null, caps: s.caps ? JSON.parse(s.caps) : null,
    avgMs: s.queries ? Math.round(s.total_ms / s.queries) : null,
    health: !s.enabled ? 'coupée' : s.paused_until && s.paused_until > now ? 'en pause' : s.fails ? 'fragile' : s.last_ok ? 'bonne' : 'pas encore essayée',
  }));
}
export function setSource(id, { enabled, priority, kinds, name, rpm } = {}) {
  const s = get('SELECT id FROM media_sources WHERE id = ?', Number(id)); if (!s) throw new Error('source introuvable');
  if (enabled !== undefined) run('UPDATE media_sources SET enabled = ?, paused_until = NULL, fails = 0 WHERE id = ?', enabled ? 1 : 0, s.id);
  if (priority !== undefined) run('UPDATE media_sources SET priority = ? WHERE id = ?', Math.max(1, Math.min(50, Number(priority) || 25)), s.id);
  if (kinds !== undefined) run('UPDATE media_sources SET kinds = ? WHERE id = ?', kinds && kinds.length ? JSON.stringify(kinds.filter((k) => ['films', 'series', 'musique', 'livres'].includes(k))) : null, s.id);
  if (name) run('UPDATE media_sources SET name = ? WHERE id = ?', String(name).slice(0, 80), s.id);
  if (rpm !== undefined) run('UPDATE media_sources SET rpm = ? WHERE id = ?', rpm ? Math.max(1, Math.min(120, Number(rpm) || 10)) : null, s.id);
}
/** Lit les capacités Torznab / Newznab (t=caps). Pur. */
export function parseCaps(xml) {
  const avail = (tag) => new RegExp(`<${tag}\\b[^>]*available="yes"`, 'i').test(xml);
  const cats = [...String(xml).matchAll(/<category\b[^>]*id="(\d+)"[^>]*name="([^"]*)"/g)].map((m) => ({ id: Number(m[1]), name: m[2] }));
  return { films: avail('movie-search'), series: avail('tv-search'), musique: avail('music-search') || avail('audio-search'), livres: avail('book-search'), recherche: avail('search'), categories: cats.slice(0, 60) };
}
/** Teste une source : connexion et capacités. */
export async function testSource(id, fetcher = fetch) {
  const s = get('SELECT * FROM media_sources WHERE id = ?', Number(id)); if (!s) throw new Error('source introuvable');
  const u = new URL(`${s.url.replace(/\/+$/, '')}${/\/api$/.test(s.url) ? '' : '/api'}`); u.searchParams.set('t', 'caps'); if (s.key) u.searchParams.set('apikey', s.key);
  const t0 = Date.now();
  try {
    const r = await fetcher(u.toString(), { signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`réponse ${r.status}`);
    const err = /<error\b[^>]*description="([^"]+)"/.exec(text); if (err) throw new Error(err[1]);
    if (!/<caps\b/i.test(text)) throw new Error('ce n’est pas une API Torznab / Newznab');
    const caps = parseCaps(text);
    run('UPDATE media_sources SET caps = ?, last_ok = ?, fails = 0, paused_until = NULL, last_error = NULL WHERE id = ?', JSON.stringify(caps), Date.now(), s.id);
    return { ok: true, ms: Date.now() - t0, caps };
  } catch (e) {
    run('UPDATE media_sources SET last_error = ? WHERE id = ?', e.message.slice(0, 200), s.id);
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}
/** Cherche dans les sources actives (et non en pause) qui servent ce type de média ; tient la santé et les statistiques. */
export async function bygulSearch(want, fetcher = fetch, now = Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const kind = KIND_OF[want.kind];
  const list = all('SELECT * FROM media_sources WHERE enabled = 1 ORDER BY priority ASC, id ASC').filter((s) => !(s.paused_until && s.paused_until > now) && (!s.kinds || JSON.parse(s.kinds).includes(kind)) && !(s.caps && kind && JSON.parse(s.caps)[kind] === false)); // la source ne sait pas chercher ce type
  const results = [], errors = [];
  await Promise.all(list.map(async (s) => {
    let wait = slotWait(s);
    if (wait > 20e3) { errors.push(`${s.name} : limite de ${rpmOf(s)} recherches par minute atteinte, sautée cette fois`); return; }
    while (wait > 0) { await sleep(wait); wait = slotWait(s); }
    const t0 = Date.now();
    try {
      const r = await searchIndexer(s, want, fetcher);
      run('UPDATE media_sources SET queries = queries + 1, total_ms = total_ms + ?, last_ok = ?, fails = 0, paused_until = NULL, last_error = NULL WHERE id = ?', Date.now() - t0, Date.now(), s.id);
      for (const x of r) results.push({ ...x, sourceId: s.id, priority: s.priority });
    } catch (e) {
      const fails = (s.fails || 0) + 1;
      run('UPDATE media_sources SET queries = queries + 1, total_ms = total_ms + ?, fails = ?, paused_until = ?, last_error = ? WHERE id = ?', Date.now() - t0, fails, fails >= 2 ? Date.now() + PAUSE(fails) : null, e.message.slice(0, 200), s.id);
      errors.push(`${s.name} : ${e.message}`);
    }
  }));
  // Même version vue dans plusieurs sources : on garde celle de la source prioritaire (puis la plus partagée)
  const best = new Map();
  for (const r of results.sort((a, b) => a.priority - b.priority || (b.seeders ?? 0) - (a.seeders ?? 0))) { const k = r.infohash || r.title.toLowerCase(); if (!best.has(k)) best.set(k, r); }
  return { results: [...best.values()], errors, sources: list.length };
}
/** Note un téléchargement obtenu par une source (statistiques). */
export const countGrab = (sourceId) => { if (sourceId) run('UPDATE media_sources SET grabs = grabs + 1 WHERE id = ?', sourceId); };
/** Recherche à la main : texte libre et type ; résultats notés (meilleurs d'abord), avec la raison d'un refus. */
export async function manualSearch({ q, kind = 'movie', year, season, episode, anime }, categories = {}, fetcher = fetch) {
  const want = { kind, anime: !!anime, title: String(q || '').trim(), year: year ? Number(year) : undefined, season: season ? Number(season) : undefined, episode: episode ? Number(episode) : undefined, artist: kind === 'album' ? String(q).split(' - ')[0] : undefined, author: undefined };
  if (want.title.length < 2) throw new Error('cherche au moins deux lettres');
  const r = await bygulSearch(want, fetcher);
  const profile = profileFor(want, categories);
  const rows = r.results.map((x) => { const s = score(want, x, profile); return { ...x, ok: s.ok, score: s.ok ? s.score : null, why: s.ok ? null : s.why, vf: s.p.vf, res: s.p.res }; })
    .sort((a, b) => (b.ok - a.ok) || (b.score ?? 0) - (a.score ?? 0) || (b.seeders ?? 0) - (a.seeders ?? 0));
  return { results: rows.slice(0, 150), errors: r.errors, sources: r.sources, cats: CATS[kind], filtre: profile.label };
}

/**
 * Importe les indexeurs de TON Prowlarr : chaque indexeur devient une source Bygul qui passe par l'API Torznab /
 * Newznab de Prowlarr ({prowlarr}/{id}/api). Actif / coupé et priorité sont repris tels quels ; un nouvel import met à
 * jour sans doublon. Bygul n'interroge jamais les sites directement (Prowlarr s'en charge, avec ses propres réglages).
 */
export async function importProwlarr({ url, key }, fetcher = fetch) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(base)) throw new Error('Adresse de Prowlarr invalide (ex. http://192.168.1.170:9696)');
  if (!key || String(key).length < 8) throw new Error('Clé API de Prowlarr manquante (Prowlarr → Settings → General → API Key)');
  const r = await fetcher(`${base}/api/v1/indexer`, { headers: { 'X-Api-Key': String(key), Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401) throw new Error('Prowlarr refuse la clé API');
  if (!r.ok) throw new Error(`Prowlarr répond ${r.status}`);
  const list = await r.json().catch(() => null);
  if (!Array.isArray(list)) throw new Error('réponse de Prowlarr illisible');
  const out = { added: 0, updated: 0, active: 0, disabled: 0, total: list.length, names: [] };
  for (const x of list) {
    if (!Number.isInteger(x.id)) continue;
    const origin = `prowlarr:${base}#${x.id}`, kind = x.protocol === 'usenet' ? 'newznab' : 'torznab', on = x.enable ? 1 : 0;
    const name = String(x.name || `Indexeur ${x.id}`).slice(0, 80), prio = Math.max(1, Math.min(50, Number(x.priority) || 25));
    const have = get('SELECT id FROM media_sources WHERE origin = ?', origin);
    if (have) { run('UPDATE media_sources SET name = ?, kind = ?, url = ?, key = ?, enabled = ?, priority = ? WHERE id = ?', name, kind, `${base}/${x.id}/api`, String(key).slice(0, 200), on, prio, have.id); out.updated++; }
    else { run('INSERT INTO media_sources(name, kind, url, key, enabled, priority, origin, added_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', name, kind, `${base}/${x.id}/api`, String(key).slice(0, 200), on, prio, origin, Date.now()); out.added++; }
    out[on ? 'active' : 'disabled']++; out.names.push(`${name}${on ? '' : ' (coupé)'}`);
  }
  return out;
}
/** Teste toutes les sources actives, une à une (pas toutes à la fois). */
export async function testAll(fetcher = fetch) {
  const out = [];
  for (const s of all('SELECT id, name FROM media_sources WHERE enabled = 1 ORDER BY priority, id')) out.push({ id: s.id, name: s.name, ...(await testSource(s.id, fetcher)) });
  return out;
}
