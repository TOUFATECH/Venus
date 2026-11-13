// Heure du serveur. Les horaires des profils enfants, le temps d'écran du jour, les tâches de nuit (compression,
// copies optimisées, sauvegardes), « Aujourd'hui / Demain » et les statistiques suivent l'heure locale du serveur.
// Sous Docker, elle vaut par défaut « Europe/Paris » (docker-compose.yml), ce qui décale tout de deux heures à
// Mayotte ou aux Antilles : le fuseau se règle donc dans Venus (Réglages → Serveur) et, tant que personne ne l'a
// choisi, il est repris de l'appareil de l'administrateur quand celui-ci se connecte depuis la maison.
import { getSetting, setSetting } from './db.js';

// Fuseau donné par la machine ou le conteneur (variable TZ, /etc/localtime), avant tout réglage dans Venus
export const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Fuseau horaire valide (ex. Indian/Mayotte) ?
export function validZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return true; } catch { return false; }
}
// Fuseau horaire utilisé en ce moment
export const serverZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
// Décalage par rapport à UTC, en minutes (Mayotte : 180), à un instant donné pour un fuseau donné
export function zoneOffset(tz, t = Date.now()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(t / 1000) * 1000) / 60000);
  } catch { return 0; }
}

// Fuseau choisi dans Venus : appliqué tout de suite (Node relit TZ à chaud) et à chaque démarrage
export const chosenZone = () => { const z = getSetting('timezone', ''); return validZone(z) ? z : ''; };
// Change le fuseau horaire du serveur (vide = celui du système)
export function setZone(tz) {
  if (tz === '' || tz == null) { setSetting('timezone', ''); process.env.TZ = systemZone; return serverZone(); }
  if (!validZone(tz)) throw Object.assign(new Error('Fuseau horaire inconnu'), { status: 400 });
  setSetting('timezone', tz);
  process.env.TZ = tz;
  return serverZone();
}
{
  const z = chosenZone();
  if (z && z !== systemZone) { process.env.TZ = z; console.log(`  ✓ Heure du serveur : ${z} (réglage de Venus ; la machine annonce ${systemZone})`); }
}

// Jour local « AAAA-MM-JJ » (et non le jour UTC : à Mayotte, entre minuit et 3 h, ce n'est pas le même)
const pad = (n) => String(n).padStart(2, '0');
// Jour local (AAAA-MM-JJ) d'une date
export function localDay(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Jour local décalé de n jours (changements d'heure compris)
export function localDayPlus(n, t = Date.now()) {
  const d = new Date(t);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return localDay(d.getTime());
}
// Informations d'heure pour les réglages
export const clockInfo = () => ({ zone: serverZone(), system: systemZone, chosen: !!chosenZone(), offset: -new Date().getTimezoneOffset(), now: Date.now() });
