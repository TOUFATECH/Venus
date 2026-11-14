// Venus ↔ Odin, au niveau des modules, avec une vraie base PostgreSQL et un faux Odin fidèle au contrat
// (tests/unit/faux-odin.mjs) : certificat épinglé, lien (mot de passe jamais gardé), sauvegarde envoyée, base effacée
// puis restaurée à l'identique (secrets compris), restauration demandée par Odin, connexion OpenID (PKCE, signature,
// state, nonce), refus sans droit avec le message d'Odin, comptes locaux quand Odin ne répond pas.
// Base PostgreSQL de test : VENUS_TEST_PG (compte qui peut créer des bases).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { fauxOdin } from './faux-odin.mjs';

const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `venus_odin_${process.pid}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-odin-'));
let D, L, B, S, N, odin;
async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { await pg.simple(sql); } finally { await pg.close(); } }

before(async () => {
  await adminSql(`CREATE DATABASE ${dbName}`);
  const u = new URL(ADMIN); u.pathname = `/${dbName}`;
  Object.assign(process.env, { VENUS_DATABASE_URL: u.toString(), DATA_DIR: path.join(tmp, 'data'), VENUS_COFFRE: '0' });
  D = await import('../../server/db.js');
  L = await import('../../server/odin-link.js');
  B = await import('../../server/odin-backup.js');
  S = await import('../../server/odin-sso.js');
  N = await import('../../server/odin-net.js');
  odin = await fauxOdin({ tls: true });
  odin.addPerson({ preferred_username: 'awa', name: 'Awa Saïd', email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1', groups: ['admin'] });
  odin.addPerson({ preferred_username: 'kofi', name: 'Kofi', email: 'kofi@exemple.yt', password: 'mot-de-passe-kofi', groups: ['famille'] });
  odin.addPerson({ preferred_username: 'invite', name: 'Invité', email: 'invite@exemple.yt', password: 'mot-de-passe-invite', groups: ['invite'] });
  odin.addPerson({ preferred_username: 'zoe', name: 'Zoé', email: 'zoe@exemple.yt', password: 'mot-de-passe-zoe-12', groups: ['famille'], twofa: '123456' });
});
after(async () => { await odin?.close(); fs.rmSync(tmp, { recursive: true, force: true }); await adminSql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); });

const { run, get, all } = new Proxy({}, { get: (_, k) => (...a) => D[k](...a) });
function fillBase() {
  D.setSetting('household_password', 's2$32768$00$00');
  D.setSetting('server_name', 'Venus du salon');
  D.setSetting('tmdb_key', 'cle-tmdb-secrete-123');
  run('INSERT INTO libraries(name, type, path) VALUES(?, ?, ?)', 'Films', 'movies', '/media/films');
  const lib = get('SELECT id FROM libraries').id;
  for (let i = 1; i <= 30; i++) run('INSERT INTO items(library_id, type, title, path, added_at) VALUES(?, ?, ?, ?, ?)', lib, 'movie', `Film ${i}`, `/media/films/f${i}.mkv`, 1700000000000 + i);
  run('INSERT INTO profiles(name, avatar, is_admin, email, created_at) VALUES(?, ?, ?, ?, ?)', 'Awa', 1, 1, 'awa@exemple.yt', 1);
  run('INSERT INTO profiles(name, avatar, is_admin, max_age, created_at) VALUES(?, ?, ?, ?, ?)', 'Petit', 2, 0, 10, 2);
  const [a, p] = all('SELECT id FROM profiles ORDER BY id').map((r) => r.id);
  const items = all('SELECT id FROM items ORDER BY id').map((r) => r.id);
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', a, items[3], 5);
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', p, items[7], 6);
  run('INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, ?, ?, ?, ?)', a, items[1], 1234.5, 5400, 0, 7);
  run('INSERT INTO playlists(profile_id, name, created_at, updated_at) VALUES(?, ?, ?, ?)', a, 'Soirée', 8, 8);
  run('INSERT INTO tokens(token, profile_id, device, created_at, last_seen) VALUES(?, ?, ?, ?, ?)', 'h1:session-du-salon', a, 'TV', Date.now(), Date.now());
}

test('certificat d’Odin : épinglé au premier contact, un autre certificat est refusé', async () => {
  const host = '127.0.0.1';
  const t = await L.testAddress(host, odin.port);
  assert.equal(t.fingerprint, odin.certFp, 'empreinte SHA-256 du certificat réellement présenté');
  assert.equal(t.url, odin.url);
  await assert.rejects(N.odinRequest(`${odin.url}/sso/cles`, { pin: 'a'.repeat(64) }), /certificat d’Odin a changé/);
  await assert.rejects(L.testAddress('127.0.0.1', 1), /ne répond pas|injoignable/);
});

test('lien : refus clairs (mot de passe, double authentification, pas de droit), puis relié sans garder le mot de passe', async () => {
  const at = { host: '127.0.0.1', port: odin.port };
  await assert.rejects(L.link({ ...at, email: 'awa@exemple.yt', password: 'faux' }), { message: 'Identifiant ou mot de passe incorrect.' });
  await assert.rejects(L.link({ ...at, email: 'zoe@exemple.yt', password: 'mot-de-passe-zoe-12' }), (e) => e.code === 'code_requis');
  await assert.rejects(L.link({ ...at, email: 'invite@exemple.yt', password: 'mot-de-passe-invite' }), { status: 403, message: 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.' });
  assert.equal(L.linked(), false);
  fillBase();
  const s = await L.link({ ...at, email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1' }, { onPassword: (pw, e) => B.rememberKeyWrap(pw, e) });
  assert.equal(s.linked, true);
  assert.equal(s.who.nom, 'Awa Saïd');
  // Ni le mot de passe ni un jeton en clair dans la base
  const dump = JSON.stringify(all('SELECT * FROM settings'));
  assert.doesNotMatch(dump, /mot-de-passe-awa-1/);
  assert.doesNotMatch(dump, /odr1\./, 'le jeton de renouvellement est chiffré');
  assert.match(D.getSetting('odin_sso_refresh'), /^odr1\./);
});

let firstVersion, before1;
test('sauvegarde : envoyée, pas renvoyée sans changement, renvoyée après un changement important', async () => {
  const r = await B.sendNow({ force: true, why: 'manuelle' });
  assert.equal(r.ok, true, r.error);
  const list = await B.versions();
  assert.equal(list.length, 1);
  firstVersion = list[0].id;
  assert.equal(list[0].raison, 'manuelle');
  assert.equal((await B.sendNow()).skipped, 'déjà à jour');
  assert.equal((await B.checkNow()).skipped, 'à l’identique', 'vérification des 5 minutes : même empreinte des deux côtés');
  // Le jeton de renouvellement tourne : chaque renouvellement en rend un nouveau, aussitôt gardé
  const old = D.getSetting('odin_sso_refresh');
  L.forgetAppToken();
  await L.appToken();
  assert.notEqual(D.getSetting('odin_sso_refresh'), old);
  assert.equal((await B.checkNow()).skipped, 'à l’identique', 'le jeton qui tourne ne change pas l’empreinte');
  // Un favori : changement important, envoyé
  const a = get('SELECT id FROM profiles ORDER BY id').id;
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', a, get('SELECT id FROM items ORDER BY id DESC').id, 9);
  const r2 = await B.sendNow();
  assert.equal(r2.ok, true);
  assert.equal((await B.versions()).length, 2);
  // L'archive envoyée : toute la base sauf sessions, caches et journaux ; secrets toujours chiffrés
  const d = (await import('../../server/db-copy.js')).parseDump(await B.download((await B.versions())[0].id));
  assert.ok(d.tables.profiles.length === 2 && d.tables.mylist.length === 3 && d.tables.progress.length === 1 && d.tables.playlists.length === 1);
  assert.equal(d.tables.tokens, undefined, 'les sessions des appareils ne partent pas');
  assert.doesNotMatch(JSON.stringify(d), /cle-tmdb-secrete-123/, 'les secrets partent chiffrés');
  assert.doesNotMatch(JSON.stringify(d), /mot-de-passe-awa-1/);
  assert.ok(d.cle && d.cle.kid, 'clé des secrets emballée avec le mot de passe Odin');
  before1 = B.fingerprint();
});

test('restauration : base effacée, nouvelle clé (nouvelle machine) → restaurée à l’identique, secrets retrouvés avec le mot de passe', async () => {
  const snapshot = (t) => JSON.stringify(all(`SELECT * FROM ${t} ORDER BY 1, 2`));
  const keep = Object.fromEntries(['profiles', 'mylist', 'progress', 'playlists', 'items', 'libraries'].map((t) => [t, snapshot(t)]));
  const id = (await B.versions())[0].id;
  const buf = await B.download(id);
  // Nouvelle installation : base vide, autre clé des secrets
  const tables = all("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").map((r) => `"${r.t}"`);
  D.db.pg.call({ op: 'query', sql: `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`, params: [] });
  D.replaceSecretKey(crypto.randomBytes(32));
  assert.equal(B.baseEmpty(), true);
  assert.equal(L.linked(), false);
  // Comme « Restaurer depuis Odin » à la première installation : connexion, lien gardé, puis restauration
  const input = { host: '127.0.0.1', port: odin.port, email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1' };
  L.keepLink(await L.login(input), input);
  assert.equal((await B.sendNow({ force: true })).skipped, 'base vide', 'une base vide n’écrase jamais la dernière sauvegarde');
  // Sans le mot de passe : tout revient sauf les secrets
  let r = B.restoreBuffer(buf, {});
  assert.equal(r.secrets, 'sans mot de passe');
  assert.equal(D.getSetting('tmdb_key', null), null);
  // Avec le mot de passe Odin : les secrets aussi
  r = B.restoreBuffer(buf, { password: 'mot-de-passe-awa-1' });
  assert.equal(r.secrets, 'retrouvés');
  assert.equal(D.getSetting('tmdb_key'), 'cle-tmdb-secrete-123');
  assert.equal(D.getSetting('server_name'), 'Venus du salon');
  for (const [t, v] of Object.entries(keep)) assert.equal(snapshot(t), v, `table ${t} identique`);
  assert.equal(B.fingerprint(), before1, 'même empreinte qu’avant l’effacement');
  // Le lien d'aujourd'hui est gardé (pas celui de la sauvegarde), la sauvegarde continue
  assert.equal(L.linked(), true);
  assert.equal((await B.checkNow()).skipped, 'à l’identique');
  // Une nouvelle ligne après restauration prend un numéro libre (compteurs remis)
  run('INSERT INTO profiles(name, created_at) VALUES(?, ?)', 'Nouveau', 3);
  assert.equal(get("SELECT id FROM profiles WHERE name = 'Nouveau'").id, 3);
});

test('restauration demandée dans Odin (« Restaurer » sur une version) : faite, puis confirmée', async () => {
  run('DELETE FROM mylist');
  assert.equal(all('SELECT * FROM mylist').length, 0);
  odin.S.restaurer = firstVersion;
  const r = await B.checkNow();
  assert.equal(r.restaure, firstVersion);
  assert.equal(odin.S.restaurer, null, 'Odin a reçu la confirmation');
  assert.equal(odin.S.restauree, firstVersion);
  assert.equal(all('SELECT * FROM mylist').length, 2, 'état de la première version');
  assert.ok(fs.readdirSync(path.join(tmp, 'data', 'backups')).some((f) => f.startsWith('venus-avant-restauration-')), 'état d’avant gardé en local');
});

// ---------------------------------------------------------------- connexion des utilisateurs (OpenID + PKCE)
const ORIGIN = 'http://venus.essai:8096';
function browser(url, cookie = '') {
  const u = new URL(url);
  return new Promise((ok, ko) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', headers: cookie ? { cookie } : {}, rejectUnauthorized: false }, (res) => { res.resume(); ok({ status: res.statusCode, location: res.headers.location }); });
    req.on('error', ko); req.end();
  });
}
test('connexion par Odin : session Odin du navigateur → profil Venus (créé puis retrouvé), sans écran', async () => {
  odin.S.redirects = [`${ORIGIN}/auth/odin/retour`];
  const a = await S.authorizeUrl(ORIGIN, { silent: true });
  const q = new URL(a.url).searchParams;
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge').length, 43);
  assert.equal(q.get('prompt'), 'none');
  const r = await browser(a.url, odin.browserSession('kofi'));
  assert.equal(r.status, 303);
  const back = new URL(r.location);
  assert.equal(back.origin + back.pathname, `${ORIGIN}/auth/odin/retour`);
  const res = await S.finish(back.searchParams, a.state);
  assert.equal(res.profile.name, 'Kofi');
  assert.equal(res.created, true);
  assert.equal(res.profile.is_admin, 0);
  // Une seconde fois : le même profil
  const a2 = await S.authorizeUrl(ORIGIN, {});
  const r2 = await browser(a2.url, odin.browserSession('kofi'));
  const res2 = await S.finish(new URL(r2.location).searchParams, a2.state);
  assert.equal(res2.profile.id, res.profile.id);
  assert.equal(res2.created, false);
  // Le profil existant d'Awa (même e-mail) est retrouvé
  const a3 = await S.authorizeUrl(ORIGIN, {});
  const res3 = await S.finish(new URL((await browser(a3.url, odin.browserSession('awa'))).location).searchParams, a3.state);
  assert.equal(res3.profile.name, 'Awa');
  assert.equal(res3.created, false);
});

test('connexion par Odin : sans droit → le message d’Odin tel quel ; sans session → login_required ; state, code et PKCE vérifiés', async () => {
  const a = await S.authorizeUrl(ORIGIN, {});
  const r = await browser(a.url, odin.browserSession('invite'));
  await assert.rejects(S.finish(new URL(r.location).searchParams, a.state), { status: 403, message: 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.' });
  const b = await S.authorizeUrl(ORIGIN, { silent: true });
  const r2 = await browser(b.url);
  await assert.rejects(S.finish(new URL(r2.location).searchParams, b.state), (e) => e.code === 'login_required');
  // Retour présenté dans un autre navigateur (cookie absent) : refusé
  const c = await S.authorizeUrl(ORIGIN, {});
  const r3 = await browser(c.url, odin.browserSession('kofi'));
  await assert.rejects(S.finish(new URL(r3.location).searchParams, 'autre'), (e) => e.code === 'state');
  // Le bon navigateur, lui, termine ; et le même retour ne sert qu'une fois
  assert.equal((await S.finish(new URL(r3.location).searchParams, c.state)).profile.name, 'Kofi');
  await assert.rejects(S.finish(new URL(r3.location).searchParams, c.state), (e) => e.code === 'state');
});

test('jetons d’Odin : signature ES256, clé, émetteur, destinataire et nonce vérifiés', async () => {
  const conn = await L.login({ host: '127.0.0.1', port: odin.port, email: 'kofi', password: 'mot-de-passe-kofi' });
  const id = conn.tokens.id_token;
  const p = await S.verifyJwt(id, { issuer: odin.url });
  assert.equal(p.preferred_username, 'kofi');
  const [h, b, s] = id.split('.');
  const forged = JSON.parse(Buffer.from(b, 'base64url')); forged.groups = ['admin'];
  await assert.rejects(S.verifyJwt(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`, { issuer: odin.url }), /Signature/);
  const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'x' })).toString('base64url');
  await assert.rejects(S.verifyJwt(`${none}.${b}.`, { issuer: odin.url }), /ES256/);
  await assert.rejects(S.verifyJwt(id, { issuer: 'https://autre:7777' }), /autre adresse/);
  await assert.rejects(S.verifyJwt(id, { issuer: odin.url, audience: 'pegase' }), /autre appli/);
  await assert.rejects(S.verifyJwt(id, { issuer: odin.url, nonce: 'n' }), /nonce/);
});

test('comptes de Venus : permis en mode « odin » ; en « odin-seul », seulement quand Odin ne répond pas', async () => {
  assert.equal(await S.localBlocked(), null);
  L.setMode('odin-seul'); S.forgetOdinCache();
  assert.match(await S.localBlocked(), /compte Odin/);
  // Odin ne répond plus : les comptes de Venus reviennent
  D.setSetting('odin_sso_url', 'https://127.0.0.1:1'); S.forgetOdinCache();
  assert.equal(await S.localBlocked(), null);
  D.setSetting('odin_sso_url', odin.url); L.setMode('odin'); S.forgetOdinCache();
});

test('délier : la session est coupée chez Odin, plus de sauvegarde', async () => {
  const s = await L.unlink();
  assert.equal(s.linked, false);
  assert.equal((await B.sendNow({ force: true })).skipped, 'pas relié');
});
