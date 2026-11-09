// Téléchargement des livres : LazyLibrarian (API « cmd ») ou Bookshelf (fork de Readarr, API v1).
// Readarr lui-même est arrêté depuis juin 2025 (métadonnées hors service) : Bookshelf reprend son interface
// et son API, LazyLibrarian est l'alternative de longue date. Réglages → Demandes → Livres.
import { all, getSetting, setSetting } from './db.js';
import { HttpError } from './http.js';
import { call, arrOptions, saveArr, arrConf, forgetKnown } from './arr.js';

export const booksApp = () => String(getSetting('books_app', '') || '');
export function booksConf() {
  const app = booksApp();
  if (app === 'bookshelf') { const c = arrConf('bookshelf'); return { app, url: c.url, keySet: !!c.key, profile: c.profile, metaProfile: c.metaProfile, root: c.root, on: !!(c.url && c.key) }; }
  const url = String(getSetting('lazylibrarian_url', '') || '').replace(/\/+$/, ''), key = String(getSetting('lazylibrarian_key', '') || '');
  return { app: app || 'lazylibrarian', url, keySet: !!key, on: !!(url && key && app === 'lazylibrarian') };
}
export const booksOn = () => booksConf().on;

export function saveBooksApp({ app, url, key, profile, metaProfile, root, remove }) {
  if (remove) { setSetting('books_app', ''); setSetting('lazylibrarian_url', ''); setSetting('lazylibrarian_key', ''); saveArr('bookshelf', { url: '', key: null, profile: 0, root: '' }); return; }
  if (app && !['lazylibrarian', 'bookshelf'].includes(app)) throw new HttpError(400, 'Application inconnue');
  if (app) setSetting('books_app', app);
  const a = app || booksApp();
  if (a === 'bookshelf') { saveArr('bookshelf', { url, key, profile, metaProfile, root }); return; }
  if (url !== undefined) {
    const u = String(url).trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new HttpError(400, 'Adresse invalide (ex. http://192.168.1.20:5299)');
    setSetting('lazylibrarian_url', u);
  }
  if (key) setSetting('lazylibrarian_key', String(key).trim().slice(0, 100));
  if (key === null) setSetting('lazylibrarian_key', '');
}

// ------------------------------------------------------------------ LazyLibrarian
async function ll(cmd, params = {}, conf = null) {
  const c = conf || { url: String(getSetting('lazylibrarian_url', '') || '').replace(/\/+$/, ''), key: String(getSetting('lazylibrarian_key', '') || '') };
  if (!c.url || !c.key) throw new HttpError(400, 'LazyLibrarian n’est pas relié (Réglages → Demandes)');
  const u = new URL(`${c.url}/api`);
  u.searchParams.set('apikey', c.key); u.searchParams.set('cmd', cmd);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  let res;
  try { res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'manual' }); } catch (e) { throw new HttpError(502, `LazyLibrarian injoignable : ${e.cause && e.cause.code ? e.cause.code : e.message}`); }
  const text = await res.text();
  if (res.status === 401 || /invalid api ?key|incorrect api key/i.test(text)) throw new HttpError(502, 'Clé API refusée');
  if (!res.ok) throw new HttpError(502, `LazyLibrarian : erreur ${res.status}`);
  try { return JSON.parse(text); } catch { return text; }
}
const llImg = (x) => (x && (x.bookimg || x.BookImg || x.cover || null)) || null;

// Test de connexion (retourne version et compteurs quand disponibles)
export async function booksTest(conf = null) {
  const c = conf ? { ...booksConf(), ...conf } : booksConf();
  if (c.app === 'bookshelf') {
    const o = await arrOptions('bookshelf', conf ? { url: conf.url, key: conf.key || arrConf('bookshelf').key } : null);
    return { name: o.name || 'Bookshelf', version: o.version, profiles: o.profiles, metaProfiles: o.metaProfiles || [], roots: o.roots };
  }
  const v = await ll('getVersion', {}, conf ? { url: conf.url, key: conf.key || String(getSetting('lazylibrarian_key', '') || '') } : null);
  const version = v && typeof v === 'object' ? (v.current_version || v.version || v.install_type || '') : String(v || '').slice(0, 40);
  return { name: 'LazyLibrarian', version: String(version || '').slice(0, 40) };
}

// Recherche de livres : ce qui est déjà voulu/présent dans l'application et déjà sur le NAS
export async function booksSearch(q) {
  const term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return [];
  const nas = new Set(all("SELECT title FROM items WHERE type IN ('book','audiobook')").map((b) => norm(b.title)));
  const c = booksConf();
  if (c.app === 'bookshelf') {
    const list = await call('bookshelf', `/api/v1/book/lookup?term=${encodeURIComponent(term)}`) || [];
    return list.slice(0, 20).map((b) => ({ id: b.foreignBookId, title: b.title, author: b.author ? b.author.authorName : (b.authorTitle || null), date: b.releaseDate || null, overview: b.overview ? String(b.overview).slice(0, 300) : null,
      poster: ((b.images || []).find((i) => i.coverType === 'cover') || (b.images || [])[0] || {}).remoteUrl || null, requested: !!b.id, inVenus: nas.has(norm(b.title)) })).filter((b) => b.id);
  }
  const r = await ll('findBook', { name: term });
  const list = Array.isArray(r) ? r : (r && (r.results || r.books)) || [];
  return list.slice(0, 20).map((b) => ({ id: b.bookid || b.BookID || b.id, title: b.bookname || b.BookName || b.title, author: b.authorname || b.AuthorName || null, date: b.bookdate || b.BookDate || null, overview: b.bookdesc ? String(b.bookdesc).slice(0, 300) : null,
    poster: llImg(b), requested: /wanted|have|open|snatched/i.test(String(b.status || b.Status || '')), inVenus: nas.has(norm(b.bookname || b.BookName || b.title || '')) })).filter((b) => b.id && b.title);
}

// Demander un livre : par identifiant (résultat d'une recherche) ou par titre + auteur (depuis « À venir »)
export async function booksAdd({ id = null, title = '', author = '', isbn = null }) {
  const c = booksConf();
  if (!c.on) throw new HttpError(400, 'Aucune application de livres reliée (Réglages → Demandes)');
  if (c.app === 'bookshelf') {
    let book = null;
    if (id) { const l = await call('bookshelf', `/api/v1/book/lookup?term=${encodeURIComponent(`edition:${id}`)}`).catch(() => []) || []; book = l.find((b) => b.foreignBookId === id) || l[0]; }
    if (!book) {
      const l = await call('bookshelf', `/api/v1/book/lookup?term=${encodeURIComponent(isbn ? `isbn:${isbn}` : `${title} ${author}`.trim())}`) || [];
      book = l.find((b) => norm(b.title) === norm(title) && (!author || !b.author || norm(b.author.authorName) === norm(author))) || l[0];
    }
    if (!book) throw new HttpError(404, 'Livre introuvable dans Bookshelf');
    if (book.id) return { already: true, title: book.title };
    const conf = arrConf('bookshelf');
    const opts = await arrOptions('bookshelf');
    const profile = conf.profile && opts.profiles.some((p) => p.id === conf.profile) ? conf.profile : (opts.profiles[0] || {}).id;
    const meta = conf.metaProfile && (opts.metaProfiles || []).some((p) => p.id === conf.metaProfile) ? conf.metaProfile : ((opts.metaProfiles || [])[0] || {}).id;
    const root = conf.root || (opts.roots[0] || {}).path;
    if (!profile || !root) throw new HttpError(400, 'Choisissez un profil et un dossier dans Réglages → Demandes (Bookshelf)');
    const added = await call('bookshelf', '/api/v1/book', { method: 'POST', body: { ...book, monitored: true, addOptions: { searchForNewBook: true },
      author: { ...book.author, qualityProfileId: profile, metadataProfileId: meta, rootFolderPath: root, monitored: true, monitorNewItems: 'none', addOptions: { monitor: 'none', searchForMissingBooks: false } } } });
    forgetKnown();
    return { added: true, title: added.title, arrId: added.id };
  }
  // LazyLibrarian : on retrouve l'identifiant du livre puis on le met en « voulu » (recherche immédiate)
  let bookId = id;
  if (!bookId) {
    const r = await ll('findBook', { name: isbn || `${title} ${author}`.trim() });
    const list = Array.isArray(r) ? r : (r && (r.results || r.books)) || [];
    const hit = list.find((b) => norm(b.bookname || b.BookName || b.title) === norm(title) && (!author || norm(b.authorname || b.AuthorName || '') === norm(author))) || list.find((b) => norm(b.bookname || b.BookName || b.title) === norm(title)) || list[0];
    bookId = hit && (hit.bookid || hit.BookID || hit.id);
  }
  if (!bookId) throw new HttpError(404, 'Livre introuvable dans LazyLibrarian');
  await ll('addBook', { id: bookId }).catch(() => null); // déjà connu : pas grave
  const q = await ll('queueBook', { id: bookId });
  if (typeof q === 'string' && /error|not found|invalid/i.test(q)) throw new HttpError(502, `LazyLibrarian : ${q.slice(0, 120)}`);
  return { added: true, title: title || String(bookId), arrId: bookId };
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
