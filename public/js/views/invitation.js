// Lien d'invitation reçu par e-mail : la personne prépare son compte (nom, avatar, code PIN, langues),
// puis cet appareil est connecté directement sur son profil — sans le mot de passe du foyer.
import { api, auth } from '../api.js';
import { h, brand, avatar, AVATAR_HUES } from '../ui.js';

// Page d'acceptation d'une invitation (création du mot de passe)
export async function render(main, { done }) {
  const token = (location.pathname.match(/^\/invitation\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const panel = h('div', { class: 'panel invite-panel' }, brand(), h('p', { class: 'muted' }, 'Ouverture de votre invitation…'));
  main.append(h('div', { class: 'center-screen' }, panel));
  let inv;
  try { inv = await api(`/api/invite/${encodeURIComponent(token)}`); }
  catch (e) {
    panel.replaceChildren(brand(), h('h2', {}, 'Invitation introuvable'), h('p', {}, e.message),
      h('div', { class: 'form-actions' }, h('a', { class: 'btn btn-play f', href: '/', onclick: (ev) => { ev.preventDefault(); history.replaceState(null, '', '/'); done(null); } }, 'Aller à la connexion')));
    return {};
  }
  let av = inv.avatar || 0;
  const err = h('p', { class: 'error-text', role: 'alert' });
  const name = h('input', { class: 'input', value: inv.name, maxlength: 30, required: true, autocomplete: 'nickname', 'data-autofocus': true });
  const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', pattern: '\\d{4,8}', maxlength: 8, autocomplete: 'new-password', placeholder: inv.admin ? 'Obligatoire (4 à 8 chiffres)' : 'Facultatif (4 à 8 chiffres)' });
  const pin2 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'new-password', placeholder: 'Le même code' });
  const audio = h('select', { class: 'input' }, [['fr', 'Français'], ['en', 'Anglais'], ['ja', 'Japonais'], ['es', 'Espagnol']].map(([v, l]) => h('option', { value: v }, l)));
  const subs = h('select', { class: 'input' }, [['fr', 'Français'], ['en', 'Anglais'], ['none', 'Aucun']].map(([v, l]) => h('option', { value: v }, l)));
  const avs = h('div', { class: 'invite-avatars', role: 'radiogroup', 'aria-label': 'Couleur de l’avatar' });
  const paintAv = () => avs.replaceChildren(...AVATAR_HUES.map((_, i) => {
    const b = h('button', { type: 'button', class: `invite-av f${i === av ? ' on' : ''}`, role: 'radio', 'aria-checked': String(i === av), 'aria-label': `Couleur ${i + 1}`, onclick: () => { av = i; paintAv(); } },
      avatar({ name: name.value || inv.name, avatar: i }));
    return b;
  }));
  name.addEventListener('input', paintAv);
  paintAv();
  const submit = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Créer mon compte');
  const form = h('form', { class: 'invite-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pin.value && !/^\d{4,8}$/.test(pin.value)) { err.textContent = 'Le code PIN fait 4 à 8 chiffres.'; return; }
    if (pin.value !== pin2.value) { err.textContent = 'Les deux codes PIN ne sont pas identiques.'; return; }
    if (inv.admin && !pin.value) { err.textContent = 'Un compte administrateur doit avoir un code PIN.'; return; }
    submit.disabled = true;
    try {
      const r = await api(`/api/invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: { name: name.value.trim(), avatar: av, pin: pin.value || null, audioLang: audio.value, subtitleLang: subs.value } });
      auth.token = r.token;
      history.replaceState(null, '', '/');
      done(null);
    } catch (e2) { err.textContent = e2.message; submit.disabled = false; }
  } },
  h('div', { class: 'field' }, h('label', {}, 'Votre nom'), name),
  h('div', { class: 'field' }, h('label', {}, 'Couleur'), avs),
  h('div', { class: 'invite-cols' },
    h('div', { class: 'field' }, h('label', {}, 'Code PIN'), pin),
    h('div', { class: 'field' }, h('label', {}, 'Confirmer'), pin2)),
  h('small', { class: 'muted' }, 'Le code PIN protège votre profil sur les appareils partagés.'),
  h('div', { class: 'invite-cols' },
    h('div', { class: 'field' }, h('label', {}, 'Langue des films'), audio),
    h('div', { class: 'field' }, h('label', {}, 'Sous-titres'), subs)),
  err,
  h('div', { class: 'form-actions' }, submit));
  panel.replaceChildren(brand(),
    h('h2', {}, `Bienvenue sur ${inv.server}`),
    h('p', {}, `${inv.by} vous a créé un compte${inv.admin ? ' administrateur' : inv.kid ? ' enfant' : ''}. Préparez-le : cet appareil sera ensuite connecté directement.`),
    form,
    h('p', { class: 'muted small' }, `Lien valable jusqu’au ${new Date(inv.expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, une seule fois.`));
  setTimeout(() => name.focus(), 50);
  return {};
}
