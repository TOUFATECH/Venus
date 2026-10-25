// Notifications : « Nouveau dans Venus », « Ton envie est arrivée »…
//  - sur le téléphone ou l'ordinateur, même appli fermée (Web Push ; nécessite Venus en HTTPS)
//  - dans l'application ouverte (message en direct)
//  - et au choix : ntfy (appli gratuite, marche aussi sans HTTPS), Discord, Telegram
// Web Push est fait à la main avec node:crypto (VAPID + chiffrement aes128gcm, RFC 8291 / 8292) : aucune dépendance.
import crypto from 'node:crypto';
import { db, all, run, getSetting, setSetting } from './db.js';
import { control, logActivity } from './activity.js';

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  device TEXT, created_at INTEGER
)`);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// ------------------------------------------------------------------ clés VAPID (créées une fois)
function vapid() {
  let v = getSetting('vapid', null);
  if (!v || !v.jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    v = { jwk, pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
    setSetting('vapid', v);
  }
  return v;
}
export const vapidPublicKey = () => vapid().pub;

function vapidAuth(endpoint) {
  const v = vapid();
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: getSetting('push_contact', 'mailto:venus@localhost') }));
  const key = crypto.createPrivateKey({ key: v.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${v.pub}`;
}

// Chiffrement du message pour le navigateur (aes128gcm)
export function encrypt(sub, plaintext) {
  const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const hk = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
  const ikm = hk(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head.writeUInt8(65, 20);
  return Buffer.concat([head, asPub, enc]);
}

async function sendPush(sub, msg) {
  const body = encrypt(sub, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: { TTL: '86400', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: 'normal', Authorization: vapidAuth(sub.endpoint) },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404 || res.status === 410) run('DELETE FROM push_subs WHERE endpoint = ?', sub.endpoint);
  else if (!res.ok) throw new Error(`push ${res.status}`);
}

export function savePushSub(profileId, sub, device) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Abonnement invalide');
  run(`INSERT INTO push_subs(endpoint, p256dh, auth, profile_id, device, created_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, profile_id=excluded.profile_id`,
  sub.endpoint, sub.keys.p256dh, sub.keys.auth, profileId, String(device || '').slice(0, 200), Date.now());
}
export const removePushSub = (endpoint) => run('DELETE FROM push_subs WHERE endpoint = ?', endpoint);
export const pushCount = () => all('SELECT COUNT(*) n FROM push_subs')[0].n;

// ------------------------------------------------------------------ autres canaux
export function channels() {
  return {
    ntfyServer: getSetting('ntfy_server', 'https://ntfy.sh'), ntfyTopic: getSetting('ntfy_topic', ''),
    discord: getSetting('discord_webhook', ''), telegramToken: getSetting('telegram_token', ''), telegramChat: getSetting('telegram_chat', ''),
    publicUrl: getSetting('public_url', ''),
  };
}
const link = (url) => { const base = String(channels().publicUrl || '').replace(/\/+$/, ''); return base && url ? `${base}/#${url}` : null; };

async function toNtfy(msg) {
  const c = channels();
  if (!c.ntfyTopic) return;
  // En-têtes HTTP en ASCII : le titre accentué est encodé (RFC 2047, compris par ntfy)
  const headers = { Title: /[^\x20-\x7e]/.test(msg.title) ? `=?UTF-8?B?${Buffer.from(msg.title).toString('base64')}?=` : msg.title, Tags: 'film_projector' };
  const click = link(msg.url);
  if (click) headers.Click = click;
  await fetch(`${String(c.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(c.ntfyTopic)}`, { method: 'POST', body: msg.body, headers, signal: AbortSignal.timeout(15000) });
}
async function toDiscord(msg) {
  const c = channels();
  if (!c.discord) return;
  await fetch(c.discord, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ username: 'Venus', embeds: [{ title: msg.title, description: msg.body, url: link(msg.url) || undefined, color: 0xf4cf9c }] }) });
}
async function toTelegram(msg) {
  const c = channels();
  if (!c.telegramToken || !c.telegramChat) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const url = link(msg.url);
  await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ chat_id: c.telegramChat, parse_mode: 'HTML', disable_web_page_preview: true, text: `<b>${esc(msg.title)}</b>\n${esc(msg.body)}${url ? `\n${esc(url)}` : ''}` }) });
}

// ------------------------------------------------------------------ envoi
// profileId : seulement ce profil (ses appareils) ; sinon tout le foyer. Les canaux partagés (ntfy, Discord…)
// ne reçoivent que les messages pour tout le foyer.
export async function notify(msg, { profileId = null } = {}) {
  const errors = [];
  // Dans l'application ouverte (les nouveautés du foyer y sont déjà annoncées en direct)
  if (profileId) control.emit('cmd', { profileId, cmd: 'notify', text: msg.body, title: msg.title, url: msg.url });
  const subs = profileId ? all('SELECT * FROM push_subs WHERE profile_id = ?', profileId) : all('SELECT * FROM push_subs');
  await Promise.all(subs.map((s) => sendPush(s, { title: msg.title, body: msg.body, url: msg.url || '/', tag: msg.tag || 'venus' }).catch((e) => errors.push(`push : ${e.message}`))));
  if (!profileId) {
    for (const [name, fn] of [['ntfy', toNtfy], ['Discord', toDiscord], ['Telegram', toTelegram]]) {
      try { await fn(msg); } catch (e) { errors.push(`${name} : ${e.message}`); }
    }
  }
  if (errors.length) console.warn('[notifications]', errors.join(' ; '));
  return { errors, push: subs.length };
}

// Nouveautés de la médiathèque, regroupées (un seul message par analyse)
let pendingAdds = [], addTimer = null;
export function libraryAdded(names) {
  if (String(getSetting('notify_new', '1')) === '0' || !names || !names.length) return;
  pendingAdds.push(...names);
  clearTimeout(addTimer);
  addTimer = setTimeout(() => {
    const list = [...new Set(pendingAdds)];
    pendingAdds = [];
    const body = list.length === 1 ? list[0] : `${list.slice(0, 4).join(', ')}${list.length > 4 ? ` et ${list.length - 4} autres` : ''}`;
    notify({ title: list.length === 1 ? 'Nouveau dans Venus' : `${list.length} nouveautés dans Venus`, body, url: '/', tag: 'new' }).catch(() => {});
    logActivity('notify', `Notification envoyée : ${body}`);
  }, 60000);
}
