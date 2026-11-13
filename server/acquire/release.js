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
  const t = ` ${name.replace(/[._]+/g, ' ').replace(/[[\]()]/g, ' ')} `;
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
  // L'année : la dernière année plausible avant les étiquettes techniques (« Blade Runner 2049 2017 » → 2017).
  const tech = (() => { const i = t.search(/\bS\d{1,2}(?: ?E\d{1,3})?\b|\b\d{1,2}x\d{2,3}\b|\b(saison|season) \d|\b(2160p|1080[pi]|720p|480p|576p|4k|uhd|multi|french|truefrench|vff|vfq|vostfr|web|webrip|web-?dl|bluray|bdrip|hdtv|remux|x26[45]|h ?26[45]|hevc|integrale|complete|flac|mp3|epub|m4b)\b/i); return i < 0 ? t.length : i; })();
  const years = [...t.slice(0, tech).matchAll(/\b(19[2-9]\d|20[0-4]\d)\b/g)].filter((x) => x.index > 2);
  const ylast = years.at(-1), year = ylast ? Number(ylast[1]) : null;
  const cut = Math.min(tech, ylast ? ylast.index : t.length);
  const title = norm(cut > 0 ? t.slice(0, cut) : t);
  const music = { flac: has(/\b(flac|alac|lossless)\b/i), mp3: has(/\b(mp3|320|v0)\b/i), k320: has(/\b320\b/), hires: has(/\b(24 ?bit|hi-?res)\b/i) };
  const book = { epub: has(/\bepub\b/i), pdf: has(/\bpdf\b/i), mobi: has(/\b(mobi|azw3?)\b/i), m4b: has(/\bm4b\b/i), audio: has(/\b(audiobook|livre audio|m4b|mp3)\b/i) };
  return {
    name, title, year, res, source, codec, lang, vf, season, episodes, pack,
    proper: has(/\b(proper|repack|rerip)\b/i), hdr: has(/\b(hdr|hdr10|dv|dovi|dolby vision)\b/i), sample: has(/\bsample\b/i), music, book,
  };
}

/** Le profil par défaut : VF d'abord, 1080p visé, 2160p permis, tailles raisonnables. */
export const DEFAULT_PROFILE = {
  langue: 'vf',            // vf : VF ou MULTI exigé · vf_puis_vo : VF préférée, VOSTFR accepté · tout
  qualites: [1080, 2160, 720],
  cible: 1080,             // on garde ce qui atteint la cible (VF + cette qualité) ; sinon on continue à chercher mieux
  maxFilmGo: 40, maxEpisodeGo: 8, minFilmMo: 300, minEpisodeMo: 80,
  musique: 'flac',         // flac (puis mp3 320) · mp3
  livre: 'epub',           // epub (puis mobi, pdf)
};

/**
 * Note d'une version pour ce que l'on cherche, ou la raison du refus.
 * want : { kind: movie|episode|season|album|book|audiobook, title, year?, season?, episode?, artist?, author? }
 * r : { title (nom), size (octets), seeders?, protocol? }
 */
export function score(want, r, profile = DEFAULT_PROFILE) {
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
      if (p.season !== want.season) return no(p.season === null ? 'pas d\'épisode indiqué' : `saison ${p.season}`);
      if (kind === 'episode' && !p.pack && !p.episodes.includes(want.episode)) return no(`épisode ${p.episodes.join(',') || '?'}`);
      if (kind === 'season' && !p.pack) return no('épisode seul, pas la saison');
    }
    if (profile.langue === 'vf' && !p.vf) return no(p.lang.vostfr ? 'VOSTFR (VF exigée)' : 'pas de VF');
    if (p.res && !profile.qualites.includes(p.res)) return no(`qualité ${p.res}p non voulue`);
    const go = (r.size || 0) / 1e9, mo = (r.size || 0) / 1e6;
    if (kind === 'movie' && r.size && (go > profile.maxFilmGo || mo < profile.minFilmMo)) return no(`taille ${go.toFixed(1)} Go`);
    if (kind === 'episode' && r.size && !p.pack && (go > profile.maxEpisodeGo || mo < profile.minEpisodeMo)) return no(`taille ${go.toFixed(1)} Go`);
    let s = 0;
    s += p.vf ? (p.lang.vff || p.lang.multi ? 1000 : 900) : p.lang.vostfr ? 300 : 0;
    const rank = profile.qualites.indexOf(p.res); s += rank >= 0 ? (profile.qualites.length - rank) * 100 : 20;
    s += { remux: 40, bluray: 35, web: 30, hdtv: 15, dvd: 5 }[p.source] ?? 0;
    s += p.codec === 'hevc' ? 6 : p.codec === 'h264' ? 4 : 0;
    s += p.proper ? 3 : 0;
    if (kind === 'episode' && p.pack) s -= 50; // pour un seul épisode : l'épisode seul plutôt que toute la saison
    s += Math.min(20, Math.log2(1 + (r.seeders ?? (r.protocol === 'usenet' ? 50 : 0))) * 3);
    return { ok: true, score: Math.round(s), cible: Boolean(p.vf && p.res && p.res >= profile.cible), p };
  }
  if (kind === 'album') {
    const nt = norm(r.title);
    if (!nt.includes(norm(want.artist)) || !nt.includes(wt)) return no('autre album');
    let s = profile.musique === 'flac' ? (p.music.flac ? 500 : p.music.k320 ? 300 : p.music.mp3 ? 150 : 50) : (p.music.k320 ? 500 : p.music.mp3 ? 400 : p.music.flac ? 300 : 50);
    s += Math.min(20, Math.log2(1 + (r.seeders ?? 0)) * 3);
    return { ok: true, score: Math.round(s), cible: profile.musique === 'flac' ? p.music.flac : p.music.k320, p };
  }
  if (kind === 'book' || kind === 'audiobook') {
    const nt = norm(r.title);
    if (!nt.includes(wt) || (want.author && !norm(want.author).split(' ').some((w) => w.length > 2 && nt.includes(w)))) return no('autre livre');
    if (kind === 'audiobook' && !p.book.audio && !p.book.m4b) return no('pas un livre audio');
    if (kind === 'book' && (p.book.audio || p.book.m4b)) return no('livre audio, pas le livre');
    let s = kind === 'audiobook' ? (p.book.m4b ? 500 : 300) : (p.book[profile.livre] ? 500 : p.book.epub ? 400 : p.book.mobi ? 300 : p.book.pdf ? 200 : 100);
    s += /\b(french|francais|fr|vf)\b/i.test(r.title) ? 200 : 0;
    s += Math.min(20, Math.log2(1 + (r.seeders ?? 0)) * 3);
    return { ok: true, score: Math.round(s), cible: true, p };
  }
  return no('type inconnu');
}

/** La meilleure version (ou rien) parmi les résultats ; plus forte que « deja » si on cherche à améliorer. */
export function best(want, results, profile = DEFAULT_PROFILE, deja = null, refus = []) {
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
