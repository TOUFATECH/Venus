// Commande vocale en français (Chrome, Edge, Safari ; Firefox ne propose pas la reconnaissance vocale) :
// « Mets One Piece », « Lance Inception », « Chaîne Mayotte La 1ère », « Chaîne 12 », « Cherche Dune »,
// « Pause », « Reprends », « Plein écran », « Retour », « Accueil », « Ma liste ».
import { api } from './api.js';

// La reconnaissance vocale est-elle disponible dans ce navigateur ?
export const voiceSupported = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/** Écoute une phrase ; onText(texte, fini) reçoit le texte au fur et à mesure. Renvoie une fonction d'arrêt. */
export function listen({ onText, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onError && onError(new Error('La commande vocale n’est pas disponible dans ce navigateur (essayez Chrome, Edge ou Safari).')); return () => {}; }
  const r = new SR();
  r.lang = 'fr-FR'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
  let final = '';
  r.onresult = (e) => {
    let txt = '';
    for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) final = txt; }
    onText && onText(txt.trim(), false);
  };
  r.onerror = (e) => { onError && onError(new Error(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans le navigateur.' : e.error === 'no-speech' ? 'Je n’ai rien entendu.' : `Micro : ${e.error}`)); };
  r.onend = () => { if (final) onText && onText(final.trim(), true); onEnd && onEnd(final.trim()); };
  try { r.start(); } catch (e) { onError && onError(e); }
  return () => { try { r.stop(); } catch { /* */ } };
}

// Texte simplifié pour reconnaître une commande
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const NUMS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20 };
// Le meilleur titre pour ce que l'on a dit : titre exact, puis début, puis mots en commun
function bestMatch(list, said, nameOf) {
  const q = norm(said);
  if (!q) return null;
  let best = null, score = 0;
  for (const x of list) {
    const t = norm(nameOf(x));
    if (!t) continue;
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(q) || q.startsWith(t)) s = 70 - Math.abs(t.length - q.length) / 10;
    else if (t.includes(q)) s = 55;
    else { const w = q.split(' ').filter((x2) => x2.length > 1); const hit = w.filter((x2) => t.split(' ').includes(x2)).length; if (hit) s = (hit / Math.max(w.length, t.split(' ').length)) * 50; }
    if (s > score) { score = s; best = x; }
  }
  return score >= 25 ? best : null;
}

/**
 * Exécute une phrase. ctx : { go, playPath(id), channelPath(c) } (playPath reçoit l'identifiant d'un film ou d'un épisode).
 * Renvoie { ok, message } (message affiché à l'utilisateur), ou { search } pour une recherche libre.
 */
export async function runVoice(text, ctx) {
  const t = norm(text);
  if (!t) return { ok: false, message: 'Je n’ai rien entendu.' };
  const video = document.querySelector('.player video, .pv-screen video, video');
  if (/^(pause|stop|arrete|mets en pause)$/.test(t)) { if (video) { video.pause(); return { ok: true, message: 'Pause' }; } return { ok: false, message: 'Rien en lecture' }; }
  if (/^(reprends|reprendre|lecture|play|continue|joue)$/.test(t)) { if (video) { video.play().catch(() => {}); return { ok: true, message: 'Lecture' }; } return { ok: false, message: 'Rien en lecture' }; }
  if (/^(plein ecran|agrandis|agrandir)$/.test(t)) { (document.querySelector('.player') || document.querySelector('.pv-screen') || document.documentElement).requestFullscreen?.().catch(() => {}); return { ok: true, message: 'Plein écran' }; }
  if (/^(retour|reviens|precedent)$/.test(t)) { history.back(); return { ok: true, message: 'Retour' }; }
  if (/^(accueil|maison|page d accueil)$/.test(t)) { ctx.go('/'); return { ok: true, message: 'Accueil' }; }
  const page = { 'ma liste': '/liste', films: '/films', series: '/series', animes: '/animes', 'la tele': '/tv', tele: '/tv', tv: '/tv', reglages: '/reglages', 'guide des programmes': '/tv?vue=guide', 'le guide': '/tv?vue=guide', statistiques: '/stats', 'ma retrospective': '/retrospective' };
  const pg = /^(?:va (?:sur|dans|a)|ouvre|affiche|montre)? ?(?:les |la |le |mes )?(.+)$/.exec(t);
  if (pg && page[pg[1]]) { ctx.go(page[pg[1]]); return { ok: true, message: `Ouverture : ${pg[1]}` }; }
  const search = /^(?:cherche|recherche|trouve)\s+(.+)$/.exec(t);
  if (search) { ctx.go(`/recherche?q=${encodeURIComponent(search[1])}`); return { ok: true, message: `Recherche : ${search[1]}` }; }
  // Chaîne de TV, par numéro ou par nom
  const ch = /^(?:mets |lance |va sur |zappe sur )?(?:la )?chaine\s+(.+)$/.exec(t);
  if (ch) {
    const chans = await api('/api/library?type=channel').catch(() => []);
    const said = ch[1];
    const num = Number(said) || NUMS[said];
    const c = num ? chans.find((x) => x.number === num) : bestMatch(chans, said, (x) => x.title);
    if (c) { ctx.go(ctx.channelPath(c)); return { ok: true, message: `Chaîne ${c.number ? `${c.number}, ` : ''}${c.title}` }; }
    return { ok: false, message: `Aucune chaîne « ${said} »` };
  }
  // Titre à lancer : « mets / lance / regarde / joue … »
  const play = /^(?:mets|met|lance|regarde|joue|lis|demarre|je veux voir|je veux regarder)\s+(?:moi\s+)?(?:le film |la serie |l anime |le |la |les |l )?(.+)$/.exec(t);
  if (play) {
    const lib = await api('/api/library').catch(() => []);
    const it = bestMatch(lib.filter((x) => x.type !== 'clip' || /clip/.test(t)), play[1], (x) => x.title);
    if (it) {
      // Série ou animé : l'épisode à suivre (sinon le premier)
      let id = it.id;
      if (it.type === 'show') {
        const d = await api(`/api/items/${it.id}`).catch(() => null);
        const first = d && d.seasons && (d.seasons.find((x) => x.number > 0) || d.seasons[0]);
        id = (d && d.nextUp && d.nextUp.id) || (first && first.episodes[0] && first.episodes[0].id) || null;
        if (!id) { ctx.go(it.path || `/titre/${it.id}`); return { ok: true, message: it.title }; }
      }
      ctx.go(ctx.playPath(id));
      return { ok: true, message: `Lecture : ${it.title}` };
    }
    const chans = await api('/api/library?type=channel').catch(() => []);
    const c = bestMatch(chans, play[1], (x) => x.title);
    if (c) { ctx.go(ctx.channelPath(c)); return { ok: true, message: `Chaîne ${c.title}` }; }
    return { ok: false, message: `« ${play[1]} » n’est pas dans Venus`, search: play[1] };
  }
  return { ok: false, search: text, message: `Recherche : ${text}` };
}
