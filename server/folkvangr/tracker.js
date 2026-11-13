// Fólkvangr · traqueurs (annonce) : HTTP(S) (BEP 3, réponse compacte BEP 23) et UDP (BEP 15).
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { decode, str } from './bencode.js';

const pct = (buf) => [...buf].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
/** Pairs au format compact (6 octets par pair IPv4, 18 par pair IPv6). Pur. */
export function compactPeers(b, v6 = false) {
  const out = [], step = v6 ? 18 : 6;
  for (let i = 0; i + step <= b.length; i += step) {
    const ip = v6 ? Array.from({ length: 8 }, (_, k) => b.readUInt16BE(i + k * 2).toString(16)).join(':') : `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
    const port = b.readUInt16BE(i + step - 2); if (port) out.push({ ip, port });
  }
  return out;
}
async function httpAnnounce(url, a) {
  const q = `info_hash=${pct(Buffer.from(a.infoHash, 'hex'))}&peer_id=${pct(a.peerId)}&port=${a.port}&uploaded=${a.uploaded}&downloaded=${a.downloaded}&left=${a.left}&compact=1&numwant=80${a.event ? `&event=${a.event}` : ''}`;
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}${q}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Venus-Folkvangr/1' } });
  if (!r.ok) throw new Error(`traqueur ${r.status}`);
  const d = decode(Buffer.from(await r.arrayBuffer())).value;
  if (d['failure reason']) throw new Error(`traqueur : ${str(d['failure reason'])}`);
  const peers = Buffer.isBuffer(d.peers) ? compactPeers(d.peers) : (d.peers || []).map((p) => ({ ip: str(p.ip), port: p.port }));
  if (Buffer.isBuffer(d.peers6)) peers.push(...compactPeers(d.peers6, true));
  return { peers, interval: d.interval || 1800 };
}
function udpAnnounce(url, a) {
  const u = new URL(url);
  return new Promise((ok, ko) => {
    const s = dgram.createSocket(/:/.test(u.hostname.replace(/^\[|\]$/g, '')) ? 'udp6' : 'udp4');
    const tid = () => crypto.randomBytes(4);
    let conn = null, t1 = tid(), tries = 0, timer;
    const done = (e, v) => { clearTimeout(timer); try { s.close(); } catch { /* */ } if (e) ko(e); else ok(v); };
    const send = (b) => s.send(b, Number(u.port || 80), u.hostname.replace(/^\[|\]$/g, ''));
    const connect = () => { const b = Buffer.alloc(16); b.writeBigUInt64BE(0x41727101980n, 0); b.writeUInt32BE(0, 8); t1.copy(b, 12); send(b); arm(); };
    const announce = () => {
      const b = Buffer.alloc(98); conn.copy(b, 0); b.writeUInt32BE(1, 8); t1 = tid(); t1.copy(b, 12); Buffer.from(a.infoHash, 'hex').copy(b, 16); a.peerId.copy(b, 36);
      b.writeBigUInt64BE(BigInt(a.downloaded), 56); b.writeBigUInt64BE(BigInt(a.left), 64); b.writeBigUInt64BE(BigInt(a.uploaded), 72);
      b.writeUInt32BE({ started: 2, completed: 1, stopped: 3 }[a.event] ?? 0, 80); b.writeUInt32BE(0, 84); crypto.randomBytes(4).copy(b, 88); b.writeInt32BE(80, 92); b.writeUInt16BE(a.port, 96);
      send(b); arm();
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (++tries > 3) return done(new Error('traqueur UDP muet')); if (conn) announce(); else connect(); }, 4000 * 2 ** tries); };
    s.on('error', (e) => done(e));
    s.on('message', (m) => {
      if (m.length < 8 || !m.subarray(4, 8).equals(t1)) return;
      const action = m.readUInt32BE(0);
      if (action === 3) return done(new Error(`traqueur : ${m.subarray(8).toString()}`));
      if (action === 0 && m.length >= 16) { conn = m.subarray(8, 16); return announce(); }
      if (action === 1 && m.length >= 20) return done(null, { interval: m.readUInt32BE(8), peers: compactPeers(m.subarray(20), s.type === 'udp6') });
    });
    connect();
  });
}
/** Annonce à un traqueur ; renvoie des pairs et le délai avant la prochaine annonce. */
export function announce(url, a) { return /^udp:/i.test(url) ? udpAnnounce(url, a) : httpAnnounce(url, a); }
