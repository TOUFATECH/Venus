'use client';
// Onglet « À venir » de Films, Séries et Animés : jour par jour, ce qui sort ou se diffuse, disponible ou pas.
// En haut, des propositions de titres absents. Chaque titre absent peut être mis en favori ♡ (« Mes envies »,
// téléchargé automatiquement par Radarr / Sonarr) ou téléchargé directement (⬇).
// Et l'onglet « Mes envies » de Ma liste.
import { useEffect, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, api, toast, img, go, openSheet } from '../../lib/hooks';
import { Icon } from '../Icon';

const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés' };
const FILTERS = [['all', 'Tout'], ['nas', 'Disponibles'], ['out', 'Pas disponibles'], ['fav', 'Mes favoris']];
// Nombre sur deux chiffres
const pad = (n) => String(n).padStart(2, '0');
// Jour local (AAAA-MM-JJ)
const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Jour d'un élément « À venir »
const dayOf = (e) => (e.at ? localDay(e.at) : e.date);
// Nom affiché (série ou titre)
const nameOf = (e) => e.show || e.title;
// Libellé d'un élément (épisode ou date de sortie)
const epLabel = (e) => (e.kind === 'movie' ? [e.release, e.year].filter(Boolean).join(' · ') : `${e.season != null ? `S${e.season}:É${e.episode}` : `Épisode ${e.episode}`}${e.epTitle ? ` - ${e.epTitle}` : ''}`);
// Date lisible
const fmtDate = (d, y) => shared().ui.fmtDate(d, y);

// Onglet « À venir » d'une bibliothèque
export default function Upcoming({ kind, tabs }) {
  const { data: d, error } = useApi(`/api/upcoming?type=${kind}`);
  if (error) return <div className="page"><div className="empty"><h2>Impossible d’afficher les sorties</h2><p>{error.message}</p></div></div>;
  if (!d) return <div className="page" aria-busy="true"><i className="sk" style={{ width: 220, height: 48 }} /></div>;
  return <UpcomingView key={kind} d={d} kind={kind} tabs={tabs} />;
}

// Calendrier jour par jour et suggestions
function UpcomingView({ d, kind, tabs }) {
  const kids = d.kids;
  const [filter, setFilter] = useState(() => { try { return sessionStorage.getItem(`vn_up_${kind}`) || 'all'; } catch { return 'all'; } });
  // Un même titre (série) partage son état de favori et de suivi entre tous ses épisodes
  const [favs, setFavs] = useState(() => new Set(d.entries.filter((e) => e.wanted).map((e) => e.key)));
  const [arr, setArr] = useState(() => new Set(d.entries.filter((e) => e.arr).map((e) => e.key)));
  const [busy, setBusy] = useState(new Set());
  const [earlier, setEarlier] = useState(false);
  const today = localDay(Date.now());
  const label = (iso) => {
    const dt = new Date(`${iso}T00:00:00`), t0 = new Date(`${today}T00:00:00`);
    const diff = Math.round((dt - t0) / 864e5);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === -1) return 'Hier';
    if (diff === 1) return 'Demain';
    const s = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', ...(dt.getFullYear() !== t0.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const payload = (e, download) => ({ key: e.key, kind: e.kind, title: nameOf(e), year: e.year || undefined, poster: e.poster || undefined, image: e.image || undefined,
    date: e.date || undefined, tmdb: e.tmdb || undefined, tvdb: e.tvdb || undefined, anilist: e.anilist || undefined, download });
  const toggleFav = async (e) => {
    const on = favs.has(e.key);
    try {
      if (on) {
        if (e.venusAdded && !(await shared().ui.confirmSheet(`Retirer « ${nameOf(e)} » de vos favoris ? Venus l’avait fait télécharger : les téléchargements en cours seront annulés et les fichiers supprimés du NAS.`, 'Retirer et supprimer'))) return;
        const rm = await api(`/api/wanted?key=${encodeURIComponent(e.key)}`, { method: 'DELETE' });
        setFavs((s) => { const n = new Set(s); n.delete(e.key); return n; }); toast(rm && rm.removed ? `« ${nameOf(e)} » retiré : téléchargements annulés et fichiers supprimés du NAS` : `« ${nameOf(e)} » retiré de vos favoris`);
      } else {
        const r = await api('/api/wanted', { method: 'POST', body: payload(e, true) });
        setFavs((s) => new Set(s).add(e.key));
        if (r.sent && !r.sent.error) setArr((s) => new Set(s).add(e.key));
        toast(r.sent && r.sent.error ? `Ajouté aux favoris, mais ${d.app} a répondu : ${r.sent.error}`
          : r.nas ? `« ${nameOf(e)} » ajouté à vos favoris (déjà sur le NAS : rien à télécharger)`
          : r.sent ? `« ${nameOf(e)} » en favori : ${r.sent.already ? `déjà suivi par ${d.app}` : 'le téléchargement est lancé'}`
            : `« ${nameOf(e)} » ajouté à vos favoris${kids ? '' : d.arr ? '' : ` (reliez ${d.app} pour le téléchargement automatique)`}`, { type: r.sent && r.sent.error ? undefined : 'success' });
      }
    } catch (err) { toast(err.message, true); }
  };
  const download = async (e) => {
    setBusy((s) => new Set(s).add(e.key));
    try {
      const r = await api('/api/wanted/grab', { method: 'POST', body: payload(e, true) });
      setArr((s) => new Set(s).add(e.key));
      toast(r.already ? `« ${r.title} » est déjà suivi par ${d.app}` : `« ${r.title} » ajouté à ${d.app} : le téléchargement est lancé`, { type: 'success' });
    } catch (err) { toast(err.message, true); }
    setBusy((s) => { const n = new Set(s); n.delete(e.key); return n; });
  };
  const ctx = { d, kids, favs, arr, busy, toggleFav, download, label };
  const avail = (e) => (e.kind === 'movie' ? !!e.nas : !!e.epId);
  const keep = (e) => (filter === 'nas' ? avail(e) : filter === 'out' ? !avail(e) : filter === 'fav' ? favs.has(e.key) : true);
  const groups = new Map();
  for (const e of d.entries.filter(keep)) { const k = dayOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const yesterday = localDay(Date.now() - 864e5);
  const days = [...groups.keys()].sort();
  const before = days.filter((x) => x < yesterday);
  const shown = earlier ? days : days.filter((x) => x >= yesterday);
  const sugs = (filter === 'all' || filter === 'out') && !kids ? d.suggestions : [];
  const count = d.entries.length;
  const setF = (k) => { setFilter(k); try { sessionStorage.setItem(`vn_up_${kind}`, k); } catch { /* */ } };
  return (
    <div className="page">
      <div className="page-head">
        <div className="head-left"><h1>{TITLES[kind]}</h1><p className="count">{`${count} ${kind === 'movie' ? `sortie${count > 1 ? 's' : ''}` : `épisode${count > 1 ? 's' : ''}`}`}</p></div>
        {tabs}
      </div>
      <div className="up-bar">
        <div className="seg up-filter" role="radiogroup" aria-label="Afficher">
          {FILTERS.filter(([k]) => !(kids && (k === 'out' || k === 'fav'))).map(([k, txt]) => <button key={k} className={`seg-b f${k === filter ? ' on' : ''}`} role="radio" aria-checked={String(k === filter)} onClick={() => setF(k)}>{txt}</button>)}
        </div>
        <div className="up-bar-right">
          {!kids && d.arr ? <span className="muted small"><Icon name="heart" />{` Favori = téléchargé automatiquement par ${d.app}`}</span> : null}
          <button className="btn btn-small btn-ghost f" title="Les sorties de vos séries, films et favoris dans le calendrier de votre téléphone" onClick={subscribe}><Icon name="cal" />Ajouter à mon calendrier</button>
        </div>
      </div>
      {sugs.length ? (
        <section className="up-sugs">
          <h2 className="section-title">{kind === 'movie' ? 'Films à découvrir' : kind === 'anime' ? 'Animés à découvrir' : 'Séries à découvrir'}<small>pas encore disponibles</small></h2>
          <div className="up-sug-row">{sugs.map((e) => <SugCard key={e.key} e={e} ctx={ctx} />)}</div>
        </section>
      ) : null}
      <div className="upcoming">
        {before.length && !earlier ? <button className="btn btn-small btn-ghost up-earlier f" onClick={() => setEarlier(true)}><Icon name="up" />{`Voir les ${before.length} jours précédents`}</button> : null}
        {shown.map((day) => (
          <section key={day} className={`up-day${day < today ? ' past' : ''}${day === today ? ' today' : ''}`}>
            <h2 className="section-title">{label(day)}<small>{fmtDate(day)}</small></h2>
            <div className="up-grid">{groups.get(day).map((e, i) => <UpCard key={`${e.key}-${e.season}-${e.episode}-${i}`} e={e} ctx={ctx} />)}</div>
          </section>
        ))}
        {!shown.length ? (
          <div className="grid-empty">
            <p>{filter === 'fav' ? 'Aucun favori à venir.' : filter === 'nas' ? 'Rien de disponible pour ces jours-ci.' : 'Rien d’annoncé pour l’instant.'}</p>
            {kind === 'movie' && !d.arr && !d.tmdb ? <p className="muted">Venus n’a pas pu joindre les catalogues de sorties (Cinemeta, sans clé). Pour plus de films annoncés, reliez Radarr ou ajoutez une clé TMDB dans les Réglages.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Image d'un élément (masquée si elle manque)
function Pic({ e, wide }) {
  const [ok, setOk] = useState(true);
  const src = wide ? e.image || e.poster : e.poster || e.image;
  if (!src || !ok) return <div className="up-ph"><span>{nameOf(e)}</span></div>;
  const main = <img src={img(src)} alt="" loading="lazy" referrerPolicy="no-referrer" className={wide && !e.image ? 'tall' : ''} onError={() => setOk(false)} />;
  // Pas d'image en largeur : l'affiche posée sur un fond flou de la même image
  return wide && !e.image ? <div className="up-tall"><img src={img(src)} alt="" className="up-blur" aria-hidden="true" referrerPolicy="no-referrer" />{main}</div> : main;
}

// Bouton favori (♡)
function FavBtn({ e, ctx, wide = false }) {
  const on = ctx.favs.has(e.key);
  return (
    <button type="button" className={`up-act fav f${wide ? ' wide btn' : ''}${on ? ' on' : ''}`} title={on ? 'Retirer des favoris' : 'Favori : téléchargé automatiquement'}
      aria-label={on ? `Retirer « ${nameOf(e)} » des favoris` : `Mettre « ${nameOf(e)} » en favori (téléchargement automatique)`}
      onClick={(ev) => { ev.stopPropagation(); ctx.toggleFav(e); }}><Icon name="heart" />{wide ? (on ? 'En favori' : 'Favori') : null}</button>
  );
}

// Bouton de téléchargement (Radarr / Sonarr)
function DlBtn({ e, ctx, wide = false }) {
  const done = ctx.arr.has(e.key);
  const title = done ? `Déjà suivi par ${ctx.d.app} : téléchargé dès sa sortie` : ctx.d.arr ? `Télécharger avec ${ctx.d.app}` : `${ctx.d.app} n’est pas relié`;
  return (
    <button type="button" className={`up-act dl f${wide ? ' wide btn' : ''}${done ? ' done' : ''}${ctx.busy.has(e.key) ? ' busy' : ''}`} disabled={done || ctx.busy.has(e.key)} title={title} aria-label={title}
      onClick={(ev) => { ev.stopPropagation(); ctx.download(e); }}><Icon name={done ? 'check' : 'download'} />{wide ? (done ? `Suivi par ${ctx.d.app}` : 'Télécharger') : null}</button>
  );
}

// Ouvre la fiche d'un élément à venir
function details(e, ctx) {
  openSheet(null, () => <Details e={e} ctx={ctx} />, { wide: true });
}

// La fenêtre garde son propre état (favori, suivi) ; la page se met à jour à la fermeture des actions
function Details({ e, ctx: initial }) {
  const [favs, setFavs] = useState(initial.favs);
  const [arr, setArr] = useState(initial.arr);
  const ctx = { ...initial, favs, arr,
    toggleFav: async (x) => { await initial.toggleFav(x); setFavs((s) => { const n = new Set(s); if (n.has(x.key)) n.delete(x.key); else n.add(x.key); return n; }); },
    download: async (x) => { await initial.download(x); setArr((s) => new Set(s).add(x.key)); } };
  return (
    <div className="up-sheet">
      <div className="up-sheet-pic"><Pic e={e} wide /></div>
      <div className="up-sheet-body">
        <h2>{nameOf(e)}</h2>
        <p className="muted">{[e.kind === 'movie' ? e.release : epLabel(e), fmtDate(dayOf(e)), e.network].filter(Boolean).join(' · ')}</p>
        {e.genres && e.genres.length ? <p className="up-genres">{e.genres.slice(0, 4).join(' · ')}</p> : null}
        {e.overview ? <p className="up-over">{e.overview}</p> : null}
        {ctx.kids ? null : <div className="up-sheet-acts"><FavBtn e={e} ctx={ctx} wide />{ctx.d.arr ? <DlBtn e={e} ctx={ctx} wide /> : null}</div>}
        {ctx.kids ? null : <p className="muted small">{ctx.d.arr ? `Favori : le titre rejoint « Mes envies » et ${ctx.d.app} le télécharge dès qu’il est disponible.` : `Reliez ${ctx.d.app} (Réglages → Demandes) pour que les favoris se téléchargent tout seuls.`}</p>}
      </div>
    </div>
  );
}

// Carte d'un élément du calendrier
function UpCard({ e, ctx }) {
  const { components } = shared();
  const out = !e.nas;
  const ok = e.kind === 'movie' ? !!e.nas : !!e.epId;
  const open = () => { if (e.epId) go(components.playPath(e.epId)); else if (e.nas) go(`/titre/${e.nas}`); else details(e, ctx); };
  return (
    <div className={`up-card${out ? ' out' : ''}`} data-key={e.key}>
      <button type="button" className="up-pic f" aria-label={`${nameOf(e)}, ${epLabel(e)}`} onClick={open}>
        <Pic e={e} wide />
        <span className={`up-badge ${ok ? 'in' : 'out'}`}>{ok ? (e.seen ? 'Disponible · vu' : 'Disponible') : 'Pas disponible'}</span>
        {e.epId ? <span className="ep-play"><Icon name="play" /></span> : null}
        {e.at && e.kind !== 'movie' ? <span className="up-time">{new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </button>
      {out && !ctx.kids ? <div className="up-acts"><FavBtn e={e} ctx={ctx} />{ctx.d.arr ? <DlBtn e={e} ctx={ctx} /> : null}</div> : null}
      <b>{nameOf(e)}</b>
      <span>{epLabel(e)}</span>
    </div>
  );
}

// Carte d'une suggestion
function SugCard({ e, ctx }) {
  return (
    <div className="up-sug">
      <button type="button" className="up-sug-pic f" aria-label={nameOf(e)} onClick={() => details(e, ctx)}><Pic e={e} wide={false} /><span className="up-sug-date">{ctx.label(dayOf(e))}</span></button>
      {ctx.kids ? null : <div className="up-acts"><FavBtn e={e} ctx={ctx} />{ctx.d.arr ? <DlBtn e={e} ctx={ctx} /> : null}</div>}
      <b>{nameOf(e)}</b>
      <small>{e.kind === 'movie' ? [e.release, e.year].filter(Boolean).join(' · ') : [e.network, e.genres && e.genres[0]].filter(Boolean).join(' · ') || epLabel(e)}</small>
    </div>
  );
}

// Abonnement iCal : le calendrier du téléphone affiche les épisodes et sorties qui vous concernent
async function subscribe() {
  let url;
  try { url = (await api('/api/calendar/link')).url; } catch (e) { toast(e.message, true); return; }
  const webcal = url.replace(/^https?:/, 'webcal:');
  openSheet('Ajouter à mon calendrier', (
    <div className="cal-sheet">
      <p>Les épisodes de vos séries, les sorties de films demandées et vos favoris apparaissent dans le calendrier de votre téléphone ou de votre ordinateur, mis à jour tout seuls.</p>
      <div className="btn-row">
        <a className="btn btn-play f" href={webcal}><Icon name="cal" />S’abonner (iPhone, Mac, Outlook)</a>
        <button className="btn f" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Lien copié'), () => {})}><Icon name="copy" />Copier le lien</button>
      </div>
      <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
      <p className="muted small">Google Agenda : Paramètres → Ajouter un agenda → À partir de l’URL, puis collez le lien. Ce lien est personnel : ne le partagez pas. Il ne fonctionne que sur le réseau de la maison (ou à distance si Venus est accessible depuis Internet).</p>
    </div>
  ));
}

// ---------------------------------------------------------------- Ma liste → Mes envies
const WISH_STATE = { none: 'Pas encore demandé', pending: 'Demandé, en attente de validation', processing: 'Demandé : téléchargé dès sa sortie', partial: 'Disponible en partie', available: 'Disponible, arrive dans Venus', blocked: 'Bloqué dans Seerr', deleted: 'Supprimé de Seerr', error: 'Seerr injoignable' };
const KIND = { movie: 'Film', show: 'Série', anime: 'Animé' };

// Onglet « Mes envies »
export function Wishes({ tabs }) {
  const [state, setState] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([api('/api/wishlist'), api('/api/wanted').catch(() => [])]).then(([d, wanted]) => setState({ d, wanted })).catch((e) => setErr(e)).finally(() => shared().app.hideBoot());
  }, []);
  if (err) return <div className="page"><div className="empty"><h2>Impossible d’afficher vos envies</h2><p>{err.message}</p></div></div>;
  if (!state) return <div className="page" aria-busy="true"><i className="sk" style={{ width: 220, height: 48 }} /></div>;
  const { d, wanted } = state;
  const today = new Date().toISOString().slice(0, 10);
  const n = d.items.length + wanted.length;
  const removeWanted = async (w) => {
    if (w.venusAdded && !(await shared().ui.confirmSheet(`Retirer « ${w.title} » de vos favoris ? Venus l’avait fait télécharger : les téléchargements en cours seront annulés et les fichiers supprimés du NAS.`, 'Retirer et supprimer'))) return;
    const rm = await api(`/api/wanted?key=${encodeURIComponent(w.key)}`, { method: 'DELETE' });
    setState((s) => ({ ...s, wanted: s.wanted.filter((x) => x !== w) }));
    toast(rm && rm.removed ? `« ${w.title} » retiré : téléchargements annulés et fichiers supprimés du NAS` : 'Retiré de mes favoris');
  };
  const removeWish = async (w) => { await api(`/api/wishlist/${w.type}/${w.tmdbId}`, { method: 'DELETE' }); setState((s) => ({ ...s, d: { ...s.d, items: s.d.items.filter((x) => x !== w) } })); toast('Retiré de mes envies'); };
  return (
    <div className="page">
      <div className="page-head"><div className="head-left"><h1>Ma liste</h1><p className="count">{`${n} envie${n > 1 ? 's' : ''}`}</p></div>{tabs}</div>
      <p className="list-hint">{!d.seerr ? 'Vos favoris pris dans « À venir » (Films, Séries, Animés, bouton ♡) : ils sont envoyés à Radarr ou Sonarr et téléchargés dès leur sortie.'
        : d.kids ? 'Vos envies sont visibles par les adultes de la maison, qui décident du téléchargement.'
          : d.auto ? 'Chaque envie est demandée à Seerr tout de suite : le téléchargement démarre dès que le titre sort. Une fois arrivé, il passe dans « Dans Venus ».'
            : 'Les demandes automatiques sont désactivées : un administrateur peut les activer dans Réglages, Seerr.'}</p>
      <div className="wish-grid">
        {!n ? (
          <div className="grid-empty"><p>Aucune envie pour l’instant.</p><p className="muted">Dans Films, Séries ou Animés, onglet « À venir », le ♡ ajoute un titre ici et le fait télécharger.</p><button className="btn btn-small f" onClick={() => go('/series?vue=avenir')}><Icon name="cal" />Voir ce qui arrive</button></div>
        ) : (
          <>
            {wanted.map((w) => {
              const app = w.kind === 'movie' ? 'Radarr' : 'Sonarr';
              const future = w.date && w.date > today;
              const lbl = w.nas ? 'Disponible' : w.error ? `${app} : ${w.error}` : w.sent ? `Demandé à ${app} : téléchargé dès sa sortie` : `En favori (reliez ${app} pour le téléchargement)`;
              return (
                <article key={w.key} className="wish" onClick={(e) => { if (w.nas && !e.target.closest('button')) go(`/titre/${w.nas}`); }}>
                  <div className="wish-pic">{w.poster || w.image ? <img src={img(w.poster || w.image)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{w.title}</span>}{future ? <span className="wish-date">{`Sortie le ${fmtDate(w.date)}`}</span> : null}</div>
                  <div className="wish-body"><b>{w.title}</b><span className="wish-meta">{[KIND[w.kind], w.year].filter(Boolean).join(' · ')}</span><span className={`wish-state st-${w.nas ? 'available' : w.error ? 'error' : w.sent ? 'processing' : 'none'}`}>{lbl}</span></div>
                  <button className="btn btn-ghost btn-icon btn-mini f" aria-label={`Retirer ${w.title} de mes favoris`} title="Retirer" onClick={() => removeWanted(w)}><Icon name="close" /></button>
                </article>
              );
            })}
            {d.items.map((w) => {
              const st = w.seerr || { state: w.requested ? 'processing' : 'none' };
              const future = w.date && w.date > today;
              const lbl = st.downloading && st.progress != null ? `Téléchargement ${st.progress} %` : st.state === 'processing' && !future ? 'Demandé, recherche en cours' : WISH_STATE[st.state] || 'Suivi';
              return (
                <article key={`${w.type}-${w.tmdbId}`} className="wish">
                  <div className="wish-pic">{w.poster ? <img src={w.poster} alt="" loading="lazy" /> : <span>{w.title}</span>}{future ? <span className="wish-date">{`Sortie le ${fmtDate(w.date)}`}</span> : null}</div>
                  <div className="wish-body">
                    <b>{w.title}</b>
                    <span className="wish-meta">{[w.type === 'movie' ? 'Film' : w.anime ? 'Animé' : 'Série', w.date ? w.date.slice(0, 4) : null].filter(Boolean).join(' · ')}</span>
                    <span className={`wish-state st-${st.state}`}>{lbl}</span>
                    {st.downloading && st.progress != null ? <div className="meter"><i style={{ width: `${st.progress}%` }} /></div> : null}
                    {w.error && st.state !== 'processing' ? <small className="error-text">{w.error}</small> : null}
                  </div>
                  <button className="btn btn-ghost btn-icon btn-mini f" aria-label={`Retirer ${w.title} de mes envies`} title="Retirer" onClick={() => removeWish(w)}><Icon name="close" /></button>
                </article>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
