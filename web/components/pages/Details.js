'use client';
// Fiche d'un film, d'une série, d'un animé ou d'un clip : bande-annonce en fond, lecture / reprise, versions,
// notes des sites, saisons et épisodes, distribution et équipe (avec photos), à propos, fiche technique,
// emplacement sur le NAS, bonus, saga, titres proches et « Avec (acteur) ».
import { useEffect, useMemo, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon, Avatar } from '../Icon';
import { Picture, FramePoster, FrameImage, Placeholder } from '../Card';
import Ratings from '../Ratings';
import { Row, ScrollRow } from '../Row';
import { PersonCard, openPerson } from '../Person';
import { openDownload } from './Downloads';
import { addToSheet } from './Collections';

const LIB = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips' };
const libOf = (d) => LIB[d.category] || LIB[d.type] || '/films';
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtSize = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const fmtRate = (b) => (!b ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mb/s` : `${Math.round(b / 1e3)} kb/s`);
const chLabel = (n) => (n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? 'Stéréo' : n === 1 ? 'Mono' : `${n} canaux`);
const STATUS = { 'Returning Series': 'En cours de diffusion', Ended: 'Terminée', Canceled: 'Annulée', 'In Production': 'En production', Planned: 'Prévue', Released: 'Sorti', 'Post Production': 'En post-production' };
let regionNames = null;
const country = (c) => { try { regionNames = regionNames || new Intl.DisplayNames(['fr'], { type: 'region' }); return regionNames.of(c); } catch { return c; } };
const refresh = () => shared().app.hostHooks.refresh();
const isSeen = (e) => !!(e.progress && e.progress.watched);
const seasonName = (s) => s.title || (s.number === 0 ? 'Bonus' : `Saison ${s.number}`);

export default function Details({ id }) {
  const { app } = shared();
  const from = useRef(app.currentUrl());
  const { data: d, error } = useApi(id ? `/api/items/${id}` : null);
  useEffect(() => {
    if (!d) return;
    app.setTitle(d.title);
    app.showPath(d.path, ['ep'], from.current);
    shared().imp('ambiance.js').then((m) => m.tintFrom(img(d.backdrop || d.poster))).catch(() => {});
  }, [d]);
  if (error) return <main className="with-nav"><div className="page"><div className="empty"><h2>Impossible d’afficher cette fiche</h2><p>{error.message}</p><button className="btn f" onClick={refresh}>Réessayer</button></div></div></main>;
  if (!d) return <main className="with-nav"><DetailsSkeleton /></main>;
  return <main className="with-nav page-in"><DetailsView d={d} /></main>;
}

function DetailsSkeleton() {
  const bar = (w, hgt = 14) => <i className="sk" style={{ width: w, height: hgt }} />;
  return <div className="page sk-details" aria-busy="true"><i className="sk sk-poster" /><div>{bar('60%', 56)}{bar('30%')}{bar('80%')}{bar('70%')}<div className="sk-actions">{bar(170, 48)}{bar(48, 48)}</div></div></div>;
}

function DetailsView({ d: initial }) {
  const L = shared();
  const { app, ui, components } = L;
  const { search } = useVenus();
  const [d, setD] = useState(initial);
  useEffect(() => setD(initial), [initial]);
  const profile = app.state.profile;
  const isShow = d.type === 'show';
  const isClip = d.type === 'clip';
  const cr = d.credits || {};
  const root = useRef(null);
  const bgRef = useRef(null);
  const bt = useRef(null); // bande-annonce de fond (mise en pause pendant la grande bande-annonce)

  const showDone = isShow && d.seasons.length && d.seasons.every((s) => s.episodes.every(isSeen));
  const firstEp = isShow && d.seasons.length ? (d.seasons.find((s) => s.number > 0) || d.seasons[0]).episodes[0] : null;
  const target = isShow ? (showDone ? firstEp : d.nextUp) : d;
  const prog = target && target.progress;
  const resumable = prog && !prog.watched && prog.position > 20;
  const remaining = resumable && prog.duration ? Math.round((prog.duration - prog.position) / 60) : 0;
  let label = 'Lecture';
  if (isShow && target) label = showDone ? 'Revoir depuis le début' : `${resumable ? 'Reprendre' : 'Lecture'} S${target.season} É${target.episode}`;
  else if (resumable) label = `Reprendre (${remaining} min restantes)`;

  // Plusieurs versions (4K, 1080p, version longue) : choix mémorisé sur cet appareil
  const vKey = `vn_version_${d.id}`;
  const [versionId, setVersionId] = useState(() => {
    let v = target && target.id;
    if (!isShow && d.versions && d.versions.length > 1) { try { const x = Number(localStorage.getItem(vKey)); if (d.versions.some((y) => y.id === x)) v = x; } catch { /* */ } }
    return v;
  });
  const playId = isShow ? target && target.id : versionId;

  // Heure de fin, mise à jour toutes les 30 s
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const total = target ? target.duration || (target.runtime ? target.runtime * 60 : 0) : 0;
  const endPos = target && target.progress && !target.progress.watched ? target.progress.position || 0 : 0;

  const [inList, setInList] = useState(!!d.inList);
  const toggleList = async () => {
    const r = await api(`/api/items/${d.id}/mylist`, { method: 'POST' });
    setInList(r.inList);
    ui.toast(r.inList ? (r.follows ? 'Ajouté à ma liste : chaque nouvelle saison sera demandée à Seerr' : 'Ajouté à ma liste') : 'Retiré de ma liste',
      { type: r.inList ? 'success' : 'info', action: { label: 'Annuler', onClick: toggleList } });
  };
  const allWatched = isShow ? d.seasons.every((s) => s.episodes.every(isSeen)) : prog && prog.watched;
  const toggleWatched = async () => {
    const set = async (w) => { await api(`/api/items/${d.id}/watched`, { method: 'POST', body: { watched: w } }); refresh(); };
    await set(!allWatched);
    const what = isShow ? (d.seasons.length > 1 ? `Les ${d.seasons.length} saisons` : 'Toute la série') : d.title;
    toast(allWatched ? `${what} : marqué comme non vu` : `${what} : marqué comme vu`, { type: 'success', action: { label: 'Annuler', onClick: () => set(allWatched) } });
  };
  const openTrailer = async () => {
    const t = await L.imp('trailer.js');
    if (bt.current) bt.current.hold();
    t.playTrailer(d.trailer, d.title, { onClose: () => bt.current && bt.current.release() });
  };
  const [trSearch, setTrSearch] = useState(false);
  const findTrailer = async () => {
    setTrSearch(true);
    try {
      const r = await api(`/api/items/${d.id}/trailer`, { method: 'POST' });
      if (r.trailer) { setD((x) => ({ ...x, trailer: r.trailer })); setTrSearch(false); const t = await L.imp('trailer.js'); t.playTrailer(r.trailer, d.title); return; }
    } catch { /* */ }
    setTrSearch(false);
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${d.title} ${d.year || ''} bande-annonce`)}`, '_blank', 'noopener');
  };
  const chooseVersion = () => {
    const s = openSheet('Version', (close) => (
      <div>
        {d.versions.map((x) => (
          <button key={x.id} className={`opt f${x.id === versionId ? ' on' : ''}`} onClick={() => {
            setVersionId(x.id); try { localStorage.setItem(vKey, String(x.id)); } catch { /* */ }
            close(); toast(`Version ${x.quality} ${x.detail ? `· ${x.detail}` : ''}`);
          }}><Icon name="check" />{x.quality || 'Version'}<small>{x.detail}</small></button>
        ))}
      </div>
    ));
    return s;
  };
  const moreOptions = () => {
    const admin = profile.isAdmin;
    openSheet(d.title, (close) => (
      <div>
        <button className="opt ic f" onClick={() => { close(); addToSheet(d); }}><Icon name="list" />Ajouter à une liste de lecture<small>{admin ? 'ou à une collection' : ''}</small></button>
        {admin ? <button className="opt ic f" onClick={() => { close(); editInfo(d); }}><Icon name="edit" />Modifier les infos<small>Titre, résumé, année, genres, âge</small></button> : null}
        {admin && !isClip ? <button className="opt ic f" onClick={() => { close(); chooseImages(d); }}><Icon name="grid4" />Choisir les images<small>Affiche, fond, logo (TMDB, Trakt)</small></button> : null}
        {admin && !isClip ? <button className="opt ic f" onClick={() => { close(); fixMatch(d); }}><Icon name="search" />Corriger l’identification<small>Ce n’est pas le bon titre</small></button> : null}
      </div>
    ));
  };
  const nEps = isShow ? d.seasons.reduce((n, s) => n + s.episodes.length, 0) : 0;
  const delVideo = () => {
    const size = !isShow && d.file && d.file.size ? d.file.size : 0;
    components.deleteVideo({
      id: d.id, what: isShow ? `la série « ${d.title} »` : `« ${d.title} »`,
      detail: isShow ? `Les ${nEps} épisode${nEps > 1 ? 's' : ''} de toutes les saisons seront supprimés.` : size ? `Place libérée : ${fmtSize(size)}.` : '',
      onDone: () => go(libOf(d), { replace: true }),
    });
  };
  const noDownload = profile.perms && profile.perms.download === false;

  // Résumé : « Lire la suite » quand il est coupé
  const ov = useRef(null);
  const [clamp, setClamp] = useState(true);
  const [long, setLong] = useState(false);
  useEffect(() => { requestAnimationFrame(() => { if (ov.current) setLong(ov.current.scrollHeight > ov.current.clientHeight + 2); }); }, [d.overview]);

  const age = ui.ageBadge(d);
  const amb = useAmbient(d.poster && !isClip ? img(d.poster, 185) : d.backdrop ? img(d.backdrop, 300) : null);
  return (
    <div className={`details${amb ? ' amb' : ''}`} ref={root} style={amb ? { '--amb': amb } : undefined}>
      <div className="details-bg" ref={bgRef}>
        {d.backdrop ? <Picture src={img(d.backdrop, 1280)} title={d.title} lazy={false} /> : <img src={`/api/items/${d.id}/thumb?size=big`} alt="" />}
      </div>
      {d.trailer ? <BackdropTrailer d={d} bgRef={bgRef} rootRef={root} apiRef={bt} /> : null}
      <div className="details-body">
        <div className="details-top">
          <div className={`details-poster${isClip ? ' wide' : ''}`}>
            {d.poster && !isClip ? <Picture src={img(d.poster)} title={d.title} lazy={false} /> : isClip ? <FrameImage id={d.id} title={d.title} /> : <FramePoster item={d} />}
          </div>
          <div className="details-main">
            {d.logo ? <img className="hero-logo" src={img(d.logo)} alt={d.title} /> : <h1 className="hero-title">{d.title}</h1>}
            <div className="meta">
              {age ? <span className="badge age">{age.textContent}</span> : null}
              {d.year ? <span>{d.year}</span> : null}
              {d.vote && !(d.ratings && d.ratings.score) ? <span>{`${d.vote.toFixed(1).replace('.', ',')}/10`}</span> : null}
              {!isShow && d.runtime ? <span>{ui.fmtRuntime(d.runtime)}</span> : null}
              {isShow ? <span>{`${d.seasons.length} saison${d.seasons.length > 1 ? 's' : ''}, ${nEps} épisode${nEps > 1 ? 's' : ''}`}</span> : null}
              {target && !(isShow && !d.nextUp) && total ? <span className="ends-at">{`Se termine à ${hhmm(now + (total - endPos) * 1000)}`}</span> : null}
            </div>
            {d.genres && d.genres.length ? <div className="genre-links">{d.genres.map((g) => <button key={g} className="tag f" onClick={() => go(`${libOf(d)}?genre=${encodeURIComponent(g)}`)}>{g}</button>)}</div> : null}
            <Ratings ratings={d.ratings} links={d.links} />
            {d.tagline ? <p className="tagline">{d.tagline}</p> : null}
            {d.overview ? <p ref={ov} className={`hero-overview${clamp ? ' clamp' : ''}`}>{d.overview}</p> : null}
            {d.overview && long ? <button className="linkish f" onClick={() => setClamp(!clamp)}>{clamp ? 'Lire la suite' : 'Réduire'}</button> : null}
            <div className="actions">
              {target ? <button className="btn btn-play f" data-autofocus="true" onClick={() => go(components.playPath(playId))}><Icon name="play" />{label}</button> : null}
              {target && resumable ? <button className="btn btn-ghost btn-icon f" aria-label="Recommencer depuis le début" title="Recommencer" onClick={() => go(components.playPath(playId, 0))}><Icon name="restart" /></button> : null}
              {target ? <button className="btn btn-ghost btn-icon f" aria-label="Envoyer vers un autre écran" title="Envoyer vers la télé" onClick={() => components.sendTo({ id: playId, title: d.title })}><Icon name="cast" /></button> : null}
              {!isShow && d.versions && d.versions.length > 1 ? <button className="btn btn-ghost f" title="Choisir la version" onClick={chooseVersion}><Icon name="film" /><span>{(d.versions.find((x) => x.id === versionId) || d.versions[0]).quality || 'Version'}</span></button> : null}
              {d.trailer ? <button className="btn btn-ghost f" onClick={openTrailer}><Icon name="film" />Bande-annonce</button>
                : !isClip ? <button className="btn btn-ghost f" title="Chercher la bande-annonce sur YouTube" disabled={trSearch} onClick={findTrailer}><Icon name="film" />{trSearch ? 'Recherche…' : 'Bande-annonce'}</button> : null}
              <button className="btn btn-ghost btn-icon f" aria-label={inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'} title="Ma liste" onClick={toggleList}><Icon name={inList ? 'check' : 'plus'} /></button>
              <button className={`btn btn-ghost btn-icon f${allWatched ? ' is-on' : ''}`} aria-label={allWatched ? 'Marquer comme non vu' : 'Marquer comme vu'} title={allWatched ? 'Vu : marquer comme non vu' : 'Marquer comme vu'} aria-pressed={String(!!allWatched)} onClick={toggleWatched}><Icon name="eye" /></button>
              {!isShow && !noDownload ? <button className="btn btn-ghost btn-icon f" aria-label="Télécharger pour regarder sans réseau" title="Télécharger" onClick={() => openDownload({ id: d.id, title: d.title, size: d.file && d.file.size, duration: d.duration || (d.runtime ? d.runtime * 60 : 0) })}><Icon name="down" /></button> : null}
              <button className="btn btn-ghost btn-icon f" aria-label="Plus d’options" title="Ajouter à une liste, modifier…" onClick={moreOptions}><Icon name="more" /></button>
              {profile.isAdmin ? <button className="btn btn-ghost btn-icon btn-del f" aria-label={isShow ? 'Supprimer la série' : 'Supprimer la vidéo'} title={isShow ? 'Supprimer la série (fichiers effacés)' : 'Supprimer la vidéo (fichier effacé)'} onClick={delVideo}><Icon name="trash" /></button> : null}
            </div>
            <ScreenTimeNote d={d} target={target} isShow={isShow} />
            <ResumeNote d={d} isShow={isShow} />
            <WatchedBy list={d.watchedBy} />
            {(isShow && showDone) || (!isShow && d.progress && d.progress.watched) ? <Opinion d={d} /> : null}
            {d.subWarnings && d.subWarnings.length ? (
              <p className="resume-note warn"><Icon name="subs" />{` Sous-titres probablement décalés : ${d.subWarnings.map((x) => x.file).join(', ')} (${d.subWarnings[0].ratio > 1 ? 'plus long' : 'plus court'} que la vidéo de ${Math.round(Math.abs(1 - d.subWarnings[0].ratio) * 100)} %). Ils viennent sans doute d’une autre version du film.`}</p>
            ) : null}
          </div>
        </div>
        {isShow && d.seasons.length ? <Seasons d={d} setD={setD} showDone={showDone} wantEp={Number(search && search.get('ep')) || null} /> : null}
        <Cast cr={cr} />
        <About d={d} cr={cr} isShow={isShow} />
        {d.extras && d.extras.length ? (
          <section className="d-section">
            <h2 className="section-title">{`Bonus (${d.extras.length})`}</h2>
            <ScrollRow className="extras-row">
              {d.extras.map((x) => (
                <button key={x.id} className="extra f" onClick={() => go(components.playPath(x.id, 0))}>
                  <span className="thumb"><ThumbImg src={x.still ? img(x.still) : `/api/items/${x.id}/thumb`} title={x.title} /><span className="ep-play"><Icon name="play" /></span></span>
                  <small>{[x.kindLabel, x.duration ? `${Math.max(1, Math.round(x.duration / 60))} min` : null].filter(Boolean).join(' · ')}</small>
                  <b>{x.title}</b>
                </button>
              ))}
            </ScrollRow>
          </section>
        ) : null}
        {d.saga && d.saga.items.length > 1 ? <div className="d-similar"><Row r={{ title: `Saga : ${d.saga.name.replace(/ - (Saga|Collection)$|^Saga /i, '')}`, items: d.saga.items }} /></div> : null}
        {d.similar && d.similar.length ? <div className="d-similar"><Row r={{ title: isClip ? 'Autres clips' : 'Plus de ce genre', items: d.similar }} /></div> : null}
        {(d.withCast || []).map((r) => (
          <div key={r.name} className="d-similar d-withcast" onClickCapture={(e) => { if (e.target.closest('.row-head h2')) { e.stopPropagation(); openPerson(r); } }}>
            <Row r={{ title: `Avec ${r.name}`, items: r.items }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ThumbImg({ src, title }) {
  const [ok, setOk] = useState(true);
  return ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} /> : <Placeholder title={title} />;
}

// Temps d'écran : prévenir avant de lancer plutôt que couper au milieu
// Teinte de la fiche : couleur dominante de l'affiche (moyenne des pixels assez colorés, sur une petite image)
const ambCache = new Map();
function useAmbient(src) {
  const [c, setC] = useState(() => (src && ambCache.get(src)) || null);
  useEffect(() => {
    if (!src || !/^\/img\//.test(src)) { setC(null); return undefined; } // images d'ailleurs : illisibles pour le canevas
    if (ambCache.has(src)) { setC(ambCache.get(src)); return undefined; }
    let dead = false;
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      if (dead) return;
      try {
        const cv = document.createElement('canvas'); cv.width = 24; cv.height = 36;
        const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 36);
        const px = x.getImageData(0, 0, 24, 36).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          const R = px[i], G = px[i + 1], B = px[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          if (mx < 40 || mx - mn < 28) continue; // trop sombre ou trop gris
          const w = (mx - mn) / 255; r += R * w; g += G * w; b += B * w; n += w;
        }
        if (n < 1) { ambCache.set(src, null); return; }
        // Couleur assombrie pour garder le texte lisible
        const k = 0.55 / Math.max(1, Math.max(r, g, b) / n / 160);
        const v = `${Math.round((r / n) * k)} ${Math.round((g / n) * k)} ${Math.round((b / n) * k)}`;
        ambCache.set(src, v); setC(v);
      } catch { /* image non lisible */ }
    };
    im.src = src;
    return () => { dead = true; };
  }, [src]);
  return c;
}

function ScreenTimeNote({ d, target, isShow }) {
  const left = shared().app.state.profile.dailyLeft;
  const need = isShow ? (target && target.runtime) || (d.nextUp && d.nextUp.runtime) || 0 : d.runtime || 0;
  if (left == null || !need) return null;
  if (left <= 0) return <p className="resume-note warn"><Icon name="clock" /> Temps d’écran du jour épuisé : la lecture reprendra demain.</p>;
  if (need > left) return <p className="resume-note warn"><Icon name="clock" />{` Il reste ${left} min de temps d’écran aujourd’hui : ${isShow ? 'cet épisode' : 'ce film'} (${need} min) sera coupé avant la fin.`}</p>;
  const eps = isShow && target ? Math.floor(left / need) : 0;
  return eps >= 1 && eps < 4 ? <p className="resume-note"><Icon name="clock" />{` Il reste ${left} min de temps d’écran : ${eps} épisode${eps > 1 ? 's' : ''} possible${eps > 1 ? 's' : ''}.`}</p> : null;
}

// « Vu jusqu'à 42 min sur l'iPhone, hier »
function ResumeNote({ d, isShow }) {
  const { ui } = shared();
  const last = isShow ? d.lastWatch : (d.progress && d.progress.position > 20 && !d.progress.watched ? d.progress : null);
  if (!last || !last.updated) return null;
  const iso = new Date(last.updated).toISOString();
  const ds = ui.daysSince(iso);
  const when = ds === 0 ? `à ${new Date(last.updated).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ds === 1 ? 'hier' : `le ${ui.fmtDate(iso.slice(0, 10), false)}`;
  const browser = /^(Chrome|Firefox|Safari|Edge|Opera)/;
  const where = last.device ? ` sur ${/^(la |l’)/.test(last.device) ? last.device : last.device.replace(browser, 'l’ordinateur ($1')}${browser.test(last.device) ? ')' : ''}` : '';
  const mins = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;
  const upTo = !isShow && d.progress ? `jusqu’à ${mins(d.progress.position)}` : isShow && d.nextUp && d.nextUp.progress && d.nextUp.progress.position > 20 ? `S${d.nextUp.season} É${d.nextUp.episode}, ${mins(d.nextUp.progress.position)}` : null;
  return <p className="resume-note"><Icon name="clock" />{` ${upTo ? `Vu ${upTo}` : 'Dernière lecture'}${where}, ${when}`.replace(/\.$/, '')}</p>;
}

// Qui l'a déjà vu dans la maison
function WatchedBy({ list }) {
  if (!list || !list.length) return null;
  const names = list.map((x) => x.name);
  return (
    <p className="watched-by">
      <span className="wb-avatars">{list.slice(0, 6).map((x) => <Avatar key={x.id || x.name} profile={x} cls="tiny" />)}</span>
      <span>{`Déjà vu par ${names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' et $1') : `${names.slice(0, 2).join(', ')} et ${names.length - 2} autres`}`}</span>
    </p>
  );
}

// « J'ai aimé / bof »
function Opinion({ d }) {
  const [cur, setCur] = useState(d.opinion);
  const set = async (liked) => { try { await api(`/api/items/${d.id}/opinion`, { method: 'POST', body: { liked } }); setCur(liked == null ? null : liked ? 1 : -1); } catch (e) { toast(e.message, true); } };
  return (
    <div className="opinion">
      <span>Votre avis</span>
      <button className={`chip small f${cur === 1 ? ' on' : ''}`} onClick={() => set(cur === 1 ? null : true)}><Icon name="heart" />J’ai aimé</button>
      <button className={`chip small f${cur === -1 ? ' on' : ''}`} onClick={() => set(cur === -1 ? null : false)}>Bof</button>
    </div>
  );
}

// ---------------------------------------------------------------- saisons et épisodes
function Seasons({ d: full, setD, showDone, wantEp }) {
  const L = shared();
  const { app, ui, components, api: A } = L;
  // Saisons absentes des dossiers (montrées avec leurs épisodes manquants), sauf si on a choisi de les cacher
  const d = L.api.prefs.get('showMissing') === false || !(full.absentSeasons && full.absentSeasons.length) ? full
    : { ...full, seasons: [...full.seasons, ...full.absentSeasons].sort((a, b) => (a.number === 0) - (b.number === 0) || a.number - b.number) };
  const profile = app.state.profile;
  const memoKey = `vn_season_${d.id}`;
  const [filter, setFilter] = useState('all');
  const fromPlayer = wantEp && d.seasons.find((s) => s.episodes.some((e) => e.id === wantEp));
  const [curId, setCurId] = useState(() => {
    let remembered = null;
    try { remembered = d.seasons.find((s) => String(s.id) === sessionStorage.getItem(memoKey)); } catch { /* */ }
    return (fromPlayer || remembered || d.seasons.find((s) => d.nextUp && s.episodes.some((e) => e.id === d.nextUp.id)) || d.seasons.find((s) => !s.absent) || d.seasons[0]).id;
  });
  const [focusId, setFocusId] = useState(fromPlayer ? wantEp : null);
  const cur = d.seasons.find((s) => s.id === curId) || d.seasons[0];
  const bar = useRef(null);
  const list = useRef(null);
  const showSeason = (s, focus = null) => { setCurId(s.id); setFocusId(focus); try { sessionStorage.setItem(memoKey, String(s.id)); } catch { /* */ } };
  const step = (dir) => { const i = d.seasons.indexOf(cur); showSeason(d.seasons[(i + dir + d.seasons.length) % d.seasons.length]); };
  useEffect(() => { requestAnimationFrame(() => bar.current && bar.current.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' })); }, [curId]);
  useEffect(() => {
    if (!focusId) return;
    const el = list.current && list.current.querySelector('.episode.is-current');
    if (el) setTimeout(() => { el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); L.nav.focusEl(el); }, 350);
  }, [focusId, curId]);

  // Vu / non vu : affiché tout de suite, annulable
  const setLocal = (ids, w, before = null) => setD((x) => ({ ...x, seasons: x.seasons.map((s) => ({ ...s, episodes: s.episodes.map((e, i) => (ids.includes(e.id) ? { ...e, progress: before ? before[ids.indexOf(e.id)] : w ? { ...(e.progress || {}), position: 0, watched: true } : undefined } : e)) })) }));
  const markEpisode = async (e, w) => {
    const before = [e.progress];
    setLocal([e.id], w);
    try { await A.api(`/api/items/${e.id}/watched`, { method: 'POST', body: { watched: w } }); }
    catch (err) { setLocal([e.id], w, before); ui.toast(err.message, true); return; }
    ui.toast(`É${e.episode} « ${e.title} » ${w ? 'vu' : 'non vu'}`, { type: 'success', action: { label: 'Annuler', onClick: () => markEpisode(e, !w) } });
  };
  const markSeason = async (s, w) => {
    const ids = s.episodes.map((e) => e.id);
    const before = s.episodes.map((e) => e.progress);
    setLocal(ids, w);
    try { await A.api(`/api/items/${s.id}/watched`, { method: 'POST', body: { watched: w } }); }
    catch (err) { setLocal(ids, w, before); ui.toast(err.message, true); return; }
    const nextS = d.seasons[d.seasons.indexOf(s) + 1];
    ui.toast(`${seasonName(s)} ${w ? 'vue en entier' : 'marquée non vue'}`, { type: 'success',
      action: w && nextS ? { label: `${seasonName(nextS)} →`, onClick: () => showSeason(nextS) } : { label: 'Annuler', onClick: async () => {
        setLocal(ids, w, before);
        for (const [i, e] of s.episodes.entries()) await A.api(`/api/items/${e.id}/watched`, { method: 'POST', body: { watched: !!(before[i] && before[i].watched) } }).catch(() => {});
      } } });
  };

  // « À suivre » : l'image lance l'épisode, son nom mène à l'épisode dans sa saison
  const nu = d.nextUp && !showDone ? d.nextUp : null;
  const nuSeason = nu && d.seasons.find((s) => s.episodes.some((e) => e.id === nu.id));
  const np = nu && nu.progress;
  const nuPct = np && np.duration && !np.watched ? Math.min(100, (np.position / np.duration) * 100) : 0;
  const nuLabel = nu ? `S${nu.season}:É${nu.episode} - ${nu.title}` : '';

  const seen = cur.episodes.filter(isSeen).length, total = cur.episodes.length, all = seen === total && total > 0;
  const next = cur.episodes.find((e) => !isSeen(e)) || cur.episodes[0];
  const mins = Math.round(cur.episodes.reduce((n, e) => n + (e.runtime ? e.runtime * 60 : e.duration || 0), 0) / 60);
  const shown = cur.episodes.filter((e) => filter === 'all' || (filter === 'unseen' ? !isSeen(e) : isSeen(e)));
  // Épisodes diffusés mais absents des dossiers, à leur place dans l'ordre
  const rows = shown.map((e) => ({ n: e.episode, el: <EpisodeRow key={e.id} e={e} current={e.id === focusId} onToggle={(w) => markEpisode(e, w)} /> }));
  if (filter === 'all' && L.api.prefs.get('showMissing') !== false && cur.missing) {
    for (const m of cur.missing) {
      rows.push({ n: m.number - 0.5, el: (
        <div key={`m${m.number}`} className={`episode missing${m.future ? ' future' : ''}`} data-ep={m.number} title={`Épisode ${m.number}${m.title ? ` — ${m.title}` : ''} : ${m.future ? (m.air ? `diffusé le ${ui.fmtDate(m.air)}` : 'date de diffusion pas encore connue') : `diffusé${m.air ? ` le ${ui.fmtDate(m.air)}` : ''}, mais pas dans vos dossiers`}`}>
          <div className="thumb">{m.still ? <img src={m.still} alt="" loading="lazy" /> : <span className="miss-num">{m.number}</span>}<span className="miss-tag">{m.future ? 'À venir' : 'Manquant'}</span></div>
          <div className="ep-line"><b>{`Épisode ${m.number}${m.title && !/^(TBA|TBD|Episode \d+|Épisode \d+)$/i.test(m.title) ? ` · ${m.title}` : ''}`}</b>{m.air ? <span>{m.future ? `Le ${ui.fmtDate(m.air)}` : ui.fmtDate(m.air)}</span> : m.future ? <span>Date à venir</span> : null}</div>
        </div>
      ) });
    }
    rows.sort((a, b) => a.n - b.n);
  }
  const idx = d.seasons.indexOf(cur);
  const nextS = d.seasons.length > 1 ? d.seasons[(idx + 1) % d.seasons.length] : null;

  return (
    <>
      {nu ? (
        <section className="d-section next-up">
          <h2 className="section-title">{nuPct ? 'Reprendre' : 'À suivre'}</h2>
          <div className="nu-card">
            <button className="nu-shot f" aria-label={`Lire ${nuLabel}`} onClick={() => go(components.playPath(nu.id))}>
              <ThumbImg src={nu.still ? img(nu.still, 780) : `/api/items/${nu.id}/thumb`} title={nu.title} />
              <span className="ep-play"><Icon name="play" /></span>
              {nuPct ? <div className="bar"><i style={{ width: `${nuPct}%` }} /></div> : null}
            </button>
            <div className="nu-text">
              <a className="nu-link f" href={`/titre/${d.id}?ep=${nu.id}`} title={nuLabel} onClick={(e) => { e.preventDefault(); if (nuSeason) { setFilter('all'); showSeason(nuSeason, nu.id); } }}>{nuLabel}</a>
              <small>{[nuSeason ? (nuSeason.title || `Saison ${nuSeason.number}`) : null, nu.runtime ? `${nu.runtime} min` : null, nuPct && np.duration ? `${Math.max(1, Math.round((np.duration - np.position) / 60))} min restantes` : null].filter(Boolean).join(' · ')}</small>
              {nu.overview ? <p>{nu.overview}</p> : null}
            </div>
          </div>
        </section>
      ) : null}
      <section className="d-section" id="episodes">
        <div className="ep-head">
          <h2 className="section-title">{d.seasons.length > 1 ? `${d.seasons.length} saisons` : 'Épisodes'}</h2>
          {d.seasons.length > 1 ? (
            <div className="season-arrows">
              <button className="season-arrow f" aria-label="Saison précédente" onClick={() => step(-1)}><Icon name="back" /></button>
              <button className="season-arrow f" aria-label="Saison suivante" onClick={() => step(1)}><Icon name="fwd" /></button>
            </div>
          ) : null}
          <div className="chips" role="group" aria-label="Filtrer les épisodes">
            {[['all', 'Tous'], ['unseen', 'Non vus'], ['seen', 'Déjà vus']].map(([fid, lbl]) => <button key={fid} className={`chip small f${fid === filter ? ' on' : ''}`} onClick={() => setFilter(fid)}>{lbl}</button>)}
          </div>
        </div>
        {d.seasons.length > 1 ? (
          <div className="season-bar" role="tablist" aria-label="Saisons" ref={bar}>
            {d.seasons.map((s) => {
              const sn = s.episodes.filter(isSeen).length, st = s.episodes.length, on = s === cur;
              const pic = s.poster || d.poster;
              return (
                <button key={s.id} className={`season-card f${on ? ' on' : ''}${sn === st && st ? ' done' : ''}${s.absent ? ' absent' : ''}`} role="tab" aria-selected={String(on)} data-id={s.id} onClick={() => showSeason(s)}>
                  <span className="season-pic">
                    {pic ? <img src={img(pic, 342)} alt="" loading="lazy" /> : <span className="season-ph">{s.number}</span>}
                    <i className="season-prog"><i style={{ width: `${st ? (sn / st) * 100 : 0}%` }} /></i>
                  </span>
                  <b>{seasonName(s)}</b>
                  <span>{s.absent ? `${s.missing.length} épisode${s.missing.length > 1 ? 's' : ''} · absente` : sn === st && st ? 'Vue en entier' : sn ? `${sn} / ${st} vus` : `${st} épisode${st > 1 ? 's' : ''}`}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="season-head">
          <div className="sh-info"><b>{seasonName(cur)}</b><span>{cur.absent ? `${cur.missing.length} épisode${cur.missing.length > 1 ? 's' : ''}, pas dans vos dossiers` : [`${total} épisode${total > 1 ? 's' : ''}`, cur.missing && cur.missing.length ? `${cur.missing.length} manquant${cur.missing.length > 1 ? 's' : ''} ou à venir` : null, mins ? ui.fmtRuntime(mins) : null, seen && !all ? `${total - seen} à voir` : null].filter(Boolean).join(' · ')}</span></div>
          {cur.absent ? null : <div className="sh-actions">
            {next ? <button className="btn btn-small f" onClick={() => go(components.playPath(next.id))}><Icon name="play" />{all ? 'Revoir la saison' : seen ? `Continuer É${next.episode}` : 'Lire la saison'}</button> : null}
            <button className={`btn btn-small btn-ghost f${all ? ' is-on' : ''}`} onClick={() => markSeason(cur, !all)}><Icon name="eye" />{all ? 'Saison vue' : 'Marquer la saison vue'}</button>
            {profile.perms && profile.perms.download === false ? null : <button className="btn btn-small btn-ghost btn-icon f" aria-label="Télécharger la saison" title="Télécharger la saison" onClick={() => openDownload({ id: cur.id, title: seasonName(cur), season: true })}><Icon name="down" /></button>}
            {profile.isAdmin ? <button className="btn btn-small btn-ghost btn-icon btn-del f" aria-label={`Supprimer ${seasonName(cur)}`} title={`Supprimer ${seasonName(cur)} (fichiers effacés)`} onClick={() => components.deleteVideo({
              id: cur.id, what: `${seasonName(cur).toLowerCase().startsWith('saison') ? 'la ' : ''}${seasonName(cur)}`, detail: `Les ${total} épisode${total > 1 ? 's' : ''} de cette saison seront supprimés.`,
              onDone: (r) => (r.gone && d.seasons.length === 1 ? go(libOf(d), { replace: true }) : refresh()),
            })}><Icon name="trash" /></button> : null}
          </div>}
        </div>
        <div className="episodes" ref={list}>
          {rows.length ? rows.map((r) => r.el) : <p className="grid-empty">{filter === 'unseen' ? 'Tous les épisodes de cette saison sont vus.' : 'Aucun épisode vu dans cette saison.'}</p>}
          {nextS ? (
            <button className="next-season f" onClick={() => { showSeason(nextS); bar.current && bar.current.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
              <span><small>{idx === d.seasons.length - 1 ? 'Reprendre depuis le début' : 'Ensuite'}</small><b>{seasonName(nextS)}</b><em>{`${nextS.absent ? nextS.missing.length : nextS.episodes.length} épisodes${nextS.absent ? ' (absente)' : ''}`}</em></span><Icon name="fwd" />
            </button>
          ) : null}
        </div>
        {d.missingSeasons && d.missingSeasons.length && L.api.prefs.get('showMissing') !== false && !d.seasons.some((x) => x.absent)
          ? <p className="missing-seasons">{`Pas dans vos dossiers : ${d.missingSeasons.map((x) => `${x.title || `Saison ${x.number}`} (${x.count} épisodes)`).join(', ')}.`}</p> : null}
      </section>
    </>
  );
}

// Épisode en vignette compacte : « Épisode 2 » et la durée ; le titre au survol
function EpisodeRow({ e, current, onToggle }) {
  const { ui, components } = shared();
  const p = e.progress;
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const dur = e.runtime || (e.duration ? Math.round(e.duration / 60) : null);
  const seen = !!(p && p.watched);
  const num = `Épisode ${e.episode}${e.episodeEnd ? `–${e.episodeEnd}` : ''}`;
  const isNew = !seen && ((e.released && ui.daysSince(e.released) <= 14) || (!e.released && e.added && Date.now() - e.added < 7 * 864e5));
  return (
    <div className="ep-item">
      <button className={`episode f${current ? ' is-current' : ''}${seen ? ' seen' : ''}`} data-ep={e.episode}
        title={e.title && !/^(É|E)pisode \d+$/i.test(e.title) ? `${num} — ${e.title}` : num}
        aria-label={`${num}${e.title ? `, ${e.title}` : ''}${dur ? `, ${dur} minutes` : ''}${seen ? ', vu' : ''}`}
        onClick={() => go(components.playPath(e.id))}>
        <div className="thumb">
          <ThumbImg src={e.still ? img(e.still) : `/api/items/${e.id}/thumb`} title={`É${e.episode}`} />
          <span className="ep-play"><Icon name="play" /></span>
          {pct > 0 && !seen ? <div className="bar"><i style={{ width: `${pct}%` }} /></div> : null}
          {current ? <span className="ep-badge now">{p && !seen && p.position > 0 ? 'En cours' : 'À suivre'}</span> : isNew ? <span className="ep-badge">Nouveau</span> : null}
        </div>
        <div className="ep-line"><b>{num}</b>{dur ? <span>{`${dur} min`}</span> : null}</div>
      </button>
      <button className={`ep-toggle f${seen ? ' on' : ''}`} aria-label={seen ? `Marquer l’${num.toLowerCase()} comme non vu` : `Marquer l’${num.toLowerCase()} comme vu`} title={seen ? 'Vu — cliquer pour marquer non vu' : 'Marquer comme vu'} onClick={(ev) => { ev.stopPropagation(); onToggle(!seen); }}><Icon name={seen ? 'check' : 'eye'} /></button>
    </div>
  );
}

// ---------------------------------------------------------------- distribution et équipe
function Cast({ cr }) {
  const people = [
    ...(cr.directors || []).map((p) => ({ ...p, role: 'Réalisation' })),
    ...(cr.creators || []).map((p) => ({ ...p, role: 'Création' })),
    ...(cr.cast || []),
    ...(cr.writers || []).map((p) => ({ ...p, role: 'Scénario' })),
    ...(cr.composers || []).map((p) => ({ ...p, role: 'Musique' })),
  ];
  if (!people.length) return null;
  return (
    <section className="d-section cast">
      <h2 className="section-title">Distribution et équipe</h2>
      <ScrollRow className="cast-row">{people.map((p, i) => <PersonCard key={`${p.name}-${p.role}-${i}`} p={p} />)}</ScrollRow>
    </section>
  );
}

// ---------------------------------------------------------------- à propos, fiche technique, emplacement
const Dl = ({ list }) => <dl className="info-list">{list.map(([k, v], i) => [<dt key={`t${i}`}>{k}</dt>, <dd key={`d${i}`}>{v}</dd>])}</dl>;
const copy = (txt, msg) => navigator.clipboard?.writeText(txt).then(() => toast(msg), () => {});

function About({ d, cr, isShow }) {
  const { ui, app } = shared();
  const pairs = [];
  const names = (list) => (list || []).map((p) => p.name).join(', ');
  if (cr.directors && cr.directors.length) pairs.push(['Réalisation', names(cr.directors)]);
  if (cr.creators && cr.creators.length) pairs.push(['Création', names(cr.creators)]);
  if (cr.writers && cr.writers.length) pairs.push(['Scénario', names(cr.writers)]);
  if (cr.composers && cr.composers.length) pairs.push(['Musique', names(cr.composers)]);
  if (cr.studios && cr.studios.length) pairs.push(['Studios', cr.studios.join(', ')]);
  if (cr.networks && cr.networks.length) pairs.push(['Diffusion', cr.networks.join(', ')]);
  if (cr.countries && cr.countries.length) pairs.push(['Pays', cr.countries.map(country).join(', ')]);
  if (d.released && d.released.length === 10) pairs.push([isShow ? 'Première diffusion' : 'Sortie', ui.fmtDate(d.released)]);
  if (cr.status && isShow) pairs.push(['Statut', STATUS[cr.status] || cr.status]);
  if (cr.nextEpisode && cr.nextEpisode.date) pairs.push(['Prochain épisode', `S${cr.nextEpisode.season} É${cr.nextEpisode.episode}, ${ui.fmtDate(cr.nextEpisode.date)}`]);
  if (d.originalTitle && d.originalTitle !== d.title) pairs.push(['Titre original', d.originalTitle]);
  if (isShow && d.totalDuration) pairs.push(['Durée totale', ui.fmtRuntime(Math.round(d.totalDuration / 60))]);
  if (cr.budget) pairs.push(['Budget', `${Math.round(cr.budget / 1e6)} M$`]);
  if (d.provenance) {
    pairs.push(['Source des infos', d.provenance.info]);
    if (d.provenance.poster) pairs.push(['Source de l’affiche', d.provenance.poster]);
    // Emplacement sur le NAS : dossier de la série et de chaque saison, ou fichier et dossier (copiable)
    if (d.location) {
      if (d.location.library) pairs.push(['Bibliothèque', d.location.library]);
      for (const l of d.location.items) {
        pairs.push([l.label, (
          <span className="prov-file loc">
            <code>{l.nas || l.path}</code>
            {l.nas ? <small className="muted">{`Dans Venus : ${l.path}`}</small> : null}
            {l.count ? <small className="muted">{`${l.count} épisode${l.count > 1 ? 's' : ''}`}</small> : null}
            <button className="btn btn-small btn-ghost f" title="Copier" onClick={() => copy(l.nas || l.path, 'Chemin copié')}><Icon name="copy" />Copier</button>
          </span>
        )]);
      }
    } else if (d.provenance.file && app.state.profile.isAdmin) {
      pairs.push(['Fichier', <span className="prov-file"><code>{d.provenance.file}</code><button className="btn btn-small btn-ghost f" onClick={() => copy(d.provenance.folder, 'Chemin du dossier copié')}><Icon name="copy" />Copier le dossier</button></span>]);
    }
  }
  const m = d.media;
  const tech = [];
  if (m) {
    const v = m.video || {};
    tech.push(['Vidéo', [m.resolution, v.codec, v.hdr || m.hdr, v.bits && v.bits > 8 ? `${v.bits} bits` : null, v.fps ? `${String(v.fps).replace('.', ',')} i/s` : null].filter(Boolean).join(' · ')]);
    const tracks = m.tracks || (m.audio || []).map((l) => ({ lang: l }));
    if (tracks.length) tech.push(['Audio', <ul className="track-list">{tracks.map((a, i) => <li key={i}>{[ui.langName(a.lang), a.codec, a.channels ? chLabel(a.channels) : null, /atmos/i.test(`${a.title} ${a.profile}`) ? 'Atmos' : null].filter(Boolean).join(' · ')}{a.isDefault && tracks.length > 1 ? <em> par défaut</em> : null}</li>)}</ul>]);
    const subs = m.subtitles || (m.subs || []).map((l) => ({ lang: l }));
    if (subs.length) tech.push(['Sous-titres', <ul className="track-list">{subs.map((x, i) => <li key={i}>{[ui.langName(x.lang), x.forced ? 'forcés' : null, x.codec, x.external ? 'fichier à part' : null].filter(Boolean).join(' · ')}</li>)}</ul>]);
    if (d.file && d.file.name) tech.push(['Fichier', [d.file.name, fmtSize(d.file.size), (d.file.container || '').toUpperCase(), fmtRate(m.bitrate)].filter(Boolean).join(' · ')]);
  }
  const tags = cr.tags && cr.tags.length ? cr.tags : null;
  if (!pairs.length && !tech.length && !tags) return null;
  const open = (title, body) => openSheet(title, <div className="about-sheet">{body}</div>);
  return (
    <section className="d-section about">
      <div className="about-btns">
        {pairs.length || tags ? <button className="btn btn-ghost f" onClick={() => open('À propos', <><Dl list={pairs} />{tags ? <div className="tag-cloud"><span className="tag-cloud-label">Étiquettes</span>{tags.map((t) => <span key={t} className="tag ghost">{t}</span>)}</div> : null}</>)}><Icon name="info" />À propos</button> : null}
        {tech.length ? <button className="btn btn-ghost f" onClick={() => open(isShow ? 'Fiche technique (premier épisode)' : 'Fiche technique', <Dl list={tech} />)}><Icon name="film" />Fiche technique</button> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- bande-annonce en fond (son, vidéo, revoir)
function BackdropTrailer({ d, bgRef, rootRef, apiRef }) {
  const L = shared();
  const prefs = L.api.prefs;
  const [sound, setSound] = useState(!!prefs.get('detailsSound'));
  const [video, setVideo] = useState(L.api.detailsTrailers());
  const [ended, setEnded] = useState(false);
  const st = useRef({ t: null, timer: null, visible: true, held: false, sound });
  const S = st.current;
  S.sound = sound;
  const fit = () => {
    if (!S.t || !bgRef.current) return;
    const w = bgRef.current.clientWidth, hh = bgRef.current.clientHeight;
    const W = Math.max(w, (hh * 16) / 9) * 1.18;
    Object.assign(S.t.el.style, { width: `${W}px`, height: `${(W * 9) / 16}px` });
  };
  const stop = () => { clearTimeout(S.timer); if (S.t) { S.t.destroy(); S.t = null; } rootRef.current && rootRef.current.classList.remove('trailer-on'); };
  const start = (delay = 1400) => {
    stop(); setEnded(false);
    S.timer = setTimeout(async () => {
      if (document.hidden) return;
      const { trailerPlayer } = await L.imp('trailer.js');
      const x = trailerPlayer(d.trailer, {
        mute: !S.sound,
        onPlaying: () => { if (S.t !== x) return; rootRef.current && rootRef.current.classList.add('trailer-on'); if (S.sound) x.mute(false); if (!S.visible) x.pause(); },
        onEnd: () => { if (S.t !== x) return; stop(); setEnded(true); },
        onError: () => { if (S.t === x) { stop(); setEnded(true); } },
      });
      S.t = x;
      x.el.classList.add('details-yt');
      bgRef.current && bgRef.current.append(x.el);
      fit();
    }, delay);
  };
  useEffect(() => {
    if (video) start(); else stop();
    return stop;
  }, [video]);
  useEffect(() => {
    const ro = new ResizeObserver(fit); ro.observe(bgRef.current);
    // Hors de l'écran (on descend vers les épisodes) ou onglet caché : pause
    const io = new IntersectionObserver(([e]) => { S.visible = e.intersectionRatio > 0.3; if (S.t && !S.held) (S.visible ? S.t.play() : S.t.pause()); }, { threshold: [0, 0.3, 0.6] });
    io.observe(bgRef.current);
    const onVis = () => { if (!S.t || S.held) return; if (document.hidden) S.t.pause(); else if (S.visible) S.t.play(); };
    document.addEventListener('visibilitychange', onVis);
    apiRef.current = {
      hold: () => { S.held = true; if (S.t) S.t.pause(); },
      release: () => { S.held = false; if (S.t && S.visible && !document.hidden) S.t.play(); },
    };
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); apiRef.current = null; };
  }, []);
  return (
    <div className="bg-ctrl">
      <button type="button" className="bg-btn f" aria-label="Revoir la bande-annonce en fond" title="Revoir la bande-annonce" hidden={!video || !ended} onClick={() => start(0)}><Icon name="restart" /></button>
      <button type="button" className="bg-btn f" hidden={!video || ended} aria-label={sound ? 'Couper le son de la bande-annonce' : 'Activer le son de la bande-annonce'} title={sound ? 'Couper le son' : 'Activer le son'}
        onClick={() => { const n = !sound; setSound(n); prefs.set('detailsSound', n); if (S.t) S.t.mute(!n); }}><Icon name={sound ? 'vol' : 'mute'} /></button>
      <button type="button" className={`bg-btn f${video ? '' : ' off'}`} aria-pressed={String(video)} aria-label={video ? 'Désactiver la bande-annonce en fond' : 'Activer la bande-annonce en fond'} title={video ? 'Désactiver la vidéo en fond' : 'Activer la vidéo en fond'}
        onClick={() => { const n = !video; setVideo(n); prefs.set('detailsTrailer', n); toast(n ? 'Bande-annonce en fond activée' : 'Bande-annonce en fond désactivée'); }}><Icon name="film" /></button>
    </div>
  );
}

// ---------------------------------------------------------------- administration : infos, images, identification
async function editInfo(d) {
  let r;
  try { r = await api(`/api/admin/items/${d.id}/edit`); } catch (e) { toast(e.message, true); return; }
  openSheet('Modifier les infos', (close) => <EditInfo d={d} r={r} close={close} />, { wide: true });
}

const Field = ({ l, children }) => <div className="field"><label>{l}</label>{children}</div>;

function EditInfo({ d, r, close }) {
  const f = r.fields;
  const [v, setV] = useState({ title: f.title || '', orig: f.originalTitle || '', year: f.year ?? '', tagline: f.tagline || '', genres: (f.genres || []).join(', '), age: String(f.age ?? ''), overview: f.overview || '' });
  const [err, setErr] = useState('');
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    const y = String(v.year).trim();
    if (!v.title.trim()) { setErr('Le titre est obligatoire'); return; }
    if (y && !/^\d{4}$/.test(y)) { setErr('Année sur 4 chiffres'); return; }
    try {
      await api(`/api/admin/items/${d.id}/edit`, { method: 'PUT', body: { title: v.title.trim(), originalTitle: v.orig.trim() || null, year: y ? Number(y) : null,
        overview: v.overview.trim() || null, tagline: v.tagline.trim() || null, genres: v.genres.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 12), age: v.age === '' ? null : Number(v.age) } });
      close(); toast('Infos enregistrées : elles ne seront plus remplacées par TMDB', { type: 'success' }); refresh();
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <form className="edit-form" onSubmit={submit}>
      <div className="two-cols"><Field l="Titre"><input className="input" maxLength={200} {...bind('title')} /></Field><Field l="Titre original"><input className="input" maxLength={200} {...bind('orig')} /></Field></div>
      <div className="two-cols">
        <Field l="Année"><input className="input" inputMode="numeric" maxLength={4} {...bind('year')} /></Field>
        <Field l="Âge minimum"><select className="input" {...bind('age')}>{[['', 'Non classé'], ['0', 'Tous publics'], ['10', '10 ans et plus'], ['12', '12 ans et plus'], ['16', '16 ans et plus'], ['18', '18 ans et plus']].map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></Field>
      </div>
      <Field l="Genres (séparés par des virgules)"><input className="input" placeholder="Action, Comédie" {...bind('genres')} /></Field>
      <Field l="Accroche"><input className="input" maxLength={300} {...bind('tagline')} /></Field>
      <Field l="Résumé"><textarea className="input" rows={6} maxLength={5000} {...bind('overview')} /></Field>
      <p className="error-text">{err}</p>
      <div className="form-actions">
        {r.custom.length ? <button className="btn btn-ghost f" type="button" onClick={async () => { await api(`/api/admin/items/${d.id}/reset`, { method: 'POST' }); close(); toast('Infos d’origine rétablies'); refresh(); }}>Revenir aux infos d’origine</button> : null}
        <button className="btn btn-play f" type="submit">Enregistrer</button>
      </div>
    </form>
  );
}

function chooseImages(d) {
  openSheet('Choisir les images', (close) => <ChooseImages d={d} close={close} />, { wide: true });
}

function ChooseImages({ d, close }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [kind, setKind] = useState('poster');
  const [busy, setBusy] = useState(null);
  const [url, setUrl] = useState('');
  useEffect(() => { api(`/api/admin/items/${d.id}/edit`).then(setR).catch((e) => setErr(e.message)); }, []);
  const NAMES = { poster: 'Affiches', backdrop: 'Fonds', logo: 'Logos' };
  const SRC = { trakt: 'Trakt', tmdb: 'TMDB', free: '' };
  const apply = async (key, src, ref) => {
    setBusy(key);
    try { await api(`/api/admin/items/${d.id}/image`, { method: 'POST', body: { kind, src, ref } }); close(); toast(`${NAMES[kind].slice(0, -1)} changé${kind === 'poster' ? 'e' : ''}`, { type: 'success' }); refresh(); }
    catch (e) { setBusy(null); toast(e.message, true); }
  };
  if (err) return <div className="img-pick"><p className="error-text">{err}</p></div>;
  if (!r) return <div className="img-pick"><p className="muted"><span className="mini-spin" /> Recherche des images…</p></div>;
  const list = r.images[kind];
  const tag = (x) => [x.label || SRC[x.src] || x.src, x.lang ? x.lang.toUpperCase() : null].filter(Boolean).join(' · ');
  return (
    <div className="img-pick">
      <div className="seg">{Object.keys(NAMES).map((k) => <button key={k} className={`seg-b f${k === kind ? ' on' : ''}`} onClick={() => setKind(k)}>{`${NAMES[k]} (${r.images[k].length})`}</button>)}</div>
      <div className={`img-grid ${kind}`}>
        {list.length ? list.map((x, i) => (
          <button key={`${x.src}-${x.ref}-${i}`} className={`img-opt f${busy === i ? ' busy' : ''}`} title={[tag(x), x.w ? `${x.w}×${x.h}` : null].filter(Boolean).join(' · ')} onClick={() => apply(i, x.src, x.ref)}>
            <img src={x.preview} alt="" loading="lazy" referrerPolicy="no-referrer" /><span className="img-src">{tag(x)}</span>
          </button>
        )) : <p className="muted">Aucune image proposée pour l’instant. Collez une adresse ci-dessous, ajoutez une clé TMDB ou un identifiant Trakt dans Réglages, ou placez poster.jpg / fanart.jpg dans le dossier.</p>}
      </div>
      <form className="img-url" onSubmit={(e) => { e.preventDefault(); const u = url.trim(); if (!/^https:\/\//i.test(u)) { toast('Collez une adresse qui commence par https://', true); return; } apply('url', 'url', u); }}>
        <label className="img-url-label">Ou collez l’adresse d’une image</label>
        <div className="img-url-row">
          <input className="input" type="url" placeholder="https://… adresse d’une image (JPEG, PNG ou WebP)" autoComplete="off" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-small btn-play f" type="submit" disabled={busy === 'url'}><Icon name="down" />Utiliser cette image</button>
        </div>
        <small className="muted">Copiez l’adresse de l’image (clic droit → « Copier l’adresse de l’image ») depuis IMP Awards, MoviePosterDB, CineMaterial, TMDB… Venus la vérifie et la garde chez lui.</small>
      </form>
    </div>
  );
}

export function fixMatch(item) {
  openSheet('Corriger l’identification', (close) => <FixMatch item={item} close={close} />);
}

function FixMatch({ item, close }) {
  const [q, setQ] = useState(item.title);
  const [year, setYear] = useState(item.year || '');
  const [state, setState] = useState({ busy: true, list: [], error: null, msg: 'Recherche…' });
  const search = async () => {
    setState({ busy: true, list: [], error: null, msg: 'Recherche…' });
    try {
      const r = await api(`/api/admin/match/${item.id}?q=${encodeURIComponent(q)}&year=${encodeURIComponent(year)}`);
      setState({ busy: false, list: r, error: null, msg: r.length ? '' : 'Aucun résultat. Essayez le titre original.' });
    } catch (e) { setState({ busy: false, list: [], error: e.message, msg: '' }); }
  };
  useEffect(() => { search(); }, []);
  const pick = async (x) => {
    setState({ busy: true, list: [], error: null, msg: 'Mise à jour…' });
    await api(`/api/admin/match/${item.id}`, { method: 'POST', body: { tmdbId: x.id } });
    close(); toast('Fiche mise à jour'); refresh();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); search(); }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" value={year} inputMode="numeric" style={{ maxWidth: 110 }} onChange={(e) => setYear(e.target.value)} />
        <button className="btn f" type="submit">Chercher</button>
      </div>
      <div className="match-list">
        {state.error ? <p className="error-text">{state.error}</p> : null}
        {state.msg ? <p style={{ color: 'var(--mist)' }}>{state.msg}</p> : null}
        {state.list.map((x) => (
          <button key={x.id} type="button" className="f" onClick={() => pick(x)}>
            <img src={x.poster || undefined} alt="" />
            <div>
              <b>{`${x.title}${x.year ? ` (${x.year})` : ''}`}</b>
              <p style={{ margin: 0, color: 'var(--mist)', fontSize: '.85rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.overview || ''}</p>
            </div>
          </button>
        ))}
      </div>
    </form>
  );
}
