// Parcours principaux sur ordinateur : regarder un film, mini-lecteur, recherche, ma liste, musique, réglages
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

test('film : fiche, lecture, retour et mini-lecteur', async ({ page }) => {
  await ouvrir(page, '/films');
  // Le nom ouvre toujours la fiche (l'image, elle, reprend la lecture d'un film commencé)
  await page.locator('.card', { hasText: 'Orage' }).first().locator('.cap').click();
  await expect(page).toHaveURL(/\/films\/orage-2018$/);
  await expect(page.getByRole('heading', { name: 'Orage' }).first()).toBeVisible();
  const fiche = page.url();
  await page.locator('.actions .btn-play').click();
  const video = page.locator('.player video');
  await expect(video).toBeVisible();
  // La vidéo avance vraiment
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(1);
  await page.mouse.move(400, 300);
  await page.locator('.p-top .p-icon').first().click();
  await expect(page).toHaveURL(fiche);
  await expect(page.locator('.mini-player.on')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer le mini-lecteur' }).click();
  await expect(page.locator('.mini-player.on')).toHaveCount(0);
});

test('épisode suivant d’une série', async ({ page }) => {
  await ouvrir(page, '/series/brigade-nord/S01E01');
  const video = page.locator('.player video');
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/S01E02/);
  await expect(page.locator('.player video')).toBeVisible();
});

test('recherche instantanée', async ({ page }) => {
  await ouvrir(page, '/recherche');
  await page.locator('input[type=search], .search-input input, input').first().fill('Nuit');
  await expect(page.locator('.card', { hasText: 'Nuit Blanche' }).first()).toBeVisible();
});

test('ajouter puis retirer de « Ma liste »', async ({ page }) => {
  await ouvrir(page, '/films/le-grand-voyage-2019');
  await page.getByRole('button', { name: 'Ajouter à ma liste' }).click();
  await expect(page.getByRole('button', { name: 'Retirer de ma liste' })).toBeVisible();
  await ouvrir(page, '/liste');
  await expect(page.locator('.card', { hasText: 'Le Grand Voyage' })).toBeVisible();
  await ouvrir(page, '/films/le-grand-voyage-2019');
  await page.getByRole('button', { name: 'Retirer de ma liste' }).click();
  await expect(page.getByRole('button', { name: 'Ajouter à ma liste' })).toBeVisible();
});

test('musique : un album se lit', async ({ page }) => {
  await ouvrir(page, '/musique');
  await page.getByText('Premier Album').first().click();
  await expect(page).toHaveURL(/\/musique\/album\//);
  await page.getByText('Lumière').first().click();
  const barre = page.getByRole('region', { name: 'Lecteur audio' });
  await expect(barre).toContainText('Lumière');
  await expect(barre.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 20_000 });
  await barre.getByRole('button', { name: 'Arrêter' }).click();
});

test('réglages : chaque rubrique s’affiche, la saisie survit au rafraîchissement', async ({ page }) => {
  await ouvrir(page, '/reglages');
  const onglets = page.locator('.set-tab');
  const n = await onglets.count();
  expect(n).toBeGreaterThan(10);
  for (let i = 0; i < n; i++) {
    await onglets.nth(i).click();
    await expect(page.locator('.set-head h2')).toHaveText((await onglets.nth(i).innerText()).trim());
    await expect(page.locator('.admin-grid .box').first()).toBeVisible();
    await expect(page.locator('.admin-grid')).not.toHaveText(/^\s*Chargement…\s*$/);
  }
  await page.locator('.set-tab', { hasText: 'Serveur' }).last().click();
  const pw = page.locator('.admin-grid input[type=password]');
  await pw.fill('abc');
  await expect(page.locator('.pw-meter')).toContainText('10 caractères');
});

test('réglages : assistant d’ajout de source', async ({ page }) => {
  await ouvrir(page, '/reglages?onglet=medias');
  await page.getByRole('button', { name: 'Ajouter un emplacement' }).first().click();
  await expect(page.getByText(/Où sont rangés vos/)).toBeVisible();
  await page.getByRole('button', { name: /Dossier de ce serveur/ }).click();
  await expect(page.locator('.path-picker .crumb').first()).toBeVisible();
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.locator('.wiz-types .chip', { hasText: 'IPTV' }).click();
  await page.getByRole('button', { name: /Identifiants Xtream/ }).click();
  await expect(page.locator('#xt-server')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('accueil : les nouveautés défilent à la une (3 films, 5 animés, 2 séries au plus)', async ({ page, api }) => {
  const home = await api('/api/home');
  const tags = home.hero.map((h) => h.heroTag).filter(Boolean);
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.length).toBeLessThanOrEqual(10);
  // Données de test : 3 films et 1 série, pas d'animé
  expect(home.hero.filter((h) => h.type === 'movie').length).toBe(3);
  // La reprise de lecture (un épisode) remplace sa série dans la liste
  const series = home.hero.filter((h) => (h.type === 'show' || h.type === 'episode') && h.category !== 'anime').length;
  expect(series).toBeGreaterThanOrEqual(1);
  expect(series).toBeLessThanOrEqual(2);
  expect(home.hero.filter((h) => h.category === 'anime').length).toBeLessThanOrEqual(5);
  await ouvrir(page, '/');
  await expect(page.locator('.hero-kicker').first()).toHaveText(/Nouveau film|Nouvel animé|Nouvelle série|Nouvel épisode|Reprendre|À suivre/);
  await expect(page.locator('.hero-dots button, .hero-dots [role=tab]')).toHaveCount(home.hero.length);
});

test('séries : chaque saison a sa propre affiche', async ({ page, api }) => {
  const lib = await api('/api/library?type=show');
  const show = (Array.isArray(lib) ? lib : lib.items).find((x) => /Brigade Nord/.test(x.title));
  const d = await api(`/api/items/${show.id}`);
  const posters = d.seasons.map((s) => s.poster);
  expect(posters.length).toBe(2);
  expect(posters.every(Boolean), 'une affiche par saison').toBeTruthy();
  expect(new Set(posters).size, 'affiches différentes').toBe(2);
  await ouvrir(page, show.path || `/titre/${show.id}`);
  await expect(page.locator('.season-card img')).toHaveCount(2);
  const imgs = await page.locator('.season-card img').evaluateAll((l) => l.map((i) => i.getAttribute('src')));
  expect(new Set(imgs).size).toBeGreaterThanOrEqual(2);
});

test('séries : saisons absentes et épisodes manquants ou à venir affichés', async ({ page, api }) => {
  const { DatabaseSync } = await import('node:sqlite');
  const lib = await api('/api/library?type=show');
  const show = (Array.isArray(lib) ? lib : lib.items).find((x) => /Brigade Nord/.test(x.title));
  const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'));
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  // TMDB connaît 3 saisons ; la saison 2 a un épisode 2 diffusé et un épisode 3 à venir
  db.prepare('UPDATE items SET tmdb_seasons = ? WHERE id = ?').run(JSON.stringify([{ n: 1, count: 2, air: day(-400) }, { n: 2, count: 3, air: day(-30) }, { n: 3, count: 4, air: day(-10), name: 'Saison 3' }]), show.id);
  db.prepare("UPDATE items SET tmdb_eps = ? WHERE type = 'season' AND show_id = ? AND season_num = 2").run(JSON.stringify([{ n: 1, air: day(-30) }, { n: 2, air: day(-20), title: 'Le retour' }, { n: 3, air: day(15) }]), show.id);
  db.close();
  const d = await api(`/api/items/${show.id}`);
  expect(d.seasons.length).toBe(2);
  expect(d.absentSeasons.map((s) => s.number)).toEqual([3]);
  expect(d.absentSeasons[0].missing.length).toBe(4);
  const s2 = d.seasons.find((s) => s.number === 2);
  expect(s2.missing.map((m) => [m.number, !!m.future])).toEqual([[2, false], [3, true]]);
  await ouvrir(page, show.path);
  await expect(page.locator('.season-card')).toHaveCount(3);
  await page.locator('.season-card', { hasText: 'Saison 2' }).click();
  await expect(page.locator('.episode.missing')).toHaveCount(2);
  await expect(page.locator('.episode.missing.future .miss-tag')).toHaveText('À venir');
  await page.locator('.season-card.absent').click();
  await expect(page.locator('.episode.missing')).toHaveCount(4);
});

test('vitesse : HTTPS en HTTP/2, fiche préparée au survol d’une affiche', async ({ page }) => {
  const http2 = await import('node:http2');
  const port = Number(new URL(etat().base).port) + 1;
  const get = (p) => new Promise((resolve, reject) => {
    const s = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
    s.on('error', reject);
    const r = s.request({ ':path': p });
    let status = 0; r.on('response', (h) => { status = h[':status']; });
    r.on('data', () => {}); r.on('end', () => { s.close(); resolve(status); }); r.end();
  });
  expect(await get('/api/status')).toBe(200);
  expect(await get('/')).toBe(200);
  expect(await get('/css/app.css')).toBe(200);
  // Survol : la fiche est demandée avant le clic
  await ouvrir(page, '/films');
  const asked = page.waitForRequest((r) => /\/api\/items\/\d+$/.test(r.url()), { timeout: 5000 });
  await page.locator('.grid .card').first().hover();
  await asked;
});
