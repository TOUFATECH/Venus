// Musique, photos et livres : bibliothèques de type « music », « photos » et « books ».
//  - Musique : étiquettes des fichiers (titre, artiste, album, n° de piste, disque, année, genre), pochette
//    (cover.jpg / folder.jpg, sinon celle intégrée au fichier), paroles (.lrc à côté du fichier ou intégrées).
//  - Photos : rangées par dossier (un dossier = un album), vignettes faites par le serveur.
//  - Livres : EPUB, PDF, CBZ (bandes dessinées) ; livres audio (un dossier de fichiers audio, ou un .m4b).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run, tx } from './db.js';
import { ffprobe } from './probe.js';
import { zipEntries, zipRead } from './zip.js';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.wma', '.alac', '.aiff', '.aif', '.ape', '.wv', '.m4b']);
export const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.bmp', '.tif', '.tiff']);
export const BOOK_EXT = new Set(['.epub', '.pdf', '.cbz']);
const SKIP = /^(\.|@eaDir$|#recycle$|\$RECYCLE|System Volume Information$|lost\+found$)/i;
const imagesDir = path.join(config.dataDir, 'images');

function walk(dir, exts, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, exts, out, depth + 1); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!exts.has(ext)) continue;
    try { const st = fs.statSync(full); if (st.size > 1024) out.push({ path: full, size: st.size, mtime: Math.floor(st.mtimeMs), ext }); } catch { /* */ }
  }
  return out;
}

const lower = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
const num = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return Number.isFinite(n) ? n : null; };
const cleanName = (s) => s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

// Pochette d'un album : image du dossier, sinon extraite du fichier (une fois par dossier)
function albumArt(dir, file) {
  for (const n of ['cover', 'folder', 'front', 'album', 'Cover', 'Folder', 'Front', 'AlbumArt']) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const f = path.join(dir, n + ext);
      if (fs.existsSync(f)) return copyImage(f);
    }
  }
  const name = `m_${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 16)}.jpg`;
  const out = path.join(imagesDir, name);
  if (fs.existsSync(out)) return Promise.resolve(name);
  return new Promise((resolve) => execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-frames:v', '1', '-vf', "scale='min(600,iw)':-2", '-y', out], { timeout: 20000 },
    (err) => resolve(!err && fs.existsSync(out) ? name : null)));
}
function copyImage(src) {
  try {
    const st = fs.statSync(src);
    const name = `l_${crypto.createHash('sha1').update(src + st.mtimeMs).digest('hex').slice(0, 16)}${path.extname(src).toLowerCase()}`;
    const dest = path.join(imagesDir, name);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    return Promise.resolve(name);
  } catch { return Promise.resolve(null); }
}

async function audioTags(file) {
  try {
    const d = await ffprobe(file, [], 30000);
    const f = d.format || {};
    const a = (d.streams || []).find((s) => s.codec_type === 'audio') || {};
    return { tags: { ...lower(a.tags), ...lower(f.tags) }, duration: Number(f.duration) || 0, codec: a.codec_name || '', bitrate: Number(f.bit_rate) || 0, chapters: (d.chapters || []).length };
  } catch { return { tags: {}, duration: 0, codec: '', bitrate: 0 }; }
}

// ------------------------------------------------------------------ analyse des bibliothèques
export async function scanMediaLibrary(lib, onFile = () => {}) {
  const exts = lib.type === 'music' ? AUDIO_EXT : lib.type === 'photos' ? PHOTO_EXT : new Set([...BOOK_EXT, ...AUDIO_EXT]);
  const files = walk(lib.path, exts);
  const known = new Map(all('SELECT id, type, path, size, mtime FROM items WHERE library_id = ? AND path IS NOT NULL', lib.id).map((r) => [r.path, r]));
  if (!files.length && known.size) { console.warn(`[scan] ${lib.path} est vide : rien n'est supprimé`); return []; }
  const seen = new Set(files.map((f) => f.path));
  const added = [];
  // Livres audio : un dossier de fichiers audio (dans une bibliothèque de livres) devient un seul livre
  const bookDirs = new Set(lib.type === 'books' ? files.filter((f) => AUDIO_EXT.has(f.ext) && f.ext !== '.m4b').map((f) => path.dirname(f.path)) : []);
  for (const d of bookDirs) seen.add(d);
  const removed = [...known.values()].filter((r) => !seen.has(r.path));
  if (removed.length) tx(() => removed.forEach((r) => run('DELETE FROM items WHERE id = ?', r.id)));
  const rel = (p) => path.relative(lib.path, p);

  for (const f of files) {
    const k = known.get(f.path);
    if (k && k.size === f.size && k.mtime === f.mtime) continue;
    onFile(f);
    if (lib.type === 'music' || (lib.type === 'books' && AUDIO_EXT.has(f.ext))) {
      const t = await audioTags(f.path);
      const g = t.tags;
      const dir = path.dirname(f.path);
      const parts = rel(dir).split(path.sep).filter(Boolean);
      const isBook = lib.type === 'books';
      const artist = g.album_artist || g['album artist'] || g.artist || g.composer || (parts.length >= 2 ? parts[parts.length - 2] : 'Artiste inconnu');
      const album = g.album || parts[parts.length - 1] || 'Album inconnu';
      const title = g.title || cleanName(path.basename(f.path, f.ext).replace(/^\d{1,3}[\s.-]+/, ''));
      const cover = await albumArt(dir, f.path);
      let parent = null;
      if (isBook && f.ext !== '.m4b') {
        // Livre audio en plusieurs fichiers : l'élément « audiobook » porte le titre et la progression
        let book = get("SELECT id FROM items WHERE library_id = ? AND type = 'audiobook' AND path = ?", lib.id, dir);
        if (!book) {
          const bt = g.album || parts[parts.length - 1] || title;
          const r = run("INSERT INTO items(library_id, type, category, title, original_title, sort_title, path, poster, year, added_at, matched, size, mtime) VALUES(?, 'audiobook', 'audiobook', ?, ?, ?, ?, ?, ?, ?, 1, 0, 0)",
            lib.id, bt, g.artist || g.album_artist || (parts.length >= 2 ? parts[parts.length - 2] : null), bt.toLowerCase(), dir, cover, num(g.date || g.year), Date.now());
          book = { id: Number(r.lastInsertRowid) };
          added.push(bt);
        }
        parent = book.id;
      }
      const type = isBook && f.ext === '.m4b' ? 'audiobook' : 'track';
      const vals = [title, artist, album, `${artist}|${album}`.toLowerCase(), num(g.disc) || 1, num(g.track) || null, num(g.date || g.year || g.originaldate), g.genre ? JSON.stringify(g.genre.split(/[;/,]/).map((x) => x.trim()).filter(Boolean)) : null,
        t.duration, cover, JSON.stringify({ codec: t.codec, bitrate: t.bitrate, lyrics: g.lyrics || g['unsyncedlyrics'] || null }), f.size, f.mtime];
      if (k) run('UPDATE items SET title=?, original_title=?, grp=?, key=?, season_num=?, episode_num=?, year=?, genres=?, duration=?, poster=?, probe=?, size=?, mtime=? WHERE id=?', ...vals, k.id);
      else {
        run(`INSERT INTO items(library_id, type, category, title, original_title, grp, key, season_num, episode_num, year, genres, duration, poster, probe, size, mtime, path, parent_id, sort_title, added_at, matched)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, lib.id, type, isBook ? 'audiobook' : 'music', ...vals, f.path, parent, title.toLowerCase(), Date.now());
        if (!isBook || type === 'audiobook') added.push(isBook ? title : `${artist} - ${title}`);
      }
    } else if (lib.type === 'photos') {
      const album = rel(path.dirname(f.path)) || path.basename(lib.path);
      const title = path.basename(f.path, f.ext);
      if (k) run('UPDATE items SET size=?, mtime=? WHERE id=?', f.size, f.mtime, k.id);
      else run(`INSERT INTO items(library_id, type, category, title, sort_title, grp, key, path, size, mtime, release_date, added_at, matched)
        VALUES(?, 'photo', 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, lib.id, title, title.toLowerCase(), path.basename(path.dirname(f.path)), album, f.path, f.size, f.mtime, new Date(f.mtime).toISOString(), Date.now());
    } else {
      // Livres : EPUB (titre et auteur lus dans le livre), PDF, CBZ
      let title = cleanName(path.basename(f.path, f.ext)), author = null, cover = null, year = null, overview = null;
      const parts = rel(path.dirname(f.path)).split(path.sep).filter(Boolean);
      if (parts.length) author = parts[0];
      if (f.ext === '.epub') { try { const m = epubInfo(f.path); title = m.title || title; author = m.author || author; year = m.year; overview = m.description; cover = m.cover ? saveBuffer(m.cover.data, m.cover.ext) : null; } catch { /* */ } }
      if (f.ext === '.cbz') { try { const pages = cbzPages(f.path); if (pages[0]) cover = saveBuffer(zipRead(f.path, pages[0]), path.extname(pages[0])); } catch { /* */ } }
      if (!cover) cover = await (async () => { for (const n of [`${path.basename(f.path, f.ext)}.jpg`, 'cover.jpg', 'folder.jpg']) { const c = path.join(path.dirname(f.path), n); if (fs.existsSync(c)) return copyImage(c); } return null; })();
      const vals = [title, author, title.toLowerCase(), year, overview, cover, f.size, f.mtime];
      if (k) run('UPDATE items SET title=?, original_title=?, sort_title=?, year=?, overview=?, poster=COALESCE(?, poster), size=?, mtime=? WHERE id=?', ...vals, k.id);
      else { run(`INSERT INTO items(library_id, type, category, title, original_title, sort_title, year, overview, poster, size, mtime, path, added_at, matched) VALUES(?, 'book', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, lib.id, f.ext.slice(1), ...vals, f.path, Date.now()); added.push(title); }
    }
  }
  // Durée totale des livres audio en plusieurs fichiers
  if (lib.type === 'books') run("UPDATE items SET duration = (SELECT SUM(t.duration) FROM items t WHERE t.parent_id = items.id) WHERE library_id = ? AND type = 'audiobook' AND path NOT LIKE '%.m4b'", lib.id);
  return added;
}

function saveBuffer(buf, ext = '.jpg') {
  if (!buf || buf.length < 200) return null;
  const name = `b_${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}${/^\.(png|webp|gif)$/i.test(ext) ? ext.toLowerCase() : '.jpg'}`;
  const dest = path.join(imagesDir, name);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
  return name;
}

// ------------------------------------------------------------------ EPUB
const xmlText = (xml, re) => { const m = re.exec(xml); return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim() : null; };
export function epubPackage(file) {
  const container = zipRead(file, 'META-INF/container.xml');
  if (!container) throw new Error('EPUB invalide');
  const opfPath = (/full-path="([^"]+)"/i.exec(container.toString('utf8')) || [])[1];
  const opf = zipRead(file, opfPath).toString('utf8');
  const base = path.posix.dirname(opfPath) === '.' ? '' : `${path.posix.dirname(opfPath)}/`;
  const manifest = new Map();
  for (const m of opf.matchAll(/<item\s([^>]+?)\/?>/gi)) {
    const a = (k) => (new RegExp(`\\b${k}="([^"]*)"`, 'i').exec(m[1]) || [])[1];
    manifest.set(a('id'), { href: path.posix.normalize(base + decodeURIComponent(a('href') || '')), type: a('media-type') || '', props: a('properties') || '' });
  }
  const spine = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"[^>]*>/gi)].map((m) => manifest.get(m[1])).filter((x) => x && /html/.test(x.type)).map((x) => x.href);
  return { opf, base, manifest, spine };
}
export function epubInfo(file) {
  const { opf, manifest } = epubPackage(file);
  const coverId = (/<meta\s+name="cover"\s+content="([^"]+)"/i.exec(opf) || /<meta\s+content="([^"]+)"\s+name="cover"/i.exec(opf) || [])[1];
  const coverItem = (coverId && manifest.get(coverId)) || [...manifest.values()].find((x) => /cover-image/.test(x.props)) || [...manifest.values()].find((x) => /image/.test(x.type) && /cover/i.test(x.href));
  let cover = null;
  if (coverItem) { try { cover = { data: zipRead(file, coverItem.href), ext: path.extname(coverItem.href) }; } catch { /* */ } }
  return {
    title: xmlText(opf, /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i), author: xmlText(opf, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i),
    year: Number((xmlText(opf, /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || '').slice(0, 4)) || null,
    description: (xmlText(opf, /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i) || '').slice(0, 3000) || null, cover,
  };
}
export const cbzPages = (file) => [...zipEntries(file).keys()].filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n) && !/__MACOSX/.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// Paroles : fichier .lrc (synchronisées) ou .txt à côté du morceau, sinon étiquette du fichier
export function lyricsOf(item) {
  const base = item.path.slice(0, -path.extname(item.path).length);
  for (const ext of ['.lrc', '.txt']) {
    try {
      const text = fs.readFileSync(base + ext, 'utf8').slice(0, 200000);
      const synced = [];
      for (const line of text.split(/\r?\n/)) {
        const times = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
        const words = line.replace(/\[[^\]]*\]/g, '').trim();
        for (const t of times) synced.push({ t: Number(t[1]) * 60 + Number(t[2]) + (t[3] ? Number(`0.${t[3]}`) : 0), text: words });
      }
      if (synced.length) return { synced: synced.sort((a, b) => a.t - b.t), plain: null };
      return { synced: null, plain: text };
    } catch { /* pas de fichier */ }
  }
  let p = null;
  try { p = JSON.parse(item.probe || 'null'); } catch { /* */ }
  return p && p.lyrics ? { synced: null, plain: p.lyrics } : null;
}
