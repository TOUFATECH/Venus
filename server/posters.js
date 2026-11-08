// Affiches sans clé : quand il n'y a pas de clé TMDB (ou que TMDB ne reconnaît pas un titre), Venus cherche
// l'affiche, le résumé et l'année sur des services gratuits qui ne demandent aucune inscription :
//   - films : le site de TMDB (affiches en français, sans clé API), puis IMP Awards (affiches haute qualité),
//     puis la recherche iTunes d'Apple (affiches 600×900, résumé en français)
//   - séries et animés : le site de TMDB, puis TVmaze (affiches, résumé, genres)
// Les images sont copiées dans le dossier des images, comme celles de TMDB. Dès qu'une clé TMDB est
// ajoutée, TMDB reprend la main (ses fiches sont plus complètes) et remplace ces affiches.
import fs from 'node:fs';
import { arrOn, call as arrCall } from './arr.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, getSetting, setSetting } from './db.js';
import { lang } from './metadata.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateIp } from './security.js';
import { traktFind, downloadTraktImage, traktId as traktIdSet } from './trakt.js';

const imagesDir = path.join(config.dataDir, 'images');
const ITUNES = process.env.VENUS_ITUNES_URL || 'https://itunes.apple.com/search';
const TVMAZE = process.env.VENUS_TVMAZE_URL || 'https://api.tvmaze.com/search/shows';
const TMDB_WEB = process.env.VENUS_TMDBWEB_URL || 'https://www.themoviedb.org';
const IMP = process.env.VENUS_IMP_URL || 'https://www.impawards.com';
const BROWSER_UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6' };
const lastStatus = new Map(); // dernier code HTTP par service (diagnostic)
async function getText(url, headers = UA) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (res.status === 429) { await sleep(5000); return null; }
  if (!res.ok) { lastStatus.set(url.split('?')[0], res.status); return null; }
  const t = await res.text();
  return t.length > 3e6 ? null : t;
}
const UA = { 'User-Agent': 'Venus/1.0 (+https://github.com/TOUFATECH/Venus)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Titre simplifié pour comparer deux résultats (accents, ponctuation, articles)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export function closeEnough(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const STOP = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'of', 'and', 'et', 'no', 'wo', 'ni', 'to', 'ga', 'wa']);
  const sx = x.split(' ').filter((w) => !STOP.has(w)), sy = y.split(' ').filter((w) => !STOP.has(w));
  if (!sx.length || !sy.length) return false;
  const common = sx.filter((w) => sy.includes(w)).length;
  // Tous les mots du titre le plus court doivent s'y retrouver (un seul manquant toléré à partir de 4 mots), et les
  // deux titres doivent avoir à peu près la même longueur : « 21 Seiki Manga » ne doit pas accepter un autre « Manga »
  const short = Math.min(sx.length, sy.length), long = Math.max(sx.length, sy.length);
  return common >= (short >= 4 ? short - 1 : short) && common / long >= 0.7;
}

export async function getJson(url) {
  const res = await fetch(url, { headers: { ...BROWSER_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) { await sleep(5000); return null; } // trop de demandes : on réessaiera au prochain passage
  if (!res.ok) { lastStatus.set(url.split('?')[0], res.status); return null; }
  return res.json();
}

// Copie une image distante dans le dossier des images (nom stable : même adresse, même fichier).
// any = adresse donnée par l'administrateur : HTTPS obligatoire, jamais une adresse du réseau local (pas de SSRF),
// type et taille vérifiés, image réencodée telle quelle (JPEG, PNG ou WebP).
export async function saveRemoteImage(url, { any = false } = {}) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== 'https:' && !(process.env.VENUS_ITUNES_URL && u.protocol === 'http:')) return null;
  if (!any && !process.env.VENUS_ITUNES_URL && !/(^|\.)(mzstatic\.com|tvmaze\.com|tmdb\.org|impawards\.com|wikipedia\.org|wikimedia\.org|media-amazon\.com|metahub\.space|trakt\.tv)$/.test(u.hostname)) return null;
  if (any) {
    if (net.isIP(u.hostname) ? isPrivateIp(u.hostname) : /^(localhost|.*\.local|.*\.lan|.*\.internal)$/i.test(u.hostname)) return null;
    try { const addrs = await dns.lookup(u.hostname, { all: true }); if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null; } catch { return null; }
    if (u.username || u.password) return null;
  }
  const name = `p_${crypto.createHash('sha1').update(u.href).digest('hex').slice(0, 20)}.jpg`;
  const dest = path.join(imagesDir, name);
  if (fs.existsSync(dest)) return name;
  try {
    // Redirections suivies à la main (3 au plus) : chaque étape repasse par les mêmes vérifications d'adresse
    let res = null, cur = u;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(cur, { headers: { ...UA, Accept: 'image/*' }, signal: AbortSignal.timeout(20000), redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const loc = res.headers.get('location'); if (!loc) return null;
      cur = new URL(loc, cur);
      if (cur.protocol !== 'https:') return null;
      if (any) { if (net.isIP(cur.hostname) ? isPrivateIp(cur.hostname) : /^(localhost|.*\.local|.*\.lan|.*\.internal)$/i.test(cur.hostname)) return null; try { const addrs = await dns.lookup(cur.hostname, { all: true }); if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null; } catch { return null; } }
      res = null;
    }
    if (!res) return null;
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 8 * 1024 * 1024) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > 8 * 1024 * 1024) return null;
    // Signature du fichier : on ne garde que de vraies images
    const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf.toString('ascii', 1, 4) === 'PNG', webp = buf.toString('ascii', 8, 12) === 'WEBP';
    if (!jpg && !png && !webp) return null;
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(dest + '.tmp', buf);
    fs.renameSync(dest + '.tmp', dest);
    return name;
  } catch { return null; }
}

// Plusieurs propositions d'affiches pour un titre, toutes sources gratuites confondues (pour « Choisir une affiche »)
export async function freePosterCandidates(type, title, year) {
  const out = [];
  const push = (r, source) => { if (r && r.poster && !out.some((x) => x.url === r.poster)) out.push({ url: r.poster, source, year: r.year || null }); };
  const jobs = type === 'movie'
    ? [[() => findArr('movie', title, year), 'Radarr'], [() => findTrakt('movie', title, year), 'Trakt'], [() => findImdb('movie', title, year), 'IMDb'], [() => findCinemeta('movie', title, year), 'Cinemeta'], [() => findTmdbWeb('movie', title, year), 'TMDB (site)'], [() => findImp(title, year), 'IMP Awards'], [() => findWiki('movie', title, year), 'Wikipédia'], [() => findMovie(title, year), 'iTunes'], [() => findOmdb('movie', title, year), 'OMDb']]
    : [[() => findArr('tv', title, year), 'Sonarr'], [() => findTrakt('tv', title, year), 'Trakt'], [() => findTmdbWeb('tv', title, year), 'TMDB (site)'], [() => findShow(title, year), 'TVmaze'], [() => findImdb('tv', title, year), 'IMDb'], [() => findCinemeta('tv', title, year), 'Cinemeta'], [() => findWiki('tv', title, year), 'Wikipédia'], [() => findOmdb('tv', title, year), 'OMDb']];
  await Promise.all(jobs.map(async ([fn, src]) => { try { push(await fn(), src); } catch { /* source muette */ } }));
  return out;
}

const decode = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();

// Site de TMDB (sans clé) : la page de recherche contient l'affiche et la date de chaque résultat
export async function findTmdbWeb(kind, title, year) {
  const lg = lang();
  const html = await getText(`${TMDB_WEB}/search/${kind === 'movie' ? 'movie' : 'tv'}?query=${encodeURIComponent(title)}&language=${encodeURIComponent(lg)}`, BROWSER_UA);
  if (!html) return null;
  // Chaque résultat : une image /t/p/<taille>/<fichier>, un lien /movie/<id>-… ou /tv/<id>-…, un titre <h2>, une date
  const re = /\/t\/p\/[^/"']+\/([A-Za-z0-9_-]+\.(?:jpg|png))[\s\S]{0,1500}?href="\/(?:movie|tv)\/(\d+)[^"]*"[^>]*>\s*<h2>([^<]+)<\/h2>(?:[\s\S]{0,400}?<span class="release_date">([^<]*)<\/span>)?/g;
  const cands = [];
  for (const m of html.matchAll(re)) cands.push({ file: m[1], id: Number(m[2]), name: decode(m[3]), year: Number((/(\d{4})/.exec(m[4] || '') || [])[1]) || null });
  const ok = cands.filter((c) => closeEnough(c.name, title));
  if (!ok.length) return null;
  const best = (year && ok.find((c) => c.year === year)) || (year && ok.find((c) => c.year && Math.abs(c.year - year) <= 1)) || (!year || ok.every((c) => !c.year) ? ok[0] : null);
  if (!best) return null;
  return { poster: `https://image.tmdb.org/t/p/w500/${best.file}`, year: best.year, genres: [], overview: null, releaseDate: null };
}

// IMP Awards : adresses prévisibles (année + titre), affiches en haute qualité (anglais)
export async function findImp(title, year) {
  if (!year) return null;
  const slug = norm(title).replace(/^(the|a|an|le|la|les|un|une|des) /, '').replace(/\s+/g, '_');
  if (!slug) return null;
  const html = await getText(`${IMP}/${year}/${slug}.html`, BROWSER_UA);
  if (!html || !/imp ?awards/i.test(html)) return null;
  const name = decode((/<title>([^<]*)<\/title>/i.exec(html) || [])[1]).replace(/\s*(Movie Poster|\(#\d+ of \d+\)).*$/i, '').replace(/\s*\(\d{4}\).*$/, '');
  if (name && !closeEnough(name, title)) return null;
  const big = (/posters\/([a-z0-9_]+_xlg\.jpg)/i.exec(html) || [])[1];
  const any = (/posters\/([a-z0-9_]+\.jpg)/i.exec(html) || [])[1];
  const file = big || any;
  return file ? { poster: `${IMP}/${year}/posters/${file}`, year, genres: [], overview: null, releaseDate: null } : null;
}

// Wikipédia (anglais puis français) : l'image principale de l'article est presque toujours l'affiche.
// Très fiable (jamais de blocage), fonctionne pour les films comme pour les séries et animés.
export async function findWiki(kind, title, year) {
  const base = String(title || '').trim();
  if (!base) return null;
  const variants = kind === 'movie'
    ? [year ? `${base} (${year} film)` : null, `${base} (film)`, base]
    : [year ? `${base} (${year} TV series)` : null, `${base} (TV series)`, `${base} (anime)`, `${base} (manga)`, base];
  for (const lg of ['en', 'fr']) {
    const titles = variants.filter(Boolean).map((v) => lg === 'fr' ? v.replace(/ \((\d{4}) film\)$/, ' (film, $1)').replace(/ \(TV series\)$/, ' (série télévisée)') : v);
    const q = new URLSearchParams({ action: 'query', prop: 'pageimages', piprop: 'original', redirects: '1', format: 'json', titles: titles.join('|') });
    const d = await getJson(`https://${lg}.wikipedia.org/w/api.php?${q}`);
    const pages = d && d.query && d.query.pages ? Object.values(d.query.pages) : [];
    const ok = pages.filter((pg) => pg && !pg.missing && pg.original && pg.original.source && /\.(jpe?g|png|webp)$/i.test(pg.original.source)
      && pg.original.height > pg.original.width // portrait : une affiche, pas un logo ni une photo
      && closeEnough(String(pg.title).replace(/\s*\([^)]*\)\s*$/, ''), base));
    if (!ok.length) continue;
    // La page la plus précise d'abord : « (2025 film) », puis « (film) », puis le titre nu
    const rank = (pg) => (year && new RegExp(`\\(${year}`).test(pg.title) ? 0 : /\((film|TV series|série|anime)/i.test(pg.title) ? 1 : 2);
    ok.sort((a, b) => rank(a) - rank(b));
    const best = ok[0];
    // Titre nu : on vérifie qu'il s'agit bien d'un film/série (image « poster » dans le nom, ou page désambiguïsée)
    if (rank(best) === 2 && !/poster|affiche|cover|dvd|blu/i.test(best.original.source)) continue;
    return { poster: best.original.source, year: year || null, genres: [], overview: null, releaseDate: null };
  }
  return null;
}

// Radarr / Sonarr (quand ils sont reliés) : leur recherche passe par la base TMDB, sans clé, et donne l'affiche,
// l'image de fond, le résumé et les genres. La meilleure source pour les films récents.
export async function findArr(kind, title, year) {
  const app = kind === 'movie' ? 'radarr' : 'sonarr';
  if (!arrOn(app)) return null;
  const q = `${String(title || '').trim()}${year && kind === 'movie' ? ` ${year}` : ''}`;
  let list = await arrCall(app, `/api/v3/${kind === 'movie' ? 'movie' : 'series'}/lookup?term=${encodeURIComponent(q)}`);
  if ((!Array.isArray(list) || !list.length) && year) list = await arrCall(app, `/api/v3/${kind === 'movie' ? 'movie' : 'series'}/lookup?term=${encodeURIComponent(title)}`);
  const img = (x, t) => ((x.images || []).find((i) => i.coverType === t) || {}).remoteUrl || null;
  const ok = (Array.isArray(list) ? list : []).filter((x) => x && (x.remotePoster || img(x, 'poster')) && (closeEnough(x.title, title) || closeEnough(x.originalTitle || '', title) || (x.alternateTitles || []).some((a) => closeEnough(a.title, title))));
  if (!ok.length) return null;
  const best = (year && (ok.find((x) => x.year === year) || ok.find((x) => Math.abs((x.year || 0) - year) <= 1))) || (year ? null : ok[0]);
  if (!best) return null;
  const poster = (best.remotePoster || img(best, 'poster')).replace('/t/p/original/', '/t/p/w780/');
  const fanart = img(best, 'fanart');
  return { poster, backdrop: fanart ? fanart.replace('/t/p/original/', '/t/p/w1280/') : null, year: best.year || year || null, genres: best.genres || [], overview: best.overview || null,
    releaseDate: (best.inCinemas || best.firstAired || '').slice(0, 10) || null, tmdbId: best.tmdbId || null };
}

// Trakt (si un Client ID est renseigné) : affiches officielles en bonne qualité
export async function findTrakt(kind, title, year) {
  const r = await traktFind({ type: kind === 'movie' ? 'movie' : 'show', title, year });
  if (!r || !r.poster) return null;
  return { poster: r.poster, year: year || null, genres: [], overview: null, releaseDate: null, trakt: true };
}

// OMDb (si une clé est renseignée) : affiche Amazon/IMDb
// IMDb (suggestions de la barre de recherche, sans clé) : la base la plus complète, affiches officielles en
// bonne qualité (images Amazon). Tolérant aux titres approximatifs ; on vérifie le titre et l'année.
const IMDB = process.env.VENUS_IMDB_URL || 'https://v3.sg.media-imdb.com/suggestion';
export async function findImdb(kind, title, year) {
  const q = String(title || '').trim();
  if (!q) return null;
  const first = (norm(q)[0] || 'x');
  const d = await getJson(`${IMDB}/${/[a-z0-9]/.test(first) ? first : 'x'}/${encodeURIComponent(q.toLowerCase()).replace(/%20/g, '+')}.json`);
  const list = d && Array.isArray(d.d) ? d.d : [];
  const kinds = kind === 'movie' ? ['movie', 'tvMovie', 'video', 'short', 'tvSpecial'] : ['tvSeries', 'tvMiniSeries'];
  const ok = list.filter((x) => x && x.id && /^tt\d+$/.test(x.id) && x.i && x.i.imageUrl && kinds.includes(x.qid) && closeEnough(x.l, q));
  if (!ok.length) return null;
  const best = (year && (ok.find((x) => x.y === year) || ok.find((x) => Math.abs((x.y || 0) - year) <= 1))) || (year ? null : ok[0]) || ok[0];
  // Image redimensionnée à 600 px de large (l'originale peut faire 5 000 px)
  const poster = best.i.imageUrl.replace(/\._V1_.*\.(jpe?g|png)$/i, '._V1_SX600.$1');
  return { poster, year: best.y || year || null, genres: [], overview: null, releaseDate: null, imdbId: best.id };
}

// Cinemeta (catalogue public de Stremio, sans clé) : affiches IMDb via metahub, autre chemin si IMDb bloque
export const CINEMETA = process.env.VENUS_CINEMETA_URL || 'https://v3-cinemeta.strem.io';
export async function findCinemeta(kind, title, year) {
  const t = kind === 'movie' ? 'movie' : 'series';
  const d = await getJson(`${CINEMETA}/catalog/${t}/top/search=${encodeURIComponent(String(title || '').trim())}.json`);
  const list = d && Array.isArray(d.metas) ? d.metas : [];
  const yearOf = (m) => Number(String(m.releaseInfo || m.year || '').slice(0, 4)) || null;
  const ok = list.filter((m) => m && m.poster && closeEnough(m.name, title));
  if (!ok.length) return null;
  const best = (year && ok.find((m) => Math.abs((yearOf(m) || 0) - year) <= 1)) || ok[0];
  const poster = /^tt\d+$/.test(best.imdb_id || best.id || '') ? `https://images.metahub.space/poster/large/${best.imdb_id || best.id}/img` : best.poster;
  return { poster, year: yearOf(best) || year || null, genres: best.genres || [], overview: best.description || null, releaseDate: best.released ? String(best.released).slice(0, 10) : null };
}

export async function findOmdb(kind, title, year) {
  const key = getSetting('omdb_key', '') || process.env.OMDB_API_KEY || '';
  if (!key) return null;
  const q = new URLSearchParams({ apikey: key, t: title, type: kind === 'movie' ? 'movie' : 'series' });
  if (year) q.set('y', String(year));
  const d = await getJson(`https://www.omdbapi.com/?${q}`);
  if (!d || d.Response !== 'True' || !d.Poster || d.Poster === 'N/A' || !closeEnough(d.Title, title)) return null;
  return { poster: d.Poster.replace(/_V1_.*\.jpg$/, '_V1_SX600.jpg'), year: Number(d.Year) || year || null, genres: d.Genre ? d.Genre.split(/,\s*/) : [], overview: d.Plot && d.Plot !== 'N/A' ? d.Plot : null, releaseDate: null };
}

// Film → { poster, overview, year, genres, releaseDate } ou null
export async function findMovie(title, year) {
  const country = (lang().split('-')[1] || 'FR').toUpperCase();
  const q = new URLSearchParams({ term: title, media: 'movie', entity: 'movie', country, limit: '10' });
  let d = await getJson(`${ITUNES}?${q}`);
  if ((!d || !d.resultCount) && country !== 'US') { q.set('country', 'US'); d = await getJson(`${ITUNES}?${q}`); }
  if (!d || !d.results) return null;
  const cands = d.results.filter((r) => closeEnough(r.trackName, title));
  if (!cands.length) return null;
  const yearOf = (r) => Number((r.releaseDate || '').slice(0, 4)) || null;
  // Même année de préférence (à un an près : sorties décalées selon les pays)
  const best = (year && cands.find((r) => yearOf(r) === year)) || (year && cands.find((r) => Math.abs((yearOf(r) || 0) - year) <= 1)) || (!year ? cands[0] : null);
  if (!best || !best.artworkUrl100) return null;
  return {
    poster: best.artworkUrl100.replace(/\/\d+x\d+bb(-\d+)?\.(jpg|png)$/i, '/600x900bb.jpg'),
    overview: best.longDescription || best.shortDescription || null,
    year: yearOf(best), releaseDate: best.releaseDate ? best.releaseDate.slice(0, 10) : null,
    genres: best.primaryGenreName ? [best.primaryGenreName] : [],
  };
}

// Série ou animé → { poster, overview, year, genres } ou null
export async function findShow(title, year, { anime = false } = {}) {
  const d = await getJson(`${TVMAZE}?q=${encodeURIComponent(title)}`);
  if (!Array.isArray(d) || !d.length) return null;
  const shows = d.map((x) => x.show).filter((s) => s && closeEnough(s.name, title) && (!anime || s.type === 'Animation' || s.language === 'Japanese' || /anime/i.test(JSON.stringify(s.genres || []))));
  if (!shows.length) return null;
  const yearOf = (s) => Number((s.premiered || '').slice(0, 4)) || null;
  const best = (year && shows.find((s) => yearOf(s) === year)) || shows.find((s) => s.image && s.image.original) || shows[0];
  if (!best.image || !best.image.original) return null;
  return { poster: best.image.original, overview: stripHtml(best.summary) || null, year: yearOf(best), releaseDate: best.premiered || null, genres: best.genres || [], tvmazeId: best.id };
}

// Image de fond d'une série sur TVmaze (type « background », la plus grande), sans clé
export async function findShowBackdrop(title, year, { anime = false } = {}) {
  const d = await getJson(`${TVMAZE}?q=${encodeURIComponent(title)}`);
  if (!Array.isArray(d) || !d.length) return null;
  const shows = d.map((x) => x.show).filter((s) => s && closeEnough(s.name, title) && (!anime || s.type === 'Animation' || s.language === 'Japanese'));
  if (!shows.length) return null;
  const yearOf = (s) => Number((s.premiered || '').slice(0, 4)) || null;
  const best = (year && shows.find((s) => yearOf(s) === year)) || shows[0];
  const imgs = await getJson(`https://api.tvmaze.com/shows/${best.id}/images`);
  if (!Array.isArray(imgs)) return null;
  const bg = imgs.filter((i) => i.type === 'background' && i.resolutions && i.resolutions.original && i.resolutions.original.width >= 1000)
    .sort((a, b) => b.resolutions.original.width - a.resolutions.original.width)[0];
  return bg ? bg.resolutions.original.url : null;
}

// Séries et animés sans image de fond : TVmaze en fournit pour la plupart. 120 titres par passage.
export async function fillMissingBackdrops() {
  const pending = all("SELECT id, title, year, category FROM items WHERE type = 'show' AND backdrop IS NULL AND IFNULL(backdrop_tried, 0) < 2 ORDER BY added_at DESC LIMIT 120");
  let n = 0;
  for (const it of pending) {
    try {
      const url = await findShowBackdrop(it.title, it.year, { anime: it.category === 'anime' });
      const file = url ? await saveRemoteImage(url) : null;
      if (file) { run('UPDATE items SET backdrop = ?, backdrop_tried = 0 WHERE id = ?', file, it.id); n++; }
      else run('UPDATE items SET backdrop_tried = IFNULL(backdrop_tried, 0) + 1 WHERE id = ?', it.id);
    } catch (e) {
      if (/fetch failed|ENOTFOUND|ECONN|timeout/i.test(e.message)) break;
      run('UPDATE items SET backdrop_tried = IFNULL(backdrop_tried, 0) + 1 WHERE id = ?', it.id);
    }
    await sleep(400);
  }
  return n;
}

// Première source qui répond ; une source en panne n'empêche pas les suivantes
async function firstOf(fns) {
  let offline = 0, last = null;
  for (const fn of fns) {
    try { const r = await fn(); if (r && r.poster) return r; }
    catch (e) { last = e; if (/fetch failed|timeout|ENOTFOUND|ECONN|EAI_AGAIN/i.test(e.message)) offline++; }
  }
  if (offline === fns.length && last) throw last; // tout est injoignable : on arrête la série (hors ligne)
  return null;
}

// Complète les films et séries sans affiche (et sans fiche TMDB). Appelé après chaque analyse.
// Combien de titres attendent encore une affiche (pour la cadence de la tâche)
export const pendingPosters = () => get("SELECT COUNT(*) n FROM items WHERE type IN ('movie','show') AND poster IS NULL AND (matched <= 0 OR tmdb_id IS NULL) AND IFNULL(poster_tried, 0) < 3").n;
// Affiches trouvées sans clé avec l'ancienne correspondance (trop large) : on les oublie pour les rechercher
// avec la correspondance stricte. Les affiches choisies à la main, de TMDB ou du dossier ne bougent pas.
export function redoFreePosters() {
  const r = run(`UPDATE items SET poster = NULL, poster_tried = 0 WHERE type IN ('movie','show') AND poster LIKE 'p\\_%' ESCAPE '\\' AND (custom IS NULL OR custom NOT LIKE '%"poster"%')`);
  return Number(r.changes || 0);
}
export async function fillMissingPosters(onProgress) {
  if (Number(getSetting('poster_sources_v', 0)) < 4) {
    run("UPDATE items SET poster_tried = 0 WHERE poster IS NULL AND type IN ('movie','show')");
    setSetting('poster_sources_v', 4);
  }
  if (getSetting('posters_free', '1') === '0') return 0;
  const pending = all("SELECT id, type, title, year, category, overview, genres, release_date FROM items WHERE type IN ('movie','show') AND poster IS NULL AND (matched <= 0 OR tmdb_id IS NULL) AND IFNULL(poster_tried, 0) < 3 ORDER BY added_at DESC LIMIT 300");
  let n = 0, done = 0;
  for (const it of pending) {
    try {
      const chain = (year) => (it.type === 'movie'
        ? [() => findArr('movie', it.title, year), () => findTrakt('movie', it.title, year), () => findImdb('movie', it.title, year), () => findCinemeta('movie', it.title, year), () => findTmdbWeb('movie', it.title, year), () => findImp(it.title, year), () => findWiki('movie', it.title, year), () => findMovie(it.title, year), () => findOmdb('movie', it.title, year)]
        : [() => findArr('tv', it.title, year), () => findTrakt('tv', it.title, year), () => findTmdbWeb('tv', it.title, year), () => findShow(it.title, year, { anime: it.category === 'anime' }), () => findImdb('tv', it.title, year), () => findCinemeta('tv', it.title, year), () => findWiki('tv', it.title, year), () => findOmdb('tv', it.title, year)]);
      // L'année tirée du nom du fichier est parfois fausse (date de la copie) : second essai sans l'année
      const found = (await firstOf(chain(it.year))) || (it.year ? await firstOf(chain(null)) : null);
      const poster = found ? (found.trakt ? await downloadTraktImage(found.poster) : await saveRemoteImage(found.poster)) : null;
      if (poster) {
        if (found.backdrop) { const bgFile = await saveRemoteImage(found.backdrop); if (bgFile) run('UPDATE items SET backdrop = ? WHERE id = ? AND backdrop IS NULL', bgFile, it.id); }
        if (it.type === 'show' && found.tvmazeId) {
          try {
            const imgs = await getJson(`https://api.tvmaze.com/shows/${found.tvmazeId}/images`);
            const bg = Array.isArray(imgs) ? imgs.filter((x) => x.type === 'background' && x.resolutions && x.resolutions.original).sort((x, y) => y.resolutions.original.width - x.resolutions.original.width)[0] : null;
            const bgFile = bg ? await saveRemoteImage(bg.resolutions.original.url) : null;
            if (bgFile) run('UPDATE items SET backdrop = ? WHERE id = ? AND backdrop IS NULL', bgFile, it.id);
          } catch { /* pas grave */ }
        }
        run(`UPDATE items SET poster = ?, overview = IFNULL(overview, ?), year = IFNULL(year, ?), release_date = IFNULL(release_date, ?),
             genres = CASE WHEN genres IS NULL OR genres IN ('', '[]') THEN ? ELSE genres END, poster_tried = 0 WHERE id = ?`,
        poster, found.overview, found.year, found.releaseDate, JSON.stringify(found.genres || []), it.id);
        n++;
      } else run('UPDATE items SET poster_tried = IFNULL(poster_tried, 0) + 1 WHERE id = ?', it.id);
    } catch (e) {
      if (/fetch failed|timeout|ENOTFOUND|ECONN/i.test(e.message)) { console.warn(`[affiches] service injoignable : ${e.message}`); break; } // hors ligne : inutile d'insister
      run('UPDATE items SET poster_tried = IFNULL(poster_tried, 0) + 1 WHERE id = ?', it.id);
    }
    onProgress && onProgress(++done, pending.length);
    await sleep(350); // on ménage les services gratuits
  }
  if (n) console.log(`[affiches] ${n} affiche(s) trouvée(s) sans clé TMDB`);
  return n;
}

// ------------------------------------------------------------------ affiches des saisons
// Chaque saison (série ou animé) a sa propre affiche. Sans elle, l'interface reprend celle de la série et
// toutes les saisons se ressemblent. Sources, dans l'ordre :
//   1. les images rangées à côté des vidéos (comme Plex / Jellyfin / Kodi) : « season01-poster.jpg » dans le
//      dossier de la série, ou « poster.jpg » / « folder.jpg » / « cover.jpg » dans le dossier de la saison ;
//   2. la liste des saisons déjà connue de TMDB (images publiques, sans clé) ;
//   3. TVmaze (gratuit, sans clé) ;
//   4. la page de la saison sur le site de TMDB (sans clé).
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
function localSeasonImage(season) {
  const ep = get("SELECT path FROM items WHERE type = 'episode' AND parent_id = ? AND path IS NOT NULL LIMIT 1", season.id);
  if (!ep || !ep.path) return null;
  const seasonDir = path.dirname(ep.path);
  const showDir = path.dirname(seasonDir);
  const n = Number(season.season_num) || 0;
  const pads = n === 0 ? ['-specials', '00', '0'] : [String(n).padStart(2, '0'), String(n)];
  const names = [
    ...pads.flatMap((x) => IMG_EXT.map((e) => path.join(showDir, `season${x}-poster${e}`))),
    ...pads.flatMap((x) => IMG_EXT.map((e) => path.join(seasonDir, `season${x}-poster${e}`))),
    // Dossier propre à la saison (sinon ces noms désignent l'affiche de la série)
    ...(seasonDir !== showDir && /(saison|season|s\d{1,2}\b|specials?|bonus)/i.test(path.basename(seasonDir))
      ? ['poster', 'folder', 'cover'].flatMap((b) => IMG_EXT.map((e) => path.join(seasonDir, `${b}${e}`))) : []),
  ];
  for (const f of names) {
    try {
      if (!fs.statSync(f).isFile()) continue;
      const st = fs.statSync(f);
      const name = `l_${crypto.createHash('sha1').update(f + st.mtimeMs).digest('hex').slice(0, 16)}${path.extname(f).toLowerCase()}`;
      const dest = path.join(imagesDir, name);
      if (!fs.existsSync(dest)) { fs.mkdirSync(imagesDir, { recursive: true }); fs.copyFileSync(f, dest); }
      return name;
    } catch { /* absente */ }
  }
  return null;
}
async function tvmazeSeasons(show) {
  let id = show.tvmaze_id;
  if (!id) {
    const found = await findShow(show.title, show.year, { anime: show.category === 'anime' }).catch(() => null);
    id = found && found.tvmazeId;
    if (id) run('UPDATE items SET tvmaze_id = ? WHERE id = ?', id, show.id);
  }
  if (!id) return null;
  const list = await getJson(`https://api.tvmaze.com/shows/${id}/seasons`);
  if (!Array.isArray(list)) return null;
  return new Map(list.filter((x) => x.image && (x.image.original || x.image.medium)).map((x) => [x.number, x.image.original || x.image.medium]));
}
async function tmdbWebSeason(show, n) {
  let id = show.tmdb_id;
  if (!id) {
    const html = await getText(`${TMDB_WEB}/search/tv?query=${encodeURIComponent(show.title)}`, BROWSER_UA);
    const m = html && [...html.matchAll(/href="\/tv\/(\d+)[^"]*"[^>]*>\s*<h2>([^<]+)<\/h2>/g)].find((x) => closeEnough(decode(x[2]), show.title));
    id = m ? Number(m[1]) : null;
  }
  if (!id) return null;
  const html = await getText(`${TMDB_WEB}/tv/${id}/season/${n}`, BROWSER_UA);
  const m = html && /class="poster[^"]*"[\s\S]{0,600}?\/t\/p\/[^/"']+\/([A-Za-z0-9_-]+\.(?:jpg|png))/.exec(html);
  return m ? `https://image.tmdb.org/t/p/w500/${m[1]}` : null;
}

export const pendingSeasonPosters = () => get(`SELECT COUNT(*) n FROM items s JOIN items sh ON sh.id = s.show_id
  WHERE s.type = 'season' AND (s.poster IS NULL OR s.poster = sh.poster) AND IFNULL(s.poster_tried, 0) < 2`).n;
export async function fillSeasonPosters(onProgress) {
  const seasons = all(`SELECT s.id, s.season_num, s.show_id, sh.title, sh.year, sh.category, sh.tvmaze_id, sh.tmdb_id, sh.tmdb_seasons
    FROM items s JOIN items sh ON sh.id = s.show_id
    WHERE s.type = 'season' AND (s.poster IS NULL OR s.poster = sh.poster) AND IFNULL(s.poster_tried, 0) < 2
    ORDER BY sh.added_at DESC, s.season_num LIMIT 400`);
  const free = getSetting('posters_free', '1') !== '0';
  const byShow = new Map();
  for (const x of seasons) { if (!byShow.has(x.show_id)) byShow.set(x.show_id, []); byShow.get(x.show_id).push(x); }
  let n = 0, done = 0, offline = false;
  const netFail = (e) => { if (/fetch failed|timeout|ENOTFOUND|ECONN|EAI_AGAIN/i.test(e && e.message)) offline = true; return null; };
  for (const list of byShow.values()) {
    const show = { id: list[0].show_id, title: list[0].title, year: list[0].year, category: list[0].category, tvmaze_id: list[0].tvmaze_id, tmdb_id: list[0].tmdb_id };
    let tmdbKnown = null, maze;
    try { tmdbKnown = new Map((JSON.parse(list[0].tmdb_seasons || '[]') || []).filter((x) => x.poster).map((x) => [x.n, x.poster])); } catch { /* */ }
    for (const season of list) {
      let poster = localSeasonImage(season);
      try {
        if (poster || offline) { /* image locale trouvée, ou services injoignables : on n'interroge pas Internet */ }
        else if (tmdbKnown && tmdbKnown.get(season.season_num)) poster = await saveRemoteImage(`https://image.tmdb.org/t/p/w500${tmdbKnown.get(season.season_num)}`);
        if (!poster && !offline && free) {
          if (maze === undefined) maze = await tvmazeSeasons(show).catch(netFail);
          if (maze && maze.get(season.season_num)) poster = await saveRemoteImage(maze.get(season.season_num));
        }
        if (!poster && !offline && free) { const u = await tmdbWebSeason(show, season.season_num).catch(netFail); if (u) poster = await saveRemoteImage(u); await sleep(350); }
      } catch (e) {
        // Hors ligne : on continue avec les images locales et on réessaiera plus tard
        if (/fetch failed|timeout|ENOTFOUND|ECONN/i.test(e.message)) { offline = true; console.warn(`[affiches] service injoignable : ${e.message}`); }
      }
      if (poster) { run('UPDATE items SET poster = ?, poster_tried = 0 WHERE id = ?', poster, season.id); n++; }
      else if (!offline) run('UPDATE items SET poster_tried = IFNULL(poster_tried, 0) + 1 WHERE id = ?', season.id);
      onProgress && onProgress(++done, seasons.length);
    }
  }
  if (n) console.log(`[affiches] ${n} affiche(s) de saison trouvée(s)`);
  return n;
}

// Diagnostic (Réglages → Affiches → « Tester les sources ») : chaque service est interrogé pour un titre,
// avec le temps de réponse, le code HTTP et ce qu'il a trouvé. Permet de voir quel service est bloqué.
export async function testSources(title, year, type = 'movie') {
  const jobs = type === 'movie'
    ? [['Radarr', 'radarr', () => findArr('movie', title, year)], ['Trakt', 'https://api.trakt.tv', () => findTrakt('movie', title, year)], ['IMDb', IMDB, () => findImdb('movie', title, year)], ['Cinemeta (Stremio)', CINEMETA, () => findCinemeta('movie', title, year)], ['Site TMDB', `${TMDB_WEB}/search/movie`, () => findTmdbWeb('movie', title, year)], ['IMP Awards', IMP, () => findImp(title, year)], ['Wikipédia', 'https://en.wikipedia.org', () => findWiki('movie', title, year)], ['iTunes', ITUNES, () => findMovie(title, year)], ['OMDb', 'https://www.omdbapi.com', () => findOmdb('movie', title, year)]]
    : [['Sonarr', 'sonarr', () => findArr('tv', title, year)], ['Trakt', 'https://api.trakt.tv', () => findTrakt('tv', title, year)], ['Site TMDB', `${TMDB_WEB}/search/tv`, () => findTmdbWeb('tv', title, year)], ['TVmaze', TVMAZE, () => findShow(title, year, { anime: type === 'anime' })], ['IMDb', IMDB, () => findImdb('tv', title, year)], ['Cinemeta (Stremio)', CINEMETA, () => findCinemeta('tv', title, year)], ['Wikipédia', 'https://en.wikipedia.org', () => findWiki('tv', title, year)], ['OMDb', 'https://www.omdbapi.com', () => findOmdb('tv', title, year)]];
  const out = [];
  for (const [name, base, fn] of jobs) {
    const t0 = Date.now(); for (const k of [...lastStatus.keys()]) if (k.startsWith(base)) lastStatus.delete(k);
    const statusOf = () => { const hit = [...lastStatus.entries()].find(([k]) => k.startsWith(base)); return hit ? hit[1] : null; };
    const unconfigured = (name === 'Radarr' && !arrOn('radarr')) || (name === 'Sonarr' && !arrOn('sonarr')) || (name === 'Trakt' && !traktIdSet()) || (name === 'OMDb' && !(getSetting('omdb_key', '') || process.env.OMDB_API_KEY));
    if (unconfigured) { out.push({ source: name, ms: 0, status: 'non configuré' }); continue; }
    try { const r = await fn(); out.push({ source: name, ms: Date.now() - t0, status: statusOf() || (r ? 200 : 'aucun résultat'), poster: r ? r.poster : null }); }
    catch (e) { out.push({ source: name, ms: Date.now() - t0, status: 'injoignable', error: e.message }); }
  }
  return out;
}
