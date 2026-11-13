// Guide des programmes (EPG) au format XMLTV : adresse trouvée dans la liste M3U
// (url-tvg / x-tvg-url), fournie par l'abonnement Xtream, ou ajoutée à la main dans les réglages.
// Le fichier (souvent gros, parfois compressé en .gz) est lu au fil de l'eau : seules les chaînes
// présentes dans Venus et les 3 prochains jours sont gardés.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { db, all, get, run, tx, getSetting, setSetting } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS epg (channel_id INTEGER REFERENCES items(id) ON DELETE CASCADE, start INTEGER, stop INTEGER, title TEXT, sub TEXT, descr TEXT, cat TEXT, icon TEXT, ep TEXT);
CREATE INDEX IF NOT EXISTS idx_epg ON epg(channel_id, start);`);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(hd|fhd|uhd|4k|sd|fr|\|)\b/g, '').replace(/[^a-z0-9]+/g, '');
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]) : ''; };
// « 20261103183000 +0100 » → millisecondes
export function xmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s || '').trim());
  if (!m) return null;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { const sign = m[7][0] === '-' ? -1 : 1; t -= sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5))) * 60000; }
  return t;
}

// Adresses EPG : réglage manuel + détectées dans les listes M3U (enregistrées au scan)
export function epgSources() {
  const manual = String(getSetting('epg_urls', '') || '').split(/\s+/).filter((u) => /^https?:\/\//i.test(u) || u.startsWith('/'));
  const auto = Object.values(getSetting('epg_auto', {}) || {}).flat().filter(Boolean);
  return [...new Set([...manual, ...auto])];
}
export function rememberEpgUrl(libId, urls) {
  const auto = getSetting('epg_auto', {}) || {};
  auto[libId] = urls;
  setSetting('epg_auto', auto);
}

// Guide gratuit des chaînes françaises (TNT, Outre-mer La 1ère…) : projet XML-TV-Fr (xmltvfr.fr).
// Plusieurs adresses possibles (compressée, complète, TNT seule) : la première qui répond est prise.
export const FREE_GUIDE = 'venus:guide-fr';
const FREE_GUIDE_URLS = (process.env.VENUS_GUIDE_FR || 'https://xmltvfr.fr/xmltv/xmltv.xml.gz https://xmltvfr.fr/xmltv/xmltv.xml https://xmltvfr.fr/xmltv/xmltv_tnt.xml').split(/\s+/).filter(Boolean);
async function openSource(src) {
  if (src === FREE_GUIDE) {
    let last = null;
    for (const u of FREE_GUIDE_URLS) { try { return await openSource(u); } catch (e) { last = e; } }
    throw last || new Error('guide gratuit injoignable');
  }
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { 'User-Agent': 'Venus/1.0' }, signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`guide inaccessible (${res.status})`);
    return Readable.fromWeb(res.body);
  }
  return fs.createReadStream(src);
}

// Lit un fichier XMLTV en continu ; renvoie le nombre de programmes gardés
async function importSource(src, channels, from, to, rows) {
  const raw = await openSource(src);
  // Compressé ? (les deux premiers octets d'un .gz sont 1f 8b)
  const first = await new Promise((resolve, reject) => { raw.once('readable', () => resolve(raw.read(2))); raw.once('error', reject); });
  if (!first) return 0;
  raw.unshift(first);
  const stream = first[0] === 0x1f && first[1] === 0x8b ? raw.pipe(zlib.createGunzip()) : raw;
  stream.setEncoding('utf8');
  const idMap = new Map(); // id XMLTV → id de la chaîne Venus
  // Une même chaîne peut être dans plusieurs listes : un identifiant XMLTV → plusieurs chaînes Venus
  const group = (pairs) => { const m = new Map(); for (const [k, id] of pairs) { if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(id); } return m; };
  // Identifiants « TF1.fr@SD » (iptv-org) : la variante après « @ » est ignorée pour retrouver « TF1.fr »
  const keyOf = (k) => String(k).toLowerCase().replace(/@.*$/, '');
  const byKey = group(channels.filter((c) => c.key).map((c) => [keyOf(c.key), c.id]));
  const byName = group(channels.map((c) => [norm(c.title), c.id]));
  let buf = '', kept = 0, total = 0;
  const handle = () => {
    // Définitions des chaînes
    for (const m of buf.matchAll(/<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi)) {
      const id = decode(m[1]);
      if (idMap.has(id)) continue;
      const names = [...m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/gi)].map((x) => decode(x[1]));
      const cids = byKey.get(keyOf(id)) ?? names.map((n) => byName.get(norm(n))).find((x) => x != null) ?? byName.get(norm(id));
      idMap.set(id, cids ?? null);
    }
    let last = 0;
    for (const m of buf.matchAll(/<programme\s([^>]*)>([\s\S]*?)<\/programme>/gi)) {
      last = m.index + m[0].length;
      total++;
      const attrs = m[1];
      const ch = (/channel="([^"]+)"/i.exec(attrs) || [])[1];
      let cids = ch != null ? idMap.get(decode(ch)) : null;
      if (cids === undefined) { cids = byKey.get(keyOf(decode(ch))) ?? byName.get(norm(decode(ch))) ?? null; idMap.set(decode(ch), cids); }
      if (!cids) continue;
      const start = xmltvTime((/start="([^"]+)"/i.exec(attrs) || [])[1]);
      const stop = xmltvTime((/stop="([^"]+)"/i.exec(attrs) || [])[1]);
      if (!start || !stop || stop < from || start > to) continue;
      const body = m[2];
      const row = [start, stop, tag(body, 'title').slice(0, 300) || 'Programme', tag(body, 'sub-title').slice(0, 300) || null, tag(body, 'desc').slice(0, 1500) || null,
        tag(body, 'category').slice(0, 80) || null, ((/<icon\s+src="([^"]+)"/i.exec(body) || [])[1] || null), tag(body, 'episode-num').slice(0, 40) || null];
      for (const cid of cids) rows.push([cid, ...row]);
      kept++;
    }
    // On garde la fin du tampon qui peut contenir un élément pas encore complet
    const cut = Math.max(last, buf.lastIndexOf('</channel>') + 10, buf.length - 200000);
    if (cut > 0) buf = buf.slice(cut);
  };
  for await (const chunk of stream) {
    buf += chunk;
    if (buf.length > 400000) handle();
  }
  handle();
  return { kept, total };
}

export async function refreshEpg(progress = () => {}) {
  const sources = epgSources();
  if (!sources.length) return 'Aucune adresse de guide (EPG) : ajoutez-en une dans Réglages → TV en direct';
  const channels = all("SELECT id, key, title FROM items WHERE type = 'channel'");
  if (!channels.length) return 'Aucune chaîne';
  const from = Date.now() - 6 * 3600e3, to = Date.now() + 4 * 86400e3;
  const rows = [];
  const report = [];
  for (const [i, src] of sources.entries()) {
    try { const r = await importSource(src, channels, from, to, rows); report.push(`${r.kept} programmes`); }
    catch (e) { report.push(`erreur : ${e.message}`); console.warn(`[epg] ${src.replace(/(password|pass)=[^&]+/i, '$1=•••')} : ${e.message}`); }
    progress((i + 1) / sources.length);
  }
  if (rows.length) {
    tx(() => {
      run('DELETE FROM epg');
      const ins = db.prepare('INSERT INTO epg(channel_id, start, stop, title, sub, descr, cat, icon, ep) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) ins.run(...r);
    });
  }
  setSetting('epg_last', { at: Date.now(), programs: rows.length, channels: new Set(rows.map((r) => r[0])).size });
  console.log(`[epg] ${rows.length} programmes pour ${new Set(rows.map((r) => r[0])).size} chaînes`);
  return `${rows.length} programmes, ${new Set(rows.map((r) => r[0])).size} chaînes (${report.join(' ; ')})`;
}

export const pruneEpg = () => run('DELETE FROM epg WHERE stop < ?', Date.now() - 6 * 3600e3);
export const programsBetween = (from, to, ids = null) => all(`SELECT rowid AS id, channel_id AS channel, start, stop, title, sub, descr, cat, icon, ep FROM epg WHERE stop > ? AND start < ?${ids ? ` AND channel_id IN (${ids.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY channel_id, start`, from, to, ...(ids || []));
export const programById = (id) => get('SELECT rowid AS id, channel_id AS channel, start, stop, title, sub, descr, cat, icon, ep FROM epg WHERE rowid = ?', Number(id));
export function nowNext(ids) {
  const now = Date.now();
  const list = programsBetween(now, now + 6 * 3600e3, ids);
  const out = {};
  for (const p of list) { const o = (out[p.channel] ||= []); if (o.length < 2) o.push(p); }
  return out;
}
export const epgState = () => ({ sources: epgSources(), last: getSetting('epg_last', null), manual: String(getSetting('epg_urls', '') || '') });
