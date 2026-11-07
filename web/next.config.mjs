// Interface de Venus en Next.js. Elle est construite une fois (npm run build, ou par le Dockerfile)
// puis servie par le serveur Venus lui-même (server/next-ui.js) : un seul port, une seule application.
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);

/** @type {import('next').NextConfig} */
export default {
  // Serveur Next autonome et léger, chargé par le serveur Venus (pas de dossier node_modules complet dans l'image)
  output: 'standalone',
  outputFileTracingRoot: here,
  turbopack: { root: here },
  poweredByHeader: false,
  // Le serveur Venus compresse déjà (brotli / gzip) et sert lui-même les fichiers /_next/static
  compress: false,
  // Les vues de l'ancienne interface s'attachent au DOM une seule fois : pas de double montage en développement
  reactStrictMode: false,
  devIndicators: false,
  agentRules: false,
  // Pas d'optimisation d'images par Next (le serveur Venus redimensionne déjà affiches et vignettes) : image plus légère
  images: { unoptimized: true },
  outputFileTracingExcludes: { '*': ['node_modules/@img/**', 'node_modules/sharp/**', 'node_modules/@emnapi/**'] },
  // Développement (npm run dev) : l'API, les images et les modules de l'interface viennent d'un serveur Venus
  // déjà lancé, par exemple VENUS_API=http://localhost:8096 npm run dev
  async rewrites() {
    const api = process.env.VENUS_API;
    if (!api) return [];
    const paths = ['/api/:p*', '/img/:p*', '/cal/:p*', '/js/:p*', '/css/:p*', '/b/:p*', '/fonts/:p*', '/icons/:p*', '/vendor/:p*', '/custom.css', '/sw.js', '/manifest.webmanifest'];
    return { beforeFiles: paths.map((source) => ({ source, destination: `${api}${source}` })) };
  },
};
