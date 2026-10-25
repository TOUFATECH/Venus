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
  { id: 'today', href: '/cesoir', label: todayLabel, icon: todayIcon, hint: 'Trois questions, trois idées à regarder' },
  { id: 'home', href: '/', label: 'Accueil', icon: 'home' },
  { id: 'movies', href: '/films', label: 'Films', icon: 'film', cat: 'movie' },
  { id: 'shows', href: '/series', label: 'Séries', icon: 'tv', cat: 'show' },
  { id: 'anime', href: '/animes', label: 'Animés', icon: 'spark', cat: 'anime' },
  { id: 'new', href: '/nouveautes', label: 'Nouveautés', icon: 'cal', hint: 'Films, séries et animés qui sortent' },
  { id: 'clips', href: '/clips', label: 'Clips', icon: 'note', cat: 'clip' },
  { id: 'tv', href: '/tv', label: 'TV', icon: 'live', cat: 'channel' },
  { id: 'mylist', href: '/liste', label: 'Ma liste', icon: 'list' },
  { id: 'search', href: '/recherche', label: 'Recherche', icon: 'search' },
  { id: 'seance', href: '/seance', label: 'Séance', icon: 'people', hint: 'Regarder ensemble, chacun sur son écran' },
  { id: 'remote', action: 'remote', label: 'Télécommande', icon: 'remote', hint: 'Piloter Venus avec votre téléphone' },
  { id: 'add', href: '/ajouter', label: 'Ajouter', icon: 'add', admin: true, hint: 'Envoyer des vidéos sur le serveur' },
  { id: 'dashboard', href: '/tableau-de-bord', label: 'Tableau de bord', icon: 'gauge', admin: true, hint: 'Lectures en cours, appareils, code de connexion' },
];
// Menu court par défaut : Aujourd'hui, Accueil, Films, Séries, Animés, Nouveautés, Recherche ; le reste dans « Plus »
const DEFAULT_HIDDEN = ['clips', 'tv', 'mylist', 'seance', 'remote', 'add', 'dashboard'];
const labelOf = (it) => (typeof it.label === 'function' ? it.label() : it.label);
const iconOf = (it) => (typeof it.icon === 'function' ? it.icon() : it.icon);
export { labelOf, iconOf };

const key = (pid) => `vn_menu_${pid}`;
export function menuPrefs(pid) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key(pid))); } catch { /* */ }
  const ids = NAV_ITEMS.map((i) => i.id);
  const order = [...((saved && saved.order) || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !(saved && saved.order || []).includes(id))];
  // Éléments apparus depuis le dernier réglage : rangés dans « Plus » s'ils le sont par défaut
  const known = (saved && saved.order) || [];
  const hidden = saved && Array.isArray(saved.hidden)
    ? [...saved.hidden.filter((id) => ids.includes(id)), ...DEFAULT_HIDDEN.filter((id) => !known.includes(id))]
    : DEFAULT_HIDDEN;
  return { order, hidden };
}
export function saveMenuPrefs(pid, prefs) {
  try { localStorage.setItem(key(pid), JSON.stringify(prefs)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('vn:menu'));
}
export function resetMenuPrefs(pid) {
  try { localStorage.removeItem(key(pid)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('vn:menu'));
}

// Éléments à afficher : ceux du menu, et ceux rangés dans « Plus »
export function menuItems(profile, hasCat) {
  const p = menuPrefs(profile.id);
  const usable = (it) => (!it.admin || profile.isAdmin) && (!it.cat || hasCat(it.cat));
  const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
  const list = p.order.map((id) => byId.get(id)).filter(usable);
  return { shown: list.filter((i) => !p.hidden.includes(i.id)), more: list.filter((i) => p.hidden.includes(i.id)), prefs: p };
}
