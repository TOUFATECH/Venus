'use client';
// Qualité de la médiathèque (administration) : définition, codecs, HDR, poids ; titres à améliorer
// (demande d'une meilleure version ou de la 4K à Seerr) ; conversions évitables et leurs causes.
import { useEffect, useState } from 'react';
import { shared } from '../../lib/shared';
import { useApi, useTitle, api, toast, img, go } from '../../lib/hooks';
import { Icon } from '../Icon';
import { PageError, PageLoading } from '../PageState';

const fmtBytes = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(2).replace('.', ',')} To` : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const FILTERS = [['improve', 'À améliorer'], ['all', 'Tout'], ['4K', '4K'], ['1080p', '1080p'], ['720p', '720p'], ['SD', 'SD'], ['hdr', 'HDR']];

export default function Quality() {
  useTitle('Qualité');
  const admin = shared().app.state.profile.isAdmin;
  const { data: d, error } = useApi(admin ? '/api/admin/quality' : null);
  if (!admin) return <main className="with-nav"><div className="empty"><h2>Réservé à l’administrateur</h2></div></main>;
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  return <QualityView d={d} />;
}

function QualityView({ d }) {
  const s = d.summary;
  const [filter, setFilter] = useState(s.toImprove ? 'improve' : 'all');
  const items = d.items.filter((x) => filter === 'all' || (filter === 'improve' ? x.reasons.length : filter === 'hdr' ? x.hdr : x.res === filter));
  const Bar = ({ label, n }) => <div className="q-bar"><span>{label}</span><div className="meter"><i style={{ width: `${s.total ? (n / s.total) * 100 : 0}%` }} /></div><b>{n}</b></div>;
  return (
    <main className="with-nav page-in">
      <div className="page">
        <div className="page-head"><div className="head-left"><h1>Qualité</h1><p className="count">{`${s.total} titres · ${fmtBytes(s.size)}`}</p></div></div>
        <div className="q-summary">
          <div className="dash-box"><div className="dash-title"><h2>Définition</h2></div>{['4K', '1080p', '720p', 'SD'].map((r) => <Bar key={r} label={r} n={s.byRes[r] || 0} />)}<Bar label="HDR" n={s.hdr} /></div>
          <div className="dash-box"><div className="dash-title"><h2>Codecs vidéo</h2></div>{s.codecs.slice(0, 5).map(([c, n]) => <Bar key={c} label={c} n={n} />)}</div>
          <div className="dash-box q-improve">
            <b>{s.toImprove}</b><span>{s.toImprove ? 'titres pourraient être en meilleure qualité' : 'Toute la médiathèque est en bonne qualité'}</span>
            {d.seerr ? null : <small className="muted">Reliez Seerr pour demander une meilleure version en un clic.</small>}
          </div>
        </div>
        <div className="toolbar">
          <div className="seg">{FILTERS.map(([id, label]) => <button key={id} className={`seg-b f${filter === id ? ' on' : ''}`} onClick={() => setFilter(id)}>{label}{id === 'improve' ? <small>{` ${s.toImprove}`}</small> : null}</button>)}</div>
        </div>
        <div className="q-list">
          {items.length ? items.slice(0, 300).map((x) => <QRow key={x.id} x={x} seerr={d.seerr} />) : <p className="grid-empty">{filter === 'improve' ? 'Rien à améliorer : tout est en bonne qualité.' : 'Aucun titre.'}</p>}
        </div>
        <Transcodes />
      </div>
    </main>
  );
}

function QRow({ x, seerr }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      await api('/api/admin/quality/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title, is4k: x.res !== '4K' && x.res !== 'SD' } });
      toast(`Meilleure version de « ${x.title} » demandée à Seerr`, { type: 'success' }); setDone(true);
    } catch (e) {
      // Pas de serveur 4K dans Seerr : demande normale
      try { await api('/api/admin/quality/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title } }); toast(`Nouvelle demande pour « ${x.title} » envoyée`, { type: 'success' }); setDone(true); }
      catch (e2) { toast(e2.message || e.message, true); setBusy(false); }
    }
  };
  return (
    <div className="q-row">
      <button className="q-main f" onClick={() => go(`/titre/${x.id}`)}>
        <span className="q-pic">{x.poster ? <img src={img(x.poster)} alt="" loading="lazy" /> : null}</span>
        <span className="q-text">
          <b>{x.title || '—'}</b>
          <small>{[x.year, x.type === 'show' ? `${x.files} épisodes` : null, fmtBytes(x.size), x.sizePerHour ? `${fmtBytes(x.sizePerHour)}/h` : null].filter(Boolean).join(' · ')}</small>
          {x.reasons.length ? <em>{x.reasons.join(' · ')}</em> : null}
        </span>
      </button>
      <span className="q-badges"><span className={`badge q-${x.res}`}>{x.res}</span>{x.hdr ? <span className="badge">HDR</span> : null}<span className="badge ghost">{x.codec}</span>{x.surround ? <span className="badge ghost">5.1</span> : null}</span>
      {seerr && x.tmdbId ? <button className="btn btn-ghost btn-small f" title="Demander une meilleure version à Seerr" disabled={busy || done} onClick={ask}><Icon name={done ? 'check' : 'refresh'} />{done ? 'Demandé' : x.res === '4K' ? 'Redemander' : 'Meilleure version'}</button> : null}
    </div>
  );
}

// Conversions évitables : appareils qui forcent des conversions, causes, et commande ffmpeg prête
function Transcodes() {
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api('/api/admin/transcodes').then(setT).catch((e) => setErr(e.message)); }, []);
  const title = <div className="dash-title"><h2>Conversions évitables</h2>{t && t.byReason.length ? <span className="pill">30 jours</span> : null}</div>;
  return (
    <section className="dash-box q-transcodes">
      {err ? <p className="error-text">{err}</p> : !t ? <>{title}<p className="muted">Chargement…</p></> : !t.byReason.length ? <>{title}<p className="dash-empty">Aucune conversion ces 30 derniers jours : tous les appareils lisent les fichiers tels quels.</p></> : (
        <>
          {title}
          <div className="tc-cols">
            <div><h3>Par appareil</h3>{t.byDevice.map((x, i) => <div key={i} className="tc-row"><span>{x.device || 'inconnu'}</span><b>{x.n}</b></div>)}</div>
            <div><h3>Par cause</h3>{t.byReason.map((r, i) => <div key={i} className="tc-row"><span>{[r.reason, r.codec ? r.codec.toUpperCase() : null, r.container ? r.container.toUpperCase() : null].filter(Boolean).join(' · ')}</span><b>{r.n}</b></div>)}</div>
          </div>
          {t.advice.length ? <div className="tc-advice">{t.advice.map((a, i) => <div key={i} className="tc-tip"><b>{a.reason}</b><p>{a.tip}</p><code className="cmd">{a.cmd}</code><button className="btn btn-small btn-ghost f" onClick={() => navigator.clipboard?.writeText(a.cmd).then(() => toast('Commande copiée'), () => {})}>Copier</button></div>)}</div> : null}
          {t.files.length ? <div><h3>Fichiers les plus convertis</h3>{t.files.map((f) => <div key={f.id} className="tc-row"><button className="linkish f" onClick={() => go(`/titre/${f.id}`)}>{f.title}</button><b>{`${f.n}×`}</b></div>)}</div> : null}
        </>
      )}
    </section>
  );
}
