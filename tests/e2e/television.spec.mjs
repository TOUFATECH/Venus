// Télévision : tout se fait aux flèches, OK (Entrée) et Retour, sans souris
import { test, expect, ouvrir, pret, etat } from './outils.mjs';

// Élément sélectionné : où il est, s'il est visible à l'écran
const selection = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  return {
    texte: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60),
    f: el.classList.contains('f') || /INPUT|SELECT/.test(el.tagName),
    visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    feuille: !!el.closest('.sheet-wrap'),
    lecteur: !!el.closest('.player'),
    menu: !!el.closest('.rail, .tabbar'),
    page: !!el.closest('main'),
  };
});
const touche = async (page, k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };

test('accueil : on se déplace aux flèches et la sélection reste à l’écran', async ({ page }) => {
  await ouvrir(page, '/');
  await touche(page, 'ArrowDown');
  const vus = new Set();
  for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await touche(page, k);
    await page.waitForTimeout(350); // défilement doux
    const s = await selection(page);
    expect(s, `après ${k}`).not.toBeNull();
    expect(s.f, `élément sélectionnable après ${k}`).toBeTruthy();
    expect(s.visible, `sélection visible après ${k} (${s.texte})`).toBeTruthy();
    vus.add(s.texte);
  }
  expect(vus.size, 'la sélection change d’élément').toBeGreaterThan(3);
  await expect(page.locator('html.keys')).toHaveCount(1);
});

test('du menu vers la page, OK ouvre une fiche, Retour revient', async ({ page }) => {
  await ouvrir(page, '/films');
  await touche(page, 'ArrowDown');
  // Depuis le menu, la flèche droite entre dans la page
  await page.locator('.rail .rail-item').first().focus();
  await touche(page, 'ArrowRight');
  expect((await selection(page)).page, 'la flèche droite entre dans la page').toBeTruthy();
  // Jusqu'à une affiche, puis OK
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement.classList.contains('card'))); i++) await touche(page, 'ArrowDown');
  await expect(page.locator('.card:focus')).toHaveCount(1);
  const avant = page.url();
  await touche(page, 'Enter');
  await expect(page).not.toHaveURL(avant);
  await pret(page);
  // Sur la fiche, une flèche suffit pour retrouver une sélection à l'écran
  await touche(page, 'ArrowDown');
  const s = await selection(page);
  expect(s && s.visible && s.f, 'sélection sur la fiche').toBeTruthy();
  await touche(page, 'Backspace');
  await expect(page).toHaveURL(avant);
});

test('fenêtre : la sélection reste dedans, Retour la ferme', async ({ page }) => {
  await ouvrir(page, '/reglages?onglet=profil');
  await page.getByRole('button', { name: /Modifier nom, couleur/ }).focus();
  await touche(page, 'Enter');
  await expect(page.locator('.sheet-wrap')).toHaveCount(1);
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
    await touche(page, k);
    const s = await selection(page);
    expect(s && s.feuille, `après ${k}, la sélection est dans la fenêtre`).toBeTruthy();
  }
  await page.locator('.sheet-wrap input').first().blur();
  await touche(page, 'Escape');
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});

test('réglages : rubriques aux flèches haut / bas, contenu à droite', async ({ page }) => {
  await ouvrir(page, '/reglages');
  await page.locator('.set-tab').first().focus();
  await touche(page, 'ArrowDown');
  expect((await selection(page)).texte).toBe((await page.locator('.set-tab').nth(1).innerText()).trim());
  await touche(page, 'Enter');
  await expect(page.locator('.set-head h2')).toHaveText((await page.locator('.set-tab').nth(1).innerText()).trim());
  await touche(page, 'ArrowRight');
  const s = await selection(page);
  expect(s && s.visible && !(await page.evaluate(() => document.activeElement.classList.contains('set-tab'))), 'la flèche droite entre dans le contenu').toBeTruthy();
});

test('guide des programmes aux flèches', async ({ page }) => {
  await ouvrir(page, '/tv?vue=guide');
  await touche(page, 'ArrowDown', 2);
  const vus = new Set();
  for (const k of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    await touche(page, k);
    await page.waitForTimeout(250);
    const s = await selection(page);
    expect(s && s.visible, `guide après ${k}`).toBeTruthy();
    vus.add(s.texte);
  }
  expect(vus.size).toBeGreaterThan(1);
});

test('lecteur : commandes aux flèches, Retour quitte', async ({ page }) => {
  await ouvrir(page, '/films');
  await page.locator('.card', { hasText: 'Nuit Blanche' }).first().locator('.cap').click();
  await expect(page.locator('.actions .btn-play')).toBeVisible();
  await page.locator('.actions .btn-play').focus();
  await touche(page, 'Enter');
  await expect(page.locator('.player video')).toBeVisible();
  await expect.poll(() => page.locator('.player video').evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await touche(page, 'ArrowDown');
  const s = await selection(page);
  expect(s && s.lecteur, 'sélection dans les commandes du lecteur').toBeTruthy();
  // Retour : la fiche du film, la vidéo continue dans le mini-lecteur
  await touche(page, 'Backspace');
  await expect(page.locator('.player')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nuit Blanche' }).first()).toBeVisible();
  await expect(page.locator('.mini-player.on')).toBeVisible();
});

test('TV : catégories, Mayotte La 1ère en tête, favoris et liste M3U', async ({ page, api }) => {
  const chans = await api('/api/library?type=channel');
  const mine = chans.filter((c) => /^http:\/\/127/.test(c.streamUrl || '') || ['France 24', 'Mayotte La 1ère', 'Mangas TV', 'Ciné Classique', 'Histoire Plus', 'Arte'].includes(c.title));
  const cat = Object.fromEntries(mine.map((c) => [c.title, c.cat]));
  expect(cat['France 24']).toBe('Info');
  expect(cat['Mayotte La 1ère']).toBe('Outre-mer');
  expect(cat['Mangas TV']).toBe('Animé / Manga');
  expect(cat['Ciné Classique']).toBe('Films');
  expect(cat['Histoire Plus']).toBe('Histoire');
  expect(chans[0].title).toBe('Mayotte La 1ère');
  // Favori : ajouté, exporté en M3U, réimporté
  const arte = mine.find((c) => c.title === 'Arte');
  await api(`/api/channels/${arte.id}/favorite`, { method: 'POST', body: { on: true } });
  const m3u = await page.request.get('/api/channels/favorites.m3u', { headers: { authorization: `Bearer ${etat().token}` } });
  expect(m3u.ok()).toBeTruthy();
  const txt = await m3u.text();
  expect(txt).toContain('#EXTM3U');
  expect(txt).toContain(',Arte');
  await api(`/api/channels/${arte.id}/favorite`, { method: 'POST', body: { on: false } });
  const imp = await api('/api/channels/favorites/import', { method: 'POST', body: { m3u: txt } });
  expect(imp.found).toBe(1);
  // Page : les catégories et le filtre Favoris
  await ouvrir(page, '/tv');
  await expect(page.locator('.tv-cats .chip', { hasText: 'Outre-mer' })).toBeVisible();
  await page.locator('.tv-cats .chip', { hasText: 'Favoris' }).click();
  await expect(page.locator('.tiles .tile')).toHaveCount(1);
  await expect(page.locator('.tv-fav-tools a[href="/api/channels/favorites.m3u"]')).toBeVisible();
  await page.locator('.tv-cats .chip', { hasText: 'Toutes' }).click();
  // Les catégories restent dans la colonne (pas de débordement à droite)
  const list = await page.locator('.tvx-list').boundingBox();
  const last = await page.locator('.tv-cats .chip').last().boundingBox();
  expect(last.x + last.width).toBeLessThanOrEqual(list.x + list.width + 1);
});
