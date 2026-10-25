// Sources réseau : partages Windows / NAS (SMB) et NFS, montés par Venus dans /mnt/venus/<id>.
// Découverte des appareils du réseau local, liste des partages, montage automatique au démarrage.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { all, run } from './db.js';

export const MOUNT_ROOT = process.env.MOUNT_ROOT || '/mnt/venus';
const credDir = path.join(config.dataDir, 'net');
fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });

const sh = (cmd, args, timeout = 20000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, code: err && err.code, out: String(stdout), err: String(stderr || (err && err.message) || '') });
  });
});
const which = async (bin) => (await sh('sh', ['-c', `command -v ${bin}`], 3000)).ok;

// ------------------------------------------------------------------ découverte du réseau local
function probe(host, port, timeout = 450) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function localSubnets() {
  const out = new Set();
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    // Les réseaux internes de Docker ne sont pas ceux de la maison
    if (/^(docker|br-|veth|virbr|cni|flannel|tailscale|zt)/.test(name)) continue;
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const [a, b, c] = i.address.split('.').map(Number);
      out.add(`${a}.${b}.${c}`);
    }
  }
  return [...out];
}

async function hostName(ip) {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), 800))]);
    return (names[0] || '').replace(/\.(local|lan|home|box)$/i, '') || null;
  } catch { return null; }
}

let lastScan = { at: 0, hosts: [] };
export async function discover({ force = false } = {}) {
  if (!force && Date.now() - lastScan.at < 60000) return lastScan.hosts;
  const subnets = localSubnets();
  const targets = [];
  for (const s of subnets) for (let i = 1; i < 255; i++) targets.push(`${s}.${i}`);
  const found = [];
  let idx = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const ip = targets[idx++];
      const [smb, nfs] = await Promise.all([probe(ip, 445), probe(ip, 2049)]);
      if (smb || nfs) found.push({ ip, smb, nfs });
    }
  };
  await Promise.all(Array.from({ length: 96 }, worker));
  await Promise.all(found.map(async (f) => { f.name = await hostName(f.ip); }));
  found.sort((a, b) => a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
  lastScan = { at: Date.now(), hosts: found };
  return found;
}

// ------------------------------------------------------------------ liste des partages d'un appareil
export async function listShares({ proto, host, user, pass }) {
  host = cleanHost(host);
  if (proto === 'nfs') {
    if (!(await which('showmount'))) throw new Error('Outil NFS absent (paquet nfs-common). Indiquez le chemin du partage à la main.');
    const r = await sh('showmount', ['-e', '--no-headers', host], 12000);
    if (!r.ok) throw new Error(`Impossible de lister les partages NFS de ${host}`);
    return r.out.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).map((name) => ({ name, comment: '' }));
  }
  if (!(await which('smbclient'))) throw new Error('Outil SMB absent (paquet smbclient). Indiquez le nom du partage à la main.');
  const auth = user ? ['-U', `${user}%${pass || ''}`] : ['-N'];
  const r = await sh('smbclient', ['-g', '-L', `//${host}`, ...auth, '-m', 'SMB3'], 15000);
  if (!r.ok) {
    if (/LOGON_FAILURE|ACCESS_DENIED/.test(r.out + r.err)) throw new Error('Identifiant ou mot de passe refusé par cet appareil');
    throw new Error(`Impossible de joindre ${host} en SMB`);
  }
  return r.out.split('\n').filter((l) => l.startsWith('Disk|')).map((l) => { const [, name, comment] = l.split('|'); return { name, comment: comment || '' }; })
    .filter((s) => !/\$$/.test(s.name)); // partages cachés (C$, ADMIN$…)
}

// ------------------------------------------------------------------ montage
function cleanHost(h) { return String(h || '').trim().replace(/^(smb|nfs|cifs):\/\//i, '').replace(/^\\\\/, '').replace(/[\\/].*$/, ''); }
function cleanShare(s) { return String(s || '').trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/'); }

export function describe(remote) {
  if (!remote) return null;
  return remote.proto === 'nfs' ? `nfs://${remote.host}${remote.share.startsWith('/') ? '' : '/'}${remote.share}` : `\\\\${remote.host}\\${remote.share.replace(/\//g, '\\')}`;
}

function isMounted(target) {
  try {
    const m = fs.readFileSync('/proc/mounts', 'utf8');
    return m.split('\n').some((l) => l.split(' ')[1] === target.replace(/ /g, '\\040'));
  } catch { return false; }
}

export function mountArgs(id, remote, target) {
  const uid = process.getuid ? process.getuid() : 0;
  const gid = process.getgid ? process.getgid() : 0;
  if (remote.proto === 'nfs') {
    const exp = remote.share.startsWith('/') ? remote.share : `/${remote.share}`;
    return ['-t', 'nfs', '-o', `${remote.writable ? 'rw' : 'ro'},soft,timeo=150,retrans=3,nolock`, `${remote.host}:${exp}`, target];
  }
  const opts = [
    remote.user ? `credentials=${path.join(credDir, `${id}.cred`)}` : 'guest',
    `uid=${uid}`, `gid=${gid}`, 'iocharset=utf8', 'file_mode=0664', 'dir_mode=0775', 'noperm', 'nobrl', 'actimeo=30',
    remote.writable ? 'rw' : 'ro',
    remote.vers ? `vers=${remote.vers}` : null,
  ].filter(Boolean).join(',');
  return ['-t', 'cifs', `//${remote.host}/${remote.share}`, target, '-o', opts];
}

export async function mountRemote(id, remote) {
  const target = path.join(MOUNT_ROOT, String(id));
  fs.mkdirSync(target, { recursive: true });
  if (isMounted(target)) return { ok: true, path: target };
  if (remote.proto !== 'nfs' && remote.user) {
    const cred = path.join(credDir, `${id}.cred`);
    fs.writeFileSync(cred, `username=${remote.user}\npassword=${remote.pass || ''}\n${remote.domain ? `domain=${remote.domain}\n` : ''}`, { mode: 0o600 });
  }
  let tries = remote.proto === 'nfs' || remote.vers ? [remote] : [{ ...remote, vers: '3.0' }, { ...remote, vers: '2.1' }, { ...remote, vers: '1.0' }];
  let last = '';
  for (const r of tries) {
    const res = await sh('mount', mountArgs(id, r, target), 30000);
    if (res.ok) { if (r.vers) remote.vers = r.vers; return { ok: true, path: target }; }
    last = res.err;
    if (/Permission denied|13\b|EACCES|LOGON|cannot mount.*read-only/i.test(last) && !/Operation not permitted/.test(last)) break;
  }
  return { ok: false, path: target, error: explain(last, remote) };
}

function explain(err, remote) {
  if (/Operation not permitted|must be superuser|only root/i.test(err)) {
    return 'Venus n’a pas le droit de monter des partages réseau. Avec Docker, utilisez le docker-compose.yml fourni (lignes cap_add: SYS_ADMIN), puis relancez « docker compose up -d ».';
  }
  if (/No such device|unknown filesystem type|helper program/i.test(err)) return `Le support ${remote.proto === 'nfs' ? 'NFS' : 'SMB'} manque sur le serveur (paquet ${remote.proto === 'nfs' ? 'nfs-common' : 'cifs-utils'}). L’image Docker de Venus l’inclut.`;
  if (/Permission denied|error\(13\)|LOGON|access denied/i.test(err)) return 'Accès refusé : vérifiez l’identifiant et le mot de passe du partage.';
  if (/No such file|error\(2\)|does not exist/i.test(err)) return 'Ce partage n’existe pas sur cet appareil. Vérifiez son nom.';
  if (/Host is down|No route|timed out|error\(112\)|error\(113\)|Connection refused/i.test(err)) return 'L’appareil ne répond pas. Est-il allumé et sur le même réseau ?';
  return `Montage impossible : ${err.trim().split('\n').pop() || 'erreur inconnue'}`;
}

export async function unmountRemote(id) {
  const target = path.join(MOUNT_ROOT, String(id));
  if (isMounted(target)) await sh('umount', ['-l', target], 15000);
  fs.rmSync(path.join(credDir, `${id}.cred`), { force: true });
  try { fs.rmdirSync(target); } catch { /* déjà supprimé ou non vide */ }
}

// Un partage réseau est-il réellement monté ? (sinon le dossier est vide et tout semblerait supprimé)
export function remoteReady(lib) {
  return isMounted(path.join(MOUNT_ROOT, String(lib.id)));
}

export function remoteOf(lib) {
  if (!lib || !lib.remote) return null;
  try { return JSON.parse(lib.remote); } catch { return null; }
}

// État des sources réseau (pour les réglages)
export const netState = new Map(); // id -> { ok, error, at }

export async function mountAll() {
  for (const lib of all('SELECT * FROM libraries WHERE remote IS NOT NULL')) {
    const r = remoteOf(lib);
    if (!r) continue;
    const res = await mountRemote(lib.id, r);
    netState.set(lib.id, { ok: res.ok, error: res.error || null, at: Date.now() });
    const full = path.join(res.path, r.sub || '');
    if (res.ok && full !== lib.path) run('UPDATE libraries SET path = ? WHERE id = ?', full, lib.id);
    if (!res.ok) console.warn(`[réseau] ${describe(r)} : ${res.error}`);
    else console.log(`[réseau] ${describe(r)} monté dans ${res.path}`);
  }
}

// Vérifie régulièrement que les partages sont toujours accessibles et les remonte si besoin
export function watchMounts(onChange) {
  setInterval(async () => {
    for (const lib of all('SELECT * FROM libraries WHERE remote IS NOT NULL')) {
      const r = remoteOf(lib);
      let alive = false;
      try { fs.readdirSync(lib.path); alive = isMounted(path.join(MOUNT_ROOT, String(lib.id))); } catch { alive = false; }
      if (!alive) {
        const res = await mountRemote(lib.id, r);
        netState.set(lib.id, { ok: res.ok, error: res.error || null, at: Date.now() });
        if (res.ok && onChange) onChange();
      } else netState.set(lib.id, { ok: true, error: null, at: Date.now() });
    }
  }, 5 * 60000).unref();
}

// IPTV : liste M3U à partir d'identifiants Xtream Codes
export function xtreamUrl({ server, user, pass }) {
  let base = String(server || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  const u = new URL(`${base}/get.php`);
  u.searchParams.set('username', user);
  u.searchParams.set('password', pass);
  u.searchParams.set('type', 'm3u_plus');
  u.searchParams.set('output', 'ts');
  return u.toString();
}
