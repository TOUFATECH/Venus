// Séances à plusieurs (lecture synchronisée, chat, réactions) et télécommande téléphone → TV.
// Tout passe par des flux d'évènements (SSE) : aucun WebSocket, aucune dépendance.
import crypto from 'node:crypto';
import { Router, HttpError, readBody, sendJson } from './http.js';
import { get } from './db.js';
import { requireProfile, checkRate, resetRate } from './auth.js';

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
    if (text) broadcast(r, 'chat', { name: p.name, avatar: p.avatar, text, at: Date.now(), from: b.client });
  } else if (b.type === 'react') {
    const emoji = String(b.emoji || '').slice(0, 8);
    if (emoji) broadcast(r, 'react', { name: p.name, emoji, from: b.client });
  } else if (b.type === 'item') {
    // L'hôte passe à l'épisode suivant : tout le monde suit
    r.itemId = Number(b.itemId) || r.itemId;
    r.state = { playing: true, position: 0, at: Date.now(), by: p.name };
    broadcast(r, 'item', { itemId: r.itemId, by: p.name }, from);
  } else throw new HttpError(400, 'Action inconnue');
  sendJson(ctx.res, { ok: true });
});

// ------------------------------------------------------------------ télécommande
// L'écran affiche un code à 6 chiffres. Un téléphone qui le saisit (ou scanne le QR code) reçoit un lien
// personnel vers cet écran, et le code de l'écran change aussitôt : chaque code ne sert qu'une fois.
const remotes = new Map(); // code -> écran
const screens = new Map(); // appareil de l'écran (jeton) -> écran
const links = new Map();   // lien du téléphone -> { owner, at }
const newCode = () => { let c; do { c = String(crypto.randomInt(100000, 1000000)); } while (remotes.has(c)); return c; };

together.get('/api/remote/screen', (ctx) => {
  const p = requireProfile(ctx);
  let c = String(ctx.url.searchParams.get('code') || '');
  if (!/^\d{6}$/.test(c) || (remotes.has(c) && remotes.get(c).owner !== ctx.auth.token)) c = newCode();
  const { send, onClose } = sse(ctx);
  const old = screens.get(ctx.auth.token);
  if (old && old.code !== c && remotes.get(old.code) === old) remotes.delete(old.code);
  const entry = { send, owner: ctx.auth.token, name: p.name, code: c, at: Date.now() };
  remotes.set(c, entry);
  screens.set(ctx.auth.token, entry);
  send('paired', { code: c, phones: [...links.values()].filter((l) => l.owner === entry.owner).length });
  onClose(() => {
    if (remotes.get(entry.code) === entry) remotes.delete(entry.code);
    if (screens.get(entry.owner) === entry) screens.delete(entry.owner);
  });
});

// Le téléphone saisit le code : il reçoit son lien, l'écran reçoit un nouveau code
together.post('/api/remote/pair', async (ctx) => {
  requireProfile(ctx);
  checkRate(`remote:${ctx.req.socket.remoteAddress}`);
  const b = await readBody(ctx.req);
  const code = String(b.code || '').replace(/\D/g, '');
  const scr = remotes.get(code);
  if (!scr) throw new HttpError(404, 'Code inconnu ou déjà utilisé. Le code change après chaque connexion : regardez celui affiché sur la TV.');
  resetRate(`remote:${ctx.req.socket.remoteAddress}`);
  const link = crypto.randomBytes(18).toString('base64url');
  links.set(link, { owner: scr.owner, at: Date.now() });
  remotes.delete(code);
  scr.code = newCode();
  remotes.set(scr.code, scr);
  scr.send('paired', { code: scr.code, joined: true, phones: [...links.values()].filter((l) => l.owner === scr.owner).length });
  sendJson(ctx.res, { link, screen: scr.name });
});

const screenOf = (link) => {
  const l = links.get(String(link));
  if (!l) return null;
  l.at = Date.now();
  return screens.get(l.owner) || null;
};
together.get('/api/remote/link/:link', (ctx) => {
  requireProfile(ctx);
  if (!links.has(ctx.params.link)) throw new HttpError(404, 'Lien expiré : saisissez le code affiché sur la TV.');
  const r = screenOf(ctx.params.link);
  if (!r) throw new HttpError(404, 'Écran introuvable. Ouvrez Venus sur la TV.');
  sendJson(ctx.res, { ok: true, screen: r.name });
});

together.post('/api/remote/link/:link', async (ctx) => {
  requireProfile(ctx);
  if (!links.has(ctx.params.link)) throw new HttpError(404, 'Lien expiré : saisissez le code affiché sur la TV.');
  const r = screenOf(ctx.params.link);
  if (!r) throw new HttpError(404, 'Écran déconnecté');
  const b = await readBody(ctx.req);
  const ALLOWED = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'playpause', 'rew', 'fwd', 'text', 'open', 'play', 'hello', 'digit', 'tv'];
  if (!ALLOWED.includes(b.cmd)) throw new HttpError(400, 'Commande inconnue');
  r.send('cmd', { cmd: b.cmd, text: typeof b.text === 'string' ? b.text.slice(0, 120) : undefined, id: Number(b.id) || undefined, digit: /^[0-9]$/.test(String(b.digit)) ? String(b.digit) : undefined });
  sendJson(ctx.res, { ok: true });
});
// Liens de téléphones inutilisés depuis 30 jours : oubliés
setInterval(() => { const lim = Date.now() - 30 * 86400000; for (const [k, l] of links) if (l.at < lim) links.delete(k); }, 6 * 3600000).unref();

// ------------------------------------------------------------------ vote en famille (« Ce soir »)
// L'écran propose 3 titres ; chacun vote sur son téléphone (QR code ou code à 4 lettres) ; le gagnant se lance.
const votes = new Map(); // code -> vote
function publicVote(v) {
  const tally = new Map();
  for (const itemId of v.ballots.values()) tally.set(itemId, (tally.get(itemId) || 0) + 1);
  return {
    code: v.code, host: v.hostName, done: v.done, winner: v.winner,
    items: v.items.map((i) => ({ ...i, votes: tally.get(i.id) || 0, voters: [...v.ballots].filter(([, x]) => x === i.id).map(([k]) => v.names.get(k)) })),
    voters: v.ballots.size,
  };
}
function voteBroadcast(v) { const st = publicVote(v); for (const c of v.clients) c('state', st); }

together.post('/api/vote', async (ctx) => {
  const p = requireProfile(ctx);
  const b = await readBody(ctx.req);
  const ids = (Array.isArray(b.itemIds) ? b.itemIds : []).map(Number).filter(Boolean).slice(0, 4);
  const items = ids.map((id) => get('SELECT id, type, title, year, poster, backdrop, overview, runtime, duration FROM items WHERE id = ?', id)).filter(Boolean)
    .map((i) => ({ id: i.id, type: i.type, title: i.title, year: i.year, poster: i.poster, backdrop: i.backdrop, overview: i.overview, runtime: i.runtime || (i.duration ? Math.round(i.duration / 60) : null) }));
  if (items.length < 2) throw new HttpError(400, 'Il faut au moins deux titres');
  let c; do { c = code(4); } while (votes.has(c));
  const v = { code: c, host: ctx.auth.token, hostName: p.name, items, ballots: new Map(), names: new Map(), clients: new Set(), done: false, winner: null, at: Date.now() };
  votes.set(c, v);
  setTimeout(() => votes.delete(c), 3 * 3600000).unref();
  sendJson(ctx.res, publicVote(v));
});
together.get('/api/vote/:code', (ctx) => {
  requireProfile(ctx);
  const v = votes.get(String(ctx.params.code).toUpperCase());
  if (!v) throw new HttpError(404, 'Vote terminé ou code inconnu');
  sendJson(ctx.res, publicVote(v));
});
together.get('/api/vote/:code/stream', (ctx) => {
  requireProfile(ctx);
  const v = votes.get(String(ctx.params.code).toUpperCase());
  if (!v) throw new HttpError(404, 'Vote terminé ou code inconnu');
  const { send, onClose } = sse(ctx);
  v.clients.add(send);
  send('state', publicVote(v));
  onClose(() => v.clients.delete(send));
});
together.post('/api/vote/:code', async (ctx) => {
  const p = requireProfile(ctx);
  const v = votes.get(String(ctx.params.code).toUpperCase());
  if (!v) throw new HttpError(404, 'Vote terminé ou code inconnu');
  if (v.done) throw new HttpError(409, 'Le vote est terminé');
  const b = await readBody(ctx.req);
  const voter = String(b.client || ctx.auth.token).slice(0, 64);
  if (!v.items.some((i) => i.id === Number(b.itemId))) throw new HttpError(400, 'Choix inconnu');
  v.ballots.set(voter, Number(b.itemId));
  v.names.set(voter, String(b.name || p.name).slice(0, 30));
  voteBroadcast(v);
  sendJson(ctx.res, publicVote(v));
});
// L'hôte clôt le vote : le plus de voix gagne (égalité : tirage au sort entre les premiers)
together.post('/api/vote/:code/close', (ctx) => {
  requireProfile(ctx);
  const v = votes.get(String(ctx.params.code).toUpperCase());
  if (!v) throw new HttpError(404, 'Vote terminé ou code inconnu');
  if (v.host !== ctx.auth.token) throw new HttpError(403, 'Seul l’écran qui a lancé le vote peut le terminer');
  const st = publicVote(v);
  const max = Math.max(...st.items.map((i) => i.votes));
  const top = st.items.filter((i) => i.votes === max);
  v.winner = top[crypto.randomInt(top.length)].id;
  v.done = true;
  voteBroadcast(v);
  sendJson(ctx.res, publicVote(v));
});
