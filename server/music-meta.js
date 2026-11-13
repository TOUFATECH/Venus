// Reconnaissance des albums et discographies : MusicBrainz (fiches, dates, liste des titres), Cover Art Archive
// (pochettes), AcoustID (empreinte sonore des fichiers sans étiquettes, avec `fpcalc`). Tout est gratuit et sans
// clé, sauf AcoustID qui demande une clé d'application (Réglages → Demandes → Musique).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { db, all, get, run, getSetting } from './db.js';
import { saveRemoteImage } from './posters.js';
import { cleanName } from './slugs.js';

const MB = (process.env.VENUS_MUSICBRAINZ_API || 'https://musicbrainz.org/ws/2').replace(/\/+$/, '');
const CAA = (process.env.VENUS_COVERART_API || 'https://coverartarchive.org').replace(/\/+$/, '');
const ACOUSTID = (process.env.VENUS_ACOUSTID_API || 'https://api.acoustid.org/v2').replace(/\/+$/, '');
const UA = { 'User-Agent': 'Venus/2 (https://github.com/TOUFATECH/Venus)', Accept: 'application/json' };
const DAY = 86400e3;

db.exec(`CREATE TABLE IF NOT EXISTS music_albums (key TEXT PRIMARY KEY, mb_rg TEXT, mb_artist TEXT, title TEXT, artist TEXT, date TEXT, type TEXT, cover TEXT, tracks TEXT, status TEXT, checked_at INTEGER);
CREATE TABLE IF NOT EXISTS music_artists (name TEXT PRIMARY KEY, mb_id TEXT, type TEXT, country TEXT, begin TEXT, disambiguation TEXT, discography TEXT, status TEXT, checked_at INTEGER);
CREATE TABLE IF NOT EXISTS music_fingerprints (item_id INTEGER PRIMARY KEY, mtime INTEGER, mb_rg TEXT, title TEXT, artist TEXT, album TEXT, status TEXT, at INTEGER)`);

// Titre simplifié (sans accents ni mentions entre parenthèses)
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(deluxe|edition|remaster(ed)?|bonus|disc \d|cd ?\d|version|explicit|expanded|anniversary|\d{4})\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// Deux titres désignent-ils le même album ?
const same = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x === y || x.startsWith(y) || y.startsWith(x)); };

// ------------------------------------------------------------------ appels, au plus un par seconde (règle MusicBrainz)
let lastCall = 0, chain = Promise.resolve();
export const musicState = { running: false, phase: '', done: 0, total: 0, lastRun: 0, error: null };
// Requête MusicBrainz (une par seconde, comme le demande le service)
function mb(path) {
  const p = chain.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const url = `${MB}${path}${path.includes('?') ? '&' : '?'}fmt=json`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 503 || res.status === 429) { await new Promise((r) => setTimeout(r, 4000)); throw new Error('MusicBrainz : trop de demandes'); }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
    return res.json();
  });
  chain = p.catch(() => {});
  return p;
}
// Texte nettoyé pour une recherche MusicBrainz
const q = (s) => String(s || '').replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim();

// ------------------------------------------------------------------ pochettes
export async function coverFor(rgId) {
  if (!rgId) return null;
  return saveRemoteImage(`${CAA}/release-group/${rgId}/front-500`).catch(() => null);
}

// ------------------------------------------------------------------ albums
// Les albums présents sur le NAS : un par clé « artiste|album » des pistes
export function nasAlbums() {
  return all("SELECT key, original_title AS artist, grp AS album, MIN(year) AS year, MIN(poster) AS cover, COUNT(*) AS n, MAX(mtime) AS mtime FROM items WHERE type = 'track' AND category = 'music' GROUP BY key");
}
// Fiche MusicBrainz d'un album
export const albumMeta = (key) => { const r = get('SELECT * FROM music_albums WHERE key = ?', key); if (!r) return null; return { ...r, tracks: parse(r.tracks) }; };
// Lecture d'une liste JSON (vide si invalide)
const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

// Identifie un album sur MusicBrainz (date, type, titres, pochette)
async function identifyAlbum(a) {
  const r = await mb(`/release-group?query=${encodeURIComponent(`releasegroup:"${q(a.album)}" AND artist:"${q(a.artist)}"`)}&limit=5`);
  const list = (r && r['release-groups']) || [];
  const hit = list.find((g) => same(g.title, a.album) && (g['artist-credit'] || []).some((c) => same(c.name || (c.artist && c.artist.name), a.artist))) || list.find((g) => g.score >= 90 && same(g.title, a.album));
  if (!hit) { run('INSERT OR REPLACE INTO music_albums(key, title, artist, status, checked_at) VALUES(?,?,?,?,?)', a.key, a.album, a.artist, 'none', Date.now()); return null; }
  const credit = (hit['artist-credit'] || [])[0];
  const artistId = credit && credit.artist ? credit.artist.id : null;
  // Liste des titres : la première édition officielle du groupe de sorties
  let tracks = [];
  const detail = await mb(`/release-group/${hit.id}?inc=releases`).catch(() => null);
  const rels = ((detail && detail.releases) || []).filter((x) => x.status === 'Official' || !x.status).sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')));
  const rel = rels[0] || ((detail && detail.releases) || [])[0];
  if (rel) {
    const full = await mb(`/release/${rel.id}?inc=recordings`).catch(() => null);
    for (const m of (full && full.media) || []) for (const t of m.tracks || []) tracks.push({ disc: m.position || 1, n: t.position, title: t.title, length: t.length ? Math.round(t.length / 1000) : null });
  }
  const cover = a.cover ? null : await coverFor(hit.id);
  const type = [hit['primary-type'], ...(hit['secondary-types'] || [])].filter(Boolean).join(' · ') || 'Album';
  run('INSERT OR REPLACE INTO music_albums(key, mb_rg, mb_artist, title, artist, date, type, cover, tracks, status, checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    a.key, hit.id, artistId, hit.title, credit ? (credit.name || credit.artist.name) : a.artist, hit['first-release-date'] || null, type, cover, JSON.stringify(tracks), 'ok', Date.now());
  if (cover) run("UPDATE items SET poster = ? WHERE type = 'track' AND category = 'music' AND key = ? AND poster IS NULL", cover, a.key);
  if (artistId) run('INSERT OR IGNORE INTO music_artists(name, mb_id, status) VALUES(?,?,?)', a.artist, artistId, 'new');
  return hit;
}

// ------------------------------------------------------------------ artistes et discographies
async function refreshArtist(name) {
  const row = get('SELECT * FROM music_artists WHERE name = ?', name);
  let id = row && row.mb_id;
  if (!id) {
    const r = await mb(`/artist?query=${encodeURIComponent(`artist:"${q(name)}"`)}&limit=3`);
    const hit = ((r && r.artists) || []).find((x) => same(x.name, name) && x.score >= 90);
    if (!hit) { run('INSERT OR REPLACE INTO music_artists(name, status, checked_at) VALUES(?,?,?)', name, 'none', Date.now()); return; }
    id = hit.id;
  }
  const info = await mb(`/artist/${id}`).catch(() => null);
  const groups = [];
  for (let offset = 0; offset < 400; offset += 100) {
    const r = await mb(`/release-group?artist=${id}&type=album|ep&limit=100&offset=${offset}`);
    const list = (r && r['release-groups']) || [];
    groups.push(...list);
    if (list.length < 100) break;
  }
  const disco = groups
    .filter((g) => !(g['secondary-types'] || []).some((t) => ['Compilation', 'Live', 'Remix', 'DJ-mix', 'Mixtape/Street', 'Demo', 'Interview', 'Audiobook', 'Spokenword'].includes(t)))
    .map((g) => ({ id: g.id, title: g.title, date: g['first-release-date'] || null, type: g['primary-type'] || 'Album', secondary: g['secondary-types'] || [] }))
    .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
  run('INSERT OR REPLACE INTO music_artists(name, mb_id, type, country, begin, disambiguation, discography, status, checked_at) VALUES(?,?,?,?,?,?,?,?,?)',
    name, id, info && info.type, info && info.country, info && info['life-span'] && info['life-span'].begin, info && info.disambiguation, JSON.stringify(disco), 'ok', Date.now());
}

// Pochettes des albums absents du NAS (quelques-unes par passage pour respecter le service)
async function fillDiscoCovers(limit = 12) {
  let n = 0;
  for (const ar of all("SELECT name, discography FROM music_artists WHERE status = 'ok'")) {
    const disco = parse(ar.discography);
    let changed = false;
    for (const g of disco) {
      if (g.cover !== undefined || n >= limit) continue;
      g.cover = await coverFor(g.id); n++; changed = true;
    }
    if (changed) run('UPDATE music_artists SET discography = ? WHERE name = ?', JSON.stringify(disco), ar.name);
    if (n >= limit) break;
  }
  return n;
}

// ------------------------------------------------------------------ empreintes sonores (AcoustID + fpcalc)
export function fpcalcBin() {
  if (process.env.VENUS_FPCALC_BIN) return process.env.VENUS_FPCALC_BIN;
  for (const p of ['/usr/bin/fpcalc', '/usr/local/bin/fpcalc', '/opt/homebrew/bin/fpcalc']) if (fs.existsSync(p)) return p;
  return null;
}
// Clé AcoustID
export const acoustidKey = () => String(getSetting('acoustid_key', '') || process.env.ACOUSTID_KEY || '');
// Empreinte sonore d'un fichier (fpcalc)
function fingerprint(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(fpcalcBin(), ['-json', '-length', '120', file]);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => { if (code) return reject(new Error(err.trim() || `fpcalc ${code}`)); try { resolve(JSON.parse(out)); } catch (e) { reject(e); } });
  });
}
// Pistes dont l'étiquette manque (artiste ou album « inconnu », ou titre = nom de fichier) : on demande à AcoustID
function untaggedTracks(limit) {
  return all(`SELECT i.* FROM items i LEFT JOIN music_fingerprints f ON f.item_id = i.id AND f.mtime = i.mtime
    WHERE i.type = 'track' AND i.category = 'music' AND f.item_id IS NULL AND (i.original_title IN ('Artiste inconnu','Unknown Artist','') OR i.grp IN ('Album inconnu','Unknown Album','') OR i.original_title IS NULL OR i.grp IS NULL) LIMIT ?`, limit);
}
// Identifie un morceau sans étiquette grâce à son empreinte sonore
async function identifyTrack(t) {
  const fp = await fingerprint(t.path);
  const url = `${ACOUSTID}/lookup?client=${encodeURIComponent(acoustidKey())}&meta=recordings+releasegroups+compress&duration=${Math.round(fp.duration)}&fingerprint=${encodeURIComponent(fp.fingerprint)}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  const data = res.ok ? await res.json() : null;
  const best = ((data && data.results) || []).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const rec = best && best.score >= 0.6 && (best.recordings || [])[0];
  if (!rec) { run('INSERT OR REPLACE INTO music_fingerprints(item_id, mtime, status, at) VALUES(?,?,?,?)', t.id, t.mtime, 'none', Date.now()); return false; }
  const rg = (rec.releasegroups || []).find((g) => g.type === 'Album') || (rec.releasegroups || [])[0];
  const artist = (rec.artists || []).map((a) => a.name).join(', ') || t.original_title;
  const album = rg ? rg.title : t.grp;
  run('INSERT OR REPLACE INTO music_fingerprints(item_id, mtime, mb_rg, title, artist, album, status, at) VALUES(?,?,?,?,?,?,?,?)', t.id, t.mtime, rg ? rg.id : null, rec.title, artist, album, 'ok', Date.now());
  run("UPDATE items SET title = ?, original_title = ?, grp = ?, key = ? WHERE id = ?", rec.title || t.title, artist, album, `${artist}|${album}`.toLowerCase(), t.id);
  return true;
}

// ------------------------------------------------------------------ passage complet (tâche planifiée)
export async function runMusicMeta({ force = false } = {}) {
  if (musicState.running) return 'Déjà en cours';
  Object.assign(musicState, { running: true, phase: 'Empreintes sonores', done: 0, total: 0, error: null });
  const out = [];
  try {
    if (fpcalcBin() && acoustidKey()) {
      const todo = untaggedTracks(40);
      musicState.total = todo.length;
      let ok = 0;
      for (const t of todo) { try { if (await identifyTrack(t)) ok++; } catch (e) { console.warn(`[musique] empreinte ${t.title} : ${e.message}`); } musicState.done++; }
      if (todo.length) out.push(`${ok}/${todo.length} fichier(s) sans étiquette reconnu(s)`);
    }
    musicState.phase = 'Fiches des albums';
    const known = new Map(all('SELECT key, status, checked_at FROM music_albums').map((r) => [r.key, r]));
    const albums = nasAlbums().filter((a) => { const k = known.get(a.key); return force || !k || (k.status === 'none' && Date.now() - k.checked_at > 30 * DAY); }).slice(0, 60);
    musicState.done = 0; musicState.total = albums.length;
    let found = 0;
    for (const a of albums) { try { if (await identifyAlbum(a)) found++; } catch (e) { console.warn(`[musique] album ${a.album} : ${e.message}`); } musicState.done++; }
    if (albums.length) out.push(`${found}/${albums.length} album(s) reconnu(s)`);
    musicState.phase = 'Discographies';
    const names = new Set(nasAlbums().map((a) => a.artist).filter((n) => n && !/inconnu|unknown/i.test(n)));
    const rows = new Map(all('SELECT name, status, checked_at FROM music_artists').map((r) => [r.name, r]));
    const artists = [...names].filter((n) => { const r = rows.get(n); return force || !r || r.status === 'new' || Date.now() - (r.checked_at || 0) > (r.status === 'none' ? 30 : 7) * DAY; }).slice(0, 30);
    musicState.done = 0; musicState.total = artists.length;
    for (const n of artists) { try { await refreshArtist(n); } catch (e) { console.warn(`[musique] artiste ${n} : ${e.message}`); } musicState.done++; }
    if (artists.length) out.push(`${artists.length} discographie(s) mise(s) à jour`);
    musicState.phase = 'Pochettes';
    const covers = await fillDiscoCovers();
    if (covers) out.push(`${covers} pochette(s)`);
    musicState.lastRun = Date.now();
  } catch (e) { musicState.error = e.message; throw e; } finally { musicState.running = false; musicState.phase = ''; }
  return out.join(', ') || 'Rien de nouveau';
}

// ------------------------------------------------------------------ pour l'API
export function artistInfo(name) {
  const r = get('SELECT * FROM music_artists WHERE name = ?', name);
  if (!r) return null;
  return { mbId: r.mb_id, type: r.type, country: r.country, begin: r.begin, disambiguation: r.disambiguation, status: r.status, checkedAt: r.checked_at, discography: parse(r.discography) };
}
// Discographie croisée avec le NAS : chaque sortie sait si elle est là (et sous quelle clé)
export function discographyOf(name, nas = nasAlbums().filter((a) => a.artist === name)) {
  const info = artistInfo(name);
  if (!info) return null;
  const metas = all('SELECT key, mb_rg FROM music_albums WHERE artist = ? OR key IN (' + (nas.map(() => '?').join(',') || "''") + ')', name, ...nas.map((a) => a.key));
  const byRg = new Map(metas.filter((m) => m.mb_rg).map((m) => [m.mb_rg, m.key]));
  const today = new Date().toISOString().slice(0, 10);
  const releases = info.discography.map((g) => {
    const key = byRg.get(g.id) || (nas.find((a) => same(a.album, g.title)) || {}).key || null;
    const local = key ? nas.find((a) => a.key === key) : null;
    return { id: g.id, title: g.title, date: g.date, year: g.date ? Number(g.date.slice(0, 4)) : null, type: g.type, secondary: g.secondary, cover: (local && local.cover) || g.cover || null,
      onNas: !!key, key, slug: local ? cleanName(`${local.artist} ${local.album}`) : null, upcoming: !!(g.date && g.date > today) };
  });
  // Les albums du NAS que MusicBrainz ne connaît pas restent visibles
  for (const a of nas) if (!releases.some((r) => r.key === a.key)) releases.unshift({ id: null, title: a.album, date: a.year ? String(a.year) : null, year: a.year, type: 'Album', secondary: [], cover: a.cover, onNas: true, key: a.key, slug: cleanName(`${a.artist} ${a.album}`), upcoming: false });
  return { ...info, releases: releases.sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))) };
}
// À venir et sorties récentes absentes : tous les artistes du NAS
export function musicUpcoming() {
  const nas = nasAlbums();
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const upcoming = [], missing = [];
  for (const ar of all("SELECT name FROM music_artists WHERE status = 'ok'")) {
    const d = discographyOf(ar.name, nas.filter((a) => a.artist === ar.name));
    if (!d) continue;
    for (const r of d.releases) {
      if (!r.date || !r.id) continue;
      const item = { ...r, artist: ar.name, artistSlug: cleanName(ar.name) };
      if (r.date > today) upcoming.push(item);
      else if (!r.onNas && r.date >= recent) missing.push(item);
    }
  }
  upcoming.sort((x, y) => x.date.localeCompare(y.date));
  missing.sort((x, y) => y.date.localeCompare(x.date));
  return { upcoming, missing, artists: all("SELECT COUNT(*) n FROM music_artists WHERE status = 'ok'")[0].n, pending: all("SELECT COUNT(*) n FROM music_artists WHERE status IS NULL OR status = 'new'")[0].n };
}
// État de l'identification de la musique (tableau de bord)
export function musicMetaStatus() {
  const albums = nasAlbums().length;
  const ok = get("SELECT COUNT(*) n FROM music_albums WHERE status = 'ok'").n;
  const artists = get("SELECT COUNT(*) n FROM music_artists WHERE status = 'ok'").n;
  const untagged = untaggedTracks(1000).length;
  return { ...musicState, albums, identified: ok, artists, untagged, fpcalc: !!fpcalcBin(), acoustid: !!acoustidKey() };
}
