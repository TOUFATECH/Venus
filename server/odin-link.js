// Le lien de Venus avec Odin (connexion unique et sauvegarde) : Réglages → Odin.
//
// L'administrateur donne l'IP et le port d'Odin, l'identifiant (e-mail) et le mot de passe de son compte Persona (les
// identités d'Odin). Venus s'en sert UNE fois (POST /sso/connexion) : il garde seulement le jeton de renouvellement que
// rend Odin, chiffré dans la base comme les autres secrets (db.js), jamais le mot de passe. Les jetons d'accès (15 min)
// en sont tirés au besoin ; chaque renouvellement rend un nouveau jeton de renouvellement (rotation), aussitôt gardé.
// Contrat : docs/sso-protocole.md d'Odin (§ 4 jetons, § 6 connexion d'un programme, § 7 sauvegardes, § 9 certificat).
import os from 'node:os';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { odinRequest, probe, baseOf, DEFAULT_PORT } from './odin-net.js';
import * as vault from './odin-vault.js';

export const APP = 'venus';
const K = {
  host: 'odin_sso_host', port: 'odin_sso_port', url: 'odin_sso_url', pin: 'odin_sso_pin', email: 'odin_sso_email',
  refresh: 'odin_sso_refresh', device: 'odin_sso_appareil', who: 'odin_sso_personne', state: 'odin_sso_etat', mode: 'odin_sso_mode',
  issuer: 'odin_sso_issuer',
};
export const LINK_KEYS = Object.values(K);

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

/** Réglages du lien (sans aucun jeton). */
export function linkConf() {
  const mode = getSetting(K.mode, 'odin');
  return {
    host: String(getSetting(K.host, '') || ''), port: Number(getSetting(K.port, DEFAULT_PORT)) || DEFAULT_PORT,
    url: String(getSetting(K.url, '') || ''), issuer: String(getSetting(K.issuer, '') || getSetting(K.url, '') || ''), pin: String(getSetting(K.pin, '') || ''),
    email: String(getSetting(K.email, '') || ''), who: getSetting(K.who, null),
    // Connexion des utilisateurs : 'odin' (par Odin, comptes de Venus aussi), 'odin-seul' (comptes de Venus seulement
    // quand Odin ne répond pas), 'local' (pas de connexion par Odin)
    mode: ['odin', 'odin-seul', 'local'].includes(mode) ? mode : 'odin',
  };
}
const refreshToken = () => String(getSetting(K.refresh, '') || '');
export const linked = () => Boolean(linkConf().url && refreshToken());
export const linkState = () => getSetting(K.state, null) || {};
export function setLinkState(patch) { const s = { ...linkState(), ...patch, at: Date.now() }; setSetting(K.state, s); return s; }

/** Identifiant de cette installation pour Odin (« appareil », § 4 : 8 à 64 caractères, gardé une fois pour toutes). */
export function device() {
  let id = String(getSetting(K.device, '') || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = crypto.randomBytes(16).toString('base64url'); setSetting(K.device, id); }
  const pf = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform] || 'autre';
  return { id, nom: `Serveur Vénus (${os.hostname()})`.slice(0, 60), plateforme: pf };
}

/** Message d'Odin, à montrer tel quel (§ 0 : `message`, ou `error_description` pour la norme OAuth). */
export function odinMessage(r, fallback) {
  const j = r && typeof r.json === 'function' ? r.json() : r;
  const m = j && (j.message || j.error_description || j.erreur || (typeof j.error === 'string' && j.error.includes(' ') ? j.error : ''));
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 500) : fallback;
}
const codeOf = (r) => { const j = r.json(); return (j && (j.code || j.error)) || ''; };

/** Requête vers l'Odin relié (adresse et certificat épinglé). */
export function call(path, opts = {}) {
  const c = linkConf();
  if (!c.url) throw err(400, 'Odin n’est pas relié : Réglages → Odin');
  return odinRequest(`${c.url}${path}`, { pin: c.pin, ...opts });
}

/** « Tester » : Odin répond-il à cette adresse ? Rend l'adresse (issuer) et l'empreinte du certificat présenté. */
export async function testAddress(host, port) {
  const c = linkConf();
  const same = c.host === String(host).trim() && Number(c.port) === Number(port);
  const r = await probe(host, port, { pin: same ? c.pin : '' });
  if (!r.info || !r.info.issuer) throw err(502, 'Cet Odin ne connaît pas encore la connexion unique : mets Odin à jour.', 'sso_absent');
  const info = r.info.odin && typeof r.info.odin === 'object' ? r.info.odin : r.info;
  return { url: String(r.info.issuer).replace(/\/+$/, ''), base: r.url, fingerprint: r.fingerprint, nom: info.nom || 'Odin', version: info.version || '' };
}

/** Erreur claire à partir d'une réponse d'Odin (§ 0). */
function failure(r, what) {
  const code = codeOf(r);
  const m = odinMessage(r, '');
  if (r.status === 403) return err(403, m || 'Odin refuse : ce compte n’a pas accès à Venus.', code || 'refuse');
  if (r.status === 401 && code === 'code_requis') return err(401, m || 'Odin demande le code de double authentification (6 chiffres).', code);
  if (r.status === 401) return err(401, m || 'Identifiant ou mot de passe incorrect.', code || 'identifiants');
  if (r.status === 423 || r.status === 429) return err(429, m || 'Trop d’essais : attends un peu avant de recommencer.', code);
  if (r.status === 404 && !m) return err(502, 'Cet Odin ne connaît pas encore la connexion unique : mets Odin à jour.', 'sso_absent');
  if (r.status === 503) return err(503, m || 'Odin n’est pas prêt (ses applis ne tournent pas) : réessaie dans un moment.', code);
  return err(502, m || `${what} : Odin répond ${r.status}`, code);
}

/**
 * Se connecter à Odin avec identifiant + mot de passe (+ code). Rend { url, fingerprint, nom, tokens, personne }.
 * Ne garde rien : sert au lien (Réglages → Odin) et à la restauration d'une nouvelle installation.
 */
export async function login({ host, port = DEFAULT_PORT, email, password, code }) {
  baseOf(host, port);
  email = String(email || '').trim();
  if (!email || email.length > 200) throw err(400, 'Indique l’adresse e-mail (ou l’identifiant) de ton compte Odin');
  if (!password) throw err(400, 'Indique le mot de passe de ton compte Odin');
  if (code && !/^\d{6}$/.test(String(code).replace(/\s/g, ''))) throw err(400, 'Le code de double authentification fait 6 chiffres');
  const a = await testAddress(host, port);
  const body = { identifiant: email, motdepasse: String(password), appli: APP, appareil: device(), ...(code ? { code: String(code).replace(/\s/g, '') } : {}) };
  const r = await odinRequest(`${a.base}/sso/connexion`, { method: 'POST', body, pin: a.fingerprint });
  const j = r.json() || {};
  if (r.status !== 200 || !j.access_token) throw failure(r, 'Connexion');
  return { ...a, tokens: j, personne: j.personne || {} };
}

/** Relier Venus à Odin (Réglages → Odin) : `onPassword` reçoit le mot de passe une fois (clé des sauvegardes). */
export async function link(input, { onPassword } = {}) {
  const r = await login(input);
  keepLink(r, input);
  if (onPassword) await onPassword(String(input.password), String(input.email || '').trim());
  await openPoste(r).catch(() => {});
  return status();
}
/** Garde le lien après une connexion réussie (adresse, certificat, personne, jeton de renouvellement chiffré). */
export function keepLink(r, { host, port = DEFAULT_PORT, email }) {
  setSetting(K.host, String(host).trim()); setSetting(K.port, Number(port) || DEFAULT_PORT);
  setSetting(K.url, r.base); setSetting(K.pin, r.fingerprint || ''); setSetting(K.email, String(email || '').trim());
  setSetting(K.refresh, String(r.tokens.refresh_token || ''));
  const p = r.personne || {};
  setSetting(K.who, { sub: String(p.sub || ''), nom: String(p.name || p.preferred_username || ''), identifiant: String(p.preferred_username || ''), email: String(p.email || ''), groupes: Array.isArray(p.groups) ? p.groups.slice(0, 20).map(String) : [] });
  setSetting(K.issuer, r.url);
  app = { token: String(r.tokens.access_token || ''), until: Date.now() + Number(r.tokens.expires_in || 900) * 1000 };
  setLinkState({ ok: true, message: r.tokens.refresh_token ? 'Relié à Odin' : 'Relié, mais Odin n’a pas donné de jeton de renouvellement : la sauvegarde s’arrêtera dans 15 minutes.', nom: r.nom });
}

/** SSO du poste (§ 6) : seulement si le coffre du système est là (pas sous Docker ni sur un serveur sans session). */
async function openPoste(r) {
  if (!(await vault.available())) return false;
  const d = await vault.deviceId();
  const x = await odinRequest(`${r.base}/sso/poste`, { method: 'POST', pin: r.fingerprint, headers: { authorization: `Bearer ${r.tokens.access_token}` }, body: { appareil: { ...device(), id: d }, utilisateur: os.userInfo().username } });
  const j = x.json() || {};
  if (x.status !== 200 || !j.jeton_poste) return false;
  await vault.store(`Odin SSO ${r.url}`, String(j.jeton_poste), r.url);
  return true;
}

/** Délier : la session est coupée chez Odin (si possible) puis oubliée ici. */
export async function unlink() {
  const t = refreshToken();
  if (t) { try { await call('/sso/revoquer', { method: 'POST', body: { token: t, token_type_hint: 'refresh_token' }, timeout: 5000 }); } catch { /* Odin absent : oublié quand même */ } }
  setSetting(K.refresh, ''); setSetting(K.who, null); forgetAppToken();
  setLinkState({ ok: false, message: 'Pas relié' });
  return status();
}

export function setMode(mode) {
  if (!['odin', 'odin-seul', 'local'].includes(mode)) throw err(400, 'Choix de connexion inconnu');
  setSetting(K.mode, mode);
}

// ---------------------------------------------------------------- jeton d'accès (15 min), renouvelé tout seul
let app = { token: '', until: 0 };
let renewing = null;
export function forgetAppToken() { app = { token: '', until: 0 }; }
/** Jeton d'accès de l'appli « venus ». Un seul renouvellement à la fois (rotation : un ancien jeton réutilisé
 *  ferait couper toute la session par Odin). */
export async function appToken({ fresh = false } = {}) {
  if (!fresh && app.token && Date.now() < app.until - 60_000) return app.token;
  if (renewing) return renewing;
  renewing = (async () => {
    const t = refreshToken();
    if (!t) throw err(400, 'Odin n’est pas relié : Réglages → Odin');
    const r = await call('/sso/jeton', { method: 'POST', timeout: 15000, body: { grant_type: 'refresh_token', refresh_token: t, client_id: APP, appareil: device().id } });
    const j = r.json() || {};
    if (r.status !== 200 || !j.access_token) {
      const e = failure(r, 'Renouvellement');
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        // Session révoquée, expirée ou droit retiré : on le dit, il faut relier de nouveau
        const m = r.status === 403 ? e.message : `${odinMessage(r, 'Odin ne reconnaît plus Venus')} Relie Venus de nouveau (Réglages → Odin).`;
        setLinkState({ ok: false, message: m });
        if (r.status !== 403) setSetting(K.refresh, '');
        throw err(r.status === 403 ? 403 : 401, m, e.code);
      }
      throw e;
    }
    if (j.refresh_token) setSetting(K.refresh, String(j.refresh_token));
    app = { token: String(j.access_token), until: Date.now() + Number(j.expires_in || 900) * 1000 };
    return app.token;
  })();
  try { return await renewing; } finally { renewing = null; }
}
/** Requête avec le jeton d'accès ; un jeton refusé (401) est renouvelé une fois. */
export async function authed(path, opts = {}) {
  const go = async (fresh) => call(path, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${await appToken({ fresh })}` } });
  let r = await go(false);
  if (r.status === 401) r = await go(true);
  return r;
}
/** Requête avec un jeton d'accès donné (restauration d'une nouvelle installation, avant tout lien gardé). */
export const withToken = (base, pin, token) => (path, opts = {}) => odinRequest(`${base}${path}`, { pin, ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${token}` } });

/** État affiché dans Réglages → Odin (jamais un jeton ni le mot de passe). */
export function status() {
  const c = linkConf();
  return { host: c.host, port: c.port, url: c.url, email: c.email, linked: linked(), who: c.who, mode: c.mode, pinned: Boolean(c.pin), fingerprint: c.pin ? `${c.pin.slice(0, 8)}…${c.pin.slice(-8)}` : '', state: linkState() };
}

/** Vérifie que le lien marche (renouvelle le jeton). */
export async function check() {
  try { await appToken({ fresh: true }); return setLinkState({ ok: true, message: 'Relié à Odin' }); }
  catch (e) { return setLinkState({ ok: false, message: e.message }); }
}
