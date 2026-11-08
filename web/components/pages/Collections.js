'use client';
// Collections (sagas TMDB et collections de l'administrateur) et listes de lecture de chaque profil
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import Card, { Placeholder } from '../Card';
import { PageError, PageLoading } from '../PageState';

const confirm = (m, l) => shared().ui.confirmSheet(m, l);
const refresh = () => shared().app.hostHooks.refresh();
const runtime = (min) => shared().ui.fmtRuntime(min);

function Cover({ x }) {
  const imgs = (x.posters || []).slice(0, 4);
  return <div className={`coll-cover n${imgs.length}`}>{imgs.length ? imgs.map((p, i) => <img key={i} src={img(p, 342)} alt="" loading="lazy" />) : <Placeholder title={x.name} />}</div>;
}

export default function Collections() {
  useTitle('Collections');
  const { search } = useVenus();
  const [tab, setTab] = useState(search && search.get('onglet') === 'listes' ? 'playlists' : 'collections');
  const { data: d, error } = useApi('/api/collections');
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const admin = shared().app.state.profile.isAdmin;
  const list = tab === 'collections' ? d.collections : d.playlists;
  return (
    <main className="with-nav page-in">
      <div className="page">
        <div className="page-head">
          <div className="head-left"><h1>Collections</h1></div>
          <div className="head-tools">
            <div className="seg">{[['collections', `Collections (${d.collections.length})`], ['playlists', `Listes de lecture (${d.playlists.length})`]].map(([k, l]) => <button key={k} className={`seg-b f${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
            {tab === 'playlists' ? <button className="btn btn-small f" onClick={() => newPlaylist().then((r) => r && go(`/liste-lecture/${r.id}`))}><Icon name="plus" />Nouvelle liste</button>
              : admin ? <button className="btn btn-small f" onClick={() => newCollection().then((r) => r && go(`/collection/${r.id}`))}><Icon name="plus" />Nouvelle collection</button> : null}
          </div>
        </div>
        {list.length ? (
          <div className="coll-grid">
            {list.map((x) => (
              <button key={x.id} className="coll-tile f" onClick={() => go(tab === 'playlists' ? `/liste-lecture/${x.id}` : `/collection/${x.id}`)}>
                <Cover x={x} />
                <b>{x.name}</b>
                <small>{[`${x.count} titre${x.count > 1 ? 's' : ''}`, x.auto ? 'Saga' : null, x.duration ? runtime(Math.round(x.duration / 60)) : null].filter(Boolean).join(' · ')}</small>
              </button>
            ))}
          </div>
        ) : <p className="grid-empty">{tab === 'playlists' ? 'Aucune liste de lecture. Appui long (ou clic droit) sur une affiche → « Ajouter à une liste », ou bouton « … » sur une fiche.' : 'Les sagas (films d’une même série) apparaissent ici toutes seules quand au moins deux de leurs films sont dans Venus.'}</p>}
      </div>
    </main>
  );
}

export function Collection() {
  const { id } = useParams();
  const { data: d, error } = useApi(`/api/collections/${encodeURIComponent(id)}`);
  useTitle(d ? d.name : undefined);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const remove = async (i) => { await api(`/api/admin/collections/${d.id}/items`, { method: 'POST', body: { itemId: i.id, remove: true } }); toast(`« ${i.title} » retiré`); refresh(); };
  return (
    <main className="with-nav page-in">
      <div className="page coll-page">
        {d.backdrop ? <div className="coll-bg"><img src={img(d.backdrop, 780)} alt="" /></div> : null}
        <div className="page-head">
          <div className="head-left"><h1>{d.name}</h1><p className="count">{`${d.items.length} titre${d.items.length > 1 ? 's' : ''}${d.auto ? ' · saga regroupée d’après TMDB' : ''}`}</p></div>
          <div className="head-tools">
            <button className="btn btn-ghost btn-small f" onClick={() => go('/collections')}><Icon name="back" />Collections</button>
            {d.editable ? <button className="btn btn-ghost btn-small f" onClick={() => rename('Renommer la collection', d.name, (name) => api(`/api/admin/collections/${d.id}`, { method: 'PUT', body: { name } }))}><Icon name="edit" />Renommer</button> : null}
            {d.editable ? <button className="btn btn-ghost btn-small btn-del f" onClick={async () => { if (!(await confirm(`Supprimer la collection « ${d.name} » ? Les vidéos restent dans Venus.`, 'Supprimer'))) return; await api(`/api/admin/collections/${d.id}`, { method: 'DELETE' }); go('/collections', { replace: true }); }}><Icon name="trash" /></button> : null}
          </div>
        </div>
        {d.overview ? <p className="coll-over">{d.overview}</p> : null}
        {d.items.length ? (
          <div className="grid">
            {d.items.map((i) => (d.editable
              ? <div key={i.id} className="coll-item"><Card item={i} poster /><button className="coll-x f" aria-label={`Retirer « ${i.title} »`} title="Retirer de la collection" onClick={() => remove(i)}><Icon name="close" /></button></div>
              : <Card key={i.id} item={i} poster />))}
          </div>
        ) : <p className="grid-empty">Collection vide : ajoutez des titres avec le bouton « … » d’une fiche.</p>}
      </div>
    </main>
  );
}

export function Playlist() {
  const { id } = useParams();
  const { data: d, error } = useApi(`/api/playlists/${Number(id)}`);
  useTitle(d ? d.name : undefined);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  return <PlaylistView d={d} />;
}

function PlaylistView({ d }) {
  const L = shared();
  const [items, setItems] = useState(d.items);
  const list = useRef(null);
  const save = (next) => api(`/api/playlists/${d.id}`, { method: 'PUT', body: { order: next.map((i) => i.id) } }).catch((e) => toast(e.message, true));
  const move = (n, dir) => {
    const j = n + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[n], next[j]] = [next[j], next[n]];
    setItems(next); save(next);
    requestAnimationFrame(() => list.current && list.current.querySelectorAll('.pl-row')[j]?.querySelector(dir < 0 ? '.pl-up' : '.pl-down')?.focus());
  };
  const playFrom = (startId, shuffle = false) => { const q = L.queue.setQueue(items, { title: d.name, startId, shuffle }); if (q) go(L.components.playPath(q.id)); };
  const firstUnseen = () => (items.find((i) => !(i.progress && i.progress.watched)) || items[0] || {}).id;
  const total = d.duration;
  return (
    <main className="with-nav page-in">
      <div className="page coll-page">
        <div className="page-head">
          <div className="head-left"><h1>{d.name}</h1><p className="count">{`${items.length} vidéo${items.length > 1 ? 's' : ''}${total ? ` · ${runtime(Math.round(total / 60))}` : ''}`}</p></div>
          <div className="head-tools">
            <button className="btn btn-ghost btn-small f" onClick={() => go('/collections?onglet=listes')}><Icon name="back" />Listes</button>
            <button className="btn btn-ghost btn-small f" onClick={() => rename('Renommer la liste', d.name, (name) => api(`/api/playlists/${d.id}`, { method: 'PUT', body: { name } }))}><Icon name="edit" />Renommer</button>
            <button className="btn btn-ghost btn-small btn-del f" aria-label="Supprimer la liste" onClick={async () => { if (!(await confirm(`Supprimer la liste « ${d.name} » ? Les vidéos restent dans Venus.`, 'Supprimer'))) return; await api(`/api/playlists/${d.id}`, { method: 'DELETE' }); go('/collections?onglet=listes', { replace: true }); }}><Icon name="trash" /></button>
          </div>
        </div>
        {items.length ? (
          <div className="actions" style={{ marginBottom: 18 }}>
            <button className="btn btn-play f" data-autofocus="true" onClick={() => playFrom(firstUnseen())}><Icon name="play" />{items.some((i) => i.progress && i.progress.watched) ? 'Continuer' : 'Tout lire'}</button>
            <button className="btn btn-ghost f" onClick={() => playFrom(null, true)}><Icon name="shuffle" />Aléatoire</button>
          </div>
        ) : null}
        <div className="pl-list" ref={list}>
          {items.length ? items.map((i, n) => {
            const watched = i.progress && i.progress.watched;
            return (
              <div key={i.id} className={`pl-row${watched ? ' seen' : ''}`}>
                <span className="pl-n">{n + 1}</span>
                <button className="pl-main f" onClick={() => playFrom(i.id)}>
                  <span className="pl-thumb"><Thumb i={i} /><span className="ep-play"><Icon name="play" /></span></span>
                  <span className="pl-txt"><b>{i.showTitle ? `${i.showTitle} · S${i.season} É${i.episode}` : i.title}</b><small>{[i.showTitle ? i.title : i.year, i.duration ? `${Math.max(1, Math.round(i.duration / 60))} min` : null, watched ? 'Vu' : null].filter(Boolean).join(' · ')}</small></span>
                </button>
                <div className="pl-tools">
                  <button className="p-icon small f pl-up" aria-label="Monter" disabled={n === 0} onClick={() => move(n, -1)}><Icon name="up" /></button>
                  <button className="p-icon small f pl-down" aria-label="Descendre" disabled={n === items.length - 1} onClick={() => move(n, 1)}><Icon name="down" /></button>
                  <button className="p-icon small f" aria-label={`Retirer « ${i.title} »`} onClick={async () => { await api(`/api/playlists/${d.id}/items`, { method: 'POST', body: { itemId: i.id, remove: true } }); setItems((l) => l.filter((x) => x !== i)); toast(`« ${i.title} » retiré de la liste`); }}><Icon name="close" /></button>
                </div>
              </div>
            );
          }) : <p className="grid-empty">Liste vide : appui long (ou clic droit) sur une affiche → « Ajouter à une liste ».</p>}
        </div>
      </div>
    </main>
  );
}

function Thumb({ i }) {
  const [ok, setOk] = useState(true);
  return ok ? <img src={i.still ? img(i.still) : i.backdrop ? img(i.backdrop, 342) : `/api/items/${i.id}/thumb`} alt="" loading="lazy" onError={() => setOk(false)} /> : <Placeholder title={i.title} />;
}

// Petite fenêtre « un nom » : renommer, nouvelle liste, nouvelle collection
function NameForm({ value = '', placeholder, button, note = null, onSubmit }) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState('');
  const input = useRef(null);
  useEffect(() => { requestAnimationFrame(() => { input.current.focus(); input.current.select(); }); }, []);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await onSubmit(v.trim(), setErr); } catch (e2) { setErr(e2.message); } }}>
      <input ref={input} className="input" value={v} placeholder={placeholder} maxLength={80} onChange={(e) => setV(e.target.value)} />
      {note}
      <p className="error-text">{err}</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit">{button}</button></div>
    </form>
  );
}

function rename(title, value, save) {
  openSheet(title, (close) => <NameForm value={value} button="Enregistrer" onSubmit={async (name, setErr) => { if (!name) { setErr('Le nom est obligatoire'); return; } await save(name); close(); refresh(); }} />);
}

export function newPlaylist(itemId = null) {
  return new Promise((resolve) => {
    let done = false;
    openSheet('Nouvelle liste de lecture', (close) => (
      <NameForm placeholder="Ex. : Marathon du dimanche" button="Créer" onSubmit={async (name, setErr) => {
        if (!name) { setErr('Donnez un nom à la liste'); return; }
        const r = await api('/api/playlists', { method: 'POST', body: { name, ...(itemId ? { itemId } : {}) } });
        done = true; close();
        toast(`Liste « ${name} » créée${r.added ? ` avec ${r.added} vidéo${r.added > 1 ? 's' : ''}` : ''}`, { type: 'success' });
        resolve(r);
      }} />
    ), { onClose: () => { if (!done) resolve(null); } });
  });
}

export function newCollection(itemId = null) {
  return new Promise((resolve) => {
    let done = false;
    openSheet('Nouvelle collection', (close) => (
      <NameForm placeholder="Ex. : Films de Noël" button="Créer" note={<p className="muted">Visible par tous les profils (selon leur âge).</p>} onSubmit={async (name, setErr) => {
        if (!name) { setErr('Donnez un nom à la collection'); return; }
        const r = await api('/api/admin/collections', { method: 'POST', body: { name, ...(itemId ? { itemId } : {}) } });
        done = true; close();
        toast(`Collection « ${name} » créée`, { type: 'success' });
        resolve(r);
      }} />
    ), { onClose: () => { if (!done) resolve(null); } });
  });
}

// « Ajouter à… » : une liste de lecture (tous) ou une collection (administrateur)
export async function addToSheet(item) {
  const d = await api('/api/collections');
  const admin = shared().app.state.profile.isAdmin;
  openSheet(`Ajouter « ${item.title} »`, (close) => {
    const addPl = async (pl) => {
      try { const r = await api(`/api/playlists/${pl.id}/items`, { method: 'POST', body: { itemId: item.id } }); close(); toast(r.added ? `Ajouté à « ${pl.name} »${r.added > 1 ? ` (${r.added} épisodes)` : ''}` : `Déjà dans « ${pl.name} »`, { type: 'success', action: { label: 'Voir', onClick: () => go(`/liste-lecture/${pl.id}`) } }); }
      catch (e) { toast(e.message, true); }
    };
    const addColl = async (c) => {
      try { await api(`/api/admin/collections/${c.id}/items`, { method: 'POST', body: { itemId: item.id } }); close(); toast(`Ajouté à la collection « ${c.name} »`, { type: 'success', action: { label: 'Voir', onClick: () => go(`/collection/${c.id}`) } }); }
      catch (e) { toast(e.message, true); }
    };
    return (
      <div>
        <h3>Listes de lecture</h3>
        {d.playlists.map((pl) => <button key={pl.id} className="opt ic f" onClick={() => addPl(pl)}><Icon name="list" />{pl.name}<small>{`${pl.count} vidéo${pl.count > 1 ? 's' : ''}`}</small></button>)}
        <button className="opt ic f" onClick={async () => { close(); const r = await newPlaylist(item.id); if (r) toast('Liste créée', { action: { label: 'Voir', onClick: () => go(`/liste-lecture/${r.id}`) } }); }}><Icon name="plus" />Nouvelle liste de lecture</button>
        {admin && ['movie', 'show', 'clip'].includes(item.type) ? (
          <>
            <h3 style={{ marginTop: 16 }}>Collections</h3>
            {d.collections.filter((c) => !c.auto).map((c) => <button key={c.id} className="opt ic f" onClick={() => addColl(c)}><Icon name="grid4" />{c.name}<small>{`${c.count} titre${c.count > 1 ? 's' : ''}`}</small></button>)}
            <button className="opt ic f" onClick={async () => { close(); const r = await newCollection(item.id); if (r) go(`/collection/${r.id}`); }}><Icon name="plus" />Nouvelle collection</button>
          </>
        ) : null}
      </div>
    );
  });
}
