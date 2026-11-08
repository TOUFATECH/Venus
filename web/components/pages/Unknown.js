'use client';
// Adresse inconnue : un lecteur s'il s'agit d'une adresse de lecture (chaîne au nom inhabituel…),
// sinon retour à l'accueil
import { useEffect } from 'react';
import { shared } from '../../lib/shared';
import { useVenus } from '../Venus';
import Player from './Player';

export default function Unknown() {
  const { path } = useVenus();
  const route = shared().app.matchRoute(path);
  const playable = route && route.bare;
  useEffect(() => { if (!playable) { shared().app.hideBoot(); shared().app.go('/', { replace: true }); } }, []);
  return playable ? <Player /> : <main className="with-nav" />;
}
