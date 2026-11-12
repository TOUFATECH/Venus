'use client';
// Odin dans Venus : la mascotte d'Odin (l'assistant de la maison, où Venus s'appelle « Freyja ») se pose en bas
// de l'écran sur toutes les pages, explique la page où tu es, fait le tour de Venus et, si Odin est relié
// (Réglages → Odin), lui transmet tes questions. Pendant qu'une vidéo joue en grand, elle disparaît ; en pause ou réduite, elle revient. Dix touchers rapides la cachent sur cet appareil ; elle revient
// par Réglages → Thème et menu → Odin. Rien n'est envoyé à Odin sans que tu poses une question.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/hooks';

export const ODIN_KEY = 'venus.odin';
export const odinShown = () => { try { return localStorage.getItem(ODIN_KEY) !== 'off'; } catch { return true; } };
export const setOdinShown = (on) => { try { localStorage.setItem(ODIN_KEY, on ? 'on' : 'off'); } catch { /* */ } window.dispatchEvent(new CustomEvent('vn:odin')); };

// Ce que fait chaque page (le plus long préfixe gagne)
export const GUIDE = [
  ['/', 'Accueil', 'Les sorties de l’année défilent en haut (une affiche toutes les 3 secondes). Dessous : reprendre ce que tu regardais, ta liste, puis les films, séries et chaînes.'],
  ['/cesoir', 'Ce soir', 'Une idée pour ce soir : reprendre, les sorties du jour, ce qui passe en direct, et qui regarde quoi à la maison.'],
  ['/films', 'Films', 'Tous tes films. Trie par date, note ou genre ; touche une affiche pour la fiche, la bande-annonce et la lecture.'],
  ['/series', 'Séries', 'Tes séries, saison par saison. Venus reprend au bon épisode et te prévient des nouveaux.'],
  ['/animes', 'Animés', 'Les animés rangés à part, avec leurs saisons et sous-titres.'],
  ['/tv', 'TV en direct', 'Les chaînes gratuites et ton enregistreur : touche une chaîne pour la regarder, ouvre le guide pour programmer un enregistrement.'],
  ['/musique', 'Musique', 'Albums, artistes et radios, avec les paroles quand elles existent.'],
  ['/livres', 'Livres', 'Livres et BD : lecture dans le navigateur, reprise à la bonne page.'],
  ['/photos', 'Photos', 'Tes photos par date et par album.'],
  ['/clips', 'Clips', 'Les clips vidéo, rangés comme une playlist.'],
  ['/recherche', 'Recherche', 'Cherche un titre, un acteur ou même une réplique. Partout : Ctrl K.'],
  ['/liste', 'Ma liste', 'Les titres gardés pour plus tard. Ajoute avec le bouton « + » d’une fiche.'],
  ['/liste-lecture', 'Listes de lecture', 'Des enchaînements à toi : plusieurs vidéos à la suite.'],
  ['/collections', 'Collections', 'Les sagas et collections : tous les films d’une série dans l’ordre.'],
  ['/nouveautes', 'Nouveautés', 'Ce qui vient d’arriver dans la bibliothèque.'],
  ['/nouveau', 'Nouveautés', 'Ce qui vient d’arriver dans la bibliothèque.'],
  ['/telechargements', 'Téléchargements', 'Les vidéos gardées sur cet appareil pour les regarder sans Internet.'],
  ['/telecommande', 'Télécommande', 'Pilote un autre écran de la maison depuis ce téléphone.'],
  ['/seance', 'Séance', 'Regarder ensemble, au même moment, sur plusieurs écrans.'],
  ['/vote', 'Vote', 'Chacun vote, Venus choisit le film du soir.'],
  ['/retrospective', 'Rétrospective', 'Ton année en films et séries.'],
  ['/stats', 'Statistiques', 'Ce qui a été regardé, par qui et combien de temps.'],
  ['/qualite', 'Qualité', 'Les vidéos à améliorer : mauvaise qualité, sous-titres manquants, doublons.'],
  ['/dashboard', 'Tableau de bord', 'Pour l’administrateur : lectures en cours, serveur, alertes.'],
  ['/serveur', 'Serveur', 'Pour l’administrateur : état du serveur, disques, journaux et clés API.'],
  ['/securite', 'Sécurité', 'Pour l’administrateur : connexions, adresses bannies et journal de sécurité.'],
  ['/reglages', 'Réglages', 'Ton profil, cet appareil, le thème et le menu ; et pour l’administrateur, tout le serveur. Odin se règle dans « Thème et menu ».'],
];
const TOUR = [['/', 'Accueil'], ['/cesoir', 'Ce soir'], ['/films', 'Films'], ['/series', 'Séries'], ['/tv', 'TV en direct'], ['/recherche', 'Recherche'], ['/liste', 'Ma liste'], ['/reglages', 'Réglages']];
export const guideFor = (path) => GUIDE.filter(([p]) => path === p || (p !== '/' && path.startsWith(`${p}/`)) || (p !== '/' && path === p)).sort((a, b) => b[0].length - a[0].length)[0] || GUIDE[0];

// Le vrai dessin d'Odin : corps en dégradé (couleur du jour donnée par Odin), deux halos, yeux, habit de fête
const mix = (h, w, k) => { const a = parseInt(h.slice(1), 16), b = w ? 255 : 0; return `#${[16, 8, 0].map((x) => Math.round(((a >> x) & 255) * (1 - k) + b * k).toString(16).padStart(2, '0')).join('')}`; };
export const tints = (c) => (c ? [mix(c, false, 0.14), c, mix(c, true, 0.32), mix(c, true, 0.62)] : ['#E19B1F', '#EDB03D', '#F8CC70', '#FFE3A0']);
const ACC = {
  bonnet: <g><path d="M28 30 Q38 2 68 2 Q92 4 102 22 L94 27 Q86 13 72 13 Q52 13 42 32Z" fill="#d62828" /><rect x="24" y="24" width="68" height="11" rx="5.5" fill="#fff" transform="rotate(-6 58 30)" /><circle cx="102" cy="23" r="7" fill="#fff" /></g>,
  cotillons: <g><path d="M50 20 L62 -8 L74 20Z" fill="#ffd36a" /><path d="M54 12 L70 12 M57 4 L67 4" stroke="#ff4a4a" strokeWidth="3" /><circle cx="62" cy="-9" r="4" fill="#ff6ad5" /></g>,
  gateau: <g><path d="M50 20 L62 -8 L74 20Z" fill="#ff6ad5" /><path d="M54 12 L70 12 M57 4 L67 4" stroke="#fff" strokeWidth="3" /><circle cx="62" cy="-9" r="4" fill="#ffd36a" /></g>,
  lune: <g><path d="M92 4 a14 14 0 1 0 14 17 a11 11 0 1 1 -14 -17Z" fill="#ffd36a" /></g>,
  coeur: <path d="M96 16 c-4 -6 -14 -4 -12 4 c1 5 12 11 12 11 s11 -6 12 -11 c2 -8 -8 -10 -12 -4z" fill="#ef4f43" />,
  trefle: <g fill="#34c77b"><circle cx="92" cy="14" r="6" /><circle cx="101" cy="14" r="6" /><circle cx="96.5" cy="6" r="6" /></g>,
  citrouille: <g><ellipse cx="60" cy="14" rx="18" ry="11" fill="#ff7a1a" /><path d="M60 3 v-6" stroke="#2f8f4e" strokeWidth="3" /></g>,
  masque: <path d="M30 52 q30 -16 60 0 q-4 16 -20 14 q-10 -2 -10 -8 q0 6 -10 8 q-16 2 -20 -14Z" fill="#9a6bff" opacity=".85" />,
  note: <path d="M96 2 v18 a5 4 0 1 1 -3 -3.5 V6 l12 -3 v4Z" fill="#9aa8ff" />,
  oeuf: <g><ellipse cx="104" cy="96" rx="11" ry="14" fill="#ffd6e7" /><path d="M94 93 q5 -3 10 0 q5 3 10 0" stroke="#9ad7ff" strokeWidth="2.4" fill="none" /></g>,
};
export function OdinFace({ size = 56, color, eyes, accessory }) {
  const t = tints(color);
  const halo = t[3];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" className="vn-odin-face" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id="vnOdinBody" cx="50%" cy="46%" r="54%"><stop offset="0" stopColor={t[0]} /><stop offset=".5" stopColor={t[1]} /><stop offset=".82" stopColor={t[2]} /><stop offset="1" stopColor={t[3]} /></radialGradient>
        <radialGradient id="vnOdinHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stopColor={halo} stopOpacity=".46" /><stop offset=".93" stopColor={halo} stopOpacity=".3" /><stop offset="1" stopColor={halo} stopOpacity="0" /></radialGradient>
      </defs>
      <g className="vn-odin-orbit"><circle cx="63" cy="64" r="49" fill="url(#vnOdinHalo)" /></g>
      <circle cx="60" cy="60" r="44" fill="url(#vnOdinBody)" />
      <g className="vn-odin-eyes"><rect x="43" y="45" width="9" height="22" rx="4.5" fill={eyes || '#fff'} /><rect x="68" y="45" width="9" height="22" rx="4.5" fill={eyes || '#fff'} /></g>
      {accessory && ACC[accessory] ? <g className="vn-odin-acc">{ACC[accessory]}</g> : null}
    </svg>
  );
}

export default function OdinGuide({ path }) {
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [hint, setHint] = useState('');
  const clicks = useRef([]);
  // Une vidéo en lecture (en grand) : Odin disparaît ; en pause, arrêtée ou réduite (petite, image dans l'image) : il revient.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const check = () => {
      const big = [...document.querySelectorAll('video')].some((v) => { if (v.paused || v.ended || document.pictureInPictureElement === v) return false; const r = v.getBoundingClientRect(); return r.width * r.height > innerWidth * innerHeight * 0.3 || document.fullscreenElement?.contains(v); });
      setPlaying(big);
    };
    const ev = ['play', 'playing', 'pause', 'ended', 'emptied', 'enterpictureinpicture', 'leavepictureinpicture'];
    for (const e of ev) document.addEventListener(e, check, true);
    document.addEventListener('fullscreenchange', check); addEventListener('resize', check);
    const t = setInterval(check, 1500); check();
    return () => { for (const e of ev) document.removeEventListener(e, check, true); document.removeEventListener('fullscreenchange', check); removeEventListener('resize', check); clearInterval(t); };
  }, []);
  const [day, setDay] = useState(null); // Odin d'aujourd'hui, donné par Odin (fête, couleur, pouvoirs, caché)
  useEffect(() => {
    const sync = () => setOn(odinShown());
    sync(); addEventListener('vn:odin', sync);
    return () => removeEventListener('vn:odin', sync);
  }, []);
  useEffect(() => { if (on) api('/api/odin').then((r) => setLinked(!!(r && r.linked))).catch(() => setLinked(false)); }, [on]);
  useEffect(() => {
    let stop = false;
    const load = () => api('/api/odin/mascotte').then((r) => { if (stop || !r || !r.linked) return; setDay(r);
      // Les pouvoirs d'Odin dans Venus (le script peut arriver un peu après la page).
      const cfg = () => { if (window.OdinPowers) window.OdinPowers.configure(r.pouvoirs || { actif: false }); else setTimeout(cfg, 500); }; cfg();
      try { const k = `${new Date().toISOString().slice(0, 10)}:${r.event?.id || ''}`; if (r.event?.says && localStorage.getItem('venus.odin.fete') !== k) { setHint(r.event.says); localStorage.setItem('venus.odin.fete', k); } } catch { /* */ }
    }).catch(() => {});
    load(); const t = setInterval(load, 5 * 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  // Une nouvelle page : le pouvoir d'Odin fait naître son titre (si les pouvoirs sont activés dans Odin).
  useEffect(() => { const t = setTimeout(() => { const h = document.querySelector('main h1, main h2, .page-head, main header'); if (h) window.OdinPowers?.appear?.(h); }, 120); return () => clearTimeout(t); }, [path]);
  useEffect(() => { setAnswer(''); setHint(''); }, [path]);
  // Pas sur le lecteur vidéo : Odin ne cache jamais l'image
  if (!on || day?.cache || playing) return null;
  const [, title, what] = guideFor(path);

  const tap = () => {
    const now = Date.now();
    const last = clicks.current[clicks.current.length - 1];
    clicks.current = last && now - last < 2000 ? [...clicks.current, now] : [now];
    const n = clicks.current.length;
    if (n >= 10) { clicks.current = []; setOpen(false); setOdinShown(false); return; }
    if (n === 8) setHint('Encore 2 et je me cache sur cet appareil.');
    else if (n === 5) setHint('Hé, ça chatouille !');
    else if (n === 1) setOpen((o) => !o);
  };
  const ask = async (e) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setAnswer('');
    try { const r = await api('/api/odin/ask', { method: 'POST', body: { q: q.trim(), page: title } }); setAnswer(r.text || '…'); setQ(''); }
    catch (err) { setAnswer(err.message || 'Odin ne répond pas'); }
    finally { setBusy(false); }
  };
  return (
    <div className={`vn-odin${open ? ' open' : ''}`}>
      {open ? (
        <section className="vn-odin-panel" role="dialog" aria-label="Odin, ton guide dans Venus">
          <header><b>Odin</b><span>ton guide dans Venus</span><button className="vn-odin-x f" aria-label="Fermer" onClick={() => setOpen(false)}>×</button></header>
          <div className="vn-odin-page"><b>{title}</b><p>{what}</p></div>
          {answer ? <div className="vn-odin-answer" aria-live="polite">{answer}</div> : null}
          {linked ? (
            <form className="vn-odin-ask" onSubmit={ask}>
              <input value={q} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ask(e); }} onChange={(e) => setQ(e.target.value)} placeholder="Demande à Odin…" aria-label="Ta question pour Odin" maxLength={2000} />
              <button className="f" disabled={busy || !q.trim()}>{busy ? '…' : '→'}</button>
            </form>
          ) : <p className="vn-odin-hint">Relie Odin (Réglages → Thème et menu → Odin) pour lui poser tes questions.</p>}
          <nav className="vn-odin-tour" aria-label="Le tour de Venus">{TOUR.map(([href, t]) => <Link key={href} href={href} className={`f${href === path ? ' on' : ''}`} onClick={() => setAnswer('')}>{t}</Link>)}</nav>
        </section>
      ) : hint ? <div className="vn-odin-bubble" role="status">{hint}</div> : null}
      <button className="vn-odin-btn f" onClick={tap} aria-label={open ? 'Odin (ouvert)' : 'Odin : explique-moi cette page'} aria-expanded={open}><OdinFace color={day?.event?.color || day?.color} eyes={day?.event?.eyes} accessory={day?.event?.accessory} /></button>
    </div>
  );
}
