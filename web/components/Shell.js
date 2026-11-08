'use client';
// Coque de Venus : rail (ordinateur, TV), barre du haut et onglets (mobile). Mise en page en flexbox ;
// chaque thème (planète) la place différemment : rail à gauche, menu en haut, dock en bas… (html[data-layout]).
import Palette from './Palette';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { shared } from '../lib/shared';
import { Icon, LogoMark, Brand, Avatar } from './Icon';

const isActive = (href, path) => (href === '/' ? path === '/' : path.startsWith(href));

function NavLink({ href, label, icon, path, className = '' }) {
  const on = isActive(href, path);
  return (
    <Link href={href} className={`${className} f${on ? ' active' : ''}`.trim()} aria-current={on ? 'page' : undefined}>
      {icon ? <Icon name={icon} /> : null}<span>{label}</span>
    </Link>
  );
}

function ItemLink({ it, path, className = '' }) {
  const { menu, app } = shared();
  if (it.action === 'remote') {
    return <button className="rail-item f" onClick={() => app.openRemote()}><Icon name={menu.iconOf(it)} /><span>{menu.labelOf(it)}</span></button>;
  }
  return <NavLink href={it.href} label={menu.labelOf(it)} icon={menu.iconOf(it)} path={path} className={className} />;
}

// Badge de l'administrateur : lectures en cours sur le serveur (caché quand personne ne regarde).
// Un seul suivi pour tous les badges (rail et mobile), en pause quand l'onglet est caché.
const live = { n: 0, subs: new Set(), timer: 0 };
function pollLive() {
  if (document.hidden) return;
  shared().api.api('/api/admin/live').then((r) => { live.n = r.playing || 0; live.subs.forEach((fn) => fn(live.n)); }).catch(() => {});
}
function LiveBadge({ cls }) {
  const [n, setN] = useState(live.n);
  useEffect(() => {
    live.subs.add(setN);
    if (live.subs.size === 1) {
      const first = setTimeout(pollLive, 1500);
      const iv = setInterval(pollLive, 30000);
      document.addEventListener('visibilitychange', pollLive);
      live.timer = () => { clearTimeout(first); clearInterval(iv); document.removeEventListener('visibilitychange', pollLive); };
    }
    return () => { live.subs.delete(setN); if (!live.subs.size && live.timer) { live.timer(); live.timer = 0; } };
  }, []);
  return (
    <Link href="/dashboard" className={`${cls} f`} hidden={!n} title="Lectures en cours">
      <Icon name="play" /><span>{n === 1 ? '1 lecture' : `${n} lectures`}</span>
    </Link>
  );
}

function TimeLeft({ p, rail }) {
  if (p.dailyLeft == null) return null;
  const low = p.dailyLeft <= 10 ? ' low' : '';
  const txt = p.dailyLeft ? `${p.dailyLeft} min` : 'Fini';
  return rail
    ? <span className={`rail-item time-left${low}`} title="Temps d’écran restant aujourd’hui"><Icon name="clock" /><span>{txt}</span></span>
    : <span className={`time-left pill${low}`}><Icon name="clock" />{txt}</span>;
}

export default function Shell({ path, bare, children }) {
  const L = shared();
  const { app, menu } = L;
  const p = app.state.profile;
  const top = useRef(null);
  const rail = useRef(null);
  const prevActive = useRef(null);

  // Barre du haut : transparente en haut de page, fond plein dès qu'on fait défiler
  useEffect(() => {
    if (bare) return undefined;
    const onScroll = () => top.current && top.current.classList.toggle('solid', scrollY > 40);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => removeEventListener('scroll', onScroll);
  }, [bare]);

  // Petit rebond de l'élément du menu qui devient actif
  useEffect(() => {
    const a = rail.current && rail.current.querySelector('a.active:not(.home-link)');
    if (a && prevActive.current && prevActive.current !== a.getAttribute('href')) {
      a.classList.add('pop');
      a.addEventListener('animationend', () => a.classList.remove('pop'), { once: true });
    }
    prevActive.current = a ? a.getAttribute('href') : null;
  }, [path]);

  if (bare || !p) return <div id="app">{children}{p ? <Palette /> : null}</div>;

  const { shown, more } = menu.menuItems(p, app.hasCat);
  const RAIL_MAX = menu.RAIL_MAX;
  const railMore = [...shown.slice(RAIL_MAX), ...more];
  const all = [...shown, ...more];
  const pick = (id) => all.find((it) => it.id === id);
  const firstTwo = shown.filter((it) => !it.action && !['home', 'today', 'search'].includes(it.id)).slice(0, 2);
  const tabItems = [pick('home'), ...firstTwo, pick('search')].filter(Boolean);
  const switchProfile = () => app.switchProfile();

  return (
    <div id="app">
      <nav className="rail" aria-label="Navigation principale" ref={rail}>
        <Link href="/" className={`home-link f${path === '/' ? ' active' : ''}`} aria-label="Venus, accueil"><LogoMark /></Link>
        <div className="rail-scroll">
          {shown.slice(0, RAIL_MAX).map((it) => <ItemLink key={it.id} it={it} path={path} />)}
          {shown.length > RAIL_MAX || more.length
            ? <button className="rail-item f" aria-label="Plus" data-more="1" onClick={() => app.openAll(railMore)}><Icon name="more" /><span>Plus</span></button>
            : null}
        </div>
        {p.isAdmin ? <LiveBadge cls="rail-item live-badge" /> : null}
        <TimeLeft p={p} rail />
        {p.isKids ? null : <NavLink href="/reglages" label="Réglages" icon="gear" path={path} />}
        <button className="rail-item f" aria-label={`Changer de profil (${p.name})`} onClick={switchProfile}><Avatar profile={p} cls="sm" /><span>{p.name}</span></button>
      </nav>
      <header className="mobile-top" ref={top}>
        <Link href="/" className="f" aria-label="Accueil"><Brand /></Link>
        <div className="top-actions">
          {p.isAdmin ? <LiveBadge cls="icon-btn live-badge top" /> : null}
          <TimeLeft p={p} />
          <button className="icon-btn f" aria-label="Rechercher partout (Ctrl+K)" title="Rechercher partout (Ctrl+K)" onClick={() => window.dispatchEvent(new CustomEvent('vn:palette'))}><Icon name="search" /></button>
          {p.isKids ? null : <Link href="/reglages" className="icon-btn f" aria-label="Réglages"><Icon name="gear" /></Link>}
          <button className="icon-btn f" aria-label={`Changer de profil (${p.name})`} onClick={switchProfile}><Avatar profile={p} cls="sm" /></button>
        </div>
      </header>
      {children}
      <Palette />
      <nav className="tabbar">
        {tabItems.map((it) => <ItemLink key={it.id} it={it} path={path} />)}
        <button className="f tab-more" aria-label="Toutes les sections" data-more="1" onClick={() => app.openAll(all.filter((it) => !tabItems.includes(it)))}><Icon name="apps" /><span>Tout</span></button>
      </nav>
    </div>
  );
}
