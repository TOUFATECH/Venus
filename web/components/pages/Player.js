'use client';
// Lecteur vidéo : page Next.js plein écran (films, épisodes, clips, chaînes de TV).
// Le moteur de lecture (HLS, pistes, sous-titres, Chromecast, AirPlay, regarder ensemble, mini-lecteur) est un
// module JavaScript piloté depuis React, comme on intègre video.js ou Shaka : il garde la main sur
// l'élément <video>, qu'il confie au mini-lecteur quand on quitte la page sans couper l'image.
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useVenus } from '../Venus';
import { go } from '../../lib/hooks';

let engine = null;
// Moteur de lecture (chargé une seule fois)
const loadEngine = () => (engine || (engine = shared().imp('views/player.js').catch((e) => { engine = null; throw e; })));

// Page du lecteur : branche le moteur de lecture sur la page
export default function Player() {
  const { path, search } = useVenus();
  const host = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const { app, ui } = shared();
    let view = null, dead = false;
    const bar = document.querySelector('.route-bar') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'route-bar' }));
    bar.classList.add('on');
    (async () => {
      try {
        // Adresse → titre à lire : /lecture/12, /films/dune/lecture, /series/x/S01E02, /tv/10-france-2…
        const route = app.matchRoute(path);
        if (!route) { go('/', { replace: true }); return; }
        let params = { ...route.params, query: new URLSearchParams(search ? search.toString() : '') };
        if (params.slug) {
          try { params = await app.resolveParams(params); } catch (e) { ui.toast(e.message, true); go('/', { replace: true }); return; }
        }
        const mod = await loadEngine();
        if (dead) return;
        view = await mod.render(host.current, params);
        if (dead) { try { view && view.destroy && view.destroy(); } catch { /* */ } }
      } catch (e) {
        if (!dead && !(e && (e.status === 401 || e.message === 'Choisissez un profil'))) setError(e);
      } finally {
        bar.classList.remove('on');
        app.hideBoot();
      }
    })();
    return () => {
      dead = true;
      try { view && view.destroy && view.destroy(); } catch { /* */ }
    };
  }, []);

  if (error) {
    return (
      <main className="with-nav">
        <div className="empty">
          <h2>Lecture impossible</h2>
          <p>{error.message || 'Erreur inattendue'}</p>
          <button className="btn f" onClick={() => history.length > 1 ? history.back() : go('/')}>Retour</button>
        </div>
      </main>
    );
  }
  return <main ref={host} />;
}
