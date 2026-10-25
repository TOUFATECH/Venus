// Le téléphone devient une télécommande : croix directionnelle, lecture, recherche au clavier, lancement d'un titre
import { api } from '../api.js';
import { h, icon, toast, img } from '../ui.js';
import { back } from '../app.js';

const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { /* */ } };

export async function render(main, { query }) {
  // Le code de la TV ne sert qu'une fois : en échange, ce téléphone reçoit un lien personnel vers l'écran
  const qrCode = (query.get('code') || '').replace(/\D/g, '');
  let link = '';
  try { link = localStorage.getItem('vn_remote_link') || ''; } catch { /* */ }
  const pair = async (c) => {
    const r = await api('/api/remote/pair', { method: 'POST', body: { code: c } });
    link = r.link;
    try { localStorage.setItem('vn_remote_link', link); localStorage.removeItem('vn_remote_target'); } catch { /* */ }
  };
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
        try { await pair(c); connected(); }
        catch (e2) { err.textContent = e2.message; }
      } },
      icon('remote'),
      h('h1', {}, 'Relier ce téléphone à un écran'),
      h('p', {}, 'Sur la TV ou l’ordinateur, ouvrez « Télécommande » : un code à 6 chiffres s’affiche. Ou scannez directement son QR code. Le code change après chaque téléphone relié.'),
      input, err, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Relier')));
    setTimeout(() => input.focus(), 50);
  };

  const send = async (cmd, extra = {}) => {
    buzz();
    try { await api(`/api/remote/link/${link}`, { method: 'POST', body: { cmd, ...extra } }); }
    catch (e) { toast(e.message, true); if (/introuvable|déconnecté|expiré/i.test(e.message)) askCode('L’écran ne répond plus. Saisissez le code affiché sur la TV.'); }
  };

  async function connected() {
    let screen = 'votre écran';
    try { screen = (await api(`/api/remote/link/${link}`)).screen || screen; } catch (e) { return askCode(e.message); }
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
        h('button', { class: 'btn btn-small btn-ghost f', onclick: () => { try { localStorage.removeItem('vn_remote_link'); } catch { /* */ } link = ''; askCode(); } }, 'Changer')),
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
      // Pavé numérique : taper le numéro d'une chaîne de TV
      h('details', { class: 'remote-digits' }, h('summary', {}, icon('live'), 'Chaînes : pavé numérique'),
        h('div', { class: 'digits' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'tv', '0', 'ok'].map((d) => (d === 'tv'
          ? h('button', { class: 'digit alt', 'aria-label': 'Ouvrir la TV en direct', onclick: () => send('tv') }, 'TV')
          : d === 'ok' ? h('button', { class: 'digit alt', 'aria-label': 'Valider le numéro', onclick: () => send('ok') }, 'OK')
            : h('button', { class: 'digit', 'aria-label': `Chiffre ${d}`, onclick: () => send('digit', { digit: d }) }, d))))),
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

  // QR code scanné : on relie ce téléphone avec le code qu'il contient (même s'il l'était déjà à un autre écran)
  if (qrCode) {
    try { await pair(qrCode); } catch (e) { if (!link) return askCode(e.message); }
  }
  if (link) connected(); else askCode();
  return {};
}
