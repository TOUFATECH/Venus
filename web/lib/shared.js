// Code partagé de Venus (public/js, copié dans web/partage/js avant la construction) : accès au serveur,
// état et navigation (core.js), fenêtres et petits composants d'affichage, thèmes, menu, navigation à la
// télécommande, moteur de lecture. Next.js l'embarque dans ses propres fichiers ; il n'est chargé
// que dans le navigateur (il touche au document dès son chargement).
let S = null;
let loading = null;

export const shared = () => S;

// Modules chargés à la demande (bande-annonce, direct, lecteur…)
const LAZY = {
  'live.js': () => import('../partage/js/live.js'),
  'trailer.js': () => import('../partage/js/trailer.js'),
  'ambiance.js': () => import('../partage/js/ambiance.js'),
  'mini.js': () => import('../partage/js/mini.js'),
  'audio.js': () => import('../partage/js/audio.js'),
  'remote-screen.js': () => import('../partage/js/remote-screen.js'),
  'views/search.js': () => import('../partage/js/views/search.js'),
  'views/player.js': () => import('../partage/js/views/player.js'),
  'voice.js': () => import('../partage/js/voice.js'),
  'screensaver.js': () => import('../partage/js/screensaver.js'),
};
const imp = (file) => {
  const load = LAZY[file];
  return load ? load() : Promise.reject(new Error(`Module inconnu : ${file}`));
};

export function loadShared() {
  if (S) return Promise.resolve(S);
  if (!loading) {
    loading = Promise.all([
      import('../partage/js/core.js'), import('../partage/js/api.js'), import('../partage/js/ui.js'), import('../partage/js/components.js'),
      import('../partage/js/menu.js'), import('../partage/js/themes.js'), import('../partage/js/queue.js'), import('../partage/js/nav.js'),
    ]).then(([app, api, ui, components, menu, themes, queue, nav]) => {
      // Next.js affiche les pages : l'écran de chargement lui appartient (masqué, pas retiré)
      app.setHost({ next: true });
      S = { app, api, ui, components, menu, themes, queue, nav, imp };
      return S;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
