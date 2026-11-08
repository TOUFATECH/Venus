'use client';
// TV en direct : chaînes (lecteur qui reste visible, direct différé, ±10 s, chaîne ±, son, plein écran,
// mosaïque des chaînes), guide des programmes (grille) et enregistrements.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';
import { PageError, PageLoading } from '../PageState';

const PX = 5; // pixels par minute dans le guide
const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
const playPath = (id) => shared().components.playPath(id);
const token = () => encodeURIComponent(shared().api.auth.token || '');
const confirm = (m, l) => shared().ui.confirmSheet(m, l);

export default function Tv() {
  const { search } = useVenus();
  const vue = search && search.get('vue');
  useTitle('TV en direct');
  if (vue === 'guide') return <Guide />;
  if (vue === 'enregistrements') return <Recordings />;
  return <Channels />;
}

function TvTabs({ current }) {
  return (
    <div className="seg tv-tabs" role="tablist">
      {[['chaines', 'Chaînes', '/tv'], ['guide', 'Guide', '/tv?vue=guide'], ['enregistrements', 'Enregistrements', '/tv?vue=enregistrements']].map(([k, l, href]) => (
        <button key={k} className={`seg-b f${k === current ? ' on' : ''}`} role="tab" aria-selected={String(k === current)} onClick={() => k !== current && go(href)}>{l}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- fenêtres : programme, enregistrer
const recordIt = async (body, msg, close, after) => {
  try { await api('/api/recordings', { method: 'POST', body }); close(); toast(msg, { type: 'success', action: { label: 'Voir', onClick: () => go('/tv?vue=enregistrements') } }); after && after(); }
  catch (e) { toast(e.message, true); }
};

export function programSheet(p, ch, onChange = () => {}) {
  openSheet(p.title, (close) => {
    const now = Date.now();
    const onAir = p.start <= now && p.stop > now;
    const pct = onAir ? Math.round(((now - p.start) / (p.stop - p.start)) * 100) : 0;
    return (
      <div className="prog-sheet">
        <p className="prog-when">{`${ch ? `${ch.number ? `${ch.number}. ` : ''}${ch.title} · ` : ''}${day(p.start)}, ${hm(p.start)} – ${hm(p.stop)}`}</p>
        {onAir ? <div className="prog-bar"><i style={{ width: `${pct}%` }} /></div> : null}
        {p.sub ? <h3>{p.sub}</h3> : null}
        {p.cat ? <span className="chip small">{p.cat}</span> : null}
        {p.descr ? <p>{p.descr}</p> : <p className="muted">Pas de résumé.</p>}
        <div className="actions">
          {onAir && ch ? <button className="btn btn-play f" onClick={() => { close(); go(playPath(ch.id)); }}><Icon name="play" />Regarder</button> : null}
          {p.rec ? <button className="btn btn-ghost f" onClick={async () => { await api(`/api/recordings/${p.rec.id}`, { method: 'DELETE' }); close(); toast(p.rec.status === 'recording' ? 'Enregistrement arrêté' : 'Enregistrement annulé'); onChange(); }}><Icon name="close" />{p.rec.status === 'recording' ? 'Arrêter l’enregistrement' : 'Annuler l’enregistrement'}</button>
            : p.stop > now ? <button className="btn f" onClick={() => recordIt({ programId: p.id }, `« ${p.title} » sera enregistré`, close, onChange)}><span className="rec-dot" />{onAir ? 'Enregistrer (à partir de maintenant)' : 'Enregistrer'}</button> : null}
          {p.stop > now ? <button className="btn btn-ghost f" onClick={() => recordIt({ programId: p.id, series: true }, `Toutes les diffusions de « ${p.title} » seront enregistrées`, close, onChange)}><Icon name="list" />Enregistrer toutes les diffusions</button> : null}
        </div>
      </div>
    );
  });
}

// « Enregistrer » depuis une chaîne : programme en cours, suivant, ou une durée (même sans guide)
export function recordSheet(ch, progs = []) {
  openSheet(`Enregistrer ${ch.title}`, (close) => <RecordMenu ch={ch} progs={progs} close={close} />);
}

function RecordMenu({ ch, progs, close }) {
  const [cur, nxt] = progs;
  const now = Date.now();
  const [start, setStart] = useState(hm(now + 3600e3));
  const [dur, setDur] = useState(60);
  const opt = (key, label, sub, fn) => <button key={key} className="opt f" onClick={fn}><span className="rec-dot" /><span><b>{label}</b><small>{sub}</small></span></button>;
  const later = (e) => {
    e.preventDefault();
    const [hh, mm] = start.split(':').map(Number);
    const d = new Date(); d.setHours(hh, mm, 0, 0);
    if (d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1); // heure passée : demain
    const s = d.getTime(), stop = s + Number(dur) * 60000;
    recordIt({ channelId: ch.id, start: s, stop, title: `${ch.title} (${hm(s)})` }, `${ch.title} sera enregistrée à ${hm(s)}${d.getDate() !== new Date().getDate() ? ' demain' : ''}`, close);
  };
  return (
    <div className="dash-menu rec-menu">
      {cur ? opt('cur', `En cours : ${cur.title}`, `jusqu’à ${hm(cur.stop)}, à partir de maintenant`, () => recordIt({ programId: cur.id }, `« ${cur.title} » est en cours d’enregistrement`, close)) : null}
      {nxt ? opt('nxt', `Ensuite : ${nxt.title}`, `${hm(nxt.start)} – ${hm(nxt.stop)}`, () => recordIt({ programId: nxt.id }, `« ${nxt.title} » sera enregistré à ${hm(nxt.start)}`, close)) : null}
      {cur ? opt('all', `Toutes les diffusions de « ${cur.title} »`, 'à chaque passage sur cette chaîne', () => recordIt({ programId: cur.id, series: true }, `Toutes les diffusions de « ${cur.title} » seront enregistrées`, close)) : null}
      {[[30, '30 minutes'], [60, '1 heure'], [120, '2 heures']].map(([m, l]) => opt(`m${m}`, `Maintenant, pendant ${l}`, `de ${hm(now)} à ${hm(now + m * 60000)}`, () => recordIt({ channelId: ch.id, start: Date.now(), stop: Date.now() + m * 60000, title: `${ch.title} (${hm(now)})` }, `${ch.title} est en cours d’enregistrement (${l})`, close)))}
      <h3 className="box-sub">Plus tard</h3>
      <form className="rec-later" onSubmit={later}>
        <div className="field"><label>À partir de</label><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label>Pendant</label><select className="input" value={dur} onChange={(e) => setDur(e.target.value)}>{[[30, '30 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h'], [240, '4 h']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <button className="btn btn-small f" type="submit">Programmer</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- chaînes
function Channels() {
  const L = shared();
  const { data: all, error } = useApi('/api/library?type=channel');
  const [nn, setNn] = useState({});
  useEffect(() => { api('/api/epg/now').then(setNn).catch(() => {}); }, []);
  if (error) return <PageError error={error} />;
  if (!all) return <PageLoading />;
  const channels = all.filter((c) => !c.down);
  if (!channels.length) {
    return (
      <main className="with-nav page-in">
        <div className="page"><div className="page-head"><h1>TV en direct</h1></div>
          <div className="empty"><h2>Aucune chaîne</h2><p>Ajoutez la liste M3U de votre abonnement IPTV pour voir vos chaînes ici.</p><button className="btn btn-play f" onClick={() => go('/reglages?onglet=medias')}>Ajouter une liste IPTV</button></div>
        </div>
      </main>
    );
  }
  return <ChannelsView all={all} nn={nn} admin={!!L.app.state.profile.isAdmin} />;
}

function ChannelsView({ all, nn, admin }) {
  const L = shared();
  const [channels, setChannels] = useState(() => all.filter((c) => !c.down));
  const down = all.filter((c) => c.down);
  const groups = [...new Set(channels.map((c) => c.group).filter(Boolean))];
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => { let id = 0; try { id = Number(localStorage.getItem('vn.tv.last')) || 0; } catch { /* */ } return channels.find((c) => c.id === id) || channels[0]; });
  const [stamp, setStamp] = useState(Math.floor(Date.now() / 120000));
  const [playingId, setPlayingId] = useState(null);
  const player = useRef(null);
  const input = useRef(null);
  const grid = useRef(null);
  const visible = channels.filter((c) => (!group || c.group === group) && (!q.trim() || norm(c.title).includes(norm(q.trim()))));
  const visRef = useRef(visible); visRef.current = visible;
  const chRef = useRef(channels); chRef.current = channels;
  const choose = (c, focus = true) => { try { localStorage.setItem('vn.tv.last', String(c.id)); } catch { /* */ } setSelected(c); player.current && player.current.play(c, focus); };
  // Les vignettes se rafraîchissent toutes les 2 minutes
  useEffect(() => { const t = setInterval(() => setStamp(Math.floor(Date.now() / 120000)), 120000); return () => clearInterval(t); }, []);
  // « / » : la recherche ; numéro de chaîne au clavier ou à la télécommande (« 1 », « 2 » → chaîne 12)
  useEffect(() => {
    const slash = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); input.current.focus(); input.current.select(); } };
    document.addEventListener('keydown', slash);
    let zapper = null;
    L.imp('live.js').then((m) => { zapper = m.numberZapper(chRef.current, (c) => choose(c), document.querySelector('.tv-page')); document.addEventListener('keydown', zapper.onKey); });
    return () => { document.removeEventListener('keydown', slash); if (zapper) { zapper.stop(); document.removeEventListener('keydown', zapper.onKey); } };
  }, []);
  const gridKeys = (e) => {
    const tiles = [...grid.current.querySelectorAll('.tile')], i = tiles.indexOf(e.currentTarget);
    if (i < 0) return;
    const top = tiles[i].offsetTop, cols = Math.max(1, tiles.filter((x) => x.offsetTop === top).length);
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols : null;
    if (j == null) return;
    e.preventDefault();
    if (j < 0) { input.current.focus(); return; }
    tiles[Math.min(tiles.length - 1, j)]?.focus();
  };
  const zap = (d) => {
    const list = visRef.current.length ? visRef.current : chRef.current;
    const i = list.findIndex((c) => selected && c.id === selected.id);
    const c = list[(i + d + list.length) % list.length];
    if (c) choose(c, false);
  };
  const onDead = (ch) => setChannels((l) => l.filter((x) => x !== ch));
  const pic = (c) => c.preview || `/api/channels/${c.id}/preview.jpg?token=${token()}&t=${stamp}`;
  return (
    <main className="with-nav page-in">
      <div className="page tv-page">
        <div className="page-head">
          <div className="head-left"><h1>TV en direct</h1><p className="count" aria-live="polite">{`${visible.length} chaîne${visible.length > 1 ? 's' : ''}`}</p></div>
          <div className="head-tools"><TvTabs current="chaines" /></div>
        </div>
        {down.length && admin ? <DownNote down={down} /> : null}
        <div className="tvx">
          <div className="tvx-player"><TvPlayer ref={player} selected={selected} nn={nn} onZap={zap} onDead={onDead} still={selected ? pic(selected) : null} onPlaying={setPlayingId} /></div>
          <div className="tvx-list">
            <div className="tvx-tools">
              <div className="search-box small"><Icon name="search" />
                <input ref={input} type="search" id="tv-search" placeholder="Chercher une chaîne (touche /)" aria-label="Chercher une chaîne" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (visible[0]) choose(visible[0]); } else if (e.key === 'ArrowDown') { e.preventDefault(); grid.current.querySelector('.tile')?.focus(); } else if (e.key === 'Escape') setQ(''); }} />
              </div>
              {groups.length > 1 ? (
                <div className="chips" role="group" aria-label="Groupes de chaînes">
                  {[['', 'Toutes'], ...groups.map((g) => [g, g])].map(([id, label]) => <button key={id || 'all'} className={`chip f${id === group ? ' on' : ''}`} onClick={() => setGroup(id)}>{label}</button>)}
                </div>
              ) : null}
            </div>
            <div className="tiles" ref={grid}>
              {visible.length ? visible.map((c) => (
                <button key={c.id} className={`tile f${selected && selected.id === c.id ? ' on' : ''}${playingId === c.id ? ' playing' : ''}`} data-id={c.id} aria-label={`${c.number ? `${c.number}, ` : ''}${c.title}, ${c.group || 'en direct'} — mettre en lecture en haut`} onClick={() => choose(c)} onKeyDown={gridKeys}>
                  <div className="tile-img">
                    <span className="ch-initials">{initials(c.title)}</span>
                    <HideOnError src={pic(c)} className="tile-shot" />
                    {c.poster ? <HideOnError src={img(c.poster)} className="tile-logo" /> : null}
                    {c.number ? <span className="ch-num">{c.number}</span> : null}
                  </div>
                  <div className="tile-cap"><b>{c.title}</b>{nn[c.id] && nn[c.id][0] ? <small className="tile-now">{nn[c.id][0].title}</small> : c.group ? <small>{c.group}</small> : null}</div>
                </button>
              )) : <p className="grid-empty">{channels.length ? 'Aucune chaîne ne correspond.' : ''}</p>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function HideOnError({ src, className }) {
  const [gone, setGone] = useState(false);
  useEffect(() => setGone(false), [src]);
  return gone ? null : <img className={className} src={src} alt="" decoding="async" onError={() => setGone(true)} />;
}

function DownNote({ down }) {
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { await api('/api/admin/channels/check', { method: 'POST', body: {} }); toast('Vérification lancée : les chaînes sont testées une par une (quelques minutes)'); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  return (
    <details className="tv-down">
      <summary>{`${down.length} chaîne${down.length > 1 ? 's' : ''} hors service masquée${down.length > 1 ? 's' : ''} (aucune image reçue lors de la dernière vérification)`}</summary>
      <ul>{down.slice(0, 60).map((c) => <li key={c.id}><b>{c.title}</b>{` — ${c.downWhy}`}</li>)}</ul>
      <button className="btn btn-small btn-ghost f" disabled={busy} onClick={check}><Icon name="refresh" />{busy ? 'Vérification en cours…' : 'Revérifier'}</button>
    </details>
  );
}

// Lecteur de la page TV : pause = direct différé (le serveur garde le flux), ±10 s, retour au direct,
// chaîne précédente / suivante, son, plein écran. Il reste visible pendant qu'on choisit une autre chaîne.
const TvPlayer = forwardRef(function TvPlayer({ selected, nn, onZap, onDead, still, onPlaying }, ref) {
  const L = shared();
  const video = useRef(null);
  const screen = useRef(null);
  const [playing, setPlayingS] = useState(false);
  const setPlaying = (x) => { setPlayingS(x); onPlaying && onPlaying(x ? S.ch && S.ch.id : null); };
  const [paused, setPaused] = useState(false);
  const [awake, setAwake] = useState(false);
  const [status, setStatus] = useState('');
  const [stillOn, setStillOn] = useState(true);
  const [muted, setMutedS] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [lag, setLag] = useState({ late: false, label: 'Direct' });
  const S = useRef({ session: null, relay: null, detach: null, hls: null, heldAt: 0, ch: null, playing: false, dead: false, wakeT: 0 }).current;

  const wake = () => { setAwake(true); clearTimeout(S.wakeT); S.wakeT = setTimeout(() => setAwake(false), 3000); };
  const hold = (on) => { if (S.relay) api(`/api/live/${S.relay}/hold`, { method: 'POST', body: { on } }).catch(() => {}); };
  const liveEdge = () => { const v = video.current; try { if (S.hls && Number.isFinite(S.hls.liveSyncPosition)) return S.hls.liveSyncPosition; const s = v.seekable; return s.length ? s.end(s.length - 1) - 4 : NaN; } catch { return NaN; } };
  const behind = () => { const e = liveEdge(); return Number.isFinite(e) ? Math.max(0, e - video.current.currentTime) : 0; };
  const setMuted = (m) => { const v = video.current; setMutedS(m); v.muted = m; if (!m && v.volume === 0) { v.volume = 0.5; setVolume(0.5); } };
  const stopPreview = () => {
    if (S.detach) { S.detach(); S.detach = null; }
    S.hls = null;
    if (S.session) { fetch(S.relay ? `/api/live/${S.session}` : `/api/hls/${S.session}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${L.api.auth.token}` } }).catch(() => {}); S.session = null; }
    S.relay = null; S.heldAt = 0;
  };
  const stopPlayback = () => { stopPreview(); S.playing = false; setPlaying(false); setPaused(false); setStillOn(true); setStatus(''); };
  // La chaîne ne démarre pas : Venus la reteste ; si elle échoue encore, elle quitte la liste
  const failed = async (ch, say = true) => {
    if (say) setStatus('Cette chaîne ne répond pas : je la reteste…');
    const r = await api(`/api/channels/${ch.id}/failed`, { method: 'POST' }).catch(() => null);
    if (S.ch !== ch) return;
    if (r && r.hidden) { setStatus(`Chaîne hors service (${r.error || 'aucune image'}) : retirée de la liste. Elle reviendra si elle remarche.`); onDead(ch); S.playing = false; setPlaying(false); }
    else if (r) { setStatus('La chaîne répond au test : nouvelle tentative…'); setTimeout(() => { if (S.ch === ch) start(ch, { noRelay: true }); }, 800); }
  };
  const start = async (ch, { noRelay = false } = {}) => {
    S.ch = ch; S.playing = true; setPlaying(true);
    setStatus('Connexion à la chaîne…');
    const prev = S.session;
    if (S.detach) { S.detach(); S.detach = null; } S.hls = null;
    try {
      const live = await L.imp('live.js');
      const info = await api(`/api/play/${ch.id}`, { method: 'POST', body: { caps: L.api.deviceCaps(), preview: true, replace: prev || undefined, noRelay } });
      if (S.dead || S.ch !== ch || !S.playing) { fetch(info.mode === 'relay' ? `/api/live/${info.sessionId}` : `/api/hls/${info.sessionId}`, { method: 'DELETE' }).catch(() => {}); return; }
      S.session = info.sessionId; S.relay = info.mode === 'relay' ? info.sessionId : null;
      S.detach = await live.attachStream(video.current, info.url, {
        live: true, dvr: !!S.relay,
        onError: () => { if (S.ch !== ch) return; if (S.relay && !noRelay) { start(ch, { noRelay: true }); return; } failed(ch); },
      });
      S.hls = (S.detach && S.detach.hls) || null;
    } catch (e) { if (S.ch === ch) { setStatus(e.message); failed(ch, false); } }
  };
  const togglePause = () => {
    const v = video.current;
    if (!S.playing) { if (selected) { setMuted(false); start(selected); } return; }
    if (v.paused) v.play().catch(() => {}); else { v.pause(); S.heldAt = Date.now(); hold(true); }
  };
  const seekBy = (d) => {
    if (!S.playing) return;
    const v = video.current;
    const e = liveEdge(); let t = v.currentTime + d;
    try { const s = v.seekable; if (s.length) t = Math.max(s.start(0) + 1, t); } catch { /* */ }
    if (Number.isFinite(e)) t = Math.min(e, t);
    if (d < 0) hold(true);
    v.currentTime = t; v.play().catch(() => {});
  };
  const goLive = () => { const v = video.current; const e = liveEdge(); if (Number.isFinite(e)) v.currentTime = e; v.play().catch(() => {}); hold(false); S.heldAt = 0; };
  const toggleFs = () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (screen.current.requestFullscreen) screen.current.requestFullscreen().catch(() => {});
    else if (video.current.webkitEnterFullscreen) video.current.webkitEnterFullscreen(); // iPhone
  };
  const vol = (d) => { const v = video.current; v.volume = Math.max(0, Math.min(1, Math.round((v.volume + d) * 10) / 10)); setVolume(v.volume); setMuted(v.volume === 0); };

  useImperativeHandle(ref, () => ({
    play: (c, focus) => {
      setMuted(false);
      start(c);
      // Sur téléphone, le lecteur est en haut : on y remonte s'il est hors de vue
      const r = screen.current.getBoundingClientRect();
      if (r.bottom < 60 || r.top > innerHeight - 60) screen.current.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      if (focus) setTimeout(() => screen.current && screen.current.focus({ preventScroll: true }), 300);
      wake();
    },
  }));
  useEffect(() => {
    const v = video.current;
    v.volume = 0.8;
    const onPlay = () => setPaused(false), onPause = () => setPaused(true), onPlaying = () => { setStatus(''); setStillOn(false); };
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause); v.addEventListener('playing', onPlaying);
    const lagT = setInterval(() => {
      if (!S.playing) return;
      const l = behind(), late = l > 12 || v.paused;
      setLag({ late, label: late && l > 12 ? `−${Math.floor(l / 60)}:${String(Math.floor(l % 60)).padStart(2, '0')}` : 'Direct' });
      // Revenu tout seul au direct : plus besoin d'enregistrer
      if (S.heldAt && !v.paused && l < 8) { hold(false); S.heldAt = 0; }
    }, 1000);
    return () => { S.dead = true; clearInterval(lagT); clearTimeout(S.wakeT); stopPreview(); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('playing', onPlaying); };
  }, []);
  // Chaîne montrée sans être lancée (image et programme)
  useEffect(() => { if (selected && S.ch !== selected) setStillOn(true); }, [selected]);

  const onKey = (e) => {
    const k = e.key;
    if (k === ' ' || k === 'k') togglePause();
    else if (k === 'ArrowUp') vol(0.1); else if (k === 'ArrowDown') vol(-0.1);
    else if (k === 'PageDown' || k === 'n') onZap(1); else if (k === 'PageUp' || k === 'p') onZap(-1);
    else if (k === 'ArrowRight') seekBy(10); else if (k === 'ArrowLeft') seekBy(-10);
    else if (k === 'f' || k === 'F') toggleFs(); else if (k === 'm' || k === 'M') setMuted(!muted);
    else if (k === 'l' || k === 'End') goLive();
    else return;
    e.preventDefault(); e.stopPropagation(); wake();
  };
  const ctl = (ic, label, fn, cls = '') => <button className={`pv-c f ${cls}`} type="button" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); fn(); wake(); }}><Icon name={ic} /></button>;
  const off = muted || volume === 0;
  const [cur, nxt] = (selected && nn[selected.id]) || [];
  return (
    <section className="pv" aria-label="Lecteur">
      <div ref={screen} className={`pv-screen${playing ? '' : ' idle'}${paused && playing ? ' paused' : ''}${awake ? ' awake' : ''}`} tabIndex={0} aria-label="Lecteur : espace pour pause, flèches pour le son et les chaînes, F pour agrandir"
        onPointerMove={wake} onKeyDown={onKey} onDoubleClick={toggleFs}
        onClick={() => { if (!playing) { if (selected) { setMuted(false); start(selected); } return; } if (awake) togglePause(); wake(); }}>
        {still ? <img className="pv-still" alt="" src={still} hidden={!stillOn} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} onLoad={(e) => { e.currentTarget.style.visibility = ''; }} /> : null}
        <video ref={video} playsInline webkit-playsinline="true" />
        <div className="pv-status" hidden={!status}>{status}</div>
        <button className="pv-big f" type="button" aria-label="Lancer la chaîne" onClick={(e) => { e.stopPropagation(); if (selected) { setMuted(false); start(selected); } }}><Icon name="play" /></button>
        <div className="pv-bar">
          {ctl('prev', 'Chaîne précédente', () => onZap(-1))}
          {ctl(paused ? 'play' : 'pause', paused ? 'Reprendre' : 'Pause (Venus enregistre : tu reprends où tu étais)', togglePause)}
          {ctl('stop', 'Arrêter', stopPlayback, 'pv-stop')}
          {ctl('next', 'Chaîne suivante', () => onZap(1))}
          {ctl('r10', 'Reculer de 10 s', () => seekBy(-10), 'pv-seek')}
          {ctl('f10', 'Avancer de 10 s', () => seekBy(10), 'pv-seek')}
          <button className={`pv-livebtn f${lag.late ? ' late' : ''}`} type="button" title="Revenir au direct" onClick={(e) => { e.stopPropagation(); goLive(); wake(); }}><span className="dot" /><span className="lbl">{lag.label}</span></button>
          <span className="pv-sp" />
          {ctl(off ? 'mute' : volume < 0.5 ? 'vollow' : 'vol', off ? 'Activer le son' : 'Couper le son', () => setMuted(!muted))}
          <input className="pv-vol" type="range" min={0} max={100} step={5} aria-label="Volume" value={Math.round((off ? 0 : volume) * 100)}
            onChange={(e) => { const v = video.current; v.volume = e.target.value / 100; setVolume(v.volume); if (muted && v.volume > 0) setMuted(false); wake(); }} onClick={(e) => e.stopPropagation()} />
          <button className="pv-c pv-rec f" type="button" title="Enregistrer" aria-label="Enregistrer" onClick={(e) => { e.stopPropagation(); if (selected) recordSheet(selected, nn[selected.id] || []); }}><span className="rec-dot" /></button>
          {ctl('fs', 'Agrandir (plein écran)', toggleFs, 'pv-fs')}
        </div>
      </div>
      <div className="pv-info">
        <h2 className="pv-name">{selected ? (selected.number ? `${selected.number}. ${selected.title}` : selected.title) : ''}</h2>
        <p className="pv-group">{(selected && selected.group) || 'TV en direct'}</p>
        <div className="pv-prog">
          {cur ? (
            <>
              <button className="pv-now f" onClick={() => programSheet(cur, selected)}>
                <b>{cur.title}</b><small>{`${hm(cur.start)} – ${hm(cur.stop)}${cur.sub ? ` · ${cur.sub}` : ''}`}</small>
                <span className="prog-bar"><i style={{ width: `${Math.min(100, Math.round(((Date.now() - cur.start) / (cur.stop - cur.start)) * 100))}%` }} /></span>
              </button>
              {nxt ? <small className="pv-next">{`Ensuite à ${hm(nxt.start)} : ${nxt.title}`}</small> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------- guide des programmes
function Guide() {
  const admin = shared().app.state.profile.isAdmin;
  const nowFrom = () => Math.floor((Date.now() - 30 * 60000) / (30 * 60000)) * 30 * 60000;
  const [from, setFrom] = useState(nowFrom);
  const [n, setN] = useState(0);
  const span = 4 * 3600e3;
  const { data: d, error } = useApi(`/api/epg?from=${from}&to=${from + span}`, { deps: [n], keep: true });
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const reload = () => setN((x) => x + 1);
  const width = (span / 60000) * PX;
  const times = [];
  for (let t = from; t < from + span; t += 30 * 60000) times.push(t);
  return (
    <main className="with-nav page-in">
      <div className="page guide-page">
        <div className="page-head">
          <div className="head-left"><h1>TV en direct</h1><p className="count">{day(from)}</p></div>
          <div className="head-tools"><TvTabs current="guide" />{admin ? <button className="btn btn-ghost btn-small f" onClick={() => guideSettings(reload)}><Icon name="gear" />Réglages du guide</button> : null}</div>
        </div>
        <div className="g-nav">
          <button className="btn btn-ghost btn-small f" disabled={from <= Date.now() - 6 * 3600e3} onClick={() => setFrom(from - 2 * 3600e3)}><Icon name="back" />2 h avant</button>
          <button className="btn btn-ghost btn-small f" onClick={() => setFrom(nowFrom())}>Maintenant</button>
          <button className="btn btn-ghost btn-small f" onClick={() => setFrom(from + 2 * 3600e3)}>2 h après<Icon name="fwd" /></button>
        </div>
        {Object.keys(d.programs).length ? (
          <div className="g-scroll">
            <div className="g-grid">
              <div className="g-head"><span className="g-corner" /><div className="g-times" style={{ width }}>{times.map((t) => <span key={t} style={{ left: ((t - from) / 60000) * PX }}>{hm(t)}</span>)}</div></div>
              <div className="g-body">
                {d.channels.map((ch) => {
                  const progs = d.programs[ch.id] || [];
                  return (
                    <div key={ch.id} className="g-row">
                      <button className="g-ch f" title={`Regarder ${ch.title}`} onClick={() => go(playPath(ch.id))}>
                        {ch.logo ? <HideOnError src={img(ch.logo)} /> : null}
                        <span>{ch.number ? <em>{ch.number}</em> : null}{ch.title}</span>
                      </button>
                      <div className="g-lane" style={{ width }}>
                        {progs.length ? progs.map((p) => {
                          const a = Math.max(p.start, from), b = Math.min(p.stop, from + span);
                          const onAir = p.start <= d.now && p.stop > d.now;
                          return (
                            <button key={p.id} className={`g-prog f${onAir ? ' now' : ''}${p.stop <= d.now ? ' past' : ''}${p.rec ? ' rec' : ''}`} style={{ left: ((a - from) / 60000) * PX, width: Math.max(6, ((b - a) / 60000) * PX - 3) }}
                              title={`${p.title} · ${hm(p.start)}–${hm(p.stop)}`} onClick={() => programSheet(p, ch, reload)}>
                              {p.rec ? <span className="rec-dot" /> : null}<b>{p.title}</b><small>{`${hm(p.start)} – ${hm(p.stop)}${p.sub ? ` · ${p.sub}` : ''}`}</small>
                            </button>
                          );
                        }) : <span className="g-none">Pas de programme</span>}
                      </div>
                    </div>
                  );
                })}
                {d.now >= from && d.now < from + span ? <div className="g-nowwrap" style={{ width }}><i className="g-now" style={{ left: ((d.now - from) / 60000) * PX }} /></div> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">
            <h2>Pas encore de guide</h2>
            <p>{d.state.sources ? 'Le guide est en cours de téléchargement, ou ne correspond à aucune de vos chaînes.' : 'Votre liste IPTV ne donne pas d’adresse de guide (XMLTV).'}</p>
            {admin ? <button className="btn btn-play f" onClick={() => guideSettings(reload)}>Ajouter une adresse de guide</button> : <p>Demandez à l’administrateur d’en ajouter une.</p>}
          </div>
        )}
      </div>
    </main>
  );
}

async function guideSettings(onDone) {
  const d = await api('/api/admin/livetv');
  openSheet('Guide des programmes et enregistrements', (close) => <GuideSettings d={d} close={close} onDone={onDone} />, { wide: true });
}

function GuideSettings({ d, close, onDone }) {
  const [v, setV] = useState({ urls: d.epg.manual, dir: d.dvrPath, pre: d.pre, post: d.post, all: !!d.everyone });
  const [err, setErr] = useState('');
  const last = d.epg.last;
  const auto = d.epg.sources.filter((x) => !d.epg.manual.includes(x));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api('/api/admin/livetv', { method: 'PUT', body: { epgUrls: v.urls, dvrPath: v.dir, pre: Number(v.pre) || 0, post: Number(v.post) || 0, everyone: v.all } });
      await api('/api/admin/tasks/epg/run', { method: 'POST' });
      close(); toast('Enregistré : le guide se met à jour', { type: 'success' }); setTimeout(() => onDone && onDone(), 4000);
    } catch (e2) { setErr(e2.message); }
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <form className="edit-form" onSubmit={submit}>
      <div className="field"><label>Adresses du guide XMLTV (une par ligne)</label><textarea className="input mono" rows={4} placeholder="https://exemple.com/guide.xml.gz" value={v.urls} onChange={set('urls')} />
        <small>{`Trouvées automatiquement dans vos listes : ${auto.length ? auto.map((x) => x.replace(/(password=)[^&]+/i, '$1•••')).join(', ') : 'aucune'}. ${last ? `Dernière mise à jour : ${new Date(last.at).toLocaleString('fr-FR')} (${last.programs} programmes, ${last.channels} chaînes).` : ''}`}</small></div>
      <div className="field"><label>Dossier des enregistrements</label><input className="input mono" value={v.dir} onChange={set('dir')} /><small>Sur le serveur. Avec Docker, choisissez un dossier monté (ex. /media/enregistrements).</small></div>
      <div className="two-cols">
        <div className="field"><label>Minutes avant le début</label><input className="input" type="number" min={0} max={30} value={v.pre} onChange={set('pre')} /></div>
        <div className="field"><label>Minutes après la fin</label><input className="input" type="number" min={0} max={120} value={v.post} onChange={set('post')} /></div>
      </div>
      <label className="switch"><span>Tous les profils peuvent programmer des enregistrements</span><input type="checkbox" className="f" checked={v.all} onChange={set('all')} /></label>
      <p className="error-text">{err}</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit">Enregistrer et mettre à jour le guide</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- enregistrements
function Recordings() {
  const [n, setN] = useState(0);
  const { data: d, error } = useApi('/api/recordings', { deps: [n], keep: true });
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const reload = () => setN((x) => x + 1);
  const now = Date.now();
  const del = async (r) => {
    if (r.status === 'done' && !(await confirm(`Supprimer l’enregistrement « ${r.title} » (fichier effacé) ?`, 'Supprimer'))) return;
    await api(`/api/recordings/${r.id}`, { method: 'DELETE' }); reload();
  };
  const groups = [['recording', 'En cours'], ['scheduled', 'Programmés'], ['done', 'Enregistrés'], ['failed', 'Échecs']];
  return (
    <main className="with-nav page-in">
      <div className="page rec-page">
        <div className="page-head"><div className="head-left"><h1>TV en direct</h1></div><div className="head-tools"><TvTabs current="enregistrements" /></div></div>
        {groups.map(([st, label]) => {
          const list = d.recordings.filter((r) => r.status === st);
          if (!list.length) return null;
          // Enregistrés : en vignettes, prêts à regarder
          if (st === 'done') return <section key={st} className="rec-sec"><h2 className="section-title">{`${label} (${list.length})`}</h2><div className="rec-grid">{list.map((r) => <DoneCard key={r.id} r={r} onDelete={() => del(r)} />)}</div></section>;
          return (
            <section key={st} className="rec-sec">
              <h2 className="section-title">{`${label} (${list.length})`}</h2>
              {list.map((r) => (
                <div key={r.id} className={`rec-row st-${r.status}`}>
                  {r.logo ? <HideOnError src={img(r.logo)} className="rec-logo" /> : <span className="rec-logo" />}
                  <div className="grow">
                    <b>{r.title}{r.sub ? <small>{` · ${r.sub}`}</small> : null}</b>
                    <span>{`${r.channel || 'Chaîne'} · ${day(r.start)}, ${hm(r.start)} – ${hm(r.stop)}${r.ruleId ? ' · émission suivie' : ''}`}</span>
                    {r.status === 'recording' ? <div className="prog-bar"><i style={{ width: `${Math.min(100, Math.round(((now - r.start) / (r.stop - r.start)) * 100))}%` }} /></div> : null}
                    {r.error ? <small className="error-text">{r.error}</small> : null}
                  </div>
                  <button className="btn btn-ghost btn-small f" onClick={() => del(r)}>{r.status === 'recording' ? 'Arrêter' : r.status === 'scheduled' ? 'Annuler' : <Icon name="trash" />}</button>
                </div>
              ))}
            </section>
          );
        })}
        {d.rules.length ? (
          <section className="rec-sec">
            <h2 className="section-title">Émissions suivies</h2>
            {d.rules.map((r) => (
              <div key={r.id} className="rec-row">
                <span className="rec-logo"><Icon name="list" /></span>
                <div className="grow"><b>{r.title}</b><span>{`${r.channel_title || 'Chaîne'} · chaque diffusion est enregistrée`}</span></div>
                <button className="btn btn-ghost btn-small f" onClick={async () => { await api(`/api/recordings/rules/${r.id}`, { method: 'DELETE' }); reload(); }}>Ne plus suivre</button>
              </div>
            ))}
          </section>
        ) : null}
        {!d.recordings.length && !d.rules.length ? <div className="empty"><h2>Aucun enregistrement</h2><p>Dans le Guide, touchez un programme puis « Enregistrer ».</p><button className="btn btn-play f" onClick={() => go('/tv?vue=guide')}>Ouvrir le guide</button></div> : null}
      </div>
    </main>
  );
}

function DoneCard({ r, onDelete }) {
  const pct = r.progress && r.progress.duration && !r.progress.watched ? Math.min(100, (r.progress.position / r.progress.duration) * 100) : 0;
  const mins = r.duration ? Math.round(r.duration / 60) : Math.round((r.stop - r.start) / 60000);
  return (
    <article className={`rec-card${r.progress && r.progress.watched ? ' seen' : ''}`}>
      <button className="rec-shot f" aria-label={`Regarder ${r.title}`} disabled={!r.itemId} onClick={() => r.itemId && go(playPath(r.itemId))}>
        {r.itemId ? <HideOnError src={`/api/items/${r.itemId}/thumb?size=big`} /> : null}
        <span className="rec-play"><Icon name="play" /></span>
        <span className="rec-dur">{mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`}</span>
        {pct ? <i className="rec-bar" style={{ width: `${pct}%` }} /> : null}
      </button>
      <div className="rec-meta">
        <span className="rec-ch">{r.logo ? <HideOnError src={img(r.logo)} /> : null}{r.channel || 'Chaîne'}</span>
        <b>{r.title}{r.sub ? <small>{` · ${r.sub}`}</small> : null}</b>
        <small>{`${day(r.start)}, ${hm(r.start)} – ${hm(r.stop)}`}</small>
      </div>
      <button className="rec-del f" aria-label={`Supprimer l’enregistrement ${r.title}`} title="Supprimer" onClick={onDelete}><Icon name="trash" /></button>
    </article>
  );
}
