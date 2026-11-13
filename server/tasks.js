// Tâches planifiées : chaque travail de fond (scan, vignettes, sauvegardes…) s'inscrit ici avec sa fréquence.
// Le tableau de bord les liste (dernière exécution, durée, prochaine, progression) et peut les lancer à la main.
import { getSetting, setSetting } from './db.js';
import { emitHook } from './webhooks.js';

const tasks = new Map();

// def : { label, description, every (ms, 0 = à la main), firstDelay (ms), run(progress) }
export function defineTask(id, def) {
  const saved = (getSetting('tasks_state', {}) || {})[id] || {};
  const t = { id, label: def.label, description: def.description || '', when: def.when || '', every: def.every || 0, run: def.run, running: false, progress: null, lastRun: saved.lastRun || 0, lastDuration: saved.lastDuration || 0, lastError: saved.lastError || null, lastResult: saved.lastResult || null, timer: null };
  tasks.set(id, t);
  if (t.every) {
    const delay = def.firstDelay ?? Math.max(30000, t.every - (Date.now() - t.lastRun));
    t.timer = setTimeout(function tick() { runTask(id).catch(() => {}); t.timer = setTimeout(tick, t.every); t.timer.unref(); }, Math.min(delay, 2 ** 31 - 1));
    t.timer.unref();
  }
  return t;
}

// Enregistre l'état d'une tâche (dernière exécution, durée, résultat)
function save(t) {
  const all = getSetting('tasks_state', {}) || {};
  all[t.id] = { lastRun: t.lastRun, lastDuration: t.lastDuration, lastError: t.lastError, lastResult: t.lastResult };
  setSetting('tasks_state', all);
}

// Lance une tâche planifiée tout de suite
export async function runTask(id) {
  const t = tasks.get(id);
  if (!t) throw new Error('Tâche inconnue');
  if (t.running) return { already: true };
  t.running = true; t.progress = null;
  const start = Date.now();
  try {
    const r = await t.run((p) => { t.progress = Math.max(0, Math.min(1, p)); });
    t.lastResult = typeof r === 'string' ? r : null; t.lastError = null;
  } catch (e) {
    t.lastError = String(e.message || e).slice(0, 300);
    console.warn(`[tâche ${id}]`, t.lastError);
    emitHook('task.failed', { task: id, label: t.label, error: t.lastError });
  } finally {
    t.running = false; t.progress = null;
    t.lastRun = Date.now(); t.lastDuration = Date.now() - start;
    save(t);
  }
  return { ok: !t.lastError };
}

// Tâches planifiées et leur état (tableau de bord)
export function listTasks() {
  return [...tasks.values()].map((t) => ({
    id: t.id, label: t.label, description: t.description, when: t.when, every: t.every, running: t.running, progress: t.progress,
    lastRun: t.lastRun || null, lastDuration: t.lastDuration || 0, lastError: t.lastError, lastResult: t.lastResult,
    nextRun: t.every ? (t.lastRun || Date.now()) + t.every : null,
  }));
}

// Cette tâche existe-t-elle ?
export const hasTask = (id) => tasks.has(id);
