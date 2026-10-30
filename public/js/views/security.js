// Sécurité (administrateur) : audit, double authentification par e-mail, HTTPS, adresses bloquées,
// appareils connectés et journal des évènements de sécurité.
import { api } from '../api.js';
import { h, icon, toast, confirmSheet } from '../ui.js';
import { state, go } from '../app.js';

const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('small', {}, hint) : null);
const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const LEVEL = { ok: ['ok', 'OK'], warn: ['warn', 'À améliorer'], bad: ['bad', 'À corriger'] };
const SEV = { info: 'Info', warn: 'Attention', high: 'Alerte' };
const KIND = {
  connexion: 'Connexion', 'echec-login': 'Mot de passe faux', 'echec-code': 'Code faux', 'echec-pin': 'PIN faux', 'echec-2fa': 'Code e-mail faux', 'echec-join': 'Code de séance faux',
  'force-brute': 'Force brute', 'force-brute-repartie': 'Force brute répartie', ban: 'Adresse bloquée', deblocage: 'Adresse débloquée', suspect: 'Requête suspecte',
  cors: 'Autre origine', '2fa-envoye': 'Code envoyé', '2fa-echec': 'Code e-mail faux', '2fa-limite': 'Limite e-mails', '2fa-envoi': 'E-mail non envoyé', '2fa-ip': 'Code autre appareil', '2fa': 'Double authentification',
  'mot-de-passe': 'Mot de passe', droits: 'Droits', profil: 'Profil', pin: 'Code PIN', 'envoi-refuse': 'Fichier refusé', envoi: 'Fichier envoyé', audit: 'Audit', https: 'HTTPS',
  deconnexion: 'Déconnexion', journal: 'Journal', installation: 'Installation', 'erreur-serveur': 'Erreur serveur',
};

export async function render(main) {
  if (!state.profile.isAdmin) { main.append(h('div', { class: 'empty' }, h('h2', {}, 'Réservé à l’administrateur'))); return; }
  const page = h('div', { class: 'page security' });
  main.append(page);
  let d;
  const load = async () => { d = await api('/api/admin/security'); paint(); };

  function auditBox() {
    const a = d.audit;
    const runBtn = h('button', { class: 'btn btn-small f', onclick: async () => {
      runBtn.disabled = true;
      try { d.audit = await api('/api/admin/security/audit', { method: 'POST' }); paint(); toast('Audit terminé', { type: 'success' }); } catch (e) { toast(e.message, true); runBtn.disabled = false; }
    } }, icon('refresh'), 'Relancer l’audit');
    return h('section', { class: 'box sec-audit' },
      h('div', { class: 'sec-head' }, h('div', {}, h('h2', {}, 'Audit de sécurité'), h('p', { class: 'muted' }, a ? `Fait le ${when(a.at)} — automatique chaque semaine` : 'Pas encore fait')), runBtn),
      a ? h('div', { class: 'sec-score', style: { '--p': `${a.score}%` } }, h('b', {}, `${a.score} %`), h('span', {}, 'des points sont au vert')) : null,
      a ? h('ul', { class: 'sec-items' }, a.items.sort((x, y) => ['bad', 'warn', 'ok'].indexOf(x.level) - ['bad', 'warn', 'ok'].indexOf(y.level)).map((i) => h('li', { class: `lv-${i.level}` },
        h('span', { class: 'sec-dot' }), h('div', {}, h('b', {}, i.title, h('em', {}, LEVEL[i.level][1])), h('p', {}, i.detail), i.fix ? h('small', {}, i.fix) : null)))) : null);
  }

  function twofaBox() {
    const sm = d.smtp;
    const host = h('input', { class: 'input', value: sm.host, placeholder: 'smtp.gmail.com', maxlength: 200, pattern: '[\\w.-]+', autocomplete: 'off' });
    const port = h('input', { class: 'input', type: 'number', min: 1, max: 65535, value: sm.port || 587 });
    const secure = h('select', { class: 'input' }, [['auto', 'Automatique'], ['starttls', 'STARTTLS (587)'], ['tls', 'TLS (465)'], ['none', 'Aucun (déconseillé)']].map(([v, l]) => h('option', { value: v, selected: sm.secure === v }, l)));
    const user = h('input', { class: 'input', value: sm.user, maxlength: 200, autocomplete: 'off', placeholder: 'Identifiant (souvent l’adresse e-mail)' });
    const pass = h('input', { class: 'input', type: 'password', maxlength: 300, autocomplete: 'new-password', placeholder: sm.passSet ? 'Enregistré (laisser vide pour conserver)' : 'Mot de passe d’application' });
    const from = h('input', { class: 'input', type: 'email', value: sm.from, maxlength: 254, placeholder: 'venus@exemple.fr' });
    const to = h('input', { class: 'input', type: 'email', value: d.twofa.email, maxlength: 254, placeholder: 'vous@exemple.fr' });
    const err = h('p', { class: 'error-text' });
    const save = async () => {
      err.textContent = '';
      const emailRe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
      if (host.value && !/^[\w.-]+$/.test(host.value.trim())) { err.textContent = 'Serveur d’e-mails : nom invalide'; return false; }
      if (from.value && !emailRe.test(from.value.trim())) { err.textContent = 'Expéditeur : adresse e-mail invalide'; return false; }
      if (to.value && !emailRe.test(to.value.trim())) { err.textContent = 'Adresse de l’administrateur invalide'; return false; }
      const p = Number(port.value); if (!(p >= 1 && p <= 65535)) { err.textContent = 'Port entre 1 et 65535'; return false; }
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { smtpHost: host.value.trim(), smtpPort: p, smtpSecure: secure.value, smtpUser: user.value.trim(), ...(pass.value ? { smtpPass: pass.value } : {}), smtpFrom: from.value.trim(), twofaEmail: to.value.trim() } });
        return true;
      } catch (e) { err.textContent = e.message; return false; }
    };
    const testBtn = h('button', { class: 'btn btn-small f', onclick: async () => {
      testBtn.disabled = true;
      if (await save()) {
        try { const r = await api('/api/admin/security/test-email', { method: 'POST' }); toast(`E-mail de test envoyé à ${r.to}`, { type: 'success' }); await load(); }
        catch (e) { err.textContent = e.message; }
      }
      testBtn.disabled = false;
    } }, icon('send'), 'Enregistrer et envoyer un e-mail de test');
    const on = d.twofa.mode !== 'off';
    const toggle = h('input', { type: 'checkbox', class: 'f', checked: on, disabled: !on && !d.twofa.verified, onchange: async (e) => {
      if (!e.target.checked && !(await confirmSheet('Couper la double authentification ? Le mot de passe du foyer suffira de nouveau pour connecter un appareil.', 'Couper'))) { e.target.checked = true; return; }
      try { await api('/api/admin/settings', { method: 'PUT', body: { twofaMode: e.target.checked ? 'new_device' : 'off' } }); toast(e.target.checked ? 'Double authentification activée' : 'Double authentification désactivée', { type: 'success' }); load(); }
      catch (e2) { e.target.checked = !e.target.checked; toast(e2.message, true); }
    } });
    return h('section', { class: 'box' },
      h('h2', {}, 'Double authentification par e-mail'),
      h('p', {}, 'Quand un nouvel appareil se connecte avec le mot de passe du foyer, un code à 6 chiffres est envoyé à l’administrateur. Code valable 10 minutes, 5 essais par code ; au plus 10 e-mails et 15 codes faux par jour.'),
      d.twofa.disabledByEnv ? h('p', { class: 'error-text' }, 'Coupée par la variable VENUS_DISABLE_2FA=1 (secours).') : null,
      h('label', { class: 'switch' }, h('span', {}, on ? 'Activée : code demandé à chaque nouvel appareil' : d.twofa.verified ? 'Désactivée' : 'Désactivée (envoyez d’abord un e-mail de test)'), toggle),
      d.twofa.sentToday || d.twofa.failsToday ? h('p', { class: 'muted' }, `Aujourd’hui : ${d.twofa.sentToday} code(s) envoyé(s), ${d.twofa.failsToday} code(s) faux.`) : null,
      field('Adresse e-mail de l’administrateur', to, 'Les codes de connexion et les alertes y sont envoyés.'),
      h('h3', { class: 'sec-sub' }, 'Serveur d’envoi (SMTP)'),
      h('div', { class: 'two-cols' }, field('Serveur', host), field('Port', port)),
      field('Chiffrement', secure),
      field('Identifiant', user), field('Mot de passe', pass, 'Gmail, Outlook… : utilisez un « mot de passe d’application ». Il est chiffré dans la base.'),
      field('Expéditeur', from),
      err, h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, testBtn));
  }

  function httpsBox() {
    const mode = h('select', { class: 'input', onchange: async () => {
      try { await api('/api/admin/settings', { method: 'PUT', body: { forceHttps: mode.value } }); toast('Réglage enregistré', { type: 'success' }); load(); } catch (e) { toast(e.message, true); }
    } }, [['remote', 'Obligatoire hors du réseau local (conseillé)'], ['all', 'Obligatoire partout'], ['off', 'Jamais (déconseillé)']].map(([v, l]) => h('option', { value: v, selected: d.https.mode === v }, l)));
    const httpsUrl = d.https.port ? `https://${location.hostname || "localhost"}:${d.https.port}` : null;
    return h('section', { class: 'box' },
      h('h2', {}, 'HTTPS'),
      h('p', {}, d.https.secure ? 'Cette page est ouverte en HTTPS : la connexion est chiffrée.' : 'Cette page est ouverte en HTTP : sur le réseau de la maison c’est toléré, depuis Internet c’est refusé.'),
      field('HTTPS obligatoire', mode, mode.value === 'all' ? 'Les adresses http:// sont redirigées vers https://.' : 'Depuis Internet, seules les connexions chiffrées sont acceptées.'),
      httpsUrl ? h('p', { class: 'muted' }, 'Adresse sécurisée de ce serveur : ', h('a', { href: httpsUrl, style: { textDecoration: 'underline' } }, httpsUrl), '. Avec le certificat créé par Venus, le navigateur demande de l’accepter une fois. Pour une adresse publique, utilisez Caddy (certificat reconnu, voir le README).') : null);
  }

  function bansBox() {
    const ipIn = h('input', { class: 'input', placeholder: 'Adresse IP à bloquer', maxlength: 60, pattern: '[0-9a-fA-F.:]+' });
    return h('section', { class: 'box' },
      h('h2', {}, 'Adresses bloquées'),
      h('p', {}, 'Les adresses qui multiplient les essais de mot de passe ou cherchent des failles sont bloquées automatiquement : 1 h, puis 6 h, 24 h et 7 jours en cas de récidive.'),
      d.bans.length ? h('div', { class: 'sec-list' }, d.bans.map((b) => h('div', { class: 'sec-row' },
        h('div', { class: 'grow' }, h('b', {}, b.ip), h('small', {}, `${b.reason} · ${b.until ? `jusqu’au ${when(b.until)}` : 'définitivement'}`)),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { await api('/api/admin/security/unban', { method: 'POST', body: { ip: b.ip } }); toast(`${b.ip} débloquée`, { type: 'success' }); load(); } }, 'Débloquer'))))
        : h('p', { class: 'muted' }, 'Aucune adresse bloquée.'),
      d.attempts.length ? h('div', { class: 'sec-list' }, h('h3', { class: 'sec-sub' }, 'Essais ratés aujourd’hui'), d.attempts.map((x) => h('div', { class: 'sec-row' },
        h('div', { class: 'grow' }, h('b', {}, x.ip), h('small', {}, `${KIND[`echec-${x.kind.split(':')[0]}`] || x.kind} · ${x.failsToday} échec(s)${x.lockedUntil ? ` · en pause jusqu’à ${new Date(x.lockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`))))) : null,
      h('div', { class: 'sec-inline' }, ipIn, h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
        const ip = ipIn.value.trim();
        if (!/^[\da-f.:]+$/i.test(ip)) { toast('Adresse IP invalide', true); return; }
        try { await api('/api/admin/security/ban', { method: 'POST', body: { ip } }); toast(`${ip} bloquée`, { type: 'success' }); load(); } catch (e) { toast(e.message, true); }
      } }, 'Bloquer')));
  }

  let allDevices = false;
  function devicesBox() {
    const list = [...d.devices].sort((a, b) => (b.current - a.current) || (b.lastSeen - a.lastSeen));
    const shown = allDevices ? list : list.slice(0, 6);
    return h('section', { class: 'box' },
      h('h2', {}, 'Appareils connectés'),
      h('p', {}, 'Chaque appareil garde sa session 180 jours, ou 45 jours sans utilisation. Seule une empreinte des sessions est gardée sur le serveur.'),
      h('div', { class: 'sec-list' }, shown.map((x) => h('div', { class: 'sec-row' },
        h('div', { class: 'grow' }, h('b', {}, x.name, x.current ? h('em', { class: 'sec-me' }, 'cet appareil') : null), h('small', {}, `${x.profile || 'Aucun profil'} · utilisé le ${when(x.lastSeen)} · connecté le ${when(x.created)}`)),
        x.current ? null : h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => { await api(`/api/admin/devices/${x.id}`, { method: 'DELETE' }); toast('Appareil déconnecté', { type: 'success' }); load(); } }, 'Déconnecter')))),
      list.length > 6 ? h('button', { class: 'btn btn-ghost btn-small f sec-more', onclick: () => { allDevices = !allDevices; paint(); } }, allDevices ? 'Afficher moins' : `Voir les ${list.length - 6} autres appareils`) : null,
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
        if (!(await confirmSheet('Déconnecter tous les autres appareils ? Ils devront retaper le mot de passe du foyer.', 'Déconnecter'))) return;
        await api('/api/admin/security/logout-others', { method: 'POST' }); toast('Autres appareils déconnectés', { type: 'success' }); load();
      } }, icon('power'), 'Déconnecter tous les autres appareils')));
  }

  let sevFilter = 'all';
  function logBox() {
    const rows = d.log.filter((x) => sevFilter === 'all' || x.severity === sevFilter || (sevFilter === 'warn' && x.severity === 'high'));
    const chips = h('div', { class: 'seg' }, [['all', 'Tout'], ['warn', 'Attention et alertes'], ['high', 'Alertes']].map(([v, l]) => h('button', { class: `seg-b f${sevFilter === v ? ' on' : ''}`, onclick: () => { sevFilter = v; paint(); } }, l)));
    return h('section', { class: 'box sec-log' },
      h('div', { class: 'sec-head' }, h('h2', {}, 'Journal de sécurité'), chips),
      h('p', { class: 'muted' }, 'Connexions, essais ratés, requêtes suspectes, blocages et changements de droits. Les 5 000 derniers évènements sont gardés.'),
      rows.length ? h('div', { class: 'sec-table' }, rows.slice(0, 200).map((x) => h('div', { class: `sec-ev sv-${x.severity}` },
        h('span', { class: 'sec-when' }, when(x.at)), h('span', { class: 'sec-kind' }, KIND[x.kind] || x.kind), h('span', { class: 'sec-detail' }, x.detail), h('span', { class: 'sec-ip' }, x.ip || ''))))
        : h('p', { class: 'muted' }, 'Rien à signaler.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
        if (!(await confirmSheet('Vider le journal de sécurité ?', 'Vider'))) return;
        await api('/api/admin/security/log', { method: 'DELETE' }); load();
      } }, 'Vider le journal')));
  }

  function paint() {
    page.replaceChildren(
      h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Sécurité'),
        h('p', { class: 'count' }, d.adminsWithoutPin.length ? `⚠ ${d.adminsWithoutPin.join(', ')} : administrateur sans code PIN` : 'Protections actives')),
      h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go('/tableau-de-bord') }, icon('back'), 'Tableau de bord')),
      h('div', { class: 'sec-grid' }, auditBox(), twofaBox(), httpsBox(), bansBox(), devicesBox()),
      logBox());
  }
  await load();
}
