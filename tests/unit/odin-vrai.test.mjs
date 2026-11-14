// Venus ↔ le VRAI Odin (pas un faux) : lancé si ODIN_DEPOT donne une copie du dépôt Odin qui a la connexion unique
// (sinon l'essai est ignoré). Deux vrais serveurs Venus, un vrai Odin (son banc d'essai, tests/unit/vrai-odin-lanceur.mjs) :
// lien, sauvegarde envoyée, installation neuve restaurée à l'identique, connexion OpenID par le portail Persona
// (puis sans écran), refus sans droit avec le message d'Odin.
// ODIN_DEPOT=/chemin/vers/odin VENUS_TEST_PG=postgres://… node --test tests/unit/odin-vrai.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPOT = process.env.ODIN_DEPOT;
const skip = !DEPOT || !fs.existsSync(path.join(DEPOT || '/', 'src/valhalla/sso/oidc.ts')) ? 'ODIN_DEPOT (copie d’Odin avec la connexion unique) non donné' : false;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-vrai-odin-'));
const dbs = [`venus_vrai_a_${process.pid}`, `venus_vrai_b_${process.pid}`];
const procs = [];
let O, A, B, odinProc;

async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { return await pg.simple(sql); } finally { await pg.close(); } }
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function venus(name, db, port) {
  const u = new URL(ADMIN); u.pathname = `/${db}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(tmp, name), VENUS_DATABASE_URL: u.toString(), VENUS_UI: 'classic', HTTPS: '0', VENUS_IPTV_WORLD: '0', VENUS_COFFRE: '0', VENUS_ODIN_QUIET_MS: '300', VENUS_ODIN_CHECK_MS: '3000', TRANSCODE_DIR: path.join(tmp, `${name}-tr`) };
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  procs.push(p);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${url}/api/status`)).ok) return { url, log: () => out }; } catch { /* */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`Venus ${name} ne démarre pas :\n${out}`);
}
async function call(v, p, { method = 'GET', body, token } = {}) {
  const r = await fetch(`${v.url}${p}`, { method, redirect: 'manual', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };

before(async () => {
  if (skip) return;
  for (const d of dbs) await adminSql(`CREATE DATABASE ${d}`);
  const [pa, pb] = [await freePort(), await freePort()];
  odinProc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(HERE, 'vrai-odin-lanceur.mjs'), `http://127.0.0.1:${pb}/auth/odin/retour`], { cwd: DEPOT, env: { ...process.env, ODIN_DEPOT: DEPOT }, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; odinProc.stderr.on('data', (d) => { err += d; });
  O = await new Promise((ok, ko) => { let buf = ''; odinProc.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) ok(JSON.parse(buf.slice(0, i))); }); odinProc.on('exit', () => ko(new Error(`Odin s'est arrêté :\n${err.slice(-3000)}`))); });
  [A, B] = await Promise.all([venus('a', dbs[0], pa), venus('b', dbs[1], pb)]);
});
after(async () => {
  for (const p of procs) { try { p.kill(); } catch { /* */ } }
  if (odinProc) { odinProc.stdin.end(); await new Promise((r) => { odinProc.on('exit', r); setTimeout(r, 5000); }); }
  if (!skip) for (const d of dbs) await adminSql(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

const FOYER = 'Foyer-Venus-2026!solide';
const odinPort = () => Number(new URL(O.url).port);
let tokenA, itemId;
test('vrai Odin : Venus A relié (compte du propriétaire), sauvegarde reçue et rangée par Odin', { skip }, async () => {
  const s = await call(A, '/api/setup', { method: 'POST', body: { password: FOYER, name: 'Awa', pin: '2468', moviesPath: path.join(tmp, 'films'), showsPath: path.join(tmp, 'series') } });
  tokenA = s.data.token;
  const bad = await call(A, '/api/admin/odin/lien', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: odinPort(), email: O.proprietaire.email, password: 'pas-le-bon' } });
  assert.equal(bad.data.ok, false);
  assert.match(bad.data.error, /incorrect/);
  const l = await call(A, '/api/admin/odin/lien', { method: 'POST', token: tokenA, body: { host: '127.0.0.1', port: odinPort(), email: O.proprietaire.email, password: O.proprietaire.mdp } });
  assert.equal(l.data.ok, true, JSON.stringify(l.data));
  // Un film et un favori
  fs.mkdirSync(path.join(tmp, 'films'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'films', 'Orage (2018).mkv'), 'video');
  const { Pg } = await import('../../server/pg.js');
  const u = new URL(ADMIN);
  const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: dbs[0] });
  try { itemId = Number((await pg.query("INSERT INTO items(library_id, type, category, title, year, path, added_at) SELECT id, 'movie', 'movie', 'Orage', 2018, $1, 1 FROM libraries WHERE type = 'movies' RETURNING id", [path.join(tmp, 'films', 'Orage (2018).mkv')])).rows[0][0]); } finally { await pg.close(); }
  assert.equal((await call(A, `/api/items/${itemId}/mylist`, { method: 'POST', token: tokenA })).data.inList, true);
  const sent = await until(async () => { const v = (await call(A, '/api/admin/odin/versions', { token: tokenA })).data.versions || []; return v.length >= 2 ? v : null; });
  assert.ok(sent, 'deux sauvegardes chez le vrai Odin (lien, puis favori)');
  const st = (await call(A, '/api/admin/odin/lien', { token: tokenA })).data;
  assert.equal(st.sauvegarde.erreur || '', '');
  assert.equal((await call(A, '/api/admin/odin/sauvegarde', { method: 'POST', token: tokenA })).status, 200);
  // Rangée chiffrée sur Odin : le nom du serveur Venus n'apparaît en clair dans aucun fichier d'Odin
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
  walk(path.join(O.home, 'valhalla', 'freyja', 'sauvegardes'));
  assert.ok(files.length >= 2);
  for (const f of files) assert.ok(!fs.readFileSync(f).includes(Buffer.from('household_password')), `${f} chiffré au repos`);
});

test('vrai Odin : installation neuve B restaurée à l’identique (profils, favori, mot de passe du foyer)', { skip }, async () => {
  const v = await call(B, '/api/odin/premiere/versions', { method: 'POST', body: { host: '127.0.0.1', port: odinPort(), email: O.proprietaire.email, password: O.proprietaire.mdp } });
  assert.equal(v.data.ok, true, JSON.stringify(v.data));
  const r = await call(B, '/api/odin/premiere/restaurer', { method: 'POST', body: { version: v.data.versions[0].id, password: O.proprietaire.mdp } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.secrets, 'retrouvés');
  const tB = (await call(B, '/api/login', { method: 'POST', body: { password: FOYER } })).data.token;
  const profiles = (await call(B, '/api/profiles', { token: tB })).data;
  assert.deepEqual(profiles.map((p) => p.name), ['Awa']);
  await call(B, `/api/profiles/${profiles[0].id}/select`, { method: 'POST', token: tB, body: { pin: '2468' } });
  assert.deepEqual((await call(B, '/api/mylist', { token: tB })).data.map((x) => x.id), [itemId]);
  assert.equal((await call(B, '/api/admin/odin/lien', { token: tB })).data.linked, true);
});

// Le navigateur : suit Venus → Odin (portail Persona si besoin) → Venus
async function browser(who, mdp, odinCookie = '') {
  const d = await fetch(`${B.url}/auth/odin/debut`, { redirect: 'manual' });
  const state = String(d.headers.get('set-cookie')).match(/vn_odin_state=([^;]+)/)[1];
  const authz = d.headers.get('location');
  assert.ok(authz.startsWith(`${O.url}/sso/autoriser?`), authz);
  let r = await fetch(authz, { redirect: 'manual', headers: odinCookie ? { cookie: odinCookie } : {} });
  let cookie = odinCookie;
  if (r.status === 200) {
    const html = await r.text();
    const demande = /name="demande" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(demande, 'portail Persona');
    r = await fetch(`${O.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: O.url }, body: new URLSearchParams({ demande, identifiant: who, motdepasse: mdp }) });
    cookie = (r.headers.getSetCookie().find((c) => c.startsWith('odin_var=')) || '').split(';')[0];
  }
  assert.equal(r.status, 303, `Odin renvoie vers Venus (${r.status})`);
  const back = await fetch(r.headers.get('location'), { redirect: 'manual', headers: { cookie: `vn_odin_state=${state}` } });
  return { location: back.headers.get('location'), cookie };
}
test('vrai Odin : connexion par le portail Persona, puis sans écran ; sans droit → le message d’Odin', { skip }, async () => {
  const first = await browser('kofi', O.personnes.kofi.mdp);
  assert.match(first.location, /^\/#odin=[\w-]+$/, first.location);
  const t = await call(B, '/api/odin/ticket', { method: 'POST', body: { ticket: first.location.split('=')[1] } });
  assert.equal((await call(B, '/api/me', { token: t.data.token })).data.name, 'Kofi');
  assert.ok(first.cookie, 'session Persona ouverte dans ce navigateur');
  const again = await browser('kofi', '', first.cookie);
  assert.match(again.location, /^\/#odin=/, 'seconde fois : sans écran');
  const no = await browser('invite', O.personnes.invite.mdp);
  const msg = decodeURIComponent(String(no.location).replace('/#odin_erreur=', ''));
  assert.match(msg, /^Tu n'as pas accès à Vénus\./, msg);
});
