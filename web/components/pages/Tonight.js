'use client';
// « Que regarder ce soir ? » : trois questions (envie, temps, avec qui), trois idées argumentées
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, img, go } from '../../lib/hooks';
import { Icon } from '../Icon';
import { Picture, Placeholder } from '../Card';
import { PageError, PageLoading } from '../PageState';

const greeting = () => { const hr = new Date().getHours(); return hr >= 18 || hr < 4 ? 'Bonsoir' : 'Bonjour'; };
const MOODS = [
  ['rire', 'Rire', 'Une comédie, quelque chose de léger', ['comedie', 'famil', 'animation']],
  ['frissons', 'Frissonner', 'Suspense, enquête, peur', ['horreur', 'thriller', 'mystere', 'crime', 'policier']],
  ['emotion', 'Être ému', 'Une belle histoire qui touche', ['drame', 'romance']],
  ['evasion', 'S’évader', 'Ailleurs, demain, l’aventure', ['science', 'fantas', 'aventure', 'action', 'animation']],
  ['reflechir', 'Apprendre', 'Documentaire, histoire vraie', ['documentaire', 'histoire', 'guerre', 'mystere']],
  ['surprise', 'Surprends-moi', 'Laissez Venus choisir', []],
];
const times = (soir) => [
  ['30', 'Moins de 45 min', 'Un épisode, un clip', 45],
  ['90', 'Environ 1 h 30', 'Un film court ou deux épisodes', 110],
  ['120', soir ? 'Toute la soirée' : 'Tout le temps qu’il faut', 'Un grand film, une série', 999],
];
const WHO = [['seul', 'Seul', 'Rien que pour moi'], ['duo', 'À deux', 'En couple ou entre amis proches'], ['famille', 'En famille', 'Avec des enfants'], ['amis', 'Entre amis', 'Ambiance, rires, sensations']];
const WHO_BONUS = { duo: ['romance', 'drame', 'comedie', 'thriller'], famille: ['animation', 'famil', 'comedie', 'aventure'], amis: ['comedie', 'action', 'horreur', 'thriller'] };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lengthOf = (i) => (i.type === 'movie' ? i.runtime || 110 : i.type === 'clip' ? Math.max(3, i.runtime || 4) : i.category === 'anime' ? 24 : 45);
const finishAt = (min) => { const d = new Date(Date.now() + min * 60000); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`; };

function score(i, a, TIMES) {
  if (i.type === 'clip' && a.time !== '30') return null;
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
    reasons.push(i.type === 'show' ? `Épisodes de ${len} min` : `${shared().ui.fmtRuntime(len)}, fini à ${finishAt(len)}`);
  }
  if (a.who === 'famille') {
    if (i.age == null || i.age > 10) return null;
    reasons.push(i.age === 0 ? 'Tous publics' : `Dès ${i.age} ans`);
  }
  s += (WHO_BONUS[a.who] || []).filter((k) => g.includes(k)).length * 1.2;
  if (i.status === 'unseen') { s += 3; reasons.push(i.type === 'show' ? 'Jamais commencée' : 'Jamais vu'); }
  else if (i.status === 'progress') { s += i.type === 'show' ? 2.5 : 1; reasons.push(i.type === 'show' && i.unseen ? `${i.unseen} épisodes à voir` : 'Déjà commencé'); }
  else s -= 4;
  if (i.vote) { s += (i.vote - 6) * 0.9; if (i.vote >= 7.8) reasons.push(`${i.vote.toFixed(1).replace('.', ',')}/10`); }
  if (i.popularity) s += Math.log10(i.popularity + 1);
  if (i.added && Date.now() - i.added < 14 * 864e5) { s += 1; reasons.push('Ajouté récemment'); }
  return { item: i, score: s + Math.random() * 1.5, reasons: [...new Set(reasons.filter(Boolean))].slice(0, 4) };
}

export async function playItem(item) {
  const { components } = shared();
  if (item.type === 'movie') return go(components.playPath(item.id));
  const d = await api(`/api/items/${item.id}`);
  if (d.nextUp) go(components.playPath(d.nextUp.id)); else go(`/titre/${item.id}`);
}

export default function Tonight() {
  const { menu, app } = shared();
  const soir = menu.dayPart() === 'soir';
  useTitle(soir ? 'Ce soir' : 'Aujourd’hui');
  const { data: items, error } = useApi('/api/library');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [picks, setPicks] = useState(null);
  const shown = useRef(new Set());
  const box = useRef(null);
  const TIMES = times(soir);
  const steps = [['mood', soir ? 'Quelle envie ce soir ?' : 'Quelle envie aujourd’hui ?', MOODS], ['time', 'Combien de temps devant vous ?', TIMES], ['who', 'Avec qui ?', WHO]];
  useEffect(() => { requestAnimationFrame(() => box.current && (box.current.querySelector('.pick .btn-play') || box.current.querySelector('.choice'))?.focus({ preventScroll: true })); }, [step, picks]);
  if (error) return <PageError error={error} />;
  if (!items) return <PageLoading />;

  const results = (a = answers) => {
    const ranked = items.map((i) => score(i, a, TIMES)).filter(Boolean).sort((x, y) => y.score - x.score);
    const fresh = ranked.filter((r) => !shown.current.has(r.item.id));
    const p = (fresh.length >= 3 ? fresh : ranked).slice(0, 3);
    p.forEach((x) => shown.current.add(x.item.id));
    if (p[0]) shared().imp('ambiance.js').then((m) => m.tintFrom(img(p[0].item.backdrop || p[0].item.poster))).catch(() => {});
    setPicks(p);
  };
  const answer = (key, id) => {
    const a = { ...answers, [key]: id };
    setAnswers(a);
    if (step < steps.length - 1) setStep(step + 1); else results(a);
  };

  let body;
  if (picks) {
    const mood = MOODS.find((m) => m[0] === answers.mood);
    body = (
      <>
        <div className="tonight-head"><Icon name="moon" /><span>{`${mood[1]}, ${TIMES.find((t) => t[0] === answers.time)[1].toLowerCase()}, ${WHO.find((w) => w[0] === answers.who)[1].toLowerCase()}`}</span></div>
        <h1 className="tonight-q">{picks.length ? `Voici nos idées pour ${soir ? 'ce soir' : 'aujourd’hui'}` : 'Rien ne correspond… pour l’instant'}</h1>
        {picks.length ? (
          <div className="picks">
            {picks.map(({ item, reasons }, i) => {
              const src = img(item.backdrop || item.poster);
              return (
                <article key={item.id} className="pick" style={{ animationDelay: `${i * 90}ms` }}>
                  <div className="pick-img">{src ? <Picture src={src} title={item.title} /> : <Placeholder title={item.title} />}<span className="pick-rank">{i === 0 ? 'Notre choix' : `Idée ${i + 1}`}</span></div>
                  <div className="pick-body">
                    <h2>{item.title}</h2>
                    <div className="pick-reasons">{reasons.map((r) => <span key={r}>{r}</span>)}</div>
                    {item.overview ? <p>{item.overview}</p> : null}
                    <div className="actions">
                      <button className="btn btn-play f" onClick={() => playItem(item)}><Icon name="play" />{item.status === 'progress' ? 'Reprendre' : 'Lecture'}</button>
                      <button className="btn btn-ghost f" onClick={() => go(`/titre/${item.id}`)}>Plus d’infos</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="grid-empty">Essayez une autre envie ou plus de temps : votre bibliothèque n’a rien qui colle à ces trois critères.</p>}
        <div className="actions tonight-actions">
          {picks.length ? <button className="btn f" onClick={() => results()}><Icon name="shuffle" />Trois autres idées</button> : null}
          {picks.length >= 2 ? <button className="btn btn-ghost f" onClick={async () => { const m = await import('./Vote'); m.startVote(picks.map((p) => p.item.id)); }}><Icon name="people" />Voter en famille</button> : null}
          <button className="btn btn-ghost f" onClick={() => { shown.current.clear(); setPicks(null); setStep(0); }}>Recommencer</button>
        </div>
      </>
    );
  } else {
    const [key, question, opts] = steps[step];
    body = (
      <>
        <div className="tonight-head"><Icon name={menu.todayIcon()} /><span>{`${greeting()} ${app.state.profile.name}`}</span></div>
        <div className="steps-dots" aria-label={`Question ${step + 1} sur 3`}>{steps.map((_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        <h1 className="tonight-q">{question}</h1>
        <div className="choice-grid">
          {opts.map(([id, label, sub], i) => <button key={id} className="choice f" data-autofocus={i === 0 ? 'true' : undefined} onClick={() => answer(key, id)}><b>{label}</b><small>{sub}</small></button>)}
        </div>
        {step > 0 ? <button className="row-link f" onClick={() => setStep(step - 1)}><Icon name="back" />Question précédente</button> : null}
      </>
    );
  }
  return <main className="with-nav page-in"><div className="page tonight-page"><div className="tonight" ref={box}>{body}</div></div></main>;
}
