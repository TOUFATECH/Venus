// Conversion qui lâche en plein film : Venus reprend juste après le dernier segment écrit, dans la même liste,
// au lieu de laisser l'image figée. Et la compression de fond se met en pause pendant une lecture.
import { test, expect, etat } from './outils.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const segs = (txt) => (txt.match(/^seg\d+\.(ts|m4s)$/gm) || []).length;

test('conversion interrompue : reprise automatique après le dernier segment', async ({ api, request }) => {
  const { token } = etat();
  const lib = await api('/api/library?type=movie');
  const film = (Array.isArray(lib) ? lib : lib.items).find((i) => i.title === 'Mousson');
  expect(film).toBeTruthy();
  // Un appareil qui ne lit pas le H.264 : conversion obligatoire
  const play = await api(`/api/play/${film.id}`, { method: 'POST', body: { caps: { video: ['vp9'], audio: ['opus'], containers: ['webm'] }, quality: 'auto', start: 0 } });
  expect(play.mode).toBe('transcode');
  expect(play.sessionId).toBeTruthy();
  const pl = async () => { const r = await request.fetch(play.url, { headers: { authorization: `Bearer ${token}` } }); return r.ok() ? r.text() : ''; };
  // Quelques segments existent
  let before = 0;
  for (let i = 0; i < 300 && before < 2; i++) { before = segs(await pl()); if (before < 2) await wait(100); }
  expect(before).toBeGreaterThanOrEqual(2);
  // ffmpeg lâche
  const f = await api(`/api/admin/hls/${play.sessionId}/fault`, { method: 'POST' });
  expect(f.ok).toBe(true);
  // La liste continue de grandir, avec une discontinuité signalée, et les nouveaux segments se lisent
  let txt = '', after = 0;
  for (let i = 0; i < 300; i++) { txt = await pl(); after = segs(txt); if (after > f.segments + 2) break; await wait(100); }
  expect(after, txt.slice(-400)).toBeGreaterThan(f.segments + 2);
  expect(txt).toContain('#EXT-X-DISCONTINUITY');
  const last = txt.match(/^seg\d+\.(ts|m4s)$/gm).pop();
  const seg = await request.fetch(play.url.replace('index.m3u8', last), { headers: { authorization: `Bearer ${token}` } });
  expect(seg.ok()).toBeTruthy();
  expect((await seg.body()).length).toBeGreaterThan(1000);
  const adm = await api('/api/admin');
  const mine = adm.sessions.find((s) => s.id === play.sessionId);
  expect(mine && mine.resumes).toBeGreaterThanOrEqual(1);
  await request.fetch(`/api/hls/${play.sessionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
});

test('compression de fond : en pause tant que quelqu’un regarde', async ({ api, request }) => {
  const { token } = etat();
  const lib = await api('/api/library?type=movie');
  const film = (Array.isArray(lib) ? lib : lib.items).find((i) => i.title === 'Mousson');
  const play = await api(`/api/play/${film.id}`, { method: 'POST', body: { caps: { video: ['vp9'], audio: ['opus'], containers: ['webm'] }, quality: 'auto', start: 0 } });
  await request.fetch(play.url, { headers: { authorization: `Bearer ${token}` } });
  const st = await api('/api/admin/convert');
  expect(st.paused).toBe(true);
  // Lancer la file ne démarre rien pendant la lecture
  const r = await api('/api/admin/convert/run', { method: 'POST' });
  expect(JSON.stringify(r)).not.toMatch(/compressée/);
  await request.fetch(`/api/hls/${play.sessionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
});
