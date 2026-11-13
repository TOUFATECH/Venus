// Mise à jour de Venus depuis l'interface (Tableau de bord → Serveur).
// - Vérification : compare le commit installé (fichier .git ou variable VENUS_COMMIT) au dernier commit de GitHub,
//   et liste les nouveautés (messages des commits) : résultat gardé 30 minutes.
// - Installation : hors Docker, « git pull » dans le dossier de Venus puis redémarrage (si un superviseur relance
//   le service). Sous Docker, l'image doit être reconstruite depuis l'hôte : la commande exacte est renvoyée.
//   Une commande personnalisée (VENUS_UPDATE_CMD) est utilisée si elle existe, par exemple un script sur l'hôte.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtime } from './env.js';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { notify } from './notify.js';

// Compagnon de mise à jour (Docker, scripts/updater.sh) : fichiers partagés dans le dossier des données
const REQ = path.join(config.dataDir, 'update-request');
const STATUS = path.join(config.dataDir, 'update-status.json');
const LOG = path.join(config.dataDir, 'update-log.txt');
const ALIVE = path.join(config.dataDir, 'updater-alive');
const NIGHT = path.join(config.dataDir, 'autoupdate-night');
// État du compagnon de mise à jour (Docker)
export function updaterInfo() {
  let alive = false, status = null, log = null;
  try { alive = Date.now() - fs.statSync(ALIVE).mtimeMs < 90000; } catch { /* absent */ }
  try { status = JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch { /* */ }
  try { log = fs.readFileSync(LOG, 'utf8').slice(-3000); } catch { /* */ }
  return { alive, status, log, pending: fs.existsSync(REQ), night: fs.existsSync(NIGHT), notify: String(getSetting('update_notify', '1')) !== '0' };
}
// Enregistre les préférences de mise à jour (nuit, notification)
export function setUpdatePrefs({ night, notify: n }) {
  if (typeof night === 'boolean') { if (night) fs.writeFileSync(NIGHT, '1'); else fs.rmSync(NIGHT, { force: true }); }
  if (typeof n === 'boolean') setSetting('update_notify', n ? '1' : '0');
  return updaterInfo();
}
// Nouvelle version sortie : une notification aux administrateurs (appareils, Telegram, ntfy…), une fois par version
export async function notifyNewVersion() {
  if (String(getSetting('update_notify', '1')) === '0') return 'Notifications de mise à jour désactivées';
  const u = await checkUpdate(true);
  if (u.error) return u.error;
  if (!u.behind || !u.remote) return 'Venus est à jour';
  if (getSetting('update_notified', '') === u.remote) return `${u.behind} nouveauté(s), déjà signalée(s)`;
  setSetting('update_notified', u.remote);
  const first = u.commits[0] ? u.commits[0].title : '';
  await notify({ title: 'Nouvelle version de Venus', body: `${u.behind} nouveauté${u.behind > 1 ? 's' : ''}${first ? ` : ${first}` : ''}. Réglages → Mise à jour pour l’installer.`, url: '/reglages?onglet=maj', tag: 'update' }, { adminOnly: true });
  return `Notification envoyée (${u.behind} nouveauté(s))`;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.VENUS_REPO || 'TOUFATECH/Venus';
const BRANCH = process.env.VENUS_BRANCH || 'main';
export const UPDATE_COMMAND = 'cd /opt/Venus && git pull && bash update.sh';
let cache = { at: 0, data: null };

// Lance une commande dans le dossier de Venus
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd: ROOT, timeout: opts.timeout || 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
});

// Commit installé : .git du dossier, sinon variable d'environnement posée au build de l'image
export async function localCommit() {
  if (process.env.VENUS_COMMIT) return process.env.VENUS_COMMIT.slice(0, 40);
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 40);
    const ref = head.slice(5).trim();
    const f = path.join(ROOT, '.git', ref);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim().slice(0, 40);
    const packed = fs.readFileSync(path.join(ROOT, '.git', 'packed-refs'), 'utf8');
    const m = new RegExp(`^([0-9a-f]{40}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(packed);
    return m ? m[1] : null;
  } catch { return null; }
}

// Compare la version installée à la dernière publiée (cache de 30 minutes)
export async function checkUpdate(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 30 * 60000) return cache.data;
  const local = await localCommit();
  const out = { local: local ? local.slice(0, 7) : null, remote: null, behind: 0, commits: [], docker: runtime.kind === 'docker', canSelfUpdate: !!process.env.VENUS_UPDATE_CMD || (runtime.kind !== 'docker' && fs.existsSync(path.join(ROOT, '.git'))) || (runtime.kind === 'docker' && updaterInfo().alive), command: UPDATE_COMMAND, checkedAt: Date.now(), error: null };
  try {
    const headers = { 'User-Agent': 'Venus/1.0', Accept: 'application/vnd.github+json' };
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=${encodeURIComponent(BRANCH)}&per_page=30`, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
    const list = await r.json();
    out.remote = list[0] ? list[0].sha.slice(0, 7) : null;
    if (local) {
      const idx = list.findIndex((c) => c.sha === local || c.sha.startsWith(local));
      const fresh = idx === -1 ? list : list.slice(0, idx);
      out.behind = idx === -1 ? (out.remote && out.remote !== out.local ? list.length : 0) : fresh.length;
      out.more = idx === -1 && out.behind > 0; // plus ancien que les 30 derniers commits
      out.commits = fresh.map((c) => ({ sha: c.sha.slice(0, 7), title: String(c.commit.message || '').split('\n')[0].slice(0, 140), date: c.commit.author?.date || null }));
    }
  } catch (e) { out.error = `Impossible de joindre GitHub : ${e.message}`; }
  cache = { at: Date.now(), data: out };
  return out;
}

let updating = false;
// Installe la mise à jour (git pull, commande personnalisée ou compagnon Docker)
export async function runUpdate() {
  if (updating) return { ok: false, message: 'Une mise à jour est déjà en cours' };
  updating = true;
  try {
    if (process.env.VENUS_UPDATE_CMD) {
      const r = await run('/bin/sh', ['-c', process.env.VENUS_UPDATE_CMD], { timeout: 15 * 60000 });
      return { ok: r.ok, message: r.ok ? 'Mise à jour lancée. Venus redémarre dans un instant.' : `La commande de mise à jour a échoué : ${(r.err || r.out).slice(-400)}`, log: (r.out + r.err).slice(-4000) };
    }
    if (runtime.kind === 'docker') {
      // Le compagnon fait tout : récupération, reconstruction et redémarrage de Venus
      if (updaterInfo().alive) {
        fs.writeFileSync(REQ, JSON.stringify({ at: Date.now() }));
        fs.writeFileSync(STATUS, JSON.stringify({ state: 'queued', at: Date.now() }));
        cache = { at: 0, data: null };
        return { ok: true, queued: true, message: 'Mise à jour lancée : Venus va se reconstruire et redémarrer (quelques minutes).' };
      }
      return { ok: false, docker: true, message: 'Pour que ce bouton fasse tout seul la mise à jour sous Docker, lancez une fois « bash update.sh » sur la machine (il installe le compagnon de mise à jour). En attendant :', command: UPDATE_COMMAND };
    }
    if (!fs.existsSync(path.join(ROOT, '.git'))) return { ok: false, message: 'Venus n’a pas été installé avec git : mettez à jour les fichiers à la main.' };
    const pull = await run('git', ['pull', '--ff-only'], { timeout: 5 * 60000 });
    if (!pull.ok) return { ok: false, message: `git pull a échoué : ${(pull.err || pull.out).slice(-400)}`, log: pull.out + pull.err };
    cache = { at: 0, data: null };
    // Interface Next.js reconstruite avec le nouveau code (si elle avait été construite). En cas d'échec, l'ancienne
    // construction est retirée : Venus sert alors son interface classique, toujours à jour, plutôt qu'un mélange.
    let web = '';
    if (fs.existsSync(path.join(ROOT, 'web', 'package.json')) && fs.existsSync(path.join(ROOT, 'web', '.next'))) {
      const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`, NEXT_TELEMETRY_DISABLED: '1' };
      const npm = (args) => new Promise((resolve) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: path.join(ROOT, 'web'), env, timeout: 15 * 60000, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32' }, (err, so, se) => resolve({ ok: !err, out: String(so || '') + String(se || '') })));
      const ci = await npm(['ci', '--no-audit', '--no-fund', '--loglevel=error']);
      const build = ci.ok ? await npm(['run', 'build']) : ci;
      if (!build.ok) { fs.rmSync(path.join(ROOT, 'web', '.next'), { recursive: true, force: true }); web = `\nInterface Next.js non reconstruite (interface classique servie) : ${build.out.slice(-300)}`; }
      else web = '\nInterface Next.js reconstruite.';
    }
    // Redémarrage : un superviseur (systemd, pm2, docker) relance Venus ; sinon l'administrateur le fait
    setTimeout(() => process.exit(0), 1500).unref();
    return { ok: true, message: 'Mise à jour installée. Venus redémarre…', log: pull.out + web };
  } finally { updating = false; }
}
