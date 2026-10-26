// Séance à plusieurs : lecture synchronisée entre écrans, chat et réactions en direct
import { api, openStream } from './api.js';
import { h, icon, avatar, toast, qrSvg, copyText, sheet } from './ui.js';
import { state } from './app.js';

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
  let members = [], room = null;
  const close = openStream(`/api/rooms/${code}/events?client=${clientId}`, {
    room: (r) => { room = r; members = r.members; handlers.room && handlers.room(r); handlers.members && handlers.members(r.members); handlers.blocked && handlers.blocked(r.blocked || []); },
    blocked: (b) => handlers.blocked && handlers.blocked(b),
    removed: (x) => { close(); handlers.removed && handlers.removed(x); },
    members: (m) => { members = m; handlers.members && handlers.members(m); },
    state: (s) => handlers.state && handlers.state(s),
    chat: (c) => handlers.chat && handlers.chat(c),
    react: (r) => handlers.react && handlers.react(r),
    notice: (n) => handlers.notice && handlers.notice(n),
    item: (i) => handlers.item && handlers.item(i),
    error: () => handlers.error && handlers.error(),
  });
  const send = (type, data = {}) => api(`/api/rooms/${code}/action`, { method: 'POST', body: { client: clientId, type, ...data } }).catch((e) => toast(e.message, true));
  const isHost = () => (members.find((m) => m.id === clientId) || {}).host === true;
  const canModerate = () => isHost() || !!(state.profile && (state.profile.isAdmin || (room && room.ownerPid === state.profile.id)));
  const moderate = (action, data = {}) => api(`/api/rooms/${code}/moderate`, { method: 'POST', body: { client: clientId, action, ...data } });
  return { send, close, isHost, canModerate, moderate, clientId };
}

// Panneau latéral : participants, réactions, discussion
export function partyPanel(code, { onReact, onChat, onInvite, onLeave, onHide, soundOn, onSound }) {
  const membersEl = h('div', { class: 'pp-members' });
  const blockedEl = h('div', { class: 'pp-blocked', hidden: true });
  let mod = null, lastMembers = [], lastBlocked = [], blockTimer = null;
  const log = h('div', { class: 'pp-log', 'aria-live': 'polite' });
  const input = h('input', { class: 'input', id: 'pp-text', placeholder: 'Écrire un message', maxlength: 280, autocomplete: 'off' });
  // Son des messages : activé ou coupé d'un clic
  const soundBtn = h('button', { class: 'p-icon small f', type: 'button' });
  const paintSound = () => {
    const on = soundOn ? soundOn() : true;
    soundBtn.replaceChildren(icon(on ? 'vol' : 'mute'));
    soundBtn.setAttribute('aria-label', on ? 'Couper le son de la discussion' : 'Activer le son de la discussion');
    soundBtn.title = on ? 'Son des messages : activé' : 'Son des messages : coupé';
    soundBtn.classList.toggle('off', !on);
  };
  soundBtn.onclick = () => { const on = !(soundOn ? soundOn() : true); onSound && onSound(on); paintSound(); };
  paintSound();
  const panel = h('aside', { class: 'party-panel', 'aria-label': 'Séance à plusieurs' },
    h('div', { class: 'pp-head' },
      h('div', {}, h('b', {}, 'Séance'), h('span', { class: 'pp-code' }, code)),
      h('div', { class: 'pp-tools' },
        h('button', { class: 'p-icon small f', 'aria-label': 'Inviter', onclick: onInvite }, icon('people')),
        soundBtn,
        h('button', { class: 'p-icon small f', 'aria-label': 'Masquer la discussion', title: 'Masquer (touche C)', onclick: () => onHide && onHide() }, icon('close')),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: onLeave }, 'Quitter'))),
    membersEl, blockedEl,
    h('div', { class: 'pp-reacts' }, REACTIONS.map((e) => h('button', { class: 'react-btn f', 'aria-label': `Réagir ${e}`, onclick: () => onReact(e) }, e))),
    log,
    h('form', { class: 'pp-form', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { onChat(t); input.value = ''; } } },
      input, h('button', { class: 'p-icon small f', type: 'submit', 'aria-label': 'Envoyer' }, icon('send'))));
  // Les touches tapées dans la discussion ne pilotent pas le lecteur
  input.addEventListener('keydown', (e) => e.stopPropagation());

  const run = async (s, action, data, done) => {
    s.close();
    try { await mod.act(action, data); if (done) toast(done, { type: 'success' }); } catch (e) { toast(e.message, true); }
  };
  function manage(m) {
    const opt = (ic, title, sub, fn, cls = '') => h('button', { class: `opt ic f ${cls}`, type: 'button', onclick: fn }, icon(ic), h('span', {}, h('b', {}, title), sub ? h('small', {}, sub) : null));
    const durations = [[5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [180, '3 h']];
    const s = sheet(`Gérer ${m.name}`, h('div', { class: 'pp-manage-sheet' },
      h('div', { class: 'pp-who' }, avatar(m, 'md'), h('div', {}, h('b', {}, m.name), h('small', {}, m.host ? 'Hôte de la séance' : 'Participant'))),
      opt('close', 'Retirer de la séance', 'Il quitte la séance tout de suite ; il pourra revenir avec le code', () => run(s, 'kick', { target: m.id }, `${m.name} a été retiré`)),
      h('div', { class: 'pp-block-for' }, h('span', {}, icon('clock'), 'Bloquer pendant'),
        h('div', { class: 'chips' }, durations.map(([mn, lbl]) => h('button', { class: 'chip f', type: 'button', onclick: () => run(s, 'block', { target: m.id, minutes: mn }, `${m.name} est bloqué ${lbl}`) }, lbl)))),
      opt('lock', 'Bloquer définitivement', 'Il ne pourra plus revenir dans cette séance', () => run(s, 'block', { target: m.id, minutes: 0 }, `${m.name} est bloqué définitivement`), 'danger'),
      h('p', { class: 'muted', style: { fontSize: '.82rem', margin: '10px 0 0' } }, 'Tout le monde dans la séance voit qui a été retiré ou bloqué.')));
  }
  function unblock(b) {
    const s = sheet(`Débloquer ${b.name} ?`, h('div', {},
      h('p', {}, `${b.name} pourra de nouveau rejoindre la séance avec le code.`),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-ghost f', type: 'button', onclick: () => s.close() }, 'Annuler'),
        h('button', { class: 'btn btn-play f', type: 'button', onclick: () => run(s, 'unblock', { pid: b.pid }, `${b.name} est débloqué`) }, 'Débloquer'))));
  }

  return {
    el: panel,
    // Modération : { me, can(), act(action, data) } — l'hôte (ou un administrateur) gère les participants
    setModeration(m) { mod = m; this.setMembers(lastMembers); this.setBlocked(lastBlocked); },
    setMembers(list) {
      lastMembers = list;
      const can = mod && mod.can();
      membersEl.replaceChildren(...list.map((m) => {
        const me = mod && m.id === mod.me;
        const label = `${m.name}${m.host ? ' (hôte)' : ''}${me ? ' (vous)' : ''}`;
        const inner = [avatar(m, 'sm'), h('small', {}, m.name), m.host ? h('span', { class: 'pp-host', 'aria-hidden': 'true' }, '★') : null];
        if (!can || me) return h('span', { class: 'pp-member', title: label }, ...inner);
        return h('button', { class: 'pp-member pp-manage f', type: 'button', title: `Gérer ${m.name}`, 'aria-label': `Gérer ${label}`, onclick: () => manage(m) }, ...inner);
      }));
    },
    setBlocked(list) {
      lastBlocked = list;
      clearTimeout(blockTimer);
      blockedEl.hidden = !list.length;
      const can = mod && mod.can();
      const left = (b) => { if (!b.until) return 'définitivement'; const mn = Math.max(1, Math.ceil((b.until - Date.now()) / 60000)); return mn >= 60 ? `encore ${Math.floor(mn / 60)} h ${String(mn % 60).padStart(2, '0')}` : `encore ${mn} min`; };
      blockedEl.replaceChildren(h('small', { class: 'pp-bl-title' }, icon('lock'), 'Bloqués'), ...list.map((b) => {
        const inner = [h('b', {}, b.name), h('small', {}, ` · ${left(b)}`)];
        const t = `${b.name}, bloqué par ${b.by} ${left(b)}`;
        return can ? h('button', { class: 'pp-bl f', type: 'button', title: `${t}. Toucher pour débloquer`, onclick: () => unblock(b) }, ...inner) : h('span', { class: 'pp-bl', title: t }, ...inner);
      }));
      // Le temps restant se met à jour ; les blocages expirés disparaissent
      if (list.length) blockTimer = setTimeout(() => this.setBlocked(list.filter((b) => !b.until || b.until > Date.now())), 30000);
    },
    message(c) {
      const m = h('div', { class: 'pp-msg' }, h('b', {}, c.name), ' ', c.text);
      log.append(m);
      // Pendant le film, les anciens messages s'effacent (ils reviennent quand on bouge la souris)
      setTimeout(() => m.classList.add('old'), 12000);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    },
    react(emoji, name) {
      const m = h('div', { class: 'pp-msg pp-react' }, name ? h('b', {}, name) : null, ' ', h('span', {}, emoji));
      log.append(m);
      setTimeout(() => m.classList.add('old'), 8000);
      log.scrollTop = log.scrollHeight;
    },
    notice(text, kind) {
      const m = h('div', { class: `pp-notice${kind === 'mod' ? ' mod' : ''}` }, kind === 'mod' ? icon('lock') : null, text);
      log.append(m);
      setTimeout(() => m.classList.add('old'), 8000);
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
