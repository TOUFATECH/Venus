'use client';
// Rétrospective de l'année : une suite d'écrans à faire défiler (comme une « story »), pour chaque profil.
// Touchez à droite (ou flèche droite) pour avancer, à gauche pour revenir ; ça avance tout seul toutes les 7 s,
// sauf si on garde le doigt (ou la souris) appuyé.
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, go, img } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import { PageError, PageLoading } from '../PageState';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// Nombre à la française (virgule)
const nf = (n) => String(n).replace('.', ',');
// Nombre d'heures lisible
const hours = (x) => (x >= 10 ? `${Math.round(x)} h` : x >= 1 ? `${nf(Math.round(x * 10) / 10)} h` : `${Math.max(1, Math.round(x * 60))} min`);
const SLIDE_MS = 7000;

// Page Rétrospective de l'année
export default function Recap() {
  const { search } = useVenus();
  const year = Number(search && search.get('annee')) || new Date().getFullYear();
  const { data: d, error } = useApi(`/api/stats?year=${year}`);
  useTitle(`Ma rétrospective ${year}`);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  return <RecapView d={d} year={year} name={shared().app.state.profile.name} />;
}

// Affiche d'un titre
function Poster({ src, title }) {
  return src ? <img className="rc-poster" src={img(src, 342)} alt={title || ''} loading="lazy" /> : <span className="rc-poster rc-ph">{(title || '?').slice(0, 1)}</span>;
}

// Diapositives de la rétrospective
function slidesOf(d, year, name) {
  const s = [];
  if (!d.totalHours && !d.movies && !d.episodes) {
    s.push({ k: 'empty', tone: 1, body: <><small>{`Votre année ${year}`}</small><h2>Rien de regardé pour l’instant</h2><p>Lancez un film ou un épisode : votre rétrospective se remplira toute seule.</p></> });
    return s;
  }
  const days = Math.floor(d.totalHours / 24);
  s.push({ k: 'intro', tone: 1, body: <><small>{`${name}, votre année ${year}`}</small><h2 className="rc-big">{hours(d.totalHours)}</h2><p>{`devant l’écran${days >= 1 ? `, soit ${days} jour${days > 1 ? 's' : ''} entier${days > 1 ? 's' : ''}` : ''}, sur ${d.days} jour${d.days > 1 ? 's' : ''} différents.`}</p></> });
  if (d.movies) {
    s.push({ k: 'movies', tone: 2, body: <><small>Films</small><h2 className="rc-big">{d.movies}</h2><p>{`film${d.movies > 1 ? 's' : ''} vu${d.movies > 1 ? 's' : ''} jusqu’au bout.`}</p>
      <div className="rc-row">{d.lastMovies.slice(0, 5).map((m) => <Poster key={m.id} src={m.poster} title={m.title} />)}</div></> });
  }
  const top = d.topShows && d.topShows[0];
  if (d.episodes || top) {
    s.push({ k: 'shows', tone: 3, body: <><small>Séries</small><h2 className="rc-big">{d.episodes}</h2><p>{`épisode${d.episodes > 1 ? 's' : ''} regardé${d.episodes > 1 ? 's' : ''}.`}</p>
      {top ? <div className="rc-feature"><Poster src={top.poster} title={top.title} /><div><b>{top.title}</b><span>{`votre série de l’année : ${hours(top.hours)}`}</span></div></div> : null}</> });
  }
  const ani = d.topAnime && d.topAnime[0];
  if (ani) s.push({ k: 'anime', tone: 4, body: <><small>Animés</small><h2>{ani.title}</h2><p>{`Votre animé de l’année : ${hours(ani.hours)}${ani.eps ? `, ${ani.eps} épisode${ani.eps > 1 ? 's' : ''}` : ''}.`}</p><div className="rc-row"><Poster src={ani.poster} title={ani.title} /></div></> });
  const g = d.genres && d.genres[0];
  if (g) s.push({ k: 'genre', tone: 5, body: <><small>Votre genre préféré</small><h2 className="rc-word">{g.name}</h2><p>{`${hours(g.hours)} en tout.${d.genres[1] ? ` Juste derrière : ${d.genres.slice(1, 3).map((x) => x.name).join(' et ')}.` : ''}`}</p></> });
  if (d.person) s.push({ k: 'person', tone: 6, body: <><small>La personne que vous avez le plus vue</small><h2 className="rc-word">{d.person}</h2><p>À l’écran ou derrière la caméra, elle était dans beaucoup de vos titres.</p></> });
  if (d.bestMonth && d.bestMonth.hours) {
    s.push({ k: 'month', tone: 2, body: <><small>Votre mois le plus chargé</small><h2 className="rc-word">{MONTHS[d.bestMonth.m]}</h2><p>{`${hours(d.bestMonth.hours)} de visionnage.${d.streak > 1 ? ` Record : ${d.streak} jours de suite.` : ''}`}</p>
      <div className="rc-bars" aria-hidden="true">{d.months.map((m) => <i key={m.m} className={m.m === d.bestMonth.m ? 'on' : ''} style={{ height: `${Math.max(4, (m.hours / d.bestMonth.hours) * 100)}%` }} />)}</div></> });
  }
  if (d.completedShows && d.completedShows.length) {
    s.push({ k: 'done', tone: 3, body: <><small>Terminées cette année</small><h2 className="rc-big">{d.completedShows.length}</h2><p>{`série${d.completedShows.length > 1 ? 's' : ''} et animé${d.completedShows.length > 1 ? 's' : ''} vus en entier.`}</p>
      <div className="rc-row">{d.completedShows.slice(0, 5).map((x) => <Poster key={x.id} src={x.poster} title={x.title} />)}</div></> });
  }
  s.push({ k: 'end', tone: 1, end: true, body: <><small>{`${year}, c’était ça`}</small><h2>{`Merci, ${name} !`}</h2><p>À l’année prochaine pour de nouvelles histoires.</p></> });
  return s;
}

// Rétrospective en diapositives
function RecapView({ d, year, name }) {
  const slides = slidesOf(d, year, name);
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const reduce = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = useRef(null);
  const n = slides.length;
  const next = () => setI((x) => Math.min(n - 1, x + 1));
  const prev = () => setI((x) => Math.max(0, x - 1));
  // Avance toute seule (sauf appui maintenu, dernier écran, mouvement réduit)
  useEffect(() => {
    if (held || reduce || i >= n - 1) return undefined;
    const t = setTimeout(next, SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, held, n]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') go('/stats');
    };
    document.addEventListener('keydown', k);
    root.current && root.current.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', k);
  }, [n]);
  const tap = (e) => {
    if (e.target.closest('button, a')) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) prev(); else next();
  };
  const cur = slides[Math.min(i, n - 1)];
  return (
    <main className="with-nav page-in">
      <div className="page recap-page">
        <div ref={root} tabIndex={-1} className={`recap tone-${cur.tone}${held ? ' held' : ''}`} role="region" aria-roledescription="diaporama" aria-label={`Rétrospective ${year}`}
          onClick={tap} onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)}>
          <div className="rc-progress" aria-hidden="true">
            {slides.map((s, j) => <i key={s.k}><b className={j < i ? 'done' : j === i && !reduce ? 'run' : j === i ? 'done' : ''} style={j === i ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: held ? 'paused' : 'running' } : undefined} /></i>)}
          </div>
          <div className="rc-slide" key={cur.k} aria-live="polite">{cur.body}</div>
          <div className="rc-foot">
            <span>{`${Math.min(i, n - 1) + 1} / ${n}`}</span>
            {cur.end ? (
              <div className="rc-actions">
                <button className="btn btn-ghost btn-small f" onClick={() => setI(0)}><Icon name="restart" />Revoir</button>
                <button className="btn btn-small f" onClick={() => go(`/stats?annee=${year}`)}><Icon name="gauge" />Tous les détails</button>
              </div>
            ) : <button className="btn btn-ghost btn-small f" aria-label="Écran suivant" onClick={next}><Icon name="fwd" />Suivant</button>}
          </div>
        </div>
      </div>
    </main>
  );
}
