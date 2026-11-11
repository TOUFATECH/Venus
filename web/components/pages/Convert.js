'use client';
// Compression des vidéos pour gagner de la place : propositions (gain estimé), réglages du profil, file d'attente,
// validation (l'original part à la corbeille et la copie prend son nom) — et le bloc correspondant sur une fiche.
import { useEffect, useState } from 'react';
import { api, toast, go, openSheet } from '../../lib/hooks';
import { Icon } from '../Icon';
import { Field, Select, Actions, Busy, Switch, confirm, fmtGo } from './SettingsSheets';

const DEFS = [['0', 'D’origine (garde le 4K)'], ['1440', '1440p'], ['1080', '1080p (recommandé)'], ['720', '720p (très compact)']];
const QUALS = [['max', 'Maximale'], ['high', 'Haute'], ['balanced', 'Équilibrée']];
const LANGS = [['fre', 'Français'], ['eng', 'Anglais'], ['jpn', 'Japonais'], ['spa', 'Espagnol'], ['ger', 'Allemand'], ['ita', 'Italien'], ['ara', 'Arabe'], ['kor', 'Coréen'], ['chi', 'Chinois'], ['por', 'Portugais']];
const langName = (c) => (LANGS.find((l) => l[0] === c) || [])[1] || (c === 'und' ? 'Langue inconnue' : c.toUpperCase());
const pct = (a, b) => (a && b ? Math.round((1 - b / a) * 100) : 0);
// Écart de taille en clair : « −35 % » quand la copie est plus légère, « +13 % » quand elle serait plus lourde (une
// vidéo déjà très légère, proposée parce que son format oblige à la convertir à chaque lecture), jamais « −-13 % »
const delta = (p) => (p > 0 ? `−${p} %` : p < 0 ? `+${-p} %` : 'même taille');
const freed = (r, later) => (r.saved > 0 ? `Validé : ${fmtGo(r.saved)} libérés${later ? ' dans 7 jours (corbeille)' : ''}` : 'Validé : la copie remplace l’original');
const epLabel = (x) => (x.type === 'episode' && x.show ? `${x.show} · S${x.season} É${x.episode} · ${x.title}` : `${x.title}${x.year ? ` (${x.year})` : ''}`);

export function ConvertBox() {
  const [st, setSt] = useState(null);
  const [sug, setSug] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const load = async () => { try { setSt(await api('/api/admin/convert')); } catch { /* */ } };
  const loadSug = async () => { try { setSug(await api('/api/admin/convert/suggest')); } catch { /* */ } };
  useEffect(() => { load(); loadSug(); }, []);
  useEffect(() => { const iv = setInterval(() => { if (!document.hidden) load(); }, st && st.running ? 3000 : 15000); return () => clearInterval(iv); }, [st && st.running]);
  if (!st) return null;
  const s = st.settings;
  const save = async (patch) => { const r = await api('/api/admin/convert/settings', { method: 'PUT', body: patch }); setSt({ ...st, settings: r.settings }); loadSug(); };
  const toggleLang = (code) => save({ langs: s.langs.includes(code) ? s.langs.filter((x) => x !== code) : [...s.langs, code] });
  const queue = async (ids, all = false) => {
    const r = await api('/api/admin/convert', { method: 'POST', body: all ? { all: true } : { ids } });
    toast(r.queued ? `${r.queued} vidéo(s) mise(s) en file` : 'Rien à ajouter'); setSel(new Set()); load(); loadSug();
  };
  const done = st.list.filter((c) => c.status === 'done');
  const active = st.list.filter((c) => c.status === 'running' || c.status === 'queued');
  const failed = st.list.filter((c) => c.status === 'failed');
  const items = sug ? (showAll ? sug.items : sug.items.slice(0, 12)) : [];
  return (
    <section className="box" id="convert">
      <h2>Compression des vidéos</h2>
      <p>Pour gagner de la place sur le NAS : Venus réencode la vidéo en <b>H.264 + AAC</b>, lisible partout sans conversion à la lecture, en qualité quasi identique (CRF 20, débit plafonné selon la définition). La copie est écrite à côté de l’original ; <b>l’original reste</b> jusqu’à ce que vous ayez vérifié la copie et cliqué « Valider » — il part alors à la corbeille (7 jours), et la copie prend son nom.</p>
      <div className="src-list">
        <span className={`src${st.saved ? ' ok' : ''}`}>{`Place gagnée : ${fmtGo(st.saved)}`}</span>
        <span className={`src${done.length ? ' ok' : ''}`}>{`${done.length} copie(s) à valider${st.pending ? ` (${fmtGo(st.pending)} à libérer)` : ''}`}</span>
        <span className="src">{active.length ? `${active.length} en file` : 'File vide'}{st.paused ? ' · en pause (lecture en cours)' : ''}</span>
        <span className="src">{`Encodeur : ${st.hw} · ${st.cpu} cœurs`}</span>
      </div>

      <h3 className="box-sub">Réglages</h3>
      <div className="two-cols wide">
        <Field label="Qualité" hint="Maximale : CRF 17, quasi sans perte visible même sur un grand écran, fichiers plus gros. Haute : CRF 20, indiscernable à distance normale. Équilibrée : CRF 23, nette, bien plus légère.">
          <Select opts={(st.qualities || []).map((q) => [q.id, q.label])} value={s.quality} onChange={(e) => save({ quality: e.target.value })} />
        </Field>
        <Field label="Définition maximale" hint="1080p suffit à la plupart des écrans et divise la taille d’un 4K par trois. « D’origine » garde le 4K (fichiers plus gros).">
          <Select opts={DEFS} value={String(s.maxHeight)} onChange={(e) => save({ maxHeight: Number(e.target.value) })} />
        </Field>
        <Field label="Encodeur" hint="Le processeur donne la meilleure qualité à taille égale mais est lent ; la carte graphique va 5 à 10 fois plus vite.">
          <Select opts={[['auto', 'Automatique (carte graphique si présente)'], ['cpu', 'Processeur (meilleure qualité, lent)'], ['gpu', 'Carte graphique (rapide)']]} value={s.encoder} onChange={(e) => save({ encoder: e.target.value })} />
        </Field>
      </div>
      <Field label="Langues audio conservées" hint="Rien de coché : toutes les pistes sont gardées. Sinon seules ces langues restent (toutes si aucune ne correspond). Modifiable vidéo par vidéo depuis sa fiche.">
        <div className="chips">{LANGS.map(([c, n]) => <button key={c} type="button" className={`chip f${s.langs.includes(c) ? ' on' : ''}`} aria-pressed={String(s.langs.includes(c))} onClick={() => toggleLang(c)}>{n}</button>)}</div>
      </Field>
      <Switch label="Réduire le son en stéréo" hint="Décoché : le 5.1 est conservé (en AAC 384 kb/s). Coché : stéréo 192 kb/s, encore plus léger." checked={s.stereo} onChange={(e) => save({ stereo: e.target.checked })} />
      <Switch label="Conserver les sous-titres texte intégrés" hint="SRT/ASS intégrés gardés dans la copie. Les sous-titres image (PGS des Blu-ray) ne peuvent pas être conservés en MP4 : Venus peut les retélécharger." checked={s.subs} onChange={(e) => save({ subs: e.target.checked })} />
      <Switch label="Seulement la nuit (1 h – 7 h)" hint="Pour ne pas ralentir le NAS en journée. Une lecture interrompt toujours la compression en cours, qui reprend ensuite." checked={s.night} onChange={(e) => save({ night: e.target.checked })} />

      <h3 className="box-sub">Propositions{sug ? <small className="muted">{` ${sug.items.length} vidéo(s) · jusqu’à ${fmtGo(sug.totalGain)} à gagner`}</small> : null}</h3>
      {!sug ? <p className="muted">Calcul…</p> : !sug.items.length ? <p className="muted">Rien à compresser : vos vidéos sont déjà en H.264 à un débit raisonnable.</p> : (
        <>
          <div className="conv-list">
            {items.map((x) => (
              <label key={x.id} className="conv-row">
                <input type="checkbox" checked={sel.has(x.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(x.id); else n.delete(x.id); setSel(n); }} aria-label={`Sélectionner ${x.title}`} />
                <span className="conv-txt"><b>{epLabel(x)}</b><small>{`${fmtGo(x.size)} → ≈ ${fmtGo(x.estimated)} (${delta(Math.round(x.gain * 100))}) · ${x.why.join(' · ')}`}</small></span>
              </label>
            ))}
          </div>
          {sug.items.length > 12 ? <button className="btn btn-ghost btn-small f" onClick={() => setShowAll(!showAll)}>{showAll ? 'Réduire' : `Voir les ${sug.items.length}`}</button> : null}
          <Actions>
            <Busy className="btn btn-small btn-play f" onClick={() => queue([...sel])} disabled={!sel.size}>{`Compresser la sélection (${sel.size})`}</Busy>
            <Busy className="btn btn-small btn-ghost f" onClick={async () => { if (await confirm('Mettre en file toutes les vidéos proposées qui gagnent de la place ? Elles seront compressées une par une ; rien n’est supprimé avant votre validation.', 'Tout compresser')) await queue([], true); }}>Tout compresser</Busy>
          </Actions>
        </>
      )}

      {active.length ? (<><h3 className="box-sub">En cours</h3><div className="conv-list">{active.map((c) => (
        <div key={c.id} className="conv-row">
          <span className="conv-txt"><b>{epLabel(c)}</b><small>{c.status === 'running' ? `${c.pct} %${c.speed ? ` · ${c.speed}× temps réel` : ''}${c.encoder ? ` · ${c.encoder}` : ''}` : 'En attente'}</small>{c.status === 'running' ? <span className="bar"><i style={{ width: `${c.pct}%` }} /></span> : null}</span>
          <button className="btn btn-ghost btn-small f" onClick={async () => { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); load(); }}>Annuler</button>
        </div>))}</div></>) : null}

      {done.length ? (<><h3 className="box-sub">Copies à valider</h3><p className="muted small">Regardez la copie (bouton « Lire la copie » : c’est elle que Venus lit désormais quand vous lancez le titre), puis validez. Pour revoir l’original : « Lire l’original ».</p><div className="conv-list">{done.map((c) => <DoneRow key={c.id} c={c} reload={load} />)}</div></>) : null}
      {failed.length ? (<><h3 className="box-sub">Échecs</h3><div className="conv-list">{failed.map((c) => (
        <div key={c.id} className="conv-row"><span className="conv-txt"><b>{epLabel(c)}</b><small className="error-text">{c.error}</small></span>
          <button className="btn btn-ghost btn-small f" onClick={async () => { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); load(); }}>Retirer</button></div>))}</div></>) : null}
    </section>
  );
}

function DoneRow({ c, reload }) {
  return (
    <div className="conv-row">
      <span className="conv-txt"><b>{epLabel(c)}</b><small>{`${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (${delta(pct(c.sizeBefore, c.sizeAfter))})${c.encoder ? ` · ${c.encoder}` : ''}`}</small></span>
      <div className="conv-actions">
        <button className="btn btn-ghost btn-small f" onClick={() => go(`/lecture/${c.itemId}`)}><Icon name="play" />Lire la copie</button>
        <button className="btn btn-ghost btn-small f" onClick={() => go(`/lecture/${c.itemId}?src=original`)}>Lire l’original</button>
        <ValidateBtn c={c} reload={reload} />
        <button className="btn btn-ghost btn-small f" onClick={async () => { if (await confirm('Supprimer la copie compressée ? L’original est conservé.', 'Supprimer la copie')) { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); reload(); } }}>Supprimer la copie</button>
      </div>
    </div>
  );
}
export function ValidateBtn({ c, reload, label = 'Valider' }) {
  return (
    <Busy className="btn btn-small btn-play f" onClick={() => new Promise((resolve) => {
      openSheet('Valider la copie compressée', (close) => (
        <div className="req-sheet">
          <p>{`La copie (${fmtGo(c.sizeAfter)}) remplace l’original (${fmtGo(c.sizeBefore)}) et prend son nom. Que faire de l’original ?`}</p>
          <button className="btn btn-play f" onClick={async () => { try { const r = await api(`/api/admin/convert/${c.id}/validate`, { method: 'POST', body: { purge: false } }); toast(freed(r, true)); } catch (e) { toast(e.message, true); } close(); reload(); resolve(); }}>Corbeille 7 jours (recommandé)</button>
          <button className="btn btn-ghost f" onClick={async () => { if (!(await confirm('Supprimer définitivement l’original, tout de suite ? Impossible de revenir en arrière.', 'Supprimer définitivement'))) return; try { const r = await api(`/api/admin/convert/${c.id}/validate`, { method: 'POST', body: { purge: true } }); toast(freed(r, false)); } catch (e) { toast(e.message, true); } close(); reload(); resolve(); }}>Supprimer définitivement maintenant</button>
          <p className="muted small">Radarr ou Sonarr, s’ils sont reliés, relisent le dossier pour retrouver le nouveau fichier au lieu de croire la vidéo perdue.</p>
        </div>
      ), { onClose: resolve });
    })}><Icon name="check" />{label}</Busy>
  );
}

// Bloc sur la fiche d'un film ou d'un épisode (administrateur)
export function CompressNote({ d, reload }) {
  const c = d.compress;
  const [langs, setLangs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState({ maxHeight: null, quality: null });
  const [est, setEst] = useState(null);
  const chosenOpts = (present) => ({ ...(present.length > 1 && langs ? { langs } : {}), ...(choice.maxHeight != null ? { maxHeight: choice.maxHeight } : {}), ...(choice.quality ? { quality: choice.quality } : {}) });
  useEffect(() => {
    if (!c || c.status !== 'suggested' || (choice.maxHeight == null && !choice.quality && !langs)) { setEst(null); return; }
    const q = new URLSearchParams(); if (choice.maxHeight != null) q.set('maxHeight', choice.maxHeight); if (choice.quality) q.set('quality', choice.quality); if (langs) q.set('langs', langs.join(','));
    api(`/api/admin/convert/estimate/${d.id}?${q}`).then(setEst).catch(() => setEst(null));
  }, [choice.maxHeight, choice.quality, langs && langs.join(',')]);
  if (!c) return null;
  if (c.show) return <p className="resume-note"><Icon name="info" />{` ${c.ready ? `${c.ready} épisode(s) compressé(s) à valider` : ''}${c.ready && c.running ? ' · ' : ''}${c.running ? `${c.running} en cours de compression` : ''} — `}<a href="/reglages?onglet=perf#convert" onClick={(e) => { e.preventDefault(); go('/reglages?onglet=perf'); }}>Réglages → Performance</a></p>;
  if (c.status === 'suggested') {
    const present = [...new Set((c.audio || []).map((a) => a.lang))];
    const chosen = langs || present;
    // Copie pas plus légère que l'original : on le dit (elle sert à lire la vidéo partout sans conversion, pas à gagner de la place)
    const gain = Math.round((est ? est.gain : c.gain) * 100);
    return (
      <div className="compress-note">
        <p><Icon name="disk" />{` ${gain > 0 ? 'Cette vidéo peut être compressée' : 'Cette vidéo peut être convertie pour être lue partout sans attente, sans gain de place'} : ${fmtGo(c.size)} → ≈ ${fmtGo(est ? est.estimated : c.estimated)} (${delta(gain)})${(est ? est.height : c.height) ? ` · ${est ? est.height : c.height}p` : ''} · ${c.why.join(' · ')}.`}</p>
        <div className="conv-choices">
          <label><span>Qualité</span><select className="f" value={choice.quality || ''} onChange={(e) => setChoice({ ...choice, quality: e.target.value || null })}><option value="">Réglage général</option>{QUALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span>Définition</span><select className="f" value={choice.maxHeight == null ? '' : String(choice.maxHeight)} onChange={(e) => setChoice({ ...choice, maxHeight: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Réglage général</option>{DEFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        {present.length > 1 ? <div className="chips">{present.map((l) => <button key={l} type="button" className={`chip f${chosen.includes(l) ? ' on' : ''}`} aria-pressed={String(chosen.includes(l))} onClick={() => setLangs(chosen.includes(l) ? (chosen.length > 1 ? chosen.filter((x) => x !== l) : chosen) : [...chosen, l])}>{langName(l)}</button>)}<small className="muted">Langues gardées dans la copie</small></div> : null}
        <button className="btn btn-ghost btn-small f" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/admin/convert', { method: 'POST', body: { ids: [d.id], opts: chosenOpts(present) } }); toast('Compression lancée : vous serez prévenu quand la copie sera prête'); reload(); } catch (e) { toast(e.message, true); } finally { setBusy(false); } }}><Icon name="disk" />{gain > 0 ? 'Compresser (l’original est conservé)' : 'Convertir (l’original est conservé)'}</button>
      </div>
    );
  }
  if (c.status === 'queued' || c.status === 'running') return <p className="resume-note"><Icon name="disk" />{c.status === 'running' ? ` Compression en cours : ${c.pct} %` : ' Compression en attente'}</p>;
  if (c.status === 'done') {
    return (
      <div className="compress-note ok">
        <p><Icon name="check" />{` ${c.sizeAfter < c.sizeBefore ? 'Copie compressée prête' : 'Copie prête, sans gain de place (la vidéo était déjà très légère)'} : ${fmtGo(c.sizeBefore)} → ${fmtGo(c.sizeAfter)} (${delta(pct(c.sizeBefore, c.sizeAfter))}). « Lire » lit désormais la copie ; vérifiez-la, puis validez pour supprimer l’original.`}</p>
        <div className="conv-actions">
          <button className="btn btn-ghost btn-small f" onClick={() => go(`/lecture/${d.id}?src=original`)}>Lire l’original</button>
          <ValidateBtn c={{ ...c, itemId: d.id }} reload={reload} label="Valider la copie" />
          <button className="btn btn-ghost btn-small f" onClick={async () => { if (await confirm('Supprimer la copie compressée ? L’original est conservé.', 'Supprimer la copie')) { await api(`/api/admin/convert/${c.id}`, { method: 'DELETE' }); reload(); } }}>Supprimer la copie</button>
        </div>
      </div>
    );
  }
  return null;
}
