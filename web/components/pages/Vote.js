'use client';
// Vote en famille : chacun choisit sur son téléphone parmi les idées de « Ce soir ».
// Écran du téléphone (/vote?code=ABCD) et fenêtre de l'écran principal (startVote).
import { useEffect, useRef, useState } from 'react';
import { shared } from '../../lib/shared';
import { useTitle, api, toast, img, go, openSheet } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon, Qr } from '../Icon';
import { playItem } from './Tonight';

const clientId = () => { try { let c = sessionStorage.getItem('vn_vote_client'); if (!c) { c = Math.random().toString(36).slice(2); sessionStorage.setItem('vn_vote_client', c); } return c; } catch { return Math.random().toString(36).slice(2); } };
const voteLink = (code) => `${location.origin}/vote?code=${code}`;
const stream = (path, handlers) => shared().api.openStream(path, handlers);

// ---------------------------------------------------------------- écran principal
export async function startVote(itemIds) {
  let v;
  try { v = await api('/api/vote', { method: 'POST', body: { itemIds } }); } catch (e) { toast(e.message, true); return; }
  let stop = () => {};
  openSheet('Vote en famille', (close) => <VoteHost initial={v} close={close} onStream={(s) => { stop = s; }} />, { wide: true, onClose: () => stop() });
}

function VoteHost({ initial, close, onStream }) {
  const [st, setSt] = useState(initial);
  useEffect(() => { onStream(stream(`/api/vote/${initial.code}/stream`, { state: setSt })); }, []);
  const max = Math.max(1, ...st.items.map((i) => i.votes));
  const w = st.done ? st.items.find((i) => i.id === st.winner) : null;
  const end = async () => { try { setSt(await api(`/api/vote/${st.code}/close`, { method: 'POST' })); toast('Le vote est terminé !', { type: 'success' }); } catch (e) { toast(e.message, true); } };
  return (
    <div className="vote-host">
      <div className="vote-join"><Qr text={voteLink(st.code)} size={170} /><div><p>Chacun scanne ce QR code avec son téléphone, ou ouvre Venus et tape le code :</p><b className="big-code">{st.code.split('').join(' ')}</b></div></div>
      <div className="vote-board">
        {st.items.map((i) => (
          <div key={i.id} className={`vote-line${st.done && st.winner === i.id ? ' win' : ''}`}>
            <span className="vl-pic">{i.poster ? <img src={img(i.poster)} alt="" /> : null}</span>
            <div className="vl-body"><b>{i.title}</b><div className="meter"><i style={{ width: `${(i.votes / max) * 100}%` }} /></div><small>{i.voters.length ? i.voters.join(', ') : 'Pas encore de voix'}</small></div>
            <b className="vl-n">{i.votes}</b>
          </div>
        ))}
      </div>
      <div className="form-actions">
        {w ? <button className="btn btn-play f" onClick={() => { close(); playItem(w); }}><Icon name="play" />{`Lancer « ${w.title} »`}</button>
          : <button className="btn btn-play f" onClick={end}><Icon name="play" />Voir le résultat</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- téléphone
export default function Vote() {
  useTitle('Vote en famille');
  const { search } = useVenus();
  const [code, setCode] = useState(String((search && search.get('code')) || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [asking, setAsking] = useState(true);
  const [mine, setMine] = useState(null);
  const input = useRef(null);
  useEffect(() => { shared().app.hideBoot(); }, []);
  useEffect(() => {
    if (!code) { setAsking(true); return undefined; }
    if (!/^[A-Z0-9]{4}$/.test(code)) { setMsg('Le code fait 4 lettres.'); setAsking(true); return undefined; }
    let stop = null, dead = false;
    api(`/api/vote/${code}`).then((x) => { if (dead) return; setSt(x); setAsking(false); stop = stream(`/api/vote/${code}/stream`, { state: setSt }); })
      .catch((e) => { if (!dead) { setMsg(e.message); setAsking(true); } });
    return () => { dead = true; if (stop) stop(); };
  }, [code]);
  useEffect(() => { if (asking) setTimeout(() => input.current && input.current.focus(), 50); }, [asking]);
  const top = <div className="remote-top"><button className="p-icon f" aria-label="Retour" onClick={() => shared().app.back('/')}><Icon name="back" /></button><b>Vote en famille</b></div>;
  let body;
  if (asking || !st) {
    body = (
      <form className="remote-pair" onSubmit={(e) => { e.preventDefault(); setMsg(''); setCode(input.current.value.toUpperCase().trim()); }}>
        <Icon name="people" /><h1>Rejoindre le vote</h1><p>Tapez le code à 4 lettres affiché sur la TV.</p>
        <input ref={input} className="input code-input" maxLength={4} placeholder="ABCD" autoComplete="off" aria-label="Code du vote" />
        <p className="error-text">{msg}</p>
        <button className="btn btn-play f" type="submit">Rejoindre</button>
      </form>
    );
  } else if (st.done) {
    const w = st.items.find((i) => i.id === st.winner);
    body = (
      <div className="vote-win">
        {w.backdrop || w.poster ? <img src={img(w.backdrop || w.poster)} alt="" /> : null}
        <div><small>Ce soir, ce sera</small><h1>{w.title}</h1><p>{`${w.votes} voix sur ${st.voters}`}</p><button className="btn f" onClick={() => go(`/titre/${w.id}`)}><Icon name="info" />Voir la fiche</button></div>
      </div>
    );
  } else {
    const pick = async (i) => {
      setMine(i.id);
      try { setSt(await api(`/api/vote/${code}`, { method: 'POST', body: { itemId: i.id, client: clientId() } })); if (navigator.vibrate) navigator.vibrate(12); } catch (e) { toast(e.message, true); }
    };
    body = (
      <>
        <div className="vote-intro"><h1>{mine ? 'A voté !' : 'Que regarder ce soir ?'}</h1><p>{mine ? 'Vous pouvez changer d’avis tant que le vote est ouvert.' : `Proposé par ${st.host}. Touchez votre choix.`}</p></div>
        <div className="vote-cards">
          {st.items.map((i) => (
            <button key={i.id} className={`vote-card f${mine === i.id ? ' on' : ''}`} onClick={() => pick(i)}>
              <span className="vc-pic">{i.poster ? <img src={img(i.poster)} alt="" /> : null}{mine === i.id ? <span className="vc-check"><Icon name="check" /></span> : null}</span>
              <span className="vc-body"><b>{i.title}</b><small>{[i.year, i.runtime ? `${i.runtime} min` : null].filter(Boolean).join(' · ')}</small>{i.overview ? <em>{i.overview}</em> : null}<span className="vc-votes">{`${i.votes} voix`}</span></span>
            </button>
          ))}
        </div>
      </>
    );
  }
  return <main><div className="vote-page">{top}{body}</div></main>;
}
