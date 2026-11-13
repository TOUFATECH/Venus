// Bygul · Sources : test d'une source, santé (pause d'une source en panne), priorités, statistiques, recherche à la main.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `venus_bygul_${process.pid}`, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bygul-'));
let B, E;
async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { await pg.simple(sql); } finally { await pg.close(); } }
before(async () => { await adminSql(`CREATE DATABASE ${dbName}`); const u = new URL(ADMIN); u.pathname = `/${dbName}`; process.env.VENUS_DATABASE_URL = u.toString(); process.env.DATA_DIR = tmp; E = await import('../../server/acquire/engine.js'); B = await import('../../server/acquire/bygul.js'); });
after(async () => { fs.rmSync(tmp, { recursive: true, force: true }); await adminSql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); });

const CAPS = '<caps><searching><search available="yes"/><tv-search available="yes"/><movie-search available="yes"/><music-search available="no"/><book-search available="no"/></searching><categories><category id="2000" name="Movies"/><category id="5000" name="TV"/></categories></caps>';
const item = (t, h, seed) => `<item><title>${t}</title><link>magnet:?xt=urn:btih:${h}</link><size>4000000000</size><torznab:attr name="seeders" value="${seed}"/><torznab:attr name="infohash" value="${h}"/></item>`;

test('sources : test (capacités), priorités, doublons, santé avec pause, statistiques, recherche à la main', async () => {
  const a = E.addSource({ name: 'Rapide', kind: 'torznab', url: 'http://a.test/api', key: 'ka' }), b = E.addSource({ name: 'Lente', kind: 'torznab', url: 'http://b.test/api', key: 'kb' });
  let bDown = false;
  const fetcher = async (u) => {
    const x = new URL(u);
    if (x.searchParams.get('t') === 'caps') return new Response(CAPS);
    if (x.hostname === 'b.test' && bDown) return new Response('panne', { status: 503 });
    const h = 'f'.repeat(40);
    return new Response(`<rss><channel>${item('Orage.2018.MULTi.1080p.WEB', h, x.hostname === 'a.test' ? 5 : 50)}${x.hostname === 'b.test' ? item('Orage.2018.VOSTFR.1080p.WEB', 'e'.repeat(40), 90) + item('Orage.2018.HDCAM', 'd'.repeat(40), 99) : ''}</channel></rss>`);
  };
  const t = await B.testSource(a, fetcher); assert.ok(t.ok); assert.equal(t.caps.films, true); assert.equal(t.caps.musique, false);
  B.setSource(b, { priority: 40 });
  const r = await B.bygulSearch({ kind: 'movie', title: 'Orage', year: 2018 }, fetcher);
  assert.equal(r.sources, 2); assert.equal(r.results.length, 3, 'la même version (même empreinte) n’apparaît qu’une fois');
  assert.equal(r.results.find((x) => x.infohash === 'f'.repeat(40)).indexer, 'Rapide', 'la source prioritaire gagne');
  // La source « Rapide » ne sait pas chercher la musique : elle n'est pas interrogée pour un album
  const m = await B.bygulSearch({ kind: 'album', artist: 'Zaza', title: 'Soleil' }, fetcher); assert.equal(m.sources, 1);
  bDown = true;
  await B.bygulSearch({ kind: 'movie', title: 'Orage' }, fetcher); await B.bygulSearch({ kind: 'movie', title: 'Orage' }, fetcher);
  const h = B.sourcesHealth(); const lb = h.find((s) => s.id === b);
  assert.equal(lb.health, 'en pause'); assert.equal(lb.fails, 2); assert.match(lb.last_error, /503/);
  assert.equal((await B.bygulSearch({ kind: 'movie', title: 'Orage' }, fetcher)).sources, 1, 'en pause : pas interrogée');
  assert.ok(B.sourcesHealth(Date.now() + 25 * 3600e3).find((s) => s.id === b).health !== 'en pause', 'réessayée plus tard');
  const la = h.find((s) => s.id === a); assert.ok(la.queries >= 3 && la.avgMs !== null && la.health === 'bonne'); assert.equal(la.key, undefined, 'la clé n’est jamais renvoyée');
  B.countGrab(a); assert.equal(B.sourcesHealth().find((s) => s.id === a).grabs, 1);
  B.setSource(b, { enabled: true });
  bDown = false;
  const man = await B.manualSearch({ q: 'Orage', kind: 'movie', year: 2018 }, undefined, fetcher);
  assert.equal(man.results[0].title, 'Orage.2018.MULTi.1080p.WEB'); assert.equal(man.results.at(-1).ok, false); assert.ok(man.results.some((x) => /caméscope/.test(x.why ?? '')));
  B.setSource(a, { enabled: false }); assert.equal((await B.bygulSearch({ kind: 'movie', title: 'Orage' }, fetcher)).sources, 1);
  assert.equal(B.parseCaps('<caps><searching><book-search available="yes"/></searching></caps>').livres, true);
});

test('import depuis Prowlarr : actifs / coupés repris, passage par l’API Torznab de Prowlarr, pas de doublon au nouvel import', async () => {
  let enable2 = false, calls = [];
  const fetcher = async (u, o = {}) => {
    calls.push({ u, key: o.headers?.['X-Api-Key'] });
    if (o.headers?.['X-Api-Key'] !== 'cle-prowlarr-123') return new Response('', { status: 401 });
    return Response.json([
      { id: 1, name: 'Indexeur Un', enable: true, protocol: 'torrent', priority: 10 },
      { id: 2, name: 'Indexeur Deux', enable: enable2, protocol: 'torrent', priority: 25 },
      { id: 3, name: 'Usenet Trois', enable: true, protocol: 'usenet' },
    ]);
  };
  await assert.rejects(B.importProwlarr({ url: 'http://prowlarr.test:9696', key: 'mauvaise-cle' }, fetcher), /refuse la clé/);
  await assert.rejects(B.importProwlarr({ url: 'ftp://x', key: 'cle-prowlarr-123' }, fetcher), /invalide/);
  const r = await B.importProwlarr({ url: 'http://prowlarr.test:9696/', key: 'cle-prowlarr-123' }, fetcher);
  assert.deepEqual([r.added, r.updated, r.active, r.disabled, r.total], [3, 0, 2, 1, 3]);
  assert.equal(calls.at(-1).u, 'http://prowlarr.test:9696/api/v1/indexer');
  const mine = B.sourcesHealth().filter((s) => /^prowlarr:/.test(s.origin || ''));
  assert.equal(mine.length, 3);
  const deux = mine.find((s) => s.name === 'Indexeur Deux');
  assert.equal(deux.enabled, false); assert.equal(deux.url, 'http://prowlarr.test:9696/2/api'); assert.equal(deux.key, undefined, 'clé jamais renvoyée');
  assert.equal(mine.find((s) => s.name === 'Usenet Trois').kind, 'newznab'); assert.equal(mine.find((s) => s.name === 'Indexeur Un').priority, 10);
  enable2 = true;
  const r2 = await B.importProwlarr({ url: 'http://prowlarr.test:9696', key: 'cle-prowlarr-123' }, fetcher);
  assert.deepEqual([r2.added, r2.updated, r2.active], [0, 3, 3]);
  assert.equal(B.sourcesHealth().find((s) => s.name === 'Indexeur Deux').enabled, true);
  // Test de toutes les sources actives, une à une
  const caps = async (u) => (new URL(u).searchParams.get('t') === 'caps' ? new Response(CAPS) : new Response('', { status: 500 }));
  const t = await B.testAll(caps); assert.ok(t.length >= 3 && t.filter((x) => /Indexeur|Usenet/.test(x.name)).every((x) => x.ok));
  for (const s of mine) E.removeSource(s.id);
});
