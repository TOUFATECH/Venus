// Fólkvangr · bencode (format des fichiers .torrent et des messages BitTorrent). Pur.
// Les chaînes restent des Buffer (les noms et les empreintes ne sont pas forcément de l'UTF-8).

export function decode(buf, start = 0) {
  let i = start;
  const next = () => {
    const c = buf[i];
    if (c === 0x69) { // i<nombre>e
      const e = buf.indexOf(0x65, i); const n = Number(buf.toString('latin1', i + 1, e)); i = e + 1;
      if (!Number.isFinite(n)) throw new Error('bencode : nombre invalide'); return n;
    }
    if (c === 0x6c) { i++; const l = []; while (buf[i] !== 0x65) { if (i >= buf.length) throw new Error('bencode : liste coupée'); l.push(next()); } i++; return l; }
    if (c === 0x64) { i++; const d = {}; while (buf[i] !== 0x65) { if (i >= buf.length) throw new Error('bencode : dictionnaire coupé'); const k = next(); d[k.toString('latin1')] = next(); } i++; return d; }
    if (c >= 0x30 && c <= 0x39) {
      const colon = buf.indexOf(0x3a, i); const len = Number(buf.toString('latin1', i, colon));
      if (!(len >= 0) || colon + 1 + len > buf.length) throw new Error('bencode : chaîne coupée');
      const s = buf.subarray(colon + 1, colon + 1 + len); i = colon + 1 + len; return s;
    }
    throw new Error(`bencode : octet inattendu (${c})`);
  };
  const value = next();
  return { value, end: i };
}
export const decodeAll = (buf) => decode(buf).value;

export function encode(v) {
  const parts = [];
  const go = (x) => {
    if (Buffer.isBuffer(x)) { parts.push(Buffer.from(`${x.length}:`), x); return; }
    if (typeof x === 'string') { const b = Buffer.from(x, 'utf8'); parts.push(Buffer.from(`${b.length}:`), b); return; }
    if (typeof x === 'number') { parts.push(Buffer.from(`i${Math.trunc(x)}e`)); return; }
    if (Array.isArray(x)) { parts.push(Buffer.from('l')); x.forEach(go); parts.push(Buffer.from('e')); return; }
    if (x && typeof x === 'object') {
      parts.push(Buffer.from('d'));
      for (const k of Object.keys(x).filter((k) => x[k] !== undefined).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) { go(Buffer.from(k)); go(x[k]); }
      parts.push(Buffer.from('e')); return;
    }
    throw new Error('bencode : valeur non encodable');
  };
  go(v);
  return Buffer.concat(parts);
}
/** Le texte d'une valeur bencode (Buffer → chaîne UTF-8). */
export const str = (b) => (Buffer.isBuffer(b) ? b.toString('utf8') : b == null ? '' : String(b));
