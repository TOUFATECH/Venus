// Interface Next.js (dossier web/) : construite une fois (Dockerfile, ou « cd web && npm ci && npm run build »),
// elle tourne dans un processus à part, sur un port interne (127.0.0.1), surveillé et relancé par Venus.
// Venus reste la seule porte d'entrée : il sert lui-même les fichiers /_next/static (compressés, cache d'un an),
// transmet les pages à Next avec un nonce pour la politique de sécurité, et retombe sur l'ancienne interface
// (public/index.html) si Next n'est pas construit, pas encore prêt, ou désactivé (VENUS_UI=classic).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = { dir: null, staticDir: null, port: 0, child: null, ready: false, restarts: 0, lastStart: 0, stopping: false, error: null };

// Dossier de l'interface construite : image Docker (web-dist), ou construction locale (web/.next/standalone)
function findBuild() {
  const candidates = [process.env.VENUS_WEB_DIR, path.join(root, 'web-dist'), path.join(root, 'web', '.next', 'standalone')].filter(Boolean);
  for (const dir of candidates) {
    if (!fs.existsSync(path.join(dir, 'server.js')) || !fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) continue;
    const staticDir = [path.join(dir, '.next', 'static'), path.join(root, 'web', '.next', 'static')].find((d) => fs.existsSync(d));
    if (staticDir) return { dir, staticDir };
  }
  return null;
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export const nextUiEnabled = () => process.env.VENUS_UI !== 'classic' && !!findBuild();
export const nextUiReady = () => state.ready;
export const nextUiInfo = () => ({ enabled: !!state.dir, ready: state.ready, restarts: state.restarts, error: state.error });

export async function startNextUi(publicDir) {
  if (process.env.VENUS_UI === 'classic') { console.log('[interface] ancienne interface (VENUS_UI=classic)'); return; }
  const found = findBuild();
  if (!found) { console.log('[interface] interface Next.js non construite : ancienne interface servie (cd web && npm ci && npm run build)'); return; }
  Object.assign(state, found);
  state.publicDir = publicDir;
  await launch();
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { state.stopping = true; try { state.child && state.child.kill('SIGTERM'); } catch { /* */ } });
  process.once('exit', () => { try { state.child && state.child.kill('SIGTERM'); } catch { /* */ } });
}

async function launch() {
  state.ready = false;
  state.lastStart = Date.now();
  state.port = Number(process.env.VENUS_NEXT_PORT) || await freePort();
  // Environnement minimal : le processus de l'interface n'a besoin d'aucun secret de Venus
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME || '/tmp', TZ: process.env.TZ || '', LANG: process.env.LANG || 'C.UTF-8',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PORT: String(state.port), HOSTNAME: '127.0.0.1',
    VENUS_PUBLIC_DIR: state.publicDir, NODE_OPTIONS: '--max-http-header-size=32768',
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: state.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  state.child = child;
  const log = (buf) => { const s = String(buf).trim(); if (s && !/Ready in|Starting\.\.\.|Next\.js \d|- Local:|- Network:|Running next\.config/.test(s)) console.log(`[interface] ${s.slice(0, 500)}`); };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('exit', (code, sig) => {
    state.ready = false;
    if (state.child === child) state.child = null;
    if (state.stopping) return;
    state.error = `arrêtée (${sig || code})`;
    state.restarts++;
    // Relance, de plus en plus espacée si elle s'arrête sans cesse (l'ancienne interface est servie entre-temps)
    const wait = Date.now() - state.lastStart < 30000 ? Math.min(60000, 2000 * 2 ** Math.min(state.restarts, 5)) : 1000;
    console.error(`[interface] interface Next.js ${state.error} : relance dans ${Math.round(wait / 1000)} s`);
    setTimeout(() => launch().catch((e) => console.error('[interface]', e.message)), wait).unref();
  });
  // Prête quand elle répond
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && state.child === child) {
    const ok = await new Promise((resolve) => {
      const r = http.get({ host: '127.0.0.1', port: state.port, path: '/__venus_ping', timeout: 1500 }, (res) => { res.resume(); resolve(true); });
      r.on('error', () => resolve(false));
      r.on('timeout', () => { r.destroy(); resolve(false); });
    });
    if (ok) { state.ready = true; state.error = null; console.log(`[interface] interface Next.js prête (${Date.now() - t0} ms)`); return; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (state.child === child) { state.error = 'ne démarre pas'; console.error('[interface] interface Next.js lente à démarrer : ancienne interface servie en attendant'); }
}

// Fichiers /_next/static/… : noms uniques par version, gardés un an par le navigateur
export function nextStaticFile(pathname) {
  if (!state.staticDir || !pathname.startsWith('/_next/static/')) return null;
  let rel;
  try { rel = decodeURIComponent(pathname.slice('/_next/static/'.length)); } catch { return null; } // adresse mal encodée
  const full = path.join(state.staticDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(state.staticDir + path.sep)) return null;
  return full;
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);
// Page demandée à l'interface Next.js. La politique de sécurité (CSP) porte un nonce neuf à chaque page :
// seuls les scripts de Next et ceux de public/index.html (marqués du même nonce) peuvent s'exécuter.
// Renvoie false si l'interface Next.js n'a pas répondu du tout : l'appelant sert alors l'interface classique.
export function proxyToNext(req, res, { buildId, csp }) {
  return new Promise((resolve) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const policy = csp(nonce);
    const before = res.getHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', policy);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-venus-') && !k.startsWith(':')) headers[k] = v;
    headers.host = `127.0.0.1:${state.port}`;
    headers['content-security-policy'] = policy;
    headers['x-venus-nonce'] = nonce;
    headers['x-venus-build'] = buildId;
    delete headers['accept-encoding'];
    const up = http.request({ host: '127.0.0.1', port: state.port, method: req.method, path: req.url, headers, timeout: 30000 }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && k !== 'content-length' && k !== 'content-security-policy' && k !== 'x-powered-by') out[k] = v;
      // Pages et données de navigation compressées à la volée (brotli rapide, sinon gzip)
      const type = String(r.headers['content-type'] || '');
      const enc = String(req.headers['accept-encoding'] || '');
      let z = null;
      if (/text\/|x-component|json|javascript/.test(type) && r.statusCode !== 204 && r.statusCode !== 304 && req.method !== 'HEAD') {
        if (/\bbr\b/.test(enc)) { z = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }, flush: zlib.constants.BROTLI_OPERATION_FLUSH }); out['content-encoding'] = 'br'; }
        else if (/\bgzip\b/.test(enc)) { z = zlib.createGzip({ level: 6, flush: zlib.constants.Z_SYNC_FLUSH }); out['content-encoding'] = 'gzip'; }
        if (z) out.vary = out.vary ? `${out.vary}, Accept-Encoding` : 'Accept-Encoding';
      }
      res.writeHead(r.statusCode || 502, out);
      if (z) r.pipe(z).pipe(res); else r.pipe(res);
      r.on('end', () => resolve(true));
      r.on('error', () => resolve(true));
    });
    up.on('timeout', () => up.destroy(new Error('délai dépassé')));
    up.on('error', () => {
      // Interface Next.js injoignable (relance en cours…) : rien n'est encore envoyé, l'interface classique prend le relais
      if (!res.headersSent && (req.method === 'GET' || req.method === 'HEAD')) {
        if (before) res.setHeader('Content-Security-Policy', before); else res.removeHeader('Content-Security-Policy');
        resolve(false);
        return;
      }
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Interface momentanément indisponible. Rechargez la page.'); } else res.end();
      resolve(true);
    });
    res.on('close', () => up.destroy());
    if (req.method === 'GET' || req.method === 'HEAD') up.end(); else req.pipe(up);
  });
}
