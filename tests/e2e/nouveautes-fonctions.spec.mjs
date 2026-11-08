// Rétrospective de l'année et recommandations « Parce que vous avez regardé »
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

test('rétrospective de l’année : écrans qui défilent, au clavier et au toucher', async ({ page, api }) => {
  // Un film et la série Brigade Nord vus en entier cette année
  const lib = await api('/api/library?type=movie');
  const film = lib.find((x) => /Grand Voyage/.test(x.title));
  await api(`/api/items/${film.id}/watched`, { method: 'POST', body: { watched: true } });
  const shows = await api('/api/library?type=show');
  const bn = shows.find((x) => /Brigade Nord/.test(x.title));
  await api(`/api/items/${bn.id}/watched`, { method: 'POST', body: { watched: true } });
  const st = await api('/api/stats');
  expect(st.movies).toBeGreaterThan(0);
  expect(st.completedShows.map((x) => x.title)).toContain('Brigade Nord');
  await ouvrir(page, '/stats');
  await page.getByRole('button', { name: /Ma rétrospective/ }).click();
  await expect(page).toHaveURL(/\/retrospective/);
  const slide = page.locator('.rc-slide');
  await expect(slide).toContainText('votre année');
  await page.keyboard.press('ArrowRight');
  await expect(slide).toContainText('Films');
  await page.keyboard.press('ArrowLeft');
  await expect(slide).toContainText('votre année');
  // Jusqu'au bout : « Merci » et « Revoir »
  for (let k = 0; k < 12; k++) await page.keyboard.press('ArrowRight');
  await expect(slide).toContainText('Merci');
  await page.getByRole('button', { name: 'Revoir' }).click();
  await expect(slide).toContainText('votre année');
  // Avance toute seule
  await expect(slide).toContainText('Films', { timeout: 10_000 });
  await api(`/api/items/${film.id}/watched`, { method: 'POST', body: { watched: false } });
  await api(`/api/items/${bn.id}/watched`, { method: 'POST', body: { watched: false } });
});

test('accueil : « Parce que vous avez regardé » d’après ce qu’on a vu', async ({ page, api }) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'));
  // Trois films du même genre ; on en regarde un
  db.prepare("UPDATE items SET genres = '[\"Thriller\",\"Drame\"]' WHERE type = 'movie'").run();
  db.close();
  const lib = await api('/api/library?type=movie');
  const film = lib.find((x) => /Orage/.test(x.title));
  await api(`/api/progress/${film.id}`, { method: 'POST', body: { position: 300, duration: 1800 } }).catch(() => null);
  await api(`/api/items/${film.id}/watched`, { method: 'POST', body: { watched: true } });
  const home = await api('/api/home');
  const row = home.rows.find((r) => r.id === `because:${film.id}`);
  expect(row, 'rangée « Parce que vous avez regardé Orage »').toBeTruthy();
  expect(row.items.map((x) => x.title)).not.toContain('Orage');
  await ouvrir(page, '/');
  await expect(page.getByText(`Parce que vous avez regardé ${film.title}`)).toBeVisible();
  await api(`/api/items/${film.id}/watched`, { method: 'POST', body: { watched: false } });
});
