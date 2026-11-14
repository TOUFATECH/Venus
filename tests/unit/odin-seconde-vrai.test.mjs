// Venus synchronisé à la seconde avec le VRAI Odin (copie du dépôt donnée par ODIN_DEPOT, utilisée en lecture seule) :
// deux vrais serveurs Venus, un vrai Odin (tests/unit/vrai-odin-lanceur.mjs), et entre Venus A et Odin un relais TCP
// qu'on coupe pour simuler une coupure réseau.
// - un favori, une reprise de lecture, un nouvel utilisateur, un réglage : chez Odin (dans son index) en moins de 2 s,
//   en « changements » ;
// - coupure réseau : file d'attente chiffrée sur le disque de Venus, Venus redémarré pendant la coupure, puis rattrapage
//   dans l'ordre au retour du réseau ; empreinte d'Odin = celle du dernier envoi de Venus ;
// - installation neuve B : « Restaurer depuis Odin » au dernier état (complète + changements) → empreinte de la base de B
//   identique à celle de A ; ensuite A et B écrivent tous deux dans le même compte (chacun voit l'autre noté).
// ODIN_DEPOT=/chemin/vers/odin VENUS_TEST_PG=postgres://… node --test tests/unit/odin-seconde-vrai.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPOT = process.env.ODIN_DEPOT;
const skip = !DEPOT || !fs.existsSync(path.join(DEPOT || '/', 'src/valhalla/sso/sauvegardes.ts')) ? 'ODIN_DEPOT (copie d’Odin avec les sauvegardes des applis) non donné' : false;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-seconde-vrai-'));
const dbs = [`venus_sec_a_${process.pid}`, `venus_sec_b_${process.pid}`];
const procs = new Map();
let O, A, B, odinProc, relais;

async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { return await pg.simple(sql); } finally { await pg.close(); } }
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(50); } };

/** Relais TCP Venus → Odin : coupe() ferme tout et refuse les connexions (câble débranché), retablit() rouvre. */
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
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(tmp, name), VENUS_DATABASE_URL: u.toString(), VENUS_UI: 'classic', HTTPS: '0', VENUS_IPTV_WORLD: '0', VENUS_COFFRE: '0', VENUS_ODIN_CHECK_MS: '4000', VENUS_ODIN_JOURNAL: '2', TRANSCODE_DIR: path.join(tmp, `${name}-tr`) };
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
// Ce que le vrai Odin a rangé pour Vénus (son index : liste des versions ; les versions elles-mêmes sont chiffrées)
const odinIndex = () => {
  const base = path.join(O.home, 'valhalla', 'freyja', 'sauvegardes');
  const who = fs.existsSync(base) ? fs.readdirSync(base) : [];
  if (!who.length) return { versions: [] };
  try { return JSON.parse(fs.readFileSync(path.join(base, who[0], 'index.json'), 'utf8')); } catch { return { versions: [] }; }
};
const odinVersions = () => [...odinIndex().versions].sort((a, b) => b.date - a.date);
const journal = (v) => `\n${v.log().split('\n').filter((l) => l.includes('[odin]')).slice(-20).join('\n')}`;
const etat = async (v, token) => (await call(v, '/api/admin/odin/lien', { token })).data.sauvegarde || {};

before(async () => {
  if (skip) return;
  for (const d of dbs) await adminSql(`CREATE DATABASE ${d}`);
  const [pa, pb] = [await freePort(), await freePort()];
  odinProc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(HERE, 'vrai-odin-lanceur.mjs'), `http://127.0.0.1:${pb}/auth/odin/retour`], { cwd: DEPOT, env: { ...process.env, ODIN_DEPOT: DEPOT }, stdio: ['pipe', 'pipe', 'pipe'] });
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

const FOYER = 'Foyer-Venus-2026!solide';
let tokenA, items = [], profilA;
/**
 * Fait `act`, puis attend que le vrai Odin ait rangé une nouvelle version (dont la raison contient `raison`, si donnée :
 * l'analyse de la bibliothèque de Venus envoie aussi les siens) ; rend { ms, v }.
 */
async function chezOdin(act, raison = '') {
  const seen = new Set(odinVersions().map((v) => v.id)), t0 = Date.now();
  await act();
  const v = await until(() => odinVersions().find((x) => !seen.has(x.id) && x.raison.includes(raison)), 5000);
  assert.ok(v, `rien reçu par Odin${raison ? ` (${raison})` : ''} ; Odin a : ${JSON.stringify(odinVersions().slice(0, 4).map((x) => [x.sorte, x.raison, x.date - t0]))}${A ? journal(A) : ''}`);
  return { ms: v.date - t0, v };
}

test('vrai Odin : Venus A relié (à travers le relais), première sauvegarde complète', { skip }, async () => {
  const s = await call(A, '/api/setup', { method: 'POST', body: { password: FOYER, name: 'Awa', pin: '2468', moviesPath: path.join(tmp, 'films'), showsPath: path.join(tmp, 'series') } });
  tokenA = s.data.token;
  profilA = (await call(A, '/api/me', { token: tokenA })).data.id;
  const { Pg } = await import('../../server/pg.js');
  const u = new URL(ADMIN);
  const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: dbs[0] });
  try {
    for (const [t, y] of [['Orage', 2018], ['Lagon', 2021], ['Mangrove', 2023]]) items.push(Number((await pg.query("INSERT INTO items(library_id, type, category, title, year, path, added_at, duration) SELECT id, 'movie', 'movie', $1, $2, $3, 1, 5400 FROM libraries WHERE type = 'movies' RETURNING id", [t, y, path.join(tmp, 'films', `${t} (${y}).mkv`)])).rows[0][0]));
  } finally { await pg.close(); }
  const { v } = await chezOdin(() => call(A, '/api/admin/odin/lien', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: relais.port, email: O.proprietaire.email, password: O.proprietaire.mdp } }).then((l) => assert.equal(l.data.ok, true, JSON.stringify(l.data))));
  assert.equal(v.sorte, 'complete');
});

test('vrai Odin : favori, reprise de lecture, nouvel utilisateur, réglage → chez Odin en moins de 2 s, en « changements »', { skip }, async () => {
  const base = odinVersions().find((x) => x.sorte === 'complete').id;
  const cases = [
    ['favori', () => call(A, `/api/items/${items[0]}/mylist`, { method: 'POST', token: tokenA }), 'ma liste'],
    ['reprise de lecture', () => call(A, '/api/progress', { method: 'POST', token: tokenA, body: { itemId: items[1], position: 1834, duration: 5400 } }), 'reprise de lecture'],
    ['nouvel utilisateur', () => call(A, '/api/profiles', { method: 'POST', token: tokenA, body: { name: 'Kofi', avatar: 3 } }), 'utilisateur'],
    ['réglage', () => call(A, '/api/admin/settings', { method: 'PUT', token: tokenA, body: { serverName: 'Venus du salon' } }), 'réglage'],
  ];
  for (const [what, act, raison] of cases) {
    const { ms, v } = await chezOdin(async () => { const r = await act(); assert.ok(r.status < 300, `${what} : ${r.status} ${JSON.stringify(r.data)}`); }, raison);
    assert.ok(ms < 2000, `${what} : rangé par le vrai Odin en ${ms} ms`);
    assert.equal(v.sorte, 'changements', what);
    assert.equal(v.base, base, what);
    console.log(`# ${what} : chez Odin en ${ms} ms (${v.taille} octets)`);
  }
  // Vérification à l'identique (celle des 30 s, ici toutes les 4 s)
  assert.ok(await until(async () => { const s = await etat(A, tokenA); return s.identique === true && s.verifie > Date.now() - 6000; }, 12000), `vérifié à l’identique ${JSON.stringify(await etat(A, tokenA))}${journal(A)}`);
  // (l'analyse de la bibliothèque peut envoyer entre deux lectures : on compare deux lectures stables)
  assert.ok(await until(async () => (await etat(A, tokenA)).sha === odinVersions()[0].empreinte, 8000), 'empreinte gardée par Odin = celle du dernier envoi de Venus');
});

test('vrai Odin : coupure réseau, Venus redémarré pendant la coupure, puis rattrapage dans l’ordre', { skip }, async () => {
  const n = odinVersions().length;
  relais.coupe();
  assert.ok((await call(A, `/api/items/${items[2]}/mylist`, { method: 'POST', token: tokenA })).data.inList);
  await sleep(2000);
  await call(A, '/api/progress', { method: 'POST', token: tokenA, body: { itemId: items[1], position: 2400, duration: 5400 } });
  await sleep(2000);
  await call(A, '/api/profiles', { method: 'POST', token: tokenA, body: { name: 'Zébulon', avatar: 4 } });
  const dir = path.join(tmp, 'a', 'odin-attente');
  assert.ok(await until(() => fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith('.voq')).length >= 3, 6000), 'trois envois en file (et ceux de l’analyse de la bibliothèque)');
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f)).includes(Buffer.from('Zébulon')), `${f} chiffré`);
  const s = await etat(A, tokenA);
  assert.equal(s.horsLigne, true);
  assert.ok(s.attente >= 3, journal(A));
  assert.equal(odinVersions().length, n, 'rien chez Odin pendant la coupure');
  // Venus s'arrête et redémarre pendant la coupure : la file reste sur le disque
  await stop('a');
  A = await venus('a', dbs[0], A.port);
  await sleep(2500);
  assert.ok(fs.readdirSync(dir).filter((f) => f.endsWith('.voq')).length >= 3, 'toujours en file après le redémarrage');
  // Le réseau revient : à la connexion suivante, tout part dans l'ordre
  const t0 = Date.now();
  relais.retablit();
  assert.ok(await until(() => odinVersions().length >= n + 3 && odinVersions().slice(0, odinVersions().length - n).some((v) => v.raison.includes('utilisateur')) && !fs.readdirSync(dir).some((f) => f.endsWith('.voq')), 20000), `rattrapé (${odinVersions().length - n} reçus)${journal(A)}`);
  console.log(`# rattrapage : ${odinVersions().length - n} envois rangés par Odin ${Date.now() - t0} ms après le retour du réseau`);
  // Les trois envois en file arrivent dans l'ordre (suivis, si la base a bougé pendant l'arrêt — analyse de la
  // bibliothèque —, d'une complète)
  const back = odinVersions().slice(0, odinVersions().length - n).reverse();
  const order = ['ma liste', 'reprise de lecture', 'utilisateur'].map((r) => back.findIndex((v) => v.sorte === 'changements' && v.raison.includes(r)));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `dans l’ordre : ${JSON.stringify(back.map((v) => v.raison))}${journal(A)}`);
  assert.ok(await until(async () => { const x = await etat(A, tokenA); return x.identique === true && x.attente === 0 && x.verifie > t0; }, 15000), 'à l’identique après le rattrapage');
  assert.ok(await until(async () => (await etat(A, tokenA)).sha === odinVersions()[0].empreinte, 8000), 'empreinte d’Odin = dernier envoi de Venus');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.voq')).length, 0);
});

let fpA, tRestore;
test('vrai Odin : installation neuve B restaurée au dernier état (complète + changements) → même empreinte que A', { skip }, async () => {
  // A au repos (son dernier envoi est le dernier d'Odin) : on note l'empreinte de sa base
  let sA;
  await until(async () => { sA = await etat(A, tokenA); return sA.dernier === odinVersions()[0].id && !sA.attente; }, 15000);
  fpA = sA.empreinte;
  const v = await call(B, '/api/odin/premiere/versions', { method: 'POST', body: { host: '127.0.0.1', port: Number(new URL(O.url).port), email: O.proprietaire.email, password: O.proprietaire.mdp } });
  assert.equal(v.data.ok, true, JSON.stringify(v.data));
  assert.equal(v.data.versions[0].dernierEtat, true);
  assert.equal(v.data.versions[0].id, odinVersions()[0].id, 'le dernier état proposé en premier');
  tRestore = Date.now();
  const r = await call(B, '/api/odin/premiere/restaurer', { method: 'POST', body: { version: v.data.versions[0].id, password: O.proprietaire.mdp } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const target = odinVersions().find((x) => x.id === r.data.version);
  assert.equal(r.data.changements, odinVersions().filter((x) => x.sorte === 'changements' && x.base === target.base && x.date <= target.date).length, 'la complète et tous ses changements rejoués');
  assert.equal(r.data.identique, true, 'empreinte de la base de B = empreinte notée par A dans son dernier envoi');
  if (r.data.version === sA.dernier) assert.equal(r.data.empreinte, fpA, 'B a exactement la base de A');
  else console.log('# (A a envoyé entre-temps : comparaison faite avec l’empreinte notée dans la version restaurée)');
  const tB = (await call(B, '/api/login', { method: 'POST', body: { password: FOYER } })).data.token;
  const profiles = (await call(B, '/api/profiles', { token: tB })).data;
  assert.deepEqual(profiles.map((p) => p.name).sort(), ['Awa', 'Kofi', 'Zébulon']);
  await call(B, `/api/profiles/${profilA}/select`, { method: 'POST', token: tB, body: { pin: '2468' } });
  assert.deepEqual((await call(B, '/api/mylist', { token: tB })).data.map((x) => x.id).sort(), [items[0], items[2]].sort());
  const cont = (await call(B, `/api/items/${items[1]}`, { token: tB })).data;
  assert.equal(Math.round((cont.progress && cont.progress.position) ?? cont.position ?? -1), 2400, 'reprise au même endroit sur B');
});

test('vrai Odin : A et B écrivent dans le même compte (chacun le voit noté), les changements de A partent toujours', { skip }, async () => {
  // B, relié après sa restauration, envoie sa propre complète (sa série à lui)
  assert.ok(await until(() => odinVersions().some((x) => x.sorte === 'complete' && x.date > tRestore && x.raison === 'après restauration'), 10000), 'complète de B après la restauration');
  const { ms, v } = await chezOdin(() => call(A, '/api/progress', { method: 'POST', token: tokenA, body: { itemId: items[0], position: 600, duration: 5400 } }), 'reprise de lecture');
  assert.ok(ms < 2000, `${ms} ms`);
  assert.equal(v.sorte, 'changements');
  assert.ok(await until(async () => { const x = await etat(A, tokenA); return x.autrePoste && x.identique === true; }, 12000), 'A note l’autre serveur et reste à l’identique');
  console.log(journal(A).split('\n').map((l) => `# ${l}`).join('\n'));
});
