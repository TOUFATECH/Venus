// Arrête le Venus des tests et efface son dossier temporaire (gardé si VENUS_TEST_KEEP=1, pour enquêter)
import fs from 'node:fs';
import { STATE, baseAdmin } from './global-setup.mjs';

export default async function globalTeardown() {
  let s;
  try { s = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return; }
  try { process.kill(-s.pid, 'SIGTERM'); } catch { try { process.kill(s.pid, 'SIGTERM'); } catch { /* déjà arrêté */ } }
  try { if (s.hlsPid) process.kill(-s.hlsPid, 'SIGTERM'); } catch { /* déjà arrêté */ }
  try { if (s.maisonPid) process.kill(-s.maisonPid, 'SIGTERM'); } catch { /* déjà arrêté */ }
  await new Promise((r) => setTimeout(r, 800));
  if (process.env.VENUS_TEST_KEEP !== '1') { fs.rmSync(s.dir, { recursive: true, force: true }); if (s.pgDb) await baseAdmin(s.admin, `DROP DATABASE IF EXISTS ${s.pgDb} WITH (FORCE)`).catch((e) => console.warn('base des tests :', e.message)); }
  else console.log(`Données des tests gardées dans ${s.dir} (journal : ${s.logFile})`);
  fs.rmSync(STATE, { force: true });
}
