// Médias automatiques : lecture des noms de versions et choix de la meilleure (node --test tests/unit)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, score, best, libraryName, DEFAULT_PROFILE } from '../../server/acquire/release.js';

test('lit un nom de version : titre, année, qualité, source, langue, épisodes', () => {
  const a = parseRelease('Dune.Part.Two.2024.MULTi.TRUEFRENCH.1080p.BluRay.x265-NoTag');
  assert.equal(a.title, 'dune part two'); assert.equal(a.year, 2024); assert.equal(a.res, 1080); assert.equal(a.source, 'bluray'); assert.equal(a.codec, 'hevc'); assert.ok(a.vf && a.lang.multi);
  const b = parseRelease('The.Last.of.Us.S02E03.VOSTFR.720p.WEB.H264');
  assert.equal(b.title, 'the last of us'); assert.equal(b.season, 2); assert.deepEqual(b.episodes, [3]); assert.ok(!b.vf && b.lang.vostfr);
  assert.deepEqual(parseRelease('Show.S01E01-E03.FRENCH.1080p.WEB').episodes, [1, 2, 3]);
  const c = parseRelease('Arcane Saison 2 MULTI 1080p WEB'); assert.equal(c.season, 2); assert.ok(c.pack); assert.equal(c.title, 'arcane');
  assert.equal(parseRelease('Film.2023.HDCAM.FRENCH').source, 'cam');
  assert.equal(parseRelease('Blade.Runner.2049.2017.FRENCH.2160p').year, 2017, 'le nombre du titre n\'est pas l\'année');
});

test('note : VF d\'abord, puis qualité ; refuse CAM, autre titre, autre année, VOSTFR si VF exigée, tailles folles', () => {
  const want = { kind: 'movie', title: 'Dune : Deuxième partie', original: 'Dune Part Two', year: 2024 };
  const R = (title, size = 8e9, seeders = 20) => ({ title, size, seeders });
  assert.equal(score(want, R('Dune.Part.Two.2024.1080p.HDCAM')).why, 'caméscope (CAM / TS) : jamais');
  assert.match(score(want, R('Dune.2021.FRENCH.1080p.WEB')).why, /autre titre/);
  assert.match(score(want, R('Dune.Part.Two.2019.FRENCH.1080p.WEB')).why, /autre année/);
  assert.match(score(want, R('Dune.Part.Two.2024.VOSTFR.1080p.WEB')).why, /VOSTFR/);
  assert.match(score(want, R('Dune.Part.Two.2024.FRENCH.1080p.WEB', 90e9)).why, /taille/);
  const vf1080 = score(want, R('Dune.Part.Two.2024.MULTi.1080p.WEB.x264')), vf720 = score(want, R('Dune.Part.Two.2024.FRENCH.720p.WEB')), vf4k = score(want, R('Dune.Part.Two.2024.MULTi.2160p.WEB'));
  assert.ok(vf1080.ok && vf720.ok && vf4k.ok); assert.ok(vf1080.score > vf4k.score && vf4k.score > vf720.score, 'cible 1080p, puis 4K, puis 720p');
  assert.ok(vf1080.cible && !vf720.cible);
  const vo = score(want, R('Dune.Part.Two.2024.VOSTFR.1080p.WEB'), { ...DEFAULT_PROFILE, langue: 'vf_puis_vo' }); assert.ok(vo.ok && vo.score < vf720.score);
});

test('séries : bon épisode, saison complète, meilleure version, amélioration seulement si mieux', () => {
  const w = { kind: 'episode', title: 'The Last of Us', season: 2, episode: 3 };
  const res = [
    { title: 'The.Last.of.Us.S02E03.MULTI.1080p.WEB.x265', size: 2e9, seeders: 50, link: 'a' },
    { title: 'The.Last.of.Us.S02E04.MULTI.1080p.WEB', size: 2e9, seeders: 90, link: 'b' },
    { title: 'The.Last.of.Us.S02.MULTI.1080p.WEB', size: 20e9, seeders: 30, link: 'c' },
    { title: 'The.Last.of.Us.S02E03.FRENCH.720p.HDTV', size: 1e9, seeders: 10, link: 'd' },
  ];
  const b = best(w, res); assert.equal(b.pick.r.link, 'a');
  assert.ok(b.rejected.some((x) => x.r.link === 'b' && /épisode 4/.test(x.why)));
  assert.equal(best(w, res, DEFAULT_PROFILE, null, ['a']).pick.r.link, 'c', 'la saison complète contient l\'épisode');
  assert.equal(best(w, res, DEFAULT_PROFILE, 5000).pick, null, 'rien de mieux que ce qu\'on a');
});

test('musique, livres, livres audio, et noms rangés dans la médiathèque', () => {
  assert.ok(score({ kind: 'album', artist: 'Daft Punk', title: 'Random Access Memories' }, { title: 'Daft Punk - Random Access Memories (2013) [FLAC 24bit]' }).cible);
  assert.equal(score({ kind: 'album', artist: 'Daft Punk', title: 'Discovery' }, { title: 'Daft Punk - Homework [MP3]' }).ok, false);
  assert.ok(score({ kind: 'audiobook', author: 'Victor Hugo', title: 'Les Misérables' }, { title: 'Victor Hugo - Les Miserables [Livre audio] m4b FR' }).ok);
  assert.equal(score({ kind: 'book', author: 'Victor Hugo', title: 'Les Misérables' }, { title: 'Victor Hugo - Les Miserables m4b' }).ok, false);
  const p = parseRelease('Dune.Part.Two.2024.MULTi.1080p.WEB');
  assert.equal(libraryName({ kind: 'movie', title: 'Dune : Deuxième partie', year: 2024 }, p, 'mkv'), 'Dune Deuxième partie (2024)/Dune Deuxième partie (2024) [1080p MULTI].mkv');
  assert.equal(libraryName({ kind: 'episode', title: 'The Last of Us', season: 2, episode: 3 }, parseRelease('x.S02E03.FRENCH.1080p'), '.mkv'), 'The Last of Us/Saison 02/The Last of Us - S02E03 [1080p VF].mkv');
});
