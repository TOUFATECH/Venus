// Base SQLite intégrée à Node (aucune dépendance native à compiler)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

import fs from 'node:fs';
import crypto from 'node:crypto';

// Restauration d'une sauvegarde demandée depuis le tableau de bord : appliquée au démarrage, avant d'ouvrir la base
const dbFile = path.join(config.dataDir, 'venus.db');
const pending = path.join(config.dataDir, 'backups', 'restore.pending');
try {
  if (fs.existsSync(pending)) {
    const src = path.join(config.dataDir, 'backups', path.basename(fs.readFileSync(pending, 'utf8').trim()));
    if (fs.existsSync(src)) {
      if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, `${dbFile}.avant-restauration`);
      for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(dbFile + ext); } catch { /* */ } }
      fs.copyFileSync(src, dbFile);
      console.log(`  ↺ Sauvegarde restaurée : ${path.basename(src)}`);
    }
    fs.unlinkSync(pending);
  }
} catch (e) { console.warn('[sauvegarde] restauration impossible :', e.message); }

export const db = new DatabaseSync(dbFile);
// La base n'est lisible que par Venus (sessions, réglages)
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* Windows ou fichier absent */ } }

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  avatar INTEGER DEFAULT 0,
  pin_hash TEXT,
  is_admin INTEGER DEFAULT 0,
  max_age INTEGER,
  subtitle_lang TEXT DEFAULT 'fr',
  audio_lang TEXT DEFAULT 'fr',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  device TEXT,
  created_at INTEGER,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- movies | shows | anime | clips | iptv
  path TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- movie | show | season | episode | clip | channel
  parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  show_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  key TEXT,                      -- clé de regroupement (séries / saisons)
  title TEXT,
  sort_title TEXT,
  original_title TEXT,
  year INTEGER,
  overview TEXT,
  tagline TEXT,
  tmdb_id INTEGER,
  poster TEXT,
  backdrop TEXT,
  logo TEXT,
  still TEXT,
  age INTEGER,                   -- âge minimum (contrôle parental)
  certification TEXT,
  vote REAL,
  genres TEXT,
  runtime INTEGER,
  season_num INTEGER,
  episode_num INTEGER,
  episode_end INTEGER,
  path TEXT UNIQUE,
  size INTEGER,
  mtime INTEGER,
  duration REAL,
  probe TEXT,
  matched INTEGER DEFAULT 0,
  added_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_show ON items(show_id);
CREATE INDEX IF NOT EXISTS idx_items_key ON items(library_id, type, key);

CREATE TABLE IF NOT EXISTS progress (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  position REAL DEFAULT 0,
  duration REAL DEFAULT 0,
  watched INTEGER DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (profile_id, item_id)
);

CREATE TABLE IF NOT EXISTS mylist (
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  added_at INTEGER,
  PRIMARY KEY (profile_id, item_id)
);
`);

// Migrations légères (bases créées par une version précédente)
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [col, def] of [['category', 'TEXT'], ['release_date', 'TEXT'], ['popularity', 'REAL'], ['stream_url', 'TEXT'], ['grp', 'TEXT'],
  ['imdb_id', 'TEXT'], ['anilist_id', 'INTEGER'], ['mal_id', 'INTEGER'], ['ratings', 'TEXT'], ['ratings_at', 'INTEGER'], ['trailer', 'TEXT'], ['channel_num', 'INTEGER'], ['credits', 'TEXT']]) {
  if (!cols('items').includes(col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} ${def}`);
}
if (!cols('libraries').includes('remote')) db.exec('ALTER TABLE libraries ADD COLUMN remote TEXT');
const libSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'libraries'").get();
if (libSql && /CHECK/.test(libSql.sql)) {
  db.exec(`PRAGMA foreign_keys = OFF; BEGIN;
    CREATE TABLE libraries_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL UNIQUE, remote TEXT);
    INSERT INTO libraries_new SELECT id, name, type, path, remote FROM libraries;
    DROP TABLE libraries; ALTER TABLE libraries_new RENAME TO libraries;
    COMMIT; PRAGMA foreign_keys = ON;`);
}
db.exec("UPDATE items SET category = CASE type WHEN 'movie' THEN 'movie' WHEN 'clip' THEN 'clip' WHEN 'channel' THEN 'channel' ELSE (SELECT CASE l.type WHEN 'anime' THEN 'anime' ELSE 'show' END FROM libraries l WHERE l.id = items.library_id) END WHERE category IS NULL");
db.exec('CREATE INDEX IF NOT EXISTS idx_items_cat ON items(category, type)');
// Doubles épisodes mal reconnus par une version précédente (ex. « S01E01-2160p »)
db.exec("UPDATE items SET episode_end = NULL WHERE episode_end IS NOT NULL AND (episode_end <= episode_num OR episode_end - episode_num > 3)");

// Cache des requêtes préparées
const cache = new Map();
export function q(sql) {
  let st = cache.get(sql);
  if (!st) { st = db.prepare(sql); cache.set(sql, st); }
  return st;
}
export const all = (sql, ...p) => q(sql).all(...p);
export const get = (sql, ...p) => q(sql).get(...p);
export const run = (sql, ...p) => q(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Clés d'API et mots de passe des services : chiffrés dans la base (AES-256-GCM). La clé de chiffrement est
// dans le dossier de données (secret.key, lisible seulement par Venus) ou dans VENUS_SECRET : une copie de la
// base ou d'une sauvegarde seule ne révèle aucun secret.
const SECRET_KEYS = new Set(['tmdb_key', 'omdb_key', 'seerr_key', 'telegram_token', 'discord_webhook', 'opensubtitles_key', 'opensubtitles_pass', 'smtp_pass', 'vapid', 'simkl_client_id']);
let masterKey = null;
function keyOf() {
  if (masterKey) return masterKey;
  if (process.env.VENUS_SECRET) return (masterKey = crypto.createHash('sha256').update(process.env.VENUS_SECRET).digest());
  const f = path.join(config.dataDir, 'secret.key');
  try { masterKey = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); if (masterKey.length === 32) return masterKey; } catch { /* à créer */ }
  masterKey = crypto.randomBytes(32);
  fs.writeFileSync(f, masterKey.toString('base64'), { mode: 0o600 });
  return masterKey;
}
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `enc1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}
function unseal(v) {
  const b = Buffer.from(v.slice(5), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
export function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return def;
  let v;
  try { v = JSON.parse(r.value); } catch { v = r.value; }
  if (typeof v === 'string' && v.startsWith('enc1:')) {
    try { const plain = unseal(v); try { return JSON.parse(plain); } catch { return plain; } }
    catch { console.warn(`[secrets] « ${key} » illisible (clé secret.key changée ?)`); return def; }
  }
  return v;
}
export function setSetting(key, value) {
  let stored = JSON.stringify(value);
  if (SECRET_KEYS.has(key) && value != null && value !== '') stored = JSON.stringify(seal(stored));
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, stored);
}
// Au démarrage : les secrets encore en clair sont chiffrés
for (const k of SECRET_KEYS) {
  const r = get('SELECT value FROM settings WHERE key = ?', k);
  if (r && !String(r.value).includes('enc1:')) { try { setSetting(k, JSON.parse(r.value)); } catch { /* */ } }
}
