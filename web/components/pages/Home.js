'use client';
// Accueil : grande affiche « À la une » (bande-annonce, extrait ou reprise de la vidéo), tuiles des sections,
// rappels (« vous regardiez… », affiches manquantes) et rangées. À la télécommande, l'affiche suit la carte choisie.
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, go, api, toast, img, useLayout } from '../../lib/hooks';
import { Avatar } from '../Icon';
import { Row } from '../Row';
import { Icon } from '../Icon';
import { Placeholder } from '../Card';

const ROTATE_MS = 3000; // une affiche toutes les 3 secondes

export default function Home() {
  const { data, error } = useApi('/api/home', { keep: true });
  useTitle(null);
  const heroApi = useRef(null);
  const { layout } = useLayout();
  const [today, setToday] = useState(null);
  useEffect(() => {
    api('/api/today').then((list) => {
      if (!list.length) return;
      const d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      setToday({ id: 'today', title: `Sortis un ${d}`, hint: list.map((x) => `${x.title} : il y a ${x.yearsAgo} an${x.yearsAgo > 1 ? 's' : ''}`).slice(0, 3).join(' · '), items: list });
    }).catch(() => {});
  }, []);
  if (error) return <main className="with-nav"><div className="page"><div className="empty"><h2>Impossible d’afficher l’accueil</h2><p>{error.message}</p></div></div></main>;
  if (!data) return <main className="with-nav"><HomeSkeleton /></main>;
  if (data.empty) return <main className="with-nav"><Empty data={data} /></main>;
  // À la télécommande, la carte sélectionnée éclaire l'affiche
  const onFocus = (item) => { if (item.type !== 'episode' && document.documentElement.classList.contains('keys') && heroApi.current) heroApi.current.spot(item); };
  const lagon = layout === 'lagon';
  return (
    <main className="with-nav home page-in">
      {lagon
        ? <div className="ce-soir">{data.hero.length ? <Hero items={data.hero} apiRef={heroApi} /> : <div className="hero empty-hero" />}<TonightSide /></div>
        : data.hero.length ? <Hero items={data.hero} apiRef={heroApi} /> : null}
      <SectionStrip />
      <Elsewhere />
      {data.noPosters ? <NoPosters /> : null}
      <div className="rows" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && heroApi.current) heroApi.current.leaveRows(); }}>
        {today ? <Row r={today} onFocus={onFocus} /> : null}
        {data.rows.map((r) => <Row key={r.id || r.title} r={r} onFocus={onFocus} />)}
      </div>
    </main>
  );
}

function HomeSkeleton() {
  const bar = (w, hgt = 14) => <i className="sk" style={{ width: w, height: hgt }} />;
  return (
    <div className="sk-page" aria-busy="true" aria-label="Chargement">
      <div className="sk-hero"><div>{bar('46%', 54)}{bar('28%')}{bar('52%')}{bar('40%')}<div className="sk-actions">{bar(150, 48)}{bar(150, 48)}</div></div></div>
      <div className="sk-rows">{bar(180, 18)}<div className="sk-row land">{Array.from({ length: 6 }, (_, i) => <i key={i} className="sk" />)}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------- affiche « À la une »
function Hero({ items, apiRef }) {
  const L = shared();
  const many = items.length > 1;
  const [idx, setIdx] = useState(0);
  const [bgItem, setBgItem] = useState(items[0]);
  const [layers, setLayers] = useState([]); // fonds déjà chargés (gardés pour un fondu instantané)
  const [paused, setPaused] = useState(false);
  const [swap, setSwap] = useState(0);
  const hero = useRef(null);
  const body = useRef(null);
  const st = useRef({ timer: null, hovering: false, keys: false, shown: null });
  const item = items[idx];
  const S = st.current;

  // Le défilement s'arrête tant que la souris est dessus, qu'on navigue au clavier dans les rangées, ou que l'onglet est caché
  const isPaused = () => S.hovering || S.keys || document.hidden;
  const next = () => setIdx((i) => (i + 1) % items.length);
  const restart = () => {
    clearTimeout(S.timer);
    setPaused(isPaused());
    if (!many || isPaused()) return;
    S.timer = setTimeout(next, ROTATE_MS);
  };

  // Nouvelle affiche à la une : fond, teinte de la page, petite animation du texte
  useEffect(() => {
    const it = items[idx];
    const hadFocus = body.current && body.current.contains(document.activeElement);
    S.shown = it;
    setBgItem(it);
    L.imp('ambiance.js').then((m) => m.tintFrom(img(it.backdrop || it.poster))).catch(() => {});
    setSwap((n) => n + 1);
    restart();
    // L'affiche suivante est chargée à l'avance pour un fondu sans à-coup
    const n = items[(idx + 1) % items.length];
    if (n && n !== it) { const pre = new Image(); pre.src = n.backdrop ? img(n.backdrop, L.ui.bgWidth()) : img(n.poster); if (n.poster) { const pp = new Image(); pp.src = img(n.poster, 342); } }
    if (hadFocus) requestAnimationFrame(() => body.current && body.current.querySelector('.btn-play')?.focus({ preventScroll: true }));
  }, [idx]);

  // Fonds : chaque image chargée reste en place, seule la bonne est visible (fondu)
  useEffect(() => {
    const key = bgItem.backdrop ? bgItem.backdrop : `th:${bgItem.id}`;
    setLayers((l) => (l.some((x) => x.key === key) ? l : [...l, { key, item: bgItem }]));
  }, [bgItem]);
  const activeKey = bgItem.backdrop ? bgItem.backdrop : `th:${bgItem.id}`;
  const [onKey, setOnKey] = useState(null);
  useEffect(() => { const r = requestAnimationFrame(() => setOnKey(activeKey)); return () => cancelAnimationFrame(r); }, [activeKey, layers.length]);

  useEffect(() => {
    const onVis = () => restart();
    document.addEventListener('visibilitychange', onVis);
    apiRef.current = {
      spot: (it) => { S.keys = true; restart(); setBgItem(it); L.imp('ambiance.js').then((m) => m.tintFrom(img(it.backdrop || it.poster || it.still))).catch(() => {}); },
      leaveRows: () => { S.keys = false; restart(); },
    };
    return () => { clearTimeout(S.timer); document.removeEventListener('visibilitychange', onVis); apiRef.current = null; };
  }, []);

  const goTo = (i) => { setIdx((i + items.length) % items.length); };
  // Balayage horizontal au doigt
  const touch = useRef(null);

  return (
    <section ref={hero} className={`hero posters${paused ? ' paused' : ''}`} style={{ '--rotate': `${ROTATE_MS}ms` }}
      onFocus={() => setBgItem(S.shown || item)}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { S.hovering = true; restart(); } }}
      onPointerLeave={() => { S.hovering = false; restart(); }}
      onTouchStart={(e) => { touch.current = [e.touches[0].clientX, e.touches[0].clientY]; }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current[0], dy = e.changedTouches[0].clientY - touch.current[1];
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) goTo(idx + (dx < 0 ? 1 : -1));
        touch.current = null;
      }}>
      <div className="hero-bg">
        {layers.map(({ key, item: it }) => <HeroLayer key={key} item={it} on={key === onKey} />)}
      </div>
      <HeroBody item={item} bodyRef={body} swap={swap} />
      {item.poster ? <button type="button" key={`${item.id}-${swap}`} className="hero-poster f" tabIndex={-1} aria-label={`Fiche de ${item.title}`} onClick={() => go(`/titre/${item.id}`)}><img src={img(item.poster, 342)} alt="" decoding="async" /></button> : null}
      {many ? <button type="button" className="hero-arrow prev" tabIndex={-1} aria-label="Titre précédent" onClick={() => goTo(idx - 1)}><Icon name="back" /></button> : null}
      {many ? <button type="button" className="hero-arrow next" tabIndex={-1} aria-label="Titre suivant" onClick={() => goTo(idx + 1)}><Icon name="fwd" /></button> : null}
      {many ? (
        <div className="hero-dots" role="tablist" aria-label="À la une">
          {items.map((it, i) => <button key={i === idx ? `${it.id}-${swap}-${paused}` : it.id} type="button" role="tab" tabIndex={-1} aria-label={it.title} aria-selected={String(i === idx)} className={i === idx ? 'on' : ''} onClick={() => goTo(i)}><i /></button>)}
        </div>
      ) : null}
    </section>
  );
}

function HeroLayer({ item, on }) {
  const [failed, setFailed] = useState(false);
  const cls = on ? 'on' : '';
  // Fond en haute définition, à la taille de l'écran (jusqu'à 3840 px sur une grande télé)
  if (item.backdrop) return failed ? <Placeholder title={item.title} cls={`ph ${cls}`} /> : <img src={img(item.backdrop, shared().ui.bgWidth())} alt="" className={cls} decoding="async" onError={() => setFailed(true)} />;
  if (item.type === 'channel') return <img src={`/api/channels/${item.id}/preview.jpg`} alt="" className={`ch-snap ${cls}`} />;
  if (failed) return item.poster ? <img src={img(item.poster)} alt="" className={`poster-fill ${cls}`} /> : <Placeholder title={item.title} cls={`ph ${cls}`} />;
  return <img src={`/api/items/${item.id}/thumb?size=big`} alt="" className={cls} decoding="async" onError={() => setFailed(true)} />;
}

async function playItem(item) {
  const { components } = shared();
  if (item.type === 'movie') return go(components.playPath(item.id));
  const d = await api(`/api/items/${item.id}`);
  if (d.nextUp) go(components.playPath(d.nextUp.id));
  else go(`/titre/${item.id}`);
}

function Meta({ item }) {
  const { ui } = shared();
  const age = ui.ageBadge(item);
  const isShow = item.type === 'show';
  return (
    <div className="meta">
      {age ? <span className="badge age">{age.textContent}</span> : null}
      {item.year ? <span>{item.year}</span> : null}
      {item.vote && !(item.ratings && item.ratings.score) ? <span>{`${item.vote.toFixed(1).replace('.', ',')}/10`}</span> : null}
      {item.type === 'movie' && item.runtime ? <span>{ui.fmtRuntime(item.runtime)}</span> : null}
      {isShow ? <span>{item.category === 'anime' ? 'Animé' : 'Série'}</span> : null}
      {item.genres && item.genres.length ? <span>{item.genres.slice(0, 2).join(', ')}</span> : null}
    </div>
  );
}

function HeroBody({ item, bodyRef, swap }) {
  const { components } = shared();
  const ref = bodyRef;
  // Petite animation d'arrivée à chaque changement de titre
  useEffect(() => { const b = ref.current; if (!b) return; b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap'); }, [swap]);
  if (item.heroResume) {
    const isEp = item.type === 'episode', live = item.type === 'channel';
    const p = item.progress;
    const pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const left = p && p.duration && !p.watched ? Math.max(1, Math.round((p.duration - p.position) / 60)) : 0;
    const title = isEp ? item.showTitle || item.title : item.title;
    const ghost = (ic, label, to) => <button className="btn btn-ghost f" aria-label={label} onClick={() => go(to)}><Icon name={ic} /><span className="lbl">{label}</span></button>;
    return (
      <div className="hero-body resume" ref={ref}>
        <div className="hero-kicker">{live ? <span className="live-dot">Direct</span> : <Icon name="restart" />}{live ? 'Votre dernière chaîne' : item.next ? 'À suivre' : item.progress && item.progress.asleep ? 'Vous vous étiez endormi ici' : 'Reprendre là où vous en étiez'}</div>
        {item.logo && !live ? <img className="hero-logo" src={img(item.logo)} alt={title} /> : <h1 className="hero-title">{title}</h1>}
        {isEp ? <a className="hero-ep f" href={`/titre/${item.showId}?ep=${item.id}`} onClick={(e) => { e.preventDefault(); go(`/titre/${item.showId}?ep=${item.id}`); }}>{`S${item.season}:É${item.episode} - ${item.title}`}</a> : null}
        {pct ? <div className="hero-progress"><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{`${left} min restantes`}</span></div> : null}
        {item.overview && !live ? <p className="hero-overview">{item.overview}</p> : null}
        <div className="actions">
          <button className="btn btn-play f" data-autofocus="true" onClick={() => go(components.playPath(item.id, item.next ? 0 : undefined))}>
            <Icon name="play" />{live ? 'Regarder' : item.next ? `Lire S${item.season} É${item.episode}` : pct ? 'Reprendre' : 'Lecture'}
          </button>
          {live ? ghost('tv', 'Toutes les chaînes', '/tv') : isEp ? ghost('info', 'Voir l’épisode', `/titre/${item.showId}?ep=${item.id}`) : ghost('info', 'Plus d’infos', `/titre/${item.id}`)}
        </div>
      </div>
    );
  }
  return (
    <div className="hero-body" ref={ref}>
      {item.heroTag ? <div className="hero-kicker"><Icon name="spark" />{item.heroTag}</div> : null}
      {item.logo ? <img className="hero-logo" src={img(item.logo)} alt={item.title} /> : <h1 className="hero-title">{item.title}</h1>}
      <Meta item={item} />
      {item.overview ? <p className="hero-overview">{item.overview}</p> : null}
      <div className="actions">
        <button className="btn btn-play f" data-autofocus="true" onClick={() => playItem(item)}><Icon name="play" />Lecture</button>
        <button className="btn btn-ghost f" aria-label="Plus d’infos" onClick={() => go(`/titre/${item.id}`)}><Icon name="info" /><span className="lbl">Plus d’infos</span></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tuiles, rappels, médiathèque vide
function SectionStrip() {
  const { app, menu } = shared();
  const all = menu.sections(app.state.profile, app.hasCat, app.state.categories || {});
  const list = ['today', 'new', 'mylist', 'collections', 'tv', 'clips'].map((id) => all.find((x) => x.id === id)).filter(Boolean).slice(0, 3);
  return (
    <nav className="home-sections" aria-label="Sections">
      <div className="hs-track">
        {list.map((it) => (
          <a key={it.id} className={`hs-tile f hs-${it.id}`} href={it.href}>
            <span className="hs-ic"><Icon name={it.icon} /></span>
            <span className="hs-txt"><b>{it.label}</b>{it.sub ? <small>{it.sub}</small> : null}</span>
          </a>
        ))}
        <button className="hs-tile hs-all f" onClick={() => app.openAll()}>
          <span className="hs-ic"><Icon name="apps" /></span><span className="hs-txt"><b>Tout</b><small>Toutes les sections</small></span>
        </button>
      </div>
    </nav>
  );
}

// « Vous regardiez X sur la télé il y a 2 min » : reprise au même endroit sur cet appareil
function Elsewhere() {
  const { app, components } = shared();
  const e = app.state.status && app.state.status.elsewhere;
  if (!e || e.duration < 60) return null;
  const ago = e.ago < 90000 ? 'à l’instant' : `il y a ${Math.round(e.ago / 60000)} min`;
  return (
    <div className="home-note elsewhere">
      <Icon name="tv" />
      <div><b>{`Vous regardiez « ${e.title} »${e.sub ? ` (${e.sub})` : ''} sur ${e.device}`}</b><p>{`${e.paused ? 'En pause' : 'En cours'} ${ago}, à ${Math.floor(e.position / 60)} min.`}</p></div>
      <div className="actions"><button className="btn btn-small btn-play f" onClick={() => go(components.playPath(e.itemId))}><Icon name="play" />Continuer ici</button></div>
    </div>
  );
}

// Pas d'affiches : l'administrateur peut lancer la recherche ou ajouter une clé TMDB
function NoPosters() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await api('/api/admin/tasks/posters/run', { method: 'POST' }); toast('Recherche des affiches lancée : elles apparaîtront d’ici quelques minutes'); } catch (e) { toast(e.message, true); setBusy(false); }
  };
  return (
    <div className="home-note">
      <Icon name="image" />
      <div><b>Vos films n’ont pas encore d’affiches</b><p>Venus les cherche tout seul sur des services gratuits. Pour les résumés complets, les notes et les bandes-annonces, ajoutez une clé TMDB (gratuite).</p></div>
      <div className="actions">
        <button className="btn btn-small f" disabled={busy} onClick={run}>Chercher les affiches</button>
        <button className="btn btn-small btn-play f" onClick={() => go('/reglages?section=sources')}>Ajouter la clé</button>
      </div>
    </div>
  );
}

function Empty({ data }) {
  const { app } = shared();
  const p = app.state.profile;
  useEffect(() => {
    if (!data.scanning) return undefined;
    const t = setTimeout(() => shared().app.hostHooks.refresh(), 5000);
    return () => clearTimeout(t);
  }, [data.scanning]);
  return (
    <div className="page">
      <div className="empty">
        <h2>{data.scanning ? 'Analyse de vos vidéos…' : 'Aucune vidéo pour le moment'}</h2>
        {data.scanning ? <p>Venus découvre vos films et séries. Ils apparaîtront ici dans quelques instants.</p>
          : p.maxAge != null ? <p>Aucun titre n’est autorisé pour ce profil. Un administrateur peut ajuster le contrôle parental.</p>
            : <p>Placez vos films dans <code>/media/films</code> et vos séries dans <code>/media/series</code> (un dossier par série), ou ajoutez une bibliothèque dans les réglages.</p>}
        {p.isAdmin ? <div className="actions" style={{ marginTop: 24, justifyContent: 'center' }}><button className="btn btn-play f" onClick={() => go('/reglages?onglet=medias')}>Choisir les dossiers de vidéos</button></div> : null}
      </div>
    </div>
  );
}

// Colonne « Ce soir » des thèmes Lagon et Océan : sorties du jour, prochaine sortie musicale, qui regarde, direct
function TonightSide() {
  const { data: d } = useApi('/api/home/tonight');
  const { app } = shared();
  const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <aside className="ce-soir-side" aria-label="Ce soir">
      <section className="cs-panel">
        <h3>À venir aujourd’hui</h3>
        {!d ? <p className="muted small">Chargement…</p> : d.soon.length ? d.soon.map((e, i) => (
          <button key={i} className="cs-item f" onClick={() => go(e.showId ? `/titre/${e.showId}` : `/avenir?type=${e.kind === 'anime' ? 'anime' : 'show'}`)}>
            <span className="cs-pic">{e.poster ? <img src={e.poster.startsWith('http') ? e.poster : img(e.poster, 92)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Placeholder title={e.title} />}</span>
            <span className="cs-txt"><b>{e.title}</b><small>{`${e.sub} · ${e.when}`}</small></span>
            <span className={`cs-badge ${e.nas ? 'in' : e.requested ? 'arr' : 'out'}`}>{e.nas ? 'Sur le NAS' : e.requested ? 'Demandé' : 'Pas sur le NAS'}</span>
          </button>
        )) : d.album ? null : <p className="muted small">Rien d’annoncé pour aujourd’hui ni demain.</p>}
        {d && d.album ? (
          <button className="cs-item f" onClick={() => go(`/musique/artiste/${encodeURIComponent(d.album.slug)}`)}>
            <span className="cs-pic">{d.album.cover ? <img src={img(d.album.cover, 92)} alt="" loading="lazy" /> : <Placeholder title={d.album.title} />}</span>
            <span className="cs-txt"><b>{`${d.album.title} · ${d.album.artist}`}</b><small>{`Album · ${new Date(d.album.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`}</small></span>
            <span className={`cs-badge ${d.album.requested ? 'arr' : 'out'}`}>{d.album.requested ? 'Demandé' : 'À venir'}</span>
          </button>
        ) : null}
      </section>
      <section className="cs-panel row-panel">
        <div><h3>Qui regarde ce soir ?</h3><div className="cs-avatars">{(d ? d.people : []).slice(0, 4).map((p) => <Avatar key={p.id} profile={p} cls="sm" />)}{d && d.people.length > 4 ? <span className="cs-more">{`+${d.people.length - 4}`}</span> : null}</div></div>
        <button className="btn btn-ghost btn-small f" onClick={() => go('/cesoir')}>Trouver un film</button>
      </section>
      <section className="cs-panel row-panel live-panel">
        {d && d.live ? (
          <button className="cs-live f" onClick={() => go(d.live.path)}>
            <span className="cs-logo">{d.live.logo ? <img src={img(d.live.logo, 160)} alt="" loading="lazy" /> : <Icon name="tv" />}<i className="live-dot" /></span>
            <span className="cs-txt"><h3>En direct</h3><b>{`${d.live.title}${d.live.now ? ` · ${d.live.now.title}` : ''}`}</b><small>{d.live.now ? `${hhmm(d.live.now.start)} – ${hhmm(d.live.now.stop)}${d.live.next ? ` · ensuite : ${d.live.next.title}` : ''}` : 'Reprendre la dernière chaîne'}</small></span>
          </button>
        ) : (
          <button className="cs-live f" onClick={() => go('/tv')}>
            <span className="cs-logo"><Icon name="tv" /></span>
            <span className="cs-txt"><h3>En direct</h3><b>Télévision</b><small>{app.hasCat && app.hasCat('channel') ? 'Choisir une chaîne' : 'Ajoutez des chaînes dans Réglages → Bibliothèques'}</small></span>
          </button>
        )}
      </section>
    </aside>
  );
}
