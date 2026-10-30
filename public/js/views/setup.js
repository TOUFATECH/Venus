// Première installation : une seule page, trois minutes
import { api, auth } from '../api.js';
import { h, brand, passwordProblem, passwordMeter } from '../ui.js';

export function render(main, { done }) {
  const err = h('p', { class: 'error-text', role: 'alert' });
  const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('small', {}, hint) : null);
  const name = h('input', { id: 'name', class: 'input', required: true, maxlength: 30, autocomplete: 'nickname', placeholder: 'Ex. : Sarah', 'data-autofocus': true });
  const pass = h('input', { id: 'pass', class: 'input', type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' });
  const pin = h('input', { id: 'pin', class: 'input', inputmode: 'numeric', required: true, pattern: '\\d{4}', minlength: 4, maxlength: 4, autocomplete: 'off', placeholder: '4 chiffres' });
  const movies = h('input', { id: 'movies', class: 'input', value: '/media/films' });
  const shows = h('input', { id: 'shows', class: 'input', value: '/media/series' });
  const tmdb = h('input', { id: 'tmdb', class: 'input', placeholder: 'Facultatif, ajoutable plus tard' });
  const submit = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Terminer l’installation');

  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Indiquez votre prénom.'; return; }
    const weak = passwordProblem(pass.value);
    if (weak) { err.textContent = `Mot de passe du foyer : ${weak.toLowerCase()}.`; pass.focus(); return; }
    if (!/^\d{4}$/.test(pin.value)) { err.textContent = 'Le code PIN de l’administrateur est obligatoire : 4 chiffres.'; pin.focus(); return; }
    submit.disabled = true; submit.textContent = 'Installation…';
    try {
      const r = await api('/api/setup', { method: 'POST', body: {
        name: name.value.trim(), password: pass.value, pin: pin.value || null,
        moviesPath: movies.value.trim(), showsPath: shows.value.trim(), tmdbKey: tmdb.value.trim() || null,
      } });
      auth.token = r.token;
      const me = await api('/api/me');
      done(me);
    } catch (e2) { err.textContent = e2.message; submit.disabled = false; submit.textContent = 'Terminer l’installation'; }
  } },
  brand(),
  h('h2', {}, 'Bienvenue dans Venus'),
  h('p', {}, 'Votre cinéma à la maison. Quelques réglages et c’est prêt.'),
  field('Votre prénom', name, 'Ce sera le profil administrateur.'),
  field('Mot de passe du foyer', pass, 'Demandé une seule fois par appareil (TV, téléphone…).'), passwordMeter(pass),
  field('Code PIN de votre profil', pin, 'Obligatoire pour l’administrateur : 4 chiffres, pour que personne d’autre n’ouvre votre profil.'),
  field('Dossier des films', movies),
  field('Dossier des séries', shows, 'Chemins vus par le serveur. Avec Docker, gardez ceux-ci.'),
  field('Clé API TMDB', tmdb, h('span', {}, 'Pour les affiches et résumés en français. Gratuite sur ',
    h('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener', style: { textDecoration: 'underline' } }, 'themoviedb.org'), '.')),
  err,
  h('div', { class: 'form-actions' }, submit));

  main.append(h('div', { class: 'center-screen' }, form));
  setTimeout(() => name.focus(), 50);
}
