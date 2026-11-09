// Thèmes Lagon et Océan : barre en haut avec recherche, bloc « Ce soir », planète animée propre à chacun,
// vagues pour Océan, version claire Sable le jour.
import { test, expect, ouvrir } from './outils.mjs';

const setPlanet = async (page, id) => { await page.evaluate(async (p) => { const m = await import('/js/themes.js'); m.setPlanet(p); }, id); await page.waitForTimeout(700); };

test('Lagon : barre haute, recherche, bloc « Ce soir », polices et planète', async ({ page, api }) => {
  await ouvrir(page, '/');
  await setPlanet(page, 'lagon');
  await ouvrir(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'lagon');
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'lagon');
  // Barre en haut : logo + nom, recherche, pilules centrées, profil à droite
  const rail = page.locator('.rail');
  const box = await rail.boundingBox();
  expect(box.y).toBeLessThan(2);
  expect(box.width).toBeGreaterThan(1000);
  await expect(rail.locator('.rail-brand')).toHaveText('venus');
  await expect(rail.locator('.rail-search')).toBeVisible();
  await rail.locator('.rail-search').click();
  await expect(page.locator('.palette input')).toBeVisible();
  await page.keyboard.press('Escape');
  // Bloc « Ce soir » : affiche à gauche, trois panneaux à droite
  const cs = page.locator('.ce-soir');
  await expect(cs.locator('.hero')).toBeVisible();
  await expect(cs.locator('.cs-panel')).toHaveCount(3);
  await expect(cs.getByText('Qui regarde ce soir ?')).toBeVisible();
  await expect(cs.getByText('En direct')).toBeVisible();
  const t = await api('/api/home/tonight');
  expect(Array.isArray(t.soon)).toBe(true);
  expect(t.people.length).toBeGreaterThan(1);
  // Police des titres : Outfit ; texte : Inter ; affiches arrondies
  expect(await page.locator('.row h2').first().evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Outfit');
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Inter');
  expect(await page.locator('.card .shot').first().evaluate((e) => getComputedStyle(e).borderRadius)).toBe('14px');
  // Planète-atoll animée dans le logo
  expect(await page.evaluate(async () => { const m = await import('/js/themes.js'); return m.planetMarkup('lagon'); })).toContain('planet-lagon');
  await expect(page.locator('.rail .mark.planet-lagon .spin')).toHaveCount(1);
  await expect(page.locator('.waves')).toHaveCount(0);
  // Réglages : les trois nouvelles planètes sont proposées
  await ouvrir(page, '/reglages?onglet=affichage');
  for (const n of ['Lagon', 'Océan', 'Sable']) await expect(page.locator('.theme-grid').getByText(n, { exact: true })).toBeVisible();
});

test('Océan : même mise en page, vagues animées, et Sable le jour', async ({ page }) => {
  await ouvrir(page, '/');
  await setPlanet(page, 'ocean');
  await ouvrir(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'ocean');
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'lagon');
  await expect(page.locator('html')).toHaveAttribute('data-waves', '1');
  await expect(page.locator('.ce-soir .cs-panel')).toHaveCount(3);
  const waves = page.locator('.waves');
  await expect(waves).toHaveCount(1);
  expect(await waves.locator('.wave').count()).toBe(3);
  // Les vagues bougent (sauf sur un appareil modeste, où elles restent immobiles)
  await page.evaluate(() => document.documentElement.classList.remove('lite'));
  expect(await waves.locator('.w1').evaluate((e) => getComputedStyle(e).animationName)).toBe('wave-roll');
  const box = await waves.boundingBox();
  expect(box.y + box.height).toBeGreaterThan(700);
  // La planète Océan a ses crêtes d'écume ; en mode nuit, le fond est bleu profond
  expect(await page.evaluate(async () => { const m = await import('/js/themes.js'); return m.planetMarkup('ocean'); })).toContain('planet-ocean');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--night').trim())).toMatch(/#03101f|rgb\(3, 16, 31\)/);
  // Thème automatique « selon l'appareil » + appareil en clair → Sable, qui garde la même mise en page
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(async () => { const m = await import('/js/themes.js'); m.setAutoTheme('system'); });
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'sable');
  await expect(page.locator('html')).toHaveAttribute('data-tone', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'lagon');
  await expect(page.locator('.waves')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(async () => { const m = await import('/js/themes.js'); m.setAutoTheme('off'); });
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'ocean');
  // Retour au thème d'origine pour les autres tests
  await setPlanet(page, 'venus');
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'rail');
});
