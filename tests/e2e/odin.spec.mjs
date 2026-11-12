// Odin dans Venus : la mascotte explique la page, transmet une question à Odin (faux Odin local), se cache après
// 10 touchers rapides et revient par les Réglages ; jamais sur le lecteur vidéo.
import http from 'node:http';
import { test, expect, ouvrir, etat } from './outils.mjs';

test('Odin explique la page, répond, se cache et revient', async ({ page }) => {
  // Faux Odin : /api/ask avec le jeton Bearer attendu
  let got = null;
  const odin = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/ask') {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer jeton-de-test') { res.writeHead(401); return res.end(); }
        got = JSON.parse(b).text; res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Les films sont rangés par date, touche une affiche.');
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/mascotte') {
      if (req.headers.authorization !== 'Bearer jeton-de-test') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, cache: false, event: { id: 'noel', name: 'Noël', color: '#2f8f4e', accessory: 'bonnet', says: 'Joyeux Noël !' }, pouvoirs: { actif: true, quand: { ouvre: true, ferme: true }, choix: 'favoris', favoris: ['feu'], force: 'normale' } }));
    }
    res.writeHead(200); res.end('ok');
  });
  await new Promise((r) => odin.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${odin.address().port}`;
  try {
    await ouvrir(page, '/');
    // Sans lien : la mascotte est là et explique quand même la page
    const btn = page.locator('.vn-odin-btn');
    await expect(btn).toBeVisible();
    await btn.click();
    const panel = page.getByRole('dialog', { name: 'Odin, ton guide dans Venus' });
    await expect(panel).toContainText('Accueil');
    await expect(panel).toContainText('Relie Odin');
    // L'administrateur relie Odin (le jeton n'est jamais renvoyé au navigateur)
    const put = await page.request.put('/api/admin/odin', { data: { url, token: 'jeton-de-test' }, headers: { authorization: `Bearer ${etat().token}` } });
    expect(put.ok()).toBeTruthy();
    const conf = await put.json();
    expect(conf).toMatchObject({ url, hasToken: true, reachable: true });
    expect(JSON.stringify(conf)).not.toContain('jeton-de-test');
    // Une question depuis la page Films
    await ouvrir(page, '/films');
    await page.locator('.vn-odin-btn').click();
    await expect(page.getByRole('dialog', { name: 'Odin, ton guide dans Venus' })).toContainText('Films');
    await page.getByLabel('Ta question pour Odin').fill('Comment sont rangés les films ?');
    await page.getByLabel('Ta question pour Odin').press('Enter');
    await expect(page.locator('.vn-odin-answer')).toContainText('rangés par date');
    expect(got).toContain('Depuis Venus (Freyja), page Films');
    // Odin d'aujourd'hui : bonnet de Noël et pouvoirs activés (réglés dans Odin)
    await expect(page.locator('.vn-odin-btn .vn-odin-acc')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => Boolean(window.OdinPowers && window.OdinPowers.cfg.actif))).toBe(true);
    // Fermer quelque chose : le pouvoir joue sur un fantôme (l'élément est déjà parti)
    await page.evaluate(() => { const d = document.createElement('div'); d.className = 'card'; d.style.cssText = 'position:fixed;left:200px;top:200px;width:240px;height:80px;z-index:5;background:#333'; d.innerHTML = '<button aria-label="Supprimer">×</button>'; document.body.append(d); d.querySelector('button').onclick = () => d.remove(); });
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('#odinPowers div').length)).toBeGreaterThan(5);
    // Une vidéo lancée en grand : Odin disparaît ; en pause, il revient
    await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); setInterval(() => { g.fillStyle = `hsl(${Date.now() % 360},70%,50%)`; g.fillRect(0, 0, 64, 36); }, 50); const v = document.createElement('video'); v.id = 'essai'; v.muted = true; v.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1'; v.srcObject = c.captureStream(20); document.body.append(v); await v.play(); });
    await expect(page.locator('.vn-odin-btn')).toHaveCount(0);
    await page.evaluate(() => document.getElementById('essai').pause());
    await expect(page.locator('.vn-odin-btn')).toBeVisible();
    await page.evaluate(() => document.getElementById('essai').remove());
    // 10 touchers rapides : caché sur cet appareil
    await page.locator('.vn-odin-x').click();
    await page.evaluate(() => { for (let k = 0; k < 10; k++) document.querySelector('.vn-odin-btn')?.click(); });
    await expect(page.locator('.vn-odin-btn')).toHaveCount(0);
    // Il revient par Réglages → Thème et menu → Odin
    await ouvrir(page, '/reglages?onglet=affichage');
    const box = page.locator('#odin');
    await expect(box).toBeVisible();
    await box.getByText('Odin sur cet appareil').click();
    await expect(page.locator('.vn-odin-btn')).toBeVisible();
  } finally {
    await page.request.put('/api/admin/odin', { data: { url: '', token: '' }, headers: { authorization: `Bearer ${etat().token}` } }).catch(() => {});
    odin.close();
  }
});
