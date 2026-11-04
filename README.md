# Web Watcher v2

Application web qui surveille la valeur d'un élément (prix, stock, texte…) sur des pages web, repéré par un sélecteur CSS.

Version 2 : mise à jour du branding et des métadonnées de version de l'application.

## Fonctionnalités

- CRUD de surveillances : nom, groupe, URL, sélecteur CSS, intervalle.
- Affichage de la valeur actuelle, de la dernière erreur éventuelle et de la date de dernière vérification.
- Vérifications automatiques périodiques : intervalle par défaut global, surchargeable par surveillance, en secondes ou en minutes (minimum 5 s).
- Groupes : les surveillances sont regroupées par groupe, avec un bouton « Vérifier le groupe ».
- Notifications [Pushover](https://pushover.net) lors d'un changement de valeur ; clés saisies depuis l'interface (jamais renvoyées au navigateur), avec bouton d'envoi de test.
- Interface sombre en Tailwind CSS (chargé via CDN).

> Les pages sont chargées dans Chromium headless : les éléments générés en JavaScript peuvent être surveillés. Certains sites refusent toujours les accès automatisés (HTTP 403) ; le navigateur ne contourne pas ces blocages.

## Prérequis

- Node.js ≥ 24 (utilise `node:sqlite`), ou Docker.

## Installation et lancement

```bash
npm install
npx playwright install chromium
npm run build
npm start
```

Puis ouvrir http://localhost:3000.

### Docker

L'image installe Chromium et ses dépendances système ; elle est plus volumineuse que l'image précédente.

```bash
docker build -f dockerfile -t web-watcher .
docker run -d --name web-watcher -p 3000:3000 -v web-watcher-data:/data web-watcher
```

Derrière un proxy, ajouter `-e HTTPS_PROXY=... -e HTTP_PROXY=... -e NO_PROXY=...` (déjà pris en compte grâce à `NODE_USE_ENV_PROXY=1`).

### Publication sur Docker Hub

Le workflow GitHub Actions publie `web-watcher` sur Docker Hub à chaque push sur `master` ou d'un tag `v*`. Il construit les images `linux/amd64` et `linux/arm64`, avec les tags `latest` (branche par défaut), `sha-<commit>`, le tag Git (`v2.0.0`, etc.), ainsi que les variantes `2.0.0` et `2` quand le tag suit le schéma semver.

Configurez les secrets du dépôt `DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN` (un access token Docker Hub) pour autoriser la publication.

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DATA_DIR` | `./data` (`/data` en Docker) | Dossier de la base SQLite `watches.db` |
| `DEFAULT_INTERVAL_SECONDS` | `3600` | Intervalle de vérification par défaut |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | — | Proxy sortant (pages surveillées et Pushover) |

Les clés Pushover (clé utilisateur et jeton d'application) se renseignent dans le panneau « Notifications Pushover » de l'interface et sont stockées dans la base SQLite.

## API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/config` | Intervalle par défaut et minimum |
| `GET` / `POST` | `/api/watches` | Liste / création |
| `PUT` / `DELETE` | `/api/watches/:id` | Modification / suppression |
| `POST` | `/api/watches/:id/check` | Vérification immédiate |
| `GET` / `PUT` | `/api/settings` | Réglages Pushover (`pushover_user`, `pushover_token`, `pushover_enabled`) |
| `POST` | `/api/settings/test` | Envoi d'une notification de test |

## Structure du projet

```
├── src/server.ts      # Serveur HTTP, API REST, base SQLite, planificateur, Pushover
├── dist/server.js     # Généré par la compilation TypeScript
├── public/index.html  # Interface (HTML + Tailwind + JS natif)
├── dockerfile
├── tsconfig.json
└── package.json
```

## Sécurité

Aucune authentification : n'exposez pas l'application sur un réseau non maîtrisé (elle peut faire émettre des requêtes HTTP arbitraires par le serveur).
