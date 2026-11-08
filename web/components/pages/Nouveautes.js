'use client';
// Nouveautés : films au cinéma et à venir, séries de la semaine, animés de la saison. Grande affiche qui suit
// le titre survolé (avec sa bande-annonce), demande via Seerr, et « Mes envies » (♡).
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, toast, go } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import { ScrollRow } from '../Row';
import { PageError, PageLoading } from '../PageState';

const KINDS = [['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés']];
const store = { get: (k, d) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const STATE_LABEL = {
  pending: 'Demandé, en attente de validation', processing: 'Demandé, recherche en cours', partial: 'Disponible en partie',
  available: 'Disponible, bientôt dans Venus', blocked: 'Bloqué dans Seerr', deleted: 'Supprimé de Seerr',
};
// Réponses gardées pendant la visite (état Seerr, envies)
const statusCache = new Map();
const wishCache = new Map();

export default function Nouveautes() {
  useTitle('Nouveautés');
  const { search } = useVenus();
  let kind = (search && search.get('type')) || store.get('vn_new_kind', 'movie');
  if (!KINDS.some(([k]) => k === kind)) kind = 'movie';
  const { data, error } = useApi(`/api/discover?kind=${kind}`);
  if (error) return <PageError error={error} />;
  if (!data) return <PageLoading />;
  return <NewView key={kind} data={data} kind={kind} />;
}

function NewView({ data, kind }) {
  const L = shared();
  const admin = L.app.state.profile.isAdmin;
  const sections = data.sections.filter((s) => s.items.length);
  const [cur, setCur] = useState(sections.length ? sections[0].items[0] : null);
  const spot = useRef(null);
  const hoverT = useRef(null);
  const missing = !data.available.tmdb && !data.available.seerr && kind !== 'anime';
  const pick = (x) => { clearTimeout(hoverT.current); hoverT.current = setTimeout(() => setCur(x), 180); };
  useEffect(() => () => clearTimeout(hoverT.current), []);
  const fmtDate = (d, y) => L.ui.fmtDate(d, y);
  return (
    <main className="with-nav new-page page-in">
      <div className="new-head">
        <h1>Nouveautés</h1>
        <div className="chips new-tabs" role="tablist">
          {KINDS.map(([k, label]) => <button key={k} className={`chip f${k === kind ? ' on' : ''}`} role="tab" aria-selected={String(k === kind)} onClick={() => { store.set('vn_new_kind', k); go(`/nouveautes?type=${k}`, { replace: true }); }}>{label}</button>)}
        </div>
        {data.available.seerr ? <span className="auto-pill"><span className="dot" />Seerr relié : demandez un titre, il se télécharge tout seul</span> : null}
      </div>
      {sections.length && cur ? <Spotlight x={cur} data={data} spotRef={spot} /> : null}
      <div className="rows new-rows">
        {sections.map((s) => (
          <section key={s.title} className="row">
            <div className="row-head"><h2>{s.title}</h2></div>
            <ScrollRow>
              {s.items.map((x) => (
                <button key={x.key} className="card poster dcard f" aria-label={`${x.title}${x.inLibrary ? ', dans Venus' : ''}`}
                  onClick={() => { if (cur === x && x.inLibrary) { go(`/titre/${x.inLibrary}`); return; } setCur(x); spot.current && spot.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  onMouseEnter={() => { if (!document.documentElement.classList.contains('touch')) pick(x); }}
                  onMouseLeave={() => clearTimeout(hoverT.current)} onFocus={() => pick(x)}>
                  <div className="shot">
                    {x.poster ? <img src={x.poster} alt="" loading="lazy" decoding="async" /> : <div className="ph">{x.title}</div>}
                    {x.inLibrary ? <span className="dc-in" title="Déjà dans Venus"><Icon name="check" /></span> : null}
                    {x.score ? <span className="dc-score">{x.source === 'anilist' ? `${x.score} %` : `★ ${(x.score / 10).toFixed(1).replace('.', ',')}`}</span> : null}
                  </div>
                  <div className="cap"><b>{x.title}</b><small>{x.date ? (new Date(x.date) > new Date() ? `Le ${fmtDate(x.date, false)}` : x.date.slice(0, 4)) : ''}</small></div>
                </button>
              ))}
            </ScrollRow>
          </section>
        ))}
        {!sections.length ? (
          <div className="empty">
            <h2>{missing ? 'Nouveautés indisponibles' : 'Rien pour le moment'}</h2>
            <p>{missing ? 'Ajoutez une clé TMDB (gratuite) ou reliez Seerr dans Réglages pour voir les films et séries qui sortent. Les animés fonctionnent sans clé.' : 'Les sites de référence ne répondent pas pour l’instant. Réessayez dans un moment.'}</p>
            {missing && admin ? <button className="btn btn-play f" onClick={() => go('/reglages?section=sources')}>Ouvrir les réglages</button> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

// Grande affiche : fond en fondu, bande-annonce en boucle, état de la demande
function Spotlight({ x, data, spotRef }) {
  const L = shared();
  const [layers, setLayers] = useState([{ k: 0, x, on: false }]);
  const [trailerOn, setTrailerOn] = useState(false);
  const [sound, setSound] = useState(false);
  const bg = useRef(null);
  const body = useRef(null);
  const st = useRef({ t: null, timer: null, sound: false, x });
  const S = st.current;
  S.x = x;
  const fit = () => {
    if (!S.t || !spotRef.current) return;
    const w = spotRef.current.clientWidth, hh = spotRef.current.clientHeight;
    const W = Math.max(w, (hh * 16) / 9) * 1.18;
    Object.assign(S.t.el.style, { width: `${W}px`, height: `${(W * 9) / 16}px` });
  };
  const stop = () => { clearTimeout(S.timer); if (S.t) { S.t.destroy(); S.t = null; } setTrailerOn(false); };
  useEffect(() => {
    // Nouveau fond par-dessus l'ancien (deux couches qui alternent)
    setLayers((l) => [...l.slice(-1), { k: (l[l.length - 1]?.k || 0) + 1, x, on: false }]);
    const b = body.current; if (b) { b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap'); }
    stop();
    if (L.api.hoverMode() !== 'off') {
      S.timer = setTimeout(async () => {
        let key = x.trailer && x.trailer.key;
        if (!key && x.tmdbId) { try { key = ((await api(`/api/discover/trailer?type=${x.type}&tmdbId=${x.tmdbId}`)).trailer || {}).key; } catch { /* */ } }
        if (!key || S.x !== x) return;
        const { trailerPlayer } = await L.imp('trailer.js');
        if (S.x !== x) return;
        const t = trailerPlayer(key, {
          mute: !S.sound && !L.api.prefs.get('hoverSound'), loop: true,
          onPlaying: () => { if (S.t === t) setTrailerOn(true); },
          onError: () => { if (S.t === t) stop(); },
        });
        S.t = t; t.el.classList.add('hero-yt'); bg.current && bg.current.append(t.el); fit();
      }, 1500);
    }
  }, [x]);
  useEffect(() => {
    const ro = new ResizeObserver(fit); ro.observe(spotRef.current);
    const onVis = () => { if (S.t) (document.hidden ? S.t.pause() : S.t.play()); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const showLayer = (k) => setLayers((l) => l.map((y) => ({ ...y, on: y.k === k })));
  const when = x.date ? (new Date(x.date) > new Date() ? `Sortie le ${L.ui.fmtDate(x.date)}` : L.ui.fmtDate(x.date)) : '';
  return (
    <section ref={spotRef} className={`spotlight${trailerOn ? ' trailer-on' : ''}`}>
      <div className="sp-bg" ref={bg}>
        {layers.map((y) => {
          const src = y.x.backdrop || y.x.poster;
          return (
            <div key={y.k} className={`sp-layer${y.on ? ' on' : ''}`}>
              {src ? <img src={src} alt="" className={y.x.backdrop ? '' : 'blur'} decoding="async" ref={(el) => { if (el && el.complete && !y.on) showLayer(y.k); }} onLoad={() => showLayer(y.k)} onError={() => showLayer(y.k)} />
                : <div className="ph" ref={(el) => { if (el && !y.on) setTimeout(() => showLayer(y.k), 0); }} />}
            </div>
          );
        })}
      </div>
      <div className="sp-body" ref={body}>
        <div className="sp-kicker">
          {x.inLibrary ? <span className="sp-in"><Icon name="check" />Dans Venus</span> : null}
          {x.anime ? <span>Animé</span> : null}
          {when ? <span>{when}</span> : null}
          {x.next ? <span>{`Épisode ${x.next.episode} le ${new Date(x.next.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`}</span> : null}
        </div>
        <h1 className="hero-title sp-title">{x.title}</h1>
        {x.original && x.original !== x.title ? <p className="sp-orig">{x.original}</p> : null}
        {x.score ? (
          <div className="ratings"><span className={`rating r-${x.source === 'anilist' ? 'anilist' : 'tmdb'}`}><span className="r-src">{x.source === 'anilist' ? 'AniList' : 'TMDB'}</span><b>{x.source === 'anilist' ? `${x.score} %` : (x.score / 10).toFixed(1).replace('.', ',')}</b>{x.source === 'anilist' ? null : <small>/10</small>}</span></div>
        ) : null}
        {x.overview ? <p className="hero-overview">{x.overview}</p> : null}
        <Actions key={x.key} x={x} data={data} />
      </div>
      <button type="button" className="hero-sound sp-sound" hidden={!trailerOn} tabIndex={-1} aria-label={sound ? 'Couper le son' : 'Activer le son'} onClick={() => { const n = !sound; setSound(n); S.sound = n; if (S.t) S.t.mute(!n); }}><Icon name={sound ? 'vol' : 'mute'} /></button>
    </section>
  );
}

// « Mes envies » : favori d'un titre pas encore dans Venus, demandé à Seerr automatiquement
function WishButton({ x, onRequest }) {
  const [on, setOn] = useState(wishCache.has(x.key) ? wishCache.get(x.key).on : null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wishCache.has(x.key)) return;
    api(`/api/wishlist/has?type=${x.type}&tmdbId=${x.tmdbId || ''}&anilistId=${x.anilistId || ''}&title=${encodeURIComponent(x.title)}&original=${encodeURIComponent(x.original || '')}`)
      .then((r) => { wishCache.set(x.key, { on: r.inWishlist, tmdbId: r.tmdbId }); setOn(r.inWishlist); }).catch(() => setOn(false));
  }, [x.key]);
  const toggle = async () => {
    const k = wishCache.get(x.key) || {};
    setBusy(true);
    try {
      if (k.on) {
        await api(`/api/wishlist/${x.type === 'movie' ? 'movie' : 'tv'}/${k.tmdbId}`, { method: 'DELETE' });
        wishCache.set(x.key, { ...k, on: false }); setOn(false); toast('Retiré de mes envies');
      } else {
        const r = await api('/api/wishlist', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, anilistId: x.anilistId, title: x.title, original: x.original, poster: x.poster, backdrop: x.backdrop, date: x.date, overview: x.overview, anime: !!x.anime } });
        wishCache.set(x.key, { on: true, tmdbId: r.tmdbId }); setOn(true);
        const future = x.date && x.date > new Date().toISOString().slice(0, 10);
        if (r.request && r.request.state !== 'error') { statusCache.set(x.key, r.request); onRequest && onRequest(r.request); }
        toast(r.auto ? (future ? `« ${x.title} » est dans vos envies : demandé à Seerr, il sera téléchargé dès sa sortie` : `« ${x.title} » est dans vos envies et demandé à Seerr`) : `« ${x.title} » est dans vos envies`);
        if (r.request && r.request.state === 'error') toast(`Seerr : ${r.request.error}`, true);
      }
    } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  return (
    <button className={`btn btn-ghost btn-icon f wish-btn${on ? ' is-on' : ''}`} disabled={on === null || busy} aria-pressed={String(!!on)}
      aria-label={on ? 'Retirer de mes envies' : 'Ajouter à mes envies'} title={on ? 'Dans mes envies' : 'Ajouter à mes envies : demandé à Seerr dès maintenant, téléchargé dès sa sortie'} onClick={toggle}><Icon name="heart" /></button>
  );
}

function Actions({ x, data }) {
  const L = shared();
  const p = L.app.state.profile;
  const [s, setS] = useState(statusCache.get(x.key) || null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (x.inLibrary || !data.available.seerr || s) return;
    let dead = false;
    api(`/api/discover/status?type=${x.type}&tmdbId=${x.tmdbId || ''}&anilistId=${x.anilistId || ''}&title=${encodeURIComponent(x.title)}&original=${encodeURIComponent(x.original || '')}`)
      .catch((e) => ({ state: 'error', error: e.message }))
      .then((r) => { statusCache.set(x.key, r); if (!dead) setS(r); });
    return () => { dead = true; };
  }, [x.key]);
  const wish = <WishButton x={x} onRequest={setS} />;
  if (x.inLibrary) return <div className="actions"><button className="btn btn-play f" onClick={() => go(`/titre/${x.inLibrary}`)}><Icon name="play" />Dans Venus : voir la fiche</button></div>;
  if (!data.available.seerr) return <div className="actions">{p.isAdmin ? <button className="btn btn-ghost f" onClick={() => go('/reglages?section=seerr')}><Icon name="gear" />Relier Seerr pour demander ce titre</button> : null}{wish}</div>;
  if (!s) return <div className="actions"><span className="sp-state"><span className="mini-spin" />Vérification…</span>{wish}</div>;
  const request = async () => {
    setBusy(true);
    try {
      const r = await api('/api/discover/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, anilistId: x.anilistId, title: x.title, original: x.original } });
      statusCache.set(x.key, r); setS(r);
      toast(`« ${x.title} » est demandé : la recherche démarre`);
    } catch (e) { toast(e.message, true); setBusy(false); }
  };
  if (s.state === 'none' || s.state === 'unknown' || s.state === 'deleted') {
    if (s.state === 'unknown') return <div className="actions"><span className="sp-state">Introuvable sur TMDB : Seerr ne peut pas le demander</span></div>;
    if (p.maxAge != null) return <div className="actions"><span className="sp-state">Ajoutez-le à vos envies : un adulte décidera</span>{wish}</div>;
    return <div className="actions"><button className="btn btn-play f" disabled={busy} onClick={request}><Icon name="add" />{busy ? 'Demande envoyée…' : 'Demander'}</button>{wish}</div>;
  }
  if (s.state === 'error') return <div className="actions"><span className="sp-state warn">{`Seerr : ${s.error || 'injoignable'}`}</span>{wish}</div>;
  const label = s.downloading && s.progress != null ? `Téléchargement ${s.progress} %` : STATE_LABEL[s.state] || 'Demandé';
  return (
    <div className="actions">
      <span className={`sp-state st-${s.state}`}><Icon name={s.downloading ? 'down' : 'check'} />{label}</span>
      {wish}
      {s.downloading && s.progress != null ? <div className="sp-progress"><i style={{ width: `${s.progress}%` }} /></div> : null}
    </div>
  );
}
