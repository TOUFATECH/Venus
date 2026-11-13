// Copies de la base PostgreSQL de Venus : sauvegardes (fichier .json.gz : chaque table et ses lignes), restauration,
// et reprise UNE SEULE FOIS d'une ancienne base SQLite (venus.db) au premier démarrage sur PostgreSQL.
// L'ancienne base est seulement lue pour être copiée, puis renommée : Venus ne s'en sert plus jamais.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db } from './db.js';

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const raw = (sql, params = []) => db.pg.rowsOf(db.pg.call({ op: 'query', sql, params }));
const tablesNow = () => raw("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name").map((r) => r.t);
const colsOf = (t) => raw('SELECT column_name AS c, data_type AS d, is_generated AS g FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [t]).filter((r) => r.g !== 'ALWAYS');

/** Toutes les tables et leurs lignes (sans les colonnes calculées). */
export function snapshot() {
  const out = {};
  for (const t of tablesNow()) { const cols = colsOf(t).map((c) => c.c); out[t] = raw(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(t)}`).map((r) => cols.map((c) => (Buffer.isBuffer(r[c]) ? { b64: r[c].toString('base64') } : r[c]))); out[`${t}#cols`] = cols; }
  return out;
}
/** Ajoute des lignes dans une table (seulement les colonnes qui existent), par paquets. Une ligne qui pointe vers
 *  une ligne absente (lien cassé) est réessayée après les autres, puis laissée de côté. */
export function insertRows(table, cols, rows) {
  const have = new Set(colsOf(table).map((c) => c.c)), keep = cols.map((c, i) => [c, i]).filter(([c]) => have.has(c));
  if (!keep.length || !rows.length) return 0;
  const put = (part) => {
    const params = [];
    const values = part.map((r) => `(${keep.map(([, i]) => { const v = r[i]; params.push(v && typeof v === 'object' && v.b64 ? Buffer.from(v.b64, 'base64') : v === undefined ? null : v); return `$${params.length}`; }).join(', ')})`).join(', ');
    db.pg.call({ op: 'query', sql: `INSERT INTO ${quote(table)} (${keep.map(([c]) => quote(c)).join(', ')}) OVERRIDING SYSTEM VALUE VALUES ${values} ON CONFLICT DO NOTHING`, params });
  };
  const per = Math.max(1, Math.floor(30000 / keep.length)); let n = 0, later = [];
  for (let k = 0; k < rows.length; k += per) {
    const part = rows.slice(k, k + per);
    try { put(part); n += part.length; }
    catch (e) { if (e.code !== '23503') throw e; for (const r of part) { try { put([r]); n++; } catch (e2) { if (e2.code !== '23503') throw e2; later.push(r); } } }
  }
  for (let pass = 0; pass < 3 && later.length; pass++) { const again = later; later = []; for (const r of again) { try { put([r]); n++; } catch (e) { if (e.code !== '23503') throw e; later.push(r); } } }
  if (later.length) console.warn(`[copie] ${table} : ${later.length} ligne(s) laissée(s) (liens vers des lignes absentes)`);
  return n;
}
/** Les compteurs des clés auto-incrémentées repartent après le plus grand numéro copié. */
export function resetSequences() {
  for (const r of raw("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND is_identity = 'YES'")) {
    db.pg.call({ op: 'query', sql: `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST((SELECT COALESCE(MAX(${quote(r.c)}), 0) FROM ${quote(r.t)}), 1))`, params: [r.t, r.c] });
  }
}
/** Remplace tout le contenu par celui d'un instantané, dans l'ordre des liens entre tables. */
function load(snap) {
  const tables = Object.keys(snap).filter((k) => !k.endsWith('#cols')), now = tablesNow();
  db.pg.call({ op: 'query', sql: `TRUNCATE ${now.map(quote).join(', ')} RESTART IDENTITY CASCADE`, params: [] });
  // Les tables sans lien d'abord (réglages, profils, bibliothèques, titres dans l'ordre), puis le reste
  const order = ['settings', 'profiles', 'libraries', 'items', ...tables.filter((t) => !['settings', 'profiles', 'libraries', 'items'].includes(t))].filter((t) => tables.includes(t) && now.includes(t));
  let total = 0;
  for (const t of order) {
    let rows = snap[t];
    if (t === 'items') { const c = snap['items#cols'], id = c.indexOf('id'); if (id >= 0) rows = [...rows].sort((a, b) => a[id] - b[id]); }
    total += insertRows(t, snap[`${t}#cols`], rows);
  }
  resetSequences();
  return total;
}

export function writeDump(file) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ format: 'venus-pg', version: 1, at: Date.now(), tables: snapshot() })), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function readDump(file) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  if (d.format !== 'venus-pg') throw new Error('Ce fichier n’est pas une sauvegarde de Venus');
  return load(d.tables);
}

/** Ancienne base SQLite → PostgreSQL (une fois). Seul endroit où Venus lit encore un fichier SQLite. */
export async function importSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(file, { readOnly: true });
  try {
    const snap = {};
    for (const { name } of old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'dialogues_%'").all()) {
      if (name === 'dialogues') continue; // l'index des dialogues est refait par Venus
      const rows = old.prepare(`SELECT * FROM ${quote(name)}`).all();
      const cols = rows.length ? Object.keys(rows[0]) : [];
      snap[name] = rows.map((r) => cols.map((c) => (r[c] instanceof Uint8Array ? { b64: Buffer.from(r[c]).toString('base64') } : typeof r[c] === 'bigint' ? Number(r[c]) : r[c])));
      snap[`${name}#cols`] = cols;
    }
    return load(snap);
  } finally { old.close(); }
}

/** Au démarrage : restauration demandée depuis le tableau de bord, ou reprise de l'ancienne base SQLite. */
export async function startupCopies(dataDir) {
  const pending = path.join(dataDir, 'backups', 'restore.pending');
  if (fs.existsSync(pending)) {
    const src = path.join(dataDir, 'backups', path.basename(fs.readFileSync(pending, 'utf8').trim()));
    try {
      if (fs.existsSync(src)) {
        writeDump(path.join(dataDir, 'backups', `venus-avant-restauration-${Date.now()}.json.gz`));
        const n = src.endsWith('.db') ? await importSqlite(src) : readDump(src);
        console.log(`  ↺ Sauvegarde restaurée : ${path.basename(src)} (${n} lignes)`);
      }
    } catch (e) { console.warn('[sauvegarde] restauration impossible :', e.message); }
    fs.rmSync(pending, { force: true });
  }
  const old = path.join(dataDir, 'venus.db');
  if (fs.existsSync(old)) {
    const empty = !raw('SELECT 1 FROM profiles LIMIT 1').length && !raw('SELECT 1 FROM items LIMIT 1').length;
    if (empty) {
      const n = await importSqlite(old);
      console.log(`  ✓ Ancienne base SQLite reprise dans PostgreSQL (${n} lignes)`);
    }
    // Plus jamais lue : gardée à côté, renommée, au cas où
    fs.renameSync(old, `${old}.reprise-dans-postgresql`);
    for (const ext of ['-wal', '-shm']) fs.rmSync(old + ext, { force: true });
  }
}
