// La reprise de lecture suit d'un appareil à l'autre, dans deux VRAIS navigateurs (Chromium) : on regarde un film sur
// le PC, on s'arrête à ~40 s ; sur le téléphone (un autre navigateur, une autre session), le film est dans « Reprendre »
// et la lecture repart au même endroit. Si ODIN_DEPOT est donné, Venus est aussi relié au vrai Odin et la reprise y est
// rangée en moins de 2 s.
// Interface : celle de Next.js si VENUS_WEB_DIR donne une interface construite (web/.next/standalone), sinon l'ancienne.
// Playwright : VENUS_PLAYWRIGHT (dossier du module « playwright »), sinon tests/node_modules ; VENUS_CHROMIUM : un autre Chromium.
// VENUS_TEST_PG=postgres://… [ODIN_DEPOT=…] [VENUS_WEB_DIR=…] node --test tests/unit/reprise-navigateurs.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
let pw = null;
for (const p of [process.env.VENUS_PLAYWRIGHT, path.join(ROOT, 'tests', 'node_modules', 'playwright')].filter(Boolean)) { try { pw = require(p); break; } catch { /* suivant */ } }
const skip = !pw ? 'Playwright absent (VENUS_PLAYWRIGHT ou tests/node_modules)' : false;
const DEPOT = process.env.ODIN_DEPOT && fs.existsSync(path.join(process.env.ODIN_DEPOT, 'src/valhalla/sso/sauvegardes.ts')) ? process.env.ODIN_DEPOT : '';
const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-reprise-'));
const dbName = `venus_reprise_${process.pid}`;
const FOYER = 'Foyer-Venus-2026!solide', PIN = '2468';
let V, O, proc, odinProc, browser, filmId;

async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { return await pg.simple(sql); } finally { await pg.close(); } }
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(200); } };
async function call(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(`${V.url}${p}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
/** Une session d'appareil : mot de passe du foyer, puis le profil (code PIN), comme l'écran de connexion. */
async function session() {
  const t = (await call('/api/login', { method: 'POST', body: { password: FOYER } })).data.token;
  const me = (await call('/api/profiles', { token: t })).data.find((p) => p.name === 'Awa');
  assert.equal((await call(`/api/profiles/${me.id}/select`, { method: 'POST', token: t, body: { pin: PIN } })).status, 200);
  return t;
}
const odinVersions = () => {
  const base = path.join(O.home, 'valhalla', 'freyja', 'sauvegardes');
  const who = fs.existsSync(base) ? fs.readdirSync(base) : [];
  try { return who.length ? JSON.parse(fs.readFileSync(path.join(base, who[0], 'index.json'), 'utf8')).versions.sort((a, b) => b.date - a.date) : []; } catch { return []; }
};

before(async () => {
  if (skip) return;
  await adminSql(`CREATE DATABASE ${dbName}`);
  // Un film d'une minute (H.264 + AAC), comme ceux des essais de bout en bout
  const films = path.join(tmp, 'films');
  fs.mkdirSync(films, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path.join(films, 'Lagon (2021).mp4')]);
  if (DEPOT) {
    odinProc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(HERE, 'vrai-odin-lanceur.mjs')], { cwd: DEPOT, env: { ...process.env, ODIN_DEPOT: DEPOT }, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = ''; odinProc.stderr.on('data', (d) => { err += d; });
    O = await new Promise((ok, ko) => { let buf = ''; odinProc.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) ok(JSON.parse(buf.slice(0, i))); }); odinProc.on('exit', () => ko(new Error(`Odin s'est arrêté :\n${err.slice(-3000)}`))); });
  }
  const port = await freePort();
  const u = new URL(ADMIN); u.pathname = `/${dbName}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(tmp, 'data'), VENUS_DATABASE_URL: u.toString(), HTTPS: '0', VENUS_IPTV_WORLD: '0', VENUS_COFFRE: '0', TRANSCODE_DIR: path.join(tmp, 'tr'), ...(process.env.VENUS_WEB_DIR ? {} : { VENUS_UI: 'classic' }) };
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  V = { url: `http://127.0.0.1:${port}`, log: () => out };
  assert.ok(await until(async () => { try { return (await fetch(`${V.url}/api/status`)).ok; } catch { return false; } }, 60000), `Venus ne démarre pas :\n${out}`);
  const s = await call('/api/setup', { method: 'POST', body: { password: FOYER, name: 'Awa', pin: PIN, moviesPath: films, showsPath: path.join(tmp, 'series') } });
  const admin = s.data.token;
  filmId = await until(async () => { const l = (await call('/api/library', { token: admin })).data; return Array.isArray(l) && (l.find((x) => x.title === 'Lagon') || {}).id; }, 60000);
  assert.ok(filmId, `le film n’est pas dans la bibliothèque :\n${out.slice(-2000)}`);
  if (O) {
    const l = await call('/api/admin/odin/lien', { method: 'POST', token: admin, body: { host: '127.0.0.1', port: Number(new URL(O.url).port), email: O.proprietaire.email, password: O.proprietaire.mdp } });
    assert.equal(l.data.ok, true, JSON.stringify(l.data));
    assert.ok(await until(() => odinVersions().some((v) => v.sorte === 'complete'), 15000));
  }
  browser = await pw.chromium.launch(process.env.VENUS_CHROMIUM ? { executablePath: process.env.VENUS_CHROMIUM } : {});
});
after(async () => {
  await browser?.close().catch(() => {});
  if (proc) { proc.kill('SIGTERM'); await new Promise((r) => { proc.on('exit', r); setTimeout(r, 8000); }); }
  if (odinProc) { odinProc.stdin.end(); await new Promise((r) => { odinProc.on('exit', r); setTimeout(r, 5000); }); }
  if (!skip) await adminSql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Un appareil : son propre navigateur (contexte isolé), sa propre session Venus. */
async function appareil(opts) {
  const ctx = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block', ...opts });
  const token = await session();
  await ctx.addInitScript((t) => { try { localStorage.setItem('vn_token', t); } catch { /* */ } }, token);
  return { ctx, page: await ctx.newPage(), token };
}
// Position affichée par la barre de lecture du lecteur (« 0:41 sur 1:00 »)
async function shown(page) {
  const t = await page.locator('.player [aria-valuetext]').first().getAttribute('aria-valuetext').catch(() => '');
  const m = /^(\d+):(\d\d)/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

test('reprise de lecture : arrêtée sur le PC, reprise au même endroit sur le téléphone (deux navigateurs)', { skip }, async () => {
  // --- Le PC : lecture, puis on avance à 40 s et on s'arrête
  const pc = await appareil({ viewport: { width: 1280, height: 860 } });
  await pc.page.goto(`${V.url}/lecture/${filmId}`);
  const video = pc.page.locator('.player video');
  await until(async () => (await video.evaluate((v) => v.currentTime).catch(() => 0)) > 1, 40000);
  assert.ok((await video.evaluate((v) => v.currentTime)) > 1, `la vidéo avance sur le PC\n${V.log().slice(-1500)}`);
  const n = O ? odinVersions().length : 0;
  const saved = pc.page.waitForRequest((r) => r.url().endsWith('/api/progress') && JSON.parse(r.postData() || '{}').position >= 38, { timeout: 30000 });
  // Avancer : un clic sur la barre de lecture, aux deux tiers (≈ 40 s)
  await pc.page.mouse.move(400, 300);
  const track = pc.page.locator('.player [aria-valuetext]').first();
  await track.waitFor({ state: 'visible', timeout: 10000 });
  const box = await track.boundingBox();
  await pc.page.mouse.click(box.x + box.width * 0.68, box.y + box.height / 2);
  const reqs = []; pc.page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(`${r.method()} ${r.url().replace(V.url, '')} ${r.postData() || ''}`.slice(0, 160)); });
  const req = await saved.catch(async (e) => { await pc.page.screenshot({ path: path.join(process.env.DEBUG_DIR || tmp, 'pc.png') }).catch(() => {}); throw new Error(`${e.message}\n${reqs.join('\n')}\nvidéo : ${JSON.stringify(await video.evaluate((v) => ({ t: v.currentTime, p: v.paused, d: v.duration, e: v.error && v.error.code })).catch((x) => x.message))}`); });
  const pos = JSON.parse(req.postData()).position;
  const t0 = Date.now();
  await sleep(300);
  await pc.page.keyboard.press('Space'); // pause
  await pc.ctx.close(); // on éteint le PC
  const fromServer = (await call(`/api/items/${filmId}`, { token: pc.token })).data.progress;
  assert.ok(fromServer && Math.abs(fromServer.position - pos) < 12, `reprise gardée par Venus : ${JSON.stringify(fromServer)} (envoyée ${pos})`);
  if (O) {
    const v = await until(() => odinVersions().slice(0, odinVersions().length - n).find((x) => x.raison.includes('reprise de lecture')), 5000);
    assert.ok(v, 'la reprise est arrivée chez Odin');
    console.log(`# reprise rangée par le vrai Odin ${v.date - t0} ms après l’envoi du lecteur`);
    assert.ok(v.date - t0 < 2000);
  }
  // --- Le téléphone : autre navigateur, autre session ; le film est à reprendre, et repart au même endroit
  const tel = await appareil({ ...pw.devices['iPhone 13'], defaultBrowserType: undefined });
  await tel.page.goto(`${V.url}/`);
  // L'accueil du téléphone propose de continuer ce que le PC regardait (« Vous regardiez « Lagon » sur … »)
  const ici = tel.page.getByRole('button', { name: 'Continuer ici' });
  await ici.waitFor({ state: 'visible', timeout: 30000 });
  assert.ok(await tel.page.getByText(/Vous regardiez « Lagon »/).first().isVisible());
  if (process.env.DEBUG_DIR) await tel.page.screenshot({ path: path.join(process.env.DEBUG_DIR, 'telephone-accueil.png') });
  const play = tel.page.waitForResponse((r) => r.url().includes(`/api/play/${filmId}`) && r.request().method() === 'POST', { timeout: 30000 });
  await ici.click();
  const res = await (await play).json();
  const start = Number(res.startAt ?? -1);
  await until(async () => (await shown(tel.page)) >= 30, 30000);
  const at = await shown(tel.page);
  console.log(`# PC arrêté à ${pos.toFixed(1)} s → téléphone repart à ${at} s (serveur : départ à ${res.startAt} s, mode ${res.mode})`);
  assert.ok(Math.abs(at - pos) <= 12, `le téléphone reprend au même endroit (${at} s, arrêté à ${pos.toFixed(1)} s)`);
  if (start >= 0) assert.ok(Math.abs(start - pos) <= 12);
  await tel.ctx.close();
});
