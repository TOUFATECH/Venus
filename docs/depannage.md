# Dépannage

[← Retour au README](../README.md) · [Configuration](configuration.md) · [Sécurité](../SECURITY.md)

---

## Lire les journaux

| Installation | Commande |
|---|---|
| Docker | `docker compose logs -f venus` |
| Linux natif | `journalctl -u venus -f` |
| Windows | `C:\ProgramData\Venus\venus.log` |
| macOS | `~/Library/Logs/Venus.log` |
| Depuis l'interface | Tableau de bord → Serveur → Journal |

En production, les erreurs affichées à l'écran ne contiennent qu'un **numéro de référence** : retrouvez-le dans le journal pour voir le détail.

---

## Problèmes fréquents

### Installation et démarrage

| Symptôme | Solution |
|---|---|
| La page ne s'ouvre pas | Vérifiez que Venus tourne (`docker compose ps`) et que le port 8096 est libre (`ss -ltn \| grep 8096`). Sur Windows, réseau Wi-Fi en profil **Privé** |
| `permission denied` sur les vidéos | Le dossier doit être lisible par le conteneur : `sudo chmod -R o+rX /chemin/Films` ou montez-le avec les bons droits |
| La construction Docker échoue sur ffmpeg | Le dépôt du ffmpeg optimisé est peut-être indisponible : l'image se replie automatiquement sur le ffmpeg de Debian. Relancez `docker compose build --no-cache` plus tard pour récupérer la version optimisée |
| Interface « classique » au lieu de la nouvelle | L'interface Next.js n'a pas pu être construite (accès npm). Relancez l'installation ou `npm run web:build` |
| Le conteneur redémarre en boucle | Lisez le journal ; vérifiez les droits du dossier `config/` |

### Lecture

| Symptôme | Solution |
|---|---|
| Lecture saccadée, processeur à 100 % | Activez la carte graphique ([guide](installation-docker.md#4-carte-graphique-accélération-matérielle)) et vérifiez Tableau de bord → Performances. Laissez les **copies optimisées** se préparer la nuit |
| La carte graphique n'est pas détectée | Intel / AMD : `ls /dev/dri` doit montrer `renderD128`. NVIDIA : `nvidia-smi` et `docker info \| grep -i nvidia`. Relancez `bash update.sh` |
| Écran noir sur une chaîne TV | La chaîne est peut-être hors ligne : Réglages → TV en direct → vérifier les chaînes |
| Pas de son (DTS, TrueHD) | Le navigateur ne lit pas ce format : Venus convertit le son automatiquement. Choisissez une autre piste audio si besoin |
| Le Chromecast n'apparaît pas | Le Chromecast exige **HTTPS** et le même réseau que l'appareil qui diffuse |

### Bibliothèques

| Symptôme | Solution |
|---|---|
| Un fichier n'apparaît pas | Vérifiez le nom ([Ranger ses fichiers](utilisation.md#3-ranger-ses-fichiers)), puis Tableau de bord → **Analyser** |
| Mauvaise affiche ou mauvais titre | Fiche du titre → **⋯ → Identifier** |
| Partage NAS déconnecté | Réglages → Médiathèques → **Reconnecter**. Dans un conteneur Proxmox non privilégié, utilisez `proxmox-host.sh nas` ([guide](installation.md#proxmox-conteneur-lxc)) |
| Les NAS ne sont pas trouvés (Docker Desktop) | Renseignez `LAN_SUBNET` dans `.env` ou saisissez l'adresse du NAS à la main |

---

## Accès et sécurité

| Situation | Solution |
|---|---|
| **Bloqué par la double authentification** (e-mail en panne) | Ajoutez `VENUS_DISABLE_2FA=1` aux variables, redémarrez, corrigez l'e-mail, puis **retirez la variable** |
| **Votre adresse est bloquée** | Depuis le réseau local (jamais bloqué) : Tableau de bord → Sécurité → Adresses bloquées → Débloquer. Ou redémarrez Venus |
| **Appareil perdu ou volé** | Tableau de bord → Sécurité → Appareils → Déconnecter, puis changez le mot de passe du foyer |
| Clés d'API perdues après une restauration | `secret.key` n'était pas dans la sauvegarde : ressaisissez les clés, ou restaurez aussi `config/secret.key` |

---

## Réinitialiser

> ⚠️ Ces opérations sont **irréversibles**. Faites d'abord une sauvegarde de `config/`.

Repartir de zéro en gardant vos vidéos (Docker) :

```bash
cd /opt/Venus
docker compose down
sudo mv config config.ancien
docker compose up -d
```

L'assistant de premier démarrage réapparaît. Pour revenir en arrière : arrêtez Venus, remettez `config.ancien` à la place de `config`, redémarrez.

---

## Signaler un problème

Ouvrez une *issue* sur [GitHub](https://github.com/TOUFATECH/Venus/issues) avec :

- la méthode d'installation et le système (ex. Docker sur Debian 13) ;
- la version (Réglages → Mise à jour) ;
- les lignes du journal autour de l'erreur (sans mot de passe ni clé) ;
- les étapes pour reproduire.

Pour une faille de sécurité, suivez plutôt [SECURITY.md](../SECURITY.md).
