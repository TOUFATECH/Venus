// Séances à plusieurs (lecture synchronisée, chat, réactions) et télécommande téléphone → TV.
// Tout passe par des flux d'évènements (SSE) : aucun WebSocket, aucune dépendance.
import crypto from 'node:crypto';
import { Router, HttpError, readBody, sendJson } from './http.js';
import { get } from './db.js';
import { requireProfile } from './auth.js';

export const together = new Router();

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I : lisible à voix haute
const code = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');

function sse(ctx) {
  ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  ctx.res.write('retry: 3000\n\n');
  const send = (type, data) => ctx.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => ctx.res.write(': ping\n\n'), 20000);
  return { send, onClose: (fn) => ctx.req.on('close', () => { clearInterval(ping); fn(); }) };
}

// ------------------------------------------------------------------ séances
const rooms = new Map();

function roomPosition(r) {
  const s = r.state;
  return s.playing ? s.position + (Date.now() - s.at) / 1000 : s.position;
}
function publicRoom(r) {
  return {
    code: r.code, itemId: r.itemId, title: r.title, host: r.host,
    members: [...r.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, host: m.id === r.hostClient })),
    state: { playing: r.state.playing, position: roomPosition(r), by: r.state.by },
  };
}
function broadcast(r, type, data, except) {
  for (const m of r.members.values()) if (m.id !== except) m.send(type, data);
}

setInterval(() => {
  for (const [c, r] of rooms) if (!r.members.size && Date.now() - r.emptySince > 10 * 60000) rooms.delete(c);
}, 60000).unref();

together.post('/api/rooms', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const item = get('SELECT i.id, i.title, s.title AS show_title, i.season_num, i.episode_num, i.type FROM items i LEFT JOIN items s ON s.id = i.show_id WHERE i.id = ?', Number(b.itemId));
  if (!item || item.type === 'channel') throw new HttpError(400, 'Choisissez un film ou un épisode');
  let c; do { c = code(4); } while (rooms.has(c));
  const title = item.show_title ? `${item.show_title}, S${item.season_num} É${item.episode_num}` : item.title;
  rooms.set(c, {
    code: c, itemId: item.id, title, host: p.name, hostClient: null, members: new Map(), emptySince: Date.now(),
    state: { playing: false, position: Number(b.position) || 0, at: Date.now(), by: p.name },
  });
  sendJson(ctx.res, { code: c, title });
});

together.get('/api/rooms/:code', (ctx) => {
  requireProfile(ctx);
  const r = rooms.get(String(ctx.params.code).toUpperCase());
  if (!r) throw new HttpError(404, 'Aucune séance avec ce code. Vérifiez les 4 lettres.');
  sendJson(ctx.res, publicRoom(r));
});

together.get('/api/rooms/:code/events', (ctx) => {
  const p = requireProfile(ctx);
  const r = rooms.get(String(ctx.params.code).toUpperCase());
  if (!r) throw new HttpError(404, 'Séance terminée');
  const id = String(ctx.url.searchParams.get('client') || code(6)).slice(0, 20);
  const { send, onClose } = sse(ctx);
  const member = { id, name: p.name, avatar: p.avatar, send };
  r.members.set(id, member);
  if (!r.hostClient) r.hostClient = id;
  send('room', publicRoom(r));
  broadcast(r, 'members', publicRoom(r).members, id);
  broadcast(r, 'notice', { text: `${p.name} a rejoint la séance` }, id);
  onClose(() => {
    if (r.members.get(id) !== member) return;
    r.members.delete(id);
    if (r.hostClient === id) r.hostClient = r.members.keys().next().value || null;
    if (!r.members.size) r.emptySince = Date.now();
    broadcast(r, 'members', publicRoom(r).members);
    broadcast(r, 'notice', { text: `${p.name} est parti` });
  });
});

together.post('/api/rooms/:code/action', async (ctx) => {
  const p = requireProfile(ctx);
  const r = rooms.get(String(ctx.params.code).toUpperCase());
  if (!r) throw new HttpError(404, 'Séance terminée');
  const b = await readBody(ctx.req);
  const from = String(b.client || '');
  if (b.type === 'state') {
    r.state = { playing: !!b.playing, position: Math.max(0, Number(b.position) || 0), at: Date.now(), by: p.name };
    broadcast(r, 'state', { playing: r.state.playing, position: r.state.position, by: p.name, reason: b.reason || null }, from);
  } else if (b.type === 'chat') {
    const text = String(b.text || '').trim().slice(0, 280);
    if (text) broadcast(r, 'chat', { name: p.name, avatar: p.avatar, text, at: Date.now() });
  } else if (b.type === 'react') {
    const emoji = String(b.emoji || '').slice(0, 8);
    if (emoji) broadcast(r, 'react', { name: p.name, emoji });
  } else if (b.type === 'item') {
    // L'hôte passe à l'épisode suivant : tout le monde suit
    r.itemId = Number(b.itemId) || r.itemId;
    r.state = { playing: true, position: 0, at: Date.now(), by: p.name };
    broadcast(r, 'item', { itemId: r.itemId, by: p.name }, from);
  } else throw new HttpError(400, 'Action inconnue');
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ télécommande
const remotes = new Map(); // code -> { screen: send(), name, last }

together.get('/api/remote/screen', (ctx) => {
  const p = requireProfile(ctx);
  let c = String(ctx.url.searchParams.get('code') || '');
  if (!/^\d{6}$/.test(c) || (remotes.has(c) && remotes.get(c).owner !== ctx.auth.token)) {
    do { c = String(crypto.randomInt(100000, 999999)); } while (remotes.has(c));
  }
  const { send, onClose } = sse(ctx);
  const entry = { send, owner: ctx.auth.token, name: p.name, phones: 0, at: Date.now() };
  remotes.set(c, entry);
  send('paired', { code: c });
  onClose(() => { if (remotes.get(c) === entry) remotes.delete(c); });
});

together.get('/api/remote/:code', (ctx) => {
  requireProfile(ctx);
  const r = remotes.get(String(ctx.params.code));
  if (!r) throw new HttpError(404, 'Écran introuvable. Vérifiez le code affiché sur la TV.');
  sendJson(ctx.res, { ok: true, screen: r.name });
});

together.post('/api/remote/:code', async (ctx) => {
  requireProfile(ctx);
  const r = remotes.get(String(ctx.params.code));
  if (!r) throw new HttpError(404, 'Écran déconnecté');
  const b = await readBody(ctx.req);
  const ALLOWED = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'playpause', 'rew', 'fwd', 'text', 'open', 'play', 'hello'];
  if (!ALLOWED.includes(b.cmd)) throw new HttpError(400, 'Commande inconnue');
  r.send('cmd', { cmd: b.cmd, text: typeof b.text === 'string' ? b.text.slice(0, 120) : undefined, id: Number(b.id) || undefined });
  sendJson(ctx.res, { ok: true });
});
