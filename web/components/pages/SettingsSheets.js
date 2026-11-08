'use client';
// Réglages : petits composants partagés et fenêtres (profil, invitation, affiche, doublons, renommage,
// corbeille, fichiers abîmés, import d'archive)
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { api, toast, go, openSheet } from '../../lib/hooks';
import { Icon, Avatar } from '../Icon';

export const confirm = (m, l) => shared().ui.confirmSheet(m, l);
export const token = () => encodeURIComponent(shared().api.auth.token || '');
export const fmtGo = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

export const Field = ({ label, hint, children, style }) => <div className="field" style={style}><label>{label}</label>{children}{hint ? <small>{hint}</small> : null}</div>;
export const Select = ({ opts, value, onChange, ...rest }) => (
  <select className="input" defaultValue={String(value ?? '')} onChange={onChange} {...rest}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
);
export const Actions = ({ children, wrap, end }) => <div className="form-actions" style={end ? undefined : { justifyContent: 'flex-start', ...(wrap ? { flexWrap: 'wrap' } : {}) }}>{children}</div>;
export const Ext = ({ href, children }) => <a href={href} target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>{children}</a>;

// Bouton qui patiente pendant son action (désactivé, libellé d'attente)
export function Busy({ onClick, busy: busyLabel, children, className = 'btn btn-small f', ...rest }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return (
    <button type="button" className={className} disabled={busy || rest.disabled} {...rest}
      onClick={async (e) => { setBusy(true); try { await onClick(e); } finally { if (alive.current) setBusy(false); } }}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

// Interrupteur
export function Switch({ label, hint, checked, onChange, disabled, mini, style }) {
  return (
    <label className={`switch${mini ? ' mini' : ''}`} style={style}>
      {label != null ? <span>{label}{hint ? <small className="muted" style={{ display: 'block' }}>{hint}</small> : null}</span> : null}
      <input type="checkbox" className="f" defaultChecked={!!checked} disabled={disabled} onChange={onChange} aria-label={mini ? hint : undefined} />
    </label>
  );
}

// Interrupteur d'un réglage du serveur
export const putSettings = (body) => api('/api/admin/settings', { method: 'PUT', body });
export function SetSwitch({ label, hint, k, checked, msg = 'Préférence enregistrée', style }) {
  return <Switch label={label} hint={hint} checked={checked} style={style} onChange={async (e) => { const on = e.target.checked; try { await putSettings({ [k]: on }); toast(typeof msg === 'function' ? msg(on) : msg); } catch (err) { toast(err.message, true); e.target.checked = !on; } }} />;
}

// Conseil quand le serveur ne peut pas faire quelque chose seul (GPU, partages réseau)
export function Advice({ adv }) {
  const code = useRef(null);
  if (!adv) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(adv.command); toast('Commande copiée'); }
    catch { const r = document.createRange(); r.selectNodeContents(code.current); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionnée : copiez-la avec Ctrl+C'); }
  };
  return (
    <div className="advice" role="note">
      <div className="advice-head"><Icon name="info" /><b>{adv.title}</b></div>
      <p>{adv.text}</p>
      {adv.command ? <div className="advice-cmd"><code ref={code}>{adv.command}</code><button className="btn btn-small f" type="button" aria-label="Copier la commande" onClick={copy}><Icon name="copy" />Copier</button></div> : null}
      {adv.command && adv.command.includes('<ID-du-conteneur>') ? <small>À lancer sur l’hôte Proxmox, dans le dossier Venus (ou via la commande curl du README). Remplacez &lt;ID-du-conteneur&gt; par le numéro du conteneur, par exemple 7700.</small> : null}
    </div>
  );
}

// Jauge de solidité d'un mot de passe (mêmes règles que le serveur)
export function PasswordMeter({ value }) {
  const problem = shared().ui.passwordProblem;
  const s = value || '';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(s)).length;
  const score = !s ? 0 : problem(s) ? 1 : Math.min(4, 1 + kinds + (s.length >= 14 ? 1 : 0) - 1);
  return (
    <div className="pw-meter" aria-live="polite" data-level={String(score)}>
      <span className="pw-bar"><i style={{ width: `${score * 25}%` }} /></span>
      <small className="pw-text">{!s ? '10 caractères minimum, lettres et chiffres' : problem(s) || ['', 'Faible', 'Correct', 'Solide', 'Très solide'][score]}</small>
    </div>
  );
}

// Contenu chargé dans une fenêtre : attente, erreur, puis le rendu
function Loaded({ load, children, deps = [] }) {
  const [r, setR] = useState({ data: undefined, error: null });
  const [n, setN] = useState(0);
  useEffect(() => { let dead = false; load().then((data) => !dead && setR({ data, error: null })).catch((error) => !dead && setR({ data: undefined, error })); return () => { dead = true; }; }, [n, ...deps]);
  if (r.error) return <p className="error-text">{r.error.message}</p>;
  if (r.data === undefined) return <p className="muted">Chargement…</p>;
  return children(r.data, () => setN((x) => x + 1));
}

// ---------------------------------------------------------------- inviter par e-mail
export function inviteSheet(existing, onDone) {
  openSheet(existing ? `Renvoyer l’invitation de ${existing.name}` : 'Inviter par e-mail', (close) => <Invite existing={existing} onDone={onDone} />);
}
function Invite({ existing, onDone }) {
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const f = useRef(null);
  useEffect(() => { setTimeout(() => f.current && f.current.querySelector(existing ? '[name=email]' : '[name=name]')?.focus(), 50); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '').trim();
    const k = fd.get('kind');
    try {
      const r = await api('/api/admin/invites', { method: 'POST', body: existing ? { profileId: existing.id, email } : { name: String(fd.get('name') || '').trim(), email, isAdmin: k === 'admin', maxAge: k === 'kid' ? 11 : k === 'teen' ? 15 : null } });
      setRes({ ...r, email }); onDone && onDone();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <form ref={f} onSubmit={submit}>
      <p className="muted">La personne reçoit un lien pour préparer son compte (nom, couleur, code PIN, langues). En l’ouvrant, son appareil est connecté directement, sans le mot de passe du foyer.</p>
      {existing ? null : <Field label="Nom"><input className="input" name="name" maxLength={30} required autoComplete="off" /></Field>}
      <Field label="Adresse e-mail"><input className="input" name="email" type="email" maxLength={200} required defaultValue={existing ? existing.email || '' : ''} autoComplete="off" placeholder="prenom@exemple.fr" /></Field>
      {existing ? null : <Field label="Type de compte"><select className="input" name="kind"><option value="std">Standard</option><option value="kid">Enfant (moins de 12 ans)</option><option value="teen">Ado (moins de 16 ans)</option><option value="admin">Administrateur</option></select></Field>}
      <p className="error-text" role="alert">{err}</p>
      {res ? (
        <div className="invite-result">
          {res.sent ? <p className="upd-ok"><Icon name="check" />{` Invitation envoyée à ${res.email}.`}</p> : <p className="warn-text">{`E-mail non envoyé : ${res.error}. Transmettez ce lien vous-même (valable 7 jours, une seule fois) :`}</p>}
          <code className="cmd">{res.link}</code>
          <button type="button" className="btn btn-small f" onClick={() => navigator.clipboard?.writeText(res.link).then(() => toast('Lien copié'), () => {})}><Icon name="copy" />Copier le lien</button>
        </div>
      ) : null}
      <div className="form-actions"><button className="btn btn-play f" type="submit" disabled={busy}>{res ? <><Icon name="check" />Fait</> : <><Icon name="send" />{existing ? 'Renvoyer le lien' : 'Envoyer l’invitation'}</>}</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- profil : nom, couleur, PIN, âge, droits
const AGES = [['', 'Aucune limite'], ['3', '3 ans et +'], ['7', '7 ans et +'], ['10', '10 ans et +'], ['12', '12 ans et +'], ['16', '16 ans et +']];
const DAYS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export function editProfile(p, self, onDone) {
  openSheet(!p ? 'Nouveau profil' : `Modifier ${p.name}`, (close) => <ProfileForm p={p} self={self} onDone={onDone} close={close} />);
}
function ProfileForm({ p, self, onDone, close }) {
  const isNew = !p;
  const me = shared().app.state.profile;
  const hues = shared().ui.AVATAR_HUES;
  const [name, setName] = useState(p ? p.name : '');
  const [av, setAv] = useState(() => (p ? p.avatar : Math.floor(Math.random() * hues.length)));
  const [pin, setPin] = useState('');
  const [rmPin, setRmPin] = useState(false);
  const [age, setAge] = useState(p && p.maxAge != null ? String(p.maxAge) : '');
  const canAdmin = !self && (!p || p.id !== me.id);
  const [admin, setAdmin] = useState(p ? !!p.isAdmin : false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(() => ({ libraries: null, download: true, transcode: true, remote: true, schedule: [], dailyMinutes: 0, ...(p && p.perms ? JSON.parse(JSON.stringify(p.perms)) : {}) }));
  const [libs, setLibs] = useState(null);
  const nameIn = useRef(null);
  const showPerms = !self && !isNew;
  useEffect(() => { setTimeout(() => nameIn.current && nameIn.current.focus(), 30); if (showPerms) api('/api/admin').then((a) => setLibs(a.libraries)).catch(() => setLibs(false)); }, []);
  const up = (fn) => setPerms((x) => { const y = JSON.parse(JSON.stringify(x)); fn(y); return y; });
  const submit = async (e) => {
    e.preventDefault();
    if (pin && !/^\d{4}$/.test(pin)) { setErr('Le code PIN doit contenir 4 chiffres.'); return; }
    if (!name.trim()) { setErr('Indiquez un nom.'); return; }
    const willBeAdmin = canAdmin ? admin : !!(p && p.isAdmin);
    const hasPinAfter = pin ? true : p && p.hasPin && !rmPin;
    if (willBeAdmin && !hasPinAfter) { setErr('Un profil administrateur doit avoir un code PIN.'); return; }
    const body = { name: name.trim(), avatar: av };
    if (pin) body.pin = pin; else if (rmPin) body.pin = null;
    if (!self) body.maxAge = age === '' ? null : Number(age);
    if (canAdmin) body.isAdmin = admin;
    if (showPerms && libs && !willBeAdmin) {
      if (perms.libraries && !perms.libraries.length) { setErr('Choisissez au moins une bibliothèque.'); return; }
      if (perms.schedule.some((x) => !x.days.length || !x.from || !x.to || x.from === x.to)) { setErr('Chaque créneau a besoin d’au moins un jour et de deux heures différentes.'); return; }
      body.perms = perms;
    }
    try {
      await api(isNew ? '/api/profiles' : `/api/profiles/${p.id}`, { method: isNew ? 'POST' : 'PUT', body });
      close(); toast(isNew ? 'Profil créé' : 'Profil enregistré'); onDone && onDone();
    } catch (e2) { setErr(e2.message); }
  };
  const allLibs = perms.libraries == null;
  return (
    <form onSubmit={submit}>
      <Field label="Nom"><input ref={nameIn} className="input" value={name} required maxLength={30} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Couleur">
        <div className="avatar-pick">{hues.map((_, i) => <button key={i} type="button" className={`f${i === av ? ' on' : ''}`} aria-label={`Couleur ${i + 1}`} onClick={() => setAv(i)}><Avatar profile={{ name: name || '?', avatar: i }} /></button>)}</div>
      </Field>
      <Field label="Code PIN" hint="Protège l’accès à ce profil."><input className="input" inputMode="numeric" maxLength={4} pattern="\d{4}" placeholder={p && p.hasPin ? '•••• (laisser vide pour conserver)' : 'Aucun'} value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
      {p && p.hasPin ? <label className="switch"><span>Supprimer le code PIN</span><input type="checkbox" className="f" checked={rmPin} onChange={(e) => setRmPin(e.target.checked)} /></label> : null}
      {!self ? <Field label="Contrôle parental" hint="Les titres au-dessus de cet âge sont masqués."><select className="input" value={age} onChange={(e) => setAge(e.target.value)}>{AGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field> : null}
      {canAdmin ? <label className="switch"><span>Administrateur (accès aux réglages du serveur)</span><input type="checkbox" className="f" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /></label> : null}
      {showPerms && libs ? (
        <div className="perms">
          <h3>Droits</h3>
          <label className="switch"><span>Toutes les bibliothèques</span><input type="checkbox" className="f" checked={allLibs} onChange={(e) => { const on = e.target.checked; up((x) => { x.libraries = on ? null : libs.map((l) => l.id); }); }} /></label>
          {allLibs ? null : (
            <div className="perm-libs">{libs.map((l) => <label key={l.id} className="chk"><input type="checkbox" className="f" checked={perms.libraries.includes(l.id)} onChange={(e) => { const on = e.target.checked; up((x) => { x.libraries = on ? [...x.libraries, l.id] : x.libraries.filter((y) => y !== l.id); }); }} />{l.name}</label>)}</div>
          )}
          {[['Télécharger pour regarder sans réseau', 'download'], ['Lire les vidéos qui demandent une conversion', 'transcode', 'Sinon, seulement les fichiers que l’appareil lit tels quels'], ['Accès depuis l’extérieur de la maison', 'remote', 'Sinon, seulement sur le réseau local']].map(([label, k, hint]) => (
            <label key={k} className="switch"><span>{label}{hint ? <small>{hint}</small> : null}</span><input type="checkbox" className="f" checked={!!perms[k]} onChange={(e) => { const on = e.target.checked; up((x) => { x[k] = on; }); }} /></label>
          ))}
          <div className="field">
            <label>Horaires autorisés</label>
            {perms.schedule.length ? (
              <div className="slots">
                {perms.schedule.map((sl, i) => (
                  <div key={i} className="slot">
                    <div className="days">{DAYS.map(([d, l]) => <button key={d} type="button" className={`day f${sl.days.includes(d) ? ' on' : ''}`} title={DAY_NAMES[d]} aria-pressed={String(sl.days.includes(d))} onClick={() => up((x) => { const s = x.schedule[i]; s.days = s.days.includes(d) ? s.days.filter((y) => y !== d) : [...s.days, d]; })}>{l}</button>)}</div>
                    <input className="input" type="time" value={sl.from} onChange={(e) => { const v = e.target.value; up((x) => { x.schedule[i].from = v; }); }} /><span>à</span>
                    <input className="input" type="time" value={sl.to} onChange={(e) => { const v = e.target.value; up((x) => { x.schedule[i].to = v; }); }} />
                    <button type="button" className="p-icon small f" aria-label="Retirer ce créneau" onClick={() => up((x) => { x.schedule.splice(i, 1); })}><Icon name="close" /></button>
                  </div>
                ))}
              </div>
            ) : <small>À toute heure.</small>}
            {perms.schedule.length < 7 ? <button type="button" className="btn btn-small btn-ghost f" onClick={() => up((x) => { x.schedule.push({ days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' }); })}><Icon name="plus" />Ajouter un créneau</button> : null}
            {perms.schedule.length ? <small>Heure du serveur. En dehors de ces créneaux, le profil ne s’ouvre pas.</small> : null}
          </div>
          <div className="field">
            <label>Temps d’écran par jour</label>
            <select className="input" style={{ maxWidth: 220 }} value={String(Number(perms.dailyMinutes || 0))} onChange={(e) => { const v = Number(e.target.value); up((x) => { x.dailyMinutes = v; }); }}>
              {[[0, 'Sans limite'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 heure'], [90, '1 h 30'], [120, '2 heures'], [180, '3 heures']].map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
            </select>
            <small>Compte le temps réellement regardé. Une fois la limite atteinte, la lecture s’arrête jusqu’au lendemain ; le profil reste ouvert pour parcourir.</small>
          </div>
        </div>
      ) : null}
      <p className="error-text">{err}</p>
      <div className="form-actions">
        {!isNew && !self && p.id !== me.id ? (
          <button type="button" className="btn btn-danger f" onClick={async () => {
            if (!(await confirm(`Supprimer le profil « ${p.name} » et sa progression ?`, 'Supprimer'))) return;
            await api(`/api/profiles/${p.id}`, { method: 'DELETE' }); close(); toast('Profil supprimé'); onDone && onDone();
          }}>Supprimer</button>
        ) : null}
        <button className="btn btn-play f" type="submit">{isNew ? 'Créer le profil' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- choisir l'affiche d'un titre
export function choosePoster(it, onDone) {
  openSheet(`Affiche de « ${it.title} »`, (close) => <PosterPick it={it} close={close} onDone={onDone} />, { wide: true });
}
function PosterPick({ it, close, onDone }) {
  const [q, setQ] = useState(it.title);
  const [y, setY] = useState(it.year ? String(it.year) : '');
  const [url, setUrl] = useState('');
  const [res, setRes] = useState(null); // null : recherche ; tableau ; Error
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setRes(null);
    try { setRes(await api(`/api/admin/posters/${it.id}/candidates?q=${encodeURIComponent(q.trim())}&year=${encodeURIComponent(y.trim())}`)); }
    catch (e) { setRes(e); }
  };
  useEffect(() => { search(); }, []);
  const use = async (src, ref) => {
    setBusy(true);
    try { await api(`/api/admin/items/${it.id}/image`, { method: 'POST', body: { kind: 'poster', src, ref } }); toast('Affiche enregistrée', { type: 'success' }); close(); onDone && onDone(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  return (
    <div className="img-pick">
      <form className="img-url-row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" value={q} aria-label="Titre à chercher" onChange={(e) => setQ(e.target.value)} />
        <input className="input" value={y} inputMode="numeric" placeholder="Année" style={{ maxWidth: 100 }} onChange={(e) => setY(e.target.value)} />
        <button className="btn btn-small f" type="submit"><Icon name="search" />Chercher</button>
      </form>
      <div className="img-grid poster">
        {res === null ? <p className="muted"><span className="mini-spin" /> Recherche…</p>
          : res instanceof Error ? <p className="error-text">{res.message}</p>
            : res.length ? res.map((c, i) => (
              <button key={i} className="img-opt f" disabled={busy} title={`${c.source}${c.year ? ` · ${c.year}` : ''}`} onClick={() => use(c.source === 'TMDB' ? 'url' : 'free', c.url)}>
                <img src={c.url} alt="" loading="lazy" referrerPolicy="no-referrer" /><span className="img-src">{c.source}</span>
              </button>
            )) : <p className="muted">Aucune proposition. Essayez le titre original ou en anglais, ou collez une adresse ci-dessous.</p>}
      </div>
      <form className="img-url" onSubmit={(e) => { e.preventDefault(); const u = url.trim(); if (!/^https:\/\//i.test(u)) { toast('Collez une adresse qui commence par https://', true); return; } use('url', u); }}>
        <label className="img-url-label">Ou collez l’adresse d’une image</label>
        <div className="img-url-row"><input className="input" type="url" placeholder="https://… adresse d’une image" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} /><button className="btn btn-small btn-play f" type="submit" disabled={busy}><Icon name="down" />Utiliser</button></div>
        <small className="muted">Depuis IMP Awards, MoviePosterDB, CineMaterial, TMDB… (clic droit sur l’image → « Copier l’adresse de l’image »).</small>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- doublons
export function openDuplicates() {
  openSheet('Doublons', <div className="dup-list"><Loaded load={() => api('/api/admin/duplicates')}>{(r, reload) => (!r.groups.length
    ? <p className="muted">Aucun film en double. Les versions voulues (4K et 1080p d’un même film) apparaissent ici aussi : ne supprimez que ce qui est de trop.</p>
    : (
      <>
        <p>{`${plural(r.groups.length, 'film')} en plusieurs exemplaires · ${fmtGo(r.recoverable)} récupérables en ne gardant que la meilleure version.`}</p>
        {r.groups.map((g, i) => (
          <div key={i} className="dup">
            <div className="dup-head"><b>{`${g.title}${g.year ? ` (${g.year})` : ''}`}</b><small>{`${g.versions.length} fichiers`}</small></div>
            <div className="dup-versions">
              {g.versions.map((v) => (
                <div key={v.id} className={`dup-v${v.primary ? ' best' : ''}`}>
                  <div className="grow"><b>{[v.quality || 'Qualité inconnue', v.detail].filter(Boolean).join(' · ')}</b><small>{v.file}</small></div>
                  {v.primary ? <span className="pill">Meilleure</span> : (
                    <Busy className="btn btn-small btn-danger f" onClick={async () => {
                      if (!(await confirm(`Supprimer le fichier « ${v.file} » (${fmtGo(v.size)}) ? Il est effacé du disque.`, 'Supprimer'))) return;
                      try { await api(`/api/admin/items/${v.id}/delete`, { method: 'POST' }); toast(`${fmtGo(v.size)} libérés`); reload(); } catch (err) { toast(err.message, true); }
                    }}>Supprimer</Busy>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </>
    ))}</Loaded></div>, { wide: true });
}

// ---------------------------------------------------------------- renommage façon Plex / Jellyfin
export function openRename() {
  openSheet('Renommer les fichiers', (close) => <div className="ren-list"><Loaded load={() => api('/api/admin/rename')}>{({ plan }) => <Rename plan={plan} close={close} />}</Loaded></div>, { wide: true });
}
function Rename({ plan, close }) {
  const [on, setOn] = useState(() => new Set(plan.filter((p) => !p.exists).map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  if (!plan.length) return <p className="muted">Tous les fichiers identifiés ont déjà un nom propre (« Film (Année)/Film (Année).mkv », « Série/Saison 01/Série - S01E02.mkv »). Les titres non identifiés n’apparaissent pas : identifiez-les d’abord depuis leur fiche.</p>;
  const apply = async () => {
    const ids = [...on];
    if (!ids.length) return;
    if (!(await confirm(`Renommer ${plural(ids.length, 'fichier')} (et leurs sous-titres) ? Les dossiers vides sont retirés. Venus continue de les reconnaître.`, 'Renommer'))) return;
    setBusy(true);
    try { const r = await api('/api/admin/rename', { method: 'POST', body: { ids } }); toast(`${plural(r.done, 'fichier')} renommé${r.done > 1 ? 's' : ''}${r.errors.length ? `, ${r.errors.length} échec(s)` : ''}`, r.errors.length ? true : { type: 'success' }); if (r.errors.length) console.warn(r.errors); close(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  return (
    <>
      <p>{`${plural(plan.length, 'fichier')} à renommer. Modèle : « Film (Année)/Film (Année).ext », « Série (Année)/Saison 01/Série (Année) - S01E02 - Titre.ext ».`}</p>
      <Actions>
        <button className="btn btn-small btn-ghost f" onClick={() => setOn(new Set(plan.filter((p) => !p.exists).map((p) => p.id)))}>Tout cocher</button>
        <button className="btn btn-small btn-ghost f" onClick={() => setOn(new Set())}>Tout décocher</button>
      </Actions>
      <div className="ren-rows">
        {plan.map((p) => (
          <label key={p.id} className={`ren${p.exists ? ' blocked' : ''}`}>
            <input type="checkbox" className="f" checked={on.has(p.id)} disabled={p.exists} onChange={(e) => { const s = new Set(on); if (e.target.checked) s.add(p.id); else s.delete(p.id); setOn(s); }} />
            <div className="grow"><small>{p.from}</small><b>{p.to}</b>{p.exists ? <small className="warn">Un fichier porte déjà ce nom</small> : null}</div>
          </label>
        ))}
      </div>
      <div className="form-actions"><button className="btn btn-play f" disabled={busy} onClick={apply}>{busy ? 'Renommage…' : 'Renommer la sélection'}</button></div>
    </>
  );
}

// ---------------------------------------------------------------- import d'une archive (changement de machine)
export function importArchive() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.tar.gz,.tgz,application/gzip'; input.hidden = true;
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    if (!(await confirm(`Importer « ${f.name} » ? Profils, vus, listes et réglages actuels seront remplacés par ceux de l’archive (une sauvegarde est faite avant). Venus redémarre ensuite.`, 'Importer'))) return;
    toast('Envoi de l’archive…');
    try {
      const r = await fetch('/api/admin/import', { method: 'POST', headers: { Authorization: `Bearer ${shared().api.auth.token || ''}`, 'Content-Type': 'application/gzip' }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Import impossible');
      toast(d.restarting ? 'Import prêt : Venus redémarre…' : 'Import prêt : redémarrez Venus pour l’appliquer', { type: 'success', duration: 8000 });
      if (d.restarting) setTimeout(() => location.reload(), 8000);
    } catch (e) { toast(e.message, true); }
  };
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}

// ---------------------------------------------------------------- corbeille
export function openTrash() {
  openSheet('Corbeille', <div className="dup-list"><Loaded load={() => api('/api/admin/trash')}>{(r, reload) => {
    if (!r.items.length) return <p className="muted">{`La corbeille est vide. Les vidéos supprimées depuis Venus y restent ${r.keepDays} jours avant d’être effacées du disque.`}</p>;
    const total = r.items.reduce((n, t) => n + t.size, 0);
    return (
      <>
        <p>{`${plural(r.items.length, 'élément')} · ${fmtGo(total)}. Effacés automatiquement ${r.keepDays} jours après leur suppression.`}</p>
        {r.items.map((t) => (
          <div key={t.id} className="dup-v">
            <div className="grow"><b>{t.title}</b><small>{`${t.kind === 'episode' ? 'Épisode' : t.kind === 'movie' ? 'Film' : 'Vidéo'} · ${fmtGo(t.size)} · supprimé le ${new Date(t.deleted_at).toLocaleDateString('fr-FR')}${t.by_name ? ` par ${t.by_name}` : ''} · effacé le ${new Date(t.expires).toLocaleDateString('fr-FR')}`}</small></div>
            <Busy onClick={async () => { try { await api(`/api/admin/trash/${t.id}/restore`, { method: 'POST' }); toast('Restauré : la vidéo réapparaît après l’analyse (quelques secondes)'); reload(); } catch (err) { toast(err.message, true); } }}>Restaurer</Busy>
            <Busy className="btn btn-small btn-ghost btn-danger f" onClick={async () => { if (!(await confirm(`Effacer « ${t.title} » du disque maintenant ?`, 'Effacer'))) return; try { await api(`/api/admin/trash/${t.id}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, true); } }}>Effacer</Busy>
          </div>
        ))}
        <div className="form-actions"><button className="btn btn-small btn-danger f" onClick={async () => { if (!(await confirm(`Vider la corbeille (${fmtGo(total)}) ? Tout est effacé du disque.`, 'Vider'))) return; try { const x = await api('/api/admin/trash', { method: 'DELETE' }); toast(`${fmtGo(x.freed)} libérés`); reload(); } catch (err) { toast(err.message, true); } }}>Vider la corbeille</button></div>
      </>
    );
  }}</Loaded></div>, { wide: true });
}

// ---------------------------------------------------------------- fichiers abîmés (tâche d'intégrité)
export function openBroken() {
  openSheet('Fichiers abîmés', (close) => <div className="dup-list"><Loaded load={() => api('/api/admin/broken')}>{(list) => (!list.length
    ? <p className="muted">Aucun fichier abîmé repéré. La tâche « Fichiers abîmés » (Serveur → Tâches) lit un peu de chaque vidéo, 30 par passage, les nouvelles d’abord.</p>
    : (
      <>
        <p>{`${plural(list.length, 'fichier')} ne se lisent pas correctement (téléchargement incomplet, disque abîmé…). Remplacez-les, ou supprimez-les.`}</p>
        {list.map((f, i) => (
          <div key={i} className="dup-v">
            <div className="grow"><b>{f.show_title ? `${f.show_title} S${f.season_num} É${f.episode_num}` : f.title}</b><small>{f.path}</small><small className="warn">{f.error || 'Erreur de lecture'}</small></div>
            <button className="btn btn-small f" onClick={() => { close(); go(`/titre/${f.item_id}`); }}>Fiche</button>
          </div>
        ))}
      </>
    ))}</Loaded></div>, { wide: true });
}
