// Venus ↔ Odin de bout en bout, par HTTP : deux VRAIS serveurs Venus (chacun sa base PostgreSQL) et un Odin.
// L'Odin est le faux Odin fidèle au contrat (tests/unit/faux-odin.mjs), ou un vrai Odin déjà lancé si ODIN_ESSAI_URL
// est donné (avec ODIN_ESSAI_ADMIN « identifiant:motdepasse », droit sur Vénus).
// 1) Venus A : installation, lien avec Odin (Réglages → Odin), sauvegarde envoyée, favori → nouvelle sauvegarde.
// 2) Venus B, installation neuve : « Restaurer depuis Odin » → profils, favoris et mot de passe du foyer de A.
// 3) Connexion par Odin sur B : session Odin du navigateur → connecté sans écran ; sans droit → message d'Odin.
// 4) « Odin seulement » : le mot de passe du foyer est refusé tant qu'Odin répond.
// Base PostgreSQL de test : VENUS_TEST_PG (compte qui peut créer des bases).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fauxOdin } from './faux-odin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-odin-e2e-'));
const dbs = [`venus_e2e_a_${process.pid}`, `venus_e2e_b_${process.pid}`];
const procs = [];
let odin, A, B;

async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { return await pg.simple(sql); } finally { await pg.close(); } }
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function venus(name, db) {
  const port = await freePort();
  const u = new URL(ADMIN); u.pathname = `/${db}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(tmp, name), VENUS_DATABASE_URL: u.toString(), VENUS_UI: 'classic', HTTPS: '0', VENUS_IPTV_WORLD: '0', VENUS_COFFRE: '0', VENUS_ODIN_QUIET_MS: '300', VENUS_ODIN_CHECK_MS: '2000', TRANSCODE_DIR: path.join(tmp, `${name}-tr`) };
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  procs.push(p);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${url}/api/status`); if (r.ok) return { url, port, log: () => out }; } catch { /* pas encore */ }
    if (p.exitCode !== null) throw new Error(`Venus ${name} s'est arrêté :\n${out}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Venus ${name} ne démarre pas :\n${out}`);
}
async function call(v, p, { method = 'GET', body, token } = {}) {
  const r = await fetch(`${v.url}${p}`, { method, redirect: 'manual', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 200)); } };
// Navigateur minimal : une requête, sans suivre la redirection
function get(url, cookie = '') {
  const u = new URL(url);
  return new Promise((ok, ko) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, { headers: cookie ? { cookie } : {}, rejectUnauthorized: false }, (res) => { res.resume(); ok({ status: res.statusCode, location: res.headers.location, cookie: res.headers['set-cookie'] }); });
    req.on('error', ko); req.end();
  });
}

before(async () => {
  for (const d of dbs) await adminSql(`CREATE DATABASE ${d}`);
  odin = await fauxOdin({ tls: true });
  odin.addPerson({ preferred_username: 'awa', name: 'Awa Saïd', email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1', groups: ['admin'] });
  odin.addPerson({ preferred_username: 'kofi', name: 'Kofi', email: 'kofi@exemple.yt', password: 'mot-de-passe-kofi', groups: ['famille'] });
  odin.addPerson({ preferred_username: 'invite', name: 'Invité', email: 'invite@exemple.yt', password: 'mot-de-passe-invite', groups: ['invite'] });
  [A, B] = await Promise.all([venus('a', dbs[0]), venus('b', dbs[1])]);
});
after(async () => {
  for (const p of procs) { try { p.kill(); } catch { /* */ } }
  await new Promise((r) => setTimeout(r, 500));
  await odin?.close();
  for (const d of dbs) await adminSql(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

const FOYER = 'Foyer-Venus-2026!solide';
let tokenA, itemId;
test('Venus A : installé, relié à Odin (mot de passe Odin jamais gardé), sauvegarde envoyée, favori → nouvelle sauvegarde', async () => {
  const s = await call(A, '/api/setup', { method: 'POST', body: { password: FOYER, name: 'Awa', pin: '2468', moviesPath: path.join(tmp, 'films'), showsPath: path.join(tmp, 'series') } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  tokenA = s.data.token;
  assert.equal((await call(A, '/api/admin/odin/lien', { token: tokenA })).data.linked, false);
  const t = await call(A, '/api/admin/odin/tester', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: odin.port } });
  assert.equal(t.data.ok, true, JSON.stringify(t.data));
  const bad = await call(A, '/api/admin/odin/lien', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: odin.port, email: 'awa@exemple.yt', password: 'faux' } });
  assert.equal(bad.status, 200, 'une erreur d’Odin ne déconnecte pas l’administrateur de Venus');
  assert.equal(bad.data.error, 'Identifiant ou mot de passe incorrect.');
  const l = await call(A, '/api/admin/odin/lien', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: odin.port, email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1' } });
  assert.equal(l.data.ok, true, JSON.stringify(l.data));
  assert.equal(l.data.who.nom, 'Awa Saïd');
  const set = () => odin.backups.get(`${odin.people.get('awa').sub}|venus`) || [];
  assert.ok(await until(() => set().length >= 1), 'première sauvegarde sur Odin');
  // Un favori : renvoyé tout seul
  const { Pg } = await import('../../server/pg.js');
  const u = new URL(ADMIN);
  const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: dbs[0] });
  // Un film dans la médiathèque (fichier présent, ligne ajoutée comme le ferait l'analyse)
  fs.mkdirSync(path.join(tmp, 'films'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'films', 'Orage (2018).mkv'), 'video');
  try { itemId = Number((await pg.query("INSERT INTO items(library_id, type, category, title, year, path, added_at) SELECT id, 'movie', 'movie', 'Orage', 2018, $1, 1 FROM libraries WHERE type = 'movies' RETURNING id", [path.join(tmp, 'films', 'Orage (2018).mkv')])).rows[0][0]); } finally { await pg.close(); }
  assert.ok(itemId > 0);
  const n = set().length;
  const fav = await call(A, `/api/items/${itemId}/mylist`, { method: 'POST', token: tokenA });
  assert.equal(fav.data.inList, true);
  assert.ok(await until(() => set().length > n), 'nouvelle sauvegarde après le favori');
  // Le mot de passe Odin n'est nulle part dans le dossier de données ni dans la base
  const st = await call(A, '/api/admin/odin/lien', { token: tokenA });
  assert.ok(st.data.sauvegarde.at > 0 && !st.data.sauvegarde.erreur, JSON.stringify(st.data.sauvegarde));
  assert.doesNotMatch(JSON.stringify(st.data), /odr1\.|mot-de-passe/);
  assert.doesNotMatch(A.log(), /mot-de-passe-awa-1/);
});

test('Venus B (installation neuve) : « Restaurer depuis Odin » → profils, favoris et mot de passe du foyer de A', async () => {
  const c = await call(B, '/api/odin/connexion');
  assert.equal(c.data.restaurer, true);
  const v = await call(B, '/api/odin/premiere/versions', { method: 'POST', body: { host: '127.0.0.1', port: odin.port, email: 'awa', password: 'mot-de-passe-awa-1' } });
  assert.equal(v.data.ok, true, JSON.stringify(v.data));
  assert.ok(v.data.versions.length >= 2);
  const r = await call(B, '/api/odin/premiere/restaurer', { method: 'POST', body: { version: v.data.versions[0].id, password: 'mot-de-passe-awa-1' } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal((await call(B, '/api/status')).data.setup, true);
  assert.equal((await call(B, '/api/odin/premiere/versions', { method: 'POST', body: {} })).status, 409, 'plus de restauration « première installation » une fois installé');
  // Le mot de passe du foyer de A ouvre B ; même profil administrateur (code PIN compris), même favori
  const login = await call(B, '/api/login', { method: 'POST', body: { password: FOYER } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const tB = login.data.token;
  const profiles = (await call(B, '/api/profiles', { token: tB })).data;
  assert.deepEqual(profiles.map((p) => p.name), ['Awa']);
  assert.equal((await call(B, `/api/profiles/${profiles[0].id}/select`, { method: 'POST', token: tB, body: { pin: '2468' } })).status, 200);
  const list = (await call(B, '/api/mylist', { token: tB })).data;
  assert.deepEqual(list.map((x) => x.id), [itemId]);
  // B reste relié au compte d'Awa : sa sauvegarde continue
  const st = await call(B, '/api/admin/odin/lien', { token: tB });
  assert.equal(st.data.linked, true);
});

test('connexion par Odin sur B : session Odin du navigateur → connecté sans écran ; sans droit → message d’Odin tel quel', async () => {
  odin.S.redirects = [`${B.url}/auth/odin/retour`];
  const login = async (who, silent = true) => {
    const d = await get(`${B.url}/auth/odin/debut${silent ? '?silencieux=1' : ''}`);
    assert.equal(d.status, 302);
    assert.ok(d.location.startsWith(`${odin.url}/sso/autoriser?`), d.location);
    const state = String(d.cookie).match(/vn_odin_state=([^;]+)/)[1];
    const o = await get(d.location, who ? odin.browserSession(who) : '');
    assert.equal(o.status, 303);
    return get(o.location, `vn_odin_state=${state}`);
  };
  const ok = await login('kofi');
  assert.match(ok.location, /^\/#odin=[\w-]+$/);
  const t = await call(B, '/api/odin/ticket', { method: 'POST', body: { ticket: ok.location.split('=')[1] } });
  assert.equal(t.status, 200);
  const me = await call(B, '/api/me', { token: t.data.token });
  assert.equal(me.data.name, 'Kofi', 'profil créé pour la personne d’Odin, session ouverte dessus');
  assert.equal((await call(B, '/api/odin/ticket', { method: 'POST', body: { ticket: ok.location.split('=')[1] } })).status, 401, 'ticket à usage unique');
  const no = await login('invite');
  assert.equal(decodeURIComponent(no.location.replace('/#odin_erreur=', '')), 'Tu n\'as pas accès à Vénus. Demande à Awa de t\'ajouter au groupe famille.');
  const none = await login('');
  assert.equal(none.location, '/#odin_rien=1', 'pas de session Odin : retour discret vers l’écran de connexion');
});

test('« Odin seulement » : le mot de passe du foyer refusé tant qu’Odin répond', async () => {
  const tA = tokenA;
  assert.equal((await call(A, '/api/admin/odin/mode', { method: 'PUT', token: tA, body: { mode: 'odin-seul' } })).status, 200);
  const c = await call(A, '/api/odin/connexion');
  assert.equal(c.data.sso, true);
  assert.equal(c.data.local, false);
  const r = await call(A, '/api/login', { method: 'POST', body: { password: FOYER } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /compte Odin/);
  await call(A, '/api/admin/odin/mode', { method: 'PUT', token: tA, body: { mode: 'odin' } });
  assert.equal((await call(A, '/api/login', { method: 'POST', body: { password: FOYER } })).status, 200);
});
