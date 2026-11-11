'use client';
// Réglages : mon profil, cet appareil, thème et menu (tous), puis l'administration du serveur (administrateur).
// Une rubrique à la fois : colonne à gauche sur ordinateur, bande défilante sur téléphone.
import { TraktLinkBox, ImportBox, RemoteBox, TranscribeBox, LightsBox } from './SettingsExtra';
import { ConvertBox } from './Convert';
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useTitle, api, toast, go } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon, Avatar } from '../Icon';
import { Field, Select, Actions, Switch, editProfile } from './SettingsSheets';
import {
  LibraryBox, PerfBoxes, UpdateBox, PlaybackBox, ProfilesBox, DevicesBox, RatingsBox, ArrBox, SeerrBox, BooksAppBox, MediaMetaBox,
  NotifyBox, MetadataBox, PostersBox, BackupBox, SubtitlesBox, ServerBox,
} from './SettingsAdmin';

const LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['ja', 'Japonais'], ['ar', 'Arabe']];
const SECTION_TAB = { menu: 'affichage', sources: 'infos', seerr: 'demandes', arr: 'demandes', ratings: 'notes', affiches: 'infos', subtitles: 'lecture', notifications: 'alertes', backups: 'sauvegardes', iptv: 'tv' };
const reboot = () => window.dispatchEvent(new CustomEvent('vn:reboot'));
const saved = () => toast('Préférence enregistrée pour cet appareil');

export default function Settings() {
  useTitle('Réglages');
  const L = shared();
  const me = L.app.state.profile;
  const { search } = useVenus();
  const NAV = [
    ['Vous', [['profil', 'Mon profil', 'key'], ['appareil', 'Cet appareil', 'play'], ['affichage', 'Thème et menu', 'image']]],
    ...(me.isAdmin ? [
      ['Médias', [['medias', 'Médiathèques', 'folder'], ['tv', 'TV en direct', 'live'], ['infos', 'Infos et affiches', 'spark'], ['notes', 'Notes des sites', 'heart'], ['demandes', 'Demandes', 'download']]],
      ['Foyer', [['famille', 'Profils et appareils', 'people'], ['alertes', 'Notifications', 'chat']]],
      ['Serveur', [['lecture', 'Lecture et conversion', 'gauge'], ['perf', 'Performances', 'spark'], ['maj', 'Mise à jour', 'download'], ['serveur', 'Serveur', 'server'], ['distance', 'Accès hors de la maison', 'live'], ['import', 'Importer (Plex, Jellyfin)', 'download'], ['sauvegardes', 'Sauvegardes', 'copy']]],
    ] : []),
  ];
  const TABS = NAV.flatMap(([, items]) => items);
  const section = search && search.get('section');
  const [tab, setTab] = useState(() => {
    const t = SECTION_TAB[section] || (search && search.get('onglet')) || (() => { try { return sessionStorage.getItem('vn_settings_tab'); } catch { return null; } })() || TABS[0][0];
    return TABS.some(([k]) => k === t) ? t : TABS[0][0];
  });
  const [swap, setSwap] = useState(0);
  const nav = useRef(null);
  const body = useRef(null);

  // Données d'administration : relues toutes les 4 s pendant une analyse ou une lecture, sinon toutes les 20 s
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(0);
  const loaded = useRef(false);
  const refresh = async () => {
    clearTimeout(timer.current);
    // Onglet caché : on vérifie plus tard, sans interroger le serveur
    if (document.hidden && loaded.current) { timer.current = setTimeout(refresh, 20000); return; }
    let x = null;
    try { x = await api('/api/admin'); setA(x); loaded.current = true; } catch (e) { setA((old) => { if (!old) setError(e); return old; }); }
    timer.current = setTimeout(refresh, x && (x.scan.running || x.sessions.length) ? 4000 : 20000);
  };
  useEffect(() => {
    L.app.hideBoot();
    if (me.isAdmin) refresh();
    return () => clearTimeout(timer.current);
  }, []);

  useEffect(() => { requestAnimationFrame(() => nav.current && nav.current.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' })); }, [tab]);
  // ?section=… : on amène le bloc demandé à l'écran
  useEffect(() => {
    if (!section || (me.isAdmin && !a)) return;
    requestAnimationFrame(() => { const el = document.getElementById(section); if (el) el.scrollIntoView({ block: 'start' }); });
  }, [!!a]);

  const pick = (k) => {
    setTab(k); setSwap((n) => n + 1);
    try { sessionStorage.setItem('vn_settings_tab', k); } catch { /* */ }
    if (scrollY > 120) scrollTo({ top: 0 });
  };
  const cur = TABS.find(([k]) => k === tab);
  const ctx = { a, refresh };
  const ADMIN = {
    medias: () => <LibraryBox {...ctx} iptv={false} />,
    tv: () => <LibraryBox {...ctx} iptv />,
    infos: () => <><MetadataBox {...ctx} /><PostersBox {...ctx} /></>,
    notes: () => <RatingsBox {...ctx} />,
    demandes: () => <><ArrBox /><BooksAppBox /><MediaMetaBox /><SeerrBox {...ctx} /></>,
    famille: () => <><ProfilesBox {...ctx} /><DevicesBox {...ctx} /></>,
    alertes: () => <NotifyBox {...ctx} />,
    lecture: () => <><PlaybackBox {...ctx} /><SubtitlesBox {...ctx} /><TranscribeBox /><LightsBox /></>,
    serveur: () => <ServerBox {...ctx} />,
    sauvegardes: () => <BackupBox {...ctx} />,
    import: () => <ImportBox {...ctx} />,
    distance: () => <RemoteBox />,
  };
  let content;
  if (tab === 'profil') content = <><MyBox me={me} /><TraktLinkBox /></>;
  else if (tab === 'appareil') content = <DeviceBox />;
  else if (tab === 'affichage') content = <><ThemeBox /><FluidBox /><MenuBox me={me} /></>;
  else if (tab === 'perf') content = <><PerfBoxes /><ConvertBox /></>;
  else if (tab === 'maj') content = <UpdateBox />;
  else if (error && !a) content = <p className="error-text">{error.message}</p>;
  else if (!a) content = <section className="box"><p className="muted">Chargement…</p></section>;
  else content = ADMIN[tab]();

  return (
    <main className="with-nav page-in">
      <div className="page admin">
        <div className="page-head">
          <h1>Réglages</h1>
          {me.isAdmin ? <button className="tool f" onClick={() => go('/dashboard')}><Icon name="gauge" />Tableau de bord</button> : null}
        </div>
        <div className="set-layout">
          <nav className="set-nav" aria-label="Rubriques des réglages" ref={nav}>
            {NAV.map(([title, items]) => (
              <div key={title} className="set-group">
                {NAV.length > 1 ? <span className="set-group-t">{title}</span> : null}
                {items.map(([k, label, ic]) => <button key={k} className={`set-tab f${k === tab ? ' on' : ''}`} aria-current={k === tab ? 'page' : undefined} onClick={() => pick(k)}><Icon name={ic} /><span>{label}</span></button>)}
              </div>
            ))}
          </nav>
          <div className="set-main">
            <div className="set-head"><h2>{cur ? cur[1] : ''}</h2></div>
            <div key={`${tab}-${swap}`} ref={body} className={`admin-grid${swap ? ' swap' : ''}`}>{content}</div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- mon profil
function MyBox({ me }) {
  const L = shared();
  const saveMe = async (body) => {
    try { const p = await api(`/api/profiles/${me.id}`, { method: 'PUT', body }); Object.assign(L.app.state.profile, p); toast('Préférence enregistrée'); }
    catch (e) { toast(e.message, true); }
  };
  return (
    <section className="box">
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}><Avatar profile={me} cls="sm" /><h2>{me.name}</h2></div>
      <Field label="Langue audio préférée"><Select opts={LANGS} value={me.audioLang} onChange={(e) => saveMe({ audioLang: e.target.value })} /></Field>
      <Field label="Langue des sous-titres" hint="Si l’audio est déjà dans votre langue, seuls les sous-titres « forcés » s’affichent."><Select opts={LANGS} value={me.subtitleLang} onChange={(e) => saveMe({ subtitleLang: e.target.value })} /></Field>
      <Field label="Qualité sur cet appareil">
        <Select opts={[['auto', 'Auto'], ['original', 'Originale'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['360p', '360p (data mobile)']]} value={L.api.preferredQuality()}
          onChange={(e) => { L.api.setPreferredQuality(e.target.value); toast('Qualité enregistrée pour cet appareil'); }} />
      </Field>
      <Switch label="Mode anti-spoiler : au-delà de là où j’en suis, les titres, résumés et images des épisodes sont masqués" checked={!!(me.uiPrefs && me.uiPrefs.spoilerGuard)}
        onChange={(e) => { const v = e.target.checked; me.uiPrefs = { ...(me.uiPrefs || {}), spoilerGuard: v }; L.api.saveProfilePrefs({ spoilerGuard: v }); L.api.clearApiCache(); toast(v ? 'Anti-spoiler activé' : 'Anti-spoiler désactivé'); }} />
      <Actions>
        <button className="btn btn-small f" onClick={() => editProfile(me, true, reboot)}>Modifier nom, couleur et code PIN</button>
        <button className="btn btn-small f" onClick={() => L.app.switchProfile()}>Changer de profil</button>
        <button className="btn btn-small btn-danger f" onClick={async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); L.api.auth.token = null; reboot(); }}>Déconnecter l’appareil</button>
      </Actions>
    </section>
  );
}

// ---------------------------------------------------------------- préférences propres à cet appareil
function DeviceBox() {
  const { prefs, hoverMode, detailsTrailers } = shared().api;
  const pref = (key) => (e) => { prefs.set(key, e.target.type === 'checkbox' ? e.target.checked : e.target.value); saved(); };
  return (
    <section className="box">
      <h2>Lecture sur cet appareil</h2>
      <p>Ces choix ne valent que pour ce navigateur ou cette télévision.</p>
      <Switch label="Plein écran au lancement d’une vidéo" checked={!!prefs.get('fullscreenOnPlay')} onChange={pref('fullscreenOnPlay')} />
      <Field label="Au survol d’une affiche"><Select opts={[['trailer', 'Bande-annonce (sinon un extrait)'], ['extract', 'Extrait de la vidéo'], ['off', 'Rien']]} value={hoverMode()} onChange={pref('hoverMode')} /></Field>
      <Switch label="Aperçus et bandes-annonces avec le son" checked={!!prefs.get('hoverSound')} onChange={pref('hoverSound')} />
      <Switch label="Bande-annonce en fond des fiches (films, séries, animés)" checked={detailsTrailers()} onChange={pref('detailsTrailer')} />
      <Switch label="Montrer les épisodes manquants dans les saisons (diffusés mais pas dans vos dossiers)" checked={prefs.get('showMissing') !== false} onChange={pref('showMissing')} />
      <Switch label="Fiche à la pause : distribution, temps restant, chapitre et dernière réplique" checked={prefs.get('pauseCard') !== false} onChange={pref('pauseCard')} />
      <Switch label="« Précédemment dans… » automatique quand les épisodes s’enchaînent (sinon, proposé en début d’épisode)" checked={!!prefs.get('recapAuto')} onChange={pref('recapAuto')} />
      <Field label="Écran de veille (fonds de vos films et séries, avec l’heure)" hint="Après ce temps sans rien toucher, si aucune vidéo ne joue (une vidéo en pause compte comme arrêtée). Automatique : 5 minutes sur une TV, 10 minutes sur ordinateur, tablette et téléphone.">
        <Select opts={[['auto', 'Automatique'], ['2', 'Après 2 minutes'], ['5', 'Après 5 minutes'], ['10', 'Après 10 minutes'], ['15', 'Après 15 minutes'], ['30', 'Après 30 minutes'], ['0', 'Jamais']]} value={String(prefs.get('screensaver') ?? 'auto')} onChange={pref('screensaver')} />
      </Field>
      <button className="btn btn-small btn-ghost f" type="button" onClick={() => shared().imp('screensaver.js').then((m) => m.showSaver())}>Voir l’écran de veille</button>
      <Switch label="Avec le son" checked={!!prefs.get('detailsSound')} onChange={pref('detailsSound')} />
      <Switch label="Mode nuit dans le lecteur : explosions moins fortes, dialogues plus clairs (suit votre profil)" checked={!!prefs.get('nightMode')} onChange={pref('nightMode')} />
      <div className="two-cols wide">
        <Field label="Sous-titres"><Select opts={[['text', 'Texte avec contour'], ['soft', 'Texte sur fond léger'], ['box', 'Texte sur fond noir']]} value={prefs.get('subStyle')} onChange={pref('subStyle')} /></Field>
        <Field label="Taille"><Select opts={[['small', 'Petite'], ['medium', 'Moyenne'], ['large', 'Grande'], ['xlarge', 'Très grande']]} value={prefs.get('subSize')} onChange={pref('subSize')} /></Field>
        <Field label="Couleur"><Select opts={[['white', 'Blanc'], ['yellow', 'Jaune'], ['cyan', 'Cyan'], ['green', 'Vert']]} value={prefs.get('subColor')} onChange={pref('subColor')} /></Field>
        <Field label="Position"><Select opts={[['normal', 'En bas de l’image'], ['high', 'Un peu plus haut'], ['top', 'En haut de l’image']]} value={prefs.get('subPos')} onChange={pref('subPos')} /></Field>
      </div>
      <Switch label="Passer automatiquement les génériques (opening, ending)" checked={!!prefs.get('autoSkip')} onChange={pref('autoSkip')} />
      <Switch label="Mini-lecteur : la vidéo continue en petit quand on quitte le lecteur" checked={!!prefs.get('miniPlayer')} onChange={pref('miniPlayer')} />
      <PushRow />
    </section>
  );
}

// Notifications sur cet appareil (même appli fermée) : Web Push, possible seulement en HTTPS
function PushRow() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
  const [sub, setSub] = useState(undefined);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setSub(s || null)).catch(() => setSub(null));
  }, [n]);
  if (!supported) {
    return (
      <div className="push-row">
        <b>Notifications sur cet appareil</b>
        <p className="muted">{window.isSecureContext ? 'Ce navigateur ne gère pas les notifications. Sur iPhone, installez d’abord Venus sur l’écran d’accueil.' : 'Il faut ouvrir Venus en HTTPS (adresse sécurisée) pour les recevoir. Sinon, utilisez l’appli ntfy (Réglages, Notifications).'}</p>
      </div>
    );
  }
  if (sub === undefined) return <div className="push-row" />;
  const enable = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications refusées par le navigateur', true); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api('/api/push/key');
      const s2 = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: s2.toJSON() } });
      toast('Notifications activées', { type: 'success' }); setN((x) => x + 1);
    } catch (e) { toast(e.message, true); }
  };
  return (
    <div className="push-row">
      <b>Notifications sur cet appareil</b>
      <p className="muted">{sub ? 'Activées : vous serez prévenu quand vos envies arrivent.' : 'Recevez « Votre envie est arrivée » et les nouveautés, même appli fermée.'}</p>
      <Actions>
        {sub ? <button className="btn btn-small btn-ghost f" onClick={async () => { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast('Notifications désactivées'); setN((x) => x + 1); }}>Désactiver</button>
          : <button className="btn btn-small f" onClick={enable}><Icon name="cal" />Activer</button>}
        {sub ? <button className="btn btn-small btn-ghost f" onClick={async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(r.errors.length ? r.errors.join(' ; ') : 'Test envoyé', r.errors.length ? true : { type: 'success' }); }}>Tester</button> : null}
      </Actions>
    </div>
  );
}

// ---------------------------------------------------------------- thème : une planète du système solaire
function ThemeBox() {
  const T = shared().themes;
  const [cur, setCur] = useState(T.chosenPlanet());
  const [glass, setGlass] = useState(T.glassMode());
  const [auto, setAuto] = useState(T.autoTheme());
  const box = useRef(null);
  const choose = (id, e) => {
    const t = T.PLANETS[id];
    T.setPlanet(id, e.currentTarget.querySelector('.mark'));
    setCur(id);
    toast(t.glass ? 'Thème Verre : clair le jour, sombre la nuit' : `Bienvenue sur ${t.name}`);
    requestAnimationFrame(() => box.current && box.current.querySelector(`[data-id="${id}"]`)?.focus());
  };
  const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sun = T.PLANETS[cur].glass ? T.sunInfo() : null;
  return (
    <section className="box" ref={box}>
      <h2>Thème</h2>
      <p>Choisissez votre planète : tout le site change sur cet appareil — couleurs, logo, mais aussi la place du menu, la forme des affiches et des boutons. « Verre » est clair le jour et sombre la nuit, comme un téléphone.</p>
      <div className="theme-grid" role="radiogroup" aria-label="Planète">
        {Object.entries(T.PLANETS).map(([id, t]) => (
          <button key={id} className={`theme-opt f${id === cur ? ' on' : ''}`} role="radio" aria-checked={String(id === cur)} data-id={id} onClick={(e) => choose(id, e)}>
            <span className="theme-pic"><span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: T.planetMarkup(id).trim() }} />{id === cur ? <span className="moon" aria-hidden="true" /> : null}</span>
            <span className="theme-name">{t.name}</span>
            <small className="theme-layout">{T.LAYOUTS[T.layoutOf(id)]}</small>
          </button>
        ))}
      </div>
      {/* Passage automatique au clair (Blanc) : le jour, ou quand l'appareil est en mode clair */}
      {!T.PLANETS[cur].glass && !T.PLANETS[cur].light ? (
        <div className="glass-mode">
          <div className="seg" role="radiogroup" aria-label="Thème automatique">
            {[['off', `Toujours ${T.PLANETS[cur].name}`], ['sun', 'Clair le jour, sombre le soir'], ['system', 'Selon l’appareil']].map(([v, l]) => (
              <button key={v} className={`seg-b f${auto === v ? ' on' : ''}`} role="radio" aria-checked={String(auto === v)} onClick={() => { T.setAutoTheme(v); setAuto(v); }}>{l}</button>
            ))}
          </div>
          {auto === 'sun' ? <small>{`Clair (thème ${T.PLANETS[T.PLANETS[cur].day || 'blanc'].name}) de ${hm(T.sunInfo().rise)} à ${hm(T.sunInfo().set)}, puis ${T.PLANETS[cur].name}.`}</small> : auto === 'system' ? <small>Clair quand votre téléphone ou ordinateur est en mode clair, sinon {T.PLANETS[cur].name}.</small> : null}
          <small>Votre thème suit votre profil sur tous vos appareils.</small>
        </div>
      ) : null}
      {/* Thème Verre : clair le jour, sombre la nuit (au soleil), ou toujours l'un des deux */}
      {T.PLANETS[cur].glass ? (
        <div className="glass-mode">
          <div className="seg" role="radiogroup" aria-label="Clair ou sombre">
            {[['auto', 'Au rythme du soleil'], ['day', 'Toujours clair'], ['night', 'Toujours sombre']].map(([v, l]) => (
              <button key={v} className={`seg-b f${glass === v ? ' on' : ''}`} role="radio" aria-checked={String(glass === v)} onClick={() => { T.setGlassMode(v); setGlass(v); }}>{l}</button>
            ))}
          </div>
          {glass === 'auto' ? <small>{`Clair de ${hm(sun.rise)} à ${hm(sun.set)} (lever et coucher du soleil chez vous, calculés sur l’appareil).`}</small> : null}
        </div>
      ) : null}
    </section>
  );
}

// Fluidité : effets complets, mode léger (sans flou ni animations lourdes) ou choix automatique selon l'appareil
function FluidBox() {
  const app = shared().app;
  const [cur, setCur] = useState(app.liteSetting());
  const [on, setOn] = useState(() => document.documentElement.classList.contains('lite'));
  const choose = (k) => {
    try { localStorage.setItem('vn_lite', k); if (k === 'auto') localStorage.removeItem('vn_lite_auto'); } catch { /* */ }
    app.applyLite(); setCur(k); setOn(document.documentElement.classList.contains('lite'));
  };
  return (
    <section className="box">
      <h2>Fluidité</h2>
      <p className="muted">Le mode léger coupe les flous et les effets lourds : utile sur une télé, une box ou un vieux téléphone. En automatique, Venus le choisit selon l’appareil et la fluidité mesurée.</p>
      <div className="seg" role="radiogroup" aria-label="Fluidité">
        {[['auto', 'Automatique'], ['off', 'Effets complets'], ['on', 'Mode léger']].map(([k, label]) => <button key={k} className={`seg-b f${k === cur ? ' on' : ''}`} role="radio" aria-checked={String(k === cur)} onClick={() => choose(k)}>{label}</button>)}
      </div>
      <p className="muted small">{`Sur cet appareil : ${on ? 'mode léger' : 'effets complets'}.`}</p>
    </section>
  );
}

// Menu de navigation : afficher, masquer et réordonner (propre à ce profil, sur cet appareil)
function MenuBox({ me }) {
  const M = shared().menu;
  const [p, setP] = useState(() => M.menuPrefs(me.id));
  const focus = useRef(null);
  const list = useRef(null);
  useEffect(() => {
    if (!focus.current || !list.current) return;
    const [id, dir] = focus.current; focus.current = null;
    const b = list.current.querySelector(`[data-id="${id}"][data-dir="${dir}"]`);
    (b && !b.disabled ? b : list.current.querySelector(`[data-id="${id}"]`))?.focus();
  }, [p]);
  const save = (next) => { M.saveMenuPrefs(me.id, next); setP(M.menuPrefs(me.id)); };
  const byId = new Map(M.NAV_ITEMS.map((i) => [i.id, i]));
  const items = p.order.map((id) => byId.get(id)).filter((it) => it && (!it.admin || me.isAdmin));
  const move = (id, d) => {
    const order = [...p.order]; const i = order.indexOf(id); const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    focus.current = [id, String(d)];
    save({ ...p, order });
  };
  const toggle = (id, show) => save({ ...p, hidden: show ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] });
  return (
    <section className="box menu-box" id="menu">
      <h2>Menu</h2>
      <p>Choisissez ce qui apparaît dans le menu et dans quel ordre. Sur ordinateur, seules les 6 premières sections sont affichées ; le reste est rangé dans « Plus ». Réglages et profil restent toujours en bas.</p>
      <ol className="menu-edit" ref={list}>
        {items.map((it, i) => (
          <li key={it.id} className={p.hidden.includes(it.id) ? 'off' : ''}>
            <span className="me-ic"><Icon name={M.iconOf(it)} /></span>
            <b>{it.id === 'today' ? 'Aujourd’hui / Ce soir' : M.labelOf(it)}</b>
            <button className="p-icon small f" data-id={it.id} data-dir="-1" aria-label={`Monter ${M.labelOf(it)}`} disabled={i === 0} onClick={() => move(it.id, -1)}><Icon name="up" /></button>
            <button className="p-icon small f" data-id={it.id} data-dir="1" aria-label={`Descendre ${M.labelOf(it)}`} disabled={i === items.length - 1} onClick={() => move(it.id, 1)}><Icon name="down" /></button>
            <label className="switch mini" title="Afficher dans le menu"><input type="checkbox" className="f" aria-label={`Afficher ${M.labelOf(it)} dans le menu`} checked={!p.hidden.includes(it.id)} onChange={(e) => toggle(it.id, e.target.checked)} /></label>
          </li>
        ))}
      </ol>
      <Actions>
        <button className="btn btn-small btn-ghost f" onClick={() => { M.resetMenuPrefs(me.id); setP(M.menuPrefs(me.id)); toast('Menu d’origine rétabli'); }}>Rétablir le menu d’origine</button>
      </Actions>
    </section>
  );
}
