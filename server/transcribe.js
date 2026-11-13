// Sous-titres générés sur le serveur : reconnaissance vocale avec whisper.cpp (programme officiel, hors ligne),
// puis traduction en français si le titre est dans une autre langue (Argos Translate hors ligne, ou un serveur
// LibreTranslate ; sinon les sous-titres restent dans la langue d'origine).
// Le résultat est un fichier .srt rangé avec les sous-titres du titre (data/subs/<id>/fr.auto.srt), lu par le
// lecteur comme n'importe quel autre sous-titre, et indexé pour la recherche dans les dialogues.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { config } from './config.js';
import { get, run, getSetting, setSetting } from './db.js';
import { subsDir } from './subtitles.js';
import { spawnLow } from './nice.js';

const binDir = path.join(config.dataDir, 'bin');
const modelsDir = path.join(config.dataDir, 'models', 'whisper');
export const MODELS = { tiny: 75, base: 142, small: 466, medium: 1500 }; // Mo environ
const MODEL_URL = (m) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`;
const ISO3 = { fr: 'fre', en: 'eng', es: 'spa', de: 'ger', it: 'ita', pt: 'por', ja: 'jpn', ar: 'ara', nl: 'dut', ru: 'rus', zh: 'chi', ko: 'kor', pl: 'pol', tr: 'tur', sv: 'swe', hi: 'hin' };

// Premier programme trouvé parmi ces noms
function which(names) {
  for (const n of names) {
    if (path.isAbsolute(n)) { if (fs.existsSync(n)) return n; continue; }
    try { const r = execFileSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).trim(); if (r) return r; } catch { /* */ }
  }
  return null;
}
// Programme whisper-cli
export const whisperBin = () => which([process.env.VENUS_WHISPER_BIN, path.join(binDir, 'whisper-cli'), 'whisper-cli', 'whisper-cpp', 'whisper.cpp', 'whisper'].filter(Boolean));
// Modèle de reconnaissance vocale choisi
export const modelName = () => String(getSetting('whisper_model', 'small'));
export const modelPath = (m = modelName()) => path.join(modelsDir, `ggml-${m}.bin`);
export const modelReady = (m = modelName()) => fs.existsSync(modelPath(m));
// Service de traduction disponible (LibreTranslate ou Argos Translate)
export const translator = () => {
  const lt = String(getSetting('libretranslate_url', '') || process.env.LIBRETRANSLATE_URL || '').trim();
  if (which(['argos-translate', 'argospm'])) return { kind: 'argos', label: 'Argos Translate (hors ligne)' };
  if (lt) return { kind: 'libre', url: lt.replace(/\/+$/, ''), key: String(getSetting('libretranslate_key', '') || ''), label: 'LibreTranslate' };
  return null;
};
// État de la reconnaissance vocale (programme, modèle, traduction)
export function transcribeStatus() {
  const t = translator();
  return { bin: whisperBin(), model: modelName(), modelReady: modelReady(), models: Object.keys(MODELS).map((m) => ({ id: m, mb: MODELS[m], ready: modelReady(m) })), translator: t ? t.label : null, downloading: dl ? { model: dl.model, pct: dl.pct } : null, jobs: [...jobs.values()].map((j) => ({ id: j.id, title: j.title, phase: j.phase, pct: j.pct, error: j.error })) };
}

// ---------------------------------------------------------------- modèle
let dl = null;
// Télécharge un modèle de reconnaissance vocale
export async function downloadModel(m) {
  if (!MODELS[m]) throw new Error('Modèle inconnu');
  if (modelReady(m)) return modelPath(m);
  if (dl) throw new Error('Un téléchargement est déjà en cours');
  fs.mkdirSync(modelsDir, { recursive: true });
  dl = { model: m, pct: 0 };
  try {
    const res = await fetch(MODEL_URL(m), { redirect: 'follow', signal: AbortSignal.timeout(3600e3) });
    if (!res.ok) throw new Error(`Téléchargement du modèle impossible (${res.status})`);
    const total = Number(res.headers.get('content-length')) || MODELS[m] * 1e6;
    const tmp = `${modelPath(m)}.part`;
    const out = fs.createWriteStream(tmp);
    let got = 0;
    for await (const chunk of res.body) { out.write(chunk); got += chunk.length; dl.pct = Math.min(99, Math.round(got / total * 100)); }
    await new Promise((r) => out.end(r));
    if (got < 1e6) throw new Error('Fichier du modèle incomplet');
    fs.renameSync(tmp, modelPath(m));
    setSetting('whisper_model', m);
    return modelPath(m);
  } finally { dl = null; }
}

// ---------------------------------------------------------------- traduction
async function translateLines(lines, from, to = 'fr') {
  const t = translator();
  if (!t) return null;
  const SEP = '\n@@\n';
  const chunks = [];
  for (let i = 0; i < lines.length; i += 60) chunks.push(lines.slice(i, i + 60));
  const out = [];
  for (const c of chunks) {
    const text = c.join(SEP);
    let res;
    if (t.kind === 'argos') {
      res = await new Promise((resolve, reject) => {
        const pr = spawn(which(['argos-translate']), ['--from', from, '--to', to], { stdio: ['pipe', 'pipe', 'pipe'] });
        let o = '', e = '';
        pr.stdout.on('data', (d) => { o += d; }); pr.stderr.on('data', (d) => { e += d; });
        pr.on('close', (code) => (code ? reject(new Error(e.trim().split('\n').pop() || 'Argos a échoué')) : resolve(o)));
        pr.stdin.end(text);
      });
    } else {
      const r = await fetch(`${t.url}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text, source: from, target: to, format: 'text', api_key: t.key || undefined }), signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`LibreTranslate a répondu ${r.status}`);
      res = (await r.json()).translatedText || '';
    }
    const parts = String(res).split(/\n?@@\n?/);
    for (let i = 0; i < c.length; i++) out.push((parts[i] || c[i]).trim());
  }
  return out;
}

// ---------------------------------------------------------------- SRT
const srtTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
// Lit des sous-titres SRT
export function parseSrt(txt) {
  const T = (s) => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(s); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : null; };
  const out = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) out.push({ start: T(a), end: T(b), text });
  }
  return out;
}
// Écrit des sous-titres SRT
const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

// ---------------------------------------------------------------- travaux
const jobs = new Map();
let running = 0;
const queue = [];
// Travail de sous-titrage d'une vidéo
export const jobOf = (itemId) => jobs.get(itemId) || null;
/** Génère les sous-titres d'un titre (file d'attente, un à la fois). onDone(result) facultatif. */
export function requestSubtitles(itemId, { lang = 'fr', onDone } = {}) {
  const item = get('SELECT * FROM items WHERE id = ?', itemId);
  if (!item || !item.path) throw new Error('Vidéo introuvable');
  if (!whisperBin()) throw new Error('La reconnaissance vocale n’est pas installée sur ce serveur (whisper.cpp)');
  if (!modelReady()) throw new Error(`Le modèle « ${modelName()} » n’est pas téléchargé : Réglages → Lecture → Sous-titres générés`);
  if (jobs.has(item.id)) return jobs.get(item.id);
  const job = { id: item.id, title: item.title, lang, phase: 'En attente', pct: 0, error: null, result: null, onDone };
  jobs.set(item.id, job);
  queue.push(job);
  pump();
  return job;
}
// Traite la file de sous-titrage, une vidéo à la fois
async function pump() {
  if (running >= 1) return;
  const job = queue.shift();
  if (!job) return;
  running++;
  try { job.result = await runJob(job); job.phase = 'Terminé'; job.pct = 100; if (job.onDone) job.onDone(job.result); }
  catch (e) { job.error = e.message; job.phase = 'Échec'; console.warn('[sous-titres générés]', job.title, ':', e.message); }
  finally { running--; setTimeout(() => jobs.delete(job.id), 10 * 60000).unref(); pump(); }
}
// Génère les sous-titres d'une vidéo : extraction du son, reconnaissance, traduction
async function runJob(job) {
  const item = get('SELECT * FROM items WHERE id = ?', job.id);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-whisper-'));
  try {
    // 1. son en WAV 16 kHz mono (ce que whisper attend)
    job.phase = 'Extraction du son'; job.pct = 2;
    const wav = path.join(tmp, 'audio.wav');
    await new Promise((resolve, reject) => {
      const pr = spawnLow(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', item.path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav]);
      let err = ''; pr.stderr.on('data', (d) => { err += d; });
      pr.on('close', (c) => (c ? reject(new Error(`Son illisible : ${err.trim().split('\n').pop()}`)) : resolve()));
    });
    // 2. reconnaissance (progression lue sur la sortie de whisper)
    job.phase = 'Reconnaissance de la parole'; job.pct = 5;
    const base = path.join(tmp, 'out');
    const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
    const detected = await new Promise((resolve, reject) => {
      const pr = spawnLow(whisperBin(), ['-m', modelPath(), '-f', wav, '-l', 'auto', '-t', String(threads), '-osrt', '-of', base, '-pp', '-np'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let lang = null, err = '';
      const onLine = (l) => {
        const m = /progress\s*=\s*(\d+)%/i.exec(l); if (m) job.pct = 5 + Math.round(Number(m[1]) * 0.85);
        const la = /auto-detected language:\s*([a-z]{2})/i.exec(l); if (la) lang = la[1];
        if (/error|failed/i.test(l)) err = l;
      };
      let buf = '';
      for (const s of [pr.stdout, pr.stderr]) s.on('data', (d) => { buf += d; const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); });
      const kill = setTimeout(() => { try { pr.kill('SIGKILL'); } catch { /* */ } }, 4 * 3600e3);
      pr.on('close', (c) => { clearTimeout(kill); if (c) reject(new Error(err || `whisper a échoué (${c})`)); else resolve(lang); });
      pr.on('error', reject);
    });
    const srtFile = fs.existsSync(`${base}.srt`) ? `${base}.srt` : fs.existsSync(`${base}.wav.srt`) ? `${base}.wav.srt` : null;
    if (!srtFile) throw new Error('whisper n’a rien produit');
    let cues = parseSrt(fs.readFileSync(srtFile, 'utf8')).filter((c) => c.start != null && c.end != null);
    if (!cues.length) throw new Error('Aucune parole reconnue');
    let lang = detected || 'und', translated = false;
    // 3. traduction vers la langue voulue si besoin et si un traducteur est là
    if (lang !== job.lang && lang !== 'und') {
      job.phase = 'Traduction'; job.pct = 92;
      const tr = await translateLines(cues.map((c) => c.text.replace(/\n/g, ' ')), lang, job.lang).catch((e) => { console.warn('[traduction]', e.message); return null; });
      if (tr) { cues = cues.map((c, i) => ({ ...c, text: tr[i] || c.text })); lang = job.lang; translated = true; }
    }
    // 4. rangé avec les sous-titres du titre, et ajouté à sa fiche technique
    const l3 = ISO3[lang] || lang.slice(0, 3);
    const dir = path.join(subsDir, String(item.id));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${l3}.auto.srt`);
    fs.writeFileSync(file, toSrt(cues));
    const probe = JSON.parse(item.probe || '{"subs":[]}');
    probe.subs = (probe.subs || []).filter((s) => s.path !== file);
    const sub = { id: `g${l3}`, path: file, codec: 'subrip', lang: l3, title: translated ? `Générés par Venus (traduits du ${lang === 'fr' ? detected : lang})` : 'Générés par Venus', forced: false, isDefault: false, text: true, external: true, generated: true };
    probe.subs.push(sub);
    run('UPDATE items SET probe = ? WHERE id = ?', JSON.stringify(probe), item.id);
    return { sub, lines: cues.length, detected, translated };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
