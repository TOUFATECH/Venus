# Développement

[← Retour au README](../README.md) · [Configuration](configuration.md) · [Sécurité](../SECURITY.md)

Ce guide présente l'organisation du code de Venus, la façon de le lancer en local et de le tester. Tout le code est commenté en français.

---

## Sommaire

1. [Principes](#1-principes)
2. [Lancer Venus en local](#2-lancer-venus-en-local)
3. [Organisation du dépôt](#3-organisation-du-dépôt)
4. [Serveur (`server/`)](#4-serveur-server)
5. [Code partagé de l'interface (`public/js/`)](#5-code-partagé-de-linterface-publicjs)
6. [Interface Next.js (`web/`)](#6-interface-nextjs-web)
7. [Tests et qualité](#7-tests-et-qualité)
8. [Image Docker](#8-image-docker)
9. [Contribuer](#9-contribuer)

---

## 1. Principes

- **Serveur sans dépendance npm** : uniquement les modules intégrés à Node.js (`node:http`, `node:sqlite`, `node:crypto`…). Moins de code tiers, moins de failles, installation instantanée.
- **ffmpeg** fait tout le travail vidéo (analyse, conversion, vignettes, enregistrements).
- **Interface Next.js 16** (App Router, React 19) servie par Venus lui-même, dans un processus séparé sans aucun secret.
- **Interface de secours** : si l'interface Next.js n'est pas construite, Venus sert l'interface classique (`public/js/app.js`), avec les mêmes fonctions.
- **Tout en français** : interface, messages, commentaires du code.

---

## 2. Lancer Venus en local

Prérequis : **Node.js 22.13 ou plus** et **ffmpeg** dans le `PATH`.

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
npm start                 # serveur sur http://localhost:8096 (données dans ./data)
```

Interface Next.js en direct (rechargement à chaque modification) :

```bash
npm run web:dev           # http://localhost:3100, API prise sur le port 8096
```

| Commande | Rôle |
|---|---|
| `npm start` | Démarre le serveur |
| `npm run dev` | Démarre le serveur et le relance à chaque modification |
| `npm run web:dev` | Interface Next.js en mode développement |
| `npm run web:build` | Construction de production de l'interface (servie ensuite par Venus) |
| `npm test` | Tests de bout en bout (Playwright) |
| `npm run security` | Contrôle de sécurité (34 attaques simulées sur un serveur jetable) |
| `npm run audit` | `npm audit` + contrôle de sécurité |
| `node scripts/load-test.mjs` | Test de charge |

---

## 3. Organisation du dépôt

```
server/        API et services (Node.js ≥ 22, aucune dépendance)
web/           interface Next.js 16 (App Router)
  app/           une route par page (accueil, fiches, bibliothèques, TV, musique, réglages, lecteur…)
  components/    coque, écrans d'entrée, cartes, rangées
    pages/       toutes les pages
  lib/           hooks React et accès au code partagé
public/        code partagé de l'interface, styles, icônes, polices, interface de secours
scripts/       installateurs Linux / Windows / macOS / Proxmox, test de charge, contrôle de sécurité
tests/         tests Playwright et analyse du code (ESLint)
docs/          documentation
Dockerfile, docker-compose*.yml, install.sh, update.sh
```

---

## 4. Serveur (`server/`)

Point d'entrée : [`server/index.js`](../server/index.js). Les routes de l'API sont dans [`server/api.js`](../server/api.js).

| Fichier | Rôle |
|---|---|
| [`activity.js`](../server/activity.js) | Tableau de bord : lectures en cours, journal d'activité, commandes aux appareils, code de connexion à 6 chiffres |
| [`api.js`](../server/api.js) | Toutes les routes de l'API (/api/…) |
| [`apikeys.js`](../server/apikeys.js) | Clés API : pour des scripts ou des applications (Home Assistant, scripts de téléchargement…) |
| [`arr.js`](../server/arr.js) | Radarr (films) et Sonarr (séries et animés) : recherche et ajout d'un titre depuis la page « Nouveau » |
| [`audit.js`](../server/audit.js) | Audit de sécurité automatique : au démarrage puis chaque semaine (et à la demande dans le tableau de bord) |
| [`auth.js`](../server/auth.js) | Authentification : mot de passe du foyer (+ code par e-mail), appareil mémorisé, profil (+ code PIN), sessions par jeton aléatoire de 256 bits |
| [`backup.js`](../server/backup.js) | Sauvegardes de la base (profils, vus, listes, envies, réglages) : une par nuit, les 10 dernières gardées |
| [`books-arr.js`](../server/books-arr.js) | Téléchargement des livres : LazyLibrarian (API « cmd ») ou Bookshelf (fork de Readarr, API v1) |
| [`books-meta.js`](../server/books-meta.js) | Livres : fiches et bibliographies depuis Open Library (gratuit, sans clé) et parutions à venir depuis Google Books |
| [`channel-cats.js`](../server/channel-cats.js) | Catégories des chaînes TV : déduites du nom de la chaîne et du groupe de la liste M3U |
| [`clock.js`](../server/clock.js) | Heure du serveur : fuseau utilisé par les horaires des profils enfants, les tâches de nuit et les statistiques |
| [`config.js`](../server/config.js) | Configuration globale (variables d'environnement + valeurs par défaut) |
| [`convert.js`](../server/convert.js) | Compression des vidéos : copie H.264 + AAC écrite à côté de l'original, qui ne remplace celui-ci qu'après validation |
| [`credits-free.js`](../server/credits-free.js) | Distribution et équipe sans clé TMDB, et filmographie d'une personne |
| [`db.js`](../server/db.js) | Base SQLite intégrée à Node (aucune dépendance native à compiler) |
| [`dialogues.js`](../server/dialogues.js) | Recherche dans les dialogues : les sous-titres (en français de préférence) de chaque film et épisode sont indexés en texte intégral |
| [`discover.js`](../server/discover.js) | Nouveautés (films, séries, animés sortis ou à venir) et demandes de téléchargement via Seerr |
| [`downloads.js`](../server/downloads.js) | Téléchargements pour regarder sans réseau : fichier d'origine ou version légère (720p / 480p) préparée en arrière-plan |
| [`dvr.js`](../server/dvr.js) | Enregistrements de la TV en direct (DVR) : un programme du guide, une émission à chaque diffusion (« série »), ou un créneau libre |
| [`env.js`](../server/env.js) | Détection de l'environnement (Docker, conteneur LXC Proxmox, machine classique) pour des conseils adaptés |
| [`epg.js`](../server/epg.js) | Guide des programmes (EPG) au format XMLTV : adresse trouvée dans la liste M3U (url-tvg / x-tvg-url), fournie par l'abonnement Xtream, ou ajoutée à la main dans les réglages |
| [`extras.js`](../server/extras.js) | Fonctions diverses : avis « j'ai aimé / bof », prévision de remplissage du disque, journal des conversions, extraits à partager, détection des sous-titres décalés |
| [`free-tv.js`](../server/free-tv.js) | Chaînes gratuites (France, Outre-mer, animé / manga en français, Japon), et vérification de toutes les chaînes IPTV |
| [`ftv.js`](../server/ftv.js) | Chaînes France Télévisions (Mayotte La 1ère et les autres La 1ère) : jeton toujours frais |
| [`guide.js`](../server/guide.js) | Guide des épisodes sans clé TMDB : la liste complète des épisodes diffusés vient de TVmaze |
| [`http.js`](../server/http.js) | Mini-framework HTTP sans dépendance : routeur, JSON, fichiers statiques compressés, Range |
| [`hw.js`](../server/hw.js) | Détection de l'accélération matérielle (NVIDIA, Intel, AMD, Raspberry Pi, Mac) : chaque encodeur est réellement testé |
| [`import-media.js`](../server/import-media.js) | Import de l'historique (vus et lectures en cours) depuis un autre serveur multimédia vers un profil Venus |
| [`index.js`](../server/index.js) | Point d'entrée du serveur : HTTP / HTTPS, tâches de fond, démarrage de l'interface |
| [`invites.js`](../server/invites.js) | Comptes par invitation : profil créé par l'administrateur et lien personnel envoyé par e-mail (valable 7 jours) |
| [`library-tools.js`](../server/library-tools.js) | Outils de médiathèque : doublons, renommage standard des fichiers, nettoyage |
| [`lights.js`](../server/lights.js) | Lumières synchronisées avec l'image (Philips Hue en local, WLED) |
| [`logbuf.js`](../server/logbuf.js) | Journal du serveur visible dans le tableau de bord : les 2 000 dernières lignes de la console, avec leur niveau |
| [`media.js`](../server/media.js) | Musique, photos et livres : bibliothèques de type « music », « photos » et « books » |
| [`metadata.js`](../server/metadata.js) | Métadonnées TMDB (affiches, résumés en français, classification d'âge, logos) |
| [`music-meta.js`](../server/music-meta.js) | Reconnaissance des albums et discographies : MusicBrainz, Cover Art Archive, empreinte sonore AcoustID |
| [`nas-health.js`](../server/nas-health.js) | Santé des disques et du NAS : temps de réponse et vitesse de lecture réelle de chaque bibliothèque |
| [`netshare.js`](../server/netshare.js) | Sources réseau : partages Windows / NAS (SMB) et NFS, montés par Venus dans /mnt/venus/<id> |
| [`new-episodes.js`](../server/new-episodes.js) | « Nouvel épisode » : prévient chaque profil quand une série qu'il suit reçoit des épisodes |
| [`next-ui.js`](../server/next-ui.js) | Lancement, surveillance et relais de l'interface Next.js (processus séparé sur un port interne) |
| [`nfo.js`](../server/nfo.js) | Fichiers .nfo (format standard des gestionnaires de médiathèque) : identifiants TMDB / IMDb, titre, année, résumé, genres |
| [`nice.js`](../server/nice.js) | Travaux d'arrière-plan en priorité basse (processeur et disque) pour qu'une lecture reste toujours fluide |
| [`notify.js`](../server/notify.js) | Notifications : « Nouveau dans Venus », « Ton envie est arrivée »… |
| [`optimize.js`](../server/optimize.js) | Copies optimisées préparées à l'avance (la nuit ou carte graphique libre) pour les vidéos qui devraient être converties à chaque lecture |
| [`parse.js`](../server/parse.js) | Extraction titre / année / saison / épisode à partir des noms de fichiers et dossiers |
| [`perms.js`](../server/perms.js) | Droits par profil : bibliothèques visibles, téléchargement, lecture convertie, accès depuis l'extérieur et horaires autorisés |
| [`posters.js`](../server/posters.js) | Affiches sans clé : quand il n'y a pas de clé TMDB (ou que TMDB ne reconnaît pas un titre), Venus cherche l'affiche, le résumé et l'année sur des services gratuits qui ne demandent aucune… |
| [`probe.js`](../server/probe.js) | Analyse des fichiers vidéo (ffprobe) et des sous-titres externes |
| [`ratings.js`](../server/ratings.js) | Notes (TMDB, IMDb, Rotten Tomatoes, Metacritic, AniList, MyAnimeList, Simkl) et bandes-annonces |
| [`relay.js`](../server/relay.js) | Relais HLS des chaînes en direct déjà au format web, sans conversion |
| [`remote-access.js`](../server/remote-access.js) | Accès hors de la maison sans ouvrir de port : lien rapide ou tunnel Cloudflare, Tailscale |
| [`reports.js`](../server/reports.js) | Rapport hebdomadaire de l'administrateur et vérification des fichiers |
| [`scanner.js`](../server/scanner.js) | Scan des bibliothèques : incrémental, détecte ajouts / modifications / suppressions |
| [`scenes.js`](../server/scenes.js) | Analyse des scènes d'une vidéo : changements de plan et volume sonore, seconde par seconde |
| [`security.js`](../server/security.js) | Sécurité : en-têtes (CSP…), CORS, CSRF, limitation des tentatives, détection d'intrusion, validation des données reçues |
| [`segments.js`](../server/segments.js) | Génériques (opening / ending) : repérage du début et de la fin dans chaque épisode, pour le bouton « Passer » |
| [`slugs.js`](../server/slugs.js) | Adresses lisibles des pages (inception-2010, breaking-bad/S01E02, france-24…), sur le modèle du rangement des fichiers |
| [`smtp.js`](../server/smtp.js) | Envoi d'e-mails sans dépendance : client SMTP minimal (TLS direct sur le port 465, ou STARTTLS sur 587/25), authentification PLAIN / LOGIN |
| [`stream.js`](../server/stream.js) | Moteur de lecture : lecture directe (0 % CPU), remux HLS (copie vidéo), ou transcodage HLS matériel |
| [`subtitles.js`](../server/subtitles.js) | Sous-titres en ligne (OpenSubtitles) : recherche, téléchargement, le fichier vidéo n'est jamais modifié |
| [`tasks.js`](../server/tasks.js) | Tâches planifiées : chaque travail de fond (scan, vignettes, sauvegardes…) s'inscrit ici avec sa fréquence |
| [`telegram-media.js`](../server/telegram-media.js) | Fiches Telegram des nouveautés : affiche, résumé, date de sortie et état (en cours de téléchargement, disponible), un seul message par titre |
| [`tls.js`](../server/tls.js) | HTTPS : certificat fourni (TLS_CERT / TLS_KEY) ou certificat auto-signé créé et renouvelé automatiquement |
| [`together.js`](../server/together.js) | Séances à plusieurs (lecture synchronisée, chat, réactions) et télécommande téléphone → TV |
| [`trakt-sync.js`](../server/trakt-sync.js) | Synchronisation avec Trakt, par profil : chaque personne relie son propre compte Trakt |
| [`trakt.js`](../server/trakt.js) | Trakt (app.trakt.tv) : affiches, fonds et logos des films, séries et animés, plus la note Trakt |
| [`transcribe.js`](../server/transcribe.js) | Sous-titres générés hors ligne (whisper.cpp) puis traduits en français (Argos Translate ou LibreTranslate) |
| [`trash.js`](../server/trash.js) | Corbeille : une vidéo supprimée depuis Venus est gardée 7 jours avant d'être effacée |
| [`trickplay.js`](../server/trickplay.js) | Vignettes d'aperçu de la barre de progression (« trickplay ») : une image toutes les 10 secondes, rangées par planches de 10 × 10 en JPEG |
| [`twofa.js`](../server/twofa.js) | Double authentification par e-mail : code à 6 chiffres à la connexion d'un nouvel appareil |
| [`upcoming.js`](../server/upcoming.js) | « À venir » : sorties et diffusions jour par jour, disponibles ou non sur le NAS |
| [`update.js`](../server/update.js) | Mise à jour de Venus depuis l'interface (Tableau de bord → Serveur) |
| [`versions.js`](../server/versions.js) | Plusieurs versions d'un même film (4K et 1080p, version longue…) : une seule affiche dans les listes, et le choix de la version sur la fiche |
| [`vf.js`](../server/vf.js) | VF : quels titres ont une piste audio française, la demande de la version française à Radarr / Sonarr, et l'annonce quand elle arrive |
| [`watch.js`](../server/watch.js) | Envies et suivi automatique avec Seerr |
| [`webhooks.js`](../server/webhooks.js) | Webhooks : Venus envoie un POST JSON à vos adresses quand il se passe quelque chose (nouveauté, lecture, connexion, alerte de sécurité) |
| [`youtube.js`](../server/youtube.js) | Bande-annonce sans clé TMDB : recherche sur YouTube (page de résultats lue côté serveur, aucune clé nécessaire) |
| [`zip.js`](../server/zip.js) | Lecture des archives ZIP (livres EPUB, bandes dessinées CBZ) sans dépendance : répertoire central, puis décompression « deflate » de l'entrée demandée |

---

## 5. Code partagé de l'interface (`public/js/`)

Ces modules sont utilisés à la fois par l'interface Next.js (qui les embarque à la construction) et par l'interface classique. `core.js` est au centre : état, accès au serveur, navigation.

| Fichier | Rôle |
|---|---|
| [`ambiance.js`](../public/js/ambiance.js) | Mode Ambiance : la lumière du film déborde autour de l'image, et l'interface prend la couleur de chaque titre |
| [`api.js`](../public/js/api.js) | Client de l'API et détection des formats que l'appareil sait lire |
| [`app.js`](../public/js/app.js) | Venus — interface classique (sans Next.js) : coque de navigation, affichage des pages et démarrage |
| [`audio.js`](../public/js/audio.js) | Lecteur audio de Venus (musique et livres audio) : il continue pendant la navigation, avec une barre en bas de l'écran, la file d'attente, les paroles, l'écran verrouillé du téléphone… |
| [`cast.js`](../public/js/cast.js) | Chromecast (Google Cast) — chargé uniquement sur Chrome/Edge, en contexte sécurisé (HTTPS) |
| [`components.js`](../public/js/components.js) | Composants partagés : cartes, rangées, actions de lecture |
| [`convert.js`](../public/js/convert.js) | Écran de compression des vidéos (interface classique) |
| [`core.js`](../public/js/core.js) | Venus — cœur partagé par l'interface Next.js (web/) et l'interface classique (app.js) : état, adresses et navigation, titre de l'onglet, mode léger, nouveautés en temps réel, changement de… |
| [`gamepad.js`](../public/js/gamepad.js) | Manette de jeu (Xbox, PlayStation, Switch Pro… branchée ou en Bluetooth) : la croix et le stick gauche déplacent la sélection, A / Croix valide, B / Rond revient en arrière, X / Carré met… |
| [`live.js`](../public/js/live.js) | Lecture HLS légère (aperçus) : hls.js chargé à la demande, ou lecture native sur Safari / iOS |
| [`menu.js`](../public/js/menu.js) | Menu de navigation personnalisable : ordre et éléments affichés, propres à chaque profil sur cet appareil |
| [`mini.js`](../public/js/mini.js) | Mini-lecteur : la vidéo continue dans une petite fenêtre en bas à droite pendant qu'on navigue |
| [`nav.js`](../public/js/nav.js) | Navigation spatiale : télécommande de TV, flèches du clavier, manette |
| [`party.js`](../public/js/party.js) | Séance à plusieurs : lecture synchronisée entre écrans, chat et réactions en direct |
| [`queue.js`](../public/js/queue.js) | File de lecture (clips) : tout lire dans l'ordre ou au hasard, suivant / précédent dans le lecteur |
| [`remote-screen.js`](../public/js/remote-screen.js) | Côté écran (TV, ordinateur) : appairage d'un téléphone et exécution de ses commandes |
| [`screensaver.js`](../public/js/screensaver.js) | Écran de veille : après quelques minutes sans rien toucher (et sans vidéo en cours), les fonds de vos films et séries défilent doucement, avec l'heure et la date |
| [`themes.js`](../public/js/themes.js) | Thèmes « planètes » : chaque planète du système solaire change les couleurs, le nom affiché et le logo (une planète dont la surface tourne) |
| [`trailer.js`](../public/js/trailer.js) | Bandes-annonces YouTube intégrées discrètement (youtube-nocookie, sans interface YouTube) |
| [`ui.js`](../public/js/ui.js) | Petits outils d'interface (sans framework) |
| [`voice.js`](../public/js/voice.js) | Commande vocale en français (Chrome, Edge, Safari) : « Mets One Piece », « Chaîne 12 » |

Le dossier `public/js/views/` contient les pages de l'interface classique ; `public/css/app.css` contient tous les styles (thèmes compris).

---

## 6. Interface Next.js (`web/`)

```
Navigateur ──► Venus (port 8096)
                ├─ /api, /img, /cal ............ API (Node.js)
                ├─ /_next/static ............... fichiers de l'interface (brotli, cache 1 an)
                ├─ /js, /css, /icons ........... modules partagés
                └─ pages ───► Next.js (processus séparé, 127.0.0.1, port interne)
                              nonce CSP neuf à chaque page
```

- **Processus séparé et surveillé** : Venus lance le serveur Next.js autonome (~20 Mo), le relance s'il s'arrête, et sert l'interface classique en attendant : jamais d'écran vide.
- **Une route par page** dans `web/app/` : chaque écran a son adresse directe (`/films/orage-2018`, `/series/brigade-nord/S02E04`, `/musique/artiste/zaza`), partageable et rechargeable.
- **Pages** dans `web/components/pages/`, coque et composants communs dans `web/components/`.
- Le moteur de lecture (HLS, Chromecast, AirPlay, mini-lecteur) est un module piloté par la page du lecteur.

---

## 7. Tests et qualité

```bash
npm run web:build && npm test     # tests dans un vrai navigateur (Playwright)
cd tests && npm run analyse       # analyse du code (ESLint : variables inconnues, règles React…)
```

Les tests démarrent un Venus jetable avec de petites vidéos, de la musique et des photos générées par ffmpeg, puis vérifient chaque page sur **ordinateur**, **téléphone** et **télévision** (navigation aux flèches) : connexion et code PIN, lecture, épisode suivant, mini-lecteur, recherche, musique, réglages… Une page qui lève une erreur JavaScript fait échouer son test.

Sur GitHub, deux workflows tournent automatiquement :

| Workflow | Quand | Contenu |
|---|---|---|
| [`tests.yml`](../.github/workflows/tests.yml) | à chaque envoi | Analyse du code, tests Playwright, construction et démarrage de l'image Docker |
| [`security.yml`](../.github/workflows/security.yml) | à chaque envoi sur `main`, à chaque *pull request* et chaque lundi | Contrôle de sécurité et audit des dépendances |

---

## 8. Image Docker

Le [`Dockerfile`](../Dockerfile) construit en plusieurs étapes :

1. **interface classique allégée** (JS et CSS minifiés) ;
2. **interface Next.js** construite en serveur autonome léger (`web-dist`) ;
3. **whisper.cpp** compilé (sous-titres générés hors ligne ; l'image se construit même si cette étape échoue) ;
4. **image finale** Node.js 24 sur Debian 13 avec un ffmpeg optimisé (accélération matérielle, tone-mapping HDR), les outils SMB / NFS et `fpcalc`.

---

## 9. Contribuer

1. Créez une branche depuis `main`.
2. Commentez le code en français, dans le style existant (un en-tête par fichier, une phrase par fonction).
3. Lancez `npm run web:build && npm test` et `npm run security`.
4. Ouvrez une *pull request* en décrivant le changement.
