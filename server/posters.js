// Affiches sans clé : quand il n'y a pas de clé TMDB (ou que TMDB ne reconnaît pas un titre), Venus cherche
// l'affiche, le résumé et l'année sur des services gratuits qui ne demandent aucune inscription :
//   - films : le site de TMDB (affiches en français, sans clé API), puis IMP Awards (affiches haute qualité),
//     puis la recherche iTunes d'Apple (affiches 600×900, résumé en français)
//   - séries et animés : le site de TMDB, puis TVmaze (affiches, résumé, genres)
// Les images sont copiées dans le dossier des images, comme celles de TMDB. Dès qu'une clé TMDB est
// ajoutée, TMDB reprend la main (ses fiches sont plus complètes) et remplace ces affiches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { all, run, getSetting } from './db.js';
import { lang } from './metadata.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateIp } from './security.js';

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
function closeEnough(a, b) {
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

async function getJson(url) {
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
  if (!any && !process.env.VENUS_ITUNES_URL && !/(^|\.)(mzstatic\.com|tvmaze\.com|tmdb\.org|impawards\.com)$/.test(u.hostname)) return null;
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
    ? [[() => findTmdbWeb('movie', title, year), 'TMDB (site)'], [() => findImp(title, year), 'IMP Awards'], [() => findMovie(title, year), 'iTunes']]
    : [[() => findTmdbWeb('tv', title, year), 'TMDB (site)'], [() => findShow(title, year), 'TVmaze']];
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
  return { poster: best.image.original, overview: stripHtml(best.summary) || null, year: yearOf(best), releaseDate: best.premiered || null, genres: best.genres || [] };
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
export async function fillMissingPosters(onProgress) {
  if (getSetting('posters_free', '1') === '0') return 0;
  const pending = all("SELECT id, type, title, year, category, overview, genres, release_date FROM items WHERE type IN ('movie','show') AND poster IS NULL AND (matched <= 0 OR tmdb_id IS NULL) AND IFNULL(poster_tried, 0) < 3 ORDER BY added_at DESC LIMIT 300");
  let n = 0, done = 0;
  for (const it of pending) {
    try {
      const found = await firstOf(it.type === 'movie'
        ? [() => findTmdbWeb('movie', it.title, it.year), () => findImp(it.title, it.year), () => findMovie(it.title, it.year)]
        : [() => findTmdbWeb('tv', it.title, it.year), () => findShow(it.title, it.year, { anime: it.category === 'anime' })]);
      const poster = found ? await saveRemoteImage(found.poster) : null;
      if (poster) {
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

// Diagnostic (Réglages → Affiches → « Tester les sources ») : chaque service est interrogé pour un titre,
// avec le temps de réponse, le code HTTP et ce qu'il a trouvé. Permet de voir quel service est bloqué.
export async function testSources(title, year, type = 'movie') {
  const jobs = type === 'movie'
    ? [['Site TMDB', `${TMDB_WEB}/search/movie`, () => findTmdbWeb('movie', title, year)], ['IMP Awards', IMP, () => findImp(title, year)], ['iTunes', ITUNES, () => findMovie(title, year)]]
    : [['Site TMDB', `${TMDB_WEB}/search/tv`, () => findTmdbWeb('tv', title, year)], ['TVmaze', TVMAZE, () => findShow(title, year, { anime: type === 'anime' })]];
  const out = [];
  for (const [name, base, fn] of jobs) {
    const t0 = Date.now(); for (const k of [...lastStatus.keys()]) if (k.startsWith(base)) lastStatus.delete(k);
    const statusOf = () => { const hit = [...lastStatus.entries()].find(([k]) => k.startsWith(base)); return hit ? hit[1] : null; };
    try { const r = await fn(); out.push({ source: name, ms: Date.now() - t0, status: statusOf() || (r ? 200 : 'aucun résultat'), poster: r ? r.poster : null }); }
    catch (e) { out.push({ source: name, ms: Date.now() - t0, status: 'injoignable', error: e.message }); }
  }
  return out;
}
