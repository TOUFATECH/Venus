'use client';
// Application Venus (React) : démarrage, écrans d'accueil (installation, connexion, profils),
// coque de navigation et page en cours. Les pages déjà réécrites sont des composants React (Films, Séries,
// Animés, Clips, Ma liste, Recherche) ; les autres sont les vues de l'ancienne interface, montées telles quelles.
import { createContext, useCallback, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { loadLegacy, legacy } from '../lib/legacy';
import Shell from './Shell';
import LegacyMount from './LegacyMount';

const Ctx = createContext(null);
const sameUrl = (a, b) => { try { return decodeURI(a) === decodeURI(b); } catch { return a === b; } };
export const useVenus = () => useContext(Ctx);

export default function Venus({ children }) {
  return <Suspense fallback={null}><App>{children}</App></Suspense>;
}

function App({ children }) {
  const router = useRouter();
  const path = usePathname() || '/';
  const search = useSearchParams();
  const qs = search ? search.toString() : '';
  const url = `${path}${qs ? `?${qs}` : ''}`;
  const [phase, setPhase] = useState('loading'); // loading | gate | ready | error
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [, setChrome] = useState(0);

  // Clé de la page : change à chaque vraie navigation et à chaque « actualiser », mais pas quand l'ancienne
  // interface remplace seulement l'adresse affichée (/titre/12 → /films/Inception.2010)
  const keyRef = useRef({ url, key: url, tick });
  if (keyRef.current.url !== url) {
    if (typeof window !== 'undefined' && window.__vnSilent && sameUrl(window.__vnSilent, url)) window.__vnSilent = null;
    else keyRef.current.key = url;
    keyRef.current.url = url;
  }
  const viewKey = `${keyRef.current.key}#${tick}`;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const start = useCallback(async () => {
    setError(null);
    let L;
    try { L = await loadLegacy(); } catch (e) { setError(e); setPhase('error'); return; }
    const { app, api } = L;
    let st;
    try { st = await api.api('/api/status'); } catch (e) { setError(e); setPhase('error'); app.hideBoot(); return; }
    app.state.status = st;
    app.setTitle();
    const show = (kind) => { setGate(kind); setPhase('gate'); };
    if (/^\/invitation\/[A-Za-z0-9_-]+$/.test(location.pathname) && st.setup) return show('invitation');
    if (!st.setup) return show('setup');
    if (!st.authenticated) return show('login');
    if (!st.profile) return show('profiles');
    app.state.profile = st.profile;
    await app.refreshCategories();
    setPhase('ready');
    // Mini-lecteur laissé ouvert avant un rechargement : il reprend
    if (!/\/(lecture|S\d+E\d+)$/i.test(location.pathname)) L.imp('mini.js').then((m) => m.resumeMini()).catch(() => {});
  }, []);

  // Pont avec l'ancienne interface : navigation, actualisation, écrans d'accueil
  if (typeof window !== 'undefined') {
    window.__VN_NEXT = Object.assign(window.__VN_NEXT || {}, {
      go: (p, { replace = false } = {}) => (replace ? router.replace(p) : router.push(p)),
      refresh,
      gate: (kind) => { const L = legacy(); if (L) L.app.state.profile = null; setGate(kind); setPhase('gate'); },
      reboot: () => { setPhase('loading'); start(); },
    });
  }

  useEffect(() => { start(); }, [start]);

  // Menu, thème, profil modifiés : la coque se redessine
  useEffect(() => {
    const redraw = () => setChrome((n) => n + 1);
    window.addEventListener('vn:menu', redraw);
    window.addEventListener('vn:theme', redraw);
    return () => { window.removeEventListener('vn:menu', redraw); window.removeEventListener('vn:theme', redraw); };
  }, []);

  // À chaque page : profil enfant, nouveautés en temps réel, état frais sur l'accueil
  useEffect(() => {
    if (phase !== 'ready') return;
    const L = legacy();
    const { app, api } = L;
    try { sessionStorage.setItem('vn_nav', '1'); } catch { /* */ }
    document.documentElement.classList.toggle('kids', !!app.state.profile?.isKids);
    app.listenEvents();
    if (document.documentElement.classList.contains('tv') && !window.__vnPairing) {
      window.__vnPairing = true;
      L.imp('remote-screen.js').then((m) => m.startPairing()).catch(() => {});
    }
    if (path === '/' || app.state.profile?.dailyLeft != null) {
      api.api('/api/status').then((st) => {
        if (!st) return;
        if (app.state.status) app.state.status.elsewhere = st.elsewhere;
        if (st.profile && app.state.profile && st.profile.id === app.state.profile.id && st.profile.dailyLeft !== app.state.profile.dailyLeft) {
          app.state.profile.dailyLeft = st.profile.dailyLeft;
          setChrome((n) => n + 1);
        }
      }).catch(() => {});
    }
    if (path === '/') app.refreshCategories().then(() => setChrome((n) => n + 1));
  }, [phase, viewKey]);

  if (phase === 'error') return <StartError error={error} retry={() => { setPhase('loading'); start(); }} />;
  if (phase === 'gate') {
    return (
      <div id="app">
        <LegacyMount key={`gate-${gate}`} gate={gate} done={(profile) => {
          const { app } = legacy();
          if (profile) { app.state.profile = profile; app.refreshCategories().then(() => setPhase('ready')); } else { setPhase('loading'); start(); }
        }} />
      </div>
    );
  }
  if (phase !== 'ready') return null;
  const L = legacy();
  const bare = L.app.isBare(path);
  return (
    <Ctx.Provider value={{ path, search, url, viewKey, tick, refresh }}>
      <Shell path={path} bare={bare}>
        <PageKey key={viewKey}>{children}</PageKey>
      </Shell>
    </Ctx.Provider>
  );
}

function PageKey({ children }) { return children; }

function StartError({ error, retry }) {
  useEffect(() => { const L = legacy(); if (L) L.app.hideBoot(); else { const b = document.querySelector('.boot'); if (b) b.style.display = 'none'; } }, []);
  return (
    <div id="app">
      <div className="center-screen">
        <div className="panel">
          <h2>{error && error.status === 0 ? 'Serveur injoignable' : 'Impossible d’afficher Venus'}</h2>
          <p>{(error && error.message) || 'Erreur inattendue'}</p>
          <div className="form-actions">
            <button className="btn btn-play f" onClick={retry}>Réessayer</button>
            <button className="btn btn-ghost f" onClick={() => location.reload()}>Recharger</button>
          </div>
        </div>
      </div>
    </div>
  );
}
