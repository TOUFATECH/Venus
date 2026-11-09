'use client';
// Réglages, partie administrateur : médiathèques, TV, infos et affiches, notes, demandes, foyer,
// notifications, lecture, performances, mise à jour, serveur et sauvegardes
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { api, toast, go } from '../../lib/hooks';
import { Icon, Avatar } from '../Icon';
import { openSourceWizard } from './SourceWizard';
import { fixMatch } from './Details';
import {
  Field, Select, Actions, Ext, Busy, Switch, SetSwitch, putSettings, Advice, PasswordMeter, confirm,
  inviteSheet, editProfile, choosePoster, openDuplicates, openRename, importArchive, openTrash, openBroken,
} from './SettingsSheets';

const HW = [['auto', 'Automatique (recommandé)'], ['nvenc', 'NVIDIA (NVENC)'], ['vaapi', 'Intel / AMD (VA-API)'], ['qsv', 'Intel Quick Sync'], ['amf', 'AMD (Windows)'], ['videotoolbox', 'Apple (Mac)'], ['v4l2m2m', 'Raspberry Pi'], ['none', 'Processeur uniquement']];
const LIB_ICON = { movies: 'film', shows: 'tv', anime: 'spark', clips: 'note', iptv: 'live', music: 'note', photos: 'image', books: 'book' };
const SOURCE_TYPES = [
  ['movies', 'Films', 'Un film par fichier, ou un dossier par film.'],
  ['shows', 'Séries', 'Un dossier par série, puis un dossier par saison (S01E01 dans le nom).'],
  ['anime', 'Animés', 'Rangés comme des séries : un dossier par animé, épisodes numérotés.'],
  ['clips', 'Clips', 'Clips musicaux ou vidéos courtes. Nom conseillé : « Artiste - Titre ».'],
  ['music', 'Musique', 'Un dossier par artiste, puis par album. Pochette : cover.jpg ; paroles : fichier .lrc du même nom.'],
  ['photos', 'Photos', 'Chaque dossier devient un album.'],
  ['books', 'Livres', 'EPUB, PDF, bandes dessinées CBZ, et livres audio (un dossier par livre, ou un fichier .m4b).'],
  ['iptv', 'TV en direct (IPTV)', 'Collez l’adresse M3U fournie par votre abonnement IPTV, ou le chemin d’un fichier .m3u sur le serveur.'],
];
const fmtBytes = (b) => `${(b / 1073741824).toFixed(1).replace('.', ',')} Go`;
const when = (t, o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => new Date(t).toLocaleString('fr-FR', o);
const libLabel = (l) => (String(l.path).startsWith('venus:') ? l.name : l.path);

// Petit chargement propre à un bloc (données qui ne viennent pas de /api/admin)
function useLoad(path, deps = []) {
  const [r, setR] = useState({ data: undefined, error: null });
  const [n, setN] = useState(0);
  useEffect(() => { let dead = false; api(path).then((data) => !dead && setR({ data, error: null })).catch((error) => !dead && setR({ data: undefined, error })); return () => { dead = true; }; }, [path, n, ...deps]);
  return { ...r, reload: () => setN((x) => x + 1), set: (data) => setR({ data, error: null }) };
}

// ---------------------------------------------------------------- médiathèques et TV
export function LibraryBox({ a, refresh, iptv }) {
  const s = a.scan;
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const COUNTS = { movies: [a.counts.movie, 'film'], shows: [a.counts.show, 'série'], anime: [null, 'animé'], clips: [a.counts.clip, 'clip'], iptv: [a.counts.channel, 'chaîne'], music: [a.counts.track, 'titre'], photos: [a.counts.photo, 'photo'], books: [a.counts.book, 'livre'] };
  const last = (s.lastAdded || []).slice(0, 6);
  const add = (type) => openSourceWizard(type, refresh);
  const scan = async (force) => { await api('/api/admin/scan', { method: 'POST', body: force ? { force: true } : {} }); toast(force ? 'Analyse complète lancée' : 'Recherche des nouveautés lancée'); refresh(); };
  return (
    <section className="box libs-box">
      <div className="libs-top">
        {iptv ? (
          <div><h2>Listes de chaînes</h2><p>Les chaînes gratuites (France et Outre-mer, Mayotte La 1ère en tête) sont déjà là. Vous pouvez ajouter la liste M3U de votre abonnement. Chaque chaîne est vérifiée chaque jour : celles qui ne donnent pas d’images sont cachées.</p></div>
        ) : (
          <div><h2>Bibliothèques</h2><p>Indiquez où se trouvent vos films, séries, animés et clips : un dossier de ce serveur ou un partage réseau (NAS, PC Windows). Venus les surveille et chaque nouveau fichier apparaît tout seul.</p></div>
        )}
        {iptv ? null : <div className="auto-pill"><span className="dot" />Détection automatique active</div>}
      </div>
      {a.runtime && a.runtime.mount ? <Advice adv={a.runtime.mount} /> : null}
      {s.running ? <div className="scan-line"><p>{`${s.phase}… ${s.total ? `${s.done}/${s.total}` : ''}`}</p><div className="progress-line"><i style={{ width: `${pct}%` }} /></div></div> : null}
      {s.error ? <p className="error-text">{s.error}</p> : null}
      <div className="lib-grid">
        {SOURCE_TYPES.filter(([t]) => (iptv ? t === 'iptv' : t !== 'iptv')).map(([type, label, hint]) => {
          const libs = a.libraries.filter((l) => l.type === type);
          const [n, word] = COUNTS[type] || [null, ''];
          return (
            <div key={type} className={`lib-card${libs.length ? '' : ' is-empty'}`}>
              <div className="lib-head"><Icon name={LIB_ICON[type]} /><b>{label}</b>{libs.length && n ? <small>{`${n} ${word}${n > 1 ? 's' : ''}`}</small> : null}</div>
              {libs.length ? libs.map((l) => (
                <div key={l.id} className="list-row">
                  <span className={`dot${l.exists ? '' : ' off'}`} title={l.exists ? 'Accessible' : 'Inaccessible'} />
                  <div className="grow">
                    {l.network ? <span className="net-line"><Icon name="wifi" />{l.network.address}</span> : <span>{libLabel(l)}</span>}
                    {l.network && l.network.error ? <small className="warn">{l.network.error}</small>
                      : !l.exists ? <small className="warn">{l.network ? 'Partage injoignable' : 'Dossier introuvable'}</small>
                        : type !== 'iptv' && !l.writable ? <small className="muted">Lecture seule</small> : null}
                  </div>
                  {l.network && !l.exists ? <Busy onClick={async () => { try { await api(`/api/admin/libraries/${l.id}/reconnect`, { method: 'POST' }); toast('Partage reconnecté'); } catch (e) { toast(e.message, true); } refresh(); }}>Reconnecter</Busy> : null}
                  <button className="btn btn-small btn-danger f" aria-label={`Retirer ${libLabel(l)}`} onClick={async () => {
                    if (!(await confirm(`Retirer « ${libLabel(l)} » de Venus ? Vos fichiers ne sont pas supprimés.`, 'Retirer'))) return;
                    await api(`/api/admin/libraries/${l.id}`, { method: 'DELETE' }); refresh();
                  }}>Retirer</button>
                </div>
              )) : <p className="lib-hint">{hint}</p>}
              <button className="btn btn-small f" onClick={() => add(type)}><Icon name="plus" />{type === 'iptv' ? 'Ajouter une liste IPTV' : 'Ajouter un emplacement'}</button>
              {type === 'iptv' ? <IptvTools libs={libs} refresh={refresh} /> : null}
            </div>
          );
        })}
      </div>
      {last.length ? <div className="last-added"><h3>Derniers médias détectés</h3><ul>{last.map((x, i) => <li key={i}><b>{x.title}</b><small>{when(x.at)}</small></li>)}</ul></div> : null}
      <Actions>
        <button className="btn btn-small f" onClick={openDuplicates}><Icon name="grid4" />Doublons</button>
        <button className="btn btn-small f" onClick={openTrash}><Icon name="trash" />Corbeille</button>
        <button className="btn btn-small f" onClick={openBroken}><Icon name="eye" />Fichiers abîmés</button>
        <button className="btn btn-small f" onClick={openRename}><Icon name="edit" />Renommer les fichiers</button>
        <button className="btn btn-small f" disabled={s.running} onClick={() => scan(false)}>Rechercher les nouveautés</button>
        <button className="btn btn-small btn-ghost f" disabled={s.running} onClick={() => scan(true)}>Tout réanalyser</button>
      </Actions>
      {s.lastScan ? <p className="lib-foot">{`Dernière vérification : ${new Date(s.lastScan).toLocaleString('fr-FR')}. Les dossiers du serveur sont surveillés en continu, les partages réseau vérifiés toutes les 10 minutes.`}</p> : null}
    </section>
  );
}

// TV en direct : chaînes gratuites (France et Outre-mer) et vérification des images de chaque chaîne
function IptvTools({ libs, refresh }) {
  const h = useLoad('/api/admin/channels/health');
  const [checking, setChecking] = useState(false);
  const has = libs.some((l) => l.path === 'venus:chaines-gratuites');
  const r = h.data;
  const status = checking ? 'Vérification en cours…' : h.error ? '' : !r ? 'État des chaînes…'
    : r.check.running ? `Vérification en cours : ${r.check.done}/${r.check.total}`
      : r.check.offline ? 'Dernière vérification : aucune chaîne joignable. Le serveur de Venus n’a sans doute pas accès à Internet (rien n’a été caché).'
        : r.n ? `${r.ok || 0} chaîne(s) fonctionnent${r.bad ? `, ${r.bad} hors service (cachées)` : ''}${r.todo ? `, ${r.todo} pas encore vérifiée(s)` : ''}` : 'Aucune chaîne';
  return (
    <div className="iptv-tools">
      <small className="muted">{status}</small>
      <Actions wrap>
        <Busy className="btn btn-small btn-ghost f" onClick={async () => {
          try { await api('/api/admin/channels/check', { method: 'POST', body: {} }); toast('Vérification lancée : chaque chaîne est ouverte pour voir si elle donne des images'); setChecking(true); } catch (e) { toast(e.message, true); }
        }}><Icon name="refresh" />Vérifier les chaînes</Busy>
        {has ? null : (
          <button className="btn btn-small btn-ghost f" onClick={async () => {
            try { await api('/api/admin/libraries', { method: 'POST', body: { type: 'iptv', name: 'Chaînes gratuites (France et Outre-mer)', path: 'venus:chaines-gratuites' } }); toast('Chaînes gratuites ajoutées, chargement en cours'); refresh(); } catch (e) { toast(e.message, true); }
          }}><Icon name="live" />Ajouter les chaînes gratuites</button>
        )}
      </Actions>
      <WorldLists refresh={refresh} />
    </div>
  );
}

// Chaînes du monde (iptv-org) : listes par pays, langue ou catégorie, réunies sans doublon
const LIST_LABEL = { countries: 'Pays', languages: 'Langue', categories: 'Catégorie', regions: 'Région', subdivisions: 'Région', cities: 'Ville' };
function WorldLists({ refresh }) {
  const d = useLoad('/api/admin/iptv-org');
  const [lists, setLists] = useState(null);
  const [add, setAdd] = useState('');
  const cur = lists || (d.data && d.data.lists) || [];
  if (!d.data) return null;
  const norm = (v) => { const m = /(countries|languages|categories|regions|subdivisions|cities)\/([a-z0-9_-]{2,40})(\.m3u)?\s*$/i.exec(v.trim()); return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null; };
  const push = () => {
    const v = norm(add);
    if (!v) { toast('Collez une adresse iptv-org, par exemple https://iptv-org.github.io/iptv/countries/fr.m3u', true); return; }
    if (!cur.includes(v)) setLists([...cur, v]);
    setAdd('');
  };
  const save = async () => {
    try { await api('/api/admin/iptv-org', { method: 'PUT', body: { lists: cur } }); toast('Listes enregistrées : les chaînes se chargent et seront vérifiées une par une', { type: 'success' }); setLists(null); d.reload && d.reload(); refresh(); }
    catch (e) { toast(e.message, true); }
  };
  return (
    <div className="world-lists">
      <h3 className="box-sub">Chaînes du monde (iptv-org)</h3>
      <p className="muted">Les listes choisies sont réunies sans doublon (ni entre elles, ni avec vos autres chaînes), rangées par catégorie, puis vérifiées : les chaînes qui ne donnent pas d’image sont cachées.</p>
      <div className="chips">
        {cur.map((l) => (
          <span key={l} className="chip on">{`${LIST_LABEL[l.split('/')[0]] || ''} : ${l.split('/')[1]}`}
            <button className="chip-x f" type="button" aria-label={`Retirer ${l}`} onClick={() => setLists(cur.filter((x) => x !== l))}>×</button>
          </span>
        ))}
      </div>
      <form className="world-add" onSubmit={(e) => { e.preventDefault(); push(); }}>
        <input className="input" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="https://iptv-org.github.io/iptv/countries/be.m3u" aria-label="Adresse d’une liste iptv-org" />
        <button className="btn btn-small btn-ghost f" type="submit">Ajouter</button>
        <button className="btn btn-small f" type="button" disabled={!lists} onClick={save}>Enregistrer et charger</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- performances (s'active tout seul selon le matériel et la place)
let perfCache = null;
const GB = 1024 ** 3;
const go1 = (n) => `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1).replace('.', ',')} Go`;
export function PerfBoxes() {
  const [d, setD] = useState(perfCache);
  const [error, setError] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const load = async () => { try { perfCache = await api('/api/admin/perf'); setD(perfCache); } catch (e) { setError(e); } };
  useEffect(() => { load(); const iv = setInterval(() => { if (!document.hidden) load(); }, 10000); return () => clearInterval(iv); }, []);
  if (error && !d) return <section className="box"><p className="error-text">{error.message}</p></section>;
  if (!d) return <section className="box"><p className="muted">Chargement…</p></section>;
  const o = d.optimize; const t = d.transcode; const n = d.nas;
  const STATE = { ready: 'Prête', waiting: 'En attente', off: 'Désactivée' };
  const upd = (x) => { perfCache = x; setD(x); };
  return (
    <>
      <section className="box">
        <h2>Carte graphique et mémoire</h2>
        <dl className="kv">
          <dt>Conversion vidéo</dt><dd>{d.hw.type !== 'none' ? <span className="ok-text">{`${d.hw.label} : activée`}</span> : 'Processeur (aucune carte graphique disponible)'}</dd>
          <dt>Fichiers de conversion</dt><dd>{t.ram ? `En mémoire vive (${go1(t.ram.free)} libres sur ${go1(t.ram.total)})${t.using === 'ram' ? '' : ' — pleine pour l’instant, le disque prend le relais'}` : 'Sur le disque'}</dd>
        </dl>
        {d.hw.hint ? <p className="warn-text">{d.hw.hint}</p> : null}
        {!t.ram ? <p className="muted small">Pour convertir en mémoire vive (plus rapide), lancez « bash update.sh » dans le dossier de Venus : il l’active tout seul si la machine a au moins 6 Go de mémoire, et ajoute la carte graphique si elle existe.</p> : null}
      </section>
      <section className="box">
        <h2>Versions optimisées</h2>
        <p className="muted">Pour les vidéos que vos appareils ne lisent pas tels quels (HEVC, 10 bits, son DTS…), Venus prépare une copie H.264 + AAC : elles démarrent tout de suite, sans conversion. Automatique quand il y a de la place (50 Go et 15 % libres) ; avec la carte graphique dès que personne ne regarde, sinon la nuit.</p>
        <div className="seg" role="radiogroup" aria-label="Versions optimisées">
          {[['auto', 'Automatique'], ['on', 'Toujours'], ['off', 'Jamais']].map(([k, label]) => (
            <button key={k} className={`seg-b f${o.mode === k ? ' on' : ''}`} role="radio" aria-checked={String(o.mode === k)} onClick={async () => { try { upd({ ...d, optimize: await api('/api/admin/perf/optimize', { method: 'POST', body: { mode: k } }) }); } catch (e) { toast(e.message, true); } }}>{label}</button>
          ))}
        </div>
        <dl className="kv">
          <dt>État</dt><dd>{`${STATE[o.state] || o.state} : ${o.why}`}</dd>
          <dt>Copies prêtes</dt><dd>{`${o.count} (${go1(o.used)} sur ${go1(o.budget)} réservés)`}</dd>
          {o.current ? <><dt>En cours</dt><dd>{`${o.current.title} — ${o.current.pct} %`}</dd></> : null}
          {o.queue ? <><dt>En attente</dt><dd>{`${o.queue} vidéo(s)`}</dd></> : null}
        </dl>
        <div className="btn-row">
          <button className="btn btn-small f" onClick={async () => { await api('/api/admin/perf/optimize', { method: 'POST', body: { run: true } }); toast('Préparation lancée (si les conditions le permettent)'); setTimeout(load, 1500); }}><Icon name="play" />Préparer maintenant</button>
          {o.count ? <button className="btn btn-small btn-ghost f" onClick={async () => { if (!(await confirm(`Effacer les ${o.count} copies (${go1(o.used)}) ?`, 'Effacer'))) return; await api('/api/admin/perf/optimize', { method: 'POST', body: { clear: true } }); load(); }}><Icon name="trash" />Effacer les copies</button> : null}
        </div>
      </section>
      <section className="box">
        <h2>Santé du NAS</h2>
        <p className="muted">Vitesse de lecture réelle de chaque bibliothèque, comparée aux vidéos les plus lourdes. Mesurée toutes les 6 heures ; vous êtes prévenu si le partage devient trop lent ou injoignable.</p>
        {n && n.libraries.length ? (
          <div className="nas-list">
            {n.libraries.map((l, i) => (
              <div key={i} className={`nas-row${l.ok ? '' : ' bad'}`}>
                <span className="nas-dot" aria-hidden="true" />
                <div><b>{l.name}</b><small>{l.error || l.verdict}</small><code>{l.path}</code></div>
                {l.readMbps != null ? <span className="nas-speed">{`${String(l.readMbps).replace('.', ',')} Mo/s`}</span> : null}
              </div>
            ))}
          </div>
        ) : <p className="muted">Pas encore mesuré.</p>}
        {n ? <p className="muted small">{`Dernière mesure : ${new Date(n.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`}</p> : null}
        <button className="btn btn-small f" disabled={measuring} onClick={async () => { setMeasuring(true); try { upd({ ...d, nas: await api('/api/admin/perf/nas', { method: 'POST' }) }); } catch (err) { toast(err.message, true); } setMeasuring(false); }}><Icon name="refresh" />{measuring ? 'Mesure en cours…' : 'Mesurer maintenant'}</button>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- mise à jour de Venus
export function UpdateBox() {
  const [u, setU] = useState(undefined); // undefined : chargement ; null : redémarrage en cours
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showCmd, setShowCmd] = useState(null);
  const [checking, setChecking] = useState(false);
  const watching = useRef(0);
  useEffect(() => { api('/api/admin/update').then(setU).catch(setError); return () => clearInterval(watching.current); }, []);
  // Pendant la mise à jour : on suit l'état, puis on attend que Venus revienne pour recharger la page
  const follow = () => {
    clearInterval(watching.current);
    let lost = false;
    watching.current = setInterval(async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (!r.ok) throw new Error();
        if (lost) { clearInterval(watching.current); toast('Venus est à jour : rechargement…', { type: 'success' }); setTimeout(() => location.reload(), 1200); return; }
        const x = await api('/api/admin/update');
        if (x.updater && x.updater.status && x.updater.status.state === 'error') { clearInterval(watching.current); setBusy(false); setU(x); toast('La mise à jour a échoué : voir le journal', true); }
        else { setBusy(true); setU(x); }
      } catch { lost = true; setU(null); }
    }, 4000);
  };
  const up = (u && u.updater) || {};
  const st = up.status && up.status.state;
  const running = busy || up.pending || st === 'queued' || st === 'running';
  useEffect(() => { if (u && running && !watching.current) follow(); }, [u, running]);
  if (error) return <section className="box upd-box"><h2>Mise à jour de Venus</h2><p className="error-text">{error.message}</p></section>;
  if (u === undefined) return <section className="box upd-box"><h2>Mise à jour de Venus</h2><p className="muted">Recherche de nouveautés…</p></section>;
  if (u === null) return <section className="box upd-box"><h2>Mise à jour de Venus</h2><p className="upd-new"><Icon name="refresh" /> Venus redémarre avec la nouvelle version… la page se recharge toute seule.</p></section>;
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
  const command = showCmd || u.command;
  const start = async () => {
    if (!(await confirm('Installer la mise à jour maintenant ? Venus se reconstruit puis redémarre (quelques minutes) ; les lectures en cours seront coupées.', 'Mettre à jour'))) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/update', { method: 'POST' });
      if (r.ok) { toast(r.message, { type: 'success', duration: 8000 }); setU({ ...u, updater: { ...up, status: { state: 'queued' } } }); follow(); }
      else { toast(r.message, true); setBusy(false); setShowCmd(r.command || u.command); }
    } catch (e) { toast(e.message, true); setBusy(false); }
  };
  const pref = (key) => async (e) => { const on = e.target.checked; try { await api('/api/admin/update/prefs', { method: 'PUT', body: { [key]: on } }); toast('Préférence enregistrée'); } catch (err) { toast(err.message, true); e.target.checked = !on; } };
  return (
    <section className="box upd-box">
      <h2>Mise à jour de Venus</h2>
      <p>{`Version installée : ${u.local ? u.local : 'inconnue'}${u.remote ? ` · dernière publiée : ${u.remote}` : ''}`}</p>
      {u.error ? <p className="error-text">{u.error}</p>
        : running ? <p className="upd-new"><Icon name="refresh" />{st === 'running' ? ' Mise à jour en cours : récupération, construction puis redémarrage…' : ' Mise à jour demandée : elle démarre dans quelques secondes…'}</p>
          : st === 'error' ? <p className="error-text">La dernière mise à jour a échoué (journal ci-dessous).</p>
            : u.behind ? <p className="upd-new"><Icon name="spark" />{` ${u.behind}${u.more ? '+' : ''} nouveauté${u.behind > 1 ? 's' : ''} disponible${u.behind > 1 ? 's' : ''}`}</p>
              : <p className="upd-ok"><Icon name="check" /> Venus est à jour.</p>}
      {u.commits && u.commits.length ? <ul className="upd-list">{u.commits.slice(0, 15).map((c, i) => <li key={i}><b>{c.title}</b><small>{` ${fmtD(c.date)}`}</small></li>)}</ul> : null}
      <div className="btn-row">
        {u.behind || running ? <button className="btn btn-play f" disabled={running} onClick={start}><Icon name={running ? 'refresh' : 'download'} />{running ? 'Mise à jour en cours…' : 'Mettre à jour maintenant'}</button> : null}
        <button className="btn btn-ghost btn-small f" disabled={checking} onClick={async () => { setChecking(true); try { setU(await api('/api/admin/update?force=1')); } catch (e) { toast(e.message, true); } setChecking(false); }}><Icon name="refresh" />Vérifier maintenant</button>
      </div>
      {showCmd || (u.behind && !u.canSelfUpdate) ? (
        <div className="upd-docker">
          <p>{u.docker ? 'Pour que le bouton fasse tout seul la mise à jour, lancez une fois cette commande sur la machine de Venus (elle installe aussi le petit compagnon de mise à jour) :' : 'Lancez cette commande sur la machine de Venus :'}</p>
          <code className="cmd">{command}</code>
          <button className="btn btn-small f" onClick={async () => { try { await navigator.clipboard.writeText(command); toast('Commande copiée'); } catch { toast('Sélectionnez la commande et copiez-la', true); } }}><Icon name="copy" />Copier la commande</button>
        </div>
      ) : null}
      <h3 className="box-sub">Préférences</h3>
      <Switch label="Me prévenir quand une nouvelle version sort" hint="Sur vos appareils, et sur Telegram, ntfy ou Discord s’ils sont reliés." checked={up.notify !== false} onChange={pref('notify')} />
      <Switch label="Mettre à jour automatiquement la nuit (vers 4 h)" hint={up.alive ? 'Seulement s’il y a du nouveau.' : 'Disponible après avoir lancé une fois « bash update.sh » sur la machine.'} checked={!!up.night} disabled={!up.alive} onChange={pref('night')} />
      <p className="muted small">{up.alive ? '● Compagnon de mise à jour actif : le bouton fait tout tout seul.' : u.docker ? '○ Compagnon de mise à jour absent.' : ''}</p>
      {up.log && (st === 'error' || st === 'done' || running) ? <details className="upd-log" open={st === 'error'}><summary>Journal de la dernière mise à jour</summary><pre>{up.log}</pre></details> : null}
    </section>
  );
}

// ---------------------------------------------------------------- lecture et conversion
export function PlaybackBox({ a, refresh }) {
  const hw = useRef(null);
  const maxS = useRef(null);
  return (
    <section className="box">
      <h2>Lecture et conversion</h2>
      <p>Venus lit vos fichiers tels quels dès que l’appareil le permet. Sinon, il les convertit à la volée avec la puce graphique détectée.</p>
      <dl className="kv">
        <dt>Accélération</dt><dd>{a.hw.label}</dd>
        <dt>HDR → SDR</dt><dd>{a.hw.tonemap ? 'Disponible' : 'Non disponible'}</dd>
        <dt>Processeur</dt><dd>{`${a.system.cpus} cœurs, charge ${a.system.load.toFixed(1)}`}</dd>
        <dt>Mémoire libre</dt><dd>{`${fmtBytes(a.system.memFree)} / ${fmtBytes(a.system.memTotal)}`}</dd>
      </dl>
      {a.runtime ? <Advice adv={a.runtime.gpu} /> : null}
      {a.hw.tested.length ? <p style={{ fontSize: '.85rem' }}>{`Testé : ${a.hw.tested.map((t) => `${t.label} ${t.ok ? '✓' : '✗'}`).join(', ')}`}</p> : null}
      <Field label="Accélération matérielle"><Select ref={hw} opts={HW} value={a.settings.hwaccel} /></Field>
      <Field label="Lectures simultanées maximum"><input ref={maxS} className="input" type="number" min={1} max={20} defaultValue={a.settings.maxSessions} /></Field>
      <SetSwitch label="Repérer les génériques des séries et animés (analyse audio en arrière-plan)" k="detectSegments" checked={a.settings.detectSegments !== false} msg="Réglage enregistré" />
      <Field label="Vignettes d’aperçu de la barre de lecture" hint="Une image toutes les 10 secondes, au survol de la barre. Environ 1 Mo par heure de vidéo.">
        <Select opts={[['auto', 'Préparées en arrière-plan pour toute la médiathèque'], ['play', 'Préparées à la première lecture seulement'], ['off', 'Désactivées']]} value={a.settings.trickplay || 'auto'}
          onChange={async (e) => { await putSettings({ trickplay: e.target.value }); toast('Réglage enregistré'); }} />
      </Field>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Changer de machine</label>
        <Actions>
          <a className="btn btn-small f" href="/api/admin/export" download=""><Icon name="down" />Exporter tout (base + images)</a>
          <button className="btn btn-small btn-ghost f" onClick={importArchive}><Icon name="upload" />Importer une archive</button>
        </Actions>
        <small>L’export contient profils, vus, listes, réglages et affiches choisies, jamais les vidéos. Sur la nouvelle machine : installez Venus, puis « Importer ».</small>
      </div>
      <Actions>
        <Busy busy="Test du matériel…" onClick={async () => { try { await putSettings({ hwaccel: hw.current.value, maxSessions: Number(maxS.current.value) }); toast('Réglages enregistrés'); } catch (e) { toast(e.message, true); } refresh(); }}>Enregistrer</Busy>
      </Actions>
      <h2 style={{ marginTop: 18 }}>{`En cours de lecture (${a.sessions.length})`}</h2>
      {a.sessions.length ? a.sessions.map((s, i) => (
        <div key={i} className="list-row">
          <span className={`dot${s.paused ? ' off' : ''}`} />
          <div className="grow"><b>{s.item}</b><span>{`${s.reason}, ${s.pipeline}${s.target ? `, ${s.target.height}p ${(s.target.bitrate / 1e6).toFixed(1)} Mb/s` : ''}${s.paused ? ', en avance, en pause' : ''}`}</span></div>
        </div>
      )) : <p style={{ margin: 0 }}>Aucune conversion en cours. Les lectures directes n’apparaissent pas ici : elles ne coûtent rien au serveur.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- foyer : profils, invitations, appareils
export function ProfilesBox({ a, refresh }) {
  return (
    <section className="box">
      <h2>Profils</h2>
      <p>Compte local : créé ici, utilisable tout de suite sur les appareils de la maison. Invitation : la personne reçoit un lien par e-mail pour préparer son compte (nom, code PIN) et connecter son appareil sans le mot de passe du foyer. Un profil enfant ne voit que les titres adaptés à son âge.</p>
      {a.profiles.map((p) => (
        <div key={p.id} className="list-row">
          <Avatar profile={p} cls="sm" />
          <div className="grow"><b>{p.name}</b><span>{[p.isAdmin ? 'Administrateur' : null, p.maxAge != null ? `Jusqu’à ${p.maxAge} ans` : null, p.hasPin ? 'Code PIN' : null].filter(Boolean).join(', ') || 'Profil standard'}</span></div>
          <button className="btn btn-small f" onClick={() => editProfile(p, false, refresh)}>Modifier</button>
        </div>
      ))}
      <Actions wrap>
        <button className="btn btn-small f" onClick={() => editProfile(null, false, refresh)}><Icon name="plus" />Créer un compte local</button>
        <button className="btn btn-small f" onClick={() => inviteSheet(null, refresh)}><Icon name="send" />Inviter par e-mail</button>
      </Actions>
      <Invites refresh={refresh} sig={JSON.stringify(a.profiles)} />
      <SetSwitch label="Montrer aux enfants les titres sans classification" k="kidsAllowUnrated" checked={a.settings.kidsAllowUnrated} msg="Enregistré" style={{ marginTop: 10 }} />
    </section>
  );
}

// Invitations en attente (lien envoyé par e-mail) : renvoyer, copier le lien, annuler
function Invites({ refresh, sig }) {
  const { data: d, reload } = useLoad('/api/admin/invites', [sig]);
  if (!d) return <div className="invites" />;
  const pend = d.invites.filter((i) => i.state !== 'used').slice(0, 20);
  const done = () => { reload(); refresh(); };
  return (
    <div className="invites">
      {!d.smtp ? <p className="warn-text small">Pour envoyer les invitations par e-mail, configurez le serveur d’e-mails (Sécurité → E-mails). Sans lui, Venus vous donne le lien à transmettre vous-même.</p> : null}
      {pend.length ? <h3 className="box-sub">Invitations en attente</h3> : null}
      {pend.map((i) => (
        <div key={i.profileId} className="list-row invite-row">
          <div className="grow"><b>{i.name}</b><span>{`${i.email} · ${i.state === 'expired' ? 'lien expiré' : i.sentAt ? `envoyé le ${new Date(i.sentAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : i.error ? `non envoyé (${i.error})` : 'en attente'}`}</span></div>
          <button className="btn btn-small f" onClick={() => inviteSheet({ id: i.profileId, name: i.name, email: i.email }, done)}><Icon name="send" />Renvoyer</button>
          <button className="btn btn-small btn-ghost btn-icon f" title="Annuler l’invitation" aria-label={`Annuler l’invitation de ${i.name}`} onClick={async () => { await api(`/api/admin/invites/${i.profileId}`, { method: 'DELETE' }); toast('Invitation annulée'); done(); }}><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

const deviceName = (ua = '') => {
  if (/Tizen/i.test(ua)) return 'TV Samsung';
  if (/Web0S|webOS/i.test(ua)) return 'TV LG';
  if (/AFT/i.test(ua)) return 'Fire TV';
  if (/Android TV|GoogleTV|BRAVIA/i.test(ua)) return 'Android TV';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Téléphone Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Appareil';
};
export function DevicesBox({ a }) {
  return (
    <section className="box">
      <h2>Appareils connectés</h2>
      <p>Derniers appareils ayant utilisé Venus.</p>
      {a.devices.slice(0, 10).map((d, i) => <div key={i} className="list-row"><div className="grow"><b>{deviceName(d.device)}</b><span>{`${d.profile || 'Aucun profil'}, ${new Date(d.last_seen).toLocaleString('fr-FR')}`}</span></div></div>)}
    </section>
  );
}

// ---------------------------------------------------------------- notes des sites (OMDb, Simkl, Trakt)
function KeyRow({ label, hint, placeholder, k, configured, save }) {
  const inp = useRef(null);
  return (
    <>
      <Field label={label} hint={hint}><input ref={inp} className="input" placeholder={placeholder} /></Field>
      <Actions>
        <Busy onClick={() => inp.current.value.trim() && save({ [k]: inp.current.value.trim() }).then(() => { inp.current.value = ''; })}>Enregistrer</Busy>
        {configured ? <Busy className="btn btn-small btn-ghost f" onClick={() => save({ [k]: '' })}>Retirer</Busy> : null}
      </Actions>
    </>
  );
}
export function RatingsBox({ a, refresh }) {
  const [err, setErr] = useState('');
  const S = a.settings;
  const save = async (body) => { setErr(''); try { await putSettings(body); toast('Enregistré : les notes se mettent à jour en arrière-plan'); refresh(); } catch (e) { setErr(e.message); } };
  const kept = (on, what) => (on ? `${what} enregistré${what === 'Clé' ? 'e' : ''} (laisser vide pour conserver)` : null);
  return (
    <section className="box" id="ratings">
      <h2>Notes des sites</h2>
      <p>Venus affiche les notes sur chaque fiche et permet de trier par note. AniList et MyAnimeList (animés) fonctionnent sans clé ; TMDB utilise la clé des affiches.</p>
      <div className="src-list">
        <span className="src ok">AniList</span><span className="src ok">MyAnimeList</span>
        <span className={`src${S.tmdbConfigured ? ' ok' : ''}`}>TMDB</span>
        {['IMDb', 'Rotten Tomatoes', 'Metacritic'].map((x) => <span key={x} className={`src${S.omdbConfigured ? ' ok' : ''}`}>{x}</span>)}
        <span className={`src${S.simklConfigured ? ' ok' : ''}`}>Simkl</span>
        <span className={`src${S.traktConfigured ? ' ok' : ''}`}>Trakt</span>
        <span className="src link" title="SensCritique n’a pas d’API publique : un lien vers sa page est proposé sur chaque fiche">SensCritique (lien)</span>
      </div>
      <KeyRow label="Clé OMDb : notes IMDb, Rotten Tomatoes et Metacritic" k="omdbKey" configured={S.omdbConfigured} save={save}
        placeholder={kept(S.omdbConfigured, 'Clé') || 'Clé OMDb'} hint={<span>Gratuite (1 000 titres par jour) sur <Ext href="https://www.omdbapi.com/apikey.aspx">omdbapi.com</Ext>.</span>} />
      <KeyRow label="Client ID Simkl" k="simklClientId" configured={S.simklConfigured} save={save}
        placeholder={kept(S.simklConfigured, 'Identifiant') || 'Client ID Simkl'} hint={<span>Gratuit : créez une application sur <Ext href="https://simkl.com/settings/developer/">simkl.com/settings/developer</Ext>.</span>} />
      <KeyRow label="Client ID Trakt : note Trakt, et affiches, fonds et logos" k="traktClientId" configured={S.traktConfigured} save={save}
        placeholder={kept(S.traktConfigured, 'Identifiant') || 'Client ID Trakt'} hint={<span>Gratuit : créez une application sur <Ext href="https://trakt.tv/oauth/applications/new">trakt.tv/oauth/applications</Ext> (adresse de redirection : urn:ietf:wg:oauth:2.0:oob), puis copiez le « Client ID ».</span>} />
      {S.traktConfigured ? <KeyRow label="Client Secret Trakt : pour que chaque profil relie son compte (synchronisation des épisodes vus)" k="traktClientSecret" configured={S.traktSecretConfigured} save={save}
        placeholder={kept(S.traktSecretConfigured, 'Secret') || 'Client Secret Trakt'} hint="Sur la même page de votre application Trakt, sous le Client ID. Ensuite : Réglages → Mon profil → Trakt." /> : null}
      {S.traktConfigured ? (
        <Field label="Affiches des films, séries et animés" hint="Vos images du dossier (poster.jpg, fanart.jpg) restent toujours prioritaires. Le changement se fait en arrière-plan.">
          <Select opts={[['tmdb', 'TMDB d’abord, Trakt quand TMDB n’en a pas'], ['trakt', 'Trakt d’abord, TMDB en secours']]} value={S.posterSource || 'tmdb'} onChange={(e) => save({ posterSource: e.target.value })} />
        </Field>
      ) : null}
      <p className="error-text">{err}</p>
      <button className="btn btn-small btn-ghost f" onClick={async () => { const r = await api('/api/admin/ratings/refresh', { method: 'POST' }); toast(`${r.queued} titre(s) en cours de mise à jour`); }}>Mettre à jour toutes les notes</button>
    </section>
  );
}

// ---------------------------------------------------------------- Radarr et Sonarr
export function ArrBox() {
  const { data: c, error, reload } = useLoad('/api/admin/arr');
  return (
    <section className="box" id="arr">
      <h2>Radarr et Sonarr</h2>
      <p>Reliez Radarr (films) et Sonarr (séries et animés) : dans l’onglet « Nouveau », un clic sur « Ajouter » envoie le titre au bon service, qui le télécharge tout seul. Venus l’ajoute ensuite dès que le fichier arrive dans vos dossiers.</p>
      {error ? <p className="error-text">{error.message}</p> : !c ? <p className="muted">Chargement…</p> : (
        <>
          <ArrOne app="radarr" conf={c.radarr} name="Radarr" port={7878} reload={reload} />
          <ArrOne app="sonarr" conf={c.sonarr} name="Sonarr" port={8989} reload={reload} />
        </>
      )}
    </section>
  );
}
function ArrOne({ app, conf, name, port, reload }) {
  const [on, setOn] = useState(!!conf.on);
  const [opts, setOpts] = useState(null);
  const [optErr, setOptErr] = useState('');
  const [err, setErr] = useState('');
  const url = useRef(null);
  const key = useRef(null);
  useEffect(() => { if (conf.on) api(`/api/admin/arr/${app}/options`).then(setOpts).catch((e) => setOptErr(e.message)); }, []);
  const savePick = async (body) => { try { await api(`/api/admin/arr/${app}`, { method: 'PUT', body }); toast('Enregistré'); } catch (e) { toast(e.message, true); } };
  return (
    <div className="arr-one">
      <h3 className="box-sub">{name}<small className="muted">{app === 'radarr' ? ' — films' : ' — séries et animés'}</small></h3>
      <div className="two-cols wide">
        <Field label="Adresse"><input ref={url} className="input" placeholder={`http://192.168.1.20:${port}`} defaultValue={conf.url || ''} inputMode="url" autoComplete="off" aria-label={`Adresse de ${name}`} /></Field>
        <Field label="Clé API"><input ref={key} className="input" placeholder={conf.keySet ? 'Clé enregistrée (laisser vide pour conserver)' : `Clé API (${name} : Settings → General)`} autoComplete="off" aria-label={`Clé API de ${name}`} /></Field>
      </div>
      <p className="error-text">{err}</p>
      <Actions>
        <Busy className="btn btn-small btn-play f" onClick={async () => {
          setErr('');
          try { const r = await api(`/api/admin/arr/${app}`, { method: 'PUT', body: { url: url.current.value.trim(), ...(key.current.value.trim() ? { key: key.current.value.trim() } : {}) } }); key.current.value = ''; setOn(true); toast(`${name} relié`, { type: 'success' }); setOpts(r); setOptErr(''); }
          catch (e) { setErr(e.message); }
        }}>{on ? 'Tester et enregistrer' : 'Relier'}</Busy>
        {on ? <button className="btn btn-small btn-ghost f" onClick={async () => { await api(`/api/admin/arr/${app}`, { method: 'PUT', body: { remove: true } }); toast(`${name} retiré`); reload(); }}>Retirer</button> : null}
      </Actions>
      <div className="arr-picks">
        {optErr ? <p className="error-text">{optErr}</p> : opts ? (
          <>
            <small className="ok-text">{`${opts.name || name} ${opts.version || ''} relié`}</small>
            <div className="two-cols wide">
              <Field label="Profil de qualité"><Select opts={opts.profiles.map((p) => [String(p.id), p.name])} value={String(conf.profile || (opts.profiles[0] || {}).id || '')} onChange={(e) => savePick({ profile: Number(e.target.value) })} /></Field>
              <Field label={app === 'sonarr' ? 'Dossier des séries' : 'Dossier des films'}><Select opts={opts.roots.map((r) => [r.path, r.path])} value={conf.root || (opts.roots[0] || {}).path || ''} onChange={(e) => savePick({ root: e.target.value })} /></Field>
            </div>
            {app === 'sonarr' ? <Field label="Dossier des animés"><Select opts={[['', 'Même dossier que les séries'], ...opts.roots.map((r) => [r.path, r.path])]} value={conf.animeRoot || ''} onChange={(e) => savePick({ animeRoot: e.target.value })} /></Field> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Seerr (Overseerr / Jellyseerr)
export function SeerrBox({ a, refresh }) {
  const S = a.settings;
  const [how, setHow] = useState('account');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const f = useRef(null);
  const connect = async (e) => {
    e.preventDefault();
    const v = (n) => f.current.elements[n].value;
    setErr(''); setBusy(true);
    try {
      if (how === 'account') {
        const r = await api('/api/admin/seerr/login', { method: 'POST', body: { url: v('url').trim(), method: v('method'), user: v('user').trim(), password: v('pass') } });
        toast(`Seerr relié avec le compte « ${r.user.name} »`);
      } else {
        await putSettings({ seerrUrl: v('url').trim(), ...(v('key').trim() ? { seerrKey: v('key').trim() } : {}) });
        toast('Seerr relié');
      }
      f.current.elements.pass.value = ''; refresh();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <section className="box" id="seerr">
      <h2>Seerr : téléchargements automatiques</h2>
      <p>{S.seerrConfigured
        ? 'Seerr est relié. Les titres ajoutés à « Mes envies » (♡ dans Nouveautés) sont demandés tout de suite, même s’ils ne sortent que dans plusieurs mois, et les nouvelles saisons des séries suivies sont demandées dès qu’elles sont annoncées.'
        : 'Reliez Seerr (Overseerr ou Jellyseerr) : vos envies et les nouvelles saisons de vos séries seront demandées automatiquement, et Radarr / Sonarr les téléchargeront. Le plus simple : se connecter avec un compte administrateur de Seerr, Venus récupère la clé tout seul.'}</p>
      {S.seerrConfigured ? <div className="auto-pill" style={{ marginBottom: 12 }}><span className="dot" />{`Relié à ${S.seerrUrl}`}</div> : null}
      <form ref={f} onSubmit={connect}>
        <Field label="Adresse de Seerr"><input className="input" name="url" id="seerr-url" placeholder="http://192.168.1.20:5055" defaultValue={S.seerrUrl || ''} inputMode="url" autoComplete="off" /></Field>
        <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
          {[['account', 'Avec mon compte'], ['key', 'Avec la clé API']].map(([id, label]) => <button key={id} type="button" className={`seg-b f${how === id ? ' on' : ''}`} onClick={() => setHow(id)}>{label}</button>)}
        </div>
        <div hidden={how !== 'account'}>
          <Field label="Se connecter avec"><select className="input" name="method"><option value="local">Compte Seerr (e-mail)</option><option value="jellyfin">Compte Jellyfin / Emby</option></select></Field>
          <Field label="Identifiant"><input className="input" name="user" id="seerr-user" autoComplete="username" placeholder="E-mail ou nom d’utilisateur" /></Field>
          <Field label="Mot de passe"><input className="input" name="pass" id="seerr-pass" type="password" autoComplete="current-password" placeholder="Mot de passe (jamais enregistré)" /></Field>
        </div>
        <div hidden={how !== 'key'}>
          <Field label="Clé API"><input className="input" name="key" id="seerr-key" placeholder={S.seerrConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Clé API (Seerr : Réglages, Général)'} autoComplete="off" /></Field>
        </div>
        <p className="error-text">{err}</p>
        <Actions>
          <button className="btn btn-small f" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Relier Seerr'}</button>
          {S.seerrConfigured ? <button type="button" className="btn btn-small btn-ghost f" onClick={async () => { await putSettings({ seerrUrl: '', seerrKey: '' }); toast('Seerr retiré'); refresh(); }}>Retirer</button> : null}
        </Actions>
      </form>
      {S.seerrConfigured ? <><h3 className="box-sub">Automatique</h3><SeerrAuto /></> : null}
    </section>
  );
}
function SeerrAuto() {
  const { data: u, error } = useLoad('/api/admin/seerr/users');
  if (error) return <div className="seerr-auto"><p className="error-text">{error.message}</p></div>;
  if (!u) return <div className="seerr-auto"><p className="muted">Chargement des comptes Seerr…</p></div>;
  const save = async (body, msg) => { try { await api('/api/admin/seerr/users', { method: 'PUT', body }); toast(msg); } catch (e) { toast(e.message, true); } };
  const userOpts = [['', 'Compte de la clé API (administrateur)'], ...u.users.map((x) => [String(x.id), `${x.name}${x.email && x.email !== x.name ? ` (${x.email})` : ''}`])];
  return (
    <div className="seerr-auto">
      <Switch label="Demander mes envies à Seerr dès qu’on les ajoute" checked={u.auto} onChange={(e) => save({ auto: e.target.checked }, 'Préférence enregistrée')} />
      <Field label="Nouvelles saisons demandées automatiquement">
        <Select opts={[['mylist', 'Pour les séries de « Ma liste » et des envies'], ['all', 'Pour toutes les séries de la médiathèque'], ['off', 'Jamais']]} value={u.follow} onChange={(e) => save({ follow: e.target.value }, 'Préférence enregistrée')} />
      </Field>
      <h3 className="box-sub">Demandes au nom de chacun</h3>
      <p className="muted" style={{ fontSize: '.88rem', margin: '0 0 10px' }}>Reliez chaque profil à son compte Seerr : ses demandes apparaissent à son nom dans Seerr (avec ses quotas), et ses envies dans sa liste de suivi Seerr.</p>
      {u.profiles.map((p) => <Field key={p.id} label={p.name}><Select opts={userOpts} value={String(u.links[String(p.id)] || '')} onChange={(e) => save({ profileId: p.id, seerrUserId: e.target.value || null }, `${p.name} relié`)} /></Field>)}
      <Actions>
        <Busy className="btn btn-small btn-ghost f" busy="Vérification…" onClick={async () => {
          try { const r = await api('/api/admin/seerr/sync', { method: 'POST' }); toast(`${r.followed} série${r.followed > 1 ? 's' : ''} suivie${r.followed > 1 ? 's' : ''}${r.error ? ` · ${r.error}` : ''}`); } catch (e) { toast(e.message, true); }
        }}><Icon name="refresh" />Vérifier maintenant</Busy>
      </Actions>
      {u.watch.lastRun ? <p className="muted" style={{ fontSize: '.82rem' }}>{`Dernière vérification : ${new Date(u.watch.lastRun).toLocaleString('fr-FR')} · vérifié toutes les 6 heures`}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- notifications (ntfy, Discord, Telegram)
export function NotifyBox({ a, refresh }) {
  const n = a.settings.notify || {};
  const f = useRef(null);
  const [topic] = useState(() => `venus-${Math.random().toString(36).slice(2, 8)}`);
  const v = (k) => f.current.elements[k].value.trim();
  return (
    <section className="box" id="notifications">
      <h2>Notifications</h2>
      <p>Prévenir quand un film, une série ou un épisode arrive dans Venus. Chaque personne reçoit aussi « Votre envie est arrivée » sur ses appareils (Réglages, Cet appareil).</p>
      <SetSwitch label="Annoncer les nouveautés" k="notifyNew" checked={n.notifyNew !== false} />
      <SetSwitch label="Prévenir chaque profil des nouveaux épisodes des séries qu’il suit" k="notifyEpisodes" checked={n.notifyEpisodes !== false} />
      <form ref={f} onSubmit={(e) => e.preventDefault()}>
        <h3 className="box-sub">ntfy (le plus simple, marche sans HTTPS)</h3>
        <p className="muted" style={{ fontSize: '.86rem', margin: '0 0 8px' }}>Installez l’appli gratuite ntfy sur le téléphone et abonnez-vous au même sujet.</p>
        <div className="two-cols">
          <Field label="Sujet"><input className="input" name="topic" defaultValue={n.ntfyTopic || ''} placeholder={topic} autoComplete="off" /></Field>
          <Field label="Serveur"><input className="input" name="server" defaultValue={n.ntfyServer || 'https://ntfy.sh'} autoComplete="off" /></Field>
        </div>
        <h3 className="box-sub">Discord et Telegram</h3>
        <Field label="Webhook Discord"><input className="input" name="discord" placeholder={n.discord ? 'Webhook enregistré (laisser vide pour conserver)' : 'https://discord.com/api/webhooks/…'} autoComplete="off" /></Field>
        <div className="two-cols">
          <Field label="Bot Telegram"><input className="input" name="tgToken" placeholder={n.telegramToken ? 'Jeton enregistré (laisser vide pour conserver)' : 'Jeton du bot (BotFather)'} autoComplete="off" /></Field>
          <Field label="Discussion"><input className="input" name="tgChat" defaultValue={n.telegramChat || ''} placeholder="Identifiant de la discussion" autoComplete="off" /></Field>
        </div>
        <SetSwitch label="Telegram : une fiche par nouveauté (affiche, résumé, date de sortie, disponible)" k="tgMedia" checked={n.tgMedia !== false} />
        <SetSwitch label="Telegram : suivre aussi les téléchargements de Radarr et Sonarr (la fiche passe de « en cours » à « téléchargé » puis « disponible »)" k="tgDownloads" checked={n.tgDownloads !== false} />
        <Field label="Adresse publique de Venus" hint="Pour que les liens des notifications ouvrent Venus."><input className="input" name="pub" defaultValue={n.publicUrl || ''} placeholder="https://venus.mondomaine.fr (facultatif)" inputMode="url" autoComplete="off" /></Field>
      </form>
      <Actions>
        <Busy onClick={async () => {
          try {
            await putSettings({ ntfyTopic: v('topic'), ntfyServer: v('server'), telegramChat: v('tgChat'), publicUrl: v('pub'), ...(v('discord') ? { discordWebhook: v('discord') } : {}), ...(v('tgToken') ? { telegramToken: v('tgToken') } : {}) });
            f.current.elements.discord.value = ''; f.current.elements.tgToken.value = '';
            toast('Notifications enregistrées'); refresh();
          } catch (e) { toast(e.message, true); }
        }}>Enregistrer</Busy>
        <Busy className="btn btn-small btn-ghost f" onClick={async () => {
          try { const r = await api('/api/admin/notify/test', { method: 'POST' }); toast(r.errors.length ? `Erreur : ${r.errors.join(' ; ')}` : 'Notification de test envoyée', r.errors.length ? true : { type: 'success' }); } catch (e) { toast(e.message, true); }
        }}>Envoyer un test</Busy>
        <Busy className="btn btn-small btn-ghost f" onClick={async () => {
          try { const r = await api('/api/admin/notify/telegram-sample', { method: 'POST' }); toast(`Fiche de « ${r.title} » envoyée sur Telegram`, { type: 'success' }); } catch (err) { toast(err.message, true); }
        }}>Fiche Telegram d’exemple</Busy>
      </Actions>
    </section>
  );
}

// ---------------------------------------------------------------- affiches et résumés (TMDB), titres non reconnus
export function MetadataBox({ a, refresh }) {
  const key = useRef(null);
  const S = a.settings;
  return (
    <section className="box" id="sources">
      <h2>Affiches et résumés</h2>
      <p>{S.tmdbConfigured ? 'TMDB est connecté : affiches, résumés en français et classifications d’âge sont récupérés automatiquement.' : 'Ajoutez une clé TMDB gratuite pour obtenir les affiches et résumés en français, et activer le contrôle parental automatique.'}</p>
      <Field label="Clé TMDB" hint={<span>Créez-la sur <Ext href="https://www.themoviedb.org/settings/api">themoviedb.org/settings/api</Ext>.</span>}>
        <input ref={key} className="input" placeholder={S.tmdbConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Collez votre clé API ou jeton TMDB'} />
      </Field>
      <Actions>
        <Busy onClick={async () => { const k = key.current.value.trim(); if (!k) return; try { await putSettings({ tmdbKey: k }); key.current.value = ''; toast('Clé enregistrée, mise à jour des fiches…'); refresh(); } catch (e) { toast(e.message, true); } }}>Enregistrer la clé</Busy>
      </Actions>
      {a.unmatched.length ? (
        <div>
          <h2 style={{ marginTop: 16 }}>{`Titres non reconnus (${a.unmatched.length})`}</h2>
          {a.unmatched.slice(0, 30).map((u) => (
            <div key={u.id} className="list-row">
              <div className="grow"><b>{u.title}</b><span>{u.type === 'movie' ? `Film${u.year ? `, ${u.year}` : ''}` : 'Série'}</span></div>
              <button className="btn btn-small f" onClick={() => fixMatch(u, refresh)}>Identifier</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// Affiches : titres sans affiche, recherche sur les services gratuits, diagnostic des sources
export function PostersBox({ a }) {
  const { data: r, error, reload } = useLoad('/api/admin/posters');
  const [test, setTest] = useState(null); // null, 'run', { mv, tv } ou Error
  const runTest = async () => {
    setTest('run');
    try {
      const [mv, tv] = await Promise.all([api('/api/admin/posters/test?title=Inception&year=2010&type=movie'), api('/api/admin/posters/test?title=Naruto&year=2002&type=anime')]);
      setTest({ mv, tv });
    } catch (e) { setTest(e); }
  };
  const label = (x) => (x.status === 200 ? 'Répond' : x.status === 'non configuré' ? 'Non configuré (facultatif)' : x.status === 'aucun résultat' ? 'Répond, mais ne trouve pas ce titre' : x.status === 'injoignable' ? `Injoignable${x.error ? ` (${x.error})` : ''}` : `Refuse (HTTP ${x.status})`);
  const rows = (res) => res.results.map((x, i) => (
    <div key={i} className="list-row">
      {x.poster ? <img className="pt-img" src={x.poster} alt="" loading="lazy" /> : <span className={`pm-ph ${x.status === 200 || x.status === 'non configuré' ? '' : 'bad'}`}><Icon name={x.status === 200 ? 'check' : x.status === 'non configuré' ? 'info' : 'close'} /></span>}
      <div className="grow"><b>{x.source}</b><span>{`${label(x)} · ${x.ms} ms`}</span></div>
    </div>
  ));
  const dead = (res) => res.results.every((x) => x.status !== 200 && x.status !== 'aucun résultat');
  return (
    <section className="box" id="affiches">
      <h2>Affiches</h2>
      <p>Les affiches viennent de TMDB (avec une clé), ou sans clé d’IMDb, de Cinemeta (Stremio), de Trakt (si un Client ID est renseigné), du site de TMDB, d’IMP Awards, de Wikipédia, d’iTunes, de TVmaze et d’OMDb. Pour un titre précis, vous pouvez choisir parmi plusieurs propositions ou coller l’adresse d’une image trouvée sur n’importe quel site.</p>
      <SetSwitch label="Chercher les affiches sur les services gratuits (sans clé)" k="postersFree" checked={a.settings.postersFree !== false} msg={(on) => (on ? 'Recherche gratuite activée' : 'Recherche gratuite désactivée')} />
      <p>{r ? (r.missing.length ? `${r.missing.length} titre${r.missing.length > 1 ? 's' : ''} sans affiche sur ${r.total}.` : `Tous vos ${r.total} titres ont une affiche.`) : ''}</p>
      <div className="poster-missing">
        {error ? <p className="error-text">{error.message}</p> : !r ? <p className="muted">Chargement…</p> : (
          <>
            {r.missing.slice(0, 40).map((it) => (
              <div key={it.id} className="list-row">
                <span className="pm-ph"><Icon name={it.type === 'movie' ? 'film' : 'tv'} /></span>
                <div className="grow"><b>{it.title}</b><span>{[it.year, it.type === 'movie' ? 'Film' : it.category === 'anime' ? 'Animé' : 'Série', it.poster_tried ? `${it.poster_tried} recherche${it.poster_tried > 1 ? 's' : ''} sans résultat` : null].filter(Boolean).join(' · ')}</span></div>
                <button className="btn btn-small f" onClick={() => choosePoster(it, reload)}><Icon name="image" />Choisir une affiche</button>
                <button className="btn btn-ghost btn-small f" onClick={() => go(it.path)}>Fiche</button>
              </div>
            ))}
            {r.missing.length > 40 ? <p className="muted">{`… et ${r.missing.length - 40} autres.`}</p> : null}
          </>
        )}
      </div>
      <Actions wrap>
        <Busy className="btn btn-small btn-play f" busy="Recherche en cours…" onClick={async () => {
          try { const x = await api('/api/admin/posters/run', { method: 'POST' }); toast(x.found ? `${x.found} affiche${x.found > 1 ? 's' : ''} trouvée${x.found > 1 ? 's' : ''}` : 'Rien de nouveau trouvé'); reload(); } catch (e) { toast(e.message, true); }
        }}><Icon name="refresh" />Chercher les affiches manquantes</Busy>
        <button className="btn btn-small btn-ghost f" disabled={test === 'run'} onClick={runTest}><Icon name="search" />Tester les sources</button>
        <Busy className="btn btn-small btn-ghost f" title="Oublie les affiches trouvées sans clé et les recherche à nouveau avec la correspondance stricte. Les affiches choisies à la main, de TMDB ou du dossier ne bougent pas." onClick={async () => {
          if (!(await confirm('Revérifier les affiches trouvées sans clé ? Elles seront recherchées à nouveau avec une correspondance plus stricte : les mauvaises disparaissent, les bonnes reviennent. Les affiches choisies à la main, celles de TMDB et celles du dossier ne bougent pas.', 'Revérifier'))) return;
          try { const x = await api('/api/admin/posters/redo', { method: 'POST' }); toast(`${x.reset} affiche(s) à revérifier, recherche lancée en tâche de fond`); reload(); } catch (e) { toast(e.message, true); }
        }}><Icon name="refresh" />Revérifier les affiches automatiques</Busy>
      </Actions>
      <div className="poster-test">
        {test === 'run' ? <p className="muted">Test en cours (quelques secondes)…</p>
          : test instanceof Error ? <p className="error-text">{test.message}</p>
            : test ? (
              <>
                <p className="muted">{`Film : « ${test.mv.title} » (${test.mv.year})${test.mv.tmdbKey ? ' · clé TMDB présente' : ' · sans clé TMDB'}`}</p>
                {rows(test.mv)}
                <p className="muted">{`Animé : « ${test.tv.title} » (${test.tv.year})`}</p>
                {rows(test.tv)}
                {dead(test.mv) && dead(test.tv) ? <p className="error-text">Aucun service ne répond : le serveur de Venus n’a sans doute pas accès à Internet (pare-feu, DNS du conteneur Docker, proxy).</p> : null}
              </>
            ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- sauvegardes
export function BackupBox({ a }) {
  const { data: r, error, reload } = useLoad('/api/admin/backups');
  const dir = useRef(null);
  return (
    <section className="box" id="backups">
      <h2>Sauvegardes</h2>
      <p>Profils, vus, listes, envies et réglages sont sauvegardés chaque nuit (les 10 dernières sont gardées). Vos vidéos ne sont pas concernées.</p>
      <SetSwitch label="Sauvegarde automatique chaque nuit" k="autoBackup" checked={a.settings.autoBackup !== false} />
      <div className="backup-list">
        {error ? <p className="error-text">{error.message}</p> : !r ? <p className="muted">Chargement…</p> : !r.items.length ? <p className="muted">Aucune sauvegarde pour l’instant.</p>
          : r.items.slice(0, 6).map((b) => (
            <div key={b.name} className="list-row">
              <div className="grow"><b>{new Date(b.at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</b><span>{`${(b.size / 1048576).toFixed(1).replace('.', ',')} Mo${b.manual ? ' · manuelle' : ''}`}</span></div>
              <a className="btn btn-ghost btn-icon btn-mini f" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download={b.name} title="Télécharger" aria-label="Télécharger"><Icon name="down" /></a>
              <button className="btn btn-ghost btn-small f" onClick={async () => {
                if (!(await confirm(`Revenir à la sauvegarde du ${new Date(b.at).toLocaleString('fr-FR')} ? Profils, vus et listes reviendront à cet état (l’état actuel est sauvegardé avant).`, 'Restaurer'))) return;
                const x = await api(`/api/admin/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' });
                toast(x.restarting ? 'Restauration : Venus redémarre…' : 'Restauration prête : redémarrez Venus pour l’appliquer', { type: 'success', duration: 8000 });
                if (x.restarting) setTimeout(() => location.reload(), 7000);
              }}>Restaurer</button>
            </div>
          ))}
      </div>
      {/* Second emplacement (NAS, disque externe) : chaque sauvegarde y est aussi copiée */}
      <form className="field" style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); const val = dir.current.value.trim(); try { await putSettings({ backupCopyDir: val }); toast(val ? 'Les sauvegardes seront aussi copiées là' : 'Copie désactivée'); } catch (err) { toast(err.message, true); } }}>
        <label>Copier aussi les sauvegardes dans un autre dossier</label>
        <div style={{ display: 'flex', gap: 8 }}><input ref={dir} className="input" defaultValue={a.settings.backupCopyDir || ''} placeholder="/mnt/nas/sauvegardes-venus (vide : aucune copie)" autoComplete="off" /><button className="btn btn-small f" type="submit">Enregistrer</button></div>
        <small>Un dossier d’un NAS ou d’un disque externe monté sur le serveur (sous Docker : un dossier partagé dans docker-compose.yml). Les 10 dernières y sont gardées.</small>
      </form>
      <Actions>
        <Busy onClick={async () => { try { await api('/api/admin/backups', { method: 'POST' }); toast('Sauvegarde faite', { type: 'success' }); reload(); } catch (e) { toast(e.message, true); } }}>Sauvegarder maintenant</Busy>
      </Actions>
    </section>
  );
}

// ---------------------------------------------------------------- sous-titres en ligne (OpenSubtitles)
export function SubtitlesBox({ a, refresh }) {
  const S = a.settings;
  const f = useRef(null);
  return (
    <section className="box" id="subtitles">
      <h2>Sous-titres en ligne</h2>
      <p>Dans le lecteur, « Audio et sous-titres », puis « Chercher des sous-titres en ligne » : les sous-titres manquants sont trouvés sur OpenSubtitles, la version qui correspond à votre fichier en premier. Le fichier vidéo n’est jamais modifié.</p>
      {S.opensubtitlesConfigured ? <div className="auto-pill" style={{ marginBottom: 12 }}><span className="dot" />Activé</div> : null}
      <form ref={f} onSubmit={(e) => e.preventDefault()}>
        <Field label="Clé API" hint={<span>Gratuite sur <Ext href="https://www.opensubtitles.com/fr/consumers">opensubtitles.com/consumers</Ext>.</span>}><input className="input" name="key" placeholder={S.opensubtitlesConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Clé API OpenSubtitles'} autoComplete="off" /></Field>
        <div className="two-cols">
          <Field label="Compte"><input className="input" name="user" placeholder="Nom d’utilisateur (facultatif)" defaultValue={S.opensubtitlesUser || ''} autoComplete="off" /></Field>
          <Field label="Mot de passe"><input className="input" name="pass" type="password" placeholder="Mot de passe (facultatif)" autoComplete="new-password" /></Field>
        </div>
      </form>
      <p className="muted" style={{ fontSize: '.84rem' }}>Avec un compte gratuit, vous avez plus de téléchargements par jour.</p>
      <Actions>
        <Busy onClick={async () => {
          const el = f.current.elements;
          try {
            await putSettings({ ...(el.key.value.trim() ? { opensubtitlesKey: el.key.value.trim() } : {}), opensubtitlesUser: el.user.value.trim(), ...(el.pass.value ? { opensubtitlesPass: el.pass.value } : {}) });
            el.pass.value = ''; el.key.value = ''; toast('Sous-titres en ligne enregistrés'); refresh();
          } catch (e) { toast(e.message, true); }
        }}>Enregistrer</Busy>
      </Actions>
    </section>
  );
}

// ---------------------------------------------------------------- serveur : nom, mot de passe du foyer, fréquence d'analyse
export function ServerBox({ a }) {
  const [pass, setPass] = useState('');
  const name = useRef(null);
  const interval = useRef(null);
  const fmtTime = shared().ui.fmtTime;
  return (
    <section className="box">
      <h2>Serveur</h2>
      <p>{`Venus ${a.version}, en ligne depuis ${fmtTime(a.system.uptime)}`}</p>
      <Field label="Nom"><input ref={name} className="input" defaultValue={a.settings.serverName} /></Field>
      <Field label="Mot de passe du foyer" hint="Après un changement, les autres appareils devront se reconnecter.">
        <input className="input" type="password" placeholder="Nouveau mot de passe" autoComplete="new-password" minLength={10} maxLength={200} value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      <PasswordMeter value={pass} />
      <Field label="Vérifier les nouveautés toutes les (minutes)" hint="Les ajouts sont aussi détectés automatiquement quand c’est possible."><input ref={interval} className="input" type="number" min={5} defaultValue={a.settings.scanInterval} /></Field>
      <Actions>
        <Busy onClick={async () => {
          const problem = shared().ui.passwordProblem;
          if (pass && problem(pass)) { toast(`Mot de passe : ${problem(pass).toLowerCase()}`, true); return; }
          if (!(Number(interval.current.value) >= 5)) { toast('Vérification : 5 minutes minimum', true); return; }
          try {
            const serverName = name.current.value.trim().slice(0, 40);
            await putSettings({ serverName, password: pass || undefined, scanInterval: Number(interval.current.value) });
            // Nouveau nom : visible tout de suite dans l'onglet du navigateur
            const { app } = shared();
            if (app.state.status) { app.state.status.name = serverName || 'Venus'; app.setTitle('Réglages'); }
            toast(pass ? 'Mot de passe changé : les autres appareils devront se reconnecter' : 'Réglages enregistrés', { type: 'success' });
            setPass('');
          } catch (e) { toast(e.message, true); }
        }}>Enregistrer</Busy>
      </Actions>
    </section>
  );
}
