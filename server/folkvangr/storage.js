// Fólkvangr · écriture et lecture des pièces sur le disque. Chaque pièce est vérifiée (SHA-1) avant d'être écrite :
// une pièce fausse (pair malveillant ou abîmé) est jetée et redemandée. Les fichiers restent dans le dossier choisi.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BLOCK = 16384;

export class Storage {
  constructor(t, dir) {
    this.t = t; this.dir = path.resolve(dir);
    this.files = t.files.map((f) => { const p = path.resolve(this.dir, f.path); if (!p.startsWith(this.dir + path.sep)) throw new Error('chemin hors du dossier de téléchargement'); return { ...f, abs: p }; });
    this.have = Buffer.alloc(Math.ceil(t.count / 8)); this.count = 0; this.partial = new Map(); this.fds = new Map();
  }
  pieceSize(i) { return i === this.t.count - 1 ? this.t.length - i * this.t.pieceLength || this.t.pieceLength : this.t.pieceLength; }
  blocksOf(i) { return Math.ceil(this.pieceSize(i) / BLOCK); }
  has(i) { return (this.have[i >> 3] & (0x80 >> (i & 7))) !== 0; }
  setHave(i) { if (!this.has(i)) { this.have[i >> 3] |= 0x80 >> (i & 7); this.count++; } }
  get done() { return this.count === this.t.count; }
  get bytesLeft() { let n = 0; for (let i = 0; i < this.t.count; i++) if (!this.has(i)) n += this.pieceSize(i); return n; }
  fd(f, write) {
    let x = this.fds.get(f.abs);
    if (!x || (write && !x.w)) {
      if (x) fs.closeSync(x.fd);
      if (write) { fs.mkdirSync(path.dirname(f.abs), { recursive: true }); if (!fs.existsSync(f.abs)) fs.closeSync(fs.openSync(f.abs, 'w')); }
      x = { fd: fs.openSync(f.abs, write ? 'r+' : 'r'), w: write }; this.fds.set(f.abs, x);
    }
    return x.fd;
  }
  /** Les morceaux de fichiers couverts par [début, fin[ (octets dans le torrent entier). */
  spans(start, end) {
    const out = [];
    for (const f of this.files) { const a = Math.max(start, f.offset), b = Math.min(end, f.offset + f.length); if (a < b) out.push({ f, fileAt: a - f.offset, bufAt: a - start, len: b - a }); }
    return out;
  }
  read(i, begin, len) {
    const start = i * this.t.pieceLength + begin, buf = Buffer.alloc(len); // octets de remplissage (padding) : zéros
    for (const s of this.spans(start, start + len)) { try { fs.readSync(this.fd(s.f, false), buf, s.bufAt, s.len, s.fileAt); } catch { /* fichier absent */ } }
    return buf;
  }
  /** Un bloc reçu ; quand la pièce est complète : vérifiée puis écrite. Renvoie 'ok' | 'mauvaise' | 'partiel'. */
  write(i, begin, data) {
    if (this.has(i)) return 'ok';
    const size = this.pieceSize(i); if (begin + data.length > size) return 'partiel';
    let p = this.partial.get(i); if (!p) { p = { buf: Buffer.alloc(size), got: new Set() }; this.partial.set(i, p); }
    data.copy(p.buf, begin); p.got.add(begin / BLOCK);
    if (p.got.size < this.blocksOf(i)) return 'partiel';
    this.partial.delete(i);
    if (!crypto.createHash('sha1').update(p.buf).digest().equals(this.t.pieces.subarray(i * 20, i * 20 + 20))) return 'mauvaise';
    const start = i * this.t.pieceLength;
    for (const s of this.spans(start, start + size)) fs.writeSync(this.fd(s.f, true), p.buf, s.bufAt, s.len, s.fileAt);
    this.setHave(i);
    return 'ok';
  }
  /** Vérifie ce qui est déjà sur le disque (reprise, ou partage d'un fichier déjà là). */
  verifyAll() {
    for (let i = 0; i < this.t.count; i++) {
      const start = i * this.t.pieceLength, sp = this.spans(start, start + this.pieceSize(i));
      if (!sp.every((s) => fs.existsSync(s.f.abs) && fs.statSync(s.f.abs).size >= s.fileAt + s.len)) continue;
      if (crypto.createHash('sha1').update(this.read(i, 0, this.pieceSize(i))).digest().equals(this.t.pieces.subarray(i * 20, i * 20 + 20))) this.setHave(i);
    }
    return this.count;
  }
  close() { for (const x of this.fds.values()) { try { fs.closeSync(x.fd); } catch { /* */ } } this.fds.clear(); }
  /** Le fichier (un seul) ou le dossier du torrent. */
  get root() { return path.join(this.dir, this.t.files.length === 1 && this.t.files[0].path === this.t.name ? this.t.name : this.t.name); }
}
