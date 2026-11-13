// Webhooks : Venus envoie un POST JSON à vos adresses quand
// il se passe quelque chose (nouveauté, lecture, connexion, alerte de sécurité). Signature HMAC-SHA256
// dans l'en-tête « X-Venus-Signature » si un secret est donné. Compatible Home Assistant, n8n, Gotify…
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

export const HOOK_EVENTS = {
  'library.added': 'Nouveautés dans la médiathèque',
  'playback.start': 'Début d’une lecture',
  'playback.stop': 'Fin d’une lecture',
  'login.new_device': 'Nouvel appareil connecté',
  'security.alert': 'Alerte de sécurité',
  'task.failed': 'Tâche planifiée en échec',
  'recording.done': 'Enregistrement TV terminé',
};
// Webhooks enregistrés
export const listHooks = () => (getSetting('webhooks', []) || []);
// Enregistre la liste des webhooks
export const saveHooks = (list) => setSetting('webhooks', list);

// Envoie un événement à un webhook (signé si un secret est réglé)
async function send(h, event, data) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), server: getSetting('server_name', 'Venus'), data });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Venus-Webhook/1.0', 'X-Venus-Event': event };
  if (h.secret) headers['X-Venus-Signature'] = `sha256=${crypto.createHmac('sha256', h.secret).update(body).digest('hex')}`;
  const res = await fetch(h.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (res.status >= 400) throw new Error(`réponse ${res.status}`);
  return res.status;
}

// Envoie un événement à tous les webhooks abonnés
export function emitHook(event, data = {}) {
  const hooks = listHooks().filter((h) => h.enabled !== false && (h.events || []).includes(event));
  for (const h of hooks) {
    send(h, event, data).then(() => markHook(h.id, null)).catch((e) => { markHook(h.id, e.message); console.warn(`[webhook] ${h.name || h.url} : ${e.message}`); });
  }
}
// Note le résultat du dernier envoi d'un webhook
function markHook(id, error) {
  const list = listHooks();
  const h = list.find((x) => x.id === id);
  if (!h) return;
  h.lastAt = Date.now(); h.lastError = error;
  saveHooks(list);
}
// Envoie un événement de test
export const testHook = (h) => send(h, 'test', { message: 'Test depuis Venus' });
