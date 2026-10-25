// « Que regarder ce soir ? » : trois questions, trois idées argumentées
import { api } from '../api.js';
import { h, icon, img, picture, placeholder, fmtRuntime } from '../ui.js';
import { go, state } from '../app.js';
import { playItem } from './home.js';
import { tintFrom } from '../ambiance.js';

const MOODS = [
  ['rire', 'Rire', 'Une comédie, quelque chose de léger', ['comedie', 'famil', 'animation']],
  ['frissons', 'Frissonner', 'Suspense, enquête, peur', ['horreur', 'thriller', 'mystere', 'crime', 'policier']],
  ['emotion', 'Être ému', 'Une belle histoire qui touche', ['drame', 'romance']],
  ['evasion', 'S’évader', 'Ailleurs, demain, l’aventure', ['science', 'fantas', 'aventure', 'action', 'animation']],
  ['reflechir', 'Apprendre', 'Documentaire, histoire vraie', ['documentaire', 'histoire', 'guerre', 'mystere']],
  ['surprise', 'Surprends-moi', 'Laissez Venus choisir', []],
];
const TIMES = [
  ['30', 'Moins de 45 min', 'Un épisode, un clip', 45],
  ['90', 'Environ 1 h 30', 'Un film court ou deux épisodes', 110],
  ['120', 'Toute la soirée', 'Un grand film, une série', 999],
];
const WHO = [
  ['seul', 'Seul', 'Rien que pour moi'],
  ['duo', 'À deux', 'En couple ou entre amis proches'],
  ['famille', 'En famille', 'Avec des enfants'],
  ['amis', 'Entre amis', 'Ambiance, rires, sensations'],
];
const WHO_BONUS = { duo: ['romance', 'drame', 'comedie', 'thriller'], famille: ['animation', 'famil', 'comedie', 'aventure'], amis: ['comedie', 'action', 'horreur', 'thriller'] };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function lengthOf(i) {
  if (i.type === 'movie') return i.runtime || 110;
  if (i.type === 'clip') return Math.max(3, i.runtime || 4);
  return i.category === 'anime' ? 24 : 45; // un épisode
}

function score(i, a) {
  if (i.type === 'clip' && a.time !== '30') return null; // un clip n'occupe pas une soirée
  const g = (i.genres || []).map(norm).join(' ');
  const mood = MOODS.find((m) => m[0] === a.mood);
  const reasons = [];
  let s = 0;
  if (mood && mood[3].length) {
    const hits = mood[3].filter((k) => g.includes(k)).length;
    if (!hits) return null;
    s += 4 + hits * 1.5;
    reasons.push((i.genres || [])[0]);
  }
  const t = TIMES.find((x) => x[0] === a.time);
  const len = lengthOf(i);
  if (t) {
    if (len > t[3]) return null;
    if (a.time === '120' && i.type === 'movie' && len >= 100) s += 2;
    if (a.time === '30' && i.type !== 'movie') s += 2;
    reasons.push(i.type === 'show' ? `Épisodes de ${len} min` : `${fmtRuntime(len)}, fini à ${finishAt(len)}`);
  }
  if (a.who === 'famille') {
    if (i.age == null || i.age > 10) return null;
    reasons.push(i.age === 0 ? 'Tous publics' : `Dès ${i.age} ans`);
  }
  const bonus = WHO_BONUS[a.who] || [];
  s += bonus.filter((k) => g.includes(k)).length * 1.2;
  if (i.status === 'unseen') { s += 3; reasons.push(i.type === 'show' ? 'Jamais commencée' : 'Jamais vu'); }
  else if (i.status === 'progress') { s += i.type === 'show' ? 2.5 : 1; reasons.push(i.type === 'show' && i.unseen ? `${i.unseen} épisodes à voir` : 'Déjà commencé'); }
  else s -= 4;
  if (i.vote) { s += (i.vote - 6) * 0.9; if (i.vote >= 7.8) reasons.push(`${i.vote.toFixed(1).replace('.', ',')}/10`); }
  if (i.popularity) s += Math.log10(i.popularity + 1);
  if (i.added && Date.now() - i.added < 14 * 864e5) { s += 1; reasons.push('Ajouté récemment'); }
  return { item: i, score: s + Math.random() * 1.5, reasons: [...new Set(reasons.filter(Boolean))].slice(0, 4) };
}

function finishAt(min) {
  const d = new Date(Date.now() + min * 60000);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function render(main) {
  const items = (await api('/api/library')).filter((i) => i.type !== 'clip' || true);
  const answers = {};
  const wrap = h('div', { class: 'tonight' });
  main.append(h('div', { class: 'page tonight-page' }, wrap));
  const shown = new Set();

  const steps = [
    ['mood', 'Quelle envie ce soir ?', MOODS],
    ['time', 'Combien de temps devant vous ?', TIMES],
    ['who', 'Avec qui ?', WHO],
  ];

  function ask(n) {
    const [key, question, opts] = steps[n];
    const dots = h('div', { class: 'steps-dots', 'aria-label': `Question ${n + 1} sur 3` }, steps.map((_, i) => h('span', { class: i <= n ? 'on' : '' })));
    const grid = h('div', { class: 'choice-grid' }, opts.map(([id, label, sub], i) => h('button', {
      class: 'choice f', ...(i === 0 ? { 'data-autofocus': true } : {}),
      onclick: () => { answers[key] = id; if (n < steps.length - 1) ask(n + 1); else results(); },
    }, h('b', {}, label), h('small', {}, sub))));
    wrap.replaceChildren(...[
      h('div', { class: 'tonight-head' }, icon('moon'), h('span', {}, `Bonsoir ${state.profile.name}`)),
      dots, h('h1', { class: 'tonight-q' }, question), grid,
      n > 0 ? h('button', { class: 'row-link f', onclick: () => ask(n - 1) }, icon('back'), 'Question précédente') : null].filter(Boolean));
    requestAnimationFrame(() => grid.firstChild.focus({ preventScroll: true }));
  }

  function results() {
    const ranked = items.map((i) => score(i, answers)).filter(Boolean).sort((a, b) => b.score - a.score);
    const fresh = ranked.filter((r) => !shown.has(r.item.id));
    const picks = (fresh.length >= 3 ? fresh : ranked).slice(0, 3);
    picks.forEach((p) => shown.add(p.item.id));
    if (picks[0]) tintFrom(img(picks[0].item.backdrop || picks[0].item.poster));
    const mood = MOODS.find((m) => m[0] === answers.mood);
    wrap.replaceChildren(...[
      h('div', { class: 'tonight-head' }, icon('moon'), h('span', {}, `${mood[1]}, ${TIMES.find((t) => t[0] === answers.time)[1].toLowerCase()}, ${WHO.find((w) => w[0] === answers.who)[1].toLowerCase()}`)),
      h('h1', { class: 'tonight-q' }, picks.length ? 'Voici nos idées pour ce soir' : 'Rien ne correspond… pour l’instant'),
      picks.length ? h('div', { class: 'picks' }, picks.map((p, i) => pickCard(p, i))) :
        h('p', { class: 'grid-empty' }, 'Essayez une autre envie ou plus de temps : votre bibliothèque n’a rien qui colle à ces trois critères.'),
      h('div', { class: 'actions tonight-actions' },
        picks.length ? h('button', { class: 'btn f', onclick: results }, icon('shuffle'), 'Trois autres idées') : null,
        h('button', { class: 'btn btn-ghost f', onclick: () => { shown.clear(); ask(0); } }, 'Recommencer'))].filter(Boolean));
    requestAnimationFrame(() => { const f = wrap.querySelector('.pick .btn-play'); if (f) f.focus({ preventScroll: true }); });
  }

  function pickCard({ item, reasons }, i) {
    const src = img(item.backdrop || item.poster);
    return h('article', { class: 'pick', style: { animationDelay: `${i * 90}ms` } },
      h('div', { class: 'pick-img' }, src ? picture(src, item.title) : placeholder(item.title), h('span', { class: 'pick-rank' }, i === 0 ? 'Notre choix' : `Idée ${i + 1}`)),
      h('div', { class: 'pick-body' },
        h('h2', {}, item.title),
        h('div', { class: 'pick-reasons' }, reasons.map((r) => h('span', {}, r))),
        item.overview ? h('p', {}, item.overview) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-play f', onclick: () => playItem(item) }, icon('play'), item.status === 'progress' ? 'Reprendre' : 'Lecture'),
          h('button', { class: 'btn btn-ghost f', onclick: () => go(`/titre/${item.id}`) }, 'Plus d’infos'))));
  }

  ask(0);
  return {};
}
