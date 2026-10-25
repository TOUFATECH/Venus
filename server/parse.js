// Extraction titre / année / saison / épisode à partir des noms de fichiers et dossiers
import path from 'node:path';

const JUNK = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10\+?|hdr|dv|dovi|sdr|bluray|blu-ray|bdrip|brrip|bdremux|remux|webrip|web-dl|webdl|web|hdtv|hdrip|dvdrip|dvd|dvdscr|cam|ts|x264|x265|h\.?264|h\.?265|hevc|avc|av1|xvid|divx|aac\d?|ac3|eac3|dd5|ddp5|dts|dts-hd|truehd|atmos|flac|5\.1|7\.1|2\.0|multi|multi-?vf2?|french|truefrench|vff|vfq|vfi|vf2|vf|vostfr|vost|subfrench|vo|en|fr|extended|remastered|unrated|uncut|directors?\.?cut|theatrical|imax|proper|repack|internal|limited|complete|integrale|intégrale|10bit|8bit|hdlight|light|mhd|nf|amzn|dsnp|hmax|atvp)\b.*$/i;

export function cleanTitle(raw, { fallback = true } = {}) {
  let s = raw
    .replace(/\.[a-z0-9]{2,4}$/i, (m) => (/^\.(mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i.test(m) ? '' : m))
    .replace(/[\[{][^\]}]*[\]}]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let year = null;
  // Année : on prend la dernière année plausible qui n'est pas au tout début
  const re = /(?:^|[\s(])((?:19[0-9]|20[0-9])\d)(?=[\s)]|$)/g;
  let m; const found = [];
  while ((m = re.exec(s))) found.push({ year: Number(m[1]), idx: m.index });
  const cur = new Date().getFullYear() + 1;
  const valid = found.filter((f) => f.year >= 1900 && f.year <= cur && f.idx > 0);
  if (valid.length) {
    const f = valid[valid.length - 1];
    year = f.year;
    s = s.slice(0, f.idx);
  }
  s = s.replace(JUNK, '').replace(/[()]/g, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!s && fallback) s = raw.replace(/[._]+/g, ' ').trim();
  return { title: s, year };
}

export function parseMovie(filePath, libRoot) {
  const base = path.basename(filePath, path.extname(filePath));
  const parent = path.basename(path.dirname(filePath));
  const fromFile = cleanTitle(base);
  // Si le nom de fichier est générique (ex: "movie.mkv", "film-1080p"), on utilise le dossier
  const generic = /^(movie|film|video|main|feature|sample|\d+)$/i.test(fromFile.title) || fromFile.title.length < 2;
  if ((generic || !fromFile.year) && path.dirname(filePath) !== libRoot) {
    const fromDir = cleanTitle(parent);
    if (generic || fromDir.year) return fromDir;
  }
  return fromFile;
}

const EP_PATTERNS = [
  /\bS(\d{1,2})[ ._-]*E(\d{1,3})(?:[ ._-]*(?:E|-E?)(\d{1,3}))?/i,
  /\b(\d{1,2})x(\d{2,3})\b/i,
  /\bSaison[ ._-]*(\d{1,2})[ ._-]*(?:Episode|Épisode|Ep)[ ._-]*(\d{1,3})/i,
  /\bSeason[ ._-]*(\d{1,2})[ ._-]*(?:Episode|Ep)[ ._-]*(\d{1,3})/i,
];

export function parseEpisode(filePath, libRoot) {
  const rel = path.relative(libRoot, filePath);
  const parts = rel.split(path.sep);
  const file = path.basename(filePath, path.extname(filePath));
  let season = null, episode = null, episodeEnd = null, matchIdx = -1;
  for (const re of EP_PATTERNS) {
    const m = re.exec(file);
    if (m) { season = Number(m[1]); episode = Number(m[2]); episodeEnd = m[3] ? Number(m[3]) : null; matchIdx = m.index; break; }
  }
  // Saison depuis le dossier
  const seasonDir = parts.slice(0, -1).reverse().find((p) => /^(season|saison|s)[ ._-]*\d{1,2}$/i.test(p) || /^specials?$/i.test(p));
  if (season == null && seasonDir) season = /^specials?$/i.test(seasonDir) ? 0 : Number(seasonDir.match(/\d+/)[0]);
  if (episode == null) {
    const m = /(?:episode|épisode|ep|e)[ ._-]*(\d{1,3})\b/i.exec(file) || /^(\d{1,3})\b/.exec(file);
    if (m) episode = Number(m[1]);
  }
  if (season == null) season = 1;

  // Nom de la série : dossier racine sous la bibliothèque, sinon début du nom de fichier
  let showRaw;
  if (parts.length > 1 && !/^(season|saison|s)[ ._-]*\d+$/i.test(parts[0])) showRaw = parts[0];
  else showRaw = matchIdx > 0 ? file.slice(0, matchIdx) : file;
  const show = cleanTitle(showRaw);

  // Titre d'épisode éventuel après SxxEyy
  let epTitle = null;
  if (matchIdx >= 0) {
    const after = file.slice(matchIdx).replace(EP_PATTERNS.find((re) => re.test(file)), '');
    const t = cleanTitle(after.replace(/^[\s._-]+/, ''), { fallback: false }).title;
    if (t && t.length > 1 && !/^\d+$/.test(t)) epTitle = t;
  }
  return { show: show.title, showYear: show.year, season, episode: episode ?? 1, episodeEnd, title: epTitle };
}

export function normKey(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

export function sortTitle(t) {
  return String(t || '').replace(/^(the|a|an|le|la|les|l'|un|une|des)\s+/i, '').toLowerCase();
}
