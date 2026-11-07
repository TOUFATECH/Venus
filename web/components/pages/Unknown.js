'use client';
// Adresse inconnue : un lecteur s'il s'agit d'une adresse de lecture (chaîne au nom inhabituel…),
// sinon retour à l'accueil
import { useEffect } from 'react';
import { legacy } from '../../lib/legacy';
import { useVenus } from '../Venus';
import Player from './Player';

export default function Unknown() {
  const { path } = useVenus();
  const route = legacy().app.matchRoute(path);
  const playable = route && route.bare;
  useEffect(() => { if (!playable) { legacy().app.hideBoot(); legacy().app.go('/', { replace: true }); } }, []);
  return playable ? <Player /> : <main className="with-nav" />;
}
