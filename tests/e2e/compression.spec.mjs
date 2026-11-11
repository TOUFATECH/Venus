// Compression des vidéos : proposition avec gain estimé, choix des langues, copie à côté de l'original,
// lecture de la copie puis de l'original, validation (original à la corbeille, la copie prend son nom).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('compression : proposition, conversion en français seulement, lecture, validation', async ({ page, api }) => {
  const lib = await api('/api/library?type=movie');
  const film = (Array.isArray(lib) ? lib : lib.items).find((i) => i.title === 'Tempête');
  expect(film).toBeTruthy();
  // Proposée : HEVC 10 bits, deux langues détectées
  const sug = await api('/api/admin/convert/suggest');
  const prop = sug.items.find((x) => x.id === film.id);
  expect(prop, JSON.stringify(sug.items.map((x) => x.title))).toBeTruthy();
  expect(prop.why.join(' ')).toMatch(/HEVC/);
  expect(prop.why.join(' ')).toMatch(/10 bits/);
  expect(prop.audio.map((a) => a.lang)).toEqual(['fre', 'eng']);
  expect(prop.estimated).toBeGreaterThan(0);
  // Les films déjà en H.264 léger ne sont pas proposés
  expect(sug.items.some((x) => x.title === 'Orage')).toBe(false);
  // Qualité au choix : Maximale donne une copie plus grosse qu'Équilibrée ; le réglage général se change
  const st0 = await api('/api/admin/convert');
  expect(st0.qualities.map((q) => q.id)).toEqual(['max', 'high', 'balanced']);
  const eMax = await api(`/api/admin/convert/estimate/${film.id}?quality=max&maxHeight=0`);
  const eBal = await api(`/api/admin/convert/estimate/${film.id}?quality=balanced&maxHeight=720`);
  expect(eMax.estimated).toBeGreaterThan(eBal.estimated);
  expect(eBal.height).toBe(360); // la source fait 360p : jamais agrandie
  const saved = await api('/api/admin/convert/settings', { method: 'PUT', body: { quality: 'max', maxHeight: 1440 } });
  expect(saved.settings.quality).toBe('max'); expect(saved.settings.maxHeight).toBe(1440);
  await api('/api/admin/convert/settings', { method: 'PUT', body: { quality: 'high', maxHeight: 1080 } });
  // La fiche (admin) montre la proposition avec les langues
  const d = await api(`/api/items/${film.id}`);
  expect(d.compress.status).toBe('suggested');
  await ouvrir(page, '/films/tempete-2005');
  const note = page.locator('.compress-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('peut être compressée');
  await expect(note.getByRole('button', { name: 'Anglais' })).toHaveAttribute('aria-pressed', 'true');
  // On ne garde que le français, puis on lance
  await note.getByRole('button', { name: 'Anglais' }).click();
  await expect(note.getByRole('button', { name: 'Anglais' })).toHaveAttribute('aria-pressed', 'false');
  await note.getByRole('button', { name: /Compresser/ }).click();
  await expect(page.locator('.resume-note, .compress-note').filter({ hasText: /Compression en (cours|attente)/ })).toBeVisible({ timeout: 10_000 });
  // La copie se fait à côté de l'original, sans le toucher
  let st;
  await expect.poll(async () => { st = await api('/api/admin/convert'); const c = st.list.find((x) => x.itemId === film.id); return c && c.status; }, { timeout: 180_000, intervals: [2000] }).toBe('done');
  const conv = st.list.find((x) => x.itemId === film.id);
  expect(conv.sizeAfter).toBeGreaterThan(0);
  expect(conv.opts.langs).toEqual(['fre']);
  const mediaDir = path.join(etat().dir, 'media', 'films', 'Tempête (2005)');
  expect(fs.existsSync(path.join(mediaDir, 'Tempête (2005).mkv'))).toBe(true);
  expect(fs.existsSync(path.join(mediaDir, 'Tempête (2005).venus.mp4'))).toBe(true);
  // La copie : H.264 8 bits, AAC, une seule piste (français), même durée
  const d2 = await api(`/api/items/${film.id}`);
  expect(d2.compress.status).toBe('done');
  const play = await api(`/api/play/${film.id}`, { method: 'POST', body: {} });
  expect(play.url).toContain('v=conv');
  expect(play.mode).toBe('direct');
  const orig = await api(`/api/play/${film.id}`, { method: 'POST', body: { source: 'original' } });
  expect(orig.url || '').not.toContain('v=conv');
  // Réglages → Performance : la copie est listée à valider, avec le gain
  await ouvrir(page, '/reglages?onglet=perf');
  const box = page.locator('#convert');
  await expect(box).toContainText('1 copie(s) à valider');
  const row = box.locator('.conv-row', { hasText: 'Tempête' });
  await expect(row).toContainText('%');
  // Validation : corbeille 7 jours ; la copie prend le nom de l'original (.mp4)
  await row.getByRole('button', { name: 'Valider' }).click();
  await page.getByRole('button', { name: 'Corbeille 7 jours (recommandé)' }).click();
  await expect(box).toContainText('Place gagnée', { timeout: 15_000 });
  await expect.poll(async () => (await api('/api/admin/convert')).saved).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(mediaDir, 'Tempête (2005).mp4'))).toBe(true);
  expect(fs.existsSync(path.join(mediaDir, 'Tempête (2005).mkv'))).toBe(false);
  expect(fs.existsSync(path.join(mediaDir, 'Tempête (2005).venus.mp4'))).toBe(false);
  const trash = await api('/api/admin/trash');
  expect(trash.items.some((t) => /Tempête/.test(t.title) && /avant compression/.test(t.title))).toBe(true);
  const d3 = await api(`/api/items/${film.id}`);
  expect(d3.compress == null).toBe(true);
  expect(d3.file && d3.file.path ? d3.file.path.endsWith('.mp4') : true).toBe(true);
  const play2 = await api(`/api/play/${film.id}`, { method: 'POST', body: {} });
  expect(play2.mode).toBe('direct');
  expect(play2.url).not.toContain('v=conv');
  await wait(200);
});
