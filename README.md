<div align="center">

<img src="public/icons/icon.svg" alt="Logo de Venus" width="128" height="128">

# Venus

### Votre cinéma personnel, chez vous.

Serveur multimédia **auto-hébergé**, léger et entièrement en français : films, séries, animés, TV en direct, musique, livres et photos, dans une interface de salle de cinéma qui se pilote au doigt, à la souris, au clavier ou à la télécommande.

[![Tests](https://github.com/TOUFATECH/Venus/actions/workflows/tests.yml/badge.svg)](https://github.com/TOUFATECH/Venus/actions/workflows/tests.yml)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.13-3c873a?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-pr%C3%AAt-2496ed?logo=docker&logoColor=white)
![Licence MIT](https://img.shields.io/badge/licence-MIT-f4cf9c)

**[Démarrage rapide](#démarrage-rapide)** · **[Docker](docs/installation-docker.md)** · **[Autres installations](docs/installation.md)** · **[Déploiement](docs/deploiement.md)** · **[Utilisation](docs/utilisation.md)** · **[Thèmes](docs/themes.md)** · **[Configuration](docs/configuration.md)** · **[Dépannage](docs/depannage.md)**

</div>

---

## Sommaire

1. [Pourquoi Venus](#pourquoi-venus)
2. [Démarrage rapide](#démarrage-rapide)
3. [Configuration requise](#configuration-requise)
4. [Documentation complète](#documentation-complète)
5. [Fonctionnalités](#fonctionnalités)
6. [Architecture](#architecture)
7. [Sécurité](#sécurité)
8. [Développement](#développement)
9. [Licence](#licence)

---

## Pourquoi Venus

| | |
|---|---|
| **Léger** | Serveur Node.js **sans aucune dépendance npm** (base SQLite intégrée à Node) + ffmpeg. Démarre en quelques secondes, ~200 Mo de mémoire. |
| **Simple** | Une commande pour installer, un assistant pour le reste : prénom, mot de passe du foyer, dossiers de vidéos. |
| **Partout** | Linux, Windows, macOS, Docker, Proxmox. Navigateur, téléphone (application installable), TV, Chromecast, AirPlay. |
| **Lecture intelligente** | Lecture directe quand l'appareil sait lire le fichier, « remux » sinon, conversion matérielle (NVIDIA, Intel, AMD, Apple, Raspberry Pi) en dernier recours. |
| **Toute la maison** | Profils avec code PIN, comptes et invitations par e-mail, profils enfants (âge, temps d'écran), séances à plusieurs. |
| **Personnalisable** | 17 thèmes « planètes » et 7 mises en page, mode jour / nuit automatique. |
| **Sécurisé** | CSP stricte, double authentification, chiffrement des secrets, blocage automatique des intrusions. |

---

## Démarrage rapide

> **Prérequis** : une machine Linux avec [Docker](https://docs.docker.com/engine/install/) et Git.

```bash
sudo git clone https://github.com/TOUFATECH/Venus.git /opt/Venus
cd /opt/Venus
sudo ./install.sh
```

Ouvrez ensuite **`http://ADRESSE-DE-LA-MACHINE:8096`** et laissez-vous guider.

Le script demande vos dossiers de films et de séries, détecte la carte graphique et la mémoire, construit l'image puis démarre Venus. Tous les détails, l'installation manuelle avec `docker compose` et les options GPU : **[Installation avec Docker](docs/installation-docker.md)**.

### Autres systèmes

| Système | Commande | Guide |
|---|---|---|
| **Linux sans Docker** (Debian, Ubuntu, LXC) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh \| sudo bash` | [Linux natif](docs/installation.md#linux-sans-docker) |
| **Windows 10 / 11** (PowerShell) | `irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 \| iex` | [Windows](docs/installation.md#windows) |
| **macOS** (puce Apple ou Intel) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh \| bash` | [macOS](docs/installation.md#macos) |
| **Docker Desktop** (Windows / Mac) | `docker compose -f docker-compose.desktop.yml up -d --build` | [Docker Desktop](docs/installation-docker.md#docker-desktop-windows-ou-mac) |
| **Proxmox** (conteneur LXC) | installation Linux + `scripts/proxmox-host.sh` sur l'hôte | [Proxmox](docs/installation.md#proxmox-conteneur-lxc) |

---

## Configuration requise

Valeurs indicatives :

| | Minimum | Recommandé |
|---|---|---|
| Processeur | 2 cœurs (x86_64 ou ARM64) | 4 cœurs ou plus |
| Mémoire | 1 Go | 4 Go (6 Go et plus : conversions en mémoire vive) |
| Disque (données Venus) | 2 Go | 10 Go (affiches, vignettes, copies optimisées) |
| Carte graphique | — | Intel Quick Sync, AMD, NVIDIA ou puce Apple pour la conversion |
| Logiciels | Docker **ou** Node.js 22.13+ et ffmpeg | Docker avec Compose v2 |
| Réseau | Port **8096** (HTTP) | Port **8920** (HTTPS) ou un proxy inverse |

---

## Documentation complète

| Guide | Contenu |
|---|---|
| 🐳 **[Installation avec Docker](docs/installation-docker.md)** | Script automatique, `docker compose` à la main, carte graphique (Intel / AMD / NVIDIA / Raspberry Pi), Docker Desktop, volumes |
| 💻 **[Autres installations](docs/installation.md)** | Linux natif (systemd), Windows, macOS, Proxmox LXC, désinstallation |
| 🚀 **[Déploiement et mise en ligne](docs/deploiement.md)** | VPS / NAS / mini-PC, HTTPS, Caddy, Nginx, tunnel Cloudflare, Tailscale, sauvegardes, mises à jour |
| 🎬 **[Guide d'utilisation](docs/utilisation.md)** | Premier démarrage, bibliothèques, NAS, profils, lecture, TV en direct, musique, livres, demandes, notifications |
| 🎨 **[Thèmes et mises en page](docs/themes.md)** | Les 17 planètes, les 7 dispositions, jour / nuit, personnalisation du menu |
| ⚙️ **[Configuration](docs/configuration.md)** | Variables d'environnement, fichiers Compose, réglages de l'interface, services externes |
| 🛠️ **[Dépannage](docs/depannage.md)** | Problèmes fréquents et solutions, journaux, réinitialisation |
| 🔒 **[Sécurité](SECURITY.md)** | Protections en place, réglages conseillés, procédure en cas d'incident |
| 🧑‍💻 **[Développement](docs/developpement.md)** | Architecture du code, lancer en local, tests, contribution |

---

## Fonctionnalités

<details open>
<summary><b>Regarder</b></summary>

- **Lecture intelligente** : directe (0 % de processeur), « remux » ou conversion matérielle ; la conversion se met en pause quand elle a assez d'avance et reprend toute seule après une coupure.
- **Copies optimisées** préparées la nuit (H.264 + AAC) pour les appareils qui devraient sinon convertir.
- **Séries** : saisons, « Reprendre », épisode suivant avec compte à rebours, « Toujours là ? », minuterie de sommeil, résumé automatique « Précédemment dans… ».
- **Sous-titres** SRT / ASS / VTT / PGS, recherche en ligne, sous-titres générés hors ligne (whisper.cpp) puis traduits en français.
- **Mini-lecteur**, image dans l'image, mode nuit (son égalisé), halo lumineux autour de l'image, partage d'un extrait (GIF / MP4).
- **TV en direct** (M3U / Xtream) avec guide des programmes, enregistrements, multi-écran, favoris et rappels.
- **Musique** (paroles synchronisées, reconnaissance des albums), **livres** (EPUB, PDF, BD, livres audio) et **photos** (diaporama, HEIC).
</details>

<details>
<summary><b>Trouver</b></summary>

- Bibliothèques **Films, Séries, Animés, Clips** avec tris et filtres (genres, années, note, qualité, studios).
- **Recherche en langage naturel** (« un film drôle de moins d'1 h 30 des années 90 »), recherche dans les dialogues, **Ctrl+K** partout, commande vocale, manette.
- **À venir** : sorties jour par jour, disponibles ou non sur le NAS, ajout en un clic aux gestionnaires de téléchargement.
- **VF** : badge et filtre des titres disponibles en version française.
- Fiches complètes : distribution avec photos, notes des sites, bandes-annonces.
</details>

<details>
<summary><b>Toute la maison</b></summary>

- Comptes locaux et **invitations par e-mail**, profils avec code PIN, **profils enfants** (âge, horaires, temps d'écran).
- **Séance à plusieurs**, **vote en famille**, **téléphone-télécommande** par QR code, « Qui regarde ce soir ? ».
- Synchronisation **Trakt**, rétrospective de l'année, notifications (Web Push, ntfy, Discord, Telegram).
</details>

<details>
<summary><b>Administrer</b></summary>

- **Tableau de bord** : lectures en cours, appareils, tâches planifiées, journal, santé du NAS, performances.
- Partages réseau **SMB / NFS** trouvés et montés depuis l'interface.
- Gestionnaires de demandes et de téléchargements (Seerr, Radarr, Sonarr, Lidarr, LazyLibrarian / Bookshelf).
- Doublons, renommage, corbeille 7 jours, compression des vidéos, sauvegardes nocturnes restaurables.
- **API** (`X-Api-Key`) et **webhooks** (Home Assistant, n8n…).
</details>

---

## Architecture

```
Navigateur ──► Venus (port 8096)
                ├─ /api, /img, /cal ............ API Node.js (aucune dépendance)
                ├─ /_next/static ............... interface compressée (brotli, cache 1 an)
                └─ pages ───► Next.js 16 (processus séparé, 127.0.0.1, port interne)
                              nonce CSP neuf à chaque page
```

| Dossier | Rôle |
|---|---|
| [`server/`](server) | API, lecture, analyse des bibliothèques, sécurité, tâches de fond (Node.js ≥ 22, sans dépendance) |
| [`web/`](web) | Interface Next.js 16 (App Router, React 19) : une route par page |
| [`public/`](public) | Code partagé de l'interface, styles, icônes, interface de secours |
| [`scripts/`](scripts) | Installateurs Linux / Windows / macOS / Proxmox, test de charge, contrôle de sécurité |
| [`tests/`](tests) | Tests de bout en bout dans un vrai navigateur (Playwright) |

Détails fichier par fichier : **[Développement](docs/developpement.md)**.

---

## Sécurité

| Contrôle | Résultat |
|---|---|
| Contrôle de sécurité (`npm run security`) | **34 / 34** protections vérifiées |
| Test de charge : 50 utilisateurs, 90 s, lectures vidéo et chaînes | 0 erreur, p95 ≤ 21 ms |
| 213 routes de l'API testées avec des entrées invalides | aucune erreur 500 |

CSP stricte avec nonce, protection CSRF, limitation des requêtes, blocage automatique des adresses suspectes, mots de passe en scrypt, secrets chiffrés en AES-256-GCM, double authentification par e-mail. Tout est détaillé dans **[SECURITY.md](SECURITY.md)**.

---

## Développement

```bash
npm start              # serveur Venus sur http://localhost:8096
npm run web:dev        # interface en direct sur http://localhost:3100
npm run web:build      # construction de production de l'interface
npm test               # tests Playwright (ordinateur, téléphone, télévision)
npm run security       # contrôle de sécurité
```

Guide complet : **[docs/developpement.md](docs/developpement.md)**.

---

## Licence

Distribué sous licence [MIT](LICENSE) © 2026 **TOUFATECH**.
Les polices (Archivo, Inter, Outfit) et le lecteur hls.js sont distribués sous leurs propres licences, jointes à côté de leurs fichiers dans `public/`.
