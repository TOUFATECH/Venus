// Médias automatiques, de bout en bout avec de fausses sources et un faux moteur de téléchargement :
// ♡ → envie → recherche → meilleure version → téléchargement → rangement → meilleure version plus tard.
// Base PostgreSQL de test : VENUS_TEST_PG (compte qui peut créer des bases).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `venus_unit_${process.pid}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-acq-'));
let E, admin;
async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { await pg.simple(sql); } finally { await pg.close(); } }

before(async () => {
  await adminSql(`CREATE DATABASE ${dbName}`);
  const u = new URL(ADMIN); u.pathname = `/${dbName}`;
  process.env.VENUS_DATABASE_URL = u.toString(); process.env.DATA_DIR = path.join(tmp, 'data');
  E = await import('../../server/acquire/engine.js');
});
after(async () => { fs.rmSync(tmp, { recursive: true, force: true }); await adminSql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); });

const feed = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.t}</title><guid>${i.l}</guid><link>${i.l}</link><size>${i.s ?? 4e9}</size><torznab:attr name="seeders" value="${i.seed ?? 10}"/><torznab:attr name="infohash" value="${i.h}"/></item>`).join('')}</channel></rss>`;
function world(results) {
  const added = [], files = new Map(), state = new Map();
  const movies = path.join(tmp, 'Films'), shows = path.join(tmp, 'Series'), dl = path.join(tmp, 'dl');
  for (const d of [movies, shows, dl]) fs.mkdirSync(d, { recursive: true });
  const trashed = [], slept = [], removed = [];
  const deps = {
    ...E.defaultDeps,
    sleep: async (ms) => { slept.push(ms); },
    fetch: async (u) => { const q = new URL(u); const key = `${q.searchParams.get('t')}|${q.searchParams.get('q')}|${q.searchParams.get('season') ?? ''}|${q.searchParams.get('ep') ?? ''}`; return new Response(feed(results(key, q) ?? []), { status: 200 }); },
    hasSources: () => true,
    search: async (want) => { const { searchAll } = await import('../../server/acquire/sources.js'); return searchAll([{ name: 'Essai', kind: 'torznab', url: 'http://source.test/api', key: 'k', enabled: true }], want, deps.fetch); },
    tmdb: async (p) => (p === '/tv/77' ? { name: 'Brigade Nord', seasons: [{ season_number: 1 }] } : { episodes: [{ episode_number: 1, air_date: '2025-01-01' }, { episode_number: 2, air_date: '2025-01-08' }, { episode_number: 3, air_date: '2099-01-01' }] }),
    episodesInLibrary: () => new Set(['1:1']),
    engine: () => ({ name: 'faux', add: async (rel, tag) => { added.push({ rel, tag }); state.set(rel.infohash, { id: rel.infohash, tags: [tag], name: rel.title, progress: 30, done: false, failed: false, path: files.get(rel.infohash) }); return rel.infohash; }, list: async () => [...state.values()], remove: async (id, files) => { removed.push({ id, files }); state.delete(id); } }),
    rootFor: (w) => (w.kind === 'movie' ? movies : shows),
    trash: (f) => { trashed.push(f); fs.rmSync(f, { force: true }); },
    scan: () => {},
  };
  const finish = (hash, rel) => { const f = path.join(dl, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'video'); const s = state.get(hash); Object.assign(s, { done: true, progress: 100, path: path.join(dl, rel.split('/')[0]) }); };
  return { deps, added, state, finish, movies, shows, trashed, slept, removed, dl };
}

test('film : ♡ → meilleure version VF 1080p → téléchargement → rangé dans la médiathèque', async () => {
  const W = world((k) => (k.startsWith('movie|') ? [
    { t: 'Orage.2018.VOSTFR.1080p.WEB.x264', l: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), h: 'a'.repeat(40), seed: 500 },
    { t: 'Orage.2018.MULTi.1080p.BluRay.x265', l: 'magnet:?xt=urn:btih:' + 'b'.repeat(40), h: 'b'.repeat(40), seed: 20 },
    { t: 'Orage.2018.HDCAM.FRENCH', l: 'magnet:?xt=urn:btih:' + 'c'.repeat(40), h: 'c'.repeat(40), seed: 900 },
  ] : []));
  const r = await E.fromWish({ id: 1, max_age: null }, { type: 'movie', title: 'Orage', tmdbId: 9001, date: '2018-05-01' }, W.deps);
  assert.equal(r.state, 'processing');
  assert.equal((await E.fromWish({ id: 2, max_age: 10 }, { type: 'movie', title: 'Autre', tmdbId: 1 }, W.deps)).state, 'kids', 'un profil enfant ne télécharge jamais');
  const s = await E.searchDue(W.deps);
  assert.ok(s[0].ok); assert.equal(W.added[0].rel.title, 'Orage.2018.MULTi.1080p.BluRay.x265', 'VF/MULTI avant la VOSTFR plus partagée, jamais le CAM');
  let w = E.wantsList("kind = 'movie'")[0]; assert.equal(w.status, 'telechargement');
  await E.poll(W.deps); w = E.wantById(w.id); assert.equal(w.progress, 30);
  W.finish('b'.repeat(40), 'Orage.2018.MULTi.1080p.BluRay.x265/Orage.2018.MULTi.1080p.BluRay.x265.mkv');
  await E.poll(W.deps); w = E.wantById(w.id);
  assert.equal(w.status, 'range'); assert.equal(w.cible, 1);
  assert.equal(w.file, path.join(W.movies, 'Orage (2018)', 'Orage (2018) [1080p MULTI].mkv')); assert.ok(fs.existsSync(w.file));
  assert.ok(E.recentLog().some((l) => /Rangé dans la médiathèque/.test(l.text)));
});

test('série : les épisodes diffusés manquants deviennent des envies ; une saison complète sert tous ses épisodes ; un échec fait chercher ailleurs', async () => {
  const W = world((k) => (k.startsWith('tvsearch|Brigade Nord|1|') ? [
    { t: 'Brigade.Nord.S01.FRENCH.1080p.WEB', l: 'magnet:?xt=urn:btih:' + 'd'.repeat(40), h: 'd'.repeat(40), s: 6e9, seed: 40 },
    { t: 'Brigade.Nord.S01E02.FRENCH.1080p.WEB', l: 'magnet:?xt=urn:btih:' + 'e'.repeat(40), h: 'e'.repeat(40), s: 1e9, seed: 3 },
  ] : []));
  const r = await E.fromWish({ id: 1, max_age: null }, { type: 'tv', title: 'Brigade Nord', tmdbId: 77 }, W.deps);
  assert.equal(r.episodes, 1, 'S01E01 est déjà dans Venus, S01E03 n’est pas encore diffusé');
  await E.searchDue(W.deps);
  const ep = E.wantsList("kind = 'episode'")[0]; assert.equal(ep.episode, 2); assert.equal(ep.grab.title, 'Brigade.Nord.S01E02.FRENCH.1080p.WEB');
  // Le téléchargement échoue : la version est notée « essayée », une autre est prise au passage suivant
  W.state.get('e'.repeat(40)).failed = true;
  await E.poll(W.deps);
  let w = E.wantById(ep.id); assert.equal(w.status, 'attente'); assert.deepEqual(w.tried, ['magnet:?xt=urn:btih:' + 'e'.repeat(40)]);
  await E.searchDue(W.deps); w = E.wantById(ep.id); assert.equal(w.grab.title, 'Brigade.Nord.S01.FRENCH.1080p.WEB', 'la saison complète, qui contient l’épisode');
  W.finish('d'.repeat(40), 'Brigade.Nord.S01.FRENCH.1080p.WEB/Brigade.Nord.S01E02.FRENCH.1080p.WEB.mkv');
  fs.writeFileSync(path.join(path.dirname(W.state.get('d'.repeat(40)).path), 'Brigade.Nord.S01.FRENCH.1080p.WEB', 'Brigade.Nord.S01E01.FRENCH.1080p.WEB.mkv'), 'video');
  await E.poll(W.deps); w = E.wantById(ep.id);
  assert.equal(w.status, 'range'); assert.equal(w.file, path.join(W.shows, 'Brigade Nord', 'Saison 01', 'Brigade Nord - S01E02 [1080p VF].mkv'));
});

test('meilleure version : une VF arrivée remplace la VOSTFR (l’ancienne part à la corbeille) ; rien de mieux = on garde', async () => {
  let vf = false;
  const W = world((k) => (k.startsWith('movie|Nuit Blanche') ? [
    { t: 'Nuit.Blanche.2021.VOSTFR.1080p.WEB', l: 'magnet:?xt=urn:btih:' + '1'.repeat(40), h: '1'.repeat(40) },
    ...(vf ? [{ t: 'Nuit.Blanche.2021.FRENCH.1080p.WEB', l: 'magnet:?xt=urn:btih:' + '2'.repeat(40), h: '2'.repeat(40) }] : []),
  ] : []));
  const id = E.addWant({ kind: 'movie', title: 'Nuit Blanche', year: 2021, tmdbId: 9002 });
  await E.searchWant(E.wantById(id), W.deps);
  W.finish('1'.repeat(40), 'Nuit.Blanche.2021.VOSTFR.1080p.WEB/x.mkv'); await E.poll(W.deps);
  let w = E.wantById(id); assert.equal(w.status, 'range'); assert.equal(w.cible, 0, 'VOSTFR : pas encore la qualité visée');
  const old = w.file;
  assert.equal((await E.searchWant(w, W.deps)).ok, false, 'rien de mieux pour l’instant');
  vf = true; await E.searchWant(E.wantById(id), W.deps);
  W.finish('2'.repeat(40), 'Nuit.Blanche.2021.FRENCH.1080p.WEB/x.mkv'); await E.poll(W.deps);
  w = E.wantById(id); assert.equal(w.cible, 1); assert.match(w.file, /\[1080p VF\]\.mkv$/); assert.deepEqual(W.trashed, [old]);
});

test('filtres par catégorie réglables : Films sans VOSTFR, animés en VOSTFR 480p, retour au filtre de départ', async () => {
  const W = world((k) => (k.startsWith('movie|Brume') ? [{ t: 'Brume.2024.VOSTFR.1080p.WEB', l: 'magnet:?xt=urn:btih:' + '3'.repeat(40), h: '3'.repeat(40) }]
    : k.startsWith('tvsearch|Kaze') ? [{ t: '[SubsPlease] Kaze - 05 (480p) VOSTFR', l: 'magnet:?xt=urn:btih:' + '4'.repeat(40), h: '4'.repeat(40), s: 3e8 }] : []));
  E.saveAcquire({ categories: { films: { langues: { vostfr: -500 } } } });
  assert.equal(E.acquireConf().categories.films.langues.vostfr, -500);
  assert.equal(E.filtersView().films.langues.vostfr, -500); assert.equal(E.filtersView().films.reglee, true); assert.equal(E.filtersView().series.reglee, false);
  const f = E.addWant({ kind: 'movie', title: 'Brume', year: 2024, tmdbId: 9100 });
  const r = await E.searchWant(E.wantById(f), W.deps); assert.equal(r.ok, false); assert.match(r.why, /VOSTFR/);
  const a = E.addWant({ kind: 'episode', title: 'Kaze', season: 1, episode: 5, showKey: 'tv:9200', anime: true });
  assert.ok((await E.searchWant(E.wantById(a), W.deps)).ok, 'animé : VOSTFR 480p accepté, numéro absolu « - 05 »');
  assert.throws(() => E.saveAcquire({ categories: { inconnue: {} } }), /catégorie inconnue/);
  E.saveAcquire({ categories: { films: { min: 9999, langues: { vf: 'x' } } } });
  assert.equal(E.acquireConf().categories.films.min, 2160, 'valeurs bornées'); assert.equal(E.acquireConf().categories.films.langues.vf, undefined);
  E.saveAcquire({ categories: { films: null } }); assert.equal(E.acquireConf().categories.films, undefined, 'retour au filtre de départ');
  assert.ok((await E.searchWant(E.wantById(f), W.deps)).ok, 'VOSTFR de nouveau acceptée (en attendant la VF)');
  await E.cancelFor('movie:9100', W.deps); await E.cancelFor('tv:9200', W.deps);
});

test('fichier exécutable dans un téléchargement : rien n’est rangé, le téléchargement est supprimé, une autre version sera cherchée', async () => {
  const W = world((k) => (k.startsWith('movie|Piege') ? [{ t: 'Piege.2023.MULTi.1080p.WEB', l: 'magnet:?xt=urn:btih:' + '5'.repeat(40), h: '5'.repeat(40) }] : []));
  const id = E.addWant({ kind: 'movie', title: 'Piege', year: 2023, tmdbId: 9300 });
  await E.searchWant(E.wantById(id), W.deps);
  W.finish('5'.repeat(40), 'Piege.2023.MULTi.1080p.WEB/Piege.mkv');
  fs.writeFileSync(path.join(W.dl, 'Piege.2023.MULTi.1080p.WEB', 'Lecteur.exe'), 'MZ');
  await E.poll(W.deps);
  const w = E.wantById(id);
  assert.equal(w.status, 'attente'); assert.equal(w.file, null); assert.match(w.note, /exécutable bloqué/);
  assert.deepEqual(w.tried, ['magnet:?xt=urn:btih:' + '5'.repeat(40)]);
  assert.deepEqual(W.removed, [{ id: '5'.repeat(40), files: true }]);
  assert.ok(!fs.existsSync(path.join(W.movies, 'Piege (2023)')));
  await E.cancelFor('movie:9300', W.deps);
});

test('par lots : taille du lot et pause entre deux recherches ; retirer annule les téléchargements', async () => {
  const W = world((k) => { const n = /^movie\|Lot (\w)/.exec(k)?.[1]; return n ? [{ t: `Lot.${n}.2020.MULTi.1080p.WEB`, l: `magnet:?xt=urn:btih:${n.repeat(40)}`, h: n.repeat(40) }] : []; });
  E.saveAcquire({ lots: { taille: 3, pauseS: 2 } });
  for (const n of ['a', 'b', 'c', 'd', 'e']) E.addWant({ kind: 'movie', title: `Lot ${n}`, year: 2020, tmdbId: 9400 + n.charCodeAt(0) });
  const s1 = await E.searchDue(W.deps);
  assert.equal(s1.length, 3, 'lot de 3'); assert.deepEqual(W.slept, [2000, 2000], 'pause de 2 s entre deux recherches');
  const s2 = await E.searchDue(W.deps); assert.equal(s2.length, 2, 'le reste au passage suivant');
  assert.equal(W.added.length, 5);
  const r = await E.cancelFor(`movie:${9400 + 97}`, W.deps);
  assert.deepEqual(r, { cancelled: 1, downloads: 1 }); assert.deepEqual(W.removed[0], { id: 'a'.repeat(40), files: true });
  assert.equal(E.wantsList('show_key = ?', `movie:${9400 + 97}`).length, 0);
  for (const n of ['b', 'c', 'd', 'e']) await E.cancelFor(`movie:${9400 + n.charCodeAt(0)}`, W.deps);
  E.saveAcquire({ lots: { taille: 10, pauseS: 4 } });
});

test('Bygul : au plus N recherches par minute et par source', async () => {
  const B = await import('../../server/acquire/bygul.js');
  B.resetSlots();
  const s = { id: 999, rpm: 2 };
  assert.equal(B.slotWait(s, 1000), 0); assert.equal(B.slotWait(s, 2000), 0);
  assert.equal(B.slotWait(s, 3000), 58000, 'troisième recherche : attendre que la première ait une minute');
  assert.equal(B.slotWait(s, 61001), 0);
  assert.equal(B.rpmOf({ rpm: 500 }), 120); assert.equal(B.rpmOf({}), 10);
});

test('sources : ajout vérifié, aucune par défaut', () => {
  assert.equal(E.listSources().length, 0, 'Venus ne fournit aucune source');
  assert.throws(() => E.addSource({ name: 'x', kind: 'torznab', url: 'ftp://x' }), /Adresse invalide/);
  assert.throws(() => E.addSource({ name: 'x', kind: 'rss', url: 'http://x' }), /torznab ou newznab/);
  const id = E.addSource({ name: 'Mon indexeur', kind: 'torznab', url: 'http://192.168.1.20:9117/api', key: 'secret' });
  assert.ok(id > 0); assert.equal(E.listSources()[0].key, undefined, 'la clé n’est jamais renvoyée');
  E.removeSource(id); assert.equal(E.listSources().length, 0);
});

test('autotest : domaine public d’archive.org → téléchargement → rangé → vérifié → tout retiré', async () => {
  const S = await import('../../server/acquire/selftest.js');
  const W = world(() => []);
  const deps = { ...W.deps, search: async () => ({ sources: 2, results: [{}], errors: [] }), engine: () => ({ name: 'venus',
    add: async (rel, tag) => { W.added.push({ rel, tag }); const h = 'c'.repeat(40); W.state.set(h, { id: h, tags: [tag], name: rel.title, progress: 0, done: false, failed: false }); setTimeout(() => {
      const f = path.join(W.dl, 'skel', 'Skeleton_Dance.mp4'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(300 * 1024, 1)); Object.assign(W.state.get(h), { done: true, progress: 100, path: path.join(W.dl, 'skel') }); }, 30); return h; },
    list: async () => [...W.state.values()], remove: async (id, files) => { W.removed.push({ id, files }); } }) };
  assert.throws(() => S.startSelfTest({ id: '../etc' }, deps), /invalide/);
  const st = await S.startSelfTest(S.DEFAULT_ITEM, deps, { wait: true, everyMs: 20, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.equal(st.result, 'réussi', JSON.stringify(st.steps));
  assert.equal(W.added[0].rel.link, 'https://archive.org/download/public-domain-spotlight-the-skeleton-dance/public-domain-spotlight-the-skeleton-dance_archive.torrent');
  assert.ok(st.steps.some((s) => /Rangé dans la médiathèque/.test(s.text))); assert.ok(st.steps.some((s) => /Fichier vérifié/.test(s.text)));
  assert.deepEqual(W.removed, [{ id: 'c'.repeat(40), files: true }]);
  assert.ok(!fs.existsSync(path.join(W.movies, 'The Skeleton Dance (1929)')), 'fichier rangé retiré');
  assert.equal(E.wantsList("show_key LIKE 'autotest:%'").length, 0, 'envie retirée');
});
