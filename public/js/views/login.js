// Connexion d'un nouvel appareil au foyer
import { api, auth } from '../api.js';
import { h, brand } from '../ui.js';

export function render(main, { done }) {
  const err = h('p', { class: 'error-text', role: 'alert' });
  const pass = h('input', { id: 'pass', class: 'input', type: 'password', required: true, autocomplete: 'current-password', 'data-autofocus': true });
  const submit = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Se connecter');
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ''; submit.disabled = true;
    try {
      const r = await api('/api/login', { method: 'POST', body: { password: pass.value } });
      auth.token = r.token;
      done(null);
    } catch (e2) {
      err.textContent = e2.message; submit.disabled = false;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      pass.select();
    }
  } },
  brand(),
  h('h2', {}, 'Connecter cet appareil'),
  h('p', {}, 'Entrez le mot de passe du foyer. Cet appareil s’en souviendra.'),
  h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Mot de passe'), pass),
  err,
  h('div', { class: 'form-actions' }, submit));
  main.append(h('div', { class: 'center-screen' }, form));
  setTimeout(() => pass.focus(), 50);
}
