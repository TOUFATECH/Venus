// Livres : fiches et bibliographies depuis Open Library (gratuit, sans clé) et parutions à venir depuis Google Books.
// Chaque auteur du NAS a sa bibliographie complète, croisée avec les livres présents ; les parutions annoncées
// alimentent l'onglet « À venir » des Livres.
import { db, all, get, run } from './db.js';
import { saveRemoteImage } from './posters.js';
import { cleanName } from './slugs.js';

const OL = (process.env.VENUS_OPENLIBRARY_API || 'https://openlibrary.org').replace(/\/+$/, '');
const OL_COVERS = (process.env.VENUS_OPENLIBRARY_COVERS || 'https://covers.openlibrary.org').replace(/\/+$/, '');
const GB = (process.env.VENUS_GOOGLEBOOKS_API || 'https://www.googleapis.com/books/v1').replace(/\/+$/, '');
const UA = { 'User-Agent': 'Venus/2 (https://github.com/TOUFATECH/Venus)', Accept: 'application/json' };
const DAY = 86400e3;

db.exec(`CREATE TABLE IF NOT EXISTS book_authors (name TEXT PRIMARY KEY, ol_key TEXT, bio TEXT, photo TEXT, birth TEXT, works TEXT, status TEXT, checked_at INTEGER);
CREATE TABLE IF NOT EXISTS book_meta (item_id INTEGER PRIMARY KEY, ol_key TEXT, isbn TEXT, status TEXT, checked_at INTEGER)`);

export const booksState = { running: false, phase: '', done: 0, total: 0, lastRun: 0, error: null };
// Titre simplifié (sans accents, parenthèses ni crochets)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(tome|volume|vol|t|livre|book|edition|intégrale|integrale)\b\.?\s*\d*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// Deux titres désignent-ils le même livre ?
const same = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x === y || (x.length > 6 && (x.startsWith(y) || y.startsWith(x)))); };
// Lecture d'une liste JSON (vide si invalide)
const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
// Texte d'un champ Open Library (chaîne simple ou objet { value })
const text = (v) => (typeof v === 'string' ? v : v && v.value ? v.value : null);

let chain = Promise.resolve(), lastCall = 0;
// Requête JSON vers Open Library / Google Books, une à la fois
function getJson(url) {
  // Une demande à la fois, avec un petit délai : ces services gratuits n'aiment pas les rafales
  const p = chain.then(async () => {
    const wait = Math.max(0, 600 - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 || res.status === 503) { await new Promise((r) => setTimeout(r, 4000)); throw new Error('Service saturé'); }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  chain = p.catch(() => {});
  return p;
}
// Couverture Open Library enregistrée dans le cache des images
const cover = (id, size = 'L') => (id ? saveRemoteImage(`${OL_COVERS}/b/id/${id}-${size}.jpg`).catch(() => null) : Promise.resolve(null));

// ------------------------------------------------------------------ livres du NAS
export const nasBooks = () => all("SELECT id, title, original_title AS author, year, poster, overview, path, mtime FROM items WHERE type IN ('book','audiobook')");

// Fiche d'un livre : couverture, résumé, année, ISBN depuis Open Library
async function identifyBook(b) {
  if (!b.author && !b.title) return false;
  const r = await getJson(`${OL}/search.json?title=${encodeURIComponent(b.title)}${b.author ? `&author=${encodeURIComponent(b.author)}` : ''}&limit=5&fields=key,title,author_name,first_publish_year,cover_i,isbn`);
  const docs = (r && r.docs) || [];
  const hit = docs.find((d) => same(d.title, b.title) && (!b.author || (d.author_name || []).some((a) => same(a, b.author)))) || docs.find((d) => same(d.title, b.title));
  if (!hit) { run('INSERT OR REPLACE INTO book_meta(item_id, status, checked_at) VALUES(?,?,?)', b.id, 'none', Date.now()); return false; }
  let overview = b.overview;
  if (!overview) { const w = await getJson(`${OL}${hit.key}.json`).catch(() => null); overview = text(w && w.description); }
  const img = b.poster ? null : await cover(hit.cover_i);
  run('UPDATE items SET overview = COALESCE(overview, ?), year = COALESCE(year, ?), poster = COALESCE(poster, ?) WHERE id = ?', overview ? String(overview).slice(0, 2000) : null, hit.first_publish_year || null, img, b.id);
  run('INSERT OR REPLACE INTO book_meta(item_id, ol_key, isbn, status, checked_at) VALUES(?,?,?,?,?)', b.id, hit.key, (hit.isbn || [])[0] || null, 'ok', Date.now());
  return true;
}

// ------------------------------------------------------------------ auteurs
async function refreshAuthor(name) {
  const row = get('SELECT * FROM book_authors WHERE name = ?', name);
  let key = row && row.ol_key;
  if (!key) {
    const r = await getJson(`${OL}/search/authors.json?q=${encodeURIComponent(name)}&limit=5`);
    const docs = (r && r.docs) || [];
    const hit = docs.find((d) => same(d.name, name)) || (docs[0] && (docs[0].work_count || 0) > 0 && norm(docs[0].name).split(' ').some((w) => norm(name).includes(w)) ? docs[0] : null);
    if (!hit) { run('INSERT OR REPLACE INTO book_authors(name, status, checked_at) VALUES(?,?,?)', name, 'none', Date.now()); return; }
    key = hit.key;
  }
  const info = await getJson(`${OL}/authors/${key}.json`).catch(() => null);
  const works = [];
  const r = await getJson(`${OL}/search.json?author_key=${encodeURIComponent(key)}&limit=200&sort=new&fields=key,title,first_publish_year,cover_i,edition_count,language`);
  for (const d of (r && r.docs) || []) {
    if (!d.title || works.some((w) => same(w.title, d.title))) continue;
    works.push({ key: d.key, title: d.title, year: d.first_publish_year || null, date: d.first_publish_year ? String(d.first_publish_year) : null, coverId: d.cover_i || null, editions: d.edition_count || 0, source: 'openlibrary' });
  }
  // Parutions annoncées : Google Books connaît les dates à venir, Open Library rarement
  const today = new Date().toISOString().slice(0, 10);
  try {
    const g = await getJson(`${GB}/volumes?q=${encodeURIComponent(`inauthor:"${name}"`)}&orderBy=newest&maxResults=40&printType=books`);
    for (const it of (g && g.items) || []) {
      const v = it.volumeInfo || {};
      if (!v.title || !v.publishedDate) continue;
      const date = String(v.publishedDate);
      const known = works.find((w) => same(w.title, v.title));
      if (known) { if (date.length >= 7 && (!known.date || known.date.length < date.length)) known.date = date; continue; }
      const isbn = ((v.industryIdentifiers || []).find((x) => x.type === 'ISBN_13') || {}).identifier || null;
      works.push({ key: `gb:${it.id}`, title: v.title, year: Number(date.slice(0, 4)) || null, date, thumb: v.imageLinks ? String(v.imageLinks.thumbnail || '').replace(/^http:/, 'https:') : null, isbn, publisher: v.publisher || null, source: 'googlebooks', upcoming: date > today });
    }
  } catch (e) { console.warn(`[livres] Google Books ${name} : ${e.message}`); }
  works.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const photo = row && row.photo ? row.photo : info && info.photos && info.photos.find((p) => p > 0) ? await saveRemoteImage(`${OL_COVERS}/a/id/${info.photos.find((p) => p > 0)}-M.jpg`).catch(() => null) : null;
  run('INSERT OR REPLACE INTO book_authors(name, ol_key, bio, photo, birth, works, status, checked_at) VALUES(?,?,?,?,?,?,?,?)',
    name, key, text(info && info.bio) ? String(text(info.bio)).slice(0, 1500) : null, photo, info && info.birth_date, JSON.stringify(works), 'ok', Date.now());
}

// Complète les couvertures manquantes des livres identifiés
async function fillWorkCovers(limit = 15) {
  let n = 0;
  for (const a of all("SELECT name, works FROM book_authors WHERE status = 'ok'")) {
    const works = parse(a.works);
    let changed = false;
    for (const w of works) {
      if (w.cover !== undefined || n >= limit) continue;
      w.cover = w.coverId ? await cover(w.coverId, 'M') : w.thumb ? await saveRemoteImage(w.thumb).catch(() => null) : null;
      n++; changed = true;
    }
    if (changed) run('UPDATE book_authors SET works = ? WHERE name = ?', JSON.stringify(works), a.name);
    if (n >= limit) break;
  }
  return n;
}

// ------------------------------------------------------------------ passage complet (tâche planifiée)
export async function runBooksMeta({ force = false } = {}) {
  if (booksState.running) return 'Déjà en cours';
  Object.assign(booksState, { running: true, phase: 'Fiches des livres', done: 0, total: 0, error: null });
  const out = [];
  try {
    const checked = new Map(all('SELECT item_id, status, checked_at FROM book_meta').map((r) => [r.item_id, r]));
    const books = nasBooks().filter((b) => { const k = checked.get(b.id); return force || !k || (k.status === 'none' && Date.now() - k.checked_at > 30 * DAY); }).slice(0, 60);
    booksState.total = books.length;
    let found = 0;
    for (const b of books) { try { if (await identifyBook(b)) found++; } catch (e) { console.warn(`[livres] ${b.title} : ${e.message}`); } booksState.done++; }
    if (books.length) out.push(`${found}/${books.length} livre(s) reconnu(s)`);
    booksState.phase = 'Bibliographies';
    const names = new Set(nasBooks().map((b) => b.author).filter((n) => n && !/inconnu|unknown|divers|various/i.test(n)));
    const rows = new Map(all('SELECT name, status, checked_at FROM book_authors').map((r) => [r.name, r]));
    const authors = [...names].filter((n) => { const r = rows.get(n); return force || !r || Date.now() - (r.checked_at || 0) > (r.status === 'none' ? 30 : 7) * DAY; }).slice(0, 30);
    booksState.done = 0; booksState.total = authors.length;
    for (const n of authors) { try { await refreshAuthor(n); } catch (e) { console.warn(`[livres] auteur ${n} : ${e.message}`); } booksState.done++; }
    if (authors.length) out.push(`${authors.length} bibliographie(s) mise(s) à jour`);
    booksState.phase = 'Couvertures';
    const covers = await fillWorkCovers();
    if (covers) out.push(`${covers} couverture(s)`);
    booksState.lastRun = Date.now();
  } catch (e) { booksState.error = e.message; throw e; } finally { booksState.running = false; booksState.phase = ''; }
  return out.join(', ') || 'Rien de nouveau';
}

// ------------------------------------------------------------------ pour l'API
export function authorInfo(name) {
  const r = get('SELECT * FROM book_authors WHERE name = ?', name);
  if (!r) return null;
  return { olKey: r.ol_key, bio: r.bio, photo: r.photo, birth: r.birth, status: r.status, checkedAt: r.checked_at, works: parse(r.works) };
}
// Bibliographie croisée avec le NAS
export function bibliographyOf(name, nas = nasBooks().filter((b) => b.author === name)) {
  const info = authorInfo(name);
  const today = new Date().toISOString().slice(0, 10);
  const works = ((info && info.works) || []).map((w) => {
    const local = nas.find((b) => same(b.title, w.title));
    return { key: w.key, title: w.title, year: w.year, date: w.date, cover: (local && local.poster) || w.cover || null, isbn: w.isbn || null, publisher: w.publisher || null, source: w.source,
      onNas: !!local, itemId: local ? local.id : null, slug: local ? cleanName(local.title) : null, upcoming: !!(w.date && w.date > today) };
  });
  for (const b of nas) if (!works.some((w) => w.itemId === b.id)) works.unshift({ key: null, title: b.title, year: b.year, date: b.year ? String(b.year) : null, cover: b.poster, onNas: true, itemId: b.id, slug: cleanName(b.title), upcoming: false, source: 'nas' });
  return { name, slug: cleanName(name), ...(info || { status: 'pending', works: [] }), works: works.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) };
}
// Parutions à venir et récentes des auteurs présents sur le NAS
export function booksUpcoming() {
  const nas = nasBooks();
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 730 * DAY).toISOString().slice(0, 10);
  const upcoming = [], missing = [];
  for (const a of all("SELECT name FROM book_authors WHERE status = 'ok'")) {
    const bib = bibliographyOf(a.name, nas.filter((b) => b.author === a.name));
    for (const w of bib.works) {
      if (!w.date || !w.key) continue;
      const item = { ...w, author: a.name, authorSlug: cleanName(a.name) };
      if (w.date > today) upcoming.push(item);
      else if (!w.onNas && w.date >= recent && w.date.length >= 4) missing.push(item);
    }
  }
  upcoming.sort((x, y) => x.date.localeCompare(y.date));
  missing.sort((x, y) => y.date.localeCompare(x.date));
  return { upcoming, missing: missing.slice(0, 60), authors: get("SELECT COUNT(*) n FROM book_authors WHERE status = 'ok'").n, pending: get("SELECT COUNT(*) n FROM book_authors WHERE status IS NULL").n };
}
// État de l'identification des livres (tableau de bord)
export function booksMetaStatus() {
  return { ...booksState, books: nasBooks().length, identified: get("SELECT COUNT(*) n FROM book_meta WHERE status = 'ok'").n, authors: get("SELECT COUNT(*) n FROM book_authors WHERE status = 'ok'").n };
}
