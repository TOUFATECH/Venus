// Collections (sagas TMDB et collections de l'administrateur) et listes de lecture de chaque profil (comme Jellyfin)
import { api } from '../api.js';
import { h, icon, img, toast, sheet, confirmSheet, fmtRuntime, placeholder } from '../ui.js';
import { card, playPath } from '../components.js';
import { go, state, setTitle } from '../core.js';
import { setQueue } from '../queue.js';

const cover = (x) => {
  const imgs = (x.posters || []).slice(0, 4);
  return h('div', { class: `coll-cover n${imgs.length}` }, imgs.length ? imgs.map((p) => h('img', { src: img(p, 342), alt: '', loading: 'lazy' })) : placeholder(x.name));
};
const tile = (x, href) => h('button', { class: 'coll-tile f', onclick: () => go(href) }, cover(x),
  h('b', {}, x.name), h('small', {}, [`${x.count} titre${x.count > 1 ? 's' : ''}`, x.auto ? 'Saga' : null, x.duration ? fmtRuntime(Math.round(x.duration / 60)) : null].filter(Boolean).join(' · ')));

export async function render(main, { view = 'all', id, query } = {}) {
  if (view === 'collection') return renderCollection(main, id);
  if (view === 'playlist') return renderPlaylist(main, id);
  setTitle('Collections');
  const page = h('div', { class: 'page' });
  main.append(page);
  let tab = (query && query.get('onglet')) === 'listes' ? 'playlists' : 'collections';
  const paint = async () => {
    const d = await api('/api/collections');
    const tabs = h('div', { class: 'seg' }, [['collections', `Collections (${d.collections.length})`], ['playlists', `Listes de lecture (${d.playlists.length})`]].map(([k, l]) => h('button', { class: `seg-b f${tab === k ? ' on' : ''}`, onclick: () => { tab = k; paint(); } }, l)));
    const list = tab === 'collections' ? d.collections : d.playlists;
    const add = tab === 'playlists' ? h('button', { class: 'btn btn-small f', onclick: () => newPlaylist().then((r) => r && go(`/liste-lecture/${r.id}`)) }, icon('plus'), 'Nouvelle liste')
      : state.profile.isAdmin ? h('button', { class: 'btn btn-small f', onclick: () => newCollection().then((r) => r && go(`/collection/${r.id}`)) }, icon('plus'), 'Nouvelle collection') : null;
    page.replaceChildren(
      h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Collections')), h('div', { class: 'head-tools' }, tabs, add)),
      list.length ? h('div', { class: 'coll-grid' }, list.map((x) => tile(x, tab === 'playlists' ? `/liste-lecture/${x.id}` : `/collection/${x.id}`)))
        : h('p', { class: 'grid-empty' }, tab === 'playlists'
          ? 'Aucune liste de lecture. Appui long (ou clic droit) sur une affiche → « Ajouter à une liste », ou bouton « … » sur une fiche.'
          : 'Les sagas (films d’une même série) apparaissent ici toutes seules quand au moins deux de leurs films sont dans Venus.'));
  };
  await paint();
}

async function renderCollection(main, id) {
  const d = await api(`/api/collections/${encodeURIComponent(id)}`);
  setTitle(d.name);
  const page = h('div', { class: 'page coll-page' });
  const grid = h('div', { class: 'grid' }, d.items.map((i) => {
    const c = card(i, { poster: true });
    if (!d.editable) return c;
    return h('div', { class: 'coll-item' }, c, h('button', { class: 'coll-x f', 'aria-label': `Retirer « ${i.title} »`, title: 'Retirer de la collection', onclick: async () => {
      await api(`/api/admin/collections/${d.id}/items`, { method: 'POST', body: { itemId: i.id, remove: true } });
      toast(`« ${i.title} » retiré`); window.dispatchEvent(new HashChangeEvent('hashchange'));
    } }, icon('close')));
  }));
  page.append(
    d.backdrop ? h('div', { class: 'coll-bg' }, h('img', { src: img(d.backdrop, 780), alt: '' })) : null,
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, d.name), h('p', { class: 'count' }, `${d.items.length} titre${d.items.length > 1 ? 's' : ''}${d.auto ? ' · saga regroupée d’après TMDB' : ''}`)),
      h('div', { class: 'head-tools' },
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go('/collections') }, icon('back'), 'Collections'),
        d.editable ? h('button', { class: 'btn btn-ghost btn-small f', onclick: () => renameSheet('Renommer la collection', d.name, async (name) => { await api(`/api/admin/collections/${d.id}`, { method: 'PUT', body: { name } }); }) }, icon('edit'), 'Renommer') : null,
        d.editable ? h('button', { class: 'btn btn-ghost btn-small btn-del f', onclick: async () => {
          if (!(await confirmSheet(`Supprimer la collection « ${d.name} » ? Les vidéos restent dans Venus.`, 'Supprimer'))) return;
          await api(`/api/admin/collections/${d.id}`, { method: 'DELETE' }); go('/collections', { replace: true });
        } }, icon('trash')) : null)),
    d.overview ? h('p', { class: 'coll-over' }, d.overview) : null,
    d.items.length ? grid : h('p', { class: 'grid-empty' }, 'Collection vide : ajoutez des titres avec le bouton « … » d’une fiche.'));
  main.append(page);
}

async function renderPlaylist(main, id) {
  const d = await api(`/api/playlists/${Number(id)}`);
  setTitle(d.name);
  const page = h('div', { class: 'page coll-page' });
  let items = d.items;
  const save = () => api(`/api/playlists/${d.id}`, { method: 'PUT', body: { order: items.map((i) => i.id) } }).catch((e) => toast(e.message, true));
  const list = h('div', { class: 'pl-list' });
  const paintList = () => {
    list.replaceChildren(...items.map((i, n) => {
      const th = h('img', { src: i.still ? img(i.still) : i.backdrop ? img(i.backdrop, 342) : `/api/items/${i.id}/thumb`, alt: '', loading: 'lazy' });
      th.addEventListener('error', () => th.replaceWith(placeholder(i.title)), { once: true });
      const move = (dir) => { const j = n + dir; if (j < 0 || j >= items.length) return; [items[n], items[j]] = [items[j], items[n]]; paintList(); save(); list.querySelectorAll('.pl-row')[j]?.querySelector(dir < 0 ? '.pl-up' : '.pl-down')?.focus(); };
      const watched = i.progress && i.progress.watched;
      return h('div', { class: `pl-row${watched ? ' seen' : ''}` },
        h('span', { class: 'pl-n' }, String(n + 1)),
        h('button', { class: 'pl-main f', onclick: () => playFrom(i.id) }, h('span', { class: 'pl-thumb' }, th, h('span', { class: 'ep-play' }, icon('play'))),
          h('span', { class: 'pl-txt' }, h('b', {}, i.showTitle ? `${i.showTitle} · S${i.season} É${i.episode}` : i.title), h('small', {}, [i.showTitle ? i.title : i.year, i.duration ? `${Math.max(1, Math.round(i.duration / 60))} min` : null, watched ? 'Vu' : null].filter(Boolean).join(' · ')))),
        h('div', { class: 'pl-tools' },
          h('button', { class: 'p-icon small f pl-up', 'aria-label': 'Monter', disabled: n === 0, onclick: () => move(-1) }, icon('up')),
          h('button', { class: 'p-icon small f pl-down', 'aria-label': 'Descendre', disabled: n === items.length - 1, onclick: () => move(1) }, icon('down')),
          h('button', { class: 'p-icon small f', 'aria-label': `Retirer « ${i.title} »`, onclick: async () => {
            await api(`/api/playlists/${d.id}/items`, { method: 'POST', body: { itemId: i.id, remove: true } });
            items = items.filter((x) => x !== i); paintList(); toast(`« ${i.title} » retiré de la liste`);
          } }, icon('close'))));
    }));
    if (!items.length) list.replaceChildren(h('p', { class: 'grid-empty' }, 'Liste vide : appui long (ou clic droit) sur une affiche → « Ajouter à une liste ».'));
  };
  const playFrom = (startId, shuffle = false) => { const q = setQueue(items, { title: d.name, startId, shuffle }); if (q) go(playPath(q.id)); };
  const firstUnseen = () => (items.find((i) => !(i.progress && i.progress.watched)) || items[0] || {}).id;
  page.append(
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, d.name), h('p', { class: 'count' }, `${items.length} vidéo${items.length > 1 ? 's' : ''}${d.duration ? ` · ${fmtRuntime(Math.round(d.duration / 60))}` : ''}`)),
      h('div', { class: 'head-tools' },
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go('/collections?onglet=listes') }, icon('back'), 'Listes'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => renameSheet('Renommer la liste', d.name, async (name) => { await api(`/api/playlists/${d.id}`, { method: 'PUT', body: { name } }); }) }, icon('edit'), 'Renommer'),
        h('button', { class: 'btn btn-ghost btn-small btn-del f', 'aria-label': 'Supprimer la liste', onclick: async () => {
          if (!(await confirmSheet(`Supprimer la liste « ${d.name} » ? Les vidéos restent dans Venus.`, 'Supprimer'))) return;
          await api(`/api/playlists/${d.id}`, { method: 'DELETE' }); go('/collections?onglet=listes', { replace: true });
        } }, icon('trash')))),
    items.length ? h('div', { class: 'actions', style: { marginBottom: '18px' } },
      h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => playFrom(firstUnseen()) }, icon('play'), items.some((i) => i.progress && i.progress.watched) ? 'Continuer' : 'Tout lire'),
      h('button', { class: 'btn btn-ghost f', onclick: () => playFrom(null, true) }, icon('shuffle'), 'Aléatoire')) : null,
    list);
  paintList();
  main.append(page);
}

function renameSheet(title, value, onSave) {
  const input = h('input', { class: 'input', value, maxlength: 80 });
  const err = h('p', { class: 'error-text' });
  const s = sheet(title, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { err.textContent = 'Le nom est obligatoire'; return; }
    try { await onSave(name); s.close(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e2) { err.textContent = e2.message; }
  } }, input, err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Enregistrer'))));
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

export function newPlaylist(itemId = null) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', placeholder: 'Ex. : Marathon du dimanche', maxlength: 80 });
    const err = h('p', { class: 'error-text' });
    const s = sheet('Nouvelle liste de lecture', h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { err.textContent = 'Donnez un nom à la liste'; return; }
      try { const r = await api('/api/playlists', { method: 'POST', body: { name: input.value.trim(), ...(itemId ? { itemId } : {}) } }); s.close(); toast(`Liste « ${input.value.trim()} » créée${r.added ? ` avec ${r.added} vidéo${r.added > 1 ? 's' : ''}` : ''}`, { type: 'success' }); resolve(r); }
      catch (e2) { err.textContent = e2.message; }
    } }, input, err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Créer'))), { onClose: () => resolve(null) });
    requestAnimationFrame(() => input.focus());
  });
}
export function newCollection(itemId = null) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', placeholder: 'Ex. : Films de Noël', maxlength: 80 });
    const err = h('p', { class: 'error-text' });
    const s = sheet('Nouvelle collection', h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { err.textContent = 'Donnez un nom à la collection'; return; }
      try { const r = await api('/api/admin/collections', { method: 'POST', body: { name: input.value.trim(), ...(itemId ? { itemId } : {}) } }); s.close(); toast(`Collection « ${input.value.trim()} » créée`, { type: 'success' }); resolve(r); }
      catch (e2) { err.textContent = e2.message; }
    } }, input, h('p', { class: 'muted' }, 'Visible par tous les profils (selon leur âge).'), err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Créer'))), { onClose: () => resolve(null) });
    requestAnimationFrame(() => input.focus());
  });
}

// « Ajouter à… » : une liste de lecture (tous) ou une collection (administrateur)
export async function addToSheet(item) {
  const d = await api('/api/collections');
  const body = h('div', {});
  const s = sheet(`Ajouter « ${item.title} »`, body);
  const addPl = async (pl) => {
    try { const r = await api(`/api/playlists/${pl.id}/items`, { method: 'POST', body: { itemId: item.id } }); s.close(); toast(r.added ? `Ajouté à « ${pl.name} »${r.added > 1 ? ` (${r.added} épisodes)` : ''}` : `Déjà dans « ${pl.name} »`, { type: 'success', action: { label: 'Voir', onClick: () => go(`/liste-lecture/${pl.id}`) } }); }
    catch (e) { toast(e.message, true); }
  };
  const addColl = async (c) => {
    try { await api(`/api/admin/collections/${c.id}/items`, { method: 'POST', body: { itemId: item.id } }); s.close(); toast(`Ajouté à la collection « ${c.name} »`, { type: 'success', action: { label: 'Voir', onClick: () => go(`/collection/${c.id}`) } }); }
    catch (e) { toast(e.message, true); }
  };
  body.append(h('h3', {}, 'Listes de lecture'),
    ...d.playlists.map((pl) => h('button', { class: 'opt ic f', onclick: () => addPl(pl) }, icon('list'), pl.name, h('small', {}, `${pl.count} vidéo${pl.count > 1 ? 's' : ''}`))),
    h('button', { class: 'opt ic f', onclick: async () => { s.close(); const r = await newPlaylist(item.id); if (r) toast('Liste créée', { action: { label: 'Voir', onClick: () => go(`/liste-lecture/${r.id}`) } }); } }, icon('plus'), 'Nouvelle liste de lecture'));
  if (state.profile.isAdmin && ['movie', 'show', 'clip'].includes(item.type)) {
    body.append(h('h3', { style: { marginTop: '16px' } }, 'Collections'),
      ...d.collections.filter((c) => !c.auto).map((c) => h('button', { class: 'opt ic f', onclick: () => addColl(c) }, icon('grid4'), c.name, h('small', {}, `${c.count} titre${c.count > 1 ? 's' : ''}`))),
      h('button', { class: 'opt ic f', onclick: async () => { s.close(); const r = await newCollection(item.id); if (r) go(`/collection/${r.id}`); } }, icon('plus'), 'Nouvelle collection'));
  }
}
