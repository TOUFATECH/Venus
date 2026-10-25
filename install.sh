#!/usr/bin/env bash
# Installation de Venus en une commande : détecte la carte graphique, demande vos dossiers, démarre tout.
# Usage : ./install.sh                      (questions interactives)
#         ./install.sh /chemin/Films /chemin/Series
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

bold "Installation de Venus"

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker n'est pas installé. Installez-le : https://docs.docker.com/engine/install/"
  exit 1
fi
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else warn "Docker Compose est introuvable."; exit 1; fi
ok "Docker trouvé"

MOVIES="${1:-}"; SHOWS="${2:-}"; ANIME="${3:-}"; CLIPS="${4:-}"
if [ -z "$MOVIES" ]; then read -rp "  Dossier de vos FILMS  (Entrée si tout est sur un NAS) : " MOVIES || true; fi
if [ -z "$SHOWS" ];  then read -rp "  Dossier de vos SÉRIES (Entrée si tout est sur un NAS) : " SHOWS || true; fi
if [ -z "$ANIME" ] && [ -t 0 ]; then read -rp "  Dossier de vos ANIMÉS (Entrée pour passer) : " ANIME || true; fi
if [ -z "$CLIPS" ] && [ -t 0 ]; then read -rp "  Dossier de vos CLIPS  (Entrée pour passer) : " CLIPS || true; fi
# Tout est sur un NAS ? Des dossiers locaux vides suffisent (les partages s'ajoutent ensuite dans Réglages)
[ -z "$MOVIES" ] && MOVIES="$PWD/media/films"
[ -z "$SHOWS" ] && SHOWS="$PWD/media/series"
for d in "$MOVIES" "$SHOWS"; do
  if [ ! -d "$d" ]; then warn "Dossier introuvable : $d (il sera créé vide)"; mkdir -p "$d"; fi
done
MOVIES="$(cd "$MOVIES" && pwd)"; SHOWS="$(cd "$SHOWS" && pwd)"
ok "Films  : $MOVIES"
ok "Séries : $SHOWS"
EXTRA_VOLUMES=""
if [ -n "$ANIME" ]; then mkdir -p "$ANIME"; ANIME="$(cd "$ANIME" && pwd)"; ok "Animés : $ANIME"; EXTRA_VOLUMES="${EXTRA_VOLUMES}
      - \"${ANIME}:/media/animes\""; fi
if [ -n "$CLIPS" ]; then mkdir -p "$CLIPS"; CLIPS="$(cd "$CLIPS" && pwd)"; ok "Clips  : $CLIPS"; EXTRA_VOLUMES="${EXTRA_VOLUMES}
      - \"${CLIPS}:/media/clips\""; fi

# ----- Détection du matériel
GPU_BLOCK=""
GPU_NAME="processeur (aucune carte graphique détectée)"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  if docker info 2>/dev/null | grep -qi nvidia; then
    GPU_NAME="NVIDIA ($(nvidia-smi --query-gpu=name --format=csv,noheader | head -1))"
    GPU_BLOCK=$'    runtime: nvidia\n    environment:\n      - NVIDIA_VISIBLE_DEVICES=all\n      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility\n    deploy:\n      resources:\n        reservations:\n          devices:\n            - driver: nvidia\n              count: all\n              capabilities: [gpu, video]'
  else
    warn "Carte NVIDIA trouvée mais le NVIDIA Container Toolkit manque : https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/"
  fi
fi
if [ -z "$GPU_BLOCK" ] && [ -d /dev/dri ] && ls /dev/dri/renderD* >/dev/null 2>&1; then
  VENDOR="Intel / AMD"
  if [ -r /sys/class/drm/renderD128/device/vendor ]; then
    case "$(cat /sys/class/drm/renderD128/device/vendor)" in
      0x8086) VENDOR="Intel" ;; 0x1002) VENDOR="AMD" ;;
    esac
  fi
  GPU_NAME="$VENDOR (VA-API / Quick Sync)"
  GPU_BLOCK=$'    devices:\n      - /dev/dri:/dev/dri'
fi
if [ -z "$GPU_BLOCK" ] && [ -e /dev/video11 ]; then
  GPU_NAME="Raspberry Pi (V4L2)"
  GPU_BLOCK=$'    devices:\n      - /dev/video10:/dev/video10\n      - /dev/video11:/dev/video11\n      - /dev/video12:/dev/video12'
fi
ok "Conversion vidéo : $GPU_NAME"

cat > docker-compose.override.yml <<EOF
# Généré par install.sh — relancez le script pour le régénérer
services:
  venus:
    volumes:
      - "${MOVIES}:/media/films"
      - "${SHOWS}:/media/series"${EXTRA_VOLUMES}
${GPU_BLOCK}
EOF
ok "Configuration écrite"

bold "Construction et démarrage (première fois : 2 à 5 minutes)…"
$DC up -d --build

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$IP" ] && IP="localhost"
echo
bold "C'est prêt !"
echo "  Ouvrez  http://${IP}:8096  sur votre téléphone, ordinateur ou TV."
echo "  Sur téléphone : menu du navigateur → « Ajouter à l'écran d'accueil »."
echo "  Vidéos sur un NAS ou un PC : Réglages → Bibliothèques → Ajouter un emplacement → Partage réseau."
