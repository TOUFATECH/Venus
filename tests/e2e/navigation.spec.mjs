// Navigation : retour au même endroit, affiche qui glisse vers la fiche
import { test, expect, ouvrir } from './outils.mjs';

test('retour en arrière : même position dans la page', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 380 });
  await ouvrir(page, '/films');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(100);
  await page.locator('.grid .card').last().locator('.cap').click();
  await expect(page.locator('.details')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.grid .card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(y - 5);
  // Ouverte depuis le menu (pas un retour) : la page commence en haut
  await page.goto('/series'); await page.goto('/films');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
});

test('affiche → fiche : transition de l’affiche, sans erreur', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vn_lite', 'off'); // effets complets (le serveur de test est une petite machine)
    window.__vt = 0;
    const o = document.startViewTransition && document.startViewTransition.bind(document);
    if (o) document.startViewTransition = (cb) => { window.__vt++; return o(cb); };
  });
  await ouvrir(page, '/films');
  await page.locator('.grid .card').first().locator('.cap').click();
  await expect(page.locator('.details-poster')).toBeVisible();
  expect(await page.evaluate(() => window.__vt)).toBeGreaterThan(0);
  // Une fois la transition finie, plus aucun nom de transition qui traîne
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.style && e.style.viewTransitionName).length)).toBe(0);
  await page.goBack();
  await page.locator('.grid .card').nth(1).locator('.cap').click();
  await expect(page.locator('.details-poster')).toBeVisible();
});
