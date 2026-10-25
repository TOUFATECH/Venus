// Séance à plusieurs : lecture synchronisée entre écrans, chat et réactions en direct
import { api, openStream } from './api.js';
import { h, icon, avatar, toast, qrSvg, copyText, sheet } from './ui.js';

export const REACTIONS = ['😂', '😮', '❤️', '👏', '😱', '🔥'];
const clientId = Math.random().toString(36).slice(2, 10);

export function inviteLink(code) {
  return `${location.origin}${location.pathname}#/seance?code=${code}`;
}

export function showInvite(code, title) {
  const link = inviteLink(code);
  sheet('Inviter à la séance', h('div', { class: 'invite' },
    h('p', {}, `Vos invités regardent « ${title} » en même temps que vous, sur leur propre écran. Pause, avance et retour sont partagés.`),
    h('div', { class: 'invite-body' },
      qrSvg(link, 180),
      h('div', { class: 'invite-code' },
        h('small', {}, 'Code de la séance'),
        h('b', { class: 'big-code' }, code.split('').join(' ')),
        h('small', {}, 'À saisir dans Venus, menu Séance, ou scannez le QR code.'),
        h('button', { class: 'btn btn-small f', onclick: () => copyText(link) }, icon('copy'), 'Copier le lien')))));
}

// Connexion à une salle. Renvoie { send(type, data), close(), isHost() }
export function joinParty(code, handlers) {
  let members = [];
  const close = openStream(`/api/rooms/${code}/events?client=${clientId}`, {
    room: (r) => { members = r.members; handlers.room && handlers.room(r); handlers.members && handlers.members(r.members); },
    members: (m) => { members = m; handlers.members && handlers.members(m); },
    state: (s) => handlers.state && handlers.state(s),
    chat: (c) => handlers.chat && handlers.chat(c),
    react: (r) => handlers.react && handlers.react(r),
    notice: (n) => handlers.notice && handlers.notice(n),
    item: (i) => handlers.item && handlers.item(i),
    error: () => handlers.error && handlers.error(),
  });
  const send = (type, data = {}) => api(`/api/rooms/${code}/action`, { method: 'POST', body: { client: clientId, type, ...data } }).catch((e) => toast(e.message, true));
  return { send, close, isHost: () => (members.find((m) => m.id === clientId) || {}).host === true, clientId };
}

// Panneau latéral : participants, réactions, discussion
export function partyPanel(code, { onReact, onChat, onInvite, onLeave }) {
  const membersEl = h('div', { class: 'pp-members' });
  const log = h('div', { class: 'pp-log', 'aria-live': 'polite' });
  const input = h('input', { class: 'input', id: 'pp-text', placeholder: 'Écrire un message', maxlength: 280, autocomplete: 'off' });
  const panel = h('aside', { class: 'party-panel', 'aria-label': 'Séance à plusieurs' },
    h('div', { class: 'pp-head' },
      h('div', {}, h('b', {}, 'Séance'), h('span', { class: 'pp-code' }, code)),
      h('div', { class: 'pp-tools' },
        h('button', { class: 'p-icon small f', 'aria-label': 'Inviter', onclick: onInvite }, icon('people')),
        h('button', { class: 'p-icon small f', 'aria-label': 'Masquer la discussion', onclick: () => panel.classList.toggle('folded') }, icon('chat')),
        h('button', { class: 'p-icon small f', 'aria-label': 'Quitter la séance', onclick: onLeave }, icon('close')))),
    membersEl,
    h('div', { class: 'pp-reacts' }, REACTIONS.map((e) => h('button', { class: 'react-btn f', 'aria-label': `Réagir ${e}`, onclick: () => onReact(e) }, e))),
    log,
    h('form', { class: 'pp-form', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { onChat(t); input.value = ''; } } },
      input, h('button', { class: 'p-icon small f', type: 'submit', 'aria-label': 'Envoyer' }, icon('send'))));
  // Les touches tapées dans la discussion ne pilotent pas le lecteur
  input.addEventListener('keydown', (e) => e.stopPropagation());

  return {
    el: panel,
    setMembers(list) {
      membersEl.replaceChildren(...list.map((m) => h('span', { class: 'pp-member', title: m.host ? `${m.name} (hôte)` : m.name }, avatar(m, 'sm'), h('small', {}, m.name))));
    },
    message(c) {
      log.append(h('div', { class: 'pp-msg' }, h('b', {}, c.name), ' ', c.text));
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    },
    notice(text) {
      log.append(h('div', { class: 'pp-notice' }, text));
      log.scrollTop = log.scrollHeight;
    },
  };
}

// Réaction qui s'envole au-dessus de la vidéo
export function floatReaction(container, emoji, name) {
  const x = 10 + Math.random() * 70;
  const el = h('div', { class: 'float-react', style: { left: `${x}%` } }, h('span', {}, emoji), name ? h('small', {}, name) : null);
  container.append(el);
  setTimeout(() => el.remove(), 3200);
}
