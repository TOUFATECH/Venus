// Authentification : mot de passe du foyer -> appareil mémorisé -> choix du profil (+ code PIN)
import crypto from 'node:crypto';
import { get, run, getSetting } from './db.js';
import { HttpError, parseCookies } from './http.js';

const TOKEN_TTL = 365 * 24 * 3600 * 1000;

export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifySecret(secret, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(String(secret), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function createToken(device = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO tokens(token, profile_id, device, created_at, last_seen) VALUES(?, NULL, ?, ?, ?)', token, device.slice(0, 200), now, now);
  return token;
}

export function tokenFromReq(req, url) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const qp = url.searchParams.get('token');
  if (qp) return qp;
  return parseCookies(req.headers.cookie).vn_token || null;
}

const seenThrottle = new Map();
export function authenticate(req, url) {
  const token = tokenFromReq(req, url);
  if (!token) return null;
  const row = get('SELECT * FROM tokens WHERE token = ?', token);
  if (!row) return null;
  if (Date.now() - row.created_at > TOKEN_TTL) { run('DELETE FROM tokens WHERE token = ?', token); return null; }
  // Mise à jour "dernière activité" au plus une fois par minute
  const last = seenThrottle.get(token) || 0;
  if (Date.now() - last > 60000) { seenThrottle.set(token, Date.now()); run('UPDATE tokens SET last_seen = ? WHERE token = ?', Date.now(), token); }
  const profile = row.profile_id ? get('SELECT * FROM profiles WHERE id = ?', row.profile_id) : null;
  return { token, profile };
}

export function requireDevice(ctx) {
  if (!ctx.auth) throw new HttpError(401, 'Connexion requise');
  return ctx.auth;
}
export function requireProfile(ctx) {
  const a = requireDevice(ctx);
  if (!a.profile) throw new HttpError(403, 'Choisissez un profil');
  return a.profile;
}
export function requireAdmin(ctx) {
  const p = requireProfile(ctx);
  if (!p.is_admin) throw new HttpError(403, 'Réservé à l’administrateur');
  return p;
}

export function isSetup() {
  return !!getSetting('household_password');
}

// Limitation simple des tentatives (anti-force brute)
const attempts = new Map();
export function checkRate(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60000) { a.n = 0; a.t = now; }
  a.n++;
  attempts.set(key, a);
  if (a.n > 10) throw new HttpError(429, 'Trop de tentatives, réessayez dans quelques minutes');
}
export function resetRate(key) { attempts.delete(key); }

export function publicProfile(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.name, avatar: p.avatar, hasPin: !!p.pin_hash, isAdmin: !!p.is_admin,
    maxAge: p.max_age, isKids: p.max_age != null && p.max_age <= 12,
    subtitleLang: p.subtitle_lang, audioLang: p.audio_lang,
  };
}
