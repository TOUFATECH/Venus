// Chaînes gratuites (France et Outre-mer), et vérification de toutes les chaînes IPTV.
//
// La source « venus:chaines-gratuites » est une liste construite par Venus à chaque analyse :
//  1. Mayotte La 1ère en tête, puis les autres chaînes La 1ère (Réunion, Guadeloupe, Martinique…)
//  2. les chaînes gratuites de la TNT (France 2, France 3, Arte, France Info…)
//  3. les chaînes françaises publiques recensées par iptv-org (France 24, TV5Monde, chaînes locales…)
// Les adresses des flux France Télévisions expirent chaque jour : ces listes publiques sont régénérées
// automatiquement, et Venus les relit à chaque analyse.
//
// La vérification ouvre chaque chaîne avec ffmpeg et attend une image : une chaîne qui n'en donne pas est
// marquée « hors service » et cachée de la page TV (on la revérifie le lendemain).
import { execFile } from 'node:child_process';
import { all, get, run, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { NET_INPUT } from './probe.js';

export const FREE_TV = 'venus:chaines-gratuites';
const PARATV = process.env.VENUS_PARATV_URL || 'https://raw.githubusercontent.com/Paradise-91/ParaTV/main';
const IPTV_ORG = process.env.VENUS_IPTVORG_URL || 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams';
// [fichier ParaTV, nom, identifiant du guide XML-TV-Fr]
const OUTREMER = [
  ['mayotte-1ere', 'Mayotte La 1ère', 'Mayotte1.fr'], ['reunion-1ere', 'Réunion La 1ère', 'Reunion1.fr'], ['guadeloupe-1ere', 'Guadeloupe La 1ère', 'Guadeloupe1.fr'], ['martinique-1ere', 'Martinique La 1ère', 'Martinique1.fr'],
  ['guyane-1ere', 'Guyane La 1ère', 'Guyane1.fr'], ['polynesie-1ere', 'Polynésie La 1ère', 'Polynesie1.fr'], ['nouvelle-caledonie-1ere', 'Nouvelle-Calédonie La 1ère', 'NouvelleCaledonie1.fr'],
  ['saint-pierre-et-miquelon-1ere', 'Saint-Pierre-et-Miquelon La 1ère', 'SaintPierreEtMiquelon1.fr'], ['wallis-et-futuna-1ere', 'Wallis-et-Futuna La 1ère', 'WallisEtFutuna1.fr'],
];
const LOGO_1ERE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/La_1%C3%A8re_logo_2018.svg/320px-La_1%C3%A8re_logo_2018.svg.png';

async function text(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 Venus' } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} : ${res.status}`);
  return res.text();
}
// Nom simplifié pour éviter les doublons (« 2. France 2 [1080p-france.tv] » = « France 2 (1080p) »)
const key = (name) => String(name).replace(/^\d+\.\s*/, '').replace(/\s*[[(].*?[\])]/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const clean = (name) => String(name).replace(/^\d+\.\s*/, '').replace(/\s*\[(SSAI|Geo-blocked|Not 24\/7)\]/gi, '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s*\((\d{3,4}p)\)\s*/i, ' ').trim();

const NOT_FRENCH = /\b(arabic|english|espa[nñ]ol|spanish|deutsch|german|germany|italiano|italian|portugu[eê]s|portuguese|greek|hungarian|hungary|russian|russia|czechia|spain|turkiye|latina?|latin america|asia|\bAR\b|\bEN\b|\bES\b|\bDE\b)\b/i;
// Chaînes payantes (bouquets Canal+, Orange…) : leurs flux « publics » sont des rediffusions non autorisées, on ne les reprend pas
const PAY_TV = /canal\s*\+(?!\s*en clair)|cin[eé]\s*\+|ocs|syfy|disney|nickelodeon|\bmtv\b|eurosport|mezzo|golf\s*\+|sony one|fashion\s*tv|trace|\bmcm\b|caillou|m6 music|nrj hits|equidia|national geographic|nat\s*geo|discovery|paramount|\bbein\b|rmc sport|tcm|warner|13e rue|planete\+|ushua[iï]a|histoire tv|toute l.histoire|seasons|game one|j-one|boomerang|cartoon/i;
export async function buildFreeTv() {
  // Le guide des programmes gratuit (XML-TV-Fr) est déclaré dans l'en-tête : Venus le télécharge tout seul
  const out = ['#EXTM3U url-tvg="venus:guide-fr"'];
  const seen = new Set();
  const add = (name, url, { logo = '', group = '', opts = [], id = '' } = {}) => {
    const k = key(name);
    // En français seulement : les versions en d'autres langues (France 24 English, TV5Monde Latin America…) sont écartées
    if (NOT_FRENCH.test(name) || PAY_TV.test(name)) return;
    if (!url || seen.has(k)) return;
    seen.add(k);
    out.push(`#EXTINF:-1 tvg-id="${id}" tvg-logo="${logo}" group-title="${group}",${clean(name)}`, ...opts, url);
  };
  // 1. Outre-mer : Mayotte La 1ère en premier
  for (const [file, name, id] of OUTREMER) add(name, `${PARATV}/streams/francetv/res/${file}-highest.m3u8`, { logo: LOGO_1ERE, group: 'Outre-mer', id });
  // 2. et 3. Listes publiques : la TNT gratuite, puis les chaînes françaises d'iptv-org
  const lists = [[`${PARATV}/playlists/paratv/group/france/france-highest.m3u`, 'TNT'], [`${IPTV_ORG}/fr.m3u`, '']];
  for (const [url, defGroup] of lists) {
    let t = '';
    try { t = await text(url); } catch (e) { console.warn('[chaînes gratuites]', e.message); continue; }
    let info = null, opts = [];
    for (const raw of t.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF')) { info = line; opts = []; }
      else if (line.startsWith('#EXTVLCOPT')) opts.push(line);
      else if (info && /^https?:\/\//i.test(line)) {
        const name = info.slice(info.lastIndexOf(',') + 1);
        // Flux protégés (DRM) ou remplacés par une image « indisponible » : inutiles
        if (/\/assets\/(drm|indisponible)\//i.test(line) || /\[SSAI\]/i.test(name)) { info = null; continue; }
        const logo = (/tvg-logo="([^"]*)"/i.exec(info) || [])[1] || '';
        const group = defGroup || ((/group-title="([^"]*)"/i.exec(info) || [])[1] || '').split(';')[0] || 'France';
        add(name, line, { logo, group, opts, id: (/tvg-id="([^"]*)"/i.exec(info) || [])[1] || '' });
        info = null;
      }
    }
  }
  return out.join('\n');
}

// Une chaîne fonctionne si ffmpeg en tire une image en moins de 25 s
function testOne(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...NET_INPUT(url).filter((x, i, a) => !/reconnect/.test(x) && !/reconnect/.test(a[i - 1] || '')),
      '-analyzeduration', '3M', '-probesize', '3M', '-i', url, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], { timeout: 25000, maxBuffer: 256 * 1024 }, (err, _o, stderr) => {
      if (!err) return resolve({ ok: true, ms: Date.now() - t0 });
      const msg = String(stderr || err.message || '').trim().split('\n').filter(Boolean).pop() || '';
      resolve({ ok: false, error: err.killed ? 'Aucune image reçue (délai dépassé)' : /403|forbidden/i.test(msg) ? 'Accès refusé (403)' : /404|not found/i.test(msg) ? 'Flux introuvable (404)' : /matches no streams|Stream map|opening output files/i.test(msg) ? 'Aucune image (flux vide ou injoignable)' : /timed out/i.test(msg) ? 'Le serveur de la chaîne ne répond pas' : /Input\/output error|Connection refused/i.test(msg) ? 'Chaîne injoignable' : msg.slice(0, 160) || 'Erreur' });
    });
  });
}

let running = null;
export const checkState = { running: false, done: 0, total: 0, ok: 0, bad: 0, at: Number(getSetting('iptv_check_at', 0)) || 0 };
// Vérifie les chaînes (toutes, celles d'une liste, ou seulement les jamais vérifiées) ; 4 à la fois
export function checkChannels({ libraryId = null, onlyNew = false, ids = null } = {}) {
  if (running) return running;
  running = (async () => {
    let list = all(`SELECT id, stream_url FROM items WHERE type = 'channel' AND stream_url IS NOT NULL${libraryId ? ' AND library_id = ?' : ''}${onlyNew ? ' AND ch_checked IS NULL' : ''} ORDER BY episode_num`, ...(libraryId ? [libraryId] : []));
    if (ids) list = list.filter((c) => ids.includes(c.id));
    Object.assign(checkState, { running: true, done: 0, total: list.length, ok: 0, bad: 0 });
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const c = list[i++];
        const r = await testOne(c.stream_url);
        run('UPDATE items SET ch_ok = ?, ch_checked = ?, ch_error = ? WHERE id = ?', r.ok ? 1 : 0, Date.now(), r.ok ? null : r.error, c.id);
        checkState.done++; if (r.ok) checkState.ok++; else checkState.bad++;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // Toutes en échec : c'est sans doute le serveur de Venus qui n'a pas accès à Internet, pas les chaînes.
    // On ne cache rien dans ce cas (sinon la page TV serait vide), et on le signale.
    checkState.offline = list.length > 3 && checkState.ok === 0;
    if (checkState.offline) run(`UPDATE items SET ch_ok = NULL WHERE id IN (${list.map(() => '?').join(',')})`, ...list.map((c) => c.id));
    checkState.running = false;
    checkState.at = Date.now();
    setSetting('iptv_check_at', checkState.at);
    return checkState.offline ? 'Aucune chaîne joignable : le serveur de Venus n’a sans doute pas accès à Internet' : `${checkState.ok} chaîne(s) fonctionnent, ${checkState.bad} hors service`;
  })().finally(() => { running = null; });
  return running;
}

// Première installation : la liste des chaînes gratuites est ajoutée une fois (on peut la retirer ensuite)
export function ensureFreeTv() {
  if (getSetting('free_tv_added', '0') === '1') return null;
  setSetting('free_tv_added', '1');
  if (get('SELECT 1 FROM libraries WHERE path = ?', FREE_TV)) return null;
  return Number(run('INSERT INTO libraries(name, type, path) VALUES(?, ?, ?)', 'Chaînes gratuites (France et Outre-mer)', 'iptv', FREE_TV).lastInsertRowid);
}
export const channelHealth = () => { const r = get("SELECT COUNT(*) n, SUM(ch_ok = 1) ok, SUM(ch_ok = 0) bad, SUM(ch_ok IS NULL) todo FROM items WHERE type = 'channel'"); return { n: r.n || 0, ok: r.ok || 0, bad: r.bad || 0, todo: r.todo || 0 }; };
