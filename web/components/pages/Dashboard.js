'use client';
// Tableau de bord de l'administrateur : lectures en cours (pause, arrêt, message), code de connexion,
// appareils, tâches de fond, santé du serveur, activité récente, médiathèques à vérifier.
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon, Avatar } from '../Icon';
import { PageError, PageLoading } from '../PageState';

const fmtBytes = (b) => {
  if (!b) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 1 : 0).replace('.', ',')} ${u[i]}`;
};
const nf = new Intl.NumberFormat('fr-FR');
const ago = (t) => {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 30 ? `il y a ${d} j` : new Date(t).toLocaleDateString('fr-FR');
};
const fmtUptime = (s) => { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60); return d ? `${d} j ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`; };
const fmtTime = (s) => shared().ui.fmtTime(s);
const Meter = ({ pct, cls = '' }) => <div className={`meter ${cls}${pct > 90 ? ' hot' : pct > 75 ? ' warm' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
const ACT_ICON = { play: 'play', stop: 'stop', login: 'key', message: 'chat', control: 'pause', device: 'exit', server: 'power', scan: 'refresh', seerr: 'down' };
const NAV = [
  ['Suivi', [['apercu', 'Aperçu', 'gauge'], ['lectures', 'En ce moment', 'play'], ['appareils', 'Appareils', 'cast'], ['activite', 'Activité', 'chat']]],
  ['Serveur', [['sante', 'Santé', 'server'], ['taches', 'Tâches de fond', 'refresh'], ['medias', 'Médiathèques', 'folder']]],
  ['Outils', [['/qualite', 'Qualité', 'film'], ['/securite', 'Sécurité', 'lock'], ['/serveur', 'Mises à jour et journaux', 'spark'], ['/stats', 'Statistiques', 'gauge'], ['/reglages', 'Réglages', 'gear']]],
];
const WHERE = { playing: ['apercu', 'lectures'], code: ['apercu', 'appareils'], tasks: ['apercu', 'taches'], devices: ['appareils'], system: ['sante'], activity: ['activite'], libs: ['medias', 'sante'] };
const TABS = NAV.flatMap(([, l]) => l).filter(([k]) => !k.startsWith('/'));
const confirm = (m, l) => shared().ui.confirmSheet(m, l);

export default function Dashboard() {
  useTitle('Tableau de bord');
  const admin = shared().app.state.profile.isAdmin;
  const { search } = useVenus();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const refresh = async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try { setD(await api('/api/admin/dashboard')); } catch (e) { setD((x) => { if (!x) setError(e); return x; }); }
    busy.current = false;
    shared().app.hideBoot();
  };
  useEffect(() => {
    if (!admin) return undefined;
    refresh();
    // Onglet caché : pas de mise à jour (le serveur et la batterie se reposent)
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
    return () => clearInterval(poll);
  }, []);
  const [tab, setTab] = useState(() => { const t = (search && search.get('vue')) || (() => { try { return sessionStorage.getItem('vn_dash_tab'); } catch { return null; } })() || 'apercu'; return TABS.some(([k]) => k === t) ? t : 'apercu'; });
  const [swap, setSwap] = useState(0);
  if (!admin) return <main className="with-nav"><div className="empty"><h2>Réservé à l’administrateur</h2></div></main>;
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const pick = (k) => {
    setTab(k); setSwap((n) => n + 1);
    try { sessionStorage.setItem('vn_dash_tab', k); } catch { /* */ }
    const u = k === 'apercu' ? '/dashboard' : `/dashboard?vue=${k}`;
    window.__vnSilent = u; history.replaceState(history.state, '', u);
  };
  const shown = (name) => WHERE[name].includes(tab);
  const ctx = { d, setD, refresh };
  return (
    <main className="with-nav page-in">
      <div className="page dash">
        <Head ctx={ctx} />
        <Notes />
        <div className="set-layout dash-layout">
          <nav className="set-nav" aria-label="Rubriques du tableau de bord">
            {NAV.map(([title, items]) => (
              <div key={title} className="set-group">
                <span className="set-group-t">{title}</span>
                {items.map(([k, label, ic]) => (k.startsWith('/')
                  ? <a key={k} className="set-tab f" href={k}><Icon name={ic} /><span>{label}</span><Icon name="fwd" /></a>
                  : <button key={k} className={`set-tab f${k === tab ? ' on' : ''}`} aria-current={k === tab ? 'page' : undefined} onClick={() => pick(k)}><Icon name={ic} /><span>{label}</span></button>))}
              </div>
            ))}
          </nav>
          <div className="set-main">
            <div className="set-head"><h2>{(TABS.find(([k]) => k === tab) || [])[1] || ''}</h2></div>
            {tab === 'apercu' ? <Kpis d={d} /> : null}
            <div className={`dash-grid${swap ? ' swap' : ''}`} key={swap} data-tab={tab}>
              {shown('playing') ? <section className="dash-box playing-box"><Playing ctx={ctx} /></section> : null}
              {shown('code') ? <section className="dash-box code-box c-code"><LoginCode ctx={ctx} /></section> : null}
              {shown('tasks') ? <section className="dash-box c-task"><Tasks d={d} /></section> : null}
              {shown('devices') ? <section className="dash-box c-dev"><Devices ctx={ctx} /></section> : null}
              {shown('system') ? <section className="dash-box c-health"><System d={d} /></section> : null}
              {shown('activity') ? <section className="dash-box c-act"><Activity d={d} /></section> : null}
              {shown('libs') ? <Libs d={d} alone={tab === 'medias'} /> : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// Journal des changements (montré une fois) et mise à jour disponible
function Notes() {
  const [log, setLog] = useState(null);
  const [upd, setUpd] = useState(null);
  useEffect(() => {
    api('/api/admin/changelog').then((c) => { if (c.items && c.items.length) setLog(c.items); }).catch(() => {});
    api('/api/admin/update').then((u) => { if (u && u.behind) setUpd(u); }).catch(() => {});
  }, []);
  return (
    <>
      {log ? (
        <div className="upd-note changelog">
          <Icon name="spark" />
          <div className="cl-body"><b>{`Venus a été mis à jour (${log.length} changement${log.length > 1 ? 's' : ''})`}</b><ul>{log.slice(0, 6).map((i, k) => <li key={k}>{i.title}</li>)}</ul></div>
          <button className="btn btn-small f" onClick={async () => { setLog(null); await api('/api/admin/changelog/seen', { method: 'POST' }).catch(() => {}); }}>Vu</button>
        </div>
      ) : null}
      {upd ? (
        <div className="upd-note"><Icon name="spark" /><span>{`Mise à jour disponible : ${upd.behind}${upd.more ? '+' : ''} nouveauté${upd.behind > 1 ? 's' : ''}`}</span><button className="btn btn-small btn-play f" onClick={() => go('/serveur?onglet=maj')}>Voir</button></div>
      ) : null}
    </>
  );
}

// Envoyer une commande (pause, reprise, arrêt) ou un message à un appareil, ou à tous
const send = async (device, cmd, text, refresh) => {
  try {
    const r = await api('/api/admin/control', { method: 'POST', body: device ? { device, cmd, text } : { all: true, cmd, text } });
    toast(cmd === 'pause' ? 'Pause demandée' : cmd === 'play' ? 'Reprise demandée' : cmd === 'stop' ? 'Lecture arrêtée'
      : !device ? (r && r.sent ? `Message envoyé à ${r.sent} appareil${r.sent > 1 ? 's' : ''}` : 'Message envoyé (aucun autre appareil ouvert pour l’instant)') : 'Message envoyé', { type: 'success' });
    setTimeout(refresh, 1200);
  } catch (e) { toast(e.message, true); }
};
function compose(device, who, refresh) {
  openSheet(device ? `Message pour ${who || 'cet appareil'}` : 'Message à tous les appareils', (close) => <Compose device={device} refresh={refresh} close={close} />);
}
function Compose({ device, refresh, close }) {
  const [text, setText] = useState('');
  const input = useRef(null);
  useEffect(() => { setTimeout(() => input.current && input.current.focus(), 50); }, []);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await send(device, 'message', text, refresh); close(); }}>
      <textarea ref={input} className="input" rows={3} maxLength={300} placeholder="Ex. : le serveur redémarre dans 5 minutes" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted">Il apparaît en petite notification en bas à droite chez les autres, même en plein écran. Toi, tu ne le reçois pas.</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit"><Icon name="send" />Envoyer</button></div>
    </form>
  );
}

function Head({ ctx }) {
  const { d, refresh } = ctx;
  const sv = d.server, s = d.system;
  const loadPct = (s.load[0] / s.cpus) * 100, memPct = ((s.memTotal - s.memFree) / s.memTotal) * 100;
  const diskPct = Math.max(0, ...s.disks.map((k) => ((k.total - k.free) / k.total) * 100));
  const missing = d.libraries.filter((l) => !l.exists || (l.network && l.network.ok === false)).length;
  const issues = [loadPct > 100 && 'processeur saturé', memPct > 90 && 'mémoire presque pleine', diskPct > 90 && 'disque presque plein', missing && `${missing} médiathèque${missing > 1 ? 's' : ''} introuvable${missing > 1 ? 's' : ''}`].filter(Boolean);
  const level = diskPct > 95 || missing || loadPct > 150 ? 'bad' : issues.length ? 'warn' : 'good';
  const restart = async () => {
    if (!(await confirm('Redémarrer Venus ? Les lectures en cours seront coupées quelques secondes.', 'Redémarrer'))) return;
    try { await api('/api/admin/restart', { method: 'POST' }); toast('Redémarrage…'); setTimeout(() => location.reload(), 6000); } catch (e) { toast(e.message, true); }
  };
  return (
    <div className="dash-head">
      <div>
        <div className="dash-h1"><h1>Tableau de bord</h1><span className={`status-chip ${level}`}><i />{level === 'good' ? 'Tout va bien' : issues.join(' · ')}</span></div>
        <p className="dash-sub">{`Venus ${sv.version} · en ligne depuis ${fmtUptime(sv.uptime)}`}</p>
      </div>
      <div className="dash-actions">
        <button className="tool f" onClick={async () => { await api('/api/admin/scan', { method: 'POST', body: {} }); toast('Analyse des médiathèques lancée'); refresh(); }}><Icon name="refresh" /><span className="lbl">Analyser</span></button>
        <button className="tool f" onClick={() => compose(null, null, refresh)}><Icon name="chat" /><span className="lbl">Message à tous</span></button>
        {sv.canRestart ? <button className="tool f" onClick={restart}><Icon name="power" /><span className="lbl">Redémarrer</span></button> : null}
      </div>
    </div>
  );
}

function Kpis({ d }) {
  const c = d.counts;
  const tiles = [['Films', c.movie, 'film', '/films', 'k-blue'], ['Séries', c.show, 'tv', '/series', 'k-violet'], ['Animés', c.anime, 'spark', '/animes', 'k-pink'], ['Stockage', fmtBytes(d.totals.size), 'server', null, 'k-amber']].filter(([, v], i) => i === 3 || v);
  return (
    <>
      <div className="kpis">
        {tiles.map(([label, v, ic, href, col]) => {
          const inner = <><span className="kpi-ic"><Icon name={ic} /></span><b>{typeof v === 'number' ? nf.format(v) : v}</b><span>{label}</span></>;
          return href ? <button key={label} className={`kpi ${col} f`} onClick={() => go(href)}>{inner}</button> : <div key={label} className={`kpi ${col}`}>{inner}</div>;
        })}
      </div>
      <p className="kpi-more">{[c.episode && `${nf.format(c.episode)} épisodes`, c.clip && `${nf.format(c.clip)} clips`, c.channel && `${nf.format(c.channel)} chaînes`, d.totals.hours && `${nf.format(d.totals.hours)} h de vidéo`].filter(Boolean).join(' · ')}</p>
    </>
  );
}

function Playing({ ctx }) {
  const { d, refresh } = ctx;
  const list = d.playing;
  return (
    <>
      <div className="dash-title">
        <h2>En ce moment</h2>
        {list.length ? <span className="pill live">{`${list.length} en cours`}</span> : null}
        {d.transcodes ? <span className="pill warm">{`${d.transcodes} conversion${d.transcodes > 1 ? 's' : ''}`}</span> : null}
      </div>
      {list.length ? <div className="np-list">{list.map((p) => <NowPlaying key={p.device} p={p} refresh={refresh} />)}</div> : <p className="dash-empty calm"><Icon name="moon" />Personne ne regarde en ce moment.</p>}
    </>
  );
}

function NowPlaying({ p, refresh }) {
  const [picOk, setPicOk] = useState(true);
  const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const mode = p.mode === 'direct' ? 'Lecture directe' : p.mode === 'remux' ? 'Remux (sans perte)' : p.mode === 'live' || p.live ? 'Direct TV' : p.mode ? `Conversion${p.hw ? ` · ${p.hw}` : ''}` : '';
  const art = p.backdrop || p.poster;
  return (
    <article className={`np${p.paused ? ' paused' : ''}`}>
      <div className="np-art">
        {(p.live && !art) || !picOk ? null : <img src={art ? img(art) : `/api/items/${p.itemId}/thumb`} alt="" onError={() => setPicOk(false)} />}
        <span className={`np-state${p.paused ? ' paused' : ''}`}><Icon name={p.paused ? 'pause' : 'play'} />{p.paused ? 'En pause' : 'Lecture'}</span>
      </div>
      <div className="np-body">
        <button className="np-title f" onClick={() => go(`/titre/${p.showId || p.itemId}`)}>{p.showTitle || p.title}</button>
        {p.showTitle ? <div className="np-sub">{`S${p.season} É${p.episode} · ${p.title}`}</div> : null}
        <div className="np-who"><Avatar profile={{ name: p.profile, avatar: p.avatar }} cls="tiny" /><span>{`${p.profile} · ${p.deviceName}`}</span><small>{p.ip ? p.ip.replace(/^::ffff:/, '') : ''}</small></div>
        {p.live ? <div className="np-time">En direct</div> : <div className="np-prog"><div className="meter"><i style={{ width: `${pct}%` }} /></div><span>{`${fmtTime(p.position)} / ${fmtTime(p.duration)}`}</span></div>}
        <div className="np-tags">
          {mode ? <span className={`pill${p.mode === 'transcode' ? ' warm' : ''}`}>{mode}</span> : null}
          {p.quality && p.quality !== 'auto' ? <span className="pill">{p.quality}</span> : null}
          {p.hls && p.hls.reason ? <span className="pill ghost" title={p.hls.reason}>{p.hls.reason}</span> : null}
        </div>
      </div>
      <div className="np-ctl">
        <button className="btn btn-ghost btn-icon f" aria-label={p.paused ? 'Reprendre la lecture' : 'Mettre en pause'} title={p.paused ? 'Reprendre' : 'Pause'} onClick={() => send(p.device, p.paused ? 'play' : 'pause', null, refresh)}><Icon name={p.paused ? 'play' : 'pause'} /></button>
        <button className="btn btn-ghost btn-icon f" aria-label="Arrêter la lecture" title="Arrêter" onClick={() => send(p.device, 'stop', null, refresh)}><Icon name="stop" /></button>
        <button className="btn btn-ghost btn-icon f" aria-label="Envoyer un message" title="Message" onClick={() => compose(p.device, p.profile, refresh)}><Icon name="chat" /></button>
      </div>
    </article>
  );
}

// Code de connexion à 6 chiffres (un appareil, une fois), avec son compte à rebours
function LoginCode({ ctx }) {
  const { d, setD, refresh } = ctx;
  const lc = d.loginCode;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, lc.expires - now);
  useEffect(() => { if (!left) refresh(); }, [left === 0]);
  return (
    <>
      <div className="dash-title"><h2>Code de connexion</h2>{lc.uses ? <span className="pill">{`${lc.uses} connexion${lc.uses > 1 ? 's' : ''}`}</span> : null}</div>
      <p className="muted small">Pour connecter un appareil sans mot de passe. Valable une fois.</p>
      <div className="code-wrap"><b className="big-code">{`${lc.code.slice(0, 3)} ${lc.code.slice(3)}`}</b><button className="btn btn-ghost btn-icon f" aria-label="Copier le code" title="Copier" onClick={() => navigator.clipboard?.writeText(lc.code).then(() => toast('Code copié'), () => {})}><Icon name="copy" /></button></div>
      <div className="meter code-meter"><i style={{ width: `${(left / lc.ttl) * 100}%` }} /></div>
      <span className="code-left">{left ? `Expire dans ${fmtTime(left / 1000)}` : 'Expiré : un nouveau code arrive…'}</span>
      <button className="btn btn-small btn-ghost f" onClick={async () => { const code = await api('/api/admin/login-code', { method: 'POST' }); setD((x) => ({ ...x, loginCode: code })); toast('Nouveau code créé'); }}><Icon name="refresh" />Nouveau code</button>
    </>
  );
}

function Devices({ ctx }) {
  const { d, refresh } = ctx;
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="dash-title"><h2>Appareils</h2><span className="pill">{d.devices.length}</span></div>
      <div className="dev-list">
        {d.devices.slice(0, all ? 40 : 5).map((x) => {
          const on = Date.now() - x.lastSeen < 5 * 60000;
          return (
            <div key={x.id} className="dev">
              <span className={`dev-dot${on ? ' on' : ''}`} title={on ? 'Actif' : 'Inactif'} />
              <div className="grow"><b>{x.name}{x.current ? <em> (cet appareil)</em> : null}{x.playing ? <span className="pill tiny">en lecture</span> : null}</b><span>{`${x.profile || 'Aucun profil'} · ${ago(x.lastSeen)}`}</span></div>
              <button className="btn btn-ghost btn-icon btn-mini f" title="Envoyer un message" aria-label="Envoyer un message" onClick={() => compose(x.id, x.profile || x.name, refresh)}><Icon name="chat" /></button>
              {x.current ? null : <button className="btn btn-ghost btn-icon btn-mini f" title="Déconnecter cet appareil" aria-label="Déconnecter cet appareil" onClick={async () => {
                if (!(await confirm(`Déconnecter « ${x.name} » ? Il faudra le mot de passe ou un code pour revenir.`, 'Déconnecter'))) return;
                try { await api(`/api/admin/devices/${x.id}`, { method: 'DELETE' }); toast('Appareil déconnecté'); refresh(); } catch (e) { toast(e.message, true); }
              }}><Icon name="exit" /></button>}
            </div>
          );
        })}
      </div>
      {d.devices.length > 5 ? <button className="linkish dash-more f" onClick={() => setAll(!all)}>{all ? 'Afficher moins' : `Afficher les ${d.devices.length} appareils`}</button> : null}
    </>
  );
}

function Tasks({ d }) {
  const t = d.tasks, sc = t.scan;
  const item = (key, ic, title, text, extra = null) => <div key={key} className="task"><span className="task-ic"><Icon name={ic} /></span><div className="grow"><b>{title}</b><span>{text}</span>{extra}</div></div>;
  const pending = [
    sc.running && item('scan', 'refresh', 'Analyse des médiathèques', `${sc.phase || 'En cours'}${sc.total ? ` · ${sc.done} / ${sc.total}` : ''}`, sc.total ? <Meter pct={(sc.done / sc.total) * 100} /> : null),
    sc.error && item('err', 'info', 'Dernière analyse', `Erreur : ${sc.error}`),
    t.ratings && item('rat', 'spark', 'Notes et distribution', `${t.ratings} titre${t.ratings > 1 ? 's' : ''} en file d’attente`),
    t.segments && item('seg', 'skip', 'Génériques (début et fin)', `${t.segments} saison${t.segments > 1 ? 's' : ''} à analyser`),
    t.unmatched && item('unm', 'info', 'Titres non reconnus', `${t.unmatched} à identifier`, <button className="linkish f" onClick={() => go('/reglages?section=sources')}>Corriger</button>),
  ].filter(Boolean);
  return (
    <>
      <div className="dash-title"><h2>Tâches de fond</h2>{pending.length ? <span className="pill warm">{pending.length}</span> : null}</div>
      {pending.length ? pending : <p className="dash-empty ok"><Icon name="check" />{`Tout est à jour${sc.lastScan ? ` · dernière analyse ${ago(sc.lastScan)}` : ''}`}</p>}
    </>
  );
}

function Gauge({ label, pct, value, sub }) {
  return (
    <div className={`gauge ${pct > 90 ? 'hot' : pct > 75 ? 'warm' : 'ok'}`}>
      <div className="g-ring" style={{ '--p': `${Math.min(100, Math.round(pct))}` }}><b>{pct > 100 ? '100 %+' : `${Math.round(pct)} %`}</b></div>
      <div className="g-txt"><span>{label}</span><small>{value}</small>{sub ? <small className="dim">{sub}</small> : null}</div>
    </div>
  );
}

function System({ d }) {
  const s = d.system;
  const memUsed = s.memTotal - s.memFree;
  const loadPct = (s.load[0] / s.cpus) * 100;
  const diskUsed = s.disks.reduce((a, k) => a + k.total - k.free, 0), diskTotal = s.disks.reduce((a, k) => a + k.total, 0);
  const fc = d.forecast;
  return (
    <>
      <div className="dash-title"><h2>Santé du serveur</h2></div>
      <div className="gauges">
        <Gauge label="Processeur" pct={loadPct} value={loadPct > 100 ? 'Saturé' : 'Charge'} sub={`${s.cpus} cœurs`} />
        <Gauge label="Mémoire" pct={(memUsed / s.memTotal) * 100} value={`${fmtBytes(memUsed)} / ${fmtBytes(s.memTotal)}`} />
        {diskTotal ? <Gauge label="Disques" pct={(diskUsed / diskTotal) * 100} value={`${fmtBytes(diskTotal - diskUsed)} libres`} sub={fc && fc.fullIn != null && fc.fullIn < 365 ? `plein dans ${fc.fullIn > 60 ? `${Math.round(fc.fullIn / 30)} mois` : `${fc.fullIn} j`}` : null} /> : null}
      </div>
      <details className="sys-more">
        <summary className="f">Détails</summary>
        <div className="sys">
          <div className="sys-row"><span>Processeur</span><b>{s.cpuModel.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim()}</b></div>
          <div className="sys-row"><span>Venus utilise</span><b>{fmtBytes(s.rss)}</b></div>
          <div className="sys-row"><span>Accélération</span><b>{d.server.hw.label || 'Processeur seul'}</b><small>{d.server.hw.type && d.server.hw.type !== 'none' ? (d.server.hw.tested ? 'Testée et fonctionnelle' : 'Détectée') : 'Aucune carte graphique : conversions plus lentes'}</small></div>
          {s.disks.map((k, i) => <div key={i} className="sys-row"><span>Disque</span><b>{`${fmtBytes(k.total - k.free)} / ${fmtBytes(k.total)}`}</b><Meter pct={((k.total - k.free) / k.total) * 100} /><small>{`${fmtBytes(k.free)} libres · ${k.names.join(', ')}`}</small></div>)}
        </div>
      </details>
    </>
  );
}

function Activity({ d }) {
  return (
    <>
      <div className="dash-title"><h2>Activité récente</h2></div>
      {d.activity.length ? (
        <ol className="timeline">
          {d.activity.slice(0, 6).map((a, i) => <li key={`${a.at}-${i}`} className={`act-${a.kind}`}><span className="tl-ic"><Icon name={ACT_ICON[a.kind] || 'info'} /></span><div><p>{a.text}</p><small>{ago(a.at)}</small></div></li>)}
        </ol>
      ) : <p className="dash-empty">Rien depuis le démarrage du serveur. Lectures, connexions et messages s’afficheront ici.</p>}
    </>
  );
}

// Médiathèques : affichées seulement quand l'une pose problème
function Libs({ d, alone }) {
  const bad = d.libraries.filter((l) => !l.exists || (l.network && l.network.ok === false));
  if (!bad.length && !alone) return <section className="dash-box c-libs" hidden />;
  if (!bad.length) {
    return (
      <section className="dash-box c-libs">
        <div className="dash-title"><h2>Médiathèques</h2><button className="linkish f" onClick={() => go('/reglages?onglet=medias')}>Gérer</button></div>
        <div className="dev-list">
          {d.libraries.map((l) => <div key={l.id} className="dev"><span className="dev-dot on" title="Accessible" /><div className="grow"><b>{l.name}</b><span>{`${l.items != null ? `${l.items} élément${l.items > 1 ? 's' : ''} · ` : ''}${l.network ? l.network.address : l.path}`}</span></div></div>)}
          {!d.libraries.length ? <p className="dash-empty">Aucune source pour l’instant.</p> : null}
        </div>
      </section>
    );
  }
  return (
    <section className="dash-box c-libs">
      <div className="dash-title"><h2>Médiathèques à vérifier</h2><button className="linkish f" onClick={() => go('/reglages')}>Gérer</button></div>
      <div className="dev-list">
        {bad.map((l) => <div key={l.id} className="dev"><span className="dev-dot bad" title={!l.exists ? 'Dossier introuvable' : 'Injoignable'} /><div className="grow"><b>{l.name}</b><span>{`${!l.exists ? 'Dossier introuvable' : 'Partage réseau injoignable'} · ${l.network ? l.network.address : l.path}`}</span></div></div>)}
      </div>
    </section>
  );
}
