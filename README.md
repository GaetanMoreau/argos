# Argos

Inventaire et veille de sécurité **locale** pour les développeurs qui maintiennent plusieurs sites web (WordPress, Kirby, Nuxt) : savoir ce qui est installé sur chaque site, ce qui est vulnérable ou en fin de support, ce qui est à mettre à jour, et être prévenu quand une faille apparaît.

Argos tourne sur votre Mac, sans compte ni service en ligne : une ligne de commande, une interface web locale et un scan quotidien automatique.

## Ce que fait Argos

**Inventaire**
- Détecte la stack de chaque projet local (WordPress, Kirby, Nuxt) et liste ses composants : cœur, plugins, thèmes, dépendances npm et Composer, versions de Node et PHP.
- Distingue les dépendances choisies par le projet des dépendances indirectes, et les dépendances de développement.
- Indique la dernière version publiée de chaque composant direct (majeure, mineure, correctif).

**Failles et fins de support**
- Croise chaque version installée avec [OSV](https://osv.dev) (npm, Packagist) et [WPVulnerability](https://www.wpvulnerability.net) (cœur, plugins et thèmes WordPress).
- Signale les failles activement exploitées (catalogue [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)) et les versions en fin de support ([endoflife.date](https://endoflife.date), statut officiel du cœur WordPress).
- Pour chaque faille : sévérité, version corrigée, lien vers l'avis de sécurité. Une faille peut être ignorée avec une justification.

**Site en ligne**
- HTTPS, redirection, certificat TLS (expiration, validité), en-têtes de sécurité avec une note de A+ à F.
- Fichiers sensibles laissés accessibles (`.git`, `.env`, copies de `wp-config.php`, `debug.log`, liste des utilisateurs WordPress, contenu Kirby…), en vérifiant le contenu et pas seulement le code HTTP.
- Expiration du nom de domaine (RDAP) et protection de l'e-mail (SPF, DMARC, DKIM).
- Performance mobile via Google PageSpeed Insights, avec le détail des points à corriger.

**Suivi**
- Scan quotidien automatique (launchd), notifications macOS pour les nouveautés seulement.
- Chaque problème est suivi d'un scan à l'autre : ouvert, ignoré, corrigé automatiquement quand il disparaît.
- Rapport de maintenance par site, imprimable ou exportable en PDF, rédigé pour le client.

## Prérequis

- **macOS** : notifications, scan planifié (launchd), trousseau et sélecteur de dossier utilisent les outils du système.
- **Node.js 24 ou plus** : Argos exécute directement son code TypeScript.
- Une copie locale de chaque projet à suivre.

## Installation

```sh
git clone <url-du-dépôt> argos
cd argos
npm install
npm link          # rend la commande `argos` disponible partout
```

Sans `npm link`, remplacez `argos` par `npm run argos --` dans les exemples.

## Démarrage rapide

```sh
argos client add "Mon client"
argos site discover ~/Sites/mon-projet --client "Mon client"   # un projet, ou un dossier qui en contient plusieurs
argos scan
argos serve                                                      # http://localhost:4000
```

Les sites et clients peuvent aussi être ajoutés depuis l'interface, avec le sélecteur de dossier de macOS.

Pour activer la vérification du site en ligne, renseignez son URL (à l'ajout, dans l'onglet « Sécurité en ligne » ou avec `argos site set <site> --url mon-site.fr`).

## Interface

`argos serve` compile l'interface au premier lancement (et après chaque modification du code), puis l'ouvre dans le navigateur.

- **Sites** : tous les sites groupés par client, avec leur état, leur note HTTP, leur performance et ce qu'il reste à traiter.
- **Fiche site** : failles groupées par composant avec la version cible, composants et mises à jour, sécurité en ligne, performance, historique des scans, rapport de maintenance.
- **Failles** : vue globale filtrable (statut, sévérité, site, dépendances de dev).

Thème clair ou sombre, utilisable sur mobile.

## Ligne de commande

| Commande | Rôle |
|---|---|
| `argos client add <nom>` · `client list` | Gérer les clients |
| `argos site add --client <c> --path <dossier> [--url] [--hosting]` | Ajouter un site |
| `argos site discover <dossier> [--client <c>]` | Reconnaître un projet ou les projets d'un dossier |
| `argos site list` · `site set <site> [--url] [--hosting] [--php]` | Lister, modifier un site |
| `argos site archive <site>` · `site remove <site> --yes` | Exclure des scans, supprimer |
| `argos scan [--site <site>] [--notify]` | Scanner tous les sites ou un seul |
| `argos findings [--site] [--status] [--prod]` | Lister les failles |
| `argos ignore <id> --note "<raison>"` | Ignorer une faille, avec justification |
| `argos components <site> [--all] [--untracked] [--outdated]` | Inventaire du dernier scan |
| `argos pagespeed key <clé>` · `pagespeed run <site>` | PageSpeed Insights |
| `argos notify test` | Notification macOS de test |
| `argos schedule install [--at 09:00]` · `uninstall` · `status` | Scan quotidien |
| `argos serve [--port] [--no-open] [--dev]` | Interface web |

`argos <commande> --help` détaille chaque commande.

## Scan quotidien

```sh
argos schedule install --at 09:00
```

Un agent launchd lance `argos scan --notify` chaque jour, rattrapé au réveil si le Mac dormait. Les notifications ne concernent que les nouveautés : urgentes (faille critique, élevée ou exploitée) ou résumé. Le détail est écrit dans `data/logs/scan.log`.

Le chemin de Node est figé dans l'agent : relancez `argos schedule install` après avoir changé de version de Node.

## PageSpeed Insights

L'API de Google exige une clé, gratuite ([obtenir une clé](https://developers.google.com/speed/docs/insights/v5/get-started), puis activer « PageSpeed Insights API » dans le projet Google Cloud) :

```sh
argos pagespeed key AIza…
```

La clé est rangée dans le trousseau macOS, jamais dans un fichier. Chaque nouveau site est analysé à son premier scan, puis à la demande.

## Données et confidentialité

- Tout reste sur le Mac : base SQLite dans `data/argos.db` (emplacement modifiable avec `ARGOS_DB`), lisible par le seul compte courant.
- L'interface n'écoute que sur `127.0.0.1` et refuse les requêtes venant d'autres sites (DNS rebinding, CSRF).
- Ce qui sort du Mac : les noms et versions des composants (vers les bases de failles et les registres de paquets), les URL des sites (vers Google PageSpeed) et des requêtes en lecture vers vos propres sites et vers les registres de domaines.

## Limites

- **WordPress** : les versions sont lues dans la copie locale. Un plugin mis à jour depuis l'administration en production n'est vu qu'après mise à jour de la copie.
- **PHP** : sa version de production est rarement visible depuis l'extérieur. Argos l'estime d'après `composer.json` ; elle peut être saisie par site.
- **DKIM** ne se découvre qu'en connaissant le sélecteur du fournisseur d'e-mail : seuls les sélecteurs courants sont essayés.
- macOS uniquement, interface en français.

## Développement

```sh
npm test               # tests (Vitest)
npm run typecheck      # TypeScript
npm run db:generate    # migration après modification de src/core/db/schema.ts
argos serve --dev      # interface avec rechargement à chaud
```

| Dossier | Contenu |
|---|---|
| `src/core` | Logique : adaptateurs de stack, sources de failles, scan, vérifications en ligne, requêtes |
| `src/cli` | Ligne de commande (Commander) |
| `web` | Interface Nuxt ; ses routes serveur réutilisent `src/core` |
| `drizzle` | Migrations SQLite, appliquées automatiquement au démarrage |
| `test` | Tests, sans accès réseau |

Stack : TypeScript, Node.js 24, SQLite (better-sqlite3, Drizzle ORM), Nuxt 4, Vitest.
