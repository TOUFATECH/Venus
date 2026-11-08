'use client';
// États communs d'une page : chargement (silhouette) et erreur (avec « Réessayer »)
import { shared } from '../lib/shared';
export function PageLoading({ children = null }) {
  const bar = (w, hgt = 14) => <i className="sk" style={{ width: w, height: hgt }} />;
  return (
    <main className="with-nav">
      <div className="page" aria-busy="true" aria-label="Chargement">{children || <>{bar(260, 48)}{bar('70%')}{bar('60%')}<div className="sk-row land">{Array.from({ length: 5 }, (_, i) => <i key={i} className="sk" />)}</div></>}</div>
    </main>
  );
}

export function PageError({ error, title = 'Impossible d’afficher cette page' }) {
  if (error && (error.status === 401 || error.message === 'Choisissez un profil')) return <main className="with-nav" />;
  return (
    <main className="with-nav">
      <div className="page"><div className="empty"><h2>{title}</h2><p>{(error && error.message) || 'Erreur inattendue'}</p><button className="btn f" onClick={() => shared().app.hostHooks.refresh()}>Réessayer</button></div></div>
    </main>
  );
}
