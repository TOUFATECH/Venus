// Mini-framework HTTP sans dépendance : routeur, JSON, fichiers statiques compressés, Range
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.vtt': 'text/vtt; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};
export const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  del(p, h) { this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

// Lecture du corps JSON d'une requête : taille et durée limitées, uniquement un objet, sans clés
// dangereuses (__proto__, constructor, prototype : pollution de prototype), profondeur et textes bornés
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function checkShape(v, depth = 0) {
  if (depth > 8) throw new HttpError(400, 'Données trop imbriquées');
  if (typeof v === 'string' && v.length > 200000) throw new HttpError(413, 'Texte trop long');
  if (Array.isArray(v)) { if (v.length > 5000) throw new HttpError(413, 'Liste trop longue'); v.forEach((x) => checkShape(x, depth + 1)); }
  else if (v && typeof v === 'object') { const keys = Object.keys(v); if (keys.length > 500) throw new HttpError(413, 'Trop de champs'); for (const k of keys) checkShape(v[k], depth + 1); }
}
export function readBody(req, limit = 1e6, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (req.headers['content-length'] && Number(req.headers['content-length']) > limit) { reject(new HttpError(413, 'Requête trop volumineuse')); req.resume(); return; }
    let size = 0; const chunks = [];
    const timer = setTimeout(() => { reject(new HttpError(408, 'Requête trop lente')); req.destroy(); }, timeout);
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { clearTimeout(timer); reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      clearTimeout(timer);
      if (!chunks.length) return resolve({});
      if (type && !/^application\/json|^text\/plain/i.test(type)) return reject(new HttpError(415, 'Format attendu : JSON'));
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8'), (k, v) => (BAD_KEYS.has(k) ? undefined : v)); }
      catch { return reject(new HttpError(400, 'JSON invalide')); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reject(new HttpError(400, 'Objet JSON attendu'));
      try { checkShape(data); } catch (e) { return reject(e); }
      resolve(data);
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

export function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  const accept = res.req?.headers['accept-encoding'] || '';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (body.length > 2048 && accept.includes('gzip')) {
    const gz = zlib.gzipSync(body, { level: 5 });
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, Vary: 'Accept-Encoding' });
    return res.end(gz);
  }
  res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Envoi d'un fichier avec prise en charge des requêtes Range (lecture directe + avance rapide)
export function sendFile(req, res, filePath, { cache = 'no-cache', type } = {}) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { throw new HttpError(404, 'Fichier introuvable'); }
  const size = stat.size;
  const headers = {
    'Content-Type': type || mimeOf(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'Last-Modified': stat.mtime.toUTCString(),
  };
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  headers.ETag = etag;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : NaN;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start)) { start = size - end; end = size - 1; } // suffix range
    if (start >= size || start < 0 || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 512 * 1024 });
    stream.pipe(res);
    res.on('close', () => stream.destroy());
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filePath, { highWaterMark: 512 * 1024 });
  stream.pipe(res);
  res.on('close', () => stream.destroy());
}

// Numéro de version de l'interface (empreinte des fichiers). Les fichiers sont servis sous /b/<version>/… :
// après une mise à jour, le navigateur charge forcément les nouveaux fichiers, jamais un mélange avec
// d'anciens fichiers gardés en cache (cause des erreurs « doesn't provide an export named »).
let build = { at: 0, id: null };
export function buildId(root) {
  if (build.id && Date.now() - build.at < 5000) return build.id;
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = fs.statSync(p); h.update(`${path.relative(root, p)}:${st.size}:${Math.floor(st.mtimeMs)};`); }
    }
  };
  walk(root);
  build = { at: Date.now(), id: h.digest('hex').slice(0, 10) };
  return build.id;
}

// Fichiers statiques de l'interface, compressés en mémoire (brotli/gzip) une seule fois
const staticCache = new Map();
export function serveStatic(req, res, root, pathname) {
  let rel = decodeURIComponent(pathname);
  // /b/<version>/js/app.js → /js/app.js ; immuable si c'est la version en cours
  let versioned = false;
  const vb = /^\/b\/([a-f0-9]{6,40})(\/.*)$/.exec(rel);
  if (vb) { rel = vb[2]; versioned = vb[1] === buildId(root); }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(root)) return false;
  let stat;
  try { stat = fs.statSync(full); if (!stat.isFile()) return false; } catch { return false; }

  const type = mimeOf(full);
  const compressible = /text|javascript|json|svg|manifest/.test(type);
  // Code de l'interface : toujours revalidé (réponse 304 instantanée si inchangé), pour qu'une mise à jour
  // ne mélange jamais anciens et nouveaux fichiers. Polices et icônes : cache d'une heure.
  const fresh = /\.(html|js|mjs|css|webmanifest|json)$/.test(full);
  const isIndex = path.basename(full) === 'index.html';
  const cacheCtl = versioned && !isIndex ? 'public, max-age=31536000, immutable' : fresh ? 'no-cache' : 'public, max-age=3600, stale-while-revalidate=86400';
  if (!compressible) { sendFile(req, res, full, { cache: cacheCtl }); return true; }

  const cacheKey = isIndex ? `${full}#${buildId(root)}` : full;
  let entry = staticCache.get(cacheKey);
  if (!entry || entry.mtime !== stat.mtimeMs) {
    let raw = fs.readFileSync(full);
    // La page d'accueil pointe vers les fichiers de la version en cours
    if (isIndex) {
      const id = buildId(root);
      raw = Buffer.from(raw.toString('utf8').replace(/(href|src)="\/(js|css|fonts)\//g, `$1="/b/${id}/$2/`));
    }
    entry = {
      mtime: stat.mtimeMs, raw,
      br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
      gz: zlib.gzipSync(raw, { level: 9 }),
      etag: `"${raw.length.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}${isIndex ? `-${buildId(root)}` : ''}"`,
    };
    staticCache.set(cacheKey, entry);
  }
  const headers = { 'Content-Type': type, 'Cache-Control': cacheCtl, ETag: entry.etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return true; }
  const ae = req.headers['accept-encoding'] || '';
  let body = entry.raw;
  if (ae.includes('br')) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (ae.includes('gzip')) { body = entry.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

export function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
