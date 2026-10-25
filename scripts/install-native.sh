#!/usr/bin/env bash
# Venus — installation SANS Docker sur Linux (Debian, Ubuntu, Proxmox LXC, Fedora, Arch…)
#
#   curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh | sudo bash
#   ou, depuis le dossier Venus :  sudo bash scripts/install-native.sh
#
# Relancer le script met Venus à jour (vos réglages et bibliothèques sont conservés).
# Désinstaller :  sudo bash scripts/install-native.sh uninstall
set -euo pipefail

REPO="https://github.com/TOUFATECH/Venus.git"
APP_DIR_DEFAULT="/opt/venus"
DATA_DIR="/var/lib/venus"
TRANSCODE_DIR="/var/cache/venus/transcode"
ENV_FILE="/etc/venus/venus.env"
UNIT="/etc/systemd/system/venus.service"
NODE_MIN="22.13.0"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
# Questions possibles même avec « curl … | bash » (on lit le clavier, pas le tube)
ask()  { local v=""; if ( : < /dev/tty ) 2>/dev/null; then read -rp "  $1" v < /dev/tty || true; fi; printf '%s' "${v:-${2:-}}"; }

[ "$(id -u)" = 0 ] || die "Lancez ce script en root : sudo bash $0"
[ "$(uname -s)" = Linux ] || die "Ce script est pour Linux. macOS : scripts/install-macos.sh — Windows : scripts/install-windows.ps1"

# ------------------------------------------------------------------ désinstallation
if [ "${1:-}" = uninstall ]; then
  bold "Désinstallation de Venus"
  systemctl disable --now venus 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload 2>/dev/null || true
  ok "Service arrêté et supprimé"
  warn "Conservés : vos vidéos, les réglages ($DATA_DIR) et le code. Pour tout effacer : rm -rf $DATA_DIR /etc/venus /var/cache/venus $APP_DIR_DEFAULT"
  exit 0
fi

bold "Installation de Venus (sans Docker)"

# ------------------------------------------------------------------ gestionnaire de paquets
PM=""
for p in apt-get dnf yum pacman zypper apk; do command -v "$p" >/dev/null 2>&1 && { PM="$p"; break; }; done
[ -n "$PM" ] || die "Gestionnaire de paquets non reconnu. Installez à la main Node.js ≥ ${NODE_MIN} et ffmpeg, puis lancez : npm start"
pkg() {
  case "$PM" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf|yum) "$PM" install -y "$@" ;;
    pacman)  pacman -S --noconfirm --needed "$@" ;;
    zypper)  zypper --non-interactive install "$@" ;;
    apk)     apk add --no-cache "$@" ;;
  esac
}
[ "$PM" = apt-get ] && apt-get update -qq
pkg ca-certificates curl tar xz-utils >/dev/null 2>&1 || pkg ca-certificates curl tar xz >/dev/null 2>&1 || true
command -v git >/dev/null 2>&1 || pkg git >/dev/null
ok "Outils de base prêts ($PM)"

# ------------------------------------------------------------------ code de Venus
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/../server/index.js" ]; then
  APP_DIR="$(cd "$SELF_DIR/.." && pwd)"           # lancé depuis un dossier Venus déjà téléchargé
else
  APP_DIR="$APP_DIR_DEFAULT"
fi
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only -q && ok "Code mis à jour ($APP_DIR)" || warn "Mise à jour du code impossible (modifications locales ?) : on garde la version présente"
elif [ ! -f "$APP_DIR/server/index.js" ]; then
  git clone -q --depth 1 "$REPO" "$APP_DIR"
  ok "Code téléchargé dans $APP_DIR"
fi

# ------------------------------------------------------------------ Node.js
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
NODE_BIN=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
elif [ -x /opt/venus-node/bin/node ] && node_ok /opt/venus-node/bin/node; then
  NODE_BIN=/opt/venus-node/bin/node
else
  # Version officielle de nodejs.org, indépendante de la distribution, dans /opt/venus-node
  case "$(uname -m)" in
    x86_64) NARCH=x64 ;; aarch64|arm64) NARCH=arm64 ;; armv7l) NARCH=armv7l ;;
    *) die "Processeur $(uname -m) non pris en charge par Node.js officiel" ;;
  esac
  BASE="https://nodejs.org/dist/latest-v22.x"
  FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-${NARCH}\.tar\.xz" | head -1)"
  [ -n "$FILE" ] || die "Téléchargement de Node.js impossible (nodejs.org injoignable ?)"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$BASE/$FILE" -o "$TMP/node.tar.xz"
  (cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | sed "s# $FILE\$# node.tar.xz#" | sha256sum -c - >/dev/null) || die "Somme de contrôle de Node.js invalide"
  rm -rf /opt/venus-node && mkdir -p /opt/venus-node
  tar -xJf "$TMP/node.tar.xz" -C /opt/venus-node --strip-components 1
  NODE_BIN=/opt/venus-node/bin/node
fi
ok "Node.js $("$NODE_BIN" -v) ($NODE_BIN)"

# ------------------------------------------------------------------ ffmpeg + partages réseau
FFMPEG=""
if [ "$PM" = apt-get ] && [ ! -x /usr/lib/jellyfin-ffmpeg/ffmpeg ]; then
  # ffmpeg de Jellyfin : pilotes Intel / AMD / NVIDIA et tone-mapping HDR inclus
  . /etc/os-release
  case "${ID:-}:${ID_LIKE:-}" in
    *ubuntu*) JREPO=ubuntu ;; *) JREPO=debian ;;
  esac
  CODENAME="${VERSION_CODENAME:-}"
  [ "${ID:-}" = ubuntu ] || [ "${ID:-}" = debian ] || CODENAME="${UBUNTU_CODENAME:-${DEBIAN_CODENAME:-$CODENAME}}"
  pkg gnupg >/dev/null 2>&1 || true
  mkdir -p /etc/apt/keyrings
  if [ -n "$CODENAME" ] && curl -fsL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/jellyfin.gpg 2>/dev/null; then
    echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/${JREPO} ${CODENAME} main" > /etc/apt/sources.list.d/jellyfin.list
    apt-get update -qq || true
    pkg jellyfin-ffmpeg7 >/dev/null 2>&1 || pkg jellyfin-ffmpeg6 >/dev/null 2>&1 || { rm -f /etc/apt/sources.list.d/jellyfin.list; apt-get update -qq; }
  fi
fi
if [ -x /usr/lib/jellyfin-ffmpeg/ffmpeg ]; then
  FFMPEG=/usr/lib/jellyfin-ffmpeg/ffmpeg
else
  command -v ffmpeg >/dev/null 2>&1 || pkg ffmpeg >/dev/null 2>&1 || { [ "$PM" = dnf ] && pkg ffmpeg-free >/dev/null 2>&1; } || true
  FFMPEG="$(command -v ffmpeg || true)"
fi
[ -n "$FFMPEG" ] || die "ffmpeg introuvable et impossible à installer. Installez-le puis relancez ce script."
ok "ffmpeg : $FFMPEG"

case "$PM" in
  apt-get) pkg cifs-utils nfs-common smbclient >/dev/null 2>&1 || true
           [ "$(uname -m)" = x86_64 ] && { pkg intel-media-va-driver mesa-va-drivers vainfo >/dev/null 2>&1 || pkg mesa-va-drivers >/dev/null 2>&1 || true; } ;;
  dnf|yum) pkg cifs-utils nfs-utils samba-client >/dev/null 2>&1 || true ;;
  pacman)  pkg cifs-utils nfs-utils smbclient libva-mesa-driver >/dev/null 2>&1 || true ;;
  zypper)  pkg cifs-utils nfs-client samba-client >/dev/null 2>&1 || true ;;
  apk)     pkg cifs-utils nfs-utils samba-client >/dev/null 2>&1 || true ;;
esac
ok "Outils de partage réseau (SMB / NFS)"

# ------------------------------------------------------------------ réglages
mkdir -p "$DATA_DIR" "$TRANSCODE_DIR" "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  bold "Où sont vos vidéos ? (Entrée pour passer : vous pourrez tout ajouter dans Réglages → Bibliothèques)"
  MOVIES="$(ask 'Dossier des FILMS  : ')"; SHOWS="$(ask 'Dossier des SÉRIES : ')"
  ANIME="$(ask 'Dossier des ANIMÉS : ')"; CLIPS="$(ask 'Dossier des CLIPS  : ')"
  PORT="$(ask 'Port de Venus [8096] : ' 8096)"
  {
    echo "# Réglages de Venus — modifiez puis : systemctl restart venus"
    echo "PORT=${PORT}"
    echo "DATA_DIR=${DATA_DIR}"
    echo "TRANSCODE_DIR=${TRANSCODE_DIR}"
    echo "FFMPEG_PATH=${FFMPEG}"
    echo "FFPROBE_PATH=$(dirname "$FFMPEG")/ffprobe"
    [ -n "$MOVIES" ] && echo "MOVIES_PATH=${MOVIES}"
    [ -n "$SHOWS" ] && echo "SHOWS_PATH=${SHOWS}"
    [ -n "$ANIME" ] && echo "ANIME_PATH=${ANIME}"
    [ -n "$CLIPS" ] && echo "CLIPS_PATH=${CLIPS}"
    echo "# TMDB_API_KEY=votre_cle    (affiches et résumés, peut aussi se saisir dans l'interface)"
    echo "# HWACCEL=auto              (auto | nvenc | vaapi | qsv | v4l2m2m | none)"
    echo "TZ=$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Europe/Paris)"
  } > "$ENV_FILE"
  ok "Réglages écrits dans $ENV_FILE"
else
  sed -i "s#^FFMPEG_PATH=.*#FFMPEG_PATH=${FFMPEG}#; s#^FFPROBE_PATH=.*#FFPROBE_PATH=$(dirname "$FFMPEG")/ffprobe#" "$ENV_FILE"
  ok "Réglages existants conservés ($ENV_FILE)"
fi
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"; PORT="${PORT:-8096}"

# ------------------------------------------------------------------ service
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=Venus, serveur multimédia
Documentation=https://github.com/TOUFATECH/Venus
After=network-online.target remote-fs.target
Wants=network-online.target

[Service]
Type=simple
# root : nécessaire pour monter vous-même les partages réseau depuis l'interface
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=3
Nice=-2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable venus >/dev/null 2>&1
  systemctl restart venus
  ok "Service venus démarré (redémarre tout seul avec la machine)"
else
  warn "systemd absent : lancez Venus vous-même avec :"
  echo "    cd ${APP_DIR} && set -a && . ${ENV_FILE} && set +a && ${NODE_BIN} --disable-warning=ExperimentalWarning server/index.js"
  exit 0
fi

# ------------------------------------------------------------------ vérification
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  bold "✅ Venus fonctionne : http://${IP:-localhost}:${PORT}"
  echo "   Journal : journalctl -u venus -f        Mise à jour : relancez ce script"
  if [ -r /proc/self/uid_map ] && ! awk 'NR==1 && $1==0 && $2==0 {f=1} END {exit !f}' /proc/self/uid_map; then
    echo
    warn "Conteneur LXC non privilégié détecté. Sur l'hôte Proxmox, pour la carte graphique et le NAS :"
    echo "    bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu <ID-du-conteneur>"
    echo "    bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) nas <ID-du-conteneur>"
  fi
else
  warn "Venus ne répond pas encore. Regardez le journal : journalctl -u venus -n 50"
  exit 1
fi
