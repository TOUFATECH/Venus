// Parler à Odin sur le réseau : requêtes HTTP(S) sans dépendance, certificat épinglé, recherche d'Odin sur le réseau local.
//
// Odin écoute en général sur https://<ip>:7777 avec un certificat auto-signé : Node le refuserait. On accepte donc le
// certificat au premier contact (« Tester » dans Réglages → Odin), on garde son empreinte SHA-256, et ensuite tout autre
// certificat est refusé (comme Pégase). Un certificat signé par une autorité reconnue est accepté normalement.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';

export const DEFAULT_PORT = 7777;
const fp = (cert) => String(cert && cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();

/** Adresse d'Odin à partir de l'IP (ou du nom) et du port. */
export function baseOf(host, port, scheme = 'https') {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  if (!h) throw Object.assign(new Error('Indique l’adresse IP d’Odin'), { status: 400 });
  if (!/^[A-Za-z0-9.-]{1,253}$|^[0-9a-fA-F:]{2,45}$/.test(h)) throw Object.assign(new Error('Adresse d’Odin invalide : une IP (ex. 192.168.1.10) ou un nom de machine'), { status: 400 });
  const p = Number(port || DEFAULT_PORT);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw Object.assign(new Error('Port d’Odin invalide (1 à 65535, 7777 en général)'), { status: 400 });
  return `${scheme}://${h.includes(':') ? `[${h}]` : h}:${p}`;
}

/**
 * Une requête vers Odin. `pin` : empreinte attendue du certificat (sinon : premier contact, rendu dans `fingerprint`).
 * Rend { status, headers, body (Buffer), fingerprint, json() }. Lève une erreur claire si Odin ne répond pas.
 */
export function odinRequest(url, { method = 'GET', headers = {}, body, pin = '', timeout = 15000, maxBytes = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    let data = body;
    const h = { accept: 'application/json', ...headers };
    if (data !== undefined && !Buffer.isBuffer(data) && typeof data !== 'string') { data = JSON.stringify(data); h['content-type'] = h['content-type'] || 'application/json'; }
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    let fingerprint = '';
    const req = (isHttps ? https : http).request(u, {
      method, headers: h, timeout,
      ...(isHttps ? { rejectUnauthorized: false, servername: /^[\d.]+$|:/.test(u.hostname) ? undefined : u.hostname, agent: false } : { agent: false }),
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('Réponse d’Odin trop grosse')); return; } chunks.push(c); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, fingerprint, json: () => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } } });
      });
      res.on('error', reject);
    });
    if (isHttps) {
      req.on('socket', (sock) => sock.once('secureConnect', () => {
        fingerprint = fp(sock.getPeerCertificate());
        const trusted = sock.authorized === true;
        if (pin && fingerprint !== pin && !trusted) {
          req.destroy(Object.assign(new Error('Le certificat d’Odin a changé depuis le premier contact : vérifie que c’est bien ton Odin, puis refais « Tester » dans Réglages → Odin.'), { code: 'ODIN_PIN' }));
        }
      }));
    }
    req.on('timeout', () => req.destroy(Object.assign(new Error('Odin ne répond pas (délai dépassé)'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => reject(explain(e, u)));
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/**
 * Un flux en direct d'Odin (Server-Sent Events). `onEvent(event, data)` à chaque événement (data : JSON lu). Rend
 * { close(), done } ; `done` se résout quand le flux s'arrête : { status, error? } (statut HTTP si Odin a refusé).
 */
export function odinStream(url, { headers = {}, pin = '', onEvent, onOpen } = {}) {
  let req = null, closed = false;
  const done = new Promise((resolve) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    req = (isHttps ? https : http).request(u, {
      method: 'GET', headers: { accept: 'text/event-stream', ...headers },
      ...(isHttps ? { rejectUnauthorized: false, servername: /^[\d.]+$|:/.test(u.hostname) ? undefined : u.hostname, agent: false } : { agent: false }),
    }, (res) => {
      if (res.statusCode !== 200) {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
        return;
      }
      if (onOpen) onOpen();
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.length > 8 * 1024 * 1024) { req.destroy(new Error('flux trop gros')); return; }
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const bloc = buf.slice(0, i); buf = buf.slice(i + 2);
          let ev = 'message'; const data = [];
          for (const l of bloc.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, '')); }
          if (!data.length) continue; // signe de vie
          let d = null; try { d = JSON.parse(data.join('\n')); } catch { continue; }
          try { onEvent(ev, d); } catch (e) { console.warn(`[odin] flux : ${e.message}`); }
        }
      });
      res.on('end', () => resolve({ status: 200 }));
      res.on('error', (e) => resolve({ status: 0, error: e }));
      res.on('close', () => resolve({ status: 200 }));
    });
    if (isHttps) {
      req.on('socket', (sock) => sock.once('secureConnect', () => {
        const f = fp(sock.getPeerCertificate());
        if (pin && f !== pin && sock.authorized !== true) req.destroy(Object.assign(new Error('Le certificat d’Odin a changé depuis le premier contact.'), { code: 'ODIN_PIN' }));
      }));
    }
    req.on('error', (e) => resolve({ status: 0, error: closed ? null : explain(e, u) }));
    req.end();
  });
  return { close() { closed = true; try { req.destroy(); } catch { /* */ } }, done };
}

function explain(e, u) {
  if (e.code === 'ODIN_PIN' || e.status) return e;
  const where = `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`;
  const map = {
    ECONNREFUSED: `Odin ne répond pas sur ${where} : vérifie qu’il est allumé et le port (7777 en général).`,
    EHOSTUNREACH: `La machine ${u.hostname} est injoignable : vérifie l’adresse IP et le réseau.`,
    ENETUNREACH: `Le réseau de ${u.hostname} est injoignable depuis Venus.`,
    ENOTFOUND: `Le nom ${u.hostname} est inconnu : mets plutôt l’adresse IP d’Odin.`,
    ETIMEDOUT: `Odin ne répond pas sur ${where} (délai dépassé).`,
    ECONNRESET: `Odin a coupé la connexion (${where}).`,
  };
  return Object.assign(new Error(map[e.code] || `Odin injoignable sur ${where} : ${e.message}`), { code: e.code || 'ODIN_NET' });
}

/**
 * Trouver l'adresse qui marche (https d'abord, puis http) pour une IP et un port.
 * Rend { url, fingerprint, info } ou lève l'erreur de la tentative https.
 */
export async function probe(host, port, { pin = '', timeout = 4000 } = {}) {
  let first;
  for (const scheme of ['https', 'http']) {
    const url = baseOf(host, port, scheme);
    try {
      const r = await odinRequest(`${url}/.well-known/openid-configuration`, { pin, timeout });
      let info = r.status === 200 ? r.json() : null;
      if (!info || !info.issuer) {
        const b = await odinRequest(`${url}/api/pegase/bonjour`, { pin, timeout }).catch(() => null);
        const j = b && b.status === 200 ? b.json() : null;
        if (j && j.odin === true) info = { odin: true, nom: j.nom, version: j.version };
        else if (r.status >= 300 && r.status < 400 && scheme === 'http') continue; // http renvoyé vers https : déjà essayé
        else info = info && info.issuer ? info : null;
      }
      if (!info) throw Object.assign(new Error(`Quelque chose répond sur ${url}, mais ce n’est pas Odin (ou Odin est trop ancien pour la connexion unique).`), { code: 'PAS_ODIN' });
      return { url, fingerprint: r.fingerprint, info };
    } catch (e) {
      if (e.code === 'ODIN_PIN' || e.code === 'PAS_ODIN') throw e;
      if (!first) first = e;
    }
  }
  throw first;
}

/** Les adresses IPv4 du réseau local de cette machine (pour chercher Odin autour). */
export function localNets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || /^169\.254\./.test(i.address)) continue;
      out.push(i.address);
    }
  }
  return out;
}

/**
 * Chercher Odin : cette machine, puis le /24 de chaque carte réseau, ports 7777 et 7443 ; 32 essais en parallèle,
 * 1,5 s chacun. Rend [{ host, port, url, nom }].
 */
export async function discover({ nets = localNets(), ports = [DEFAULT_PORT, 7443], timeout = 1500, parallel = 32, extra = ['127.0.0.1'] } = {}) {
  const hosts = new Set(extra);
  for (const ip of nets) { const base = ip.split('.').slice(0, 3).join('.'); for (let k = 1; k < 255; k++) hosts.add(`${base}.${k}`); }
  const jobs = [];
  for (const h of hosts) for (const p of ports) jobs.push([h, p]);
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [h, p] = jobs[next++];
      try {
        const r = await probe(h, p, { timeout });
        found.push({ host: h, port: p, url: r.url, nom: (r.info && (r.info.nom || r.info.name)) || 'Odin' });
      } catch { /* rien ici */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  // La même machine vue par 127.0.0.1 et par son IP : on garde l'IP du réseau (utile aux autres appareils)
  const mine = new Set(nets);
  return found.filter((f) => !(f.host === '127.0.0.1' && found.some((g) => mine.has(g.host) && g.port === f.port)))
    .sort((a, b) => (a.host === '127.0.0.1') - (b.host === '127.0.0.1') || a.host.localeCompare(b.host, 'fr', { numeric: true }));
}
