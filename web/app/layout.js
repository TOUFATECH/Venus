// Page HTML de Venus : en-tête, thème appliqué avant le premier affichage (pas de clignotement),
// écran de chargement, puis l'application React (components/Venus.js).
// Les petits scripts « en ligne » sont ceux de public/index.html, marqués du nonce donné par le serveur Venus (politique de sécurité du contenu stricte, aucun script inconnu ne peut s'exécuter).
import { headers } from 'next/headers';
import Venus from '../components/Venus';
import { inlineScripts } from '../lib/inline';

export const dynamic = 'force-dynamic';
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0d1016' };

export default async function RootLayout({ children }) {
  const h = await headers();
  const nonce = h.get('x-venus-nonce') || undefined;
  const build = (h.get('x-venus-build') || '').replace(/[^a-f0-9]/g, '');
  const inline = inlineScripts();
  const b = build ? `/b/${build}` : '';
  const script = (s, i) => <script key={i} nonce={nonce} dangerouslySetInnerHTML={{ __html: s }} />;
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <meta name="description" content="Venus, votre cinéma personnel" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Venus" />
        <meta name="venus-build" content={build} />
        <title>Venus</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <link rel="preload" href={`${b}/fonts/archivo.woff2`} as="font" type="font/woff2" crossOrigin="" />
        <link rel="stylesheet" href={`${b}/css/app.css`} />
        <link rel="stylesheet" href="/custom.css" />
        {(inline.head || []).map(script)}
      </head>
      <body suppressHydrationWarning>
        <div className="boot" role="status" aria-label="Chargement de Venus">
          <div className="boot-inner">
            <div className="boot-venus" aria-hidden="true"><div className="bv-clouds" /><div className="bv-swirl" /></div>
            <div className="boot-note" />
          </div>
        </div>
        <Venus>{children}</Venus>
        <noscript>Venus a besoin de JavaScript pour fonctionner.</noscript>
        {(inline.body || []).map(script)}
      </body>
    </html>
  );
}
