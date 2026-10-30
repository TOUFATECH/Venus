// Audit de sécurité automatique : au démarrage puis chaque semaine (et à la demande dans le tableau de bord).
// Chaque point est noté ok / à améliorer / à corriger, avec la marche à suivre. Une alerte est envoyée à
// l'administrateur quand un nouveau point « à corriger » apparaît.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { httpsMode, logSecurity } from './security.js';
import { twofaOn } from './twofa.js';
import { smtpOn } from './smtp.js';
import { listBackups } from './backup.js';

const pkg = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); } catch { return {}; } })();

export async function runSecurityAudit() {
  const items = [];
  const add = (level, title, detail, fix = '') => items.push({ level, title, detail, fix });

  // Mot de passe du foyer
  const pw = getSetting('household_password', '');
  if (getSetting('password_weak', false)) add('bad', 'Mot de passe du foyer faible', 'Il est trop court ou trop courant.', 'Réglages → Serveur : choisissez au moins 10 caractères en mélangeant lettres et chiffres.');
  else add('ok', 'Mot de passe du foyer', 'Chiffré avec scrypt (sel unique, résistant aux cartes graphiques).');
  if (pw && !String(pw).startsWith('s2$')) add('warn', 'Ancien chiffrement du mot de passe', 'Il sera renforcé automatiquement à la prochaine connexion.');

  // Administrateurs
  const admins = all('SELECT name, pin_hash FROM profiles WHERE is_admin = 1');
  const noPin = admins.filter((a) => !a.pin_hash).map((a) => a.name);
  if (noPin.length) add('bad', 'Administrateur sans code PIN', `${noPin.join(', ')} : n’importe qui sur un appareil connecté peut ouvrir ce profil et tout modifier.`, 'Réglages → Profils : ajoutez un code PIN.');
  else add('ok', 'Profils administrateurs protégés', 'Chaque administrateur a un code PIN.');
  if (admins.length > 3) add('warn', 'Beaucoup d’administrateurs', `${admins.length} profils ont tous les droits.`, 'Gardez les droits d’administrateur pour une ou deux personnes.');

  // Double authentification
  if (twofaOn()) add('ok', 'Double authentification', 'Un code par e-mail est demandé à chaque nouvel appareil.');
  else if (process.env.VENUS_DISABLE_2FA === '1') add('bad', 'Double authentification coupée', 'La variable VENUS_DISABLE_2FA=1 est active (secours).', 'Retirez-la une fois l’accès rétabli.');
  else add('warn', 'Double authentification désactivée', smtpOn() ? 'Le serveur d’e-mails est prêt : il reste à l’activer.' : 'Le mot de passe du foyer suffit pour connecter un nouvel appareil.', 'Tableau de bord → Sécurité : configurez l’envoi d’e-mails puis activez-la.');

  // HTTPS
  const mode = httpsMode();
  const pub = String(getSetting('public_url', '') || '');
  if (mode === 'off') add('warn', 'HTTPS non imposé', 'Les connexions depuis Internet peuvent passer en clair.', 'Tableau de bord → Sécurité : « HTTPS obligatoire hors du réseau local ».');
  else add('ok', 'HTTPS', mode === 'all' ? 'Obligatoire partout.' : 'Obligatoire hors du réseau local.');
  if (pub.startsWith('http://')) add('bad', 'Adresse publique en http://', `${pub} : mots de passe et vidéos circulent en clair sur Internet.`, 'Utilisez une adresse https:// (Caddy ou certificat Let’s Encrypt).');

  // Logiciels
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) add('bad', 'Node.js trop ancien', `Version ${process.versions.node}.`, 'Mettez à jour Node.js (22.13 ou plus récent).');
  else add('ok', 'Node.js à jour', `Version ${process.versions.node}.`);
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  add('ok', 'Dépendances', deps.length ? `${deps.length} dépendance(s) : lancez « npm audit » régulièrement.` : 'Aucune dépendance externe : rien à corriger avec « npm audit ».');

  // Secrets et fichiers
  try {
    const st = fs.statSync(path.join(config.dataDir, 'secret.key'));
    if (process.platform !== 'win32' && (st.mode & 0o077)) add('warn', 'Clé de chiffrement lisible par d’autres', 'secret.key devrait n’être lisible que par Venus.', `chmod 600 ${path.join(config.dataDir, 'secret.key')}`);
    else add('ok', 'Clés d’API chiffrées', 'Les clés et mots de passe des services sont chiffrés dans la base (AES-256-GCM).');
  } catch { add('ok', 'Clés d’API chiffrées', process.env.VENUS_SECRET ? 'Clé fournie par VENUS_SECRET.' : 'Aucun secret enregistré pour l’instant.'); }
  try {
    const st = fs.statSync(path.join(config.dataDir, 'venus.db'));
    if (process.platform !== 'win32' && (st.mode & 0o004)) add('warn', 'Base de données lisible par tous', 'D’autres comptes de la machine peuvent la lire.', `chmod 600 ${path.join(config.dataDir, 'venus.db')}*`);
  } catch { /* */ }

  // Sauvegardes
  const backups = listBackups();
  const last = backups[0];
  if (String(getSetting('auto_backup', '1')) === '0') add('warn', 'Sauvegardes automatiques désactivées', 'En cas de panne, profils, vus et réglages seraient perdus.', 'Réglages → Sauvegardes.');
  else if (!last || Date.now() - last.at > 3 * 864e5) add('warn', 'Pas de sauvegarde récente', last ? `Dernière sauvegarde : ${new Date(last.at).toLocaleDateString('fr-FR')}.` : 'Aucune sauvegarde.', 'Réglages → Sauvegardes → Sauvegarder maintenant.');
  else add('ok', 'Sauvegardes', `Dernière : ${new Date(last.at).toLocaleString('fr-FR')} (${backups.length} gardées).`);

  // Sessions et activité suspecte
  const old = get('SELECT COUNT(*) AS n FROM tokens WHERE last_seen < ?', Date.now() - 30 * 864e5).n;
  if (old) add('warn', 'Appareils inactifs', `${old} appareil(s) connecté(s) mais inutilisé(s) depuis plus de 30 jours.`, 'Tableau de bord → Sécurité : déconnectez-les.');
  const week = Date.now() - 7 * 864e5;
  const bans = get('SELECT COUNT(*) AS n FROM security_log WHERE kind = ? AND at > ?', 'ban', week).n;
  const brute = get("SELECT COUNT(*) AS n FROM security_log WHERE kind LIKE 'force-brute%' AND at > ?", week).n;
  if (bans || brute) add('warn', 'Tentatives d’intrusion cette semaine', `${brute} blocage(s) après des essais de mot de passe, ${bans} adresse(s) bannie(s).`, 'Consultez le journal de sécurité ; si cela vient d’Internet, vérifiez la redirection de port de votre box.');
  else add('ok', 'Aucune tentative d’intrusion cette semaine', 'Rien de suspect dans le journal.');

  const score = Math.round((items.filter((i) => i.level === 'ok').length / items.length) * 100);
  const report = { at: Date.now(), score, items };
  const prev = getSetting('security_audit', null);
  setSetting('security_audit', report);
  // Alerte pour chaque nouveau point à corriger
  const prevBad = new Set((prev ? prev.items : []).filter((i) => i.level === 'bad').map((i) => i.title));
  const fresh = items.filter((i) => i.level === 'bad' && !prevBad.has(i.title));
  if (fresh.length) logSecurity('audit', '', `Audit de sécurité : ${fresh.map((i) => i.title).join(' ; ')}`, 'high');
  return report;
}

export const lastAudit = () => getSetting('security_audit', null);

export function startSecurityAudit() {
  setTimeout(() => runSecurityAudit().catch((e) => console.warn('[audit]', e.message)), 30000).unref();
  setInterval(() => runSecurityAudit().catch(() => {}), 7 * 864e5).unref();
}
