// Base SQLite intégrée à Node (aucune dépendance native à compiler)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'venus.db'));

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
for (const [col, def] of [['category', 'TEXT'], ['release_date', 'TEXT'], ['popularity', 'REAL'], ['stream_url', 'TEXT'], ['grp', 'TEXT']]) {
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

export function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
