'use client';
// Recherche universelle : Ctrl+K (⌘K sur Mac), Y / Triangle à la manette, ou le micro.
// On tape quelques lettres : titres, chaînes, acteurs et réalisateurs, pages et réglages, dans une seule liste ;
// flèches haut / bas pour choisir, Entrée pour ouvrir, Échap pour fermer. Le micro accepte des commandes
// (« Mets One Piece », « Chaîne 12 », « Pause »…).
import { useEffect, useMemo, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import { Icon } from './Icon';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const SETTINGS = [['profil', 'Mon profil'], ['appareil', 'Cet appareil (lecture, sous-titres)'], ['affichage', 'Thème et menu'], ['medias', 'Médiathèques', true], ['tv', 'TV en direct (listes, chaînes du monde)', true],
  ['infos', 'Infos et affiches (clé TMDB)', true], ['notes', 'Notes des sites (Trakt)', true], ['demandes', 'Demandes (Radarr, Sonarr)', true], ['famille', 'Profils et appareils', true], ['alertes', 'Notifications', true],
  ['lecture', 'Lecture et conversion', true], ['maj', 'Mise à jour', true], ['sauvegardes', 'Sauvegardes', true]];
const KIND = { movie: 'Film', show: 'Série', anime: 'Animé', clip: 'Clip', channel: 'Chaîne', person: 'Personne', page: 'Page', setting: 'Réglage', action: 'Action' };

export default function Palette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((o) => !o); }
    };
    const ask = () => setOpen(true);
    document.addEventListener('keydown', key);
    window.addEventListener('vn:palette', ask);
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('vn:palette', ask); };
  }, []);
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('vn:navigate', close); return () => window.removeEventListener('vn:navigate', close); }, []);
  return open ? <PaletteBox close={() => setOpen(false)} /> : null;
}

function PaletteBox({ close }) {
  const L = shared();
  const { app, api, menu } = L;
  const p = app.state.profile;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [titles, setTitles] = useState([]);
  const [chans, setChans] = useState([]);
  const [voice, setVoice] = useState(null); // { text, live }
  const input = useRef(null);
  const listRef = useRef(null);
  const stopRef = useRef(null);
  const [voiceMod, setVoiceMod] = useState(null);
  useEffect(() => {
    input.current && input.current.focus();
    api.api('/api/library').then(setTitles).catch(() => {});
    if (app.hasCat('channel')) api.api('/api/library?type=channel').then(setChans).catch(() => {});
    L.imp('voice.js').then(setVoiceMod).catch(() => {});
    return () => stopRef.current && stopRef.current();
  }, []);

  const go = (path) => { close(); app.go(path); };
  const channelPath = (c) => c.path || `/tv/${c.number || ''}-${c.slug || c.id}`;
  const statics = useMemo(() => {
    const out = [];
    const m = menu.menuItems(p, app.hasCat);
    for (const it of [...m.shown, ...m.more]) {
      if (!it || !it.href) continue;
      const label = typeof it.label === 'function' ? it.label() : it.label;
      out.push({ kind: 'page', label, sub: it.hint || '', icon: typeof it.icon === 'function' ? it.icon() : it.icon, run: () => go(it.href) });
    }
    out.push({ kind: 'page', label: 'Multi-écran (TV)', sub: '2 ou 4 chaînes en même temps', icon: 'multi', run: () => go('/tv?vue=multi') });
    out.push({ kind: 'page', label: 'Guide des programmes', sub: 'TV en direct', icon: 'cal', run: () => go('/tv?vue=guide') });
    out.push({ kind: 'page', label: 'Ma rétrospective de l’année', sub: 'Vos films, séries et animés de l’année', icon: 'spark', run: () => go('/retrospective') });
    if (!p.isKids) for (const [k, l, admin] of SETTINGS) if (!admin || p.isAdmin) out.push({ kind: 'setting', label: `Réglages : ${l}`, icon: 'gear', run: () => go(`/reglages?onglet=${k}`) });
    out.push({ kind: 'action', label: 'Changer de profil', icon: 'people', run: () => { close(); app.switchProfile(); } });
    return out;
  }, [p.id]);

  const results = useMemo(() => {
    const n = norm(q);
    if (!n) return statics.slice(0, 8);
    const words = n.split(' ');
    const match = (t) => { const x = norm(t); return words.every((w) => x.includes(w)) ? (x.startsWith(n) ? 3 : x.split(' ').some((w) => w.startsWith(words[0])) ? 2 : 1) : 0; };
    const out = [];
    for (const i of titles) {
      const s = Math.max(match(i.title), match(i.originalTitle) * 0.9);
      if (s) out.push({ s: s + 0.5, kind: i.type === 'show' && i.category === 'anime' ? 'anime' : i.type, label: i.title, sub: [i.year, (i.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '), poster: i.poster, run: () => go(i.path || `/titre/${i.id}`) });
    }
    for (const c of chans) { const s = Math.max(match(c.title), String(c.number) === n ? 4 : 0); if (s && !c.down) out.push({ s: s + 0.3, kind: 'channel', label: c.title, sub: `${c.number ? `Chaîne ${c.number} · ` : ''}${c.cat || c.group || 'TV en direct'}`, icon: 'live', run: () => go(channelPath(c)) }); }
    const people = new Map();
    for (const i of titles) for (const name of i.people || []) { if (!people.has(name)) { const s = match(name); if (s) people.set(name, s); } }
    for (const [name, s] of [...people].sort((a, b) => b[1] - a[1]).slice(0, 4)) out.push({ s, kind: 'person', label: name, sub: 'Films et séries avec cette personne', icon: 'people', run: () => go(`/recherche?q=${encodeURIComponent(name)}`) });
    for (const x of statics) { const s = match(x.label) || match(x.sub); if (s) out.push({ ...x, s: s - 0.2 }); }
    out.sort((a, b) => b.s - a.s);
    const top = out.slice(0, 12);
    top.push({ kind: 'action', label: `Rechercher « ${q.trim()} » partout`, icon: 'search', run: () => go(`/recherche?q=${encodeURIComponent(q.trim())}`) });
    return top;
  }, [q, titles, chans, statics]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const r = results[sel]; if (r) r.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };

  const mic = () => {
    if (!voiceMod) return;
    if (voice && voice.live) { stopRef.current && stopRef.current(); return; }
    if (!voiceMod.voiceSupported()) { L.ui.toast('La commande vocale n’est pas disponible dans ce navigateur : essayez Chrome, Edge ou Safari (ordinateur ou téléphone).', true); return; }
    setVoice({ text: '', live: true });
    stopRef.current = voiceMod.listen({
      onText: (text, done) => { setVoice({ text, live: !done }); if (!done) setQ(text); },
      onError: (e) => { setVoice(null); L.ui.toast(e.message, true); },
      onEnd: async (text) => {
        setVoice(null);
        if (!text) return;
        const r = await voiceMod.runVoice(text, { go: (path) => go(path), playPath: (id) => L.components.playPath(id), channelPath });
        if (r.ok) { L.ui.toast(r.message, { type: 'success' }); close(); }
        else { setQ(r.search || text); if (r.message) L.ui.toast(r.message); }
      },
    });
  };

  return (
    <div className="palette-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche universelle">
        <div className="pal-top">
          <Icon name="search" />
          <input ref={input} className="pal-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Un film, une chaîne, un acteur, un réglage…"
            role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={results[sel] ? `pal-${sel}` : undefined} aria-label="Rechercher partout" autoComplete="off" spellCheck={false} />
          <button className={`pal-mic f${voice && voice.live ? ' on' : ''}`} type="button" aria-label={voice && voice.live ? 'Arrêter l’écoute' : 'Commande vocale'} title="Commande vocale : « Mets One Piece », « Chaîne 12 », « Pause »…" onClick={mic}><Icon name="mic" /></button>
          <kbd className="pal-esc" aria-hidden="true">Échap</kbd>
        </div>
        {voice ? <div className="pal-voice" aria-live="polite"><span className="pal-wave" aria-hidden="true"><i /><i /><i /><i /></span>{voice.text || 'Je vous écoute… (« Mets One Piece », « Chaîne 12 », « Pause »)'}</div> : null}
        <ul className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.label}-${i}`} id={`pal-${i}`} role="option" aria-selected={String(i === sel)} className={`pal-item${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => r.run()}>
              <span className="pal-ic">{r.poster ? <img src={L.ui.img(r.poster, 92)} alt="" loading="lazy" /> : <Icon name={r.icon || 'spark'} />}</span>
              <span className="pal-txt"><b>{r.label}</b>{r.sub ? <small>{r.sub}</small> : null}</span>
              <span className="pal-kind">{KIND[r.kind] || ''}</span>
            </li>
          ))}
        </ul>
        <div className="pal-help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ouvrir / fermer</span></div>
      </div>
    </div>
  );
}
