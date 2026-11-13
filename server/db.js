// Base de données de Venus : PostgreSQL (zéro SQLite). Venus garde son usage simple de la base (all / get / run,
// réponses immédiates) : un fil à part parle à PostgreSQL et le fil principal attend sa réponse. Le SQL écrit
// pour Venus est adapté à PostgreSQL au passage (sql-pg.js).
// Connexion : VENUS_DATABASE_URL (ou DATABASE_URL), ou le fichier postgres.json du dossier de données
// ({ "url": "postgres://venus:motdepasse@hote:5432/venus" }) ; une base créée par Urðr (Odin) convient.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import path from 'node:path';
import { config } from './config.js';
import { statements, translate, decode } from './sql-pg.js';

import fs from 'node:fs';
import crypto from 'node:crypto';

export function pgConf(env = process.env) {
  let url = env.VENUS_DATABASE_URL || env.DATABASE_URL || '';
  if (!url) { try { url = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'postgres.json'), 'utf8')).url || ''; } catch { /* absent */ } }
  if (!url) throw new Error('Base PostgreSQL non réglée : VENUS_DATABASE_URL=postgres://utilisateur:motdepasse@hote:5432/venus (ou postgres.json dans le dossier de données)');
  const u = new URL(url);
  const host = decodeURIComponent(u.hostname || u.searchParams.get('host') || '/var/run/postgresql');
  const ssl = u.searchParams.get('sslmode');
  return { host, port: Number(u.port || 5432), user: decodeURIComponent(u.username || 'venus'), password: decodeURIComponent(u.password || ''), database: decodeURIComponent(u.pathname.replace(/^\//, '') || 'venus'), ...(ssl ? { ssl: ssl === 'disable' ? 'non' : ssl === 'require' || ssl === 'verify-full' ? 'obligatoire' : 'si-possible' } : {}) };
}

// ---------------------------------------------------------------- le lien avec le fil PostgreSQL
const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
const { port1, port2 } = new MessageChannel();
const worker = new Worker(new URL('./db-worker.js', import.meta.url), { workerData: { sab, port: port2, conf: pgConf() }, transferList: [port2] });
worker.unref();
let inTx = 0;
function call(msg) {
  Atomics.store(flag, 0, 0);
  port1.postMessage({ ...msg, tx: inTx > 0 });
  if (Atomics.wait(flag, 0, 0, 180000) === 'timed-out') throw new Error('PostgreSQL ne répond pas (3 min)');
  const m = receiveMessageOnPort(port1)?.message;
  if (!m) throw new Error('PostgreSQL : réponse perdue');
  if (!m.ok) { const e = new Error(`${m.error.message}${m.error.detail ? ` (${m.error.detail})` : ''}`); e.code = m.error.code; if (process.env.VENUS_SQL_DEBUG) e.message += `\n  SQL : ${msg.sql}`; throw e; }
  return m;
}
const rowsOf = (m) => m.rows.map((r) => { const o = {}; m.fields.forEach(([n, t], i) => { o[n] = decode(t, r[i]); }); return o; });

// Les tables connues (clé primaire, colonne auto-incrémentée, colonnes) : pour adapter INSERT OR REPLACE, RETURNING…
const schema = new Map();
for (const r of rowsOf(call({ op: 'query', sql: `SELECT c.table_name t, c.column_name col, c.is_identity id, (SELECT array_to_string(array_agg(k.column_name::text ORDER BY k.ordinal_position), ',') FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema WHERE tc.table_schema = current_schema() AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY') pk FROM information_schema.columns c WHERE c.table_schema = current_schema() ORDER BY c.table_name, c.ordinal_position`, params: [] }))) {
  const s = schema.get(r.t) || { pk: r.pk ? r.pk.split(',') : [], identity: null, cols: [] }; s.cols.push(r.col); if (r.id === 'YES') s.identity = r.col; schema.set(r.t, s);
}

const translated = new Map();
const tr = (sql) => { let t = translated.get(sql); if (!t) { t = translate(sql, schema); if (!/^\s*(CREATE|ALTER)\b/i.test(sql)) translated.set(sql, t); } return t; };
function runOne(sql, params) {
  const t = tr(sql);
  if (t.kind === 'skip') return { rows: [], count: 0 };
  const m = call({ op: 'query', sql: t.sql, params });
  return { rows: rowsOf(m), count: m.count, returning: t.returning };
}
/** Même forme que les requêtes préparées de node:sqlite (all / get / run). */
function statement(sql) {
  return {
    all: (...p) => runOne(sql, p).rows,
    get: (...p) => runOne(sql, p).rows[0],
    run: (...p) => { const r = runOne(sql, p); return { changes: r.count, lastInsertRowid: r.returning && r.rows[0] ? r.rows[0][r.returning] : undefined }; },
    iterate: (...p) => runOne(sql, p).rows[Symbol.iterator](),
  };
}
export const db = {
  exec(sql) {
    for (const st of statements(sql)) {
      if (/^BEGIN\b/i.test(st)) { call({ op: 'simple', sql: 'BEGIN' }); inTx++; continue; }
      if (/^(COMMIT|END|ROLLBACK)\b/i.test(st)) { inTx = Math.max(0, inTx - 1); call({ op: 'simple', sql: /^ROLLBACK/i.test(st) ? 'ROLLBACK' : 'COMMIT' }); continue; }
      runOne(st, []);
    }
  },
  prepare: statement,
  /** Instantané de toutes les tables (sauvegardes, export) : { table: [lignes] }. */
  tables() { return [...schema.keys()]; },
  pg: { call, rowsOf },
};

db.exec(`

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

// Collections (choisies par l'administrateur) et listes de lecture (propres à chaque profil)
db.exec(`
CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, overview TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS collection_items (collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE, item_id INTEGER REFERENCES items(id) ON DELETE CASCADE, pos INTEGER, PRIMARY KEY (collection_id, item_id));
CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS playlist_items (playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE, item_id INTEGER REFERENCES items(id) ON DELETE CASCADE, pos INTEGER, PRIMARY KEY (playlist_id, item_id));
`);

// Migrations légères (bases créées par une version précédente)
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [col, def] of [['category', 'TEXT'], ['release_date', 'TEXT'], ['popularity', 'REAL'], ['stream_url', 'TEXT'], ['grp', 'TEXT'],
  ['imdb_id', 'TEXT'], ['anilist_id', 'INTEGER'], ['mal_id', 'INTEGER'], ['ratings', 'TEXT'], ['ratings_at', 'INTEGER'], ['trailer', 'TEXT'], ['channel_num', 'INTEGER'], ['credits', 'TEXT'],
  ['nfo', 'TEXT'], ['custom', 'TEXT'], ['version_of', 'INTEGER'], ['tmdb_eps', 'TEXT'], ['tmdb_seasons', 'TEXT'], ['poster_tried', 'INTEGER'], ['backdrop_tried', 'INTEGER'], ['tvmaze_id', 'INTEGER'], ['guide_eps', 'TEXT'], ['guide_at', 'INTEGER'], ['stream_opts', 'TEXT'], ['ch_ok', 'INTEGER'], ['ch_checked', 'INTEGER'], ['ch_error', 'TEXT']]) {
  if (!cols('items').includes(col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} ${def}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_items_version ON items(version_of)');
if (!cols('progress').includes('device')) db.exec('ALTER TABLE progress ADD COLUMN device TEXT');
// Temps de visionnage par profil et par jour (limite quotidienne des profils enfants)
db.exec('CREATE TABLE IF NOT EXISTS track_prefs (profile_id INTEGER, show_id INTEGER, audio_lang TEXT, sub_lang TEXT, sub_mode TEXT, updated_at INTEGER, PRIMARY KEY(profile_id, show_id))');
db.exec('CREATE TABLE IF NOT EXISTS watch_time (profile_id INTEGER, day TEXT, seconds REAL DEFAULT 0, PRIMARY KEY(profile_id, day))');
if (!cols('profiles').includes('perms')) db.exec('ALTER TABLE profiles ADD COLUMN perms TEXT');
if (!cols('profiles').includes('email')) db.exec('ALTER TABLE profiles ADD COLUMN email TEXT');
if (!cols('profiles').includes('ui_prefs')) db.exec('ALTER TABLE profiles ADD COLUMN ui_prefs TEXT');
// Reprise « endormi » : la position gardée est celle du dernier geste, pas la fin de la lecture
if (!cols('progress').includes('asleep')) db.exec('ALTER TABLE progress ADD COLUMN asleep INTEGER DEFAULT 0');
if (!cols('libraries').includes('remote')) db.exec('ALTER TABLE libraries ADD COLUMN remote TEXT');
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
// Compteur des écritures dans la table des titres : permet de garder en mémoire les listes lourdes
// (bibliothèques entières) et de les reconstruire seulement quand quelque chose a changé
export let itemsVersion = 1;
export const bumpItems = () => { itemsVersion++; };
const touchesItems = (sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*\bitems\b/i.test(sql);
export const run = (sql, ...p) => { const r = q(sql).run(...p); if (touchesItems(sql)) itemsVersion++; return r; };

export function tx(fn) {
  if (inTx) return fn(); // déjà dans une transaction : on la prolonge
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); itemsVersion++; return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Clés d'API et mots de passe des services : chiffrés dans la base (AES-256-GCM). La clé de chiffrement est
// dans le dossier de données (secret.key, lisible seulement par Venus) ou dans VENUS_SECRET : une copie de la
// base ou d'une sauvegarde seule ne révèle aucun secret.
const SECRET_KEYS = new Set(['tmdb_key', 'omdb_key', 'seerr_key', 'telegram_token', 'discord_webhook', 'opensubtitles_key', 'opensubtitles_pass', 'smtp_pass', 'vapid', 'simkl_client_id', 'trakt_client_id', 'trakt_client_secret', 'remote_access', 'odin_token']);
// Jetons Trakt de chaque profil : chiffrés aussi
const isSecret = (k) => SECRET_KEYS.has(k) || k.startsWith('trakt_auth:');
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
  if (isSecret(key) && value != null && value !== '') stored = JSON.stringify(seal(stored));
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, stored);
}
// Au démarrage : les secrets encore en clair sont chiffrés
for (const k of SECRET_KEYS) {
  const r = get('SELECT value FROM settings WHERE key = ?', k);
  if (r && !String(r.value).includes('enc1:')) { try { setSetting(k, JSON.parse(r.value)); } catch { /* */ } }
}
