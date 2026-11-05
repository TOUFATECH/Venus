// Menu de navigation personnalisable : ordre et éléments affichés, propres à chaque profil sur cet appareil.
// « Aujourd'hui » devient « Ce soir » à partir de 17 h.

export function dayPart(d = new Date()) {
  const hr = d.getHours();
  return hr >= 17 || hr < 4 ? 'soir' : 'jour';
}
export const todayLabel = () => (dayPart() === 'soir' ? 'Ce soir' : 'Aujourd’hui');
export const todayIcon = () => (dayPart() === 'soir' ? 'moon' : 'sun');
export const todayQuestion = () => (dayPart() === 'soir' ? 'Que regarder ce soir ?' : 'Que regarder aujourd’hui ?');

export const NAV_ITEMS = [
  { id: 'home', href: '/', label: 'Accueil', icon: 'home' },
  { id: 'movies', href: '/films', label: 'Films', icon: 'film', cat: 'movie' },
  { id: 'shows', href: '/series', label: 'Séries', icon: 'tv', cat: 'show' },
  { id: 'anime', href: '/animes', label: 'Animés', icon: 'spark', cat: 'anime' },
  { id: 'today', href: '/cesoir', label: todayLabel, icon: todayIcon, hint: 'Trois questions, trois idées à regarder', short: '3 idées pour vous' },
  { id: 'new', href: '/nouveautes', label: 'Nouveautés', icon: 'cal', hint: 'Films, séries et animés qui sortent', short: 'Sorties à venir' },
  { id: 'clips', href: '/clips', label: 'Clips', icon: 'clip', cat: 'clip' },
  { id: 'tv', href: '/tv', label: 'TV', icon: 'live', cat: 'channel' },
  { id: 'music', href: '/musique', label: 'Musique', icon: 'note', cat: 'music' },
  { id: 'photos', href: '/photos', label: 'Photos', icon: 'image', cat: 'photo' },
  { id: 'books', href: '/livres', label: 'Livres', icon: 'book', cat: 'book' },
  { id: 'mylist', href: '/liste', label: 'Ma liste', icon: 'list', hint: 'Gardé pour plus tard', short: 'Titres gardés' },
  { id: 'collections', href: '/collections', label: 'Collections', icon: 'grid4', hint: 'Sagas, collections et listes de lecture', short: 'Sagas et listes' },
  { id: 'search', href: '/recherche', label: 'Recherche', icon: 'search' },
  { id: 'seance', href: '/seance', label: 'Séance', icon: 'people', hint: 'Regarder ensemble, chacun sur son écran' },
  { id: 'remote', action: 'remote', label: 'Télécommande', icon: 'remote', hint: 'Piloter Venus avec votre téléphone' },
  { id: 'add', href: '/ajouter', label: 'Ajouter', icon: 'add', admin: true, hint: 'Où ranger vos fichiers, liste IPTV' },
  { id: 'stats', href: '/stats', label: 'Statistiques', icon: 'gauge', hint: 'Vos heures, genres et séries préférées' },
  { id: 'downloads', href: '/telechargements', label: 'Téléchargements', icon: 'down', hint: 'Vos vidéos pour regarder sans réseau' },
  { id: 'dashboard', href: '/tableau-de-bord', label: 'Tableau de bord', icon: 'gauge', admin: true, hint: 'Lectures en cours, appareils, code de connexion' },
];
// Tout ce qui a du contenu est affiché d'office (Films, Séries, Animés, TV, Clips, Musique, Photos, Livres…) ;
// seuls les outils sont rangés dans « Plus » au départ. Chaque section reste masquable dans Réglages → Menu.
const DEFAULT_HIDDEN = ['seance', 'remote', 'add', 'dashboard', 'stats', 'downloads'];
// Sections de contenu : jamais masquées par un ancien réglage (avant la v2, elles étaient cachées par défaut)
export const CONTENT_IDS = ['today', 'home', 'movies', 'shows', 'anime', 'new', 'clips', 'tv', 'music', 'photos', 'books', 'mylist', 'collections', 'search'];
const PREFS_VERSION = 3;
/** Sur ordinateur, le rail ne montre que les 4 premières sections ; le reste est dans « Plus ». */
export const RAIL_MAX = 4;
const labelOf = (it) => (typeof it.label === 'function' ? it.label() : it.label);
const iconOf = (it) => (typeof it.icon === 'function' ? it.icon() : it.icon);
export { labelOf, iconOf };

const key = (pid) => `vn_menu_${pid}`;
export function menuPrefs(pid) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key(pid))); } catch { /* */ }
  const ids = NAV_ITEMS.map((i) => i.id);
  // Réglage d'avant la v3 : nouvel ordre par défaut (Accueil, Films, Séries, Animés d'abord)
  const savedOrder = saved && saved.v >= 3 ? saved.order || [] : [];
  const order = [...savedOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !savedOrder.includes(id))];
  // Éléments apparus depuis le dernier réglage : rangés dans « Plus » s'ils le sont par défaut
  const known = (saved && saved.order) || [];
  let hidden = saved && Array.isArray(saved.hidden)
    ? [...saved.hidden.filter((id) => ids.includes(id)), ...DEFAULT_HIDDEN.filter((id) => !known.includes(id))]
    : DEFAULT_HIDDEN;
  // Réglage enregistré avec l'ancien menu court : les sections de contenu réapparaissent
  if (saved && saved.v < 2) hidden = hidden.filter((id) => !CONTENT_IDS.includes(id));
  hidden = [...new Set(hidden)];
  return { order, hidden };
}
export function saveMenuPrefs(pid, prefs) {
  try { localStorage.setItem(key(pid), JSON.stringify({ order: prefs.order, hidden: prefs.hidden, v: PREFS_VERSION })); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('vn:menu'));
}
export function resetMenuPrefs(pid) {
  try { localStorage.removeItem(key(pid)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('vn:menu'));
}

// Éléments à afficher : ceux du menu, et ceux rangés dans « Plus »
export function menuItems(profile, hasCat) {
  const p = menuPrefs(profile.id);
  // Profil enfant : seulement le contenu (pas d'outils, pas de nouveautés à venir, pas de téléchargements)
  const KIDS_HIDE = new Set(['new', 'seance', 'remote', 'add', 'dashboard', 'stats', 'downloads', 'collections', 'tv']);
  const usable = (it) => (!it.admin || profile.isAdmin) && (!it.cat || hasCat(it.cat)) && !(profile.isKids && KIDS_HIDE.has(it.id));
  const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
  const list = p.order.map((id) => byId.get(id)).filter(usable);
  return { shown: list.filter((i) => !p.hidden.includes(i.id)), more: list.filter((i) => p.hidden.includes(i.id)), prefs: p };
}

// Sections de la médiathèque (tuiles de l'accueil et grille « Tout ») avec le nombre de titres
const COUNT_WORD = { movie: ['film', 'films'], show: ['série', 'séries'], anime: ['animé', 'animés'], clip: ['clip', 'clips'], channel: ['chaîne', 'chaînes'],
  music: ['titre', 'titres'], photo: ['photo', 'photos'], book: ['livre', 'livres'] };
export function countLabel(cat, n) {
  const w = COUNT_WORD[cat];
  return w && n ? `${n} ${n > 1 ? w[1] : w[0]}` : '';
}
export const SECTION_IDS = ['today', 'movies', 'shows', 'anime', 'tv', 'clips', 'music', 'photos', 'books', 'collections', 'mylist', 'new'];
export function sections(profile, hasCat, counts = {}) {
  const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
  return SECTION_IDS.map((id) => byId.get(id))
    .filter((it) => it && (!it.cat || hasCat(it.cat)) && (!it.admin || profile.isAdmin))
    .map((it) => ({ ...it, label: labelOf(it), icon: iconOf(it), sub: it.cat ? countLabel(it.cat, counts[it.cat] || 0) : it.short || it.hint || '' }));
}
