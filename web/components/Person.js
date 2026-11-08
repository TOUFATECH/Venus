'use client';
// Une personne (acteur, réalisateur, équipe) : photo, ses titres dans la médiathèque, et le reste de sa
// filmographie, à mettre en favori (téléchargé automatiquement) ou à télécharger tout de suite.
import { useEffect, useState } from 'react';
import { shared } from '../lib/shared';
import { api, toast, img, openSheet } from '../lib/hooks';
import Card from './Card';
import { Icon } from './Icon';

export function openPerson(p) {
  const s = openSheet(p.name, (close) => <PersonSheet p={p} close={close} />, { wide: true });
  const onNav = () => s.close();
  window.addEventListener('vn:navigate', onNav, { once: true });
  return s;
}

function PersonSheet({ p, close }) {
  const [inLib, setInLib] = useState(null);
  const [libErr, setLibErr] = useState(null);
  const [films, setFilms] = useState(null);
  const [filmsErr, setFilmsErr] = useState(null);
  useEffect(() => {
    api(`/api/people?name=${encodeURIComponent(p.name)}`).then(setInLib).catch((e) => setLibErr(e.message));
    api(`/api/people/films?name=${encodeURIComponent(p.name)}`).then(setFilms).catch((e) => setFilmsErr(e.message));
  }, [p.name]);
  const out = films ? films.items.filter((x) => !x.nas) : [];
  return (
    <div>
      <div className="person-head">
        {p.photo ? <img src={img(p.photo)} alt="" className="person-photo" /> : null}
        <div>
          {p.role ? <p className="muted">{p.role}</p> : null}
          <p className="person-links">
            <a href={`https://www.themoviedb.org/search/person?query=${encodeURIComponent(p.name)}`} target="_blank" rel="noopener">Voir sur TMDB</a>{' · '}
            <a href={`https://www.imdb.com/fr/find/?q=${encodeURIComponent(p.name)}&s=nm`} target="_blank" rel="noopener">IMDb</a>
          </p>
        </div>
      </div>
      <h3 className="person-sub">Dans votre médiathèque</h3>
      <div className="grid person-grid" onClickCapture={(e) => { if (e.target.closest('.card')) close(); }}>
        {libErr ? <p className="error-text">{libErr}</p>
          : !inLib ? <p className="grid-empty">Recherche dans votre médiathèque…</p>
            : inLib.length ? inLib.map((i) => <Card key={i.id} item={i} poster />)
              : <p className="grid-empty">Aucun autre titre avec cette personne dans votre médiathèque.</p>}
      </div>
      <h3 className="person-sub">Autres films et séries</h3>
      <div className="grid person-grid person-out">
        {filmsErr ? <p className="error-text">{filmsErr}</p>
          : !films ? <p className="grid-empty">Recherche de sa filmographie…</p>
            : !out.length ? <p className="grid-empty">{films.error || 'Rien d’autre de connu, ou tout est déjà dans votre médiathèque.'}</p>
              : out.map((x) => <OutFilm key={x.key} x={x} f={films} />)}
      </div>
    </div>
  );
}

// Titre absent du NAS : favori (téléchargé dès que possible) ou téléchargement tout de suite (Radarr / Sonarr)
export function OutFilm({ x, f }) {
  const appName = x.kind === 'movie' ? 'Radarr' : 'Sonarr';
  const on = x.kind === 'movie' ? f.radarr : f.sonarr;
  const [wanted, setWanted] = useState(!!x.wanted);
  const [dl, setDl] = useState('idle');
  const [picOk, setPicOk] = useState(!!x.poster);
  const body = { key: x.key, kind: x.kind, title: x.title, year: x.year || undefined, poster: x.poster, date: x.date || undefined };
  const fav = async () => {
    try {
      if (wanted) { await api(`/api/wanted?key=${encodeURIComponent(x.key)}`, { method: 'DELETE' }); setWanted(false); toast('Retiré de vos favoris'); }
      else { const r = await api('/api/wanted', { method: 'POST', body: { ...body, download: true } }); setWanted(true); toast(r.sent && !r.sent.error ? `« ${x.title} » en favori : le téléchargement est lancé` : `« ${x.title} » ajouté à vos favoris`, { type: 'success' }); }
    } catch (e) { toast(e.message, true); }
  };
  const grab = async () => {
    setDl('busy');
    try { const r = await api('/api/wanted/grab', { method: 'POST', body }); setDl('done'); toast(r.already ? `« ${r.title} » est déjà suivi par ${appName}` : `« ${r.title} » ajouté à ${appName}`, { type: 'success' }); }
    catch (e) { setDl('idle'); toast(e.message, true); }
  };
  return (
    <div className="up-sug person-film">
      <div className="up-sug-pic">{picOk ? <img src={x.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setPicOk(false)} /> : <div className="up-ph"><span>{x.title}</span></div>}</div>
      {f.kids ? null : (
        <div className="up-acts">
          <button type="button" className={`up-act fav f${wanted ? ' on' : ''}`} title={wanted ? 'Retirer des favoris' : `Favori : téléchargé automatiquement${on ? ` par ${appName}` : ''}`} aria-label={`Favori : ${x.title}`} onClick={fav}><Icon name="heart" /></button>
          {on ? <button type="button" className={`up-act dl f${dl === 'done' ? ' done' : ''}`} disabled={dl !== 'idle'} title={`Télécharger avec ${appName}`} aria-label={`Télécharger ${x.title}`} onClick={grab}><Icon name={dl === 'done' ? 'check' : 'download'} /></button> : null}
        </div>
      )}
      <b>{x.title}</b>
      <small>{[x.kind === 'movie' ? 'Film' : 'Série', x.year].filter(Boolean).join(' · ')}</small>
    </div>
  );
}

// Photos manquantes (équipe surtout) : demandées au serveur par lots (TVmaze, Wikidata)
const queue = new Map();
let timer = 0;
export function wantPhoto(name, cb) {
  if (!queue.has(name)) queue.set(name, []);
  queue.get(name).push(cb);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const batch = new Map(queue); queue.clear();
    const names = [...batch.keys()];
    for (let i = 0; i < names.length; i += 24) {
      const part = names.slice(i, i + 24);
      let r = {};
      try { r = await api(`/api/people/photos?names=${encodeURIComponent(part.join('|'))}`); } catch { continue; }
      for (const n of part) if (r[n]) for (const f of batch.get(n)) f(r[n]);
    }
  }, 60);
}

// Carte d'une personne : visage (ou initiales), nom, rôle
export function PersonCard({ p }) {
  const { ui } = shared();
  const [photo, setPhoto] = useState(p.photo || null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!p.photo && !window.__VN_PREVIEW) wantPhoto(p.name, setPhoto); }, [p.name]);
  const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  return (
    <button className="person f" onClick={() => openPerson({ ...p, photo: p.photo || photo })}>
      <div className={`face${loaded ? ' has-img' : ''}`} style={{ '--h': ui.hueOf(p.name) }}>
        {initials}
        {photo ? <img src={img(photo)} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setPhoto(null)} /> : null}
      </div>
      <b>{p.name}</b>
      {p.role ? <span>{p.role}</span> : null}
    </button>
  );
}
