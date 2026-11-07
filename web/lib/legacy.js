// Pont vers les modules de l'ancienne interface (public/js), chargés tels que le serveur les sert
// (/b/<version>/js/…) : une seule instance de chaque module, partagée avec les vues pas encore réécrites.
let L = null;
let loading = null;

export const legacy = () => L;

export function loadLegacy() {
  if (L) return Promise.resolve(L);
  if (!loading) {
    const build = document.querySelector('meta[name="venus-build"]')?.content;
    const root = build ? `/b/${build}/js/` : '/js/';
    const imp = (file) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${root}${file}`);
    // L'ancienne interface sait qu'elle est pilotée par Next.js (pas de démarrage ni de routage à elle)
    window.__VN_NEXT = window.__VN_NEXT || {};
    loading = Promise.all(['app.js', 'api.js', 'ui.js', 'components.js', 'menu.js', 'themes.js', 'queue.js', 'nav.js'].map(imp))
      .then(([app, api, ui, components, menu, themes, queue, nav]) => {
        L = { app, api, ui, components, menu, themes, queue, nav, root, imp };
        return L;
      })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}
