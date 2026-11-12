'use client';
// Odin dans Venus : la mascotte d'Odin (l'assistant de la maison, où Venus s'appelle « Freyja ») se pose en bas
// de l'écran sur toutes les pages, explique la page où tu es, fait le tour de Venus et, si Odin est relié
// (Réglages → Odin), lui transmet tes questions. Dix touchers rapides la cachent sur cet appareil ; elle revient
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

// Le vrai dessin d'Odin : corps en dégradé doré, deux halos, yeux
export function OdinFace({ size = 56 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" className="vn-odin-face">
      <defs>
        <radialGradient id="vnOdinBody" cx="50%" cy="46%" r="54%"><stop offset="0" stopColor="#E19B1F" /><stop offset=".5" stopColor="#EDB03D" /><stop offset=".82" stopColor="#F8CC70" /><stop offset="1" stopColor="#FFE3A0" /></radialGradient>
        <radialGradient id="vnOdinHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stopColor="#FFE7AE" stopOpacity=".46" /><stop offset=".93" stopColor="#FFE7AE" stopOpacity=".3" /><stop offset="1" stopColor="#FFE7AE" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="vn-odin-orbit"><circle cx="63" cy="64" r="49" fill="url(#vnOdinHalo)" /></g>
      <circle cx="60" cy="60" r="44" fill="url(#vnOdinBody)" />
      <g className="vn-odin-eyes"><rect x="43" y="45" width="9" height="22" rx="4.5" fill="#fff" /><rect x="68" y="45" width="9" height="22" rx="4.5" fill="#fff" /></g>
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
  useEffect(() => {
    const sync = () => setOn(odinShown());
    sync(); addEventListener('vn:odin', sync);
    return () => removeEventListener('vn:odin', sync);
  }, []);
  useEffect(() => { if (on) api('/api/odin').then((r) => setLinked(!!(r && r.linked))).catch(() => setLinked(false)); }, [on]);
  useEffect(() => { setAnswer(''); setHint(''); }, [path]);
  // Pas sur le lecteur vidéo : Odin ne cache jamais l'image
  if (!on || /^\/(lecture|lire)(\/|$)/.test(path) || /\/lecture$/.test(path) || /\/S\d+E\d+$/i.test(path)) return null;
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
      <button className="vn-odin-btn f" onClick={tap} aria-label={open ? 'Odin (ouvert)' : 'Odin : explique-moi cette page'} aria-expanded={open}><OdinFace /></button>
    </div>
  );
}
