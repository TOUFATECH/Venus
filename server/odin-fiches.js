// Plusieurs serveurs Venus sur le même compte Odin, synchronisés ENTRE EUX par Odin, fiche par fiche (contrat d'Odin :
// docs/sso-protocole.md § 7 bis, routes /api/venus/envoyer | tirer | empreintes | flux, sur le modèle de Pégase).
//
// Ce qui se synchronise : les profils (liés à une personne d'Odin), leurs réglages (langues, interface, pistes par série),
// leurs favoris (j'aime / je n'aime pas), « Ma liste » et les reprises de lecture. Ce qui ne part pas : les fichiers vidéo,
// la bibliothèque locale (chaque serveur a la sienne), les codes PIN, les droits d'administration, les sessions.
//
// Clés communes entre serveurs (les identifiants de la base diffèrent d'un serveur à l'autre) :
// - profil = l'identifiant `sub` de la personne d'Odin (Persona) liée à ce profil (réglage « odin_comptes ») ; un profil
//   local sans personne d'Odin reste sur son serveur ;
// - titre = TMDB (« tmdb-movie-603 », « tmdb-tv-1399 »), sinon IMDb (« imdb-tt0133093 »), sinon l'empreinte du fichier
//   (« f-… » : SHA-256 de sa taille, de ses 64 premiers et 64 derniers Kio) ; un épisode = sa série + « -s1e2 » ;
// - une reprise (comme une ligne de « Ma liste » ou un favori) = profil + titre (+ épisode) : « <sub>:tmdb-tv-1399-s1e2 ».
//
// Comment :
// - chaque écriture de Venus sur ces tables est vue (db.js → onWrite) ; 150 ms plus tard, les fiches changées depuis
//   « l'ombre » (table odin_fiches : ce qu'Odin a, fiche par fiche) partent à Odin (POST /api/venus/envoyer) ;
// - Venus écoute le flux d'Odin (GET /api/venus/flux) : les fiches d'un AUTRE serveur arrivent aussitôt et sont appliquées
//   à la base (moins de 2 s de bout en bout). Odin ne renvoie jamais à un serveur ses propres fiches, et une fiche reçue
//   est notée dans l'ombre au moment où elle est appliquée : elle ne repart pas (pas de boucle) ;
// - conflit : la fiche la plus récente (« maj ») gagne, partout ; Odin rend la gagnante quand un envoi arrive trop tard ;
// - coupure : les fiches changées attendent dans l'ombre (envoye = 0) et partent au retour ; puis les empreintes des
//   collections (SHA-256 des « id:maj » triés) sont comparées à celles d'Odin, et une collection différente est relue
//   en entier (rattrapage). La même comparaison a lieu toutes les 30 s.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, all, get, run, getSetting, setSetting, onWrite, itemsVersion } from './db.js';
import { linked, linkConf, appToken, authed, device, odinMessage } from './odin-link.js';
import { odinStream } from './odin-net.js';

export const COLS = ['profils', 'reglages', 'maliste', 'favoris', 'reprises'];
// Tables de Venus → collections qu'elles touchent
const TABLES = { profiles: ['profils', 'reglages'], track_prefs: ['reglages'], mylist: ['maliste'], opinions: ['favoris'], progress: ['reprises'] };

const ms = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const T = { calme: ms('VENUS_ODIN_LOT_MS', 150), verif: ms('VENUS_ODIN_FICHES_MS', 30_000), reessai: 30_000 };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const note = (m) => { if (process.env.VENUS_ODIN_JOURNAL !== '0') console.log(`[odin] fiches : ${process.env.VENUS_ODIN_JOURNAL === '2' ? `${new Date().toISOString().slice(17, 23)} ` : ''}${m}`); };
const sleep = (n) => new Promise((r) => { const t = setTimeout(r, n); t.unref?.(); });
/** JSON aux clés triées (même fiche → même empreinte, sur tous les serveurs). */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const hashOf = (data) => sha256(stable(data));
/** Le gagnant d'un conflit (même règle qu'Odin) : a remplace b ? */
export const gagne = (a, b) => a.maj > b.maj || (a.maj === b.maj && String(a.appareil) < String(b.appareil));
/** Empreinte d'une collection (identique à celle d'Odin) : SHA-256 des lignes « id:maj » triées, jointes par « \n ». */
export function empreinte(list) { const l = list.map((r) => `${r.id}:${Math.trunc(r.maj)}`).sort(); return { n: l.length, hash: sha256(l.join('\n')) }; }

// Une fiche = sa collection + son identifiant (la reprise et la ligne de « Ma liste » d'un même titre ont le même identifiant)
db.exec('CREATE TABLE IF NOT EXISTS odin_fiches (col TEXT NOT NULL, id TEXT NOT NULL, h TEXT, maj INTEGER, appareil TEXT, envoye INTEGER DEFAULT 0, ici INTEGER DEFAULT 1, suppr INTEGER DEFAULT 0, data TEXT, PRIMARY KEY (col, id))');
const cle = (col, id) => `${col}|${id}`;

// ---------------------------------------------------------------- état (affiché dans Réglages → Odin)
const etat = { actif: false, enLigne: false, envois: 0, envoyees: 0, recues: 0, appliquees: 0, ignorees: 0, enAttente: 0, nonApplicables: 0, dernierEnvoi: 0, dernierRecu: null, identique: null, verifie: 0, rattrapages: 0, erreur: '' };
export const state = () => ({ ...etat, attente: [...ombre.values()].filter((o) => !o.envoye).length, fiches: ombre.size, empreintes: empreintesIci() });

// ---------------------------------------------------------------- l'ombre : ce qu'Odin a, fiche par fiche
let ombre = new Map(); // « col|id » → { id, col, h, maj, appareil, envoye, ici, suppr, data }
const lireOmbre = () => { ombre = new Map(all('SELECT * FROM odin_fiches').map((r) => [cle(r.col, r.id), { ...r, maj: Number(r.maj) || 0, envoye: Number(r.envoye) || 0, ici: Number(r.ici) || 0, suppr: Number(r.suppr) || 0 }])); };
function poser(o) {
  ombre.set(cle(o.col, o.id), o);
  run('INSERT INTO odin_fiches(id, col, h, maj, appareil, envoye, ici, suppr, data) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET h = excluded.h, maj = excluded.maj, appareil = excluded.appareil, envoye = excluded.envoye, ici = excluded.ici, suppr = excluded.suppr, data = excluded.data',
    o.id, o.col, o.h, o.maj, o.appareil, o.envoye, o.ici, o.suppr, o.data);
}
/** Oublie l'ombre (autre Odin, autre compte, base restaurée) : tout repartira, et les fiches d'Odin plus récentes gagneront. */
export function forgetFiches() { run('DELETE FROM odin_fiches'); ombre = new Map(); }

// ---------------------------------------------------------------- clés communes
/** Profils liés à une personne d'Odin : { parSub: { sub: id }, parProfil: Map(id → sub) }. */
function liens() {
  const l = getSetting('odin_comptes', {}) || {}, parProfil = new Map();
  for (const [sub, pid] of Object.entries(l)) if (/^[A-Za-z0-9_-]{1,64}$/.test(sub)) parProfil.set(Number(pid), sub);
  return { parSub: l, parProfil };
}
/** Le profil de l'administrateur qui relie Venus devient celui de sa personne d'Odin (s'il n'est lié à personne). */
export function lierProfil(profileId) {
  const who = linkConf().who;
  if (!who || !who.sub || !/^[A-Za-z0-9_-]{1,64}$/.test(who.sub)) return false;
  const { parSub, parProfil } = liens();
  if (parSub[who.sub] && get('SELECT 1 AS x FROM profiles WHERE id = ?', Number(parSub[who.sub]))) return false;
  if (parProfil.has(Number(profileId))) return false;
  setSetting('odin_comptes', { ...parSub, [who.sub]: Number(profileId) });
  return true;
}

const fpCache = new Map(); // « chemin|taille|date » → clé
/** Empreinte d'un fichier : SHA-256 de sa taille, de ses 64 premiers et 64 derniers Kio (la même sur tous les serveurs). */
export function fileKey(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || !st.size) return null;
  const k = `${file}|${st.size}|${st.mtimeMs}`;
  if (fpCache.has(k)) return fpCache.get(k);
  let out = null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(65536, st.size), a = Buffer.alloc(n), b = Buffer.alloc(n), size = Buffer.alloc(8);
      fs.readSync(fd, a, 0, n, 0); fs.readSync(fd, b, 0, n, st.size - n); size.writeBigUInt64BE(BigInt(st.size));
      out = `f-${crypto.createHash('sha256').update(size).update(a).update(b).digest('hex').slice(0, 40)}`;
    } finally { fs.closeSync(fd); }
  } catch { out = null; }
  if (fpCache.size > 50_000) fpCache.clear();
  fpCache.set(k, out);
  return out;
}
let idx = { v: -1, cle: new Map(), item: new Map() };
/** Index des titres de CE serveur : id local → clé commune, et clé commune → id local. Refait quand la bibliothèque change. */
function index() {
  if (idx.v === itemsVersion) return idx;
  const rows = all("SELECT id, type, tmdb_id, imdb_id, show_id, season_num, episode_num, path, version_of FROM items WHERE type IN ('movie', 'show', 'episode', 'clip')");
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const cle = new Map(), item = new Map();
  const own = (r) => {
    const tm = Number(r.tmdb_id), im = String(r.imdb_id || '');
    if (r.type === 'movie' && tm > 0) return `tmdb-movie-${tm}`;
    if (r.type === 'show' && tm > 0) return `tmdb-tv-${tm}`;
    if ((r.type === 'movie' || r.type === 'show') && /^tt\d{5,12}$/.test(im)) return `imdb-${im}`;
    return null;
  };
  for (const r of rows) {
    let k = own(r);
    if (!k && r.type === 'episode') {
      const s = byId.get(Number(r.show_id)), sk = s && own(s);
      if (sk && r.season_num != null && r.episode_num != null) k = `${sk}-s${Number(r.season_num)}e${Number(r.episode_num)}`;
    }
    if (!k && r.type !== 'show' && r.path) k = fileKey(r.path);
    if (!k) continue;
    cle.set(Number(r.id), k);
    if (!item.has(k) || (r.version_of == null && byId.get(item.get(k))?.version_of != null)) item.set(k, Number(r.id));
  }
  idx = { v: itemsVersion, cle, item };
  return idx;
}
const uiOf = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const num = (v, d = 1) => Math.round((Number(v) || 0) * 10 ** d) / 10 ** d;

/** Les fiches de CE serveur pour ces collections : Map(« col|id » → { id, col, data, ts }) (ts : date de la ligne, si elle en a une). */
function extraire(cols) {
  const want = new Set(cols), out = new Map(), { parProfil } = liens();
  if (!parProfil.size) return out;
  const ix = (want.has('reglages') || want.has('maliste') || want.has('favoris') || want.has('reprises')) ? index() : null;
  if (want.has('profils') || want.has('reglages')) {
    for (const p of all('SELECT id, name, avatar, max_age, subtitle_lang, audio_lang, ui_prefs, created_at FROM profiles')) {
      const sub = parProfil.get(Number(p.id)); if (!sub) continue;
      if (want.has('profils')) out.set(cle('profils', sub), { id: sub, col: 'profils', data: { nom: String(p.name || ''), avatar: Number(p.avatar) || 0, age_max: p.max_age == null ? null : Number(p.max_age) }, ts: Number(p.created_at) || 1 });
      if (want.has('reglages')) out.set(cle('reglages', `${sub}:reglages`), { id: `${sub}:reglages`, col: 'reglages', data: { sous_titres: p.subtitle_lang || null, audio: p.audio_lang || null, interface: uiOf(p.ui_prefs) }, ts: 1 });
    }
  }
  if (want.has('reglages')) {
    for (const r of all('SELECT profile_id, show_id, audio_lang, sub_lang, sub_mode, updated_at FROM track_prefs')) {
      const sub = parProfil.get(Number(r.profile_id)), k = ix.cle.get(Number(r.show_id)); if (!sub || !k) continue;
      out.set(cle('reglages', `${sub}:pistes:${k}`), { id: `${sub}:pistes:${k}`, col: 'reglages', data: { audio: r.audio_lang || null, sous_titres: r.sub_lang || null, mode: r.sub_mode || null }, ts: Number(r.updated_at) || 1 });
    }
  }
  const lignes = (col, sql, data, ts) => {
    if (!want.has(col)) return;
    for (const r of all(sql)) {
      const sub = parProfil.get(Number(r.profile_id)), k = ix.cle.get(Number(r.item_id)); if (!sub || !k) continue;
      out.set(cle(col, `${sub}:${k}`), { id: `${sub}:${k}`, col, data: data(r), ts: Number(ts(r)) || 1 });
    }
  };
  lignes('maliste', 'SELECT profile_id, item_id, added_at FROM mylist', (r) => ({ ajoute: Number(r.added_at) || 0 }), (r) => r.added_at);
  lignes('favoris', 'SELECT profile_id, item_id, liked, at FROM opinions', (r) => ({ avis: Number(r.liked) > 0 ? 1 : -1 }), (r) => r.at);
  lignes('reprises', 'SELECT profile_id, item_id, position, duration, watched, updated_at FROM progress', (r) => ({ position: num(r.position), duree: num(r.duration), vu: Number(r.watched) ? 1 : 0 }), (r) => r.updated_at);
  return out;
}

// ---------------------------------------------------------------- changements de CE serveur → l'ombre (envoye = 0)
let dirty = new Set(), tCalme = null, applying = false;
/** Compare les fiches de la base à l'ombre ; les fiches changées attendent l'envoi. Rend le nombre de fiches changées. */
function diff(cols) {
  if (!linked()) return 0;
  const { parProfil } = liens(); if (!parProfil.size) return 0; // aucun profil lié : rien à envoyer (et surtout rien à effacer)
  const cur = extraire(cols), now = Date.now(), moi = device().id, want = new Set(cols), subs = new Set(parProfil.values());
  const ix = cols.some((c) => c !== 'profils') ? index() : null;
  /** Une fiche disparue d'ici est-elle vraiment effacée ? (pas un profil délié, ni un titre sorti de CETTE bibliothèque) */
  const efface = (o) => {
    const [sub, a, ...b] = o.id.split(':');
    if (!subs.has(sub) || o.col === 'profils') return false; // un profil n'est jamais effacé à distance
    if (o.col === 'reglages') return a === 'pistes' && ix.item.has(b.join(':'));
    return ix.item.has([a, ...b].join(':'));
  };
  let n = 0;
  {
    for (const [k, f] of cur) {
      const o = ombre.get(k), h = hashOf(f.data), id = f.id;
      if (o && o.ici && !o.suppr && o.h === h) continue;
      // Première fois : la date de la ligne (une vieille reprise ne passe pas devant une plus récente d'un autre serveur)
      const maj = !o ? f.ts : f.ts > o.maj ? f.ts : Math.max(now, o.maj + 1);
      poser({ id, col: f.col, h, maj, appareil: moi, envoye: 0, ici: 1, suppr: 0, data: JSON.stringify(f.data) });
      n++;
    }
    for (const o of [...ombre.values()]) {
      if (!want.has(o.col) || !o.ici || o.suppr || cur.has(cle(o.col, o.id)) || !efface(o)) continue;
      poser({ ...o, h: '', maj: Math.max(now, o.maj + 1), appareil: moi, envoye: 0, suppr: 1, data: '{}' });
      n++;
    }
  }
  return n;
}
function lot() {
  clearTimeout(tCalme); tCalme = null;
  if (!dirty.size || !linked()) return;
  const cols = [...dirty]; dirty = new Set();
  let n = 0;
  try { n = diff(cols); } catch (e) { etat.erreur = `Fiches non calculées : ${e.message}`; for (const c of cols) dirty.add(c); return; }
  if (n) { if (process.env.VENUS_ODIN_JOURNAL === '2') note(`${n} fiche(s) changée(s) ici (${cols.join(', ')})`); envoyer().catch(() => {}); }
}
function marquer(cols) { for (const c of cols) dirty.add(c); clearTimeout(tCalme); tCalme = setTimeout(lot, T.calme); tCalme.unref?.(); }
let tItems = null;
const TABLE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+"?(\w+)/i;
/** Écoute de chaque écriture de Venus (db.js). */
function noteWrite(sql, params) {
  if (applying || !started) return;
  const m = TABLE.exec(sql); if (!m) return;
  const t = m[1].toLowerCase();
  if (TABLES[t]) { if (linked()) marquer(TABLES[t]); return; }
  if (t === 'settings' && String(params && params[0]) === 'odin_comptes') { if (linked()) marquer(COLS); return; }
  // Bibliothèque changée : des fiches reçues peuvent maintenant s'appliquer ici (titre arrivé sur ce serveur)
  if (t === 'items' && !tItems) { tItems = setTimeout(() => { tItems = null; try { reessayer(); } catch { /* */ } }, 5000); tItems.unref?.(); }
}

// ---------------------------------------------------------------- envoi
let envoiEnCours = null, envoiEncore = false;
export function envoyer() {
  if (envoiEnCours) { envoiEncore = true; return envoiEnCours; }
  envoiEnCours = (async () => {
    try { do { envoiEncore = false; await envoyerUneFois(); } while (envoiEncore); } finally { envoiEnCours = null; }
  })();
  return envoiEnCours;
}
async function envoyerUneFois() {
  for (;;) {
    if (!linked()) return;
    const l = [...ombre.values()].filter((o) => !o.envoye).sort((a, b) => a.maj - b.maj).slice(0, 1000);
    if (!l.length) { etat.enAttente = 0; return; }
    const changements = l.map((o) => ({ id: o.id, col: o.col, maj: o.maj, ...(o.suppr ? { suppr: true } : { data: JSON.parse(o.data || '{}') }) }));
    let r;
    try { r = await authed('/api/venus/envoyer', { method: 'POST', body: { changements }, timeout: 20000 }); }
    catch (e) { etat.enLigne = false; etat.erreur = `${e.message} ${l.length} fiche(s) attendent : elles partiront dès qu’Odin répondra.`; etat.enAttente = l.length; return; }
    const j = r.json() || {};
    if (r.status !== 200) { etat.erreur = odinMessage(r, `Odin refuse les fiches (${r.status})`); return; }
    etat.envois++; etat.envoyees += Number(j.appliques) || 0; etat.dernierEnvoi = Date.now(); etat.erreur = '';
    if (process.env.VENUS_ODIN_JOURNAL === '2') note(`${l.length} envoyée(s) à Odin (${Number(j.appliques) || 0} prise(s))`);
    // Envoyées : notées (sauf si la fiche a encore changé pendant l'envoi)
    for (const o of l) { const cur = ombre.get(cle(o.col, o.id)); if (cur && cur.maj === o.maj && !cur.envoye) poser({ ...cur, envoye: 1 }); }
    // Refusées : laissées de côté (notées comme envoyées, sinon elles repartiraient sans fin)
    for (const x of Array.isArray(j.refuses) ? j.refuses : []) note(`fiche ${x.id} refusée par Odin : ${x.raison}`);
    // Arrivées trop tard : la fiche d'un autre serveur, plus récente, gagne aussi ici
    if (Array.isArray(j.gagnants) && j.gagnants.length) { etat.ignorees += j.gagnants.length; appliquer(j.gagnants, 'gagnantes'); }
  }
}

// ---------------------------------------------------------------- réception : appliquer les fiches d'un autre serveur
function profilDe(sub, fiche) {
  const { parSub } = liens();
  const pid = Number(parSub[sub]);
  if (pid && get('SELECT 1 AS x FROM profiles WHERE id = ?', pid)) return pid;
  if (!fiche || fiche.suppr) return null;
  // Profil d'une personne d'Odin venu d'un autre serveur : créé ici (sans code PIN, sans droit d'administration)
  const d = fiche.data || {};
  const r = run('INSERT INTO profiles(name, avatar, max_age, created_at) VALUES(?, ?, ?, ?)', String(d.nom || 'Odin').slice(0, 30), Number(d.avatar) || 0, d.age_max == null ? null : Number(d.age_max), Date.now());
  const id = Number(r.lastInsertRowid);
  setSetting('odin_comptes', { ...(getSetting('odin_comptes', {}) || {}), [sub]: id });
  return id;
}
/** Applique UNE fiche à la base. Rend true si elle s'applique ici (profil et titre présents). */
function appliquerUne(f) {
  const d = f.data || {};
  const [sub, ...rest] = String(f.id).split(':');
  if (f.col === 'profils') {
    const pid = profilDe(sub, f);
    if (!pid) return f.suppr ? true : false; // un profil n'est jamais effacé à distance (il emporterait ses données)
    if (!f.suppr) run('UPDATE profiles SET name = ?, avatar = ?, max_age = ? WHERE id = ?', String(d.nom || 'Odin').slice(0, 30), Number(d.avatar) || 0, d.age_max == null ? null : Number(d.age_max), pid);
    return true;
  }
  const pid = profilDe(sub, null);
  if (!pid) return false;
  if (f.col === 'reglages' && rest[0] === 'reglages') {
    if (!f.suppr) run('UPDATE profiles SET subtitle_lang = ?, audio_lang = ?, ui_prefs = ? WHERE id = ?', d.sous_titres || 'fr', d.audio || 'fr', JSON.stringify(d.interface && typeof d.interface === 'object' ? d.interface : {}), pid);
    return true;
  }
  const ix = index();
  const key = f.col === 'reglages' ? rest.slice(1).join(':') : rest.join(':');
  const item = ix.item.get(key);
  if (!item) return false;
  if (f.col === 'reglages') {
    if (f.suppr) run('DELETE FROM track_prefs WHERE profile_id = ? AND show_id = ?', pid, item);
    else run('INSERT INTO track_prefs(profile_id, show_id, audio_lang, sub_lang, sub_mode, updated_at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, show_id) DO UPDATE SET audio_lang = excluded.audio_lang, sub_lang = excluded.sub_lang, sub_mode = excluded.sub_mode, updated_at = excluded.updated_at', pid, item, d.audio || null, d.sous_titres || null, d.mode || null, f.maj);
  } else if (f.col === 'maliste') {
    if (f.suppr) run('DELETE FROM mylist WHERE profile_id = ? AND item_id = ?', pid, item);
    else run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?) ON CONFLICT(profile_id, item_id) DO UPDATE SET added_at = excluded.added_at', pid, item, Number(d.ajoute) || f.maj);
  } else if (f.col === 'favoris') {
    if (f.suppr) run('DELETE FROM opinions WHERE profile_id = ? AND item_id = ?', pid, item);
    else run('INSERT INTO opinions(profile_id, item_id, liked, at) VALUES(?, ?, ?, ?) ON CONFLICT(profile_id, item_id) DO UPDATE SET liked = excluded.liked, at = excluded.at', pid, item, Number(d.avis) > 0 ? 1 : -1, f.maj);
  } else if (f.col === 'reprises') {
    if (f.suppr) run('DELETE FROM progress WHERE profile_id = ? AND item_id = ?', pid, item);
    else run('INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at, device) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, item_id) DO UPDATE SET position = excluded.position, duration = excluded.duration, watched = excluded.watched, updated_at = excluded.updated_at, device = excluded.device', pid, item, Number(d.position) || 0, Number(d.duree) || 0, Number(d.vu) ? 1 : 0, f.maj, 'autre serveur Vénus (Odin)');
  } else return false;
  return true;
}
/**
 * Applique des fiches reçues d'Odin (d'un autre serveur), si elles sont plus récentes que celles d'ici. Chaque fiche
 * appliquée est notée dans l'ombre avec l'empreinte de ce que la base en montre maintenant : elle ne repartira pas.
 */
export function appliquer(list, d = 'flux') {
  // Un changement d'ici pas encore comparé à l'ombre l'est d'abord : une fiche reçue plus ancienne ne l'écrase jamais
  if (dirty.size) lot();
  const moi = device().id, recues = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.id !== 'string' || !COLS.includes(f.col) || !Number.isFinite(Number(f.maj))) continue;
    const r = { id: f.id, col: f.col, maj: Math.trunc(Number(f.maj)), appareil: String(f.appareil || ''), suppr: f.suppr ? 1 : 0, data: f.suppr ? {} : (f.data && typeof f.data === 'object' ? f.data : {}) };
    const o = ombre.get(cle(r.col, r.id));
    if (o && !gagne(r, o)) continue; // celle d'ici est plus récente (elle partira) ou c'est la même
    if (r.appareil === moi && o && o.maj === r.maj) continue;
    recues.push(r);
  }
  if (!recues.length) return 0;
  // Les profils d'abord (les autres fiches en ont besoin)
  recues.sort((a, b) => (a.col === 'profils' ? 0 : 1) - (b.col === 'profils' ? 0 : 1));
  const ok = new Map();
  applying = true;
  try { for (const f of recues) { try { ok.set(cle(f.col, f.id), appliquerUne(f)); } catch (e) { ok.set(cle(f.col, f.id), false); note(`fiche ${f.id} non appliquée : ${e.message}`); } } }
  finally { applying = false; }
  const cur = extraire([...new Set(recues.map((f) => f.col))]);
  for (const f of recues) {
    const ici = ok.get(cle(f.col, f.id)) ? 1 : 0, c = cur.get(cle(f.col, f.id));
    poser({ id: f.id, col: f.col, h: ici && c ? hashOf(c.data) : '', maj: f.maj, appareil: f.appareil, envoye: 1, ici: ici && (c || f.suppr) ? 1 : 0, suppr: f.suppr, data: JSON.stringify(f.data) });
  }
  const n = [...ok.values()].filter(Boolean).length;
  etat.recues += recues.length; etat.appliquees += n; etat.nonApplicables = [...ombre.values()].filter((o) => !o.ici && !o.suppr).length;
  if (d === 'flux') etat.dernierRecu = { at: Date.now(), n: recues.length };
  if (process.env.VENUS_ODIN_JOURNAL === '2') note(`${recues.length} reçue(s) (${d}), ${n} appliquée(s)`);
  return n;
}
/** Les fiches reçues qui ne s'appliquaient pas encore ici (profil ou titre absent) : on réessaie. */
let dernierEssai = '';
export function reessayer() {
  const l = [...ombre.values()].filter((o) => !o.ici && !o.suppr);
  // Seulement si la bibliothèque ou les profils liés ont changé depuis le dernier essai
  const marque = `${itemsVersion}|${JSON.stringify(getSetting('odin_comptes', {}))}|${l.length}`;
  if (!l.length || marque === dernierEssai) return 0;
  dernierEssai = marque;
  const fiches = l.map((o) => ({ id: o.id, col: o.col, maj: o.maj, appareil: o.appareil, data: JSON.parse(o.data || '{}') }));
  // Elles ne « gagnent » pas contre elles-mêmes : on les retire de l'ombre le temps de les rappliquer
  for (const o of l) ombre.delete(cle(o.col, o.id));
  return appliquer(fiches, 'en attente');
}

// ---------------------------------------------------------------- rattrapage : empreintes, puis collections relues
function empreintesIci() {
  const out = {};
  for (const c of COLS) out[c] = empreinte([...ombre.values()].filter((o) => o.col === c));
  return out;
}
let rattrapageEnCours = null;
/** Compare les empreintes d'Odin à celles d'ici ; une collection différente est relue en entier et fusionnée. */
export function rattraper(distantes) {
  if (rattrapageEnCours) return rattrapageEnCours;
  rattrapageEnCours = (async () => {
    try {
      const avant = etat.envois;
      await envoyer();
      if (!distantes || etat.envois !== avant) { const r = await authed('/api/venus/empreintes', { timeout: 15000 }); if (r.status !== 200) throw new Error(odinMessage(r, `Odin ne donne pas les empreintes (${r.status})`)); distantes = (r.json() || {}).empreintes || {}; }
      let ici = empreintesIci(), relues = 0;
      for (const c of COLS) {
        if (distantes[c] && distantes[c].hash === ici[c].hash) continue;
        relues++;
        const vus = new Set(); let depuis;
        for (;;) {
          const r = await authed('/api/venus/tirer', { method: 'POST', body: { col: c, ...(depuis !== undefined ? { depuis } : {}), limite: 5000 }, timeout: 30000 });
          const j = r.json() || {};
          if (r.status !== 200) throw new Error(odinMessage(r, `Odin ne donne pas les fiches (${r.status})`));
          for (const f of j.changements || []) vus.add(f.id);
          appliquer(j.changements || [], 'rattrapage');
          if (j.complet || j.suite == null) break;
          depuis = j.suite;
        }
        // Ce qu'Odin n'a pas (ou a de plus ancien) repart
        for (const o of [...ombre.values()]) if (o.col === c && o.envoye && !vus.has(o.id)) poser({ ...o, envoye: 0 });
      }
      if (relues) { etat.rattrapages++; await envoyer(); ici = empreintesIci(); }
      const r = await authed('/api/venus/empreintes', { timeout: 15000 });
      const fin = r.status === 200 ? ((r.json() || {}).empreintes || {}) : {};
      etat.identique = COLS.every((c) => fin[c] && fin[c].hash === ici[c].hash) && !state().attente;
      etat.verifie = Date.now();
      return { ok: true, relues, identique: etat.identique };
    } catch (e) { etat.erreur = e.message; return { ok: false, error: e.message }; }
    finally { rattrapageEnCours = null; }
  })();
  return rattrapageEnCours;
}

// ---------------------------------------------------------------- le flux d'Odin (fiches des autres serveurs en direct)
let flux = null, boucle = null, attente = 0;
function ecouter() {
  if (boucle || !started) return;
  boucle = (async () => {
    while (started && linked()) {
      let token;
      try { token = await appToken(); } catch (e) { etat.enLigne = false; etat.erreur = e.message; attente = Math.min(T.reessai, attente ? attente * 2 : 1000); await sleep(attente); continue; }
      const c = linkConf();
      const s = odinStream(`${c.url}/api/venus/flux`, {
        pin: c.pin, headers: { authorization: `Bearer ${token}` },
        onOpen: () => { etat.enLigne = true; attente = 0; },
        onEvent: (ev, d) => {
          if (ev === 'bonjour') rattraper(d.empreintes).catch(() => {});
          else if (ev === 'changements') appliquer(d.changements, 'flux');
          else if (ev === 'verif' && !state().attente) { const ici = empreintesIci(); if (COLS.some((k) => !d.empreintes || !d.empreintes[k] || d.empreintes[k].hash !== ici[k].hash)) rattraper(d.empreintes).catch(() => {}); else { etat.identique = true; etat.verifie = Date.now(); } }
          else if (ev === 'revoque') { etat.erreur = String(d.texte || 'Odin a coupé la connexion de Venus.'); }
        },
      });
      flux = s;
      const r = await s.done;
      flux = null; etat.enLigne = false;
      if (!started) break;
      if (r.status === 401) await appToken({ fresh: true }).catch(() => {});
      else if (r.status && r.status !== 200) { etat.erreur = (r.json && (r.json.message || r.json.erreur)) || `Odin refuse le flux des fiches (${r.status})`; if (r.status === 404 && !etat.odinAncien) { etat.odinAncien = true; note('cet Odin ne connaît pas encore la synchronisation entre serveurs (mets Odin à jour)'); } }
      else if (r.error) etat.erreur = r.error.message;
      attente = Math.min(T.reessai, attente ? attente * 2 : (r.status === 404 ? T.reessai : 1000));
      await sleep(attente);
    }
  })().finally(() => { boucle = null; });
}
/** Relance tout (Venus relié de nouveau à Odin) : l'ombre est oubliée, tout est comparé à Odin. */
export function relancer() {
  if (flux) flux.close();
  forgetFiches();
  if (!started) return;
  verifier().catch(() => {});
  ecouter();
}
/** Venus délié : le flux s'arrête. */
export function arreter() { if (flux) flux.close(); }

/** Vérification (toutes les 30 s) : une écriture qui aurait échappé au suivi part ; empreintes comparées à Odin. */
export async function verifier() {
  if (!linked()) return { ok: false, skipped: 'pas relié' };
  try { if (diff(COLS)) await envoyer(); } catch (e) { etat.erreur = e.message; }
  reessayer();
  ecouter();
  return rattraper();
}

let started = false;
export function startOdinFiches() {
  if (started) return;
  started = true; etat.actif = true;
  lireOmbre();
  onWrite(noteWrite);
  const t = setInterval(() => { verifier().catch(() => {}); }, T.verif); t.unref?.();
  setTimeout(() => { if (linked()) { verifier().catch(() => {}); } }, 1000).unref?.();
}
