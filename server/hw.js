// Détection automatique de l'accélération matérielle (NVIDIA, Intel, AMD, Raspberry Pi, Mac, sinon CPU)
// Chaque encodeur candidat est réellement testé : on ne garde que ce qui fonctionne sur la machine.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { config } from './config.js';
import { getSetting } from './db.js';

export const hw = { type: 'none', label: 'Processeur (logiciel)', encoder: 'libx264', device: null, tested: [], filters: new Set(), ready: false };

function run(args, timeout = 25000) {
  return new Promise((resolve) => {
    execFile(config.ffmpeg, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout) + String(stderr) }));
  });
}

function renderNode() {
  try {
    const nodes = fs.readdirSync('/dev/dri').filter((n) => n.startsWith('renderD')).sort();
    return nodes.length ? `/dev/dri/${nodes[0]}` : null;
  } catch { return null; }
}

const TEST_INPUT = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=1'];

function candidates() {
  const node = renderNode();
  const list = [];
  if (fs.existsSync('/dev/nvidia0') || fs.existsSync('/proc/driver/nvidia/version')) {
    list.push({ type: 'nvenc', label: 'NVIDIA NVENC', encoder: 'h264_nvenc', test: [...TEST_INPUT, '-vf', 'format=yuv420p', '-c:v', 'h264_nvenc', '-f', 'null', '-'] });
  }
  if (node) {
    list.push({ type: 'vaapi', label: 'VA-API (Intel / AMD)', encoder: 'h264_vaapi', device: node,
      test: ['-hide_banner', '-loglevel', 'error', '-vaapi_device', node, '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=1', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'] });
    list.push({ type: 'qsv', label: 'Intel Quick Sync', encoder: 'h264_qsv', device: node,
      test: ['-hide_banner', '-loglevel', 'error', '-init_hw_device', `qsv=hw:${node}`, '-filter_hw_device', 'hw', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=1', '-vf', 'format=nv12,hwupload=extra_hw_frames=64', '-c:v', 'h264_qsv', '-f', 'null', '-'] });
  }
  if (fs.existsSync('/dev/video11')) {
    list.push({ type: 'v4l2m2m', label: 'Raspberry Pi (V4L2)', encoder: 'h264_v4l2m2m', test: [...TEST_INPUT, '-vf', 'format=yuv420p', '-c:v', 'h264_v4l2m2m', '-f', 'null', '-'] });
  }
  if (os.platform() === 'darwin') {
    list.push({ type: 'videotoolbox', label: 'Apple VideoToolbox', encoder: 'h264_videotoolbox', test: [...TEST_INPUT, '-c:v', 'h264_videotoolbox', '-f', 'null', '-'] });
  }
  return list;
}

export async function detectHardware() {
  const filt = await run(['-hide_banner', '-filters'], 10000);
  for (const name of ['zscale', 'tonemap', 'tonemap_vaapi', 'tonemap_cuda', 'tonemap_opencl', 'scale_cuda', 'scale_vaapi', 'scale_qsv', 'overlay']) {
    if (new RegExp(`\\s${name}\\s`).test(filt.out)) hw.filters.add(name);
  }
  const forced = getSetting('hwaccel') || config.hwaccel || 'auto';
  hw.tested = [];
  if (forced !== 'none') {
    for (const c of candidates()) {
      if (forced !== 'auto' && forced !== c.type) continue;
      const r = await run(c.test);
      hw.tested.push({ type: c.type, label: c.label, ok: r.ok });
      if (r.ok) {
        Object.assign(hw, { type: c.type, label: c.label, encoder: c.encoder, device: c.device || null });
        break;
      }
    }
  }
  if (!hw.tested.some((t) => t.ok)) Object.assign(hw, { type: 'none', label: 'Processeur (logiciel)', encoder: 'libx264', device: null });
  hw.ready = true;
  console.log(`[matériel] transcodage : ${hw.label}${hw.tested.length ? ` (testés : ${hw.tested.map((t) => `${t.type}=${t.ok ? 'ok' : 'non'}`).join(', ')})` : ''}`);
  return hw;
}

// Construit les pipelines ffmpeg, du plus rapide (tout GPU) au plus sûr (tout CPU).
// opts: { width, height, bitrate, fps, src (infos vidéo), burnIndex (sous-titre image à incruster) }
export function videoPipelines(opts) {
  const { width, height, bitrate, src, burnIndex } = opts;
  const fps = src.fps && src.fps > 1 && src.fps < 121 ? src.fps : 24;
  const gop = Math.round(fps * config.segmentSeconds);
  const kbit = Math.round(bitrate / 1000);
  const rate = ['-b:v', `${kbit}k`, '-maxrate', `${Math.round(kbit * 1.5)}k`, '-bufsize', `${kbit * 2}k`];
  const gopArgs = ['-g', String(gop), '-keyint_min', String(gop), '-force_key_frames', `expr:gte(t,n_forced*${config.segmentSeconds})`];
  const hdr = !!src.hdr;
  const swTonemap = hdr && hw.filters.has('zscale') && hw.filters.has('tonemap')
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : '';
  const swScale = `scale=${width}:${height}:flags=bicubic`;
  const burn = burnIndex != null;
  // Incrustation (sous-titres image type PGS) côté CPU, avant mise à l'échelle
  const mkFilter = (chain) => burn
    ? ['-filter_complex', `[0:v:0][0:${burnIndex}]overlay=eof_action=pass,${chain}[v]`, '-map', '[v]']
    : ['-vf', chain, '-map', '0:v:0'];

  const sw = {
    name: 'cpu', input: [],
    video: [...mkFilter(`${swTonemap}${swScale},format=yuv420p`), '-c:v', 'libx264', '-preset', os.cpus().length >= 6 ? 'veryfast' : 'superfast', '-crf', '21',
      '-maxrate', `${Math.round(kbit * 1.5)}k`, '-bufsize', `${kbit * 2}k`, '-profile:v', 'high', '-level:v', '4.1', ...gopArgs],
  };
  const pipelines = [];

  if (hw.type === 'nvenc') {
    const enc = ['-c:v', 'h264_nvenc', '-preset', 'p4', ...rate, '-profile:v', 'high', ...gopArgs, '-forced-idr', '1'];
    if (!burn && (!hdr || hw.filters.has('tonemap_cuda')) && hw.filters.has('scale_cuda')) {
      pipelines.push({ name: 'nvenc-full', input: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
        video: ['-map', '0:v:0', '-vf', `${hdr ? 'tonemap_cuda=format=yuv420p:tonemap=hable,' : ''}scale_cuda=${width}:${height}:format=yuv420p`, ...enc] });
    }
    pipelines.push({ name: 'nvenc', input: [], video: [...mkFilter(`${swTonemap}${swScale},format=yuv420p`), ...enc] });
  } else if (hw.type === 'vaapi') {
    const enc = ['-c:v', 'h264_vaapi', ...rate, ...gopArgs];
    if (!burn && (!hdr || hw.filters.has('tonemap_vaapi'))) {
      pipelines.push({ name: 'vaapi-full', input: ['-hwaccel', 'vaapi', '-hwaccel_device', hw.device, '-hwaccel_output_format', 'vaapi'],
        video: ['-map', '0:v:0', '-vf', `${hdr ? 'tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,' : ''}scale_vaapi=w=${width}:h=${height}:format=nv12`, ...enc] });
    }
    pipelines.push({ name: 'vaapi', input: ['-vaapi_device', hw.device], video: [...mkFilter(`${swTonemap}${swScale},format=nv12,hwupload`), ...enc] });
  } else if (hw.type === 'qsv') {
    const enc = ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate, '-look_ahead', '0', ...gopArgs];
    if (!burn && !hdr) {
      pipelines.push({ name: 'qsv-full', input: ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'],
        video: ['-map', '0:v:0', '-vf', `scale_qsv=w=${width}:h=${height}:format=nv12`, ...enc] });
    }
    pipelines.push({ name: 'qsv', input: ['-init_hw_device', `qsv=hw:${hw.device}`, '-filter_hw_device', 'hw'],
      video: [...mkFilter(`${swTonemap}${swScale},format=nv12,hwupload=extra_hw_frames=64`), ...enc] });
  } else if (hw.type === 'v4l2m2m') {
    pipelines.push({ name: 'v4l2m2m', input: [], video: [...mkFilter(`${swScale},format=yuv420p`), '-c:v', 'h264_v4l2m2m', '-b:v', `${kbit}k`, ...gopArgs] });
  } else if (hw.type === 'videotoolbox') {
    pipelines.push({ name: 'videotoolbox', input: ['-hwaccel', 'videotoolbox'], video: [...mkFilter(`${swTonemap}${swScale},format=yuv420p`), '-c:v', 'h264_videotoolbox', ...rate, ...gopArgs] });
  }
  pipelines.push(sw);
  return pipelines;
}
