// TV en direct : lecture réelle (chaînes de test servies en local), zapping préparé, dernière chaîne,
// récentes, multi-écran, rappels de programmes
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

// Attend que la vidéo avance (lecture effective)
const lit = (loc) => expect.poll(() => loc.evaluate((v) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.3);
// Ouvre une chaîne par son nom
async function chaine(page, nom) {
  await page.locator('#tv-search').fill(nom);
  await page.locator('.tiles .tile', { hasText: nom }).first().click();
}

test('TV : lecture, chaîne voisine préparée, dernière chaîne et récentes', async ({ page }) => {
  await ouvrir(page, '/tv');
  const warm = page.waitForRequest((r) => /\/api\/play\/\d+$/.test(r.url()) && /"warm":true/.test(r.postData() || ''), { timeout: 20_000 });
  await chaine(page, 'Test Bleu');
  await page.locator('#tv-search').fill('');
  await lit(page.locator('.pv-screen video'));
  await warm; // la suivante / la précédente se préparent pendant qu'on regarde
  await page.locator('#tv-search').fill('');
  await chaine(page, 'Test Vert');
  await expect(page.locator('.pv-name')).toContainText('Test Vert');
  await lit(page.locator('.pv-screen video'));
  // Dernière chaîne : retour à Test Bleu
  await page.locator('.pv-screen').hover();
  await page.locator('.pv-last').click();
  await expect(page.locator('.pv-name')).toContainText('Test Bleu');
  await lit(page.locator('.pv-screen video'));
  // Récentes : les deux chaînes, la plus récente d'abord
  await page.locator('#tv-search').fill('');
  await page.locator('.tv-cats .chip', { hasText: 'Récentes' }).click();
  await expect(page.locator('.tiles .tile').first()).toContainText('Test Bleu');
  await expect(page.locator('.tiles .tile', { hasText: 'Test Vert' })).toHaveCount(1);
});

test('TV : multi-écran, deux chaînes en même temps, le son suit l’écran choisi', async ({ page }) => {
  await ouvrir(page, '/tv?vue=multi');
  await page.locator('.seg-b', { hasText: '2 écrans' }).click();
  const cells = page.locator('.mv-cell');
  await expect(cells).toHaveCount(2);
  const ids = await page.locator('.mv-cell select').first().evaluate((s) => [...s.options].filter((o) => /Test (Bleu|Vert)/.test(o.textContent)).map((o) => o.value));
  await cells.nth(0).locator('select').selectOption(ids[0]);
  await cells.nth(1).locator('select').selectOption(ids[1]);
  await lit(cells.nth(0).locator('video'));
  await lit(cells.nth(1).locator('video'));
  await cells.nth(1).click({ position: { x: 40, y: 40 } });
  await expect(cells.nth(1)).toHaveClass(/sound/);
  expect(await cells.nth(0).locator('video').evaluate((v) => v.muted)).toBe(true);
  expect(await cells.nth(1).locator('video').evaluate((v) => v.muted)).toBe(false);
  // Choix gardés au retour
  await ouvrir(page, '/tv?vue=multi');
  await lit(page.locator('.mv-cell').nth(1).locator('video'));
});

test('TV : rappel de programme, notification avant le début', async ({ page, api }) => {
  const { DatabaseSync } = await import('node:sqlite');
  const chans = await api('/api/library?type=channel');
  const ch = chans.find((c) => c.title === 'Test Bleu');
  const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'));
  const start = Date.now() + 3 * 60000;
  db.prepare('INSERT INTO epg(channel_id, start, stop, title) VALUES(?, ?, ?, ?)').run(ch.id, start, start + 3600e3, 'Le grand test');
  db.close();
  const g = await api(`/api/epg?from=${Date.now() - 600000}&to=${Date.now() + 3 * 3600e3}`);
  const prog = (g.programs[ch.id] || []).find((x) => x.title === 'Le grand test');
  expect(prog).toBeTruthy();
  // Depuis le guide : « Me prévenir »
  await ouvrir(page, '/tv?vue=guide');
  await page.getByText('Le grand test').first().click();
  await page.getByRole('button', { name: 'Me prévenir' }).click();
  await expect(page.getByRole('button', { name: /Rappel programmé/ })).toBeVisible();
  const list = await api('/api/epg/reminders');
  expect(list.map((r) => r.title)).toContain('Le grand test');
  // Moins de 5 minutes avant : la notification part (vérifiée dans la base)
  await expect.poll(() => {
    const d = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'));
    const r = d.prepare("SELECT notified FROM tv_reminders WHERE title = 'Le grand test'").get();
    d.close();
    return r && r.notified;
  }, { timeout: 45_000 }).toBe(1);
});
