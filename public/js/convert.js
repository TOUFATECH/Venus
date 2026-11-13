// Compression des vidéos (interface classique) : même service que web/components/pages/Convert.js.
// Propositions avec gain estimé, réglages du profil, file d'attente, copies à valider — et le bloc d'une fiche.
import { api } from './api.js';
import { h, icon, sheet, toast, confirmSheet, langName } from './ui.js';
import { go } from './core.js';

const DEFS = [['0', 'D’origine (garde le 4K)'], ['1440', '1440p'], ['1080', '1080p (recommandé)'], ['720', '720p (très compact)']];
const QUALS = [['max', 'Maximale'], ['high', 'Haute'], ['balanced', 'Équilibrée']];
const LANGS = [['fre', 'Français'], ['eng', 'Anglais'], ['jpn', 'Japonais'], ['spa', 'Espagnol'], ['ger', 'Allemand'], ['ita', 'Italien'], ['ara', 'Arabe'], ['kor', 'Coréen'], ['chi', 'Chinois'], ['por', 'Portugais']];
// Taille lisible en Go ou Mo
const fmtGo = (b) => (!b ? '0 Mo' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);
// Pourcentage de place gagnée
const pct = (a, b) => (a && b ? Math.round((1 - b / a) * 100) : 0);
// Écart de taille en clair : « −35 % » quand la copie est plus légère, « +13 % » quand elle serait plus lourde (une
// vidéo déjà très légère, proposée parce que son format oblige à la convertir à chaque lecture), jamais « −-13 % »
const delta = (p) => (p > 0 ? `−${p} %` : p < 0 ? `+${-p} %` : 'même taille');
// Message après validation (place libérée)
const freed = (r, later) => (r.saved > 0 ? `Validé : ${fmtGo(r.saved)} libérés${later ? ' dans 7 jours (corbeille)' : ''}` : 'Validé : la copie remplace l’original');
// Nom lisible d'une vidéo (épisode avec sa série)
const epLabel = (x) => (x.type === 'episode' && x.show ? `${x.show} · S${x.season} É${x.episode} · ${x.title}` : `${x.title}${x.year ? ` (${x.year})` : ''}`);
// Champ de formulaire avec son libellé et son aide
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('small', {}, hint) : null);
// Liste déroulante
const select = (opts, value, onchange) => h('select', { class: 'f', onchange }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
// Interrupteur enregistré dès qu'il change
const toggle = (label, hint, on, onchange) => h('label', { class: 'switch' }, h('span', {}, label, h('small', { class: 'muted', style: { display: 'block' } }, hint)),
  h('input', { type: 'checkbox', class: 'f', checked: on, onchange: async (e) => { try { await onchange(e.target.checked); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; } } }));

// Validation : l'original part à la corbeille (7 jours) ou est supprimé tout de suite ; la copie prend son nom
export function validateSheet(c, reload) {
  return new Promise((resolve) => {
    const run = async (purge) => {
      try { const r = await api(`/api/admin/convert/${c.id}/validate`, { method: 'POST', body: { purge } }); toast(freed(r, !purge)); } catch (e) { toast(e.message, true); }
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

// Encadré « Compression des vidéos » des réglages
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
        field('Qualité', select((st.qualities || []).map((q) => [q.id, q.label]), s.quality, (e) => save({ quality: e.target.value })), 'Maximale : CRF 17, quasi sans perte visible même sur un grand écran, fichiers plus gros. Haute : CRF 20, indiscernable à distance normale. Équilibrée : CRF 23, nette, bien plus légère.'),
        field('Définition maximale', select(DEFS, s.maxHeight, (e) => save({ maxHeight: Number(e.target.value) })), '1080p suffit à la plupart des écrans et divise la taille d’un 4K par trois. « D’origine » garde le 4K (fichiers plus gros).'),
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
          h('span', { class: 'conv-txt' }, h('b', {}, epLabel(x)), h('small', {}, `${fmtGo(x.size)} → ≈ ${fmtGo(x.estimated)} (${delta(Math.round(x.gain * 100))}) · ${x.why.join(' · ')}`))))),
        sug.items.length > 12 ? h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { showAll = !showAll; paint(); } }, showAll ? 'Réduire' : `Voir les ${sug.items.length}`) : null,
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
          h('button', { class: 'btn btn-small btn-play f', disabled: !sel.size, onclick: () => queue([...sel]) }, `Compresser la sélection (${sel.size})`),
          h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { if (await confirmSheet('Mettre en file toutes les vidéos proposées qui gagnent de la place ? Elles seront compressées une par une ; rien n’est supprimé avant votre validation.', 'Tout compresser')) queue([], true); } }, 'Tout compresser'))),
      active.length ? h('h3', { class: 'box-sub' }, 'En cours') : null,
      active.length ? list(active.map((c) => h('div', { class: 'conv-row' },
        h('span', { class: 'conv-txt' }, h('b', {}, epLabel(c)), h('small', {}, c.status === 'running' ? `${c.pct} %${c.speed ? ` · ${c.speed}× temps réel` : ''}${c.encoder ? ` · ${c.encoder}` : ''}` : 'En attente'),
          c.status === 'running' ? h('span', { class: 'bar' }, h('i', { style: { width: `${c.pct}%` } })) : null),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => cancel(c.id) }, 'Annuler')))) : null,
      done.length ? h('h3', { class: 'box-sub' }, 'Copies à valider') : null,
      done.length ? h('p', { class: 'muted small' }, 'Regardez la copie (bouton « Lire la copie » : c’est elle que Venus lit désormais quand vous lancez le titre), puis validez. Pour revoir l’original : « Lire l’original ».') : null,
      done.length ? list(done.map((c) => h('div', { class: 'conv-row' },
        h('span', { class: 'conv-txt' }, h('b', {}, epLabel(c)), h('small', {}, `${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (${delta(pct(c.sizeBefore, c.sizeAfter))})${c.encoder ? ` · ${c.encoder}` : ''}`)),
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
    const choice = { maxHeight: null, quality: null };
    const head = h('p', {});
    // Copie pas plus légère que l'original : on le dit (elle sert à lire la vidéo partout sans conversion, pas à gagner de la place)
    const label = h('span', {});
    const paintHead = (e) => {
      const gain = Math.round((e ? e.gain : c.gain) * 100);
      head.replaceChildren(icon('disk'), ` ${gain > 0 ? 'Cette vidéo peut être compressée' : 'Cette vidéo peut être convertie pour être lue partout sans attente, sans gain de place'} : ${fmtGo(c.size)} → ≈ ${fmtGo(e ? e.estimated : c.estimated)} (${delta(gain)})${(e ? e.height : c.height) ? ` · ${e ? e.height : c.height}p` : ''} · ${c.why.join(' · ')}.`);
      label.textContent = gain > 0 ? 'Compresser (l’original est conservé)' : 'Convertir (l’original est conservé)';
    };
    paintHead(null);
    const refresh = async () => {
      if (choice.maxHeight == null && !choice.quality && chosen.length === present.length) return paintHead(null);
      const q = new URLSearchParams(); if (choice.maxHeight != null) q.set('maxHeight', choice.maxHeight); if (choice.quality) q.set('quality', choice.quality); if (chosen.length !== present.length) q.set('langs', chosen.join(','));
      try { paintHead(await api(`/api/admin/convert/estimate/${d.id}?${q}`)); } catch { paintHead(null); }
    };
    const sel = (label, opts, onchange) => h('label', {}, h('span', {}, label), h('select', { class: 'f', onchange }, h('option', { value: '' }, 'Réglage général'), opts.map(([v, l]) => h('option', { value: v }, l))));
    const choices = h('div', { class: 'conv-choices' },
      sel('Qualité', QUALS, (e) => { choice.quality = e.target.value || null; refresh(); }),
      sel('Définition', DEFS, (e) => { choice.maxHeight = e.target.value === '' ? null : Number(e.target.value); refresh(); }));
    const chips = h('div', { class: 'chips' });
    const paintChips = () => chips.replaceChildren(...present.map((l) => h('button', { type: 'button', class: `chip f${chosen.includes(l) ? ' on' : ''}`, 'aria-pressed': String(chosen.includes(l)), onclick: () => { chosen = chosen.includes(l) ? (chosen.length > 1 ? chosen.filter((x) => x !== l) : chosen) : [...chosen, l]; paintChips(); refresh(); } }, langName(l))), h('small', { class: 'muted' }, 'Langues gardées dans la copie'));
    paintChips();
    const btn = h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
      btn.disabled = true;
      const opts = { ...(present.length > 1 && chosen.length !== present.length ? { langs: chosen } : {}), ...(choice.maxHeight != null ? { maxHeight: choice.maxHeight } : {}), ...(choice.quality ? { quality: choice.quality } : {}) };
      try { await api('/api/admin/convert', { method: 'POST', body: { ids: [d.id], opts } }); toast('Compression lancée : vous serez prévenu quand la copie sera prête'); reload(); } catch (e) { toast(e.message, true); btn.disabled = false; }
    } }, icon('disk'), label);
    return h('div', { class: 'compress-note' }, head, choices, present.length > 1 ? chips : null, btn);
  }
  if (c.status === 'queued' || c.status === 'running') return h('p', { class: 'resume-note' }, icon('disk'), c.status === 'running' ? ` Compression en cours : ${c.pct} %` : ' Compression en attente');
  if (c.status === 'done') {
    return h('div', { class: 'compress-note ok' },
      h('p', {}, icon('check'), ` ${c.sizeAfter < c.sizeBefore ? 'Copie compressée prête' : 'Copie prête, sans gain de place (la vidéo était déjà très légère)'} : ${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (${delta(pct(c.sizeBefore, c.sizeAfter))}). « Lire » lit désormais la copie ; vérifiez-la, puis validez pour supprimer l’original.`),
      h('div', { class: 'conv-actions' },
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go(`/lecture/${d.id}?src=original`) }, 'Lire l’original'),
        h('button', { class: 'btn btn-small btn-play f', onclick: () => validateSheet({ ...c, itemId: d.id }, reload) }, icon('check'), 'Valider la copie'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { if (await confirmSheet('Supprimer la copie compressée ? L’original est conservé.', 'Supprimer la copie')) { try { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, true); } reload(); } } }, 'Supprimer la copie')));
  }
  return null;
}
