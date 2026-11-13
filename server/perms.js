// Droits par profil : bibliothèques visibles, téléchargement, lecture convertie,
// accès depuis l'extérieur et horaires autorisés. Les administrateurs ont toujours tous les droits.
import { isPrivateIp } from './security.js';

export const DEFAULT_PERMS = { libraries: null, download: true, transcode: true, remote: true, schedule: [], dailyMinutes: 0 };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Droits d'un profil, complétés par les droits par défaut
export function permsOf(p) {
  if (!p) return { ...DEFAULT_PERMS };
  if (p.is_admin) return { ...DEFAULT_PERMS, admin: true };
  let saved = {};
  try { saved = JSON.parse(p.perms || '{}') || {}; } catch { /* */ }
  return { ...DEFAULT_PERMS, ...saved };
}

// Heure « HH:MM » convertie en minutes
const minutes = (hm) => { const [hh, mm] = String(hm).split(':').map(Number); return hh * 60 + mm; };
// Créneau en cours ? Les créneaux qui passent minuit (22:00 → 01:00) sont acceptés.
export function inSchedule(schedule, d = new Date()) {
  if (!schedule || !schedule.length) return true;
  const now = d.getHours() * 60 + d.getMinutes(), day = d.getDay();
  return schedule.some((s) => {
    const from = minutes(s.from), to = minutes(s.to);
    if (from <= to) return s.days.includes(day) && now >= from && now < to;
    return (s.days.includes(day) && now >= from) || (s.days.includes((day + 6) % 7) && now < to);
  });
}
// Heure lisible (« 8 h 30 »)
const fmtHm = (hm) => hm.replace(/^0/, '').replace(':00', ' h').replace(':', ' h ');
// Horaires autorisés en texte lisible
export function scheduleText(schedule) {
  return schedule.map((s) => {
    const d = s.days.length === 7 ? 'tous les jours' : s.days.length === 5 && [1, 2, 3, 4, 5].every((x) => s.days.includes(x)) ? 'en semaine'
      : s.days.length === 2 && s.days.includes(0) && s.days.includes(6) ? 'le week-end' : s.days.map((x) => DAYS[x]).join(', ');
    return `${d} de ${fmtHm(s.from)} à ${fmtHm(s.to)}`;
  }).join(' ; ');
}

// Raison d'un refus d'accès pour ce profil (ou null)
export function accessProblem(p, ip) {
  const r = permsOf(p);
  if (r.admin) return null;
  if (!r.remote && ip && !isPrivateIp(ip)) return 'Ce profil n’est accessible qu’à la maison (réseau local)';
  if (!inSchedule(r.schedule)) return `Pas maintenant : ce profil peut utiliser Venus ${scheduleText(r.schedule)}`;
  return null;
}

// Filtre SQL des bibliothèques visibles
export function libraryClause(p, alias = 'i') {
  const r = permsOf(p);
  if (r.admin || !Array.isArray(r.libraries)) return { sql: '1=1', args: [] };
  if (!r.libraries.length) return { sql: '0', args: [] };
  return { sql: `${alias}.library_id IN (${r.libraries.map(() => '?').join(',')})`, args: r.libraries };
}

// Vérification des droits envoyés par l'interface
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Vérifie les droits envoyés par l'interface
export function validPerms(v) {
  const bad = (m) => { const e = new Error(`Droits : ${m}`); e.status = 400; throw e; };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('format invalide');
  const out = { libraries: null, download: true, transcode: true, remote: true, schedule: [], dailyMinutes: 0 };
  if (v.dailyMinutes != null) { if (!Number.isInteger(v.dailyMinutes) || v.dailyMinutes < 0 || v.dailyMinutes > 1440) bad('limite quotidienne invalide (minutes)'); out.dailyMinutes = v.dailyMinutes; }
  if (v.libraries != null) {
    if (!Array.isArray(v.libraries) || v.libraries.length > 200 || !v.libraries.every((x) => Number.isInteger(x) && x > 0)) bad('bibliothèques invalides');
    out.libraries = [...new Set(v.libraries)];
  }
  for (const k of ['download', 'transcode', 'remote']) { if (v[k] !== undefined && typeof v[k] !== 'boolean') bad(`${k} : vrai ou faux attendu`); if (v[k] !== undefined) out[k] = v[k]; }
  if (v.schedule != null) {
    if (!Array.isArray(v.schedule) || v.schedule.length > 7) bad('7 créneaux au plus');
    out.schedule = v.schedule.map((s) => {
      if (!s || !Array.isArray(s.days) || !s.days.length || !s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) bad('jours invalides');
      if (!HM.test(s.from) || !HM.test(s.to) || s.from === s.to) bad('heures invalides (HH:MM, début différent de la fin)');
      return { days: [...new Set(s.days)].sort(), from: s.from, to: s.to };
    });
  }
  return out;
}
