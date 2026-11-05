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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.VENUS_REPO || 'TOUFATECH/Venus';
const BRANCH = process.env.VENUS_BRANCH || 'main';
export const UPDATE_COMMAND = 'cd /opt/Venus && git pull && docker compose up -d --build';
let cache = { at: 0, data: null };

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

export async function checkUpdate(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 30 * 60000) return cache.data;
  const local = await localCommit();
  const out = { local: local ? local.slice(0, 7) : null, remote: null, behind: 0, commits: [], docker: runtime.kind === 'docker', canSelfUpdate: !!process.env.VENUS_UPDATE_CMD || (runtime.kind !== 'docker' && fs.existsSync(path.join(ROOT, '.git'))), command: UPDATE_COMMAND, checkedAt: Date.now(), error: null };
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
export async function runUpdate() {
  if (updating) return { ok: false, message: 'Une mise à jour est déjà en cours' };
  updating = true;
  try {
    if (process.env.VENUS_UPDATE_CMD) {
      const r = await run('/bin/sh', ['-c', process.env.VENUS_UPDATE_CMD], { timeout: 15 * 60000 });
      return { ok: r.ok, message: r.ok ? 'Mise à jour lancée. Venus redémarre dans un instant.' : `La commande de mise à jour a échoué : ${(r.err || r.out).slice(-400)}`, log: (r.out + r.err).slice(-4000) };
    }
    if (runtime.kind === 'docker') return { ok: false, docker: true, message: 'Sous Docker, la mise à jour se fait depuis la machine hôte.', command: UPDATE_COMMAND };
    if (!fs.existsSync(path.join(ROOT, '.git'))) return { ok: false, message: 'Venus n’a pas été installé avec git : mettez à jour les fichiers à la main.' };
    const pull = await run('git', ['pull', '--ff-only'], { timeout: 5 * 60000 });
    if (!pull.ok) return { ok: false, message: `git pull a échoué : ${(pull.err || pull.out).slice(-400)}`, log: pull.out + pull.err };
    cache = { at: 0, data: null };
    // Redémarrage : un superviseur (systemd, pm2, docker) relance Venus ; sinon l'administrateur le fait
    setTimeout(() => process.exit(0), 1500).unref();
    return { ok: true, message: 'Mise à jour installée. Venus redémarre…', log: pull.out };
  } finally { updating = false; }
}
