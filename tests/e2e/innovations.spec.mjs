// Fonctions inédites : « Précédemment dans… » automatique, meilleurs moments, chapitres générés, recherche dans les
// dialogues, retour au moment où l'on s'est endormi, fiche à la pause, mode anti-spoiler, « Qui regarde ce soir ? »,
// sous-titres générés (faux whisper) et lumières synchronisées (faux pont Hue + faux WLED).
import { test, expect, ouvrir, etat } from './outils.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function brigade(api) {
  const shows = await api('/api/library?type=show');
  const bn = (Array.isArray(shows) ? shows : shows.items).find((i) => i.title === 'Brigade Nord');
  const d = await api(`/api/items/${bn.id}`);
  const eps = d.seasons.flatMap((s) => s.episodes);
  const find = (s, e) => eps.find((x) => x.season === s && x.episode === e);
  return { show: bn, details: d, e1: find(1, 1), e2: find(1, 2), e3: find(2, 1) };
}

test('scènes : meilleurs moments, « Précédemment dans… » monté à partir de l’épisode précédent', async ({ page, api, request }) => {
  const { e1, e2 } = await brigade(api);
  // Analyse des scènes de S01E01 (coupures toutes les 3 s, volume alterné) → moments forts
  const hl = await api(`/api/items/${e1.id}/highlights?wait=1&n=3`);
  expect(hl.moments.length).toBeGreaterThan(0);
  expect(hl.moments[0].start).toBeGreaterThanOrEqual(0);
  expect(hl.moments[0].end).toBeGreaterThan(hl.moments[0].start);
  // Le résumé de S01E01 se prépare (202), puis est prêt
  const { token } = etat();
  let r;
  for (let i = 0; i < 60; i++) {
    const res = await request.get(`/api/items/${e2.id}/recap`, { headers: { authorization: `Bearer ${token}` } });
    expect([200, 202]).toContain(res.status());
    r = await res.json();
    if (res.status() === 200 && r.ready) break;
    await wait(1000);
  }
  expect(r.ready, JSON.stringify(r)).toBe(true);
  expect(r.prev.episode).toBe(1);
  const mp4 = await request.get(r.url, { headers: { authorization: `Bearer ${token}` } });
  expect(mp4.status()).toBe(200);
  expect(mp4.headers()['content-type']).toContain('video/mp4');
  expect(Number(mp4.headers()['content-length'] || (await mp4.body()).length)).toBeGreaterThan(10_000);
  // Dans le lecteur de S01E02 : bouton « Précédemment », le résumé se joue par-dessus puis « Passer le résumé »
  await ouvrir(page, `/lecture/${e2.id}`);
  const video = page.locator('.player > video, .player video').first();
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
  const btn = page.locator('.p-recap');
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await expect(btn).toContainText('S1 É1');
  await btn.click();
  const layer = page.locator('.p-recap-layer');
  await expect(layer).toBeVisible();
  await expect.poll(() => layer.locator('video').evaluate((v) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.2);
  await layer.getByRole('button', { name: /Passer le résumé/ }).click();
  await expect(layer).toBeHidden();
  // Partage (sur l'épisode analysé) : la section « Meilleurs moments » propose les extraits trouvés
  await ouvrir(page, `/lecture/${e1.id}`);
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.3);
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: 'Partager un extrait' }).click();
  await expect(page.locator('.moments .moment').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.moments .moment').first().click();
  await expect(page.locator('.moments .moment.on')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('dialogues : recherche d’une réplique, résultat dans la page et la palette', async ({ page, api }) => {
  const { e1 } = await brigade(api);
  // L'ouverture d'une lecture met l'index des dialogues en file ; on attend la réplique du sous-titre externe
  await api('/api/play/' + e1.id, { method: 'POST', body: { preview: true } }).catch(() => null);
  await api('/api/play/' + e1.id, { method: 'POST', body: {} }).catch(() => null);
  let res;
  await expect.poll(async () => { res = await api('/api/dialogues?q=lagon'); return res.results.length; }, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(res.results[0].item.id).toBe(e1.id);
  expect(res.results[0].lines[0].text).toContain('lagon');
  expect(res.results[0].lines[0].start).toBeGreaterThanOrEqual(7);
  // Sans accent ni majuscule, et par préfixe
  expect((await api('/api/dialogues?q=MAYOT')).results.length).toBe(1);
  // Page de recherche : section « Dans les dialogues », lecture à la seconde près
  await ouvrir(page, '/recherche?q=lagon');
  const hit = page.locator('.line-hits .line-hit').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await expect(hit).toContainText('lagon');
  await hit.click();
  await expect(page).toHaveURL(/\/lecture\/\d+\?t=\d+/);
  await expect(page.locator('.player')).toBeVisible();
  await page.keyboard.press('Escape');
  // Palette (Ctrl+K)
  await ouvrir(page, '/');
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('secrets');
  await expect(page.locator('.palette').getByText(/garde tous nos secrets/)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
});

test('sommeil : la reprise revient au dernier geste quand on s’est endormi', async ({ api }) => {
  const lib = await api('/api/library?type=movie');
  const film = (Array.isArray(lib) ? lib : lib.items).find((i) => i.title === 'Nuit Blanche');
  // 50 min sans aucun geste alors que la vidéo a avancé de 10 min → position ramenée une minute avant le dernier geste
  const r = await api('/api/progress', { method: 'POST', body: { itemId: film.id, position: 1500, duration: 1800, idle: 3000, activePos: 900 } });
  expect(r.asleep).toBe(true);
  expect(r.position).toBe(840);
  expect(r.watched).toBe(false);
  const play = await api(`/api/play/${film.id}`, { method: 'POST', body: {} });
  expect(play.resumeAsleep).toBe(true);
  expect(Math.round(play.startAt)).toBeGreaterThanOrEqual(835); // la reprise recule encore de quelques secondes
  expect(Math.round(play.startAt)).toBeLessThanOrEqual(840);
  // Geste récent : rien ne change
  const ok = await api('/api/progress', { method: 'POST', body: { itemId: film.id, position: 1500, duration: 1800, idle: 20, activePos: 1490 } });
  expect(ok.asleep).toBe(false);
  expect(ok.position).toBe(1500);
  await api(`/api/items/${film.id}/watched`, { method: 'POST', body: { watched: false } });
});

test('pause intelligente : la fiche apparaît à la pause et disparaît à la reprise', async ({ page }) => {
  await ouvrir(page, '/films/orage-2018/lecture');
  const video = page.locator('.player video').first();
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await video.evaluate((v) => v.pause());
  const card = page.locator('.p-pause');
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card).toContainText('Il reste');
  await expect(card).toContainText('Se termine à');
  await video.evaluate((v) => v.play());
  await expect(card).toBeHidden({ timeout: 5000 });
});

test('anti-spoiler : les épisodes après le prochain sont voilés quand le profil le demande', async ({ page, api }) => {
  const { show, e1 } = await brigade(api);
  await api(`/api/items/${e1.id}/watched`, { method: 'POST', body: { watched: true } });
  await api('/api/profile/ui-prefs', { method: 'PUT', body: { spoilerGuard: true } });
  const d = await api(`/api/items/${show.id}`);
  expect(d.spoilerGuard).toBe(true);
  const eps = d.seasons.flatMap((s) => s.episodes);
  const next = eps.find((e) => e.season === 1 && e.episode === 2);
  const later = eps.find((e) => e.season === 2 && e.episode === 1);
  expect(next.hidden).toBeFalsy();
  expect(later.hidden).toBe(true);
  expect(later.title).toBe('Épisode 1');
  expect(later.overview).toBeNull();
  await ouvrir(page, '/series/brigade-nord');
  await page.getByRole('button', { name: /Saison 2/ }).first().click().catch(() => {});
  await expect(page.locator('.episode.spoiler .spoiler-veil').first()).toBeVisible({ timeout: 15_000 });
  // Retour à la normale
  await api('/api/profile/ui-prefs', { method: 'PUT', body: { spoilerGuard: false } });
  await api(`/api/items/${e1.id}/watched`, { method: 'POST', body: { watched: false } });
  const d2 = await api(`/api/items/${show.id}`);
  expect(d2.seasons.flatMap((s) => s.episodes).find((e) => e.season === 2).hidden).toBeFalsy();
});

test('« Qui regarde ce soir ? » : un film pour toutes les personnes présentes', async ({ page, api }) => {
  const profiles = await api('/api/profiles');
  const ids = profiles.map((p) => p.id);
  const r = await api(`/api/together?profiles=${ids.join(',')}&kind=movie`);
  expect(r.profiles.length).toBe(ids.length);
  expect(r.results.length).toBeGreaterThan(0);
  expect(r.results[0].item.type).toBe('movie');
  expect(r.results[0]).toHaveProperty('why');
  await ouvrir(page, '/cesoir');
  const box = page.locator('.together');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.locator('.together-p').nth(1).click();
  await expect(box.locator('.together-p[aria-pressed="true"]')).toHaveCount(2);
  await expect(box.locator('.together-card').first()).toBeVisible({ timeout: 15_000 });
  await box.getByRole('radio', { name: 'Séries' }).click();
  await expect(box.locator('.together-card, .grid-empty').first()).toBeVisible({ timeout: 15_000 });
});

test('sous-titres générés : la reconnaissance vocale produit une piste « Générés par Venus »', async ({ page, api }) => {
  const st = await api('/api/admin/transcribe');
  expect(st.bin).toBeTruthy();
  expect(st.modelReady).toBe(true);
  const lib = await api('/api/library?type=movie');
  const film = (Array.isArray(lib) ? lib : lib.items).find((i) => i.title === 'Le Grand Voyage');
  const job = await api(`/api/items/${film.id}/subtitles/generate`, { method: 'POST', body: {} });
  expect(job.id).toBe(film.id);
  let j;
  await expect.poll(async () => { j = await api(`/api/items/${film.id}/subtitles/generate`); return j.done || !!j.error; }, { timeout: 30_000 }).toBe(true);
  expect(j.error, JSON.stringify(j)).toBeFalsy();
  expect(j.sub.id).toBe('gfre');
  expect(j.sub.title).toContain('Générés par Venus');
  const play = await api(`/api/play/${film.id}`, { method: 'POST', body: {} });
  const sub = play.subs.find((s) => s.id === 'gfre');
  expect(sub).toBeTruthy();
  // Réglages : l'état s'affiche
  await ouvrir(page, '/reglages?onglet=lecture');
  await expect(page.locator('#transcribe')).toContainText('Reconnaissance vocale installée');
  await expect(page.locator('#transcribe')).toContainText('Modèle small');
});

test('lumières synchronisées : appairage Hue, WLED, couleurs envoyées pendant la lecture puis restaurées', async ({ page, api, request }) => {
  const { maisonPort } = etat();
  const host = `127.0.0.1:${maisonPort}`;
  const maison = async (p) => (await request.get(`http://${host}${p}`)).json();
  await request.post(`http://${host}/__reset`);
  // Pont Hue : il faut appuyer sur le bouton
  const first = await api('/api/admin/lights/hue/pair', { method: 'POST', body: { bridge: host } });
  expect(first.paired).toBe(false);
  expect(first.pressButton).toBe(true);
  await request.post(`http://${host}/__bouton`);
  const second = await api('/api/admin/lights/hue/pair', { method: 'POST', body: { bridge: host } });
  expect(second.paired).toBe(true);
  const lights = await api('/api/admin/lights/hue/lights');
  expect(lights.lights.map((l) => l.name).sort()).toEqual(['Couloir', 'Salon']);
  // WLED vérifié puis ajouté ; une adresse hors du réseau local est refusée
  const w = await api('/api/admin/lights/wled/check', { method: 'POST', body: { host } });
  expect(w.name).toBe('WLED salon');
  expect(w.leds).toBe(60);
  const bad = await request.put('/api/admin/lights', { data: { wled: ['8.8.8.8'] }, headers: { authorization: `Bearer ${etat().token}` } });
  expect(bad.status()).toBe(400);
  let st = await api('/api/admin/lights', { method: 'PUT', body: { enabled: true, hueLights: ['1'], wled: [host], brightness: 80, restore: true } });
  expect(st.targets).toBe(2);
  const t = await api('/api/admin/lights/test', { method: 'POST' });
  expect(t.sent).toBe(2);
  await wait(2600);
  // Lecture : le lecteur montre l'ampoule, envoie des couleurs ; le pont et le WLED les reçoivent
  await request.post(`http://${host}/__reset`);
  expect((await api('/api/lights')).ready).toBe(true);
  await ouvrir(page, '/films/orage-2018/lecture');
  const video = page.locator('.player video').first();
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await page.mouse.move(400, 300);
  const bulb = page.locator('.p-lights');
  await expect(bulb).toBeVisible();
  await expect(bulb).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await maison('/__journal')).journal.filter((e) => e.path === '/api/venus-test-user/lights/1/state' && e.method === 'PUT').length, { timeout: 15_000 }).toBeGreaterThan(0);
  const j = await maison('/__journal');
  const hueCall = j.journal.find((e) => e.path === '/api/venus-test-user/lights/1/state');
  expect(hueCall.body.on).toBe(true);
  expect(hueCall.body.xy).toHaveLength(2);
  expect(hueCall.body.bri).toBeGreaterThan(0);
  expect(hueCall.body.bri).toBeLessThanOrEqual(Math.round(254 * 0.8));
  const wledCall = j.journal.find((e) => e.path === '/json/state' && e.method === 'POST');
  expect(wledCall.body.seg[0].col[0]).toHaveLength(3);
  // La lampe du couloir n'est pas synchronisée
  expect(j.journal.some((e) => e.path === '/api/venus-test-user/lights/2/state')).toBe(false);
  // On coupe depuis le lecteur : les lampes reviennent à leur état d'avant (Salon : allumé 120, WLED : éteint)
  await page.mouse.move(420, 320);
  await bulb.click();
  await expect(bulb).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => { const m = await maison('/__journal'); return m.hue['1'].state.bri === 120 && m.wled.on === false; }, { timeout: 10_000 }).toBe(true);
  // Réglages : la section existe et montre l'état
  await page.evaluate(async () => { const m = await import('/js/api.js'); m.prefs.set('lights', true); });
  await ouvrir(page, '/reglages?onglet=lecture');
  await expect(page.locator('#lights')).toContainText(`Pont Hue ${host} appairé`);
  await expect(page.locator('#lights')).toContainText('2 lampe(s) synchronisée(s)');
  st = await api('/api/admin/lights', { method: 'PUT', body: { enabled: false } });
  expect(st.enabled).toBe(false);
});
