'use client';
// Administration du serveur : mise à jour, tâches planifiées, journal du serveur, clés API, webhooks, personnalisation
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useTitle, api, toast, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';

const when = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
const dur = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const TABS = [['maj', 'Mise à jour'], ['taches', 'Tâches planifiées'], ['journal', 'Journal du serveur'], ['cles', 'Clés API'], ['webhooks', 'Webhooks'], ['perso', 'Personnalisation']];
const confirm = (m, l) => shared().ui.confirmSheet(m, l);

export default function Server() {
  useTitle('Serveur');
  const { search } = useVenus();
  const admin = shared().app.state.profile.isAdmin;
  const [tab, setTab] = useState(() => { const t = (search && search.get('onglet')) || 'taches'; return TABS.some(([k]) => k === t) ? t : 'taches'; });
  useEffect(() => { shared().app.hideBoot(); }, []);
  if (!admin) return <main className="with-nav"><div className="empty"><h2>Réservé à l’administrateur</h2></div></main>;
  const Tab = { maj: UpdateTab, taches: TasksTab, journal: LogsTab, cles: KeysTab, webhooks: HooksTab, perso: BrandTab }[tab];
  return (
    <main className="with-nav page-in">
      <div className="page srv">
        <div className="page-head">
          <div className="head-left"><h1>Serveur</h1></div>
          <button className="btn btn-ghost btn-small f" onClick={() => go('/dashboard')}><Icon name="back" />Tableau de bord</button>
        </div>
        <div className="seg srv-tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} className={`seg-b f${k === tab ? ' on' : ''}`} role="tab" aria-selected={String(k === tab)} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="srv-body"><Tab /></div>
      </div>
    </main>
  );
}

// Données d'un onglet, rechargeables ; rafraîchies toutes les `every` ms si demandé
function useTab(path, every = 0) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    api(path).then((x) => { if (!dead) { setD(x); setErr(null); } }).catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [path, n]);
  useEffect(() => {
    if (!every) return undefined;
    const t = setTimeout(() => setN((x) => x + 1), every);
    return () => clearTimeout(t);
  }, [d, every]);
  return { d, err, reload: () => setN((x) => x + 1) };
}
const Loading = () => <p className="muted"><span className="mini-spin" /> Chargement…</p>;

function TasksTab() {
  const [fast, setFast] = useState(false);
  const { d: list, err, reload } = useTab('/api/admin/tasks', fast ? 3000 : 0);
  useEffect(() => { if (list) setFast(list.some((t) => t.running)); }, [list]);
  if (err) return <p className="error-text">{err}</p>;
  if (!list) return <Loading />;
  return (
    <>
      <p className="muted">Les travaux faits en arrière-plan. « Lancer » les démarre tout de suite.</p>
      <div className="task-list">
        {list.map((t) => (
          <div key={t.id} className={`task${t.running ? ' running' : ''}${t.lastError ? ' failed' : ''}`}>
            <div className="grow">
              <b>{t.label}</b><p>{t.description}</p>
              <small>{[t.when || (t.every ? `Toutes les ${Math.round(t.every / 3600e3)} h` : null), `Dernière fois : ${when(t.lastRun)}${t.lastRun ? ` (${dur(t.lastDuration)})` : ''}`, t.lastResult, t.nextRun ? `Prochaine : ${when(t.nextRun)}` : null].filter(Boolean).join(' · ')}</small>
              {t.lastError ? <small className="error-text">{`Erreur : ${t.lastError}`}</small> : null}
              {t.running ? <div className="task-bar"><i className={t.progress == null ? 'indet' : ''} style={{ width: `${t.progress != null ? Math.round(t.progress * 100) : 30}%` }} /></div> : null}
            </div>
            <button className="btn btn-small f" disabled={t.running} onClick={async (e) => { e.currentTarget.disabled = true; await api(`/api/admin/tasks/${t.id}/run`, { method: 'POST' }); toast(`« ${t.label} » lancée`); setTimeout(() => { setFast(true); reload(); }, 800); }}>{t.running ? 'En cours…' : 'Lancer'}</button>
          </div>
        ))}
      </div>
    </>
  );
}

function LogsTab() {
  const [level, setLevel] = useState('all');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t); }, [q]);
  const { d: lines, err } = useTab(`/api/admin/logs?level=${level}&q=${encodeURIComponent(qd)}`, qd ? 0 : 5000);
  return (
    <>
      <div className="log-tools">
        <div className="seg">{[['all', 'Tout'], ['warn', 'Avertissements'], ['error', 'Erreurs']].map(([v, l]) => <button key={v} className={`seg-b f${v === level ? ' on' : ''}`} onClick={() => setLevel(v)}>{l}</button>)}</div>
        <input className="input" placeholder="Rechercher dans le journal" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn btn-small btn-ghost f" href="/api/admin/logs?download=1" download=""><Icon name="down" />Télécharger</a>
      </div>
      <div className="log-view" role="log">
        {err ? <p className="error-text">{err}</p> : !lines ? <Loading /> : lines.length
          ? lines.map((l, i) => <div key={i} className={`log-line lv-${l.level}`}><time>{new Date(l.at).toLocaleTimeString('fr-FR')}</time><span>{l.text}</span></div>)
          : <p className="muted">Rien à afficher.</p>}
      </div>
      <p className="muted">Les 2 000 dernières lignes depuis le démarrage. Les mots de passe et jetons sont masqués.</p>
    </>
  );
}

function KeysTab() {
  const { d: keys, err, reload } = useTab('/api/admin/apikeys');
  const [name, setName] = useState('');
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await api('/api/admin/apikeys', { method: 'POST', body: { name: name.trim() } });
      setName('');
      openSheet('Nouvelle clé API', (
        <div>
          <p>Copiez-la maintenant : elle ne sera plus affichée.</p>
          <input className="input mono" value={r.key} readOnly onFocus={(ev) => ev.target.select()} />
          <div className="form-actions"><button className="btn btn-play f" onClick={async () => { try { await navigator.clipboard.writeText(r.key); toast('Clé copiée'); } catch { /* */ } }}><Icon name="copy" />Copier</button></div>
          <p className="muted">Exemple : <code>{`curl -X POST -H "X-Api-Key: ${r.key.slice(0, 8)}…" ${location.origin}/api/admin/scan`}</code></p>
        </div>
      ), { onClose: reload });
    } catch (e2) { toast(e2.message, true); }
  };
  if (err) return <p className="error-text">{err}</p>;
  if (!keys) return <Loading />;
  return (
    <>
      <p>Une clé API permet à un script ou une application de piloter Venus (lancer une analyse, lire la médiathèque…) avec les droits de l’administrateur. Envoyez-la dans l’en-tête <code>X-Api-Key</code>. Elle n’est affichée qu’une fois.</p>
      <form className="srv-inline" onSubmit={create}>
        <input className="input" placeholder="Nom de l’application (ex. : Home Assistant)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-small f" type="submit"><Icon name="plus" />Créer une clé</button>
      </form>
      {keys.length ? (
        <div className="sec-list">
          {keys.map((k) => (
            <div key={k.id} className="sec-row">
              <div className="grow"><b>{k.name}</b><small>{`…${k.hint} · créée le ${when(k.createdAt)} · utilisée : ${when(k.lastUsed)}${k.lastIp ? ` depuis ${k.lastIp}` : ''}`}</small></div>
              <button className="btn btn-ghost btn-small f" onClick={async () => { if (!(await confirm(`Supprimer la clé « ${k.name} » ? Les applications qui l’utilisent n’auront plus accès.`, 'Supprimer'))) return; await api(`/api/admin/apikeys/${k.id}`, { method: 'DELETE' }); reload(); }}>Supprimer</button>
            </div>
          ))}
        </div>
      ) : <p className="muted">Aucune clé.</p>}
    </>
  );
}

function HooksTab() {
  const { d, err, reload } = useTab('/api/admin/webhooks');
  if (err) return <p className="error-text">{err}</p>;
  if (!d) return <Loading />;
  const edit = (hk = null) => openSheet(hk ? 'Modifier le webhook' : 'Nouveau webhook', (close) => <HookForm hk={hk} events={d.events} close={() => { close(); reload(); }} />, { wide: true });
  const test = async (e, hk) => { const b = e.currentTarget; b.disabled = true; try { const r = await api(`/api/admin/webhooks/${hk.id}/test`, { method: 'POST' }); toast(`Test envoyé (réponse ${r.status})`, { type: 'success' }); } catch (x) { toast(x.message, true); } b.disabled = false; };
  return (
    <>
      <p>Prévenez d’autres services (Home Assistant, n8n, Gotify, Discord…) quand quelque chose se passe sur Venus.</p>
      <div className="srv-inline"><button className="btn btn-small f" onClick={() => edit()}><Icon name="plus" />Ajouter un webhook</button></div>
      {d.hooks.length ? (
        <div className="sec-list">
          {d.hooks.map((hk) => (
            <div key={hk.id} className="sec-row">
              <div className="grow">
                <b>{hk.name || hk.url}</b>
                <small>{`${hk.events.map((e) => d.events[e] || e).join(', ')}${hk.lastAt ? ` · dernier envoi ${when(hk.lastAt)}` : ''}`}</small>
                {hk.lastError ? <small className="error-text">{`Dernière erreur : ${hk.lastError}`}</small> : null}
              </div>
              <button className="btn btn-ghost btn-small f" onClick={(e) => test(e, hk)}>Tester</button>
              <button className="btn btn-ghost btn-small f" onClick={() => edit(hk)}>Modifier</button>
              <button className="btn btn-ghost btn-small f" aria-label="Supprimer" onClick={async () => { if (!(await confirm('Supprimer ce webhook ?', 'Supprimer'))) return; await api(`/api/admin/webhooks/${hk.id}`, { method: 'DELETE' }); reload(); }}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      ) : <p className="muted">Aucun webhook.</p>}
    </>
  );
}

function HookForm({ hk, events, close }) {
  const [url, setUrl] = useState(hk ? hk.url : '');
  const [name, setName] = useState(hk ? hk.name : '');
  const [secret, setSecret] = useState(hk ? hk.secret : '');
  const [evs, setEvs] = useState(new Set(hk ? hk.events : ['library.added']));
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!/^https?:\/\/.+/.test(url.trim())) { setErr('Adresse http:// ou https:// attendue'); return; }
    if (!evs.size) { setErr('Choisissez au moins un évènement'); return; }
    try { await api(hk ? `/api/admin/webhooks/${hk.id}` : '/api/admin/webhooks', { method: hk ? 'PUT' : 'POST', body: { url: url.trim(), name: name.trim(), secret, events: [...evs] } }); close(); }
    catch (e2) { setErr(e2.message); }
  };
  return (
    <form onSubmit={submit}>
      <div className="field"><label>Adresse</label><input className="input" value={url} placeholder="https://…" maxLength={2000} onChange={(e) => setUrl(e.target.value)} /></div>
      <div className="field"><label>Nom</label><input className="input" value={name} placeholder="Nom (facultatif)" maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Secret</label><input className="input" value={secret} placeholder="Secret (facultatif, pour la signature)" maxLength={200} onChange={(e) => setSecret(e.target.value)} /></div>
      <div className="field"><label>Évènements</label>
        <div className="perm-libs">
          {Object.entries(events).map(([k, l]) => (
            <label key={k} className="chk"><input type="checkbox" className="f" checked={evs.has(k)} onChange={(e) => { const n = new Set(evs); if (e.target.checked) n.add(k); else n.delete(k); setEvs(n); }} />{l}</label>
          ))}
        </div>
      </div>
      <p className="muted">Venus envoie un POST JSON {'{ event, at, server, data }'}. Avec un secret, l’en-tête X-Venus-Signature contient sha256=HMAC du corps.</p>
      <p className="error-text">{err}</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit">Enregistrer</button></div>
    </form>
  );
}

function BrandTab() {
  const { d, err } = useTab('/api/admin/branding');
  const msg = useRef(null);
  const css = useRef(null);
  const [error, setError] = useState('');
  if (err) return <p className="error-text">{err}</p>;
  if (!d) return <Loading />;
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/api/admin/branding', { method: 'PUT', body: { loginMessage: msg.current.value, customCss: css.current.value } }); toast('Enregistré : rechargez la page pour voir le CSS', { type: 'success', action: { label: 'Recharger', onClick: () => location.reload() } }); }
    catch (e2) { setError(e2.message); }
  };
  return (
    <form className="edit-form" onSubmit={submit}>
      <div className="field"><label>Message sur la page de connexion</label><textarea ref={msg} className="input" rows={3} maxLength={1000} placeholder="Ex. : Bienvenue chez nous ! Demandez le mot de passe à Sarah." defaultValue={d.loginMessage} /><small>Visible par tous, avant la connexion : n’y mettez pas le mot de passe.</small></div>
      <div className="field"><label>CSS personnalisé</label><textarea ref={css} className="input mono" rows={12} maxLength={100000} spellCheck={false} placeholder={'/* Exemple */\n.card .shot { border-radius: 16px; }'} defaultValue={d.customCss} /><small>Appliqué à toutes les pages, sur tous les appareils. Videz le champ pour revenir à l’apparence d’origine.</small></div>
      <p className="error-text">{error}</p>
      <div className="form-actions"><button className="btn btn-play f" type="submit">Enregistrer</button></div>
    </form>
  );
}

// Mise à jour : version installée, nouveautés disponibles, installation (ou commande à lancer sous Docker)
function UpdateTab() {
  const [force, setForce] = useState(0);
  const { d: u, err } = useTab(`/api/admin/update${force ? `?force=${force}` : ''}`);
  const [busy, setBusy] = useState(false);
  if (err) return <p className="error-text">{err}</p>;
  if (!u) return <Loading />;
  const fmtD = (x) => (x ? new Date(x).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
  const run = async () => {
    if (!(await confirm('Installer la mise à jour maintenant ? Venus redémarre ensuite (quelques secondes), les lectures en cours sont coupées.', 'Mettre à jour'))) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/update', { method: 'POST' });
      if (r.ok) { toast(r.message, { type: 'success', duration: 8000 }); setTimeout(() => location.reload(), 9000); } else { toast(r.message, true); setBusy(false); }
    } catch (e) { toast(e.message, true); setBusy(false); }
  };
  const recheck = <button className="btn btn-ghost btn-small f" onClick={() => setForce(Date.now())}><Icon name="refresh" />Vérifier à nouveau</button>;
  return (
    <section className="box upd-box">
      <h2>Mise à jour de Venus</h2>
      <p>{`Version installée : ${u.local ? `commit ${u.local}` : 'inconnue'}${u.remote ? ` · dernière publiée : ${u.remote}` : ''}.`}</p>
      {u.error ? <p className="error-text">{u.error}</p> : u.behind ? <p className="upd-new"><Icon name="spark" />{` ${u.behind}${u.more ? '+' : ''} nouveauté${u.behind > 1 ? 's' : ''} depuis votre version.`}</p> : <p className="upd-ok"><Icon name="check" /> Venus est à jour.</p>}
      {u.commits && u.commits.length ? <ul className="upd-list">{u.commits.slice(0, 15).map((c, i) => <li key={i}><b>{c.title}</b><small>{` ${fmtD(c.date)}`}</small></li>)}</ul> : null}
      {u.behind && u.canSelfUpdate ? <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-play f" disabled={busy} onClick={run}><Icon name="refresh" />{busy ? 'Mise à jour…' : 'Mettre à jour maintenant'}</button>{recheck}</div>
        : u.behind ? (
          <div className="upd-docker">
            <p>Venus tourne sous Docker : la mise à jour se lance depuis la machine qui l’héberge (SSH ou terminal), avec cette commande :</p>
            <code className="cmd">{u.command}</code>
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-small f" onClick={async () => { try { await navigator.clipboard.writeText(u.command); toast('Commande copiée'); } catch { toast('Sélectionnez la commande et copiez-la', true); } }}><Icon name="copy" />Copier la commande</button>{recheck}</div>
          </div>
        ) : <div className="form-actions" style={{ justifyContent: 'flex-start' }}>{recheck}</div>}
    </section>
  );
}
