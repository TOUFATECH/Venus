# Venus

Votre cinéma personnel : un serveur multimédia léger, auto-hébergé, avec une interface façon Netflix / Apple TV qui se pilote au doigt, à la souris ou à la télécommande.

- **Zéro dépendance** côté serveur : Node.js + ffmpeg, rien d’autre. Démarre en quelques secondes, environ 70 Mo de RAM au repos.
- **Linux, Windows, Mac, Docker et Proxmox** : une commande d'installation pour chacun.
- **S'adapte au matériel tout seul** : NVIDIA (NVENC), Intel (Quick Sync / VA-API), AMD (VA-API, AMF sous Windows), Raspberry Pi, puce Apple (VideoToolbox), sinon processeur. Chaque option est réellement testée au démarrage, et si une conversion échoue, Venus bascule automatiquement sur la suivante.
- **Lecture intelligente** : lecture directe quand l'appareil sait lire le fichier (0 % de CPU), simple « remux » quand seul le conteneur ou l'audio pose problème, conversion matérielle sinon. La conversion se met en pause quand elle a assez d'avance : pas de film entier converti pour rien.
- **Profils** avec code PIN, **contrôle parental** par âge, langue audio et sous-titres préférées par profil.
- **Séries** : saisons, « Reprendre la lecture », épisode suivant automatique avec compte à rebours.
- **Sous-titres** SRT / ASS / VTT, intégrés ou externes (`Film.fr.srt`, `Film.forced.fr.srt`), encodage Windows détecté. Les sous-titres image (PGS Blu-ray) sont incrustés à la volée.
- **TV** : navigation complète aux flèches de la télécommande (Android TV, Fire TV, Samsung, LG…).
- **Chromecast** et **AirPlay**, contrôles sur l'écran verrouillé du téléphone, application installable (PWA).
- **Affiches et résumés en français** via TMDB (gratuit), ou vos propres `poster.jpg` / `fanart.jpg`.

## Notes, nouveautés, Seerr, thèmes

- **Notes des sites** sur chaque fiche, et tri par note : TMDB, IMDb, Rotten Tomatoes, Metacritic (clé gratuite [OMDb](https://www.omdbapi.com/apikey.aspx)), AniList et MyAnimeList (sans clé), Simkl (identifiant gratuit). SensCritique n'a pas d'API publique : un lien vers sa page est proposé. Clés à coller dans **Réglages → Notes des sites**.
- **Nouveautés** : films au cinéma et à venir, séries de la semaine, animés de la saison (TMDB et AniList), avec une grande affiche qui suit le titre survolé et sa bande-annonce.
- **Seerr** (Overseerr / Jellyseerr) : **Réglages → Seerr**. Le plus simple : l'adresse de Seerr et un compte administrateur Seerr (e-mail, ou compte Jellyfin / Emby) ; Venus récupère la clé API tout seul, le mot de passe n'est pas gardé. On peut aussi coller la clé API.
  - **Mes envies** : le ♡ des Nouveautés ajoute un film, une série ou un animé (sorti ou à venir) à « Ma liste → Mes envies ». Il est demandé à Seerr aussitôt : Radarr / Sonarr le téléchargent dès sa sortie, puis il passe tout seul dans « Ma liste ».
  - **Séries suivies** : chaque nouvelle saison annoncée des séries de « Ma liste » (ou de toute la médiathèque, au choix) est demandée automatiquement. Vérification toutes les 6 heures, ou « Vérifier maintenant ».
  - **Au nom de chacun** : reliez chaque profil à son compte Seerr, ses demandes et sa liste de suivi Seerr sont à son nom. Les profils enfants ajoutent des envies, un adulte décide.
- **Bandes-annonces** au survol des affiches et dans le carrousel d'accueil (son activable), réglables dans **Réglages → Lecture sur cet appareil**.
- **TV en direct** : numéros de chaîne (ceux de la liste M3U, `tvg-chno`, sinon dans l'ordre), saisie d'un numéro au clavier, à la télécommande ou au pavé numérique du téléphone, liste des chaînes à droite pendant la lecture (touche L).
- **Thèmes planètes** : Mercure, Vénus, Terre, Mars, Jupiter, Saturne, Uranus, Neptune, Pluton. Couleurs, nom et logo animé changent (**Réglages → Thème**).

## Ce que Netflix ne fait pas

- **Mode Ambiance** : la lumière du film déborde autour de l'image, comme une TV Ambilight, et toute l'interface prend la couleur du titre que vous survolez. Bouton dans le lecteur, ou touche A.
- **Que regarder ce soir ?** : trois questions (votre envie, votre temps, avec qui) et Venus propose trois idées argumentées, en tenant compte de ce que vous avez déjà vu, de l'heure de fin et de l'âge des enfants.
- **Séance à plusieurs** : regardez le même film au même moment, chacun chez soi. Pause, avance et retour sont partagés, avec réactions qui s'envolent sur l'image et discussion. Bouton « Ensemble » dans le lecteur, puis partagez le code de 4 lettres ou le QR code.
- **Votre téléphone devient la télécommande** : menu Télécommande sur la TV, scannez le QR code. Croix directionnelle, lecture, recherche au clavier du téléphone, et « Reprendre sur la TV » en un geste.

## Installation

Venus s'installe sur **Linux, Windows et Mac**, avec ou sans **Docker**. Une seule commande, puis ouvrez `http://ADRESSE-DE-LA-MACHINE:8096` et laissez-vous guider : prénom, mot de passe du foyer, c'est tout.

| Machine | Commande | Carte graphique utilisée |
|---|---|---|
| **Linux avec Docker** (NAS, mini-PC, VPS) | `git clone https://github.com/TOUFATECH/Venus.git && cd Venus && ./install.sh` | Intel / AMD / NVIDIA / Raspberry Pi, détectée seule |
| **Linux sans Docker** (Debian, Ubuntu, conteneur Proxmox…) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh \| sudo bash` | Intel / AMD / NVIDIA |
| **Windows 10 / 11** | Dans PowerShell : `irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 \| iex` | NVIDIA, Intel Quick Sync, AMD |
| **Mac** (puce Apple ou Intel) | `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh \| bash` | Puce Apple (VideoToolbox) |
| **Windows / Mac avec Docker Desktop** | voir plus bas | Processeur uniquement |

### Linux avec Docker

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
./install.sh
```

Le script demande le dossier de vos films et celui de vos séries (laissez vide si tout est sur un NAS), détecte votre carte graphique, puis démarre Venus. Sans Docker sur la machine, il propose de l'installer ou d'installer Venus directement. `./install.sh --docker` ou `./install.sh --native` forcent un mode.

Mise à jour : `cd Venus && git pull && ./install.sh --docker`

À la main : modifiez les chemins dans `docker-compose.yml`, ajoutez votre GPU si besoin (voir `docker-compose.override.example.yml`), puis `docker compose up -d --build`.

### Linux sans Docker

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-native.sh | sudo bash
```

Installe Node.js (version officielle), ffmpeg de Jellyfin (toutes les accélérations matérielles), les outils SMB / NFS, puis un service `venus` qui démarre avec la machine. Code dans `/opt/venus`, réglages dans `/etc/venus/venus.env`, données dans `/var/lib/venus`.

- Mise à jour : relancez la même commande (vos réglages sont conservés)
- Journal : `journalctl -u venus -f`
- Désinstaller : `sudo bash /opt/venus/scripts/install-native.sh uninstall`

### Windows

Ouvrez **PowerShell** (menu Démarrer → tapez PowerShell) et collez :

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex
```

Windows demande l'autorisation administrateur, puis le script télécharge Node.js et ffmpeg (versions portables, rien d'autre n'est modifié sur le PC), demande vos dossiers de vidéos, ouvre le port 8096 dans le pare-feu pour le réseau privé, et lance Venus **au démarrage du PC, même sans session ouverte**. Tout est rangé dans `C:\ProgramData\Venus`.

- Mise à jour : relancez la même commande
- Journal : `C:\ProgramData\Venus\venus.log`
- Réglages : `C:\ProgramData\Venus\venus.conf`, puis relancez la commande
- Désinstaller : `$env:VENUS_ACTION='uninstall'; irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex`

Si la TV ou le téléphone ne voient pas Venus, vérifiez que votre Wi-Fi est en profil **Privé** (Paramètres → Réseau et Internet). Les partages réseau (NAS, autre PC) s'ajoutent dans Venus avec leur adresse `\\NAS\Videos`.

### Mac

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-macos.sh | bash
```

Nécessite [Homebrew](https://brew.sh). Installe Node.js et ffmpeg, puis lance Venus à chaque ouverture de session. La conversion vidéo utilise la puce du Mac (VideoToolbox). Données dans `~/Library/Application Support/Venus`, journal dans `~/Library/Logs/Venus.log`.

- Mise à jour : relancez la même commande
- Désinstaller : `bash ~/Library/Application\ Support/Venus/app/scripts/install-macos.sh uninstall`
- Vidéos sur un disque externe ou dans Documents : Réglages Système → Confidentialité et sécurité → Accès complet au disque → ajoutez `node` (le chemin est affiché à la fin de l'installation).

### Windows ou Mac avec Docker Desktop

```bash
git clone https://github.com/TOUFATECH/Venus.git
cd Venus
cp .env.example .env        # puis indiquez vos dossiers dans .env (Windows : C:/Users/Moi/Videos)
docker compose -f docker-compose.desktop.yml up -d --build
```

Docker Desktop fait tourner Venus dans une machine virtuelle : la carte graphique n'est pas accessible (conversion au processeur) et les NAS ne sont trouvés automatiquement que si `LAN_SUBNET` est renseigné dans `.env`. Pour profiter de la carte graphique, préférez l'installation sans Docker ci-dessus. Sur Mac, `./install.sh --docker` fait tout cela pour vous.

### Proxmox (conteneur LXC)

Venus fonctionne très bien dans un conteneur LXC Debian ou Ubuntu, avec la méthode « Linux sans Docker » (la plus légère) ou « Linux avec Docker ». Deux réglages se font **sur l'hôte Proxmox** (shell du nœud, pas celui du conteneur), avec le script fourni. Remplacez `7700` par le numéro de votre conteneur :

```bash
# Carte graphique Intel / AMD → conversion vidéo accélérée
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) gpu 7700

# Partage NAS / PC Windows → monté sur l'hôte puis transmis au conteneur
bash <(curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/proxmox-host.sh) nas 7700
```

- `gpu` transmet `/dev/dri/renderD128` au conteneur avec les bons droits (Proxmox 8.1 et plus : `devN` ; versions antérieures : règles `lxc.cgroup2`). Avec Docker dans le conteneur, relancez ensuite `./install.sh --docker` dans le conteneur pour donner la carte à Venus.
- `nas` est nécessaire pour un conteneur **non privilégié** (le cas par défaut) : Proxmox lui interdit de monter lui-même un partage réseau. Le script monte le partage sur l'hôte (`/etc/fstab`, remonté au démarrage), le transmet au conteneur dans `/media/<nom>`, et il suffit de l'ajouter dans Venus comme « Dossier de ce serveur ».
- Conteneur **privilégié** : `… proxmox-host.sh mount 7700` autorise le conteneur à monter lui-même les partages, et l'assistant « Partage réseau » de Venus fonctionne directement.

Venus détecte tout seul qu'il tourne dans un LXC et affiche ces commandes dans **Réglages** quand la carte graphique ou les partages ne sont pas accessibles.

## Vidéos sur le réseau (NAS, PC Windows)

Inutile de copier vos vidéos sur le serveur : **Réglages → Bibliothèques → Ajouter un emplacement → Partage réseau**.

1. Venus cherche les appareils qui partagent des fichiers sur votre réseau (SMB et NFS). Si le vôtre n'apparaît pas, saisissez son adresse (`192.168.1.20`, `nas.local`).
2. Entrez l'identifiant et le mot de passe du partage (ou laissez vide pour un accès invité) et choisissez le partage.
3. Indiquez si besoin le sous-dossier (`Films/HD`), et c'est tout.

Venus monte le partage lui-même, le remonte automatiquement après une coupure ou un redémarrage, et vérifie les nouveautés toutes les 10 minutes. Si un partage devient injoignable, la bibliothèque est conservée telle quelle (rien n'est effacé) et un bouton « Reconnecter » apparaît.

Venus monte les partages avec `mount.cifs` / `mount -t nfs` sur Linux, `net use` sur Windows et `mount_smbfs` sur Mac. Avec Docker, le conteneur a besoin des lignes `cap_add: SYS_ADMIN` et `network_mode: host` déjà présentes dans le `docker-compose.yml` fourni. Dans un conteneur Proxmox non privilégié, voir la section Proxmox ci-dessus. Les mots de passe des partages sont stockés dans le dossier de données de Venus (`net/`), lisibles uniquement par Venus.

**IPTV** : même menu, type « TV en direct », puis « Identifiants Xtream » (serveur, identifiant, mot de passe de votre abonnement) ou « Adresse M3U ».

## Ajouter des films, séries, animés et clips

Trois façons, au choix :

1. **Depuis l'application** : menu **Ajouter** (administrateur). Choisissez la bibliothèque, le nom de la série et la saison si besoin, puis déposez les fichiers. Une barre de progression indique la vitesse et le temps restant.
2. **En copiant dans les dossiers** (partage réseau, NAS, clé USB) : Venus surveille les dossiers et ajoute chaque nouveau fichier tout seul en quelques secondes. Une notification « Nouveau dans Venus » s'affiche sur tous les écrans ouverts, et l'accueil se met à jour sans recharger.
3. **Réglages → Bibliothèques** : ajoutez un dossier par type (Films, Séries, Animés, Clips) ou une liste IPTV. Les derniers médias détectés y sont listés.

Pour l'envoi depuis l'application, les dossiers doivent être accessibles en écriture : avec Docker, n'ajoutez pas `:ro` aux volumes de vos médias (c'est le réglage par défaut du `docker-compose.yml` fourni). Sur un partage réseau sans détection des changements, Venus revérifie à intervalle régulier (réglable).

## Sources

Dans **Réglages → Bibliothèques → Ajouter un emplacement**, choisissez le type :

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
| `DATA_DIR` | `/config` (Docker), `./data` | Base de données, affiches, cache |
| `TRANSCODE_DIR` | `/transcode` (Docker) | Fichiers temporaires de conversion (son contenu est vidé au démarrage ; le dossier peut être un point de montage) |
| `MOVIES_PATH` / `SHOWS_PATH` / `ANIME_PATH` / `CLIPS_PATH` | `/media/films`, `/media/series`… | Dossiers proposés à l'installation |
| `TMDB_API_KEY` | — | Clé TMDB (sinon saisissable dans l'interface) |
| `HWACCEL` | `auto` | Forcer `nvenc`, `vaapi`, `qsv`, `amf` (Windows), `videotoolbox` (Mac), `v4l2m2m` ou `none` |
| `LAN_SUBNET` | — | Réseau à explorer pour trouver les NAS (ex. `192.168.1`), utile avec Docker Desktop |
| `FFMPEG_PATH` / `FFPROBE_PATH` | auto | Chemins de ffmpeg |

## Architecture

```
server/
  index.js      serveur HTTP, démarrage
  api.js        routes de l'API
  stream.js     décision de lecture, sessions HLS, sous-titres WebVTT, vignettes
  hw.js         détection et pipelines d'accélération matérielle
  scanner.js    analyse des bibliothèques, surveillance des dossiers
  netshare.js   partages réseau SMB / NFS (Linux, Windows, Mac), recherche des NAS, Xtream
  env.js        détection Docker / LXC Proxmox / machine, conseils GPU et montage
  together.js   séances à plusieurs et téléphone-télécommande
  metadata.js   TMDB : affiches, résumés, classifications d'âge
  parse.js      nettoyage des noms de fichiers
  probe.js      ffprobe, sous-titres externes
  auth.js, db.js, http.js, config.js
scripts/        installateurs Linux, Windows, Mac et outil hôte Proxmox
public/         interface (JavaScript natif, sans framework ni compilation)
```

## Honnêtement, par rapport à Plex et Jellyfin

Venus fait mieux sur la légèreté, la simplicité d'installation et la sobriété de l'interface. Plex et Jellyfin restent plus complets sur certains points qui ne sont pas (encore) dans cette version : applications natives dans les stores des TV, guide des programmes (EPG) pour l'IPTV, musique et photos, téléchargement hors-ligne, vignettes d'aperçu sur la barre de progression, saut automatique du générique de début, plugins.
