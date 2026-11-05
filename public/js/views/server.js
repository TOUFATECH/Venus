// Administration du serveur (comme Jellyfin) : tâches planifiées, journal du serveur, clés API, webhooks, personnalisation
import { api } from '../api.js';
import { h, icon, toast, sheet, confirmSheet } from '../ui.js';
import { go, state, setTitle } from '../app.js';

const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
const dur = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const TABS = [['maj', 'Mise à jour'], ['taches', 'Tâches planifiées'], ['journal', 'Journal du serveur'], ['cles', 'Clés API'], ['webhooks', 'Webhooks'], ['perso', 'Personnalisation']];

export async function render(main, { query } = {}) {
  if (!state.profile.isAdmin) { main.append(h('div', { class: 'empty' }, h('h2', {}, 'Réservé à l’administrateur'))); return; }
  setTitle('Serveur');
  let tab = (query && query.get('onglet')) || 'taches';
  if (!TABS.some(([k]) => k === tab)) tab = 'taches';
  const page = h('div', { class: 'page srv' });
  const body = h('div', { class: 'srv-body' });
  const tabs = h('div', { class: 'seg srv-tabs', role: 'tablist' });
  let timer = null;
  const paintTabs = () => tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { class: `seg-b f${k === tab ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; paintTabs(); show(); } }, l)));
  const show = async () => {
    clearTimeout(timer);
    body.replaceChildren(h('p', { class: 'muted' }, h('span', { class: 'mini-spin' }), ' Chargement…'));
    try { await ({ maj: updateTab, taches: tasksTab, journal: logsTab, cles: keysTab, webhooks: hooksTab, perso: brandTab })[tab](body, (fn, ms) => { timer = setTimeout(fn, ms); }); }
    catch (e) { body.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
  };
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Serveur')),
    h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go('/tableau-de-bord') }, icon('back'), 'Tableau de bord')), tabs, body);
  main.append(page);
  paintTabs();
  await show();
  // Arrêt du rafraîchissement en quittant la page
  window.addEventListener('hashchange', () => clearTimeout(timer), { once: true });
}

async function tasksTab(body, later) {
  const list = await api('/api/admin/tasks');
  body.replaceChildren(h('p', { class: 'muted' }, 'Les travaux faits en arrière-plan. « Lancer » les démarre tout de suite.'),
    h('div', { class: 'task-list' }, list.map((t) => h('div', { class: `task${t.running ? ' running' : ''}${t.lastError ? ' failed' : ''}` },
      h('div', { class: 'grow' }, h('b', {}, t.label), h('p', {}, t.description),
        h('small', {}, [t.when || (t.every ? `Toutes les ${Math.round(t.every / 3600e3)} h` : null), `Dernière fois : ${when(t.lastRun)}${t.lastRun ? ` (${dur(t.lastDuration)})` : ''}`, t.lastResult, t.nextRun ? `Prochaine : ${when(t.nextRun)}` : null].filter(Boolean).join(' · ')),
        t.lastError ? h('small', { class: 'error-text' }, `Erreur : ${t.lastError}`) : null,
        t.running ? h('div', { class: 'task-bar' }, h('i', { style: { width: `${t.progress != null ? Math.round(t.progress * 100) : 30}%` }, class: t.progress == null ? 'indet' : '' })) : null),
      h('button', { class: 'btn btn-small f', disabled: t.running, onclick: async (e) => { e.currentTarget.disabled = true; await api(`/api/admin/tasks/${t.id}/run`, { method: 'POST' }); toast(`« ${t.label} » lancée`); setTimeout(() => tasksTab(body, later), 800); } }, t.running ? 'En cours…' : 'Lancer')))));
  if (list.some((t) => t.running)) later(() => tasksTab(body, later).catch(() => {}), 3000);
}

async function logsTab(body, later) {
  let level = 'all', q = '';
  const out = h('div', { class: 'log-view', role: 'log' });
  const search = h('input', { class: 'input', placeholder: 'Rechercher dans le journal', maxlength: 100, oninput: () => { q = search.value; clearTimeout(t0); t0 = setTimeout(load, 300); } });
  let t0 = null;
  const chips = h('div', { class: 'seg' }, [['all', 'Tout'], ['warn', 'Avertissements'], ['error', 'Erreurs']].map(([v, l]) => h('button', { class: `seg-b f${v === level ? ' on' : ''}`, onclick: (e) => { level = v; chips.querySelectorAll('.seg-b').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); load(); } }, l)));
  const load = async () => {
    const lines = await api(`/api/admin/logs?level=${level}&q=${encodeURIComponent(q)}`);
    out.replaceChildren(...(lines.length ? lines.map((l) => h('div', { class: `log-line lv-${l.level}` }, h('time', {}, new Date(l.at).toLocaleTimeString('fr-FR')), h('span', {}, l.text))) : [h('p', { class: 'muted' }, 'Rien à afficher.')]));
  };
  body.replaceChildren(h('div', { class: 'log-tools' }, chips, search,
    h('a', { class: 'btn btn-small btn-ghost f', href: '/api/admin/logs?download=1', download: '' }, icon('down'), 'Télécharger')), out,
  h('p', { class: 'muted' }, 'Les 2 000 dernières lignes depuis le démarrage. Les mots de passe et jetons sont masqués.'));
  await load();
  const tick = () => { if (!document.contains(out)) return; if (!q) load().catch(() => {}); later(tick, 5000); };
  later(tick, 5000);
}

async function keysTab(body) {
  const keys = await api('/api/admin/apikeys');
  const name = h('input', { class: 'input', placeholder: 'Nom de l’application (ex. : Home Assistant)', maxlength: 60 });
  body.replaceChildren(
    h('p', {}, 'Une clé API permet à un script ou une application de piloter Venus (lancer une analyse, lire la médiathèque…) avec les droits de l’administrateur. Envoyez-la dans l’en-tête ', h('code', {}, 'X-Api-Key'), '. Elle n’est affichée qu’une fois.'),
    h('form', { class: 'srv-inline', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      try {
        const r = await api('/api/admin/apikeys', { method: 'POST', body: { name: name.value.trim() } });
        const field = h('input', { class: 'input mono', value: r.key, readonly: true, onfocus: (ev) => ev.target.select() });
        sheet('Nouvelle clé API', h('div', {}, h('p', {}, 'Copiez-la maintenant : elle ne sera plus affichée.'), field,
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', onclick: async () => { try { await navigator.clipboard.writeText(r.key); toast('Clé copiée'); } catch { field.select(); } } }, icon('copy'), 'Copier')),
          h('p', { class: 'muted' }, 'Exemple : ', h('code', {}, `curl -X POST -H "X-Api-Key: ${r.key.slice(0, 8)}…" ${location.origin}/api/admin/scan`))), { onClose: () => keysTab(body) });
      } catch (e2) { toast(e2.message, true); }
    } }, name, h('button', { class: 'btn btn-small f', type: 'submit' }, icon('plus'), 'Créer une clé')),
    keys.length ? h('div', { class: 'sec-list' }, keys.map((k) => h('div', { class: 'sec-row' },
      h('div', { class: 'grow' }, h('b', {}, k.name), h('small', {}, `…${k.hint} · créée le ${when(k.createdAt)} · utilisée : ${when(k.lastUsed)}${k.lastIp ? ` depuis ${k.lastIp}` : ''}`)),
      h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
        if (!(await confirmSheet(`Supprimer la clé « ${k.name} » ? Les applications qui l’utilisent n’auront plus accès.`, 'Supprimer'))) return;
        await api(`/api/admin/apikeys/${k.id}`, { method: 'DELETE' }); keysTab(body);
      } }, 'Supprimer')))) : h('p', { class: 'muted' }, 'Aucune clé.'));
}

async function hooksTab(body) {
  const d = await api('/api/admin/webhooks');
  const edit = (hk = null) => {
    const url = h('input', { class: 'input', value: hk ? hk.url : '', placeholder: 'https://…', maxlength: 2000 });
    const nm = h('input', { class: 'input', value: hk ? hk.name : '', placeholder: 'Nom (facultatif)', maxlength: 60 });
    const secret = h('input', { class: 'input', value: hk ? hk.secret : '', placeholder: 'Secret (facultatif, pour la signature)', maxlength: 200 });
    const evs = new Set(hk ? hk.events : ['library.added']);
    const err = h('p', { class: 'error-text' });
    const s = sheet(hk ? 'Modifier le webhook' : 'Nouveau webhook', h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!/^https?:\/\/.+/.test(url.value.trim())) { err.textContent = 'Adresse http:// ou https:// attendue'; return; }
      if (!evs.size) { err.textContent = 'Choisissez au moins un évènement'; return; }
      const b = { url: url.value.trim(), name: nm.value.trim(), secret: secret.value, events: [...evs] };
      try { await api(hk ? `/api/admin/webhooks/${hk.id}` : '/api/admin/webhooks', { method: hk ? 'PUT' : 'POST', body: b }); s.close(); hooksTab(body); }
      catch (e2) { err.textContent = e2.message; }
    } },
    h('div', { class: 'field' }, h('label', {}, 'Adresse'), url), h('div', { class: 'field' }, h('label', {}, 'Nom'), nm), h('div', { class: 'field' }, h('label', {}, 'Secret'), secret),
    h('div', { class: 'field' }, h('label', {}, 'Évènements'), h('div', { class: 'perm-libs' }, Object.entries(d.events).map(([k, l]) => h('label', { class: 'chk' },
      h('input', { type: 'checkbox', class: 'f', checked: evs.has(k), onchange: (e) => (e.target.checked ? evs.add(k) : evs.delete(k)) }), l)))),
    h('p', { class: 'muted' }, 'Venus envoie un POST JSON { event, at, server, data }. Avec un secret, l’en-tête X-Venus-Signature contient sha256=HMAC du corps.'),
    err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Enregistrer'))), { wide: true });
  };
  body.replaceChildren(
    h('p', {}, 'Prévenez d’autres services (Home Assistant, n8n, Gotify, Discord…) quand quelque chose se passe sur Venus.'),
    h('div', { class: 'srv-inline' }, h('button', { class: 'btn btn-small f', onclick: () => edit() }, icon('plus'), 'Ajouter un webhook')),
    d.hooks.length ? h('div', { class: 'sec-list' }, d.hooks.map((hk) => h('div', { class: 'sec-row' },
      h('div', { class: 'grow' }, h('b', {}, hk.name || hk.url), h('small', {}, `${hk.events.map((e) => d.events[e] || e).join(', ')}${hk.lastAt ? ` · dernier envoi ${when(hk.lastAt)}` : ''}`),
        hk.lastError ? h('small', { class: 'error-text' }, `Dernière erreur : ${hk.lastError}`) : null),
      h('button', { class: 'btn btn-ghost btn-small f', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await api(`/api/admin/webhooks/${hk.id}/test`, { method: 'POST' }); toast(`Test envoyé (réponse ${r.status})`, { type: 'success' }); } catch (err) { toast(err.message, true); } b.disabled = false; } }, 'Tester'),
      h('button', { class: 'btn btn-ghost btn-small f', onclick: () => edit(hk) }, 'Modifier'),
      h('button', { class: 'btn btn-ghost btn-small f', 'aria-label': 'Supprimer', onclick: async () => { if (!(await confirmSheet('Supprimer ce webhook ?', 'Supprimer'))) return; await api(`/api/admin/webhooks/${hk.id}`, { method: 'DELETE' }); hooksTab(body); } }, icon('trash'))))) : h('p', { class: 'muted' }, 'Aucun webhook.'));
}

async function brandTab(body) {
  const d = await api('/api/admin/branding');
  const msg = h('textarea', { class: 'input', rows: 3, maxlength: 1000, placeholder: 'Ex. : Bienvenue chez nous ! Demandez le mot de passe à Sarah.' }, d.loginMessage);
  const css = h('textarea', { class: 'input mono', rows: 12, maxlength: 100000, spellcheck: false, placeholder: '/* Exemple */\n.card .shot { border-radius: 16px; }' }, d.customCss);
  const err = h('p', { class: 'error-text' });
  body.replaceChildren(h('form', { class: 'edit-form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/admin/branding', { method: 'PUT', body: { loginMessage: msg.value, customCss: css.value } }); toast('Enregistré : rechargez la page pour voir le CSS', { type: 'success', action: { label: 'Recharger', onClick: () => location.reload() } }); }
    catch (e2) { err.textContent = e2.message; }
  } },
  h('div', { class: 'field' }, h('label', {}, 'Message sur la page de connexion'), msg, h('small', {}, 'Visible par tous, avant la connexion : n’y mettez pas le mot de passe.')),
  h('div', { class: 'field' }, h('label', {}, 'CSS personnalisé'), css, h('small', {}, 'Appliqué à toutes les pages, sur tous les appareils. Videz le champ pour revenir à l’apparence d’origine.')),
  err, h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Enregistrer'))));
}

// Mise à jour : version installée, nouveautés disponibles sur GitHub, installation (ou commande à lancer sous Docker)
async function updateTab(body) {
  const u = await api('/api/admin/update');
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
  const cmd = h('code', { class: 'cmd' }, u.command);
  const copy = h('button', { class: 'btn btn-small f', onclick: async () => { try { await navigator.clipboard.writeText(u.command); toast('Commande copiée'); } catch { toast('Sélectionnez la commande et copiez-la', true); } } }, icon('copy'), 'Copier la commande');
  const status = u.error ? h('p', { class: 'error-text' }, u.error)
    : u.behind ? h('p', { class: 'upd-new' }, icon('spark'), ` ${u.behind}${u.more ? '+' : ''} nouveauté${u.behind > 1 ? 's' : ''} depuis votre version.`)
      : h('p', { class: 'upd-ok' }, icon('check'), ' Venus est à jour.');
  const doUpdate = h('button', { class: 'btn btn-play f', onclick: async () => {
    if (!(await confirmSheet('Installer la mise à jour maintenant ? Venus redémarre ensuite (quelques secondes), les lectures en cours sont coupées.', 'Mettre à jour'))) return;
    doUpdate.disabled = true; doUpdate.textContent = 'Mise à jour…';
    try {
      const r = await api('/api/admin/update', { method: 'POST' });
      if (r.ok) { toast(r.message, { type: 'success', duration: 8000 }); setTimeout(() => location.reload(), 9000); }
      else { toast(r.message, true); doUpdate.disabled = false; doUpdate.replaceChildren(icon('refresh'), 'Mettre à jour maintenant'); }
    } catch (e) { toast(e.message, true); doUpdate.disabled = false; doUpdate.replaceChildren(icon('refresh'), 'Mettre à jour maintenant'); }
  } }, icon('refresh'), 'Mettre à jour maintenant');
  const recheck = h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { recheck.disabled = true; try { await api('/api/admin/update?force=1'); } catch { /* */ } window.dispatchEvent(new HashChangeEvent('hashchange')); } }, icon('refresh'), 'Vérifier à nouveau');
  body.replaceChildren(
    h('section', { class: 'box upd-box' },
      h('h2', {}, 'Mise à jour de Venus'),
      h('p', {}, `Version installée : ${u.local ? `commit ${u.local}` : 'inconnue'}${u.remote ? ` · dernière publiée : ${u.remote}` : ''}.`),
      status,
      u.commits && u.commits.length ? h('ul', { class: 'upd-list' }, u.commits.slice(0, 15).map((c) => h('li', {}, h('b', {}, c.title), h('small', {}, ` ${fmtD(c.date)}`)))) : null,
      u.behind && u.canSelfUpdate ? h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, doUpdate, recheck)
        : u.behind ? h('div', { class: 'upd-docker' }, h('p', {}, 'Venus tourne sous Docker : la mise à jour se lance depuis la machine qui l’héberge (SSH ou terminal), avec cette commande :'), cmd, h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, copy, recheck))
          : h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, recheck)));
}
