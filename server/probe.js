// Analyse des fichiers vidéo (ffprobe) et des sous-titres externes
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'tx3g']);

export function ffprobe(file, pre = [], timeout = 90000) {
  return new Promise((resolve, reject) => {
    execFile(config.ffprobe, ['-v', 'error', ...pre, '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
  });
}

function containerOf(file, formatName = '') {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['mp4', 'm4v', 'mov'].includes(ext) || formatName.includes('mp4')) return 'mp4';
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv' || formatName.includes('matroska')) return 'mkv';
  return ext || formatName.split(',')[0];
}

// Options réseau pour les flux en direct (IPTV)
export const NET_INPUT = (url) => (/^https?:/i.test(url)
  ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000', '-user_agent', 'Mozilla/5.0 Venus']
  : []);

const liveCache = new Map();
export async function probeLive(url) {
  const c = liveCache.get(url);
  if (c && Date.now() - c.t < 3600e3) return c.p;
  const p = await probeFile(url, [...NET_INPUT(url).filter((x, i, a) => !/reconnect/.test(x) && !/reconnect/.test(a[i - 1] || '')), '-analyzeduration', '4000000', '-probesize', '4000000'], 15000);
  liveCache.set(url, { t: Date.now(), p });
  return p;
}

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
    chapters: [],
  };
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
