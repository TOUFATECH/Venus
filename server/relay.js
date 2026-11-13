// Relais HLS des chaînes en direct : quand une chaîne est déjà au format web (HLS en H.264 / AAC, la grande
// majorité), Venus la relaie TELLE QUELLE au navigateur, sans ffmpeg. Démarrage quasi instantané, pistes
// audio d'origine gardées, aucune charge pour le serveur. ffmpeg ne sert plus qu'aux chaînes que le
// navigateur ne sait pas lire (HEVC, AC-3…), ou si ce relais échoue.
//
// Venus va chercher les listes et les morceaux lui-même (avec le bon navigateur / Referer, sans souci de
// CORS) et réécrit chaque adresse pour qu'elle repasse par lui. Sécurité : un relais ne suit que les
// serveurs annoncés par la chaîne elle-même (pas d'accès libre à n'importe quelle adresse), et son
// identifiant aléatoire sert de clé, comme pour les sessions /api/hls.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { get } from './db.js';
import { HttpError } from './http.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateIp } from './security.js';
import { isFtv, ftvPlaylist } from './ftv.js';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const relays = new Map(); // id → { itemId, url, hosts:Set, headers, touched }
const IDLE = 120000;
// Direct différé : pendant une pause, Venus continue de télécharger les morceaux de la chaîne (2 h au plus)
// et allonge la liste au lieu de la faire glisser ; on reprend là où on était, ou on revient au direct.
const HOLD_MAX = 2 * 3600e3;
// Dossier du direct différé (pause d'une chaîne)
const holdDir = (id) => path.join(config.dataDir, 'cache', 'timeshift', id);

// En-têtes à envoyer avec le flux (Referer, User-Agent) s'ils sont précisés
function headersFor(url) {
  let o = {};
  try { o = JSON.parse((get('SELECT stream_opts FROM items WHERE stream_url = ? AND stream_opts IS NOT NULL LIMIT 1', url) || {}).stream_opts || '{}') || {}; } catch { /* */ }
  return { 'User-Agent': o.ua || BROWSER, ...(o.referer ? { Referer: o.referer } : {}), Accept: '*/*' };
}

// Cette chaîne peut-elle être relayée telle quelle (flux HLS) ?
export function canRelay(url) { return /^https?:\/\/[^\s]+\.m3u8?(\?|$)/i.test(String(url || '')); }

// Ouvre un relais pour une chaîne
export function startRelay(item) {
  const id = crypto.randomBytes(16).toString('hex');
  relays.set(id, { itemId: item.id, url: item.stream_url, hosts: new Set([new URL(item.stream_url).host]), headers: headersFor(item.stream_url), touched: Date.now(), media: new Map(), cache: new Map(), servedSeq: new Map(), hold: false });
  return { id, url: `/api/live/${id}/pl.m3u8?u=${encodeURIComponent(item.stream_url)}` };
}
// Ferme un relais
export function stopRelay(id) { const r = relays.get(id); if (r) dropHold(id, r); relays.delete(id); }
// Un relais sans activité est fermé (en pause, l'enregistrement le garde ouvert jusqu'à 2 h)
setInterval(() => { const now = Date.now(); for (const [k, r] of relays) if (now - r.touched > (r.hold ? HOLD_MAX : IDLE)) stopRelay(k); }, 30000).unref();

// Adresse du réseau local (box, NAS, cette machine) ? Résultat gardé pour la durée du relais.
async function isLocalHost(r, hostname) {
  if (!r.local) r.local = new Map();
  if (r.local.has(hostname)) return r.local.get(hostname);
  const h = hostname.replace(/^\[|\]$/g, '');
  let local;
  if (net.isIP(h)) local = isPrivateIp(h);
  else if (/^(localhost|.*\.local|.*\.lan|.*\.internal|.*\.home\.arpa)$/i.test(h)) local = true;
  else { try { local = (await dns.lookup(h, { all: true })).some((a) => isPrivateIp(a.address)); } catch { local = false; } }
  r.local.set(hostname, local);
  return local;
}
// Types de contenu relayés : vidéo, audio, listes HLS, binaire. Jamais une page ni un script venus d'ailleurs
// (ils seraient servis depuis l'adresse de Venus, avec ses droits).
function safeType(t) {
  const v = String(t || '').split(';')[0].trim().toLowerCase();
  return /^(video|audio)\/[\w.+-]+$|^application\/(octet-stream|mp4|vnd\.apple\.mpegurl|x-mpegurl|mp2t|pkcs7-mime|binary)$|^binary\/octet-stream$/.test(v) ? v : 'application/octet-stream';
}
// Redirection vers le réseau local depuis une chaîne sur Internet : refusée
async function checkFinal(r, res) {
  if (!res.url) return;
  const f = new URL(res.url);
  if (await isLocalHost(r, f.hostname) && !(await isLocalHost(r, new URL(r.url).hostname))) throw new HttpError(403, 'Adresse du réseau local refusée');
}
// Relais et adresse vérifiée (seuls les serveurs annoncés par la chaîne sont suivis)
async function relayOf(id, u) {
  const r = relays.get(id);
  if (!r) throw new HttpError(404, 'Relais expiré');
  let url;
  try { url = new URL(u); } catch { throw new HttpError(400, 'Adresse invalide'); }
  if (!/^https?:$/.test(url.protocol) || !r.hosts.has(url.host)) throw new HttpError(403, 'Serveur non annoncé par la chaîne');
  // Une chaîne sur Internet ne peut pas faire passer le relais vers le réseau local (box, NAS…) :
  // seule une chaîne elle-même locale (tuner, Tvheadend…) y a droit
  if (await isLocalHost(r, url.hostname) && !(await isLocalHost(r, new URL(r.url).hostname))) throw new HttpError(403, 'Adresse du réseau local refusée');
  r.touched = Date.now();
  return { r, url };
}

// Réécrit une liste HLS : chaque adresse (variantes, pistes audio, morceaux, clés, init) repasse par le relais.
export function rewritePlaylist(text, base, id, hosts) {
  const prox = (u, playlist) => {
    let abs; try { abs = new URL(u.trim(), base); } catch { return u; }
    if (!/^https?:$/.test(abs.protocol)) return u;
    hosts.add(abs.host);
    return `/api/live/${id}/${playlist ? 'pl.m3u8' : 'seg'}?u=${encodeURIComponent(abs.href)}`;
  };
  let nextIsPlaylist = false;
  return text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith('#')) {
      if (/^#EXT-X-STREAM-INF/i.test(l)) nextIsPlaylist = true;
      // Pistes audio / sous-titres (listes), images-clés I-frame (listes), clés de chiffrement et init (fichiers)
      return l.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${prox(u, /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/i.test(l))}"`);
    }
    const out = prox(l, nextIsPlaylist || /\.m3u8?(\?|$)/i.test(l));
    nextIsPlaylist = false;
    return out;
  }).join('\n');
}

// ------------------------------------------------------------ listes de morceaux (direct différé)
const SEG_TAG = /^#(EXTINF|EXT-X-PROGRAM-DATE-TIME|EXT-X-DISCONTINUITY$|EXT-X-BYTERANGE|EXT-X-GAP|EXT-X-CUE|EXT-X-DATERANGE|EXT-X-KEY|EXT-X-MAP)/i;
/** Découpe une liste de morceaux : en-tête + morceaux numérotés (avec leurs balises), adresses absolues. */
export function parseMedia(text, base) {
  const lines = text.split(/\r?\n/), head = [], segs = [];
  let seq = 0, tags = [], inSegs = false;
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#')) {
      const m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/i.exec(l); if (m) { seq = Number(m[1]); continue; }
      if (/^#EXT-X-ENDLIST/i.test(l)) continue;
      if (SEG_TAG.test(l) || inSegs) { inSegs = true; tags.push(l.replace(/URI="([^"]+)"/g, (_x, u) => { try { return `URI="${new URL(u, base).href}"`; } catch { return `URI="${u}"`; } })); }
      else if (!/^#EXT-X-DISCONTINUITY-SEQUENCE/i.test(l)) head.push(l);
      continue;
    }
    let abs = l; try { abs = new URL(l, base).href; } catch { /* */ }
    segs.push({ seq: seq + segs.length, tags, uri: abs, dur: Number((/#EXTINF:([\d.]+)/i.exec(tags.join('\n')) || [])[1]) || 0 });
    tags = [];
  }
  const td = Number((/#EXT-X-TARGETDURATION:(\d+)/i.exec(head.join('\n')) || [])[1]) || 6;
  return { head, segs, td };
}
// Liste de lecture HLS des segments gardés en mémoire
function buildMedia(m) {
  const first = m.segs.length ? m.segs[0].seq : 0;
  return [...m.head.filter((l) => !/^#EXT-X-MEDIA-SEQUENCE/i.test(l)), `#EXT-X-MEDIA-SEQUENCE:${first}`, ...m.segs.flatMap((s) => [...s.tags, s.uri])].join('\n') + '\n';
}
// Télécharge un segment de la chaîne
async function fetchMedia(r, key) {
  const res = await fetch(key, { headers: r.headers, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const final = res.url || key; r.hosts.add(new URL(final).host);
  return parseMedia(await res.text(), final);
}
// Fusion : on garde tous les morceaux déjà vus (en pause), on ajoute les nouveaux
function merge(r, key, fresh) {
  const st = r.media.get(key) || { head: fresh.head, segs: [], td: fresh.td };
  st.head = fresh.head; st.td = fresh.td;
  const last = st.segs.length ? st.segs[st.segs.length - 1].seq : -1;
  for (const s of fresh.segs) if (s.seq > last) st.segs.push(s);
  if (!r.hold) st.segs = fresh.segs.slice(); // hors pause : la fenêtre de la chaîne, telle quelle
  // 2 h au plus
  let total = st.segs.reduce((a, s) => a + s.dur, 0);
  while (total > HOLD_MAX / 1000 && st.segs.length > 1) total -= st.segs.shift().dur;
  r.media.set(key, st);
  return st;
}
// En pause : téléchargement des morceaux à venir (un par un), pour pouvoir reprendre plus tard
async function prefetch(id, r) {
  if (r.fetching) return; r.fetching = true;
  try {
    for (const st of r.media.values()) for (const s of st.segs) {
      if (!r.hold || relays.get(id) !== r) return;
      if (s.seq < (r.servedSeq.get(st) ?? -Infinity) - 1 || r.cache.has(s.uri)) continue;
      const file = path.join(holdDir(id), crypto.createHash('sha1').update(s.uri).digest('hex'));
      try {
        const res = await fetch(s.uri, { headers: r.headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        r.cache.set(s.uri, { file, type: res.headers.get('content-type') || 'video/mp2t' });
      } catch { /* morceau perdu : on continue */ }
    }
  } finally { r.fetching = false; }
}
// Met en pause (garde les segments) ou reprend une chaîne
export function holdRelay(id, on) {
  const r = relays.get(id); if (!r) return false;
  r.touched = Date.now();
  if (on && !r.hold) {
    r.hold = true; fs.mkdirSync(holdDir(id), { recursive: true });
    // La chaîne est relue toutes les quelques secondes, même si le navigateur ne demande plus rien
    const tick = async () => {
      for (const key of r.media.keys()) { try { merge(r, key, await fetchMedia(r, key)); } catch { /* réessai au prochain tour */ } }
      void prefetch(id, r);
    };
    r.timer = setInterval(tick, 4000); void tick();
  } else if (!on && r.hold) dropHold(id, r);
  return true;
}
// Libère les segments gardés pendant la pause
function dropHold(id, r) {
  r.hold = false; clearInterval(r.timer); r.timer = null; r.cache = new Map();
  fs.rm(holdDir(id), { recursive: true, force: true }, () => {});
}

// Sert la liste de lecture d'une chaîne relayée
export async function servePlaylistRelay(ctx, id) {
  const { r, url } = await relayOf(id, ctx.url.searchParams.get('u'));
  const key = url.href;
  // Liste de morceaux déjà suivie et en pause : on sert la liste allongée (sans réinterroger la chaîne si on l'a à jour)
  if (r.hold && r.media.has(key)) {
    try { merge(r, key, await fetchMedia(r, key)); } catch { /* on sert ce qu'on a */ }
    return sendPl(ctx, rewritePlaylist(buildMedia(r.media.get(key)), key, id, r.hosts));
  }
  let text, final;
  if (isFtv(url.href) && !/\.ftven\.fr$/i.test(url.hostname)) {
    // France TV (Mayotte La 1ère…) : liste servie avec un jeton frais (celui de la liste publique expire)
    const f = await ftvPlaylist(url.href).catch((e) => { throw new HttpError(502, `Chaîne injoignable (${e.message})`); });
    text = f.text; final = url; for (const h of f.hosts) r.hosts.add(h);
  } else {
    const res = await fetch(url, { headers: r.headers, redirect: 'follow', signal: AbortSignal.timeout(12000) }).catch((e) => { throw new HttpError(502, `Chaîne injoignable (${e.message})`); });
    if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `La chaîne répond ${res.status}`);
    await checkFinal(r, res);
    final = new URL(res.url || url.href); r.hosts.add(final.host);
    text = await res.text();
  }
  if (!/^\s*#EXTM3U/.test(text)) throw new HttpError(502, 'Ce n’est pas un flux HLS');
  if (/#EXTINF/i.test(text)) {
    const st = merge(r, key, parseMedia(text, final.href));
    return sendPl(ctx, rewritePlaylist(buildMedia(st), final.href, id, r.hosts));
  }
  sendPl(ctx, rewritePlaylist(text, final.href, id, r.hosts));
}
// Envoie une liste de lecture HLS
function sendPl(ctx, text) {
  ctx.res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
  ctx.res.end(text);
}

// Sert un segment d'une chaîne relayée
export async function serveSegmentRelay(ctx, id) {
  const { r, url } = await relayOf(id, ctx.url.searchParams.get('u'));
  // Où en est le spectateur (pour savoir quoi garder pendant une pause)
  for (const st of r.media.values()) { const s = st.segs.find((x) => x.uri === url.href); if (s) { r.servedSeq.set(st, Math.max(r.servedSeq.get(st) ?? -1, s.seq)); break; } }
  const cached = r.cache.get(url.href);
  if (cached && fs.existsSync(cached.file)) {
    ctx.res.writeHead(200, { 'Content-Type': safeType(cached.type), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': fs.statSync(cached.file).size });
    return void fs.createReadStream(cached.file).pipe(ctx.res);
  }
  const ctrl = new AbortController();
  ctx.req.on('close', () => ctrl.abort());
  const headers = { ...r.headers, ...(ctx.req.headers.range ? { Range: ctx.req.headers.range } : {}) };
  // Serveur de la chaîne muet : on abandonne au bout de 15 s (le lecteur redemande aussitôt) au lieu de bloquer
  const slow = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal }).catch((e) => { throw new HttpError(502, `Morceau injoignable (${e.message})`); }).finally(() => clearTimeout(slow));
  if (!res.ok && res.status !== 206) throw new HttpError(502, `La chaîne répond ${res.status}`);
  await checkFinal(r, res);
  r.hosts.add(new URL(res.url || url.href).host);
  const h = { 'Content-Type': safeType(res.headers.get('content-type') || 'video/mp2t'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  for (const k of ['content-length', 'content-range', 'accept-ranges']) { const v = res.headers.get(k); if (v) h[k] = v; }
  ctx.res.writeHead(res.status, h);
  if (!res.body) return ctx.res.end();
  Readable.fromWeb(res.body).on('error', () => ctx.res.destroy()).pipe(ctx.res);
}
