'use client';
// « Nouveau » : chercher un film, une série ou un animé et l'ajouter à Radarr / Sonarr, qui le téléchargent.
// En dessous : les téléchargements en cours (progression), rafraîchis toutes les 15 s.
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, toast, go } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import { PageLoading } from '../PageState';

const KINDS = [['movie', 'Films', 'film'], ['show', 'Séries', 'tv'], ['anime', 'Animés', 'spark']];

export default function Request() {
  useTitle('Nouveau');
  const { data: st, error } = useApi('/api/arr/status');
  if (st === undefined && !error) return <PageLoading />;
  return <RequestView st={st || { radarr: false, sonarr: false }} />;
}

function RequestView({ st }) {
  const { search } = useVenus();
  const admin = !!shared().app.state.profile.isAdmin;
  const [kind, setKind] = useState(() => { const k = (search && search.get('type')) || (st.radarr ? 'movie' : 'show'); return KINDS.some(([x]) => x === k) ? k : 'movie'; });
  const [q, setQ] = useState((search && search.get('q')) || '');
  const [results, setResults] = useState([]);
  const [note, setNote] = useState('Cherchez un titre pour l’ajouter.');
  const [queue, setQueue] = useState([]);
  const input = useRef(null);
  const seq = useRef(0);

  const loadQueue = () => api('/api/arr/queue').then(setQueue).catch(() => {});
  useEffect(() => {
    if (!st.radarr && !st.sonarr) return undefined;
    setTimeout(() => input.current && input.current.focus(), 50);
    loadQueue();
    const iv = setInterval(() => { if (!document.hidden) loadQueue(); }, 15000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); return undefined; }
    if (term.length < 2) { setResults([]); setNote('Tapez au moins deux lettres.'); return undefined; }
    const t = setTimeout(async () => {
      const my = ++seq.current;
      setNote('Recherche…');
      try {
        const list = await api(`/api/arr/search?kind=${kind}&q=${encodeURIComponent(term)}`);
        if (my !== seq.current) return;
        if (kind === 'anime') list.sort((a, b) => Number(b.animeHint) - Number(a.animeHint));
        setResults(list);
        setNote(list.length ? `${list.length} résultat${list.length > 1 ? 's' : ''}` : 'Aucun résultat.');
      } catch (e) { if (my === seq.current) { setResults([]); setNote(e.message); } }
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind]);

  if (!st.radarr && !st.sonarr) {
    return (
      <main className="with-nav page-in">
        <div className="page req-page">
          <div className="page-head"><h1>Nouveau</h1></div>
          <div className="empty">
            <h2>Radarr et Sonarr ne sont pas encore reliés</h2>
            <p>Une fois reliés, vous cherchez un film, une série ou un animé ici et un clic suffit : il se télécharge tout seul et arrive dans Venus.</p>
            {admin ? <button className="btn btn-play f" onClick={() => go('/reglages?section=arr')}><Icon name="settings" />Relier Radarr et Sonarr</button> : <p className="muted">Demandez à l’administrateur de les relier.</p>}
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="with-nav page-in">
      <div className="page req-page">
        <div className="page-head"><div className="head-left"><h1>Nouveau</h1><p className="muted">Ajoutez un titre : il se télécharge tout seul et arrive dans Venus.</p></div></div>
        <div className="req-bar">
          <div className="search-box"><Icon name="search" /><input ref={input} className="input" type="search" placeholder="Titre d’un film, d’une série ou d’un animé…" autoComplete="off" aria-label="Rechercher un titre à ajouter" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="seg" role="radiogroup" aria-label="Type">
            {KINDS.map(([k, label, ic]) => {
              const off = k === 'movie' ? !st.radarr : !st.sonarr;
              return <button key={k} className={`seg-b f${k === kind ? ' on' : ''}`} role="radio" aria-checked={String(k === kind)} disabled={off} title={off ? `${k === 'movie' ? 'Radarr' : 'Sonarr'} n’est pas relié` : ''} onClick={() => setKind(k)}><Icon name={ic} />{label}</button>;
            })}
          </div>
        </div>
        {queue.length ? (
          <section className="req-queue">
            <h2>En téléchargement</h2>
            <div className="req-q-list">
              {queue.map((x, i) => (
                <div key={`${x.title}-${x.episode || ''}-${i}`} className="req-q">
                  {x.poster ? <img src={x.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="req-ph small">{(x.title || '?').slice(0, 1)}</span>}
                  <div className="grow">
                    <b>{x.title}{x.episode ? <small>{` · ${x.episode}`}</small> : null}</b>
                    <div className="progress-line"><i style={{ width: `${x.progress}%` }} /></div>
                    <small>{[x.status, `${x.progress} %`, x.timeleft && x.timeleft !== '00:00:00' ? `reste ${x.timeleft.replace(/^00:/, '')}` : null].filter(Boolean).join(' · ')}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <p className="muted req-note">{note}</p>
        <div className="req-grid">{results.map((r) => <ReqCard key={r.id} r={r} kind={kind} onAdded={() => setTimeout(loadQueue, 4000)} />)}</div>
      </div>
    </main>
  );
}

function ReqCard({ r, kind, onAdded }) {
  const [state, setState] = useState(r.inVenus ? 'venus' : r.requested ? 'requested' : 'idle');
  const [picOk, setPicOk] = useState(!!r.poster);
  const add = async () => {
    setState('busy');
    try {
      const res = await api('/api/arr/add', { method: 'POST', body: { kind, id: r.id } });
      setState(res.already ? 'already' : 'added');
      toast(res.already ? `« ${res.title} » était déjà demandé` : `« ${res.title} » ajouté : le téléchargement commence`, { type: 'success' });
      onAdded();
    } catch (e) { setState('idle'); toast(e.message, true); }
  };
  return (
    <article className="req-card">
      <div className="req-pic">{picOk ? <img src={r.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setPicOk(false)} /> : <span className="req-ph">{r.title.slice(0, 1)}</span>}</div>
      <div className="req-body">
        <b className="req-title">{r.title}</b>
        <small>{[r.year, r.seasons ? `${r.seasons} saison${r.seasons > 1 ? 's' : ''}` : null, r.runtime ? `${r.runtime} min` : null, r.network].filter(Boolean).join(' · ')}</small>
        {r.overview ? <p>{r.overview}</p> : null}
        {state === 'venus' ? <span className="req-state ok"><Icon name="check" />Déjà dans Venus</span>
          : state === 'requested' ? <span className="req-state"><Icon name="check" />Déjà demandé</span>
            : <button className={`btn btn-small btn-play f${state === 'added' || state === 'already' ? ' done' : ''}`} disabled={state !== 'idle'} onClick={add}>
                <Icon name={state === 'busy' ? 'refresh' : state === 'idle' ? 'download' : 'check'} />
                {state === 'busy' ? 'Ajout…' : state === 'added' ? 'Ajouté' : state === 'already' ? 'Déjà demandé' : 'Ajouter'}
              </button>}
      </div>
    </article>
  );
}
