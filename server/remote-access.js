// Accès hors de la maison, sans ouvrir de port sur la box :
// - « Lien rapide » : tunnel Cloudflare gratuit et sans compte (adresse https://….trycloudflare.com, qui change
//   à chaque redémarrage) ;
// - « Mon tunnel » : tunnel Cloudflare à votre nom (adresse fixe, ex. venus.mondomaine.fr), avec le jeton
//   copié depuis le tableau de bord Cloudflare (Zero Trust → Réseaux → Tunnels) ;
// - Tailscale : rien à lancer ici, Venus reconnaît simplement qu'on arrive par le réseau Tailscale.
// Venus télécharge lui-même le programme officiel « cloudflared » (GitHub de Cloudflare) dans ses données.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

const BIN_DIR = path.join(config.dataDir, 'bin');
const BIN = path.join(BIN_DIR, 'cloudflared');
const ARCH = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' };
const st = { running: false, url: null, connected: false, error: null, log: [], startedAt: null, mode: 'off' };
let proc = null;

export const remoteConf = () => { const c = getSetting('remote_access', null); return c && typeof c === 'object' ? c : { mode: 'off' }; };
function binPath() {
  if (process.env.VENUS_CLOUDFLARED_BIN) return process.env.VENUS_CLOUDFLARED_BIN;
  if (fs.existsSync(BIN)) return BIN;
  try { return execFileSync('sh', ['-c', 'command -v cloudflared'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
async function install() {
  const a = ARCH[os.arch()];
  if (process.platform !== 'linux' || !a) throw new Error(`Téléchargement automatique prévu pour Linux seulement (ici : ${process.platform} ${os.arch()}) : installez cloudflared vous-même`);
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${a}`;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Téléchargement de cloudflared impossible (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5e6 || buf.subarray(0, 4).toString('latin1') !== '\x7fELF') throw new Error('Fichier téléchargé inattendu');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(`${BIN}.tmp`, buf, { mode: 0o755 });
  fs.renameSync(`${BIN}.tmp`, BIN);
  return BIN;
}

export function remoteStatus(req) {
  const host = String((req && (req.headers.host || req.headers[':authority'])) || '').replace(/:\d+$/, '');
  const viaTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(host) || /\.ts\.net$/i.test(host);
  const viaTunnel = !!(req && req.headers['cf-ray']);
  return { ...st, log: st.log.slice(-12), mode: remoteConf().mode, hasToken: !!remoteConf().token, installed: !!binPath(), viaTailscale, viaTunnel, host };
}

function stopProc() {
  if (proc) { try { proc.kill('SIGTERM'); } catch { /* */ } proc = null; }
  Object.assign(st, { running: false, url: null, connected: false });
}

export async function startRemote(mode, token) {
  stopProc();
  st.error = null; st.log = [];
  if (mode === 'off') { setSetting('remote_access', { mode: 'off' }); st.mode = 'off'; return remoteStatus(); }
  const conf = { mode, token: mode === 'token' ? String(token || remoteConf().token || '').trim() : undefined };
  if (mode === 'token' && !/^[A-Za-z0-9+/=_-]{40,}$/.test(conf.token || '')) throw new Error('Jeton du tunnel invalide : copiez la longue suite de caractères donnée par Cloudflare (après « --token »)');
  const bin = binPath() || await install();
  setSetting('remote_access', conf);
  st.mode = mode;
  const port = config.port || 8096;
  const args = mode === 'quick'
    ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]
    : ['tunnel', '--no-autoupdate', 'run', '--token', conf.token];
  proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  st.running = true; st.startedAt = Date.now();
  const onLine = (line) => {
    const l = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (!l) return;
    st.log.push(l.replace(/(--token\s+)\S+/g, '$1•••').slice(0, 300)); if (st.log.length > 40) st.log.shift();
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(l);
    if (m) st.url = m[0];
    if (/Registered tunnel connection|Connection [a-f0-9-]+ registered/i.test(l)) st.connected = true;
    if (/(ERR|error)/.test(l) && /failed|unauthorized|invalid/i.test(l)) st.error = l.slice(0, 200);
  };
  for (const s of [proc.stdout, proc.stderr]) { let buf = ''; s.on('data', (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(onLine); }); }
  const me = proc;
  proc.on('exit', (code) => {
    if (proc !== me) return;
    proc = null; st.running = false; st.connected = false;
    if (code && !st.error) st.error = `Le tunnel s’est arrêté (code ${code})`;
    // Coupure : nouvel essai dans 30 s tant que l'accès est activé
    setTimeout(() => { if (!proc && remoteConf().mode !== 'off') startRemote(remoteConf().mode).catch((e) => { st.error = e.message; }); }, 30000).unref();
  });
  // Laisse quelques secondes pour obtenir l'adresse
  for (let i = 0; i < 40 && !(st.url || st.connected || st.error || !st.running); i++) await new Promise((r) => setTimeout(r, 250));
  return remoteStatus();
}

/** Au démarrage de Venus : relance l'accès s'il était activé */
export function resumeRemote() {
  const c = remoteConf();
  if (c.mode && c.mode !== 'off') startRemote(c.mode).catch((e) => { st.error = e.message; console.warn('[accès distant]', e.message); });
}
export function stopRemote() { stopProc(); }
process.on('exit', () => { if (proc) { try { proc.kill('SIGTERM'); } catch { /* */ } } });
