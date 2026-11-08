'use client';
// Petits outils partagés par les pages Next.js de Venus
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { shared } from './shared';
import { useVenus } from '../components/Venus';

// Données de l'API : rechargées à chaque « actualiser » (tirer vers le bas, nouveautés…)
export function useApi(path, { deps = [], keep = false } = {}) {
  const venus = useVenus();
  const tick = venus ? venus.tick : 0;
  const [state, setState] = useState({ data: undefined, error: null, loading: !!path });
  const [n, setN] = useState(0);
  const shown = useRef(null); // adresse dont les données sont affichées
  useEffect(() => {
    if (!path) { setState({ data: undefined, error: null, loading: false }); return undefined; }
    let dead = false;
    if (!keep) setState((s) => ({ ...s, loading: true }));
    shared().api.api(path)
      .then((data) => { if (!dead) { shown.current = path; setState({ data, error: null, loading: false }); } })
      .catch((error) => {
        if (dead) return;
        // Actualisation ratée (réseau coupé un instant…) : la page affichée reste, un message prévient
        if (shown.current === path && ![401, 403, 404].includes(error.status)) {
          setState((s) => ({ ...s, loading: false }));
          shared().ui.toast(error.message, true);
          return;
        }
        shown.current = null;
        setState({ data: undefined, error, loading: false });
      })
      .finally(() => shared().app.hideBoot());
    return () => { dead = true; };
  }, [path, tick, n, ...deps]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const set = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, set };
}

// Titre de l'onglet
export function useTitle(t) {
  useEffect(() => { if (t !== undefined) shared().app.setTitle(t || undefined); }, [t]);
}

// Fenêtre (feuille) de Venus avec un contenu React. Renvoie { close }.
export function openSheet(title, element, opts = {}) {
  const host = document.createElement('div');
  host.className = 'sheet-react';
  const root = createRoot(host);
  let s = null;
  const close = () => s && s.close();
  flushSync(() => root.render(typeof element === 'function' ? element(close) : element));
  s = shared().ui.sheet(title, host, { ...opts, onClose: () => { setTimeout(() => root.unmount(), 0); opts.onClose && opts.onClose(); } });
  return s;
}

// Exécute une fonction une seule fois par montage, en ignorant les résultats arrivés après le démontage
export function useMounted() {
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return alive;
}

export const go = (p, o) => shared().app.go(p, o);
export const toast = (m, o) => shared().ui.toast(m, o);
export const api = (p, o) => shared().api.api(p, o);
export const img = (n, w) => shared().ui.img(n, w);
