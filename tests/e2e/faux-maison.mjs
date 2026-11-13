// Faux pont Philips Hue + faux contrôleur WLED, sur un seul port, pour tester les lumières synchronisées.
// GET /__journal rend tout ce que Venus a envoyé ; POST /__bouton simule l'appui sur le bouton du pont.
import http from 'node:http';

const port = Number(process.argv[2]) || 18770;
const journal = [];
let buttonPressed = false;
const USER = 'venus-test-user';
const hue = {
  1: { name: 'Salon', state: { on: true, bri: 120, xy: [0.4, 0.4] } },
  2: { name: 'Couloir', state: { on: false, bri: 50, ct: 300 } },
};
let wled = { on: false, bri: 40, ps: 2, seg: [{ col: [[255, 160, 0]] }] };

// Lit le corps d'une requête
const read = (req) => new Promise((resolve) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
// Envoie une réponse JSON
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = ['POST', 'PUT'].includes(req.method) ? await read(req) : null;
  if (u.pathname !== '/__journal') journal.push({ method: req.method, path: u.pathname, body, at: Date.now() });
  // outils du test
  if (u.pathname === '/__journal') return send(res, 200, { journal, hue, wled, buttonPressed });
  if (u.pathname === '/__bouton') { buttonPressed = true; setTimeout(() => { buttonPressed = false; }, 30000); return send(res, 200, { ok: true }); }
  if (u.pathname === '/__reset') { journal.length = 0; return send(res, 200, { ok: true }); }
  // Hue
  if (u.pathname === '/api' && req.method === 'POST') {
    if (!buttonPressed) return send(res, 200, [{ error: { type: 101, address: '', description: 'link button not pressed' } }]);
    return send(res, 200, [{ success: { username: USER } }]);
  }
  let m = u.pathname.match(/^\/api\/([^/]+)\/lights$/);
  if (m) return m[1] === USER ? send(res, 200, hue) : send(res, 200, [{ error: { type: 1, description: 'unauthorized user' } }]);
  m = u.pathname.match(/^\/api\/([^/]+)\/lights\/(\d+)\/state$/);
  if (m && req.method === 'PUT') {
    if (m[1] !== USER || !hue[m[2]]) return send(res, 200, [{ error: { type: 3, description: 'resource not available' } }]);
    Object.assign(hue[m[2]].state, body);
    return send(res, 200, Object.entries(body).map(([k, v]) => ({ success: { [`/lights/${m[2]}/state/${k}`]: v } })));
  }
  // WLED
  if (u.pathname === '/json/info') return send(res, 200, { ver: '0.15.0', name: 'WLED salon', leds: { count: 60 } });
  if (u.pathname === '/json/state') {
    if (req.method === 'POST') { wled = { ...wled, ...body }; return send(res, 200, { success: true }); }
    return send(res, 200, wled);
  }
  send(res, 404, { error: 'inconnu' });
}).listen(port, '127.0.0.1');
