// File de lecture (clips) : tout lire dans l'ordre ou au hasard, suivant / précédent dans le lecteur.
// Gardée pour l'onglet en cours (sessionStorage), avec un repli en mémoire.
const KEY = 'vn_queue';
let memory = null;

function load() {
  try { const v = sessionStorage.getItem(KEY); if (v) return JSON.parse(v); } catch { /* navigation privée */ }
  return memory;
}
function save(q) {
  memory = q;
  try { sessionStorage.setItem(KEY, JSON.stringify(q)); } catch { /* */ }
}

export function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const entry = (i) => ({ id: i.id, title: i.title, artist: i.originalTitle || '' });

// Crée la file et renvoie le premier élément à lire
export function setQueue(items, { shuffle = false, startId = null, title = 'Clips' } = {}) {
  const original = items.filter((i) => i && i.id).map(entry);
  let list = original;
  if (shuffle) list = shuffled(list);
  if (startId != null && !shuffle) {
    const i = list.findIndex((x) => x.id === startId);
    if (i > 0) list = [...list.slice(i), ...list.slice(0, i)];
  }
  if (startId != null && shuffle) {
    const i = list.findIndex((x) => x.id === startId);
    if (i > 0) { const [x] = list.splice(i, 1); list.unshift(x); }
  }
  save({ list, title, shuffle, original });
  return list[0] || null;
}

export function queueAround(id) {
  const q = load();
  if (!q || !q.list) return null;
  const i = q.list.findIndex((x) => x.id === Number(id));
  if (i < 0) return null;
  return { prev: q.list[i - 1] || null, next: q.list[i + 1] || null, index: i, total: q.list.length, shuffle: !!q.shuffle, title: q.title };
}

// Bascule aléatoire / dans l'ordre pour la suite de la file (ce qui est déjà lu ne bouge pas)
export function toggleShuffle(currentId) {
  const q = load();
  if (!q) return null;
  const i = q.list.findIndex((x) => x.id === Number(currentId));
  const done = q.list.slice(0, i + 1);
  let rest = q.list.slice(i + 1);
  q.shuffle = !q.shuffle;
  if (q.shuffle) rest = shuffled(rest);
  else {
    // dans l'ordre, en reprenant juste après le clip en cours
    const base = q.original || q.list, n = base.length;
    const order = new Map(base.map((x, k) => [x.id, k]));
    const cur = order.get(Number(currentId)) ?? 0;
    const rank = (x) => ((order.get(x.id) ?? 0) - cur + n) % n;
    rest.sort((a, b) => rank(a) - rank(b));
  }
  q.list = [...done, ...rest];
  save(q);
  return q.shuffle;
}

export function clearQueue() { memory = null; try { sessionStorage.removeItem(KEY); } catch { /* */ } }
