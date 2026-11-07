'use client';
// Musique, photos et livres : pages Next.js. La lecture audio (musique, livres audio) reste assurée
// par le lecteur de Venus en bas de l'écran (audio.js), qui continue pendant la navigation.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { legacy } from '../../lib/legacy';
import { useApi, useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import { Placeholder } from '../Card';
import { PageError, PageLoading } from '../PageState';

const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const audio = () => legacy().imp('audio.js');
const isBack = (e) => legacy().ui.isBack(e);

// ================================================================ MUSIQUE
const fmt = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const total = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const Cover = ({ c, title, w = 342 }) => (c ? <img src={img(c, w)} alt="" loading="lazy" /> : <Placeholder title={title} />);
const shuffle = (l) => [...l].sort(() => Math.random() - 0.5);
const play = async (list, i = 0) => (await audio()).playList(list, i);
const queue = async (list) => (await audio()).addToQueue(list);

function AlbumTile({ a }) {
  return (
    <button className="m-tile f" onClick={() => go(`/musique/album/${encodeURIComponent(a.slug)}`)}>
      <span className="m-cover"><Cover c={a.cover} title={a.album} /></span><b>{a.album}</b><small>{[a.artist, a.year].filter(Boolean).join(' · ')}</small>
    </button>
  );
}

// Liste de titres : celui en cours est mis en évidence (et anime son égaliseur pendant la lecture)
function Tracks({ tracks, showAlbum = false, showArtist = false }) {
  const [now, setNow] = useState({ id: null, playing: false });
  useEffect(() => {
    let off = null, dead = false;
    audio().then((m) => {
      if (dead) return;
      const set = (track, playing) => setNow({ id: track ? track.id : null, playing: !!playing });
      const { track, playing } = m.nowPlaying(); set(track, playing);
      off = m.onAudioChange(set);
    });
    return () => { dead = true; if (off) off(); };
  }, []);
  return (
    <div className="tracks">
      {tracks.map((t, i) => (
        <div key={t.id} className={`tr-row${now.id === t.id ? ' on' : ''}${now.id === t.id && now.playing ? ' playing' : ''}`} data-id={t.id}>
          <button className="tr-main f" onClick={() => play(tracks, i)}>
            <span className="tr-n">{t.track ? t.track : i + 1}</span>
            <span className="tr-eq" aria-hidden="true"><i /><i /><i /></span>
            <span className="tr-txt"><b>{t.title}</b>{showArtist || showAlbum ? <small>{[showArtist ? t.artist : null, showAlbum ? t.album : null].filter(Boolean).join(' · ')}</small> : null}</span>
            <small className="tr-d">{fmt(t.duration)}</small>
          </button>
          <button className="p-icon small f" aria-label={`Ajouter « ${t.title} » à la file`} title="Ajouter à la file" onClick={() => queue([t])}><Icon name="plus" /></button>
        </div>
      ))}
    </div>
  );
}

export function Music() {
  useTitle('Musique');
  const { search } = useVenus();
  const [tab, setTab] = useState((search && search.get('vue')) || 'albums');
  const { data: d, error } = useApi('/api/music');
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const shuffleAll = async () => { const all = d.tracks.length ? d.tracks : (await api('/api/music')).tracks; play(shuffle(all).slice(0, 300), 0); };
  return (
    <main className="with-nav page-in">
      <div className="page music-page">
        <div className="page-head">
          <div className="head-left"><h1>Musique</h1></div>
          <div className="head-tools">
            <div className="seg">{[['albums', `Albums (${d.albums.length})`], ['artistes', `Artistes (${d.artists.length})`], ['titres', `Titres (${d.total})`]].map(([k, l]) => <button key={k} className={`seg-b f${k === tab ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
            {d.total ? <button className="btn btn-play btn-small f" onClick={shuffleAll}><Icon name="shuffle" />Tout en aléatoire</button> : null}
          </div>
        </div>
        {!d.total ? <div className="empty"><h2>Pas encore de musique</h2><p>Ajoutez une bibliothèque « Musique » dans Réglages → Bibliothèques (un dossier par artiste, puis par album).</p></div>
          : tab === 'albums' ? (
            <div>
              {d.recent.length > 4 ? <><h2 className="section-title">Ajoutés récemment</h2><div className="m-row">{d.recent.slice(0, 12).map((a) => <AlbumTile key={a.slug} a={a} />)}</div></> : null}
              <h2 className="section-title">Tous les albums</h2>
              <div className="m-grid">{d.albums.map((a) => <AlbumTile key={a.slug} a={a} />)}</div>
            </div>
          ) : tab === 'artistes' ? (
            <div className="m-grid artists">
              {d.artists.map((a) => <button key={a.slug} className="m-tile f" onClick={() => go(`/musique/artiste/${encodeURIComponent(a.slug)}`)}><span className="m-cover round"><Cover c={a.cover} title={a.name} /></span><b>{a.name}</b><small>{`${a.albums} album${a.albums > 1 ? 's' : ''}`}</small></button>)}
            </div>
          ) : d.tracks.length ? <Tracks tracks={d.tracks} showArtist showAlbum /> : <p className="muted">Trop de titres pour les afficher tous : passez par les albums ou les artistes.</p>}
      </div>
    </main>
  );
}

export function Album() {
  const { name } = useParams();
  const { data: a, error } = useApi(`/api/music/album?slug=${encodeURIComponent(dec(name || ''))}`);
  useTitle(a ? a.album : undefined);
  if (error) return <PageError error={error} />;
  if (!a) return <PageLoading />;
  return (
    <main className="with-nav page-in">
      <div className="page music-page">
        <div className="m-head">
          <span className="m-cover big"><Cover c={a.cover} title={a.album} w={500} /></span>
          <div>
            <small>Album</small><h1>{a.album}</h1>
            <p><button className="linkish f" onClick={() => go(`/musique/artiste/${encodeURIComponent(a.artistSlug)}`)}>{a.artist}</button>{[a.year, `${a.tracks.length} titre${a.tracks.length > 1 ? 's' : ''}`, total(a.duration), ...a.genres].filter(Boolean).map((x) => ` · ${x}`).join('')}</p>
            <div className="actions">
              <button className="btn btn-play f" data-autofocus="true" onClick={() => play(a.tracks, 0)}><Icon name="play" />Lecture</button>
              <button className="btn btn-ghost f" onClick={() => play(shuffle(a.tracks), 0)}><Icon name="shuffle" />Aléatoire</button>
              <button className="btn btn-ghost f" onClick={() => queue(a.tracks)}><Icon name="plus" />À la suite</button>
            </div>
          </div>
        </div>
        <Tracks tracks={a.tracks} />
      </div>
    </main>
  );
}

export function Artist() {
  const { name } = useParams();
  const { data: a, error } = useApi(`/api/music/artist?slug=${encodeURIComponent(dec(name || ''))}`);
  useTitle(a ? a.name : undefined);
  if (error) return <PageError error={error} />;
  if (!a) return <PageLoading />;
  return (
    <main className="with-nav page-in">
      <div className="page music-page">
        <div className="page-head">
          <div className="head-left"><h1>{a.name}</h1><p className="count">{`${a.albums.length} album${a.albums.length > 1 ? 's' : ''} · ${a.tracks.length} titres`}</p></div>
          <div className="head-tools"><button className="btn btn-play btn-small f" onClick={() => play(shuffle(a.tracks), 0)}><Icon name="shuffle" />Lecture aléatoire</button></div>
        </div>
        <div className="m-grid">{a.albums.map((x) => <AlbumTile key={x.slug} a={x} />)}</div>
        <h2 className="section-title">Titres</h2>
        <Tracks tracks={a.tracks} showAlbum />
      </div>
    </main>
  );
}

// ================================================================ PHOTOS
const dateOf = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export function Photos() {
  useTitle('Photos');
  const { data: albums, error } = useApi('/api/photos');
  if (error) return <PageError error={error} />;
  if (!albums) return <PageLoading />;
  return (
    <main className="with-nav page-in">
      <div className="page photos-page">
        <div className="page-head"><div className="head-left"><h1>Photos</h1><p className="count">{`${albums.length} album${albums.length > 1 ? 's' : ''}`}</p></div></div>
        {albums.length ? (
          <div className="m-grid">
            {albums.map((a) => <button key={a.slug} className="m-tile f" onClick={() => go(`/photos/${encodeURIComponent(a.slug)}`)}><span className="m-cover wide"><img src={`/api/photo/${a.cover}?w=640`} alt="" loading="lazy" /></span><b>{a.name}</b><small>{`${a.count} photo${a.count > 1 ? 's' : ''} · ${dateOf(a.last)}`}</small></button>)}
          </div>
        ) : <div className="empty"><h2>Pas encore de photos</h2><p>Ajoutez une bibliothèque « Photos » dans Réglages → Bibliothèques : chaque dossier devient un album.</p></div>}
      </div>
    </main>
  );
}

export function PhotoAlbum() {
  const { name } = useParams();
  const { data: a, error } = useApi(`/api/photos/album?slug=${encodeURIComponent(dec(name || ''))}`);
  const [view, setView] = useState(null); // { start, show }
  useTitle(a ? a.name : undefined);
  if (error) return <PageError error={error} />;
  if (!a) return <PageLoading />;
  return (
    <main className="with-nav page-in">
      <div className="page photos-page">
        <div className="page-head">
          <div className="head-left">
            <h1>{a.name}</h1><p className="count">{`${a.photos.length} photo${a.photos.length > 1 ? 's' : ''}`}</p>
            {a.folder ? <p className="muted small album-path" title="Emplacement sur le NAS"><Icon name="folder" />{` ${a.folder}`}</p> : null}
          </div>
          <div className="head-tools">
            <button className="btn btn-ghost btn-small f" onClick={() => go('/photos')}><Icon name="back" />Albums</button>
            <button className="btn btn-play btn-small f" onClick={() => setView({ start: 0, show: true })}><Icon name="play" />Diaporama</button>
          </div>
        </div>
        <div className="ph-grid">
          {a.photos.map((p, i) => <button key={p.id} className="ph-cell f" aria-label={p.title} onClick={() => setView({ start: i, show: false })}><img src={`/api/photo/${p.id}?w=320`} alt="" loading="lazy" /></button>)}
        </div>
      </div>
      {view ? <Viewer list={a.photos} start={view.start} slideshow={view.show} onClose={() => setView(null)} /> : null}
    </main>
  );
}

// Visionneuse : flèches, glisser du doigt, Échap pour fermer, diaporama toutes les 5 secondes
function Viewer({ list, start, slideshow, onClose }) {
  const [i, setI] = useState(start);
  const [show, setShow] = useState(slideshow);
  const root = useRef(null);
  const x0 = useRef(null);
  const w = () => Math.min(2048, Math.round(innerWidth * (devicePixelRatio || 1)));
  const go1 = (n) => setI((n + list.length) % list.length);
  useEffect(() => { const nx = list[(i + 1) % list.length]; if (nx) { const pre = new Image(); pre.src = `/api/photo/${nx.id}?w=${w()}`; } }, [i]);
  useEffect(() => { if (!show) return undefined; const t = setInterval(() => setI((x) => (x + 1) % list.length), 5000); return () => clearInterval(t); }, [show]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setI((x) => (x + 1) % list.length); } else if (e.key === 'ArrowLeft') { e.preventDefault(); setI((x) => (x - 1 + list.length) % list.length); }
      else if (e.key === ' ') { e.preventDefault(); setShow((s) => !s); } else if (isBack(e)) { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('vn:navigate', onClose);
    root.current && root.current.requestFullscreen?.().catch?.(() => {});
    return () => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('vn:navigate', onClose); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  const p = list[i];
  return createPortal(
    <div ref={root} className={`photo-viewer${show ? ' show' : ''}`} role="dialog" aria-label="Photo"
      onPointerDown={(e) => { if (e.pointerType === 'touch') x0.current = e.clientX; }}
      onPointerUp={(e) => { if (x0.current == null) return; const dx = e.clientX - x0.current; x0.current = null; if (Math.abs(dx) > 50) go1(i + (dx < 0 ? 1 : -1)); }}>
      <img className="pv-img" alt="" src={`/api/photo/${p.id}?w=${w()}`} />
      <div className="pv-cap">{`${p.title} · ${dateOf(p.date)} · ${i + 1} / ${list.length}`}{p.path ? <small className="pv-path">{p.path}</small> : null}</div>
      <button className="p-icon f pv-prev" aria-label="Photo précédente" onClick={() => go1(i - 1)}><Icon name="back" /></button>
      <button className="p-icon f pv-next" aria-label="Photo suivante" onClick={() => go1(i + 1)}><Icon name="fwd" /></button>
      <div className="pv-tools">
        <button className="p-icon f" aria-label="Diaporama" onClick={() => setShow(!show)}><Icon name={show ? 'pause' : 'play'} /></button>
        <a className="p-icon f" aria-label="Télécharger" title="Télécharger l’original" href={`/api/photo/${p.id}`} download={p.title}><Icon name="down" /></a>
        <button className="p-icon f" aria-label="Fermer" onClick={onClose}><Icon name="close" /></button>
      </div>
    </div>,
    document.body,
  );
}

// ================================================================ LIVRES
const pct = (b) => (b.progress && b.progress.duration ? Math.min(100, Math.round((b.progress.watched ? 1 : b.progress.position / b.progress.duration) * 100)) : 0);
const FORMAT = { epub: 'EPUB', pdf: 'PDF', cbz: 'BD', audiobook: 'Livre audio' };

export function Books() {
  useTitle('Livres');
  const [filter, setFilter] = useState('all');
  const { data: list, error } = useApi('/api/books');
  if (error) return <PageError error={error} />;
  if (!list) return <PageLoading />;
  const open = async (b) => {
    if (b.type !== 'audiobook') return go(`/lire/${b.id}`);
    const d = await api(`/api/books/${b.id}`);
    const parts = d.parts.map((p) => ({ ...p, artist: d.author, album: d.title, cover: d.cover }));
    // Reprise : partie et position d'après la progression enregistrée
    let at = d.progress && !d.progress.watched ? d.progress.position : 0, idx = 0;
    while (idx < parts.length - 1 && at >= (parts[idx].duration || 0)) { at -= parts[idx].duration || 0; idx++; }
    (await audio()).playList(parts, idx, { kind: 'book', bookId: b.id, at });
    toast(at > 5 || idx ? `Reprise de « ${d.title} »` : `Lecture de « ${d.title} »`);
  };
  const shown = list.filter((b) => filter === 'all' || (filter === 'audio' ? b.type === 'audiobook' : b.type === 'book'));
  const reading = shown.filter((b) => b.progress && !b.progress.watched && b.progress.position > 0).sort((a, b) => b.progress.updated - a.progress.updated);
  const tile = (b, sub) => (
    <button key={b.id} className="m-tile f" onClick={() => open(b)}>
      <span className="m-cover book">
        {b.cover ? <img src={img(b.cover, 342)} alt="" loading="lazy" /> : <Placeholder title={b.title} />}
        {sub ? null : <em className="b-fmt">{FORMAT[b.type === 'audiobook' ? 'audiobook' : b.format] || ''}</em>}
        {pct(b) ? <span className="bar"><i style={{ width: `${pct(b)}%` }} /></span> : null}
      </span>
      <b>{b.title}</b><small>{sub || b.author || ''}</small>
    </button>
  );
  return (
    <main className="with-nav page-in">
      <div className="page books-page">
        <div className="page-head">
          <div className="head-left"><h1>Livres</h1><p className="count">{`${list.length} livre${list.length > 1 ? 's' : ''}`}</p></div>
          <div className="head-tools"><div className="seg">{[['all', 'Tous'], ['read', 'À lire'], ['audio', 'Livres audio']].map(([k, l]) => <button key={k} className={`seg-b f${k === filter ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
        </div>
        {reading.length ? <><h2 className="section-title">En cours</h2><div className="m-row">{reading.slice(0, 10).map((b) => tile(b, `${pct(b)} %`))}</div></> : null}
        {list.length ? <div className="m-grid books">{shown.map((b) => tile(b))}</div>
          : <div className="empty"><h2>Pas encore de livres</h2><p>Ajoutez une bibliothèque « Livres » dans Réglages → Bibliothèques : EPUB, PDF, CBZ et livres audio (un dossier par livre).</p></div>}
      </div>
    </main>
  );
}

// Lecteur : EPUB et CBZ dans Venus (fond clair / sépia / sombre, taille du texte), PDF par le navigateur
export function Reader() {
  const { id: raw } = useParams();
  const [id, setId] = useState(/^\d+$/.test(dec(raw)) ? Number(dec(raw)) : null);
  useEffect(() => { if (!id) legacy().app.resolveParams({ slug: dec(raw) }).then((p) => setId(p.id)).catch((e) => { toast(e.message, true); go('/livres', { replace: true }); }); }, [raw]);
  const { data: b, error } = useApi(id ? `/api/books/${id}` : null);
  useTitle(b ? b.title : undefined);
  useEffect(() => { if (b) legacy().app.showSlug('lire', b.slug); }, [b]);
  if (error) return <PageError error={error} />;
  if (!b) return <main className="with-nav" />;
  return <main className="with-nav"><div className="rd-spacer" /><ReaderView b={b} id={id} /></main>;
}

function ReaderView({ b, id }) {
  const total = b.format === 'epub' ? b.chapters : b.format === 'cbz' ? b.pages : 1;
  const [n, setN] = useState(b.progress && !b.progress.watched ? Math.min(total - 1, Math.floor(b.progress.position)) : 0);
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('vn_reader') || '{}'); } catch { return {}; } })();
  const [theme, setTheme] = useState(prefs.theme || 'light');
  const [size, setSize] = useState(prefs.size || 100);
  const frame = useRef(null);
  const saveT = useRef(null);
  const nRef = useRef(n); nRef.current = n;
  const look = useRef({ theme, size }); look.current = { theme, size };
  const save = (frac = 0) => {
    clearTimeout(saveT.current);
    const k = nRef.current;
    saveT.current = setTimeout(() => api('/api/progress', { method: 'POST', body: { itemId: id, position: Math.min(total, k + frac), duration: total, watched: k >= total - 1 && frac > 0.9 } }).catch(() => {}), 800);
  };
  const keep = (t, s) => { try { localStorage.setItem('vn_reader', JSON.stringify({ theme: t, size: s })); } catch { /* */ } };
  const show = (k) => setN(Math.max(0, Math.min(total - 1, k)));
  useEffect(() => {
    save(0);
    if (b.format === 'cbz') { const pre = new Image(); pre.src = `/api/books/${id}/page/${Math.min(total - 1, n + 1)}`; }
  }, [n]);
  const onKey = useRef(null);
  onKey.current = (e) => {
    if (e.key === 'ArrowRight' || (e.key === 'PageDown' && b.format === 'cbz')) { e.preventDefault(); show(nRef.current + 1); }
    else if (e.key === 'ArrowLeft' || (e.key === 'PageUp' && b.format === 'cbz')) { e.preventDefault(); show(nRef.current - 1); }
    else if (isBack(e) && !document.querySelector('.sheet-wrap')) { e.preventDefault(); if (history.length > 1) history.back(); else go('/livres'); }
  };
  useEffect(() => {
    const k = (e) => onKey.current(e);
    document.addEventListener('keydown', k, true);
    if (b.format === 'pdf') save(0.5);
    return () => document.removeEventListener('keydown', k, true);
  }, []);
  // Style du chapitre (fond, taille, typographie), reprise de la position, suivi de la lecture
  const styleFrame = () => {
    const doc = frame.current && frame.current.contentDocument;
    if (!doc || !doc.documentElement) return;
    let st = doc.getElementById('vn-style');
    if (!st) { st = doc.createElement('style'); st.id = 'vn-style'; (doc.head || doc.documentElement).append(st); }
    const c = { light: ['#fbfaf7', '#1d1d1f'], sepia: ['#f4ecd8', '#3b2f1e'], dark: ['#121214', '#e6e3dc'] }[look.current.theme];
    st.textContent = `html{background:${c[0]}!important;color:${c[1]}!important;font-size:${look.current.size}%!important}body{max-width:42em;margin:0 auto!important;padding:2.2em 1.4em 4em!important;line-height:1.65!important;font-family:Georgia,'Iowan Old Style','Palatino Linotype',serif!important;background:transparent!important;color:inherit!important}img,svg{max-width:100%!important;height:auto!important}a{color:inherit}`;
    if (!doc.__vn) {
      doc.__vn = true;
      const frac = b.progress && Math.floor(b.progress.position) === nRef.current ? b.progress.position - nRef.current : 0;
      if (frac > 0) setTimeout(() => { const se = doc.scrollingElement; se.scrollTop = frac * (se.scrollHeight - se.clientHeight); }, 50);
      doc.addEventListener('scroll', () => { const se = doc.scrollingElement; save(se.scrollHeight > se.clientHeight ? se.scrollTop / (se.scrollHeight - se.clientHeight) : 1); }, { passive: true });
      doc.addEventListener('keydown', (e) => onKey.current(e), true);
    }
  };
  useEffect(() => { styleFrame(); }, [theme, size]);
  const toc = () => openSheet('Table des matières', (close) => <div>{b.toc.map((t, i) => <button key={i} className={`opt f${t.chapter === n ? ' on' : ''}`} onClick={() => { close(); show(t.chapter); }}>{t.title}</button>)}</div>);
  const lookSheet = () => openSheet('Affichage', (close) => (
    <div className="look">
      <div className="look-row"><span>Fond</span><div className="seg">{[['light', 'Clair'], ['sepia', 'Sépia'], ['dark', 'Sombre']].map(([v, l]) => <button key={v} className={`seg-b f${theme === v ? ' on' : ''}`} onClick={() => { setTheme(v); keep(v, size); close(); }}>{l}</button>)}</div></div>
      <div className="look-row"><span>Taille du texte</span><div className="seg">{[80, 100, 120, 140, 170].map((v) => <button key={v} className={`seg-b f${size === v ? ' on' : ''}`} onClick={() => { setSize(v); keep(theme, v); close(); }}>{`${v} %`}</button>)}</div></div>
    </div>
  ));
  // Le lecteur couvre tout l'écran (au-dessus du menu)
  return createPortal(
    <div className={`reader rd-${theme}`}>
      <div className="rd-bar">
        <button className="p-icon f" aria-label="Retour" onClick={() => go('/livres')}><Icon name="back" /></button>
        <b className="rd-title">{b.title}</b>
        {b.format !== 'pdf' && b.toc && b.toc.length ? <button className="p-icon f" aria-label="Table des matières" title="Table des matières" onClick={toc}><Icon name="chapters" /></button> : null}
        {b.format === 'epub' ? <button className="p-icon f" aria-label="Affichage" title="Affichage" onClick={lookSheet}><Icon name="subs" /></button> : null}
        <a className="p-icon f" aria-label="Télécharger le livre" title="Télécharger" href={`/api/books/${id}/file?download=1`} download=""><Icon name="down" /></a>
      </div>
      {b.format === 'pdf' ? <iframe className="rd-frame pdf" src={`/api/books/${id}/file`} title={b.title} />
        : b.format === 'cbz' ? <div className="rd-page" onClick={(e) => show(n + (e.clientX > innerWidth / 2 ? 1 : -1))}><img className="rd-img" alt="" src={`/api/books/${id}/page/${n}`} /></div>
          : <iframe ref={frame} className="rd-frame" title={b.title} sandbox="allow-same-origin" src={`/api/books/${id}/chapter/${n}`} onLoad={styleFrame} />}
      {b.format !== 'pdf' ? (
        <div className="rd-foot">
          <button className="btn btn-ghost btn-small f" onClick={() => show(n - 1)}><Icon name="back" />{b.format === 'cbz' ? 'Page précédente' : 'Chapitre précédent'}</button>
          <span className="rd-pos">{b.format === 'cbz' ? `Page ${n + 1} / ${total}` : `Chapitre ${n + 1} / ${total}`}</span>
          <button className="btn btn-ghost btn-small f" onClick={() => show(n + 1)}>{b.format === 'cbz' ? 'Page suivante' : 'Chapitre suivant'}<Icon name="fwd" /></button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
