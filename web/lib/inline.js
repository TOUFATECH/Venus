// Petits scripts « en ligne » de l'interface (thème appliqué avant le premier affichage, filet de sécurité
// du chargement) : lus dans public/index.html, la seule source, pour ne jamais diverger de l'interface classique.
import fs from 'node:fs';
import path from 'node:path';

let cache = { at: 0, v: { head: [], body: [] } };
// Contenu des scripts intégrés d'une page HTML
const grab = (s) => [...String(s || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

// Scripts intégrés de public/index.html (à marquer du nonce CSP)
export function inlineScripts() {
  const dir = process.env.VENUS_PUBLIC_DIR;
  if (!dir) return cache.v;
  const file = path.join(dir, 'index.html');
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs === cache.at) return cache.v;
    const [head, body] = fs.readFileSync(file, 'utf8').split('</head>');
    cache = { at: st.mtimeMs, v: { head: grab(head), body: grab(body) } };
  } catch { /* fichier absent : l'interface démarre quand même, sans thème préchargé */ }
  return cache.v;
}
