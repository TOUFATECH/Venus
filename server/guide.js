// Guide des épisodes sans clé TMDB : la liste complète des épisodes diffusés vient de TVmaze.
// Sert à montrer les épisodes manquants (diffusés mais absents des dossiers) et les saisons manquantes.
// Gardé dans la fiche de la série (guide_eps), rafraîchi tous les 3 jours au plus.
import { all, get, run } from './db.js';
import { getJson, closeEnough } from './posters.js';

const TVMAZE = process.env.VENUS_TVMAZE_API || 'https://api.tvmaze.com';
const FRESH = 3 * 864e5;
const busy = new Map();

async function findId(show) {
  if (show.tvmaze_id) return show.tvmaze_id;
  const d = await getJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(show.title)}`);
  if (!Array.isArray(d)) return null;
  const anime = show.category === 'anime';
  const yearOf = (s) => Number((s.premiered || '').slice(0, 4)) || null;
  const list = d.map((x) => x.show).filter((s) => s && closeEnough(s.name, show.title) && (!anime || s.type === 'Animation' || s.language === 'Japanese'));
  const best = (show.year && list.find((s) => Math.abs((yearOf(s) || 0) - show.year) <= 1)) || list[0];
  if (!best) return null;
  run('UPDATE items SET tvmaze_id = ? WHERE id = ?', best.id, show.id);
  return best.id;
}

// Récupère (ou rafraîchit) le guide d'une série ; renvoie la liste [{ s, n, title, air, still }]
export async function ensureGuide(showId, { force = false } = {}) {
  const show = get("SELECT id, title, year, category, tvmaze_id, guide_eps, guide_at FROM items WHERE id = ? AND type = 'show'", showId);
  if (!show) return [];
  const cached = () => { try { return JSON.parse(show.guide_eps || '[]'); } catch { return []; } };
  if (!force && show.guide_at && Date.now() - show.guide_at < FRESH) return cached();
  if (busy.has(showId)) return busy.get(showId);
  const job = (async () => {
    try {
      const id = await findId(show);
      if (!id) { run('UPDATE items SET guide_at = ? WHERE id = ?', Date.now(), show.id); return cached(); }
      const eps = await getJson(`${TVMAZE}/shows/${id}/episodes`);
      if (!Array.isArray(eps)) return cached();
      const guide = eps.filter((e) => e && e.season > 0 && e.number > 0).map((e) => ({
        s: e.season, n: e.number, title: e.name && !/^episode \d+$/i.test(e.name) ? e.name : null, air: e.airdate || null,
        still: e.image && (e.image.medium || e.image.original) ? (e.image.medium || e.image.original) : null,
      }));
      run('UPDATE items SET guide_eps = ?, guide_at = ? WHERE id = ?', JSON.stringify(guide), Date.now(), show.id);
      return guide;
    } catch {
      // Service injoignable : on réessaiera dans une heure (pas à chaque ouverture de la fiche)
      run('UPDATE items SET guide_at = ? WHERE id = ?', Date.now() - FRESH + 3600e3, show.id);
      return cached();
    } finally { busy.delete(showId); }
  })();
  busy.set(showId, job);
  return job;
}

// Pour la fiche : attend le guide au plus `ms` millisecondes (on n'allonge pas l'ouverture de la fiche)
export async function guideFor(showId, ms = 3500) {
  const show = get('SELECT guide_eps, guide_at FROM items WHERE id = ?', showId);
  const cached = (() => { try { return JSON.parse((show && show.guide_eps) || '[]'); } catch { return []; } })();
  if (show && show.guide_at && Date.now() - show.guide_at < FRESH) return cached;
  return Promise.race([ensureGuide(showId), new Promise((r) => setTimeout(() => r(cached), ms))]);
}

// Tâche quotidienne : séries regardées ou ajoutées récemment d'abord, 80 par passage
export async function refreshGuides() {
  const shows = all(`SELECT s.id FROM items s WHERE s.type = 'show' AND (s.guide_at IS NULL OR s.guide_at < ?)
    ORDER BY (SELECT MAX(p.updated_at) FROM progress p JOIN items e ON e.id = p.item_id WHERE e.show_id = s.id) DESC, s.added_at DESC LIMIT 80`, Date.now() - FRESH);
  let n = 0;
  for (const s of shows) { const g = await ensureGuide(s.id, { force: true }); if (g.length) n++; await new Promise((r) => setTimeout(r, 400)); }
  return `${n} guide(s) d'épisodes mis à jour`;
}
