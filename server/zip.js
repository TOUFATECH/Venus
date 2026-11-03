// Lecture des archives ZIP (livres EPUB, bandes dessinées CBZ) sans dépendance : répertoire central,
// puis décompression « deflate » de l'entrée demandée. Les archives de plus de 4 Go (ZIP64) ne sont pas prises en charge.
import fs from 'node:fs';
import zlib from 'node:zlib';

const cache = new Map(); // fichier → { mtime, entries }

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}

export function zipEntries(file) {
  const st = fs.statSync(file);
  const c = cache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.entries;
  const fd = fs.openSync(file, 'r');
  try {
    const tailLen = Math.min(st.size, 66000);
    const tail = readAt(fd, st.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('archive ZIP illisible');
    const count = tail.readUInt16LE(eocd + 10);
    const size = tail.readUInt32LE(eocd + 12);
    const offset = tail.readUInt32LE(eocd + 16);
    if (offset === 0xffffffff) throw new Error('archive trop grande (ZIP64)');
    const dir = readAt(fd, offset, size);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= dir.length; i++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) break;
      const method = dir.readUInt16LE(p + 10), comp = dir.readUInt32LE(p + 20), raw = dir.readUInt32LE(p + 24);
      const nl = dir.readUInt16LE(p + 28), xl = dir.readUInt16LE(p + 30), cl = dir.readUInt16LE(p + 32), local = dir.readUInt32LE(p + 42);
      const name = dir.toString('utf8', p + 46, p + 46 + nl);
      if (!name.endsWith('/')) entries.set(name, { name, method, comp, raw, local });
      p += 46 + nl + xl + cl;
    }
    cache.set(file, { mtime: st.mtimeMs, entries });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return entries;
  } finally { fs.closeSync(fd); }
}

export function zipRead(file, name, maxSize = 60e6) {
  const e = zipEntries(file).get(name);
  if (!e) return null;
  if (e.raw > maxSize || e.comp > maxSize) throw new Error('fichier trop gros dans l’archive');
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, e.local, 30);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('entrée ZIP invalide');
    const start = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = readAt(fd, start, e.comp);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: maxSize });
    throw new Error(`compression ${e.method} non prise en charge`);
  } finally { fs.closeSync(fd); }
}
