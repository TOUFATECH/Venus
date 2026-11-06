// Allège l'interface au moment de construire l'image Docker : chaque fichier JS et CSS est minifié sur place
// (mêmes noms, mêmes imports : rien d'autre ne change). esbuild n'est utilisé qu'à la construction ; Venus
// lui-même reste sans dépendance. En cas de problème, les fichiers d'origine sont gardés.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'public';
let esbuild;
try { esbuild = await import('esbuild'); } catch { console.log('esbuild absent : interface non minifiée'); process.exit(0); }
let before = 0, after = 0, n = 0;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const file of walk(root)) {
  const ext = path.extname(file);
  if (!['.js', '.mjs', '.css'].includes(ext) || /\.min\./.test(file)) continue;
  if (path.basename(file) === 'sw.js') continue; // le service worker reste lisible (mises à jour du cache)
  const src = fs.readFileSync(file, 'utf8');
  try {
    const out = esbuild.transformSync(src, { loader: ext === '.css' ? 'css' : 'js', minify: true, target: ext === '.css' ? ['chrome100', 'firefox100', 'safari15'] : 'es2022', legalComments: 'none', charset: 'utf8' });
    if (out.code.length && out.code.length < src.length) { fs.writeFileSync(file, out.code); before += src.length; after += out.code.length; n++; }
  } catch (e) { console.warn(`gardé tel quel : ${file} (${e.message.split('\n')[0]})`); }
}
console.log(`Interface minifiée : ${n} fichiers, ${(before / 1024).toFixed(0)} Ko → ${(after / 1024).toFixed(0)} Ko`);
