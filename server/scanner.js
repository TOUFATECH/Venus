// Scan des bibliothèques : incrémental, détecte ajouts / modifications / suppressions
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx } from './db.js';
import { probeFile, findExternalSubs } from './probe.js';
import { downloadedSubs } from './subtitles.js';
import { parseMovie, parseEpisode, normKey, sortTitle } from './parse.js';
import { refreshMissing, copyLocalImage } from './metadata.js';
import { remoteReady } from './netshare.js';

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.mts', '.wmv', '.flv', '.mpg', '.mpeg', '.vob', '.ogv', '.3gp']);
const SKIP_DIR = /^(\.|@eaDir$|#recycle$|\$RECYCLE|System Volume Information$|lost\+found$|extras?$|featurettes?$|behind the scenes$|deleted scenes$|trailers?$|samples?$|bonus$)/i;

import { EventEmitter } from 'node:events';
export const events = new EventEmitter();
events.setMaxListeners(200);
export const scanState = { running: false, phase: '', done: 0, total: 0, lastScan: null, error: null, lastAdded: [] };
let added = [];
let pendingRescan = false;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(full, out); continue; }
    if (!e.isFile() && !e.isSymbolicLink()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!VIDEO_EXT.has(ext) || /(^|[._-])sample([._-]|$)/i.test(e.name)) continue;
    try {
      const st = fs.statSync(full);
      if (st.size < 5 * 1024 * 1024) continue; // ignore les fichiers minuscules
      out.push({ path: full, size: st.size, mtime: Math.floor(st.mtimeMs) });
    } catch { /* fichier inaccessible */ }
  }
  return out;
}

function findArt(dir, base, names) {
  const candidates = [];
  for (const n of names) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      if (base) candidates.push(path.join(dir, `${base}-${n}${ext}`));
      candidates.push(path.join(dir, n + ext));
    }
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

async function pool(items, size, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

const catOf = (lib) => (lib.type === 'anime' ? 'anime' : 'show');

function upsertShow(lib, info, showDir) {
  const key = normKey(info.show);
  let show = get("SELECT * FROM items WHERE library_id=? AND type='show' AND key=?", lib.id, key);
  if (!show) {
    let poster = null, backdrop = null;
    if (showDir) {
      const p = findArt(showDir, null, ['poster', 'folder', 'cover', 'show']);
      const b = findArt(showDir, null, ['fanart', 'backdrop', 'background']);
      if (p) poster = copyLocalImage(p);
      if (b) backdrop = copyLocalImage(b);
    }
    const r = run(`INSERT INTO items(library_id, type, category, key, title, sort_title, year, poster, backdrop, added_at, matched)
                   VALUES(?, 'show', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    lib.id, catOf(lib), key, info.show, sortTitle(info.show), info.showYear, poster, backdrop, Date.now());
    show = get('SELECT * FROM items WHERE id=?', Number(r.lastInsertRowid));
  }
  const sKey = `${show.id}:${info.season}`;
  let season = get("SELECT * FROM items WHERE type='season' AND show_id=? AND key=?", show.id, sKey);
  if (!season) {
    const r = run(`INSERT INTO items(library_id, type, category, parent_id, show_id, key, title, season_num, added_at, matched)
                   VALUES(?, 'season', ?, ?, ?, ?, ?, ?, ?, 0)`,
    lib.id, catOf(lib), show.id, show.id, sKey, info.season === 0 ? 'Bonus' : `Saison ${info.season}`, info.season, Date.now());
    season = get('SELECT * FROM items WHERE id=?', Number(r.lastInsertRowid));
  }
  return { show, season };
}

async function processFile(lib, f, existing) {
  let probe;
  try { probe = await probeFile(f.path); }
  catch (e) { console.warn(`[scan] lecture impossible : ${f.path} (${e.message})`); return; }
  probe.subs.push(...findExternalSubs(f.path));
  const probeJson = JSON.stringify(probe);

  if (existing) {
    probe.subs.push(...downloadedSubs(existing.id));
    run('UPDATE items SET size=?, mtime=?, duration=?, probe=? WHERE id=?', f.size, f.mtime, probe.duration, JSON.stringify(probe), existing.id);
    return;
  }
  if (lib.type === 'clips') {
    const base = path.basename(f.path, path.extname(f.path)).replace(/[._]+/g, ' ').replace(/\s*[\[(][^\])]*[\])]/g, '').trim();
    const [artist, ...rest] = base.split(/\s+-\s+/);
    const title = rest.length ? rest.join(' - ') : base;
    added.push(rest.length ? `${artist} - ${title}` : title);
    run(`INSERT INTO items(library_id, type, category, title, original_title, sort_title, path, size, mtime, duration, probe, added_at, matched, release_date)
         VALUES(?, 'clip', 'clip', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    lib.id, title, rest.length ? artist : null, sortTitle(title), f.path, f.size, f.mtime, probe.duration, probeJson, Date.now(),
    new Date(f.mtime).toISOString().slice(0, 10));
    return;
  }
  if (lib.type === 'movies') {
    const info = parseMovie(f.path, lib.path);
    added.push(info.title);
    const dir = path.dirname(f.path);
    const base = path.basename(f.path, path.extname(f.path));
    const dedicated = dir !== lib.path;
    const p = findArt(dir, base, dedicated ? ['poster', 'folder', 'cover', 'movie'] : ['poster']);
    const b = findArt(dir, base, dedicated ? ['fanart', 'backdrop', 'background'] : ['fanart']);
    run(`INSERT INTO items(library_id, type, category, title, sort_title, year, path, size, mtime, duration, probe, poster, backdrop, added_at, matched)
         VALUES(?, 'movie', 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    lib.id, info.title, sortTitle(info.title), info.year, f.path, f.size, f.mtime, probe.duration, probeJson,
    p ? copyLocalImage(p) : null, b ? copyLocalImage(b) : null, Date.now());
  } else {
    const info = parseEpisode(f.path, lib.path);
    added.push(`${info.show} (S${info.season}E${info.episode})`);
    const rel = path.relative(lib.path, f.path).split(path.sep);
    const showDir = rel.length > 1 ? path.join(lib.path, rel[0]) : null;
    tx(() => {
      const { show, season } = upsertShow(lib, info, showDir);
      run(`INSERT INTO items(library_id, type, category, parent_id, show_id, title, season_num, episode_num, episode_end, path, size, mtime, duration, probe, added_at, matched)
           VALUES(?, 'episode', '${catOf(lib)}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      lib.id, season.id, show.id, info.title || `Épisode ${info.episode}`, info.season, info.episode, info.episodeEnd,
      f.path, f.size, f.mtime, probe.duration, probeJson, Date.now());
      run('UPDATE items SET added_at = ? WHERE id IN (?, ?)', Date.now(), show.id, season.id);
    });
  }
}

export async function scanAll({ force = false } = {}) {
  if (scanState.running) { pendingRescan = true; return; }
  Object.assign(scanState, { running: true, phase: 'Recherche des fichiers', done: 0, total: 0, error: null });
  added = [];
  try {
    const libs = all('SELECT * FROM libraries');
    for (const lib of libs) {
      if (lib.type === 'iptv') { scanState.phase = `Chaînes : ${lib.name}`; await scanIptv(lib).catch((e) => console.warn(`[iptv] ${lib.name} : ${e.message}`)); continue; }
      if (!fs.existsSync(lib.path)) { console.warn(`[scan] dossier introuvable : ${lib.path}`); continue; }
      if (lib.remote && !remoteReady(lib)) { console.warn(`[scan] partage réseau indisponible : ${lib.name}, on garde la bibliothèque telle quelle`); continue; }
      const files = walk(lib.path);
      const known = new Map(all("SELECT id, path, size, mtime FROM items WHERE library_id=? AND path IS NOT NULL", lib.id).map((r) => [r.path, r]));
      const seen = new Set(files.map((f) => f.path));

      // Suppressions — sauf si le dossier est soudain vide (disque débranché, partage coupé) : on ne vide pas la bibliothèque
      if (!files.length && known.size > 0) { console.warn(`[scan] ${lib.path} est vide : disque ou partage déconnecté ? Rien n’est supprimé.`); continue; }
      const removed = [...known.values()].filter((r) => !seen.has(r.path));
      if (removed.length) tx(() => removed.forEach((r) => run('DELETE FROM items WHERE id=?', r.id)));

      // Ajouts / modifications
      const todo = files.filter((f) => { const k = known.get(f.path); return force || !k || k.size !== f.size || k.mtime !== f.mtime; });
      scanState.phase = `Analyse : ${lib.name}`;
      scanState.total += todo.length;
      await pool(todo, 3, async (f) => { await processFile(lib, f, known.get(f.path)); scanState.done++; });
    }
    // Nettoyage des saisons / séries vides
    run("DELETE FROM items WHERE type='season' AND NOT EXISTS (SELECT 1 FROM items e WHERE e.parent_id = items.id)");
    run("DELETE FROM items WHERE type='show' AND NOT EXISTS (SELECT 1 FROM items s WHERE s.parent_id = items.id)");

    scanState.phase = 'Téléchargement des affiches et résumés';
    await refreshMissing((d, t) => { scanState.done = d; scanState.total = t; });
    scanState.lastScan = Date.now();
    if (added.length) {
      // Titres définitifs (après identification TMDB) pour la notification
      const unique = [...new Set(added)];
      scanState.lastAdded = [...unique, ...scanState.lastAdded].slice(0, 30).map((t) => (typeof t === 'string' ? { title: t, at: Date.now() } : t));
      events.emit('library', { added: unique });
      console.log(`[scan] ${unique.length} nouveauté(s) : ${unique.slice(0, 5).join(', ')}`);
    }
  } catch (e) {
    console.error('[scan]', e);
    scanState.error = e.message;
  } finally {
    scanState.running = false;
    scanState.phase = '';
    if (pendingRescan) { pendingRescan = false; setTimeout(() => scanAll(), 1000); }
  }
}

let scheduled;
export function scheduleScan(ms = 5000) { clearTimeout(scheduled); scheduled = setTimeout(() => scanAll(), ms); }

// Surveillance des dossiers : nouveau film copié = visible en quelques secondes
const watchers = [];
let debounce;
export function watchLibraries() {
  watchers.splice(0).forEach((w) => w.close());
  for (const lib of all("SELECT * FROM libraries WHERE type != 'iptv' AND remote IS NULL")) {
    try {
      const w = fs.watch(lib.path, { recursive: true }, (_e, name) => {
        if (name && !VIDEO_EXT.has(path.extname(String(name)).toLowerCase()) && path.extname(String(name))) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => scanAll(), 8000); // laisse le temps à la copie de se terminer
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch { /* partages réseau : le scan périodique prend le relais */ }
  }
}

// ---------------------------------------------------------------- IPTV : liste de lecture M3U (adresse ou fichier)
export function parseM3u(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attr = (k) => { const m = new RegExp(`${k}="([^"]*)"`, 'i').exec(line); return m ? m[1].trim() : null; };
      const comma = line.lastIndexOf(',');
      cur = { name: (comma >= 0 ? line.slice(comma + 1) : '').trim() || attr('tvg-name') || 'Chaîne', logo: attr('tvg-logo'), group: attr('group-title'), id: attr('tvg-id'), chno: parseInt(attr('tvg-chno') || attr('channel-number') || attr('tvg-num') || '', 10) || null };
    } else if (line.startsWith('#EXTGRP:') && cur) {
      cur.group = cur.group || line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      if (/^(https?|rtmp|rtsp|udp|rtp):\/\//i.test(line)) out.push({ ...(cur || { name: line.split('/').pop() }), url: line });
      cur = null;
    }
  }
  return out;
}

async function scanIptv(lib) {
  let text;
  if (/^https?:\/\//i.test(lib.path)) {
    const res = await fetch(lib.path, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Venus/1.0' } });
    if (!res.ok) throw new Error(`liste inaccessible (${res.status})`);
    text = await res.text();
  } else text = fs.readFileSync(lib.path, 'utf8');
  const channels = parseM3u(text);
  const known = new Map(all("SELECT id, stream_url FROM items WHERE library_id=? AND type='channel'", lib.id).map((r) => [r.stream_url, r]));
  const seen = new Set();
  tx(() => {
    channels.forEach((c, i) => {
      seen.add(c.url);
      const k = known.get(c.url);
      if (k) run('UPDATE items SET title=?, poster=?, grp=?, episode_num=?, channel_num=? WHERE id=?', c.name, c.logo, c.group, i + 1, c.chno, k.id);
      else run(`INSERT INTO items(library_id, type, category, title, sort_title, poster, grp, stream_url, episode_num, channel_num, added_at, matched)
                VALUES(?, 'channel', 'channel', ?, ?, ?, ?, ?, ?, ?, ?, 1)`, lib.id, c.name, sortTitle(c.name), c.logo, c.group, c.url, i + 1, c.chno, Date.now());
    });
    for (const [url, r] of known) if (!seen.has(url)) run('DELETE FROM items WHERE id=?', r.id);
  });
  console.log(`[iptv] ${lib.name} : ${channels.length} chaînes`);
  events.emit('library', { added: [] });
}
