'use client';
// Application Venus (Next.js) : démarrage, écrans d'entrée (installation, connexion, profils),
// coque de navigation et page en cours. Le code partagé (état, accès au serveur, navigation…) vient de lib/shared.
import { createContext, useCallback, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { loadShared, shared } from '../lib/shared';
import Shell from './Shell';
import Gate from './Gates';
import { pageChanged } from '../lib/scroll';

const Ctx = createContext(null);
// Le code partagé commence à se charger dès l'arrivée de ce fichier, sans attendre le premier affichage React
if (typeof window !== 'undefined') loadShared().catch(() => {});
let statusAt = 0;
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

  // Clé de la page : change à chaque vraie navigation et à chaque « actualiser », mais pas quand le code
  // partagé remplace seulement l'adresse affichée (/titre/12 → /films/Inception.2010)
  const keyRef = useRef({ url, key: url, tick });
  if (keyRef.current.url !== url) {
    if (typeof window !== 'undefined' && window.__vnSilent && sameUrl(window.__vnSilent, url)) window.__vnSilent = null;
    else keyRef.current.key = url;
    keyRef.current.url = url;
  }
  const viewKey = `${keyRef.current.key}#${tick}`;

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // Les fenêtres ouvertes (fiche d'une personne…) se ferment quand on change de page
  useEffect(() => { window.dispatchEvent(new Event('vn:navigate')); }, [keyRef.current.key]);

  const start = useCallback(async () => {
    setError(null);
    let L;
    try { L = await loadShared(); } catch (e) { setError(e); setPhase('error'); return; }
    const { app, api } = L;
    let st;
    try { st = await api.api('/api/status'); } catch (e) { setError(e); setPhase('error'); app.hideBoot(); return; }
    app.state.status = st;
    statusAt = Date.now();
    app.setTitle();
    const show = (kind) => { setGate(kind); setPhase('gate'); };
    if (/^\/invitation\/[A-Za-z0-9_-]+$/.test(location.pathname) && st.setup) return show('invitation');
    if (!st.setup) return show('setup');
    if (!st.authenticated) return show('login');
    if (!st.profile) return show('profiles');
    app.state.profile = st.profile;
    L.api.applyProfilePrefs(st.profile); L.themes.useProfileTheme(st.profile);
    await app.refreshCategories();
    setPhase('ready');
    // Mini-lecteur laissé ouvert avant un rechargement : il reprend
    if (!/\/(lecture|S\d+E\d+)$/i.test(location.pathname)) L.imp('mini.js').then((m) => m.resumeMini()).catch(() => {});
  }, []);

  // Next.js affiche les pages : le code partagé navigue avec son routeur, et lui confie l'actualisation,
  // les écrans d'entrée, le redémarrage et deux fenêtres (ajout à une liste, téléchargement)
  const L0 = typeof window !== 'undefined' ? shared() : null;
  if (L0) {
    L0.app.setHost({
      go: (p, { replace = false } = {}) => (replace ? router.replace(p) : router.push(p)),
      prefetch: (p) => { try { router.prefetch(p); } catch { /* adresse inconnue */ } },
      refresh,
      gate: (kind) => { L0.app.state.profile = null; setGate(kind); setPhase('gate'); },
      reboot: () => { setPhase('loading'); start(); },
      addToList: (item) => import('./pages/Collections').then((m) => m.addToSheet(item)),
      download: (d) => import('./pages/Downloads').then((m) => m.openDownload(d)),
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
    const L = shared();
    const { app, api } = L;
    try { sessionStorage.setItem('vn_nav', '1'); } catch { /* */ }
    document.documentElement.classList.toggle('kids', !!app.state.profile?.isKids);
    // Heure du serveur : l'administrateur annonce le fuseau de son appareil, une fois par session (pas depuis une
    // télé, dont l'horloge est souvent mal réglée). À la maison et tant que rien n'a été choisi, le serveur l'adopte.
    if (app.state.profile?.isAdmin && !document.documentElement.classList.contains('tv')) {
      try {
        if (!sessionStorage.getItem('vn_clock')) {
          sessionStorage.setItem('vn_clock', '1');
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (zone) api.api('/api/admin/clock', { method: 'POST', body: { zone } }).then((r) => { if (r && r.adopted) L.ui.toast(`Heure du serveur réglée sur ${zone.replace(/_/g, ' ')} (Réglages → Serveur pour la changer)`); }).catch(() => {});
        }
      } catch { /* stockage indisponible */ }
    }
    app.listenEvents();
    if (document.documentElement.classList.contains('tv') && !window.__vnPairing) {
      window.__vnPairing = true;
      L.imp('remote-screen.js').then((m) => m.startPairing()).catch(() => {});
    }
    // État frais (lecture en cours ailleurs, temps d'écran) ; inutile s'il vient d'être lu au démarrage
    if ((path === '/' || app.state.profile?.dailyLeft != null) && Date.now() - statusAt > 3000) {
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
        <Gate key={`gate-${gate}`} kind={gate} done={(profile) => {
          const { app } = shared();
          if (profile) { app.state.profile = profile; shared().api.applyProfilePrefs(profile); shared().themes.useProfileTheme(profile); app.refreshCategories().then(() => setPhase('ready')); } else { setPhase('loading'); start(); }
        }} />
      </div>
    );
  }
  if (phase !== 'ready') return null;
  const L = shared();
  const bare = L.app.isBare(path);
  return (
    <Ctx.Provider value={{ path, search, url, viewKey, tick, refresh }}>
      <Shell path={path} bare={bare}>
        <PageKey key={viewKey} url={url}>{children}</PageKey>
      </Shell>
    </Ctx.Provider>
  );
}

// Chaque page : position retrouvée en revenant en arrière
function PageKey({ children, url }) {
  useEffect(() => { pageChanged(url); }, [url]);
  return children;
}

function StartError({ error, retry }) {
  useEffect(() => { const L = shared(); if (L) L.app.hideBoot(); else { const b = document.querySelector('.boot'); if (b) b.style.display = 'none'; } }, []);
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
