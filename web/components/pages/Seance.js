'use client';
// Rejoindre une séance à plusieurs avec son code (ou via le lien d'invitation)
import { useEffect, useRef, useState } from 'react';
import { useTitle, api, go } from '../../lib/hooks';
import { shared } from '../../lib/shared';
import { useVenus } from '../Venus';
import { Icon } from '../Icon';

export default function Seance() {
  useTitle('Séance');
  const { search } = useVenus();
  const [code, setCode] = useState(((search && search.get('code')) || '').toUpperCase());
  const [err, setErr] = useState('');
  const input = useRef(null);
  const join = async (e) => {
    if (e) e.preventDefault();
    setErr('');
    const c = code.trim().toUpperCase();
    if (c.length !== 4) { setErr('Le code fait 4 lettres.'); return; }
    try { const r = await api(`/api/rooms/${c}`); go(`/lecture/${r.itemId}?salle=${r.code}`, { replace: true }); } catch (e2) { setErr(e2.message); }
  };
  useEffect(() => { shared().app.hideBoot(); if (code.length === 4) join(); else setTimeout(() => input.current && input.current.focus(), 50); }, []);
  return (
    <main className="with-nav page-in">
      <div className="page">
        <div className="together">
          <form className="panel" onSubmit={join}>
            <Icon name="people" />
            <h1>Rejoindre une séance</h1>
            <p>Regardez le même film au même moment que vos proches, chacun chez soi. Pause, retour en arrière, réactions et discussion sont partagés.</p>
            <input ref={input} className="input code-input" id="room-code" maxLength={4} placeholder="ABCD" autoComplete="off" autoCapitalize="characters" aria-label="Code de la séance" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <p className="error-text">{err}</p>
            <div className="form-actions"><button className="btn btn-play f" type="submit">Rejoindre</button></div>
          </form>
          <div className="together-how">
            <h2>Lancer votre propre séance</h2>
            <ol><li>Lancez un film ou un épisode.</li><li>Dans le lecteur, touchez « Ensemble ».</li><li>Partagez le code de 4 lettres ou le QR code.</li></ol>
          </div>
        </div>
      </div>
    </main>
  );
}
