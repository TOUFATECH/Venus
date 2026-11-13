'use client';
// Téléchargements : vidéos préparées pour regarder sans réseau (train, avion…), et choix de la version à télécharger
import { useEffect, useState } from 'react';
import { shared } from '../../lib/shared';
import { useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';

// Taille lisible en Go ou Mo
const fmtSize = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const STATE = { queued: 'En attente', working: 'Préparation', ready: 'Prêt', error: 'Échec' };

// Page Téléchargements : vidéos préparées pour regarder sans réseau
export default function Downloads() {
  useTitle('Téléchargements');
  const { tick } = useVenus();
  const [jobs, setJobs] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false, timer = null;
    api('/api/downloads').then((list) => {
      if (dead) return;
      setJobs(list);
      if (list.some((j) => j.state === 'working' || j.state === 'queued')) timer = setTimeout(() => setN((x) => x + 1), 2000);
    }).catch((e) => { if (!dead) { setJobs([]); toast(e.message, true); } }).finally(() => shared().app.hideBoot());
    return () => { dead = true; clearTimeout(timer); };
  }, [n, tick]);
  const del = async (j) => { await api(`/api/downloads/${j.id}`, { method: 'DELETE' }); setN((x) => x + 1); };
  return (
    <main className="with-nav page-in">
      <div className="page">
        <div className="page-head"><div className="head-left"><h1>Téléchargements</h1></div></div>
        <p className="list-hint">Les vidéos sont enregistrées sur votre appareil : elles se regardent ensuite sans réseau. Sur iPhone, choisissez « Enregistrer dans Fichiers » puis ouvrez-les avec l’appli Fichiers ou VLC. Les versions légères restent prêtes 7 jours sur le serveur.</p>
        <div className="dl-list">
          {!jobs ? null : jobs.length ? jobs.map((j) => (
            <div key={j.id} className={`dl-row st-${j.state}`}>
              <span className="dl-pic">{j.poster ? <img src={img(j.poster)} alt="" /> : null}</span>
              <div className="dl-body">
                <b>{j.title}</b>
                <small>{[j.quality === 'original' ? 'Original' : `Version légère ${j.quality}`, STATE[j.state], j.size ? fmtSize(j.size) : null].filter(Boolean).join(' · ')}</small>
                {j.state === 'working' || j.state === 'queued' ? <div className="meter"><i style={{ width: `${j.progress}%` }} /></div> : null}
                {j.error ? <small className="error-text">{j.error}</small> : null}
              </div>
              <div className="dl-actions">
                {j.state === 'ready' ? <a className="btn btn-small f" href={`/api/downloads/${j.id}/file`} download={j.name}><Icon name="down" />Enregistrer</a> : j.state === 'working' ? <span className="dl-pct">{`${j.progress} %`}</span> : null}
                <button className="btn btn-ghost btn-icon btn-mini f" aria-label="Supprimer" title="Supprimer" onClick={() => del(j)}><Icon name="close" /></button>
              </div>
            </div>
          )) : <div className="grid-empty"><p>Aucun téléchargement. Sur la fiche d’un film ou d’une saison, touchez « Télécharger ».</p></div>}
        </div>
      </div>
    </main>
  );
}

// Choix de la version à télécharger (film, épisode ou saison entière)
export function openDownload({ id, title, size, duration, season = false }) {
  const est = (gbPerHour) => (duration ? `≈ ${fmtSize(gbPerHour * 1e9 * (duration / 3600))}` : '');
  openSheet(`Télécharger ${season ? 'la saison' : `« ${title} »`}`, (close) => {
    const prep = async (quality) => {
      close();
      try {
        const r = await api(`/api/items/${id}/download`, { method: 'POST', body: { quality } });
        toast(r.length > 1 ? `${r.length} épisodes en préparation (${quality})` : `« ${title} » en préparation (${quality})`, { type: 'success', action: { label: 'Voir', onClick: () => go('/telechargements') } });
      } catch (e) { toast(e.message, true); }
    };
    return (
      <div className="dl-choices">
        {season ? null : (
          <a className="opt f" href={`/api/items/${id}/download`} download="" onClick={() => setTimeout(close, 300)}>
            <Icon name="down" /><span><b>Fichier d’origine</b><small>{['Meilleure qualité', fmtSize(size)].filter(Boolean).join(' · ')}</small></span>
          </a>
        )}
        <button className="opt f" onClick={() => prep('720p')}><Icon name="film" /><span><b>Version légère 720p</b><small>{['Idéale pour un téléphone ou une tablette', season ? '≈ 0,9 Go par heure' : est(0.9)].filter(Boolean).join(' · ')}</small></span></button>
        <button className="opt f" onClick={() => prep('480p')}><Icon name="film" /><span><b>Très légère 480p</b><small>{['Pour garder de la place', season ? '≈ 0,45 Go par heure' : est(0.45)].filter(Boolean).join(' · ')}</small></span></button>
        <p className="muted" style={{ fontSize: '.84rem', margin: '10px 0 0' }}>Les versions légères sont préparées par le serveur, puis disponibles dans « Téléchargements ».</p>
      </div>
    );
  });
}
