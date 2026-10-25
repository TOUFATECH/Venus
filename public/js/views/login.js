// Connexion d'un nouvel appareil au foyer : mot de passe, ou code à 6 chiffres donné par l'administrateur
// (le code ne sert qu'une fois : il change à chaque connexion)
import { api, auth } from '../api.js';
import { h, brand } from '../ui.js';

export function render(main, { done }) {
  let mode = 'password';
  const err = h('p', { class: 'error-text', role: 'alert' });
  const pass = h('input', { id: 'pass', class: 'input', type: 'password', autocomplete: 'current-password', 'data-autofocus': true });
  const code = h('input', { id: 'login-code', class: 'input code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '000 000', 'aria-label': 'Code à 6 chiffres' });
  code.addEventListener('input', () => {
    const d = code.value.replace(/\D/g, '').slice(0, 6);
    code.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    if (d.length === 6) form.requestSubmit();
  });
  const submit = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Se connecter');
  const passField = h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Mot de passe'), pass);
  const codeField = h('div', { class: 'field', hidden: true }, h('label', { for: 'login-code' }, 'Code à 6 chiffres'), code,
    h('small', { class: 'muted' }, 'Sur un appareil déjà connecté, l’administrateur ouvre « Tableau de bord » : le code y est affiché. Il change après chaque connexion.'));
  const intro = h('p', {});
  const switchBtn = h('button', { class: 'linkish f', type: 'button', onclick: () => setMode(mode === 'password' ? 'code' : 'password') });
  const setMode = (m) => {
    mode = m;
    err.textContent = '';
    passField.hidden = m !== 'password';
    codeField.hidden = m !== 'code';
    intro.textContent = m === 'password' ? 'Entrez le mot de passe du foyer. Cet appareil s’en souviendra.' : 'Entrez le code à 6 chiffres affiché dans le tableau de bord de l’administrateur.';
    switchBtn.textContent = m === 'password' ? 'Se connecter avec un code à 6 chiffres' : 'Utiliser le mot de passe';
    setTimeout(() => (m === 'password' ? pass : code).focus(), 30);
  };
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    err.textContent = ''; submit.disabled = true;
    try {
      const r = mode === 'password'
        ? await api('/api/login', { method: 'POST', body: { password: pass.value } })
        : await api('/api/login/code', { method: 'POST', body: { code: code.value.replace(/\D/g, '') } });
      auth.token = r.token;
      done(null);
    } catch (e2) {
      err.textContent = e2.message; submit.disabled = false;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      (mode === 'password' ? pass : code).select();
    }
  } },
  brand(),
  h('h2', {}, 'Connecter cet appareil'),
  intro, passField, codeField,
  err,
  h('div', { class: 'form-actions login-actions' }, switchBtn, submit));
  main.append(h('div', { class: 'center-screen' }, form));
  setMode(new URLSearchParams(location.hash.split('?')[1] || '').has('code') ? 'code' : 'password');
}
