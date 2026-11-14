// Plusieurs serveurs Venus sur le même compte Odin, synchronisés ENTRE EUX par le VRAI Odin (copie du dépôt donnée par
// ODIN_DEPOT, utilisée en lecture seule) : deux vrais serveurs Venus (A et B, chacun sa base PostgreSQL et sa
// bibliothèque, des identifiants de titres différents), un vrai Odin (tests/unit/vrai-odin-lanceur.mjs), et entre A et
// Odin un relais TCP qu'on coupe pour simuler une coupure réseau.
// - « Ma liste », un favori (j'aime), une reprise d'épisode, un titre sans TMDB (reconnu par l'empreinte du fichier) :
//   ajoutés sur A, visibles sur B en moins de 2 s ;
// - conflit : la reprise la plus récente gagne sur les deux serveurs ;
// - coupure de A, changements des deux côtés, puis rattrapage au retour du réseau ;
// - empreintes identiques (A, B et Odin) ; aucune boucle d'envois (au repos, plus rien ne part).
// ODIN_DEPOT=/chemin/vers/odin VENUS_TEST_PG=postgres://… node --test tests/unit/odin-multi-vrai.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPOT = process.env.ODIN_DEPOT;
const skip = !DEPOT || !fs.existsSync(path.join(DEPOT || '/', 'src/valhalla/sso/fiches.ts')) ? 'ODIN_DEPOT (copie d’Odin avec la synchronisation entre serveurs Vénus) non donné' : false;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-multi-vrai-'));
const dbs = [`venus_multi_a_${process.pid}`, `venus_multi_b_${process.pid}`];
const procs = new Map();
let O, A, B, odinProc, relais;

const pgOf = async (db) => { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); return Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: db || u.pathname.slice(1) }); };
async function adminSql(sql) { const pg = await pgOf(); try { return await pg.simple(sql); } finally { await pg.close(); } }
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(25); } };

/** Relais TCP Venus A → Odin : coupe() ferme tout et refuse les connexions (câble débranché), retablit() rouvre. */
async function relaisVers(port) {
  const socks = new Set();
  let coupe = false;
  const srv = net.createServer((c) => {
    if (coupe) { c.destroy(); return; }
    const o = net.connect(port, '127.0.0.1');
    socks.add(c); socks.add(o);
    c.pipe(o); o.pipe(c);
    const end = () => { c.destroy(); o.destroy(); socks.delete(c); socks.delete(o); };
    c.on('error', end); o.on('error', end); c.on('close', end); o.on('close', end);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { port: srv.address().port, coupe() { coupe = true; for (const s of socks) s.destroy(); }, retablit() { coupe = false; }, close: () => new Promise((r) => { for (const s of socks) s.destroy(); srv.close(r); }) };
}
async function venus(name, db, port) {
  const u = new URL(ADMIN); u.pathname = `/${db}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(tmp, name), VENUS_DATABASE_URL: u.toString(), VENUS_UI: 'classic', HTTPS: '0', VENUS_IPTV_WORLD: '0', VENUS_COFFRE: '0', VENUS_ODIN_CHECK_MS: '30000', VENUS_ODIN_FICHES_MS: '4000', VENUS_ODIN_JOURNAL: '2', TRANSCODE_DIR: path.join(tmp, `${name}-tr`) };
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  procs.set(name, p);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${url}/api/status`)).ok) return { url, port, name, db, log: () => out }; } catch { /* */ }
    if (p.exitCode !== null) throw new Error(`Venus ${name} s'est arrêté :\n${out}`);
    await sleep(500);
  }
  throw new Error(`Venus ${name} ne démarre pas :\n${out}`);
}
async function stop(name) { const p = procs.get(name); if (!p || p.exitCode !== null) return; p.kill('SIGTERM'); await new Promise((r) => { p.on('exit', r); setTimeout(r, 8000); }); }
async function call(v, p, { method = 'GET', body, token } = {}) {
  const r = await fetch(`${v.url}${p}`, { method, redirect: 'manual', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const journal = (v) => `\n${v.log().split('\n').filter((l) => l.includes('[odin]')).slice(-25).join('\n')}`;
/** La reprise d'un titre (ou d'un épisode) sur ce serveur, lue dans sa base (-1 : aucune). */
async function position(v, id) { const pg = await pgOf(v.db); try { const r = (await pg.query('SELECT position FROM progress WHERE item_id = $1', [id])).rows[0]; return r ? Math.round(Number(r[0])) : -1; } finally { await pg.close(); } }
/** L'ombre d'un serveur (diagnostic) : ce qu'il croit qu'Odin a, fiche par fiche. */
async function ombreDe(v) { const pg = await pgOf(v.db); try { return `\n${v.name} : ${(await pg.query('SELECT id, col, maj, envoye, ici, suppr FROM odin_fiches ORDER BY col, id')).rows.map((r) => r.join(' ')).join('\n    ')}`; } finally { await pg.close(); } }
const fiches = async (v) => (await call(v, '/api/admin/odin/lien', { token: v.token })).data.fiches || {};

const FOYER = 'Foyer-Venus-2026!solide';
// La même vidéo (mêmes octets) sur les deux serveurs, sans TMDB ni IMDb : reconnue par l'empreinte du fichier
const VIDEO = crypto.randomBytes(300_000);
/** Une bibliothèque : 3 films TMDB, une série TMDB et ses épisodes, un film sans identifiant. Rend { nom: id local }. */
async function bibliotheque(v, ordre) {
  const pg = await pgOf(v.db), ids = {};
  const dir = path.join(tmp, `${v.name}-ailleurs`); fs.mkdirSync(dir, { recursive: true });
  const fichier = path.join(dir, `Mystere-${v.name}.mkv`); fs.writeFileSync(fichier, VIDEO);
  const lib = async (t) => (await pg.query('SELECT id FROM libraries WHERE type = $1', [t])).rows[0][0];
  const films = Number(await lib('movies')), series = Number(await lib('shows'));
  const ins = async (cols, vals) => Number((await pg.query(`INSERT INTO items(${cols.join(', ')}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)).rows[0][0]);
  try {
    // Des titres « en plus » d'abord, dans un ordre propre à chaque serveur : les identifiants locaux diffèrent
    for (let i = 0; i < ordre; i++) await ins(['library_id', 'type', 'category', 'title', 'path', 'added_at'], [films, 'movie', 'movie', `Bouche-trou ${i}`, path.join(tmp, `${v.name}-x${i}.mkv`), 1]);
    for (const [t, tmdb] of [['Matrix', 603], ['Pulp Fiction', 680], ['Le Voyage de Chihiro', 129]]) ids[t] = await ins(['library_id', 'type', 'category', 'title', 'tmdb_id', 'path', 'added_at', 'duration'], [films, 'movie', 'movie', t, tmdb, path.join(tmp, `${v.name}-${tmdb}.mkv`), 1, 5400]);
    ids.serie = await ins(['library_id', 'type', 'category', 'title', 'tmdb_id', 'added_at'], [series, 'show', 'show', 'Game of Thrones', 1399, 1]);
    ids.saison = await ins(['library_id', 'type', 'category', 'title', 'parent_id', 'show_id', 'season_num', 'added_at'], [series, 'season', 'show', 'Saison 1', ids.serie, ids.serie, 1, 1]);
    for (const e of [1, 2]) ids[`s1e${e}`] = await ins(['library_id', 'type', 'category', 'title', 'parent_id', 'show_id', 'season_num', 'episode_num', 'path', 'added_at', 'duration'], [series, 'episode', 'show', `Épisode ${e}`, ids.saison, ids.serie, 1, e, path.join(tmp, `${v.name}-got-s1e${e}.mkv`), 1, 3300]);
    ids.mystere = await ins(['library_id', 'type', 'category', 'title', 'path', 'added_at', 'duration'], [films, 'movie', 'movie', 'Film mystère', fichier, 1, 4000]);
  } finally { await pg.close(); }
  return ids;
}

before(async () => {
  if (skip) return;
  for (const d of dbs) await adminSql(`CREATE DATABASE ${d}`);
  const [pa, pb] = [await freePort(), await freePort()];
  odinProc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(HERE, 'vrai-odin-lanceur.mjs')], { cwd: DEPOT, env: { ...process.env, ODIN_DEPOT: DEPOT }, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; odinProc.stderr.on('data', (d) => { err += d; });
  O = await new Promise((ok, ko) => { let buf = ''; odinProc.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) ok(JSON.parse(buf.slice(0, i))); }); odinProc.on('exit', () => ko(new Error(`Odin s'est arrêté :\n${err.slice(-3000)}`))); });
  relais = await relaisVers(Number(new URL(O.url).port));
  [A, B] = await Promise.all([venus('a', dbs[0], pa), venus('b', dbs[1], pb)]);
});
after(async () => {
  for (const n of procs.keys()) await stop(n);
  await relais?.close();
  if (odinProc) { odinProc.stdin.end(); await new Promise((r) => { odinProc.on('exit', r); setTimeout(r, 5000); }); }
  if (!skip) for (const d of dbs) await adminSql(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deux vrais serveurs Venus reliés au même compte d’Odin (A à travers le relais)', { skip }, async () => {
  for (const [v, ordre] of [[A, 0], [B, 4]]) {
    const s = await call(v, '/api/setup', { method: 'POST', body: { password: FOYER, name: 'Awa', pin: '2468', moviesPath: path.join(tmp, `${v.name}-films`), showsPath: path.join(tmp, `${v.name}-series`) } });
    assert.ok(s.data.token, JSON.stringify(s.data));
    v.token = s.data.token;
    v.ids = await bibliotheque(v, ordre);
  }
  assert.notEqual(A.ids.Matrix, B.ids.Matrix, 'identifiants locaux différents');
  for (const [v, port] of [[A, relais.port], [B, Number(new URL(O.url).port)]]) {
    const l = await call(v, '/api/admin/odin/lien', { method: 'POST', token: v.token, body: { host: '127.0.0.1', port, email: O.proprietaire.email, password: O.proprietaire.mdp } });
    assert.equal(l.data.ok, true, JSON.stringify(l.data));
  }
  for (const v of [A, B]) assert.ok(await until(async () => { const f = await fiches(v); return f.enLigne && f.verifie > 0; }, 15000), `${v.name} écoute Odin ${JSON.stringify(await fiches(v))}${journal(v)}`);
});

/** Fait `act` sur `de`, attend que `voir` soit vrai sur `vers` ; rend le délai en ms. */
async function propage(act, voir, quoi) {
  const t0 = Date.now();
  const r = await act(); assert.ok(r.status < 300, `${quoi} : ${r.status} ${JSON.stringify(r.data)}`);
  const ok = await until(voir, 5000);
  const ms = Date.now() - t0;
  assert.ok(ok, `${quoi} : pas arrivé${journal(A)}${journal(B)}`);
  console.log(`# ${quoi} : ${ms} ms (${new Date(t0).toISOString().slice(17, 23)})`);
  return ms;
}

test('« Ma liste », favori, reprise d’épisode, titre sans TMDB : ajoutés sur A, visibles sur B en moins de 2 s', { skip }, async () => {
  const maListeB = async () => (await call(B, '/api/mylist', { token: B.token })).data.map((x) => x.id);
  const temps = [];
  temps.push(['« Ma liste » A → B', await propage(() => call(A, `/api/items/${A.ids.Matrix}/mylist`, { method: 'POST', token: A.token }), async () => (await maListeB()).includes(B.ids.Matrix), '« Ma liste » A → B')]);
  temps.push(['favori A → B', await propage(() => call(A, `/api/items/${A.ids['Pulp Fiction']}/opinion`, { method: 'POST', token: A.token, body: { liked: true } }), async () => (await call(B, `/api/items/${B.ids['Pulp Fiction']}`, { token: B.token })).data.opinion === 1, 'favori (j’aime) A → B')]);
  temps.push(['reprise S1E2 A → B', await propage(() => call(A, '/api/progress', { method: 'POST', token: A.token, body: { itemId: A.ids.s1e2, position: 1234, duration: 3300 } }), async () => (await position(B, B.ids.s1e2)) === 1234, 'reprise de l’épisode S1E2 A → B')]);
  temps.push(['sans TMDB A → B', await propage(() => call(A, `/api/items/${A.ids.mystere}/mylist`, { method: 'POST', token: A.token }), async () => (await maListeB()).includes(B.ids.mystere), 'titre sans TMDB (empreinte du fichier) A → B')]);
  // Dans l'autre sens, et un retrait
  temps.push(['retrait B → A', await propage(() => call(B, `/api/items/${B.ids.Matrix}/mylist`, { method: 'POST', token: B.token }), async () => !(await call(A, '/api/mylist', { token: A.token })).data.some((x) => x.id === A.ids.Matrix), 'retrait de « Ma liste » B → A')]);
  const lents = temps.filter(([, ms]) => ms >= 2000);
  assert.deepEqual(lents, [], `moins de 2 s chacun (charge de la machine : ${os.loadavg()[0].toFixed(1)})${journal(A)}${journal(B)}`);
});

test('conflit : la reprise la plus récente gagne sur les deux serveurs', { skip }, async () => {
  const pos = position;
  // A et B changent la même reprise presque en même temps (B en dernier)
  await call(A, '/api/progress', { method: 'POST', token: A.token, body: { itemId: A.ids['Le Voyage de Chihiro'], position: 600, duration: 5400 } });
  await sleep(30);
  await call(B, '/api/progress', { method: 'POST', token: B.token, body: { itemId: B.ids['Le Voyage de Chihiro'], position: 900, duration: 5400 } });
  assert.ok(await until(async () => (await pos(A, A.ids['Le Voyage de Chihiro'])) === 900 && (await pos(B, B.ids['Le Voyage de Chihiro'])) === 900, 5000), `les deux à 900 : A ${await pos(A, A.ids['Le Voyage de Chihiro'])}, B ${await pos(B, B.ids['Le Voyage de Chihiro'])}${journal(A)}${journal(B)}`);
});

test('coupure de A, changements des deux côtés, puis rattrapage au retour du réseau (le plus récent gagne)', { skip }, async () => {
  const pos = position;
  relais.coupe();
  assert.ok(await until(async () => !(await fiches(A)).enLigne, 5000), 'A hors ligne');
  // B : une reprise (plus ancienne) et un ajout à « Ma liste » ; A, coupé : la même reprise, plus tard, et un favori
  await call(B, '/api/progress', { method: 'POST', token: B.token, body: { itemId: B.ids.Matrix, position: 300, duration: 5400 } });
  await call(B, `/api/items/${B.ids['Pulp Fiction']}/mylist`, { method: 'POST', token: B.token });
  await sleep(50);
  await call(A, '/api/progress', { method: 'POST', token: A.token, body: { itemId: A.ids.Matrix, position: 2400, duration: 5400 } });
  await call(A, `/api/items/${A.ids.Matrix}/opinion`, { method: 'POST', token: A.token, body: { liked: false } });
  assert.ok(await until(async () => (await fiches(A)).attente >= 2, 3000), `fiches de A en attente ${JSON.stringify(await fiches(A))}${await ombreDe(A)}${journal(A)}`);
  await sleep(1500);
  assert.equal(await pos(B, B.ids.Matrix), 300, 'B ne voit rien de A pendant la coupure');
  const t0 = Date.now();
  relais.retablit();
  assert.ok(await until(async () => (await pos(B, B.ids.Matrix)) === 2400 && (await pos(A, A.ids.Matrix)) === 2400, 20000), `reprise la plus récente (A, 2400) partout${journal(A)}${journal(B)}`);
  assert.ok(await until(async () => (await call(A, '/api/mylist', { token: A.token })).data.some((x) => x.id === A.ids['Pulp Fiction']), 5000), '« Ma liste » de B arrivée chez A');
  assert.ok(await until(async () => (await call(B, `/api/items/${B.ids.Matrix}`, { token: B.token })).data.opinion === -1, 5000), 'favori de A arrivé chez B');
  console.log(`# rattrapage : ${Date.now() - t0} ms après le retour du réseau`);
});

test('empreintes identiques (A, B et Odin) et aucune boucle d’envois au repos', { skip }, async () => {
  // Les deux serveurs au repos, vérifiés à l'identique
  assert.ok(await until(async () => { const [a, b] = [await fiches(A), await fiches(B)]; return a.identique === true && b.identique === true && !a.attente && !b.attente && JSON.stringify(a.empreintes) === JSON.stringify(b.empreintes); }, 15000),
    `A ${JSON.stringify(await fiches(A))}\nB ${JSON.stringify(await fiches(B))}${journal(A)}${journal(B)}`);
  const [a, b] = [await fiches(A), await fiches(B)];
  // Celles d'Odin (lues avec un jeton de l'appli Vénus du même compte)
  const c = await fetch(`${O.url}/sso/connexion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiant: O.proprietaire.email, motdepasse: O.proprietaire.mdp, appli: 'venus', appareil: { id: 'essai-empreintes-x', nom: 'essai' } }) }).then((r) => r.json());
  const odin = (await fetch(`${O.url}/api/venus/empreintes`, { headers: { authorization: `Bearer ${c.access_token}` } }).then((r) => r.json())).empreintes;
  assert.deepEqual(a.empreintes, odin, 'A = Odin'); assert.deepEqual(b.empreintes, odin, 'B = Odin');
  assert.ok(odin.maliste.n >= 3 && odin.reprises.n >= 3 && odin.favoris.n >= 2 && odin.profils.n === 1, JSON.stringify(odin));
  console.log(`# empreintes identiques : ${Object.entries(odin).map(([k, x]) => `${k} ${x.n}`).join(', ')}`);
  // Au repos : plus rien ne part, ni de A ni de B (deux vérifications de 4 s passent)
  await sleep(9000);
  const [a2, b2] = [await fiches(A), await fiches(B)];
  assert.equal(a2.envois, a.envois, `A n’envoie plus rien${journal(A)}`); assert.equal(b2.envois, b.envois, `B n’envoie plus rien${journal(B)}`);
  // Un seul changement sur A : un seul envoi de A, aucun de B (il l'applique sans le renvoyer)
  await propage(() => call(A, `/api/items/${A.ids['Le Voyage de Chihiro']}/opinion`, { method: 'POST', token: A.token, body: { liked: true } }), async () => (await call(B, `/api/items/${B.ids['Le Voyage de Chihiro']}`, { token: B.token })).data.opinion === 1, 'un favori de plus A → B');
  await sleep(2000);
  const [a3, b3] = [await fiches(A), await fiches(B)];
  assert.equal(a3.envois, a2.envois + 1, 'un envoi de A'); assert.equal(b3.envois, b2.envois, 'B ne renvoie pas ce qu’il a reçu');
  assert.equal(b3.recues, b2.recues + 1, 'B a reçu une fiche');
});
