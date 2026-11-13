'use client';
// Adresse d'un titre : /titre/12, /films/inception-2010, /series/breaking-bad…
// Films et clips : la même adresse sert à la lecture (notée dans l'historique) ; sinon c'est la fiche.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { shared } from '../../lib/shared';
import Details from './Details';
import Player from './Player';

// Décode un paramètre d'adresse
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

// Fiche d'un titre à partir de son adresse lisible (ou de son identifiant)
export default function TitleRoute({ param = 'slug' }) {
  const params = useParams();
  const raw = dec(String(params[param] || ''));
  const L = shared();
  const playing = typeof window !== 'undefined' && !window.__VN_MEMORY_ROUTER && history.state && history.state.vnPlay;
  const [id, setId] = useState(/^\d+$/.test(raw) ? Number(raw) : null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (playing || id) return;
    L.app.resolveParams({ slug: raw }).then((p) => setId(p.id)).catch((e) => { setError(e); L.ui.toast(e.message, true); L.app.go('/', { replace: true }); });
  }, [raw]);
  if (playing) return <Player />;
  if (error) return null;
  if (!id) return <main className="with-nav" />;
  return <Details id={id} />;
}
