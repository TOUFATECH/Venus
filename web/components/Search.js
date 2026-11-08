'use client';
// Recherche instantanée, en React : titres, titres originaux, acteurs et réalisateurs, genres, années —
// insensible aux accents. Demandes en français (« un film drôle des années 90 »), recherches récentes,
// et titres pas encore dans Venus (à ajouter à ses envies).
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import { useVenus } from './Venus';
import Card from './Card';
import { Icon } from './Icon';
import { openPerson as openPersonSheet } from './Person';

const kindOf = (i) => (i.type === 'clip' ? 'clip' : i.type === 'movie' ? 'movie' : i.category === 'anime' ? 'anime' : 'show');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const KINDS = [['all', 'Tout'], ['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés'], ['clip', 'Clips']];

function Section({ title, children }) {
  return <section className="search-sec"><h2 className="section-title">{title}</h2>{children}</section>;
}

export default function Search() {
  const L = shared();
  const { api, app } = L;
  const { search, tick } = useVenus();
  const [all, setAll] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    app.setTitle('Recherche');
    let dead = false;
    api.api('/api/library').then((d) => { if (!dead) setAll(d); }).catch((e) => { if (!dead) setError(e); }).finally(() => app.hideBoot());
    return () => { dead = true; };
  }, [tick]);
  return (
    <main className="with-nav page-in">
      {error ? <div className="page"><div className="empty"><h2>Impossible d’afficher cette page</h2><p>{error.message}</p></div></div>
        : all ? <SearchView all={all} initial={(search && search.get('q')) || ''} initialKind={(search && search.get('type')) || 'all'} />
          : <div className="page" aria-busy="true"><i className="sk" style={{ width: '100%', height: 56 }} /></div>}
    </main>
  );
}

function SearchView({ all, initial, initialKind }) {
  const L = shared();
  const { api, app, ui } = L;
  const recentKey = `vn_recent_search_${app.state.profile ? app.state.profile.id : 0}`;
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(recentKey)) || []; } catch { return []; } };
  const [recent, setRecent] = useState(getRecent);
  const pushRecent = (q) => {
    const next = [q, ...getRecent().filter((x) => norm(x) !== norm(q))].slice(0, 8);
    try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* */ }
    setRecent(next);
  };
  const [raw, setRaw] = useState(initial);
  const [kind, setKind] = useState(initialKind);
  const q = norm(useDeferredValue(raw));
  const input = useRef(null);
  useEffect(() => { const t = setTimeout(() => input.current && input.current.focus(), 50); return () => clearTimeout(t); }, []);

  const index = useMemo(() => all.map((i) => ({ i, t: norm(i.title), o: norm(i.originalTitle), g: (i.genres || []).map(norm), p: (i.people || []).map((n) => [n, norm(n)]), y: String(i.year || '') })), [all]);
  const genres = useMemo(() => [...new Set(all.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'fr')), [all]);
  const people = useMemo(() => [...new Set(all.flatMap((i) => i.people || []))], [all]);
  const keep = (list) => (kind === 'all' ? list : list.filter((i) => kindOf(i) === kind));
  const has = (k) => k === 'all' || all.some((i) => kindOf(i) === k);

  // Titres pas encore dans Venus : recherche en ligne après une courte pause de frappe
  const [online, setOnline] = useState(null);
  const [smartMod, setSmartMod] = useState(null);
  useEffect(() => { L.imp('views/search.js').then(setSmartMod).catch(() => {}); }, []);
  useEffect(() => {
    setOnline(null);
    if (q.length < 2) return undefined;
    let dead = false;
    const t = setTimeout(() => {
      api.api(`/api/search/online?q=${encodeURIComponent(raw.trim())}`).then((r) => { if (!dead && r.available && r.items.length) setOnline(r.items); }).catch(() => {});
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);

  const result = useMemo(() => {
    if (!q) return null;
    const words = q.split(' ');
    const persons = new Map();
    const scored = index.map((x) => {
      let s = 0;
      for (const w of words) {
        if (x.t === q) s += 10;
        if (x.t.startsWith(w)) s += 4; else if (x.t.includes(` ${w}`)) s += 3; else if (x.t.includes(w)) s += 2;
        else if (x.o.includes(w)) s += 2;
        else if (x.y === w) s += 2;
        else if (x.g.some((g) => g.startsWith(w))) s += 1.5;
        else if (x.p.some(([, n]) => n.split(' ').some((part) => part.startsWith(w)))) s += 1.2;
        else return null;
      }
      for (const [name, n] of x.p) if (words.every((w) => n.split(' ').some((part) => part.startsWith(w)))) persons.set(name, (persons.get(name) || 0) + 1);
      return { i: x.i, s };
    }).filter(Boolean).sort((a, b) => b.s - a.s || (b.i.year || 0) - (a.i.year || 0)).map((x) => x.i).filter((i) => kind === 'all' || kindOf(i) === kind);
    const smart = smartMod && smartMod.understand ? smartMod.understand(q, { genres, people }) : null;
    if (smart && smart.terms.length >= 1 && words.length >= 2) {
      return { smart, hits: keep(all.filter(smart.test)).sort((a, b) => (b.vote || 0) - (a.vote || 0) || (b.year || 0) - (a.year || 0)) };
    }
    return { scored, persons: [...persons].sort((a, b) => b[1] - a[1]).slice(0, 8), genreHits: genres.filter((g) => norm(g).startsWith(q)) };
  }, [q, kind, index, smartMod]);

  const openPerson = (name) => { pushRecent(name); openPersonSheet({ name }); };
  const remember = (e) => { if (e.target.closest('.card') && raw.trim()) pushRecent(raw.trim()); };

  let body;
  if (!result) {
    const recentAdded = keep([...all]).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 18);
    body = <>
      {recent.length ? (
        <Section title="Recherches récentes">
          <div className="chips">
            {recent.map((r) => <button key={r} className="chip small f" onClick={() => setRaw(r)}><Icon name="restart" />{r}</button>)}
            <button className="linkish f" onClick={() => { try { localStorage.removeItem(recentKey); } catch { /* */ } setRecent([]); }}>Effacer</button>
          </div>
        </Section>
      ) : null}
      {genres.length ? (
        <Section title="Parcourir par genre">
          <div className="genre-tiles">{genres.map((g, k) => <button key={g} className="genre-tile f" style={{ '--h': (k * 47) % 360 }} onClick={() => setRaw(g)}>{g}</button>)}</div>
        </Section>
      ) : null}
      <Section title="Ajouts récents"><div className="grid">{recentAdded.map((i) => <Card key={i.id} item={i} poster />)}</div></Section>
    </>;
  } else if (result.smart) {
    body = (
      <Section title="Pour cette demande">
        <div className="chips" style={{ marginBottom: 10 }}>{result.smart.terms.map((t) => <span key={t} className="chip small on">{t}</span>)}</div>
        {result.hits.length ? <div className="grid">{result.hits.slice(0, 40).map((i) => <Card key={i.id} item={i} poster />)}</div>
          : <p className="grid-empty">Rien ne correspond à tout ça. Enlevez un critère.</p>}
      </Section>
    );
  } else {
    body = <>
      {result.persons.length ? (
        <Section title="Personnes">
          <div className="people-hits">
            {result.persons.map(([name, n]) => (
              <button key={name} className="person-hit f" onClick={() => openPerson(name)}>
                <span className="ph-ini">{name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <span><b>{name}</b><small>{`${n} titre${n > 1 ? 's' : ''} dans Venus`}</small></span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}
      {result.genreHits.length ? <div className="chips" style={{ marginBottom: 8 }}>{result.genreHits.map((g) => <button key={g} className="chip small f" onClick={() => app.go(`/films?genre=${encodeURIComponent(g)}`)}>{`Genre : ${g}`}</button>)}</div> : null}
      <Section title={result.scored.length ? `Dans Venus · ${result.scored.length}` : 'Dans Venus'}>
        {result.scored.length ? <div className="grid">{result.scored.slice(0, 60).map((i) => <Card key={i.id} item={i} poster />)}</div>
          : <p className="grid-empty">Rien dans votre médiathèque pour cette recherche.</p>}
      </Section>
      <div className="online-hits">
        {online ? <Section title="Pas encore dans Venus"><div className="grid">{online.map((x) => <OnlineCard key={`${x.type}-${x.tmdbId}`} x={x} />)}</div></Section> : null}
      </div>
    </>;
  }

  return (
    <div className="page">
      <div className="search-box">
        <Icon name="search" />
        <input ref={input} type="search" placeholder="Titre, acteur, genre, année…" aria-label="Rechercher" autoComplete="off" enterKeyHint="search" data-autofocus="true"
          value={raw} onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && raw.trim()) { pushRecent(raw.trim()); e.currentTarget.blur(); } }} />
        <button className="search-clear f" type="button" aria-label="Effacer" hidden={!raw} onClick={() => { setRaw(''); input.current && input.current.focus(); }}><Icon name="close" /></button>
      </div>
      <div className="seg search-kinds" role="group" aria-label="Type">
        {KINDS.filter(([k]) => has(k)).map(([k, l]) => <button key={k} className={`seg-b f${kind === k ? ' on' : ''}`} aria-pressed={String(kind === k)} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div className="search-body" onClickCapture={remember}>{body}</div>
    </div>
  );
}

// Titre pas encore dans Venus : ♡ l'ajoute à mes envies (demandé à Seerr)
function OnlineCard({ x }) {
  const { api, ui, app } = shared();
  const [state, setState] = useState('idle');
  const wish = async (e) => {
    e.stopPropagation();
    setState('busy');
    try {
      const r = await api.api('/api/wishlist', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title, original: x.original, poster: x.poster, backdrop: x.backdrop, date: x.date, overview: x.overview, anime: !!x.anime } });
      setState('on');
      ui.toast(r.auto ? `« ${x.title} » est dans vos envies et demandé à Seerr` : `« ${x.title} » est dans vos envies`, { type: 'success', action: { label: 'Mes envies', onClick: () => app.go('/liste?vue=envies') } });
    } catch (err) { ui.toast(err.message, true); setState('idle'); }
  };
  return (
    <div className="card poster online-card">
      <div className="shot">
        {x.poster ? <img src={x.poster} alt="" loading="lazy" /> : <div className="ph">{x.title}</div>}
        <button className={`oc-wish f${state === 'on' ? ' on' : ''}`} disabled={state !== 'idle'} aria-label={`Ajouter ${x.title} à mes envies`} title="Ajouter à mes envies (demandé à Seerr)" onClick={wish}><Icon name="heart" /></button>
        <span className="oc-tag">{x.type === 'movie' ? 'Film' : x.anime ? 'Animé' : 'Série'}</span>
      </div>
      <div className="cap"><b>{x.title}</b><span>{[x.date ? x.date.slice(0, 4) : null, x.score ? `★ ${(x.score / 10).toFixed(1).replace('.', ',')}` : null].filter(Boolean).join(' · ')}</span></div>
    </div>
  );
}
