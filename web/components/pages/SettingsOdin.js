'use client';
// Réglages → Odin (administrateur) : relier Venus à Odin (IP, port, e-mail, mot de passe jamais réaffiché), connexion
// des utilisateurs par Odin, sauvegarde continue de la base sur Odin et restauration d'une version.
// Aussi : « Restaurer depuis Odin » à la première installation (OdinRestore, utilisé par l'écran d'installation).
import { useEffect, useRef, useState } from 'react';
import { api, toast } from '../../lib/hooks';
import { Field, Actions, Busy, confirm } from './SettingsSheets';

const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round((b || 0) / 1024))} Ko`);
const MODES = [
  ['odin', 'Avec Odin ou le mot de passe du foyer'],
  ['odin-seul', 'Avec Odin seulement'],
  ['local', 'Sans Odin'],
];

// Adresse d'Odin : IP, port, « Trouver Odin sur le réseau »
function Address({ host, setHost, port, setPort, find }) {
  const [found, setFound] = useState(null);
  const search = async () => {
    setFound(null);
    try { const r = await api(find, { method: 'POST' }); setFound(r.odins); if (r.odins.length === 1) { setHost(r.odins[0].host); setPort(String(r.odins[0].port)); } }
    catch (e) { toast(e.message, true); }
  };
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 7.5em', gap: 10 }}>
        <Field label="Adresse IP d’Odin"><input className="input" value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="192.168.1.10" inputMode="decimal" autoComplete="off" spellCheck={false} /></Field>
        <Field label="Port"><input className="input" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="7777" inputMode="numeric" /></Field>
      </div>
      <Actions wrap>
        <Busy className="btn btn-ghost btn-small f" busy="Recherche sur le réseau…" onClick={search}>Trouver Odin sur le réseau</Busy>
        {found && !found.length ? <span className="muted">Aucun Odin trouvé sur ce réseau (ports 7777 et 7443). Mets son adresse IP à la main.</span> : null}
      </Actions>
      {found && found.length > 1 ? (
        <div className="backup-list">
          {found.map((o) => (
            <div key={`${o.host}:${o.port}`} className="list-row">
              <div className="grow"><b>{o.nom}</b><span>{`${o.host} · port ${o.port}`}</span></div>
              <button type="button" className="btn btn-ghost btn-small f" onClick={() => { setHost(o.host); setPort(String(o.port)); }}>Choisir</button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// Identifiants Odin (+ code de double authentification si Odin le demande)
function Account({ email, setEmail, pass, setPass, code, setCode, needCode }) {
  return (
    <>
      <Field label="E-mail de ton compte Odin" hint="Ou ton identifiant Persona."><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" spellCheck={false} /></Field>
      <Field label="Mot de passe" hint="Il sert une seule fois, pour se connecter à Odin : Venus ne le garde pas."><input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" maxLength={200} /></Field>
      {needCode ? <Field label="Code de double authentification" hint="Les 6 chiffres de ton application d’authentification."><input className="input code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></Field> : null}
    </>
  );
}

export function OdinLinkBox() {
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7777');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [test, setTest] = useState(null);
  const [vers, setVers] = useState(null);
  const [edit, setEdit] = useState(false);
  const timer = useRef(0);
  const load = async () => {
    clearTimeout(timer.current);
    try { const x = await api('/api/admin/odin/lien'); setS(x); setError(null); setHost((h) => h || x.host || ''); setPort((p) => (x.port && p === '7777' ? String(x.port) : p)); setEmail((e) => e || x.email || ''); }
    catch (e) { setError(e); }
    timer.current = setTimeout(load, 15000);
  };
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, []);

  const tester = async () => {
    setTest(null);
    const r = await api('/api/admin/odin/tester', { method: 'POST', body: { host, port } });
    setTest(r);
    if (r.ok) toast(`${r.nom} répond${r.version ? ` (version ${r.version})` : ''}`); else toast(r.error, true);
  };
  const relier = async () => {
    if (!host) { toast('Indique l’adresse IP d’Odin', true); return; }
    if (!email || !pass) { toast('Indique l’e-mail et le mot de passe de ton compte Odin', true); return; }
    const r = await api('/api/admin/odin/lien', { method: 'POST', body: { host, port, email, password: pass, code: needCode ? code : undefined } });
    if (!r.ok) { if (r.code === 'code_requis') setNeedCode(true); if (r.code === 'code_faux') setCode(''); toast(r.error, true); return; }
    setPass(''); setCode(''); setNeedCode(false); setEdit(false);
    toast('Venus est relié à Odin : la sauvegarde commence', { type: 'success' });
    load();
  };
  const delier = async () => {
    if (!(await confirm('Délier Venus d’Odin ? La sauvegarde sur Odin s’arrête et la connexion par Odin n’est plus proposée. Les sauvegardes déjà faites restent sur Odin.', 'Délier'))) return;
    setS(await api('/api/admin/odin/lien', { method: 'DELETE' })); setVers(null);
  };
  const mode = async (m) => { try { await api('/api/admin/odin/mode', { method: 'PUT', body: { mode: m } }); toast('Connexion des utilisateurs réglée'); load(); } catch (e) { toast(e.message, true); } };
  const sauver = async () => { try { const r = await api('/api/admin/odin/sauvegarde', { method: 'POST' }); toast(r.inchange ? 'Odin a déjà cette sauvegarde' : 'Sauvegarde envoyée à Odin', { type: 'success' }); load(); } catch (e) { toast(e.message, true); } };
  const versions = async () => { try { setVers((await api('/api/admin/odin/versions')).versions); } catch (e) { toast(e.message, true); } };
  const restaurer = async (v) => {
    if (!(await confirm(`Revenir à la sauvegarde du ${when(v.at)} ? Profils, listes, vus, envies et réglages reviendront à cet état (l’état actuel est d’abord gardé sur ce serveur).`, 'Restaurer'))) return;
    try {
      const r = await api(`/api/admin/odin/versions/${encodeURIComponent(v.id)}/restaurer`, { method: 'POST', body: {} });
      toast(r.restarting ? 'Sauvegarde restaurée : Venus redémarre…' : 'Sauvegarde restaurée. Redémarre Venus quand tu peux pour tout recharger.', { type: 'success', duration: 8000 });
      if (r.restarting) setTimeout(() => location.reload(), 7000); else load();
    } catch (e) { toast(e.message, true); }
  };

  if (error && !s) return <section className="box" id="odin-lien"><h2>Odin</h2><p className="error-text">{error.message}</p></section>;
  if (!s) return <section className="box" id="odin-lien"><h2>Odin</h2><p className="muted">Chargement…</p></section>;
  const b = s.sauvegarde || {};
  const showForm = !s.linked || edit;
  return (
    <>
      <section className="box" id="odin-lien">
        <h2>Odin</h2>
        <p>Relie Venus à Odin : toute la base de Venus (profils, listes, favoris, vus et reprises, téléchargements, demandes, enregistrements, réglages) est sauvegardée sur Odin en continu, et la famille se connecte avec son compte Odin. Les vidéos elles-mêmes ne partent pas.</p>
        {s.linked ? (
          <div className="list-row">
            <div className="grow">
              <b>{s.state && s.state.ok === false ? 'Relié, mais Odin refuse' : 'Relié à Odin'}</b>
              <span style={{ wordBreak: 'normal' }}>{`${s.host} · port ${s.port}${s.who && s.who.nom ? ` · compte de ${s.who.nom}` : ''}${s.pinned ? ' · certificat vérifié' : ''}`}</span>
              {s.state && s.state.ok === false && s.state.message ? <span className="error-text" style={{ display: 'block' }}>{s.state.message}</span> : null}
            </div>
            {!edit ? <button type="button" className="btn btn-ghost btn-small f" onClick={() => setEdit(true)}>Changer</button> : null}
          </div>
        ) : <div className="list-row"><div className="grow"><b>Pas relié</b><span>{s.state && s.state.message && s.state.message !== 'Pas relié' ? s.state.message : 'Donne l’adresse d’Odin et ton compte.'}</span></div></div>}
        {showForm ? (
          <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <Address host={host} setHost={setHost} port={port} setPort={setPort} find="/api/admin/odin/trouver" />
            <Account email={email} setEmail={setEmail} pass={pass} setPass={setPass} code={code} setCode={setCode} needCode={needCode} />
            {test ? <p className={test.ok ? 'muted' : 'error-text'}>{test.ok ? `${test.nom} répond à ${test.url}${test.certificat ? ` · certificat ${test.certificat}` : ''}` : test.error}</p> : null}
            <Actions wrap>
              <Busy className="btn btn-ghost btn-small f" busy="Test…" onClick={tester}>Tester</Busy>
              <Busy className="btn btn-small btn-play f" busy="Connexion à Odin…" onClick={relier}>{s.linked ? 'Relier de nouveau' : 'Relier à Odin'}</Busy>
              {edit ? <button type="button" className="btn btn-ghost btn-small f" onClick={() => { setEdit(false); setPass(''); }}>Annuler</button> : null}
            </Actions>
          </form>
        ) : (
          <Actions wrap>
            <Busy className="btn btn-ghost btn-small f" busy="Test…" onClick={async () => { await tester(); load(); }}>Tester</Busy>
            <button type="button" className="btn btn-ghost btn-small btn-del f" onClick={delier}>Délier</button>
          </Actions>
        )}
      </section>

      {s.url ? (
        <section className="box" id="odin-connexion">
          <h2>Connexion des utilisateurs</h2>
          <p>Chacun se connecte à Venus avec son compte Odin. Si Odin est déjà ouvert dans le navigateur (ou sur ce poste), c’est automatique. Qui n’a pas le droit voit le message d’Odin : les droits se règlent dans Odin (Persona → Applis).</p>
          <div className="field">
            <label htmlFor="odin-mode">On se connecte</label>
            <select id="odin-mode" className="input" defaultValue={s.mode} key={s.mode} onChange={(e) => mode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <small>{s.mode === 'odin-seul' ? 'Le mot de passe du foyer ne sert que si Odin ne répond pas. ' : ''}{`Adresse de retour à déclarer dans Odin si Venus est servi à une autre adresse : ${typeof location !== 'undefined' ? location.origin : ''}/auth/odin/retour`}</small>
          </div>
          {s.profilsLies ? <p className="muted">{`${s.profilsLies} profil${s.profilsLies > 1 ? 's' : ''} lié${s.profilsLies > 1 ? 's' : ''} à un compte Odin.`}</p> : null}
        </section>
      ) : null}

      {s.linked ? (
        <section className="box" id="odin-sauvegarde">
          <h2>Sauvegarde sur Odin</h2>
          <p>Envoyée dès qu’un changement compte (profil, favori, envie, réglage…), et vérifiée toutes les 5 minutes : si la base diffère de la dernière sauvegarde d’Odin, elle repart. Les clés et mots de passe des services partent chiffrés : Odin ne peut pas les lire, et ton mot de passe Odin les retrouve à la restauration.</p>
          <div className="list-row">
            <div className="grow">
              <b>{b.at ? `Dernière sauvegarde : ${when(b.at)}` : 'Pas encore de sauvegarde'}</b>
              <span>{[b.taille ? size(b.taille) : '', b.verifie ? `vérifiée le ${when(b.verifie)}` : '', b.envois ? `${b.envois} envoi${b.envois > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span>
              {b.erreur ? <span className="error-text" style={{ display: 'block' }}>{b.erreur}</span> : null}
              {b.restaure ? <span style={{ display: 'block' }}>{`Restaurée le ${when(b.restaure.at)} (${b.restaure.label})${b.restaure.secrets === 'mot de passe différent' || b.restaure.secrets === 'sans mot de passe' ? ' : clés des services à saisir de nouveau' : ''}`}</span> : null}
            </div>
          </div>
          <Actions wrap>
            <Busy className="btn btn-small f" busy="Envoi…" onClick={sauver}>Sauvegarder maintenant</Busy>
            <Busy className="btn btn-ghost btn-small f" busy="Chargement…" onClick={versions}>Versions gardées par Odin</Busy>
          </Actions>
          {vers ? (
            <div className="backup-list">
              {!vers.length ? <p className="muted">Odin n’a encore aucune sauvegarde de Venus.</p> : vers.slice(0, 20).map((v, i) => (
                <div key={v.id} className="list-row">
                  <div className="grow"><b>{when(v.at)}</b><span>{[size(v.taille), v.raison, v.appareil, i === 0 ? 'la plus récente' : ''].filter(Boolean).join(' · ')}</span></div>
                  {v.sorte === 'complete' ? <button type="button" className="btn btn-ghost btn-small f" onClick={() => restaurer(v)}>Restaurer</button> : <small className="muted">changements</small>}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- première installation : « Restaurer depuis Odin »
export function OdinRestore({ cancel, done }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7777');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState('');
  const [list, setList] = useState(null);
  const [who, setWho] = useState(null);
  const [busy, setBusy] = useState('');
  const connect = async (e) => {
    e.preventDefault();
    setErr('');
    if (!host) { setErr('Indique l’adresse IP d’Odin (ou « Trouver Odin sur le réseau »).'); return; }
    if (!email || !pass) { setErr('Indique l’e-mail et le mot de passe de ton compte Odin.'); return; }
    setBusy('Connexion à Odin…');
    try {
      const r = await api('/api/odin/premiere/versions', { method: 'POST', body: { host, port, email, password: pass, code: needCode ? code : undefined } });
      if (!r.ok) { if (r.code === 'code_requis') setNeedCode(true); setErr(r.error); return; }
      setList(r.versions); setWho(r.personne);
    } catch (e2) { setErr(e2.message); } finally { setBusy(''); }
  };
  const restore = async (v) => {
    setErr(''); setBusy('Restauration…');
    try {
      const r = await api('/api/odin/premiere/restaurer', { method: 'POST', body: { version: v.id, password: pass } });
      setPass('');
      const lost = r.secrets === 'mot de passe différent' || r.secrets === 'sans mot de passe';
      done(`Venus est restauré (sauvegarde du ${when(r.de)}).${lost ? ' Les clés des services (TMDB, e-mail…) sont à saisir de nouveau : elles avaient été rangées avec un autre mot de passe Odin.' : ''}${r.restarting ? ' Venus redémarre…' : ''}`, r.restarting);
    } catch (e) { setErr(e.message); setBusy(''); }
  };
  return (
    <form className="panel" onSubmit={connect} noValidate>
      <h2>Restaurer depuis Odin</h2>
      {!list ? (
        <>
          <p>Retrouve les profils, listes, favoris, vus, téléchargements et réglages de ton ancien Venus, sauvegardés sur Odin. Connecte-toi avec le compte Odin qui faisait les sauvegardes.</p>
          <Address host={host} setHost={setHost} port={port} setPort={setPort} find="/api/odin/premiere/trouver" />
          <Account email={email} setEmail={setEmail} pass={pass} setPass={setPass} code={code} setCode={setCode} needCode={needCode} />
          <p className="error-text" role="alert">{err}</p>
          <div className="form-actions">
            <button type="button" className="linkish f" onClick={cancel}>Installer sans restaurer</button>
            <button className="btn btn-play f" type="submit" disabled={!!busy}>{busy || 'Voir les sauvegardes'}</button>
          </div>
        </>
      ) : (
        <>
          <p>{`Sauvegardes de Venus gardées par Odin${who && who.nom ? ` pour ${who.nom}` : ''} :`}</p>
          {!list.length ? <p className="muted">Odin n’a aucune sauvegarde de Venus pour ce compte.</p> : (
            <div className="backup-list">
              {list.slice(0, 12).map((v, i) => (
                <div key={v.id} className="list-row">
                  <div className="grow"><b>{when(v.at)}</b><span>{[size(v.taille), v.appareil, i === 0 ? 'la plus récente' : ''].filter(Boolean).join(' · ')}</span></div>
                  <button type="button" className={`btn btn-small f${i === 0 ? ' btn-play' : ' btn-ghost'}`} disabled={!!busy} onClick={() => restore(v)}>{busy && i === 0 ? busy : 'Restaurer'}</button>
                </div>
              ))}
            </div>
          )}
          <p className="error-text" role="alert">{err}</p>
          <div className="form-actions"><button type="button" className="linkish f" onClick={cancel}>Installer sans restaurer</button></div>
        </>
      )}
    </form>
  );
}
