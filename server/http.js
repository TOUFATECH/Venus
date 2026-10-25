// Mini-framework HTTP sans dépendance : routeur, JSON, fichiers statiques compressés, Range
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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

export function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON invalide')); }
    });
    req.on('error', reject);
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

// Fichiers statiques de l'interface, compressés en mémoire (brotli/gzip) une seule fois
const staticCache = new Map();
export function serveStatic(req, res, root, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(root)) return false;
  let stat;
  try { stat = fs.statSync(full); if (!stat.isFile()) return false; } catch { return false; }

  const type = mimeOf(full);
  const compressible = /text|javascript|json|svg|manifest/.test(type);
  const isHtml = full.endsWith('.html') || full.endsWith('sw.js');
  const cacheCtl = isHtml ? 'no-cache' : 'public, max-age=3600, stale-while-revalidate=86400';
  if (!compressible) { sendFile(req, res, full, { cache: cacheCtl }); return true; }

  let entry = staticCache.get(full);
  if (!entry || entry.mtime !== stat.mtimeMs) {
    const raw = fs.readFileSync(full);
    entry = {
      mtime: stat.mtimeMs, raw,
      br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
      gz: zlib.gzipSync(raw, { level: 9 }),
      etag: `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`,
    };
    staticCache.set(full, entry);
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
