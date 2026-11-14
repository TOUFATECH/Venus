// Routes de Venus pour Odin : Réglages → Odin (lien, sauvegarde, restauration), connexion des utilisateurs par Odin
// (/auth/odin/debut → Odin → /auth/odin/retour), SSO du poste, et restauration à la première installation.
import { router } from './api.js';
import { HttpError, readBody, sendJson } from './http.js';
import { isSetup, requireAdmin, createToken, setTokenProfile, checkRate, failRate, resetRate } from './auth.js';
import { logSecurity } from './security.js';
import { logActivity } from './activity.js';
import { runtime } from './env.js';
import { discover } from './odin-net.js';
import { status as linkStatus, link, unlink, setMode, testAddress, login, keepLink, withToken, linkConf, check as checkLink, linked } from './odin-link.js';
import { sendNow, versions, download, restoreBuffer, rememberKeyWrap, state as backupState, baseEmpty, startOdinBackup, SKIP } from './odin-backup.js';
import { ssoOn, localBlocked, authorizeUrl, finish, issueTicket, takeTicket, posteAvailable, posteLogin, forgetOdinCache, linkedProfiles } from './odin-sso.js';

const supervised = () => runtime.kind === 'docker' || !!process.env.INVOCATION_ID || !!process.env.VENUS_SUPERVISED || (!!process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME !== '0');
const fail = (e, def = 502) => new HttpError(e.status && e.status >= 400 && e.status < 600 ? e.status : def, e.message);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pass = (v) => (typeof v === 'string' && v.length <= 200 ? v : '');
const portOf = (v) => Number(v) || 7777;
// Origine de Venus telle que le navigateur la voit (adresse de retour d'Odin, comparée exactement par Odin)
function origin(req) {
  const proto = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
  return `${proto}://${String(req.headers.host || 'localhost').replace(/[^\w.:[\]-]/g, '')}`;
}

// ---------------------------------------------------------------- écran de connexion
/** Ce que l'écran de connexion propose : Odin, la session du poste, les comptes de Venus, la restauration. */
router.get('/api/odin/connexion', async (ctx) => {
  const sso = ssoOn();
  const blocked = sso ? await localBlocked() : null;
  sendJson(ctx.res, {
    sso, local: !blocked, localMessage: blocked || null,
    poste: sso ? await posteAvailable(ctx.ip).catch(() => false) : false,
    restaurer: !isSetup() && baseEmpty(),
  });
});

const STATE_COOKIE = 'vn_odin_state';
const cookieOf = (req, name) => { const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie || '')); return m ? decodeURIComponent(m[1]) : ''; };
const redirect = (ctx, to, cookie) => { const h = { Location: to, 'Cache-Control': 'no-store' }; if (cookie) h['Set-Cookie'] = cookie; ctx.res.writeHead(302, h); ctx.res.end(); };

// Le navigateur part vers Odin (silencieux=1 : sans écran si une session Odin existe, sinon retour tout de suite)
router.get('/auth/odin/debut', async (ctx) => {
  checkRate('odin-sso', ctx.ip);
  let a;
  try { a = await authorizeUrl(origin(ctx.req), { silent: ctx.url.searchParams.get('silencieux') === '1' }); }
  catch (e) { return redirect(ctx, `/#odin_erreur=${encodeURIComponent(e.status === 400 ? e.message : `Odin ne répond pas : ${e.message}`)}`); }
  const secure = origin(ctx.req).startsWith('https:');
  redirect(ctx, a.url, `${STATE_COOKIE}=${encodeURIComponent(a.state)}; Path=/auth/odin; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`);
});
// Retour d'Odin : session Venus du profil de la personne, remise à la page par un ticket à usage unique
router.get('/auth/odin/retour', async (ctx) => {
  const clear = `${STATE_COOKIE}=; Path=/auth/odin; HttpOnly; SameSite=Lax; Max-Age=0`;
  try {
    const r = await finish(ctx.url.searchParams, cookieOf(ctx.req, STATE_COOKIE));
    const token = createToken(ctx.req.headers['user-agent'] || '');
    setTokenProfile(token, r.profile.id);
    resetRate('odin-sso', ctx.ip);
    logSecurity('connexion', ctx.ip, `« ${r.profile.name} » connecté par Odin${r.created ? ' (profil créé)' : ''}`, 'info');
    logActivity('login', `${r.profile.name} s’est connecté avec son compte Odin`);
    redirect(ctx, `/#odin=${issueTicket(token)}`, clear);
  } catch (e) {
    if (e.code === 'login_required') return redirect(ctx, '/#odin_rien=1', clear);
    if (e.status === 403) logSecurity('connexion', ctx.ip, `Connexion par Odin refusée : ${e.message}`, 'info');
    else failRate('odin-sso', ctx.ip, `Connexion par Odin ratée : ${e.message}`);
    redirect(ctx, `/#odin_erreur=${encodeURIComponent(e.message || 'Connexion par Odin impossible')}`, clear);
  }
});
router.post('/api/odin/ticket', async (ctx) => {
  const b = await readBody(ctx.req, 4096);
  checkRate('odin-ticket', ctx.ip);
  const token = takeTicket(str(b.ticket, 100));
  if (!token) { failRate('odin-ticket', ctx.ip, 'Ticket de connexion Odin inconnu'); throw new HttpError(401, 'Connexion par Odin expirée : recommence.'); }
  resetRate('odin-ticket', ctx.ip);
  sendJson(ctx.res, { token });
});
// SSO du poste : un navigateur de cette machine, un jeton de poste dans le coffre du système
router.post('/api/odin/poste', async (ctx) => {
  checkRate('odin-sso', ctx.ip);
  try {
    const r = await posteLogin(ctx.ip);
    const token = createToken(ctx.req.headers['user-agent'] || '');
    setTokenProfile(token, r.profile.id);
    logSecurity('connexion', ctx.ip, `« ${r.profile.name} » connecté par la session Odin du poste`, 'info');
    sendJson(ctx.res, { token });
  } catch (e) { throw fail(e, 401); }
});

// ---------------------------------------------------------------- première installation : restaurer depuis Odin
function firstInstall() { if (isSetup() || !baseEmpty()) throw new HttpError(409, 'Venus est déjà installé : la restauration se fait dans Réglages → Odin.'); }
router.post('/api/odin/premiere/trouver', async (ctx) => { firstInstall(); sendJson(ctx.res, { odins: await discover() }); });
router.post('/api/odin/premiere/versions', async (ctx) => {
  firstInstall();
  const b = await readBody(ctx.req, 8192);
  checkRate('odin-premiere', ctx.ip);
  const input = { host: str(b.host, 253), port: portOf(b.port), email: str(b.email), password: pass(b.password), code: str(b.code, 8) };
  let r;
  try { r = await login(input); } catch (e) { if (e.status === 401 && e.code !== 'code_requis') failRate('odin-premiere', ctx.ip, 'Restauration depuis Odin : connexion refusée'); return sendJson(ctx.res, { error: e.message, code: e.code || null }, e.status && e.status < 600 ? e.status : 502); }
  resetRate('odin-premiere', ctx.ip);
  keepLink(r, input); // Venus reste relié à ce compte : la sauvegarde continue ensuite
  try { sendJson(ctx.res, { versions: (await versions(withToken(r.base, r.fingerprint, r.tokens.access_token))).filter((v) => v.sorte === 'complete'), personne: { nom: r.personne.name || '', email: r.personne.email || '' }, odin: r.nom }); }
  catch (e) { throw fail(e); }
});
router.post('/api/odin/premiere/restaurer', async (ctx) => {
  firstInstall();
  if (!linked()) throw new HttpError(400, 'Connecte-toi d’abord à Odin');
  const b = await readBody(ctx.req, 8192);
  const version = str(b.version, 120), password = pass(b.password);
  let r;
  try { r = restoreBuffer(await download(version), { password, label: `première installation (${version})` }); }
  catch (e) { throw fail(e); }
  if (password) rememberKeyWrap(password, linkConf().email);
  logSecurity('installation', ctx.ip, `Venus restauré depuis Odin (sauvegarde ${version}, ${r.lignes} lignes)`, 'info');
  afterRestore();
  sendJson(ctx.res, { ok: true, ...r, restarting: supervised() });
  if (supervised()) setTimeout(() => process.exit(75), 800);
});
async function afterRestore() {
  try { const s = await import('./scanner.js'); s.watchLibraries(); s.scanAll(); } catch { /* le prochain démarrage le fera */ }
}

// ---------------------------------------------------------------- Réglages → Odin (administrateur)
router.get('/api/admin/odin/lien', (ctx) => {
  requireAdmin(ctx);
  sendJson(ctx.res, { ...linkStatus(), sauvegarde: backupState(), exclues: SKIP, profilsLies: linkedProfiles().length, supervise: supervised() });
});
router.post('/api/admin/odin/trouver', async (ctx) => { requireAdmin(ctx); sendJson(ctx.res, { odins: await discover() }); });
router.post('/api/admin/odin/tester', async (ctx) => {
  requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  try { const t = await testAddress(str(b.host, 253), portOf(b.port)); sendJson(ctx.res, { ok: true, nom: t.nom, version: t.version, url: t.url, certificat: t.fingerprint ? `${t.fingerprint.slice(0, 8)}…${t.fingerprint.slice(-8)}` : null, lien: linked() ? (await checkLink()) : null }); }
  catch (e) { sendJson(ctx.res, { ok: false, error: e.message }); }
});
router.post('/api/admin/odin/lien', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = await readBody(ctx.req, 8192);
  checkRate('odin-lien', ctx.ip);
  const input = { host: str(b.host, 253), port: portOf(b.port), email: str(b.email), password: pass(b.password), code: str(b.code, 8) };
  try {
    const s = await link(input, { onPassword: (pw, email) => rememberKeyWrap(pw, email) });
    resetRate('odin-lien', ctx.ip);
    forgetOdinCache();
    logSecurity('odin', ctx.ip, `${me.name} a relié Venus à Odin (${input.host}:${input.port})`, 'info');
    sendNow({ force: true, why: 'manuelle' }).catch(() => {});
    sendJson(ctx.res, s);
  } catch (e) {
    if (e.status === 401 && e.code !== 'code_requis') failRate('odin-lien', ctx.ip, 'Lien avec Odin : connexion refusée');
    sendJson(ctx.res, { error: e.message, code: e.code || null }, e.status && e.status < 600 ? e.status : 502);
  }
});
router.del('/api/admin/odin/lien', async (ctx) => {
  const me = requireAdmin(ctx);
  const s = await unlink();
  logSecurity('odin', ctx.ip, `${me.name} a délié Venus d’Odin`, 'info');
  sendJson(ctx.res, s);
});
router.put('/api/admin/odin/mode', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = await readBody(ctx.req, 1024);
  try { setMode(str(b.mode, 20)); } catch (e) { throw fail(e, 400); }
  logSecurity('odin', ctx.ip, `${me.name} a réglé la connexion par Odin : ${b.mode}`, 'info');
  sendJson(ctx.res, linkStatus());
});
router.post('/api/admin/odin/sauvegarde', async (ctx) => {
  requireAdmin(ctx);
  const r = await sendNow({ force: true, why: 'manuelle' });
  if (!r.ok) throw new HttpError(502, r.error || r.skipped || 'Sauvegarde impossible');
  sendJson(ctx.res, { ...r, sauvegarde: backupState() });
});
router.get('/api/admin/odin/versions', async (ctx) => {
  requireAdmin(ctx);
  try { sendJson(ctx.res, { versions: await versions() }); } catch (e) { throw fail(e); }
});
router.post('/api/admin/odin/versions/:id/restaurer', async (ctx) => {
  const me = requireAdmin(ctx);
  const b = await readBody(ctx.req, 4096);
  const password = pass(b.password);
  let r;
  try { r = restoreBuffer(await download(ctx.params.id), { password, label: `Réglages → Odin (${ctx.params.id})` }); }
  catch (e) { throw fail(e); }
  if (password) rememberKeyWrap(password, linkConf().email);
  logSecurity('odin', ctx.ip, `${me.name} a restauré la sauvegarde ${ctx.params.id} depuis Odin`, 'warn');
  logActivity('server', `${me.name} a restauré la sauvegarde ${ctx.params.id} depuis Odin`);
  afterRestore();
  sendJson(ctx.res, { ok: true, ...r, restarting: supervised() });
  if (supervised()) setTimeout(() => process.exit(75), 800);
});

startOdinBackup();
