// « Nouvel épisode » : quand l'analyse ajoute des épisodes d'une série qu'un profil suit (il en a déjà regardé
// au moins un, ou la série est dans sa liste), ce profil est prévenu : message dans l'application ouverte et
// notification sur ses appareils. Un seul message par série et par analyse : « Dr Stone : É10 à É12 ».
import { all, getSetting, setSetting } from './db.js';
import { notify } from './notify.js';
import { pathFor } from './slugs.js';

const rangeOf = (eps) => {
  const bySeason = new Map();
  for (const e of eps) { const l = bySeason.get(e.season_num) || []; l.push(e.episode_num); bySeason.set(e.season_num, l); }
  return [...bySeason].map(([s, l]) => { l.sort((a, b) => a - b); return l.length === 1 ? `S${s} É${l[0]}` : `S${s} É${l[0]} à É${l[l.length - 1]}`; }).join(', ');
};

export async function announceNewEpisodes() {
  if (String(getSetting('notify_episodes', '1')) === '0') return 0;
  const since = Number(getSetting('new_eps_checked', 0)) || Date.now() - 3600e3;
  const now = Date.now();
  setSetting('new_eps_checked', now);
  const eps = all(`SELECT e.id, e.show_id, e.season_num, e.episode_num, s.title AS show_title FROM items e JOIN items s ON s.id = e.show_id
    WHERE e.type = 'episode' AND e.added_at > ? AND e.added_at <= ? ORDER BY e.season_num, e.episode_num`, since, now);
  if (!eps.length) return 0;
  const byShow = new Map();
  for (const e of eps) { const l = byShow.get(e.show_id) || []; l.push(e); byShow.set(e.show_id, l); }
  let sent = 0;
  for (const [showId, list] of byShow) {
    // Profils qui suivent la série : un épisode commencé ou vu, ou la série dans leur liste
    const fans = all(`SELECT DISTINCT p.profile_id AS id FROM progress p JOIN items e ON e.id = p.item_id WHERE e.show_id = ? AND e.id NOT IN (${list.map(() => '?').join(',')})
      UNION SELECT profile_id AS id FROM mylist WHERE item_id = ?`, showId, ...list.map((e) => e.id), showId);
    if (!fans.length) continue;
    const first = list[0];
    const body = list.length === 1 ? `${first.show_title} : ${rangeOf(list)}` : `${first.show_title} : ${list.length} nouveaux épisodes (${rangeOf(list)})`;
    for (const f of fans) {
      await notify({ title: list.length === 1 ? 'Nouvel épisode' : 'Nouveaux épisodes', body, url: pathFor(first.id) || '/', tag: `eps-${showId}` }, { profileId: f.id }).catch(() => {});
      sent++;
    }
  }
  return sent;
}
