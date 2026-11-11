// Compression des vidéos (interface classique) : même service que web/components/pages/Convert.js.
// Propositions avec gain estimé, réglages du profil, file d'attente, copies à valider — et le bloc d'une fiche.
import { api } from './api.js';
import { h, icon, sheet, toast, confirmSheet, langName } from './ui.js';
import { go } from './core.js';

const LANGS = [['fre', 'Français'], ['eng', 'Anglais'], ['jpn', 'Japonais'], ['spa', 'Espagnol'], ['ger', 'Allemand'], ['ita', 'Italien'], ['ara', 'Arabe'], ['kor', 'Coréen'], ['chi', 'Chinois'], ['por', 'Portugais']];
const fmtGo = (b) => (!b ? '0 Mo' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);
const pct = (a, b) => (a && b ? Math.round((1 - b / a) * 100) : 0);
const epLabel = (x) => (x.type === 'episode' && x.show ? `${x.show} · S${x.season} É${x.episode} · ${x.title}` : `${x.title}${x.year ? ` (${x.year})` : ''}`);
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('small', {}, hint) : null);
const select = (opts, value, onchange) => h('select', { class: 'f', onchange }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
const toggle = (label, hint, on, onchange) => h('label', { class: 'switch' }, h('span', {}, label, h('small', { class: 'muted', style: { display: 'block' } }, hint)),
  h('input', { type: 'checkbox', class: 'f', checked: on, onchange: async (e) => { try { await onchange(e.target.checked); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; } } }));

// Validation : l'original part à la corbeille (7 jours) ou est supprimé tout de suite ; la copie prend son nom
export function validateSheet(c, reload) {
  return new Promise((resolve) => {
    const run = async (purge) => {
      try { const r = await api(`/api/admin/convert/${c.id}/validate`, { method: 'POST', body: { purge } }); toast(purge ? `Validé : ${fmtGo(r.saved)} libérés` : `Validé : ${fmtGo(r.saved)} libérés dans 7 jours (corbeille)`); } catch (e) { toast(e.message, true); }
      s.close(); reload(); resolve();
    };
    const s = sheet('Valider la copie compressée', h('div', { class: 'req-sheet' },
      h('p', {}, `La copie (${fmtGo(c.sizeAfter)}) remplace l’original (${fmtGo(c.sizeBefore)}) et prend son nom. Que faire de l’original ?`),
      h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => run(false) }, 'Corbeille 7 jours (recommandé)'),
      h('button', { class: 'btn btn-ghost f', onclick: async () => { if (await confirmSheet('Supprimer définitivement l’original, tout de suite ? Impossible de revenir en arrière.', 'Supprimer définitivement')) run(true); } }, 'Supprimer définitivement maintenant'),
      h('p', { class: 'muted small' }, 'Radarr ou Sonarr, s’ils sont reliés, relisent le dossier pour retrouver le nouveau fichier au lieu de croire la vidéo perdue.')),
    { onClose: resolve });
  });
}

export function convertBox() {
  const box = h('section', { class: 'box', id: 'convert' }, h('h2', {}, 'Compression des vidéos'), h('p', { class: 'muted' }, 'Chargement…'));
  let st = null, sug = null, showAll = false;
  const sel = new Set();
  const load = async () => { try { st = await api('/api/admin/convert'); paint(); } catch { /* hors ligne */ } };
  const loadSug = async () => { try { sug = await api('/api/admin/convert/suggest'); paint(); } catch { /* */ } };
  const save = async (patch) => { try { const r = await api('/api/admin/convert/settings', { method: 'PUT', body: patch }); st.settings = r.settings; paint(); loadSug(); } catch (e) { toast(e.message, true); } };
  const queue = async (ids, all = false) => {
    try { const r = await api('/api/admin/convert', { method: 'POST', body: all ? { all: true } : { ids } }); toast(r.queued ? `${r.queued} vidéo(s) mise(s) en file` : 'Rien à ajouter'); } catch (e) { toast(e.message, true); }
    sel.clear(); load(); loadSug();
  };
  const cancel = async (id) => { try { await api(`/api/admin/convert/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, true); } load(); loadSug(); };
  const list = (rows) => h('div', { class: 'conv-list' }, rows);
  function paint() {
    if (!st) return;
    const s = st.settings;
    const done = st.list.filter((c) => c.status === 'done'), active = st.list.filter((c) => c.status === 'running' || c.status === 'queued'), failed = st.list.filter((c) => c.status === 'failed');
    const items = sug ? (showAll ? sug.items : sug.items.slice(0, 12)) : [];
    box.replaceChildren(h('h2', {}, 'Compression des vidéos'),
      h('p', {}, 'Pour gagner de la place sur le NAS : Venus réencode la vidéo en ', h('b', {}, 'H.264 + AAC'), ', lisible partout sans conversion à la lecture, en qualité quasi identique (CRF 20, débit plafonné selon la définition). La copie est écrite à côté de l’original ; ', h('b', {}, 'l’original reste'), ' jusqu’à ce que vous ayez vérifié la copie et cliqué « Valider » — il part alors à la corbeille (7 jours), et la copie prend son nom.'),
      h('div', { class: 'src-list' },
        h('span', { class: `src${st.saved ? ' ok' : ''}` }, `Place gagnée : ${fmtGo(st.saved)}`),
        h('span', { class: `src${done.length ? ' ok' : ''}` }, `${done.length} copie(s) à valider${st.pending ? ` (${fmtGo(st.pending)} à libérer)` : ''}`),
        h('span', { class: 'src' }, active.length ? `${active.length} en file` : 'File vide', st.paused ? ' · en pause (lecture en cours)' : ''),
        h('span', { class: 'src' }, `Encodeur : ${st.hw} · ${st.cpu} cœurs`)),
      h('h3', { class: 'box-sub' }, 'Réglages'),
      h('div', { class: 'two-cols wide' },
        field('Définition maximale', select([['1080', '1080p (recommandé)'], ['0', 'D’origine (garde le 4K)'], ['720', '720p (très compact)']], s.maxHeight, (e) => save({ maxHeight: Number(e.target.value) })), '1080p suffit à la plupart des écrans et divise la taille d’un 4K par trois. « D’origine » garde le 4K (fichiers plus gros).'),
        field('Encodeur', select([['auto', 'Automatique (carte graphique si présente)'], ['cpu', 'Processeur (meilleure qualité, lent)'], ['gpu', 'Carte graphique (rapide)']], s.encoder, (e) => save({ encoder: e.target.value })), 'Le processeur donne la meilleure qualité à taille égale mais est lent ; la carte graphique va 5 à 10 fois plus vite.')),
      field('Langues audio conservées', h('div', { class: 'chips' }, LANGS.map(([c, n]) => h('button', { type: 'button', class: `chip f${s.langs.includes(c) ? ' on' : ''}`, 'aria-pressed': String(s.langs.includes(c)), onclick: () => save({ langs: s.langs.includes(c) ? s.langs.filter((x) => x !== c) : [...s.langs, c] }) }, n))),
        'Rien de coché : toutes les pistes sont gardées. Sinon seules ces langues restent (toutes si aucune ne correspond). Modifiable vidéo par vidéo depuis sa fiche.'),
      toggle('Réduire le son en stéréo', 'Décoché : le 5.1 est conservé (en AAC 384 kb/s). Coché : stéréo 192 kb/s, encore plus léger.', s.stereo, (v) => save({ stereo: v })),
      toggle('Conserver les sous-titres texte intégrés', 'SRT/ASS intégrés gardés dans la copie. Les sous-titres image (PGS des Blu-ray) ne peuvent pas être conservés en MP4 : Venus peut les retélécharger.', s.subs, (v) => save({ subs: v })),
      toggle('Seulement la nuit (1 h – 7 h)', 'Pour ne pas ralentir le NAS en journée. Une lecture interrompt toujours la compression en cours, qui reprend ensuite.', s.night, (v) => save({ night: v })),
      h('h3', { class: 'box-sub' }, 'Propositions', sug ? h('small', { class: 'muted' }, ` ${sug.items.length} vidéo(s) · jusqu’à ${fmtGo(sug.totalGain)} à gagner`) : null),
      !sug ? h('p', { class: 'muted' }, 'Calcul…') : !sug.items.length ? h('p', { class: 'muted' }, 'Rien à compresser : vos vidéos sont déjà en H.264 à un débit raisonnable.') : h('div', {},
        list(items.map((x) => h('label', { class: 'conv-row' },
          h('input', { type: 'checkbox', checked: sel.has(x.id), 'aria-label': `Sélectionner ${x.title}`, onchange: (e) => { if (e.target.checked) sel.add(x.id); else sel.delete(x.id); paint(); } }),
          h('span', { class: 'conv-txt' }, h('b', {}, epLabel(x)), h('small', {}, `${fmtGo(x.size)} → ≈ ${fmtGo(x.estimated)} (−${Math.round(x.gain * 100)} %) · ${x.why.join(' · ')}`))))),
        sug.items.length > 12 ? h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { showAll = !showAll; paint(); } }, showAll ? 'Réduire' : `Voir les ${sug.items.length}`) : null,
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
          h('button', { class: 'btn btn-small btn-play f', disabled: !sel.size, onclick: () => queue([...sel]) }, `Compresser la sélection (${sel.size})`),
          h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { if (await confirmSheet(`Mettre en file les ${sug.items.length} vidéos proposées ? Elles seront compressées une par une ; rien n’est supprimé avant votre validation.`, 'Tout compresser')) queue([], true); } }, 'Tout compresser'))),
      active.length ? h('h3', { class: 'box-sub' }, 'En cours') : null,
      active.length ? list(active.map((c) => h('div', { class: 'conv-row' },
        h('span', { class: 'conv-txt' }, h('b', {}, epLabel(c)), h('small', {}, c.status === 'running' ? `${c.pct} %${c.speed ? ` · ${c.speed}× temps réel` : ''}${c.encoder ? ` · ${c.encoder}` : ''}` : 'En attente'),
          c.status === 'running' ? h('span', { class: 'bar' }, h('i', { style: { width: `${c.pct}%` } })) : null),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => cancel(c.id) }, 'Annuler')))) : null,
      done.length ? h('h3', { class: 'box-sub' }, 'Copies à valider') : null,
      done.length ? h('p', { class: 'muted small' }, 'Regardez la copie (bouton « Lire la copie » : c’est elle que Venus lit désormais quand vous lancez le titre), puis validez. Pour revoir l’original : « Lire l’original ».') : null,
      done.length ? list(done.map((c) => h('div', { class: 'conv-row' },
        h('span', { class: 'conv-txt' }, h('b', {}, epLabel(c)), h('small', {}, `${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (−${pct(c.sizeBefore, c.sizeAfter)} %)${c.encoder ? ` · ${c.encoder}` : ''}`)),
        h('div', { class: 'conv-actions' },
          h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go(`/lecture/${c.itemId}`) }, icon('play'), 'Lire la copie'),
          h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go(`/lecture/${c.itemId}?src=original`) }, 'Lire l’original'),
          h('button', { class: 'btn btn-small btn-play f', onclick: () => validateSheet(c, load) }, icon('check'), 'Valider'),
          h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { if (await confirmSheet('Supprimer la copie compressée ? L’original est conservé.', 'Supprimer la copie')) cancel(c.id); } }, 'Supprimer la copie'))))) : null,
      failed.length ? h('h3', { class: 'box-sub' }, 'Échecs') : null,
      failed.length ? list(failed.map((c) => h('div', { class: 'conv-row' },
        h('span', { class: 'conv-txt' }, h('b', {}, epLabel(c)), h('small', { class: 'error-text' }, c.error)),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => cancel(c.id) }, 'Retirer')))) : null);
  }
  load(); loadSug();
  const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); if (!document.hidden) load(); }, 5000);
  return box;
}

// Bloc sur la fiche d'un film ou d'un épisode (administrateur) ; reload = re-rendu de la fiche
export function compressNote(d, reload) {
  const c = d.compress;
  if (!c) return null;
  if (c.show) return h('p', { class: 'resume-note' }, icon('info'), ` ${c.ready ? `${c.ready} épisode(s) compressé(s) à valider` : ''}${c.ready && c.running ? ' · ' : ''}${c.running ? `${c.running} en cours de compression` : ''} — `, h('a', { href: '/reglages?onglet=perf', onclick: (e) => { e.preventDefault(); go('/reglages?onglet=perf'); } }, 'Réglages → Performance'));
  if (c.status === 'suggested') {
    const present = [...new Set((c.audio || []).map((a) => a.lang))];
    let chosen = present.slice();
    const chips = h('div', { class: 'chips' });
    const paintChips = () => chips.replaceChildren(...present.map((l) => h('button', { type: 'button', class: `chip f${chosen.includes(l) ? ' on' : ''}`, 'aria-pressed': String(chosen.includes(l)), onclick: () => { chosen = chosen.includes(l) ? (chosen.length > 1 ? chosen.filter((x) => x !== l) : chosen) : [...chosen, l]; paintChips(); } }, langName(l))), h('small', { class: 'muted' }, 'Langues gardées dans la copie'));
    paintChips();
    const btn = h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
      btn.disabled = true;
      try { await api('/api/admin/convert', { method: 'POST', body: { ids: [d.id], opts: present.length > 1 && chosen.length !== present.length ? { langs: chosen } : {} } }); toast('Compression lancée : vous serez prévenu quand la copie sera prête'); reload(); } catch (e) { toast(e.message, true); btn.disabled = false; }
    } }, icon('disk'), 'Compresser (l’original est conservé)');
    return h('div', { class: 'compress-note' },
      h('p', {}, icon('disk'), ` Cette vidéo peut être compressée : ${fmtGo(c.size)} → ≈ ${fmtGo(c.estimated)} (−${Math.round(c.gain * 100)} %)${c.height ? ` · ${c.height}p` : ''} · ${c.why.join(' · ')}.`),
      present.length > 1 ? chips : null, btn);
  }
  if (c.status === 'queued' || c.status === 'running') return h('p', { class: 'resume-note' }, icon('disk'), c.status === 'running' ? ` Compression en cours : ${c.pct} %` : ' Compression en attente');
  if (c.status === 'done') {
    return h('div', { class: 'compress-note ok' },
      h('p', {}, icon('check'), ` Copie compressée prête : ${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (−${pct(c.sizeBefore, c.sizeAfter)} %). « Lire » lit désormais la copie ; vérifiez-la, puis validez pour supprimer l’original.`),
      h('div', { class: 'conv-actions' },
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go(`/lecture/${d.id}?src=original`) }, 'Lire l’original'),
        h('button', { class: 'btn btn-small btn-play f', onclick: () => validateSheet({ ...c, itemId: d.id }, reload) }, icon('check'), 'Valider la copie'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { if (await confirmSheet('Supprimer la copie compressée ? L’original est conservé.', 'Supprimer la copie')) { try { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, true); } reload(); } } }, 'Supprimer la copie')));
  }
  return null;
}
