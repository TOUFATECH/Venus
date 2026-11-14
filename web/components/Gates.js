'use client';
// Écrans d'entrée : première installation, connexion d'un appareil, « Qui regarde ? », lien d'invitation
import { useEffect, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import { api, openSheet } from '../lib/hooks';
import { Icon, Brand, Avatar } from './Icon';
import { PasswordMeter } from './pages/SettingsSheets';
import { OdinRestore } from './pages/SettingsOdin';

// Odin : après une déconnexion voulue, pas de reconnexion automatique dans cet onglet
export const noOdinAuto = () => { try { sessionStorage.setItem('vn_odin_essai', '1'); } catch { /* */ } };

export default function Gate({ kind, done }) {
  useEffect(() => { shared().app.hideBoot(); }, []);
  const View = { setup: Setup, login: Login, profiles: Profiles, invitation: Invitation }[kind];
  return <main><div className="center-screen">{View ? <View done={done} /> : null}</div></main>;
}

const Field = ({ label, id, hint, children }) => <div className="field"><label htmlFor={id}>{label}</label>{children}{hint ? <small>{hint}</small> : null}</div>;
// Saisie d'un code à 6 chiffres affiché « 123 456 », envoyé tout seul une fois complet
const fmtCode = (v) => { const d = v.replace(/\D/g, '').slice(0, 6); return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d; };
const digits = (v) => v.replace(/\D/g, '');
const shake = (el) => { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };

// ---------------------------------------------------------------- première installation
function Setup({ done }) {
  const [odin, setOdin] = useState(null); // « Restaurer depuis Odin » proposé tant que la base est vide
  const [restore, setRestore] = useState(false);
  const [restored, setRestored] = useState('');
  useEffect(() => { api('/api/odin/connexion').then(setOdin).catch(() => {}); }, []);
  if (restored) return <div className="panel"><Brand /><h2>Restauration faite</h2><p>{restored}</p><div className="form-actions"><button className="btn btn-play f" onClick={() => done(null)}>Continuer</button></div></div>;
  if (restore) return <OdinRestore cancel={() => setRestore(false)} done={(msg, restarting) => { setRestored(msg); if (restarting) setTimeout(() => location.reload(), 8000); }} />;
  return <SetupForm done={done} offerOdin={!!(odin && odin.restaurer)} onRestore={() => setRestore(true)} />;
}
function SetupForm({ done, offerOdin, onRestore }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const f = useRef(null);
  useEffect(() => { setTimeout(() => f.current && f.current.elements.name.focus(), 50); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const el = f.current.elements;
    setErr('');
    if (!el.name.value.trim()) { setErr('Indiquez votre prénom.'); return; }
    const weak = shared().ui.passwordProblem(pass);
    if (weak) { setErr(`Mot de passe du foyer : ${weak.toLowerCase()}.`); el.pass.focus(); return; }
    if (!/^\d{4}$/.test(el.pin.value)) { setErr('Le code PIN de l’administrateur est obligatoire : 4 chiffres.'); el.pin.focus(); return; }
    setBusy(true);
    try {
      const r = await api('/api/setup', { method: 'POST', body: {
        name: el.name.value.trim(), password: pass, pin: el.pin.value || null,
        moviesPath: el.movies.value.trim(), showsPath: el.shows.value.trim(), tmdbKey: el.tmdb.value.trim() || null,
      } });
      shared().api.auth.token = r.token;
      done(await api('/api/me'));
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <form ref={f} className="panel" onSubmit={submit} noValidate>
      <Brand />
      <h2>Bienvenue dans Venus</h2>
      <p>Votre cinéma à la maison. Quelques réglages et c’est prêt.</p>
      {offerOdin ? <div className="login-msg" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><span>Tu avais déjà Venus, sauvegardé sur Odin ?</span><button type="button" className="btn btn-small f" onClick={onRestore}>Restaurer depuis Odin</button></div> : null}
      <Field label="Votre prénom" id="name" hint="Ce sera le profil administrateur."><input id="name" name="name" className="input" required maxLength={30} autoComplete="nickname" placeholder="Ex. : Sarah" /></Field>
      <Field label="Mot de passe du foyer" id="pass" hint="Demandé une seule fois par appareil (TV, téléphone…)."><input id="pass" name="pass" className="input" type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
      <PasswordMeter value={pass} />
      <Field label="Code PIN de votre profil" id="pin" hint="Obligatoire pour l’administrateur : 4 chiffres, pour que personne d’autre n’ouvre votre profil."><input id="pin" name="pin" className="input" inputMode="numeric" required pattern="\d{4}" minLength={4} maxLength={4} autoComplete="off" placeholder="4 chiffres" /></Field>
      <Field label="Dossier des films" id="movies"><input id="movies" name="movies" className="input" defaultValue="/media/films" /></Field>
      <Field label="Dossier des séries" id="shows" hint="Chemins vus par le serveur. Avec Docker, gardez ceux-ci."><input id="shows" name="shows" className="input" defaultValue="/media/series" /></Field>
      <Field label="Clé API TMDB" id="tmdb" hint={<span>Pour les affiches et résumés en français. Gratuite sur <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>themoviedb.org</a>.</span>}>
        <input id="tmdb" name="tmdb" className="input" placeholder="Facultatif, ajoutable plus tard" />
      </Field>
      <p className="error-text" role="alert">{err}</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={busy}>{busy ? 'Installation…' : 'Terminer l’installation'}</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- connexion d'un appareil
// Mot de passe du foyer, ou code à 6 chiffres donné par l'administrateur (il change à chaque connexion) ;
// double authentification : code reçu par e-mail
function Login({ done }) {
  const [mode, setMode] = useState(() => (new URLSearchParams(location.search || '').has('code') ? 'code' : 'password'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [mail, setMail] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [mailInfo, setMailInfo] = useState('');
  const [wait, setWait] = useState(0); // secondes avant de pouvoir renvoyer le code
  const form = useRef(null);
  const inputs = { password: useRef(null), code: useRef(null), email: useRef(null) };
  const msg = shared().app.state.status && shared().app.state.status.loginMessage;
  // Connexion par Odin : session du poste, puis session Odin du navigateur (sans écran), sinon le bouton
  const [odin, setOdin] = useState(null);
  const [odinErr, setOdinErr] = useState(() => (typeof window !== 'undefined' && window.__vnOdinError) || '');
  useEffect(() => {
    let tried = false;
    try { tried = !!sessionStorage.getItem('vn_odin_essai'); } catch { /* */ }
    api('/api/odin/connexion').then(async (o) => {
      setOdin(o);
      if (!o.sso || tried || window.__vnOdinError) return;
      noOdinAuto();
      if (o.poste) {
        try { const r = await api('/api/odin/poste', { method: 'POST' }); shared().api.auth.token = r.token; done(null); return; }
        catch (e) { setOdinErr(e.message); return; }
      }
      location.href = '/auth/odin/debut?silencieux=1';
    }).catch(() => {});
  }, []);
  const local = !odin || odin.local;
  useEffect(() => { setErr(''); setTimeout(() => inputs[mode].current && inputs[mode].current.focus(), 30); }, [mode]);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((s) => s - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy) return;
    const problem = mode === 'password' && !pass ? 'Entrez le mot de passe'
      : mode === 'code' && !/^\d{6}$/.test(digits(code)) ? 'Le code fait 6 chiffres'
        : mode === 'email' && !/^\d{6}$/.test(digits(mail)) ? 'Le code reçu par e-mail fait 6 chiffres' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try {
      const r = mode === 'password' ? await api('/api/login', { method: 'POST', body: { password: pass } })
        : mode === 'email' ? await api('/api/login/verify', { method: 'POST', body: { challenge: challenge.challenge, code: digits(mail) } })
          : await api('/api/login/code', { method: 'POST', body: { code: digits(code) } });
      if (r.twofa) {
        setChallenge(r); setPass(''); setBusy(false);
        setMailInfo(`Envoyé à ${r.email}. Il est valable 10 minutes.`);
        setMode('email'); setWait(60);
        return;
      }
      shared().api.auth.token = r.token;
      done(null);
    } catch (e2) {
      setErr(e2.message); setBusy(false);
      shake(form.current);
      inputs[mode].current && inputs[mode].current.select();
      if (mode === 'email' && /expiré|Trop d’essais|reconnectez/.test(e2.message)) setTimeout(() => setMode('password'), 1800);
    }
  };
  // Code complet : envoi automatique (après la mise à jour de l'affichage)
  const autoSend = useRef(false);
  useEffect(() => { if (autoSend.current) { autoSend.current = false; submit(); } }, [code, mail]);
  const onCode = (set) => (e) => { const v = fmtCode(e.target.value); set(v); if (digits(v).length === 6) autoSend.current = true; };
  const resend = async () => {
    if (wait > 0) return;
    try { const r = await api('/api/login/resend', { method: 'POST', body: { challenge: challenge.challenge } }); setChallenge(r); setWait(60); setErr(''); setMailInfo(`Nouveau code envoyé à ${r.email}. Il est valable 10 minutes.`); }
    catch (e) { setErr(e.message); }
  };
  return (
    <form ref={form} className="panel" onSubmit={submit}>
      <Brand />
      {msg ? <p className="login-msg">{msg}</p> : null}
      <h2>Connecter cet appareil</h2>
      {odin && odin.sso ? (
        <div className="odin-login" style={{ display: 'grid', gap: 8, margin: '6px 0 14px' }}>
          <a className="btn btn-play f" href="/auth/odin/debut" style={{ justifyContent: 'center' }}>Se connecter avec Odin</a>
          {odinErr ? <p className="error-text" role="alert" style={{ margin: 0 }}>{odinErr}</p> : <small className="muted" style={{ textAlign: 'center' }}>Avec ton compte Odin : si Odin est déjà ouvert, c’est automatique.</small>}
          {local ? <small className="muted" style={{ textAlign: 'center' }}>Ou, sans Odin :</small> : null}
        </div>
      ) : null}
      {!local ? <p className="muted">{odin.localMessage}</p> : null}
      <div hidden={!local}>
      <p>{mode === 'password' ? 'Entrez le mot de passe du foyer. Cet appareil s’en souviendra.' : mode === 'email' ? 'Double authentification : un code vient d’être envoyé par e-mail à l’administrateur.' : 'Entrez le code à 6 chiffres affiché dans le tableau de bord de l’administrateur.'}</p>
      <div className="field" hidden={mode !== 'password'}>
        <label htmlFor="pass">Mot de passe</label>
        <input ref={inputs.password} id="pass" className="input" type="password" autoComplete="current-password" maxLength={200} value={pass} onChange={(e) => setPass(e.target.value)} />
      </div>
      <div className="field" hidden={mode !== 'code'}>
        <label htmlFor="login-code">Code à 6 chiffres</label>
        <input ref={inputs.code} id="login-code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-label="Code à 6 chiffres" value={code} onChange={onCode(setCode)} />
        <small className="muted">Sur un appareil déjà connecté, l’administrateur ouvre « Tableau de bord » : le code y est affiché. Il change après chaque connexion.</small>
      </div>
      <div className="field" hidden={mode !== 'email'}>
        <label htmlFor="mail-code">Code reçu par e-mail</label>
        <input ref={inputs.email} id="mail-code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-label="Code reçu par e-mail" value={mail} onChange={onCode(setMail)} />
        <small className="muted">{mailInfo}</small>
        <button className="linkish f" type="button" disabled={wait > 0} onClick={resend}>{wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code'}</button>
      </div>
      <p className="error-text" role="alert">{err}</p>
      <div className="form-actions login-actions">
        <button className="linkish f" type="button" onClick={() => setMode(mode === 'password' ? 'code' : 'password')}>{mode === 'code' ? 'Utiliser le mot de passe' : mode === 'email' ? 'Recommencer' : 'Se connecter avec un code à 6 chiffres'}</button>
        <button className={`btn f${odin && odin.sso ? '' : ' btn-play'}`} type="submit" disabled={busy}>{mode === 'email' ? 'Valider le code' : 'Se connecter'}</button>
      </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- « Qui regarde ? »
function Profiles({ done }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const first = useRef(null);
  useEffect(() => { api('/api/profiles').then(setList).catch(setError); }, []);
  useEffect(() => { if (list && first.current) first.current.focus({ preventScroll: true }); }, [list]);
  const select = async (p) => {
    if (!p.hasPin) { try { done(await api(`/api/profiles/${p.id}/select`, { method: 'POST', body: {} })); } catch (e) { shared().ui.toast(e.message, true); } return; }
    askPin(p, async (pin) => done(await api(`/api/profiles/${p.id}/select`, { method: 'POST', body: { pin } })));
  };
  if (error) return <div className="panel"><Brand /><h2>Profils indisponibles</h2><p>{error.message}</p><div className="form-actions"><button className="btn btn-play f" onClick={() => done(null)}>Réessayer</button></div></div>;
  if (!list) return null;
  return (
    <div>
      <h1>Qui regarde ?</h1>
      <p className="lead">Chaque profil a sa liste, sa progression et ses réglages.</p>
      <div className="profiles">
        {list.map((p, i) => (
          <button key={p.id} ref={i === 0 ? first : undefined} className="profile-tile f" onClick={() => select(p)}>
            <Avatar profile={p} />
            <span className="name">{p.name}{' '}{p.hasPin ? <Icon name="lock" /> : null}</span>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 48 }}>
        <button className="btn btn-ghost btn-small f" onClick={async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); shared().api.auth.token = null; noOdinAuto(); done(null); }}><Icon name="exit" />Déconnecter cet appareil</button>
      </div>
    </div>
  );
}

// Pavé du code PIN (clavier numérique et touches 0-9 / retour arrière)
export function askPin(profile, onSubmit) {
  openSheet(`Code PIN de ${profile.name}`, (close) => <PinPad profile={profile} onSubmit={onSubmit} close={close} />, { keepBackspace: true });
}
function PinPad({ profile, onSubmit, close }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const dots = useRef(null);
  const firstKey = useRef(null);
  const sending = useRef(false);
  const press = (d) => {
    if (sending.current) return;
    setCode((c) => (d === '⌫' ? c.slice(0, -1) : c.length < 4 ? c + d : c));
  };
  useEffect(() => {
    if (code.length !== 4) return;
    sending.current = true;
    onSubmit(code).then(() => close(), (e) => { setErr(e.message); setCode(''); shake(dots.current); }).finally(() => { sending.current = false; });
  }, [code]);
  useEffect(() => {
    setTimeout(() => firstKey.current && firstKey.current.focus(), 30);
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); press('⌫'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Avatar profile={profile} cls="sm" /></div>
      <div ref={dots} className="pin-dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i < code.length ? 'on' : ''} />)}</div>
      <p className="error-text" style={{ textAlign: 'center' }}>{err}</p>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (k
          ? <button key={k} ref={i === 0 ? firstKey : undefined} className="f" aria-label={k === '⌫' ? 'Effacer' : k} onClick={() => press(k)}>{k}</button>
          : <span key="sp" />))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lien d'invitation reçu par e-mail
// La personne prépare son compte (nom, avatar, code PIN, langues), puis cet appareil est connecté
// directement sur son profil, sans le mot de passe du foyer.
function Invitation({ done }) {
  const token = (location.pathname.match(/^\/invitation\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [av, setAv] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const f = useRef(null);
  useEffect(() => {
    api(`/api/invite/${encodeURIComponent(token)}`).then((x) => { setInv(x); setName(x.name); setAv(x.avatar || 0); setTimeout(() => f.current && f.current.elements.name.focus(), 50); }).catch(setError);
  }, []);
  const toLogin = (e) => { e.preventDefault(); history.replaceState(null, '', '/'); done(null); };
  if (error) return <div className="panel invite-panel"><Brand /><h2>Invitation introuvable</h2><p>{error.message}</p><div className="form-actions"><a className="btn btn-play f" href="/" onClick={toLogin}>Aller à la connexion</a></div></div>;
  if (!inv) return <div className="panel invite-panel"><Brand /><p className="muted">Ouverture de votre invitation…</p></div>;
  const hues = shared().ui.AVATAR_HUES;
  const submit = async (e) => {
    e.preventDefault();
    const el = f.current.elements;
    const pin = el.pin.value;
    setErr('');
    if (pin && !/^\d{4,8}$/.test(pin)) { setErr('Le code PIN fait 4 à 8 chiffres.'); return; }
    if (pin !== el.pin2.value) { setErr('Les deux codes PIN ne sont pas identiques.'); return; }
    if (inv.admin && !pin) { setErr('Un compte administrateur doit avoir un code PIN.'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: { name: name.trim(), avatar: av, pin: pin || null, audioLang: el.audio.value, subtitleLang: el.subs.value } });
      shared().api.auth.token = r.token;
      history.replaceState(null, '', '/');
      done(null);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <div className="panel invite-panel">
      <Brand />
      <h2>{`Bienvenue sur ${inv.server}`}</h2>
      <p>{`${inv.by} vous a créé un compte${inv.admin ? ' administrateur' : inv.kid ? ' enfant' : ''}. Préparez-le : cet appareil sera ensuite connecté directement.`}</p>
      <form ref={f} className="invite-form" onSubmit={submit} noValidate>
        <div className="field"><label>Votre nom</label><input className="input" name="name" value={name} maxLength={30} required autoComplete="nickname" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label>Couleur</label>
          <div className="invite-avatars" role="radiogroup" aria-label="Couleur de l’avatar">
            {hues.map((_, i) => <button key={i} type="button" className={`invite-av f${i === av ? ' on' : ''}`} role="radio" aria-checked={String(i === av)} aria-label={`Couleur ${i + 1}`} onClick={() => setAv(i)}><Avatar profile={{ name: name || inv.name, avatar: i }} /></button>)}
          </div>
        </div>
        <div className="invite-cols">
          <div className="field"><label>Code PIN</label><input className="input" name="pin" type="password" inputMode="numeric" maxLength={8} autoComplete="new-password" placeholder={inv.admin ? 'Obligatoire (4 à 8 chiffres)' : 'Facultatif (4 à 8 chiffres)'} /></div>
          <div className="field"><label>Confirmer</label><input className="input" name="pin2" type="password" inputMode="numeric" maxLength={8} autoComplete="new-password" placeholder="Le même code" /></div>
        </div>
        <small className="muted">Le code PIN protège votre profil sur les appareils partagés.</small>
        <div className="invite-cols">
          <div className="field"><label>Langue des films</label><select className="input" name="audio">{[['fr', 'Français'], ['en', 'Anglais'], ['ja', 'Japonais'], ['es', 'Espagnol']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label>Sous-titres</label><select className="input" name="subs">{[['fr', 'Français'], ['en', 'Anglais'], ['none', 'Aucun']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <p className="error-text" role="alert">{err}</p>
        <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={busy}>Créer mon compte</button></div>
      </form>
      <p className="muted small">{`Lien valable jusqu’au ${new Date(inv.expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, une seule fois.`}</p>
    </div>
  );
}
