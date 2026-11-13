# Installation avec Docker

[← Retour au README](../README.md) · [Autres installations](installation.md) · [Déploiement](deploiement.md) · [Configuration](configuration.md)

Docker est la méthode recommandée sur Linux (NAS, mini-PC, serveur, VPS) : Venus et toutes ses dépendances (ffmpeg optimisé, whisper.cpp, outils SMB / NFS) sont réunis dans une seule image.

---

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation automatique (recommandée)](#2-installation-automatique-recommandée)
3. [Installation manuelle avec docker compose](#3-installation-manuelle-avec-docker-compose)
4. [Carte graphique (accélération matérielle)](#4-carte-graphique-accélération-matérielle)
5. [Docker Desktop (Windows ou Mac)](#5-docker-desktop-windows-ou-mac)
6. [Dossiers et volumes](#6-dossiers-et-volumes)
7. [Commandes utiles](#7-commandes-utiles)
8. [Mise à jour](#8-mise-à-jour)
9. [Désinstallation](#9-désinstallation)

---

## 1. Prérequis

| Élément | Vérification |
|---|---|
| Docker Engine avec Compose v2 | `docker compose version` |
| Git | `git --version` |
| Port 8096 libre | `ss -ltn \| grep 8096` ne doit rien afficher |
| Vos vidéos accessibles depuis la machine | disque local, disque USB ou partage NAS |

Docker n'est pas installé ? Le script d'installation propose de l'installer pour vous. À la main :

```bash
curl -fsSL https://get.docker.com | sh
```

---

## 2. Installation automatique (recommandée)

```bash
sudo git clone https://github.com/TOUFATECH/Venus.git /opt/Venus
cd /opt/Venus
sudo ./install.sh
```

Le script :

1. demande le dossier de vos **films** et celui de vos **séries** (laissez vide si tout est sur un NAS : vous l'ajouterez depuis l'interface) ;
2. détecte la **carte graphique** (Intel, AMD, NVIDIA, Raspberry Pi) et la **mémoire** disponible ;
3. écrit `docker-compose.override.yml` avec vos dossiers et votre matériel ;
4. construit l'image et démarre le conteneur.

Ouvrez ensuite `http://ADRESSE-DE-LA-MACHINE:8096` : l'assistant de premier démarrage vous demande un prénom et le mot de passe du foyer.

**Options du script**

| Commande | Effet |
|---|---|
| `./install.sh` | Choisit la meilleure méthode pour la machine |
| `./install.sh --docker` | Force l'installation Docker |
| `./install.sh --native` | Force l'installation sans Docker (voir [Linux sans Docker](installation.md#linux-sans-docker)) |
| `./install.sh --docker /chemin/Films /chemin/Series` | Installation Docker sans questions |

---

## 3. Installation manuelle avec docker compose

```bash
sudo git clone https://github.com/TOUFATECH/Venus.git /opt/Venus
cd /opt/Venus
```

Créez `docker-compose.override.yml` avec vos dossiers de vidéos :

```yaml
services:
  venus:
    volumes:
      - /chemin/vers/Films:/media/films
      - /chemin/vers/Series:/media/series
      # - /chemin/vers/Animes:/media/animes
      # - /chemin/vers/Clips:/media/clips
```

Puis construisez et démarrez :

```bash
docker compose up -d --build
```

Le fichier [`docker-compose.yml`](../docker-compose.yml) fourni utilise :

| Réglage | Pourquoi |
|---|---|
| `network_mode: host` | Venus voit les appareils de la maison (NAS, Chromecast) ; il répond sur le port 8096 de la machine |
| `cap_add: SYS_ADMIN, DAC_READ_SEARCH` | Permet de monter les partages réseau depuis l'interface (Réglages → Bibliothèques → Partage réseau) |
| `no-new-privileges:true` | Aucun programme du conteneur ne peut obtenir plus de droits |
| `restart: unless-stopped` | Venus redémarre avec la machine |

> Vous ne montez pas de partage réseau depuis l'interface ? Vous pouvez retirer `cap_add` et `apparmor:unconfined`.

---

## 4. Carte graphique (accélération matérielle)

La conversion matérielle est 5 à 10 fois plus rapide qu'au processeur. `install.sh` et `update.sh` la configurent tout seuls ; à la main, ajoutez le bloc correspondant dans `docker-compose.override.yml` (exemples complets dans [`docker-compose.override.example.yml`](../docker-compose.override.example.yml)).

**Intel (Quick Sync) ou AMD** — la plupart des NAS et mini-PC :

```yaml
services:
  venus:
    devices:
      - /dev/dri:/dev/dri
```

**NVIDIA** — nécessite le [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) sur la machine :

```yaml
services:
  venus:
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu, video]
```

**Raspberry Pi 4** :

```yaml
services:
  venus:
    devices:
      - /dev/video10:/dev/video10
      - /dev/video11:/dev/video11
      - /dev/video12:/dev/video12
```

Vérifiez ensuite dans **Tableau de bord → Performances** : la carte graphique détectée y est affichée. Pour forcer un mode : variable `HWACCEL` (`nvenc`, `vaapi`, `qsv`, `v4l2m2m`, `none`), voir [Configuration](configuration.md).

---

## 5. Docker Desktop (Windows ou Mac)

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
cp .env.example .env
```

Indiquez vos dossiers dans `.env` (Windows : barres `/`, par exemple `C:/Users/Moi/Videos/Films`) :

```ini
VENUS_MOVIES=C:/Users/Moi/Videos/Films
VENUS_SHOWS=C:/Users/Moi/Videos/Series
VENUS_PORT=8096
LAN_SUBNET=192.168.1
TZ=Europe/Paris
```

Puis :

```bash
docker compose -f docker-compose.desktop.yml up -d --build
```

Ouvrez `http://localhost:8096`.

> Docker Desktop fait tourner Venus dans une machine virtuelle : la carte graphique n'est pas accessible (conversion au processeur) et les NAS ne sont trouvés automatiquement que si `LAN_SUBNET` est renseigné. Pour profiter de la carte graphique, préférez l'[installation Windows](installation.md#windows) ou [macOS](installation.md#macos) sans Docker.

---

## 6. Dossiers et volumes

| Dans le conteneur | Sur la machine | Contenu | À sauvegarder |
|---|---|---|---|
| `/config` | `./config` | Base de données, réglages, affiches, clé de chiffrement `secret.key`, sauvegardes | **Oui** |
| `/transcode` | `./transcode` | Fichiers temporaires de conversion | Non |
| `/media/films`, `/media/series`, `/media/animes`, `/media/clips` | vos dossiers | Vos vidéos (lecture seule possible avec `:ro`) | Selon vous |

Les dossiers montés apparaissent dans l'assistant de premier démarrage ; d'autres emplacements s'ajoutent ensuite dans **Réglages → Médiathèques**.

---

## 7. Commandes utiles

```bash
docker compose ps                    # état du conteneur
docker compose logs -f venus         # journal en direct
docker compose restart venus         # redémarrer
docker compose down                  # arrêter
docker compose up -d --build         # reconstruire et démarrer
docker exec -it venus sh             # ouvrir un terminal dans le conteneur
```

---

## 8. Mise à jour

**Depuis l'application** : Réglages → **Mise à jour** → « Mettre à jour maintenant ». Venus peut aussi se mettre à jour seul la nuit.

**En ligne de commande** :

```bash
cd /opt/Venus && sudo bash update.sh
```

`update.sh` récupère la dernière version, régénère le réglage matériel (`docker-compose.hw.yml`, votre `docker-compose.override.yml` n'est jamais modifié), reconstruit l'image et redémarre Venus. Vos données dans `./config` sont conservées.

---

## 9. Désinstallation

```bash
cd /opt/Venus
docker compose down
docker image rm venus:latest
# Facultatif, supprime aussi vos réglages et votre base :
sudo rm -rf /opt/Venus
```

Vos vidéos ne sont jamais supprimées par la désinstallation.
