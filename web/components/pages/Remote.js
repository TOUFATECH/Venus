'use client';
// Le téléphone devient une télécommande : croix directionnelle, lecture, recherche au clavier, lancement d'un titre
import { useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy';
import { useTitle, api, toast, img } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';

const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* */ } };
const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* */ } } };

export default function Remote() {
  useTitle('Télécommande');
  const { search } = useVenus();
  const qrCode = ((search && search.get('code')) || '').replace(/\D/g, '');
  const [link, setLink] = useState(null); // null : en cours ; '' : à relier
  const [msg, setMsg] = useState('');
  const pair = async (c) => {
    const r = await api('/api/remote/pair', { method: 'POST', body: { code: c } });
    ls.set('vn_remote_link', r.link); ls.set('vn_remote_target', '');
    setLink(r.link);
  };
  useEffect(() => {
    legacy().app.hideBoot();
    const saved = ls.get('vn_remote_link');
    // QR code scanné : on relie ce téléphone avec le code qu'il contient (même s'il l'était déjà)
    if (qrCode) pair(qrCode).catch((e) => { if (saved) setLink(saved); else { setMsg(e.message); setLink(''); } });
    else setLink(saved);
  }, []);
  const lost = (m) => { setMsg(m); setLink(''); };
  return (
    <main>
      <div className="remote-page">
        {link === null ? null : link ? <Pad link={link} onLost={lost} onChange={() => { ls.set('vn_remote_link', ''); setMsg(''); setLink(''); }} />
          : <PairForm msg={msg} onPair={async (c) => { try { await pair(c); setMsg(''); } catch (e) { setMsg(e.message); } }} />}
      </div>
    </main>
  );
}

function Top({ children, back = true }) {
  return <div className="remote-top">{back ? <button className="p-icon f" aria-label="Retour" onClick={() => legacy().app.back('/')}><Icon name="back" /></button> : null}{children}</div>;
}

function PairForm({ msg, onPair }) {
  const input = useRef(null);
  useEffect(() => { setTimeout(() => input.current && input.current.focus(), 50); }, []);
  return (
    <>
      <Top><b>Télécommande</b></Top>
      <form className="remote-pair" onSubmit={(e) => { e.preventDefault(); onPair(input.current.value.replace(/\D/g, '')); }}>
        <Icon name="remote" />
        <h1>Relier ce téléphone à un écran</h1>
        <p>Sur la TV ou l’ordinateur, ouvrez « Télécommande » : un code à 6 chiffres s’affiche. Ou scannez directement son QR code. Le code change après chaque téléphone relié.</p>
        <input ref={input} className="input code-input" id="remote-code" inputMode="numeric" maxLength={7} placeholder="000 000" autoComplete="one-time-code" aria-label="Code affiché sur la TV" />
        <p className="error-text">{msg}</p>
        <button className="btn btn-play f" type="submit">Relier</button>
      </form>
    </>
  );
}

function Pad({ link, onLost, onChange }) {
  const [screen, setScreen] = useState(null);
  const [cont, setCont] = useState([]);
  const [text, setText] = useState('');
  const host = useRef(null);
  const send = async (cmd, extra = {}) => {
    buzz();
    try { await api(`/api/remote/link/${link}`, { method: 'POST', body: { cmd, ...extra } }); }
    catch (e) { toast(e.message, true); if (/introuvable|déconnecté|expiré/i.test(e.message)) onLost('L’écran ne répond plus. Saisissez le code affiché sur la TV.'); }
  };
  useEffect(() => {
    api(`/api/remote/link/${link}`).then((r) => { setScreen(r.screen || 'votre écran'); send('hello'); }).catch((e) => onLost(e.message));
    // Lancer directement sur la TV ce que l'on regardait
    api('/api/home').then((home) => setCont(((home.rows || []).find((r) => r.id === 'continue') || {}).items || [])).catch(() => {});
  }, [link]);
  useEffect(() => { if (!screen) return undefined; const t = setTimeout(() => { if (text !== null) send('text', { text }); }, 350); return () => clearTimeout(t); }, [text]);
  const inSim = !!(host.current && host.current.closest('.phone-sim'));
  const pad = (cmd, ic, label, cls) => <button className={`pad-btn ${cls}`} aria-label={label} onClick={() => send(cmd)}><Icon name={ic} /></button>;
  if (!screen) return <div ref={host} />;
  return (
    <div ref={host} style={{ display: 'contents' }}>
      <Top back={!inSim}>
        <div><b>Télécommande</b><small>{`Reliée à l’écran de ${screen}`}</small></div>
        <button className="btn btn-small btn-ghost f" onClick={onChange}>Changer</button>
      </Top>
      <div className="dpad">
        {pad('up', 'up', 'Haut', 'up')}{pad('left', 'back', 'Gauche', 'left')}
        <button className="pad-btn ok" aria-label="OK" onClick={() => send('ok')}>OK</button>
        <button className="pad-btn right" aria-label="Droite" onClick={() => send('right')}><span className="flip"><Icon name="back" /></span></button>
        {pad('down', 'down', 'Bas', 'down')}
      </div>
      <div className="remote-row">
        <button className="r-btn" onClick={() => send('back')}><Icon name="back" /><span>Retour</span></button>
        <button className="r-btn" onClick={() => send('home')}><Icon name="home" /><span>Accueil</span></button>
      </div>
      <div className="remote-row media">
        <button className="r-btn" onClick={() => send('rew')}><Icon name="r10" /><span>−30 s</span></button>
        <button className="r-btn big" onClick={() => send('playpause')}><Icon name="play" /><span>Lecture / pause</span></button>
        <button className="r-btn" onClick={() => send('fwd')}><Icon name="f10" /><span>+30 s</span></button>
      </div>
      <div className="remote-search"><Icon name="search" /><input className="input" id="remote-search" placeholder="Chercher un titre sur la TV" enterKeyHint="search" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} /></div>
      <details className="remote-digits">
        <summary><Icon name="live" />Chaînes : pavé numérique</summary>
        <div className="digits">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'tv', '0', 'ok'].map((d) => (d === 'tv'
            ? <button key={d} className="digit alt" aria-label="Ouvrir la TV en direct" onClick={() => send('tv')}>TV</button>
            : d === 'ok' ? <button key={d} className="digit alt" aria-label="Valider le numéro" onClick={() => send('ok')}>OK</button>
              : <button key={d} className="digit" aria-label={`Chiffre ${d}`} onClick={() => send('digit', { digit: d })}>{d}</button>))}
        </div>
      </details>
      {cont.length ? (
        <div className="remote-launch">
          <h2>Reprendre sur la TV</h2>
          <div className="launch-list">
            {cont.slice(0, 6).map((c) => (
              <button key={c.id} className="launch-item" onClick={() => send('play', { id: c.id })}>
                {c.backdrop || c.still ? <img src={img(c.backdrop || c.still)} alt="" loading="lazy" /> : <span />}
                <span><b>{c.showTitle || c.title}</b>{c.season ? <small>{`S${c.season} É${c.episode}`}</small> : null}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
