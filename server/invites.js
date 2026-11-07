// Comptes par invitation : l'administrateur indique un nom et une adresse e-mail ; Venus crée le profil et envoie un
// lien personnel. En l'ouvrant (sur n'importe quel appareil, sans le mot de passe du foyer), la personne prépare son
// compte : nom, avatar, code PIN, langues ; l'appareil est ensuite connecté directement sur son profil.
// Le lien ne sert qu'une fois et expire au bout de 7 jours. Seule son empreinte est gardée dans la base.
import crypto from 'node:crypto';
import { db, all, get, run, getSetting } from './db.js';
import { sendMail, smtpOn } from './smtp.js';

const TTL = 7 * 864e5;
db.exec(`CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,                 -- empreinte SHA-256 du lien
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT, created_by TEXT, created_at INTEGER, expires_at INTEGER, used_at INTEGER, sent_at INTEGER, send_error TEXT
)`);
const hashOf = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export function baseUrl(req) {
  const pub = String(getSetting('public_url', '') || '').replace(/\/+$/, '');
  if (pub) return pub;
  const proto = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
  return `${proto}://${String(req.headers.host || 'localhost').replace(/[^\w.:[\]-]/g, '')}`;
}

// Nouveau lien pour un profil (l'ancien, s'il existe, ne marche plus)
export async function createInvite(profile, email, by, base) {
  const token = crypto.randomBytes(24).toString('base64url');
  run('DELETE FROM invites WHERE profile_id = ? AND used_at IS NULL', profile.id);
  run('INSERT INTO invites(token, profile_id, email, created_by, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)', hashOf(token), profile.id, email, by, Date.now(), Date.now() + TTL);
  const link = `${base}/invitation/${token}`;
  let sent = false, error = null;
  if (smtpOn()) {
    const server = getSetting('server_name', 'Venus');
    try {
      await sendMail({
        to: email,
        subject: `${server} : ${by} vous invite`,
        text: `Bonjour ${profile.name},\n\n${by} vous a créé un compte sur ${server}, pour regarder les films, séries et animés de la maison.\n\nPréparez votre compte (nom, photo, code PIN) avec ce lien personnel, valable 7 jours :\n${link}\n\nSi vous n'attendiez pas ce message, ignorez-le.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;background:#151320;color:#eee;border-radius:16px">
          <h2 style="margin:0 0 12px">Bienvenue sur ${esc(server)}</h2>
          <p>Bonjour ${esc(profile.name)},</p>
          <p><b>${esc(by)}</b> vous a créé un compte pour regarder les films, séries et animés de la maison.</p>
          <p style="margin:24px 0"><a href="${esc(link)}" style="background:#f4c98a;color:#151320;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">Préparer mon compte</a></p>
          <p style="color:#aaa;font-size:13px">Lien personnel, valable 7 jours et une seule fois. Si vous n'attendiez pas ce message, ignorez-le.</p>
          <p style="color:#777;font-size:12px;word-break:break-all">${esc(link)}</p></div>`,
      });
      sent = true;
    } catch (e) { error = e.message; }
  } else error = 'serveur d’e-mails non configuré (Réglages → Sécurité)';
  run('UPDATE invites SET sent_at = ?, send_error = ? WHERE token = ?', sent ? Date.now() : null, error, hashOf(token));
  return { link, sent, error };
}

export function inviteFor(token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(String(token || ''))) return null;
  const inv = get('SELECT * FROM invites WHERE token = ?', hashOf(token));
  if (!inv || inv.used_at || inv.expires_at < Date.now()) return null;
  const p = get('SELECT * FROM profiles WHERE id = ?', inv.profile_id);
  return p ? { inv, profile: p } : null;
}
export const markUsed = (token) => run('UPDATE invites SET used_at = ? WHERE token = ?', Date.now(), hashOf(token));
export function listInvites() {
  return all(`SELECT i.profile_id, i.email, i.created_by, i.created_at, i.expires_at, i.used_at, i.sent_at, i.send_error, p.name
    FROM invites i JOIN profiles p ON p.id = i.profile_id ORDER BY i.created_at DESC LIMIT 100`).map((r) => ({
    profileId: r.profile_id, name: r.name, email: r.email, by: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at,
    usedAt: r.used_at, sentAt: r.sent_at, error: r.send_error, state: r.used_at ? 'used' : r.expires_at < Date.now() ? 'expired' : 'pending',
  }));
}
export const cancelInvites = (profileId) => run('DELETE FROM invites WHERE profile_id = ? AND used_at IS NULL', profileId);
