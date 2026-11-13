// Vidéo (mode nuit, image dans l'image, apparence des sous-titres) et thèmes (automatique, par profil, teinte de la fiche)
import path from 'node:path';
import { test, expect, ouvrir, etat, baseVenus } from './outils.mjs';

test('lecteur : mode nuit, image dans l’image, apparence des sous-titres gardée par profil', async ({ page, api }) => {
  await ouvrir(page, '/films/orage-2018/lecture');
  const video = page.locator('.player video');
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await page.mouse.move(400, 300);
  // Mode nuit : le son passe par le compresseur, la vidéo continue
  const night = page.getByRole('button', { name: 'Mode nuit (son égalisé)' });
  await night.click();
  await expect(night).toHaveAttribute('aria-pressed', 'true');
  expect(await video.evaluate((v) => !!(v.__vnAudio && v.__vnAudio.on))).toBe(true);
  const t0 = await video.evaluate((v) => v.currentTime);
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(t0 + 0.5);
  // Image dans l'image (Chromium la prend en charge)
  await page.mouse.move(420, 320);
  await page.getByRole('button', { name: 'Image dans l’image' }).click();
  await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement), { timeout: 5000 }).toBe(true);
  await page.evaluate(() => document.exitPictureInPicture());
  // Apparence des sous-titres : réglage enregistré sur le profil
  await page.evaluate(async () => { const m = await import('/js/api.js'); m.prefs.set('subColor', 'cyan'); m.prefs.set('subPos', 'top'); });
  await expect.poll(async () => (await api('/api/status')).profile.uiPrefs.subColor, { timeout: 5000 }).toBe('cyan');
  const st = await api('/api/status');
  expect(st.profile.uiPrefs.subPos).toBe('top');
  expect(st.profile.uiPrefs.nightMode).toBe(true);
  await page.evaluate(async () => { const m = await import('/js/api.js'); m.prefs.set('nightMode', false); m.prefs.set('subColor', 'white'); m.prefs.set('subPos', 'normal'); });
});

test('thèmes : automatique selon l’appareil, gardé par profil', async ({ page, api }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await ouvrir(page, '/reglages?onglet=affichage');
  await page.getByRole('radio', { name: 'Selon l’appareil' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'blanc');
  await expect.poll(async () => (await api('/api/status')).profile.uiPrefs.themeAuto, { timeout: 5000 }).toBe('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).not.toHaveAttribute('data-planet', 'blanc');
  // Un autre appareil (stockage vide) retrouve le thème du profil
  await page.evaluate(() => { localStorage.removeItem('vn_theme_auto'); });
  await page.emulateMedia({ colorScheme: 'light' });
  await ouvrir(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-planet', 'blanc');
  await page.getByRole('link', { name: /Réglages/ }).first().click().catch(() => {});
  await ouvrir(page, '/reglages?onglet=affichage');
  await page.getByRole('radio', { name: /^Toujours / }).click();
  await expect.poll(async () => (await api('/api/status')).profile.uiPrefs.themeAuto, { timeout: 5000 }).toBe('off');
});

test('fiche teintée de la couleur de son affiche', async ({ page, api }) => {
  const db = await baseVenus();
  const red = await db.get("SELECT poster FROM items WHERE type = 'season' AND poster LIKE 'l\\_%' ESCAPE '\\' ORDER BY season_num LIMIT 1");
  await db.run("UPDATE items SET poster = ? WHERE type = 'movie' AND title = 'Nuit Blanche'", red.poster);
  await db.close();
  await api('/api/library?type=movie');
  await ouvrir(page, '/films/nuit-blanche-2021');
  await expect(page.locator('.details.amb')).toBeVisible();
  const amb = await page.locator('.details').evaluate((el) => getComputedStyle(el).getPropertyValue('--amb'));
  const [r, g, b] = amb.trim().split(/\s+/).map(Number);
  expect(r).toBeGreaterThan(g + 40); // affiche rouge → teinte rouge
  expect(r).toBeGreaterThan(b + 40);
});
