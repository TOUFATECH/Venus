// Prépare un Venus jetable pour les tests : petites vidéos, musique et photos générées avec ffmpeg,
// serveur démarré dans un dossier temporaire, installation faite, bibliothèques analysées,
// interface Next.js prête. Les informations utiles aux tests sont écrites dans tests/.venus-test.json.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const STATE = path.resolve(here, '..', '.venus-test.json');
export const PASSWORD = 'Foyer-de-test-2026';
export const PIN = '2468';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function makeMedia(dir) {
  const m = (...p) => { const f = path.join(dir, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  // Une vidéo de 30 s (H.264 + AAC), copiée sous plusieurs noms
  const base = m('base.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', base);
  for (const f of [
    ['films', 'Le Grand Voyage (2019)', 'Le Grand Voyage (2019).mp4'],
    ['films', 'Nuit Blanche (2021).mp4'],
    ['films', 'Orage (2018).mp4'],
    ['series', 'Brigade Nord', 'Saison 01', 'Brigade Nord S01E01.mp4'],
    ['series', 'Brigade Nord', 'Saison 01', 'Brigade Nord S01E02.mp4'],
    ['series', 'Brigade Nord', 'Saison 02', 'Brigade Nord S02E01.mp4'],
    ['clips', 'Zaza - Soleil.mp4'],
  ]) fs.copyFileSync(base, m(...f));
  fs.rmSync(base);
  for (const [n, t] of [['01 - Lumière.mp3', 523], ['02 - Marée.mp3', 659]]) {
    ff('-f', 'lavfi', '-i', `sine=frequency=${t}:duration=20`, '-c:a', 'libmp3lame', '-b:a', '96k',
      '-metadata', 'artist=Zaza', '-metadata', 'album=Premier Album', '-metadata', `title=${n.slice(5, -4)}`, m('musique', 'Zaza', 'Premier Album', n));
  }
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1200x800', '-frames:v', '1', m('photos', 'Vacances', 'plage.jpg'));
  // Petite liste de chaînes (adresses injoignables : on teste la page, pas les flux)
  fs.writeFileSync(m('tv', 'chaines.m3u'), ['#EXTM3U',
    ...[['France 24', 'Infos'], ['Mayotte La 1ère', 'France TV'], ['Mangas TV', 'Divertissement'], ['Ciné Classique', ''], ['Histoire Plus', ''], ['Arte', 'TNT']]
      .flatMap(([n, g], i) => [`#EXTINF:-1 tvg-chno="${i + 1}" group-title="${g}",${n}`, `http://127.0.0.1:9/ch${i}.m3u8`]),
    ...[['Test Bleu', 'a', 41], ['Test Vert', 'b', 42]].flatMap(([n, k, no]) => [`#EXTINF:-1 tvg-chno="${no}" group-title="Test",${n}`, `http://127.0.0.1:${Number(process.env.VENUS_TEST_PORT || 18765) + 2}/${k}/index.m3u8`])].join('\n'));
  // Deux vraies chaînes (HLS servi par un petit serveur local) : lecture, zapping, multi-écran
  for (const [k, c] of [['a', 'blue'], ['b', 'green']]) {
    fs.mkdirSync(m('hls', k), { recursive: true });
    ff('-f', 'lavfi', '-i', `testsrc2=size=480x270:rate=25:duration=40`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=40', '-vf', `drawbox=c=${c}@0.6:t=fill:w=120:h=60`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_segment_filename', path.join(m('hls', k), 'seg%03d.ts'), path.join(m('hls', k), 'index.m3u8'));
  }
  // Affiches propres à chaque saison, rangées comme chez Plex / Jellyfin
  ff('-f', 'lavfi', '-i', 'color=c=red:size=400x600', '-frames:v', '1', m('series', 'Brigade Nord', 'season01-poster.jpg'));
  ff('-f', 'lavfi', '-i', 'color=c=blue:size=400x600', '-frames:v', '1', m('series', 'Brigade Nord', 'Saison 02', 'poster.jpg'));
  ff('-f', 'lavfi', '-i', 'mandelbrot=size=1200x800', '-frames:v', '1', m('photos', 'Vacances', 'coucher.jpg'));
}

export default async function globalSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-e2e-'));
  const media = path.join(dir, 'media');
  makeMedia(media);
  const port = Number(process.env.VENUS_TEST_PORT) || 19000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  const logFile = path.join(dir, 'venus.log');
  const log = fs.openSync(logFile, 'a');
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, DATA_DIR: path.join(dir, 'data'), TRANSCODE_DIR: path.join(dir, 'transcode'), PORT: String(port), HTTPS_PORT: String(port + 1), NODE_ENV: 'production', VENUS_IPTV_WORLD: '0' },
  });
  srv.unref();
  // Petit serveur des chaînes de test (dossier media/hls)
  const hls = spawn('python3', ['-m', 'http.server', String(port + 2), '--bind', '127.0.0.1', '--directory', path.join(media, 'hls')], { detached: true, stdio: 'ignore' });
  hls.unref();

  const api = async (p, o = {}) => {
    const r = await fetch(base + p, { ...o, body: o.body ? JSON.stringify(o.body) : undefined, headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${p} : ${r.status} ${j.error || ''}`);
    return j;
  };
  for (let i = 0; ; i++) {
    try { await fetch(`${base}/api/status`); break; } catch { if (i > 120) throw new Error(`Venus ne démarre pas :\n${fs.readFileSync(logFile, 'utf8')}`); await wait(250); }
  }
  const { token } = await api('/api/setup', { method: 'POST', body: { name: 'Admin', password: PASSWORD, pin: PIN, moviesPath: path.join(media, 'films'), showsPath: path.join(media, 'series') } });
  // Pas de recherche d'affiches sur Internet pendant les tests : plus rapide et reproductible
  await api('/api/admin/settings', { method: 'PUT', token, body: { postersFree: false } });
  for (const [type, name, p] of [['clips', 'Clips', 'clips'], ['music', 'Musique', 'musique'], ['photos', 'Photos', 'photos'], ['iptv', 'Chaînes de test', path.join('tv', 'chaines.m3u')]]) {
    await api('/api/admin/libraries', { method: 'POST', token, body: { type, name, path: path.join(media, p) } });
  }
  await api('/api/profiles', { method: 'POST', token, body: { name: 'Lina', avatar: 3 } });
  await api('/api/admin/scan', { method: 'POST', token, body: {} });
  // Analyse terminée : films, épisodes, clips, musique et photos présents
  for (let i = 0; ; i++) {
    const a = await api('/api/admin', { token });
    const c = a.counts;
    if (!a.scan.running && c.movie >= 3 && c.show >= 1 && c.clip >= 1 && c.track >= 2 && c.photo >= 2) break;
    if (i > 240) throw new Error(`Analyse incomplète : ${JSON.stringify(c)}`);
    await wait(500);
  }
  // Interface Next.js prête (sinon Venus sert l'interface classique)
  for (let i = 0; ; i++) {
    const html = await fetch(`${base}/`).then((r) => r.text()).catch(() => '');
    if (html.includes('/_next/static/')) break;
    if (i > 120) throw new Error('Interface Next.js absente : lancez « npm run web:build » à la racine de Venus avant les tests.');
    await wait(500);
  }
  fs.writeFileSync(STATE, JSON.stringify({ base, token, pid: srv.pid, hlsPid: hls.pid, dir, logFile }, null, 2));
  // Session des tests : l'appareil est déjà connecté sur le profil administrateur
  fs.writeFileSync(path.resolve(here, '..', '.auth.json'), JSON.stringify({ cookies: [], origins: [{ origin: base, localStorage: [{ name: 'vn_token', value: token }] }] }));
  process.env.VENUS_BASE = base;
}
