# Venus — image Docker légère avec un ffmpeg optimisé (tous les pilotes d'accélération matérielle inclus)

# Étape 1 : interface allégée (JS et CSS minifiés). esbuild ne sert qu'ici ; s'il n'est pas téléchargeable,
# l'interface est gardée telle quelle et la construction continue.
FROM node:24-trixie-slim AS web
WORKDIR /w
COPY public ./public
COPY scripts/minify.mjs ./minify.mjs
RUN (npm install --no-save --no-audit --no-fund --loglevel=error esbuild@0.24.2 && node minify.mjs public) || echo "Interface non minifiée (esbuild indisponible)"

# Étape 2 : interface Next.js, construite en serveur autonome léger (~20 Mo, sans dossier node_modules complet)
FROM node:24-trixie-slim AS next
WORKDIR /w/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY web ./
# Code partagé (public/js) : embarqué par Next.js dans ses propres fichiers
COPY public/js /w/public/js
RUN npm run build \
 && mkdir -p /out \
 && cp -r .next/standalone/. /out/ \
 && mkdir -p /out/.next && cp -r .next/static /out/.next/static

# Étape 3 : whisper.cpp (sous-titres générés par reconnaissance vocale, hors ligne). Si la compilation échoue,
# l'image se construit quand même, sans cette fonction.
FROM debian:trixie-slim AS whisper
RUN set -eux; apt-get update; apt-get install -y --no-install-recommends ca-certificates git cmake g++ make; rm -rf /var/lib/apt/lists/*; \
    mkdir -p /out; \
    ( git clone --depth 1 --branch v1.7.5 https://github.com/ggml-org/whisper.cpp /w && cd /w \
      && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_NATIVE=OFF \
      && cmake --build build -j"$(nproc)" --target whisper-cli \
      && cp build/bin/whisper-cli /out/ ) || echo "whisper.cpp non compilé"

FROM node:24-trixie-slim

ARG TARGETARCH
ARG FFMPEG_PKG=jellyfin-ffmpeg7

ENV NODE_ENV=production \
    PORT=8096 \
    DATA_DIR=/config \
    TRANSCODE_DIR=/transcode \
    MOVIES_PATH=/media/films \
    SHOWS_PATH=/media/series

# ffmpeg optimisé (NVENC, VA-API, Quick Sync, tone-mapping HDR) depuis un dépôt APT tiers signé,
# avec repli automatique sur le ffmpeg de Debian si le dépôt est indisponible.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl; \
    mkdir -p /etc/apt/keyrings; \
    if curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg; then \
      . /etc/os-release; \
      echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/jellyfin.list; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends "${FFMPEG_PKG}" \
      || apt-get install -y --no-install-recommends jellyfin-ffmpeg6 \
      || apt-get install -y --no-install-recommends ffmpeg; \
    apt-get install -y --no-install-recommends cifs-utils nfs-common smbclient libgomp1 libstdc++6 libchromaprint-tools; \
    if [ "${TARGETARCH:-amd64}" = "amd64" ]; then \
      apt-get install -y --no-install-recommends mesa-va-drivers intel-media-va-driver vainfo || true; \
    fi; \
    apt-get purge -y gnupg; apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /config /transcode /media/films /media/series /mnt/venus

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY --from=web /w/public ./public
# Interface Next.js : lancée et surveillée par Venus sur un port interne (VENUS_UI=classic pour l'ancienne interface)
COPY --from=next /out ./web-dist
# whisper-cli (s'il a pu être compilé) : Venus le trouve dans /usr/local/bin
COPY --from=whisper /out/ /usr/local/bin/

EXPOSE 8096
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8096)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
