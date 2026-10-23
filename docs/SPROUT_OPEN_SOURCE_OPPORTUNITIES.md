# Opportunités open source

**Évaluation au 23 octobre 2026.** Une licence permissive autorise l'intégration sous réserve de conserver les notices et de vérifier les dépendances. Cette matrice n'est pas un avis juridique.

## Critères

- Apporte une capacité mesurable absente ou coûteuse à construire.
- Compatible avec Next.js/TypeScript/Supabase et l'architecture existante.
- Licence identifiable et projet maintenu.
- Coût d'intégration inférieur à une implémentation locale ciblée.
- Aucun remplacement d'un composant local déjà plus sûr sans preuve comparative.

Effort : **S** 1–3 jours, **M** 1–2 semaines, **L** 3–6 semaines, hors conformité et exploitation.

## Matrice de décision

| Projet | Licence | Maturité observable | Fonction apportée | Avantage démontrable | Coût | Décision |
|---|---|---|---|---|---:|---|
| [JSON Resume](https://github.com/jsonresume/jsonresume.org) | MIT | Écosystème ancien, schéma et outils actifs | Format JSON interopérable, validation et thèmes | Réduit le format propriétaire et facilite import/export/tests | S–M | **GO P1** pour une couche d'échange, avec mapping vers le modèle existant |
| [Reactive Resume](https://github.com/reactive-resume/reactive-resume) | MIT | Produit complet et maintenu | Édition de CV, modèles, imports/exports | Références UX et briques réutilisables permises par la licence | M–L | **GO sélectif P1**, pas de fork intégral ; reprendre uniquement schéma/rendu/composants justifiés |
| [react-pdf](https://github.com/diegomura/react-pdf) | MIT | Bibliothèque React largement utilisée et maintenue | Mise en page PDF déclarative | Plus souple que des coordonnées manuelles quand les modèles deviennent complexes | M | **GO conditionnel P2** si `pdf-lib` bloque un cas mesuré |
| [pgvector](https://github.com/pgvector/pgvector) | PostgreSQL License | Extension PostgreSQL mature, versions et index documentés | Recherche vectorielle et hybride dans Postgres | Évite un service vectoriel externe ; permet un reranking sur un petit candidat set | M | **GO pilote P1**, derrière flag et seulement après benchmark labellisé |
| [postal-mime](https://github.com/postalsys/postal-mime) | MIT-0 | Bibliothèque TypeScript active | Parsing MIME, pièces jointes, adresses et encodages | Évite un parseur email maison lors de l'inbox Gmail/webhook | S–M | **GO P1** au moment de brancher l'inbox ; imposer limites de taille et sanitation |
| [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 | Standard CNCF, SDK serveur mature | Traces, métriques et corrélation de requêtes | Rend mesurables p95, erreurs fournisseurs, retries et coût par workflow | S–M | **GO P0** côté serveur ; instrumentation navigateur seulement si nécessaire |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0 | Orchestrateur actif et complet | Tâches durables, retries, observabilité | Bon produit généraliste mais duplique la file Postgres déjà testée | L + exploitation | **NO-GO maintenant** ; réévaluer seulement si multi-worker/ops dépassent le système actuel |
| [PGMQ](https://github.com/pgmq/pgmq) | PostgreSQL License | Extension Postgres dédiée aux messages | Queue visible avec lecture/archivage | Standardise une file SQL, mais exige une migration de garanties déjà implémentées | M–L | **NO-GO maintenant** ; aucune amélioration prouvée sur les invariants locaux |
| [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript) | MIT | Moteur durable mature, écosystème large | Workflows distribués et reprise déterministe | Puissant à grande échelle, mais service et modèle opérationnel supplémentaires | L–XL | **NO-GO** au stade actuel |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Automatisation navigateur mature | Tests E2E et navigation contrôlée | Excellent pour tests et environnements autorisés, fragile comme moteur ATS générique | M–XL | **GO tests / NO-GO auto-apply générique** |
| [ScrapeGraphAI](https://github.com/ScrapeGraphAI/Scrapegraph-ai) | MIT pour le dépôt ; vérifier modèles/services | Projet actif mais chaîne IA lourde | Extraction web pilotée par LLM | Aucun avantage local démontré face aux API officielles ; lenteur et coût supérieurs dans l'essai existant | L + modèles | **NO-GO** |

## Intégrations recommandées

### 1. OpenTelemetry côté serveur — GO P0

Instrumenter les frontières, pas chaque fonction : requête catalogue, cache EasyJobs, parsing CV, calcul de match, préparation, claim worker, appel adaptateur et réconciliation. Attributs autorisés : provider, version moteur, état et durées. Ne jamais exporter le texte du CV, le contenu des lettres, les emails ou tokens OAuth.

**Succès** : p50/p95, taux d'erreur, retry, `uncertain`, coût estimé par workflow et corrélation par ID technique non personnel.

### 2. JSON Resume — GO P1

Ajouter un adaptateur entrant/sortant, sans remplacer immédiatement le schéma Supabase. Le format externe facilite portabilité, fixtures et comparaison des rendus. Les champs français spécifiques peuvent rester dans une extension versionnée.

**Succès** : round-trip sans perte sur un corpus de CV, rapport explicite des champs non mappés et aucune régression des corrections utilisateur.

### 3. pgvector — pilote P1 uniquement

Le candidat set doit d'abord être filtré par contrat, localisation, droit au travail et autres contraintes dures. Un embedding peut ensuite reranker les offres sémantiquement proches. Il ne doit pas générer le score final ni masquer l'explication déterministe.

**Succès** : amélioration statistiquement utile de NDCG@10, recall@20 et acceptation utilisateur sur un jeu labellisé, latence et coût bornés.

### 4. postal-mime — GO P1 conditionnel

À utiliser uniquement quand un flux Gmail ou webhook autorisé existe. Stocker la source minimale, neutraliser le HTML, limiter les pièces jointes et rattacher un message à une candidature avec score de confiance.

**Succès** : corpus MIME multilingue, pièces jointes bornées, aucun script rendu et erreurs isolées sans perdre le message brut nécessaire à la reprise.

### 5. Reactive Resume / react-pdf — réutilisation ciblée

Le produit dispose déjà d'un éditeur et d'exports. Un remplacement global créerait une refonte prématurée. Réutiliser seulement si un besoin précis est mesuré : format interopérable, pagination complexe, modèles accessibles ou export mieux testé.

## Solutions explicitement écartées

- **Nouvel orchestrateur de jobs** : le worker Postgres possède déjà idempotence, lease, retry, réconciliation et preuves. Trigger.dev, PGMQ ou Temporal n'ont pas de bénéfice net aujourd'hui.
- **Framework de scraping IA** : une API structurée officielle fournit une provenance et une fraîcheur supérieures. ScrapeGraphAI n'a pas justifié son coût localement.
- **Navigateur généraliste de soumission** : CAPTCHA, login, variations de DOM et conditions d'utilisation empêchent une confirmation fiable. Playwright reste un outil de test ou d'intégration explicitement autorisée.
- **Moteur de matching entièrement vectoriel** : il affaiblirait les contraintes dures et l'explicabilité. Le vectoriel est un reranker, pas une source de vérité.
- **Fork complet d'un constructeur de CV** : maintenance, design system, sécurité et migration ne sont pas justifiés par les besoins actuels.

## Vérifications avant adoption

Pour chaque GO : épingler une version, auditer les dépendances et notices, générer SBOM, vérifier compatibilité serveur/client, mesurer bundle et mémoire, ajouter un kill switch, traiter les données personnelles dans le registre de traitement, et documenter rollback. La décision finale de licence appartient au conseil juridique.

Voir [l'audit technique](./SPROUT_TECHNICAL_AUDIT.md) et [la roadmap](./SPROUT_IMPLEMENTATION_ROADMAP.md).
