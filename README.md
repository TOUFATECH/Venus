<div align="center">

# Venus

**Votre cinéma personnel, chez vous.**
Un serveur multimédia léger et auto-hébergé, avec une interface de salle de cinéma qui se pilote au doigt, à la souris ou à la télécommande.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.13-3c873a?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
[![Tests](https://github.com/TOUFATECH/Venus/actions/workflows/tests.yml/badge.svg)](https://github.com/TOUFATECH/Venus/actions/workflows/tests.yml)
![Docker](https://img.shields.io/badge/Docker-pr%C3%AAt-2496ed?logo=docker&logoColor=white)
![Licence MIT](https://img.shields.io/badge/licence-MIT-f4cf9c)

[Installation](#installation) · [Mise à jour](#mise-à-jour) · [Fonctionnalités](#fonctionnalités) · [Interface Next.js](#interface-nextjs) · [Architecture](#architecture) · [Fiabilité et sécurité](#fiabilité-et-sécurité)

</div>

---

## En bref

| | |
|---|---|
| **Léger** | Serveur Node.js **sans aucune dépendance** (base `node:sqlite` intégrée) + ffmpeg. Démarre en quelques secondes. |
| **Interface moderne** | **Next.js 16**, mise en page en **flexbox**, 17 thèmes « planètes » et 7 dispositions (rail, menu en haut, dock, TV, verre…). **Lagon** et **Océan** réorganisent tout le site : barre en haut avec recherche, bloc « Ce soir » (reprendre, sorties du jour, qui regarde, direct), infos sous les affiches, polices Outfit et Inter ; Océan ajoute des vagues qui roulent, et les deux passent sur **Sable** (clair) le jour. |
| **Partout** | Linux, Windows, Mac, Docker, Proxmox. Navigateur, téléphone (application installable), TV (télécommande), Chromecast, AirPlay. |
| **Lecture intelligente** | Lecture directe quand l'appareil sait lire le fichier, simple « remux » sinon, conversion matérielle (NVIDIA, Intel, AMD, Apple, Raspberry Pi) en dernier recours. |
| **Toute la maison** | Profils avec code PIN, comptes locaux ou **invitations par e-mail**, profils enfants (temps d'écran, âge), séances à plusieurs. |
| **Automatique** | Affiches et résumés en français, « À venir » relié à Radarr / Sonarr / Seerr, notifications Telegram, mises à jour en un clic. |

---

## Installation

Une seule commande, puis ouvrez `http://ADRESSE-DE-LA-MACHINE:8096` et laissez-vous guider : prénom, mot de passe du foyer, c'est tout.

| Machine | Commande | Carte graphique |
|---|---|---|
| **Linux avec Docker** (NAS, mini-PC, VPS) | `git clone https://github.com/TOUFATECH/Venus.git && cd Venus && ./install.sh` | Intel / AMD / NVIDIA / Raspberry Pi, détectée seule |
| **Linux sans Docker** (Debian, Ubuntu, LXC…) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh \| sudo bash` | Intel / AMD / NVIDIA |
| **Windows 10 / 11** | PowerShell : `irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 \| iex` | NVIDIA, Intel Quick Sync, AMD |
| **Mac** (puce Apple ou Intel) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh \| bash` | Puce Apple (VideoToolbox) |
| **Windows / Mac avec Docker Desktop** | voir plus bas | Processeur uniquement |

> L'interface Next.js est construite pendant l'installation (Docker, Linux, Mac). Si ce n'est pas possible (pas d'accès à npm, installation Windows), Venus sert automatiquement son **interface classique** : tout fonctionne de la même façon.

<details>
<summary><b>Linux avec Docker</b></summary>

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
./install.sh
```

Le script demande le dossier de vos films et celui de vos séries (laissez vide si tout est sur un NAS), détecte votre carte graphique et la mémoire disponible, puis construit et démarre Venus. Sans Docker sur la machine, il propose de l'installer ou d'installer Venus directement. `./install.sh --docker` ou `./install.sh --native` forcent un mode.

À la main : modifiez les chemins dans `docker-compose.yml`, ajoutez votre GPU si besoin (voir `docker-compose.override.example.yml`), puis `docker compose up -d --build`.
</details>

<details>
<summary><b>Linux sans Docker</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh | sudo bash
```

Installe Node.js (version officielle), ffmpeg de Jellyfin (toutes les accélérations matérielles), les outils SMB / NFS, construit l'interface, puis crée un service `venus` qui démarre avec la machine. Code dans `/opt/venus`, réglages dans `/etc/venus/venus.env`, données dans `/var/lib/venus`.

- Journal : `journalctl -u venus -f`
- Désinstaller : `sudo bash /opt/venus/scripts/install-native.sh uninstall`
</details>

<details>
<summary><b>Windows</b></summary>

Ouvrez **PowerShell** (menu Démarrer → tapez PowerShell) et collez :

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex
```

Le script télécharge Node.js et ffmpeg (versions portables, rien d'autre n'est modifié sur le PC), demande vos dossiers de vidéos, ouvre le port 8096 pour le réseau privé, et lance Venus **au démarrage du PC, même sans session ouverte**. Tout est rangé dans `C:\ProgramData\Venus`.

- Journal : `C:\ProgramData\Venus\venus.log`
- Réglages : `C:\ProgramData\Venus\venus.conf`, puis relancez la commande
- Désinstaller : `$env:VENUS_ACTION='uninstall'; irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex`

Si la TV ou le téléphone ne voient pas Venus, vérifiez que votre Wi-Fi est en profil **Privé**.
</details>

<details>
<summary><b>Mac</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh | bash
```

Nécessite [Homebrew](https://brew.sh). Installe Node.js et ffmpeg, construit l'interface, puis lance Venus à chaque ouverture de session. Données dans `~/Library/Application Support/Venus`, journal dans `~/Library/Logs/Venus.log`.

- Désinstaller : `bash ~/Library/Application\ Support/Venus/app/scripts/install-macos.sh uninstall`
- Vidéos sur un disque externe : Réglages Système → Confidentialité et sécurité → Accès complet au disque → ajoutez `node`.
</details>

<details>
<summary><b>Windows ou Mac avec Docker Desktop</b></summary>

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
cp .env.example .env        # puis indiquez vos dossiers dans .env (Windows : C:/Users/Moi/Videos)
docker compose -f docker-compose.desktop.yml up -d --build
```

Docker Desktop fait tourner Venus dans une machine virtuelle : la carte graphique n'est pas accessible et les NAS ne sont trouvés automatiquement que si `LAN_SUBNET` est renseigné dans `.env`.
</details>

<details>
<summary><b>Proxmox (conteneur LXC)</b></summary>

Venus fonctionne très bien dans un conteneur LXC Debian ou Ubuntu. Deux réglages se font **sur l'hôte Proxmox** (remplacez `7700` par le numéro du conteneur) :

```bash
# Carte graphique Intel / AMD → conversion vidéo accélérée
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu 7700

# Partage NAS / PC Windows → monté sur l'hôte puis transmis au conteneur
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) nas 7700
```

- `gpu` transmet `/dev/dri/renderD128` avec les bons droits.
- `nas` est nécessaire pour un conteneur **non privilégié** (le cas par défaut), qui n'a pas le droit de monter un partage lui-même.
- Conteneur **privilégié** : `… proxmox-host.sh mount 7700` suffit, l'assistant « Partage réseau » de Venus fonctionne ensuite directement.

Venus détecte qu'il tourne dans un LXC et affiche ces commandes dans **Réglages** quand c'est utile.
</details>

## Mise à jour

**Depuis l'application** : Réglages → **Mise à jour** → « Mettre à jour maintenant ». Venus prévient (notification, Telegram) quand une nouvelle version sort, et peut se mettre à jour tout seul la nuit.

**En ligne de commande** (Docker) :

```bash
cd /opt/Venus && git pull && bash update.sh
```

`update.sh` récupère la dernière version, reconstruit l'image (serveur **et** interface Next.js), active la carte graphique et les conversions en mémoire si la machine le permet, installe le petit compagnon qui rend le bouton « Mettre à jour » autonome, puis redémarre. Sans Docker, relancez simplement la commande d'installation (vos réglages sont conservés) ; le bouton de l'application reconstruit aussi l'interface.

---

## Fonctionnalités

### Regarder

- **Lecture intelligente** : lecture directe (0 % de processeur) quand l'appareil sait lire le fichier, « remux » quand seul le conteneur ou le son posent problème, conversion matérielle sinon. La conversion se met en pause quand elle a assez d'avance.
- **Lecture qui ne se fige pas** : si la conversion lâche en plein film, Venus reprend juste après le dernier segment écrit (même liste, discontinuité signalée) ; si le processeur convertit moins vite que la lecture, la qualité baisse d'un cran toute seule (et en automatique, le processeur seul ne vise jamais plus que ce qu'il tient en temps réel) ; le lecteur surveille l'image figée (saut par-dessus un trou, coup de pouce au décodeur, reprise de session, passage en conversion pour une lecture directe qui coince). Toutes les tâches de fond (compression, copies optimisées, reconnaissance vocale, analyses) tournent en priorité basse et la compression se **suspend** pendant toute lecture.
- **Copies optimisées** préparées la nuit ou quand la carte graphique est libre (H.264 + AAC) pour les appareils qui convertiraient sinon ; conversions en mémoire vive quand la machine en a assez.
- **Séries** : saisons, « Reprendre », épisode suivant avec compte à rebours, « Toujours là ? », minuterie de sommeil.
- **Sous-titres** SRT / ASS / VTT / PGS, intégrés ou externes, recherche en ligne (OpenSubtitles), décalage réglable.
- **Mini-lecteur** qui continue pendant la navigation, mode **Ambiance** (la lumière du film déborde autour de l'image), partage d'un extrait (GIF ou MP4).
- **TV en direct** (IPTV M3U / Xtream) avec guide des programmes, numéros de chaîne et **enregistrements** ; chaînes rangées par catégorie, favoris (export / import M3U), zapping instantané, **multi-écran** (2 ou 4 chaînes), rappels de programmes, chaînes du monde (iptv-org) sans doublon.
- **Confort** : mode nuit (son égalisé), image dans l'image, sous-titres à votre goût (gardés par profil), écran de veille (après 10 minutes sans activité, 5 sur la TV, même sur une vidéo en pause).
- **Musique** : albums, artistes, titres, paroles synchronisées ; chaque album est **reconnu sur MusicBrainz** (date, type, liste des titres, pochette Cover Art Archive, titres manquants signalés), les fichiers sans étiquette sont identifiés par **empreinte sonore** (AcoustID) ; **discographie complète** de chaque artiste avec **Sur le NAS / Pas sur le NAS**, onglet **À venir** (sorties annoncées, albums de l'année absents) et téléchargement en un clic via **Lidarr**.
- **Livres** : EPUB, PDF, BD, livres audio, lecteur intégré ; fiches complétées par **Open Library** (couverture, résumé), page **Auteur** avec sa **bibliographie complète** (Sur le NAS / Pas sur le NAS), onglet **À venir** (parutions annoncées via Google Books, parutions récentes absentes) et demande en un clic via **LazyLibrarian** ou **Bookshelf**.
- **Photos** (diaporama, HEIC).
- **Ce que les autres lecteurs n'ont pas** :
  - **« Précédemment dans… » automatique** : Venus analyse les scènes (coupures, volume) et monte un résumé de 30 secondes de l'épisode précédent, proposé au début du suivant (ou lancé tout seul avec l'option « Précédemment automatique »).
  - **Retour au moment où l'on s'est endormi** : 45 minutes sans aucun geste alors que la vidéo défilait, et la reprise revient au dernier geste, pas à la fin de l'épisode.
  - **Fiche à la pause** : temps restant, heure de fin, chapitre, acteurs de la scène avec leurs photos, dernière réplique et résumé — sans quitter la vidéo.
  - **Chapitres générés** pour les fichiers qui n'en ont pas, avec un titre tiré des dialogues (« Le lagon garde tous nos secrets »).
  - **Sous-titres générés sur le serveur** (whisper.cpp, hors ligne) puis traduits en français (Argos Translate ou LibreTranslate) pour les vidéos qui n'en ont pas : à demander depuis le lecteur.
  - **Recherche dans les dialogues** : tapez une réplique, retrouvez le film ou l'épisode et lancez la lecture à la seconde près (page Recherche et Ctrl+K).
  - **Mode anti-spoiler** par profil : les épisodes après le prochain à voir n'affichent ni titre, ni résumé, ni image.
  - **« Qui regarde ce soir ? »** (page Ce soir) : cochez les personnes présentes, Venus propose ce que personne n'a vu, permis au plus jeune, et qui plaît à chacun.
  - **Lumières synchronisées** : les ampoules Philips Hue et les bandes LED WLED prennent la couleur dominante de l'image, puis reviennent comme avant à la fin (Réglages → Lecture).
  - **Meilleurs moments** repérés automatiquement, proposés dans « Partager un extrait ».

### Trouver

- **Films, Séries, Animés, Clips** : tri (date d'ajout, sortie, note, popularité, durée…), filtres (genres, années, note, classification, qualité, studios), affiches / vignettes / liste.
- **À venir** : sorties et épisodes jour par jour, **Disponible** ou **Pas disponible** sur le NAS, suggestions de titres absents ; le ♡ met en favori **et** lance le téléchargement (Radarr / Sonarr), calendrier à s'abonner (iCal).
- **Recherche instantanée** en français : « un film drôle de moins d'1 h 30 des années 90 », acteurs, genres, et titres pas encore dans Venus.
- **Fiches complètes** : distribution et équipe **avec leurs photos**, filmographie de chaque acteur, notes des sites (IMDb, Rotten Tomatoes, Metacritic, AniList…), emplacement du fichier sur le NAS.
- **Survol** : contour lumineux animé de l'affiche, bande-annonce, fiche préchargée pour s'ouvrir instantanément.
- **Ctrl+K** partout : titres, chaînes, personnes, pages et réglages ; **commande vocale** en français (« Mets One Piece », « Chaîne 12 ») ; **manette de jeu**.

### Toute la maison

- **Comptes** : l'administrateur crée des **comptes locaux** ou **invite par e-mail** (lien personnel, valable 7 jours).
- **Profils** avec code PIN, langues préférées, **profils enfants** (menu simplifié, temps d'écran, horaires, âge).
- **Séance à plusieurs** (chacun chez soi, en même temps), **vote en famille** pour choisir le film, **téléphone-télécommande** par QR code.
- **Trakt** : chaque profil relie son compte (code à saisir sur trakt.tv) ; ce qui est vu part dans Trakt, l'historique Trakt arrive dans Venus. **Rétrospective de l'année** par profil.
- **Notifications** : Web Push, ntfy, Discord, et **Telegram avec une fiche par nouveauté** (affiche, résumé, date de sortie, « en cours de téléchargement » puis « disponible »).

### Administrer

- **Tableau de bord** : lectures en cours, appareils, tâches planifiées, journal, **santé du NAS**, performances (GPU, mémoire, copies optimisées).
- **Seerr, Radarr, Sonarr, Lidarr, LazyLibrarian / Bookshelf** : envies, séries suivies, nouvelles saisons demandées automatiquement ; albums, artistes et livres demandés depuis Venus (Readarr étant arrêté depuis juin 2025, Venus parle à ses deux successeurs).
- **Médiathèque** : doublons, renommage façon Plex / Jellyfin, corbeille 7 jours, qualité (4K, HDR, débits), sauvegardes nocturnes restaurables.
- **Compression des vidéos** (Réglages → Performance, et sur chaque fiche) : Venus repère les fichiers qui gagneraient à être recompressés (HEVC/AV1 10 bits, vieux codecs, débits excessifs) et propose une copie H.264 8 bits, AAC, à la **qualité de votre choix** (Maximale CRF 17 / Haute CRF 20 / Équilibrée CRF 23) et à la définition de votre choix (4K d'origine, 1440p, 1080p, 720p), réglables globalement et vidéo par vidéo avec la taille estimée en direct, sous-titres texte conservés, langues audio à garder au choix (français, anglais…). La copie `.venus.mp4` est écrite à côté de l'original ; rien n'est supprimé tant que vous ne l'avez pas lue et **validée** : l'original passe alors en corbeille 7 jours (ou est supprimé tout de suite), la copie prend son nom et Radarr / Sonarr sont prévenus. Lecture directe sans conversion sur tous les appareils, place gagnée sur le NAS.
- **Import depuis Plex ou Jellyfin** : épisodes vus et lectures en cours, retrouvés par fichier ou identifiants.
- **API et webhooks** (`X-Api-Key`, Home Assistant, n8n…), CSS personnalisé, message d'accueil.

---

## Interface Next.js

L'interface est une application **Next.js 16** (App Router, React 19, dernières versions) dans le dossier [`web/`](web), mise en page en **flexbox** : chaque écran est une vraie page avec son adresse directe (`/films/orage-2018`, `/series/brigade-nord/S02E04`, `/musique/artiste/zaza`…), partageable et rechargeable. L'image Docker repose sur Node 24 et Debian 13 (trixie) avec jellyfin-ffmpeg 7 ; le lecteur HLS embarqué est hls.js 1.7.4. Elle est servie **par Venus lui-même**, sur le même port : rien de plus à ouvrir ni à configurer.

```
Navigateur ──► Venus (port 8096)
                ├─ /api, /img, /cal ............ API (Node.js, zéro dépendance)
                ├─ /_next/static ............... fichiers de l'interface (brotli, cache 1 an)
                ├─ /js, /css, /icons ........... modules partagés de l'interface
                └─ pages ───► Next.js (processus séparé, 127.0.0.1, port interne)
                              nonce CSP neuf à chaque page
```

- **Processus séparé et surveillé** : Venus lance le serveur Next.js autonome (~20 Mo), le relance s'il s'arrête, et sert l'interface classique en attendant : il n'y a jamais d'écran vide.
- **Tout passe par Next.js** : le menu (rail, menu en haut, dock, onglets mobiles), le démarrage (installation, connexion, profils), le routage et **chaque page** sont des composants Next.js. Le moteur de lecture vidéo (HLS, Chromecast, AirPlay, mini-lecteur) est un module piloté par la page Next.js du lecteur, comme on intègre video.js.
- **Code partagé embarqué** : l'état, l'accès au serveur, les thèmes, le menu et la navigation à la télécommande (`public/js`, avec `core.js` au centre) sont embarqués par Next.js dans ses propres fichiers au moment de la construction. L'ancienne application n'est plus chargée du tout ; elle ne sert que d'interface de secours.
- **Navigation Next.js** : liens préchargés, retour / avance du navigateur, adresses lisibles (`/films/inception-2010`, `/series/breaking-bad/S01E02`).
- **Secours** : `VENUS_UI=classic` sert l'ancienne interface ; sans construction de `web/`, elle est servie automatiquement.

### État de la migration

| Partie | Statut |
|---|---|
| Coque : thèmes, 6 dispositions, rail, menu en haut, dock, onglets mobiles, badge des lectures, temps d'écran | ✅ Next.js |
| Démarrage : installation, connexion (mot de passe, code à 6 chiffres, double authentification), « Qui regarde ? » et code PIN, invitations | ✅ Next.js |
| Accueil, fiche d'un titre (saisons, épisodes, distribution, modifier, identifier, images) | ✅ Next.js |
| Films, Séries, Animés, Clips, Ma liste, À venir, Mes envies, Nouveautés, Recherche | ✅ Next.js |
| TV en direct (chaînes, guide, enregistrements), Ce soir, vote en famille, séance, télécommande | ✅ Next.js |
| Musique, photos, livres et liseuse, collections, listes de lecture, téléchargements | ✅ Next.js |
| Réglages (profil, appareil, thème, menu, médiathèques, assistant NAS / IPTV, Seerr, Radarr / Sonarr, notifications, sauvegardes…) | ✅ Next.js |
| Tableau de bord, statistiques, qualité, sécurité, serveur | ✅ Next.js |
| Lecteur vidéo (films, épisodes, clips, chaînes) | ✅ page Next.js, moteur de lecture en module |

### Développer l'interface

```bash
npm start                 # serveur Venus (port 8096)
npm run web:dev           # interface en direct sur http://localhost:3100 (API prise sur le port 8096)
npm run web:build         # construction de production (servie ensuite par Venus)
```

### Tests

```bash
npm run web:build && npm test   # 125 tests dans un vrai navigateur (Playwright)
cd tests && npm run analyse     # analyse du code (variables inconnues, règles React…)
```

Les tests démarrent un Venus jetable avec de petites vidéos, de la musique et des photos générées par ffmpeg, puis vérifient chaque page sur **ordinateur**, **téléphone** et **télévision** (navigation aux flèches de la télécommande) : connexion et code PIN, lecture d'un film, épisode suivant, mini-lecteur, recherche, Ma liste, musique, réglages, assistant d'ajout de source. Une page qui lève une erreur JavaScript fait échouer son test. Sur GitHub, l'analyse et les tests tournent à chaque envoi, avec la construction et le démarrage de l'image Docker.

---

## Architecture

```
server/            API et services — Node.js ≥ 22, aucune dépendance
  index.js           serveur HTTP/HTTPS, tâches de fond, démarrage
  next-ui.js         lancement, surveillance et relais de l'interface Next.js
  api.js             routes de l'API
  stream.js          décision de lecture, sessions HLS, sous-titres, vignettes
  hw.js              détection et pipelines d'accélération matérielle
  optimize.js        copies optimisées (nuit / carte graphique libre)
  scanner.js         analyse des bibliothèques, surveillance des dossiers
  netshare.js        partages SMB / NFS, recherche des NAS
  upcoming.js        « À venir », favoris envoyés à Radarr / Sonarr, calendrier iCal
  invites.js, auth.js, security.js, twofa.js   comptes, invitations, sécurité
  notify.js, telegram-media.js                 notifications et fiches Telegram
  metadata.js, posters.js, ratings.js, credits-free.js   affiches, notes, distribution
  update.js          vérification et installation des mises à jour
web/               interface Next.js 16 (App Router)
  app/               une route par page (accueil, fiches, bibliothèques, TV, musique, réglages, lecteur…)
  components/        coque, écrans d'entrée, cartes, rangées, et toutes les pages (components/pages)
public/            code partagé (core.js : état et navigation ; API, thèmes, menu, lecteur), interface de secours (app.js), styles, icônes
scripts/           installateurs Linux / Windows / Mac / Proxmox, test de charge, contrôle de sécurité
```

---

## Fiabilité et sécurité

| Contrôle | Résultat |
|---|---|
| Contrôle de sécurité (`npm run security`) | **34 / 34** protections vérifiées |
| Test de charge (`node scripts/load-test.mjs`) : 50 utilisateurs, 90 s, lectures vidéo et chaînes | 0 erreur, p95 ≤ 21 ms, 0 coupure |
| Endurance (3 séries de charge) | mémoire stable (208 → 213 Mo), descripteurs stables |
| Exploration des 213 routes de l'API avec des entrées invalides | aucune erreur 500 |
| Pages de l'interface (Next.js) | HTML en ~10 ms, fichiers servis compressés et gardés en cache |

- **CSP stricte** avec nonce par page, en-têtes de sécurité, protection CSRF, limitation des requêtes, blocage automatique des adresses suspectes.
- **Double authentification** par e-mail, codes PIN, appareils révocables, journal et audit hebdomadaire.
- **HTTPS** intégré (port 8920, certificat créé au premier démarrage) ou derrière Caddy / Nginx.

Détails et marche à suivre : [SECURITY.md](SECURITY.md).

---

## Vidéos sur le réseau (NAS, PC Windows)

Inutile de copier vos vidéos : **Réglages → Bibliothèques → Ajouter un emplacement → Partage réseau**. Venus trouve les appareils qui partagent des fichiers (SMB, NFS), monte le partage, le remonte après une coupure et vérifie les nouveautés toutes les 10 minutes. Si un partage devient injoignable, rien n'est effacé et un bouton « Reconnecter » apparaît.

**IPTV** : même menu, type « TV en direct », puis identifiants Xtream ou adresse M3U.

### Ranger ses vidéos

```
Films/
  Inception (2010).mkv
  Interstellar (2014)/
    Interstellar.2014.MULTI.1080p.mkv
    Interstellar.2014.MULTI.1080p.fr.srt
Series/
  Breaking Bad/
    Saison 1/
      Breaking.Bad.S01E01.mkv
```

Les noms « sales » (`Film.2019.MULTI.VFF.1080p.BluRay.x264-GRP.mkv`) sont nettoyés automatiquement ; un titre mal reconnu se corrige depuis sa fiche.

## Sur chaque écran

| Appareil | Comment |
|---|---|
| Téléphone, tablette | Ouvrez l'adresse, puis « Installer Venus » (sur iPhone : Partager → Sur l'écran d'accueil) |
| Ordinateur | Navigateur, ou icône « Installer » dans la barre d'adresse |
| Android TV, Fire TV, Google TV, Samsung, LG | Navigateur de la TV, navigation complète aux flèches de la télécommande |
| Chromecast | Bouton de diffusion dans le lecteur (HTTPS nécessaire) |
| Apple TV | AirPlay depuis l'iPhone, l'iPad ou le Mac |

## Accès depuis l'extérieur (HTTPS)

Le plus simple : **Réglages → Accès hors de la maison**. Venus propose un **lien rapide** (tunnel Cloudflare gratuit, sans compte ni port à ouvrir), **votre propre tunnel Cloudflare** (adresse fixe, avec le jeton du tableau de bord) ou **Tailscale** (réseau privé : vos appareils comme à la maison). Les visites par tunnel sont toujours traitées comme venant d'Internet.

Autre possibilité, [Caddy](https://caddyserver.com), qui obtient le certificat tout seul :

```
cinema.mondomaine.fr {
  reverse_proxy 127.0.0.1:8096
}
```

Venus sert aussi HTTPS (en **HTTP/2**) sur le port **8920** avec un certificat auto-signé (`TLS_CERT` et `TLS_KEY` pour un vrai certificat). Les connexions venant d'Internet en `http://` sont redirigées vers HTTPS ; le réseau local reste accessible en `http://`.

## Variables d'environnement

| Variable | Par défaut | Rôle |
|---|---|---|
| `PORT` | `8096` | Port HTTP |
| `TZ` | `Europe/Paris` (Docker) | Fuseau horaire de départ. Il se règle ensuite dans Réglages → Serveur ; sans choix, Venus adopte celui de l'appareil de l'administrateur (réseau local) quand il diffère |
| `DATA_DIR` | `/config` (Docker), `./data` | Base de données, affiches, cache |
| `TRANSCODE_DIR` | `/transcode` (Docker) | Fichiers temporaires de conversion |
| `MOVIES_PATH` / `SHOWS_PATH` / `ANIME_PATH` / `CLIPS_PATH` | `/media/films`… | Dossiers proposés à l'installation |
| `TMDB_API_KEY` | — | Clé TMDB (sinon saisissable dans l'interface ; Venus trouve les affiches sans clé) |
| `HWACCEL` | `auto` | Forcer `nvenc`, `vaapi`, `qsv`, `amf`, `videotoolbox`, `v4l2m2m` ou `none` |
| `VENUS_FAST_TRANSCODE` | — | Dossier en mémoire vive (tmpfs) pour les conversions ; posé par `update.sh` quand la machine a assez de RAM |
| `VENUS_UI` | — | `classic` : sert l'interface classique au lieu de l'interface Next.js |
| `VENUS_WEB_DIR` | auto | Dossier de l'interface Next.js construite (`web-dist` dans l'image Docker) |
| `VENUS_NEXT_PORT` | aléatoire | Port interne (127.0.0.1) de l'interface Next.js |
| `HTTPS_PORT` | `8920` | Port HTTPS intégré (`HTTPS=0` pour le couper) |
| `TLS_CERT` / `TLS_KEY` | — | Certificat et clé (sinon auto-signé) |
| `FORCE_HTTPS` | `remote` | `off`, `remote` ou `all` |
| `TRUST_PROXY` | — | `1` si un proxy sur une autre machine transmet l'adresse du visiteur |
| `LAN_SUBNET` | — | Réseau à explorer pour trouver les NAS (ex. `192.168.1`) |
| `VENUS_SECRET` | — | Clé de chiffrement des clés d'API (sinon `/config/secret.key`) |
| `VENUS_WHISPER_BIN` | auto | Chemin de `whisper-cli` (sous-titres générés) ; l'image Docker l'inclut |
| `VENUS_FPCALC_BIN` | auto | Chemin de `fpcalc` (empreintes AcoustID) ; l'image Docker l'inclut (`libchromaprint-tools`) |
| `ACOUSTID_KEY` | — | Clé d'application AcoustID (sinon saisissable dans Réglages → Demandes) |
| `LIBRETRANSLATE_URL` | — | Serveur LibreTranslate pour traduire les sous-titres générés (sinon réglable dans l'interface, ou Argos Translate s'il est installé) |

## Par rapport à Plex et Jellyfin

Venus fait mieux sur la légèreté, la simplicité d'installation, la sobriété de l'interface et l'automatisation (À venir, téléchargements, Telegram). Plex et Jellyfin gardent l'avantage des applications natives dans les stores des TV, des plugins et du DLNA.

## Licence

[MIT](LICENSE) © 2026 TOUFATECH
