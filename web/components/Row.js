'use client';
// Rangées défilantes (accueil, fiche, nouveautés) et carte de chaîne TV, en composants Next.js
import { useEffect, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import Card from './Card';
import { Icon } from './Icon';

// Rangée horizontale avec flèches (cachées au bout)
export function ScrollRow({ className = 'row-scroll', children, innerRef = null }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  useEffect(() => {
    const el = ref.current;
    if (innerRef) innerRef.current = el;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    requestAnimationFrame(update);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  const by = (dir) => ref.current.scrollBy({ left: dir * Math.max(240, ref.current.clientWidth * 0.82), behavior: 'smooth' });
  return (
    <div className="row-body">
      <button type="button" className={`row-arrow prev${edge.start ? ' off' : ''}`} tabIndex={-1} aria-label="Précédent" onClick={() => by(-1)}><Icon name="back" /></button>
      <div ref={ref} className={className}>{children}</div>
      <button type="button" className={`row-arrow next${edge.end ? ' off' : ''}`} tabIndex={-1} aria-label="Suivant" onClick={() => by(1)}><Icon name="fwd" /></button>
    </div>
  );
}

const initials = (t) => String(t || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

// Chaîne de TV : logo, « Direct », et l'image en direct au survol de la souris (sans le son)
export function ChannelCard({ item }) {
  const { app, components, ui } = shared();
  const ref = useRef(null);
  const [logoOk, setLogoOk] = useState(!!item.poster);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    let timer = null, session = null, detach = null, video = null, gone = false;
    const L = shared();
    const stop = () => {
      clearTimeout(timer); gone = true;
      if (detach) { detach(); detach = null; }
      if (session) { fetch(`/api/hls/${session}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${L.api.auth.token}` } }).catch(() => {}); session = null; }
      if (video) { video.remove(); video = null; }
      setPreviewing(false);
    };
    const enter = () => {
      if (document.documentElement.classList.contains('touch') || L.api.hoverMode() === 'off') return;
      gone = false;
      timer = setTimeout(async () => {
        try {
          const live = await L.imp('live.js');
          const info = await L.api.api(`/api/play/${item.id}`, { method: 'POST', body: { caps: L.api.deviceCaps(), preview: true } });
          if (gone) { fetch(`/api/hls/${info.sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${L.api.auth.token}` } }).catch(() => {}); return; }
          session = info.sessionId;
          video = document.createElement('video');
          Object.assign(video, { className: 'pv', muted: true, playsInline: true, autoplay: true });
          video.addEventListener('playing', () => { if (!gone) setPreviewing(true); });
          el.querySelector('.shot').append(video);
          detach = await live.attachStream(video, info.url, { live: true, onError: stop });
        } catch { /* chaîne muette : le logo reste */ }
      }, 600);
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', stop);
    el.addEventListener('click', stop);
    return () => { el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', stop); el.removeEventListener('click', stop); stop(); };
  }, [item.id]);
  return (
    <button ref={ref} className={`card channel f${previewing ? ' previewing' : ''}`} aria-label={`${item.number ? `${item.number}, ` : ''}${item.title}, en direct`} onClick={() => app.go(components.playPath(item.id))}>
      <div className="shot">
        {logoOk ? <img src={ui.img(item.poster)} alt="" loading="lazy" className="ch-logo" onError={() => setLogoOk(false)} /> : <span className="ch-initials">{initials(item.title)}</span>}
        <span className="live-dot">Direct</span>
        {item.number ? <span className="ch-num">{item.number}</span> : null}
      </div>
      <div className="cap"><b>{item.title}</b>{item.group ? <small>{item.group}</small> : null}</div>
    </button>
  );
}

export function AnyCard(props) {
  return props.item.type === 'channel' ? <ChannelCard item={props.item} /> : <Card {...props} />;
}

// Rangée de l'accueil ou d'une fiche : titre, outils (tout lire, mélanger, tout voir), cartes
export function Row({ r, onFocus = null, poster: forcePoster }) {
  const { app, components, queue: Q, api, ui } = shared();
  const [items, setItems] = useState(r.items);
  useEffect(() => setItems(r.items), [r.items]);
  const scroller = useRef(null);
  if (!items.length) return null;
  const ranked = r.id === 'top';
  const clips = items.filter((it) => it.type === 'clip');
  const queue = clips.length ? () => clips : null;
  // Films, séries et animés en affiches ; épisodes, clips, chaînes et reprises en vignettes larges
  const posters = forcePoster !== undefined ? forcePoster : r.style !== 'channels' && items.length > 0
    && !items.some((it) => it.type === 'channel')
    && items.filter((it) => it.type === 'movie' || it.type === 'show').length >= Math.ceil(items.length * 0.6);
  const tools = [];
  if (clips.length > 1 && clips.length === items.length) {
    tools.push(<button key="all" className="row-link f" onClick={() => { const f = Q.setQueue(clips, { title: r.title }); app.go(components.playPath(f.id)); }}><Icon name="play" />Tout lire</button>);
    tools.push(<button key="shuf" className="row-link f" onClick={() => { const f = Q.setQueue(clips, { shuffle: true, title: r.title }); app.go(components.playPath(f.id)); }}><Icon name="shuffle" />Aléatoire</button>);
  }
  if (r.shuffle) {
    tools.push(<button key="mix" className="row-link f" onClick={() => { setItems((l) => [...l].sort(() => Math.random() - 0.5)); scroller.current && scroller.current.scrollTo({ left: 0, behavior: 'smooth' }); }}><Icon name="shuffle" />Mélanger</button>);
  }
  if (r.more) tools.push(<button key="more" className="row-link f" onClick={() => app.go(r.more)}>Tout voir</button>);
  // « Vous aviez laissé… » : une croix sur chaque carte pour l'oublier (progression effacée, rien n'est marqué vu)
  const forget = async (e, it) => {
    e.stopPropagation(); e.preventDefault();
    try { await api.api(`/api/items/${it.showId || it.id}/forget`, { method: 'POST' }); setItems((l) => l.filter((x) => x !== it)); ui.toast('Retiré'); } catch (err) { ui.toast(err.message, true); }
  };
  return (
    <section className={`row${r.style === 'channels' ? ' row-channels' : ''}`} aria-label={r.title}>
      <div className="row-head">
        <h2>{r.title}</h2>
        {r.hint ? <small className="row-hint">{r.hint}</small> : null}
        {tools.length ? <div className="row-tools">{tools}</div> : null}
      </div>
      <ScrollRow className={`row-scroll${posters ? ' posters' : ''}`} innerRef={scroller}>
        {items.map((it, i) => (it.type === 'channel'
          ? <ChannelCard key={`c${it.id}`} item={it} />
          : (
            <Card key={`${it.type}-${it.id}`} item={it} poster={posters} rank={ranked && i < 10 ? i + 1 : null} onFocus={onFocus} queue={queue}>
              {r.stale ? <span className="card-x" role="button" tabIndex={-1} title="Retirer de cette liste" aria-label="Retirer" onClick={(e) => forget(e, it)}><Icon name="close" /></span> : null}
            </Card>
          )))}
      </ScrollRow>
    </section>
  );
}
