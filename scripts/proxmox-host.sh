#!/usr/bin/env bash
# Venus — outil à lancer SUR L'HÔTE PROXMOX (pas dans le conteneur).
#
#   gpu  <CTID>   Transmet la puce graphique (Intel / AMD) au conteneur : conversion vidéo accélérée
#   nas  <CTID>   Monte un partage NAS / PC Windows sur l'hôte et le transmet au conteneur
#   mount <CTID>  Conteneur privilégié uniquement : autorise Venus à monter lui-même les partages
#
# Sans rien installer :
#   bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu 7700
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { local v; read -rp "  $1" v < /dev/tty || true; printf '%s' "${v:-${2:-}}"; }
asks() { local v; read -rsp "  $1" v < /dev/tty || true; echo >&2; printf '%s' "$v"; }
confirm() { local a; a="$(ask "$1 [O/n] " o)"; [[ "$a" =~ ^[OoYy]$ ]]; }

usage() {
  cat <<'TXT'
Venus — outil à lancer SUR L'HÔTE PROXMOX (pas dans le conteneur).

  gpu   <CTID>   Transmet la puce graphique (Intel / AMD) au conteneur : conversion vidéo accélérée
  nas   <CTID>   Monte un partage NAS / PC Windows sur l'hôte et le transmet au conteneur
  mount <CTID>   Conteneur privilégié uniquement : autorise Venus à monter lui-même les partages

Exemple :  bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu 7700
TXT
  exit 1
}

CMD="${1:-}"; CTID="${2:-}"
[ -n "$CMD" ] && [ -n "$CTID" ] || usage
command -v pct >/dev/null 2>&1 || die "Ce script se lance sur l'hôte Proxmox (commande pct introuvable)."
[ "$(id -u)" = 0 ] || die "Lancez-le en root sur l'hôte Proxmox."
CONF="/etc/pve/lxc/${CTID}.conf"
[ -f "$CONF" ] || die "Conteneur ${CTID} introuvable (${CONF} n'existe pas)."
UNPRIV=0; grep -qE '^unprivileged:\s*1' "$CONF" && UNPRIV=1
NAME="$(awk -F': ' '/^hostname:/{print $2}' "$CONF")"
bold "Venus : conteneur ${CTID} (${NAME:-sans nom}, $([ $UNPRIV = 1 ] && echo 'non privilégié' || echo 'privilégié'))"

running() { pct status "$CTID" 2>/dev/null | grep -q running; }
restart_ct() {
  if confirm "Redémarrer le conteneur ${CTID} maintenant pour appliquer ?"; then
    if running; then pct reboot "$CTID"; else pct start "$CTID"; fi
    ok "Conteneur redémarré"
  else
    warn "Pensez à redémarrer le conteneur : pct reboot ${CTID}"
  fi
}
free_index() { # premier index libre pour devN / mpN
  local prefix="$1" i=0
  while grep -qE "^${prefix}${i}:" "$CONF"; do i=$((i + 1)); done
  echo "$i"
}
pve_ge_81() {
  local v; v="$(pveversion 2>/dev/null | sed -n 's#^pve-manager/\([0-9]*\)\.\([0-9]*\).*#\1 \2#p')"
  [ -n "$v" ] || return 1
  set -- $v; [ "$1" -gt 8 ] || { [ "$1" -eq 8 ] && [ "$2" -ge 1 ]; }
}

# ------------------------------------------------------------------ carte graphique
cmd_gpu() {
  local nodes=() n
  for n in /dev/dri/renderD*; do [ -e "$n" ] && nodes+=("$n"); done
  if [ ${#nodes[@]} -eq 0 ]; then
    if [ -e /dev/nvidia0 ]; then die "Carte NVIDIA détectée : son partage avec un LXC demande d'installer le même pilote dans le conteneur. Suivez le guide « NVIDIA » du README."; fi
    die "Aucune puce graphique (/dev/dri) sur cet hôte. Vérifiez qu'un processeur Intel avec graphique intégré ou une carte AMD est présent et que le pilote i915/amdgpu est chargé."
  fi
  for n in "${nodes[@]}"; do
    local vendor; vendor="$(cat "/sys/class/drm/$(basename "$n")/device/vendor" 2>/dev/null || true)"
    case "$vendor" in 0x8086) vendor="Intel";; 0x1002) vendor="AMD";; 0x10de) vendor="NVIDIA";; *) vendor="inconnue";; esac
    ok "Puce graphique trouvée : ${n} (${vendor})"
  done
  if grep -qE "^(dev[0-9]+:.*renderD|lxc\.mount\.entry:.*dev/dri)" "$CONF"; then
    ok "La puce graphique est déjà transmise à ce conteneur."; restart_ct; return
  fi
  # Groupe « render » DANS le conteneur, pour que Venus ait le droit d'utiliser la puce
  local gid=""
  if running; then gid="$(pct exec "$CTID" -- getent group render 2>/dev/null | cut -d: -f3 || true)"; fi
  [ -n "$gid" ] || gid="$(pct exec "$CTID" -- getent group video 2>/dev/null | cut -d: -f3 || true)"
  [ -n "$gid" ] || gid=104
  confirm "Transmettre ${nodes[*]} au conteneur ${CTID} (groupe ${gid}) ?" || exit 0
  if pve_ge_81; then
    for n in "${nodes[@]}"; do
      local i; i="$(free_index dev)"
      pct set "$CTID" "-dev${i}" "${n},gid=${gid},mode=0666"
      ok "dev${i}: ${n}"
    done
  else
    cp "$CONF" "${CONF}.avant-venus"
    {
      echo "lxc.cgroup2.devices.allow: c 226:* rwm"
      echo "lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir"
    } >> "$CONF"
    ok "Configuration ajoutée (sauvegarde : ${CONF}.avant-venus)"
    [ $UNPRIV = 1 ] && warn "Conteneur non privilégié sur un Proxmox ancien : si Venus ne voit pas la puce, mettez Proxmox à jour (8.1 ou plus)."
  fi
  restart_ct
  ok "Dans Venus : Réglages → Lecture et conversion → Enregistrer (nouveau test du matériel), ou redémarrez Venus."
}

# ------------------------------------------------------------------ partage réseau monté sur l'hôte
cmd_nas() {
  bold "Partage réseau à transmettre au conteneur ${CTID}"
  local proto host share user pass label target opts cred idx dest line auth
  proto="$(ask 'Type de partage, smb (Windows, la plupart des NAS) ou nfs [smb] : ' smb)"
  host="$(ask 'Adresse du NAS ou du PC (ex. 192.168.1.20) : ')"
  [ -n "$host" ] || die "Adresse obligatoire."
  if [ "$proto" = nfs ]; then
    share="$(ask 'Chemin exporté (ex. /volume1/video) : ')"
  else
    share="$(ask 'Nom du partage (ex. Videos) : ')"
    user="$(ask 'Identifiant (vide pour invité) : ')"
    [ -n "$user" ] && pass="$(asks 'Mot de passe : ')"
  fi
  [ -n "$share" ] || die "Partage obligatoire."
  label="$(ask "Nom du dossier dans Venus [$(basename "$share" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')] : " "$(basename "$share" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')")"
  target="/mnt/venus-nas/${label}"
  dest="/media/${label}"
  mkdir -p "$target"

  # Root du conteneur non privilégié = UID 100000 sur l'hôte : les fichiers lui appartiennent
  local uid=0 gid=0; [ $UNPRIV = 1 ] && { uid=100000; gid=100000; }
  if [ "$proto" = nfs ]; then
    command -v mount.nfs >/dev/null || apt-get install -y nfs-common >/dev/null
    opts="ro,soft,timeo=150,_netdev,nofail,x-systemd.automount"
    line="${host}:${share} ${target} nfs ${opts} 0 0"
  else
    command -v mount.cifs >/dev/null || apt-get install -y cifs-utils >/dev/null
    cred="/root/.venus-${label}.cred"
    if [ -n "${user:-}" ]; then
      umask 077; printf 'username=%s\npassword=%s\n' "$user" "${pass:-}" > "$cred"; auth="credentials=${cred}"
    else auth="guest"; fi
    opts="${auth},uid=${uid},gid=${gid},iocharset=utf8,file_mode=0664,dir_mode=0775,noperm,_netdev,nofail,x-systemd.automount"
    line="//${host}/${share// /\\040} ${target} cifs ${opts} 0 0"
  fi
  confirm "Monter ${host}:${share} dans ${target} (au démarrage aussi) et le transmettre au conteneur dans ${dest} ?" || exit 0
  if ! grep -qF " ${target} " /etc/fstab; then
    cp /etc/fstab /etc/fstab.avant-venus
    echo "$line" >> /etc/fstab
    ok "Ajouté à /etc/fstab (sauvegarde : /etc/fstab.avant-venus)"
  fi
  systemctl daemon-reload 2>/dev/null || true
  mount "$target" 2>/dev/null || mount -a
  ls "$target" >/dev/null 2>&1 || die "Le montage a échoué : vérifiez l'adresse, le nom du partage et le mot de passe (détails : dmesg | tail). Pour réessayer, retirez la ligne ${target} de /etc/fstab."
  ok "Partage monté : $(ls "$target" | head -5 | tr '\n' ' ')…"
  if grep -qE "^mp[0-9]+: ${target}," "$CONF"; then ok "Déjà transmis au conteneur."; else
    idx="$(free_index mp)"
    pct set "$CTID" "-mp${idx}" "${target},mp=${dest},backup=0"
    ok "mp${idx}: ${target} → ${dest} dans le conteneur"
  fi
  restart_ct
  bold "Dans Venus : Réglages → Bibliothèques → Ajouter un emplacement → Dossier de ce serveur → ${dest}"
}

# ------------------------------------------------------------------ conteneur privilégié : montage par Venus
cmd_mount() {
  [ $UNPRIV = 0 ] || die "Conteneur non privilégié : Proxmox ne l'autorise pas à monter des partages. Utilisez plutôt la commande « nas » : proxmox-host.sh nas ${CTID}"
  confirm "Autoriser le conteneur ${CTID} à monter des partages SMB et NFS ?" || exit 0
  local feats; feats="$(awk -F': ' '/^features:/{print $2}' "$CONF")"
  if [ -n "$feats" ]; then
    case "$feats" in *mount=*) feats="$(echo "$feats" | sed 's/mount=[^,]*/mount=cifs;nfs/')";; *) feats="${feats},mount=cifs;nfs";; esac
  else feats="mount=cifs;nfs"; fi
  pct set "$CTID" --features "$feats"
  ok "features: ${feats}"
  restart_ct
  ok "Dans Venus : Réglages → Bibliothèques → Ajouter un emplacement → Partage réseau."
}

case "$CMD" in
  gpu) cmd_gpu ;;
  nas) cmd_nas ;;
  mount) cmd_mount ;;
  *) usage ;;
esac
