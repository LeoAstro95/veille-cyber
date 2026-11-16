# Veille Cyber

Site de veille en cybersécurité **mis à jour automatiquement chaque jour à 7h (heure de Paris)**.
Il rassemble les vulnérabilités et les attaques des 3 derniers jours dans une seule page.

Projet personnel — BTS SIO option SISR — Maxime Stephan.

## Ce que le site affiche

| Onglet | Source | Contenu |
|---|---|---|
| CERT-FR | ANSSI (flux RSS) | Alertes, avis de sécurité, actualités |
| Exploitées (KEV) | CISA Known Exploited Vulnerabilities | Failles **activement exploitées**, avec l'action à mener et l'usage éventuel par des ransomwares |
| CVE critiques | NVD (NIST), API 2.0 | CVE publiées récemment avec un score CVSS v3 critique (≥ 9.0) |
| Attaques & actu | The Hacker News, BleepingComputer, ZATAZ, SecurityWeek | Articles, avec un repère automatique « attaque » (ransomware, fuite, piratage…) |

Les jours précédents restent consultables grâce au menu « Jour » (archives dans `docs/data/archive/`).

## Fonctionnement

```
GitHub Actions (cron, 7h Paris)
        │
        ▼
scripts/fetch_veille.py  ──►  docs/data/veille.json  (+ archive datée)
                                      │  commit automatique
                                      ▼
                     GitHub Pages sert docs/ (HTML/CSS/JS)
```

- **Python sans dépendance** : le script n'utilise que la bibliothèque standard (`urllib`, `xml`, `json`).
- **Tolérant aux pannes** : si une source ne répond pas, elle est signalée en bas de page et les autres sont quand même publiées.
- **Site statique** : pas de serveur ni de base de données. L'hébergement sur GitHub Pages est gratuit.

## Mise en ligne (≈ 10 minutes)

1. Crée un dépôt **public** sur GitHub, par exemple `veille-cyber`.
2. Envoie-y le contenu de ce dossier :
   ```bash
   cd veille-cyber
   git init
   git add .
   git commit -m "Première version de la veille cyber"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/veille-cyber.git
   git push -u origin main
   ```
3. **Settings → Actions → General → Workflow permissions** : coche *Read and write permissions*, puis *Save*.
4. **Settings → Pages** : *Source* = `Deploy from a branch`, *Branch* = `main`, dossier = `/docs`, puis *Save*.
5. **Actions → Veille cyber quotidienne → Run workflow** : ce premier lancement manuel remplit les données tout de suite.
6. Le site est en ligne à l'adresse `https://<ton-pseudo>.github.io/veille-cyber/`.

Ensuite, tout se fait seul, chaque matin.

## Notification sur le téléphone (ntfy)

Chaque matin, après la collecte, un résumé arrive sur ton téléphone. Quand tu touches la notification, le site s'ouvre.

1. Installe l'application **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iPhone](https://apps.apple.com/app/ntfy/id1625396347)). Elle est gratuite et ne demande pas de compte.
2. Choisis un **nom de canal difficile à deviner**, par exemple `veille-maxime-8f3k2q9z`.
   Sur ntfy.sh, n'importe qui qui connaît ce nom peut lire tes notifications : ne prends pas un nom simple.
3. Dans l'application, touche **+** et abonne-toi à ce nom de canal.
4. Dans ton dépôt GitHub, va dans **Settings → Secrets and variables → Actions** :
   - onglet **Secrets** → *New repository secret* : nom `NTFY_TOPIC`, valeur = ton nom de canal ;
   - onglet **Variables** → *New repository variable* : nom `SITE_URL`, valeur = `https://<ton-pseudo>.github.io/veille-cyber/`.
5. Relance le workflow à la main (**Actions → Run workflow**) : la notification doit arriver en environ 2 minutes.

Pour tester tout de suite depuis un terminal :
```bash
curl -d "Test de ma veille cyber" ntfy.sh/<ton-nom-de-canal>
```

La notification est en **priorité haute** quand il y a une alerte CERT-FR ou une faille activement exploitée ;
sinon elle est en priorité normale. Si `NTFY_TOPIC` n'est pas défini, l'étape est simplement ignorée.

> Astuce : dans le navigateur de ton téléphone, ouvre le site puis choisis « Ajouter à l'écran d'accueil »
> pour l'avoir aussi sous forme d'icône, comme une application.

## Tester en local

```bash
python3 scripts/fetch_veille.py      # collecte les données
cd docs && python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

> Le site doit être servi par un serveur web (même local). En ouvrant `index.html` en double-clic,
> le navigateur bloque la lecture du fichier JSON.

## Personnaliser

Tout se règle en haut de `scripts/fetch_veille.py` :

- `JOURS` : la période couverte (3 jours par défaut) ;
- `FLUX_PRESSE` : les flux RSS à ajouter ou à retirer ;
- `MOTS_ATTAQUE` : les mots-clés qui marquent un article comme « attaque ».

Pour changer l'heure, modifie les lignes `cron` dans `.github/workflows/veille.yml` (en heure UTC).

## Bon à savoir

- GitHub Actions peut prendre **quelques minutes à une demi-heure de retard** sur l'heure prévue quand ses serveurs sont chargés.
- GitHub désactive les workflows planifiés d'un dépôt public **après 60 jours sans activité**. Les commits quotidiens du bot comptent normalement comme de l'activité. Si le workflow est quand même désactivé, réactive-le dans l'onglet Actions.
- L'API NVD sans clé est limitée en nombre de requêtes. Pour un seul appel par jour, ça suffit largement.

## Idées d'évolution (pour aller plus loin)

- Recevoir aussi le résumé par e-mail ou sur Discord (webhook).
- Mettre en avant les produits que tu utilises (Cisco, Fortinet, Windows Server…).
- Ajouter des graphiques d'évolution à partir des archives.
- Ajouter le score EPSS (probabilité d'exploitation) pour chaque CVE.

## Compétences mobilisées (BTS SIO)

Veille technologique, automatisation (CI/CD), scripts Python, consommation d'API REST et de flux RSS/JSON,
publication d'un service web, sécurité des systèmes d'information.
