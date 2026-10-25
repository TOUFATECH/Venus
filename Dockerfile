# Venus — image Docker légère avec ffmpeg de Jellyfin (tous les pilotes d'accélération matérielle inclus)
FROM node:24-bookworm-slim

ARG TARGETARCH
ARG FFMPEG_PKG=jellyfin-ffmpeg7

ENV NODE_ENV=production \
    PORT=8096 \
    DATA_DIR=/config \
    TRANSCODE_DIR=/transcode \
    MOVIES_PATH=/media/films \
    SHOWS_PATH=/media/series

# ffmpeg optimisé (NVENC, VA-API, Quick Sync, tone-mapping HDR) depuis le dépôt Jellyfin,
# avec repli automatique sur le ffmpeg de Debian si le dépôt est indisponible.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    mkdir -p /etc/apt/keyrings; \
    if curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg; then \
      . /etc/os-release; \
      echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/jellyfin.list; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends "${FFMPEG_PKG}" \
      || apt-get install -y --no-install-recommends jellyfin-ffmpeg6 \
      || apt-get install -y --no-install-recommends ffmpeg; \
    if [ "${TARGETARCH:-amd64}" = "amd64" ]; then \
      apt-get install -y --no-install-recommends mesa-va-drivers intel-media-va-driver vainfo || true; \
    fi; \
    apt-get purge -y gnupg; apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /config /transcode /media/films /media/series

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

EXPOSE 8096
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8096)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
