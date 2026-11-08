// Copie le code partagé de Venus (public/js : accès au serveur, thèmes, menu, navigation à la télécommande,
// moteur de lecture…) dans web/partage/js, pour que Next.js l'embarque dans ses propres fichiers.
// Lancé tout seul avant « npm run build » et « npm run dev ».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.resolve(web, '..', 'public', 'js');
const to = path.join(web, 'partage', 'js');
if (!fs.existsSync(from)) { console.error(`Code partagé introuvable : ${from}`); process.exit(1); }
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, filter: (f) => !/\.min\.|\.map$/.test(f) });
console.log(`Code partagé copié : ${path.relative(web, to)}`);
