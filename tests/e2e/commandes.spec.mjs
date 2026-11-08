// Recherche universelle (Ctrl+K), commande vocale (interprétation des phrases), manette de jeu
import { test, expect, ouvrir } from './outils.mjs';

test('Ctrl+K : titres, chaînes, réglages, au clavier', async ({ page }) => {
  await ouvrir(page, '/');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('dialog', { name: 'Recherche universelle' });
  await expect(box).toBeVisible();
  await page.keyboard.type('orage');
  await expect(box.locator('.pal-item').first()).toContainText('Orage');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/films\/orage-2018$/);
  await expect(box).toHaveCount(0);
  // Une chaîne
  await page.keyboard.press('Control+k');
  await page.keyboard.type('test vert');
  await expect(page.locator('.pal-item').first()).toContainText('Test Vert');
  await expect(page.locator('.pal-item').first()).toContainText('Chaîne');
  // Un réglage, choisi avec les flèches
  await page.locator('.pal-input').fill('mise a jour');
  await expect(page.locator('.pal-item', { hasText: 'Réglages : Mise à jour' })).toHaveCount(1);
  const idx = await page.locator('.pal-item').evaluateAll((l) => l.findIndex((x) => /Mise à jour/.test(x.textContent)));
  for (let k = 0; k < idx; k++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/onglet=maj/);
  // Échap ferme
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette')).toHaveCount(0);
});

test('commande vocale : les phrases françaises deviennent des actions', async ({ page }) => {
  await ouvrir(page, '/');
  const run = (text) => page.evaluate(async (t) => {
    const m = await import('/js/voice.js');
    const c = await import('/js/components.js');
    let went = null;
    const r = await m.runVoice(t, { go: (p) => { went = p; }, playPath: (id) => c.playPath(id), channelPath: (ch) => `/tv/${ch.number}` });
    return { ...r, went };
  }, text);
  expect((await run('Mets Orage')).went).toMatch(/^\/lecture\/\d+$/);
  expect((await run('lance le film nuit blanche')).went).toMatch(/^\/lecture\/\d+$/);
  expect((await run('Mets Brigade Nord')).went).toMatch(/^\/lecture\/\d+$/); // série : épisode à suivre
  expect((await run('Chaîne 42')).went).toBe('/tv/42');
  expect((await run('chaîne test bleu')).went).toBe('/tv/41');
  expect((await run('cherche voyage')).went).toBe('/recherche?q=voyage');
  expect((await run('ma liste')).went).toBe('/liste');
  expect((await run('Accueil')).went).toBe('/');
  const nope = await run('mets un titre qui n existe pas du tout');
  expect(nope.ok).toBe(false);
  // Navigateur sans reconnaissance vocale : un message clair au lieu d'une erreur
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('button', { name: 'Commande vocale' })).toBeVisible();
});

test('manette : flèches, validation et retour', async ({ page }) => {
  await ouvrir(page, '/films');
  // Fausse manette : croix bas, puis A
  await page.evaluate(() => {
    const btn = (on) => ({ pressed: on, value: on ? 1 : 0 });
    const state = { buttons: Array.from({ length: 17 }, () => btn(false)), axes: [0, 0, 0, 0] };
    window.__pad = state;
    navigator.getGamepads = () => [{ id: 'Manette de test', index: 0, connected: true, buttons: state.buttons, axes: state.axes, mapping: 'standard', timestamp: performance.now() }];
    window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: { id: 'Manette de test' } }));
  });
  await expect(page.getByText(/Manette connectée/)).toBeVisible();
  const tap = async (i) => {
    await page.evaluate((k) => { window.__pad.buttons[k] = { pressed: true, value: 1 }; }, i);
    await page.waitForTimeout(80);
    await page.evaluate((k) => { window.__pad.buttons[k] = { pressed: false, value: 0 }; }, i);
    await page.waitForTimeout(80);
  };
  await tap(15); // droite : la sélection apparaît
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.classList.contains('f'))).toBe(true);
  // Aller sur une affiche puis A
  await page.locator('.grid .card').first().focus();
  await tap(0);
  await expect(page.locator('.details, .player')).toBeVisible();
  await tap(1); // B : retour
  await expect(page).toHaveURL(/\/films$/);
  // Y : recherche universelle
  await tap(3);
  await expect(page.locator('.palette')).toBeVisible();
});
