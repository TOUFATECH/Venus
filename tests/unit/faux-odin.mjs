// Faux Odin pour les essais de Venus, fidèle au contrat « docs/sso-protocole.md » d'Odin (version 1) :
// découverte OpenID, /sso/autoriser (code + PKCE S256, state obligatoire, prompt=none, session du navigateur),
// /sso/jeton (code à usage unique, rotation des jetons de renouvellement liés à l'appareil), /sso/infos, /sso/cles (ES256),
// /sso/connexion (identifiant + mot de passe + double authentification), /sso/poste, /sso/echange, /sso/revoquer,
// /api/sauvegardes/<appli> (envoyer, lister, empreinte, télécharger, restauree). En http ou en https (certificat
// auto-signé fabriqué par openssl), au choix.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export async function fauxOdin({ tls = false, owner = 'Awa' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = sha(JSON.stringify([jwk.x, jwk.y])).slice(0, 16);
  const people = new Map(); // identifiant -> personne
  const rights = { venus: ['famille', 'admin'], pegase: ['famille', 'admin', 'invite'], odin: ['admin'] };
  const codes = new Map(), refresh = new Map(), access = new Set(), postes = new Map(), browserSessions = new Map();
  const backups = new Map(); // `${sub}|${appli}` -> [versions]
  const log = [];
  const S = { issuer: '', restaurer: null, maxSize: 500 * 1024 * 1024, redirects: [] };

  const addPerson = (p) => { const x = { sub: crypto.randomBytes(5).toString('hex'), groups: ['famille'], twofa: null, ...p }; people.set(x.preferred_username, x); return x; };
  const find = (id) => [...people.values()].find((p) => p.preferred_username === id || (p.email && p.email.toLowerCase() === String(id).toLowerCase()));
  const allowed = (p, app) => p.groups.includes('admin') || (rights[app] || []).some((g) => g === '*' || p.groups.includes(g));
  const refusal = (app) => `Tu n'as pas accès à ${app === 'venus' ? 'Vénus' : app}. Demande à ${owner} de t'ajouter au groupe famille.`;
  const claims = (p) => ({ sub: p.sub, preferred_username: p.preferred_username, name: p.name, email: p.email, groups: p.groups });
  const sign = (head, body) => {
    const h = b64u(JSON.stringify(head)), b = b64u(JSON.stringify(body));
    const s = crypto.sign('sha256', Buffer.from(`${h}.${b}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `${h}.${b}.${b64u(s)}`;
  };
  function tokensFor(p, app, { nonce, device, offline = true } = {}) {
    const now = Math.floor(Date.now() / 1000), sid = crypto.randomBytes(5).toString('hex');
    const at = sign({ alg: 'ES256', typ: 'at+jwt', kid }, { iss: S.issuer, sub: p.sub, aud: app, client_id: app, iat: now, exp: now + 900, jti: b64u(crypto.randomBytes(8)), sid, scope: 'openid profile email groups', ...claims(p) });
    const it = sign({ alg: 'ES256', typ: 'JWT', kid }, { iss: S.issuer, sub: p.sub, aud: app, iat: now, exp: now + 900, auth_time: now, sid, ...(nonce ? { nonce } : {}), ...claims(p) });
    access.add(at);
    const out = { access_token: at, token_type: 'Bearer', expires_in: 900, id_token: it, scope: 'openid profile email groups' };
    if (offline) { const rt = `odr1.${sid}.${b64u(crypto.randomBytes(24))}`; refresh.set(rt, { sub: p.sub, app, device, sid, used: false }); out.refresh_token = rt; }
    return out;
  }
  const personOfAccess = (req) => {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Bearer ')) return { err: [401, 'jeton_requis', 'Connexion requise.'] };
    const t = h.slice(7);
    if (!access.has(t)) return { err: [401, 'jeton_invalide', 'Jeton expiré ou révoqué.'] };
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
    if (p.exp * 1000 < Date.now()) return { err: [401, 'jeton_invalide', 'Jeton expiré.'] };
    const person = [...people.values()].find((x) => x.sub === p.sub);
    if (!person || person.off) return { err: [401, 'jeton_invalide', 'Session révoquée.'] };
    return { person, claims: p };
  };
  const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
  const bad = (res, status, code, message, extra = {}) => json(res, status, { ok: false, code, message, ...extra });
  const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const parse = (req, buf) => { const t = String(req.headers['content-type'] || ''); if (t.includes('json')) { try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return null; } } return Object.fromEntries(new URLSearchParams(buf.toString('utf8'))); };
  const cookie = (req, name) => { const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie || '')); return m ? m[1] : ''; };

  async function route(req, res) {
    const u = new URL(req.url, S.issuer);
    const p = u.pathname;
    log.push(`${req.method} ${p}`);
    if (p === '/.well-known/openid-configuration') {
      return json(res, 200, { issuer: S.issuer, authorization_endpoint: `${S.issuer}/sso/autoriser`, token_endpoint: `${S.issuer}/sso/jeton`, userinfo_endpoint: `${S.issuer}/sso/infos`, jwks_uri: `${S.issuer}/sso/cles`, end_session_endpoint: `${S.issuer}/sso/deconnexion`, revocation_endpoint: `${S.issuer}/sso/revoquer`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['ES256'], odin: { protocole: 1, nom: 'Odin', version: 'essai' } });
    }
    if (p === '/sso/cles') return json(res, 200, { keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, use: 'sig', alg: 'ES256' }] });
    if (p === '/sso/autoriser') {
      const q = req.method === 'POST' ? new URLSearchParams((await body(req)).toString('utf8')) : u.searchParams;
      const app = q.get('client_id'), redirect = q.get('redirect_uri'), state = q.get('state');
      if (app !== 'venus' && app !== 'pegase') { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('appli inconnue'); }
      if (!S.redirects.includes(redirect)) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('adresse de retour non déclarée'); }
      const back = (params) => { res.writeHead(303, { location: `${redirect}?${new URLSearchParams({ ...params, ...(state ? { state } : {}), iss: S.issuer })}`, ...(params.setCookie ? {} : {}) }); res.end(); };
      if (!state || state.length < 8) return back({ error: 'invalid_request', error_description: 'state obligatoire' });
      if (!/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') || '') || q.get('code_challenge_method') !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE obligatoire' });
      let person = browserSessions.get(cookie(req, 'odin_var'));
      let setCookie = '';
      if (!person && req.method === 'POST') {
        const who = find(q.get('identifiant') || '');
        if (!who || who.password !== q.get('motdepasse')) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('Identifiant ou mot de passe incorrect.'); }
        person = who; const sid = b64u(crypto.randomBytes(16)); browserSessions.set(sid, who); setCookie = `odin_var=${sid}; Path=/sso; HttpOnly; SameSite=Lax`;
      }
      if (!person) {
        if (q.get('prompt') === 'none') return back({ error: 'login_required', error_description: 'Pas de session Odin dans ce navigateur.' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<form method="post">portail Persona</form>');
      }
      const go = (params) => { res.writeHead(303, { location: `${redirect}?${new URLSearchParams({ ...params, state, iss: S.issuer })}`, ...(setCookie ? { 'set-cookie': setCookie } : {}) }); res.end(); };
      if (!allowed(person, app)) return go({ error: 'access_denied', error_description: refusal(app) });
      const code = b64u(crypto.randomBytes(24));
      codes.set(code, { person, app, redirect, challenge: q.get('code_challenge'), nonce: q.get('nonce'), at: Date.now(), offline: /offline_access/.test(q.get('scope') || '') });
      return go({ code });
    }
    if (p === '/sso/jeton' && req.method === 'POST') {
      const b = parse(req, await body(req)) || {};
      if (b.grant_type === 'authorization_code') {
        const c = codes.get(b.code);
        codes.delete(b.code);
        if (!c || Date.now() - c.at > 60_000 || c.redirect !== b.redirect_uri || c.app !== b.client_id) return json(res, 400, { error: 'invalid_grant', error_description: 'Ce code a déjà servi ou il a expiré : recommence la connexion.', message: 'Ce code a déjà servi ou il a expiré : recommence la connexion.' });
        if (b64u(crypto.createHash('sha256').update(String(b.code_verifier || '')).digest()) !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'Preuve PKCE fausse.', message: 'Preuve PKCE fausse.' });
        return json(res, 200, tokensFor(c.person, c.app, { nonce: c.nonce, device: b.appareil, offline: c.offline }));
      }
      if (b.grant_type === 'refresh_token') {
        const r = refresh.get(b.refresh_token);
        if (!r) return json(res, 400, { error: 'invalid_grant', error_description: 'Session révoquée : reconnecte-toi.', message: 'Session révoquée : reconnecte-toi.' });
        if (r.used) { for (const [k, v] of refresh) if (v.sid === r.sid) refresh.delete(k); return json(res, 400, { error: 'invalid_grant', error_description: 'Jeton déjà servi : session coupée.', message: 'Jeton déjà servi : session coupée.' }); }
        if (r.device && r.device !== b.appareil) return json(res, 400, { error: 'invalid_grant', error_description: 'Autre appareil.', message: 'Autre appareil.' });
        r.used = true;
        const person = [...people.values()].find((x) => x.sub === r.sub);
        if (!allowed(person, r.app)) return json(res, 403, { error: 'access_denied', error_description: refusal(r.app), message: refusal(r.app) });
        S.refreshes = (S.refreshes || 0) + 1;
        return json(res, 200, tokensFor(person, r.app, { device: r.device }));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (p === '/sso/infos') {
      const a = personOfAccess(req);
      if (a.err) return bad(res, ...a.err);
      return json(res, 200, { ...claims(a.person), applis: Object.keys(rights).filter((k) => allowed(a.person, k)), appli: a.claims.aud });
    }
    if (p === '/sso/connexion' && req.method === 'POST') {
      const b = parse(req, await body(req)) || {};
      const who = find(b.identifiant || '');
      if (!who || who.password !== b.motdepasse) return bad(res, 401, 'identifiants', 'Identifiant ou mot de passe incorrect.');
      if (who.twofa && !b.code) return bad(res, 401, 'code_requis', 'Entre le code à 6 chiffres de ton application.');
      if (who.twofa && b.code !== who.twofa) return bad(res, 401, 'code_faux', 'Code faux : recommence avec ton mot de passe et un nouveau code.');
      if (!rights[b.appli]) return bad(res, 404, 'appli_inconnue', 'Appli inconnue.');
      if (!allowed(who, b.appli)) return bad(res, 403, 'refuse', refusal(b.appli));
      if (!b.appareil || !/^[A-Za-z0-9_-]{8,64}$/.test(b.appareil.id || '')) return bad(res, 400, 'requete_invalide', 'appareil.id manquant');
      return json(res, 200, { ok: true, ...tokensFor(who, b.appli, { device: b.appareil.id }), personne: claims(who), appli: b.appli, applis: Object.keys(rights).filter((k) => allowed(who, k)) });
    }
    if (p === '/sso/poste' && req.method === 'POST') {
      const a = personOfAccess(req);
      if (a.err) return bad(res, ...a.err);
      const b = parse(req, await body(req)) || {};
      if (!b.appareil || !b.appareil.id) return bad(res, 400, 'requete_invalide', 'appareil.id manquant');
      const t = `odp1.${crypto.randomBytes(5).toString('hex')}.${b64u(crypto.randomBytes(24))}`;
      postes.set(t, { sub: a.person.sub, device: b.appareil.id, user: b.utilisateur });
      return json(res, 200, { ok: true, jeton_poste: t, poste: { id: t.split('.')[1], expire: Date.now() + 90 * 864e5 } });
    }
    if (p === '/sso/echange' && req.method === 'POST') {
      const b = parse(req, await body(req)) || {};
      const x = postes.get(b.jeton_poste);
      if (!x || (b.appareil && x.device !== b.appareil.id) || x.user !== b.utilisateur) return bad(res, 401, 'jeton_poste_invalide', 'La session Odin de ce poste n’est plus valable : reconnecte-toi.');
      const who = [...people.values()].find((q) => q.sub === x.sub);
      if (!allowed(who, b.appli)) return bad(res, 403, 'refuse', refusal(b.appli));
      return json(res, 200, { ok: true, ...tokensFor(who, b.appli, { device: x.device }), personne: claims(who), appli: b.appli });
    }
    if (p === '/sso/revoquer' && req.method === 'POST') {
      const b = parse(req, await body(req)) || {};
      if (b.jeton_poste) postes.delete(b.jeton_poste);
      if (b.token) { const r = refresh.get(b.token); if (r) for (const [k, v] of refresh) if (v.sid === r.sid) refresh.delete(k); }
      return json(res, 200, { ok: true });
    }
    const m = /^\/api\/sauvegardes\/(\w+)(?:\/([\w.:-]+))?$/.exec(p);
    if (m) {
      const a = personOfAccess(req);
      if (a.err) return bad(res, ...a.err);
      if (a.claims.aud !== m[1]) return bad(res, 403, 'mauvaise_appli', 'Jeton d’une autre appli.');
      const key = `${a.person.sub}|${m[1]}`;
      const list = backups.get(key) || [];
      backups.set(key, list);
      if (!m[2] && req.method === 'POST') {
        const buf = await body(req);
        const want = String(req.headers['x-odin-empreinte'] || '');
        if (want !== sha(buf)) return bad(res, 400, 'empreinte_fausse', 'L’empreinte ne correspond pas au contenu.');
        if (buf.length > S.maxSize) return bad(res, 413, 'trop_gros', 'Sauvegarde trop grosse.', { limite: S.maxSize });
        const last = list[0];
        if (last && last.empreinte === want) return json(res, 200, { ok: true, inchange: true, version: last.meta });
        const id = `v${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}-${crypto.randomBytes(2).toString('hex')}`;
        const meta = { id, date: Date.now(), taille: buf.length, empreinte: want, sorte: String(req.headers['x-odin-sorte'] || 'complete'), raison: decodeURIComponent(String(req.headers['x-odin-raison'] || '')), nom: decodeURIComponent(String(req.headers['x-odin-nom'] || '')), base: null, appareil: 'Serveur Vénus' };
        list.unshift({ meta, buf, empreinte: want });
        return json(res, 201, { ok: true, inchange: false, version: meta });
      }
      if (!m[2] && req.method === 'GET') return json(res, 200, { ok: true, appli: m[1], versions: list.map((v) => v.meta), derniere: list[0] ? list[0].meta : null, taille_totale: list.reduce((n, v) => n + v.buf.length, 0), taille_max: S.maxSize, restaurer: S.restaurer });
      if (m[2] === 'empreinte') return json(res, 200, { ok: true, empreinte: list[0] ? list[0].empreinte : null, version: list[0] ? list[0].meta.id : null, date: list[0] ? list[0].meta.date : null, restaurer: S.restaurer });
      if (m[2] === 'restauree' && req.method === 'POST') { S.restaurer = null; S.restauree = (parse(req, await body(req)) || {}).version; return json(res, 200, { ok: true }); }
      const v = list.find((x) => x.meta.id === m[2]);
      if (!v) return bad(res, 404, 'introuvable', 'Version de sauvegarde inconnue.');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-odin-empreinte': v.empreinte, 'x-odin-sorte': v.meta.sorte, 'content-disposition': `attachment; filename="${v.meta.nom || 'sauvegarde'}"` });
      return res.end(v.buf);
    }
    return bad(res, 404, 'introuvable', 'Route inconnue.');
  }

  let server, tmp;
  const handler = (req, res) => { route(req, res).catch((e) => { try { json(res, 500, { ok: false, code: 'erreur', message: e.message }); } catch { /* */ } }); };
  if (tls) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'faux-odin-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '2', '-subj', '/CN=odin-essai'], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, handler);
  } else server = http.createServer(handler);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  S.issuer = `${tls ? 'https' : 'http'}://127.0.0.1:${port}`;
  const certFp = tls ? new crypto.X509Certificate(fs.readFileSync(path.join(tmp, 'c.pem'))).fingerprint256.replace(/:/g, '').toLowerCase() : null;
  return {
    port, url: S.issuer, S, people, rights, backups, log, addPerson, certFp, postes,
    /** Ouvre une session Odin « dans le navigateur » de cette personne (cookie odin_var). */
    browserSession(id) { const sid = b64u(crypto.randomBytes(16)); browserSessions.set(sid, find(id)); return `odin_var=${sid}`; },
    /** Un jeton de poste pour cette personne (comme si Pégase l'avait rangé dans le coffre). */
    posteFor(id, device, user) { const t = `odp1.${crypto.randomBytes(5).toString('hex')}.${b64u(crypto.randomBytes(24))}`; postes.set(t, { sub: find(id).sub, device, user }); return t; },
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }),
  };
}
