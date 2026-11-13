// Fólkvangr · fichiers .torrent et liens magnet (BEP 3, BEP 9). Pur, sauf la création d'un .torrent (lit les fichiers).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decode, encode, str } from './bencode.js';

const sha1 = (b) => crypto.createHash('sha1').update(b).digest();

/** Le dictionnaire « info » (déjà vérifié par son empreinte) → la description du torrent. */
export function fromInfo(info, infoHash, announce = []) {
  const name = str(info['name.utf-8'] || info.name).replace(/[\\/]/g, '_') || infoHash;
  const pieceLength = info['piece length'];
  const pieces = info.pieces;
  if (!(pieceLength > 0) || !Buffer.isBuffer(pieces) || pieces.length % 20) throw new Error('torrent invalide (pièces)');
  let files, offset = 0;
  if (Array.isArray(info.files)) {
    files = info.files.map((f) => {
      const parts = (f['path.utf-8'] || f.path).map(str);
      if (parts.some((p) => !p || p === '..' || p === '.' || p.includes('/') || p.includes('\\') || p.includes('\0'))) throw new Error('torrent refusé : chemin dangereux');
      const x = { path: path.join(name, ...parts), length: f.length, offset }; offset += f.length; return x;
    }).filter((f) => !f.path.split(path.sep).some((p) => p.startsWith('.____padding')));
    offset = info.files.reduce((a, f) => a + f.length, 0);
  } else { files = [{ path: name, length: info.length, offset: 0 }]; offset = info.length; }
  if (name === '..' || name === '.') throw new Error('torrent refusé : nom dangereux');
  const count = pieces.length / 20;
  if (Math.ceil(offset / pieceLength) !== count) throw new Error('torrent invalide (taille et pièces ne correspondent pas)');
  return { infoHash, name, pieceLength, pieces, count, length: offset, files, announce, private: info.private === 1 };
}
/** Un fichier .torrent → description (avec l'empreinte calculée sur le dictionnaire « info » d'origine). */
export function parseTorrent(buf) {
  const top = decode(buf).value;
  if (!top || !top.info) throw new Error('fichier .torrent invalide');
  // L'empreinte se calcule sur les octets exacts du dictionnaire « info »
  const k = buf.indexOf(Buffer.from('4:infod')); if (k < 0) throw new Error('fichier .torrent invalide (info)');
  const { end } = decode(buf, k + 6), infoBuf = buf.subarray(k + 6, end);
  const announce = [...new Set([str(top.announce), ...((top['announce-list'] || []).flat().map(str))].filter((u) => /^(https?|udp):\/\//i.test(u)))];
  // Web seeds (BEP 19) : des serveurs HTTP qui ont les mêmes fichiers (archive.org, miroirs)
  const ul = top['url-list']; const webseeds = [...new Set((Array.isArray(ul) ? ul : ul ? [ul] : []).map(str).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 8);
  return { ...fromInfo(top.info, sha1(infoBuf).toString('hex'), announce), infoBuf, webseeds };
}
/** Un lien magnet → empreinte, nom, traqueurs. */
export function parseMagnet(uri) {
  const u = new URL(uri); if (u.protocol !== 'magnet:') throw new Error('lien magnet invalide');
  const xt = u.searchParams.getAll('xt').find((x) => /^urn:btih:/i.test(x)); if (!xt) throw new Error('lien magnet sans empreinte');
  let h = xt.slice(9);
  if (/^[a-z2-7]{32}$/i.test(h)) h = base32hex(h); // ancienne forme en base 32
  if (!/^[a-f0-9]{40}$/i.test(h)) throw new Error('empreinte du magnet invalide');
  return { infoHash: h.toLowerCase(), name: u.searchParams.get('dn') || h.toLowerCase(), announce: u.searchParams.getAll('tr').filter((x) => /^(https?|udp):\/\//i.test(x)), webseeds: u.searchParams.getAll('ws').filter((x) => /^https?:\/\//i.test(x)).slice(0, 8) };
}
function base32hex(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of s.toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))).toString('hex');
}
/** Vérifie que le dictionnaire « info » reçu d'un pair a bien l'empreinte annoncée. */
export function checkInfo(infoBuf, infoHash) { return sha1(infoBuf).toString('hex') === infoHash; }

/** Crée un .torrent pour un fichier ou un dossier (partage, et tests). */
export function createTorrent(target, { announce = [], pieceLength = 256 * 1024, urlList = [] } = {}) {
  const st = fs.statSync(target), name = path.basename(target), list = [];
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n); const s = fs.statSync(f); if (s.isDirectory()) walk(f, [...rel, n]); else list.push({ file: f, parts: [...rel, n], length: s.size }); } };
  if (st.isDirectory()) walk(target, []); else list.push({ file: target, parts: [], length: st.size });
  const hashes = []; let cur = Buffer.alloc(0);
  for (const f of list) { const data = fs.readFileSync(f.file); let p = 0; while (p < data.length) { const take = Math.min(pieceLength - cur.length, data.length - p); cur = Buffer.concat([cur, data.subarray(p, p + take)]); p += take; if (cur.length === pieceLength) { hashes.push(sha1(cur)); cur = Buffer.alloc(0); } } }
  if (cur.length) hashes.push(sha1(cur));
  const info = st.isDirectory() ? { name, 'piece length': pieceLength, pieces: Buffer.concat(hashes), files: list.map((f) => ({ length: f.length, path: f.parts })) } : { name, 'piece length': pieceLength, pieces: Buffer.concat(hashes), length: st.size };
  return encode({ ...(announce[0] ? { announce: announce[0], 'announce-list': announce.map((a) => [a]) } : {}), ...(urlList.length ? { 'url-list': urlList } : {}), info });
}
export const infoHashOf = (infoBuf) => sha1(infoBuf).toString('hex');
