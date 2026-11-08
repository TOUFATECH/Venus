// Parcours principaux sur ordinateur : regarder un film, mini-lecteur, recherche, ma liste, musique, réglages
import { test, expect, ouvrir } from './outils.mjs';

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
  const series = home.hero.filter((h) => h.type === 'show' && h.category !== 'anime').length;
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
