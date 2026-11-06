#!/usr/bin/env bash
# Mise à jour de Venus, en une commande :   cd /opt/Venus && bash update.sh
#  1. récupère la dernière version ;
#  2. active tout seul ce que la machine permet :
#       - la carte graphique (NVIDIA, Intel, AMD, Raspberry Pi) pour des conversions 5 à 10 fois plus rapides ;
#       - les conversions en mémoire vive si la machine a au moins 6 Go de mémoire (plus rapides, n'usent pas le disque) ;
#     (fichier docker-compose.hw.yml, régénéré à chaque fois ; votre docker-compose.override.yml n'est pas touché)
#  3. reconstruit et redémarre Venus.
set -e
cd "$(dirname "$0")"
say() { printf '\033[1;35m▸\033[0m %s\n' "$1"; }

if [ -d .git ]; then say "Récupération de la dernière version…"; git pull --ff-only || say "git pull impossible (modifications locales ?) : on continue avec la version présente"; fi

DC="docker compose"; $DC version >/dev/null 2>&1 || DC="docker-compose"
OVR=docker-compose.override.yml
HW=docker-compose.hw.yml

GPU_LINES=""; GPU_ENV=""; GPU_NAME="aucune (le processeur fera les conversions)"
if [ -f "$OVR" ] && grep -Eq '/dev/dri|runtime: *nvidia|/dev/video1' "$OVR"; then
  GPU_NAME="déjà réglée dans $OVR"
elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 && docker info 2>/dev/null | grep -qi nvidia; then
  GPU_NAME="NVIDIA ($(nvidia-smi --query-gpu=name --format=csv,noheader | head -1))"
  GPU_LINES=$'    runtime: nvidia\n    deploy:\n      resources:\n        reservations:\n          devices:\n            - driver: nvidia\n              count: all\n              capabilities: [gpu, video]'
  GPU_ENV=$'      - NVIDIA_VISIBLE_DEVICES=all\n      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility'
elif ls /dev/dri/renderD* >/dev/null 2>&1; then
  V="Intel / AMD"
  case "$(cat /sys/class/drm/renderD128/device/vendor 2>/dev/null)" in 0x8086) V="Intel";; 0x1002) V="AMD";; esac
  GPU_NAME="$V (VA-API / Quick Sync)"
  GPU_LINES=$'    devices:\n      - /dev/dri:/dev/dri'
elif [ -e /dev/video11 ]; then
  GPU_NAME="Raspberry Pi (V4L2)"
  GPU_LINES=$'    devices:\n      - /dev/video10:/dev/video10\n      - /dev/video11:/dev/video11\n      - /dev/video12:/dev/video12'
elif command -v nvidia-smi >/dev/null 2>&1; then
  say "Carte NVIDIA trouvée mais le « NVIDIA Container Toolkit » manque : https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/"
fi

MEM_MB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
RAM_LINES=""; RAM_ENV=""; RAM_NAME="sur le disque (moins de 6 Go de mémoire)"
if [ "$MEM_MB" -ge 6000 ]; then
  SIZE=$(( MEM_MB / 4 )); [ "$SIZE" -gt 4096 ] && SIZE=4096
  RAM_NAME="en mémoire vive (${SIZE} Mo réservés au plus)"
  RAM_LINES=$'    volumes:\n      - type: tmpfs\n        target: /transcode-ram\n        tmpfs:\n          size: '"$(( SIZE * 1024 * 1024 ))"
  RAM_ENV="      - VENUS_FAST_TRANSCODE=/transcode-ram"
fi

{
  echo "# Généré par update.sh selon le matériel de la machine (relancez « bash update.sh » pour le refaire)"
  echo "services:"
  echo "  venus:"
  echo "    labels:"
  echo "      - venus.materiel=auto"
  [ -n "$GPU_LINES" ] && echo "$GPU_LINES"
  [ -n "$RAM_LINES" ] && echo "$RAM_LINES"
  if [ -n "$GPU_ENV$RAM_ENV" ]; then
    echo "    environment:"
    [ -n "$GPU_ENV" ] && echo "$GPU_ENV"
    [ -n "$RAM_ENV" ] && echo "$RAM_ENV"
  fi
  true
} > "$HW"

# Fichiers utilisés par docker compose (dans .env, que docker compose lit tout seul)
FILES="docker-compose.yml"; [ -f "$OVR" ] && FILES="$FILES:$OVR"; FILES="$FILES:$HW"
touch .env; grep -v '^COMPOSE_FILE=' .env > .env.tmp || true; echo "COMPOSE_FILE=$FILES" >> .env.tmp; mv .env.tmp .env

say "Carte graphique : $GPU_NAME"
say "Conversions : $RAM_NAME"
say "Construction et redémarrage (quelques minutes)…"
$DC up -d --build
say "C'est à jour. Réglages → Performances montre ce qui est activé."
