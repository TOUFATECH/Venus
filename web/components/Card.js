'use client';
// Carte d'un titre (affiche ou vignette) en React : nom, sous-titre, note, progression, « vu »,
// nombre d'épisodes. L'aperçu vidéo au survol et le menu rapide (clic droit, appui long) sont ceux de Venus.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import { Icon } from './Icon';

// Affiche → fiche : l'affiche de la carte glisse et grandit jusqu'à sa place sur la fiche (transition de vue).
// Un seul élément porte le nom à la fois (jamais de doublon), et on n'attend pas la fiche plus de 0,6 s.
function morphTo(from, path) {
  const L = shared();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!from || !document.startViewTransition || reduce || document.documentElement.classList.contains('lite')) { L.app.go(path); return; }
  const before = document.querySelector('.details-poster');
  from.style.viewTransitionName = 'vt-poster';
  let vt;
  try {
    vt = document.startViewTransition(() => new Promise((resolve) => {
      from.style.viewTransitionName = '';
      L.app.go(path);
      const t0 = Date.now();
      const look = () => {
        const to = document.querySelector('.details-poster');
        if (to && to !== before) { to.style.viewTransitionName = 'vt-poster'; resolve(); return; }
        if (Date.now() - t0 > 600) { resolve(); return; }
        setTimeout(look, 16);
      };
      look();
    }));
  } catch { from.style.viewTransitionName = ''; L.app.go(path); return; }
  vt.finished.finally(() => { const to = document.querySelector('.details-poster'); if (to) to.style.viewTransitionName = ''; }).catch(() => {});
  vt.ready.catch(() => {});
}

// Fiche préparée d'avance : ses données (cache de l'API) et sa page Next.js
function prefetchItem(item, isEp) {
  const L = shared();
  L.api.prefetch(`/api/items/${isEp ? item.showId : item.id}`);
  const h = L.app.hostHooks;
  if (!isEp && item.path && h && h.prefetch) h.prefetch(item.path);
}

// Image avec fondu à l'arrivée ; aplat de couleur si elle manque
export function Picture({ src, title, className = '', lazy = true }) {
  const [failed, setFailed] = useState(!src);
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (el && el.complete && el.naturalWidth) el.classList.add('ok'); }, [src]);
  if (failed) return <Placeholder title={title} />;
  return (
    <img ref={ref} src={src} alt="" className={lazy ? `${className} fade`.trim() : className} loading={lazy ? 'lazy' : 'eager'} decoding="async"
      onLoad={(e) => e.currentTarget.classList.add('ok')} onError={() => setFailed(true)} />
  );
}

export function Placeholder({ title, cls = 'ph', text = false }) {
  return <div className={cls} style={{ '--h': shared().ui.hueOf(title) }}>{text ? title : null}</div>;
}

// Image tirée de la vidéo (pas d'affiche ni de fond connus)
export function FrameImage({ id, title }) {
  return <Picture src={`/api/items/${id}/thumb`} title={title} />;
}

export function FramePoster({ item }) {
  return <div className="gen-poster"><FrameImage id={item.id} title={item.title} /></div>;
}

export default function Card({ item: initial, poster = false, rank = null, queue = null, onFocus = null, children = null }) {
  const L = shared();
  const { ui, components, api, app, queue: Q } = L;
  const [item, setItem] = useState(initial);
  const ref = useRef(null);
  useEffect(() => setItem(initial), [initial]);
  // Aperçu au survol et menu rapide : comportements partagés avec le reste de Venus
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    components.attachPreview(el, item);
    components.attachQuick(el, item);
  }, []);

  const isEp = item.type === 'episode';
  const isClip = item.type === 'clip';
  const p = item.progress;
  const resume = !!(p && !p.watched && p.position > 0) || item.next;
  const title = isEp ? item.showTitle || item.title : item.title;

  let media;
  if (poster) media = item.poster ? <Picture src={ui.img(item.poster, 342)} title={title} /> : <FramePoster item={{ ...item, title }} />;
  else {
    const src = ui.img(item.backdrop || item.still, 780);
    media = src ? <Picture src={src} title={title} /> : <FrameImage id={item.id} title={title} />;
  }

  let sub;
  if (isEp && item.fresh) sub = `S${item.season} É${item.episode}${item.released ? `, sorti le ${ui.fmtDate(item.released, false)}` : ''}`;
  else if (isEp && item.next) sub = `À suivre : saison ${item.season}, épisode ${item.episode}`;
  else if (isEp) sub = `S${item.season} É${item.episode}, ${item.title}${resume ? `, ${components.remaining(p) || ''}` : ''}`;
  else if (resume) sub = components.remaining(p);
  else if (isClip) sub = item.originalTitle || 'Clip';
  else if (item.type === 'show' && item.status === 'progress' && item.unseen) sub = `${item.unseen} épisode${item.unseen > 1 ? 's' : ''} non vu${item.unseen > 1 ? 's' : ''}`;
  else sub = [item.year, item.type === 'show' ? (item.category === 'anime' ? 'Animé' : 'Série') : (item.genres || [])[0]].filter(Boolean).join(', ');
  const sc = !isEp && !isClip ? components.scoreOf(item) : null;
  const isNew = (isEp && item.fresh && ui.daysSince(item.released) <= 14) || (!isEp && !isClip && ui.daysSince(item.released) <= 30);
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const seen = item.status === 'seen' || (p && p.watched && !resume);

  // Le nom ouvre la fiche (film, série, animé) ; l'image lance la lecture quand c'est le plus utile
  const open = (e) => {
    const onTitle = e.target.closest && e.target.closest('.cap');
    if (isClip) { if (queue) Q.setQueue(queue(), { startId: item.id }); return app.go(components.playPath(item.id)); }
    const toTitle = onTitle || !(resume || isEp);
    if (toTitle) window.__vtFrom = ref.current && ref.current.querySelector('.shot');
    // Adresse lisible donnée par le serveur (/films/inception-2010), sinon le numéro
    const fiche = item.path && !isEp ? item.path : `/titre/${item.id}`;
    const shot = ref.current && ref.current.querySelector('.shot');
    if (onTitle) return isEp ? app.go(`/titre/${item.showId}?ep=${item.id}`) : morphTo(shot, fiche);
    return resume || isEp ? app.go(components.playPath(item.id, item.next ? 0 : undefined)) : morphTo(shot, fiche);
  };

  // Vu / non vu d'un clic, sans ouvrir la fiche
  const toggleSeen = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const before = item;
    try {
      await api.api(`/api/items/${item.id}/watched`, { method: 'POST', body: { watched: !seen } });
      setItem({ ...item, status: seen ? 'unseen' : 'seen', progress: seen ? null : { ...(p || {}), watched: true, position: 0 }, unseen: seen ? item.episodes : 0, next: null });
      ui.toast(seen ? `« ${title} » : non vu` : `« ${title} » : vu`, { type: 'success', action: { label: 'Annuler', onClick: async () => { await api.api(`/api/items/${item.id}/watched`, { method: 'POST', body: { watched: seen } }); setItem(before); } } });
    } catch (err) { ui.toast(err.message, true); }
  };

  return (
    <button ref={ref} className={`card f${poster ? ' poster' : ''}`}
      data-pre={!isClip ? String(isEp ? item.showId || '' : item.id) : undefined}
      data-bg={!isClip && !isEp && item.backdrop ? item.backdrop : undefined}
      aria-label={[title, sub, seen ? 'déjà vu' : null].filter(Boolean).join(', ')}
      onClick={open}
      onFocus={onFocus ? () => onFocus(item) : undefined}
      onPointerDown={() => { if (!isClip) api.prefetch(`/api/items/${isEp ? item.showId : item.id}`); }}
      // Survol (souris) ou sélection au clavier / télécommande : la fiche et sa page se préparent, elle s'ouvre aussitôt
      onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !isClip) { clearTimeout(ref.preT); ref.preT = setTimeout(() => prefetchItem(item, isEp), 140); } }}
      onPointerLeave={() => clearTimeout(ref.preT)}
      onFocusCapture={() => { if (!isClip) { clearTimeout(ref.preT); ref.preT = setTimeout(() => prefetchItem(item, isEp), 250); } }}>
      <div className="shot">
        {media}
        {rank ? <span className="rank" aria-hidden="true">{rank}</span> : null}
        {isNew && !seen ? <span className="tag-new">{isEp ? 'Nouvel épisode' : 'Nouveau'}</span> : null}
        {pct > 0 && !(p && p.watched) ? <div className="bar"><i style={{ width: `${pct}%` }} /></div> : null}
        {seen ? <span className="check" title="Déjà vu"><Icon name="check" /></span> : null}
        {item.type === 'show' && item.episodes
          ? <span className="ep-pill" title={`${item.episodes} épisode${item.episodes > 1 ? 's' : ''}`}>
              {item.status === 'progress' && item.unseen != null && item.unseen < item.episodes ? `${item.episodes - item.unseen}/${item.episodes}` : `${item.episodes} ép.`}
            </span>
          : null}
        {item.vf
          ? <span className={`vf-pill${item.vf === 'partiel' ? ' part' : ''}`} title={item.vf === 'partiel' ? `VF disponible pour ${item.vfn || 'une partie des'} épisodes` : 'VF disponible (piste audio française)'}>
              {item.vf === 'partiel' && item.vfn ? `VF ${item.vfn.split('/')[0]}` : 'VF'}
            </span>
          : null}
        {item.type === 'show' && item.newEps && item.status !== 'seen'
          ? <span className="new-pill" title={`${item.newEps} épisode${item.newEps > 1 ? 's' : ''} ajouté${item.newEps > 1 ? 's' : ''} cette semaine`}>{`+${item.newEps} nouveau${item.newEps > 1 ? 'x' : ''}`}</span>
          : null}
        {!isClip
          ? <span role="button" tabIndex={0} className="card-eye f" aria-label={seen ? `Marquer « ${title} » comme non vu` : `Marquer « ${title} » comme vu`} title={seen ? 'Marquer comme non vu' : 'Marquer comme vu'}
              onClick={toggleSeen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSeen(e); }}><Icon name={seen ? 'eye-off' : 'eye'} /></span>
          : null}
      </div>
      <div className="cap">
        <b title={isClip ? title : isEp ? `Voir S${item.season}:É${item.episode} - ${item.title} dans sa saison` : `Voir la fiche de ${title}`}>{title}</b>
        {sub || sc ? <small>{sub || ''}{sc ? <span className="cap-score" title="Note moyenne des sites">{`★ ${sc.toFixed(1).replace('.', ',')}`}</span> : null}</small> : null}
      </div>
      {children}
    </button>
  );
}
