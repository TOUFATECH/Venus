'use client';
// Réglages : compte Trakt du profil, import depuis Plex / Jellyfin, accès hors de la maison
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { api, toast } from '../../lib/hooks';
import { Icon } from '../Icon';
import { Field, Select, Actions, Busy, Switch, Ext, confirm } from './SettingsSheets';

const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'jamais');

// ---------------------------------------------------------------- Trakt (par profil)
export function TraktLinkBox() {
  const [st, setSt] = useState(null);
  const [code, setCode] = useState(null);
  const pollT = useRef(null);
  const load = () => api('/api/trakt').then(setSt).catch(() => {});
  useEffect(() => { load(); return () => clearTimeout(pollT.current); }, []);
  if (!st) return null;
  const poll = (every) => {
    pollT.current = setTimeout(async () => {
      try {
        const r = await api('/api/trakt/link/poll', { method: 'POST' });
        if (r.linked) { setCode(null); toast('Compte Trakt relié : votre historique arrive dans Venus', { type: 'success' }); setTimeout(load, 2500); load(); return; }
        if (r.pending) { poll(r.slowDown ? every + 2 : every); return; }
        setCode(null); toast(r.denied ? 'Liaison refusée sur Trakt' : 'Le code a expiré : recommencez', true);
      } catch (e) { setCode(null); toast(e.message, true); }
    }, every * 1000);
  };
  const link = async () => {
    try { const r = await api('/api/trakt/link', { method: 'POST' }); setCode(r); poll(r.interval || 5); }
    catch (e) { toast(e.message, true); }
  };
  return (
    <section className="box" id="trakt">
      <h2>Trakt</h2>
      <p>Reliez votre compte Trakt : ce que vous regardez dans Venus est marqué « vu » sur Trakt, et votre historique Trakt (épisodes vus, lectures en cours) arrive dans Venus, puis toutes les 6 heures.</p>
      {!st.ready ? <p className="muted">L’administrateur doit d’abord ajouter le Client ID et le Client Secret Trakt (Réglages → Notes des sites).</p>
        : st.linked ? (
          <>
            <p className="tv-check-st ok">{`Relié au compte Trakt${st.user ? ` « ${st.user} »` : ''}.`}</p>
            <p className="muted">{`Dernier import : ${when(st.lastImport)}${st.imported ? ` (${st.imported.movies} film(s), ${st.imported.episodes} épisode(s), ${st.imported.resumed} lecture(s) en cours)` : ''}. Dernier envoi : ${when(st.lastPush)}.`}</p>
            <Actions wrap>
              <Busy onClick={async () => { const r = await api('/api/trakt/import', { method: 'POST' }); toast(`Importé : ${r.movies} film(s), ${r.episodes} épisode(s), ${r.resumed} lecture(s) en cours`, { type: 'success' }); load(); }}>Importer maintenant</Busy>
              <Busy className="btn btn-small btn-ghost f" onClick={async () => { if (await confirm('Délier votre compte Trakt ? Rien n’est effacé, ni dans Venus ni sur Trakt.', 'Délier')) { await api('/api/trakt/link', { method: 'DELETE' }); load(); } }}>Délier</Busy>
            </Actions>
          </>
        ) : code ? (
          <div className="trakt-code">
            <p>{'Sur votre téléphone ou ordinateur, ouvrez '}<Ext href={code.url}>{code.url.replace(/^https?:\/\//, '')}</Ext>{' et saisissez ce code :'}</p>
            <b className="trakt-code-v" aria-label={`Code ${code.code.split('').join(' ')}`}>{code.code}</b>
            <p className="muted">Venus attend la validation… (le code reste valable 10 minutes)</p>
          </div>
        ) : <Actions><button className="btn btn-small f" onClick={link}><Icon name="link" />Relier mon compte Trakt</button></Actions>}
    </section>
  );
}

// ---------------------------------------------------------------- import Plex / Jellyfin
export function ImportBox({ a }) {
  const [kind, setKind] = useState('jellyfin');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [check, setCheck] = useState(null);
  const [user, setUser] = useState('');
  const [prof, setProf] = useState(String((a.profiles || [])[0] ? a.profiles[0].id : ''));
  const [res, setRes] = useState(null);
  const profiles = a.profiles || [];
  const test = async () => {
    setCheck(null); setRes(null);
    const r = await api('/api/admin/import/check', { method: 'POST', body: { kind, url, token } });
    setCheck(r); if (r.users && r.users[0]) setUser(r.users[0].id);
    toast(`Connecté à ${r.name || r.server}`, { type: 'success' });
  };
  const go = async () => {
    const r = await api('/api/admin/import/run', { method: 'POST', body: { kind, url, token, user, profileId: Number(prof) } });
    setRes(r);
    toast(`${r.watched} vu(s) et ${r.resumed} en cours importés`, { type: 'success' });
  };
  return (
    <section className="box" id="import">
      <h2>Importer depuis Plex ou Jellyfin</h2>
      <p>Récupérez ce que vous avez déjà vu (et les lectures en cours) dans Plex, Jellyfin ou Emby, pour un profil Venus. Les fichiers sont retrouvés par leur nom, puis par leurs identifiants TMDB / IMDb. Rien n’est modifié dans Plex ou Jellyfin.</p>
      <div className="seg" role="radiogroup" aria-label="Serveur d’origine">
        {[['jellyfin', 'Jellyfin / Emby'], ['plex', 'Plex']].map(([k, l]) => <button key={k} className={`seg-b f${kind === k ? ' on' : ''}`} role="radio" aria-checked={String(kind === k)} onClick={() => { setKind(k); setCheck(null); setRes(null); }}>{l}</button>)}
      </div>
      <Field label="Adresse du serveur" hint={kind === 'plex' ? 'Par exemple http://192.168.1.126:32400' : 'Par exemple http://192.168.1.126:8097'}><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === 'plex' ? 'http://192.168.1.126:32400' : 'http://192.168.1.126:8097'} /></Field>
      <Field label={kind === 'plex' ? 'Jeton Plex (X-Plex-Token)' : 'Clé d’API'} hint={kind === 'plex'
        ? <span>Dans Plex Web, ouvrez un film → « … » → « Obtenir des infos » → « Afficher le XML » : le jeton est à la fin de l’adresse (X-Plex-Token=…). <Ext href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/">Aide Plex</Ext></span>
        : 'Jellyfin : Tableau de bord → Clés API → « + ». Emby : Paramètres → Clés API.'}>
        <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      </Field>
      <Actions><Busy onClick={test} disabled={!url || !token}>Se connecter</Busy></Actions>
      {check ? (
        <>
          <p className="tv-check-st ok">{`${check.server}${check.name ? ` · ${check.name}` : ''}`}</p>
          {kind !== 'plex' ? <Field label="Utilisateur Jellyfin dont on reprend l’historique"><Select opts={check.users.map((u) => [u.id, u.name])} value={user} onChange={(e) => setUser(e.target.value)} /></Field>
            : <p className="muted">Plex : c’est l’historique du compte à qui appartient le jeton.</p>}
          <Field label="Profil Venus qui reçoit l’historique"><Select opts={profiles.map((p) => [String(p.id), p.name])} value={prof} onChange={(e) => setProf(e.target.value)} /></Field>
          <Actions><Busy onClick={go} busy="Import en cours…">Importer</Busy></Actions>
        </>
      ) : null}
      {res ? (
        <div className="import-res">
          <p><b>{`${res.watched} vu(s)`}</b>{` et `}<b>{`${res.resumed} lecture(s) en cours`}</b>{` importés sur ${res.total} trouvés${res.already ? ` (${res.already} déjà à jour)` : ''}.`}</p>
          {res.notFound ? <details><summary>{`${res.notFound} absent(s) de Venus`}</summary><ul>{res.missing.map((m) => <li key={m}>{m}</li>)}</ul>{res.notFound > res.missing.length ? <p className="muted">…</p> : null}</details> : null}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- accès hors de la maison
export function RemoteBox() {
  const [st, setSt] = useState(null);
  const [token, setToken] = useState('');
  const load = () => api('/api/admin/remote').then(setSt).catch((e) => toast(e.message, true));
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  if (!st) return <section className="box"><p className="muted">Chargement…</p></section>;
  const start = async (mode) => {
    if (mode === 'quick' && !(await confirm('Créer un lien public vers Venus ? Toute personne qui a le lien voit la page de connexion : gardez des mots de passe solides (et la double vérification).', 'Créer le lien'))) return;
    const r = await api('/api/admin/remote', { method: 'POST', body: { mode, token: mode === 'token' ? token : undefined } });
    setSt(r); setToken('');
    if (r.error) toast(r.error, true); else if (mode !== 'off') toast(r.url ? 'Lien créé' : 'Tunnel lancé', { type: 'success' });
  };
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast('Adresse copiée')).catch(() => {});
  return (
    <>
      <section className="box" id="distance">
        <h2>Regarder hors de la maison</h2>
        <p>Sans ouvrir de port sur votre box. Les profils réglés « seulement à la maison » restent bloqués à l’extérieur.</p>
        {st.viaTunnel ? <p className="tv-check-st ok">Vous êtes en ce moment connecté par le tunnel Cloudflare.</p> : null}
        {st.viaTailscale ? <p className="tv-check-st ok">Vous êtes en ce moment connecté par Tailscale.</p> : null}
        <div className="remote-state">
          <b>{st.mode === 'off' ? 'Désactivé' : st.running ? (st.url || st.connected ? 'En ligne' : 'Connexion…') : 'Arrêté'}</b>
          {st.url ? <span><a href={st.url} target="_blank" rel="noopener">{st.url}</a> <button className="btn btn-small btn-ghost f" onClick={() => copy(st.url)}><Icon name="copy" />Copier</button></span> : null}
          {st.error ? <span className="error-text">{st.error}</span> : null}
        </div>
        <h3 className="box-sub">Lien rapide (gratuit, sans compte)</h3>
        <p className="muted">Une adresse https://….trycloudflare.com, idéale pour essayer ou pour un voyage. Elle change à chaque redémarrage de Venus.</p>
        <Actions wrap>
          <Busy onClick={() => start('quick')} busy="Création du lien…">{st.mode === 'quick' ? 'Nouveau lien' : 'Créer un lien rapide'}</Busy>
          {st.mode !== 'off' ? <Busy className="btn btn-small btn-ghost f" onClick={() => start('off')}>Couper l’accès</Busy> : null}
        </Actions>
        <h3 className="box-sub">Mon tunnel Cloudflare (adresse fixe)</h3>
        <p className="muted">Avec un compte Cloudflare gratuit et votre nom de domaine : <Ext href="https://one.dash.cloudflare.com/">Zero Trust</Ext> → Réseaux → Tunnels → Créer un tunnel (cloudflared) → copiez le jeton (la longue suite après « --token »). Dans « Nom d’hôte public », indiquez le service <code>http://localhost:{typeof location !== 'undefined' ? location.port || '8096' : '8096'}</code>.</p>
        <Field label="Jeton du tunnel" hint={st.hasToken ? 'Un jeton est enregistré (laisser vide pour le garder).' : null}><input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhIjoi…" /></Field>
        <Actions><Busy onClick={() => start('token')} disabled={!token && !st.hasToken}>Lancer mon tunnel</Busy></Actions>
        {st.log && st.log.length ? <details><summary>Journal du tunnel</summary><pre className="log">{st.log.join('\n')}</pre></details> : null}
      </section>
      <section className="box">
        <h2>Tailscale (réseau privé, le plus sûr)</h2>
        <p>Vos appareils se retrouvent comme à la maison, où qu’ils soient, et Venus n’est visible de personne d’autre.</p>
        <ol className="steps-list">
          <li>Créez un compte gratuit sur <Ext href="https://tailscale.com/download">tailscale.com</Ext>.</li>
          <li>Installez Tailscale sur la machine où tourne Venus : sur Linux, <code>curl -fsSL https://tailscale.com/install.sh | sh</code> puis <code>sudo tailscale up</code> ; sur un NAS Synology ou QNAP, depuis le centre de paquets.</li>
          <li>Installez l’application Tailscale sur votre téléphone ou ordinateur, avec le même compte.</li>
          <li>Ouvrez Venus avec l’adresse Tailscale de la machine (100.x.y.z, visible dans l’application) : <code>http://100.x.y.z:{typeof location !== 'undefined' ? location.port || '8096' : '8096'}</code>.</li>
        </ol>
      </section>
    </>
  );
}
