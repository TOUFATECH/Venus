// Venus · Médias automatiques — les sources (indexeurs Torznab / Newznab) et les moteurs de téléchargement
// (qBittorrent, Transmission, SABnzbd), pilotés par leurs API officielles.
//
// Venus ne cherche QUE dans les sources que tu as ajoutées toi-même (aucune n'est fournie) : à toi de n'ajouter
// que des sources autorisées. Les mots de passe et clés restent sur ce serveur et ne sont jamais renvoyés.

const T = (ms) => AbortSignal.timeout(ms);
const unxml = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();

// ---------------------------------------------------------------- indexeurs (Torznab / Newznab)
/** Catégories standard Newznab. */
export const CATS = { movie: [2000], episode: [5000], season: [5000], album: [3000], audiobook: [3030], book: [7000, 7020] };

/** Lit la réponse RSS d'un indexeur Torznab / Newznab. Pur. */
export function parseFeed(xml, protocol = 'torrent') {
  const out = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const it = m[1], tag = (n) => { const x = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`).exec(it); return x ? unxml(x[1]) : ''; };
    const attrs = {}; for (const a of it.matchAll(/<(?:torznab|newznab):attr\s+name="([^"]+)"\s+value="([^"]*)"/g)) attrs[a[1]] = unxml(a[2]);
    const enc = /<enclosure\b[^>]*url="([^"]+)"[^>]*?(?:length="(\d+)")?/.exec(it);
    const link = attrs.magneturl || (enc ? unxml(enc[1]) : tag('link'));
    const title = tag('title'); if (!title || !link) continue;
    out.push({
      title, link, guid: tag('guid') || link, protocol,
      size: Number(attrs.size || tag('size') || enc?.[2] || 0), seeders: attrs.seeders !== undefined ? Number(attrs.seeders) : undefined, peers: attrs.peers !== undefined ? Number(attrs.peers) : undefined,
      infohash: (attrs.infohash || (/btih:([a-f0-9]{40})/i.exec(link)?.[1] ?? '')).toLowerCase() || undefined, date: Date.parse(tag('pubDate')) || undefined,
      category: Number(attrs.category || 0) || undefined,
    });
  }
  return out;
}
/** L'adresse de recherche (Torznab / Newznab). Pur. */
export function searchUrl(ix, want) {
  const u = new URL(`${ix.url.replace(/\/+$/, '')}${/\/api$/.test(ix.url) ? '' : '/api'}`);
  const q = (k, v) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); };
  q('apikey', ix.key);
  q('cat', (CATS[want.kind] ?? []).join(','));
  if (want.kind === 'movie') { q('t', 'movie'); q('q', `${want.searchTitle ?? want.title}${want.year ? ` ${want.year}` : ''}`); }
  else if (want.kind === 'episode' || want.kind === 'season') { q('t', 'tvsearch'); q('q', want.searchTitle ?? want.title); q('season', want.season); if (want.kind === 'episode') q('ep', want.episode); }
  else if (want.kind === 'album') { q('t', 'music'); q('q', `${want.artist} ${want.title}`); }
  else { q('t', 'book'); q('q', `${want.author ?? ''} ${want.title}`.trim()); }
  q('limit', 100);
  return u.toString();
}
export async function searchIndexer(ix, want, fetcher = fetch) {
  const r = await fetcher(searchUrl(ix, want), { signal: T(30000), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!r.ok) throw new Error(`${ix.name} : ${r.status}`);
  const text = await r.text();
  const err = /<error\b[^>]*description="([^"]+)"/.exec(text); if (err) throw new Error(`${ix.name} : ${unxml(err[1])}`);
  return parseFeed(text, ix.kind === 'newznab' ? 'usenet' : 'torrent').map((x) => ({ ...x, indexer: ix.name }));
}
/** Cherche dans toutes les sources actives du bon protocole, sans s'arrêter si l'une est en panne. */
export async function searchAll(indexers, want, fetcher = fetch) {
  const errors = [], results = [];
  await Promise.all(indexers.filter((x) => x.enabled !== false).map(async (ix) => { try { results.push(...await searchIndexer(ix, want, fetcher)); } catch (e) { errors.push(e.message); } }));
  return { results, errors };
}

// ---------------------------------------------------------------- moteurs de téléchargement
/** État commun : { id, name, progress (0-100), done, failed, path (fichier ou dossier), size, eta (s), speed (o/s) } */
export function client(conf, fetcher = fetch) {
  if (conf.type === 'qbittorrent') return qbittorrent(conf, fetcher);
  if (conf.type === 'transmission') return transmission(conf, fetcher);
  if (conf.type === 'sabnzbd') return sabnzbd(conf, fetcher);
  throw new Error('moteur de téléchargement inconnu');
}
const base = (c) => String(c.url || '').replace(/\/+$/, '');

function qbittorrent(c, fetcher) {
  let sid = '';
  const login = async () => {
    const r = await fetcher(`${base(c)}/api/v2/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base(c) }, body: new URLSearchParams({ username: c.user || '', password: c.password || '' }), signal: T(15000) });
    const t = await r.text();
    if (!r.ok || !/^ok/i.test(t.trim())) throw new Error('qBittorrent refuse la connexion (identifiant ou mot de passe)');
    sid = (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const api = async (path, body) => {
    if (!sid) await login();
    const go = () => fetcher(`${base(c)}/api/v2${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: sid, Referer: base(c), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? new URLSearchParams(body) : undefined, signal: T(20000) });
    let r = await go(); if (r.status === 403) { await login(); r = await go(); }
    if (!r.ok) throw new Error(`qBittorrent : ${r.status}`);
    return r;
  };
  const cat = c.category || 'venus';
  return {
    async test() { const r = await api('/app/version'); return `qBittorrent ${(await r.text()).trim()}`; },
    async add(rel, tag, savePath) { await api('/torrents/add', { urls: rel.link, category: cat, tags: tag, ...(savePath ? { savepath: savePath } : {}) }); return rel.infohash || null; },
    async list() {
      const l = await (await api(`/torrents/info?category=${encodeURIComponent(cat)}`)).json();
      return l.map((t) => ({ id: t.hash, tags: String(t.tags || '').split(',').map((x) => x.trim()), name: t.name, progress: Math.round((t.progress || 0) * 100), done: t.progress >= 1 || /^(uploading|stalledUP|pausedUP|stoppedUP|queuedUP|forcedUP|checkingUP)$/.test(t.state), failed: /^(error|missingFiles)$/.test(t.state), path: t.content_path || `${t.save_path}/${t.name}`, size: t.size, eta: t.eta, speed: t.dlspeed }));
    },
    async remove(id, files = false) { await api('/torrents/delete', { hashes: id, deleteFiles: files ? 'true' : 'false' }); },
  };
}
function transmission(c, fetcher) {
  let sid = '';
  const rpc = async (method, args = {}) => {
    const url = `${base(c)}${/\/rpc$/.test(base(c)) ? '' : '/transmission/rpc'}`, auth = c.user ? { Authorization: `Basic ${Buffer.from(`${c.user}:${c.password || ''}`).toString('base64')}` } : {};
    const go = () => fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Transmission-Session-Id': sid, ...auth }, body: JSON.stringify({ method, arguments: args }), signal: T(20000) });
    let r = await go(); if (r.status === 409) { sid = r.headers.get('x-transmission-session-id') || ''; r = await go(); }
    if (r.status === 401) throw new Error('Transmission refuse la connexion (identifiant ou mot de passe)');
    if (!r.ok) throw new Error(`Transmission : ${r.status}`);
    const d = await r.json(); if (d.result !== 'success') throw new Error(`Transmission : ${d.result}`);
    return d.arguments;
  };
  return {
    async test() { const a = await rpc('session-get', { fields: ['version'] }); return `Transmission ${a.version}`; },
    async add(rel, tag, savePath) { const a = await rpc('torrent-add', { filename: rel.link, labels: ['venus', tag], ...(savePath ? { 'download-dir': savePath } : {}) }); const t = a['torrent-added'] || a['torrent-duplicate']; return t?.hashString?.toLowerCase() || rel.infohash || null; },
    async list() {
      const a = await rpc('torrent-get', { fields: ['hashString', 'name', 'percentDone', 'status', 'downloadDir', 'labels', 'totalSize', 'eta', 'rateDownload', 'error', 'leftUntilDone'] });
      return (a.torrents || []).filter((t) => (t.labels || []).includes('venus')).map((t) => ({ id: t.hashString.toLowerCase(), tags: t.labels || [], name: t.name, progress: Math.round((t.percentDone || 0) * 100), done: t.leftUntilDone === 0 && t.percentDone >= 1, failed: t.error > 0 && t.error !== 1, path: `${t.downloadDir}/${t.name}`, size: t.totalSize, eta: t.eta, speed: t.rateDownload }));
    },
    async remove(id, files = false) { await rpc('torrent-remove', { ids: [id], 'delete-local-data': files }); },
  };
}
function sabnzbd(c, fetcher) {
  const api = async (params) => {
    const u = new URL(`${base(c)}/api`); for (const [k, v] of Object.entries({ ...params, apikey: c.key || '', output: 'json' })) u.searchParams.set(k, String(v));
    const r = await fetcher(u, { signal: T(20000) }); if (!r.ok) throw new Error(`SABnzbd : ${r.status}`);
    const d = await r.json(); if (d.status === false || d.error) throw new Error(`SABnzbd : ${d.error || 'refus'}`); return d;
  };
  const cat = c.category || 'venus';
  return {
    async test() { const d = await api({ mode: 'version' }); return `SABnzbd ${d.version}`; },
    async add(rel, tag) { const d = await api({ mode: 'addurl', name: rel.link, cat, nzbname: tag }); return d.nzo_ids?.[0] || null; },
    async list() {
      const q = await api({ mode: 'queue' }), h = await api({ mode: 'history', limit: 100 });
      return [
        ...(q.queue?.slots || []).filter((s) => s.cat === cat).map((s) => ({ id: s.nzo_id, tags: [s.filename], name: s.filename, progress: Math.round(Number(s.percentage) || 0), done: false, failed: false, path: '', size: Number(s.mb || 0) * 1e6, eta: null, speed: null })),
        ...(h.history?.slots || []).filter((s) => s.category === cat).map((s) => ({ id: s.nzo_id, tags: [s.name], name: s.name, progress: s.status === 'Completed' ? 100 : 99, done: s.status === 'Completed', failed: s.status === 'Failed', path: s.storage || '', size: Number(s.bytes || 0), eta: 0, speed: 0 })),
      ];
    },
    async remove(id) { await api({ mode: 'queue', name: 'delete', value: id }); },
  };
}
