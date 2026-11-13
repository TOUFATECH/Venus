// Venus · Médias automatiques — lire le nom d'une version (« release ») et choisir la meilleure.
// Pur : aucune entrée/sortie. Sert aux films, séries, animés, musique, livres et livres audio.
//
// Ordre de préférence par défaut (réglable) : la langue d'abord (VF / MULTI avant tout), puis la qualité
// (1080p, puis 2160p si permis, puis 720p), puis la source (Remux / Blu-ray, puis Web, puis HDTV), puis la
// santé du partage (sources). Jamais : caméscope (CAM, TS, TC), échantillons, fichiers trop petits ou trop gros.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export { norm };

/** Les informations d'un nom de version. */
export function parseRelease(raw) {
  const name = String(raw || '');
  // [Groupe] au début et [empreinte] à la fin (animés) : retirés pour lire le titre
  const group = /^\s*\[([^\]]*)\]/.exec(name)?.[1] ?? null;
  const t = ` ${name.replace(/^\s*(\[[^\]]*\]\s*)+/, '').replace(/\[[0-9A-F]{8}\]/gi, ' ').replace(/[._]+/g, ' ').replace(/[[\]()]/g, ' ')} `;
  const has = (re) => re.test(t);
  const res = has(/\b(2160p|4k|uhd)\b/i) ? 2160 : has(/\b1080[pi]\b/i) ? 1080 : has(/\b720p\b/i) ? 720 : has(/\b(576p|480p|dvdrip|sd)\b/i) ? 480 : null;
  const source = has(/\bremux\b/i) ? 'remux' : has(/\b(blu ?ray|bdrip|brrip|bdremux|bd)\b/i) ? 'bluray' : has(/\b(web ?dl|webrip|web|amzn|nf|dsnp|hmax|atvp)\b/i) ? 'web' : has(/\b(hdtv|tvrip|pdtv)\b/i) ? 'hdtv' : has(/\b(dvd|dvdrip|dvdr)\b/i) ? 'dvd' : has(/\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|r5|scr|screener|dvdscr)\b/i) ? 'cam' : null;
  const codec = has(/\b(x265|h ?265|hevc)\b/i) ? 'hevc' : has(/\b(x264|h ?264|avc)\b/i) ? 'h264' : has(/\bav1\b/i) ? 'av1' : null;
  const lang = {
    vff: has(/\b(vff|truefrench)\b/i), vfq: has(/\b(vfq|quebec)\b/i), vfi: has(/\bvfi\b/i),
    multi: has(/\bmulti\b/i), french: has(/\b(french|vf|vf2|fr)\b/i), vostfr: has(/\b(vostfr|subfrench|stfr)\b/i),
  };
  const vf = lang.vff || lang.vfq || lang.vfi || lang.multi || (lang.french && !lang.vostfr);
  // Épisodes : S01E02, S01E02E03, S01E02-E04, 1x02 ; saison complète : S01, Saison 1, Season 1, Integrale
  let season = null, episodes = [], pack = false;
  let m = /\bS(\d{1,2}) ?E(\d{1,3})((?:[ -]?E\d{1,3})*)\b/i.exec(t);
  if (m) { season = Number(m[1]); episodes = [Number(m[2]), ...[...m[3].matchAll(/E(\d{1,3})/gi)].map((x) => Number(x[1]))]; if (/-E/i.test(m[3]) && episodes.length === 2) { const [a, b] = episodes; episodes = Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i); } }
  else if ((m = /\b(\d{1,2})x(\d{2,3})\b/.exec(t))) { season = Number(m[1]); episodes = [Number(m[2])]; }
  else if ((m = /\b(?:S|saison |season )(\d{1,2})\b(?! ?E\d)/i.exec(t))) { season = Number(m[1]); pack = true; }
  else if (has(/\b(integrale|complete series|complete)\b/i)) pack = true;
  // Animés en numérotation absolue : « Frieren - 03 », « One Piece - 1071v2 »
  const abs = season === null && !pack ? /\s-\s(\d{1,4})(?:v\d)?\s/.exec(t) : null;
  const absolute = abs ? Number(abs[1]) : null;
  // L'année : la dernière année plausible avant les étiquettes techniques (« Blade Runner 2049 2017 » → 2017).
  const tech = (() => { const i = t.search(/\s-\s\d{1,4}(?:v\d)?\s|\bS\d{1,2}(?: ?E\d{1,3})?\b|\b\d{1,2}x\d{2,3}\b|\b(saison|season) \d|\b(2160p|1080[pi]|720p|480p|576p|4k|uhd|multi|french|truefrench|vff|vfq|vostfr|web|webrip|web-?dl|bluray|bdrip|hdtv|remux|x26[45]|h ?26[45]|hevc|integrale|complete|flac|mp3|epub|m4b)\b/i); return i < 0 ? t.length : i; })();
  const years = [...t.slice(0, tech).matchAll(/\b(19[2-9]\d|20[0-4]\d)\b/g)].filter((x) => x.index > 2);
  const ylast = years.at(-1), year = ylast ? Number(ylast[1]) : null;
  const cut = Math.min(tech, ylast ? ylast.index : t.length);
  const title = norm(cut > 0 ? t.slice(0, cut) : t);
  const music = { flac: has(/\b(flac|alac|lossless)\b/i), mp3: has(/\b(mp3|320|v0)\b/i), k320: has(/\b320\b/), hires: has(/\b(24 ?bit|hi-?res)\b/i) };
  const book = { epub: has(/\bepub\b/i), pdf: has(/\bpdf\b/i), mobi: has(/\b(mobi|azw3?)\b/i), m4b: has(/\bm4b\b/i), audio: has(/\b(audiobook|livre audio|m4b|mp3)\b/i) };
  return {
    name, title, year, res, source, codec, lang, vf, season, episodes, pack, absolute, group,
    raw: has(/\braw\b/i), english: has(/\b(english|eng|vostang|en)\b/i),
    exe: /\.(exe|scr|bat|cmd|msi|com|vbs|jar|apk|lnk|ps1|pif)(\b|$)/i.test(name) || has(/\b(keygen|crack(ed)?|patch only)\b/i),
    proper: has(/\b(proper|repack|rerip)\b/i), hdr: has(/\b(hdr|hdr10|dv|dovi|dolby vision)\b/i), sample: has(/\bsample\b/i), music, book,
  };
}

/**
 * Les filtres par catégorie (réglables dans Venus et depuis Odin). Valeurs de départ : les profils Radarr / Sonarr
 * de la maison. langues : points ajoutés selon la langue de la version (multi = FR + VO, vf, vostfr, vo = autre langue
 * sans français, raw = sans sous-titres) ; une version sous le « seuil » est refusée. cibleLangues + cible : la version
 * qu'on garde ; tant qu'elle n'est pas atteinte (ex. VOSTFR d'une nouveauté), on cherche mieux (la VF à sa sortie).
 */
export const CATEGORIES = {
  films:     { label: 'Films', min: 720, max: 2160, cible: 1080, langues: { multi: 100, vf: 90, vostfr: -100, vo: -500, raw: -1000 }, seuil: -200, cibleLangues: ['multi', 'vf'], hevc: 0, maxGo: 40, minMo: 300 },
  animation: { label: 'Films d’animation', min: 480, max: 2160, cible: 1080, langues: { multi: 100, vf: 90, vostfr: -100, vo: -500, raw: -1000 }, seuil: -200, cibleLangues: ['multi', 'vf'], hevc: 0, maxGo: 40, minMo: 200, ancienAvant: 2000 },
  series:    { label: 'Séries', min: 480, max: 1080, cible: 1080, langues: { multi: 100, vf: 100, vostfr: 0, vo: -1000, raw: -1000 }, seuil: -200, cibleLangues: ['multi', 'vf'], hevc: 60, maxGo: 8, minMo: 80 },
  animes:    { label: 'Animés', min: 400, max: 1080, cible: 1080, langues: { multi: 100, vf: 100, vostfr: 90, vo: -100, raw: 0 }, seuil: -200, cibleLangues: ['multi', 'vf', 'vostfr'], hevc: 60, maxGo: 8, minMo: 40 },
  musique:   { label: 'Musique', formats: ['flac', 'mp3_320', 'mp3'], langue: 'fr_en' },
  livres:    { label: 'Livres', formats: ['epub', 'mobi', 'pdf'], langue: 'fr' },
  livres_audio: { label: 'Livres audio', formats: ['m4b', 'mp3'], langue: 'fr' },
};
/** La catégorie d'une envie. Pur. */
export function categoryOf(want) {
  if (want.kind === 'movie') return want.anime ? 'animation' : 'films';
  if (want.kind === 'episode' || want.kind === 'season') return want.anime ? 'animes' : 'series';
  return { album: 'musique', book: 'livres', audiobook: 'livres_audio' }[want.kind] ?? 'films';
}
/** Le filtre à appliquer (catégories réglées par-dessus celles de départ). */
export function profileFor(want, custom = {}) {
  const c = categoryOf(want), base = CATEGORIES[c], mine = custom?.[c] || {};
  return { cat: c, ...base, ...mine, ...(base.langues ? { langues: { ...base.langues, ...(mine.langues || {}) } } : {}) };
}
const RES = [240, 360, 400, 480, 540, 576, 720, 1080, 1440, 2160];
const FORMATS = { musique: ['flac', 'mp3_320', 'mp3'], livres: ['epub', 'mobi', 'azw3', 'pdf', 'cbz'], livres_audio: ['m4b', 'mp3'] };
const num = (v, lo, hi) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Math.max(lo, Math.min(hi, Math.round(Number(v)))));
/** Vérifie des filtres reçus (écran, Odin) : seules les clés connues, bornées. Renvoie { films: {...}, ... }. Pur. */
export function cleanCategories(input = {}) {
  const out = {};
  for (const [cat, v] of Object.entries(input || {})) {
    const base = CATEGORIES[cat]; if (!base || !v || typeof v !== 'object') continue;
    const o = {};
    if (base.langues) {
      for (const k of ['min', 'max', 'cible']) { const n = num(v[k], 240, 2160); if (n !== undefined) o[k] = RES.reduce((a, r) => (Math.abs(r - n) < Math.abs(a - n) ? r : a), RES[0]); }
      if (o.min && o.max && o.min > o.max) [o.min, o.max] = [o.max, o.min];
      for (const [k, lo, hi] of [['seuil', -1000, 0], ['hevc', -200, 200], ['maxGo', 1, 200], ['minMo', 0, 5000], ['ancienAvant', 1900, 2100]]) { const n = num(v[k], lo, hi); if (n !== undefined) o[k] = n; }
      if (v.langues && typeof v.langues === 'object') { o.langues = {}; for (const k of ['multi', 'vf', 'vostfr', 'vo', 'raw']) { const n = num(v.langues[k], -1000, 1000); if (n !== undefined) o.langues[k] = n; } }
      if (Array.isArray(v.cibleLangues)) o.cibleLangues = v.cibleLangues.filter((k) => ['multi', 'vf', 'vostfr', 'vo', 'raw'].includes(k));
    } else {
      if (Array.isArray(v.formats)) { const f = v.formats.filter((x) => FORMATS[cat].includes(x)); if (f.length) o.formats = [...new Set(f)]; }
      if (['fr', 'fr_en', 'tout'].includes(v.langue)) o.langue = v.langue;
    }
    if (Object.keys(o).length) out[cat] = o;
  }
  return out;
}
/** Compatibilité : l'ancien profil unique = filtre « films ». */
export const DEFAULT_PROFILE = profileFor({ kind: 'movie' });
const LANG_LABEL = { multi: 'MULTI', vf: 'VF', vostfr: 'VOSTFR', vo: 'sans français', raw: 'RAW (sans sous-titres)' };
export function langOf(p) { return p.lang.multi ? 'multi' : p.vf ? 'vf' : p.lang.vostfr ? 'vostfr' : p.raw ? 'raw' : 'vo'; }

/**
 * Note d'une version pour ce que l'on cherche, ou la raison du refus.
 * want : { kind: movie|episode|season|album|book|audiobook, title, year?, season?, episode?, artist?, author? }
 * r : { title (nom), size (octets), seeders?, protocol? }
 */
export function score(want, r, profile = null) {
  // Le filtre de la catégorie de l'envie (celui passé s'il est de la même catégorie)
  profile = profile && profile.cat === categoryOf(want) ? profile : profileFor(want);
  const p = parseRelease(r.title);
  const no = (why) => ({ ok: false, why, p });
  if (p.sample) return no('échantillon');
  if (p.source === 'cam') return no('caméscope (CAM / TS) : jamais');
  const wt = norm(want.title);
  const kind = want.kind;
  if (kind === 'movie' || kind === 'episode' || kind === 'season') {
    // Le bon titre : identique, ou titre original, ou titre sans article.
    const alts = [wt, norm(want.original), norm(want.title).replace(/^(the|le|la|les|l) /, '')].filter(Boolean);
    if (!alts.some((a) => p.title === a || p.title.replace(/^(the|le|la|les|l) /, '') === a)) return no(`autre titre (${p.title})`);
    if (kind === 'movie') {
      if (want.year && p.year && Math.abs(p.year - want.year) > 1) return no(`autre année (${p.year})`);
      if (p.season !== null || p.episodes.length) return no('épisode, pas un film');
    } else {
      const absOk = want.anime && p.season === null && p.absolute !== null && (p.absolute === want.absolute || (want.season === 1 && p.absolute === want.episode));
      if (!absOk && p.season !== want.season) return no(p.season === null ? (p.absolute !== null ? `épisode ${p.absolute}` : 'pas d\'épisode indiqué') : `saison ${p.season}`);
      if (kind === 'episode' && !absOk && !p.pack && !p.episodes.includes(want.episode)) return no(`épisode ${p.episodes.join(',') || '?'}`);
      if (kind === 'season' && !p.pack) return no('épisode seul, pas la saison');
    }
    if (p.exe) return no('fichier exécutable : bloqué');
    const c = profile, L = langOf(p), ls = c.langues[L] ?? 0;
    if (ls < c.seuil) return no(`${LANG_LABEL[L]} : refusé par le filtre ${c.label} (${ls})`);
    const min = c.ancienAvant && want.year && want.year < c.ancienAvant ? Math.min(c.min, 480) : c.min;
    if (p.res && (p.res < min || p.res > c.max)) return no(`${p.res}p : hors du filtre ${c.label} (${min}p à ${c.max}p)`);
    const go = (r.size || 0) / 1e9, mo = (r.size || 0) / 1e6;
    if (r.size && !(kind === 'episode' && p.pack) && (go > c.maxGo || mo < c.minMo)) return no(`taille ${go.toFixed(1)} Go hors du filtre ${c.label}`);
    let s = 1000 + ls;
    s += !p.res ? 80 : p.res === c.cible ? 300 : p.res > c.cible ? 200 : Math.max(60, 300 - (c.cible - p.res) / 2);
    s += { remux: 40, bluray: 35, web: 30, hdtv: 15, dvd: 5 }[p.source] ?? 0;
    s += p.codec === 'hevc' ? c.hevc || 6 : p.codec === 'h264' ? 4 : 0;
    s += p.proper ? 3 : 0;
    if (kind === 'episode' && p.pack) s -= 50; // pour un seul épisode : l'épisode seul plutôt que toute la saison
    s += Math.min(20, Math.log2(1 + (r.seeders ?? (r.protocol === 'usenet' ? 50 : 0))) * 3);
    return { ok: true, score: Math.round(s), cible: Boolean(c.cibleLangues.includes(L) && p.res && p.res >= c.cible), lang: L, p };
  }
  if (kind === 'album') {
    const nt = norm(r.title), c = profile;
    if (p.exe) return no('fichier exécutable : bloqué');
    if (!nt.includes(norm(want.artist)) || !nt.includes(wt)) return no('autre album');
    const f = p.music.flac ? 'flac' : p.music.k320 ? 'mp3_320' : p.music.mp3 ? 'mp3' : null, k = f ? c.formats.indexOf(f) : -1;
    if (f && k < 0) return no(`format ${f} hors du filtre Musique`);
    let s = k >= 0 ? 500 - k * 150 : 50;
    s += Math.min(20, Math.log2(1 + (r.seeders ?? 0)) * 3);
    return { ok: true, score: Math.round(s), cible: k === 0, p };
  }
  if (kind === 'book' || kind === 'audiobook') {
    const nt = norm(r.title);
    if (!nt.includes(wt) || (want.author && !norm(want.author).split(' ').some((w) => w.length > 2 && nt.includes(w)))) return no('autre livre');
    const c = profile;
    if (p.exe) return no('fichier exécutable : bloqué');
    if (kind === 'audiobook' && !p.book.audio && !p.book.m4b) return no('pas un livre audio');
    if (kind === 'book' && (p.book.audio || p.book.m4b)) return no('livre audio, pas le livre');
    const fr = /\b(french|francais|fr|vf|vff)\b/i.test(norm(r.title));
    if (c.langue === 'fr' && !fr && p.english) return no('en anglais : le filtre demande le français');
    const k = c.formats.findIndex((f) => (f === 'mp3' ? p.music.mp3 : p.book[f]));
    let s = k >= 0 ? 500 - k * 100 : 100;
    s += fr ? 200 : 0;
    s += Math.min(20, Math.log2(1 + (r.seeders ?? 0)) * 3);
    return { ok: true, score: Math.round(s), cible: true, p };
  }
  return no('type inconnu');
}

/** La meilleure version (ou rien) parmi les résultats ; plus forte que « deja » si on cherche à améliorer. */
export function best(want, results, profile = null, deja = null, refus = []) {
  const ok = [], rejected = [];
  for (const r of results) {
    if (refus.includes(r.guid || r.link)) { rejected.push({ r, why: 'déjà essayée (échec)' }); continue; }
    const x = score(want, r, profile);
    if (x.ok) ok.push({ r, ...x }); else rejected.push({ r, why: x.why });
  }
  ok.sort((a, b) => b.score - a.score || (b.r.seeders ?? 0) - (a.r.seeders ?? 0));
  const top = ok[0];
  if (!top) return { pick: null, rejected };
  if (deja !== null && top.score <= deja) return { pick: null, rejected, meilleure: false };
  return { pick: top, rejected };
}

/** Le nom de fichier rangé dans la médiathèque (Venus le reconnaît tout seul). Pur. */
export function libraryName(want, p, ext) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  const tag = [p?.res ? `${p.res}p` : null, p?.vf ? (p.lang.multi ? 'MULTI' : 'VF') : p?.lang?.vostfr ? 'VOSTFR' : null].filter(Boolean).join(' ');
  const e = ext.startsWith('.') ? ext : `.${ext}`;
  if (want.kind === 'movie') { const d = `${safe(want.title)}${want.year ? ` (${want.year})` : ''}`; return `${d}/${d}${tag ? ` [${tag}]` : ''}${e}`; }
  if (want.kind === 'episode') { const s2 = String(want.season).padStart(2, '0'), e2 = String(want.episode).padStart(2, '0'); return `${safe(want.title)}/Saison ${s2}/${safe(want.title)} - S${s2}E${e2}${tag ? ` [${tag}]` : ''}${e}`; }
  if (want.kind === 'album') return `${safe(want.artist)}/${safe(want.title)}${want.year ? ` (${want.year})` : ''}`;
  if (want.kind === 'book' || want.kind === 'audiobook') return `${safe(want.author || 'Auteur inconnu')}/${safe(want.title)}${want.kind === 'book' ? e : ''}`;
  return safe(want.title) + e;
}
