// Connexion d'un nouvel appareil au foyer : mot de passe, ou code à 6 chiffres donné par l'administrateur
// (le code ne sert qu'une fois : il change à chaque connexion)
import { api, auth } from '../api.js';
import { h, brand } from '../ui.js';

export function render(main, { done }) {
  let mode = 'password';
  const err = h('p', { class: 'error-text', role: 'alert' });
  const pass = h('input', { id: 'pass', class: 'input', type: 'password', autocomplete: 'current-password', 'data-autofocus': true, maxlength: 200 });
  // Double authentification : code reçu par e-mail
  let challenge = null, resendAt = 0, resendTimer = null;
  const mailCode = h('input', { id: 'mail-code', class: 'input code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '000 000', 'aria-label': 'Code reçu par e-mail' });
  mailCode.addEventListener('input', () => {
    const d = mailCode.value.replace(/\D/g, '').slice(0, 6);
    mailCode.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    if (d.length === 6) form.requestSubmit();
  });
  const mailInfo = h('small', { class: 'muted' });
  const resendBtn = h('button', { class: 'linkish f', type: 'button', onclick: async () => {
    if (Date.now() < resendAt) return;
    try { const r = await api('/api/login/resend', { method: 'POST', body: { challenge: challenge.challenge } }); challenge = r; startResend(); err.textContent = ''; mailInfo.textContent = `Nouveau code envoyé à ${r.email}. Il est valable 10 minutes.`; }
    catch (e) { err.textContent = e.message; }
  } }, 'Renvoyer le code');
  const startResend = () => {
    resendAt = Date.now() + 60000; clearInterval(resendTimer);
    const tick = () => { const s2 = Math.ceil((resendAt - Date.now()) / 1000); resendBtn.disabled = s2 > 0; resendBtn.textContent = s2 > 0 ? `Renvoyer le code (${s2} s)` : 'Renvoyer le code'; if (s2 <= 0) clearInterval(resendTimer); };
    tick(); resendTimer = setInterval(tick, 1000);
  };
  const mailField = h('div', { class: 'field', hidden: true }, h('label', { for: 'mail-code' }, 'Code reçu par e-mail'), mailCode, mailInfo, resendBtn);
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
  // Vérifications avant envoi (le serveur vérifie aussi tout)
  const clientCheck = () => {
    if (mode === 'password' && !pass.value) return 'Entrez le mot de passe';
    if (mode === 'code' && !/^\d{6}$/.test(code.value.replace(/\D/g, ''))) return 'Le code fait 6 chiffres';
    if (mode === 'email' && !/^\d{6}$/.test(mailCode.value.replace(/\D/g, ''))) return 'Le code reçu par e-mail fait 6 chiffres';
    return '';
  };
  const setMode = (m) => {
    mode = m;
    err.textContent = '';
    passField.hidden = m !== 'password';
    codeField.hidden = m !== 'code';
    mailField.hidden = m !== 'email';
    intro.textContent = m === 'password' ? 'Entrez le mot de passe du foyer. Cet appareil s’en souviendra.' : m === 'email' ? 'Double authentification : un code vient d’être envoyé par e-mail à l’administrateur.' : 'Entrez le code à 6 chiffres affiché dans le tableau de bord de l’administrateur.';
    switchBtn.textContent = m === 'code' ? 'Utiliser le mot de passe' : m === 'email' ? 'Recommencer' : 'Se connecter avec un code à 6 chiffres';
    submit.textContent = m === 'email' ? 'Valider le code' : 'Se connecter';
    setTimeout(() => ({ password: pass, code, email: mailCode })[m].focus(), 30);
  };
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    err.textContent = clientCheck();
    if (err.textContent) return;
    submit.disabled = true;
    try {
      const r = mode === 'password'
        ? await api('/api/login', { method: 'POST', body: { password: pass.value } })
        : mode === 'email'
          ? await api('/api/login/verify', { method: 'POST', body: { challenge: challenge.challenge, code: mailCode.value.replace(/\D/g, '') } })
          : await api('/api/login/code', { method: 'POST', body: { code: code.value.replace(/\D/g, '') } });
      if (r.twofa) {
        challenge = r; submit.disabled = false; pass.value = '';
        mailInfo.textContent = `Envoyé à ${r.email}. Il est valable 10 minutes.`;
        setMode('email'); startResend();
        return;
      }
      clearInterval(resendTimer);
      auth.token = r.token;
      done(null);
    } catch (e2) {
      err.textContent = e2.message; submit.disabled = false;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      ({ password: pass, code, email: mailCode })[mode].select();
      if (mode === 'email' && /expiré|Trop d’essais|reconnectez/.test(e2.message)) setTimeout(() => setMode('password'), 1800);
    }
  } },
  brand(),
  h('h2', {}, 'Connecter cet appareil'),
  intro, passField, codeField, mailField,
  err,
  h('div', { class: 'form-actions login-actions' }, switchBtn, submit));
  main.append(h('div', { class: 'center-screen' }, form));
  setMode(new URLSearchParams(location.hash.split('?')[1] || '').has('code') ? 'code' : 'password');
}
