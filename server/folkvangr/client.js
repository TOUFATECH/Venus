// Fólkvangr · le moteur de téléchargement de Venus (BitTorrent, écrit pour Venus, sans bibliothèque).
// Fichiers .torrent et liens magnet (métadonnées reçues des pairs, vérifiées), traqueurs HTTP et UDP, web seeds
// HTTP (BEP 19 : archive.org, miroirs ; chaque pièce reçue est vérifiée comme celles des pairs), pièces
// vérifiées avant écriture, plusieurs pairs à la fois (pièces les plus rares d'abord, fin accélérée), partage
// limité (ratio ou durée), reprise après redémarrage. Limites : pas encore de DHT (un magnet sans traqueur ne
// trouve pas de pairs), pas de chiffrement de protocole (MSE).
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Wire } from './wire.js';
import { Storage, BLOCK } from './storage.js';
import { announce } from './tracker.js';
import { parseMagnet, parseTorrent, fromInfo, checkInfo } from './metainfo.js';
import { decode } from './bencode.js';

const META_PIECE = 16384;
const now = () => Date.now();

class Torrent {
  constructor(c, rec) {
    this.c = c; this.rec = rec; this.infoHash = rec.infoHash; this.tags = rec.tags || []; this.dir = rec.dir;
    this.meta = null; this.storage = null; this.wires = new Set(); this.known = new Map(); this.trackers = rec.announce || [];
    this.inflight = new Map(); this.avail = null; this.metaParts = new Map(); this.metaSize = 0; this.error = null;
    this.webseeds = (rec.webseeds || []).map((url) => ({ url, busy: 0, fails: 0, until: 0 })); this.wsPieces = new Set();
    this.uploaded = rec.uploaded || 0; this.downloadedNow = 0; this.speed = 0; this.lastBytes = 0; this.nextAnnounce = 0; this.stopped = !!rec.stopped; this.doneAt = rec.doneAt || null;
    if (rec.info) this.setInfo(Buffer.from(rec.info, 'base64'));
  }
  get name() { return this.meta?.name || this.rec.name || this.infoHash; }
  setInfo(infoBuf) {
    const info = decode(infoBuf).value;
    this.meta = { ...fromInfo(info, this.infoHash, this.trackers), infoBuf };
    this.storage = new Storage(this.meta, this.dir);
    this.storage.verifyAll();
    this.avail = new Uint16Array(this.meta.count);
    this.rec.info = infoBuf.toString('base64'); this.rec.name = this.meta.name; if (this.c.torrents.has(this.infoHash)) this.c.save();
    for (const w of this.wires) { if (this.storage.count) w.bitfield(this.storage.have); this.track(w); }
  }
  status() {
    const s = this.storage, done = !!(s && s.done);
    return { id: this.infoHash, tags: this.tags, name: this.name, progress: s ? Math.floor((s.count / this.meta.count) * 100) : 0, done, failed: !!this.error, error: this.error,
      path: s ? path.join(this.dir, this.meta.name) : '', size: this.meta?.length || 0, eta: this.speed && s ? Math.round(s.bytesLeft / this.speed) : null, speed: this.speed, peers: this.wires.size, uploaded: this.uploaded, state: this.stopped ? 'arrêté' : !this.meta ? 'métadonnées' : done ? 'partage' : 'téléchargement' };
  }
  // ----- pairs
  addPeers(list) { for (const p of list) { const k = `${p.ip}:${p.port}`; if (!this.known.has(k) && !this.c.isSelf(p)) this.known.set(k, { ...p, tried: 0, fail: 0 }); } }
  connectMore() {
    if (this.stopped || (this.storage?.done && !this.wantSeed())) return;
    const want = this.c.maxPeers - this.wires.size; if (want <= 0) return;
    const cands = [...this.known.values()].filter((p) => !p.busy && p.fail < 3 && now() - p.tried > 60000).slice(0, want);
    for (const p of cands) {
      p.tried = now(); p.busy = true;
      const sock = net.connect({ host: p.ip, port: p.port }); sock.setTimeout(10000, () => sock.destroy());
      sock.once('connect', () => { sock.setTimeout(0); this.attach(new Wire(sock, { infoHash: this.infoHash, peerId: this.c.peerId }), p); });
      sock.once('error', () => { p.fail++; p.busy = false; });
      sock.once('close', () => { p.busy = false; });
    }
  }
  attach(w, p = null) {
    this.wires.add(w);
    w.on('handshake', () => { if (this.meta && this.storage.count) w.bitfield(this.storage.have); });
    w.on('close', () => { this.wires.delete(w); if (p) p.busy = false; if (w.peerHave && this.avail) for (let i = 0; i < this.meta.count; i++) if (bit(w.peerHave, i)) this.avail[i]--; for (const [k, r] of this.inflight) if (r.w === w) this.inflight.delete(k); });
    w.on('bitfield', (bf) => { w.peerHave = bf; if (this.avail) for (let i = 0; i < this.meta.count; i++) if (bit(bf, i)) this.avail[i]++; this.track(w); });
    w.on('have', (i) => { if (!w.peerHave) w.peerHave = Buffer.alloc(Math.ceil((this.meta?.count || i + 8) / 8)); if (i >> 3 < w.peerHave.length && !bit(w.peerHave, i)) { w.peerHave[i >> 3] |= 0x80 >> (i & 7); if (this.avail && i < this.avail.length) this.avail[i]++; } this.track(w); });
    w.on('unchoke', () => this.fill(w));
    w.on('choke', () => { for (const [k, r] of this.inflight) if (r.w === w) this.inflight.delete(k); w.requests.clear(); });
    w.on('interested', () => { if (this.meta && this.uploadSlots() > 0) w.unchoke(); });
    w.on('request', (i, begin, len) => { if (w.amChoking || !this.storage?.has(i) || len > 2 * BLOCK || !this.wantSeed()) return; const data = this.storage.read(i, begin, len); w.piece(i, begin, data); this.uploaded += data.length; });
    w.on('piece', (i, begin, data) => this.onPiece(w, i, begin, data));
    w.on('extended', () => { if (!this.meta && w.metadataSize && w.ext.ut_metadata) { this.metaSize = w.metadataSize; this.askMeta(w); } if (this.meta) w.sendExtHandshake(this.meta.infoBuf.length); });
    w.on('metadata', (piece, data, total) => { if (this.meta || !total || total > 10 * 1024 * 1024) return; this.metaSize = total; this.metaParts.set(piece, data); this.metaMaybeDone(w); });
    w.on('metadataRequest', (piece) => { if (!this.meta) return; const b = this.meta.infoBuf; w.metadataSend(piece, b.subarray(piece * META_PIECE, (piece + 1) * META_PIECE), b.length); });
  }
  askMeta(w) { const n = Math.ceil(this.metaSize / META_PIECE); for (let k = 0; k < n; k++) if (!this.metaParts.has(k)) w.metadataRequest(k); }
  metaMaybeDone() {
    const n = Math.ceil(this.metaSize / META_PIECE); if (this.metaParts.size < n) return;
    const buf = Buffer.concat([...Array(n).keys()].map((k) => this.metaParts.get(k)));
    if (!checkInfo(buf, this.infoHash)) { this.metaParts.clear(); return; } // métadonnées fausses : on recommence avec d'autres pairs
    try { this.setInfo(buf); } catch (e) { this.error = e.message; }
  }
  track(w) { if (!this.meta || !w.peerHave || this.storage.done) return; for (let i = 0; i < this.meta.count; i++) if (bit(w.peerHave, i) && !this.storage.has(i)) { w.interested(); if (!w.peerChoking) this.fill(w); return; } w.notInterested(); }
  uploadSlots() { return 8 - [...this.wires].filter((x) => !x.amChoking).length; }
  wantSeed() { if (!this.storage?.done) return true; const ratio = this.uploaded / Math.max(1, this.meta.length), hours = (now() - (this.doneAt || now())) / 3600e3; return this.c.seedRatio > 0 && ratio < this.c.seedRatio && hours < this.c.seedHours; }
  /** Garde jusqu'à 12 blocs demandés à ce pair : pièces commencées d'abord, puis les plus rares. */
  fill(w) {
    if (!this.meta || w.peerChoking || !w.peerHave || this.storage.done) return;
    const t = this.meta, s = this.storage, mine = () => [...this.inflight.values()].filter((r) => r.w === w).length;
    const tryPiece = (i) => { for (let b = 0; b < s.blocksOf(i) && mine() < 12; b++) { const k = `${i}:${b * BLOCK}`; if (this.inflight.has(k) || s.partial.get(i)?.got.has(b)) continue; const len = Math.min(BLOCK, s.pieceSize(i) - b * BLOCK); this.inflight.set(k, { w, at: now() }); w.request(i, b * BLOCK, len); } };
    for (const i of s.partial.keys()) { if (mine() >= 12) return; if (bit(w.peerHave, i)) tryPiece(i); }
    const order = [...Array(t.count).keys()].filter((i) => !s.has(i) && !s.partial.has(i) && !this.wsPieces.has(i) && bit(w.peerHave, i)).sort((a, b) => this.avail[a] - this.avail[b] || Math.random() - 0.5);
    for (const i of order) { if (mine() >= 12) return; tryPiece(i); }
    // Fin du téléchargement : on redemande aussi les blocs lents à un autre pair
    if (mine() < 4) for (const [k, r] of this.inflight) { if (mine() >= 12) break; if (r.w !== w && now() - r.at > 5000) { const [i, begin] = k.split(':').map(Number); if (bit(w.peerHave, i)) w.request(i, begin, Math.min(BLOCK, s.pieceSize(i) - begin)); } }
  }
  onPiece(w, i, begin, data) {
    if (!this.storage || i >= this.meta.count) return;
    this.inflight.delete(`${i}:${begin}`); w.requests.delete(`${i}:${begin}`); this.downloadedNow += data.length;
    const r = this.storage.write(i, begin, data);
    if (r === 'mauvaise') { w.bad = (w.bad || 0) + 1; if (w.bad > 3) w.destroy(); }
    if (r === 'ok' && this.storage.has(i)) { for (const x of this.wires) x.have(i); if (this.storage.done) this.finished(); }
    this.fill(w);
  }
  // ----- web seeds (BEP 19) : une pièce entière demandée en HTTP (Range), fichier par fichier, puis vérifiée
  wsUrl(ws, f) {
    const enc = (p) => p.split(path.sep).map(encodeURIComponent).join('/');
    if (this.meta.files.length === 1 && f.path === this.meta.name) return ws.url.endsWith('/') ? ws.url + encodeURIComponent(this.meta.name) : ws.url;
    return (ws.url.endsWith('/') ? ws.url : `${ws.url}/`) + enc(f.path);
  }
  webSeed() {
    if (!this.meta || this.stopped || this.storage.done || !this.webseeds.length) return;
    const s = this.storage;
    for (const ws of this.webseeds) {
      while (ws.busy < 2 && ws.until <= now()) {
        // Les pièces que les pairs n'ont pas d'abord, puis les autres ; jamais une pièce déjà en cours
        const busyPeers = new Set([...this.inflight.keys()].map((k) => Number(k.split(':')[0])));
        let i = -1, best = Infinity;
        for (let k = 0; k < this.meta.count; k++) if (!s.has(k) && !this.wsPieces.has(k) && !busyPeers.has(k) && !s.partial.has(k) && this.avail[k] < best) { best = this.avail[k]; i = k; if (!best) break; }
        if (i < 0) return;
        this.wsPieces.add(i); ws.busy++;
        void this.wsFetch(ws, i).then((ok) => { ws.busy--; this.wsPieces.delete(i); if (ok) { ws.fails = 0; } else if (++ws.fails >= 5) { ws.until = now() + 10 * 60e3; ws.fails = 0; } if (!this.stopped) this.webSeed(); });
      }
    }
  }
  async wsFetch(ws, i) {
    const s = this.storage, size = s.pieceSize(i), start = i * this.meta.pieceLength, buf = Buffer.alloc(size);
    try {
      for (const sp of s.spans(start, start + size)) {
        const r = await this.c.fetcher(this.wsUrl(ws, sp.f), { headers: { Range: `bytes=${sp.fileAt}-${sp.fileAt + sp.len - 1}` }, signal: AbortSignal.timeout(120000) });
        if (r.status !== 206 && !(r.status === 200 && sp.fileAt === 0 && sp.len === sp.f.length)) return false; // le serveur doit respecter la plage
        const b = Buffer.from(await r.arrayBuffer()); if (b.length !== sp.len) return false;
        b.copy(buf, sp.bufAt);
      }
    } catch { return false; }
    if (this.stopped || s.has(i)) return true;
    let res = 'partiel';
    for (let b = 0; b < size; b += BLOCK) res = s.write(i, b, buf.subarray(b, Math.min(size, b + BLOCK)));
    this.downloadedNow += size;
    if (res !== 'ok' || !s.has(i)) return false; // pièce fausse : le serveur est noté en échec
    for (const x of this.wires) x.have(i);
    if (s.done) this.finished();
    return true;
  }
  finished() { if (this.doneAt) return; this.doneAt = now(); this.rec.doneAt = this.doneAt; this.c.save(); this.storage.close(); for (const w of this.wires) w.notInterested(); void this.announceAll('completed'); this.c.onDone?.(this.status()); }
  async announceAll(event) {
    const s = this.storage, a = { infoHash: this.infoHash, peerId: this.c.peerId, port: this.c.port, uploaded: this.uploaded, downloaded: this.downloadedNow, left: s ? s.bytesLeft : 1 << 30, event };
    let interval = 1800;
    await Promise.all(this.trackers.map(async (u) => { try { const r = await announce(u, a); this.addPeers(r.peers); interval = Math.min(interval, Math.max(60, r.interval)); } catch { /* traqueur indisponible */ } }));
    this.nextAnnounce = now() + interval * 1000;
  }
  tick() {
    if (this.stopped) return;
    const b = this.downloadedNow; this.speed = Math.round((b - this.lastBytes) / 5); this.lastBytes = b;
    for (const [k, r] of this.inflight) if (now() - r.at > 30000) { this.inflight.delete(k); r.w.requests.delete(k); }
    if (now() >= this.nextAnnounce) void this.announceAll(this.nextAnnounce ? undefined : 'started');
    if (!this.meta) for (const w of this.wires) if (w.metadataSize && w.ext.ut_metadata) this.askMeta(w);
    if (this.storage?.done && !this.wantSeed()) { for (const w of this.wires) w.destroy(); return; }
    // Partage : les pairs intéressés qui nous envoient le plus sont servis d'abord
    if (this.meta) { const l = [...this.wires].filter((w) => w.peerInterested).sort((a, b) => b.downloaded - a.downloaded); l.forEach((w, k) => (k < 8 && this.wantSeed() ? w.unchoke() : w.choke())); }
    for (const w of this.wires) this.fill(w);
    this.webSeed();
    this.connectMore();
    this.rec.uploaded = this.uploaded;
  }
  stop() { this.stopped = true; for (const w of this.wires) w.destroy(); this.storage?.close(); void this.announceAll('stopped'); }
}
const bit = (bf, i) => (bf[i >> 3] & (0x80 >> (i & 7))) !== 0;

/** Le moteur : une instance par Venus. store = { load(): records[], save(records) }. */
export class Folkvangr {
  constructor({ port = 51413, store, seedRatio = 1, seedHours = 72, maxPeers = 40, fetcher = fetch, host = '0.0.0.0' } = {}) {
    this.port = port; this.store = store; this.seedRatio = seedRatio; this.seedHours = seedHours; this.maxPeers = maxPeers; this.fetcher = fetcher; this.host = host;
    this.peerId = Buffer.concat([Buffer.from('-VN0100-'), crypto.randomBytes(12)]);
    this.torrents = new Map(); this.selfAddrs = new Set();
  }
  async start() {
    this.server = net.createServer((sock) => this.incoming(sock));
    await new Promise((ok, ko) => { this.server.once('error', ko); this.server.listen(this.port, this.host, () => { this.server.off('error', ko); ok(); }); });
    this.port = this.server.address().port; this.selfAddrs.add(`127.0.0.1:${this.port}`);
    for (const rec of this.store?.load() || []) { try { this.torrents.set(rec.infoHash, new Torrent(this, rec)); } catch (e) { console.warn('[fólkvangr]', rec.name, e.message); } }
    this.timer = setInterval(() => { for (const t of this.torrents.values()) t.tick(); }, 5000); this.timer.unref?.();
    for (const t of this.torrents.values()) t.tick();
    return this;
  }
  isSelf(p) { return this.selfAddrs.has(`${p.ip}:${p.port}`); }
  save() { this.store?.save([...this.torrents.values()].map((t) => t.rec)); }
  incoming(sock) {
    let buf = Buffer.alloc(0);
    const pre = (d) => {
      buf = Buffer.concat([buf, d]); if (buf.length < 48) return;
      sock.off('data', pre);
      const t = this.torrents.get(buf.subarray(28, 48).toString('hex')); if (!t || t.stopped) return sock.destroy();
      const w = new Wire(sock, { infoHash: t.infoHash, peerId: this.peerId, incoming: true }); t.attach(w); w.onData(buf);
    };
    sock.on('data', pre); sock.on('error', () => {}); sock.setTimeout(30000, () => sock.destroy());
  }
  /** Ajoute un lien (magnet, adresse d'un .torrent, ou .torrent en mémoire) ; renvoie l'empreinte. */
  async add(link, { tags = [], dir, peers = [] } = {}) {
    let meta = null, magnet = null;
    if (Buffer.isBuffer(link)) meta = parseTorrent(link);
    else if (/^magnet:/i.test(link)) magnet = parseMagnet(link);
    else if (/^https?:\/\//i.test(link)) {
      const r = await this.fetcher(link, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) return this.add(/^magnet:/i.test(loc) ? loc : new URL(loc, link).toString(), { tags, dir, peers });
      if (!r.ok) throw new Error(`fichier .torrent introuvable (${r.status})`);
      const b = Buffer.from(await r.arrayBuffer()); if (b.length > 20 * 1024 * 1024) throw new Error('fichier .torrent trop gros');
      meta = parseTorrent(b);
    } else throw new Error('lien de téléchargement non reconnu');
    const infoHash = meta ? meta.infoHash : magnet.infoHash;
    let t = this.torrents.get(infoHash);
    if (!t) {
      fs.mkdirSync(dir, { recursive: true });
      t = new Torrent(this, { infoHash, tags, dir, name: meta?.name || magnet.name, announce: meta ? meta.announce : magnet.announce, webseeds: meta ? meta.webseeds : magnet.webseeds, added: now(), ...(meta ? { info: meta.infoBuf.toString('base64') } : {}) });
      this.torrents.set(infoHash, t); this.save();
    } else { t.tags = [...new Set([...t.tags, ...tags])]; t.rec.tags = t.tags; t.stopped = false; this.save(); }
    t.addPeers(peers); t.tick();
    return infoHash;
  }
  list() { return [...this.torrents.values()].map((t) => t.status()); }
  remove(id, { files = false } = {}) {
    const t = this.torrents.get(id); if (!t) return false;
    t.stop(); this.torrents.delete(id); this.save();
    if (files && t.meta) fs.rmSync(path.join(t.dir, t.meta.name), { recursive: true, force: true });
    return true;
  }
  stop() { clearInterval(this.timer); for (const t of this.torrents.values()) t.stop(); this.server?.close(); }
}
