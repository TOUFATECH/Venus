// Débogage : chaque page, sur ordinateur, sans erreur JavaScript, sans réponse 5xx du serveur, sans requête
// API refusée (401 / 403 inattendus) ; la recherche universelle s'ouvre partout ; navigation avant / arrière.
import { test, expect, ouvrir, pret } from './outils.mjs';

const PAGES = ['/', '/films', '/films?vue=avenir', '/series', '/animes', '/clips', '/liste', '/recherche', '/nouveautes', '/tv', '/tv?vue=multi', '/tv?vue=guide',
  '/tv?vue=enregistrements', '/cesoir', '/collections', '/musique', '/photos', '/stats', '/retrospective', '/telechargements', '/reglages', '/dashboard',
  '/qualite', '/securite', '/serveur', '/films/orage-2018', '/series/brigade-nord'];

test('débogage : toutes les pages, réponses du serveur et va-et-vient', async ({ page }) => {
  test.setTimeout(180_000);
  const bad = [];
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 500) bad.push(`${r.status()} ${u}`);
    if ([401, 403].includes(r.status()) && /\/api\//.test(u) && !/\/api\/(live|hls)\//.test(u)) bad.push(`${r.status()} ${u}`);
  });
  for (const u of PAGES) {
    await ouvrir(page, u);
    await expect(page.locator('main, .player').first()).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  // Va-et-vient rapide : pas d'erreur ni de page blanche (dès que la page est prête : un retour demandé pendant
  // qu'elle s'installe encore est annulé par le navigateur sur une machine lente)
  for (let i = 0; i < 6; i++) { await page.goBack(); await pret(page); await page.waitForTimeout(150); }
  for (let i = 0; i < 6; i++) { await page.goForward(); await pret(page); await page.waitForTimeout(150); }
  await expect(page.locator('main, .player').first()).toBeVisible();
  expect(bad, 'réponses en erreur').toEqual([]);
});
