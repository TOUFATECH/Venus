// Santé des disques et du NAS : pour chaque bibliothèque, Venus mesure le temps de réponse du dossier et la vitesse
// de lecture réelle (64 Mo lus au milieu d'une grosse vidéo, là où rien n'est en cache). Il compare avec le débit
// des vidéos les plus lourdes de la bibliothèque : si le partage est trop lent pour elles, l'administrateur est prévenu.
import fs from 'node:fs';
import { all, getSetting, setSetting } from './db.js';
import { notify } from './notify.js';

const MB = 1024 * 1024;
function timeRead(file, size) {
  return new Promise((resolve) => {
    const want = 64 * MB;
    const start = size > want * 3 ? Math.floor((size / 2 + Math.random() * size / 4) / MB) * MB : 0;
    const t0 = process.hrtime.bigint();
    let n = 0;
    const st = fs.createReadStream(file, { start, end: start + want - 1, highWaterMark: 4 * MB });
    const stop = setTimeout(() => st.destroy(new Error('timeout')), 60000);
    st.on('data', (c) => { n += c.length; });
    st.on('close', () => {
      clearTimeout(stop);
      const s = Number(process.hrtime.bigint() - t0) / 1e9;
      resolve(n ? { mbps: (n / MB) / Math.max(s, 0.001), bytes: n, seconds: s } : null);
    });
    st.on('error', () => {});
  });
}

export async function checkNas() {
  const out = [];
  for (const lib of all("SELECT id, name, path, type FROM libraries WHERE type != 'iptv' AND path NOT LIKE 'venus:%'")) {
    const r = { id: lib.id, name: lib.name, path: lib.path, ok: false };
    try {
      const t0 = Date.now();
      fs.readdirSync(lib.path);
      r.listMs = Date.now() - t0;
    } catch (e) { r.error = `Dossier injoignable (${e.code || e.message})`; out.push(r); continue; }
    // Débit nécessaire : la vidéo la plus lourde parmi les plus regardées / ajoutées (au 95e centile)
    const rows = all("SELECT path, size, probe FROM items WHERE library_id = ? AND path IS NOT NULL AND type IN ('movie','episode','clip') ORDER BY size DESC LIMIT 200", lib.id);
    const rates = rows.map((x) => { try { return JSON.parse(x.probe).bitrate || 0; } catch { return 0; } }).filter(Boolean).sort((a, b) => a - b);
    r.needMbps = rates.length ? rates[Math.min(rates.length - 1, Math.floor(rates.length * 0.95))] / 8 / MB : null;
    const big = rows.find((x) => x.size > 300 * MB && fs.existsSync(x.path));
    if (big) {
      const m = await timeRead(big.path, big.size);
      if (m) r.readMbps = Math.round(m.mbps * 10) / 10;
    }
    r.ok = r.listMs < 3000 && (r.readMbps == null || r.needMbps == null || r.readMbps >= r.needMbps * 1.5);
    r.verdict = r.readMbps == null ? 'Pas encore de grosse vidéo pour mesurer la vitesse'
      : r.ok ? `Assez rapide : ${r.readMbps} Mo/s (les vidéos les plus lourdes demandent ${r.needMbps ? r.needMbps.toFixed(1) : '?'} Mo/s)`
        : `Trop lent pour les vidéos les plus lourdes : ${r.readMbps} Mo/s lus, ${r.needMbps.toFixed(1)} Mo/s nécessaires (×1,5 de marge). Vérifiez le câble réseau (1 Gb/s), le Wi-Fi du NAS ou ses disques.`;
    if (r.listMs >= 3000) r.verdict = `Le dossier met ${(r.listMs / 1000).toFixed(1)} s à répondre : le NAS est peut-être en veille ou surchargé.`;
    out.push(r);
  }
  const result = { at: Date.now(), libraries: out };
  setSetting('nas_health', result);
  const bad = out.filter((x) => !x.ok);
  const key = bad.map((x) => x.id).join(',');
  if (bad.length && getSetting('nas_warned', '') !== key) {
    setSetting('nas_warned', key);
    notify({ title: 'NAS trop lent ou injoignable', body: bad.map((x) => `${x.name} : ${x.error || x.verdict}`).join(' · ').slice(0, 300), url: '/dashboard?vue=sante', tag: 'nas' }, { adminOnly: true }).catch(() => {});
  } else if (!bad.length) setSetting('nas_warned', '');
  return result;
}
export const nasHealth = () => getSetting('nas_health', null);
