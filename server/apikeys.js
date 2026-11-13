// Clés API : pour des scripts ou des applications (Home Assistant, scripts de
// téléchargement…). Envoyées dans l'en-tête « X-Api-Key ». Une clé agit comme l'administrateur
// principal ; seule son empreinte est gardée, la clé n'est montrée qu'une fois à sa création.
import crypto from 'node:crypto';
import { db, all, get, run } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, hint TEXT, created_at INTEGER, last_used INTEGER, last_ip TEXT)');
const KEY_RE = /^vk_[A-Za-z0-9_-]{40}$/;
// Empreinte d'une clé API (seule l'empreinte est gardée dans la base)
const hashKey = (k) => crypto.createHash('sha256').update(`venus-api:${k}`).digest('hex');

// Crée une clé API ; la clé complète n'est montrée qu'une fois
export function createApiKey(name) {
  const key = `vk_${crypto.randomBytes(30).toString('base64url')}`;
  run('INSERT INTO api_keys(name, hash, hint, created_at) VALUES(?, ?, ?, ?)', name, hashKey(key), key.slice(-4), Date.now());
  return key;
}
// Liste des clés API (nom, indice, dates d'utilisation)
export const listApiKeys = () => all('SELECT id, name, hint, created_at AS createdAt, last_used AS lastUsed, last_ip AS lastIp FROM api_keys ORDER BY id');
// Supprime une clé API
export const revokeApiKey = (id) => run('DELETE FROM api_keys WHERE id = ?', Number(id)).changes;

const used = new Map();
// Renvoie le profil administrateur associé, ou null
export function profileFromApiKey(key, ip) {
  if (!KEY_RE.test(String(key || ''))) return null;
  const row = get('SELECT * FROM api_keys WHERE hash = ?', hashKey(key));
  if (!row) return null;
  const now = Date.now();
  if (now - (used.get(row.id) || 0) > 60000) { used.set(row.id, now); run('UPDATE api_keys SET last_used = ?, last_ip = ? WHERE id = ?', now, ip || null, row.id); }
  return get('SELECT * FROM profiles WHERE is_admin = 1 ORDER BY id LIMIT 1') || null;
}
