#!/usr/bin/env bash
# Venus — installation sur Mac (Apple Silicon ou Intel), sans Docker.
# La conversion vidéo utilise la puce du Mac (VideoToolbox) : rapide et silencieux.
#
#   curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh | bash
#   ou, depuis le dossier Venus :  bash scripts/install-macos.sh
#
# Relancer le script met Venus à jour (réglages et bibliothèques conservés).
# Désinstaller :  bash scripts/install-macos.sh uninstall
set -euo pipefail

REPO="https://github.com/TOUFATECH/Venus.git"
LABEL="io.github.toufatech.venus"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT="$HOME/Library/Application Support/Venus"
DATA_DIR="$SUPPORT/data"
TRANSCODE_DIR="$HOME/Library/Caches/Venus/transcode"
LOG="$HOME/Library/Logs/Venus.log"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { local v=""; if ( : < /dev/tty ) 2>/dev/null; then read -rp "  $1" v < /dev/tty || true; fi; printf '%s' "${v:-${2:-}}"; }
xml()  { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

[ "$(uname -s)" = Darwin ] || die "Ce script est pour macOS. Linux : scripts/install-native.sh — Windows : scripts/install-windows.ps1"
[ "$(id -u)" != 0 ] || die "Lancez ce script sans sudo : Venus tourne avec votre compte."
UID_NUM="$(id -u)"

if [ "${1:-}" = uninstall ]; then
  bold "Désinstallation de Venus"
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST"
  ok "Venus ne démarre plus avec le Mac"
  warn "Conservés : vos vidéos et vos réglages (${SUPPORT}). Pour tout effacer : rm -rf \"${SUPPORT}\" ~/Library/Caches/Venus"
  exit 0
fi

bold "Installation de Venus sur Mac"

# ------------------------------------------------------------------ Homebrew, Node.js, ffmpeg
BREW="$(command -v brew || true)"
[ -n "$BREW" ] || { [ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew; } || true
[ -n "$BREW" ] || { [ -x /usr/local/bin/brew ] && BREW=/usr/local/bin/brew; } || true
if [ -z "$BREW" ]; then
  warn "Homebrew est nécessaire pour installer Node.js et ffmpeg. Installez-le avec :"
  echo '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  die "Puis relancez ce script."
fi
PREFIX="$("$BREW" --prefix)"
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
NODE_BIN="$PREFIX/bin/node"
if ! [ -x "$NODE_BIN" ] || ! node_ok "$NODE_BIN"; then
  "$BREW" install node >/dev/null || "$BREW" upgrade node >/dev/null
fi
[ -x "$PREFIX/bin/ffmpeg" ] || "$BREW" install ffmpeg >/dev/null
command -v git >/dev/null 2>&1 || "$BREW" install git >/dev/null
ok "Node.js $("$NODE_BIN" -v), ffmpeg $("$PREFIX/bin/ffmpeg" -version | head -1 | awk '{print $3}')"

# ------------------------------------------------------------------ code de Venus
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/../server/index.js" ]; then
  APP_DIR="$(cd "$SELF_DIR/.." && pwd)"
else
  APP_DIR="$SUPPORT/app"
fi
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only -q && ok "Code mis à jour" || warn "Mise à jour du code impossible : on garde la version présente"
elif [ ! -f "$APP_DIR/server/index.js" ]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone -q --depth 1 "$REPO" "$APP_DIR"
  ok "Code téléchargé dans ${APP_DIR}"
fi

# ------------------------------------------------------------------ réglages
mkdir -p "$DATA_DIR" "$TRANSCODE_DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
CONF="$SUPPORT/venus.conf"
if [ ! -f "$CONF" ]; then
  bold "Où sont vos vidéos ? (Entrée = proposition entre crochets, ou rien pour passer)"
  MOVIES="$(ask "Dossier des FILMS  [$HOME/Movies] : " "$HOME/Movies")"
  SHOWS="$(ask 'Dossier des SÉRIES : ')"; ANIME="$(ask 'Dossier des ANIMÉS : ')"; CLIPS="$(ask 'Dossier des CLIPS  : ')"
  PORT="$(ask 'Port de Venus [8096] : ' 8096)"
  {
    echo "# Réglages de Venus — modifiez puis relancez : bash scripts/install-macos.sh"
    echo "PORT=$PORT"
    [ -n "$MOVIES" ] && echo "MOVIES_PATH=$MOVIES"
    [ -n "$SHOWS" ] && echo "SHOWS_PATH=$SHOWS"
    [ -n "$ANIME" ] && echo "ANIME_PATH=$ANIME"
    [ -n "$CLIPS" ] && echo "CLIPS_PATH=$CLIPS"
    echo "# TMDB_API_KEY=votre_cle"
  } > "$CONF"
  ok "Réglages écrits dans ${CONF}"
else
  ok "Réglages existants conservés (${CONF})"
fi

# Variables de lancement : réglages de l'utilisateur + chemins fixes
ENV_XML=""
add_env() { ENV_XML="${ENV_XML}      <key>$(xml "$1")</key><string>$(xml "$2")</string>
"; }
add_env PATH "$PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"
add_env NODE_ENV production
add_env DATA_DIR "$DATA_DIR"
add_env TRANSCODE_DIR "$TRANSCODE_DIR"
add_env FFMPEG_PATH "$PREFIX/bin/ffmpeg"
add_env FFPROBE_PATH "$PREFIX/bin/ffprobe"
while IFS='=' read -r k v; do
  case "$k" in ''|\#*) continue ;; esac
  add_env "$k" "$v"
done < "$CONF"
PORT="$(sed -n 's/^PORT=//p' "$CONF" | tail -1)"; PORT="${PORT:-8096}"

# ------------------------------------------------------------------ démarrage automatique (LaunchAgent)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>$(xml "$NODE_BIN")</string>
      <string>--disable-warning=ExperimentalWarning</string>
      <string>server/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>
    <key>EnvironmentVariables</key>
    <dict>
${ENV_XML}    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>$(xml "$LOG")</string>
    <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
  </dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null || die "Fichier de démarrage invalide : $PLIST"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 || true
ok "Venus démarre maintenant et à chaque ouverture de session"

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)"
  echo
  bold "✅ Venus fonctionne : http://${IP}:${PORT}  (sur ce Mac : http://localhost:${PORT})"
  echo "   Journal : tail -f ~/Library/Logs/Venus.log      Mise à jour : relancez ce script"
  echo "   Si macOS demande l'autorisation pour « node » (réseau local, dossiers) : acceptez."
  echo "   Vidéos sur un disque externe ou dans Documents : Réglages Système → Confidentialité → Accès complet au disque → ajoutez ${NODE_BIN}"
  open "http://localhost:${PORT}" 2>/dev/null || true
else
  warn "Venus ne répond pas encore. Regardez le journal : tail -n 50 ~/Library/Logs/Venus.log"
  exit 1
fi
