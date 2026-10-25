// « Qui regarde ? » — choix du profil, avec code PIN facultatif
import { api, auth } from '../api.js';
import { h, icon, avatar, sheet } from '../ui.js';

export async function render(main, { done }) {
  const profiles = await api('/api/profiles');

  const select = async (p) => {
    if (!p.hasPin) { done(await api(`/api/profiles/${p.id}/select`, { method: 'POST', body: {} })); return; }
    askPin(p, async (pin) => done(await api(`/api/profiles/${p.id}/select`, { method: 'POST', body: { pin } })));
  };

  const tiles = profiles.map((p, i) => h('button', { class: 'profile-tile f', onclick: () => select(p), ...(i === 0 ? { 'data-autofocus': true } : {}) },
    avatar(p),
    h('span', { class: 'name' }, p.name, ' ', p.hasPin ? icon('lock') : null)));

  main.append(h('div', { class: 'center-screen' }, h('div', {},
    h('h1', {}, 'Qui regarde ?'),
    h('p', { class: 'lead' }, 'Chaque profil a sa liste, sa progression et ses réglages.'),
    h('div', { class: 'profiles' }, tiles),
    h('div', { style: { textAlign: 'center', marginTop: '48px' } },
      h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
        await api('/api/logout', { method: 'POST' }).catch(() => {});
        auth.token = null; done(null);
      } }, icon('exit'), 'Déconnecter cet appareil')))));
}

export function askPin(profile, onSubmit) {
  let code = '';
  const dots = h('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => h('span')));
  const err = h('p', { class: 'error-text', style: { textAlign: 'center' } });
  const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < code.length));
  const press = async (d) => {
    if (d === '⌫') code = code.slice(0, -1);
    else if (code.length < 4) code += d;
    paint();
    if (code.length === 4) {
      try { await onSubmit(code); s.close(); }
      catch (e) {
        err.textContent = e.message; code = ''; paint();
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
      }
    }
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k
    ? h('button', { class: 'f', onclick: () => press(k), 'aria-label': k === '⌫' ? 'Effacer' : k }, k)
    : h('span'));
  const content = h('div', { style: { textAlign: 'center' } },
    h('div', { style: { display: 'flex', justifyContent: 'center' } }, avatar(profile, 'sm')),
    dots, err, h('div', { class: 'pinpad' }, keys));
  const s = sheet(`Code PIN de ${profile.name}`, content, { keepBackspace: true, onClose: () => document.removeEventListener('keydown', onKey) });
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); press('⌫'); }
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => keys[0].focus(), 30);
}
