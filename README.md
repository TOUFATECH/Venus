# Venus

Votre cinéma personnel : un serveur multimédia léger, auto-hébergé, avec une interface façon Netflix / Apple TV qui se pilote au doigt, à la souris ou à la télécommande.

- **Zéro dépendance** côté serveur : Node.js + ffmpeg, rien d’autre. Démarre en quelques secondes, environ 70 Mo de RAM au repos.
- **S'adapte au matériel tout seul** : NVIDIA (NVENC), Intel (Quick Sync / VA-API), AMD (VA-API), Raspberry Pi, Mac, sinon processeur. Chaque option est réellement testée au démarrage, et si une conversion échoue, Venus bascule automatiquement sur la suivante.
- **Lecture intelligente** : lecture directe quand l'appareil sait lire le fichier (0 % de CPU), simple « remux » quand seul le conteneur ou l'audio pose problème, conversion matérielle sinon. La conversion se met en pause quand elle a assez d'avance : pas de film entier converti pour rien.
- **Profils** avec code PIN, **contrôle parental** par âge, langue audio et sous-titres préférées par profil.
- **Séries** : saisons, « Reprendre la lecture », épisode suivant automatique avec compte à rebours.
- **Sous-titres** SRT / ASS / VTT, intégrés ou externes (`Film.fr.srt`, `Film.forced.fr.srt`), encodage Windows détecté. Les sous-titres image (PGS Blu-ray) sont incrustés à la volée.
- **TV** : navigation complète aux flèches de la télécommande (Android TV, Fire TV, Samsung, LG…).
- **Chromecast** et **AirPlay**, contrôles sur l'écran verrouillé du téléphone, application installable (PWA).
- **Affiches et résumés en français** via TMDB (gratuit), ou vos propres `poster.jpg` / `fanart.jpg`.

## Ce que Netflix ne fait pas

- **Mode Ambiance** : la lumière du film déborde autour de l'image, comme une TV Ambilight, et toute l'interface prend la couleur du titre que vous survolez. Bouton dans le lecteur, ou touche A.
- **Que regarder ce soir ?** : trois questions (votre envie, votre temps, avec qui) et Venus propose trois idées argumentées, en tenant compte de ce que vous avez déjà vu, de l'heure de fin et de l'âge des enfants.
- **Séance à plusieurs** : regardez le même film au même moment, chacun chez soi. Pause, avance et retour sont partagés, avec réactions qui s'envolent sur l'image et discussion. Bouton « Ensemble » dans le lecteur, puis partagez le code de 4 lettres ou le QR code.
- **Votre téléphone devient la télécommande** : menu Télécommande sur la TV, scannez le QR code. Croix directionnelle, lecture, recherche au clavier du téléphone, et « Reprendre sur la TV » en un geste.

## Installation sur votre serveur

Sur votre serveur Linux (NAS, mini-PC, VPS) avec Docker installé :

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
./install.sh
```

Le script vous demande le dossier de vos films et celui de vos séries (vous pouvez laisser vide si tout est sur un NAS), détecte votre carte graphique, puis démarre Venus. Ouvrez ensuite `http://IP-DU-SERVEUR:8096` et laissez-vous guider : prénom, mot de passe du foyer, c'est tout.

Mettre à jour plus tard :

```bash
cd Venus && git pull && docker compose up -d --build
```

À la main : modifiez les chemins dans `docker-compose.yml`, ajoutez votre GPU si besoin (voir `docker-compose.override.example.yml`), puis `docker compose up -d --build`.

## Vidéos sur le réseau (NAS, PC Windows)

Inutile de copier vos vidéos sur le serveur : **Réglages → Bibliothèques → Ajouter un emplacement → Partage réseau**.

1. Venus cherche les appareils qui partagent des fichiers sur votre réseau (SMB et NFS). Si le vôtre n'apparaît pas, saisissez son adresse (`192.168.1.20`, `nas.local`).
2. Entrez l'identifiant et le mot de passe du partage (ou laissez vide pour un accès invité) et choisissez le partage.
3. Indiquez si besoin le sous-dossier (`Films/HD`), et c'est tout.

Venus monte le partage lui-même, le remonte automatiquement après une coupure ou un redémarrage, et vérifie les nouveautés toutes les 10 minutes. Si un partage devient injoignable, la bibliothèque est conservée telle quelle (rien n'est effacé) et un bouton « Reconnecter » apparaît.

Pour cela, le conteneur a besoin des lignes `cap_add: SYS_ADMIN` et `network_mode: host` déjà présentes dans le `docker-compose.yml` fourni. Les mots de passe des partages sont stockés dans `config/net/`, lisibles uniquement par Venus.

**IPTV** : même menu, type « TV en direct », puis « Identifiants Xtream » (serveur, identifiant, mot de passe de votre abonnement) ou « Adresse M3U ».

### Sans Docker

Node.js 22.13 ou plus récent et ffmpeg installés :

```bash
MOVIES_PATH=/chemin/Films SHOWS_PATH=/chemin/Series npm start
```

## Ajouter des films, séries, animés et clips

Trois façons, au choix :

1. **Depuis l'application** : menu **Ajouter** (administrateur). Choisissez la bibliothèque, le nom de la série et la saison si besoin, puis déposez les fichiers. Une barre de progression indique la vitesse et le temps restant.
2. **En copiant dans les dossiers** (partage réseau, NAS, clé USB) : Venus surveille les dossiers et ajoute chaque nouveau fichier tout seul en quelques secondes. Une notification « Nouveau dans Venus » s'affiche sur tous les écrans ouverts, et l'accueil se met à jour sans recharger.
3. **Réglages → Bibliothèques** : ajoutez un dossier par type (Films, Séries, Animés, Clips) ou une liste IPTV. Les derniers médias détectés y sont listés.

Pour l'envoi depuis l'application, les dossiers doivent être accessibles en écriture : avec Docker, n'ajoutez pas `:ro` aux volumes de vos médias (c'est le réglage par défaut du `docker-compose.yml` fourni). Sur un partage réseau sans détection des changements, Venus revérifie à intervalle régulier (réglable).

## Sources

Dans **Réglages → Sources → Ajouter une source**, choisissez le type :

| Source | Contenu | Comment ranger |
|---|---|---|
| Films | Films | Un fichier par film, ou un dossier par film |
| Séries | Séries TV | Un dossier par série, un sous-dossier par saison, `S01E01` dans le nom |
| Animés | Animés | Comme les séries |
| Clips | Clips musicaux, vidéos courtes | Nom conseillé : `Artiste - Titre.mp4` |
| TV en direct | Chaînes IPTV | Collez l'adresse M3U de votre abonnement, ou le chemin d'un fichier `.m3u` |

L'accueil affiche **Reprendre la lecture** (là où vous vous êtes arrêté), **Nouveaux épisodes** (sortis ces 60 derniers jours d'après TMDB, sinon ajoutés récemment), **Nouveaux films**, **Derniers ajouts**, **Populaires**, **Au hasard**, puis une rangée par source.
Chaque page de source se filtre par **Non vus / En cours / Déjà vus** et se trie par **date d'ajout, date de sortie**, titre, note ou popularité. Sur la fiche d'une série, les épisodes se filtrent aussi par vus / non vus.

TV en direct : la page TV montre un aperçu en direct (muet) de la chaîne sélectionnée et l'image actuelle de chaque chaîne, rafraîchie toutes les 2 minutes. La vidéo est relayée telle quelle quand c'est possible (H.264), sinon convertie. Touches P+ / P- de la télécommande pour zapper. Les chaînes qui ne répondent pas affichent un message clair au lieu de tourner dans le vide.

## Ranger ses vidéos

```
Films/
  Inception (2010).mkv
  Interstellar (2014)/
    Interstellar.2014.MULTI.1080p.mkv
    Interstellar.2014.MULTI.1080p.fr.srt
    poster.jpg            (facultatif)
Series/
  Breaking Bad/
    Saison 1/
      Breaking.Bad.S01E01.mkv
      Breaking.Bad.S01E02.mkv
```

Les noms « sales » (`Film.2019.MULTI.VFF.1080p.BluRay.x264-GRP.mkv`) sont nettoyés automatiquement. Les nouveaux fichiers apparaissent tout seuls en quelques secondes ; un scan complet tourne aussi toutes les heures. Si un titre est mal reconnu : fiche du titre → **Corriger l'identification**.

## Sur chaque écran

| Appareil | Comment |
|---|---|
| Téléphone, tablette | Ouvrez l'adresse, puis « Ajouter à l'écran d'accueil » |
| Ordinateur | Navigateur, ou icône « Installer » dans la barre d'adresse |
| Android TV, Fire TV, Google TV | Navigateur de la TV (ex. TV Bro), télécommande prise en charge |
| Samsung (Tizen), LG (webOS) | Navigateur intégré à la TV |
| Chromecast | Bouton de diffusion dans le lecteur (nécessite HTTPS, voir plus bas) |
| Apple TV | AirPlay depuis l'iPhone, l'iPad ou le Mac |

Raccourcis du lecteur : flèches ← → (10 s), espace (pause), F (plein écran), Retour (quitter). Sur mobile : toucher deux fois à gauche ou à droite pour reculer ou avancer.

## Accès depuis l'extérieur et Chromecast (HTTPS)

Le Chromecast et l'installation de l'application exigent une adresse HTTPS. Le plus simple est Caddy, qui obtient le certificat tout seul :

```
# Caddyfile
cinema.mondomaine.fr {
  reverse_proxy 127.0.0.1:8096
}
```

Hors de chez vous, baissez la qualité dans le lecteur (720p ou 480p) si votre connexion montante est limitée.

## Variables d'environnement

| Variable | Par défaut | Rôle |
|---|---|---|
| `PORT` | `8096` | Port HTTP |
| `DATA_DIR` | `/config` | Base de données, affiches, cache |
| `TRANSCODE_DIR` | `/transcode` | Fichiers temporaires de conversion (vidé au démarrage) |
| `MOVIES_PATH` / `SHOWS_PATH` | `/media/films` / `/media/series` | Dossiers proposés à l'installation |
| `TMDB_API_KEY` | — | Clé TMDB (sinon saisissable dans l'interface) |
| `HWACCEL` | `auto` | Forcer `nvenc`, `vaapi`, `qsv`, `v4l2m2m` ou `none` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | auto | Chemins de ffmpeg |

## Architecture

```
server/
  index.js      serveur HTTP, démarrage
  api.js        routes de l'API
  stream.js     décision de lecture, sessions HLS, sous-titres WebVTT, vignettes
  hw.js         détection et pipelines d'accélération matérielle
  scanner.js    analyse des bibliothèques, surveillance des dossiers
  metadata.js   TMDB : affiches, résumés, classifications d'âge
  parse.js      nettoyage des noms de fichiers
  probe.js      ffprobe, sous-titres externes
  auth.js, db.js, http.js, config.js
public/         interface (JavaScript natif, sans framework ni compilation)
```

## Honnêtement, par rapport à Plex et Jellyfin

Venus fait mieux sur la légèreté, la simplicité d'installation et la sobriété de l'interface. Plex et Jellyfin restent plus complets sur certains points qui ne sont pas (encore) dans cette version : applications natives dans les stores des TV, guide des programmes (EPG) pour l'IPTV, musique et photos, téléchargement hors-ligne, vignettes d'aperçu sur la barre de progression, saut automatique du générique de début, synchronisation « regarder ensemble », plugins.
