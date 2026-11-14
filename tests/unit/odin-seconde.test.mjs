// Venus synchronisé avec Odin à la seconde (modules, vraie base PostgreSQL, faux Odin fidèle au contrat) :
// chaque changement part en « changements » (seulement les lignes touchées) en moins de 2 s, regroupé ; vérification à
// l'identique par empreinte ; coupure réseau → file d'attente chiffrée puis rattrapage dans l'ordre ; une écriture qui a
// échappé au suivi est rattrapée par la vérification ; Odin qui a perdu la base → une complète repart ; restauration à la
// seconde près (complète + changements) à l'identique.
// Base PostgreSQL de test : VENUS_TEST_PG (compte qui peut créer des bases).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fauxOdin } from './faux-odin.mjs';

const ADMIN = process.env.VENUS_TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `venus_seconde_${process.pid}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venus-seconde-'));
let D, L, B, C, odin;
async function adminSql(sql) { const { Pg } = await import('../../server/pg.js'); const u = new URL(ADMIN); const pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) }); try { await pg.simple(sql); } finally { await pg.close(); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(50); } };

before(async () => {
  await adminSql(`CREATE DATABASE ${dbName}`);
  const u = new URL(ADMIN); u.pathname = `/${dbName}`;
  // Vérification lancée à la main dans ces essais ; complète régulière après 40 envois de changements
  Object.assign(process.env, { VENUS_DATABASE_URL: u.toString(), DATA_DIR: path.join(tmp, 'data'), VENUS_COFFRE: '0', VENUS_ODIN_CHECK_MS: '3600000', VENUS_ODIN_COMPLETE_LOTS: '40', VENUS_ODIN_LENT_MS: '1500' });
  D = await import('../../server/db.js');
  L = await import('../../server/odin-link.js');
  B = await import('../../server/odin-backup.js');
  C = await import('../../server/db-copy.js');
  odin = await fauxOdin({ tls: true });
  odin.addPerson({ preferred_username: 'awa', name: 'Awa Saïd', email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1', groups: ['admin'] });
});
after(async () => { await odin?.close(); fs.rmSync(tmp, { recursive: true, force: true }); await adminSql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); });

const run = (...a) => D.run(...a), get = (...a) => D.get(...a), all = (...a) => D.all(...a);
const list = () => odin.backups.get([...odin.backups.keys()][0]) || [];
const newest = () => list()[0] && list()[0].meta;
/** Attend qu'Odin ait reçu une nouvelle version après `n` versions ; rend le délai depuis `t0`. */
async function arrives(n, t0) { const ok = await until(() => list().length > n, 5000); assert.ok(ok, 'rien reçu par Odin'); return Date.now() - t0; }

let complete, profileA, items;
test('mise en place : base, lien, première sauvegarde complète (la base des changements)', async () => {
  D.db.exec('CREATE TABLE IF NOT EXISTS folk_torrents (info_hash TEXT PRIMARY KEY, rec TEXT NOT NULL, updated_at INTEGER)'); // (acquire/native.js)
  D.setSetting('household_password', 's2$32768$00$00');
  D.setSetting('server_name', 'Venus du salon');
  run('INSERT INTO libraries(name, type, path) VALUES(?, ?, ?)', 'Films', 'movies', '/media/films');
  const lib = get('SELECT id FROM libraries').id;
  for (let i = 1; i <= 200; i++) run('INSERT INTO items(library_id, type, title, path, added_at) VALUES(?, ?, ?, ?, ?)', lib, 'movie', `Film ${i}`, `/media/films/f${i}.mkv`, 1700000000000 + i);
  run('INSERT INTO profiles(name, avatar, is_admin, email, created_at) VALUES(?, ?, ?, ?, ?)', 'Awa', 1, 1, 'awa@exemple.yt', 1);
  profileA = get('SELECT id FROM profiles').id;
  items = all('SELECT id FROM items ORDER BY id').map((r) => r.id);
  const input = { host: '127.0.0.1', port: odin.port, email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1' };
  await L.link(input, { onPassword: (pw, e) => B.rememberKeyWrap(pw, e) });
  const r = await B.sendNow({ force: true, why: 'manuelle' });
  assert.equal(r.ok, true, r.error);
  complete = r.version;
  assert.equal(newest().sorte, 'complete');
  B.startOdinBackup();
});

test('chaque changement part chez Odin en moins de 2 s, en « changements » (seulement ce qui a changé)', async () => {
  const cases = [
    ['favori (ma liste)', () => run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', profileA, items[3], Date.now()), 'ma liste'],
    ['reprise de lecture', () => run('INSERT INTO progress(profile_id, item_id, position, duration, watched, updated_at) VALUES(?, ?, ?, ?, ?, ?)', profileA, items[5], 1234.5, 5400, 0, Date.now()), 'reprise de lecture'],
    ['reprise qui avance', () => run('UPDATE progress SET position = ?, updated_at = ? WHERE profile_id = ? AND item_id = ?', 1300, Date.now(), profileA, items[5]), 'reprise de lecture'],
    ['nouvel utilisateur', () => run('INSERT INTO profiles(name, avatar, created_at) VALUES(?, ?, ?)', 'Kofi', 2, Date.now()), 'utilisateur'],
    ['réglage', () => D.setSetting('sleep_rewind_min', 30), 'réglage'],
    ['téléchargement terminé', () => run('INSERT INTO folk_torrents(info_hash, rec, updated_at) VALUES(?, ?, ?)', 'a'.repeat(40), JSON.stringify({ infoHash: 'a'.repeat(40), name: 'Orage', doneAt: Date.now() }), Date.now()), 'téléchargement terminé'],
  ];
  for (const [what, act, raison] of cases) {
    const n = list().length, t0 = Date.now();
    act();
    const ms = await arrives(n, t0);
    const v = newest();
    assert.ok(ms < 2000, `${what} : reçu par Odin en ${ms} ms`);
    assert.equal(v.sorte, 'changements', what);
    assert.equal(v.base, complete, `${what} : sur la dernière complète`);
    assert.equal(v.raison, raison, what);
    const ch = B.parseChanges(list()[0].buf);
    assert.ok(list()[0].buf.length < list().find((x) => x.meta.sorte === 'complete').buf.length / 3, `${what} : bien plus petit que toute la base`);
    assert.equal(Object.values(ch.tables).reduce((k, t) => k + (t.put || t.replace || []).length + (t.del || []).length, 0), 1, `${what} : une seule ligne envoyée`);
  }
  assert.equal(B.state().delai < 2000, true, 'délai noté dans l’état');
});

test('plusieurs changements rapprochés : regroupés (une fois par seconde au plus)', async () => {
  const n = list().length, t0 = Date.now();
  for (let i = 0; i < 25; i++) { run('UPDATE progress SET position = ?, updated_at = ? WHERE profile_id = ? AND item_id = ?', 1400 + i, Date.now(), profileA, items[5]); await sleep(20); }
  const took = Date.now() - t0;
  await arrives(n, t0);
  await sleep(1500);
  const got = list().length - n;
  assert.ok(got >= 1 && got <= Math.ceil(took / 1000) + 1, `${got} envoi(s) pour 25 changements en ${took} ms`);
  assert.equal(get('SELECT position FROM progress WHERE item_id = ?', items[5]).position, 1424);
});

test('vérification à l’identique : empreinte d’Odin = celle du dernier envoi, base reconstruite = base de Venus', async () => {
  const c = await B.checkNow();
  assert.equal(c.skipped, 'à l’identique', JSON.stringify(c));
  const st = B.state();
  assert.equal(st.identique, true);
  assert.equal(st.attente, 0);
  const remote = await B.remoteFingerprint();
  assert.equal(remote.empreinte, st.sha, 'Odin a exactement le dernier envoi');
  assert.equal(remote.empreinte, crypto.createHash('sha256').update(list()[0].buf).digest('hex'));
  // Ce qu'Odin permet de reconstruire (complète + changements) = la base de Venus, table par table
  const a = await B.assemble(newest().id);
  const live = C.snapshot({ skip: B.SKIP });
  for (const t of ['profiles', 'mylist', 'progress', 'folk_torrents', 'items', 'libraries']) {
    const sort = (rows) => rows.map((r) => JSON.stringify(r)).sort();
    assert.deepEqual(sort(a.dump.tables[t]), sort(live[t]), `table ${t} identique chez Odin`);
  }
  assert.equal(a.dump.empreinte, B.fingerprint(), 'empreinte notée dans le dernier envoi = empreinte de la base');
});

test('coupure réseau : file d’attente chiffrée sur le disque, puis rattrapage dans l’ordre au retour d’Odin', async () => {
  const n = list().length;
  odin.S.coupe = true;
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', profileA, items[10], Date.now());
  await sleep(1300);
  run('INSERT INTO profiles(name, avatar, created_at) VALUES(?, ?, ?)', 'Zébulon-hors-ligne', 3, Date.now());
  await sleep(1300);
  run('UPDATE progress SET position = ? WHERE profile_id = ? AND item_id = ?', 2000, profileA, items[5]);
  assert.ok(await until(() => B.queueFiles().length === 3, 4000), `3 envois en attente (${B.queueFiles().length})`);
  const st = B.state();
  assert.equal(st.horsLigne, true);
  assert.match(st.erreur, /en attente/);
  assert.equal(list().length, n, 'rien reçu pendant la coupure');
  // Chiffrés : ni le nom ni la structure en clair sur le disque
  for (const f of B.queueFiles()) {
    const b = fs.readFileSync(path.join(tmp, 'data', 'odin-attente', f));
    assert.equal(b.subarray(0, 4).toString(), 'VOQ1');
    assert.ok(!b.includes(Buffer.from('Zébulon')) && !b.includes(Buffer.from('profiles')) && !b.includes(Buffer.from([0x1f, 0x8b])), `${f} chiffré`);
    assert.equal((fs.statSync(path.join(tmp, 'data', 'odin-attente', f)).mode & 0o777).toString(8), '600');
  }
  // Retour du réseau : tout part, dans l'ordre (le prochain essai, ou la vérification)
  odin.S.coupe = false;
  const t0 = Date.now();
  await B.checkNow();
  assert.ok(await until(() => B.queueFiles().length === 0, 8000), 'file vidée');
  const back = list().slice(0, list().length - n).reverse().map((v) => B.parseChanges(v.buf));
  assert.deepEqual(back.map((c) => Object.keys(c.tables)), [['mylist'], ['profiles'], ['progress']], 'dans l’ordre');
  assert.ok(back.every((c, i) => i === 0 || c.seq === back[i - 1].seq + 1));
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(B.state().horsLigne, false);
  assert.equal((await B.checkNow()).skipped, 'à l’identique');
});

test('une écriture qui échappe au suivi (SQL direct) est rattrapée par la vérification des 30 s', async () => {
  D.db.exec(`UPDATE profiles SET avatar = 7 WHERE name = 'Kofi'`);
  const n = list().length;
  await sleep(1200);
  assert.equal(list().length, n, 'pas vue par le suivi des écritures');
  const c = await B.checkNow();
  assert.equal(c.skipped, 'à l’identique', JSON.stringify(c));
  assert.equal(list().length, n + 1);
  assert.deepEqual(Object.keys(B.parseChanges(list()[0].buf).tables), ['profiles']);
});

test('tables remplies par Venus lui-même (analyse) : envoyées quelques secondes après, avec les autres', async () => {
  const n = list().length;
  run('UPDATE items SET overview = ? WHERE id = ?', 'Résumé trouvé par l’analyse', items[0]);
  await sleep(700);
  assert.equal(list().length, n, 'pas tout de suite');
  assert.ok(await until(() => list().length > n, 3000));
  assert.deepEqual(Object.keys(B.parseChanges(list()[0].buf).tables), ['items']);
});

test('complète régulière (ici après 40 envois de changements), puis les changements repartent sur elle', async () => {
  const before = list().filter((v) => v.meta.sorte === 'complete').length;
  D.setSetting('odin_sauvegarde', { ...B.state(), depuisComplete: 37 }); // (pour ne pas attendre 40 envois)
  for (let i = 0; i < 6 && list().filter((v) => v.meta.sorte === 'complete').length === before; i++) {
    const n = list().length;
    run('UPDATE progress SET position = ? WHERE profile_id = ? AND item_id = ?', 3000 + i, profileA, items[5]);
    await arrives(n, Date.now());
    await sleep(300);
  }
  assert.ok(await until(() => list().filter((v) => v.meta.sorte === 'complete').length === before + 1, 4000), 'nouvelle complète');
  const newBase = list().find((v) => v.meta.sorte === 'complete').meta.id;
  assert.notEqual(newBase, complete);
  const n = list().length;
  run('DELETE FROM mylist WHERE item_id = ?', items[10]);
  await arrives(n, Date.now());
  assert.equal(newest().base, newBase);
  assert.deepEqual(B.parseChanges(list()[0].buf).tables.mylist.del.length, 1, 'un favori retiré = une clé effacée');
  complete = newBase;
});

test('Odin a perdu la base des changements : une complète repart toute seule', async () => {
  const key = [...odin.backups.keys()][0];
  odin.backups.set(key, []);
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', profileA, items[20], Date.now());
  assert.ok(await until(() => list().length >= 1 && newest().sorte === 'complete', 5000), 'complète renvoyée');
  assert.equal((await B.checkNow()).skipped, 'à l’identique');
  complete = newest().id;
});

test('un autre serveur Venus du même compte écrit aussi : noté, sans renvoyer sans cesse', async () => {
  const n = list().length;
  run('INSERT INTO mylist(profile_id, item_id, added_at) VALUES(?, ?, ?)', profileA, items[21], Date.now());
  await arrives(n, Date.now());
  const other = Buffer.from('autre-serveur');
  list().unshift({ meta: { id: 'v20991231T000000Z-beef', date: Date.now(), taille: other.length, empreinte: crypto.createHash('sha256').update(other).digest('hex'), sorte: 'complete', raison: 'changement', nom: 'x', base: null, appareil: 'Serveur Vénus (grenier)' }, buf: other, empreinte: crypto.createHash('sha256').update(other).digest('hex') });
  const c = await B.checkNow();
  assert.equal(c.skipped, 'à l’identique');
  assert.equal(B.state().autrePoste.appareil, 'Serveur Vénus (grenier)');
  list().shift();
});

test('restauration à la seconde près : complète + changements, base effacée → identique (empreinte)', async () => {
  await sleep(1200);
  assert.equal((await B.checkNow()).skipped, 'à l’identique');
  const fp = B.fingerprint();
  const want = { mylist: all('SELECT * FROM mylist ORDER BY 1, 2'), progress: all('SELECT * FROM progress ORDER BY 1, 2'), profiles: all('SELECT * FROM profiles ORDER BY id') };
  const id = newest().id;
  assert.equal(newest().sorte, 'changements');
  const points = B.restorePoints(await B.versions());
  assert.equal(points[0].id, id);
  assert.equal(points[0].dernierEtat, true);
  const tables = all("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").map((r) => `"${r.t}"`);
  D.db.pg.call({ op: 'query', sql: `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`, params: [] });
  const input = { host: '127.0.0.1', port: odin.port, email: 'awa@exemple.yt', password: 'mot-de-passe-awa-1' };
  L.keepLink(await L.login(input), input);
  const r = await B.restoreVersion(id, { password: 'mot-de-passe-awa-1' });
  assert.ok(r.changements >= 1);
  assert.equal(r.identique, true);
  assert.equal(B.fingerprint(), fp, 'même empreinte qu’avant l’effacement');
  assert.deepEqual({ mylist: all('SELECT * FROM mylist ORDER BY 1, 2'), progress: all('SELECT * FROM progress ORDER BY 1, 2'), profiles: all('SELECT * FROM profiles ORDER BY id') }, want);
});
