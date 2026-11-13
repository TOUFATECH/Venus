// Autotest des médias automatiques, de bout en bout, avec un film du DOMAINE PUBLIC pris sur archive.org :
//   Bygul (les sources répondent ?) → envie → téléchargement (Fólkvangr ou ton client) → rangement dans la
//   médiathèque → vérification du fichier → tout est retiré (téléchargement, fichier, envie).
// Seuls les éléments d'archive.org sont acceptés ici : l'autotest ne télécharge jamais d'œuvre protégée.
import fs from 'node:fs';
import path from 'node:path';
import { addWant, wantById, removeWant, grab, poll, defaultDeps } from './engine.js';
import { bygulSearch } from './bygul.js';
import { parseRelease } from './release.js';

export const DEFAULT_ITEM = { id: 'public-domain-spotlight-the-skeleton-dance', title: 'The Skeleton Dance', year: 1929 };
export const state = { running: false, steps: [], result: null, startedAt: null, item: null };
const step = (text, ok = true) => { state.steps.push({ at: Date.now(), text, ok }); };

/** Lance l'autotest (une seule fois à la fois). item : { id (identifiant archive.org), title, year }. */
export function startSelfTest(item = DEFAULT_ITEM, deps = defaultDeps, opts = {}) {
  if (state.running) throw new Error('un autotest est déjà en cours');
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(item.id || '')) throw new Error('identifiant archive.org invalide');
  Object.assign(state, { running: true, steps: [], result: null, startedAt: Date.now(), item });
  const p = run(item, deps, opts).catch((e) => { step(`Arrêt : ${e.message}`, false); state.result = 'échec'; }).finally(() => { state.running = false; });
  return opts.wait ? p.then(() => state) : state;
}

async function run(item, deps, { timeoutMs = 30 * 60e3, everyMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // 1. Bygul : les sources répondent-elles ? (simple recherche, rien n'est téléchargé depuis elles)
  try {
    const r = await (deps.search || bygulSearch)({ kind: 'movie', title: item.title, year: item.year });
    step(r.sources ? `Bygul : ${r.sources} source(s) interrogée(s), ${r.results.length} résultat(s)${r.errors.length ? `, ${r.errors.length} en erreur` : ''}` : 'Bygul : aucune source active (ajoute ou importe tes sources)', !!r.sources && r.errors.length < r.sources);
  } catch (e) { step(`Bygul : ${e.message}`, false); }
  // 2. Envie + téléchargement du torrent d'archive.org (web seeds HTTP d'archive.org + pairs)
  const id = addWant({ kind: 'movie', title: item.title, year: item.year, showKey: `autotest:${item.id}` });
  const link = `https://archive.org/download/${item.id}/${item.id}_archive.torrent`;
  const rel = `${item.title.replace(/[^\w]+/g, '.')}.${item.year}.Domaine.Public.archive.org`;
  try {
    await grab(wantById(id), { r: { title: rel, link }, score: 0, cible: true, p: parseRelease(rel) }, deps);
    const w = wantById(id); step(`Téléchargement lancé dans ${w.grab.engine === 'venus' ? 'Fólkvangr' : w.grab.engine} : ${link}`);
    // 3. Suivi jusqu'au rangement
    const t0 = Date.now(); let last = -1;
    for (;;) {
      await poll(deps);
      const x = wantById(id);
      if (x.status === 'range') { step(`Rangé dans la médiathèque : ${x.file}`); break; }
      if (x.status === 'erreur') throw new Error(x.note || 'erreur au rangement');
      if (x.status !== 'telechargement') throw new Error(x.note || `téléchargement en échec (${x.status})`);
      if (Math.floor((x.progress || 0) / 25) !== last) { last = Math.floor((x.progress || 0) / 25); step(`Progression : ${x.progress || 0} %`); }
      if (Date.now() - t0 > timeoutMs) throw new Error(`pas fini après ${Math.round(timeoutMs / 60000)} min (progression ${x.progress} %)`);
      await sleep(everyMs);
    }
    // 4. Vérification du fichier rangé
    const x = wantById(id), st = fs.statSync(x.file);
    if (st.size < 100 * 1024) throw new Error(`fichier rangé trop petit (${st.size} octets)`);
    step(`Fichier vérifié : ${path.basename(x.file)} (${(st.size / 1048576).toFixed(1)} Mo)`);
    state.result = 'réussi';
  } finally {
    // 5. Tout est retiré
    const x = wantById(id);
    if (x?.grab?.id) await deps.engine().remove(x.grab.id, true).catch(() => {});
    if (x?.file) { try { fs.rmSync(x.file, { force: true }); const d = path.dirname(x.file); if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch { /* déjà retiré */ } deps.scan?.(); }
    removeWant(id);
    step('Nettoyé : téléchargement, fichier rangé et envie retirés');
  }
}
