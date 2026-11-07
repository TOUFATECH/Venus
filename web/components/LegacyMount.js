'use client';
// Vue de l'ancienne interface montée dans une page React (le temps qu'elle soit réécrite).
// La vue reçoit un vrai <main> déjà dans la page ; React ne touche pas à son contenu.
import { useEffect, useRef } from 'react';
import { legacy } from '../lib/legacy';
import { useVenus } from './Venus';

export default function LegacyMount({ gate = null, done = null }) {
  const venus = useVenus();
  const ref = useRef(null);
  const path = venus ? venus.path : null;
  const query = venus ? venus.search : null;
  const route = gate ? null : legacy().app.matchRoute(path);
  const bare = route ? route.bare : !!gate;

  useEffect(() => {
    const L = legacy();
    const { app, ui, nav } = L;
    const main = ref.current;
    let view = null, dead = false;
    const bar = document.querySelector('.route-bar') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'route-bar' }));
    bar.classList.add('on');
    // Page lente : sa silhouette s'affiche plutôt qu'un écran vide
    const sk = setTimeout(() => { if (!dead && !main.childElementCount) main.append(skeleton(path)); }, 140);
    const finish = () => {
      clearTimeout(sk);
      bar.classList.remove('on');
      main.querySelectorAll(':scope > .sk-wrap').forEach((x) => x.remove());
      app.hideBoot();
      if (document.documentElement.classList.contains('keys') || document.documentElement.classList.contains('tv')) requestAnimationFrame(() => nav.focusFirst());
    };
    const fail = (e) => {
      finish();
      if (e && (e.status === 401 || e.message === 'Choisissez un profil')) return;
      const box = ui.h('div', { class: 'empty' }, ui.h('h2', {}, 'Impossible d’afficher cette page'), ui.h('p', {}, (e && e.message) || 'Erreur inattendue'),
        ui.h('button', { class: 'btn f', onclick: () => venus && venus.refresh() }, 'Réessayer'));
      main.append(box);
    };
    (async () => {
      try {
        let mod, params;
        if (gate) {
          mod = await L.imp(`views/${gate}.js`);
          params = { done: (profile) => done && done(profile) };
        } else {
          if (!route) { app.go('/', { replace: true }); return; }
          params = { ...route.params, query: new URLSearchParams(query ? query.toString() : '') };
          if (params.slug) {
            try { params = await app.resolveParams(params); } catch (e) { ui.toast(e.message, true); app.go('/', { replace: true }); return; }
          }
          mod = await route.loader();
        }
        if (dead) return;
        view = await mod.render(main, params);
        if (dead) { try { view && view.destroy && view.destroy(); } catch { /* */ } return; }
        finish();
        if (!gate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          main.classList.add('page-in');
          setTimeout(() => main.classList.remove('page-in'), 900);
        }
      } catch (e) { if (!dead) fail(e); }
    })();
    return () => {
      dead = true;
      clearTimeout(sk);
      try { view && view.destroy && view.destroy(); } catch { /* */ }
    };
  }, []);

  return <main ref={ref} className={bare ? '' : 'with-nav'} />;
}

// Silhouette d'une page pendant son chargement
function skeleton(path) {
  const { h } = legacy().ui;
  const bar = (w, hgt = 14) => h('i', { class: 'sk', style: { width: w, height: `${hgt}px` } });
  const cards = (n, cls) => h('div', { class: `sk-row ${cls}` }, Array.from({ length: n }, () => h('i', { class: 'sk' })));
  let body;
  if (path === '/') {
    body = [h('div', { class: 'sk-hero' }, h('div', {}, bar('46%', 54), bar('28%'), bar('52%'), bar('40%'), h('div', { class: 'sk-actions' }, bar('150px', 48), bar('150px', 48)))),
      h('div', { class: 'sk-rows' }, bar('180px', 18), cards(6, 'land'), bar('220px', 18), cards(6, 'land'))];
  } else if (/^\/(titre|films|series|animes)\//.test(path || '')) {
    body = [h('div', { class: 'page sk-details' }, h('i', { class: 'sk sk-poster' }), h('div', {}, bar('60%', 56), bar('30%'), bar('80%'), bar('70%'), h('div', { class: 'sk-actions' }, bar('170px', 48), bar('48px', 48))))];
  } else {
    body = [h('div', { class: 'page' }, bar('260px', 48), bar('70%'), bar('60%'), cards(5, 'land'))];
  }
  return h('div', { class: 'sk-wrap sk-page', 'aria-busy': 'true', 'aria-label': 'Chargement' }, body);
}
