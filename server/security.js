// Sécurité de Venus : en-têtes (CSP, anti-clickjacking…), CORS, CSRF, limitation des tentatives,
// détection d'intrusion basique (bannissement temporaire des adresses IP), journal de sécurité,
// validation des données reçues et chemins de fichiers sûrs. Aucune dépendance.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { db, all, get, run, getSetting } from './db.js';
import { HttpError } from './http.js';

const PROD = process.env.NODE_ENV === 'production';

db.exec(`
CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY, at INTEGER, ip TEXT, kind TEXT, severity TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS security_log_at ON security_log(at);
CREATE TABLE IF NOT EXISTS ip_bans (ip TEXT PRIMARY KEY, until INTEGER, reason TEXT, at INTEGER, count INTEGER DEFAULT 1);
`);

// ------------------------------------------------------------------ adresse du client
const strip = (ip) => String(ip || '').replace(/^::ffff:/, '');
export function isLoopback(ip) { ip = strip(ip); return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.'); }
export function isPrivateIp(ip) {
  ip = strip(ip);
  if (isLoopback(ip)) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^(fc|fd|fe80)/i.test(ip);
}
// Derrière un proxy (Caddy, Nginx) sur la même machine — ou TRUST_PROXY=1 — on lit X-Forwarded-For
const trustProxy = (remote) => isLoopback(remote) || (process.env.TRUST_PROXY === '1' && isPrivateIp(remote));
export function clientIp(req) {
  const remote = strip(req.socket.remoteAddress);
  const xff = req.headers['x-forwarded-for'];
  if (xff && trustProxy(remote)) {
    const list = String(xff).split(',').map((x) => strip(x.trim())).filter((x) => net.isIP(x));
    if (list.length) return list[list.length - 1];
  }
  return remote;
}
export function isSecure(req) {
  if (req.socket.encrypted) return true;
  return trustProxy(strip(req.socket.remoteAddress)) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// ------------------------------------------------------------------ journal de sécurité
let notifyFn = null;
export function onSecurityAlert(fn) { notifyFn = fn; }
const lastAlert = new Map();
export function logSecurity(kind, ip, detail = '', severity = 'warn') {
  try {
    run('INSERT INTO security_log(at, ip, kind, severity, detail) VALUES(?, ?, ?, ?, ?)', Date.now(), ip || '', kind, severity, String(detail).slice(0, 500));
  } catch { /* base indisponible */ }
  if (severity !== 'info') console.warn(`[sécurité] ${kind} ${ip || ''} ${detail}`);
  // Alerte à l'administrateur pour les évènements graves (au plus une fois toutes les 10 min par type)
  if (severity === 'high' && notifyFn && Date.now() - (lastAlert.get(kind) || 0) > 600000) {
    lastAlert.set(kind, Date.now());
    try { notifyFn({ title: 'Venus : alerte de sécurité', body: `${detail}${ip ? ` (${ip})` : ''}`, url: '/tableau-de-bord' }); } catch { /* */ }
  }
}
setInterval(() => {
  try { run('DELETE FROM security_log WHERE id NOT IN (SELECT id FROM security_log ORDER BY id DESC LIMIT 5000)'); } catch { /* */ }
}, 3600000).unref();
export function securityLog(limit = 200) {
  return all('SELECT * FROM security_log ORDER BY id DESC LIMIT ?', Math.min(1000, Math.max(1, Number(limit) || 200)));
}

// ------------------------------------------------------------------ bannissement et détection d'intrusion
const banCache = new Map();
export function isBanned(ip) {
  if (!ip || isLoopback(ip)) return null;
  let b = banCache.get(ip);
  if (b === undefined) { b = get('SELECT * FROM ip_bans WHERE ip = ?', ip) || null; banCache.set(ip, b); }
  if (b && b.until && b.until < Date.now()) return null;
  return b;
}
export function banIp(ip, ms, reason) {
  if (!ip || isLoopback(ip)) return;
  const prev = get('SELECT * FROM ip_bans WHERE ip = ?', ip);
  const count = (prev ? prev.count : 0) + 1;
  const until = ms === Infinity ? null : Date.now() + ms;
  run('INSERT INTO ip_bans(ip, until, reason, at, count) VALUES(?, ?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET until = excluded.until, reason = excluded.reason, at = excluded.at, count = excluded.count',
    ip, until, String(reason).slice(0, 200), Date.now(), count);
  banCache.delete(ip);
  logSecurity('ban', ip, `Adresse bloquée ${until ? `jusqu’à ${new Date(until).toLocaleString('fr-FR')}` : 'définitivement'} : ${reason}`, 'high');
}
export function unbanIp(ip) { run('DELETE FROM ip_bans WHERE ip = ?', ip); banCache.delete(ip); scores.delete(ip); }
export function listBans() { return all('SELECT * FROM ip_bans WHERE until IS NULL OR until > ? ORDER BY at DESC', Date.now()); }

// Score de suspicion par adresse : il baisse d'un point par minute. À 40, l'adresse est bloquée
// 1 h, puis 6 h, 24 h et 7 jours en cas de récidive.
const scores = new Map();
const BAN_STEPS = [3600e3, 6 * 3600e3, 24 * 3600e3, 7 * 24 * 3600e3];
export function suspicious(ip, points, reason) {
  if (!ip || isLoopback(ip)) return;
  const now = Date.now();
  const s = scores.get(ip) || { v: 0, t: now };
  s.v = Math.max(0, s.v - (now - s.t) / 60000) + points;
  s.t = now;
  scores.set(ip, s);
  if (points >= 10) logSecurity('suspect', ip, reason, 'warn');
  if (s.v >= 40) {
    const prev = get('SELECT count FROM ip_bans WHERE ip = ?', ip);
    banIp(ip, BAN_STEPS[Math.min(BAN_STEPS.length - 1, prev ? prev.count : 0)], reason);
    scores.delete(ip);
  }
}
setInterval(() => { const now = Date.now(); for (const [ip, s] of scores) if (now - s.t > 3600e3) scores.delete(ip); }, 600000).unref();

const SCANNER = /(\.env\b|\/\.git|wp-(admin|login|content|includes)|phpmyadmin|\.php\d?$|\/cgi-bin|\/etc\/passwd|boaform|\.aspx?$|\/actuator|server-status|\/HNAP1|\.(bak|sql|sqlite)$|\/vendor\/phpunit|\/shell|\/\.aws)/i;
// Requêtes typiques des robots qui cherchent des failles, et tentatives de remonter l'arborescence
export function inspectRequest(req, url, ip) {
  const raw = req.url || '';
  if (raw.length > 8192) { suspicious(ip, 10, 'Adresse anormalement longue'); throw new HttpError(414, 'Adresse trop longue'); }
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { suspicious(ip, 5, 'Adresse mal encodée'); throw new HttpError(400, 'Adresse invalide'); }
  if (/\0|(^|[\\/])\.\.([\\/]|$)/.test(decoded) || /%2e%2e|%252e/i.test(raw)) {
    suspicious(ip, 20, `Tentative de remonter les dossiers : ${raw.slice(0, 120)}`);
    throw new HttpError(400, 'Adresse invalide');
  }
  if (SCANNER.test(url.pathname)) {
    suspicious(ip, 15, `Recherche de faille : ${url.pathname.slice(0, 120)}`);
    throw new HttpError(404, 'Introuvable');
  }
}

// ------------------------------------------------------------------ limitation des tentatives (force brute)
// Par adresse : 5 échecs en 15 min → pause qui double à chaque fois (15 min, 30 min… 24 h max) ;
// 30 échecs dans la journée → bloqué jusqu'au lendemain. Par compte (toutes adresses confondues) :
// 20 échecs en 1 h → pause de 15 min pour tout le monde (attaque répartie sur plusieurs machines).
const fails = new Map(); // `${kind}|${ip}` -> { list: [t], lockedUntil, locks, day, dayCount }
const accountFails = new Map(); // kind -> [t]
const today = () => new Date().toISOString().slice(0, 10);
const LIMITS = {
  login: { max: 5, perDay: 30, account: 20 },
  code: { max: 5, perDay: 20, account: 30 },
  pin: { max: 5, perDay: 20, account: 0 },
  '2fa': { max: 5, perDay: 15, account: 30 },
  join: { max: 10, perDay: 60, account: 0 },
};
function bucket(kind, ip) {
  const key = `${kind}|${ip}`;
  let b = fails.get(key);
  if (!b || b.day !== today()) { b = { list: [], lockedUntil: 0, locks: b && b.day === today() ? b.locks : 0, day: today(), dayCount: 0 }; fails.set(key, b); }
  return b;
}
const fmtWait = (ms) => (ms > 3600e3 ? `${Math.ceil(ms / 3600e3)} h` : `${Math.max(1, Math.ceil(ms / 60000))} min`);
export function guardAttempt(kind, ip) {
  const L = LIMITS[kind.split(':')[0]] || LIMITS.login;
  if (isBanned(ip)) throw new HttpError(403, 'Accès bloqué pour cette adresse. L’administrateur peut la débloquer dans le tableau de bord.');
  const b = bucket(kind, ip);
  const now = Date.now();
  if (b.dayCount >= L.perDay) throw new HttpError(429, 'Trop d’essais aujourd’hui depuis cet appareil. Réessayez demain.');
  if (b.lockedUntil > now) throw new HttpError(429, `Trop d’essais. Réessayez dans ${fmtWait(b.lockedUntil - now)}.`);
  const acc = (accountFails.get(kind) || []).filter((t) => now - t < 3600e3);
  if (L.account && acc.length >= L.account) throw new HttpError(429, 'Trop d’essais sur ce compte. Réessayez dans quelques minutes.');
}
export function failAttempt(kind, ip, detail = '') {
  const L = LIMITS[kind.split(':')[0]] || LIMITS.login;
  const now = Date.now();
  const b = bucket(kind, ip);
  b.list = b.list.filter((t) => now - t < 15 * 60000);
  b.list.push(now); b.dayCount++;
  const acc = (accountFails.get(kind) || []).filter((t) => now - t < 3600e3);
  acc.push(now); accountFails.set(kind, acc);
  logSecurity(`echec-${kind.split(':')[0]}`, ip, detail || `Échec (${kind})`, 'info');
  suspicious(ip, 3, `Échecs répétés (${kind})`);
  if (b.list.length >= L.max) {
    b.locks++;
    b.lockedUntil = now + Math.min(24 * 3600e3, 15 * 60000 * 2 ** (b.locks - 1));
    b.list = [];
    logSecurity('force-brute', ip, `${L.max} échecs (${kind}) : pause de ${fmtWait(b.lockedUntil - now)}`, b.locks >= 3 ? 'high' : 'warn');
  }
  if (L.account && acc.length === L.account) logSecurity('force-brute-repartie', ip, `${L.account} échecs en 1 h sur « ${kind} », toutes adresses confondues`, 'high');
}
export function okAttempt(kind, ip) { const b = fails.get(`${kind}|${ip}`); if (b) { b.list = []; b.lockedUntil = 0; } }
export function attemptStats() {
  return [...fails.entries()].filter(([, b]) => b.day === today() && (b.dayCount || b.lockedUntil > Date.now()))
    .map(([k, b]) => ({ kind: k.split('|')[0], ip: k.split('|').slice(1).join('|'), failsToday: b.dayCount, lockedUntil: b.lockedUntil > Date.now() ? b.lockedUntil : null }));
}

// Limite générale du nombre de requêtes à l'API par adresse (protège aussi des boucles)
const reqCount = new Map();
export function rateLimit(ip, pathname) {
  if (!ip || isLoopback(ip)) return;
  if (/^\/api\/(hls|stream|subs)\//.test(pathname) || pathname.startsWith('/img/')) return; // flux vidéo : beaucoup de petites requêtes
  const now = Date.now();
  let c = reqCount.get(ip);
  if (!c || now - c.t > 60000) { c = { n: 0, t: now }; reqCount.set(ip, c); }
  if (++c.n > 900) {
    if (c.n === 901) suspicious(ip, 10, 'Plus de 900 requêtes par minute');
    throw new HttpError(429, 'Trop de requêtes, ralentissez');
  }
}
setInterval(() => { const now = Date.now(); for (const [ip, c] of reqCount) if (now - c.t > 120000) reqCount.delete(ip); }, 120000).unref();

// ------------------------------------------------------------------ en-têtes de sécurité, CSP, CORS
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let inlineHashes = { at: 0, list: [] };
function scriptHashes() {
  // Empreintes des petits scripts écrits directement dans index.html (seuls scripts « en ligne » autorisés)
  try {
    const st = fs.statSync(path.join(publicDir, 'index.html'));
    if (st.mtimeMs === inlineHashes.at) return inlineHashes.list;
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const list = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    inlineHashes = { at: st.mtimeMs, list };
    return list;
  } catch { return []; }
}
export function contentSecurityPolicy(secure) {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes().join(' ')} https://www.gstatic.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    secure ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ');
}
// Fichiers lus par le Chromecast (autre origine) : seuls ces flux sont partagés entre origines, sans cookie
export const isMediaRoute = (p) => /^\/api\/(hls|stream|subs)\//.test(p) || p.startsWith('/img/') || /^\/api\/items\/\d+\/(thumb|preview)$/.test(p) || /^\/api\/channels\/\d+\/preview\.jpg$/.test(p);
export function applyHeaders(req, res, url, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(secure));
  if (secure && httpsMode() !== 'off') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (isMediaRoute(url.pathname)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  } else res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
// Pré-vérification CORS : acceptée seulement pour les flux vidéo (lecture seule)
export function handlePreflight(req, res, url, ip) {
  if (isMediaRoute(url.pathname)) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range, Content-Type', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  logSecurity('cors', ip, `Requête d’une autre origine refusée : ${String(req.headers.origin || '?').slice(0, 100)} → ${url.pathname}`, 'info');
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Origine non autorisée' }));
}

// ------------------------------------------------------------------ CSRF : origine des requêtes qui modifient quelque chose
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function allowedHosts(req) {
  const hosts = new Set([String(req.headers.host || '').toLowerCase()]);
  const fwd = req.headers['x-forwarded-host'];
  if (fwd && trustProxy(strip(req.socket.remoteAddress))) hosts.add(String(fwd).split(',')[0].trim().toLowerCase());
  const pub = getSetting('public_url', '');
  if (pub) { try { hosts.add(new URL(pub).host.toLowerCase()); } catch { /* */ } }
  return hosts;
}
export function checkCsrf(req, url, ip) {
  if (!UNSAFE.has(req.method)) return;
  const origin = req.headers.origin || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch { return 'invalid'; } })() : null);
  if (origin && origin !== 'null') {
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch { host = null; }
    if (!host || !allowedHosts(req).has(host)) {
      suspicious(ip, 10, `Requête venant d’un autre site refusée (CSRF) : ${String(origin).slice(0, 80)} → ${url.pathname}`);
      throw new HttpError(403, 'Origine non autorisée');
    }
  } else if (origin === 'null') {
    suspicious(ip, 10, `Origine « null » refusée → ${url.pathname}`);
    throw new HttpError(403, 'Origine non autorisée');
  }
  // Sans en-tête Origin (application, script) : l'identifiant doit venir de l'en-tête Authorization,
  // jamais d'un cookie envoyé automatiquement par le navigateur
}

// HPP : un paramètre en double dans l'adresse (?type=a&type=b) est refusé
export function checkHpp(url, ip) {
  const seen = new Set();
  for (const k of url.searchParams.keys()) {
    if (seen.has(k)) { suspicious(ip, 2, `Paramètre en double : ${k}`); throw new HttpError(400, `Paramètre « ${k} » en double`); }
    seen.add(k);
  }
}

// ------------------------------------------------------------------ HTTPS obligatoire
// off : jamais ; remote (par défaut) : obligatoire hors du réseau local ; all : partout
export function httpsMode() { return process.env.FORCE_HTTPS || getSetting('force_https', 'remote'); }
export function requireHttps(req, res, url, ip, httpsPort) {
  const mode = httpsMode();
  if (mode === 'off' || isSecure(req)) return false;
  if (mode === 'remote' && isPrivateIp(ip)) return false;
  // Redirection vers la version sécurisée quand Venus la sert lui-même ; sinon refus explicite
  if (httpsPort && (req.method === 'GET' || req.method === 'HEAD')) {
    const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
    res.writeHead(301, { Location: `https://${host}:${httpsPort}${url.pathname}${url.search}` });
    res.end();
    return true;
  }
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'HTTPS obligatoire : ouvrez Venus avec une adresse https://' }));
  return true;
}

// ------------------------------------------------------------------ erreurs sans détails en production
export function publicError(e, ip, req, url) {
  const status = e.status || 500;
  if (status < 500) return { status, error: e.message || 'Erreur' };
  // Erreurs prévues (service extérieur indisponible, chaîne muette…) : message utile gardé, rien de technique
  if (e.status && e.status !== 500) return { status, error: e.message || 'Service indisponible' };
  const ref = crypto.randomBytes(3).toString('hex').toUpperCase();
  console.error(`[erreur ${ref}] ${req.method} ${url.pathname}`, e);
  logSecurity('erreur-serveur', ip, `Réf. ${ref} : ${req.method} ${url.pathname} — ${String(e.message || e).slice(0, 160)}`, 'info');
  return { status, error: PROD ? `Erreur interne (réf. ${ref})` : (e.message || 'Erreur interne') };
}

// ------------------------------------------------------------------ chemins de fichiers sûrs
// Résout `rel` à l'intérieur de `root` ; refuse toute sortie du dossier, les octets nuls et les liens qui s'échappent
export function safeJoin(root, rel) {
  const r = String(rel ?? '');
  if (r.includes('\0')) throw new HttpError(400, 'Chemin invalide');
  const base = path.resolve(root);
  const full = path.resolve(base, r.replace(/^[/\\]+/, ''));
  if (full !== base && !full.startsWith(base + path.sep)) throw new HttpError(400, 'Chemin invalide');
  try {
    const real = fs.realpathSync(full);
    const realBase = fs.realpathSync(base);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new HttpError(400, 'Chemin invalide');
  } catch (e) { if (e instanceof HttpError) throw e; /* fichier pas encore créé */ }
  return full;
}
export const safeFileName = (x, max = 150) => String(x || '').normalize('NFC').replace(/[\u0000-\u001f<>:"|?*\\/]/g, ' ').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, max);

// ------------------------------------------------------------------ validation des données reçues
// Chaque champ est décrit par un petit schéma ; les champs inconnus sont ignorés, les types vérifiés
// (pas d'objet là où on attend un texte : protection contre les injections « NoSQL » et la pollution).
const fail = (field, msg) => { throw new HttpError(400, `${field} : ${msg}`); };
export const V = {
  str: ({ max = 200, min = 0, trim = true, pattern = null, label } = {}) => (v, f) => {
    if (typeof v !== 'string' && typeof v !== 'number') fail(label || f, 'texte attendu');
    let s = String(v).normalize('NFC');
    if (trim) s = s.trim();
    // Caractères de contrôle invisibles retirés (hors retours à la ligne)
    s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (s.length < min) fail(label || f, min === 1 ? 'obligatoire' : `${min} caractères minimum`);
    if (s.length > max) fail(label || f, `${max} caractères maximum`);
    if (pattern && s && !pattern.test(s)) fail(label || f, 'format invalide');
    return s;
  },
  int: ({ min = -1e12, max = 1e12, label } = {}) => (v, f) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n)) fail(label || f, 'nombre entier attendu');
    if (n < min || n > max) fail(label || f, `entre ${min} et ${max}`);
    return n;
  },
  num: ({ min = -1e15, max = 1e15, label } = {}) => (v, f) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) fail(label || f, 'nombre attendu');
    if (n < min || n > max) fail(label || f, `entre ${min} et ${max}`);
    return n;
  },
  bool: ({ label } = {}) => (v, f) => { if (typeof v !== 'boolean') fail(label || f, 'vrai ou faux attendu'); return v; },
  oneOf: (list, { label } = {}) => (v, f) => { if (!list.includes(v)) fail(label || f, 'valeur non autorisée'); return v; },
  email: ({ label } = {}) => (v, f) => {
    const s = V.str({ max: 254, label })(v, f).toLowerCase();
    if (s && !/^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) fail(label || f, 'adresse e-mail invalide');
    return s;
  },
  url: ({ label, https = false } = {}) => (v, f) => {
    const s = V.str({ max: 2000, label })(v, f);
    if (!s) return s;
    let u; try { u = new URL(s); } catch { fail(label || f, 'adresse invalide'); }
    if (!/^https?:$/.test(u.protocol) || (https && u.protocol !== 'https:')) fail(label || f, https ? 'adresse https:// attendue' : 'adresse http(s):// attendue');
    return s;
  },
  pin: ({ label } = {}) => (v, f) => { const s = String(v ?? ''); if (s && !/^\d{4,8}$/.test(s)) fail(label || f, '4 à 8 chiffres'); return s; },
  nullable: (inner) => Object.assign((v, f) => (v === null || v === '' ? null : inner(v, f)), { nullable: true }),
  list: (inner, { max = 100, label } = {}) => (v, f) => {
    if (!Array.isArray(v)) fail(label || f, 'liste attendue');
    if (v.length > max) fail(label || f, `${max} éléments maximum`);
    return v.map((x, i) => inner(x, `${f}[${i}]`));
  },
};
// validate(body, { name: V.str({ min: 1 }) }, { required: ['name'] }) → objet propre (seulement les champs connus)
export function validate(body, schema, { required = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Données invalides');
  const out = {};
  for (const [k, check] of Object.entries(schema)) {
    // null pour un champ facultatif = « non fourni » (sauf champs qui acceptent explicitement null)
    if (body[k] === undefined || (body[k] === null && !check.nullable)) { if (required.includes(k)) fail(k, 'obligatoire'); continue; }
    out[k] = check(body[k], k);
  }
  return out;
}

// ------------------------------------------------------------------ mots de passe
const COMMON = new Set(['password', 'motdepasse', 'azerty', 'azertyuiop', 'qwerty', '123456', '1234567', '12345678', '123456789', '1234567890', 'admin', 'venus', 'soleil', 'bonjour', 'iloveyou', 'marseille', 'doudou', 'loulou', 'chouchou', 'password1', 'motdepasse1', '000000', '111111', 'abc123', 'football', 'jetaime', 'nicolas', 'camille', 'qwertyuiop', 'liverpool', 'princesse', 'famille', 'cinema', 'netflix', 'plex', 'jellyfin']);
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 10) return 'Mot de passe trop court : 10 caractères minimum';
  if (s.length > 200) return 'Mot de passe trop long (200 caractères maximum)';
  if (COMMON.has(s.toLowerCase()) || COMMON.has(s.toLowerCase().replace(/\d+$/, ''))) return 'Ce mot de passe est trop courant, choisissez-en un autre';
  if (/^(.)\1+$/.test(s)) return 'Mot de passe trop simple (un seul caractère répété)';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(s)).length;
  if (kinds < 2 && s.length < 16) return 'Mélangez lettres et chiffres (ou utilisez une phrase de 16 caractères et plus)';
  return null;
}
