// Vote en famille : chacun choisit sur son téléphone parmi les idées de « Ce soir ».
// Écran du téléphone (#/vote?code=ABCD) et fenêtre de l'écran principal (startVote).
import { api, openStream } from '../api.js';
import { h, icon, img, qrSvg, sheet, toast } from '../ui.js';
import { go, back } from '../app.js';
import { playItem } from './home.js';

const clientId = (() => { try { let c = sessionStorage.getItem('vn_vote_client'); if (!c) { c = Math.random().toString(36).slice(2); sessionStorage.setItem('vn_vote_client', c); } return c; } catch { return Math.random().toString(36).slice(2); } })();
export const voteLink = (code) => `${location.origin}${location.pathname}#/vote?code=${code}`;

// ---------------------------------------------------------------- écran principal
export async function startVote(itemIds) {
  let v;
  try { v = await api('/api/vote', { method: 'POST', body: { itemIds } }); } catch (e) { toast(e.message, true); return; }
  const board = h('div', { class: 'vote-board' });
  const closeBtn = h('button', { class: 'btn btn-play f' }, icon('play'), 'Voir le résultat');
  const paint = (st) => {
    v = st;
    const max = Math.max(1, ...st.items.map((i) => i.votes));
    board.replaceChildren(...st.items.map((i) => h('div', { class: `vote-line${st.done && st.winner === i.id ? ' win' : ''}` },
      h('span', { class: 'vl-pic' }, i.poster ? h('img', { src: img(i.poster), alt: '' }) : null),
      h('div', { class: 'vl-body' }, h('b', {}, i.title), h('div', { class: 'meter' }, h('i', { style: { width: `${(i.votes / max) * 100}%` } })),
        h('small', {}, i.voters.length ? i.voters.join(', ') : 'Pas encore de voix')),
      h('b', { class: 'vl-n' }, String(i.votes)))));
    closeBtn.disabled = st.done;
    if (st.done) {
      const w = st.items.find((i) => i.id === st.winner);
      closeBtn.replaceChildren(icon('play'), `Lancer « ${w.title} »`);
      closeBtn.disabled = false;
      closeBtn.onclick = () => { s.close(); playItem(w); };
    }
  };
  closeBtn.onclick = async () => {
    try { paint(await api(`/api/vote/${v.code}/close`, { method: 'POST' })); toast('Le vote est terminé !', { type: 'success' }); } catch (e) { toast(e.message, true); }
  };
  const content = h('div', { class: 'vote-host' },
    h('div', { class: 'vote-join' }, qrSvg(voteLink(v.code), 170),
      h('div', {}, h('p', {}, 'Chacun scanne ce QR code avec son téléphone, ou ouvre Venus et tape le code :'), h('b', { class: 'big-code' }, v.code.split('').join(' ')))),
    board, h('div', { class: 'form-actions' }, closeBtn));
  paint(v);
  const stop = openStream(`/api/vote/${v.code}/stream`, { state: paint });
  const s = sheet('Vote en famille', content, { wide: true, onClose: () => stop() });
}

// ---------------------------------------------------------------- téléphone
export async function render(main, { query }) {
  let code = String((query && query.get('code')) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const page = h('div', { class: 'vote-page' });
  main.append(page);
  let stop = null;
  const top = h('div', { class: 'remote-top' }, h('button', { class: 'p-icon f', 'aria-label': 'Retour', onclick: () => back('/') }, icon('back')), h('b', {}, 'Vote en famille'));
  const askCode = (msg = '') => {
    const input = h('input', { class: 'input code-input', maxlength: 4, placeholder: 'ABCD', autocomplete: 'off', 'aria-label': 'Code du vote' });
    page.replaceChildren(top, h('form', { class: 'remote-pair', onsubmit: (e) => { e.preventDefault(); code = input.value.toUpperCase().trim(); join(); } },
      icon('people'), h('h1', {}, 'Rejoindre le vote'), h('p', {}, 'Tapez le code à 4 lettres affiché sur la TV.'), input, h('p', { class: 'error-text' }, msg), h('button', { class: 'btn btn-play f', type: 'submit' }, 'Rejoindre')));
    setTimeout(() => input.focus(), 50);
  };
  let mine = null;
  const paint = (st) => {
    const body = h('div', { class: 'vote-cards' });
    if (st.done) {
      const w = st.items.find((i) => i.id === st.winner);
      page.replaceChildren(top, h('div', { class: 'vote-win' },
        w.backdrop || w.poster ? h('img', { src: img(w.backdrop || w.poster), alt: '' }) : null,
        h('div', {}, h('small', {}, 'Ce soir, ce sera'), h('h1', {}, w.title), h('p', {}, `${w.votes} voix sur ${st.voters}`),
          h('button', { class: 'btn f', onclick: () => go(`/titre/${w.id}`) }, icon('info'), 'Voir la fiche'))));
      return;
    }
    body.replaceChildren(...st.items.map((i) => h('button', { class: `vote-card f${mine === i.id ? ' on' : ''}`, onclick: async () => {
      mine = i.id;
      try { paint(await api(`/api/vote/${code}`, { method: 'POST', body: { itemId: i.id, client: clientId } })); if (navigator.vibrate) navigator.vibrate(12); } catch (e) { toast(e.message, true); }
    } },
    h('span', { class: 'vc-pic' }, i.poster ? h('img', { src: img(i.poster), alt: '' }) : null, mine === i.id ? h('span', { class: 'vc-check' }, icon('check')) : null),
    h('span', { class: 'vc-body' }, h('b', {}, i.title), h('small', {}, [i.year, i.runtime ? `${i.runtime} min` : null].filter(Boolean).join(' · ')),
      i.overview ? h('em', {}, i.overview) : null, h('span', { class: 'vc-votes' }, `${i.votes} voix`)))));
    page.replaceChildren(top, h('div', { class: 'vote-intro' }, h('h1', {}, mine ? 'A voté !' : 'Que regarder ce soir ?'),
      h('p', {}, mine ? 'Vous pouvez changer d’avis tant que le vote est ouvert.' : `Proposé par ${st.host}. Touchez votre choix.`)), body);
  };
  const join = async () => {
    if (!/^[A-Z0-9]{4}$/.test(code)) return askCode(code ? 'Le code fait 4 lettres.' : '');
    let st;
    try { st = await api(`/api/vote/${code}`); } catch (e) { return askCode(e.message); }
    paint(st);
    if (stop) stop();
    stop = openStream(`/api/vote/${code}/stream`, { state: paint });
  };
  if (code) join(); else askCode();
  return { destroy: () => { if (stop) stop(); } };
}
