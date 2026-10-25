// TV en direct : aperçu muet de la chaîne sélectionnée + mosaïque des chaînes avec leur image actuelle
import { api, auth, deviceCaps } from '../api.js';
import { h, icon, img } from '../ui.js';
import { go } from '../app.js';
import { playPath } from '../components.js';
import { attachStream } from '../live.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

export async function render(main) {
  const channels = await api('/api/library?type=channel');
  const groups = [...new Set(channels.map((c) => c.group).filter(Boolean))];
  let group = '';
  let selected = null, session = null, detach = null, switchTimer = null, destroyed = false, muted = true;

  // ------------------------------------------------------------ panneau d'aperçu
  const video = h('video', { muted: true, playsinline: true, 'webkit-playsinline': true, autoplay: true });
  video.muted = true;
  const still = h('img', { class: 'pv-still', alt: '' });
  const status = h('div', { class: 'pv-status' });
  const nameEl = h('h2', { class: 'pv-name' });
  const groupEl = h('p', { class: 'pv-group' });
  const soundBtn = h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { muted = !muted; video.muted = muted; soundBtn.textContent = muted ? 'Activer le son' : 'Couper le son'; } }, 'Activer le son');
  const watchBtn = h('button', { class: 'btn btn-play f', onclick: () => selected && go(playPath(selected.id)) }, icon('play'), 'Regarder');
  const preview = h('section', { class: 'pv', 'aria-label': 'Aperçu de la chaîne' },
    h('div', { class: 'pv-screen' }, still, video, status, h('span', { class: 'live-dot pv-live' }, 'Direct')),
    h('div', { class: 'pv-info' }, h('div', {}, nameEl, groupEl), h('div', { class: 'actions' }, watchBtn, soundBtn)));

  async function stopPreview() {
    if (detach) { detach(); detach = null; }
    if (session) { fetch(`/api/hls/${session}`, { method: 'DELETE', keepalive: true }).catch(() => {}); session = null; }
  }

  async function showPreview(ch) {
    if (selected && selected.id === ch.id) return;
    selected = ch;
    nameEl.textContent = ch.title;
    groupEl.textContent = ch.group || 'TV en direct';
    still.src = ch.preview || `/api/channels/${ch.id}/preview.jpg?token=${encodeURIComponent(auth.token || '')}&t=${Math.floor(Date.now() / 60000)}`;
    still.hidden = false;
    status.textContent = 'Connexion à la chaîne…';
    status.hidden = false;
    [...grid.querySelectorAll('.tile')].forEach((t) => t.classList.toggle('on', Number(t.dataset.id) === ch.id));
    clearTimeout(switchTimer);
    // On attend un instant : inutile de lancer un flux pour chaque chaîne survolée
    switchTimer = setTimeout(async () => {
      const prev = session;
      if (detach) { detach(); detach = null; }
      try {
        const info = await api(`/api/play/${ch.id}`, { method: 'POST', body: { caps: deviceCaps(), preview: true, replace: prev || undefined } });
        if (destroyed || selected !== ch) { fetch(`/api/hls/${info.sessionId}`, { method: 'DELETE' }).catch(() => {}); return; }
        session = info.sessionId;
        detach = await attachStream(video, info.url, {
          live: true,
          onError: () => { if (selected === ch) { status.textContent = 'Cette chaîne ne répond pas pour le moment.'; status.hidden = false; } },
        });
      } catch (e) {
        if (selected === ch) { status.textContent = e.message; status.hidden = false; }
      }
    }, 650);
  }
  video.addEventListener('playing', () => { status.hidden = true; still.hidden = true; });

  // ------------------------------------------------------------ mosaïque
  const grid = h('div', { class: 'tiles' });
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', id: 'tv-search', placeholder: 'Chercher une chaîne', 'aria-label': 'Chercher une chaîne', autocomplete: 'off' });

  const tile = (c) => {
    const logo = c.poster ? h('img', { class: 'tile-logo', src: img(c.poster), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null;
    const shot = h('img', { class: 'tile-shot', alt: '', loading: 'lazy', src: c.preview || `/api/channels/${c.id}/preview.jpg?token=${encodeURIComponent(auth.token || '')}&t=${Math.floor(Date.now() / 120000)}`,
      onerror: (e) => e.target.remove() });
    const el = h('button', { class: 'tile f', 'data-id': c.id, 'aria-label': `${c.title}, ${c.group || 'en direct'}`, onclick: () => go(playPath(c.id)) },
      h('div', { class: 'tile-img' }, h('span', { class: 'ch-initials' }, initials(c.title)), shot, logo),
      h('div', { class: 'tile-cap' }, h('b', {}, c.title), c.group ? h('small', {}, c.group) : null));
    el.addEventListener('focus', () => showPreview(c));
    el.addEventListener('mouseenter', () => showPreview(c));
    return el;
  };

  const paint = () => {
    const q = norm(input.value.trim());
    const list = channels.filter((c) => (!group || c.group === group) && (!q || norm(c.title).includes(q)));
    grid.replaceChildren(...list.map(tile));
    count.textContent = `${list.length} chaîne${list.length > 1 ? 's' : ''}`;
    if (!list.length) grid.replaceChildren(h('p', { class: 'grid-empty' }, channels.length ? 'Aucune chaîne ne correspond.' : ''));
  };
  input.addEventListener('input', paint);

  const chips = groups.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Groupes de chaînes' },
    [['', 'Toutes'], ...groups.map((g) => [g, g])].map(([id, label]) => {
      const b = h('button', { class: `chip f${id === group ? ' on' : ''}`, onclick: () => {
        group = id; [...chips.children].forEach((c) => c.classList.toggle('on', c === b)); paint();
      } }, label);
      return b;
    })) : null;

  if (!channels.length) {
    main.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', {}, 'TV en direct')),
      h('div', { class: 'empty' }, h('h2', {}, 'Aucune chaîne'), h('p', {}, 'Ajoutez la liste M3U de votre abonnement IPTV pour voir vos chaînes ici.'),
        h('button', { class: 'btn btn-play f', onclick: () => go('/ajouter') }, 'Ajouter une liste IPTV'))));
    return {};
  }

  main.append(h('div', { class: 'page tv-page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'TV en direct'), count),
    preview,
    h('div', { class: 'filters' }, chips || h('span'), channels.length > 8 ? h('div', { class: 'search-box small' }, icon('search'), input) : null),
    grid));
  paint();
  showPreview(channels[0]);

  // Les vignettes se rafraîchissent toutes les 2 minutes
  const refresh = setInterval(() => {
    grid.querySelectorAll('.tile-shot').forEach((im) => { if (im.src.startsWith('blob:') || im.src.startsWith('data:')) return; im.src = im.src.replace(/t=\d+/, `t=${Math.floor(Date.now() / 120000)}`); });
  }, 120000);

  return { destroy: () => { destroyed = true; clearTimeout(switchTimer); clearInterval(refresh); stopPreview(); } };
}
