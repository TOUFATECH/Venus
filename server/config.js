// Configuration globale (variables d'environnement + valeurs par défaut)
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const env = process.env;

function findFfmpeg(name) {
  const explicit = env[`${name.toUpperCase()}_PATH`];
  if (explicit) return explicit;
  // jellyfin-ffmpeg (Docker) embarque tous les pilotes d'accélération matérielle
  const jf = `/usr/lib/jellyfin-ffmpeg/${name}`;
  if (fs.existsSync(jf)) return jf;
  return name;
}

export const config = {
  port: Number(env.PORT || 8096),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || './data'),
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

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'images'), { recursive: true });
fs.rmSync(config.transcodeDir, { recursive: true, force: true });
fs.mkdirSync(config.transcodeDir, { recursive: true });
