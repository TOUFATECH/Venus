// Fólkvangr · protocole entre pairs (BEP 3), extensions (BEP 10) et métadonnées d'un magnet (ut_metadata, BEP 9).
import { EventEmitter } from 'node:events';
import { decode, encode } from './bencode.js';

const PSTR = Buffer.from('BitTorrent protocol');
const RESERVED = Buffer.from([0, 0, 0, 0, 0, 0x10, 0, 0]); // extensions BEP 10
export const MSG = { choke: 0, unchoke: 1, interested: 2, notInterested: 3, have: 4, bitfield: 5, request: 6, piece: 7, cancel: 8, extended: 20 };
const MAX_MSG = 2 * 1024 * 1024; // une pièce de 16 Ko + marge ; au-delà : pair fautif

export class Wire extends EventEmitter {
  constructor(sock, { infoHash, peerId, incoming = false }) {
    super();
    this.sock = sock; this.infoHash = Buffer.from(infoHash, 'hex'); this.peerId = peerId; this.incoming = incoming;
    this.buf = Buffer.alloc(0); this.shook = false; this.closed = false;
    this.amChoking = true; this.amInterested = false; this.peerChoking = true; this.peerInterested = false;
    this.peerHave = null; this.ext = {}; this.metadataSize = 0; this.requests = new Map(); this.downloaded = 0; this.uploaded = 0;
    sock.setNoDelay?.(true);
    sock.on('data', (d) => this.onData(d));
    sock.on('error', () => this.destroy());
    sock.on('close', () => this.destroy());
    sock.setTimeout?.(120000, () => this.destroy());
    if (!incoming) this.handshake();
  }
  handshake() { this.sock.write(Buffer.concat([Buffer.from([PSTR.length]), PSTR, RESERVED, this.infoHash, this.peerId])); }
  destroy() { if (this.closed) return; this.closed = true; try { this.sock.destroy(); } catch { /* */ } this.emit('close'); }
  send(id, payload = Buffer.alloc(0)) { if (this.closed) return; const h = Buffer.alloc(5); h.writeUInt32BE(payload.length + 1); h[4] = id; this.sock.write(Buffer.concat([h, payload])); }
  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (!this.shook) {
      if (this.buf.length < 68) return;
      if (this.buf[0] !== 19 || !this.buf.subarray(1, 20).equals(PSTR)) return this.destroy();
      const hash = this.buf.subarray(28, 48);
      if (!hash.equals(this.infoHash)) return this.destroy();
      this.peerExt = (this.buf[25] & 0x10) !== 0; this.remoteId = this.buf.subarray(48, 68); this.buf = this.buf.subarray(68); this.shook = true;
      if (this.incoming) this.handshake();
      if (this.peerExt) this.sendExtHandshake();
      this.emit('handshake');
    }
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > MAX_MSG) return this.destroy();
      if (this.buf.length < 4 + len) return;
      const m = this.buf.subarray(4, 4 + len); this.buf = this.buf.subarray(4 + len);
      if (!len) continue; // maintien de connexion
      try { this.onMessage(m[0], m.subarray(1)); } catch { return this.destroy(); }
    }
  }
  onMessage(id, p) {
    switch (id) {
      case MSG.choke: this.peerChoking = true; this.emit('choke'); break;
      case MSG.unchoke: this.peerChoking = false; this.emit('unchoke'); break;
      case MSG.interested: this.peerInterested = true; this.emit('interested'); break;
      case MSG.notInterested: this.peerInterested = false; break;
      case MSG.have: this.emit('have', p.readUInt32BE(0)); break;
      case MSG.bitfield: this.emit('bitfield', Buffer.from(p)); break;
      case MSG.request: this.emit('request', p.readUInt32BE(0), p.readUInt32BE(4), p.readUInt32BE(8)); break;
      case MSG.piece: this.downloaded += p.length - 8; this.emit('piece', p.readUInt32BE(0), p.readUInt32BE(4), Buffer.from(p.subarray(8))); break;
      case MSG.cancel: break;
      case MSG.extended: this.onExtended(p[0], p.subarray(1)); break;
      default: break;
    }
  }
  // ----- BEP 10 / BEP 9
  sendExtHandshake(metadataSize) { this.send(MSG.extended, Buffer.concat([Buffer.from([0]), encode({ m: { ut_metadata: 1 }, v: 'Venus Folkvangr 1', ...(metadataSize ? { metadata_size: metadataSize } : {}) })])); }
  onExtended(eid, p) {
    if (eid === 0) { const d = decode(p).value; this.ext = d.m || {}; this.metadataSize = d.metadata_size || 0; this.emit('extended'); return; }
    if (eid === 1) { // nos messages ut_metadata (id 1 annoncé par nous)
      const { value, end } = decode(p);
      if (value.msg_type === 0) this.emit('metadataRequest', value.piece);
      else if (value.msg_type === 1) this.emit('metadata', value.piece, Buffer.from(p.subarray(end)), value.total_size);
      else if (value.msg_type === 2) this.emit('metadataReject', value.piece);
    }
  }
  metadataRequest(piece) { if (this.ext.ut_metadata) this.send(MSG.extended, Buffer.concat([Buffer.from([this.ext.ut_metadata]), encode({ msg_type: 0, piece })])); }
  metadataSend(piece, data, total) { if (this.ext.ut_metadata) this.send(MSG.extended, Buffer.concat([Buffer.from([this.ext.ut_metadata]), encode({ msg_type: 1, piece, total_size: total }), data])); }
  // ----- messages courants
  interested() { if (!this.amInterested) { this.amInterested = true; this.send(MSG.interested); } }
  notInterested() { if (this.amInterested) { this.amInterested = false; this.send(MSG.notInterested); } }
  unchoke() { if (this.amChoking) { this.amChoking = false; this.send(MSG.unchoke); } }
  choke() { if (!this.amChoking) { this.amChoking = true; this.send(MSG.choke); } }
  have(i) { const b = Buffer.alloc(4); b.writeUInt32BE(i); this.send(MSG.have, b); }
  bitfield(bf) { this.send(MSG.bitfield, bf); }
  request(i, begin, len) { const b = Buffer.alloc(12); b.writeUInt32BE(i); b.writeUInt32BE(begin, 4); b.writeUInt32BE(len, 8); this.requests.set(`${i}:${begin}`, Date.now()); this.send(MSG.request, b); }
  piece(i, begin, data) { const h = Buffer.alloc(8); h.writeUInt32BE(i); h.writeUInt32BE(begin, 4); this.uploaded += data.length; this.send(MSG.piece, Buffer.concat([h, data])); }
}
