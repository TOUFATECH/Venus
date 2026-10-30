// Venus — point d'entrée du serveur
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError, sendJson, serveStatic } from './http.js';
import { authenticate, migrateTokens } from './auth.js';
import { router } from './api.js';
import { together } from './together.js';
import { detectHardware } from './hw.js';
import { scanAll, watchLibraries, events } from './scanner.js';
import { libraryAdded } from './notify.js';
import { runWatch } from './watch.js';
import { schedulePending } from './segments.js';
import { refreshRatings } from './ratings.js';
import { startWatch } from './watch.js';
import { startBackups } from './backup.js';
import { stopAllSessions } from './stream.js';
import { mountAll, watchMounts } from './netshare.js';
import { runtime } from './env.js';
import { getSetting, all } from './db.js';
import { clientIp, isSecure, inspectRequest, isBanned, applyHeaders, handlePreflight, checkCsrf, checkHpp, rateLimit, requireHttps, publicError, suspicious, logSecurity, onSecurityAlert } from './security.js';
import { tlsOptions } from './tls.js';
import { notify } from './notify.js';
import { startSecurityAudit } from './audit.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let httpsPort = null;
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, url, params: {}, auth: null };
  res.req = req;
  const ip = clientIp(req);
  ctx.ip = ip;
  const secure = isSecure(req);
  try {
    // En-têtes de sécurité (CSP, anti-clickjacking, CORS limité aux flux vidéo…)
    applyHeaders(req, res, url, secure);
    if (isBanned(ip)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Accès bloqué pour cette adresse.'); }
    inspectRequest(req, url, ip);
    if (requireHttps(req, res, url, ip, httpsPort)) return;

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) {
      if (req.method === 'OPTIONS') return handlePreflight(req, res, url, ip);
      rateLimit(ip, url.pathname);
      checkHpp(url, ip);
      checkCsrf(req, url, ip);
      const m = router.match(req.method, url.pathname) || together.match(req.method, url.pathname);
      if (!m) { suspicious(ip, 2, `Route inconnue : ${req.method} ${url.pathname.slice(0, 80)}`); throw new HttpError(404, 'Route inconnue'); }
      ctx.params = m.params;
      ctx.auth = authenticate(req, url, ip, secure);
      await m.handler(ctx);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
    if (serveStatic(req, res, publicDir, url.pathname)) return;
    // Application monopage : toute autre route renvoie l'interface
    serveStatic(req, res, publicDir, '/index.html');
  } catch (e) {
    const { status, error } = publicError(e, ip, req, url);
    if (status === 401 && ctx.auth === null && (req.headers.authorization || url.searchParams.has('token'))) suspicious(ip, 1, 'Identifiant de session refusé');
    if (status === 429) suspicious(ip, 2, 'Limite de requêtes atteinte');
    if (!res.headersSent) sendJson(res, { error }, status);
    else res.end();
  }
}
const server = http.createServer(handle);
// Délais : en-têtes lents (attaque « slowloris ») et connexions inactives coupés ; les vidéos et les
// envois de fichiers, qui transfèrent en continu, ne sont pas concernés
server.headersTimeout = 20000;
server.requestTimeout = 0;
server.setTimeout(120000);
server.maxHeadersCount = 100;

server.keepAliveTimeout = 65000;

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

async function main() {
  const where = { docker: 'Docker', lxc: `conteneur LXC ${runtime.unprivileged ? 'non privilégié' : 'privilégié'}`, machine: 'machine' }[runtime.kind];
  console.log(`[système] Venus tourne dans : ${where}${runtime.canMount ? '' : ' (montage réseau non autorisé)'}`);
  migrateTokens();
  await detectHardware();
  server.listen(config.port, config.host, () => {
    console.log(`\n  ✨ Venus ${config.version} est prêt`);
    console.log(`     http://localhost:${config.port}`);
    for (const ip of lanAddresses()) console.log(`     http://${ip}:${config.port}`);
    console.log('');
  });
  // HTTPS : certificat fourni (TLS_CERT / TLS_KEY) ou créé automatiquement (autosigné) dans le dossier de données
  const tls = await tlsOptions(lanAddresses()).catch((e) => { console.warn('[https]', e.message); return null; });
  const wanted = Number(process.env.HTTPS_PORT || getSetting('https_port', 8920)) || 0;
  if (tls && wanted) {
    const secureServer = https.createServer({ ...tls, minVersion: 'TLSv1.2' }, handle);
    secureServer.headersTimeout = 20000; secureServer.requestTimeout = 0; secureServer.setTimeout(120000); secureServer.keepAliveTimeout = 65000;
    secureServer.on('error', (e) => console.warn('[https]', e.message));
    secureServer.listen(wanted, config.host, () => {
      httpsPort = wanted;
      console.log(`  🔒 HTTPS : https://localhost:${wanted}${tls.selfSigned ? ' (certificat autosigné : le navigateur demandera de l’accepter une fois)' : ''}`);
    });
  }
  // Alertes de sécurité envoyées à l'administrateur (notifications, ntfy, Discord, Telegram)
  onSecurityAlert((m) => notify({ title: m.title, body: m.body, url: m.url, tag: 'securite' }, { adminOnly: true }));
  startSecurityAudit();
  // Partages réseau (NAS, PC) : montés avant la première analyse
  await mountAll().catch((e) => console.warn('[réseau]', e.message));
  watchMounts(() => scanAll());
  watchLibraries();
  // Génériques des séries et animés : analyse en arrière-plan des nouveaux épisodes
  setTimeout(() => schedulePending(), 90000).unref();
  setInterval(() => schedulePending(), 30 * 60000).unref();
  // Notes et bandes-annonces : titres nouveaux ou notés il y a plus de 10 jours
  setTimeout(() => refreshRatings(), 120000).unref();
  startWatch();
  // Nouveautés : notification, et les envies arrivées passent dans « Ma liste » (avec notification à la personne)
  let watchSoon = null;
  events.on('library', (d) => {
    if (d && d.added && d.added.length) {
      libraryAdded(d.added);
      clearTimeout(watchSoon); watchSoon = setTimeout(() => runWatch().catch(() => {}), 90000);
    }
  });
  startBackups();
  setInterval(() => refreshRatings(), 6 * 3600000).unref();
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
