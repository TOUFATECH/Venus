'use client';
// Films, Séries, Animés, Clips, Ma liste — en React.
// Barre d'outils : visionnage, tri (et son sens), filtres, affichage (affiches, vignettes, liste), au hasard.
// Onglets « À venir » (Films, Séries, Animés) et « Mes envies » (Ma liste) : voir pages/Upcoming.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shared } from '../lib/shared';
import { useVenus } from './Venus';
import Card, { Picture, FramePoster } from './Card';
import { Icon } from './Icon';
import Upcoming, { Wishes } from './pages/Upcoming';

const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips', mylist: 'Ma liste' };
const PATHS = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips', mylist: '/liste' };
const rel = (i) => i.released || (i.year ? `${i.year}-01-01` : '');
const cmpTitle = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true });
const norm = (i, src) => {
  const r = i.ratings || {};
  if (!src) return r.score || (i.vote ? i.vote * 10 : 0);
  const x = r[src];
  return x && x.v ? (x.v / x.max) * 100 : -1;
};
// [id, libellé, comparaison (ordre naturel), libellés du sens]
const SORTS = [
  ['added', 'Date d’ajout', (a, b) => (b.added || 0) - (a.added || 0), ['Plus récents', 'Plus anciens']],
  ['az', 'Titre', cmpTitle, ['A → Z', 'Z → A']],
  ['released', 'Date de sortie', (a, b) => rel(b).localeCompare(rel(a)), ['Plus récents', 'Plus anciens']],
  ['score', 'Note moyenne', (a, b) => norm(b) - norm(a), ['Mieux notés', 'Moins bien notés']],
  ['played', 'Date de lecture', (a, b) => (b.played || 0) - (a.played || 0), ['Vus récemment', 'Vus il y a longtemps']],
  ['popular', 'Popularité', (a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.vote || 0) - (a.vote || 0), ['Plus populaires', 'Moins populaires']],
  ['runtime', 'Durée', (a, b) => (a.runtime || 1e9) - (b.runtime || 1e9), ['Plus courts', 'Plus longs']],
  ['age', 'Classification', (a, b) => (a.age ?? 99) - (b.age ?? 99), ['Tous publics d’abord', 'Adultes d’abord']],
  ['random', 'Aléatoire', null, ['Nouveau tirage', 'Nouveau tirage']],
];
const STATUS = [['all', 'Tous'], ['unseen', 'Non vus'], ['progress', 'En cours'], ['seen', 'Vus']];
const AGES = [['0', 'Tous publics', (a) => a == null || a <= 7], ['10', '10 ans et plus', (a) => a === 10], ['12', '12 ans et plus', (a) => a === 12], ['16', '16 ans et plus', (a) => a === 16], ['18', '18 ans et plus', (a) => a >= 18]];
const QUALITY = [['4K', '4K', (i) => i.res === '4K'], ['HDR', 'HDR', (i) => i.hdr], ['1080p', 'Full HD', (i) => i.res === '1080p'], ['SD', 'Basse définition', (i) => i.res === 'SD' || i.res === '720p']];
const SCORES = [['60', '6 et plus'], ['70', '7 et plus'], ['80', '8 et plus']];
const VIEWS = [['poster', 'Affiches', 'grid4'], ['wide', 'Vignettes', 'film'], ['list', 'Liste', 'rows']];
const EMPTY = { genres: [], decades: [], ages: [], quality: [], studios: [], minScore: '' };

const store = {
  get(k, d, ls = false) { try { return JSON.parse((ls ? localStorage : sessionStorage).getItem(k)) ?? d; } catch { return d; } },
  set(k, v, ls = false) { try { (ls ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
const shuffleSeed = (n) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export default function Browse({ kind }) {
  const { search } = useVenus();
  const vue = search ? search.get('vue') : null;
  const upcomingTab = (kind === 'show' || kind === 'anime' || kind === 'movie') && vue === 'avenir';
  const wishTab = kind === 'mylist' && vue === 'envies';
  const { app } = shared();
  useEffect(() => { app.setTitle(TITLES[kind]); }, [kind]);

  const tab = (on, label, path) => (
    <button key={label} className={`vt f${on ? ' on' : ''}`} role="tab" aria-selected={String(on)} onClick={() => app.go(path, { replace: true })}>{label}</button>
  );
  const tabs = kind === 'show' || kind === 'anime' || kind === 'movie'
    ? <div className="view-tabs" role="tablist">{tab(!upcomingTab, 'Bibliothèque', PATHS[kind])}{tab(upcomingTab, 'À venir', `${PATHS[kind]}?vue=avenir`)}</div>
    : kind === 'mylist'
      ? <div className="view-tabs" role="tablist">{tab(!wishTab, 'Dans Venus', PATHS.mylist)}{tab(wishTab, 'Mes envies', `${PATHS.mylist}?vue=envies`)}</div>
      : null;

  return (
    <main className="with-nav page-in">
      {upcomingTab ? <Upcoming kind={kind} tabs={tabs} /> : wishTab ? <Wishes tabs={tabs} /> : <Library kind={kind} tabs={tabs} />}
    </main>
  );
}

function Library({ kind, tabs }) {
  const L = shared();
  const { api, app, ui, components, queue: Q } = L;
  const isClip = kind === 'clip';
  const key = `vn_filters_${kind}`;
  const { search, tick } = useVenus();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let dead = false;
    (kind === 'mylist' ? api.api('/api/mylist') : api.api(`/api/library?type=${kind}`))
      .then((d) => { if (!dead) setItems(d); })
      .catch((e) => { if (!dead) setError(e); })
      .finally(() => app.hideBoot());
    return () => { dead = true; };
  }, [kind, tick]);

  if (error) return <div className="page"><div className="empty"><h2>Impossible d’afficher cette page</h2><p>{error.message}</p></div></div>;
  if (!items) return <SkeletonGrid />;
  return <LibraryView kind={kind} items={items} tabs={tabs} wantGenre={search ? search.get('genre') : null} storeKey={key} />;
}

function SkeletonGrid() {
  return (
    <div className="page" aria-busy="true" aria-label="Chargement">
      <i className="sk" style={{ width: 220, height: 48 }} />
      <div className="sk-chips"><i className="sk" style={{ width: 80, height: 38 }} /><i className="sk" style={{ width: 90, height: 38 }} /><i className="sk" style={{ width: 90, height: 38 }} /></div>
      <div className="sk-grid">{Array.from({ length: 14 }, (_, i) => <i key={i} className="sk" />)}</div>
    </div>
  );
}

function LibraryView({ kind, items, tabs, wantGenre, storeKey }) {
  const L = shared();
  const { app, components, queue: Q } = L;
  const isClip = kind === 'clip';

  const sorts = useMemo(() => [...SORTS, ...components.RATING_SOURCES.filter(([k]) => items.some((i) => i.ratings && i.ratings[k]))
    .map(([k, label]) => [`r-${k}`, `Note ${label}`, (a, b) => norm(b, k) - norm(a, k), ['Mieux notés', 'Moins bien notés']])]
    .filter(([id]) => !isClip || ['added', 'az', 'played', 'runtime', 'random'].includes(id))
    .filter(([id]) => id !== 'played' || items.some((i) => i.played))
    .filter(([id]) => id !== 'age' || items.some((i) => i.age != null)), [items, isClip]);

  const [f, setF] = useState(() => {
    const x = { sort: kind === 'mylist' ? 'mine' : 'added', desc: false, status: 'all', ...EMPTY, ...store.get(storeKey, {}) };
    if (typeof x.genre === 'string') { x.genres = x.genre ? [x.genre] : []; delete x.genre; }
    if (x.sort === 'vote') x.sort = 'score';
    if (x.sort !== 'mine' && !sorts.some((s) => s[0] === x.sort)) x.sort = 'added';
    if (wantGenre) Object.assign(x, EMPTY, { genres: [wantGenre], status: 'all' });
    return x;
  });
  const [view, setView] = useState(() => store.get(`vn_view_${kind}`, isClip ? 'wide' : 'poster', true));
  const [order, setOrder] = useState(() => shuffleSeed(items.length));
  const update = useCallback((patch) => setF((old) => { const n = { ...old, ...(typeof patch === 'function' ? patch(old) : patch) }; store.set(storeKey, n); return n; }), [storeKey]);

  // Valeurs proposées dans les filtres, d'après ce qu'il y a vraiment dans la médiathèque
  const facets = useMemo(() => {
    const studioCount = new Map();
    for (const i of items) for (const s of i.studios || []) studioCount.set(s, (studioCount.get(s) || 0) + 1);
    return {
      genres: [...new Set(items.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'fr')),
      decades: [...new Set(items.filter((i) => i.year).map((i) => Math.floor(i.year / 10) * 10))].sort((a, b) => b - a),
      ages: AGES.filter(([, , test]) => items.some((i) => i.age != null && test(i.age))),
      quality: QUALITY.filter(([, , test]) => items.some(test)),
      studios: [...studioCount].filter(([, n]) => n > 1 || studioCount.size < 16).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([s]) => s),
      hasScores: items.some((i) => norm(i) > 0),
    };
  }, [items]);

  const filtersOn = f.genres.length + f.decades.length + f.ages.length + f.quality.length + f.studios.length + (f.minScore ? 1 : 0);
  const shown = useMemo(() => {
    const match = (i) => (f.status === 'all' || i.status === f.status)
      && (!f.genres.length || (i.genres || []).some((g) => f.genres.includes(g)))
      && (!f.decades.length || (i.year && f.decades.includes(Math.floor(i.year / 10) * 10)))
      && (!f.ages.length || AGES.some(([id, , test]) => f.ages.includes(id) && test(i.age)))
      && (!f.quality.length || QUALITY.some(([id, , test]) => f.quality.includes(id) && test(i)))
      && (!f.studios.length || (i.studios || []).some((s) => f.studios.includes(s)))
      && (!f.minScore || norm(i) >= Number(f.minScore));
    const list = items.filter(match);
    if (f.sort === 'random') { const pos = new Map(items.map((it, k) => [it.id, order[k]])); list.sort((a, b) => pos.get(a.id) - pos.get(b.id)); }
    else if (f.sort !== 'mine') list.sort(sorts.find((s) => s[0] === f.sort)[2]);
    if (f.desc && f.sort !== 'random') list.reverse();
    return list;
  }, [items, f, order, sorts]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Grandes médiathèques : d'abord ce qui tient à l'écran, le reste par paquets en approchant du bas
  const [limit, setLimit] = useState(72);
  const sentinel = useRef(null);
  useEffect(() => { setLimit(72); }, [f, view]);
  useEffect(() => {
    if (limit >= shown.length || !sentinel.current) return undefined;
    const obs = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) setLimit((n) => n + 72); }, { rootMargin: '1200px 0px' });
    obs.observe(sentinel.current);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const h = idle(() => setLimit((n) => n + 72), { timeout: 1500 });
    return () => { obs.disconnect(); cancel(h); };
  }, [limit, shown.length]);

  const resetFilters = () => update(EMPTY);
  const resetAll = () => update({ ...EMPTY, status: 'all' });
  const word = isClip ? 'clip' : 'titre';
  const s = f.sort === 'mine' ? null : sorts.find((x) => x[0] === f.sort);
  const sortBtn = useRef(null);
  const filterBtn = useRef(null);
  const [menu, setMenu] = useState(null); // 'sort' | 'filter'

  const randomOpen = () => {
    if (!shown.length) return;
    const pick = shown[Math.floor(Math.random() * shown.length)];
    app.go(isClip ? components.playPath(pick.id) : `/titre/${pick.id}`);
  };
  const playAll = (shuffle) => { const q = Q.setQueue(shown, { shuffle, title: 'Clips' }); if (q) app.go(components.playPath(q.id)); };

  // Filtres actifs : petites étiquettes qu'on retire d'un clic
  const tags = [];
  const tag = (label, remove) => tags.push(<button key={`${tags.length}-${label}`} className="af f" aria-label={`Retirer le filtre ${label}`} onClick={() => update(remove)}>{label}<Icon name="close" /></button>);
  for (const g of f.genres) tag(g, (o) => ({ genres: o.genres.filter((x) => x !== g) }));
  for (const d of f.decades) tag(`Années ${String(d).slice(2)}`, (o) => ({ decades: o.decades.filter((x) => x !== d) }));
  for (const a of f.ages) tag(AGES.find((x) => x[0] === a)[1], (o) => ({ ages: o.ages.filter((x) => x !== a) }));
  for (const q of f.quality) tag(QUALITY.find((x) => x[0] === q)[1], (o) => ({ quality: o.quality.filter((x) => x !== q) }));
  for (const st of f.studios) tag(st, (o) => ({ studios: o.studios.filter((x) => x !== st) }));
  if (f.minScore) tag(`Note ${SCORES.find((x) => x[0] === f.minScore)[1]}`, { minScore: '' });
  if (tags.length > 1) tags.push(<button key="clear" className="linkish f" onClick={resetFilters}>Tout effacer</button>);

  const gridCls = `grid view-${view}${isClip && view !== 'list' ? ' grid-wide' : ''}${view === 'wide' ? ' grid-wide' : ''}`;
  const visible = shown.slice(0, limit);

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-left">
          <h1>{TITLES[kind]}</h1>
          <p className="count" aria-live="polite">{`${shown.length}${shown.length !== items.length ? ` sur ${items.length}` : ''} ${word}${items.length > 1 ? 's' : ''}`}</p>
        </div>
        {tabs || (isClip
          ? <div className="actions play-all" hidden={shown.length < 1}>
              <button className="btn btn-play btn-small f" onClick={() => playAll(false)}><Icon name="play" />Tout lire</button>
              <button className="btn btn-ghost btn-small f" onClick={() => playAll(true)}><Icon name="shuffle" />Aléatoire</button>
            </div>
          : null)}
      </div>
      {kind === 'mylist' ? <p className="list-hint">Les séries de votre liste sont suivies : chaque nouvelle saison annoncée est demandée à Seerr automatiquement.</p> : null}
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filtrer par visionnage">
          {STATUS.map(([id, label]) => <button key={id} className={`seg-b f${f.status === id ? ' on' : ''}`} aria-pressed={String(f.status === id)} onClick={() => update({ status: id })}>{label}</button>)}
        </div>
        <div className="tools">
          <button ref={sortBtn} className="tool f" aria-haspopup="true" aria-expanded={menu === 'sort'} aria-label={`Trier : ${s ? `${s[1]}, ${s[3][f.desc ? 1 : 0]}` : 'ordre de la liste'}`} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
            <Icon name="sort" /><span className="lbl">{s ? s[1] : 'Ordre de la liste'}</span>{f.desc && f.sort !== 'random' ? <small>↑</small> : null}
          </button>
          <button ref={filterBtn} className={`tool f${filtersOn ? ' on' : ''}`} aria-haspopup="true" aria-expanded={menu === 'filter'} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
            <Icon name="filter" /><span className="lbl">Filtres</span>{filtersOn ? <b className="tool-n">{filtersOn}</b> : null}
          </button>
          <div className="seg icons" role="group" aria-label="Affichage">
            {VIEWS.filter(([id]) => !isClip || id !== 'poster').map(([id, label, ic]) => (
              <button key={id} className={`seg-b f${view === id ? ' on' : ''}`} title={label} aria-label={`Affichage : ${label}`} aria-pressed={String(view === id)} onClick={() => { setView(id); store.set(`vn_view_${kind}`, id, true); }}><Icon name={ic} /></button>
            ))}
          </div>
          <button className="tool f" title="Ouvrir un titre au hasard parmi ceux affichés" disabled={!shown.length} onClick={randomOpen}><Icon name="shuffle" /><span className="lbl">Au hasard</span></button>
        </div>
      </div>
      <div className="active-filters" hidden={!tags.length}>{tags}</div>
      <div className={gridCls}>
        {shown.length
          ? visible.map((i) => (view === 'list'
            ? <ListRow key={i.id} item={i} />
            : <Card key={i.id} item={i} poster={view === 'poster' && !isClip} queue={isClip ? () => shownRef.current : null} />))
          : (
            <div className="grid-empty">
              <p>{!items.length
                ? kind === 'mylist' ? 'Votre liste est vide. Ajoutez des titres avec le bouton + sur leur fiche.' : 'Rien ici pour l’instant. Ajoutez une source dans les réglages.'
                : f.status === 'unseen' && !filtersOn ? 'Vous avez tout vu ici. Bravo.' : 'Aucun titre ne correspond à ces filtres.'}</p>
              {items.length && (filtersOn || f.status !== 'all') ? <button className="btn btn-ghost btn-small f" onClick={resetAll}>Tout afficher</button> : null}
            </div>
          )}
      </div>
      {limit < shown.length ? <div ref={sentinel} className="grid-more" aria-hidden="true" /> : null}

      {menu === 'sort' ? (
        <Dropdown anchor={sortBtn} onClose={() => setMenu(null)}>
          {(close) => {
            const opts = (kind === 'mylist' ? [['mine', 'Ordre de la liste', null, ['Ajoutés récemment', 'Ajoutés il y a longtemps']]] : []).concat(sorts);
            const cur = opts.find((x) => x[0] === f.sort) || opts[0];
            return <>
              <p className="dd-title">Trier par</p>
              <div className="dd-list">
                {opts.map(([id, label]) => (
                  <button key={id} className={`dd-opt f${id === f.sort ? ' on' : ''}`} role="menuitemradio" aria-checked={String(id === f.sort)} onClick={() => {
                    if (id === 'random') setOrder(shuffleSeed(items.length));
                    update((o) => ({ sort: id, desc: id !== o.sort ? false : o.desc })); close();
                  }}><Icon name={id === f.sort ? 'check' : 'dot'} />{label}</button>
                ))}
              </div>
              {cur[0] !== 'random'
                ? <div className="dd-seg">{cur[3].map((lbl, k) => <button key={lbl} className={`seg-b f${(k === 1) === !!f.desc ? ' on' : ''}`} onClick={() => { update({ desc: k === 1 }); close(); }}>{lbl}</button>)}</div>
                : null}
            </>;
          }}
        </Dropdown>
      ) : null}

      {menu === 'filter' ? (
        <Dropdown anchor={filterBtn} wide onClose={() => setMenu(null)}>
          {(close) => {
            const group = (title, values, field, labelOf = (v) => v) => (values.length < 2 && !f[field].length ? null : (
              <div className="dd-group" key={field}>
                <p className="dd-title">{title}</p>
                <div className="dd-chips">
                  {values.map((v) => {
                    const id = Array.isArray(v) ? v[0] : v;
                    const on = f[field].includes(id);
                    return <button key={id} className={`mini f${on ? ' on' : ''}`} aria-pressed={String(on)}
                      onClick={() => update((o) => ({ [field]: on ? o[field].filter((x) => x !== id) : [...o[field], id] }))}>{Array.isArray(v) ? v[1] : labelOf(v)}</button>;
                  })}
                </div>
              </div>
            ));
            return <>
              {group('Genres', facets.genres, 'genres')}
              {group('Années', facets.decades, 'decades', (d) => `${d}s`)}
              {facets.hasScores ? (
                <div className="dd-group">
                  <p className="dd-title">Note minimale</p>
                  <div className="dd-chips">{[['', 'Toutes'], ...SCORES].map(([id, label]) => <button key={id || 'all'} className={`mini f${f.minScore === id ? ' on' : ''}`} onClick={() => update({ minScore: id })}>{label}</button>)}</div>
                </div>
              ) : null}
              {group('Classification', facets.ages, 'ages')}
              {group('Qualité', facets.quality, 'quality')}
              {group(kind === 'movie' ? 'Studios' : 'Studios et chaînes', facets.studios, 'studios')}
              <div className="dd-foot">
                <button className="btn btn-ghost btn-small f" onClick={resetFilters}>Réinitialiser</button>
                <button className="btn btn-small f" onClick={close}>Voir les résultats</button>
              </div>
            </>;
          }}
        </Dropdown>
      ) : null}
    </div>
  );
}

// Une ligne de la vue « Liste »
function ListRow({ item: i }) {
  const { ui, components, app } = shared();
  const score = norm(i);
  const p = i.progress;
  const pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const age = ui.ageBadge(i);
  return (
    <div className="lib-row">
      <button className="lr-main f" onClick={() => app.go(i.type === 'clip' ? components.playPath(i.id) : `/titre/${i.id}`)}>
        <div className="lr-pic">{i.poster ? <Picture src={ui.img(i.poster)} title={i.title} /> : <FramePoster item={i} />}</div>
        <div className="lr-text">
          <b>{i.title}</b>
          <span className="lr-meta">
            {[i.year, i.type === 'show' ? `${i.episodes || 0} épisodes` : i.runtime ? ui.fmtRuntime(i.runtime) : null, (i.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
            {age ? <span className={age.className} title={age.title}>{age.textContent}</span> : null}
            {i.res === '4K' ? <span className="badge">4K</span> : null}
            {i.hdr ? <span className="badge">HDR</span> : null}
          </span>
          {i.overview ? <p>{i.overview}</p> : null}
          {pct ? <div className="bar"><i style={{ width: `${pct}%` }} /></div> : null}
        </div>
        {score > 0 ? <span className="lr-score">★ {(score / 10).toFixed(1).replace('.', ',')}</span> : <span />}
        {i.status === 'seen' ? <span className="lr-seen" title="Vu"><Icon name="check" /></span> : <span />}
      </button>
      <button className="btn btn-ghost btn-icon f lr-play" aria-label={`Lire ${i.title}`} onClick={() => app.go(components.playPath(i.id))}><Icon name="play" /></button>
    </div>
  );
}

// Menu déroulant ancré sous un bouton (fermeture : clic à côté, Échap)
function Dropdown({ anchor, wide = false, onClose, children }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const r = anchor.current.getBoundingClientRect();
    const w = Math.min(wide ? 560 : 300, innerWidth - 24);
    setPos({ width: w, left: Math.max(12, Math.min(innerWidth - w - 12, r.right - w)), top: r.bottom + 8, maxHeight: Math.max(220, innerHeight - r.bottom - 24) });
    const onDown = (e) => { if (box.current && !box.current.contains(e.target) && !anchor.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'GoBack' || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current && anchor.current.focus(); } };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      box.current && (box.current.querySelector('.on') || box.current.querySelector('button'))?.focus({ preventScroll: true });
    }, 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, []);
  return createPortal(
    <div ref={box} className={`dropdown${wide ? ' wide' : ''}`} role="menu" style={pos || { visibility: 'hidden' }}>{children(onClose)}</div>,
    document.body,
  );
}
