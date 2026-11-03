// Guide des programmes TV (grille) et enregistrements, comme Jellyfin
import { api } from '../api.js';
import { h, icon, img, toast, sheet, confirmSheet } from '../ui.js';
import { go, state } from '../app.js';
import { playPath } from '../components.js';

const PX = 5; // pixels par minute
const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function tvTabs(current) {
  return h('div', { class: 'seg tv-tabs', role: 'tablist' }, [['chaines', 'Chaînes', '/tv'], ['guide', 'Guide', '/tv?vue=guide'], ['enregistrements', 'Enregistrements', '/tv?vue=enregistrements']]
    .map(([k, l, href]) => h('button', { class: `seg-b f${k === current ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === current), onclick: () => k !== current && go(href) }, l)));
}

// Fenêtre d'un programme : regarder, enregistrer, suivre l'émission
export function programSheet(p, ch, onChange = () => {}) {
  const now = Date.now();
  const onAir = p.start <= now && p.stop > now;
  const pct = onAir ? Math.round(((now - p.start) / (p.stop - p.start)) * 100) : 0;
  const rec = async (body, msg) => {
    try { await api('/api/recordings', { method: 'POST', body }); s.close(); toast(msg, { type: 'success', action: { label: 'Voir', onClick: () => go('/tv?vue=enregistrements') } }); onChange(); }
    catch (e) { toast(e.message, true); }
  };
  const s = sheet(p.title, h('div', { class: 'prog-sheet' },
    h('p', { class: 'prog-when' }, `${ch ? `${ch.number ? `${ch.number}. ` : ''}${ch.title} · ` : ''}${day(p.start)}, ${hm(p.start)} – ${hm(p.stop)}`),
    onAir ? h('div', { class: 'prog-bar' }, h('i', { style: { width: `${pct}%` } })) : null,
    p.sub ? h('h3', {}, p.sub) : null,
    p.cat ? h('span', { class: 'chip small' }, p.cat) : null,
    p.descr ? h('p', {}, p.descr) : h('p', { class: 'muted' }, 'Pas de résumé.'),
    h('div', { class: 'actions' },
      onAir && ch ? h('button', { class: 'btn btn-play f', onclick: () => { s.close(); go(playPath(ch.id)); } }, icon('play'), 'Regarder') : null,
      p.rec ? h('button', { class: 'btn btn-ghost f', onclick: async () => { await api(`/api/recordings/${p.rec.id}`, { method: 'DELETE' }); s.close(); toast(p.rec.status === 'recording' ? 'Enregistrement arrêté' : 'Enregistrement annulé'); onChange(); } }, icon('close'), p.rec.status === 'recording' ? 'Arrêter l’enregistrement' : 'Annuler l’enregistrement')
        : p.stop > now ? h('button', { class: 'btn f', onclick: () => rec({ programId: p.id }, `« ${p.title} » sera enregistré`) }, h('span', { class: 'rec-dot' }), onAir ? 'Enregistrer (à partir de maintenant)' : 'Enregistrer') : null,
      p.stop > now ? h('button', { class: 'btn btn-ghost f', onclick: () => rec({ programId: p.id, series: true }, `Toutes les diffusions de « ${p.title} » seront enregistrées`) }, icon('list'), 'Enregistrer toutes les diffusions') : null)));
}

export async function renderGuide(main) {
  const page = h('div', { class: 'page guide-page' });
  main.append(page);
  let from = Math.floor((Date.now() - 30 * 60000) / (30 * 60000)) * 30 * 60000;
  const span = 4 * 3600e3;
  let timer = null;
  const paint = async () => {
    const d = await api(`/api/epg?from=${from}&to=${from + span}`);
    const width = (span / 60000) * PX;
    const head = h('div', { class: 'g-times', style: { width: `${width}px` } });
    for (let t = from; t < from + span; t += 30 * 60000) head.append(h('span', { style: { left: `${((t - from) / 60000) * PX}px` } }, hm(t)));
    const rows = d.channels.map((ch) => {
      const progs = (d.programs[ch.id] || []);
      const lane = h('div', { class: 'g-lane', style: { width: `${width}px` } }, progs.length ? progs.map((p) => {
        const a = Math.max(p.start, from), b = Math.min(p.stop, from + span);
        const onAir = p.start <= d.now && p.stop > d.now;
        return h('button', { class: `g-prog f${onAir ? ' now' : ''}${p.stop <= d.now ? ' past' : ''}${p.rec ? ' rec' : ''}`, style: { left: `${((a - from) / 60000) * PX}px`, width: `${Math.max(6, ((b - a) / 60000) * PX - 3)}px` },
          title: `${p.title} · ${hm(p.start)}–${hm(p.stop)}`, onclick: () => programSheet(p, ch, paint) },
        p.rec ? h('span', { class: 'rec-dot' }) : null, h('b', {}, p.title), h('small', {}, `${hm(p.start)} – ${hm(p.stop)}${p.sub ? ` · ${p.sub}` : ''}`));
      }) : h('span', { class: 'g-none' }, 'Pas de programme'));
      return h('div', { class: 'g-row' },
        h('button', { class: 'g-ch f', title: `Regarder ${ch.title}`, onclick: () => go(playPath(ch.id)) },
          ch.logo ? h('img', { src: img(ch.logo), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null,
          h('span', {}, ch.number ? h('em', {}, ch.number) : null, ch.title)), lane);
    });
    const nowLine = d.now >= from && d.now < from + span ? h('i', { class: 'g-now', style: { left: `${((d.now - from) / 60000) * PX}px` } }) : null;
    const admin = state.profile.isAdmin;
    page.replaceChildren(
      h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'TV en direct'), h('p', { class: 'count' }, day(from))),
        h('div', { class: 'head-tools' }, tvTabs('guide'), admin ? h('button', { class: 'btn btn-ghost btn-small f', onclick: () => guideSettings(paint) }, icon('gear'), 'Réglages du guide') : null)),
      h('div', { class: 'g-nav' },
        h('button', { class: 'btn btn-ghost btn-small f', disabled: from <= Date.now() - 6 * 3600e3, onclick: () => { from -= 2 * 3600e3; paint(); } }, icon('back'), '2 h avant'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { from = Math.floor((Date.now() - 30 * 60000) / (30 * 60000)) * 30 * 60000; paint(); } }, 'Maintenant'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { from += 2 * 3600e3; paint(); } }, '2 h après', icon('fwd'))),
      Object.keys(d.programs).length ? h('div', { class: 'g-scroll' }, h('div', { class: 'g-grid' }, h('div', { class: 'g-head' }, h('span', { class: 'g-corner' }), head), h('div', { class: 'g-body' }, ...rows, nowLine ? h('div', { class: 'g-nowwrap', style: { width: `${width}px` } }, nowLine) : null)))
        : h('div', { class: 'empty' }, h('h2', {}, 'Pas encore de guide'), h('p', {}, d.state.sources ? 'Le guide est en cours de téléchargement, ou ne correspond à aucune de vos chaînes.' : 'Votre liste IPTV ne donne pas d’adresse de guide (XMLTV).'),
          admin ? h('button', { class: 'btn btn-play f', onclick: () => guideSettings(paint) }, 'Ajouter une adresse de guide') : h('p', {}, 'Demandez à l’administrateur d’en ajouter une.')));
    clearTimeout(timer);
    timer = setTimeout(() => { if (document.contains(page)) paint().catch(() => {}); }, 60000);
  };
  await paint();
  return { destroy: () => clearTimeout(timer) };
}

async function guideSettings(onDone) {
  const d = await api('/api/admin/livetv');
  const urls = h('textarea', { class: 'input mono', rows: 4, placeholder: 'https://exemple.com/guide.xml.gz' }, d.epg.manual);
  const dir = h('input', { class: 'input mono', value: d.dvrPath });
  const pre = h('input', { class: 'input', type: 'number', min: 0, max: 30, value: d.pre });
  const post = h('input', { class: 'input', type: 'number', min: 0, max: 120, value: d.post });
  const all = h('input', { type: 'checkbox', class: 'f', checked: d.everyone });
  const err = h('p', { class: 'error-text' });
  const last = d.epg.last;
  const s = sheet('Guide des programmes et enregistrements', h('form', { class: 'edit-form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      await api('/api/admin/livetv', { method: 'PUT', body: { epgUrls: urls.value, dvrPath: dir.value, pre: Number(pre.value) || 0, post: Number(post.value) || 0, everyone: all.checked } });
      await api('/api/admin/tasks/epg/run', { method: 'POST' });
      s.close(); toast('Enregistré : le guide se met à jour', { type: 'success' }); setTimeout(() => onDone && onDone(), 4000);
    } catch (e2) { err.textContent = e2.message; }
  } },
  h('div', { class: 'field' }, h('label', {}, 'Adresses du guide XMLTV (une par ligne)'), urls,
    h('small', {}, `Trouvées automatiquement dans vos listes : ${d.epg.sources.length - d.epg.manual.split(/\s+/).filter(Boolean).length > 0 ? d.epg.sources.filter((x) => !d.epg.manual.includes(x)).map((x) => x.replace(/(password=)[^&]+/i, '$1•••')).join(', ') : 'aucune'}. ${last ? `Dernière mise à jour : ${new Date(last.at).toLocaleString('fr-FR')} (${last.programs} programmes, ${last.channels} chaînes).` : ''}`)),
  h('div', { class: 'field' }, h('label', {}, 'Dossier des enregistrements'), dir, h('small', {}, 'Sur le serveur. Avec Docker, choisissez un dossier monté (ex. /media/enregistrements).')),
  h('div', { class: 'two-cols' }, h('div', { class: 'field' }, h('label', {}, 'Minutes avant le début'), pre), h('div', { class: 'field' }, h('label', {}, 'Minutes après la fin'), post)),
  h('label', { class: 'switch' }, h('span', {}, 'Tous les profils peuvent programmer des enregistrements'), all),
  err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Enregistrer et mettre à jour le guide'))), { wide: true });
}

export async function renderRecordings(main) {
  const page = h('div', { class: 'page rec-page' });
  main.append(page);
  const paint = async () => {
    const d = await api('/api/recordings');
    const now = Date.now();
    const groups = [['recording', 'En cours'], ['scheduled', 'Programmés'], ['done', 'Enregistrés'], ['failed', 'Échecs']];
    const row = (r) => h('div', { class: `rec-row st-${r.status}` },
      r.logo ? h('img', { class: 'rec-logo', src: img(r.logo), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : h('span', { class: 'rec-logo' }),
      h('div', { class: 'grow' }, h('b', {}, r.title, r.sub ? h('small', {}, ` · ${r.sub}`) : null),
        h('span', {}, `${r.channel || 'Chaîne'} · ${day(r.start)}, ${hm(r.start)} – ${hm(r.stop)}${r.ruleId ? ' · émission suivie' : ''}`),
        r.status === 'recording' ? h('div', { class: 'prog-bar' }, h('i', { style: { width: `${Math.min(100, Math.round(((now - r.start) / (r.stop - r.start)) * 100))}%` } })) : null,
        r.error ? h('small', { class: 'error-text' }, r.error) : null),
      r.status === 'done' && r.itemId ? h('button', { class: 'btn btn-small f', onclick: () => go(playPath(r.itemId)) }, icon('play'), 'Lire') : null,
      h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
        if (r.status === 'done' && !(await confirmSheet(`Supprimer l’enregistrement « ${r.title} » (fichier effacé) ?`, 'Supprimer'))) return;
        await api(`/api/recordings/${r.id}`, { method: 'DELETE' }); paint();
      } }, r.status === 'recording' ? 'Arrêter' : r.status === 'scheduled' ? 'Annuler' : icon('trash')));
    page.replaceChildren(
      h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'TV en direct')), h('div', { class: 'head-tools' }, tvTabs('enregistrements'))),
      ...groups.map(([st, label]) => { const list = d.recordings.filter((r) => r.status === st); return list.length ? h('section', { class: 'rec-sec' }, h('h2', { class: 'section-title' }, `${label} (${list.length})`), ...list.map(row)) : null; }),
      d.rules.length ? h('section', { class: 'rec-sec' }, h('h2', { class: 'section-title' }, 'Émissions suivies'),
        ...d.rules.map((r) => h('div', { class: 'rec-row' }, h('span', { class: 'rec-logo' }, icon('list')), h('div', { class: 'grow' }, h('b', {}, r.title), h('span', {}, `${r.channel_title || 'Chaîne'} · chaque diffusion est enregistrée`)),
          h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { await api(`/api/recordings/rules/${r.id}`, { method: 'DELETE' }); paint(); } }, 'Ne plus suivre')))) : null,
      !d.recordings.length && !d.rules.length ? h('div', { class: 'empty' }, h('h2', {}, 'Aucun enregistrement'), h('p', {}, 'Dans le Guide, touchez un programme puis « Enregistrer ».'), h('button', { class: 'btn btn-play f', onclick: () => go('/tv?vue=guide') }, 'Ouvrir le guide')) : null);
  };
  await paint();
  const t = setInterval(() => { if (document.contains(page)) paint().catch(() => {}); }, 30000);
  return { destroy: () => clearInterval(t) };
}
