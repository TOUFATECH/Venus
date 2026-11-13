# Configuration

[← Retour au README](../README.md) · [Docker](installation-docker.md) · [Déploiement](deploiement.md) · [Sécurité](../SECURITY.md)

Venus se règle presque entièrement **depuis l'interface**. Les variables d'environnement servent aux réglages de démarrage (ports, dossiers, HTTPS) et aux cas particuliers.

---

## Sommaire

1. [Où placer les réglages](#1-où-placer-les-réglages)
2. [Variables d'environnement](#2-variables-denvironnement)
3. [Fichiers Docker Compose](#3-fichiers-docker-compose)
4. [Réglages de l'interface](#4-réglages-de-linterface)
5. [Services externes](#5-services-externes)

---

## 1. Où placer les réglages

| Installation | Fichier | Appliquer |
|---|---|---|
| Docker | `docker-compose.override.yml` (section `environment:`) | `docker compose up -d` |
| Docker Desktop | `.env` (voir [`.env.example`](../.env.example)) | `docker compose -f docker-compose.desktop.yml up -d` |
| Linux natif | `/etc/venus/venus.env` | `sudo systemctl restart venus` |
| Windows | `C:\ProgramData\Venus\venus.conf` | relancer la commande d'installation |
| macOS / développement | variables du shell, ex. `PORT=9000 npm start` | redémarrer Venus |

Exemple Docker :

```yaml
services:
  venus:
    environment:
      - TZ=Indian/Mayotte
      - TMDB_API_KEY=votre_cle
      - HWACCEL=vaapi
      - FORCE_HTTPS=remote
```

---

## 2. Variables d'environnement

### Essentiel

| Variable | Par défaut | Rôle |
|---|---|---|
| `PORT` | `8096` | Port HTTP |
| `HOST` | `0.0.0.0` | Adresse d'écoute (`127.0.0.1` pour n'accepter que la machine, derrière un proxy) |
| `TZ` | `Europe/Paris` (Docker) | Fuseau horaire de départ ; se règle ensuite dans Réglages → Serveur |
| `DATA_DIR` | `/config` (Docker), `./data` | Base de données, affiches, cache, sauvegardes |
| `TRANSCODE_DIR` | `/transcode` (Docker) | Fichiers temporaires de conversion |
| `MOVIES_PATH` / `SHOWS_PATH` / `ANIME_PATH` / `CLIPS_PATH` | `/media/films`… | Dossiers proposés au premier démarrage |

### Lecture et matériel

| Variable | Par défaut | Rôle |
|---|---|---|
| `HWACCEL` | `auto` | Forcer `nvenc`, `vaapi`, `qsv`, `amf`, `videotoolbox`, `v4l2m2m` ou `none` |
| `VENUS_FAST_TRANSCODE` | — | Dossier en mémoire vive (tmpfs) pour les conversions ; posé par `update.sh` quand la machine a assez de mémoire |
| `FFMPEG_PATH` / `FFPROBE_PATH` | auto | Chemin d'un ffmpeg / ffprobe particulier |
| `VENUS_WHISPER_BIN` | auto | Chemin de `whisper-cli` (sous-titres générés) ; inclus dans l'image Docker |
| `VENUS_FPCALC_BIN` | auto | Chemin de `fpcalc` (empreintes sonores) ; inclus dans l'image Docker |
| `LIBRETRANSLATE_URL` | — | Serveur LibreTranslate pour traduire les sous-titres générés |

### Sécurité et réseau

| Variable | Par défaut | Rôle |
|---|---|---|
| `HTTPS_PORT` | `8920` | Port HTTPS intégré (`HTTPS=0` pour le couper) |
| `TLS_CERT` / `TLS_KEY` | — | Certificat et clé (sinon certificat auto-signé) |
| `FORCE_HTTPS` | `remote` | `off`, `remote` (hors réseau local) ou `all` |
| `TRUST_PROXY` | — | `1` si un proxy sur une autre machine transmet l'adresse du visiteur |
| `LAN_SUBNET` | — | Réseau à explorer pour trouver les NAS (ex. `192.168.1`) |
| `MOUNT_ROOT` | auto | Dossier où Venus monte les partages réseau |
| `VENUS_SECRET` | — | Clé de chiffrement des secrets (sinon fichier `secret.key` dans les données) |
| `VENUS_DISABLE_2FA` | — | `1` : coupe la double authentification (secours uniquement, voir [Dépannage](depannage.md)) |

### Interface et mises à jour

| Variable | Par défaut | Rôle |
|---|---|---|
| `VENUS_UI` | — | `classic` : sert l'interface classique au lieu de l'interface Next.js |
| `VENUS_WEB_DIR` | auto | Dossier de l'interface Next.js construite (`web-dist` dans l'image Docker) |
| `VENUS_NEXT_PORT` | aléatoire | Port interne (127.0.0.1) de l'interface Next.js |
| `VENUS_UPDATE_CMD` | — | Commande lancée par le bouton « Mettre à jour » (ex. un script sur l'hôte) |
| `VENUS_IPTV_WORLD` | activé | `0` : ne pas ajouter les chaînes gratuites du monde |

### Clés de services (facultatives, saisissables aussi dans l'interface)

| Variable | Service |
|---|---|
| `TMDB_API_KEY` | Fiches, affiches et distribution (TMDB) |
| `OMDB_API_KEY` | Notes IMDb / Rotten Tomatoes / Metacritic (OMDb) |
| `OPENSUBTITLES_API_KEY` | Recherche de sous-titres en ligne |
| `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` | Synchronisation Trakt |
| `SIMKL_CLIENT_ID` | Notes Simkl |
| `ACOUSTID_KEY` | Reconnaissance des morceaux par empreinte sonore |

Une valeur saisie dans l'interface a priorité sur la variable d'environnement.

---

## 3. Fichiers Docker Compose

| Fichier | Rôle | Modifié par |
|---|---|---|
| [`docker-compose.yml`](../docker-compose.yml) | Configuration de base (réseau hôte, volumes `config` et `transcode`, sécurité) | personne (suivi par Git) |
| `docker-compose.override.yml` | **Vos** dossiers de vidéos, votre carte graphique, vos variables | `install.sh`, puis vous |
| `docker-compose.hw.yml` | Carte graphique et conversions en mémoire détectées | `update.sh` (régénéré à chaque fois) |
| [`docker-compose.override.example.yml`](../docker-compose.override.example.yml) | Exemples Intel / AMD / NVIDIA / Raspberry Pi | — |
| [`docker-compose.desktop.yml`](../docker-compose.desktop.yml) | Docker Desktop (Windows / Mac), réglé par `.env` | — |

`docker-compose.override.yml`, `docker-compose.hw.yml` et `.env` ne sont pas suivis par Git : une mise à jour ne les écrase jamais.

---

## 4. Réglages de l'interface

**Pour chacun** (Réglages → Vous)

| Section | Contenu |
|---|---|
| Mon profil | Nom, avatar, code PIN, langues audio et sous-titres préférées, compte Trakt, anti-spoiler |
| Cet appareil | Qualité de lecture, sous-titres, aperçus au survol, écran de veille |
| Thème et menu | Planète, mise en page, clair / sombre automatique, fluidité, sections du menu — voir [Thèmes](themes.md) |

**Administrateur**

| Section | Contenu |
|---|---|
| Médiathèques | Dossiers, partages réseau, renommage, doublons, corbeille |
| TV en direct | Listes M3U / Xtream, guide des programmes, enregistrements |
| Infos et affiches | Clé TMDB, langue des fiches, sources d'images |
| Notes des sites | IMDb, Rotten Tomatoes, Metacritic, Trakt, Simkl |
| Demandes | Seerr, Radarr, Sonarr, Lidarr, LazyLibrarian / Bookshelf, AcoustID |
| Profils et appareils | Comptes, invitations, profils enfants, droits |
| Notifications | Serveur d'e-mails, Web Push, ntfy, Discord, Telegram |
| Lecture et conversion | Accélération matérielle, qualité maximale, sous-titres incrustés |
| Performances | Copies optimisées, compression des vidéos, conversions en mémoire |
| Mise à jour | Version installée, nouveautés, mise à jour automatique |
| Serveur | Nom, mot de passe du foyer, fuseau horaire, fréquence d'analyse |
| Accès hors de la maison | Lien rapide, tunnel Cloudflare, Tailscale |
| Importer un historique | Reprendre les vus et lectures en cours d'un autre serveur multimédia |
| Sauvegardes | Sauvegardes nocturnes, second emplacement, restauration |

---

## 5. Services externes

Tous sont **facultatifs** : Venus fonctionne sans aucun d'eux.

| Service | Usage dans Venus | Où le relier |
|---|---|---|
| **TMDB** | Fiches, affiches, distribution, sorties à venir | Réglages → Infos et affiches |
| **Radarr** / **Sonarr** | Ajout de films / séries depuis Venus, calendrier, recherche de la VF | Réglages → Demandes |
| **Seerr** | Envies et nouvelles saisons demandées automatiquement | Réglages → Demandes |
| **Lidarr** | Albums et artistes demandés depuis Venus | Réglages → Demandes |
| **LazyLibrarian** / **Bookshelf** | Livres demandés depuis Venus | Réglages → Demandes |
| **Trakt** | Historique synchronisé dans les deux sens | Réglages → Mon profil |
| **OpenSubtitles** | Recherche de sous-titres | Réglages → Lecture et conversion |
| **Telegram**, **Discord**, **ntfy** | Notifications | Réglages → Notifications |
| **Philips Hue** / **WLED** | Lumières synchronisées avec l'image | Réglages → Lecture et conversion |
| **Cloudflare** / **Tailscale** | Accès depuis l'extérieur | Réglages → Accès hors de la maison |
| **Home Assistant**, **n8n** | API (`X-Api-Key`) et webhooks | Tableau de bord → Serveur |

Pour Radarr, Sonarr et Lidarr : indiquez l'adresse (ex. `http://192.168.1.10:7878`) et la **clé API** trouvée dans leurs *Settings → General*. Les clés sont chiffrées dans la base.
