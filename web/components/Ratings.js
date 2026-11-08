'use client';
// Notes des sites (IMDb, Rotten Tomatoes, Metacritic, TMDB, AniList…) et liens vers ceux sans note publique
import { shared } from '../lib/shared';

export default function Ratings({ ratings, links = {} }) {
  const { components } = shared();
  const r = ratings || {};
  const chips = components.RATING_SOURCES.filter(([k]) => r[k] && r[k].v).map(([k, label]) => {
    const x = { ...r[k], src: k };
    const votes = x.votes ? `, ${x.votes.toLocaleString('fr-FR')} votes` : '';
    const Tag = x.url ? 'a' : 'span';
    return (
      <Tag key={k} className={`rating r-${k}`} href={x.url || undefined} target={x.url ? '_blank' : undefined} rel="noopener"
        title={`${label} : ${components.fmtScore(x)}${x.max === 10 ? ' sur 10' : x.max === 100 && k === 'mc' ? ' sur 100' : ''}${votes}`}>
        <span className="r-src">{k === 'rt' ? (x.v >= 60 ? '🍅' : '🥀') : label}</span>
        {k === 'rt' ? <span className="r-src-txt">Rotten Tomatoes</span> : null}
        <b>{components.fmtScore(x)}</b>
        {x.max === 10 ? <small>/10</small> : null}
      </Tag>
    );
  });
  const extra = [
    links.anilist && !r.anilist ? ['anilist', 'AniList', links.anilist] : null,
    links.mal && !r.mal ? ['mal', 'MyAnimeList', links.mal] : null,
    links.imdb && !r.imdb ? ['imdb', 'IMDb', links.imdb] : null,
    links.senscritique ? ['sc', 'SensCritique', links.senscritique] : null,
  ].filter(Boolean).map(([k, label, url]) => (
    <a key={`l-${k}`} className={`rating r-${k} r-link`} href={url} target="_blank" rel="noopener" title={`Voir sur ${label}`}><span className="r-src">{label}</span><span className="r-go">↗</span></a>
  ));
  if (!chips.length && !extra.length) return null;
  return <div className="ratings">{chips}{extra}</div>;
}
