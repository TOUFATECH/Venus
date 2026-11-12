// VF disponible (badge, filtre, fiche), « Chercher en VF » auprès de Radarr, arrivées et épisode précis pour Odin
import http from 'node:http';
import path from 'node:path';
import { test, expect, ouvrir, etat } from './outils.mjs';

const FR = JSON.stringify({ audio: [{ lang: 'fre', codec: 'aac', channels: 2 }, { lang: 'jpn', codec: 'aac', channels: 2 }], subs: [] });
const VO = JSON.stringify({ audio: [{ lang: 'eng', codec: 'aac', channels: 2 }], subs: [] });

test('VF : badge sur les affiches, filtre, fiche et pastille par épisode', async ({ page, api }) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(etat().dir, 'data', 'venus.db'));
  const films = await api('/api/library?type=movie');
  const film = films.find((x) => /Grand Voyage/.test(x.title)) || films[0];
  const autre = films.find((x) => x.id !== film.id);
  const bn = (await api('/api/library?type=show')).find((x) => /Brigade Nord/.test(x.title));
  const eps = db.prepare("SELECT id FROM items WHERE show_id = ? AND type = 'episode' ORDER BY season_num, episode_num").all(bn.id);
  const before = db.prepare('SELECT id, probe FROM items WHERE id IN (' + [film.id, autre.id, ...eps.map((e) => e.id)].join(',') + ')').all();
  try {
    db.prepare('UPDATE items SET probe = ? WHERE id = ?').run(FR, film.id);
    db.prepare('UPDATE items SET probe = ? WHERE id = ?').run(VO, autre.id);
    // Une partie des épisodes seulement en VF
    eps.forEach((e, i) => db.prepare('UPDATE items SET probe = ? WHERE id = ?').run(i === 0 ? FR : VO, e.id));

    const lib = await api('/api/library?type=movie');
    expect(lib.find((x) => x.id === film.id).vf).toBe('vf');
    expect(lib.find((x) => x.id === autre.id).vf).toBeFalsy();
    const lite = await api('/api/library?type=movie&lite=1&limit=500');
    expect(lite.items.find((x) => x.id === film.id).vf).toBe('vf');
    const show = (await api('/api/library?type=show')).find((x) => x.id === bn.id);
    expect(show.vf).toBe(eps.length > 1 ? 'partiel' : 'vf');
    expect(show.vfn).toBe(`1/${eps.length}`);

    const d = await api(`/api/items/${bn.id}`);
    expect(d.vf.vf).toBe(1);
    const all = d.seasons.flatMap((s) => s.episodes);
    expect(all.find((e) => e.id === eps[0].id).vf).toBe(true);

    // Affiches : badge « VF »
    await ouvrir(page, '/films');
    await expect(page.locator('.card .vf-pill').first()).toBeVisible();
    // Fiche : « VF disponible »
    const fd = await api(`/api/items/${film.id}`);
    await ouvrir(page, fd.path || `/titre/${film.id}`);
    await expect(page.locator('.meta .badge.vf')).toContainText('VF');
  } finally {
    for (const r of before) db.prepare('UPDATE items SET probe = ? WHERE id = ?').run(r.probe, r.id);
    db.close();
  }
});

test('Chercher en VF : format et profil « + VF » créés dans Radarr, film passé dessus, recherche lancée', async ({ api }) => {
  // Faux Radarr
  const journal = [];
  const state = { formats: [], profiles: [{ id: 1, name: 'HD-1080p', upgradeAllowed: false, cutoffFormatScore: 0, formatItems: [] }], movies: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null, u = new URL(req.url, 'http://x');
      journal.push({ m: req.method, p: u.pathname, body });
      const send = (x) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
      if (u.pathname === '/api/v3/system/status') return send({ version: '5.0', appName: 'Radarr' });
      if (u.pathname === '/api/v3/rootfolder') return send([{ path: '/films' }]);
      if (u.pathname === '/api/v3/qualityprofile' && req.method === 'GET') return send(state.profiles);
      if (u.pathname === '/api/v3/qualityprofile' && req.method === 'POST') { const p = { ...body, id: 7 }; state.profiles.push(p); return send(p); }
      if (u.pathname === '/api/v3/customformat' && req.method === 'GET') return send(state.formats);
      if (u.pathname === '/api/v3/customformat' && req.method === 'POST') { const f = { ...body, id: 3 }; state.formats.push(f); return send(f); }
      if (u.pathname === '/api/v3/movie' && req.method === 'GET') return send(state.movies);
      if (/^\/api\/v3\/movie\/\d+$/.test(u.pathname) && req.method === 'PUT') { state.movies[0] = body; return send(body); }
      if (u.pathname === '/api/v3/command') return send({ id: 1, name: body.name });
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const film = (await api('/api/library?type=movie'))[0];
    state.movies = [{ id: 42, title: film.title, year: film.year, tmdbId: 999001, qualityProfileId: 1, monitored: false }];
    await api('/api/admin/arr/radarr', { method: 'PUT', body: { url, key: 'cle-test' } });
    const r = await api(`/api/items/${film.id}/vf`, { method: 'POST' });
    expect(r.text).toMatch(/version française/);
    expect(state.formats[0].name).toBe('VF (Venus)');
    const vfp = state.profiles.find((p) => p.name === 'HD-1080p + VF');
    expect(vfp.formatItems.find((f) => f.format === 3).score).toBe(1000);
    expect(state.movies[0].qualityProfileId).toBe(7);
    expect(journal.some((j) => j.p === '/api/v3/command' && j.body.name === 'MoviesSearch' && j.body.movieIds[0] === 42)).toBe(true);
    // Deuxième demande : rien n'est recréé
    await api(`/api/items/${film.id}/vf`, { method: 'POST' });
    expect(state.formats.length).toBe(1);
    expect(state.profiles.length).toBe(2);
    expect((await api(`/api/items/${film.id}`)).vfWanted).toBe(true);
  } finally {
    await api('/api/admin/arr/radarr', { method: 'PUT', body: { remove: true } }).catch(() => {});
    srv.close();
  }
});

test('Odin : arrivées et épisode précis (dernier, suivant, S/E)', async ({ api }) => {
  const bn = (await api('/api/library?type=show')).find((x) => /Brigade Nord/.test(x.title));
  const last = await api(`/api/shows/${bn.id}/episode?which=last`);
  const first = await api(`/api/shows/${bn.id}/episode?which=first`);
  expect(last.show.title).toBe(bn.title);
  expect(last.play).toMatch(/S\d+E\d+/);
  expect(last.season * 1000 + last.episode).toBeGreaterThanOrEqual(first.season * 1000 + first.episode);
  const exact = await api(`/api/shows/${bn.id}/episode?s=${first.season}&e=${first.episode}`);
  expect(exact.id).toBe(first.id);
  const next = await api(`/api/shows/${bn.id}/episode?which=next`);
  expect(next.id).toBeTruthy();
  const arr = await api('/api/arrivals?since=0&limit=300');
  expect(arr.items.some((a) => a.kind === 'episode' && a.showId === bn.id)).toBe(true);
});
