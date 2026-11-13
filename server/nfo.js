// Fichiers .nfo (format standard des gestionnaires de médiathèque) : identifiants TMDB / IMDb, titre, année, résumé, genres.
// L'identifiant donne une identification exacte ; le reste sert quand il n'y a pas de clé TMDB.
import fs from 'node:fs';
import path from 'node:path';

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]{0,20000}?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]) : ''; };
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]{0,500}?)</${name}>`, 'gi'))].map((m) => decode(m[1])).filter(Boolean);

export function parseNfo(text) {
  const xml = String(text || '').slice(0, 200000);
  // Certains .nfo ne contiennent qu'une adresse IMDb / TMDB
  const imdbUrl = /imdb\.com\/title\/(tt\d{5,10})/i.exec(xml);
  const tmdbUrl = /themoviedb\.org\/(?:movie|tv)\/(\d+)/i.exec(xml);
  let tmdb = null, imdb = null;
  for (const m of xml.matchAll(/<uniqueid([^>]*)>([^<]+)<\/uniqueid>/gi)) {
    const type = (/type="([^"]+)"/i.exec(m[1]) || [])[1] || '';
    if (/tmdb/i.test(type)) tmdb = Number(m[2]) || tmdb;
    if (/imdb/i.test(type) && /^tt\d+$/.test(m[2].trim())) imdb = m[2].trim();
  }
  tmdb = tmdb || Number(tag(xml, 'tmdbid')) || (tmdbUrl ? Number(tmdbUrl[1]) : null);
  const idTag = tag(xml, 'imdbid') || tag(xml, 'id');
  imdb = imdb || (/^tt\d+$/.test(idTag) ? idTag : null) || (imdbUrl ? imdbUrl[1] : null);
  const year = Number(tag(xml, 'year')) || Number((tag(xml, 'premiered') || tag(xml, 'aired')).slice(0, 4)) || null;
  const out = {
    tmdb: tmdb || null, imdb, title: tag(xml, 'title') || null, originalTitle: tag(xml, 'originaltitle') || null,
    year: year && year > 1880 && year < 2200 ? year : null, plot: tag(xml, 'plot') || tag(xml, 'outline') || null, tagline: tag(xml, 'tagline') || null,
    genres: [...new Set(tags(xml, 'genre').flatMap((g) => g.split(/\s*\/\s*/)))].slice(0, 10), mpaa: tag(xml, 'mpaa') || null,
    rating: Number(tag(xml, 'rating')) || null,
  };
  return Object.values(out).some((v) => (Array.isArray(v) ? v.length : v)) ? out : null;
}

function readIfSmall(f) {
  try { const st = fs.statSync(f); if (!st.isFile() || st.size > 2e6) return null; return fs.readFileSync(f, 'utf8'); } catch { return null; }
}
// Film : « Nom du fichier.nfo », sinon movie.nfo dans un dossier propre au film
export function movieNfo(videoPath, dedicated) {
  const dir = path.dirname(videoPath), base = path.basename(videoPath, path.extname(videoPath));
  for (const f of [path.join(dir, `${base}.nfo`), dedicated ? path.join(dir, 'movie.nfo') : null].filter(Boolean)) {
    const t = readIfSmall(f);
    if (t) { const n = parseNfo(t); if (n) return n; }
  }
  return null;
}
// Série : tvshow.nfo dans le dossier de la série
export function showNfo(showDir) {
  if (!showDir) return null;
  const t = readIfSmall(path.join(showDir, 'tvshow.nfo'));
  return t ? parseNfo(t) : null;
}
