# Déploiement et mise en ligne

[← Retour au README](../README.md) · [Docker](installation-docker.md) · [Configuration](configuration.md) · [Sécurité](../SECURITY.md)

Ce guide explique comment passer d'une installation locale à un Venus **fiable, accessible de l'extérieur en HTTPS, sauvegardé et à jour**.

---

## Sommaire

1. [Choisir où l'héberger](#1-choisir-où-lhéberger)
2. [Procédure de mise en production](#2-procédure-de-mise-en-production)
3. [Accès depuis l'extérieur](#3-accès-depuis-lextérieur)
4. [HTTPS](#4-https)
5. [Sauvegardes et restauration](#5-sauvegardes-et-restauration)
6. [Mises à jour](#6-mises-à-jour)
7. [Surveillance](#7-surveillance)
8. [Liste de contrôle finale](#8-liste-de-contrôle-finale)

---

## 1. Choisir où l'héberger

| Machine | Avantages | Points d'attention |
|---|---|---|
| **NAS** (Synology, QNAP, Unraid…) | Les vidéos sont déjà dessus | Processeur parfois faible : privilégiez un modèle Intel avec Quick Sync |
| **Mini-PC** (Intel N100, NUC…) | Silencieux, économe, Quick Sync très efficace | Vidéos sur un NAS : ajoutez le partage depuis l'interface |
| **Proxmox** (LXC) | Isolation, sauvegardes de l'hyperviseur | Voir [Proxmox](installation.md#proxmox-conteneur-lxc) |
| **VPS / serveur dédié** | Accessible partout, bonne connexion | Stockage coûteux, pas de carte graphique en général |
| **PC Windows / Mac** | Rien à acheter | Doit rester allumé |

---

## 2. Procédure de mise en production

```bash
# 1. Installer
sudo git clone https://github.com/TOUFATECH/Venus.git /opt/Venus
cd /opt/Venus && sudo ./install.sh

# 2. Vérifier que Venus répond
curl -I http://127.0.0.1:8096
docker compose logs --tail 50 venus
```

3. Ouvrez `http://ADRESSE:8096` et terminez l'assistant (prénom, mot de passe du foyer).
4. **Sécurisez le compte administrateur** (voir [SECURITY.md](../SECURITY.md#à-faire-après-linstallation)) :
   - code PIN sur chaque profil administrateur (Réglages → Profils) ;
   - mot de passe du foyer d'au moins 10 caractères ;
   - serveur d'e-mails puis **double authentification** (Tableau de bord → Sécurité).
5. Ajoutez vos bibliothèques (Réglages → **Médiathèques**) et laissez l'analyse se terminer.
6. Vérifiez **Tableau de bord → Sécurité** : chaque point « à corriger » indique la marche à suivre.
7. Mettez en place l'[accès extérieur](#3-accès-depuis-lextérieur) et les [sauvegardes](#5-sauvegardes-et-restauration).

---

## 3. Accès depuis l'extérieur

> N'ouvrez **jamais** le port 8096 directement sur votre box : passez toujours par HTTPS.

Le plus simple : **Réglages → Accès hors de la maison**. Trois options, sans ouvrir de port :

| Option | Adresse | Compte requis | Idéal pour |
|---|---|---|---|
| **Lien rapide** (tunnel Cloudflare) | `https://….trycloudflare.com`, change à chaque redémarrage | Aucun | Tester, dépanner |
| **Mon tunnel** (Cloudflare Zero Trust) | fixe, ex. `https://cinema.mondomaine.fr` | Cloudflare (gratuit) + un domaine | Usage quotidien, famille |
| **Tailscale** | adresse privée Tailscale | Tailscale (gratuit) | Accès privé, uniquement vos appareils |

**Mettre en place « Mon tunnel »**

1. Dans le tableau de bord Cloudflare : **Zero Trust → Réseaux → Tunnels → Créer un tunnel** (type *cloudflared*).
2. Ajoutez un nom d'hôte public, par exemple `cinema.mondomaine.fr`, qui pointe vers `http://localhost:8096`.
3. Copiez le **jeton** du tunnel (la longue suite de caractères après `--token`).
4. Collez-le dans Venus : Réglages → Accès hors de la maison → **Mon tunnel**.

Venus télécharge lui-même le programme officiel `cloudflared` et le relance s'il s'arrête. Les visites par tunnel sont toujours traitées comme venant d'Internet (protections renforcées).

---

## 4. HTTPS

### Caddy (certificat automatique, recommandé)

```
cinema.mondomaine.fr {
  reverse_proxy 127.0.0.1:8096
}
```

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul. Ouvrez les ports 80 et 443 de la box vers la machine de Caddy.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name cinema.mondomaine.fr;

    ssl_certificate     /etc/letsencrypt/live/cinema.mondomaine.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cinema.mondomaine.fr/privkey.pem;

    client_max_body_size 0;          # envois de fichiers (affiches, sous-titres, archives)
    proxy_buffering off;             # lecture vidéo fluide

    location / {
        proxy_pass http://127.0.0.1:8096;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Si le proxy est sur **une autre machine** du réseau, ajoutez `TRUST_PROXY=1` à Venus pour qu'il voie la vraie adresse des visiteurs.

### HTTPS intégré

Venus sert aussi HTTPS (HTTP/2) sur le port **8920** avec un certificat auto-signé créé au premier démarrage. Pour un vrai certificat : `TLS_CERT=/config/cert.pem` et `TLS_KEY=/config/key.pem`.

| `FORCE_HTTPS` | Comportement |
|---|---|
| `remote` (défaut) | Les visites venant d'Internet en `http://` sont redirigées vers HTTPS ; le réseau local reste en `http://` |
| `all` | Tout le monde est redirigé vers HTTPS |
| `off` | Aucune redirection |

> Le **Chromecast** exige HTTPS.

---

## 5. Sauvegardes et restauration

**Automatiques** : une sauvegarde de la base chaque nuit (les 10 dernières sont gardées) dans `/config/backups` (Docker). Une copie vers un second emplacement (NAS, disque externe) se règle dans **Réglages → Sauvegardes**, qui permet aussi de lancer une sauvegarde manuelle et de **restaurer**.

**À sauvegarder vous-même** :

| Élément | Pourquoi |
|---|---|
| `config/secret.key` | Clé de chiffrement des clés d'API et mots de passe des services. **Elle n'est pas dans les sauvegardes** : sans elle, ces secrets sont à ressaisir après une restauration sur une autre machine |
| `config/` en entier | Base, affiches, réglages : restauration complète en une copie |
| `docker-compose.override.yml` | Vos dossiers et votre matériel |

Exemple de sauvegarde complète (Docker) :

```bash
cd /opt/Venus
docker compose stop venus
sudo tar czf /sauvegardes/venus-$(date +%F).tar.gz config docker-compose.override.yml
docker compose start venus
```

**Restaurer sur une nouvelle machine** : installez Venus, arrêtez-le, remplacez le dossier `config/` par celui de la sauvegarde, puis redémarrez.

---

## 6. Mises à jour

| Méthode | Comment |
|---|---|
| **Depuis l'application** | Réglages → **Mise à jour** → « Mettre à jour maintenant ». Option de mise à jour automatique la nuit |
| **Docker** | `cd /opt/Venus && sudo bash update.sh` |
| **Linux natif, macOS, Windows** | Relancer la commande d'installation (réglages conservés) |

Venus vous prévient (notification, Telegram) quand une nouvelle version est disponible et affiche la liste des nouveautés. Faites une sauvegarde manuelle avant une mise à jour importante.

---

## 7. Surveillance

- **Tableau de bord** : lectures en cours, appareils connectés, tâches planifiées, journal, santé du NAS, performances (GPU, mémoire).
- **Tableau de bord → Sécurité** : connexions, échecs, adresses bloquées, audit hebdomadaire.
- **Notifications** aux administrateurs pour les événements graves (Web Push, ntfy, Discord, Telegram).
- **Webhooks** et **API** (`X-Api-Key`) pour Home Assistant, n8n ou votre propre supervision.
- État du serveur sans session : `curl http://127.0.0.1:8096/api/health` (répond `{"ok":true}`).

---

## 8. Liste de contrôle finale

- [ ] Venus démarre avec la machine (`restart: unless-stopped` ou service systemd)
- [ ] Mot de passe du foyer solide, code PIN sur chaque administrateur
- [ ] Double authentification activée
- [ ] Accès extérieur uniquement en HTTPS (tunnel, Caddy ou Nginx)
- [ ] Sauvegarde vers un second emplacement réglée, `secret.key` gardée à part
- [ ] Carte graphique détectée (Tableau de bord → Performances)
- [ ] Audit de sécurité sans point « à corriger »
