// Lance un VRAI Odin (copie du dépôt Odin donnée par ODIN_DEPOT) pour les essais de Venus, avec son banc d'essai
// (test/banc/odin-vrai.ts) : compte du propriétaire, Persona, sauvegardes des applis. À lancer avec
// « node --experimental-strip-types » (Odin est écrit en TypeScript). Écrit une ligne JSON sur la sortie
// ({ url, proprietaire, personnes }) puis attend que l'entrée standard se ferme pour tout arrêter.
// Argument : l'adresse de retour de Venus à déclarer dans Persona (ex. http://127.0.0.1:18096/auth/odin/retour).
import fs from 'node:fs';
import path from 'node:path';

const depot = process.env.ODIN_DEPOT;
const retour = process.argv[2] || '';
const { T } = await import(path.join(depot, 'test/banc/lib.ts'));
const { vraiOdin, COMPTE } = await import(path.join(depot, 'test/banc/odin-vrai.ts'));
const { allModules, valhallaOf } = await import(path.join(depot, 'src/valhalla/odin.ts'));

// Les messages d'Odin vont sur la sortie d'erreur (la sortie standard ne porte que la ligne JSON)
for (const k of ['log', 'warn', 'info']) console[k] = (...a) => process.stderr.write(`${a.map(String).join(' ')}\n`);
const tt = new T();
// Un faux pare-feu : le port direct de l'appli ne touche pas à celui de la machine (comme les essais d'Odin)
const dir = tt.tmp('faux-pare-feu-');
fs.writeFileSync(path.join(dir, 'ufw'), '#!/bin/sh\nif [ "$1" = status ]; then echo "Status: active"; fi\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'nft'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.PATH = `${dir}:${process.env.PATH}`;
const IDS = ['var', 'brisingamen', 'freyja', 'garmr', 'fjalar', 'valgrind'];
const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
const va = valhallaOf();
const personnes = { kofi: { mdp: 'girafe-orange-sous-la-pluie-42', groupes: 'famille' }, invite: { mdp: 'baobab-violet-au-clair-de-lune-7', groupes: 'invite' } };
for (const [login, p] of Object.entries(personnes)) {
  const r = await va.act('var', 'ajouter', { login, nom: login === 'kofi' ? 'Kofi' : 'Invité', groupes: p.groupes, email: `${login}@exemple.yt`, mot_de_passe: p.mdp });
  if (!r.ok) throw new Error(r.text);
}
if (retour) { const r = await va.act('var', 'ajouter_retour', { appli: 'venus', adresse: retour }); if (!r.ok) throw new Error(r.text); }
process.stdout.write(`${JSON.stringify({ url: v.url, proprietaire: { email: COMPTE.email, mdp: COMPTE.password, prenom: COMPTE.prenom }, personnes, home: v.o.paths.home })}\n`);
process.stdin.resume();
process.stdin.on('end', async () => { await tt.end().catch(() => {}); process.exit(0); });
