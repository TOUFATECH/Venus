#!/bin/sh
# Compagnon de mise à jour de Venus (conteneur « venus-autoupdate », installé par update.sh).
#  - Bouton « Mettre à jour » de Venus : Venus dépose config/update-request ; le compagnon récupère la dernière
#    version (git pull) puis reconstruit Venus (bash update.sh --from-app). L'état et le journal sont écrits dans
#    config/update-status.json et config/update-log.txt, que Venus affiche.
#  - Mise à jour automatique la nuit (si config/autoupdate-night existe) : vers 4 h, s'il y a du nouveau.
#  - Signe de vie : config/updater-alive (Venus sait ainsi que le bouton peut tout faire tout seul).
apk add --no-cache git bash >/dev/null 2>&1
git config --global --add safe.directory "$VENUS_DIR"
cd "$VENUS_DIR" || exit 1
DATA="$VENUS_DIR/config"
mkdir -p "$DATA"
status() { printf '{"state":"%s","at":%s000}\n' "$1" "$(date +%s)" > "$DATA/update-status.json"; }
echo "[mise à jour] compagnon prêt"
while true; do
  date +%s > "$DATA/updater-alive"
  GO=0
  if [ -f "$DATA/update-request" ]; then GO=1; rm -f "$DATA/update-request"; fi
  if [ -f "$DATA/autoupdate-night" ] && [ "$(date +%H)" = "04" ] && [ "$(cat "$DATA/.night-done" 2>/dev/null)" != "$(date +%F)" ]; then
    date +%F > "$DATA/.night-done"
    git fetch -q origin main && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && GO=1
  fi
  if [ "$GO" = 1 ]; then
    status running
    echo "[mise à jour] $(date '+%F %T') : récupération de la dernière version…" > "$DATA/update-log.txt"
    if git pull --ff-only >> "$DATA/update-log.txt" 2>&1 && bash update.sh --from-app >> "$DATA/update-log.txt" 2>&1; then
      status done
    else
      status error
    fi
  fi
  sleep 10
done
