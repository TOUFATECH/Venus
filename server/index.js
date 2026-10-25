// Venus — point d'entrée du serveur
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError, sendJson, serveStatic } from './http.js';
import { authenticate } from './auth.js';
import { router } from './api.js';
import { together } from './together.js';
import { detectHardware } from './hw.js';
import { scanAll, watchLibraries } from './scanner.js';
import { schedulePending } from './segments.js';
import { stopAllSessions } from './stream.js';
import { mountAll, watchMounts } from './netshare.js';
import { runtime } from './env.js';
import { getSetting, all } from './db.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, url, params: {}, auth: null };
  res.req = req;
  try {
    // En-têtes de sécurité
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' });
        return res.end();
      }
      const m = router.match(req.method, url.pathname) || together.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'Route inconnue');
      ctx.params = m.params;
      ctx.auth = authenticate(req, url);
      await m.handler(ctx);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
    if (serveStatic(req, res, publicDir, url.pathname)) return;
    // Application monopage : toute autre route renvoie l'interface
    serveStatic(req, res, publicDir, '/index.html');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, e);
    if (!res.headersSent) sendJson(res, { error: e.message || 'Erreur interne' }, status);
    else res.end();
  }
});

server.keepAliveTimeout = 65000;
server.requestTimeout = 0; // les longues lectures vidéo ne doivent pas être coupées

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

async function main() {
  const where = { docker: 'Docker', lxc: `conteneur LXC ${runtime.unprivileged ? 'non privilégié' : 'privilégié'}`, machine: 'machine' }[runtime.kind];
  console.log(`[système] Venus tourne dans : ${where}${runtime.canMount ? '' : ' (montage réseau non autorisé)'}`);
  await detectHardware();
  server.listen(config.port, config.host, () => {
    console.log(`\n  ✨ Venus ${config.version} est prêt`);
    console.log(`     http://localhost:${config.port}`);
    for (const ip of lanAddresses()) console.log(`     http://${ip}:${config.port}`);
    console.log('');
  });
  // Partages réseau (NAS, PC) : montés avant la première analyse
  await mountAll().catch((e) => console.warn('[réseau]', e.message));
  watchMounts(() => scanAll());
  watchLibraries();
  // Génériques des séries et animés : analyse en arrière-plan des nouveaux épisodes
  setTimeout(() => schedulePending(), 90000).unref();
  setInterval(() => schedulePending(), 30 * 60000).unref();
  // Scan au démarrage puis périodique (filet de sécurité pour les partages réseau)
  setTimeout(() => scanAll(), 2000);
  // Les partages réseau ne signalent pas les nouveaux fichiers : vérification toutes les 10 minutes
  setInterval(() => { if (all("SELECT 1 FROM libraries WHERE remote IS NOT NULL LIMIT 1").length) scanAll(); }, 10 * 60000).unref();
  const tick = () => { scanAll(); setTimeout(tick, Number(getSetting('scan_interval', 60)) * 60000).unref(); };
  setTimeout(tick, Number(getSetting('scan_interval', 60)) * 60000).unref();
}

const shutdown = () => { stopAllSessions(); server.close(); setTimeout(() => process.exit(0), 300); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
