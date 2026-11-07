'use client';
// Assistant « Ajouter une source » : dossier du serveur, partage réseau (NAS, PC) ou IPTV (M3U, Xtream)
import { useEffect, useRef, useState } from 'react';
import { api, toast, openSheet } from '../../lib/hooks';
import { Icon } from '../Icon';

const TYPES = [['movies', 'Films'], ['shows', 'Séries'], ['anime', 'Animés'], ['clips', 'Clips'], ['music', 'Musique'], ['photos', 'Photos'], ['books', 'Livres'], ['iptv', 'TV en direct (IPTV)']];
const NAMES = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct', music: 'Musique', photos: 'Photos', books: 'Livres' };
// Chemins Windows (C:\Films) ou Linux / macOS (/media/films)
const joinPath = (base, name) => (base.includes('\\') ? `${base.replace(/\\$/, '')}\\${name}` : `${base.replace(/\/$/, '')}/${name}`);
const Field = ({ label, id, hint, children }) => <div className="field"><label htmlFor={id}>{label}</label>{children}{hint ? <small>{hint}</small> : null}</div>;
const Spin = ({ children }) => <p className="net-searching"><span className="mini-spin" />{children}</p>;

export function openSourceWizard(preset = 'movies', onDone) {
  openSheet('Ajouter une source', (close) => <Wizard preset={preset} close={close} onDone={onDone} />);
}

function Wizard({ preset, close, onDone }) {
  const [type, setType] = useState(preset);
  const [step, setStep] = useState({ id: 'start' });
  const go1 = (id, data = {}) => setStep({ id, ...data });
  // Ajout de la source ; renvoie un message d'erreur, ou rien si c'est fait
  const finish = async (payload) => {
    try {
      await api('/api/admin/libraries', { method: 'POST', body: { type, ...payload } });
      close();
      toast(type === 'iptv' ? 'Liste ajoutée, chargement des chaînes' : 'Source ajoutée, Venus analyse vos vidéos');
      onDone && onDone();
      return null;
    } catch (e) { return e.message; }
  };
  const ctx = { type, finish, go: go1 };
  const views = { start: Start, local: Local, network: Network, login: Login, share: ConfirmShare, xtream: Xtream, m3u: M3u, file: FileStep };
  const View = views[step.id];
  return (
    <div className="wizard">
      <div className="chips wiz-types" role="group" aria-label="Type de contenu">
        {TYPES.map(([t, l]) => <button key={t} type="button" className={`chip f${t === type ? ' on' : ''}`} onClick={() => { setType(t); go1('start'); }}>{l}</button>)}
      </div>
      <View ctx={ctx} {...step} />
    </div>
  );
}

const Back = ({ onClick }) => <button type="button" className="row-link f wiz-back" onClick={onClick}><Icon name="back" />Retour</button>;

// Bouton d'envoi qui montre l'attente et l'erreur
function useSubmit(ctx, busyLabel = 'Ajout…') {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (payload) => { setErr(''); setBusy(true); const e = await ctx.finish(payload); if (e) { setErr(e); setBusy(false); } };
  return { busy, err, setErr, run, label: (l) => (busy ? busyLabel : l) };
}

function Start({ ctx }) {
  const iptv = ctx.type === 'iptv';
  const box = useRef(null);
  useEffect(() => { requestAnimationFrame(() => box.current && box.current.querySelector('.wiz-choice')?.focus()); }, [ctx.type]);
  const opts = iptv ? [
    ['xtream', 'Identifiants Xtream', 'Serveur, identifiant et mot de passe fournis par votre abonnement', 'live'],
    ['m3u', 'Adresse M3U', 'Un lien http… qui se termine souvent par .m3u ou m3u_plus', 'tv'],
    ['file', 'Fichier sur le serveur', 'Une liste .m3u déjà copiée sur ce serveur', 'folder'],
  ] : [
    ['network', 'Partage réseau', 'Un NAS, un PC Windows, une box ou un disque réseau', 'wifi'],
    ['local', 'Dossier de ce serveur', 'Un disque interne, un disque USB, un dossier déjà monté', 'folder'],
  ];
  return (
    <div ref={box}>
      <h3 className="wiz-q">{iptv ? 'Comment accéder à vos chaînes ?' : `Où sont rangés vos ${NAMES[ctx.type].toLowerCase()} ?`}</h3>
      <div className="wiz-choices">{opts.map(([id, label, sub, ic]) => <button key={id} type="button" className="wiz-choice f" onClick={() => ctx.go(id)}><Icon name={ic} /><b>{label}</b><small>{sub}</small></button>)}</div>
    </div>
  );
}

function Local({ ctx }) {
  const [name, setName] = useState(NAMES[ctx.type]);
  const picker = useRef(null);
  const s = useSubmit(ctx);
  return (
    <>
      <Back onClick={() => ctx.go('start')} />
      <form onSubmit={(e) => { e.preventDefault(); const p = picker.current.value(); if (!p) { s.setErr('Choisissez un dossier.'); return; } s.run({ name, path: p }); }}>
        <h3 className="wiz-q">{`Choisissez le dossier de vos ${NAMES[ctx.type].toLowerCase()}`}</h3>
        <PathPicker apiRef={picker} onError={s.setErr} />
        <Field label="Nom affiché" id="src-name"><input className="input" id="src-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="error-text">{s.err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={s.busy}>{s.label('Ajouter ce dossier')}</button></div>
      </form>
    </>
  );
}

// Partage réseau : 1. l'appareil
function Network({ ctx }) {
  const [hosts, setHosts] = useState(null);
  const [err, setErr] = useState('');
  const [advice, setAdvice] = useState(null);
  const [host, setHost] = useState('');
  const [proto, setProto] = useState('smb');
  const scan = (force) => { setHosts(null); api(`/api/admin/network/discover${force ? '?force=1' : ''}`).then(setHosts).catch((e) => setErr(e.message)); };
  useEffect(() => { scan(false); api('/api/admin/network/capability').then((c) => setAdvice(c.advice || null)).catch(() => {}); }, []);
  return (
    <>
      <Back onClick={() => ctx.go('start')} />
      {advice ? (
        <div className="advice" role="note">
          <div className="advice-head"><Icon name="info" /><b>{advice.title}</b></div><p>{advice.text}</p>
          {advice.command ? <div className="advice-cmd"><code>{advice.command}</code></div> : null}
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button type="button" className="btn btn-small f" onClick={() => ctx.go('local')}><Icon name="folder" />Choisir un dossier déjà monté</button></div>
        </div>
      ) : null}
      <h3 className="wiz-q">Choisissez l’appareil qui contient vos vidéos</h3>
      <div className="net-hosts" aria-live="polite">
        {err ? <p className="error-text">{err}</p> : !hosts ? <Spin>Recherche des appareils sur votre réseau…</Spin> : !hosts.length ? (
          <><p className="muted">Aucun appareil de partage trouvé automatiquement. Saisissez son adresse ci-dessous.</p><button type="button" className="row-link f" onClick={() => scan(true)}>Chercher à nouveau</button></>
        ) : (
          <>
            {hosts.map((x) => (
              <button key={x.ip} type="button" className="net-host f" onClick={() => ctx.go('login', { dev: { host: x.ip, name: x.name, proto: x.smb ? 'smb' : 'nfs', both: x.smb && x.nfs } })}>
                <Icon name="server" /><span><b>{x.name || x.ip}</b><small>{x.name ? x.ip : 'Appareil du réseau'}</small></span>
                <span className="net-tags">{x.smb ? <span>SMB</span> : null}{x.nfs ? <span>NFS</span> : null}</span>
              </button>
            ))}
            <button type="button" className="row-link f" onClick={() => scan(true)}>Actualiser</button>
          </>
        )}
      </div>
      <details className="wiz-manual">
        <summary>Saisir l’adresse à la main</summary>
        <form onSubmit={(e) => { e.preventDefault(); if (host.trim()) ctx.go('login', { dev: { host: host.trim(), proto } }); }}>
          <div className="two-cols wide">
            <Field label="Adresse de l’appareil" id="net-host"><input className="input" id="net-host" placeholder="192.168.1.20 ou nas.local" autoComplete="off" value={host} onChange={(e) => setHost(e.target.value)} /></Field>
            <Field label="Type de partage" id="net-proto"><select className="input" id="net-proto" value={proto} onChange={(e) => setProto(e.target.value)}><option value="smb">SMB (Windows, la plupart des NAS)</option><option value="nfs">NFS (Linux, certains NAS)</option></select></Field>
          </div>
          <div className="form-actions"><button className="btn f" type="submit">Continuer</button></div>
        </form>
      </details>
    </>
  );
}

// 2. identifiants et choix du partage
function Login({ ctx, dev }) {
  const [proto, setProto] = useState(dev.proto);
  const [user, setUser] = useState(dev.user || '');
  const [pass, setPass] = useState(dev.pass || '');
  const [share, setShare] = useState('');
  const [shares, setShares] = useState(null); // null : rien ; 'loading' ; liste
  const [err, setErr] = useState('');
  const userIn = useRef(null);
  const list = async (p = proto) => {
    setErr(''); setShares('loading');
    try { setShares(await api('/api/admin/network/shares', { method: 'POST', body: { proto: p, host: dev.host, user: user.trim(), pass } })); }
    catch (e) { setShares(null); setErr(e.message); }
  };
  useEffect(() => { setTimeout(() => { if (proto === 'nfs') list(); else userIn.current && userIn.current.focus(); }, 30); }, []);
  const choose = (s) => ctx.go('share', { r: { ...dev, proto, user: proto === 'nfs' ? '' : user.trim(), pass: proto === 'nfs' ? '' : pass, share: s } });
  return (
    <>
      <Back onClick={() => ctx.go('network')} />
      <h3 className="wiz-q">{dev.name || dev.host}</h3>
      {dev.both ? <div className="chips">{['smb', 'nfs'].map((p) => <button key={p} type="button" className={`chip f${p === proto ? ' on' : ''}`} onClick={() => { setProto(p); setShares(null); }}>{p.toUpperCase()}</button>)}</div> : null}
      <form onSubmit={(e) => { e.preventDefault(); list(); }}>
        {proto === 'nfs' ? null : (
          <div className="two-cols wide">
            <Field label="Identifiant" id="net-user"><input ref={userIn} className="input" id="net-user" autoComplete="username" placeholder="Laissez vide pour un accès invité" value={user} onChange={(e) => setUser(e.target.value)} /></Field>
            <Field label="Mot de passe" id="net-pass"><input className="input" id="net-pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
          </div>
        )}
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-play f" type="submit">Voir les partages</button></div>
      </form>
      <div className="net-shares">
        {shares === 'loading' ? <Spin>Lecture des partages…</Spin> : Array.isArray(shares) ? (shares.length
          ? shares.map((x) => <button key={x.name} type="button" className="net-share f" onClick={() => choose(x.name)}><Icon name="folder" /><span><b>{x.name}</b>{x.comment ? <small>{x.comment}</small> : null}</span></button>)
          : <p className="muted">Aucun partage visible. Saisissez son nom ci-dessous.</p>) : null}
      </div>
      <p className="error-text">{err}</p>
      <form className="wiz-inline" onSubmit={(e) => { e.preventDefault(); if (share.trim()) choose(share.trim()); }}>
        <Field label="Ou nom du partage" id="net-share"><input className="input" id="net-share" placeholder={proto === 'nfs' ? '/volume1/video' : 'Videos'} autoComplete="off" value={share} onChange={(e) => setShare(e.target.value)} /></Field>
        <button className="btn f" type="submit">Utiliser ce partage</button>
      </form>
    </>
  );
}

// 3. sous-dossier, écriture, nom
function ConfirmShare({ ctx, r }) {
  const [sub, setSub] = useState('');
  const [name, setName] = useState(NAMES[ctx.type]);
  const [rw, setRw] = useState(false);
  const s = useSubmit(ctx, 'Connexion au partage…');
  const subIn = useRef(null);
  useEffect(() => { setTimeout(() => subIn.current && subIn.current.focus(), 30); }, []);
  const addr = r.proto === 'nfs' ? `${r.host}:${r.share}` : `\\\\${r.host}\\${r.share}`;
  return (
    <>
      <Back onClick={() => ctx.go('login', { dev: r })} />
      <div className="net-summary"><Icon name="wifi" /><span><b>{addr}</b><small>{r.user ? `Connexion en tant que ${r.user}` : 'Accès invité'}</small></span></div>
      <form onSubmit={(e) => { e.preventDefault(); s.run({ name, remote: { proto: r.proto, host: r.host, share: r.share, sub: sub.trim(), user: r.user, pass: r.pass, writable: rw } }); }}>
        <Field label="Sous-dossier" id="net-sub" hint={`Si vos ${NAMES[ctx.type].toLowerCase()} sont rangés dans un dossier précis du partage.`}><input ref={subIn} className="input" id="net-sub" placeholder="Ex. : Films/HD (laisser vide pour tout le partage)" autoComplete="off" value={sub} onChange={(e) => setSub(e.target.value)} /></Field>
        <Field label="Nom affiché" id="net-name"><input className="input" id="net-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <label className="switch"><span>Autoriser l’envoi de vidéos depuis l’application<small className="muted" style={{ display: 'block' }}>Sinon, Venus lit seulement le partage.</small></span><input type="checkbox" id="net-rw" className="f" checked={rw} onChange={(e) => setRw(e.target.checked)} /></label>
        <p className="error-text">{s.err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={s.busy}>{s.label('Ajouter ce partage')}</button></div>
      </form>
    </>
  );
}

function Xtream({ ctx }) {
  const [v, setV] = useState({ server: '', user: '', pass: '', name: NAMES.iptv });
  const s = useSubmit(ctx);
  const first = useRef(null);
  useEffect(() => { setTimeout(() => first.current && first.current.focus(), 30); }, []);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <>
      <Back onClick={() => ctx.go('start')} />
      <form onSubmit={(e) => { e.preventDefault(); s.run({ name: v.name, xtream: { server: v.server.trim(), user: v.user.trim(), pass: v.pass } }); }}>
        <Field label="Adresse du serveur" id="xt-server" hint="Elle figure dans l’e-mail de votre abonnement IPTV, souvent avec un numéro de port."><input ref={first} className="input" id="xt-server" placeholder="http://exemple-iptv.com:8080" autoComplete="off" inputMode="url" value={v.server} onChange={set('server')} /></Field>
        <div className="two-cols wide">
          <Field label="Identifiant" id="xt-user"><input className="input" id="xt-user" autoComplete="off" value={v.user} onChange={set('user')} /></Field>
          <Field label="Mot de passe" id="xt-pass"><input className="input" id="xt-pass" type="password" autoComplete="off" value={v.pass} onChange={set('pass')} /></Field>
        </div>
        <Field label="Nom affiché" id="xt-name"><input className="input" id="xt-name" value={v.name} onChange={set('name')} /></Field>
        <p className="error-text">{s.err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={s.busy}>{s.label('Ajouter mes chaînes')}</button></div>
      </form>
    </>
  );
}

function M3u({ ctx }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState(NAMES.iptv);
  const s = useSubmit(ctx);
  const first = useRef(null);
  useEffect(() => { setTimeout(() => first.current && first.current.focus(), 30); }, []);
  return (
    <>
      <Back onClick={() => ctx.go('start')} />
      <form onSubmit={(e) => { e.preventDefault(); s.run({ name, path: url.trim() }); }}>
        <Field label="Adresse de la liste M3U" id="m3u-url"><input ref={first} className="input" id="m3u-url" placeholder="http://mon-fournisseur/get.php?…&type=m3u_plus" autoComplete="off" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <Field label="Nom affiché" id="m3u-name"><input className="input" id="m3u-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="error-text">{s.err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={s.busy}>{s.label('Ajouter la liste')}</button></div>
      </form>
    </>
  );
}

function FileStep({ ctx }) {
  const [name, setName] = useState(NAMES.iptv);
  const picker = useRef(null);
  const s = useSubmit(ctx);
  return (
    <>
      <Back onClick={() => ctx.go('start')} />
      <form onSubmit={(e) => { e.preventDefault(); const f = picker.current.file(); if (!f) { s.setErr('Choisissez un fichier .m3u dans la liste.'); return; } s.run({ name, path: f }); }}>
        <h3 className="wiz-q">Choisissez le fichier .m3u</h3>
        <PathPicker apiRef={picker} files={['m3u', 'm3u8']} onError={s.setErr} />
        <Field label="Nom affiché" id="m3u-fname"><input className="input" id="m3u-fname" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="error-text">{s.err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={s.busy}>{s.label('Ajouter la liste')}</button></div>
      </form>
    </>
  );
}

// Explorateur de dossiers du serveur : fil d'Ariane cliquable, dossiers (et fichiers si demandés)
function PathPicker({ apiRef, files = null, onError }) {
  const [r, setR] = useState(null);
  const [picked, setPicked] = useState('');
  const [manual, setManual] = useState('');
  const list = useRef(null);
  const current = r ? (r.absolute && r.path === '/' ? '' : r.path) : '';
  apiRef.current = { value: () => current, file: () => picked };
  const open = async (p) => {
    try {
      const x = await api(`/api/admin/fs?path=${encodeURIComponent(p)}${files ? `&files=${files.join(',')}` : ''}`);
      setR(x); setManual(x.absolute && x.path === '/' ? '' : x.path);
      if (list.current) list.current.scrollTop = 0;
    } catch (e) { if (p !== '/') open('/'); else onError && onError(e.message); }
  };
  useEffect(() => { open('start'); }, []);
  const crumbs = [];
  if (r) {
    if (r.path === '/' || !r.path) crumbs.push(['/', r.absolute ? 'Ce PC' : 'Racine']);
    else {
      const sp = r.path.includes('\\') ? '\\' : '/';
      let acc = '';
      crumbs.push(['/', sp === '/' ? 'Racine' : 'Ce PC']);
      r.path.split(sp).filter(Boolean).forEach((b, i) => { acc = sp === '/' ? `${acc}/${b}` : (i === 0 ? `${b}\\` : `${acc.replace(/\\$/, '')}\\${b}`); crumbs.push([acc, b]); });
    }
  }
  return (
    <div className="path-picker">
      <div className="pp-crumbs">
        {crumbs.map(([p, label], i) => [i ? <span key={`s${i}`} className="sep" aria-hidden="true">›</span> : null, <button key={p} type="button" className={`crumb f${i === crumbs.length - 1 ? ' on' : ''}`} onClick={() => open(p)}>{label}</button>])}
      </div>
      <div className="folder-list" role="listbox" ref={list}>
        {r ? (
          <>
            {r.path !== '/' ? <button type="button" className="f" onClick={() => open(r.parent)}><Icon name="back" />..</button> : null}
            {r.dirs.map((d) => <button key={`d${d}`} type="button" className="f" onClick={() => open(r.absolute ? d : joinPath(r.path, d))}><Icon name="folder" /><span>{d}</span></button>)}
            {(r.files || []).map((f) => { const full = joinPath(r.path, f); return <button key={`f${f}`} type="button" className={`f file${full === picked ? ' is-picked' : ''}`} onClick={() => setPicked(full)}><Icon name="tv" /><span>{f}</span></button>; })}
            {!r.dirs.length && !(r.files || []).length ? <p className="muted folder-empty">{files ? 'Aucun sous-dossier ni fichier .m3u ici.' : 'Aucun sous-dossier : ce dossier peut être choisi.'}</p> : null}
          </>
        ) : null}
      </div>
      {files ? (picked ? <div className="picked"><Icon name="check" /><span>{picked}</span></div> : null) : <p className="picker-hint">Entrez dans le dossier voulu : c’est le dossier affiché en haut qui sera ajouté.</p>}
      <details className="wiz-manual">
        <summary>Saisir le chemin à la main</summary>
        <input className="input" placeholder="ou saisissez un chemin, puis Entrée" autoComplete="off" spellCheck={false} value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open(manual.trim() || '/'); } }} />
      </details>
    </div>
  );
}
