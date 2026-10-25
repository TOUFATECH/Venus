// Le téléphone devient une télécommande : croix directionnelle, lecture, recherche au clavier, lancement d'un titre
import { api } from '../api.js';
import { h, icon, toast, img } from '../ui.js';
import { back } from '../app.js';

const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { /* */ } };

export async function render(main, { query }) {
  let code = (query.get('code') || '').replace(/\D/g, '');
  try { if (!code) code = localStorage.getItem('vn_remote_target') || ''; } catch { /* */ }
  const page = h('div', { class: 'remote-page' });
  const inSim = !!main.closest && !!main.closest('.phone-sim');
  main.append(page);

  const askCode = (msg) => {
    const input = h('input', { class: 'input code-input', id: 'remote-code', inputmode: 'numeric', maxlength: 7, placeholder: '000 000', autocomplete: 'one-time-code', 'aria-label': 'Code affiché sur la TV' });
    const err = h('p', { class: 'error-text' }, msg || '');
    page.replaceChildren(
      h('div', { class: 'remote-top' }, h('button', { class: 'p-icon f', 'aria-label': 'Retour', onclick: () => back('/') }, icon('back')), h('b', {}, 'Télécommande')),
      h('form', { class: 'remote-pair', onsubmit: async (e) => {
        e.preventDefault();
        const c = input.value.replace(/\D/g, '');
        try { await api(`/api/remote/${c}`); code = c; try { localStorage.setItem('vn_remote_target', c); } catch { /* */ } connected(); }
        catch (e2) { err.textContent = e2.message; }
      } },
      icon('remote'),
      h('h1', {}, 'Relier ce téléphone à un écran'),
      h('p', {}, 'Sur la TV ou l’ordinateur, ouvrez « Télécommande » : un code à 6 chiffres s’affiche. Ou scannez directement son QR code.'),
      input, err, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Relier')));
    setTimeout(() => input.focus(), 50);
  };

  const send = async (cmd, extra = {}) => {
    buzz();
    try { await api(`/api/remote/${code}`, { method: 'POST', body: { cmd, ...extra } }); }
    catch (e) { toast(e.message, true); if (/introuvable|déconnecté/i.test(e.message)) askCode('L’écran ne répond plus. Rouvrez « Télécommande » sur la TV.'); }
  };

  async function connected() {
    let screen = 'votre écran';
    try { screen = (await api(`/api/remote/${code}`)).screen || screen; } catch (e) { return askCode(e.message); }
    send('hello');
    const pad = (cmd, ic, label, cls = '') => h('button', { class: `pad-btn ${cls}`, 'aria-label': label, onclick: () => send(cmd) }, icon(ic));
    const searchIn = h('input', { class: 'input', id: 'remote-search', placeholder: 'Chercher un titre sur la TV', enterkeyhint: 'search', autocomplete: 'off' });
    let typeTimer;
    searchIn.addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(() => send('text', { text: searchIn.value }), 350); });
    const launch = h('div', { class: 'remote-launch' });

    page.replaceChildren(
      h('div', { class: 'remote-top' },
        inSim ? null : h('button', { class: 'p-icon f', 'aria-label': 'Retour', onclick: () => back('/') }, icon('back')),
        h('div', {}, h('b', {}, 'Télécommande'), h('small', {}, `Reliée à l’écran de ${screen}`)),
        h('button', { class: 'btn btn-small btn-ghost f', onclick: () => { try { localStorage.removeItem('vn_remote_target'); } catch { /* */ } askCode(); } }, 'Changer')),
      h('div', { class: 'dpad' },
        pad('up', 'up', 'Haut', 'up'), pad('left', 'back', 'Gauche', 'left'),
        h('button', { class: 'pad-btn ok', 'aria-label': 'OK', onclick: () => send('ok') }, 'OK'),
        h('button', { class: 'pad-btn right', 'aria-label': 'Droite', onclick: () => send('right') }, h('span', { class: 'flip' }, icon('back'))),
        pad('down', 'down', 'Bas', 'down')),
      h('div', { class: 'remote-row' },
        h('button', { class: 'r-btn', onclick: () => send('back') }, icon('back'), h('span', {}, 'Retour')),
        h('button', { class: 'r-btn', onclick: () => send('home') }, icon('home'), h('span', {}, 'Accueil'))),
      h('div', { class: 'remote-row media' },
        h('button', { class: 'r-btn', onclick: () => send('rew') }, icon('r10'), h('span', {}, '−30 s')),
        h('button', { class: 'r-btn big', onclick: () => send('playpause') }, icon('play'), h('span', {}, 'Lecture / pause')),
        h('button', { class: 'r-btn', onclick: () => send('fwd') }, icon('f10'), h('span', {}, '+30 s'))),
      h('div', { class: 'remote-search' }, icon('search'), searchIn),
      launch);

    // Lancer directement sur la TV ce que l'on regardait
    try {
      const home = await api('/api/home');
      const cont = (home.rows.find((r) => r.id === 'continue') || {}).items || [];
      if (cont.length) {
        launch.append(h('h2', {}, 'Reprendre sur la TV'), h('div', { class: 'launch-list' }, cont.slice(0, 6).map((c) => h('button', { class: 'launch-item', onclick: () => send('play', { id: c.id }) },
          c.backdrop || c.still ? h('img', { src: img(c.backdrop || c.still), alt: '', loading: 'lazy' }) : h('span'),
          h('span', {}, h('b', {}, c.showTitle || c.title), c.season ? h('small', {}, `S${c.season} É${c.episode}`) : null)))));
      }
    } catch { /* facultatif */ }
  }

  if (code) connected(); else askCode();
  return {};
}
