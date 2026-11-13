# Autres installations

[← Retour au README](../README.md) · [Docker](installation-docker.md) · [Déploiement](deploiement.md) · [Configuration](configuration.md)

Venus s'installe aussi sans Docker. Ces installations utilisent directement la carte graphique de la machine (y compris la puce Apple sur Mac).

> L'interface Next.js est construite pendant l'installation. Si ce n'est pas possible (pas d'accès à npm, installation Windows), Venus sert automatiquement son **interface classique** : toutes les fonctions restent disponibles.

---

## Sommaire

- [Linux sans Docker](#linux-sans-docker)
- [Windows](#windows)
- [macOS](#macos)
- [Proxmox (conteneur LXC)](#proxmox-conteneur-lxc)
- [Récapitulatif des emplacements](#récapitulatif-des-emplacements)

---

## Linux sans Docker

Debian, Ubuntu, conteneur LXC… :

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh | sudo bash
```

Le script installe Node.js (version officielle), un ffmpeg optimisé (toutes les accélérations matérielles), les outils SMB / NFS, construit l'interface, puis crée un service **systemd** `venus` qui démarre avec la machine.

| | |
|---|---|
| Code | `/opt/venus` |
| Réglages | `/etc/venus/venus.env` |
| Données | `/var/lib/venus` |
| Journal | `journalctl -u venus -f` |
| Redémarrer | `sudo systemctl restart venus` |
| Mettre à jour | relancer la commande d'installation (réglages conservés) |
| Désinstaller | `sudo bash /opt/venus/scripts/install-native.sh uninstall` |

---

## Windows

Windows 10 ou 11. Ouvrez **PowerShell** (menu Démarrer → tapez « PowerShell ») et collez :

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex
```

Le script télécharge Node.js et ffmpeg en versions portables (rien d'autre n'est modifié sur le PC), demande vos dossiers de vidéos, ouvre le port 8096 pour le réseau privé, et lance Venus **au démarrage du PC, même sans session ouverte**.

| | |
|---|---|
| Dossier | `C:\ProgramData\Venus` |
| Journal | `C:\ProgramData\Venus\venus.log` |
| Réglages | `C:\ProgramData\Venus\venus.conf` (relancez ensuite la commande) |
| Désinstaller | `$env:VENUS_ACTION='uninstall'; irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 \| iex` |

Accélération : NVIDIA (NVENC), Intel Quick Sync, AMD (AMF).

> La TV ou le téléphone ne trouvent pas Venus ? Vérifiez que votre connexion Wi-Fi est en profil **Privé** dans les paramètres réseau de Windows.

---

## macOS

Puce Apple ou Intel. Nécessite [Homebrew](https://brew.sh).

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh | bash
```

Le script installe Node.js et ffmpeg, construit l'interface, puis lance Venus à chaque ouverture de session. La conversion utilise la puce Apple (VideoToolbox).

| | |
|---|---|
| Données | `~/Library/Application Support/Venus` |
| Journal | `~/Library/Logs/Venus.log` |
| Désinstaller | `bash ~/Library/Application\ Support/Venus/app/scripts/install-macos.sh uninstall` |

> Vidéos sur un disque externe : Réglages Système → Confidentialité et sécurité → **Accès complet au disque** → ajoutez `node`.

---

## Proxmox (conteneur LXC)

Venus fonctionne très bien dans un conteneur LXC Debian ou Ubuntu.

**1. Dans le conteneur** : installez Venus avec la méthode [Linux sans Docker](#linux-sans-docker).

**2. Sur l'hôte Proxmox** (remplacez `7700` par le numéro de votre conteneur) :

```bash
# Carte graphique Intel / AMD → conversion vidéo accélérée
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu 7700

# Partage NAS / PC Windows → monté sur l'hôte puis transmis au conteneur
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) nas 7700
```

| Commande | Usage |
|---|---|
| `gpu <CTID>` | Transmet `/dev/dri/renderD128` au conteneur avec les bons droits |
| `nas <CTID>` | Nécessaire pour un conteneur **non privilégié** (cas par défaut), qui ne peut pas monter un partage lui-même |
| `mount <CTID>` | Conteneur **privilégié** uniquement : l'assistant « Partage réseau » de Venus fonctionne ensuite directement |

Venus détecte qu'il tourne dans un LXC et rappelle ces commandes dans **Réglages** quand c'est utile.

---

## Récapitulatif des emplacements

| Installation | Données à sauvegarder | Journal |
|---|---|---|
| Docker | `/opt/Venus/config` | `docker compose logs -f venus` |
| Linux natif | `/var/lib/venus` et `/etc/venus/venus.env` | `journalctl -u venus -f` |
| Windows | `C:\ProgramData\Venus` | `venus.log` |
| macOS | `~/Library/Application Support/Venus` | `~/Library/Logs/Venus.log` |

Étape suivante : **[Déploiement et mise en ligne](deploiement.md)**.
