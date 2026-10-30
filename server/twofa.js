// Double authentification par e-mail : à la connexion d'un nouvel appareil avec le mot de passe du foyer,
// un code à 6 chiffres est envoyé à l'adresse de l'administrateur. Code valable 10 minutes, 5 essais par code.
// Limites par jour : 10 e-mails envoyés au total (5 par adresse IP) et 15 codes faux par adresse.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { HttpError } from './http.js';
import { sendMail, smtpOn } from './smtp.js';
import { logSecurity } from './security.js';

const TTL = 10 * 60000;
const pending = new Map(); // id -> { hash, expires, tries, ip, ua, sentAt }
const today = () => new Date().toISOString().slice(0, 10);

export const twofaEmail = () => String(getSetting('twofa_email', '') || '');
export const twofaOn = () => process.env.VENUS_DISABLE_2FA !== '1' && getSetting('twofa_mode', 'off') === 'new_device' && !!twofaEmail() && smtpOn();
export const maskEmail = (e) => String(e).replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '•'.repeat(Math.min(6, b.length)) + c);

function daily() {
  let d = getSetting('twofa_daily', null);
  if (!d || d.day !== today()) d = { day: today(), sent: 0, byIp: {}, fails: {} };
  return d;
}
const saveDaily = (d) => setSetting('twofa_daily', d);
const hashCode = (id, code) => crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');

async function deliver(id, entry, code) {
  const name = getSetting('server_name', 'Venus');
  const when = new Date().toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  await sendMail({
    to: twofaEmail(),
    subject: `${name} : code de connexion ${code}`,
    text: `Code de connexion à ${name} : ${code}\n\nDemandé le ${when} depuis ${entry.ip} (${entry.device}).\nIl est valable 10 minutes.\n\nSi ce n'est pas vous, ne donnez ce code à personne : quelqu'un connaît le mot de passe du foyer. Changez-le dans Réglages.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="margin:0 0 12px">Code de connexion à ${escapeHtml(name)}</h2><p style="font-size:32px;letter-spacing:8px;font-weight:800;margin:16px 0">${code}</p><p>Demandé le ${escapeHtml(when)} depuis <b>${escapeHtml(entry.ip)}</b> (${escapeHtml(entry.device)}). Valable 10 minutes.</p><p style="color:#a33">Si ce n’est pas vous, ne donnez ce code à personne : quelqu’un connaît le mot de passe du foyer. Changez-le dans Réglages.</p></div>`,
  });
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Après le bon mot de passe : crée un défi et envoie le code
export async function startChallenge(ip, device) {
  const d = daily();
  if (d.sent >= 10) { logSecurity('2fa-limite', ip, 'Limite de 10 e-mails de code par jour atteinte', 'high'); throw new HttpError(429, 'Trop de codes envoyés aujourd’hui. Réessayez demain.'); }
  if ((d.byIp[ip] || 0) >= 5) throw new HttpError(429, 'Trop de codes demandés depuis cet appareil aujourd’hui. Réessayez demain.');
  if ((d.fails[ip] || 0) >= 15) throw new HttpError(429, 'Trop de codes faux aujourd’hui depuis cet appareil. Réessayez demain.');
  const id = crypto.randomBytes(16).toString('base64url');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const entry = { hash: hashCode(id, code), expires: Date.now() + TTL, tries: 0, ip, device, sentAt: Date.now() };
  try { await deliver(id, entry, code); } catch (e) {
    logSecurity('2fa-envoi', ip, `Code non envoyé : ${e.message}`, 'warn');
    throw new HttpError(502, `Le code n’a pas pu être envoyé par e-mail (${e.message}). L’administrateur peut vérifier le serveur d’e-mails, ou couper la double authentification avec VENUS_DISABLE_2FA=1.`);
  }
  d.sent++; d.byIp[ip] = (d.byIp[ip] || 0) + 1; saveDaily(d);
  pending.set(id, entry);
  logSecurity('2fa-envoye', ip, `Code de connexion envoyé à ${maskEmail(twofaEmail())}`, 'info');
  return { challenge: id, email: maskEmail(twofaEmail()), expires: entry.expires };
}

// Renvoyer un code (au plus une fois par minute, dans les limites du jour)
export async function resendChallenge(id, ip) {
  const e = pending.get(String(id));
  if (!e || e.ip !== ip || e.expires < Date.now()) throw new HttpError(410, 'Ce code a expiré : reconnectez-vous avec le mot de passe');
  if (Date.now() - e.sentAt < 60000) throw new HttpError(429, 'Attendez une minute avant de redemander un code');
  pending.delete(String(id));
  return startChallenge(ip, e.device);
}

// Vérifie le code ; renvoie true si bon. Chaque défi : 5 essais. Chaque adresse : 15 codes faux par jour.
export function verifyChallenge(id, code, ip) {
  const e = pending.get(String(id || ''));
  if (!e || e.expires < Date.now()) { pending.delete(String(id || '')); throw new HttpError(410, 'Ce code a expiré : reconnectez-vous avec le mot de passe'); }
  if (e.ip !== ip) { logSecurity('2fa-ip', ip, 'Code saisi depuis une autre adresse que la demande', 'warn'); throw new HttpError(403, 'Code demandé depuis un autre appareil'); }
  const d = daily();
  if ((d.fails[ip] || 0) >= 15) throw new HttpError(429, 'Trop de codes faux aujourd’hui. Réessayez demain.');
  const ok = /^\d{6}$/.test(String(code || '')) && crypto.timingSafeEqual(Buffer.from(hashCode(id, String(code))), Buffer.from(e.hash));
  if (ok) { pending.delete(String(id)); return true; }
  e.tries++;
  d.fails[ip] = (d.fails[ip] || 0) + 1; saveDaily(d);
  if (e.tries >= 5) logSecurity('2fa-echec', ip, 'Code de connexion faux 5 fois : code annulé', 'high');
  if (e.tries >= 5) { pending.delete(String(id)); throw new HttpError(429, 'Trop d’essais : reconnectez-vous avec le mot de passe pour recevoir un nouveau code'); }
  throw new HttpError(401, `Code incorrect (${5 - e.tries} essai${5 - e.tries > 1 ? 's' : ''} restant${5 - e.tries > 1 ? 's' : ''})`);
}
setInterval(() => { const now = Date.now(); for (const [id, e] of pending) if (e.expires < now) pending.delete(id); }, 60000).unref();

export function twofaStats() { const d = daily(); return { sentToday: d.sent, failsToday: Object.values(d.fails).reduce((a, b) => a + b, 0) }; }
