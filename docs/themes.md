# Thèmes et mises en page

[← Retour au README](../README.md) · [Utilisation](utilisation.md) · [Configuration](configuration.md)

Chaque thème de Venus est une **planète** : elle change les couleurs, le logo (une planète dont la surface tourne) et la **mise en page** de tout le site. Le choix suit votre profil sur tous vos appareils.

**Où le régler** : Réglages → **Thème et menu**.

---

## Les 17 planètes

| Planète | Ambiance | Mise en page |
|---|---|---|
| **Venus** *(par défaut)* | Sable doré et cuivre, nuages | Rail |
| **Mercure** | Gris minéral, cratères | Grand menu |
| **Terre** | Bleu océan, continents | Dock |
| **Mars** | Rouge rouille, cratères | Streaming |
| **Jupiter** | Bandes ocre, grande tache | Grand menu |
| **Saturne** | Or pâle, anneaux | Grand menu |
| **Uranus** | Cyan glacé | Rail |
| **Neptune** | Bleu électrique | Dock |
| **Pluton** | Rose poudré, cœur | Rail |
| **Noir** | Noir pur, idéal pour les écrans OLED | TV |
| **Blanc** | Thème clair | Dock |
| **TV** | Fond noir, boutons blancs, contours lisibles de loin | TV |
| **Cinéma** | Anthracite et rouge vif, menu en haut | Streaming |
| **Verre** | Surfaces en verre dépoli, clair le jour et sombre la nuit | Verre |
| **Lagon** | Abysse, turquoise et corail | Lagon |
| **Océan** | Bleu profond, vagues animées | Lagon |
| **Sable** | Version claire de Lagon et Océan | Lagon |

---

## Les 7 mises en page

| Mise en page | Description | Idéale pour |
|---|---|---|
| **Rail** | Menu d'icônes à gauche | Ordinateur |
| **Grand menu** | Menu à gauche avec les noms en clair | Grandes médiathèques |
| **Dock** | Barre flottante en bas, contenu sur toute la largeur | Tablette, ordinateur |
| **Streaming** | Menu en haut, transparent puis plein au défilement, affiches aux coins nets | Ordinateur, TV |
| **TV** | Grands onglets centrés, gros textes et contours de sélection | Télévision et télécommande |
| **Verre** | Surfaces givrées, boutons en pilule, icônes rondes | Ordinateur, Mac, iPhone |
| **Lagon** | Barre en haut avec recherche, bloc « Ce soir » à l'accueil, infos sous les affiches, polices Outfit et Inter | Tous les écrans |

Sur téléphone, toutes les mises en page passent à des onglets en bas de l'écran.

---

## Clair ou sombre automatiquement

| Réglage | Effet |
|---|---|
| **Toujours la planète** | Le thème choisi en permanence |
| **Clair le jour, sombre le soir** | Thème clair (Blanc, ou Sable pour Lagon et Océan) entre le lever et le coucher du soleil, calculés sur l'appareil à partir du fuseau horaire (rien n'est envoyé) |
| **Selon l'appareil** | Suit le mode clair / sombre du téléphone ou de l'ordinateur |

Le thème **Verre** a ses propres choix : *au rythme du soleil*, *toujours clair* ou *toujours sombre*.

---

## Fluidité

Réglages → Thème et menu → **Fluidité** :

- **Effets complets** : tous les effets (flous, animations, planète qui tourne) ;
- **Mode léger** : sans flou ni animation lourde, pour les TV et appareils modestes ;
- **Automatique** : Venus choisit selon la puissance de l'appareil.

---

## Personnaliser le menu

Réglages → **Thème et menu** → Menu : choisissez l'ordre et les sections affichées (Accueil, Films, Séries, Animés, Clips, Nouveau, Ce soir, Nouveautés, TV, Musique, Photos, Livres, Ma liste, Collections, Recherche, Séance, Télécommande, Statistiques, Téléchargements, Tableau de bord). Le réglage est propre à chaque profil et à chaque appareil. « Aujourd'hui » devient automatiquement « Ce soir » à partir de 17 h.

---

## CSS personnalisé (administrateur)

Tableau de bord → **Serveur** → Personnalisation → **CSS personnalisé** : vos règles CSS s'appliquent à toutes les pages, sur tous les appareils. Videz le champ pour revenir à l'apparence d'origine.

```css
/* Exemple : affiches plus arrondies */
.card .shot { border-radius: 16px; }
```

Au même endroit : le **message d'accueil** affiché sur l'écran de connexion. Le **nom du serveur** se change dans Réglages → Serveur.
