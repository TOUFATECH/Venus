// Connexion des utilisateurs de Venus par Odin (OpenID Connect, code + PKCE) et SSO du poste.
//
// - Navigateur : Venus envoie vers Odin (/sso/autoriser). Si une session Odin existe déjà dans ce navigateur, Odin
//   renvoie tout de suite, sans écran ; sinon le portail Persona demande identifiant et mot de passe. Au retour
//   (/auth/odin/retour), Venus échange le code (avec la preuve PKCE), vérifie le jeton d'identité (signature ES256 avec la
//   clé publique d'Odin, émetteur, destinataire, date, nonce), relit les droits (/sso/infos), puis ouvre la session
//   Venus du profil de cette personne (créé à sa première venue). Sans droit sur Venus : le message d'Odin, tel quel.
// - SSO du poste : un navigateur de CETTE machine (adresse 127.0.0.1) et un jeton de poste dans le coffre du système
//   → échange (/sso/echange), sans mot de passe ni écran.
// - Les comptes de Venus (mot de passe du foyer, code à 6 chiffres) restent possibles ; en mode « odin-seul »,
//   seulement quand Odin ne répond pas.
import crypto from 'node:crypto';
import os from 'node:os';
import { get, all, run, getSetting, setSetting } from './db.js';
import { linkConf, call, APP, odinMessage } from './odin-link.js';
import * as vault from './odin-vault.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const err = (status, message, code) => Object.assign(new Error(message), { status, code });

/** La connexion par Odin est-elle proposée ? (Odin réglé et mode différent de « local ») */
export function ssoOn() { const c = linkConf(); return Boolean(c.url && c.mode !== 'local'); }

// ---------------------------------------------------------------- Odin joignable ? (gardé 30 s)
let reach = { at: 0, ok: false };
export async function odinReachable() {
  if (Date.now() - reach.at < 30_000) return reach.ok;
  let ok = false;
  try { const r = await call('/.well-known/openid-configuration', { timeout: 3000 }); ok = r.status === 200; } catch { ok = false; }
  reach = { at: Date.now(), ok };
  return ok;
}
/** Les comptes de Venus sont-ils permis maintenant ? Rend null si oui, sinon le message. */
export async function localBlocked() {
  const c = linkConf();
  if (!c.url || c.mode !== 'odin-seul') return null;
  if (!(await odinReachable())) return null;
  return 'Ici, on se connecte avec son compte Odin (bouton « Se connecter avec Odin »). Le mot de passe du foyer ne sert que si Odin ne répond pas.';
}

// ---------------------------------------------------------------- découverte et clés publiques (gardées 5 min)
let disco = { at: 0, v: null }, jwks = { at: 0, keys: [] };
async function discovery() {
  if (disco.v && Date.now() - disco.at < 300_000) return disco.v;
  const r = await call('/.well-known/openid-configuration', { timeout: 6000 });
  const j = r.json();
  if (r.status !== 200 || !j || !j.issuer) throw err(502, 'Odin ne répond pas comme un fournisseur d’identité (mets Odin à jour).');
  disco = { at: Date.now(), v: j };
  return j;
}
async function keys(force = false) {
  if (!force && jwks.keys.length && Date.now() - jwks.at < 300_000) return jwks.keys;
  const r = await call('/sso/cles', { timeout: 6000 });
  const j = r.json();
  jwks = { at: Date.now(), keys: (j && Array.isArray(j.keys) ? j.keys : []) };
  return jwks.keys;
}
export function forgetOdinCache() { disco = { at: 0, v: null }; jwks = { at: 0, keys: [] }; reach = { at: 0, ok: false }; }

/** Vérifie un jeton JWT d'Odin (§ 4) : ES256 seulement, clé `kid`, signature, émetteur, destinataire, date, nonce. */
export async function verifyJwt(jwt, { issuer, audience = APP, nonce } = {}) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw err(401, 'Jeton d’Odin illisible');
  let h, p;
  try { h = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw err(401, 'Jeton d’Odin illisible'); }
  if (h.alg !== 'ES256') throw err(401, 'Jeton d’Odin refusé (signature attendue : ES256)');
  let k = (await keys()).find((x) => x.kid === h.kid);
  if (!k) k = (await keys(true)).find((x) => x.kid === h.kid);
  if (!k) throw err(401, 'Jeton d’Odin signé par une clé inconnue');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.x, y: k.y }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw err(401, 'Signature du jeton d’Odin fausse');
  if (issuer && p.iss !== issuer) throw err(401, 'Jeton d’Odin venu d’une autre adresse que celle réglée');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(audience)) throw err(401, 'Jeton d’Odin fait pour une autre appli');
  if (!(Number(p.exp) * 1000 > Date.now() - 60_000)) throw err(401, 'Jeton d’Odin expiré');
  if (nonce !== undefined && p.nonce !== nonce) throw err(401, 'Jeton d’Odin rejoué (nonce différent)');
  return p;
}

// ---------------------------------------------------------------- le profil Venus d'une personne d'Odin
/** Profil de la personne : déjà lié (identifiant Odin), sinon même e-mail, sinon créé. */
export function profileFor(person) {
  const sub = String(person.sub || '');
  if (!/^[\w-]{1,64}$/.test(sub)) throw err(502, 'Odin n’a pas donné d’identifiant de personne');
  const links = getSetting('odin_comptes', {}) || {};
  let p = links[sub] ? get('SELECT * FROM profiles WHERE id = ?', Number(links[sub])) : null;
  const email = String(person.email || '').trim().toLowerCase();
  if (!p && email) p = get('SELECT * FROM profiles WHERE lower(email) = ?', email);
  let created = false;
  if (!p) {
    const groups = Array.isArray(person.groups) ? person.groups.map(String) : [];
    const name = String(person.name || person.preferred_username || 'Odin').trim().slice(0, 30) || 'Odin';
    const kid = groups.some((g) => /^enfants?$/i.test(g));
    const r = run('INSERT INTO profiles(name, avatar, is_admin, max_age, email, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      name, crypto.randomInt(12), groups.includes('admin') ? 1 : 0, kid ? 12 : null, email || null, Date.now());
    p = get('SELECT * FROM profiles WHERE id = ?', Number(r.lastInsertRowid));
    created = true;
  }
  if (String(links[sub]) !== String(p.id)) setSetting('odin_comptes', { ...links, [sub]: p.id });
  if (email && !p.email) run('UPDATE profiles SET email = ? WHERE id = ?', email, p.id);
  return { profile: p, created };
}
/** Profils liés à une personne d'Odin (pour les montrer dans les réglages). */
export function linkedProfiles() {
  const links = getSetting('odin_comptes', {}) || {};
  const ids = new Set(Object.values(links).map(Number));
  return all('SELECT id FROM profiles').filter((r) => ids.has(r.id)).map((r) => r.id);
}

// ---------------------------------------------------------------- flux du navigateur (code + PKCE)
const pending = new Map(); // state -> { verifier, nonce, redirect, at, back }
const PENDING_TTL = 10 * 60_000;
function prune() { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > PENDING_TTL) pending.delete(k); while (pending.size > 500) pending.delete(pending.keys().next().value); }

/** Adresse d'Odin où envoyer le navigateur. `origin` : l'origine de Venus vue par le navigateur. */
export async function authorizeUrl(origin, { silent = false, hint = '' } = {}) {
  if (!ssoOn()) throw err(400, 'La connexion par Odin n’est pas réglée (Réglages → Odin)');
  const d = await discovery();
  prune();
  const state = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48)), nonce = b64u(crypto.randomBytes(16));
  const redirect = `${origin}/auth/odin/retour`;
  pending.set(state, { verifier, nonce, redirect, at: Date.now(), issuer: d.issuer });
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  // Le navigateur va à l'adresse d'Odin réglée dans Venus (la même que celle du serveur)
  const base = linkConf().url;
  const q = new URLSearchParams({ response_type: 'code', client_id: APP, redirect_uri: redirect, scope: 'openid profile email groups', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' });
  if (silent) q.set('prompt', 'none');
  if (hint) q.set('login_hint', String(hint).slice(0, 100));
  return { url: `${base}/sso/autoriser?${q}`, state };
}

/**
 * Retour d'Odin : rend { profile, created, person } ou lève une erreur avec le message à montrer.
 * `cookieState` : le state gardé dans un cookie de ce navigateur (anti-CSRF de connexion).
 */
export async function finish(params, cookieState) {
  const state = String(params.get('state') || '');
  const p = pending.get(state);
  if (!state || !p || state !== cookieState) throw err(400, 'Connexion par Odin expirée ou ouverte dans un autre navigateur : recommence.', 'state');
  pending.delete(state);
  if (Date.now() - p.at > PENDING_TTL) throw err(400, 'Connexion par Odin expirée : recommence.', 'state');
  const iss = params.get('iss');
  if (iss && p.issuer && iss.replace(/\/+$/, '') !== p.issuer.replace(/\/+$/, '')) throw err(400, 'Réponse venue d’un autre Odin que celui réglé : connexion refusée.', 'iss');
  const error = params.get('error');
  if (error) {
    // Pas le droit : le message d'Odin tel quel. Pas de session Odin (prompt=none) : on le dit simplement.
    if (error === 'login_required' || error === 'interaction_required') throw err(401, '', 'login_required');
    throw err(error === 'access_denied' ? 403 : 400, String(params.get('error_description') || 'Odin a refusé la connexion.').slice(0, 500), error);
  }
  const code = params.get('code');
  if (!code) throw err(400, 'Odin n’a pas renvoyé de code de connexion : recommence.');
  const r = await call('/sso/jeton', { method: 'POST', timeout: 15000, body: { grant_type: 'authorization_code', code, redirect_uri: p.redirect, client_id: APP, code_verifier: p.verifier } });
  const j = r.json() || {};
  if (r.status !== 200 || !j.access_token || !j.id_token) throw err(r.status === 403 ? 403 : 401, odinMessage(r, 'Odin a refusé le code de connexion : recommence.'), j.error);
  const id = await verifyJwt(j.id_token, { issuer: p.issuer, nonce: p.nonce });
  const person = await whoIs(j.access_token);
  if (person.sub !== id.sub) throw err(401, 'Réponse d’Odin incohérente (personne différente) : connexion refusée.');
  if (j.refresh_token) revoke(j.refresh_token);
  return { ...profileFor(person), person };
}

/** /sso/infos : la personne et ses droits ; sans droit sur Venus, le message d'Odin. */
async function whoIs(accessToken) {
  const r = await call('/sso/infos', { timeout: 10000, headers: { authorization: `Bearer ${accessToken}` } });
  const j = r.json() || {};
  if (r.status === 403) throw err(403, odinMessage(r, 'Tu n’as pas accès à Venus.'), 'refuse');
  if (r.status !== 200 || !j.sub) throw err(401, odinMessage(r, 'Odin ne confirme pas la connexion : recommence.'));
  if (Array.isArray(j.applis) && !j.applis.includes(APP)) throw err(403, odinMessage(j, `Tu n’as pas accès à Venus. Demande au propriétaire d’Odin de te l’ouvrir dans Persona.`), 'refuse');
  return j;
}
function revoke(token) { call('/sso/revoquer', { method: 'POST', timeout: 5000, body: { token, token_type_hint: 'refresh_token' } }).catch(() => {}); }

// ---------------------------------------------------------------- SSO du poste (navigateur de cette machine)
const LOOP = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
export const isLoopback = (ip) => LOOP.test(String(ip || ''));
/** Un jeton de poste est-il dans le coffre de cette machine ? (seulement pour un navigateur de cette machine) */
export async function posteAvailable(ip) {
  if (!isLoopback(ip) || !ssoOn()) return false;
  const c = linkConf();
  return Boolean(await vault.read(`Odin SSO ${c.issuer}`).catch(() => null));
}
export async function posteLogin(ip) {
  if (!isLoopback(ip)) throw err(403, 'Connexion du poste : seulement depuis cette machine');
  const c = linkConf();
  const jeton = await vault.read(`Odin SSO ${c.issuer}`).catch(() => null);
  if (!jeton) throw err(404, 'Pas de session Odin sur ce poste', 'pas_de_poste');
  const appareil = { id: await vault.deviceId(), nom: `Venus (${os.hostname()})`.slice(0, 60), plateforme: { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform] || 'autre' };
  const r = await call('/sso/echange', { method: 'POST', timeout: 10000, body: { jeton_poste: jeton, appli: APP, appareil, utilisateur: os.userInfo().username } });
  const j = r.json() || {};
  if (r.status === 401 && j.code === 'jeton_poste_invalide') { await vault.clear(`Odin SSO ${c.issuer}`).catch(() => {}); throw err(401, odinMessage(r, 'La session Odin de ce poste n’est plus valable.'), j.code); }
  if (r.status === 403) throw err(403, odinMessage(r, 'Tu n’as pas accès à Venus.'), 'refuse');
  if (r.status !== 200 || !j.access_token) throw err(502, odinMessage(r, `Odin refuse l’échange (${r.status})`));
  const person = await whoIs(j.access_token);
  if (j.refresh_token) revoke(j.refresh_token);
  return { ...profileFor(person), person };
}

// ---------------------------------------------------------------- ticket à usage unique (retour d'Odin → page de Venus)
// Le jeton de session de Venus ne passe jamais dans une adresse : la page reçoit un ticket (60 s, une fois) dans le
// fragment (#odin=…), et l'échange contre le jeton par une requête POST.
const tickets = new Map();
export function issueTicket(token) {
  for (const [k, v] of tickets) if (Date.now() - v.at > 60_000) tickets.delete(k);
  const t = b64u(crypto.randomBytes(24));
  tickets.set(t, { token, at: Date.now() });
  return t;
}
export function takeTicket(t) {
  const v = tickets.get(String(t || ''));
  tickets.delete(String(t || ''));
  if (!v || Date.now() - v.at > 60_000) return null;
  return v.token;
}

