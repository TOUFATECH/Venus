// Robustesse et contrôle parental : entrées invalides sans erreur 500, lecture par plages, profils avec limite
// d'âge (musique, livres et photos ouverts ; titres cachés intouchables), secrets chiffrés dans la base, heure du
// serveur, bibliothèque supprimée retirée tout de suite des listes.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, etat, PASSWORD } from './outils.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const listOf = (d) => (Array.isArray(d) ? d : d.items || []);

// Appel brut : état HTTP et corps, sans exiger une réussite
const brut = (request, token) => async (p, o = {}) => {
  const r = await request.fetch(p, { method: o.method || 'GET', data: o.body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* pas du JSON */ }
  return { status: r.status(), body, headers: r.headers(), size: (await r.body()).length };
};

test('entrées invalides : pas d’erreur 500 (cookie mal encodé, titre inconnu)', async ({ request }) => {
  const { token } = etat();
  const call = brut(request, token);
  // Cookie illisible : ignoré, la page d'état répond
  const anonyme = brut(request, null);
  expect((await anonyme('/api/status', { headers: { cookie: 'vn_token=%E0%A4%A' } })).status).toBe(200);
  // Titre inconnu : « introuvable », pas une erreur interne
  expect((await call('/api/items/999999/mylist', { method: 'POST', body: {} })).status).toBe(404);
  expect((await call('/api/progress', { method: 'POST', body: { itemId: 999999, position: 12, duration: 100 } })).status).toBe(404);
  expect((await call('/api/items/999999/trailer', { method: 'POST', body: {} })).status).toBe(404);
});

test('lecture directe par plages : en-tête invalide ignoré, fin de fichier plus grande que le fichier', async ({ api, request }) => {
  const { token } = etat();
  const call = brut(request, token);
  const film = listOf(await api('/api/library?type=movie')).find((i) => i.title === 'Orage');
  const url = `/api/stream/${film.id}/file`;
  const entier = await call(url);
  expect(entier.status).toBe(200);
  const taille = entier.size;
  // « bytes=0-99 » : 100 octets
  const debut = await call(url, { headers: { range: 'bytes=0-99' } });
  expect(debut.status).toBe(206); expect(debut.size).toBe(100);
  // En-tête invalide : le fichier entier (avant : réponse 206 amputée du premier octet)
  const faux = await call(url, { headers: { range: 'bytes=abc' } });
  expect(faux.status).toBe(200); expect(faux.size).toBe(taille);
  // Les « N derniers octets » avec N plus grand que le fichier : tout le fichier (avant : erreur 416)
  const fin = await call(url, { headers: { range: `bytes=-${taille * 10}` } });
  expect(fin.status).toBe(206); expect(fin.size).toBe(taille);
  expect(fin.headers['content-range']).toBe(`bytes 0-${taille - 1}/${taille}`);
  // Début après la fin : plage impossible
  expect((await call(url, { headers: { range: `bytes=${taille + 5}-` } })).status).toBe(416);
});

test('profil avec limite d’âge : musique, livres et photos s’ouvrent ; un titre caché ne peut être ni noté ni marqué', async ({ api, request }) => {
  const admin = etat().token;
  const profils = await api('/api/profiles');
  const ado = (profils.profiles || profils).find((p) => p.name === 'Ado test') || await api('/api/profiles', { method: 'POST', body: { name: 'Ado test', avatar: 5, maxAge: 12 } });
  // Un appareil de plus, sur ce profil
  const login = await request.fetch('/api/login', { method: 'POST', data: { password: PASSWORD } });
  const token = (await login.json()).token;
  const call = brut(request, token);
  expect((await call(`/api/profiles/${ado.id}/select`, { method: 'POST', body: {} })).status).toBe(200);
  try {
    // Les films des tests n'ont pas de classification : cachés pour ce profil
    const film = listOf(await api('/api/library?type=movie'))[0];
    expect(listOf((await call('/api/library?type=movie')).body)).toHaveLength(0);
    expect((await call(`/api/items/${film.id}`)).status).toBe(403);
    for (const [p, body] of [[`/api/items/${film.id}/mylist`, {}], [`/api/items/${film.id}/watched`, { watched: true }], [`/api/items/${film.id}/opinion`, { liked: true }], [`/api/items/${film.id}/forget`, {}], [`/api/items/${film.id}/trailer`, {}]]) {
      expect((await call(p, { method: 'POST', body })).status, p).toBe(404);
    }
    expect((await call('/api/progress', { method: 'POST', body: { itemId: film.id, position: 20, duration: 30 } })).status).toBe(404);
    // Musique, livres, photos : listés ET lisibles (avant : listés, puis « introuvable » à l'ouverture)
    const musique = (await call('/api/music')).body;
    const titre = (musique.tracks || [])[0];
    expect(titre, 'un titre de musique est listé').toBeTruthy();
    expect((await call(`/api/audio/${titre.id}`)).status).toBe(200);
    const livres = (await call('/api/books')).body;
    const livre = (livres.books || livres.items || livres)[0];
    expect(livre, 'un livre est listé').toBeTruthy();
    expect((await call(`/api/books/${livre.id}`)).status).toBe(200);
    const albums = (await call('/api/photos')).body;
    expect(albums.length).toBeGreaterThan(0);
    expect((await call(`/api/photo/${albums[0].cover}?w=320`)).status).toBe(200);
    // Rien n'a été écrit pour le film caché
    const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'), { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) n FROM progress WHERE profile_id = ? AND item_id = ?').get(ado.id, film.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM mylist WHERE profile_id = ? AND item_id = ?').get(ado.id, film.id).n).toBe(0);
    db.close();
  } finally {
    await request.fetch(`/api/profiles/${ado.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } });
  }
});

test('secrets chiffrés dans la base : clé de service, secret de webhook ; sauvegarde lisible par Venus seulement', async ({ api, request }) => {
  const { token, dir } = etat();
  const call = brut(request, token);
  const CLE = 'cle-acoustid-de-test-1234', SECRET = 'secret-webhook-de-test-5678';
  await api('/api/admin/music-meta', { method: 'PUT', body: { acoustidKey: CLE } });
  const hook = await call('/api/admin/webhooks', { method: 'POST', body: { name: 'Test', url: 'http://127.0.0.1:9/hook', secret: SECRET, events: ['library.added'] } });
  expect(hook.status).toBe(200);
  try {
    const db = new DatabaseSync(path.join(dir, 'data', 'venus.db'), { readOnly: true });
    const lire = (k) => String((db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value || '');
    for (const [k, clair] of [['acoustid_key', CLE], ['webhooks', SECRET]]) {
      expect(lire(k), k).toContain('enc1:');
      expect(lire(k), k).not.toContain(clair);
    }
    db.close();
    // Venus, lui, relit bien ses réglages
    const hooks = await api('/api/admin/webhooks');
    expect(JSON.stringify(hooks)).toContain('127.0.0.1:9/hook');
    // Sauvegarde : mêmes droits que la base (600)
    const b = await api('/api/admin/backups', { method: 'POST', body: {} });
    expect(b.name).toBeTruthy();
    const nom = b.name;
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'data', 'backups', nom)).mode & 0o777).toBe(0o600);
  } finally {
    await api('/api/admin/music-meta', { method: 'PUT', body: { acoustidKey: '' } });
    const id = hook.body && hook.body.id;
    if (id) await request.fetch(`/api/admin/webhooks/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  }
});

test('heure du serveur : fuseau repris de l’appareil de l’administrateur à la maison, puis réglable', async ({ api, request }) => {
  const { token } = etat();
  const call = brut(request, token);
  // Aucun fuseau choisi au départ, quoi qu'aient fait les tests précédents
  await api('/api/admin/settings', { method: 'PUT', body: { timezone: '' } });
  const avant = (await api('/api/admin')).clock;
  expect(avant.zone).toBeTruthy(); expect(avant.chosen).toBe(false);
  // Un fuseau très éloigné de celui de la machine de test, quel qu'il soit
  const loin = avant.offset === -600 ? 'Asia/Tokyo' : 'Pacific/Tahiti';
  try {
    expect((await call('/api/admin/clock', { method: 'POST', body: { zone: 'Mars/Olympus' } })).status).toBe(400);
    // Jamais « UTC » ni « Etc/… » (réglage d'usine de certains appareils)
    expect((await call('/api/admin/clock', { method: 'POST', body: { zone: 'Etc/GMT+5' } })).body.adopted).toBe(false);
    const r = (await call('/api/admin/clock', { method: 'POST', body: { zone: loin } })).body;
    expect(r.adopted).toBe(true);
    expect(r.zone).toBe(loin);
    const apres = (await api('/api/admin')).clock;
    expect(apres.zone).toBe(loin); expect(apres.chosen).toBe(true);
    expect(apres.offset).toBe(loin === 'Asia/Tokyo' ? 540 : -600);
    // Une fois choisi, un autre appareil ne le change plus
    const autre = (await call('/api/admin/clock', { method: 'POST', body: { zone: 'America/Martinique' } })).body;
    expect(autre.adopted).toBe(false); expect(autre.zone).toBe(loin);
    // Réglable à la main, fuseau inconnu refusé
    expect((await call('/api/admin/settings', { method: 'PUT', body: { timezone: 'Nulle/Part' } })).status).toBe(400);
    await api('/api/admin/settings', { method: 'PUT', body: { timezone: 'Indian/Mayotte' } });
    expect((await api('/api/admin')).clock.offset).toBe(180);
  } finally {
    // Retour à l'heure de la machine pour les autres tests
    await api('/api/admin/settings', { method: 'PUT', body: { timezone: '' } });
  }
  const fin = (await api('/api/admin')).clock;
  expect(fin.zone).toBe(avant.system); expect(fin.chosen).toBe(false);
});

test('bibliothèque supprimée : ses titres quittent les listes tout de suite', async ({ api, request }) => {
  const { token, dir } = etat();
  const dossier = path.join(dir, 'media', 'films-temporaires');
  fs.mkdirSync(path.join(dossier, 'Zénith (2001)'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'media', 'films', 'Orage (2018).mp4'), path.join(dossier, 'Zénith (2001)', 'Zénith (2001).mp4'));
  const lib = await api('/api/admin/libraries', { method: 'POST', body: { type: 'movies', name: 'Films temporaires', path: dossier } });
  const id = lib.id || (lib.library && lib.library.id) || (await api('/api/admin')).libraries.find((l) => l.name === 'Films temporaires').id;
  await api('/api/admin/scan', { method: 'POST', body: {} });
  const present = async () => listOf(await api('/api/library?type=movie')).some((i) => i.title === 'Zénith');
  for (let i = 0; i < 80 && !(await present()); i++) await wait(250);
  expect(await present()).toBe(true);
  const r = await request.fetch(`/api/admin/libraries/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  // Tout de suite : ni dans la liste des films, ni sur l'accueil
  expect(await present()).toBe(false);
  expect(JSON.stringify(await api('/api/home'))).not.toContain('Zénith');
  fs.rmSync(dossier, { recursive: true, force: true });
});
