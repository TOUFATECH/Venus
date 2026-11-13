// Recherche dans les dialogues : les sous-titres (en français de préférence) de chaque film et épisode sont
// indexés en texte intégral (recherche plein texte de PostgreSQL, sans accents ni majuscules).
// « je suis ton père » → le film, la scène, et la lecture à la seconde près.
import fs from 'node:fs';
import { db, all, get, run } from './db.js';
import { parseVtt } from './scenes.js';

db.exec(`CREATE TABLE IF NOT EXISTS dialogue_index (item_id INTEGER PRIMARY KEY, mtime INTEGER, sub_id TEXT, lang TEXT, n INTEGER, indexed_at INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS dialogues (id INTEGER PRIMARY KEY, text TEXT, item_id INTEGER, start REAL, stop REAL, plain TEXT)`);
db.exec(`ALTER TABLE dialogues ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(plain, ''))) STORED`);
db.exec('CREATE INDEX IF NOT EXISTS idx_dialogues_tsv ON dialogues USING GIN (tsv)');
db.exec('CREATE INDEX IF NOT EXISTS idx_dialogues_item ON dialogues(item_id)');
/** Sans accents ni majuscules (« Père » → « pere ») : pour l'index et pour la recherche. */
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const pickSub = (probe) => {
  const subs = (probe.subs || []).filter((s) => s.text && !s.forced);
  return subs.find((s) => /^fr/.test(s.lang || '')) || subs.find((s) => /^en/.test(s.lang || '')) || subs[0] || null;
};
/** Indexe un titre (si ce n'est pas déjà fait pour ce fichier et ce sous-titre). Renvoie le nombre de répliques. */
export async function indexDialogues(item, subtitleVtt) {
  let probe; try { probe = JSON.parse(item.probe || '{}'); } catch { probe = {}; }
  const sub = pickSub(probe);
  const cur = get('SELECT * FROM dialogue_index WHERE item_id = ?', item.id);
  if (!sub) { if (cur) { run('DELETE FROM dialogues WHERE item_id = ?', item.id); run('DELETE FROM dialogue_index WHERE item_id = ?', item.id); } return 0; }
  if (cur && cur.mtime === item.mtime && cur.sub_id === sub.id) return cur.n;
  const file = await subtitleVtt(item, probe, sub.id);
  const cues = parseVtt(fs.readFileSync(file, 'utf8'));
  // Répliques regroupées par phrase de 2 s au moins (les sous-titres coupent les phrases en deux)
  const rows = [];
  for (const c of cues) {
    const last = rows[rows.length - 1];
    const t = c.text.replace(/^[-–—]\s*/, '');
    if (last && c.start - last.stop < 0.8 && !/[.!?…]$/.test(last.text) && last.text.length < 160) { last.text += ` ${t}`; last.stop = c.end; }
    else rows.push({ start: c.start, stop: c.end, text: t });
  }
  const ins = db.prepare('INSERT INTO dialogues(text, item_id, start, stop, plain) VALUES(?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    run('DELETE FROM dialogues WHERE item_id = ?', item.id);
    for (const r of rows) ins.run(r.text, item.id, Math.round(r.start * 10) / 10, Math.round(r.stop * 10) / 10, plain(r.text));
    run('INSERT INTO dialogue_index(item_id, mtime, sub_id, lang, n, indexed_at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET mtime = excluded.mtime, sub_id = excluded.sub_id, lang = excluded.lang, n = excluded.n, indexed_at = excluded.indexed_at', item.id, item.mtime, sub.id, sub.lang || null, rows.length, Date.now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows.length;
}

// File d'attente (les plus récents d'abord), un titre à la fois
const queue = [];
let busy = false, subtitleVttFn = null;
export function setSubtitleVtt(fn) { subtitleVttFn = fn; }
export function scheduleDialogues(itemId, urgent = false) {
  if (!itemId || queue.includes(itemId)) return;
  if (urgent) queue.unshift(itemId); else queue.push(itemId);
  pump();
}
async function pump() {
  if (busy || !subtitleVttFn) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    const it = get('SELECT * FROM items WHERE id = ?', id);
    if (!it || !it.path) continue;
    try { await indexDialogues(it, subtitleVttFn); } catch (e) { console.warn('[dialogues]', it.title, ':', e.message); }
  }
  busy = false;
}
export function schedulePendingDialogues(limit = 500) {
  const rows = all(`SELECT i.id FROM items i LEFT JOIN dialogue_index d ON d.item_id = i.id
    WHERE i.type IN ('movie', 'episode') AND i.path IS NOT NULL AND i.probe LIKE '%"text":true%' AND (d.item_id IS NULL OR d.mtime IS NOT i.mtime)
    ORDER BY i.added_at DESC LIMIT ?`, limit);
  rows.forEach((r) => scheduleDialogues(r.id));
  return rows.length;
}
export const dialogueStats = () => ({ items: (get('SELECT COUNT(*) n FROM dialogue_index') || {}).n || 0, lines: (get('SELECT SUM(n) n FROM dialogue_index') || {}).n || 0, pending: queue.length });

/** Recherche : une requête libre → répliques classées, 3 au plus par titre */
export function searchDialogues(q, { limit = 30 } = {}) {
  const words = plain(q).match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length || words.join('').length < 3) return [];
  // Requête plein texte : tous les mots, le dernier en préfixe ; mots réduits aux lettres et chiffres (sans danger)
  const expr = words.map((w, i) => `${w}${i === words.length - 1 && w.length >= 3 ? ':*' : ''}`).join(' & ');
  let rows;
  try {
    rows = all(`SELECT item_id AS "itemId", start, stop, text, ts_rank(tsv, to_tsquery('simple', ?)) AS rank FROM dialogues WHERE tsv @@ to_tsquery('simple', ?) ORDER BY rank DESC LIMIT ?`, expr, expr, limit * 4);
  } catch { return []; }
  const per = new Map(), out = [];
  for (const r of rows) {
    const n = per.get(r.itemId) || 0;
    if (n >= 3) continue;
    per.set(r.itemId, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
