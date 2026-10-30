# Sécurité de Venus

Venus est pensé pour la maison, mais il est souvent ouvert sur Internet. Voici ce qui le protège, ce qu'il faut régler et quoi faire en cas de problème.

## À faire après l'installation

1. **Tableau de bord → Sécurité** : lisez l'audit. Chaque point « à corriger » donne la marche à suivre.
2. **Code PIN pour chaque administrateur** (obligatoire depuis cette version) : Réglages → Profils.
3. **Mot de passe du foyer solide** : 10 caractères au moins, en mélangeant lettres et chiffres (ou symboles), et pas un mot de passe courant.
4. **Double authentification par e-mail** : renseignez un serveur d'e-mails (Gmail : `smtp.gmail.com`, port 465, mot de passe d'application), envoyez l'e-mail de test, puis activez-la. Un code à 6 chiffres est alors demandé à chaque nouvel appareil.
5. **Accès depuis Internet : passez par HTTPS** (Caddy, voir README), jamais par une simple redirection du port 8096.

## Ce qui est en place

| Domaine | Protection |
|---|---|
| Force brute | 5 essais faux en 15 min par adresse → pause qui double à chaque fois (jusqu'à 24 h) ; plafond par jour ; 20 échecs par heure sur l'ensemble du compte → pause générale. Même chose pour les codes PIN, les codes d'appairage et de salon. |
| Détection d'intrusion | Score de suspicion par adresse (chemins de scanners, `../`, jetons faux, routes inconnues, excès de requêtes). Au-delà du seuil : adresse bloquée 1 h, puis 6 h, 24 h, 7 jours. Le réseau local de la machine n'est jamais bloqué. |
| Mots de passe | scrypt (sel unique, 32 Mo de mémoire par essai), comparaison en temps constant ; les anciens formats sont renforcés à la connexion suivante. Politique : 10 caractères, mélange, liste de mots de passe courants refusés (client et serveur). |
| Double authentification | Code par e-mail, 10 minutes, 5 essais par code, saisi depuis la même adresse que la demande. Par jour : 10 e-mails au total, 5 par adresse, 15 codes faux par adresse. Un nouveau code au plus par minute. |
| Sessions | Jetons opaques de 256 bits (pas de JWT : rien à falsifier ni à « valider » côté client). Seule leur empreinte SHA-256 est stockée. Format vérifié strictement. Expiration après 45 jours sans utilisation, 180 jours au plus. Déconnexion des autres appareils au changement de mot de passe. |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS. Le cookie ne sert qu'aux images et vidéos (lectures) : il ne permet aucune modification. |
| CSRF | Toute requête qui modifie quelque chose exige l'en-tête `Authorization` et une origine identique au serveur. |
| CORS | Seuls les flux vidéo, sous-titres et images (pour le Chromecast) sont partagés ; l'API refuse les autres origines. |
| XSS / CSP | `Content-Security-Policy` stricte (scripts du site uniquement, empreintes des scripts intégrés), échappement de tout texte affiché. |
| Clickjacking | `X-Frame-Options: DENY` et `frame-ancestors 'none'`. |
| Autres en-têtes | `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, HSTS en HTTPS ; pas de `X-Powered-By`. |
| Validation | Chaque route vérifie type, longueur et format des champs. Corps JSON : objet uniquement, taille et profondeur limitées, clés `__proto__`/`constructor` supprimées (injection d'objets « NoSQL » et pollution de prototype). Paramètres en double refusés (HPP). |
| SQL | Requêtes paramétrées partout (SQLite intégré à Node). |
| Fichiers | Chemins résolus et vérifiés (`realpath`) dans le dossier autorisé ; `..`, octets nuls et liens symboliques sortants refusés. Envois de fichiers : nom nettoyé, extension et contenu (signature) vérifiés, taille limitée. |
| ReDoS | Aucune expression régulière sur des textes non bornés ; longueur des entrées limitée avant tout test. |
| Délais | En-têtes : 20 s ; corps : 20 s ; connexion inactive : 2 min ; 900 requêtes par minute par adresse (hors vidéo) ; adresses de plus de 8 Ko refusées. |
| Erreurs | En production, aucune trace technique : un message générique et un numéro de référence, retrouvable dans le journal du serveur. |
| Secrets | Clés d'API et mots de passe des services chiffrés dans la base (AES-256-GCM) avec `/config/secret.key` (droits 600). Base de données en droits 600. Aucune clé dans le code. |
| Droits | Les profils non administrateurs ne voient que leurs propres téléchargements, réglages et historique ; toute route d'administration exige un profil administrateur protégé par code PIN. |
| Journal | Connexions, échecs, blocages, changements de droits et de mots de passe : Tableau de bord → Sécurité. Les événements graves déclenchent une notification aux administrateurs. |
| Audit | Au démarrage puis chaque semaine : mot de passe, PIN, 2FA, HTTPS, Node.js, dépendances, droits des fichiers, sauvegardes, appareils inactifs, tentatives d'intrusion. |
| Dépendances | Aucune dépendance npm : `npm audit` n'a rien à corriger. La vérification GitHub tourne quand même chaque semaine. |

## HTTPS

- **Recommandé depuis Internet** : Caddy (certificat Let's Encrypt automatique), voir README.
- **Intégré** : port 8920, certificat auto-signé dans `/config/tls` (renouvelé seul). Votre propre certificat : `TLS_CERT=/config/cert.pem` et `TLS_KEY=/config/key.pem`.
- **Obligation** : `FORCE_HTTPS=remote` (défaut : redirection hors du réseau local), `all` ou `off`. Réglable aussi dans Tableau de bord → Sécurité.
- Derrière un proxy installé sur une autre machine du réseau : `TRUST_PROXY=1`.

## En cas de problème

- **Bloqué par la double authentification** (e-mail en panne) : ajoutez `VENUS_DISABLE_2FA=1` dans `docker-compose.yml`, `docker compose up -d`, corrigez l'e-mail, puis retirez la variable.
- **Votre adresse est bloquée** : depuis le réseau local (jamais bloqué), Tableau de bord → Sécurité → Adresses bloquées → Débloquer. Ou redémarrez Venus (les pauses de force brute sont en mémoire).
- **Appareil perdu ou volé** : Tableau de bord → Sécurité → Appareils → Déconnecter, puis changez le mot de passe du foyer.
- **Sauvegardes** : `/config/backups` (automatiques). La clé `/config/secret.key` n'y est pas : gardez-la à part, sinon les clés d'API seront à ressaisir après une restauration sur une autre machine.

## Vérifier soi-même

```
npm run security     # attaques simulées sur un serveur jetable
npm run audit        # npm audit + attaques simulées
```

## Signaler une faille

Ouvrez une issue privée (« Security advisory ») sur GitHub : https://github.com/TOUFATECH/Venus/security/advisories/new
