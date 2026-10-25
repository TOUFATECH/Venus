// Rejoindre une séance à plusieurs avec son code (ou via le lien d'invitation)
import { api } from '../api.js';
import { h, icon } from '../ui.js';
import { go } from '../app.js';

export async function render(main, { query }) {
  const input = h('input', { class: 'input code-input', id: 'room-code', maxlength: 4, placeholder: 'ABCD', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Code de la séance', value: (query.get('code') || '').toUpperCase() });
  const err = h('p', { class: 'error-text' });
  const join = async (e) => {
    if (e) e.preventDefault();
    err.textContent = '';
    const c = input.value.trim().toUpperCase();
    if (c.length !== 4) { err.textContent = 'Le code fait 4 lettres.'; return; }
    try { const r = await api(`/api/rooms/${c}`); go(`/lecture/${r.itemId}?salle=${r.code}`, { replace: true }); }
    catch (e2) { err.textContent = e2.message; }
  };
  main.append(h('div', { class: 'page' }, h('div', { class: 'together' },
    h('form', { class: 'panel', onsubmit: join },
      icon('people'),
      h('h1', {}, 'Rejoindre une séance'),
      h('p', {}, 'Regardez le même film au même moment que vos proches, chacun chez soi. Pause, retour en arrière, réactions et discussion sont partagés.'),
      input, err,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Rejoindre'))),
    h('div', { class: 'together-how' },
      h('h2', {}, 'Lancer votre propre séance'),
      h('ol', {},
        h('li', {}, 'Lancez un film ou un épisode.'),
        h('li', {}, 'Dans le lecteur, touchez « Ensemble ».'),
        h('li', {}, 'Partagez le code de 4 lettres ou le QR code.'))))));
  if (input.value.length === 4) join();
  else setTimeout(() => input.focus(), 50);
  return {};
}
