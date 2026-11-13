// Fólkvangr dans Venus : le moteur BitTorrent de Venus, démarré à la première utilisation, ses téléchargements
// gardés dans la base PostgreSQL (reprise après redémarrage). Port d'écoute : réglage « folk_port » (51413 par défaut).
import { db, all, run, getSetting } from '../db.js';
import { setNativeEngine } from './engine.js';

db.exec('CREATE TABLE IF NOT EXISTS folk_torrents (info_hash TEXT PRIMARY KEY, rec TEXT NOT NULL, updated_at INTEGER)');
const store = {
  load: () => all('SELECT rec FROM folk_torrents').map((r) => JSON.parse(r.rec)),
  save: (recs) => {
    const keep = new Set(recs.map((r) => r.infoHash));
    for (const r of all('SELECT info_hash FROM folk_torrents')) if (!keep.has(r.info_hash)) run('DELETE FROM folk_torrents WHERE info_hash = ?', r.info_hash);
    for (const r of recs) run('INSERT INTO folk_torrents(info_hash, rec, updated_at) VALUES(?, ?, ?) ON CONFLICT(info_hash) DO UPDATE SET rec = excluded.rec, updated_at = excluded.updated_at', r.infoHash, JSON.stringify(r), Date.now());
  },
};
let started = null;
export function folkvangr() {
  if (!started) started = import('../folkvangr/client.js').then(({ Folkvangr }) => new Folkvangr({
    port: Number(process.env.VENUS_TORRENT_PORT || getSetting('folk_port', 51413)) || 51413, store,
    seedRatio: Number(getSetting('folk_seed_ratio', 1)), seedHours: Number(getSetting('folk_seed_hours', 72)),
  }).start()).catch((e) => { started = null; throw new Error(`Fólkvangr ne démarre pas : ${e.message}`); });
  return started;
}
setNativeEngine(() => ({
  add: async (rel, tag, dir) => (await folkvangr()).add(rel.link, { tags: [tag], dir }),
  list: async () => (await folkvangr()).list(),
  remove: async (id, files = false) => (await folkvangr()).remove(id, { files }),
}));
/** Au démarrage de Venus : reprend les téléchargements en cours (s'il y en a). */
export function resumeFolkvangr() { if (all('SELECT 1 FROM folk_torrents LIMIT 1').length) folkvangr().catch((e) => console.warn('[fólkvangr]', e.message)); }
