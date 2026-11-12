// Mayotte La 1ère (France TV) : la liste publique a un jeton périmé → Venus en demande un neuf et le met partout
import http from 'node:http';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
test('France TV : jeton périmé remplacé par un jeton frais (relais et ffmpeg)', async () => {
  const OLD = b64('exp=1700000000~acl=%2f*~hmac=aaaa'), NEW = b64('exp=4000000000~acl=%2f*~hmac=bbbb');
  let asked = 0;
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/esi/TA')) { asked++; res.end(JSON.stringify({ url: `https://simulcast-b.ftven.fr/${NEW}/simulcast/1er_Mayotte/v.m3u8` })); return; }
    res.end(`#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="https://simulcast-b.ftven.fr/${OLD}/simulcast/1er_Mayotte/a.m3u8",GROUP-ID="a"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://simulcast-b.ftven.fr/${OLD}/simulcast/1er_Mayotte/v.m3u8\n`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.VENUS_FTV_AUTH = `${base}/esi/TA`;
  try {
    const f = await import('../../server/ftv.js');
    const url = `${base}/ParaTV/main/streams/francetv/res/mayotte-1ere-highest.m3u8`;
    expect(f.isFtv(url)).toBe(true);
    expect(f.isFtv('https://example.com/live.m3u8')).toBe(false);
    const p = await f.ftvPlaylist(url);
    expect(p.text).not.toContain(OLD);
    expect(p.text.match(new RegExp(NEW, 'g')).length).toBe(2);
    expect(p.exp).toBeGreaterThan(Date.now() + 3600e3);
    await f.ftvPlaylist(url);
    expect(asked).toBe(1); // jeton gardé tant qu'il est valable
    const file = await f.liveSource(url);
    expect(f.isFtvFile(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain(`https://simulcast-b.ftven.fr/${NEW}/simulcast/1er_Mayotte/v.m3u8`);
    expect(await f.liveSource('https://example.com/live.m3u8')).toBe('https://example.com/live.m3u8');
  } finally { srv.close(); }
});
