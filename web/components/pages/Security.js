'use client';
// Sécurité (administrateur) : audit, double authentification par e-mail, HTTPS, adresses bloquées,
// appareils connectés et journal des évènements de sécurité.
import { useRef, useState } from 'react';
import { legacy } from '../../lib/legacy';
import { useApi, useTitle, api, toast, go } from '../../lib/hooks';
import { Icon } from '../Icon';
import { PageError, PageLoading } from '../PageState';

const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const LEVEL = { ok: 'OK', warn: 'À améliorer', bad: 'À corriger' };
const KIND = {
  connexion: 'Connexion', 'echec-login': 'Mot de passe faux', 'echec-code': 'Code faux', 'echec-pin': 'PIN faux', 'echec-2fa': 'Code e-mail faux', 'echec-join': 'Code de séance faux',
  'force-brute': 'Force brute', 'force-brute-repartie': 'Force brute répartie', ban: 'Adresse bloquée', deblocage: 'Adresse débloquée', suspect: 'Requête suspecte',
  cors: 'Autre origine', '2fa-envoye': 'Code envoyé', '2fa-echec': 'Code e-mail faux', '2fa-limite': 'Limite e-mails', '2fa-envoi': 'E-mail non envoyé', '2fa-ip': 'Code autre appareil', '2fa': 'Double authentification',
  'mot-de-passe': 'Mot de passe', droits: 'Droits', profil: 'Profil', pin: 'Code PIN', 'envoi-refuse': 'Fichier refusé', envoi: 'Fichier envoyé', audit: 'Audit', https: 'HTTPS',
  deconnexion: 'Déconnexion', journal: 'Journal', installation: 'Installation', 'erreur-serveur': 'Erreur serveur', 'cle-api': 'Clé API',
};
const confirm = (msg, label) => legacy().ui.confirmSheet(msg, label);
export const Field = ({ label, hint, children }) => <div className="field"><label>{label}</label>{children}{hint ? <small>{hint}</small> : null}</div>;

export default function Security() {
  useTitle('Sécurité');
  const admin = legacy().app.state.profile.isAdmin;
  const { data: d, error, reload, set } = useApi(admin ? '/api/admin/security' : null, { keep: true });
  if (!admin) return <main className="with-nav"><div className="empty"><h2>Réservé à l’administrateur</h2></div></main>;
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  return (
    <main className="with-nav page-in">
      <div className="page security">
        <div className="page-head">
          <div className="head-left"><h1>Sécurité</h1><p className="count">{d.adminsWithoutPin.length ? `⚠ ${d.adminsWithoutPin.join(', ')} : administrateur sans code PIN` : 'Protections actives'}</p></div>
          <button className="btn btn-ghost btn-small f" onClick={() => go('/dashboard')}><Icon name="back" />Tableau de bord</button>
        </div>
        <div className="sec-grid">
          <Audit d={d} set={set} />
          <TwoFa d={d} reload={reload} />
          <Https d={d} reload={reload} />
          <Bans d={d} reload={reload} />
          <Devices d={d} reload={reload} />
        </div>
        <Log d={d} reload={reload} />
      </div>
    </main>
  );
}

function Audit({ d, set }) {
  const a = d.audit;
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await api('/api/admin/security/audit', { method: 'POST' }); set((x) => ({ ...x, audit: r })); toast('Audit terminé', { type: 'success' }); } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  const order = ['bad', 'warn', 'ok'];
  return (
    <section className="box sec-audit">
      <div className="sec-head">
        <div><h2>Audit de sécurité</h2><p className="muted">{a ? `Fait le ${when(a.at)} — automatique chaque semaine` : 'Pas encore fait'}</p></div>
        <button className="btn btn-small f" disabled={busy} onClick={run}><Icon name="refresh" />Relancer l’audit</button>
      </div>
      {a ? <div className="sec-score" style={{ '--p': `${a.score}%` }}><b>{`${a.score} %`}</b><span>des points sont au vert</span></div> : null}
      {a ? (
        <ul className="sec-items">
          {[...a.items].sort((x, y) => order.indexOf(x.level) - order.indexOf(y.level)).map((i) => (
            <li key={i.title} className={`lv-${i.level}`}><span className="sec-dot" /><div><b>{i.title}<em>{LEVEL[i.level]}</em></b><p>{i.detail}</p>{i.fix ? <small>{i.fix}</small> : null}</div></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TwoFa({ d, reload }) {
  const sm = d.smtp;
  const r = { host: useRef(), port: useRef(), secure: useRef(), user: useRef(), pass: useRef(), from: useRef(), to: useRef() };
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const val = (k) => r[k].current.value.trim();
  const save = async () => {
    setErr('');
    const emailRe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
    if (val('host') && !/^[\w.-]+$/.test(val('host'))) { setErr('Serveur d’e-mails : nom invalide'); return false; }
    if (val('from') && !emailRe.test(val('from'))) { setErr('Expéditeur : adresse e-mail invalide'); return false; }
    if (val('to') && !emailRe.test(val('to'))) { setErr('Adresse de l’administrateur invalide'); return false; }
    const p = Number(val('port')); if (!(p >= 1 && p <= 65535)) { setErr('Port entre 1 et 65535'); return false; }
    try {
      const pass = r.pass.current.value;
      await api('/api/admin/settings', { method: 'PUT', body: { smtpHost: val('host'), smtpPort: p, smtpSecure: r.secure.current.value, smtpUser: val('user'), ...(pass ? { smtpPass: pass } : {}), smtpFrom: val('from'), twofaEmail: val('to') } });
      return true;
    } catch (e) { setErr(e.message); return false; }
  };
  const test = async () => {
    setBusy(true);
    if (await save()) {
      try { const x = await api('/api/admin/security/test-email', { method: 'POST' }); toast(`E-mail de test envoyé à ${x.to}`, { type: 'success' }); reload(); }
      catch (e) { setErr(e.message); }
    }
    setBusy(false);
  };
  const on = d.twofa.mode !== 'off';
  const toggle = async (e) => {
    const want = e.target.checked;
    if (!want && !(await confirm('Couper la double authentification ? Le mot de passe du foyer suffira de nouveau pour connecter un appareil.', 'Couper'))) return;
    try { await api('/api/admin/settings', { method: 'PUT', body: { twofaMode: want ? 'new_device' : 'off' } }); toast(want ? 'Double authentification activée' : 'Double authentification désactivée', { type: 'success' }); reload(); }
    catch (e2) { toast(e2.message, true); }
  };
  return (
    <section className="box">
      <h2>Double authentification par e-mail</h2>
      <p>Quand un nouvel appareil se connecte avec le mot de passe du foyer, un code à 6 chiffres est envoyé à l’administrateur. Code valable 10 minutes, 5 essais par code ; au plus 10 e-mails et 15 codes faux par jour.</p>
      {d.twofa.disabledByEnv ? <p className="error-text">Coupée par la variable VENUS_DISABLE_2FA=1 (secours).</p> : null}
      <label className="switch"><span>{on ? 'Activée : code demandé à chaque nouvel appareil' : d.twofa.verified ? 'Désactivée' : 'Désactivée (envoyez d’abord un e-mail de test)'}</span>
        <input type="checkbox" className="f" checked={on} disabled={!on && !d.twofa.verified} onChange={toggle} /></label>
      {d.twofa.sentToday || d.twofa.failsToday ? <p className="muted">{`Aujourd’hui : ${d.twofa.sentToday} code(s) envoyé(s), ${d.twofa.failsToday} code(s) faux.`}</p> : null}
      <Field label="Adresse e-mail de l’administrateur" hint="Les codes de connexion et les alertes y sont envoyés."><input ref={r.to} className="input" type="email" defaultValue={d.twofa.email} maxLength={254} placeholder="vous@exemple.fr" /></Field>
      <h3 className="sec-sub">Serveur d’envoi (SMTP)</h3>
      <div className="two-cols">
        <Field label="Serveur"><input ref={r.host} className="input" defaultValue={sm.host} placeholder="smtp.gmail.com" maxLength={200} pattern="[\w.-]+" autoComplete="off" /></Field>
        <Field label="Port"><input ref={r.port} className="input" type="number" min={1} max={65535} defaultValue={sm.port || 587} /></Field>
      </div>
      <Field label="Chiffrement"><select ref={r.secure} className="input" defaultValue={sm.secure}>{[['auto', 'Automatique'], ['starttls', 'STARTTLS (587)'], ['tls', 'TLS (465)'], ['none', 'Aucun (déconseillé)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Identifiant"><input ref={r.user} className="input" defaultValue={sm.user} maxLength={200} autoComplete="off" placeholder="Identifiant (souvent l’adresse e-mail)" /></Field>
      <Field label="Mot de passe" hint="Gmail, Outlook… : utilisez un « mot de passe d’application ». Il est chiffré dans la base."><input ref={r.pass} className="input" type="password" maxLength={300} autoComplete="new-password" placeholder={sm.passSet ? 'Enregistré (laisser vide pour conserver)' : 'Mot de passe d’application'} /></Field>
      <Field label="Expéditeur"><input ref={r.from} className="input" type="email" defaultValue={sm.from} maxLength={254} placeholder="venus@exemple.fr" /></Field>
      <p className="error-text">{err}</p>
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-small f" disabled={busy} onClick={test}><Icon name="send" />Enregistrer et envoyer un e-mail de test</button></div>
    </section>
  );
}

function Https({ d, reload }) {
  const [mode, setMode] = useState(d.https.mode);
  const change = async (e) => {
    const v = e.target.value; setMode(v);
    try { await api('/api/admin/settings', { method: 'PUT', body: { forceHttps: v } }); toast('Réglage enregistré', { type: 'success' }); reload(); } catch (e2) { toast(e2.message, true); }
  };
  const httpsUrl = d.https.port ? `https://${location.hostname || 'localhost'}:${d.https.port}` : null;
  return (
    <section className="box">
      <h2>HTTPS</h2>
      <p>{d.https.secure ? 'Cette page est ouverte en HTTPS : la connexion est chiffrée.' : 'Cette page est ouverte en HTTP : sur le réseau de la maison c’est toléré, depuis Internet c’est refusé.'}</p>
      <Field label="HTTPS obligatoire" hint={mode === 'all' ? 'Les adresses http:// sont redirigées vers https://.' : 'Depuis Internet, seules les connexions chiffrées sont acceptées.'}>
        <select className="input" value={mode} onChange={change}>{[['remote', 'Obligatoire hors du réseau local (conseillé)'], ['all', 'Obligatoire partout'], ['off', 'Jamais (déconseillé)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      {httpsUrl ? <p className="muted">Adresse sécurisée de ce serveur : <a href={httpsUrl} style={{ textDecoration: 'underline' }}>{httpsUrl}</a>. Avec le certificat créé par Venus, le navigateur demande de l’accepter une fois. Pour une adresse publique, utilisez Caddy (certificat reconnu, voir le README).</p> : null}
    </section>
  );
}

function Bans({ d, reload }) {
  const [ip, setIp] = useState('');
  const ban = async () => {
    const x = ip.trim();
    if (!/^[\da-f.:]+$/i.test(x)) { toast('Adresse IP invalide', true); return; }
    try { await api('/api/admin/security/ban', { method: 'POST', body: { ip: x } }); toast(`${x} bloquée`, { type: 'success' }); setIp(''); reload(); } catch (e) { toast(e.message, true); }
  };
  return (
    <section className="box">
      <h2>Adresses bloquées</h2>
      <p>Les adresses qui multiplient les essais de mot de passe ou cherchent des failles sont bloquées automatiquement : 1 h, puis 6 h, 24 h et 7 jours en cas de récidive.</p>
      {d.bans.length ? (
        <div className="sec-list">
          {d.bans.map((b) => (
            <div key={b.ip} className="sec-row">
              <div className="grow"><b>{b.ip}</b><small>{`${b.reason} · ${b.until ? `jusqu’au ${when(b.until)}` : 'définitivement'}`}</small></div>
              <button className="btn btn-ghost btn-small f" onClick={async () => { await api('/api/admin/security/unban', { method: 'POST', body: { ip: b.ip } }); toast(`${b.ip} débloquée`, { type: 'success' }); reload(); }}>Débloquer</button>
            </div>
          ))}
        </div>
      ) : <p className="muted">Aucune adresse bloquée.</p>}
      {d.attempts.length ? (
        <div className="sec-list">
          <h3 className="sec-sub">Essais ratés aujourd’hui</h3>
          {d.attempts.map((x, i) => (
            <div key={`${x.ip}-${i}`} className="sec-row"><div className="grow"><b>{x.ip}</b><small>{`${KIND[`echec-${x.kind.split(':')[0]}`] || x.kind} · ${x.failsToday} échec(s)${x.lockedUntil ? ` · en pause jusqu’à ${new Date(x.lockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`}</small></div></div>
          ))}
        </div>
      ) : null}
      <div className="sec-inline">
        <input className="input" placeholder="Adresse IP à bloquer" maxLength={60} pattern="[0-9a-fA-F.:]+" value={ip} onChange={(e) => setIp(e.target.value)} />
        <button className="btn btn-small btn-ghost f" onClick={ban}>Bloquer</button>
      </div>
    </section>
  );
}

function Devices({ d, reload }) {
  const [all, setAll] = useState(false);
  const list = [...d.devices].sort((a, b) => (b.current - a.current) || (b.lastSeen - a.lastSeen));
  const shown = all ? list : list.slice(0, 6);
  return (
    <section className="box">
      <h2>Appareils connectés</h2>
      <p>Chaque appareil garde sa session 180 jours, ou 45 jours sans utilisation. Seule une empreinte des sessions est gardée sur le serveur.</p>
      <div className="sec-list">
        {shown.map((x) => (
          <div key={x.id} className="sec-row">
            <div className="grow"><b>{x.name}{x.current ? <em className="sec-me">cet appareil</em> : null}</b><small>{`${x.profile || 'Aucun profil'} · utilisé le ${when(x.lastSeen)} · connecté le ${when(x.created)}`}</small></div>
            {x.current ? null : <button className="btn btn-ghost btn-small f" onClick={async () => { await api(`/api/admin/devices/${x.id}`, { method: 'DELETE' }); toast('Appareil déconnecté', { type: 'success' }); reload(); }}>Déconnecter</button>}
          </div>
        ))}
      </div>
      {list.length > 6 ? <button className="btn btn-ghost btn-small f sec-more" onClick={() => setAll(!all)}>{all ? 'Afficher moins' : `Voir les ${list.length - 6} autres appareils`}</button> : null}
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-small btn-ghost f" onClick={async () => {
          if (!(await confirm('Déconnecter tous les autres appareils ? Ils devront retaper le mot de passe du foyer.', 'Déconnecter'))) return;
          await api('/api/admin/security/logout-others', { method: 'POST' }); toast('Autres appareils déconnectés', { type: 'success' }); reload();
        }}><Icon name="power" />Déconnecter tous les autres appareils</button>
      </div>
    </section>
  );
}

function Log({ d, reload }) {
  const [sev, setSev] = useState('all');
  const rows = d.log.filter((x) => sev === 'all' || x.severity === sev || (sev === 'warn' && x.severity === 'high'));
  return (
    <section className="box sec-log">
      <div className="sec-head">
        <h2>Journal de sécurité</h2>
        <div className="seg">{[['all', 'Tout'], ['warn', 'Attention et alertes'], ['high', 'Alertes']].map(([v, l]) => <button key={v} className={`seg-b f${sev === v ? ' on' : ''}`} onClick={() => setSev(v)}>{l}</button>)}</div>
      </div>
      <p className="muted">Connexions, essais ratés, requêtes suspectes, blocages et changements de droits. Les 5 000 derniers évènements sont gardés.</p>
      {rows.length ? (
        <div className="sec-table">
          {rows.slice(0, 200).map((x, i) => <div key={i} className={`sec-ev sv-${x.severity}`}><span className="sec-when">{when(x.at)}</span><span className="sec-kind">{KIND[x.kind] || x.kind}</span><span className="sec-detail">{x.detail}</span><span className="sec-ip">{x.ip || ''}</span></div>)}
        </div>
      ) : <p className="muted">Rien à signaler.</p>}
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-small btn-ghost f" onClick={async () => { if (!(await confirm('Vider le journal de sécurité ?', 'Vider'))) return; await api('/api/admin/security/log', { method: 'DELETE' }); reload(); }}>Vider le journal</button>
      </div>
    </section>
  );
}
