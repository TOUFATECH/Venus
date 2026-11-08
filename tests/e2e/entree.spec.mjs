// Écrans d'entrée : connexion d'un nouvel appareil, « Qui regarde ? », code PIN
import { test, expect, pret, PASSWORD, PIN } from './outils.mjs';

test.use({ storageState: { cookies: [], origins: [] } });

test('connexion, choix du profil et code PIN', async ({ page }) => {
  await page.goto('/');
  await pret(page);
  await expect(page.getByRole('heading', { name: 'Connecter cet appareil' })).toBeVisible();
  // Champ vide, puis mauvais mot de passe
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.locator('.error-text')).toHaveText('Entrez le mot de passe');
  await page.locator('#pass').fill('pas-le-bon');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.locator('.error-text')).not.toBeEmpty();
  // Mode code : formaté « 123 456 »
  await page.getByRole('button', { name: /code à 6 chiffres/ }).click();
  await expect(page.locator('#login-code')).toBeFocused();
  await page.locator('#login-code').pressSequentially('123');
  await expect(page.locator('#login-code')).toHaveValue('123');
  await page.getByRole('button', { name: 'Utiliser le mot de passe' }).click();
  // Bon mot de passe
  await page.locator('#pass').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Qui regarde ?' })).toBeVisible();
  // Profil administrateur : code PIN, d'abord faux
  await page.locator('.profile-tile', { hasText: 'Admin' }).click();
  await expect(page.locator('.pinpad')).toBeVisible();
  await page.keyboard.type('0000');
  await expect(page.locator('.sheet .error-text')).not.toBeEmpty();
  await expect(page.locator('.pin-dots .on')).toHaveCount(0);
  await page.keyboard.type(PIN);
  await expect(page.locator('.rail, .tabbar').first()).toBeVisible();
  await expect(page.locator('.pinpad')).toHaveCount(0);
});

test('profil sans code PIN', async ({ page }) => {
  await page.goto('/');
  await pret(page);
  await page.locator('#pass').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.profile-tile', { hasText: 'Lina' }).click();
  await expect(page.locator('.rail, .tabbar').first()).toBeVisible();
});
