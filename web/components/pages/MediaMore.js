'use client';
// Musique et livres, la suite : « À venir » (sorties annoncées, albums et livres récents absents du NAS),
// discographies et bibliographies complètes, demandes à Lidarr / LazyLibrarian / Bookshelf.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useApi, useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { Icon } from '../Icon';
import { Placeholder } from '../Card';
import { PageError, PageLoading } from '../PageState';

const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const Cover = ({ c, title, w = 342 }) => (c ? <img src={img(c, w)} alt="" loading="lazy" /> : <Placeholder title={title} />);
export const dateFr = (d) => {
  if (!d) return '';
  if (d.length === 4) return d;
  if (d.length === 7) return new Date(`${d}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};
const daysTo = (d) => Math.round((new Date(d) - Date.now()) / 86400e3);
const when = (d) => { const n = daysTo(d); return n <= 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : n < 30 ? `Dans ${n} jours` : dateFr(d); };

// Bouton « Demander » générique : envoie la demande, se transforme en « Demandé »
export function AskBtn({ label = 'Demander', done = 'Demandé', requested, onAsk, small = true }) {
  const [state, setState] = useState(requested ? 'done' : 'idle');
  useEffect(() => { setState(requested ? 'done' : 'idle'); }, [requested]);
  if (state === 'done') return <span className="asked"><Icon name="check" />{done}</span>;
  return (
    <button type="button" className={`btn btn-play f${small ? ' btn-small' : ''}`} disabled={state === 'busy'} onClick={async (e) => {
      e.stopPropagation(); setState('busy');
      try { const r = await onAsk(); toast(r && r.already ? `« ${r.title} » est déjà demandé` : `« ${(r && r.title) || ''} » demandé : téléchargé dès que possible`); setState('done'); } catch (err) { toast(err.message, true); setState('idle'); }
    }}><Icon name="download" />{state === 'busy' ? 'Envoi…' : label}</button>
  );
}

// ================================================================ MUSIQUE
// Tuile d'une sortie (présente ou absente du NAS)
export function ReleaseTile({ r, lidarr, showArtist = false }) {
  const sub = [showArtist ? r.artist : null, r.date ? (r.upcoming ? when(r.date) : dateFr(r.date).replace(/^\d+ /, (m) => m)) : null, r.type && r.type !== 'Album' ? r.type : null].filter(Boolean).join(' · ');
  const inner = (
    <>
      <span className={`m-cover${r.onNas ? '' : ' absent'}`}>
        <Cover c={r.cover} title={r.title} />
        <span className={`up-badge ${r.onNas ? 'in' : r.requested ? 'arr' : 'out'}`}>{r.onNas ? 'Disponible' : r.requested ? 'Demandé' : r.upcoming ? 'À venir' : 'Pas sur le NAS'}</span>
      </span>
      <b>{r.title}</b><small>{sub}</small>
    </>
  );
  if (r.onNas && r.slug) return <button className="m-tile f" onClick={() => go(`/musique/album/${encodeURIComponent(r.slug)}`)}>{inner}</button>;
  return (
    <div className="m-tile static">
      {inner}
      {lidarr && r.id ? <AskBtn requested={r.requested} onAsk={() => api('/api/music/request', { method: 'POST', body: { album: r.id } })} /> : null}
    </div>
  );
}

export function MusicUpcoming() {
  const { data: d, error, reload } = useApi('/api/music/upcoming');
  useEffect(() => { if (d && d.status && d.status.running) { const t = setTimeout(reload, 4000); return () => clearTimeout(t); } }, [d]);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const empty = !d.upcoming.length && !d.missing.length;
  return (
    <div className="m-upcoming">
      {d.status && d.status.running ? <p className="muted">{`Venus met à jour les discographies (${d.status.phase}${d.status.total ? ` ${d.status.done}/${d.status.total}` : ''})…`}</p>
        : !d.artists ? <p className="muted">Venus n’a pas encore identifié vos artistes : la fiche de chaque album puis sa discographie arrivent dans les minutes qui suivent l’analyse (tâche « Musique : albums et discographies »).</p> : null}
      <h2 className="section-title">Sorties annoncées<small className="muted">{` ${d.upcoming.length}`}</small></h2>
      {d.upcoming.length ? <div className="m-grid">{d.upcoming.map((r) => <ReleaseTile key={r.id} r={r} lidarr={d.lidarr} showArtist />)}</div>
        : <p className="muted">{d.artists ? `Aucune sortie annoncée pour vos ${d.artists} artiste(s).` : ''}</p>}
      <h2 className="section-title">Sortis cette année, pas sur le NAS<small className="muted">{` ${d.missing.length}`}</small></h2>
      {d.missing.length ? <div className="m-grid">{d.missing.map((r) => <ReleaseTile key={r.id} r={r} lidarr={d.lidarr} showArtist />)}</div>
        : empty ? null : <p className="muted">Tout ce que vos artistes ont sorti cette année est déjà là.</p>}
      {!d.lidarr ? <p className="muted small">Reliez Lidarr dans Réglages → Demandes pour télécharger un album en un clic.</p> : null}
    </div>
  );
}

// Discographie complète d'un artiste (page Artiste)
export function Discography({ a }) {
  const [filter, setFilter] = useState('all');
  if (!a.discography) return <p className="muted">Discographie en cours de recherche (MusicBrainz)…</p>;
  const list = a.discography.filter((r) => filter === 'all' || (filter === 'nas' ? r.onNas : !r.onNas));
  const absent = a.discography.filter((r) => !r.onNas).length;
  return (
    <>
      <div className="disco-head">
        <h2 className="section-title">Discographie complète<small className="muted">{` ${a.discography.length} sortie${a.discography.length > 1 ? 's' : ''}${absent ? ` · ${absent} pas sur le NAS` : ''}`}</small></h2>
        <div className="seg">{[['all', 'Tout'], ['nas', 'Sur le NAS'], ['out', 'Pas sur le NAS']].map(([k, l]) => <button key={k} className={`seg-b f${k === filter ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
      </div>
      {a.lidarr && a.info && a.info.mbId ? <p className="disco-follow">{a.info.followed ? <span className="asked"><Icon name="check" />Artiste suivi dans Lidarr : les prochains albums seront téléchargés</span>
        : <AskBtn label="Suivre l’artiste (tous ses albums, et les prochains)" done="Artiste suivi" requested={false} onAsk={() => api('/api/music/request', { method: 'POST', body: { artist: a.info.mbId } })} />}</p> : null}
      <div className="m-grid">{list.map((r) => <ReleaseTile key={r.id || r.key} r={r} lidarr={a.lidarr} />)}</div>
    </>
  );
}

// Page Album : fiche MusicBrainz et titres manquants
export function AlbumMeta({ a }) {
  if (!a.mb) return null;
  const miss = a.mb.missing || [];
  return (
    <div className="album-meta">
      {miss.length ? (
        <details className="missing">
          <summary><Icon name="info" />{`${miss.length} titre${miss.length > 1 ? 's' : ''} de l’album manque${miss.length > 1 ? 'nt' : ''} sur le NAS`}{a.lidarr ? <AskBtn label="Compléter l’album" done="Demandé" requested={false} onAsk={() => api('/api/music/request', { method: 'POST', body: { album: a.mb.id } })} /> : null}</summary>
          <ol>{miss.map((t) => <li key={`${t.disc}-${t.n}`}>{t.title}{t.length ? <small>{` ${Math.floor(t.length / 60)}:${String(t.length % 60).padStart(2, '0')}`}</small> : null}</li>)}</ol>
        </details>
      ) : <p className="muted small"><Icon name="check" />{`Album complet (${a.mb.expected} titres)`}</p>}
    </div>
  );
}

// Feuille « Ajouter de la musique » : recherche d'artistes et d'albums dans Lidarr
export function musicAddSheet() {
  openSheet('Ajouter de la musique', (close) => <MusicSearch close={close} />, { wide: true });
}
function MusicSearch({ close }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => { setBusy(true); try { setRes(await api(`/api/music/search?q=${encodeURIComponent(q.trim())}`)); } catch (e) { toast(e.message, true); } finally { setBusy(false); } }, 350);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="req-sheet">
      <input className="input" autoFocus placeholder="Artiste ou album…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un artiste ou un album" />
      {busy ? <p className="muted">Recherche…</p> : null}
      {res && res.artists.length ? <><h3 className="box-sub">Artistes</h3><div className="req-list">{res.artists.map((a) => (
        <div key={a.mbId} className="req-row">
          <span className="req-pic round">{a.poster ? <img src={a.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Placeholder title={a.name} />}</span>
          <div className="req-txt"><b>{a.name}</b><small>{[a.type, a.inVenus ? 'Déjà sur le NAS' : null, ...(a.genres || [])].filter(Boolean).join(' · ')}</small></div>
          <AskBtn label="Suivre" done="Suivi" requested={a.requested} onAsk={() => api('/api/music/request', { method: 'POST', body: { artist: a.mbId } })} />
        </div>))}</div></> : null}
      {res && res.albums.length ? <><h3 className="box-sub">Albums</h3><div className="req-list">{res.albums.map((b) => (
        <div key={b.mbId} className="req-row">
          <span className="req-pic">{b.poster ? <img src={b.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Placeholder title={b.title} />}</span>
          <div className="req-txt"><b>{b.title}</b><small>{[b.artist, b.date ? dateFr(b.date) : null, b.type, b.inVenus ? 'Déjà sur le NAS' : null].filter(Boolean).join(' · ')}</small></div>
          {b.inVenus ? <button className="btn btn-ghost btn-small f" onClick={() => { close(); go('/musique'); }}>Écouter</button> : <AskBtn requested={b.requested} onAsk={() => api('/api/music/request', { method: 'POST', body: { album: b.mbId } })} />}
        </div>))}</div></> : null}
      {res && !res.artists.length && !res.albums.length && !busy ? <p className="muted">Rien trouvé dans Lidarr pour « {q} ».</p> : null}
    </div>
  );
}

// ================================================================ LIVRES
export function WorkTile({ w, request, showAuthor = false }) {
  const sub = [showAuthor ? w.author : null, w.date ? (w.upcoming ? when(w.date) : dateFr(w.date)) : null, w.publisher].filter(Boolean).join(' · ');
  const inner = (
    <>
      <span className={`m-cover book${w.onNas ? '' : ' absent'}`}>
        <Cover c={w.cover} title={w.title} />
        <span className={`up-badge ${w.onNas ? 'in' : w.requested ? 'arr' : 'out'}`}>{w.onNas ? 'Disponible' : w.requested ? 'Demandé' : w.upcoming ? 'À venir' : 'Pas sur le NAS'}</span>
      </span>
      <b>{w.title}</b><small>{sub}</small>
    </>
  );
  if (w.onNas && w.itemId) return <button className="m-tile f" onClick={() => go(`/lire/${w.itemId}`)}>{inner}</button>;
  return (
    <div className="m-tile static">
      {inner}
      {request ? <AskBtn requested={w.requested} onAsk={() => api('/api/books/request', { method: 'POST', body: { title: w.title, author: w.author || '', isbn: w.isbn || undefined } })} /> : null}
    </div>
  );
}

export function BooksUpcoming() {
  const { data: d, error, reload } = useApi('/api/books/upcoming');
  useEffect(() => { if (d && d.status && d.status.running) { const t = setTimeout(reload, 4000); return () => clearTimeout(t); } }, [d]);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  return (
    <div className="m-upcoming">
      {d.status && d.status.running ? <p className="muted">{`Venus met à jour les bibliographies (${d.status.phase}${d.status.total ? ` ${d.status.done}/${d.status.total}` : ''})…`}</p>
        : !d.authors ? <p className="muted">Venus n’a pas encore identifié vos auteurs : les bibliographies arrivent dans les minutes qui suivent l’analyse (tâche « Livres : fiches et bibliographies »).</p> : null}
      <h2 className="section-title">Parutions annoncées<small className="muted">{` ${d.upcoming.length}`}</small></h2>
      {d.upcoming.length ? <div className="m-grid books">{d.upcoming.map((w) => <WorkTile key={w.key} w={w} request={d.request} showAuthor />)}</div>
        : <p className="muted">{d.authors ? `Aucune parution annoncée pour vos ${d.authors} auteur(s). Les dates à venir sont rares chez les libraires en ligne : la liste se remplit au fil des annonces.` : ''}</p>}
      <h2 className="section-title">Parus ces deux dernières années, pas sur le NAS<small className="muted">{` ${d.missing.length}`}</small></h2>
      {d.missing.length ? <div className="m-grid books">{d.missing.map((w) => <WorkTile key={w.key} w={w} request={d.request} showAuthor />)}</div> : <p className="muted">Rien ne manque pour l’instant.</p>}
      {!d.request ? <p className="muted small">Reliez LazyLibrarian ou Bookshelf dans Réglages → Demandes pour télécharger un livre en un clic.</p> : null}
    </div>
  );
}

export function Authors({ authors }) {
  if (!authors.length) return <p className="muted">Les auteurs apparaissent quand les livres sont rangés par dossier d’auteur ou qu’ils portent leur nom (EPUB).</p>;
  return (
    <div className="m-grid artists">
      {authors.map((a) => <button key={a.slug} className="m-tile f" onClick={() => go(`/livres/auteur/${encodeURIComponent(a.slug)}`)}><span className="m-cover round"><Cover c={a.photo || a.cover} title={a.name} /></span><b>{a.name}</b><small>{`${a.count} livre${a.count > 1 ? 's' : ''}`}</small></button>)}
    </div>
  );
}

export function Author() {
  const { name } = useParams();
  const { data: a, error } = useApi(`/api/books/author?slug=${encodeURIComponent(dec(name || ''))}`);
  const [filter, setFilter] = useState('all');
  useTitle(a ? a.name : undefined);
  if (error) return <PageError error={error} />;
  if (!a) return <PageLoading />;
  const works = a.works.filter((w) => filter === 'all' || (filter === 'nas' ? w.onNas : !w.onNas));
  const absent = a.works.filter((w) => !w.onNas).length;
  return (
    <main className="with-nav page-in">
      <div className="page books-page">
        <div className="m-head author">
          <span className="m-cover big round"><Cover c={a.photo || (a.books[0] || {}).cover} title={a.name} w={500} /></span>
          <div>
            <small>Auteur</small><h1>{a.name}</h1>
            <p className="muted">{[a.birth ? `Né(e) le ${a.birth}` : null, `${a.books.length} livre${a.books.length > 1 ? 's' : ''} sur le NAS`, a.works.length ? `${a.works.length} œuvre${a.works.length > 1 ? 's' : ''} connue${a.works.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')}</p>
            {a.bio ? <p className="author-bio">{a.bio}</p> : null}
          </div>
        </div>
        <div className="disco-head">
          <h2 className="section-title">Bibliographie{absent ? <small className="muted">{` ${absent} pas sur le NAS`}</small> : null}</h2>
          <div className="seg">{[['all', 'Tout'], ['nas', 'Sur le NAS'], ['out', 'Pas sur le NAS']].map(([k, l]) => <button key={k} className={`seg-b f${k === filter ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        </div>
        {a.status === 'pending' || !a.status ? <p className="muted">Bibliographie en cours de recherche (Open Library)…</p> : a.status === 'none' ? <p className="muted">Open Library ne connaît pas cet auteur sous ce nom.</p> : null}
        <div className="m-grid books">{works.map((w) => <WorkTile key={w.key || w.itemId} w={{ ...w, author: a.name }} request={a.request} />)}</div>
      </div>
    </main>
  );
}

export function booksAddSheet() {
  openSheet('Ajouter un livre', (close) => <BookSearch close={close} />, { wide: true });
}
function BookSearch({ close }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => { setBusy(true); try { setRes(await api(`/api/books/search?q=${encodeURIComponent(q.trim())}`)); } catch (e) { toast(e.message, true); } finally { setBusy(false); } }, 350);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="req-sheet">
      <input className="input" autoFocus placeholder="Titre ou auteur…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un livre" />
      {busy ? <p className="muted">Recherche…</p> : null}
      {res && res.length ? <div className="req-list">{res.map((b) => (
        <div key={b.id} className="req-row">
          <span className="req-pic book">{b.poster ? <img src={b.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Placeholder title={b.title} />}</span>
          <div className="req-txt"><b>{b.title}</b><small>{[b.author, b.date ? dateFr(String(b.date)) : null, b.inVenus ? 'Déjà sur le NAS' : null].filter(Boolean).join(' · ')}</small>{b.overview ? <p>{b.overview}</p> : null}</div>
          {b.inVenus ? <button className="btn btn-ghost btn-small f" onClick={() => { close(); go('/livres'); }}>Lire</button> : <AskBtn requested={b.requested} onAsk={() => api('/api/books/request', { method: 'POST', body: { id: b.id, title: b.title, author: b.author || '' } })} />}
        </div>))}</div> : res && !busy ? <p className="muted">Rien trouvé pour « {q} ».</p> : null}
    </div>
  );
}
