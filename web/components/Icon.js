'use client';
// Icônes et petits éléments graphiques de Venus, en React (mêmes dessins que l'interface classique)
import { shared } from '../lib/shared';

export function Icon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: shared().ui.iconMarkup(name) }} />;
}

// Logo : la planète du thème choisi (sa surface tourne)
export function LogoMark() {
  return <span className="mark-host" style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: shared().themes.planetMarkup().trim() }} />;
}

export function Brand({ cls = '' }) {
  return <span className={`brand ${cls}`}><LogoMark /><span className="brand-name">{shared().themes.brandName()}</span></span>;
}

export function Avatar({ profile, cls = '' }) {
  const { AVATAR_HUES } = shared().ui;
  return (
    <div className={`avatar ${cls}`} style={{ '--hue': AVATAR_HUES[(profile.avatar || 0) % AVATAR_HUES.length] }}>
      {(profile.name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

// QR code (adresse à scanner avec un téléphone)
export function Qr({ text, size = 220 }) {
  const el = shared().ui.qrSvg(text, size);
  return <span className="qr-host" style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: el.outerHTML }} />;
}
