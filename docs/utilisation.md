# Guide d'utilisation

[← Retour au README](../README.md) · [Thèmes](themes.md) · [Configuration](configuration.md) · [Dépannage](depannage.md)

---

## Sommaire

1. [Premier démarrage](#1-premier-démarrage)
2. [Ajouter ses vidéos](#2-ajouter-ses-vidéos)
3. [Ranger ses fichiers](#3-ranger-ses-fichiers)
4. [Profils, comptes et famille](#4-profils-comptes-et-famille)
5. [Naviguer](#5-naviguer)
6. [Regarder](#6-regarder)
7. [TV en direct](#7-tv-en-direct)
8. [Musique, livres et photos](#8-musique-livres-et-photos)
9. [Demander des titres et suivre les sorties](#9-demander-des-titres-et-suivre-les-sorties)
10. [Sur chaque écran](#10-sur-chaque-écran)
11. [Notifications](#11-notifications)
12. [Administration](#12-administration)
13. [Raccourcis clavier](#13-raccourcis-clavier)

---

## 1. Premier démarrage

1. Ouvrez `http://ADRESSE-DE-LA-MACHINE:8096`.
2. L'assistant demande votre **prénom** (premier profil, administrateur) et le **mot de passe du foyer**.
3. Choisissez les dossiers de vidéos proposés (ceux montés à l'installation) ou ajoutez-en d'autres.
4. Venus analyse les fichiers, récupère affiches et résumés en français, puis l'accueil se remplit.

> Une clé [TMDB](https://www.themoviedb.org/settings/api) (gratuite) améliore les fiches, mais Venus trouve les affiches même sans clé.

---

## 2. Ajouter ses vidéos

**Réglages → Médiathèques → Ajouter un emplacement**

| Type d'emplacement | Usage |
|---|---|
| **Dossier** | Dossier présent sur la machine (ou monté dans le conteneur Docker) |
| **Partage réseau** | NAS ou PC Windows en SMB / NFS : Venus trouve les appareils, monte le partage, le remonte après une coupure et vérifie les nouveautés toutes les 10 minutes |
| **TV en direct** | Identifiants Xtream ou adresse d'une liste M3U |

Chaque bibliothèque a un type : **Films, Séries, Animés, Clips, Musique, Photos, Livres**. Un nouveau fichier copié dans un dossier surveillé apparaît en quelques secondes.

Si un partage devient injoignable, rien n'est effacé : un bouton « Reconnecter » apparaît.

---

## 3. Ranger ses fichiers

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

- Les noms « sales » (`Film.2019.MULTI.VFF.1080p.BluRay.x264-GRP.mkv`) sont nettoyés automatiquement.
- Les sous-titres externes (`.srt`, `.ass`, `.vtt`) placés à côté de la vidéo sont détectés.
- Les fichiers `.nfo` et les images rangées à côté des vidéos (`poster.jpg`, `season01-poster.jpg`…) sont pris en compte.
- Un titre mal reconnu se corrige depuis sa fiche : **⋯ → Identifier**.
- **Réglages → Médiathèques** propose aussi un renommage propre des fichiers identifiés, la recherche de doublons et une corbeille de 7 jours.

---

## 4. Profils, comptes et famille

| Fonction | Où |
|---|---|
| Créer un profil, code PIN, langues préférées | Réglages → **Profils et appareils** |
| Profil enfant (âge maximum, horaires, temps d'écran, menu simplifié) | Réglages → Profils et appareils → profil → Enfant |
| Comptes locaux et **invitations par e-mail** (lien valable 7 jours) | Réglages → Profils et appareils |
| Droits par profil (bibliothèques visibles, téléchargement, conversion) | Réglages → Profils et appareils → Droits |
| Appareils connectés, déconnexion à distance | Tableau de bord → Sécurité → Appareils |

**Ensemble** :

- **Séance** : regarder la même vidéo en même temps, chacun sur son écran.
- **Vote en famille** : chacun vote, Venus propose le film gagnant.
- **Ce soir** : cochez les personnes présentes, Venus propose ce que personne n'a vu, adapté au plus jeune.
- **Télécommande** : scannez le QR code avec un téléphone pour piloter la TV.

---

## 5. Naviguer

Le menu contient : **Accueil, Films, Séries, Animés, Clips, Nouveau, Ce soir, Nouveautés, TV, Musique, Photos, Livres, Ma liste, Collections, Recherche**, et les outils **Séance, Télécommande, Statistiques, Téléchargements, Tableau de bord**.

- L'ordre et les éléments affichés se règlent dans **Réglages → Thème et menu** (par profil et par appareil).
- **Filtres** : genres, années, note, classification, qualité (4K, HDR), studios, « VF disponible ».
- **Recherche** en langage naturel : « un film drôle de moins d'1 h 30 des années 90 », acteurs, genres, et même des **répliques** de dialogues.
- **Commande vocale** en français : « Mets One Piece », « Chaîne 12 ».
- **Manette de jeu** et **télécommande de TV** : navigation complète aux flèches.

---

## 6. Regarder

**Lecture** : Venus choisit seul la meilleure méthode — lecture directe, « remux » (changement de conteneur sans perte) ou conversion matérielle. Le choix de la qualité se fait dans le lecteur (**Auto** par défaut).

**Dans le lecteur**

| Fonction | Détail |
|---|---|
| Sous-titres | Intégrés ou externes, recherche en ligne, taille / couleur / fond réglables, décalage |
| Sous-titres générés | Pour une vidéo sans sous-titres : reconnaissance vocale hors ligne puis traduction en français |
| Audio | Choix de la piste, **mode nuit** (son égalisé) |
| Chapitres | Ceux du fichier, ou générés automatiquement |
| Barre de progression | Vignette d'aperçu au survol |
| Fiche à la pause | Temps restant, heure de fin, acteurs de la scène, dernière réplique |
| Image dans l'image, mini-lecteur | La lecture continue pendant la navigation |
| Partager un extrait | GIF ou MP4, meilleurs moments proposés |
| Diffuser | Chromecast (HTTPS nécessaire), AirPlay |

**Séries** : « Reprendre », épisode suivant avec compte à rebours, saut du générique, « Toujours là ? », minuterie de sommeil, résumé « Précédemment dans… », mode **anti-spoiler**.

**Hors ligne** : téléchargez une vidéo depuis sa fiche pour la regarder sans réseau (page **Téléchargements**).

---

## 7. TV en direct

1. Réglages → **TV en direct** (ou Médiathèques → Ajouter → TV en direct).
2. Saisissez vos identifiants **Xtream** ou l'adresse de votre liste **M3U**.
3. Le guide des programmes (XMLTV) est trouvé dans la liste ou ajouté à la main.

Ensuite : chaînes rangées par catégorie, numéros de chaîne, favoris (export / import M3U), zapping instantané, **multi-écran** (2 ou 4 chaînes), rappels de programmes et **enregistrements** (une émission, toutes les diffusions d'une série, ou un créneau libre).

---

## 8. Musique, livres et photos

| Bibliothèque | Fonctions |
|---|---|
| **Musique** | Albums, artistes, titres, paroles synchronisées, reconnaissance des albums (MusicBrainz) et des fichiers sans étiquette (empreinte sonore), discographie complète avec ce qui manque |
| **Livres** | EPUB, PDF, BD, livres audio, liseuse intégrée, fiches complétées automatiquement, bibliographie de chaque auteur |
| **Photos** | Albums, diaporama, HEIC |

---

## 9. Demander des titres et suivre les sorties

- **Nouveautés** : sorties et épisodes jour par jour, **Disponible** ou **Pas disponible** sur le NAS. Calendrier à s'abonner (iCal).
- **Nouveau** : cherchez un film ou une série et cliquez « Ajouter » : le titre est envoyé à votre gestionnaire de téléchargement.
- **Ma liste** : le ♡ garde un titre pour plus tard et peut lancer son téléchargement.

Services à relier dans **Réglages → Demandes** : Seerr, Radarr (films), Sonarr (séries et animés), Lidarr (musique), LazyLibrarian ou Bookshelf (livres). Voir [Configuration](configuration.md#services-externes).

---

## 10. Sur chaque écran

| Appareil | Comment |
|---|---|
| Téléphone, tablette | Ouvrez l'adresse, puis « Installer Venus » (iPhone : Partager → Sur l'écran d'accueil) |
| Ordinateur | Navigateur, ou icône « Installer » dans la barre d'adresse |
| Android TV, Fire TV, Google TV, Samsung, LG | Navigateur de la TV, navigation complète à la télécommande |
| Chromecast | Bouton de diffusion dans le lecteur (HTTPS nécessaire) |
| Apple TV | AirPlay depuis l'iPhone, l'iPad ou le Mac |

---

## 11. Notifications

**Réglages → Notifications** : Web Push (navigateur et téléphone), ntfy, Discord et **Telegram** (une fiche par nouveauté avec affiche et résumé, « en cours de téléchargement » puis « disponible »). Les administrateurs reçoivent aussi les alertes de sécurité et de mise à jour.

---

## 12. Administration

Réservée aux profils administrateurs (protégés par code PIN).

| Page | Contenu |
|---|---|
| **Tableau de bord** | Lectures en cours, appareils, tâches planifiées, journal, santé du NAS, performances |
| **Tableau de bord → Sécurité** | Audit, double authentification, HTTPS, adresses bloquées, journal de sécurité |
| **Tableau de bord → Serveur** | Tâches planifiées, journal du serveur, clés API, webhooks, CSS personnalisé, message d'accueil |
| **Statistiques** | Heures de visionnage, genres et séries préférés, rétrospective de l'année |
| **Qualité** | Répartition 4K / HDR / débits, fichiers à recompresser |
| **Réglages → Performances** | Copies optimisées, compression des vidéos, conversions en mémoire |
| **Réglages → Sauvegardes** | Sauvegardes nocturnes, second emplacement, restauration |
| **Réglages → Mise à jour** | Vérification, nouveautés, mise à jour en un clic |

---

## 13. Raccourcis clavier

Dans le lecteur :

| Touche | Action |
|---|---|
| `Espace` / `K` | Lecture / pause |
| `←` / `→` | Reculer / avancer de 10 secondes |
| `↑` / `↓` | Volume |
| `F` | Plein écran |
| `M` | Couper le son |
| `N` | Épisode suivant |
| `S` | Passer le générique / le résumé |
| `[` / `]` | Chapitre précédent / suivant |
| `<` / `>` | Ralentir / accélérer |
| `G` / `H` | Décaler les sous-titres (−0,1 s / +0,1 s) |
| `Z` | Changer le cadrage de l'image |
| `A` | Halo lumineux autour de l'image |
| `L` | Liste des chaînes (TV en direct) |
| `Page ↑` / `Page ↓` | Chaîne précédente / suivante |
| `Échap` | Quitter le lecteur |

Partout : `Ctrl` + `K` ouvre la recherche rapide (titres, chaînes, personnes, pages, réglages).
