// Toutes les pages s'affichent, sans erreur, sur ordinateur comme sur téléphone
import { test, expect, ouvrir } from './outils.mjs';

const PAGES = [
  '/', '/films', '/films?vue=avenir', '/series', '/animes', '/clips', '/liste', '/liste?vue=envies', '/recherche', '/nouveautes',
  '/tv', '/tv?vue=guide', '/tv?vue=enregistrements', '/cesoir', '/vote', '/seance', '/telecommande', '/collections',
  '/musique', '/photos', '/livres', '/stats', '/retrospective', '/tv?vue=multi', '/telechargements', '/nouveau', '/reglages', '/dashboard', '/qualite', '/securite', '/serveur',
];

const PLEIN_ECRAN = ['/vote', '/telecommande'];

for (const url of PAGES) {
  test(`page ${url}`, async ({ page }) => {
    await ouvrir(page, url);
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
    await expect(main).not.toBeEmpty();
    await expect(page.getByText('Lecture impossible')).toHaveCount(0);
    // Ni défilement horizontal parasite, ni menu manquant
    const debord = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(debord, 'débordement horizontal').toBeLessThanOrEqual(1);
    // Pages plein écran (vote, télécommande) : pas de menu
    if (!PLEIN_ECRAN.includes(url)) await expect(page.locator('.rail, .tabbar').filter({ visible: true }).first()).toBeVisible();
  });
}

test('fiches : film, série, album, album photo', async ({ page, api }) => {
  const films = await api('/api/library?type=movie');
  const film = (films.items || films)[0];
  await ouvrir(page, `/titre/${film.id}`);
  await expect(page.locator('.actions .btn-play')).toBeVisible();
  await ouvrir(page, '/series');
  await page.locator('.card').first().click();
  await expect(page.getByText(/Brigade Nord/).first()).toBeVisible();
  await expect(page.getByText(/2 épisodes|Épisode 2|S01E02|É2/).first()).toBeVisible();
  await ouvrir(page, '/musique');
  await expect(page.getByText('Premier Album').first()).toBeVisible();
  await ouvrir(page, '/photos');
  await expect(page.getByText('Vacances').first()).toBeVisible();
});
