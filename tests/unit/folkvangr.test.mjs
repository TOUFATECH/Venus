// Fólkvangr : vrais échanges BitTorrent sur la machine (traqueur HTTP de test, un pair qui partage, un qui télécharge,
// puis un lien magnet dont les métadonnées viennent des pairs). Fichier reçu identique octet pour octet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Folkvangr } from '../../server/folkvangr/client.js';
import { createTorrent, parseTorrent, parseMagnet } from '../../server/folkvangr/metainfo.js';
import { decode, encode } from '../../server/folkvangr/bencode.js';
import { compactPeers } from '../../server/folkvangr/tracker.js';

test('bencode, .torrent, magnet, pairs compacts', () => {
  const x = { a: 1, b: Buffer.from('xy'), l: [1, Buffer.from('z')] };
  assert.deepEqual(decode(encode(x)).value, x);
  assert.throws(() => decode(Buffer.from('5:ab')), /coupée/);
  const m = parseMagnet('magnet:?xt=urn:btih:' + 'ab'.repeat(20) + '&dn=Film&tr=udp%3A%2F%2Ftracker.example%3A80&tr=javascript:alert(1)');
  assert.equal(m.infoHash, 'ab'.repeat(20)); assert.deepEqual(m.announce, ['udp://tracker.example:80']);
  assert.deepEqual(compactPeers(Buffer.from([127, 0, 0, 1, 0x1a, 0xe1])), [{ ip: '127.0.0.1', port: 6881 }]);
  // Un .torrent avec « .. » dans un chemin est refusé
  const bad = encode({ info: { name: 'x', 'piece length': 16384, pieces: Buffer.alloc(20), files: [{ length: 1, path: ['..', 'etc'] }] } });
  assert.throws(() => parseTorrent(bad), /chemin dangereux/);
});

test('un pair partage, un autre télécharge (.torrent puis magnet) : fichiers identiques', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folk-'));
  const peers = new Map();
  const tracker = http.createServer((req, res) => {
    const raw = req.url.split('?')[1].split('&'), q = Object.fromEntries(raw.map((x) => x.split('=')));
    const hash = Buffer.from(q.info_hash.replace(/%([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("hex");
    const l = peers.get(hash) || []; if (!l.includes(Number(q.port))) l.push(Number(q.port)); peers.set(hash, l);
    const c = Buffer.concat(l.filter((p) => p !== Number(q.port)).map((p) => { const b = Buffer.from([127, 0, 0, 1, 0, 0]); b.writeUInt16BE(p, 4); return b; }));
    res.end(encode({ interval: 60, peers: c }));
  });
  await new Promise((r) => tracker.listen(0, '127.0.0.1', r));
  const ann = `http://127.0.0.1:${tracker.address().port}/announce`;
  // Un « film » de 3 Mo et un dossier de deux fichiers
  const src = path.join(tmp, 'seed'); fs.mkdirSync(path.join(src, 'Album'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Film.2024.mkv'), crypto.randomBytes(3 * 1024 * 1024 + 123));
  fs.writeFileSync(path.join(src, 'Album', '01.flac'), crypto.randomBytes(700000)); fs.writeFileSync(path.join(src, 'Album', '02.flac'), crypto.randomBytes(500001));
  const tFilm = createTorrent(path.join(src, 'Film.2024.mkv'), { announce: [ann], pieceLength: 256 * 1024 });
  const tAlbum = createTorrent(path.join(src, 'Album'), { announce: [ann], pieceLength: 64 * 1024 });
  const A = await new Folkvangr({ port: 0, host: '127.0.0.1' }).start(), B = await new Folkvangr({ port: 0, host: '127.0.0.1' }).start(), C = await new Folkvangr({ port: 0, host: '127.0.0.1' }).start();
  try {
    await A.add(tFilm, { dir: src, tags: ['seed'] }); await A.add(tAlbum, { dir: src });
    assert.ok(A.list().every((t) => t.done), 'le pair qui partage a tout (vérifié sur le disque)');
    const h = await B.add(tFilm, { dir: path.join(tmp, 'b'), tags: ['venus-1'] });
    const ha = await B.add(tAlbum, { dir: path.join(tmp, 'b') });
    const wait = async (cl, id) => { for (let k = 0; k < 200; k++) { const t = cl.list().find((x) => x.id === id); if (t?.done) return t; await new Promise((r) => setTimeout(r, 200)); } throw new Error(`pas fini : ${JSON.stringify(cl.list().find((x) => x.id === id))}`); };
    const st = await wait(B, h); await wait(B, ha);
    assert.equal(st.tags[0], 'venus-1'); assert.equal(st.path, path.join(tmp, 'b', 'Film.2024.mkv'));
    assert.ok(fs.readFileSync(path.join(tmp, 'b', 'Film.2024.mkv')).equals(fs.readFileSync(path.join(src, 'Film.2024.mkv'))));
    for (const f of ['01.flac', '02.flac']) assert.ok(fs.readFileSync(path.join(tmp, 'b', 'Album', f)).equals(fs.readFileSync(path.join(src, 'Album', f))));
    // Magnet : les métadonnées arrivent des pairs (vérifiées par leur empreinte), puis le fichier
    const mag = `magnet:?xt=urn:btih:${parseTorrent(tFilm).infoHash}&dn=Film&tr=${encodeURIComponent(ann)}`;
    const hm = await C.add(mag, { dir: path.join(tmp, 'c') });
    await wait(C, hm);
    assert.ok(fs.readFileSync(path.join(tmp, 'c', 'Film.2024.mkv')).equals(fs.readFileSync(path.join(src, 'Film.2024.mkv'))));
    assert.ok(A.list().find((t) => t.id === h).uploaded > 0, 'le partage compte ce qui est envoyé');
    assert.ok(C.remove(hm, { files: true })); assert.ok(!fs.existsSync(path.join(tmp, 'c', 'Film.2024.mkv')));
  } finally { A.stop(); B.stop(); C.stop(); tracker.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('web seeds (BEP 19) : sans aucun pair, les pièces arrivent en HTTP (plages), vérifiées ; un serveur menteur est écarté', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folk-ws-'));
  const src = path.join(tmp, 'pub'); fs.mkdirSync(path.join(src, 'DomainePublic'), { recursive: true });
  fs.writeFileSync(path.join(src, 'DomainePublic', 'film.mp4'), crypto.randomBytes(1024 * 1024 + 77));
  fs.writeFileSync(path.join(src, 'DomainePublic', 'film.srt'), crypto.randomBytes(40000));
  let menteur = false, ranges = 0;
  const srv = http.createServer((req, res) => {
    const f = path.join(src, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/download\//, '')));
    if (!f.startsWith(src) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    const data = fs.readFileSync(f), m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (!m) { res.end(data); return; }
    ranges++;
    const part = Buffer.from(data.subarray(Number(m[1]), Number(m[2]) + 1)); if (menteur) part.fill(7);
    res.writeHead(206, { 'Content-Range': `bytes ${m[1]}-${m[2]}/${data.length}`, 'Content-Length': part.length }); res.end(part);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const ws = `http://127.0.0.1:${srv.address().port}/download/`;
  const tor = createTorrent(path.join(src, 'DomainePublic'), { pieceLength: 64 * 1024, urlList: [ws] });
  assert.deepEqual(parseTorrent(tor).webseeds, [ws]);
  assert.deepEqual(parseMagnet(`magnet:?xt=urn:btih:${'a'.repeat(40)}&ws=${encodeURIComponent(ws)}&ws=ftp://x`).webseeds, [ws]);
  const D = await new Folkvangr({ port: 0, host: '127.0.0.1' }).start();
  try {
    const h = await D.add(tor, { dir: path.join(tmp, 'd') });
    let st; for (let k = 0; k < 150 && !(st = D.list().find((x) => x.id === h)).done; k++) { await new Promise((r) => setTimeout(r, 200)); D.torrents.get(h).webSeed(); }
    assert.ok(st.done, `pas fini : ${JSON.stringify(st)}`); assert.ok(ranges > 10, 'téléchargé par plages HTTP');
    for (const f of ['film.mp4', 'film.srt']) assert.ok(fs.readFileSync(path.join(tmp, 'd', 'DomainePublic', f)).equals(fs.readFileSync(path.join(src, 'DomainePublic', f))));
    D.remove(h, { files: true });
    // Serveur qui renvoie de fausses données : aucune pièce acceptée, le serveur est mis de côté
    menteur = true;
    const h2 = await D.add(tor, { dir: path.join(tmp, 'e') });
    const t2 = D.torrents.get(h2);
    for (let k = 0; k < 40 && t2.webseeds[0].until === 0; k++) { await new Promise((r) => setTimeout(r, 100)); t2.webSeed(); }
    assert.equal(t2.storage.count, 0, 'aucune pièce fausse écrite'); assert.ok(t2.webseeds[0].until > Date.now(), 'serveur menteur écarté 10 min');
  } finally { D.stop(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
