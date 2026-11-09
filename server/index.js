// Venus — point d'entrée du serveur
import './logbuf.js'; // journal du serveur (tableau de bord) : chargé en premier
import { warmUpcoming, wantedArrivals } from './upcoming.js';
import { runOptimize } from './optimize.js';
import { checkNas } from './nas-health.js';
import { pollDownloads, announceArrivals, pruneTgPosts } from './telegram-media.js';
import { notifyNewVersion } from './update.js';
// Une erreur imprévue dans une tâche de fond ou un flux ne doit pas éteindre tout Venus : elle est notée dans le
// journal (Serveur → Journal) et le serveur continue. Les erreurs de démarrage, elles, arrêtent bien le processus.
let started = false;
process.on('unhandledRejection', (e) => { console.error('[erreur non gérée]', e && e.stack ? e.stack : e); });
process.on('uncaughtException', (e) => { console.error('[erreur fatale évitée]', e && e.stack ? e.stack : e); if (!started) process.exit(1); });
export const markStarted = () => { started = true; };
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError, sendJson, serveStatic, buildId } from './http.js';
import { startNextUi, nextUiReady, nextStaticFile, proxyToNext } from './next-ui.js';
import { authenticate, migrateTokens } from './auth.js';
import { router, customCss, sendTvReminders } from './api.js';
import { together } from './together.js';
import { detectHardware } from './hw.js';
import { scanAll, watchLibraries, events } from './scanner.js';
import { ensureFreeTv, ensureIptvWorld, checkChannels } from './free-tv.js';
import { libraryAdded } from './notify.js';
import { runWatch } from './watch.js';
import { schedulePending } from './segments.js';
import { refreshRatings } from './ratings.js';
import { startWatch } from './watch.js';
import { startBackups } from './backup.js';
import { stopAllSessions } from './stream.js';
import { mountAll, watchMounts } from './netshare.js';
import { runtime } from './env.js';
import { getSetting, setSetting, all } from './db.js';
import fs from 'node:fs';
import { contentSecurityPolicy, clientIp, isSecure, inspectRequest, isBanned, applyHeaders, handlePreflight, checkCsrf, checkHpp, rateLimit, requireHttps, publicError, suspicious, onSecurityAlert } from './security.js';
import { tlsOptions } from './tls.js';
import { notify } from './notify.js';
import { startSecurityAudit } from './audit.js';
import { fillMissingPosters, fillMissingBackdrops, pendingPosters, fillSeasonPosters } from './posters.js';
import { refreshGuides } from './guide.js';
import { announceNewEpisodes } from './new-episodes.js';
import { purgeTrash, KEEP_DAYS } from './trash.js';
import { sendWeeklyReport, checkFiles } from './reports.js';
import { recordSize } from './extras.js';
import { defineTask } from './tasks.js';
import { trickplayBackfill } from './trickplay.js';
import { refreshRatings as ratingsAll } from './ratings.js';
import { makeBackup } from './backup.js';
import { runSecurityAudit } from './audit.js';
import { emitHook } from './webhooks.js';
import { refreshEpg, pruneEpg } from './epg.js';
import { startDvr, applyRules } from './dvr.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let httpsPort = null;
// HTTP/2 : en-têtes propres à HTTP/1 interdits (une erreur sinon), adresse dans « :authority »
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);
function h2compat(req, res) {
  if (!req.headers.host && req.headers[':authority']) req.headers.host = req.headers[':authority'];
  const setHeader = res.setHeader.bind(res), writeHead = res.writeHead.bind(res);
  res.setHeader = (k, v) => (HOP_HEADERS.has(String(k).toLowerCase()) ? res : setHeader(k, v));
  res.writeHead = (status, a, b) => {
    const clean = (h) => (h && typeof h === 'object' && !Array.isArray(h) ? Object.fromEntries(Object.entries(h).filter(([k]) => !HOP_HEADERS.has(k.toLowerCase()))) : h);
    return typeof a === 'string' ? writeHead(status, a, clean(b)) : writeHead(status, clean(a));
  };
}

async function handle(req, res) {
  if (req.httpVersionMajor === 2) h2compat(req, res);
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, url, params: {}, auth: null };
  if (!res.req) res.req = req;
  const ip = clientIp(req);
  ctx.ip = ip;
  const secure = isSecure(req);
  try {
    // En-têtes de sécurité (CSP, anti-clickjacking, CORS limité aux flux vidéo…)
    applyHeaders(req, res, url, secure);
    if (isBanned(ip)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Accès bloqué pour cette adresse.'); }
    inspectRequest(req, url, ip);
    if (requireHttps(req, res, url, ip, httpsPort)) return;

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/') || url.pathname.startsWith('/cal/')) {
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
    // CSS personnalisé (Tableau de bord → Serveur → Personnalisation)
    if (url.pathname === '/custom.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(customCss()); }
    // Interface Next.js : ses fichiers (noms uniques par version, gardés un an), puis ses pages
    const next = nextUiReady();
    if (url.pathname.startsWith('/_next/static/')) {
      const f = nextStaticFile(url.pathname);
      if (f && serveStatic(req, res, path.dirname(f), `/${path.basename(f)}`, { immutable: true })) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end('Fichier introuvable');
    }
    const page = url.pathname === '/' || url.pathname === '/index.html';
    if (!(next && page) && serveStatic(req, res, publicDir, url.pathname)) return;
    // Fichier absent (police, image, script…) : vraie erreur 404, pas la page d'accueil à sa place
    if (/\.(woff2?|ttf|otf|eot|m?js|css|map|png|jpe?g|gif|webp|avif|svg|ico|json|webmanifest|xml|txt)$/.test(url.pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end('Fichier introuvable'); }
    if (next && await proxyToNext(req, res, { buildId: buildId(publicDir), csp: (nonce) => contentSecurityPolicy(secure, nonce) })) return;
    // Application monopage (ancienne interface) : toute autre route renvoie l'interface
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
  // Interface Next.js lancée en parallèle (l'ancienne interface répond tant qu'elle n'est pas prête)
  startNextUi(publicDir).catch((e) => console.error('[interface]', e.message));
  server.listen(config.port, config.host, () => {
    markStarted();
    console.log(`\n  ✨ Venus ${config.version} est prêt`);
    console.log(`     http://localhost:${config.port}`);
    for (const ip of lanAddresses()) console.log(`     http://${ip}:${config.port}`);
    console.log('');
  });
  // HTTPS : certificat fourni (TLS_CERT / TLS_KEY) ou créé automatiquement (autosigné) dans le dossier de données
  const tls = await tlsOptions(lanAddresses()).catch((e) => { console.warn('[https]', e.message); return null; });
  const wanted = Number(process.env.HTTPS_PORT || getSetting('https_port', 8920)) || 0;
  if (tls && wanted) {
    // HTTP/2 (et HTTP/1.1 pour les anciens appareils) : le navigateur charge tout en parallèle sur une seule
    // connexion, au lieu de 6 connexions au plus (images, vidéo et chaînes ne s'attendent plus les unes les autres)
    const secureServer = process.env.VENUS_HTTP2 === '0' ? https.createServer({ ...tls, minVersion: 'TLSv1.2' }, handle)
      : http2.createSecureServer({ ...tls, minVersion: 'TLSv1.2', allowHTTP1: true, settings: { maxConcurrentStreams: 256 } }, handle);
    secureServer.headersTimeout = 20000; secureServer.requestTimeout = 0; secureServer.setTimeout(120000); secureServer.keepAliveTimeout = 65000;
    secureServer.on('error', (e) => console.warn('[https]', e.message));
    secureServer.listen(wanted, config.host, () => {
      httpsPort = wanted;
      console.log(`  🔒 HTTPS : https://localhost:${wanted}${tls.selfSigned ? ' (certificat autosigné : le navigateur demandera de l’accepter une fois)' : ''}`);
    });
  }
  // Alertes de sécurité envoyées à l'administrateur (notifications, ntfy, Discord, Telegram)
  onSecurityAlert((m) => { notify({ title: m.title, body: m.body, url: m.url, tag: 'securite' }, { adminOnly: true }); emitHook('security.alert', { title: m.title, message: m.body }); });
  startSecurityAudit();
  // Accès hors de la maison (tunnel) : relancé s'il était activé
  import('./remote-access.js').then((m) => m.resumeRemote());
  // Trakt : historique de chaque profil relié importé toutes les 6 h (vérifié toutes les 30 min)
  import('./trakt-sync.js').then((m) => { const t = () => m.traktSyncAll().catch((e) => console.warn('[trakt]', e.message)); setTimeout(t, 60000).unref(); setInterval(t, 30 * 60000).unref(); });
  // Rappels de programmes TV : notification 5 minutes avant le début
  setInterval(() => sendTvReminders().catch((e) => console.warn('[rappels]', e.message)), 30000).unref();
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
  // « À venir » : programmes TVmaze et AniList préparés à l'avance
  setTimeout(() => warmUpcoming().catch(() => {}), 45000).unref();
  setInterval(() => warmUpcoming().catch(() => {}), 5.5 * 3600e3).unref();
  // Nouveautés : notification, et les envies arrivées passent dans « Ma liste » (avec notification à la personne)
  let watchSoon = null, tgSoon = null;
  events.on('library', (d) => {
    if (d && d.added && d.added.length) {
      libraryAdded(d.added);
      // Fiches Telegram (affiche, résumé, date, état) : quelques minutes après, le temps que l'affiche arrive
      clearTimeout(tgSoon); tgSoon = setTimeout(() => announceArrivals().catch((e) => console.warn('[telegram]', e.message)), 4 * 60e3);
      announceNewEpisodes().catch((e) => console.warn('[nouveaux épisodes]', e.message));
      emitHook('library.added', { titles: d.added.slice(0, 50), count: d.added.length });
      clearTimeout(watchSoon); watchSoon = setTimeout(() => runWatch().catch(() => {}), 90000);
    }
  });
  startBackups();
  // Vignettes d'aperçu de la barre de lecture : préparées en arrière-plan, titre après titre
  // Tâches visibles dans Tableau de bord → Serveur (leur propre minuterie reste celle d'origine)
  defineTask('scan', { label: 'Analyse des bibliothèques', description: 'Cherche les nouveaux fichiers, les fichiers modifiés et supprimés.', when: `Toutes les ${getSetting('scan_interval', 60)} min, et dès qu’un fichier apparaît`, run: async () => { await scanAll(); return 'Analyse terminée'; } });
  defineTask('posters', { label: 'Affiches manquantes', description: 'Films, séries et saisons encore sans affiche ou sans image de fond : recherche sur des services gratuits (sans clé), en plus de TMDB.', when: 'Chaque jour', every: 86400e3, firstDelay: 120000, run: async () => {
    // Tant qu'il reste des titres à traiter, la tâche enchaîne les passages (300 titres chacun) sans attendre le lendemain
    let found = 0, passes = 0;
    do { found += await fillMissingPosters(); passes++; } while (pendingPosters() > 0 && passes < 12);
    const bg = await fillMissingBackdrops();
    const seasons = await fillSeasonPosters();
    return `${found} affiche(s), ${seasons} affiche(s) de saison et ${bg} image(s) de fond trouvée(s)${pendingPosters() ? `, ${pendingPosters()} titre(s) encore sans affiche` : ''}`;
  } });
  defineTask('ratings', { label: 'Notes, distribution et bandes-annonces', description: 'Notes des sites, épisodes manquants, affiches Trakt : titres nouveaux ou vus il y a plus de 10 jours.', when: 'Toutes les 6 heures', run: async () => `${ratingsAll()} titre(s) mis en file` });
  defineTask('segments', { label: 'Repérage des génériques', description: 'Analyse audio des épisodes pour « Passer l’intro » et « Passer le générique ».', when: 'Toutes les 30 minutes', run: async () => { schedulePending(); return 'Épisodes en attente ajoutés à la file'; } });
  defineTask('backup', { label: 'Sauvegarde de la base', description: 'Profils, vus, listes, envies et réglages (10 dernières gardées).', when: 'Chaque nuit', run: async () => { makeBackup(); return 'Sauvegarde faite'; } });
  defineTask('guide', { label: 'Guide des épisodes', description: 'Sans clé TMDB : liste des épisodes diffusés (TVmaze), pour montrer les épisodes et saisons manquants.', when: 'Chaque jour', every: 86400e3, firstDelay: 240000, run: refreshGuides });
  defineTask('iptv-check', { label: 'Vérification des chaînes', description: 'Ouvre chaque chaîne de TV en direct et vérifie qu’elle donne 4 secondes d’images sans couper ; celles qui échouent ou démarrent trop lentement sont cachées jusqu’à la prochaine vérification.', when: 'Toutes les 12 heures', every: 43200e3, firstDelay: 300000, run: () => checkChannels() });
  defineTask('report', { label: 'Rapport de la semaine', description: 'Nouveautés, temps regardé par profil, espace disque, tâches en échec : envoyé à l’administrateur (notification, et e-mail si réglé).', when: 'Chaque semaine', every: 7 * 86400e3, firstDelay: 3 * 86400e3, run: sendWeeklyReport });
  defineTask('integrity', { label: 'Fichiers abîmés', description: 'Lit un peu de chaque vidéo avec ffmpeg pour repérer les fichiers corrompus ou incomplets (30 par passage, les nouveaux d’abord).', when: 'Toutes les 12 heures', every: 12 * 3600e3, firstDelay: 20 * 60000, run: () => checkFiles(30) });
  defineTask('trash', { label: 'Corbeille', description: `Efface pour de bon les vidéos supprimées depuis plus de ${KEEP_DAYS} jours (Réglages → Corbeille pour les restaurer avant).`, when: 'Chaque nuit', every: 86400e3, firstDelay: 300000, run: async () => { const r = purgeTrash(); return r.count ? `${r.count} élément(s) effacé(s), ${(r.freed / 1e9).toFixed(1)} Go libérés` : 'Rien à effacer'; } });
  defineTask('disk', { label: 'Espace disque', description: 'Prévient l’administrateur quand un disque (données, conversion, médiathèques) est presque plein (moins de 5 % ou 10 Go).', when: 'Toutes les 6 heures', every: 6 * 3600e3, firstDelay: 90000, run: async () => {
    recordSize(); // relevé quotidien pour la prévision « disque plein dans N mois »
    const checked = new Set(); const warn = [];
    for (const [name, dir] of [['Données de Venus', config.dataDir], ['Conversion', config.transcodeDir], ...all('SELECT name, path FROM libraries').map((l) => [l.name, l.path])]) {
      let st; try { st = fs.statfsSync(dir); } catch { continue; }
      const total = st.blocks * st.bsize, free = st.bavail * st.bsize, key = `${total}:${free}`;
      if (!total || checked.has(key)) continue; checked.add(key);
      if (free < Math.min(total * 0.05, 10 * 1024 ** 3)) warn.push(`${name} : ${(free / 1024 ** 3).toFixed(1)} Go libres`);
    }
    if (warn.length && getSetting('disk_warned', '') !== warn.join('|')) {
      setSetting('disk_warned', warn.join('|'));
      notify({ title: 'Disque presque plein', body: warn.join(' · '), url: '/dashboard', tag: 'disk' }, { adminOnly: true });
    } else if (!warn.length) setSetting('disk_warned', '');
    return warn.length ? `Attention : ${warn.join(' · ')}` : 'Assez de place partout';
  } });
  defineTask('audit', { label: 'Audit de sécurité', description: 'Vérifie les réglages de sécurité et prévient en cas de problème.', when: 'Chaque semaine', run: async () => { const r = await runSecurityAudit(); return `Note : ${r.score} %`; } });
  defineTask('seerr', { label: 'Séries suivies (Seerr)', description: 'Demande à Seerr les nouvelles saisons des séries suivies.', when: 'Toutes les 6 heures', run: async () => { await runWatch(); return 'Vérification faite'; } });
  defineTask('epg', { label: 'Guide des programmes TV', description: 'Télécharge le guide XMLTV des chaînes et programme les enregistrements des émissions suivies.', every: 12 * 3600e3, firstDelay: 60e3,
    run: async (progress) => { const r = await refreshEpg(progress); const n = applyRules(); return n ? `${r} · ${n} enregistrement(s) programmé(s)` : r; } });
  setInterval(() => pruneEpg(), 3600e3).unref();
  startDvr();
  defineTask('optimize', { label: 'Versions optimisées', description: 'Prépare une copie H.264 + AAC des vidéos qui doivent être converties à chaque lecture (HEVC, 10 bits, son DTS…), pour qu’elles démarrent tout de suite. Automatique s’il y a de la place, avec la carte graphique (ou la nuit avec le processeur), jamais pendant une lecture.', when: 'Toutes les 30 minutes', every: 30 * 60e3, firstDelay: 10 * 60e3, run: () => runOptimize() });
  defineTask('nas-health', { label: 'Santé du NAS', description: 'Mesure la vitesse de lecture de chaque bibliothèque et prévient si le partage est trop lent ou injoignable.', when: 'Toutes les 6 heures', every: 6 * 3600e3, firstDelay: 8 * 60e3, run: async () => { const r = await checkNas(); const bad = r.libraries.filter((x) => !x.ok); return bad.length ? `À surveiller : ${bad.map((x) => x.name).join(', ')}` : `${r.libraries.length} bibliothèque(s) en forme`; } });
  defineTask('wanted', { label: 'Favoris arrivés', description: 'Prévient chaque profil quand un favori pris dans « À venir » arrive sur le NAS.', when: 'Toutes les 20 minutes', every: 20 * 60e3, firstDelay: 5 * 60e3, run: wantedArrivals });
  defineTask('telegram', { label: 'Fiches Telegram', description: 'Envoie sur Telegram une fiche par film, série ou animé (affiche, résumé, date de sortie), mise à jour au fil du téléchargement puis de l’arrivée dans Venus.', when: 'Toutes les 2 minutes', every: 2 * 60e3, firstDelay: 90e3, run: async () => { const a = await pollDownloads(); const b = await announceArrivals(); pruneTgPosts(); return `${a} · ${b}`; } });
  defineTask('update-check', { label: 'Nouvelle version', description: 'Regarde sur GitHub si une nouvelle version de Venus est sortie et prévient les administrateurs (appareils, Telegram…), une fois par version.', when: 'Toutes les 3 heures', every: 3 * 3600e3, firstDelay: 3 * 60e3, run: notifyNewVersion });
  defineTask('trickplay', { label: 'Vignettes de la barre de lecture', description: 'Une image toutes les 10 secondes pour chaque film, épisode et clip, montrée au survol de la barre.', every: 6 * 3600e3, firstDelay: 5 * 60e3, run: trickplayBackfill });
  setInterval(() => refreshRatings(), 6 * 3600000).unref();
  // Scan au démarrage puis périodique (filet de sécurité pour les partages réseau)
  // Chaînes gratuites (France et Outre-mer, Mayotte La 1ère en tête) ajoutées à la première mise en route
  try { if (ensureFreeTv()) console.log('[iptv] chaînes gratuites ajoutées'); } catch (e) { console.warn('[iptv]', e.message); }
  // Chaînes du monde (iptv-org : France, Japon, Inde, animé, films, sport…), ajoutées une fois
  try { if (process.env.VENUS_IPTV_WORLD !== '0' && ensureIptvWorld()) console.log('[iptv] chaînes du monde ajoutées'); } catch (e) { console.warn('[iptv]', e.message); }
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
