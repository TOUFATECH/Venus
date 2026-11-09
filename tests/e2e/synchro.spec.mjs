// Trakt (liaison par code, import de l'historique, envoi de ce qui est vu), import depuis Jellyfin et Plex,
// accès hors de la maison (tunnel), écran de veille. Les services extérieurs sont simulés par un petit serveur.
import http from 'node:http';
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

test.describe.configure({ mode: 'serial' });
const sent = [];
let mock;
const port = () => Number(new URL(etat().base).port) + 3;
const sql = async (fn) => { const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db')); try { return fn(db); } finally { db.close(); } };

test.beforeAll(async () => {
  let polls = 0;
  const media = path.join(etat().dir, 'media');
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      // --- Trakt
      if (u.pathname === '/oauth/device/code') return json(200, { device_code: 'dc1', user_code: 'AB12CD34', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 });
      if (u.pathname === '/oauth/device/token') return ++polls < 2 ? json(400, {}) : json(200, { access_token: 'jeton', refresh_token: 'renouv', expires_in: 7776000 });
      if (u.pathname === '/users/settings') return json(200, { user: { username: 'maou' } });
      if (u.pathname === '/sync/watched/movies') return json(200, [{ movie: { ids: { tmdb: 9001 } }, last_watched_at: '2026-10-01T20:00:00.000Z' }]);
      if (u.pathname === '/sync/watched/shows') return json(200, [{ show: { ids: { tmdb: 9100 } }, seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: '2026-10-02T20:00:00.000Z' }] }] }]);
      if (u.pathname === '/sync/playback') return json(200, [{ type: 'episode', progress: 40, paused_at: '2026-10-03T20:00:00.000Z', show: { ids: { tmdb: 9100 } }, episode: { season: 1, number: 2 } }]);
      if (u.pathname === '/sync/history' || u.pathname === '/sync/history/remove') { sent.push({ path: u.pathname, auth: req.headers.authorization, body: JSON.parse(body || '{}') }); return json(201, {}); }
      if (u.pathname === '/oauth/revoke') return json(200, {});
      // --- Jellyfin
      if (u.pathname === '/System/Info') return req.headers['x-emby-token'] === 'cle-jf' ? json(200, { ProductName: 'Jellyfin Server', Version: '10.10.7', ServerName: 'Salon' }) : json(401, {});
      if (u.pathname === '/Users') return json(200, [{ Id: 'u1', Name: 'Maou' }]);
      if (u.pathname === '/Users/u1/Items') {
        const types = u.searchParams.get('IncludeItemTypes'), f = u.searchParams.get('Filters');
        if (types === 'Series') return json(200, { Items: [{ Id: 's1', Name: 'Brigade Nord', ProviderIds: {} }] });
        if (f === 'IsPlayed') return json(200, { Items: [
          { Type: 'Movie', Name: 'Le Grand Voyage', Path: '/autre/disque/Le Grand Voyage (2019).mp4', UserData: { Played: true } },
          { Type: 'Episode', Name: 'Épisode 2', SeriesId: 's1', SeriesName: 'Brigade Nord', ParentIndexNumber: 2, IndexNumber: 1, Path: '/x/inconnu.mkv', UserData: { Played: true } },
          { Type: 'Movie', Name: 'Film absent', Path: '/x/absent.mkv', UserData: { Played: true } },
        ] });
        if (f === 'IsResumable') return json(200, { Items: [{ Type: 'Movie', Name: 'Nuit Blanche', Path: path.join(media, 'films', 'Nuit Blanche (2021).mp4'), UserData: { PlaybackPositionTicks: 600 * 1e7 } }] });
      }
      // --- Plex
      if (u.pathname === '/' && req.headers['x-plex-token']) return json(200, { MediaContainer: { version: '1.41', friendlyName: 'Plex du salon' } });
      if (u.pathname === '/library/sections') return json(200, { MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } });
      if (u.pathname === '/library/sections/1/all') return json(200, { MediaContainer: { Metadata: [{ title: 'Orage', viewCount: 1, lastViewedAt: 1790000000, Media: [{ Part: [{ file: '/plex/Orage (2018).mp4' }] }] }] } });
      json(404, {});
    });
  });
  await new Promise((r) => mock.listen(port(), '127.0.0.1', r));
});
test.afterAll(() => mock && mock.close());

test('Trakt : relier le compte avec un code, importer l’historique, envoyer ce qui est vu', async ({ page, api }) => {
  const lib = await api('/api/library');
  const orage = lib.find((x) => x.title === 'Orage'), bn = lib.find((x) => /Brigade Nord/.test(x.title)), nuit = lib.find((x) => x.title === 'Nuit Blanche');
  await sql((db) => {
    db.prepare("INSERT INTO settings(key, value) VALUES('trakt_client_id', '\"id-test\"'), ('trakt_client_secret', '\"secret-test\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    db.prepare('UPDATE items SET tmdb_id = 9001 WHERE id = ?').run(orage.id);
    db.prepare('UPDATE items SET tmdb_id = 9100 WHERE id = ?').run(bn.id);
    db.prepare('UPDATE items SET tmdb_id = 9002 WHERE id = ?').run(nuit.id);
    db.prepare('DELETE FROM progress').run();
  });
  await ouvrir(page, '/reglages?onglet=profil');
  await page.getByRole('button', { name: 'Relier mon compte Trakt' }).click();
  await expect(page.locator('.trakt-code-v')).toHaveText('AB12CD34');
  await expect(page.getByText(/Relié au compte Trakt « maou »/)).toBeVisible({ timeout: 15_000 });
  // Historique importé : Orage vu, S01E01 vu, S01E02 repris à 40 %
  await expect.poll(async () => (await api('/api/trakt')).lastImport, { timeout: 10_000 }).toBeTruthy();
  const st = await api('/api/trakt');
  expect(st.imported).toEqual({ movies: 1, episodes: 1, resumed: 1 });
  const rows = await sql((db) => db.prepare('SELECT i.title, i.season_num s, i.episode_num e, p.watched, p.position FROM progress p JOIN items i ON i.id = p.item_id').all());
  expect(rows.find((r) => r.title === 'Orage').watched).toBe(1);
  expect(rows.find((r) => r.s === 1 && r.e === 1).watched).toBe(1);
  expect(rows.find((r) => r.s === 1 && r.e === 2).position).toBeGreaterThan(0);
  // Vu dans Venus → envoyé à Trakt
  await api(`/api/items/${nuit.id}/watched`, { method: 'POST', body: { watched: true } });
  await expect.poll(() => sent.filter((x) => x.path === '/sync/history').length, { timeout: 10_000 }).toBeGreaterThan(0);
  const h = sent.find((x) => x.path === '/sync/history');
  expect(h.auth).toBe('Bearer jeton');
  expect(h.body.movies[0].ids.tmdb).toBe(9002);
  // Décoché → retiré de Trakt
  await api(`/api/items/${nuit.id}/watched`, { method: 'POST', body: { watched: false } });
  await expect.poll(() => sent.filter((x) => x.path === '/sync/history/remove').length, { timeout: 10_000 }).toBe(1);
  // Les jetons sont chiffrés dans la base
  const raw = await sql((db) => db.prepare("SELECT value FROM settings WHERE key LIKE 'trakt_auth:%'").get());
  expect(raw.value).not.toContain('jeton');
  await page.getByRole('button', { name: 'Délier' }).click();
  await page.getByRole('button', { name: 'Délier' }).last().click();
  await expect(page.getByRole('button', { name: 'Relier mon compte Trakt' })).toBeVisible();
});

test('import depuis Jellyfin (par l’interface) et Plex', async ({ page, api }) => {
  await sql((db) => db.prepare('DELETE FROM progress').run());
  await ouvrir(page, '/reglages?onglet=import');
  await page.getByPlaceholder('http://192.168.1.126:8097').fill(`http://127.0.0.1:${port()}`);
  await page.locator('#import input[type=password]').fill('cle-jf');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(/Jellyfin Server 10.10.7 · Salon/)).toBeVisible();
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(page.locator('.import-res')).toContainText('2 vu(s)');
  await expect(page.locator('.import-res')).toContainText('1 lecture(s) en cours');
  await expect(page.locator('.import-res')).toContainText('1 absent(s) de Venus');
  const rows = await sql((db) => db.prepare('SELECT i.title, i.season_num s, i.episode_num e, p.watched, p.position FROM progress p JOIN items i ON i.id = p.item_id').all());
  expect(rows.find((r) => r.title === 'Le Grand Voyage').watched).toBe(1); // retrouvé par le nom du fichier
  expect(rows.find((r) => r.s === 2 && r.e === 1).watched).toBe(1);        // retrouvé par série + numéro
  expect(rows.find((r) => r.title === 'Nuit Blanche').position).toBe(600);
  // Plex (par l'API) : Orage vu
  const profiles = (await api('/api/admin')).profiles;
  const chk = await api('/api/admin/import/check', { method: 'POST', body: { kind: 'plex', url: `127.0.0.1:${port()}`, token: 'jeton-plex' } });
  expect(chk.name).toBe('Plex du salon');
  const r = await api('/api/admin/import/run', { method: 'POST', body: { kind: 'plex', url: `http://127.0.0.1:${port()}`, token: 'jeton-plex', profileId: profiles[0].id } });
  expect(r.watched).toBe(1);
  await sql((db) => db.prepare('DELETE FROM progress').run());
});

test('accès hors de la maison : lien rapide, puis coupure', async ({ page, api }) => {
  await ouvrir(page, '/reglages?onglet=distance');
  await page.getByRole('button', { name: 'Créer un lien rapide' }).click();
  await page.getByRole('button', { name: 'Créer le lien' }).click();
  await expect(page.locator('.remote-state a')).toHaveText('https://essai-venus.trycloudflare.com');
  await expect(page.locator('.remote-state b')).toHaveText('En ligne');
  // Une visite par le tunnel n'est jamais « à la maison »
  // Visite par le tunnel (HTTPS côté Cloudflare) : servie normalement, mais comptée comme venant d'Internet
  const viaTunnel = await page.request.get('/api/status', { headers: { 'cf-ray': 'test', 'cf-connecting-ip': '8.8.8.8', 'cf-visitor': '{"scheme":"https"}' }, maxRedirects: 0 });
  expect(viaTunnel.status()).toBe(200);
  // Sans « https » côté visiteur : renvoyé vers HTTPS (jamais traité comme le réseau de la maison)
  const plain = await page.request.get('/api/status', { headers: { 'cf-ray': 'test', 'cf-connecting-ip': '8.8.8.8' }, maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(plain.status());
  await page.getByRole('button', { name: 'Couper l’accès' }).click();
  await expect(page.locator('.remote-state b')).toHaveText('Désactivé');
  expect((await api('/api/admin/remote')).mode).toBe('off');
});

test('écran de veille : apparaît sans activité, disparaît au premier geste', async ({ page }) => {
  await sql((db) => db.prepare("UPDATE items SET backdrop = poster WHERE type = 'season' AND poster IS NOT NULL").run());
  await sql((db) => { const p = db.prepare("SELECT poster FROM items WHERE type = 'season' AND poster IS NOT NULL LIMIT 1").get(); db.prepare("UPDATE items SET backdrop = ? WHERE type IN ('movie', 'show')").run(p.poster); });
  await page.addInitScript(() => localStorage.setItem('vn_pref_screensaver', '0.05')); // 3 secondes
  await ouvrir(page, '/films');
  await expect(page.locator('.saver')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.saver-clock b')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('.saver-cap b')).not.toBeEmpty();
  await page.keyboard.press('Enter');
  await expect(page.locator('.saver')).toHaveCount(0);
  await expect(page).toHaveURL(/\/films$/); // la touche n'a rien ouvert
});
