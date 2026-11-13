// Musique et livres : reconnaissance des albums (MusicBrainz, pochettes), discographie et « À venir » avec Lidarr ;
// fiches et bibliographies (Open Library, Google Books) et demandes à LazyLibrarian. Tous les services sont simulés.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

// Port du Venus de test
const base = () => Number(new URL(etat().base).port);
const faux = () => `http://127.0.0.1:${base() + 5}`;
let mock, lidarr, ll;
const sent = { lidarr: [], ll: [] };
const in30 = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
const in60 = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
const months3 = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);

test.beforeAll(async () => {
  const jpg = fs.readFileSync(path.join(etat().dir, 'media', 'pochette.jpg'));
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const p = u.pathname;
    // --- MusicBrainz
    if (p === '/mb/release-group' && u.searchParams.get('query')) return json(200, { 'release-groups': [{ id: 'rg-1', score: 100, title: 'Premier Album', 'first-release-date': '2020-05-01', 'primary-type': 'Album', 'secondary-types': [], 'artist-credit': [{ name: 'Zaza', artist: { id: 'ar-1', name: 'Zaza' } }] }] });
    if (p === '/mb/release-group' && u.searchParams.get('artist') === 'ar-1') return json(200, { 'release-groups': [
      { id: 'rg-1', title: 'Premier Album', 'first-release-date': '2020-05-01', 'primary-type': 'Album', 'secondary-types': [] },
      { id: 'rg-2', title: 'Deuxième Souffle', 'first-release-date': months3, 'primary-type': 'Album', 'secondary-types': [] },
      { id: 'rg-3', title: 'Horizon', 'first-release-date': in30, 'primary-type': 'Album', 'secondary-types': [] },
      { id: 'rg-4', title: 'Live à Mamoudzou', 'first-release-date': '2021-01-01', 'primary-type': 'Album', 'secondary-types': ['Live'] },
    ] });
    if (p === '/mb/release-group/rg-1') return json(200, { id: 'rg-1', releases: [{ id: 'rel-1', status: 'Official', date: '2020-05-01' }] });
    if (p === '/mb/release/rel-1') return json(200, { id: 'rel-1', media: [{ position: 1, tracks: [{ position: 1, title: 'Lumière', length: 20000 }, { position: 2, title: 'Marée', length: 20000 }, { position: 3, title: 'Cyclone', length: 185000 }] }] });
    if (p === '/mb/artist/ar-1') return json(200, { id: 'ar-1', name: 'Zaza', type: 'Person', country: 'YT', 'life-span': { begin: '1990' }, disambiguation: 'chanteuse mahoraise' });
    if (p === '/mb/artist') return json(200, { artists: [{ id: 'ar-1', score: 100, name: 'Zaza' }] });
    // --- Cover Art Archive (redirection comme le vrai) puis l'image
    if (p.startsWith('/caa/release-group/')) { res.writeHead(307, { Location: `${faux()}/img/${p.split('/')[3]}.jpg` }); return res.end(); }
    if (p.startsWith('/img/') || p.startsWith('/olc/')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpg); }
    // --- Open Library
    if (p === '/ol/search.json' && u.searchParams.get('title')) return json(200, { docs: [{ key: '/works/OL1W', title: 'Les Misérables', author_name: ['Victor Hugo'], first_publish_year: 1862, cover_i: 101, isbn: ['9782070409228'] }] });
    if (p === '/ol/works/OL1W.json') return json(200, { description: { value: 'Jean Valjean, Cosette, Javert : la fresque de Hugo.' } });
    if (p === '/ol/search/authors.json') return json(200, { docs: [{ key: 'OL9A', name: 'Victor Hugo', birth_date: '26 February 1802', work_count: 400 }] });
    if (p === '/ol/authors/OL9A.json') return json(200, { name: 'Victor Hugo', bio: { value: 'Poète, dramaturge et romancier français.' }, birth_date: '26 February 1802', photos: [5543] });
    if (p === '/ol/search.json' && u.searchParams.get('author_key') === 'OL9A') return json(200, { docs: [
      { key: '/works/OL1W', title: 'Les Misérables', first_publish_year: 1862, cover_i: 101, edition_count: 900 },
      { key: '/works/OL2W', title: 'Notre-Dame de Paris', first_publish_year: 1831, cover_i: 102, edition_count: 500 },
      { key: '/works/OL3W', title: 'Les Travailleurs de la mer', first_publish_year: 1866, cover_i: 103, edition_count: 120 },
    ] });
    // --- Google Books : une parution annoncée et une récente
    if (p === '/gb/volumes') return json(200, { items: [
      { id: 'gb1', volumeInfo: { title: 'Hugo inédit : carnets retrouvés', publishedDate: in60, publisher: 'Éditions du Lagon', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781234567897' }], imageLinks: { thumbnail: `${faux()}/img/gb1.jpg` } } },
      { id: 'gb2', volumeInfo: { title: 'Choses vues (nouvelle édition)', publishedDate: months3, publisher: 'Folio' } },
      { id: 'gb3', volumeInfo: { title: 'Notre-Dame de Paris', publishedDate: '2019-03-01' } },
    ] });
    json(404, {});
  });
  await new Promise((r) => mock.listen(base() + 5, '127.0.0.1', r));
  // --- Faux Lidarr (API v1)
  lidarr = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.headers['x-api-key'] !== 'cle-lidarr') return json(401, {});
      const p = u.pathname;
      if (p === '/api/v1/system/status') return json(200, { appName: 'Lidarr', version: '2.9.6' });
      if (p === '/api/v1/qualityprofile') return json(200, [{ id: 1, name: 'Lossless' }, { id: 2, name: 'Standard' }]);
      if (p === '/api/v1/metadataprofile') return json(200, [{ id: 1, name: 'Standard' }]);
      if (p === '/api/v1/rootfolder') return json(200, [{ path: '/music', freeSpace: 1e12 }]);
      if (p === '/api/v1/artist' && req.method === 'GET') return json(200, []);
      if (p === '/api/v1/album' && req.method === 'GET') return json(200, [{ foreignAlbumId: 'rg-2', monitored: true }]);
      if (p === '/api/v1/artist/lookup') return json(200, [{ foreignArtistId: 'ar-1', artistName: 'Zaza', artistType: 'Person', images: [], genres: ['pop'] }, { foreignArtistId: 'ar-9', artistName: 'Zazie', images: [] }]);
      if (p === '/api/v1/album/lookup') {
        const term = u.searchParams.get('term') || '';
        const all = [{ foreignAlbumId: 'rg-3', title: 'Horizon', releaseDate: in30, albumType: 'Album', images: [], artist: { foreignArtistId: 'ar-1', artistName: 'Zaza' } }, { foreignAlbumId: 'rg-1', title: 'Premier Album', releaseDate: '2020-05-01', albumType: 'Album', images: [], artist: { foreignArtistId: 'ar-1', artistName: 'Zaza' } }];
        if (term.startsWith('lidarr:')) return json(200, all.filter((a) => a.foreignAlbumId === term.slice(7)));
        return json(200, all);
      }
      if (p === '/api/v1/album' && req.method === 'POST') { const b = JSON.parse(body); sent.lidarr.push(b); return json(201, { id: 77, title: b.title }); }
      if (p === '/api/v1/artist' && req.method === 'POST') { const b = JSON.parse(body); sent.lidarr.push(b); return json(201, { id: 78, artistName: b.artistName }); }
      if (p === '/api/v1/queue') return json(200, { records: [{ title: 'Zaza - Horizon', size: 100, sizeleft: 40, status: 'downloading', album: { title: 'Horizon', releaseDate: in30 }, artist: { artistName: 'Zaza' } }] });
      json(404, {});
    });
  });
  await new Promise((r) => lidarr.listen(base() + 6, '127.0.0.1', r));
  // --- Faux LazyLibrarian (API « cmd »)
  ll = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (u.pathname !== '/api') return json(404, {});
    if (u.searchParams.get('apikey') !== 'cle-ll') { res.writeHead(200); return res.end('Incorrect API key'); }
    const cmd = u.searchParams.get('cmd');
    if (cmd === 'getVersion') return json(200, { current_version: '1.9.0', install_type: 'git' });
    if (cmd === 'findBook') return json(200, [{ bookid: 'b-100', bookname: 'Hugo inédit : carnets retrouvés', authorname: 'Victor Hugo', bookdate: in60, bookimg: '' }, { bookid: 'b-2', bookname: 'Notre-Dame de Paris', authorname: 'Victor Hugo', bookdate: '1831', status: 'Have' }]);
    if (cmd === 'addBook' || cmd === 'queueBook') { sent.ll.push({ cmd, id: u.searchParams.get('id') }); res.writeHead(200); return res.end('OK'); }
    json(404, {});
  });
  await new Promise((r) => ll.listen(base() + 7, '127.0.0.1', r));
});
test.afterAll(async () => { for (const s of [mock, lidarr, ll]) if (s) await new Promise((r) => s.close(r)); });

test('musique : album reconnu (MusicBrainz), pochette, titre manquant, discographie et À venir', async ({ page, api }) => {
  // Lidarr relié, puis reconnaissance lancée à la main
  const r = await api('/api/admin/arr/lidarr', { method: 'PUT', body: { url: `http://127.0.0.1:${base() + 6}`, key: 'cle-lidarr' } });
  expect(r.name).toBe('Lidarr');
  expect(r.metaProfiles.length).toBe(1);
  await api('/api/admin/music-meta/run', { method: 'POST', body: { force: true } });
  let st;
  await expect.poll(async () => { st = await api('/api/admin/music-meta'); return !st.running && st.identified >= 1 && st.artists >= 1; }, { timeout: 60_000 }).toBe(true);
  // Album : date, type, liste des titres et titre manquant (Cyclone), pochette depuis Cover Art Archive
  const al = await api('/api/music/album?slug=zaza-premier-album');
  expect(al.mb.date).toBe('2020-05-01');
  expect(al.mb.expected).toBe(3);
  expect(al.mb.missing.map((t) => t.title)).toEqual(['Cyclone']);
  expect(al.cover).toBeTruthy();
  // Artiste : discographie croisée (sans le live), à venir, pas sur le NAS, déjà demandé dans Lidarr
  const ar = await api('/api/music/artist?slug=zaza');
  expect(ar.info.country).toBe('YT');
  const titles = ar.discography.map((x) => x.title);
  expect(titles).toContain('Horizon');
  expect(titles).toContain('Deuxième Souffle');
  expect(titles).not.toContain('Live à Mamoudzou');
  expect(ar.discography.find((x) => x.title === 'Premier Album').onNas).toBe(true);
  expect(ar.discography.find((x) => x.title === 'Horizon').upcoming).toBe(true);
  expect(ar.discography.find((x) => x.title === 'Deuxième Souffle').requested).toBe(true);
  const up = await api('/api/music/upcoming');
  expect(up.upcoming.map((x) => x.title)).toEqual(['Horizon']);
  expect(up.missing.map((x) => x.title)).toEqual(['Deuxième Souffle']);
  // Demande d'un album absent → Lidarr reçoit l'album avec son artiste et la recherche immédiate
  const d = await api('/api/music/request', { method: 'POST', body: { album: 'rg-3' } });
  expect(d.added).toBe(true);
  expect(sent.lidarr[0].foreignAlbumId).toBe('rg-3');
  expect(sent.lidarr[0].addOptions.searchForNewAlbum).toBe(true);
  expect(sent.lidarr[0].artist.qualityProfileId).toBe(1);
  expect(sent.lidarr[0].artist.rootFolderPath).toBe('/music');
  // Recherche Lidarr : artistes et albums, déjà sur le NAS signalé
  const s = await api('/api/music/search?q=zaza');
  expect(s.artists[0].inVenus).toBe(true);
  expect(s.albums.find((x) => x.title === 'Premier Album').inVenus).toBe(true);
  // File de téléchargement commune
  const q = await api('/api/arr/queue');
  expect(q.some((x) => x.app === 'lidarr' && x.title === 'Horizon')).toBe(true);

  // Interface : onglet À venir, page artiste, page album
  await ouvrir(page, '/musique?vue=avenir');
  await expect(page.getByText('Sorties annoncées')).toBeVisible();
  const horizon = page.locator('.m-tile', { hasText: 'Horizon' }).first();
  await expect(horizon).toBeVisible();
  await expect(horizon.locator('.up-badge')).toHaveText('À venir');
  await expect(page.locator('.m-tile', { hasText: 'Deuxième Souffle' }).locator('.up-badge')).toHaveText('Demandé');
  await ouvrir(page, '/musique/artiste/zaza');
  await expect(page.getByText('Discographie complète')).toBeVisible();
  await expect(page.locator('.m-tile', { hasText: 'Premier Album' }).locator('.up-badge')).toHaveText('Disponible');
  await page.getByRole('button', { name: 'Pas sur le NAS' }).click();
  await expect(page.locator('.m-grid .m-tile')).toHaveCount(2);
  await ouvrir(page, '/musique/album/zaza-premier-album');
  await expect(page.locator('.album-meta .missing summary')).toContainText('1 titre de l’album manque');
  await page.locator('.album-meta .missing summary').click();
  await expect(page.locator('.album-meta .missing li')).toContainText('Cyclone');
  await expect(page.locator('.m-head small').first()).toContainText('sorti le 1 mai 2020');
  // Ajouter (recherche Lidarr) depuis la page Musique
  await ouvrir(page, '/musique');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByLabel('Rechercher un artiste ou un album').fill('zaza');
  await expect(page.locator('.req-row', { hasText: 'Zazie' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.req-row', { hasText: 'Zazie' }).getByRole('button', { name: 'Suivre' }).click();
  await expect(page.locator('.req-row', { hasText: 'Zazie' }).locator('.asked')).toHaveText(/Suivi/);
  expect(sent.lidarr.at(-1).foreignArtistId).toBe('ar-9');
  expect(sent.lidarr.at(-1).addOptions.monitor).toBe('all');
  await page.keyboard.press('Escape');
});

test('livres : fiche Open Library, auteur et bibliographie, parutions à venir, demande à LazyLibrarian', async ({ page, api, request }) => {
  // Adresse invalide refusée, puis LazyLibrarian relié
  const bad = await request.put('/api/admin/books-app', { data: { app: 'lazylibrarian', url: `http://127.0.0.1:${base() + 7}`, key: 'mauvaise' }, headers: { authorization: `Bearer ${etat().token}` } });
  expect(bad.status()).toBe(502);
  expect((await bad.json()).error).toMatch(/refusée/);
  const ok = await api('/api/admin/books-app', { method: 'PUT', body: { app: 'lazylibrarian', url: `http://127.0.0.1:${base() + 7}`, key: 'cle-ll' } });
  expect(ok.name).toBe('LazyLibrarian');
  await api('/api/admin/books-meta/run', { method: 'POST', body: { force: true } });
  let st;
  await expect.poll(async () => { st = await api('/api/admin/books-meta'); return !st.running && st.identified >= 1 && st.authors >= 1; }, { timeout: 60_000 }).toBe(true);
  // Le livre du NAS a reçu couverture, résumé et année
  const lib = await api('/api/books');
  const mis = lib.books.find((b) => b.title === 'Les Misérables');
  expect(mis.year).toBe(1862);
  expect(mis.cover).toBeTruthy();
  expect(mis.overview).toContain('Jean Valjean');
  expect(lib.authors.map((a) => a.name)).toEqual(['Victor Hugo']);
  expect(lib.request).toBe(true);
  // Bibliographie croisée : sur le NAS, pas sur le NAS, parution annoncée (Google Books), éditions dédoublonnées
  const au = await api('/api/books/author?slug=victor-hugo');
  expect(au.bio).toContain('Poète');
  const w = (t) => au.works.find((x) => x.title === t);
  expect(w('Les Misérables').onNas).toBe(true);
  expect(w('Notre-Dame de Paris').onNas).toBe(false);
  expect(w('Hugo inédit : carnets retrouvés').upcoming).toBe(true);
  expect(au.works.filter((x) => x.title === 'Notre-Dame de Paris')).toHaveLength(1);
  const up = await api('/api/books/upcoming');
  expect(up.upcoming.map((x) => x.title)).toEqual(['Hugo inédit : carnets retrouvés']);
  expect(up.missing.map((x) => x.title)).toContain('Choses vues (nouvelle édition)');
  // Demande : LazyLibrarian reçoit addBook puis queueBook avec l'identifiant trouvé
  const d = await api('/api/books/request', { method: 'POST', body: { title: 'Hugo inédit : carnets retrouvés', author: 'Victor Hugo' } });
  expect(d.added).toBe(true);
  expect(sent.ll.map((x) => x.cmd)).toEqual(['addBook', 'queueBook']);
  expect(sent.ll[1].id).toBe('b-100');
  // Recherche : déjà dans LazyLibrarian (Have) signalé
  const s = await api('/api/books/search?q=hugo');
  expect(s.find((x) => x.title === 'Notre-Dame de Paris').requested).toBe(true);

  // Interface : onglets Auteurs et À venir, page auteur avec filtre
  await ouvrir(page, '/livres?vue=auteurs');
  await page.locator('.m-tile', { hasText: 'Victor Hugo' }).click();
  await expect(page).toHaveURL(/\/livres\/auteur\/victor-hugo/);
  await expect(page.locator('.author-bio')).toContainText('Poète');
  await expect(page.locator('.m-tile', { hasText: 'Les Misérables' }).locator('.up-badge')).toHaveText('Disponible');
  await expect(page.locator('.m-tile', { hasText: 'Hugo inédit' }).locator('.up-badge')).toHaveText('À venir');
  await page.getByRole('button', { name: 'Pas sur le NAS' }).click();
  await expect(page.locator('.m-tile', { hasText: 'Les Misérables' })).toHaveCount(0);
  await ouvrir(page, '/livres?vue=avenir');
  await expect(page.getByText('Parutions annoncées')).toBeVisible();
  const tile = page.locator('.m-tile', { hasText: 'Hugo inédit' }).first();
  await expect(tile.locator('.up-badge')).toHaveText('À venir');
  await tile.getByRole('button', { name: 'Demander' }).click();
  await expect(tile.locator('.asked')).toHaveText(/Demandé/);
  // Réglages : la section livres montre l'application reliée et la reconnaissance
  await ouvrir(page, '/reglages?onglet=demandes');
  await expect(page.locator('#books-app')).toContainText('LazyLibrarian 1.9.0 relié');
  await expect(page.locator('#media-meta')).toContainText('1/1 livre(s) reconnu(s)');
  await expect(page.locator('#arr')).toContainText('Lidarr');
  await api('/api/admin/books-app', { method: 'PUT', body: { remove: true } });
  await api('/api/admin/arr/lidarr', { method: 'PUT', body: { remove: true } });
});
