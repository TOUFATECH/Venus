// Configuration globale (variables d'environnement + valeurs par défaut)
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const env = process.env;

function findFfmpeg(name) {
  const explicit = env[`${name.toUpperCase()}_PATH`];
  if (explicit) return explicit;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    // jellyfin-ffmpeg (Docker / Linux) embarque tous les pilotes d'accélération matérielle
    `/usr/lib/jellyfin-ffmpeg/${name}`,
    // macOS : Homebrew (puces Apple puis Intel)
    '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name,
  ];
  if (process.platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files';
    const local = env.LOCALAPPDATA || '';
    candidates.unshift(
      path.join(env.ProgramData || 'C:\\ProgramData', 'Venus', 'ffmpeg', 'bin', exe),
      path.join(local, 'Microsoft', 'WinGet', 'Links', exe),
      path.join(pf, 'ffmpeg', 'bin', exe),
      path.join(pf, 'Jellyfin', 'Server', exe),
    );
  }
  for (const c of candidates) { try { if (c && fs.statSync(c).isFile()) return c; } catch { /* absent */ } }
  return exe; // dans le PATH
}

// Dossier de données par défaut selon le système
function defaultDataDir() {
  if (env.DATA_DIR) return env.DATA_DIR;
  if (fs.existsSync('./data') || process.platform === 'linux') return './data';
  if (process.platform === 'win32') return path.join(env.ProgramData || 'C:\\ProgramData', 'Venus');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Venus');
  return './data';
}

export const config = {
  port: Number(env.PORT || 8096),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(defaultDataDir()),
  transcodeDir: path.resolve(env.TRANSCODE_DIR || path.join(os.tmpdir(), 'venus-transcode')),
  ffmpeg: findFfmpeg('ffmpeg'),
  ffprobe: findFfmpeg('ffprobe'),
  // Bibliothèques par défaut (montées par Docker)
  defaultMovies: env.MOVIES_PATH || '/media/films',
  defaultShows: env.SHOWS_PATH || '/media/series',
  defaultAnime: env.ANIME_PATH || '/media/animes',
  defaultClips: env.CLIPS_PATH || '/media/clips',
  tmdbKey: env.TMDB_API_KEY || '',
  hwaccel: env.HWACCEL || 'auto', // auto | none | nvenc | vaapi | qsv | v4l2m2m | videotoolbox
  segmentSeconds: 4,
  version: '1.0.0',
};

function ensureDir(dir, what) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (e) {
    console.error(`\n  ✖ Venus ne peut pas écrire dans le dossier ${what} : ${dir}\n    ${e.message}\n    Vérifiez qu'il existe et que l'utilisateur qui lance Venus a les droits d'écriture.\n`);
    process.exit(1);
  }
}

// Vide un dossier sans le supprimer : il peut s'agir d'un point de montage (Docker, LXC, tmpfs)
export function emptyDir(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); }
    catch (e) { console.warn(`[démarrage] impossible de supprimer ${path.join(dir, name)} : ${e.message}`); }
  }
}

ensureDir(config.dataDir, 'de données');
ensureDir(path.join(config.dataDir, 'images'), 'des images');
ensureDir(config.transcodeDir, 'de conversion');
emptyDir(config.transcodeDir); // restes d'une conversion interrompue
