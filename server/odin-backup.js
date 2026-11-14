// Sauvegarde continue de la base de Venus sur Odin, et restauration (nouvelle installation ou Réglages → Odin).
//
// Ce qui part : toute la base PostgreSQL (profils et réglages de chaque utilisateur, « Ma liste », favoris, envies,
// historique de lecture et reprises, téléchargements et demandes, enregistrements, réglages du serveur…), au même
// format que les sauvegardes de la nuit (db-copy.js). Ce qui ne part pas : les fichiers vidéo, images et musiques
// (trop gros), les sessions des appareils, les caches que Venus refait seul (index des dialogues, guide TV) et les
// journaux. Envoyée dès un changement important (20 s après le dernier), et vérifiée toutes les 5 minutes : Venus
// compare l'empreinte de sa base avec celle de la dernière sauvegarde gardée par Odin, et renvoie si elle diffère.
//
// Les secrets (clés d'API, mots de passe des sources, SMTP…) partent CHIFFRÉS : ils le sont déjà dans la base avec la
// clé de Venus (secret.key), qui, elle, ne part jamais en clair. Elle part emballée avec une clé tirée du mot de passe
// Odin de l'administrateur (scrypt + AES-256-GCM) : Odin ne peut pas la lire, et une restauration sur une nouvelle
// machine la retrouve avec ce même mot de passe. Sans lui (mot de passe changé depuis), tout revient sauf les secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, get, getSetting, setSetting, onWrite, bumpItems, secretKeyId, secretKeyBytes, replaceSecretKey } from './db.js';
import { dumpBuffer, parseDump, load, writeDump, insertRows, resetSequences } from './db-copy.js';
import { backupsDir } from './backup.js';
import { config } from './config.js';
import { authed, linked, odinMessage, APP, LINK_KEYS, setLinkState } from './odin-link.js';

// Tables laissées de côté : sessions des appareils, caches refaits par Venus, journaux
export const SKIP = ['tokens', 'dialogue_index', 'dialogues', 'epg', 'security_log', 'transcode_log', 'ip_bans'];
// Parmi elles, gardées telles quelles à la restauration (les caches, eux, sont refaits)
const PRESERVE = ['tokens', 'security_log', 'transcode_log', 'ip_bans'];
// Réglages qui bougent tout seuls (dates de dernière tâche, états) : ni « changement important », ni dans l'empreinte
export const VOLATILE = /^(last_|odin_sso_|odin_sauvegarde|odin_cle_|tasks_state|epg_last|iptv_check_at|new_eps_checked|tg_arrivals_at|nas_health|security_audit|disk_warned|nas_warned|broken_notified|update_notified|smtp_verified|changelog_seen)/;
// Tables dont un changement mérite un envoi rapide (le reste est rattrapé par la vérification des 5 minutes)
export const IMPORTANT = new Set(['profiles', 'mylist', 'wishlist', 'wanted', 'media_wants', 'folk_torrents', 'playlists', 'playlist_items', 'collections', 'collection_items', 'record_rules', 'recordings', 'invites', 'api_keys', 'libraries', 'track_prefs', 'opinions', 'media_sources', 'settings']);
const ST = 'odin_sauvegarde'; // état : { at, empreinte, version, taille, erreur, envois }

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const raw = (sql, params = []) => db.pg.rowsOf(db.pg.call({ op: 'query', sql, params }));
export const state = () => getSetting(ST, null) || {};
const setState = (patch) => setSetting(ST, { ...state(), ...patch });

/**
 * Empreinte de la base (ce qui part sur Odin), calculée par PostgreSQL : pour chaque table, l'empreinte de ses lignes
 * dans un ordre fixe ; les réglages qui bougent seuls sont ignorés. Deux bases identiques → même empreinte.
 */
export function fingerprint() {
  const tables = raw("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name").map((r) => r.t).filter((t) => !SKIP.includes(t));
  const h = crypto.createHash('sha256');
  for (const t of tables) {
    const where = t === 'settings' ? `WHERE NOT (x.key ~ '${VOLATILE.source.replace(/'/g, "''")}')` : '';
    const r = raw(`SELECT count(*) AS n, md5(COALESCE(string_agg(s.h, '' ORDER BY s.h), '')) AS h FROM (SELECT md5(x::text) AS h FROM ${quote(t)} x ${where}) s`)[0];
    h.update(`${t}:${r.n}:${r.h}\n`);
  }
  return h.digest('hex');
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

// ---------------------------------------------------------------- envoi
/** L'archive envoyée à Odin : la base (gzip), avec ce qu'il faut pour la restaurer ailleurs. */
export function archive() {
  const empreinte = fingerprint();
  const buf = dumpBuffer({ skip: SKIP, extra: { app: APP, empreinte, serveur: getSetting('server_name', 'Venus'), venus: config.version, cle: getSetting('odin_cle_sauvegarde', null), exclues: SKIP } });
  return { buf, empreinte };
}

let sending = null;
const RAISONS = { changement: 'changement', 'nouvel utilisateur': 'nouvel utilisateur', favori: 'favori', réglage: 'réglage', vérification: 'vérification', manuelle: 'manuelle', quotidienne: 'quotidienne', restauration: 'avant restauration' };
/** Envoie la base à Odin (si elle a changé depuis la dernière sauvegarde, sauf `force`). § 7 du contrat. */
export async function sendNow({ force = false, why = 'changement' } = {}) {
  if (!linked()) return { ok: false, skipped: 'pas relié' };
  // Installation neuve (rien dedans) : jamais envoyée, elle passerait devant la vraie dernière sauvegarde
  if (baseEmpty()) return { ok: false, skipped: 'base vide' };
  if (sending) return sending;
  const job = (async () => {
    await null; // jamais fini avant d'être noté comme « en cours »
    try {
      const fpNow = fingerprint();
      if (!force && fpNow === state().empreinte && state().sha) return { ok: true, skipped: 'déjà à jour', empreinte: fpNow };
      const { buf, empreinte } = archive();
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const r = await authed(`/api/sauvegardes/${APP}`, { method: 'POST', body: buf, timeout: 180000, headers: {
        'content-type': 'application/octet-stream', 'x-odin-empreinte': sha, 'x-odin-sorte': 'complete',
        'x-odin-raison': encodeURIComponent(RAISONS[why] || 'changement'), 'x-odin-nom': encodeURIComponent('venus-base.json.gz'),
      } });
      if (r.status === 413) throw Object.assign(new Error(odinMessage(r, `Sauvegarde trop grosse pour Odin (${(buf.length / 1048576).toFixed(1)} Mo) : augmente la taille maximale de Vénus dans Persona.`)), { status: 413 });
      if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin refuse la sauvegarde (${r.status})`)), { status: r.status });
      const j = r.json() || {};
      const v = (j.version && (j.version.id || j.version)) || '';
      setState({ at: Date.now(), empreinte, sha, version: String(v), taille: buf.length, erreur: '', envois: (state().envois || 0) + 1 });
      setLinkState({ ok: true, message: 'Relié à Odin' });
      dirty = false;
      return { ok: true, version: String(v), taille: buf.length, empreinte, inchange: j.inchange === true };
    } catch (e) {
      setState({ erreur: e.message, essai: Date.now() });
      return { ok: false, error: e.message };
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
/** Empreinte (SHA-256 de l'archive) de la dernière sauvegarde gardée par Odin, et une restauration demandée dans Odin. */
export async function remoteFingerprint() {
  const r = await authed(`/api/sauvegardes/${APP}/empreinte`, { timeout: 10000 });
  if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin ne donne pas l’empreinte (${r.status})`)), { status: r.status });
  const j = r.json() || {};
  return { empreinte: String(j.empreinte || ''), version: String(j.version || ''), restaurer: j.restaurer ? String(j.restaurer) : '' };
}
/** Télécharge une version et vérifie son SHA-256 (§ 7). */
export async function download(id, via = authed) {
  if (!/^[\w.:-]{1,120}$/.test(String(id))) throw Object.assign(new Error('Version invalide'), { status: 400 });
  const r = await via(`/api/sauvegardes/${APP}/${encodeURIComponent(id)}`, { timeout: 300000, headers: { accept: 'application/octet-stream' } });
  if (r.status >= 400) throw Object.assign(new Error(odinMessage(r, `Odin ne donne pas cette sauvegarde (${r.status})`)), { status: r.status === 404 ? 404 : 502 });
  const want = String(r.headers['x-odin-empreinte'] || '').toLowerCase();
  const got = crypto.createHash('sha256').update(r.body).digest('hex');
  if (want && want !== got) throw Object.assign(new Error('La sauvegarde reçue d’Odin est abîmée (empreinte différente) : réessaie.'), { status: 502 });
  if (String(r.headers['x-odin-sorte'] || 'complete') !== 'complete') throw Object.assign(new Error('Cette version ne contient que des changements : choisis une sauvegarde complète.'), { status: 400 });
  return r.body;
}

/** La base est-elle vide (première installation) ? */
export function baseEmpty() { return !get('SELECT 1 AS x FROM profiles LIMIT 1') && !getSetting('household_password'); }

/**
 * Restaure une sauvegarde reçue d'Odin dans la base, tout de suite. L'état actuel est d'abord gardé en local
 * (backups/venus-avant-restauration-…). Le lien avec Odin (adresse, jeton) reste celui d'aujourd'hui.
 * `password` : mot de passe Odin, pour retrouver la clé des secrets si elle diffère de celle de cette installation.
 */
export function restoreBuffer(buf, { password, label = 'odin' } = {}) {
  const d = parseDump(buf);
  fs.mkdirSync(backupsDir, { recursive: true });
  // Le lien avec Odin et l'état de la sauvegarde restent ceux d'aujourd'hui : jamais ceux de l'archive (un ancien jeton de
  // renouvellement réutilisé ferait couper toute la session par Odin)
  const ours = (k) => LINK_KEYS.includes(k) || k === ST || k === 'odin_cle_sauvegarde';
  const keep = Object.fromEntries([...LINK_KEYS, ST, 'odin_cle_sauvegarde'].map((k) => [k, getSetting(k, null)]));
  const kc = (d.tables['settings#cols'] || []).indexOf('key');
  if (kc >= 0 && Array.isArray(d.tables.settings)) d.tables.settings = d.tables.settings.filter((r) => !ours(String(r[kc])));
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
  const have = new Set(raw("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").map((r) => r.t));
  for (const t of PRESERVE.filter((x) => have.has(x))) {
    const cols = raw('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND is_generated <> $2 ORDER BY ordinal_position', [t, 'ALWAYS']).map((r) => r.c);
    kept[t] = { cols, rows: raw(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(t)}`).map((r) => cols.map((c) => r[c])) };
  }
  const n = load(Object.fromEntries(Object.entries(d.tables).filter(([k]) => !PRESERVE.includes(k.replace(/#cols$/, '')))));
  // Sessions des appareils et journaux d'aujourd'hui remis (une session dont le profil n'existe plus est laissée)
  for (const [t, { cols, rows }] of Object.entries(kept)) { try { insertRows(t, cols, rows); } catch (e) { console.warn(`[odin] ${t} non remis : ${e.message}`); } }
  resetSequences();
  // Le lien d'aujourd'hui (chiffré de nouveau avec la clé maintenant en place)
  for (const [k, v] of Object.entries(keep)) if (v !== null && v !== undefined && !(k === 'odin_cle_sauvegarde' && v.kid !== secretKeyId())) setSetting(k, v);
  bumpItems();
  // La base est maintenant celle de cette archive : si c'est aussi la dernière d'Odin, rien à renvoyer ; sinon (version
  // plus ancienne), la vérification suivante la renvoie et elle devient la dernière
  setState({ restaure: { at: Date.now(), de: d.at, lignes: n, label, secrets }, empreinte: d.empreinte || '', sha: crypto.createHash('sha256').update(buf).digest('hex'), version: '' });
  dirty = false;
  return { lignes: n, de: d.at, serveur: d.serveur || '', secrets };
}

// ---------------------------------------------------------------- en continu
let dirty = false, timer = null, started = false;
const QUIET = Number(process.env.VENUS_ODIN_QUIET_MS || 20_000);
const CHECK = Number(process.env.VENUS_ODIN_CHECK_MS || 5 * 60_000);
const TABLE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+"?(\w+)/i;
export function noteWrite(sql, params) {
  const m = TABLE.exec(sql);
  if (!m || !IMPORTANT.has(m[1].toLowerCase())) return;
  if (m[1].toLowerCase() === 'settings' && (VOLATILE.test(String(params && params[0])) || String(params && params[0]).startsWith('odin_'))) return;
  dirty = true;
  if (!linked()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sendNow({ why: 'changement' }).catch(() => {}); }, QUIET);
  timer.unref?.();
}
export async function checkNow() {
  if (!linked()) return { ok: false, skipped: 'pas relié' };
  try {
    let remote;
    try { remote = await remoteFingerprint(); } catch (e) { setState({ erreur: e.message, essai: Date.now() }); return { ok: false, error: e.message }; }
    // Restauration demandée par le propriétaire dans Odin (page Vénus d'Odin → « Restaurer »)
    if (remote.restaurer && remote.restaurer !== state().demandeFaite) {
      try {
        const buf = await download(remote.restaurer);
        const r = restoreBuffer(buf, { label: `demandée dans Odin (${remote.restaurer})` });
        setState({ demandeFaite: remote.restaurer });
        await authed(`/api/sauvegardes/${APP}/restauree`, { method: 'POST', body: { version: remote.restaurer }, timeout: 10000 }).catch(() => {});
        console.log(`  ↺ Sauvegarde ${remote.restaurer} restaurée à la demande d’Odin (${r.lignes} lignes)`);
        return { ok: true, restaure: remote.restaurer, ...r };
      } catch (e) { setState({ erreur: `Restauration demandée par Odin impossible : ${e.message}`, essai: Date.now() }); return { ok: false, error: e.message }; }
    }
    const local = fingerprint();
    const st = state();
    if (local !== st.empreinte || remote.empreinte !== st.sha || dirty) return await sendNow({ force: true, why: 'vérification' });
    setState({ verifie: Date.now(), erreur: '' });
    return { ok: true, skipped: 'à l’identique', empreinte: local };
  } catch (e) { return { ok: false, error: e.message }; }
}
export function startOdinBackup() {
  if (started) return;
  started = true;
  onWrite(noteWrite);
  const t = setInterval(() => { checkNow().catch(() => {}); }, CHECK);
  t.unref?.();
  setTimeout(() => { checkNow().catch(() => {}); }, Math.min(CHECK, 60_000)).unref?.();
}
