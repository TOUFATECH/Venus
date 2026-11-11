// Travaux d'arrière-plan (compression, copies optimisées, reconnaissance vocale, analyses) : lancés en priorité
// basse pour le processeur (nice 15) et le disque (ionice idle), afin qu'une lecture en cours garde toujours la
// main. Sans ces outils (Windows, image minimale), le programme est lancé normalement : rien ne casse.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const find = (name) => ['/usr/bin', '/bin', '/usr/local/bin'].map((d) => `${d}/${name}`).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } });
const NICE = process.platform === 'win32' ? null : find('nice');
const IONICE = process.platform === 'win32' ? null : find('ionice');

// Comme spawn(), mais le processus (et tous les fils qu'il créera) tourne en priorité basse
export function spawnLow(cmd, args, opts) {
  const wrap = [];
  if (IONICE) wrap.push(IONICE, '-c', '3');
  if (NICE) wrap.push(NICE, '-n', '15');
  const proc = wrap.length ? spawn(wrap[0], [...wrap.slice(1), cmd, ...args], opts) : spawn(cmd, args, opts);
  if (!wrap.length && process.platform === 'win32') { try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* */ } }
  return proc;
}

// Pour un processus déjà lancé (au mieux : sur Linux, seuls les fils déjà créés sont concernés)
export function lowPriority(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') { try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* */ } return; }
  execFile('renice', ['-n', '15', '-p', String(proc.pid)], () => {});
  execFile('ionice', ['-c', '3', '-p', String(proc.pid)], () => {});
}
