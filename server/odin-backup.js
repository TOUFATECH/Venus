// Venus synchronisé avec Odin à la seconde : sauvegarde continue de la base, et restauration (nouvelle installation,
// Réglages → Odin, ou « Restaurer » demandé depuis Odin).
//
// Ce qui part : toute la base PostgreSQL (profils et réglages de chaque utilisateur, « Ma liste », favoris, envies,
// historique de lecture et reprises, téléchargements et demandes, enregistrements, réglages du serveur…). Ce qui ne part
// pas : les fichiers vidéo, images et musiques (trop gros), les sessions des appareils, les caches que Venus refait seul
// (index des dialogues, guide TV) et les journaux.
//
// Comment (contrat d'Odin : docs/sso-protocole.md § 7, x-odin-sorte « complete » | « changements ») :
// - une sauvegarde COMPLÈTE de temps en temps (au lien, au démarrage si besoin, puis toutes les 30 minutes s'il y a eu des
//   changements, ou après 500 envois de changements) : c'est la « base » des changements qui suivent ;
// - chaque changement (profil, favori, « ma liste », reprise de lecture, téléchargement, réglage, utilisateur…) part
//   AUSSITÔT, regroupé au plus 1 seconde, en CHANGEMENTS : seulement les lignes ajoutées, modifiées ou effacées depuis
//   l'envoi précédent (Venus garde en mémoire l'empreinte de chaque ligne de ce qu'Odin a déjà) ;
// - chaque envoi passe d'abord par une FILE D'ATTENTE CHIFFRÉE sur le disque (AES-256-GCM, clé tirée de secret.key) :
//   Odin injoignable → les changements attendent, et partent dans l'ordre dès son retour (rattrapage) ;
// - toutes les 30 secondes, VÉRIFICATION À L'IDENTIQUE : l'empreinte de chaque table de la base est comparée à celle de
//   ce qu'Odin a (une écriture qui aurait échappé au suivi repart), et l'empreinte rendue par Odin à celle du dernier envoi.
// Restaurer = la sauvegarde complète, puis ses changements dans l'ordre jusqu'au point choisi (à la seconde près).
//
// Les secrets (clés d'API, mots de passe des sources, SMTP…) partent CHIFFRÉS : ils le sont déjà dans la base avec la
// clé de Venus (secret.key), qui, elle, ne part jamais en clair. Elle part emballée avec une clé tirée du mot de passe
// Odin de l'administrateur (scrypt + AES-256-GCM) : Odin ne peut pas la lire, et une restauration sur une nouvelle
// machine la retrouve avec ce même mot de passe. Sans lui (mot de passe changé depuis), tout revient sauf les secrets.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { db, get, getSetting, setSetting, onWrite, bumpItems, secretKeyId, secretKeyBytes, replaceSecretKey } from './db.js';
import { dumpBuffer, parseDump, load, writeDump, insertRows, resetSequences, tablesNow, colsOf } from './db-copy.js';
import { backupsDir } from './backup.js';
import { config } from './config.js';
import { authed, linked, odinMessage, APP, LINK_KEYS, setLinkState } from './odin-link.js';

// Tables laissées de côté : sessions des appareils, caches refaits par Venus, journaux
export const SKIP = ['tokens', 'dialogue_index', 'dialogues', 'epg', 'security_log', 'transcode_log', 'ip_bans'];
// Parmi elles, gardées telles quelles à la restauration (les caches, eux, sont refaits)
const PRESERVE = ['tokens', 'security_log', 'transcode_log', 'ip_bans'];
// Réglages qui bougent tout seuls (dates de dernière tâche, états) : ni changement à envoyer, ni dans l'empreinte
export const VOLATILE = /^(last_|odin_sso_|odin_sauvegarde|odin_cle_|tasks_state|epg_last|iptv_check_at|new_eps_checked|tg_arrivals_at|nas_health|security_audit|disk_warned|nas_warned|broken_notified|update_notified|smtp_verified|changelog_seen)/;
// Tables remplies par Venus lui-même (analyse des bibliothèques, métadonnées) : leurs changements partent avec le
// prochain envoi, au plus tard 10 s après (pas besoin de la seconde, et une analyse en écrit beaucoup)
export const SLOW = new Set(['items', 'music_albums', 'music_artists', 'music_fingerprints', 'book_meta', 'book_authors', 'person_photos', 'scenes', 'segments', 'file_checks', 'size_history', 'optimized', 'conversions', 'media_log', 'tg_posts']);
const ST = 'odin_sauvegarde'; // état (réglage « volatil ») : voir state()

// Réglables pour les essais (millisecondes)
const ms = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const T = {
  calme: ms('VENUS_ODIN_LOT_MS', 150),            // regroupement : envoi 150 ms après le dernier changement…
  lot: ms('VENUS_ODIN_LOT_MAX_MS', 1000),         // … et jamais plus d'1 s après le premier
  lent: ms('VENUS_ODIN_LENT_MS', 10_000),         // tables remplies par Venus lui-même
  verif: ms('VENUS_ODIN_CHECK_MS', 30_000),       // vérification à l'identique
  complete: ms('VENUS_ODIN_COMPLETE_MS', 30 * 60_000), // sauvegarde complète régulière (s'il y a eu des changements)
  lots: ms('VENUS_ODIN_COMPLETE_LOTS', 500),      // … ou après autant d'envois de changements
  octets: 16 * 1024 * 1024,                       // … ou autant d'octets de changements
  reessai: 30_000,                                // attente maximale entre deux essais quand Odin ne répond pas
};

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const raw = (sql, params = []) => db.pg.rowsOf(db.pg.call({ op: 'query', sql, params }));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const note = (m) => { if (process.env.VENUS_ODIN_JOURNAL !== '0') console.log(`[odin] ${m}`); };
/**
 * État de la synchronisation (affiché dans Réglages → Odin) :
 * { base (id de la complète sur laquelle partent les changements), dernier (id du dernier envoi reçu par Odin), sha (son
 *   SHA-256), empreinte (empreinte de la base qu'Odin peut reconstruire), at, taille, envois, changements, complete: {at,
 *   id, taille}, depuisComplete, octetsDepuis, attente (en file), horsLigne, delai (ms entre le changement et sa réception
 *   par Odin), verifie, identique, autrePoste, erreur, restaure }
 */
export const state = () => getSetting(ST, null) || {};
const setState = (patch) => setSetting(ST, { ...state(), ...patch });

// ---------------------------------------------------------------- empreintes (calculées par PostgreSQL)
const VOL_SQL = `x.key ~ '${VOLATILE.source.replace(/'/g, "''")}'`;
const where = (t, more = '') => { const w = [t === 'settings' ? `NOT (${VOL_SQL})` : '', more].filter(Boolean); return w.length ? `WHERE ${w.join(' AND ')}` : ''; };
const tables = () => tablesNow().filter((t) => !SKIP.includes(t));
/** Empreinte d'une table : nombre de lignes et empreinte de leurs empreintes, dans un ordre fixe. */
function sumOf(t) {
  const r = raw(`SELECT count(*) AS n, md5(COALESCE(string_agg(s.h, '' ORDER BY s.h), '')) AS h FROM (SELECT md5(x::text) AS h FROM ${quote(t)} x ${where(t)}) s`)[0];
  return `${r.n}:${r.h}`;
}
const sums = (only) => Object.fromEntries(tables().filter((t) => !only || only(t)).map((t) => [t, sumOf(t)]));
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fpOf = (s) => { const h = crypto.createHash('sha256'); for (const t of Object.keys(s).sort(byName)) h.update(`${t}:${s[t]}\n`); return h.digest('hex'); };
/** Empreinte de la base (ce qui part sur Odin). Deux bases identiques → même empreinte. */
export function fingerprint() { return fpOf(sums()); }

// Clés primaires (une ligne = sa clé) : relues quand une table nouvelle apparaît
let pks = null;
function pkOf(t) {
  if (!pks || !pks.has(t)) {
    pks = new Map();
    for (const r of raw("SELECT tc.table_name AS t, k.column_name AS c FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema WHERE tc.table_schema = current_schema() AND tc.constraint_type = 'PRIMARY KEY' ORDER BY tc.table_name, k.ordinal_position")) {
      if (!pks.has(r.t)) pks.set(r.t, []);
      pks.get(r.t).push(r.c);
    }
    if (!pks.has(t)) pks.set(t, []);
  }
  return pks.get(t);
}
const enc = (v) => (Buffer.isBuffer(v) ? { b64: v.toString('base64') } : v === undefined ? null : v);
const keyOf = (pk, r) => JSON.stringify(pk.map((c) => enc(r[c])));
/** Empreinte de chaque ligne d'une table (par sa clé primaire). */
function rowMap(t, pk) {
  const m = new Map();
  for (const r of raw(`SELECT ${pk.map((c) => `x.${quote(c)}`).join(', ')}, md5(x::text) AS "__h" FROM ${quote(t)} x ${where(t)}`)) m.set(keyOf(pk, r), r.__h);
  return m;
}

// ---------------------------------------------------------------- l'ombre : ce qu'Odin peut reconstruire, ligne par ligne
// { base, tables: Map(t → { sum, pk, rows: Map(clé → md5) | null }) } — null : pas encore de complète reçue par Odin
let ombre = null;
function shadowOf(s) {
  const m = new Map();
  for (const [t, sum] of Object.entries(s)) { const pk = pkOf(t); m.set(t, { sum, pk, rows: pk.length ? rowMap(t, pk) : null }); }
  return m;
}
const ombreFp = () => fpOf(Object.fromEntries([...ombre.tables].map(([t, x]) => [t, x.sum])));

/** Les lignes de `t` dont l'empreinte est dans `hashes` (par paquets). */
function rowsByHash(t, cols, hashes) {
  const out = [];
  for (let i = 0; i < hashes.length; i += 500) {
    const part = hashes.slice(i, i + 500);
    const rs = raw(`SELECT ${cols.map((c) => `x.${quote(c)}`).join(', ')} FROM ${quote(t)} x ${where(t, `md5(x::text) IN (${part.map((_, j) => `$${j + 1}`).join(', ')})`)}`, part);
    for (const r of rs) out.push(cols.map((c) => enc(r[c])));
  }
  return out;
}
/**
 * Ce qui a changé dans ces tables depuis l'ombre (l'ombre avance d'autant) : { t: { cols, pk, put: [lignes], del: [clés] } },
 * ou { t: { cols, replace: [lignes] } } pour une table sans clé primaire ou nouvelle. Synchrone : la base ne bouge pas
 * pendant le calcul (Venus attend chaque réponse de PostgreSQL).
 */
function diff(list) {
  const out = {};
  const have = new Set(tablesNow());
  for (const t of list) {
    if (SKIP.includes(t)) continue;
    const old = ombre.tables.get(t);
    if (!have.has(t)) { if (old) { out[t] = { cols: [], replace: [] }; ombre.tables.delete(t); } continue; }
    const sum = sumOf(t);
    if (old && old.sum === sum) continue;
    const cols = colsOf(t).map((c) => c.c), pk = pkOf(t);
    if (!old || !pk.length || !old.rows) {
      out[t] = { cols, replace: raw(`SELECT ${cols.map((c) => `x.${quote(c)}`).join(', ')} FROM ${quote(t)} x ${where(t)}`).map((r) => cols.map((c) => enc(r[c]))) };
      ombre.tables.set(t, { sum, pk, rows: pk.length ? rowMap(t, pk) : null });
      continue;
    }
    const cur = rowMap(t, pk);
    const changed = [], del = [];
    for (const [k, h] of cur) if (old.rows.get(k) !== h) changed.push(h);
    for (const k of old.rows.keys()) if (!cur.has(k)) del.push(JSON.parse(k));
    out[t] = { cols, pk, put: rowsByHash(t, cols, changed), del };
    ombre.tables.set(t, { sum, pk, rows: cur });
  }
  return out;
}

// Pourquoi (en-tête x-odin-raison, ≤ 120 caractères)
const WHY = { profiles: 'utilisateur', mylist: 'ma liste', wishlist: 'favori', opinions: 'favori', progress: 'reprise de lecture', watch_time: 'reprise de lecture', folk_torrents: 'téléchargement', media_wants: 'téléchargement', wanted: 'téléchargement', settings: 'réglage', track_prefs: 'réglage', playlists: 'liste de lecture', playlist_items: 'liste de lecture', recordings: 'enregistrement', record_rules: 'enregistrement', items: 'bibliothèque', libraries: 'bibliothèque' };
function raisonOf(ch) {
  const w = [];
  for (const [t, c] of Object.entries(ch)) {
    let r = WHY[t] || 'changement';
    if (t === 'profiles' && c.put && c.put.length && !c.del.length) r = 'utilisateur';
    if (t === 'folk_torrents' && c.put && c.put.some((x) => x.some((v) => { const m = typeof v === 'string' && /"doneAt":(\d+)/.exec(v); return m && Date.now() - Number(m[1]) < 120_000; }))) r = 'téléchargement terminé';
    if (!w.includes(r)) w.push(r);
  }
  return w.join(', ').slice(0, 120) || 'changement';
}

// ---------------------------------------------------------------- la clé des secrets, emballée avec le mot de passe Odin
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function wrapKey(password, email) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const k = crypto.scryptSync(String(password).normalize('NFC'), Buffer.concat([salt, Buffer.from(String(email || '').toLowerCase())]), 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(secretKeyBytes()), c.final()]);
  return { v: 1, kid: secretKeyId(), email: String(email || '').toLowerCase(), salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function unwrapKey(w, password) {
  if (!w || w.v !== 1) return null;
  try {
    const k = crypto.scryptSync(String(password).normalize('NFC'), Buffer.concat([Buffer.from(w.salt, 'base64'), Buffer.from(w.email || '')]), 32, SCRYPT);
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(w.iv, 'base64'));
    d.setAuthTag(Buffer.from(w.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(w.data, 'base64')), d.final()]);
  } catch { return null; }
}
/** Appelé au moment où l'administrateur relie Venus (seul moment où Venus a le mot de passe, sans le garder). */
export function rememberKeyWrap(password, email) { setSetting('odin_cle_sauvegarde', wrapKey(password, email)); }

// ---------------------------------------------------------------- la file d'attente chiffrée (disque)
// Un fichier par envoi de changements, dans l'ordre : « VOQ1 » + iv (12) + étiquette (16) + chiffré de
// [longueur de l'en-tête (4)] [en-tête JSON] [archive]. Clé : HKDF(secret.key). Rien en clair sur le disque.
const QMAGIC = Buffer.from('VOQ1');
const qdir = () => path.join(config.dataDir, 'odin-attente');
const qkey = () => Buffer.from(crypto.hkdfSync('sha256', secretKeyBytes(), Buffer.from('venus'), Buffer.from('odin-file-attente-v1'), 32));
export function queueFiles() { try { return fs.readdirSync(qdir()).filter((f) => /^\d{12}\.voq$/.test(f)).sort(); } catch { return []; } }
function qput(meta, body) {
  fs.mkdirSync(qdir(), { recursive: true, mode: 0o700 });
  const head = Buffer.from(JSON.stringify(meta)), len = Buffer.alloc(4); len.writeUInt32BE(head.length);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', qkey(), iv);
  const data = Buffer.concat([c.update(Buffer.concat([len, head, body])), c.final()]);
  const f = path.join(qdir(), `${String(meta.seq).padStart(12, '0')}.voq`);
  fs.writeFileSync(`${f}.part`, Buffer.concat([QMAGIC, iv, c.getAuthTag(), data]), { mode: 0o600 });
  fs.renameSync(`${f}.part`, f);
}
function qread(name) {
  try {
    const b = fs.readFileSync(path.join(qdir(), name));
    if (!b.subarray(0, 4).equals(QMAGIC)) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', qkey(), b.subarray(4, 16)); d.setAuthTag(b.subarray(16, 32));
    const p = Buffer.concat([d.update(b.subarray(32)), d.final()]), n = p.readUInt32BE(0);
    return { meta: JSON.parse(p.subarray(4, 4 + n).toString('utf8')), body: p.subarray(4 + n) };
  } catch { return null; } // clé des secrets changée (restauration) : illisible, laissé de côté
}
const qdel = (name) => fs.rmSync(path.join(qdir(), name), { force: true });
const qclear = () => { for (const f of queueFiles()) qdel(f); };

// ---------------------------------------------------------------- envoi des changements (à la seconde)
let dirty = new Set(), tCalme = null, tLot = null, tLent = null, tRetry = null, retryWait = 0;
let completeEnCours = false, needFull = false, fullWhy = '', flushing = null, flushAgain = false;

/** Construit les changements des tables touchées et les range dans la file. Rend le nombre de tables envoyées. */
function lot() {
  for (const t of [tCalme, tLot, tLent]) clearTimeout(t);
  tCalme = tLot = tLent = null;
  if (!linked() || !dirty.size) return 0;
  if (completeEnCours) return 0; // repris juste après la complète (qui, elle, a la base de ce moment)
  if (!ombre) { needFull = true; kickFull(); return 0; }
  const list = [...dirty]; dirty = new Set();
  let ch;
  try { ch = diff(list); } catch (e) { for (const t of list) dirty.add(t); setState({ erreur: `Changements non calculés : ${e.message}` }); return 0; }
  if (!Object.keys(ch).length) return 0;
  const st = state(), seq = (Number(st.seq) || 0) + 1, at = Date.now(), empreinte = ombreFp();
  const body = zlib.gzipSync(JSON.stringify({ format: 'venus-pg-changements', version: 1, app: APP, base: ombre.base, seq, at, empreinte, serveur: getSetting('server_name', 'Venus'), venus: config.version, tables: ch }));
  qput({ seq, at, base: ombre.base, empreinte, raison: raisonOf(ch), sha: sha256(body), taille: body.length }, body);
  if (process.env.VENUS_ODIN_JOURNAL === '2') note(`changements ${seq} : ${Object.entries(ch).map(([t, c]) => `${t} ${(c.put || c.replace || []).length} ligne(s)${c.del && c.del.length ? `, ${c.del.length} effacée(s)` : ''}`).join(' · ')}`);
  setState({ seq, local: at, etat: empreinte, attente: queueFiles().length });
  flush().catch(() => {});
  return Object.keys(ch).length;
}
function plan(t) {
  if (SLOW.has(t)) { if (!tLent && !tLot) { tLent = setTimeout(lot, T.lent); tLent.unref?.(); } return; }
  clearTimeout(tCalme);
  if (!tLot) { tLot = setTimeout(lot, T.lot); tLot.unref?.(); }
  tCalme = setTimeout(lot, T.calme); tCalme.unref?.();
}
const TABLE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+"?(\w+)/i;
/** Écoute de chaque écriture de Venus (db.js) : la table touchée part au prochain envoi. */
export function noteWrite(sql, params) {
  const m = TABLE.exec(sql);
  if (!m) return;
  const t = m[1].toLowerCase();
  if (SKIP.includes(t)) return;
  if (t === 'settings') { const k = String(params && params[0]); if (VOLATILE.test(k) || k.startsWith('odin_')) return; }
  dirty.add(t);
  if (linked()) plan(t);
}

const offline = (e) => !e.status && e.code !== 'ODIN_PIN';
function retry() {
  if (tRetry) return;
  retryWait = Math.min(T.reessai, retryWait ? retryWait * 2 : 1000);
  tRetry = setTimeout(() => { tRetry = null; (needFull ? sendNow({ force: true, why: 'rattrapage' }) : flush()).catch(() => {}); }, retryWait);
  tRetry.unref?.();
}
function horsLigne(e) {
  const n = queueFiles().length;
  if (!state().horsLigne) note(`Odin injoignable (${e.message}) : les changements attendent, chiffrés`);
  setState({ horsLigne: true, attente: n, erreur: `${e.message}${n ? ` ${n} envoi${n > 1 ? 's' : ''} en attente, chiffré${n > 1 ? 's' : ''} sur ce serveur : ils partiront dès qu’Odin répondra.` : ''}` });
  retry();
}
/** Vide la file dans l'ordre (rattrapage après une coupure). */
export function flush() {
  if (flushing) { flushAgain = true; return flushing; }
  flushing = (async () => {
    try { do { flushAgain = false; await flushOnce(); } while (flushAgain); }
    finally { flushing = null; }
  })();
  return flushing;
}
async function flushOnce() {
  if (!linked()) return;
  for (const f of queueFiles()) {
    if (completeEnCours) return; // la complète en cours contient déjà tout
    const e = qread(f);
    if (!e || e.meta.base !== state().base) { note(`envoi ${f} laissé : ${e ? 'ancienne base' : 'illisible'}`); qdel(f); continue; } // la complète suivante le contient
    let r;
    try {
      r = await authed(`/api/sauvegardes/${APP}`, { method: 'POST', body: e.body, timeout: 20000, headers: {
        'content-type': 'application/octet-stream', 'x-odin-empreinte': e.meta.sha, 'x-odin-sorte': 'changements', 'x-odin-base': e.meta.base,
        'x-odin-raison': encodeURIComponent(e.meta.raison || 'changement'), 'x-odin-nom': encodeURIComponent(`venus-changements-${e.meta.seq}.json.gz`),
      } });
    } catch (err) { if (offline(err)) return horsLigne(err); setState({ erreur: err.message }); return; }
    const j = r.json() || {};
    if (r.status === 400 && j.code === 'requete_invalide') {
      // Odin ne connaît plus la base de ces changements : une complète repart (elle contient tout)
      note(`Odin refuse les changements (${j.message || j.code}) : une sauvegarde complète repart`);
      qclear(); needFull = true; kickFull(); return;
    }
    if (r.status === 400 && j.code === 'empreinte_fausse') continue; // renvoyé au prochain passage
    if (r.status >= 400) { setState({ erreur: odinMessage(r, `Odin refuse les changements (${r.status})`), attente: queueFiles().length }); retry(); return; }
    qdel(f);
    retryWait = 0;
    if (e.meta.base !== state().base) continue;
    if (state().horsLigne) note('Odin répond de nouveau : rattrapage des envois en attente');
    const st = state(), v = (j.version && (j.version.id || j.version)) || '';
    setState({ dernier: String(v), sha: e.meta.sha, empreinte: e.meta.empreinte, at: Date.now(), delai: Date.now() - e.meta.at, envois: (st.envois || 0) + 1, changements: (st.changements || 0) + 1,
      depuisComplete: (st.depuisComplete || 0) + 1, octetsDepuis: (st.octetsDepuis || 0) + e.body.length, attente: queueFiles().length, horsLigne: false, erreur: '', raison: e.meta.raison });
    setLinkState({ ok: true, message: 'Relié à Odin' });
  }
  if (fullDue()) kickFull();
}

// ---------------------------------------------------------------- sauvegarde complète
let sending = null;
const RAISONS = { changement: 'changement', 'nouvel utilisateur': 'nouvel utilisateur', favori: 'favori', réglage: 'réglage', vérification: 'vérification', manuelle: 'manuelle', quotidienne: 'quotidienne', régulière: 'régulière', démarrage: 'démarrage', rattrapage: 'rattrapage', restauration: 'après restauration' };
function fullDue() {
  const st = state();
  if (!st.base || !ombre) return true;
  if (!st.depuisComplete) return false;
  return st.depuisComplete >= T.lots || (st.octetsDepuis || 0) >= T.octets || Date.now() - ((st.complete && st.complete.at) || 0) >= T.complete;
}
function kickFull() {
  if (sending || !linked()) return;
  setTimeout(() => { if (needFull || fullDue()) sendNow({ force: true, why: fullWhy || (state().base ? 'régulière' : 'démarrage') }).catch(() => {}); }, 0).unref?.();
}
/** L'archive complète envoyée à Odin, et l'ombre de ce moment (la base des changements qui suivront). */
export function archive() {
  const s = sums();
  const empreinte = fpOf(s);
  const shadow = shadowOf(s);
  const buf = dumpBuffer({ skip: SKIP, extra: { app: APP, empreinte, serveur: getSetting('server_name', 'Venus'), venus: config.version, cle: getSetting('odin_cle_sauvegarde', null), exclues: SKIP } });
  return { buf, empreinte, shadow };
}
/** Envoie toute la base à Odin (si elle a changé depuis le dernier envoi, sauf `force`). § 7 du contrat. */
export async function sendNow({ force = false, why = 'changement' } = {}) {
  if (!linked()) return { ok: false, skipped: 'pas relié' };
  // Installation neuve (rien dedans) : jamais envoyée, elle passerait devant la vraie dernière sauvegarde
  if (baseEmpty()) return { ok: false, skipped: 'base vide' };
  if (sending) return sending;
  const job = (async () => {
    await null; // jamais fini avant d'être noté comme « en cours »
    await flush().catch(() => {}); // ce qui attend part d'abord (l'historique d'Odin reste complet)
    // Toujours injoignable : la complète attendra le rattrapage (sinon les changements en file seraient perdus pour
    // l'historique d'Odin, remplacés par la complète)
    if (queueFiles().length && state().horsLigne) { needFull = true; return { ok: false, error: state().erreur || 'Odin injoignable' }; }
    try {
      if (!force && ombre && !queueFiles().length && state().sha && fingerprint() === state().empreinte) return { ok: true, skipped: 'déjà à jour', empreinte: state().empreinte };
      completeEnCours = true;
      const { buf, empreinte, shadow } = archive();
      const sha = sha256(buf);
      let r;
      try {
        r = await authed(`/api/sauvegardes/${APP}`, { method: 'POST', body: buf, timeout: 180000, headers: {
          'content-type': 'application/octet-stream', 'x-odin-empreinte': sha, 'x-odin-sorte': 'complete',
          'x-odin-raison': encodeURIComponent(RAISONS[why] || 'changement'), 'x-odin-nom': encodeURIComponent('venus-base.json.gz'),
        } });
      } catch (e) { if (offline(e)) { needFull = true; horsLigne(e); } throw e; }
      if (r.status === 413) throw Object.assign(new Error(odinMessage(r, `Sauvegarde trop grosse pour Odin (${(buf.length / 1048576).toFixed(1)} Mo) : augmente la taille maximale de Vénus dans Persona.`)), { status: 413 });
      if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin refuse la sauvegarde (${r.status})`)), { status: r.status });
      const j = r.json() || {};
      const v = String((j.version && (j.version.id || j.version)) || '');
      ombre = { base: v, tables: shadow };
      needFull = false; fullWhy = ''; retryWait = 0;
      qclear(); // les changements en attente sont dans cette complète
      const st = state();
      setState({ base: v, dernier: v, sha, empreinte, etat: empreinte, at: Date.now(), taille: buf.length, envois: (st.envois || 0) + 1, complete: { at: Date.now(), id: v, taille: buf.length },
        depuisComplete: 0, octetsDepuis: 0, attente: 0, horsLigne: false, erreur: '', raison: RAISONS[why] || 'changement', autrePoste: null });
      setLinkState({ ok: true, message: 'Relié à Odin' });
      note(`sauvegarde complète ${v} (${RAISONS[why] || why}, ${buf.length} octets)`);
      return { ok: true, version: v, taille: buf.length, empreinte, inchange: j.inchange === true };
    } catch (e) {
      if (!offline(e)) setState({ erreur: e.message, essai: Date.now() });
      return { ok: false, error: e.message };
    } finally {
      completeEnCours = false;
      if (dirty.size) setTimeout(lot, 0).unref?.(); // écrit pendant l'envoi : part tout de suite, sur la nouvelle base
    }
  })();
  sending = job;
  job.finally(() => { if (sending === job) sending = null; });
  return job;
}

// ---------------------------------------------------------------- versions et restauration
const versionOf = (x) => ({ id: String(x.id ?? ''), at: Number(x.date) || 0, taille: Number(x.taille) || 0, empreinte: String(x.empreinte || ''), sorte: String(x.sorte || 'complete'), raison: String(x.raison || ''), appareil: String(x.appareil || ''), base: x.base || null });
/** Versions gardées par Odin, la plus récente d'abord. `via` : requête authentifiée (lien gardé, ou session de restauration). */
export async function versions(via = authed) {
  const r = await via(`/api/sauvegardes/${APP}`, { timeout: 20000 });
  if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin ne donne pas la liste des sauvegardes (${r.status})`)), { status: r.status === 403 ? 403 : 502 });
  const j = r.json() || {};
  return (Array.isArray(j.versions) ? j.versions : []).map(versionOf).filter((v) => v.id).sort((a, b) => b.at - a.at);
}
/**
 * Les points de restauration à proposer : le dernier état (à la seconde, s'il vient de changements), puis chaque sauvegarde
 * complète. Un point « changements » se restaure avec sa complète et tous les changements jusqu'à lui.
 */
export function restorePoints(list) {
  const out = list.filter((v) => v.sorte === 'complete');
  const last = list[0];
  if (last && last.sorte === 'changements' && out.some((v) => v.id === last.base)) out.unshift(last);
  return out.map((v, i) => (i === 0 && v === last ? { ...v, dernierEtat: true } : v));
}
/** Empreinte (SHA-256 du dernier envoi) gardée par Odin, et une restauration demandée dans Odin. */
export async function remoteFingerprint() {
  const r = await authed(`/api/sauvegardes/${APP}/empreinte`, { timeout: 10000 });
  if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin ne donne pas l’empreinte (${r.status})`)), { status: r.status });
  const j = r.json() || {};
  return { empreinte: String(j.empreinte || ''), version: String(j.version || ''), restaurer: j.restaurer ? String(j.restaurer) : '' };
}
/** Télécharge une version et vérifie son SHA-256 (§ 7). Rend { buf, sorte }. */
async function fetchVersion(id, via = authed) {
  if (!/^[\w.:-]{1,120}$/.test(String(id))) throw Object.assign(new Error('Version invalide'), { status: 400 });
  const r = await via(`/api/sauvegardes/${APP}/${encodeURIComponent(id)}`, { timeout: 300000, headers: { accept: 'application/octet-stream' } });
  if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin ne donne pas cette sauvegarde (${r.status})`)), { status: r.status === 404 ? 404 : 502 });
  const want = String(r.headers['x-odin-empreinte'] || '').toLowerCase();
  if (want && want !== sha256(r.body)) throw Object.assign(new Error('La sauvegarde reçue d’Odin est abîmée (empreinte différente) : réessaie.'), { status: 502 });
  return { buf: r.body, sorte: String(r.headers['x-odin-sorte'] || 'complete') };
}
/** Une sauvegarde complète (octets d'origine, SHA-256 vérifié). */
export async function download(id, via = authed) {
  const v = await fetchVersion(id, via);
  if (v.sorte !== 'complete') throw Object.assign(new Error('Cette version ne contient que des changements : choisis une sauvegarde complète.'), { status: 400 });
  return v.buf;
}
/** Lit une archive de changements. */
export function parseChanges(buf) {
  let d;
  try { d = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch { throw new Error('Changements illisibles'); }
  if (!d || d.format !== 'venus-pg-changements' || !d.tables) throw new Error('Ce n’est pas un envoi de changements de Venus');
  return d;
}
/** Applique des changements à une sauvegarde lue (en mémoire, avant de la charger). */
export function applyChanges(dump, ch) {
  for (const [t, c] of Object.entries(ch.tables)) {
    let cols = dump.tables[`${t}#cols`] ? [...dump.tables[`${t}#cols`]] : [...(c.cols || [])];
    let rows = Array.isArray(dump.tables[t]) ? dump.tables[t].map((r) => [...r]) : [];
    for (const col of c.cols || []) if (!cols.includes(col)) { cols.push(col); for (const r of rows) r.push(null); }
    const at = (c.cols || []).map((col) => cols.indexOf(col));
    const toRow = (r) => { const o = new Array(cols.length).fill(null); at.forEach((j, i) => { o[j] = r[i] === undefined ? null : r[i]; }); return o; };
    if (c.replace) rows = c.replace.map(toRow);
    else {
      const pi = c.pk.map((k) => cols.indexOf(k));
      const key = (r) => JSON.stringify(pi.map((i) => (r[i] === undefined ? null : r[i])));
      const m = new Map(rows.map((r) => [key(r), r]));
      for (const k of c.del || []) m.delete(JSON.stringify(k));
      for (const r of c.put || []) { const o = toRow(r); m.set(key(o), o); }
      rows = [...m.values()];
    }
    dump.tables[t] = rows; dump.tables[`${t}#cols`] = cols;
  }
  dump.at = ch.at; dump.empreinte = ch.empreinte;
  return dump;
}
/**
 * La sauvegarde à l'état de cette version : la complète, puis ses changements dans l'ordre jusqu'à elle.
 * Rend { dump, buf (de la version visée), id, base, changements }.
 */
export async function assemble(id, via = authed) {
  const list = await versions(via);
  const v = list.find((x) => x.id === id);
  if (!v) throw Object.assign(new Error('Cette version n’existe plus sur Odin.'), { status: 404 });
  const base = v.sorte === 'complete' ? v : list.find((x) => x.id === v.base && x.sorte === 'complete');
  if (!base) throw Object.assign(new Error('La sauvegarde complète de ces changements n’est plus sur Odin : choisis une sauvegarde complète.'), { status: 404 });
  const full = await fetchVersion(base.id, via);
  const dump = parseDump(full.buf);
  if (v.sorte === 'complete') return { dump, buf: full.buf, id: v.id, base: base.id, changements: 0 };
  const chain = list.filter((x) => x.sorte === 'changements' && x.base === base.id && x.at <= v.at);
  const got = [];
  let target = null;
  for (const x of chain) { const f = await fetchVersion(x.id, via); const c = parseChanges(f.buf); got.push(c); if (x.id === v.id) target = { c, buf: f.buf }; }
  if (!target) throw Object.assign(new Error('Changements introuvables sur Odin.'), { status: 404 });
  got.sort((a, b) => a.seq - b.seq || a.at - b.at);
  for (const c of got) if (c.seq <= target.c.seq) applyChanges(dump, c);
  return { dump, buf: target.buf, id: v.id, base: base.id, changements: got.filter((c) => c.seq <= target.c.seq).length };
}

/** La base est-elle vide (première installation) ? */
export function baseEmpty() { return !get('SELECT 1 AS x FROM profiles LIMIT 1') && !getSetting('household_password'); }

/**
 * Restaure une sauvegarde (archive complète reçue d'Odin) dans la base, tout de suite. L'état actuel est d'abord gardé en
 * local (backups/venus-avant-restauration-…). Le lien avec Odin (adresse, jeton) reste celui d'aujourd'hui.
 * `password` : mot de passe Odin, pour retrouver la clé des secrets si elle diffère de celle de cette installation.
 */
export function restoreBuffer(buf, opts = {}) { return restoreDump(parseDump(buf), { ...opts, sha: sha256(buf) }); }
/** Restaure la version `id` d'Odin (complète, ou changements : à la seconde près). */
export async function restoreVersion(id, { via = authed, ...opts } = {}) {
  const a = await assemble(id, via);
  return { ...restoreDump(a.dump, { ...opts, sha: sha256(a.buf) }), version: a.id, changements: a.changements };
}
function restoreDump(d, { password, label = 'odin' } = {}) {
  // Le lien avec Odin et l'état de la sauvegarde restent ceux d'aujourd'hui : jamais ceux de l'archive (un ancien jeton de
  // renouvellement réutilisé ferait couper toute la session par Odin)
  const ours = (k) => LINK_KEYS.includes(k) || k === ST || k === 'odin_cle_sauvegarde';
  const keep = Object.fromEntries([...LINK_KEYS, ST, 'odin_cle_sauvegarde'].map((k) => [k, getSetting(k, null)]));
  const kc = (d.tables['settings#cols'] || []).indexOf('key');
  if (kc >= 0 && Array.isArray(d.tables.settings)) d.tables.settings = d.tables.settings.filter((r) => !ours(String(r[kc])));
  fs.mkdirSync(backupsDir, { recursive: true });
  if (!baseEmpty()) writeDump(path.join(backupsDir, `venus-avant-restauration-${Date.now()}.json.gz`));
  // La clé des secrets de la sauvegarde
  let secrets = 'mêmes';
  const w = d.cle;
  if (w && w.kid && w.kid !== secretKeyId()) {
    const key = password ? unwrapKey(w, password) : null;
    if (key) { try { replaceSecretKey(key); secrets = 'retrouvés'; } catch (e) { secrets = e.message; } }
    else secrets = password ? 'mot de passe différent' : 'sans mot de passe';
  }
  const kept = {};
  const have = new Set(tablesNow());
  for (const t of PRESERVE.filter((x) => have.has(x))) {
    const cols = colsOf(t).map((r) => r.c);
    kept[t] = { cols, rows: raw(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(t)}`).map((r) => cols.map((c) => r[c])) };
  }
  const n = load(Object.fromEntries(Object.entries(d.tables).filter(([k]) => !PRESERVE.includes(k.replace(/#cols$/, '')))));
  // Sessions des appareils et journaux d'aujourd'hui remis (une session dont le profil n'existe plus est laissée)
  for (const [t, { cols, rows }] of Object.entries(kept)) { try { insertRows(t, cols, rows); } catch (e) { console.warn(`[odin] ${t} non remis : ${e.message}`); } }
  resetSequences();
  // Le lien d'aujourd'hui (chiffré de nouveau avec la clé maintenant en place)
  for (const [k, v] of Object.entries(keep)) if (v !== null && v !== undefined && !(k === 'odin_cle_sauvegarde' && v.kid !== secretKeyId())) setSetting(k, v);
  bumpItems();
  // La base est maintenant celle de l'archive : ce qui attendait (ancien état) ne part plus, et une complète repart (nouvelle
  // base des changements : jamais des changements de cette installation ajoutés à la série d'une autre)
  const fp = fingerprint();
  qclear(); dirty = new Set(); ombre = null; needFull = true; fullWhy = 'restauration';
  setState({ restaure: { at: Date.now(), de: d.at, lignes: n, label, secrets, identique: d.empreinte ? fp === d.empreinte : null }, empreinte: '', sha: '', base: '', dernier: '', attente: 0 });
  if (started) kickFull();
  return { lignes: n, de: d.at, serveur: d.serveur || '', secrets, identique: d.empreinte ? fp === d.empreinte : null, empreinte: fp };
}

// ---------------------------------------------------------------- vérification à l'identique (toutes les 30 s)
let lastSlow = 0;
export async function checkNow() {
  if (!linked()) return { ok: false, skipped: 'pas relié' };
  try {
    await flush().catch(() => {}); // rattrapage d'abord
    let remote;
    try { remote = await remoteFingerprint(); }
    catch (e) { if (offline(e)) horsLigne(e); else setState({ erreur: e.message, essai: Date.now() }); return { ok: false, error: e.message }; }
    // Restauration demandée par le propriétaire dans Odin (page Vénus d'Odin → « Restaurer »)
    if (remote.restaurer && remote.restaurer !== state().demandeFaite) {
      try {
        const r = await restoreVersion(remote.restaurer, { label: `demandée dans Odin (${remote.restaurer})` });
        setState({ demandeFaite: remote.restaurer });
        await authed(`/api/sauvegardes/${APP}/restauree`, { method: 'POST', body: { version: remote.restaurer }, timeout: 10000 }).catch(() => {});
        console.log(`  ↺ Sauvegarde ${remote.restaurer} restaurée à la demande d’Odin (${r.lignes} lignes)`);
        return { ok: true, restaure: remote.restaurer, ...r };
      } catch (e) { setState({ erreur: `Restauration demandée par Odin impossible : ${e.message}`, essai: Date.now() }); return { ok: false, error: e.message }; }
    }
    // Pas encore de base pour les changements (démarrage, restauration, Odin qui a tout perdu) : une complète
    if (!ombre) {
      const st = state();
      // Démarrage : la base est celle qu'Odin peut reconstruire (dernier état envoyé ou en file) → on repart de là
      if (st.base && st.etat && remote.version && fingerprint() === st.etat) ombre = { base: st.base, tables: shadowOf(sums()) };
      else return await sendNow({ force: true, why: fullWhy || (st.base ? 'vérification' : 'démarrage') });
      await flush().catch(() => {});
    }
    if (needFull) return await sendNow({ force: true, why: fullWhy || 'rattrapage' });
    // Une écriture a-t-elle échappé au suivi ? (empreinte de chaque table, comparée à ce qu'Odin a ; les grosses tables
    // remplies par Venus lui-même, toutes les 5 minutes seulement : leur calcul fait attendre Venus)
    const lentes = Date.now() - lastSlow >= 5 * 60_000;
    if (lentes) lastSlow = Date.now();
    const s = sums((t) => lentes || !SLOW.has(t));
    for (const [t, sum] of Object.entries(s)) { const o = ombre.tables.get(t); if (!o || o.sum !== sum) dirty.add(t); }
    const now = new Set(tablesNow());
    for (const t of ombre.tables.keys()) if (!now.has(t)) dirty.add(t);
    if (dirty.size) { lot(); await flush().catch(() => {}); }
    const n = queueFiles().length;
    if (n) return { ok: false, attente: n, error: state().erreur || `${n} envoi(s) en attente` };
    let st = state();
    let same = remote.version === st.dernier && remote.empreinte === st.sha;
    if (!same) {
      // La dernière version d'Odin n'est pas la nôtre : un autre serveur Venus du même compte écrit aussi, ou Odin a perdu
      // notre dernier envoi
      const list = await versions();
      const mine = list.find((v) => v.id === st.dernier), base = list.find((v) => v.id === st.base && v.sorte === 'complete');
      if (mine && base && mine.empreinte === st.sha) { same = true; setState({ autrePoste: { appareil: list[0] && list[0].appareil, version: list[0] && list[0].id, at: list[0] && list[0].at } }); }
      else return await sendNow({ force: true, why: 'vérification' });
    }
    if (fullDue()) return await sendNow({ force: true, why: 'régulière' });
    st = state();
    const fp = ombreFp();
    setState({ verifie: Date.now(), identique: same && fp === st.empreinte, erreur: '', horsLigne: false });
    return { ok: true, skipped: 'à l’identique', empreinte: fp };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Oublie tout ce qui concerne l'Odin d'avant (lien changé ou coupé). */
export function forgetSync() {
  qclear(); ombre = null; dirty = new Set(); needFull = true;
  setState({ base: '', dernier: '', sha: '', empreinte: '', etat: '', attente: 0, horsLigne: false, autrePoste: null, depuisComplete: 0, octetsDepuis: 0 });
}

let started = false;
/**
 * Au démarrage, avant toute écriture : si la base est exactement celle qu'Odin peut reconstruire (dernier envoi reçu ou
 * en file), Venus repart de là (les changements en file partiront tels quels) ; sinon une complète partira.
 */
function resume() {
  const st = state();
  if (!linked() || ombre || !st.base || !st.etat) return false;
  try {
    const s = sums();
    if (fpOf(s) !== st.etat) { note('la base a changé depuis le dernier envoi : une sauvegarde complète partira'); return false; }
    ombre = { base: st.base, tables: shadowOf(s) };
    note(`reprise de la synchronisation sur ${st.base} (${queueFiles().length} envoi(s) en attente)`);
    return true;
  } catch { return false; }
}
export function startOdinBackup() {
  if (started) return;
  started = true;
  resume();
  onWrite(noteWrite);
  const t = setInterval(() => { checkNow().catch(() => {}); }, T.verif);
  t.unref?.();
  // Au démarrage : Venus se connecte à Odin, rattrape la file, et repart de l'état qu'Odin a
  setTimeout(() => { checkNow().catch(() => {}); }, Math.min(T.verif, 2000)).unref?.();
}
