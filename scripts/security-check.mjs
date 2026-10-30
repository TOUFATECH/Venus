// Vérification automatique des protections de Venus (npm run security, et chaque semaine sur GitHub).
// Démarre un serveur Venus jetable dans un dossier temporaire, puis tente les attaques classiques :
// force brute, CSRF, CORS, injection de types, pollution de prototype, remontée de dossiers, HPP,
// en-têtes de sécurité, jeton invalide, images sans session.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-secu-'));
const port = 18000 + Math.floor(Math.random() * 1000);
const B = `http://127.0.0.1:${port}`;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
  cwd: root, env: { ...process.env, DATA_DIR: dir, TRANSCODE_DIR: path.join(dir, 't'), PORT: String(port), HTTPS: '0', NODE_ENV: 'production', MOVIES_PATH: dir, SHOWS_PATH: dir }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; srv.stdout.on('data', (d) => { logs += d; }); srv.stderr.on('data', (d) => { logs += d; });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };
const req = (p, o = {}) => fetch(B + p, { redirect: 'manual', ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${B}/api/status`); break; } catch { await wait(250); } }
  // Installation avec un mot de passe faible : refusée
  let r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: '1234', name: 'Admin', pin: '1234' }) });
  check('Mot de passe faible refusé à l’installation', r.status === 400);
  r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'Un-Mot-de-passe-solide-42', name: 'Admin', pin: '4321' }) });
  const { token } = await r.json();
  check('Installation avec un mot de passe solide', r.ok && /^[\w-]{43}$/.test(token || ''));
  const auth = { authorization: `Bearer ${token}` };

  // En-têtes
  r = await fetch(`${B}/`);
  const csp = r.headers.get('content-security-policy') || '';
  check('Content-Security-Policy', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
  check('Anti-clickjacking (X-Frame-Options)', r.headers.get('x-frame-options') === 'DENY');
  check('nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  check('Pas d’en-tête X-Powered-By', !r.headers.get('x-powered-by'));

  // CORS / CSRF
  r = await req('/api/login', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  check('CORS : autre origine refusée sur l’API', r.status === 403 && !r.headers.get('access-control-allow-origin'));
  r = await req('/api/profiles', { method: 'POST', headers: { ...auth, origin: 'https://evil.example' }, body: JSON.stringify({ name: 'x' }) });
  check('CSRF : requête venant d’un autre site refusée', r.status === 403);
  r = await req('/api/profiles/1', { method: 'PUT', headers: { cookie: `vn_token=${token}` }, body: JSON.stringify({ name: 'pirate' }) });
  check('CSRF : le cookie seul ne permet pas de modifier', r.status === 401);

  // Validation et injections
  r = await req('/api/login', { method: 'POST', body: JSON.stringify({ password: { $ne: '' } }) });
  check('Injection d’objet (type « NoSQL ») refusée', r.status === 400);
  r = await req('/api/profiles', { method: 'POST', headers: auth, body: '{"name":"Test","__proto__":{"isAdmin":true},"constructor":{"x":1}}' });
  const prof = await r.json();
  check('Pollution de prototype neutralisée', r.ok && prof.isAdmin === false);
  r = await req('/api/library?type=movie&type=show', { headers: auth });
  check('HPP : paramètre en double refusé', r.status === 400);
  r = await req('/api/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: "x'); DROP TABLE profiles;--" }) });
  const after = await (await req('/api/profiles', { headers: auth })).json();
  check('Injection SQL sans effet (requêtes paramétrées)', r.ok && Array.isArray(after) && after.length >= 3);
  r = await req('/api/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'x'.repeat(5000) }) });
  check('Texte trop long refusé', r.status === 400);

  // Chemins
  r = await fetch(`${B}/img/..%2f..%2fvenus.db`);
  check('Remontée de dossiers refusée', r.status === 400);
  r = await fetch(`${B}/.env`);
  check('Recherche de fichiers sensibles bloquée', r.status === 404);

  // Sessions
  r = await req('/api/me', { headers: { authorization: 'Bearer abc' } });
  check('Jeton mal formé refusé', r.status === 401);
  r = await req('/api/me', { headers: { authorization: `Bearer ${'A'.repeat(43)}` } });
  check('Jeton inconnu refusé', r.status === 401);
  r = await fetch(`${B}/img/x.jpg`);
  check('Images réservées aux appareils connectés', r.status === 401);
  r = await req('/api/admin/security', { headers: auth });
  check('Tableau de sécurité accessible à l’administrateur', r.ok);
  r = await req('/api/login', { method: 'POST', body: JSON.stringify({ password: 'Un-Mot-de-passe-solide-42' }) });
  const t2 = (await r.json()).token;
  const auth2 = { authorization: `Bearer ${t2}` };
  r = await req('/api/admin/security', { headers: auth2 });
  check('Route d’administration sans profil choisi refusée', r.status === 401 || r.status === 403);
  r = await req('/api/profiles/1/select', { method: 'POST', headers: auth2, body: JSON.stringify({}) });
  check('Profil administrateur protégé par son code PIN', r.status === 403);
  r = await req('/api/profiles/1/select', { method: 'POST', headers: auth2, body: JSON.stringify({ pin: '4321' }) });
  check('Bon code PIN accepté', r.ok);

  // Force brute
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await req('/api/login', { method: 'POST', body: JSON.stringify({ password: `faux-${i}` }) })).status);
  check('Force brute : pause après 5 essais', codes.slice(0, 5).every((c) => c === 401) && codes.slice(5).every((c) => c === 429), codes.join(','));

  // Erreurs sans détails
  r = await req('/api/items/abc', { headers: auth });
  const body = await r.text();
  check('Pas de trace technique dans les erreurs', !/at \w+ \(|node:internal|\.js:\d+/.test(body));
} catch (e) {
  check('Exécution du test', false, e.message);
} finally {
  srv.kill();
  await wait(300);
  fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} protections vérifiées`);
if (failed.length) { console.log(logs.slice(-2000)); process.exit(1); }
