// Bande-annonce sans clé TMDB : recherche sur YouTube (page de résultats lue côté serveur, aucune clé
// nécessaire). On garde la première vidéo dont le titre parle de bande-annonce / trailer / teaser / PV,
// courte (moins de 6 min), sinon la première vidéo courte. Résultat mémorisé dans la fiche.
import { get, run } from './db.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

// Lit les résultats d'une page de recherche YouTube
function parseResults(html) {
  const out = [];
  // Les résultats sont dans ytInitialData : on cherche chaque videoRenderer, son titre et sa durée
  const re = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"[\s\S]*?(?:"lengthText":\{[^}]*?"simpleText":"([\d:]+)")?/g;
  let m;
  while ((m = re.exec(html)) && out.length < 12) {
    const [h, mn, s] = m[3] ? m[3].split(':').map(Number).reverse().concat([0, 0]).slice(0, 3).reverse() : [0, 0, 0];
    const secs = m[3] ? (m[3].split(':').length === 3 ? h * 3600 + mn * 60 + s : mn * 60 + s) : null;
    out.push({ id: m[1], title: m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/'), secs });
  }
  return out;
}

// Cherche la bande-annonce d'un titre sur YouTube
export async function searchYoutubeTrailer(title, year, kind = 'movie') {
  const q = `${title}${year ? ` ${year}` : ''} ${kind === 'anime' ? 'trailer PV' : 'bande-annonce trailer'}`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`; // vidéos seulement
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const list = parseResults(await res.text());
  if (!list.length) return null;
  const short = list.filter((v) => v.secs == null || v.secs <= 360);
  const named = short.find((v) => /trailer|bande.?annonce|teaser|\bPV\b|promo/i.test(v.title));
  const pick = named || short[0] || null;
  return pick ? { site: 'youtube', key: pick.id, name: pick.title, source: 'youtube' } : null;
}

// Cherche et mémorise la bande-annonce d'un titre de la médiathèque ; renvoie la clé YouTube ou null.
// Un échec est mémorisé une journée (pas de recherche à chaque ouverture de la fiche).
export async function findTrailerFor(itemId) {
  const it = get('SELECT id, type, title, original_title, year, category, trailer FROM items WHERE id = ?', itemId);
  if (!it) return null;
  let cur = null; try { cur = JSON.parse(it.trailer || 'null'); } catch { /* */ }
  if (cur && cur.key) return cur.key;
  if (cur && cur.none && Date.now() - cur.none < 864e5) return null;
  let found = null;
  try { found = await searchYoutubeTrailer(it.title, it.year, it.category === 'anime' ? 'anime' : it.type); } catch { /* */ }
  if (!found && it.original_title && it.original_title !== it.title) { try { found = await searchYoutubeTrailer(it.original_title, it.year, it.category === 'anime' ? 'anime' : it.type); } catch { /* */ } }
  run('UPDATE items SET trailer = ? WHERE id = ?', JSON.stringify(found || { none: Date.now() }), it.id);
  return found ? found.key : null;
}
