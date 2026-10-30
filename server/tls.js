// HTTPS : certificat fourni (variables TLS_CERT / TLS_KEY, ex. Let's Encrypt) ou, à défaut, certificat
// autosigné créé une fois dans le dossier de données (openssl). Le navigateur demande alors de l'accepter
// une fois ; pour une adresse publique, un proxy comme Caddy (certificat reconnu) reste le plus confortable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { getSetting } from './db.js';

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 30000 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(out))));

export async function tlsOptions(addresses = []) {
  if (process.env.HTTPS === '0' || getSetting('https_enabled', true) === false) return null;
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), selfSigned: false };
  }
  const dir = path.join(config.dataDir, 'tls');
  const certFile = path.join(dir, 'cert.pem'), keyFile = path.join(dir, 'key.pem'), metaFile = path.join(dir, 'names.txt');
  const names = ['localhost', os.hostname(), '127.0.0.1', ...addresses].filter(Boolean);
  const wanted = [...new Set(names)].sort().join(',');
  let fresh = false;
  try {
    const st = fs.statSync(certFile);
    // Renouvelé tous les 300 jours, ou si l'adresse de la machine a changé
    fresh = Date.now() - st.mtimeMs < 300 * 864e5 && fs.readFileSync(metaFile, 'utf8') === wanted;
  } catch { /* pas encore de certificat */ }
  if (!fresh) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const san = [...new Set(names)].map((n) => (/^[\d.]+$|:/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
    try {
      await run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-sha256', '-days', '397', '-nodes',
        '-keyout', keyFile, '-out', certFile, '-subj', '/CN=Venus', '-addext', `subjectAltName=${san}`]);
    } catch (e) {
      throw new Error(`certificat HTTPS non créé (openssl indisponible ?) : ${e.message.slice(0, 120)}`);
    }
    fs.writeFileSync(metaFile, wanted);
    try { fs.chmodSync(keyFile, 0o600); } catch { /* Windows */ }
    console.log('  🔒 Certificat HTTPS autosigné créé');
  }
  return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), selfSigned: true };
}
