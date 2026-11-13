#!/usr/bin/env node
// Test de charge de Venus : plusieurs personnes en même temps qui naviguent, et des vidéos et chaînes lancées.
// Sans dépendance. À lancer depuis n'importe quelle machine du réseau (ou sur le serveur) :
//
//   node scripts/load-test.mjs --url http://192.168.1.126:8096 --password "mot de passe du foyer" \
//        --users 30 --videos 4 --channels 2 --duration 120 [--pin 1234]
//
// Chaque « personne » connecte son propre appareil, choisit un profil sans code PIN (ou celui du --pin), puis
// enchaîne accueil, bibliothèques, fiches, recherche, à venir, guide… Les « vidéos » lancent une vraie lecture et
// téléchargent les morceaux au rythme de la lecture (×1,5) : on mesure le démarrage et les coupures.
// À la fin : temps de réponse (médian, 95 %, max), erreurs, démarrage des vidéos, coupures, mémoire du serveur.
// Les appareils créés par le test sont déconnectés à la fin.

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const URL0 = String(args.url || 'http://localhost:8096').replace(/\/+$/, '');
const PASSWORD = String(args.password || process.env.VENUS_PASSWORD || '');
const USERS = Number(args.users || 20), VIDEOS = Number(args.videos || 3), CHANNELS = Number(args.channels || 1);
const DURATION = Number(args.duration || 60) * 1000, PIN = args.pin ? String(args.pin) : null;
if (!PASSWORD) { console.error('Indiquez le mot de passe du foyer : --password "…"'); process.exit(1); }

const stats = new Map(); // nom → { n, err, times[] }
const errors = new Map();
// Enregistre la durée et le résultat d'une requête dans les statistiques
const rec = (name, ms, ok, why) => {
  const s = stats.get(name) || { n: 0, err: 0, times: [] };
  s.n++; s.times.push(ms); if (!ok) { s.err++; const k = `${name} : ${why}`; errors.set(k, (errors.get(k) || 0) + 1); }
  stats.set(name, s);
};
// Requête vers Venus, chronométrée
async function req(token, method, path, body, name = path.replace(/\d+/g, ':id').replace(/\?.*$/, '')) {
  const t0 = performance.now();
  try {
    const r = await fetch(URL0 + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const buf = await r.arrayBuffer();
    const ms = performance.now() - t0;
    rec(`${method} ${name}`, ms, r.status < 500 && r.status !== 429, `HTTP ${r.status}`);
    let json = null; try { json = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { /* binaire */ }
    return { status: r.status, json, bytes: buf.byteLength, ms };
  } catch (e) {
    rec(`${method} ${name}`, performance.now() - t0, false, e.name === 'TimeoutError' ? 'délai dépassé (30 s)' : e.message);
    return { status: 0, json: null, bytes: 0 };
  }
}
// Pause de quelques millisecondes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Élément au hasard dans une liste
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Percentile p d'une liste de durées
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// Simule un appareil : connexion puis choix d'un profil
async function device(i) {
  const r = await req(null, 'POST', '/api/login', { password: PASSWORD }, '/api/login');
  if (!r.json || !r.json.token) throw new Error(`connexion refusée (${r.status}${r.json && r.json.error ? ` : ${r.json.error}` : ''})`);
  const token = r.json.token;
  const profiles = (await req(token, 'GET', '/api/profiles')).json || [];
  const p = profiles.find((x) => !x.hasPin) || (PIN ? profiles.find((x) => x.hasPin) : null);
  if (!p) throw new Error('aucun profil sans code PIN : ajoutez --pin');
  const sel = await req(token, 'POST', `/api/profiles/${p.id}/select`, p.hasPin ? { pin: PIN } : {}, '/api/profiles/:id/select');
  if (sel.status !== 200) throw new Error(`profil refusé (${sel.status})`);
  return { token, i, profile: p };
}

let catalog = { movie: [], show: [], channel: [] };
// Charge le catalogue (films, séries, chaînes) pour choisir quoi lire
async function loadCatalog(token) {
  for (const t of ['movie', 'show', 'channel']) {
    const r = await req(token, 'GET', `/api/library?type=${t}`);
    const items = r.json ? (Array.isArray(r.json) ? r.json : r.json.items || []) : [];
    catalog[t] = items.map((x) => x.id).filter(Boolean);
  }
}

// Une personne qui navigue
async function browse(d, until) {
  const words = ['le', 'la', 'un', 'man', 'dra', 'ani', 'star', 'nuit'];
  while (Date.now() < until) {
    const roll = Math.random();
    if (roll < 0.2) await req(d.token, 'GET', '/api/home');
    else if (roll < 0.4) await req(d.token, 'GET', `/api/library?type=${pick(['movie', 'show', 'anime'])}`);
    else if (roll < 0.62 && (catalog.movie.length || catalog.show.length)) await req(d.token, 'GET', `/api/items/${pick([...catalog.movie, ...catalog.show])}`);
    else if (roll < 0.72) await req(d.token, 'GET', `/api/library?type=movie&q=${pick(words)}`, null, '/api/library?q');
    else if (roll < 0.8) await req(d.token, 'GET', `/api/upcoming?type=${pick(['movie', 'show', 'anime'])}`);
    else if (roll < 0.86) await req(d.token, 'GET', '/api/status');
    else if (roll < 0.92) await req(d.token, 'GET', '/api/library?type=channel');
    else await req(d.token, 'GET', '/api/mylist');
    await sleep(300 + Math.random() * 1200); // temps de lecture de la page
  }
}

// Une lecture : démarrage, puis morceaux téléchargés au rythme de la lecture (×1,5)
const play = { started: 0, failed: 0, startMs: [], stalls: 0, segments: 0, segMs: [], bytes: 0, why: new Map() };
// Compte une coupure de lecture et sa cause
const stall = (label, why) => { play.stalls++; const k = `${label} : ${why}`; play.why.set(k, (play.why.get(k) || 0) + 1); };
// Simule une lecture : liste HLS puis segments, au rythme de la vidéo
async function watch(d, id, until, label) {
  const caps = { video: ['h264'], audio: ['aac', 'mp3'], containers: ['mp4', 'hls'], maxHeight: 1080 };
  const t0 = performance.now();
  const r = await req(d.token, 'POST', `/api/play/${id}`, { caps, start: 0 }, `/api/play (${label})`);
  if (!r.json || !r.json.url) { play.failed++; stall(label, `lecture refusée : ${(r.json && r.json.error) || r.status}`); return; }
  const base = URL0;
  if (r.json.mode === 'direct') {
    // Lecture directe : morceaux de 2 Mo
    let off = 0; let first = true;
    while (Date.now() < until) {
      const s = performance.now();
      const res = await fetch(base + r.json.url, { headers: { Range: `bytes=${off}-${off + 2 * 1024 * 1024 - 1}`, Authorization: `Bearer ${d.token}` } }).catch(() => null);
      if (!res || res.status >= 400) { stall(label, `lecture directe HTTP ${res ? res.status : 'injoignable'}`); break; }
      const b = await res.arrayBuffer(); play.bytes += b.byteLength; off += b.byteLength;
      if (first) { play.started++; play.startMs.push(performance.now() - t0); first = false; }
      play.segments++; play.segMs.push(performance.now() - s);
      if (b.byteLength < 2 * 1024 * 1024) off = 0;
      await sleep(1000);
    }
    return;
  }
  // HLS : liste des morceaux, puis chaque morceau
  const plUrl = base + r.json.url;
  let first = true, n = 0, segDur = 4;
  while (Date.now() < until) {
    const plr = await fetch(plUrl, { headers: { Authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    const pl = plr && plr.ok ? await plr.text() : '';
    if (plr && plr.status >= 400 && first) { // la source ne répond pas (chaîne hors service) : Venus le dit, on n'insiste pas
      play.failed++; let why = `HTTP ${plr.status}`; try { why = (await plr.json()).error || why; } catch { /* */ }
      stall(label, `source injoignable (${why})`); return;
    }
    const segs = pl.split('\n').filter((l) => l && !l.startsWith('#'));
    const durs = [...pl.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
    if (durs.length) segDur = durs[0];
    const live = !/#EXT-X-ENDLIST/.test(pl) && !/#EXT-X-PLAYLIST-TYPE:VOD/.test(pl);
    if (!segs.length) { if (!first) stall(label, 'liste des morceaux vide'); await sleep(1000); continue; }
    const target = live ? segs.length - 1 : Math.min(n, segs.length - 1);
    const seg = new URL(segs[target], plUrl).toString();
    const s = performance.now();
    const res = await fetch(seg, { headers: { Authorization: `Bearer ${d.token}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    const ms = performance.now() - s;
    if (!res || res.status >= 400) { stall(label, `morceau HTTP ${res ? res.status : 'injoignable'}`); await sleep(1000); continue; }
    const b = await res.arrayBuffer(); play.bytes += b.byteLength;
    if (first) { play.started++; play.startMs.push(performance.now() - t0); first = false; }
    play.segments++; play.segMs.push(ms);
    if (ms > segDur * 1000) stall(label, 'morceau plus lent que la lecture'); // image figée
    n++;
    await sleep(Math.max(0, (segDur * 1000) / 1.5 - ms));
  }
}

// Mesure l'état du serveur (mémoire, descripteurs) pendant le test
async function serverSnapshot(token) {
  const d = (await req(token, 'GET', '/api/admin/dashboard', null, '(mesure) dashboard')).json;
  return d && d.system ? { rss: d.system.rss, load: d.system.load && d.system.load[0] } : null;
}

(async () => {
  console.log(`▸ Venus ${URL0} : ${USERS} personnes, ${VIDEOS} vidéo(s), ${CHANNELS} chaîne(s), ${DURATION / 1000} s`);
  const devices = [];
  for (let i = 0; i < USERS; i++) {
    try { devices.push(await device(i)); } catch (e) { console.error(`  appareil ${i + 1} : ${e.message}`); if (!devices.length) process.exit(1); }
  }
  console.log(`▸ ${devices.length} appareils connectés`);
  await loadCatalog(devices[0].token);
  console.log(`▸ Catalogue : ${catalog.movie.length} films, ${catalog.show.length} séries, ${catalog.channel.length} chaînes`);
  const before = await serverSnapshot(devices[0].token);
  const until = Date.now() + DURATION;
  const samples = [];
  const sampler = setInterval(async () => { const s = await serverSnapshot(devices[0].token); if (s) samples.push(s); }, 5000);
  const episodes = [];
  const jobs = devices.map((d) => browse(d, until));
  // Vidéos : films (ou épisodes) au hasard ; chaînes : en direct
  for (let v = 0; v < VIDEOS && catalog.movie.length; v++) jobs.push(watch(devices[v % devices.length], pick(catalog.movie), until, 'film'));
  for (let c = 0; c < CHANNELS && catalog.channel.length; c++) jobs.push(watch(devices[(VIDEOS + c) % devices.length], catalog.channel[c % catalog.channel.length], until, 'chaîne'));
  void episodes;
  const tick = setInterval(() => { if (process.stdout.isTTY) process.stdout.write(`\r  … ${Math.max(0, Math.round((until - Date.now()) / 1000))} s restantes, ${[...stats.values()].reduce((a, s) => a + s.n, 0)} requêtes   `); }, 1000);
  await Promise.all(jobs);
  clearInterval(tick); clearInterval(sampler);
  const after = await serverSnapshot(devices[0].token);
  process.stdout.write('\n');

  // ---------------------------------------------------------------- rapport
  const rows = [...stats.entries()].sort((a, b) => b[1].n - a[1].n);
  const total = rows.reduce((a, [, s]) => a + s.n, 0), errs = rows.reduce((a, [, s]) => a + s.err, 0);
  console.log(`\nRequêtes : ${total} en ${DURATION / 1000} s (${(total / (DURATION / 1000)).toFixed(1)}/s), erreurs : ${errs} (${((errs / Math.max(1, total)) * 100).toFixed(2)} %)`);
  console.log('Temps de réponse (ms)           nombre   médian    95 %     max   erreurs');
  for (const [name, s] of rows) console.log(`  ${name.padEnd(30).slice(0, 30)} ${String(s.n).padStart(6)} ${pct(s.times, 0.5).toFixed(0).padStart(8)} ${pct(s.times, 0.95).toFixed(0).padStart(7)} ${Math.max(...s.times).toFixed(0).padStart(7)} ${String(s.err).padStart(8)}`);
  if (errors.size) { console.log('\nErreurs :'); for (const [k, n] of errors) console.log(`  ${n} × ${k}`); }
  console.log(`\nLectures : ${play.started} démarrées, ${play.failed} refusées · démarrage médian ${pct(play.startMs, 0.5).toFixed(0)} ms, max ${Math.max(0, ...play.startMs).toFixed(0)} ms`);
  console.log(`  ${play.segments} morceaux (${(play.bytes / 1048576).toFixed(0)} Mo), temps médian ${pct(play.segMs, 0.5).toFixed(0)} ms, 95 % ${pct(play.segMs, 0.95).toFixed(0)} ms, coupures : ${play.stalls}`);
  for (const [k, n] of play.why) console.log(`    ${n} × ${k}`);
  if (before && after) {
    const peak = Math.max(after.rss, ...samples.map((x) => x.rss));
    console.log(`\nServeur : mémoire ${(before.rss / 1048576).toFixed(0)} Mo → ${(after.rss / 1048576).toFixed(0)} Mo (pic ${(peak / 1048576).toFixed(0)} Mo), charge ${Math.max(...samples.map((x) => x.load || 0), after.load || 0).toFixed(2)}`);
  }
  // Ménage : déconnexion des appareils du test
  await Promise.all(devices.map((d) => req(d.token, 'POST', '/api/logout', {}, '(ménage) logout')));
  const ok = errs / Math.max(1, total) < 0.01 && play.started > 0;
  console.log(`\n${ok ? '✅ Le serveur tient la charge.' : '⚠️ À regarder : erreurs ou lectures refusées ci-dessus.'}`);
  process.exit(ok ? 0 : 2);
})();
