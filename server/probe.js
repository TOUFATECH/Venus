// Analyse des fichiers vidéo (ffprobe) et des sous-titres externes
import { get, run } from './db.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { isFtvFile, FTV_ARGS, liveSource } from './ftv.js';

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'tx3g']);

// Lance ffprobe sur un fichier ou un flux et renvoie le JSON
export function ffprobe(file, pre = [], timeout = 90000) {
  return new Promise((resolve, reject) => {
    execFile(config.ffprobe, ['-v', 'error', ...pre, '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file],
      { timeout, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
  });
}

// Format du conteneur (mkv, mp4, ts…)
function containerOf(file, formatName = '') {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['mp4', 'm4v', 'mov'].includes(ext) || formatName.includes('mp4')) return 'mp4';
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv' || formatName.includes('matroska')) return 'mkv';
  return ext || formatName.split(',')[0];
}

// Options réseau pour les flux en direct (IPTV)
// Options réseau de ffmpeg pour une chaîne : reconnexion, et l'identité de navigateur / la page d'origine que
// certaines chaînes exigent (lignes #EXTVLCOPT de la liste M3U, gardées dans stream_opts)
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Options ffmpeg d'entrée pour un flux web (délais, reconnexion)
export const NET_INPUT = (url) => {
  // Copie rafraîchie d'une chaîne France TV (jeton neuf) : fichier local qui ne pointe que vers France TV
  if (isFtvFile(url)) return FTV_ARGS;
  if (!/^https?:/i.test(url)) return [];
  let o = {};
  try { o = JSON.parse((get('SELECT stream_opts FROM items WHERE stream_url = ? AND stream_opts IS NOT NULL LIMIT 1', url) || {}).stream_opts || '{}') || {}; } catch { /* */ }
  // Flux web : ffmpeg ne suit que des adresses web (jamais un fichier du serveur glissé dans une liste distante)
  return ['-protocol_whitelist', 'http,https,tcp,tls,crypto,data', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000', '-user_agent', o.ua || BROWSER,
    ...(o.referer ? ['-headers', `Referer: ${o.referer}\r\n`] : [])];
};

// Analyse des chaînes gardée (mémoire + base) : le codec d'une chaîne change rarement. Elle sert tout de suite
// (démarrage plus rapide) et se rafraîchit en arrière-plan au-delà d'une heure.
const liveCache = new Map();
// Analyse un flux web
const probeNet = async (u) => { const url = await liveSource(u); return probeFile(url, [...NET_INPUT(url).filter((x, i, a) => !/reconnect/.test(x) && !/reconnect/.test(a[i - 1] || '')), '-analyzeduration', '3000000', '-probesize', '3000000'], 15000); };
/** Analyse déjà connue (mémoire ou base), sans aller sur le réseau ; null sinon. */
export function cachedProbe(url) {
  let c = liveCache.get(url);
  if (!c) { try { const s = get('SELECT value FROM settings WHERE key = ?', `probe:${url}`); if (s) { c = JSON.parse(s.value); liveCache.set(url, c); } } catch { /* rien */ } }
  return c ? c.p : null;
}
// Analyse d'une chaîne en direct (en cache quelques minutes)
export async function probeLive(url) {
  let c = liveCache.get(url);
  if (!c) { try { const s = get('SELECT value FROM settings WHERE key = ?', `probe:${url}`); if (s) { c = JSON.parse(s.value); liveCache.set(url, c); } } catch { /* rien */ } }
  const save = (p) => { const v = { t: Date.now(), p }; liveCache.set(url, v); try { run('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)', `probe:${url}`, JSON.stringify(v)); } catch { /* rien */ } return p; };
  if (c && Date.now() - c.t < 24 * 3600e3) {
    if (Date.now() - c.t > 3600e3 && !c.refreshing) { c.refreshing = true; probeNet(url).then(save).catch(() => { c.refreshing = false; }); }
    return c.p;
  }
  return save(await probeNet(url));
}

// Analyse un fichier : vidéo, pistes audio, sous-titres, durée, chapitres
export async function probeFile(file, pre = [], timeout = 90000) {
  const data = await ffprobe(file, pre, timeout);
  const streams = data.streams || [];
  const fmt = data.format || {};
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  let video = null;
  if (v) {
    const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
    const transfer = v.color_transfer || '';
    video = {
      index: v.index, codec: v.codec_name, profile: v.profile || '', level: v.level || 0,
      width: v.width, height: v.height, pixFmt: v.pix_fmt || '',
      bitDepth: Number(v.bits_per_raw_sample) || (/(10|12)le/.test(v.pix_fmt || '') ? 10 : 8),
      hdr: /smpte2084|arib-std-b67/.test(transfer),
      dovi: (v.side_data_list || []).some((sd) => /dovi|dolby/i.test(sd.side_data_type || '')),
      fps: d ? Math.round((n / d) * 100) / 100 : 0,
      bitrate: Number(v.bit_rate) || 0,
    };
  }
  const audio = streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
    index: s.index, order: i, codec: s.codec_name, profile: s.profile || '',
    channels: s.channels || 2, layout: s.channel_layout || '',
    lang: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und',
    title: (s.tags && (s.tags.title || s.tags.TITLE)) || '',
    isDefault: !!(s.disposition && s.disposition.default),
  }));
  const subs = streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({
    id: `e${s.index}`, index: s.index, codec: s.codec_name,
    lang: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und',
    title: (s.tags && (s.tags.title || s.tags.TITLE)) || '',
    forced: !!(s.disposition && s.disposition.forced) || /forc/i.test((s.tags && s.tags.title) || ''),
    isDefault: !!(s.disposition && s.disposition.default),
    text: TEXT_SUBS.has(s.codec_name),
  }));
  const duration = Number(fmt.duration) || 0;
  return {
    container: containerOf(file, fmt.format_name),
    duration,
    bitrate: Number(fmt.bit_rate) || (duration ? Math.round((Number(fmt.size) * 8) / duration) : 0),
    video, audio, subs,
    chapters: mapChapters(data.chapters, duration),
    chaptersChecked: true,
  };
}

// Chapitres intégrés au fichier (MKV, MP4) : début, fin et titre
export function mapChapters(list, duration = 0) {
  const out = (list || []).map((c, i) => ({
    start: Math.max(0, Number(c.start_time) || 0),
    end: Number(c.end_time) || 0,
    title: String((c.tags && (c.tags.title || c.tags.TITLE)) || '').trim().slice(0, 120) || `Chapitre ${i + 1}`,
  })).filter((c) => !duration || c.start < duration);
  // Un seul chapitre couvrant tout le fichier n'apporte rien
  return out.length >= 2 ? out : [];
}

// Pour les fichiers analysés avant la prise en charge des chapitres
export function readChapters(file, duration = 0) {
  return new Promise((resolve) => {
    execFile(config.ffprobe, ['-v', 'error', '-show_chapters', '-print_format', 'json', file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      try { resolve(mapChapters(JSON.parse(out).chapters, duration)); } catch { resolve([]); }
    });
  });
}

const SUB_EXT = new Set(['.srt', '.ass', '.ssa', '.vtt']);
const LANG_HINTS = {
  fr: 'fre', fre: 'fre', fra: 'fre', french: 'fre', francais: 'fre', vf: 'fre', vff: 'fre',
  en: 'eng', eng: 'eng', english: 'eng', anglais: 'eng', vo: 'eng',
  es: 'spa', spa: 'spa', de: 'ger', ger: 'ger', deu: 'ger', it: 'ita', ita: 'ita', pt: 'por', por: 'por',
  ja: 'jpn', jpn: 'jpn', ar: 'ara', ara: 'ara', nl: 'dut', ru: 'rus', zh: 'chi', ko: 'kor',
};

// Sous-titres externes : "Film.fr.srt", "Film.forced.fr.srt", dossier "Subs/"
export function findExternalSubs(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const out = [];
  const scan = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d); } catch { return; }
    for (const f of entries) {
      const ext = path.extname(f).toLowerCase();
      if (!SUB_EXT.has(ext)) continue;
      if (!f.toLowerCase().startsWith(base.toLowerCase())) continue;
      const tags = f.slice(base.length, -ext.length).toLowerCase().split(/[._\-\s]+/).filter(Boolean);
      let lang = 'und';
      for (const t of tags) if (LANG_HINTS[t]) { lang = LANG_HINTS[t]; break; }
      out.push({
        id: `x${out.length}`, path: path.join(d, f), codec: ext.slice(1) === 'srt' ? 'subrip' : ext.slice(1),
        lang, title: '', forced: tags.includes('forced') || tags.includes('force'),
        isDefault: false, text: true, external: true,
      });
    }
  };
  scan(dir);
  for (const sub of ['Subs', 'subs', 'Subtitles', 'subtitles', 'Sous-titres']) {
    const d = path.join(dir, sub);
    if (fs.existsSync(d)) scan(d);
  }
  return out;
}
