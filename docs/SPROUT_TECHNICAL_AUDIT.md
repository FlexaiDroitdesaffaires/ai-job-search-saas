# Audit technique — Sprout vs AI Job Search SaaS

**État audité : `develop` à `8b004b2`, le 23 octobre 2026. Audit sans modification applicative.**

## Conclusion de maturité

Le produit local est une **fondation pré-lancement avancée**, pas encore un équivalent opérationnel de Sprout. Il est déjà crédible de l'import du CV jusqu'au dossier approuvé et au suivi assisté. Ses invariants de vérité, de sécurité base de données et de fiabilité asynchrone sont souvent plus rigoureux que ce que Sprout expose publiquement. En revanche, trois boucles commerciales ne sont pas fermées : recherche ciblée à grande échelle, paiement/crédits, et résultat de candidature confirmé par un canal réel.

La bonne stratégie n'est pas de cloner Sprout. Il faut conserver le noyau local explicable et prouvable, puis combler les sorties produit manquantes. Une version commercialisable en **mode assisté transparent** est plus proche qu'une promesse d'auto-apply généralisé.

## Architecture réellement observée

```text
Sources officielles/ciblées
  -> normalisation + URL/provenance + déduplication exacte
  -> Supabase/RLS
  -> filtres en mémoire + matching déterministe
  -> swipe (refus ou brouillon)
  -> préparation éditable
  -> snapshot/hashes + approbation
  -> mode assisté OU file durable de test
  -> preuve/réconciliation (aucun adaptateur production actif)
```

Stack : Next.js 16.4.1, React 19, TypeScript, Supabase, Zod, Vitest, `pdf-lib`, `mammoth` et `unpdf` ([`package.json`](../package.json)). Les scripts séparent ingestion, vérification EasyJobs et worker de soumission.

## Évaluation par domaine

### Architecture et maintenabilité

**Solide à conserver**

- Séparation lisible entre UI, actions, matching, sources, normalisation, préparation et adaptateurs.
- Validation Zod à la frontière EasyJobs et délais réseau bornés.
- RPC et contraintes SQL pour les transitions sensibles, plutôt que de faire confiance au client.
- Tests unitaires, contrats de migration, pgTAP et intégrations Supabase déjà structurés.
- Adaptateurs décrivant explicitement leurs capacités : une route non confirmable n'est pas expédiée.

**Dette mesurable**

- [`app/dashboard/jobs/page.tsx`](../app/dashboard/jobs/page.tsx) agrège requêtes, transformation métier, calcul et persistance. Le chargement d'une page est aussi une écriture massive.
- La lecture est plafonnée aux 500 offres les plus récentes avant filtrage. Une offre pertinente plus ancienne devient invisible.
- Le filtrage textuel et le scoring vivent dans le processus Next.js ; le coût croît avec utilisateurs × offres.
- Les tables billing, inbox et notifications précèdent leurs parcours applicatifs. Elles sont une bonne base, mais ne constituent pas une fonctionnalité livrée.

### Performances et scalabilité

Le point critique se trouve dans [`app/dashboard/jobs/page.tsx`](../app/dashboard/jobs/page.tsx) : six lectures parallèles sont efficaces, mais toutes les offres retenues sont ensuite filtrées/scorées côté serveur et chaque match est `upsert` à chaque affichage. Cela crée une amplification de lecture, CPU et écriture, sans cache ni pagination par curseur.

Objectifs avant montée en charge :

- recherche EasyJobs à la demande, limitée par requête, avec cache court et attribution ;
- préfiltrage SQL/serveur avant le scoring ;
- score calculé seulement si profil, offre ou version de moteur a changé ;
- pagination stable et métriques p50/p95 ;
- budgets explicites sur API externe, parsing et génération.

Critères proposés : p95 serveur < 800 ms sur lecture mise en cache, zéro `upsert` si les entrées n'ont pas changé, première page ≤ 50 offres, taux d'erreur EasyJobs < 1 % hors indisponibilité fournisseur.

### Sécurité et confidentialité

**Points forts**

- Authentification vérifiée serveur et RLS étendue.
- Fonctions `SECURITY DEFINER` avec `search_path` vide, privilèges révoqués et opérations sensibles réservées au rôle de service.
- Ledgers append-only, clés d'idempotence et unicité des reçus.
- CV stockés dans un bucket privé ; taille, MIME et extensions attendues contrôlés ; échec d'extraction explicite.
- URL de source et de candidature limitées à HTTPS à la normalisation.

**Lacunes avant production**

- [`next.config.mjs`](../next.config.mjs) ne configure pas CSP, HSTS, anti-framing, politique de référent ni Permissions Policy.
- Aucun rate limiting applicatif visible sur authentification, upload, génération ou actions coûteuses.
- Un DOCX est un ZIP : la signature `PK` et le MIME ne suffisent pas à prévenir une archive malveillante, une décompression excessive ou du contenu actif. Aucun antivirus/quarantaine n'est visible.
- Le fichier est stocké avant extraction ; c'est acceptable si le bucket est réellement privé et si une politique de purge/quarantaine est ajoutée.
- Politique de rétention, export et suppression des données candidat à formaliser et à tester.

### Import et gestion du CV

[`app/api/resumes/route.ts`](../app/api/resumes/route.ts) impose authentification, PDF/DOCX et 10 Mo, conserve un statut `failed`, puis autorise la correction. Cette approche déterministe limite les hallucinations. En revanche, le parseur reste heuristique : pas d'OCR, extraction de dates/entreprises/études limitée, absence de score de confiance par champ.

Recommandation : conserver la vérité utilisateur comme référence, ajouter détection ZIP-bomb/AV, puis une extraction structurée avec confiance et diff. L'OCR ne doit être exécuté qu'en fallback pour un PDF sans texte.

### Matching

[`lib/matching/engine.ts`](../lib/matching/engine.ts) pondère huit critères et explique chaque score. C'est peu coûteux, reproductible et auditable. Limites : correspondance lexicale fragile aux synonymes et langues, demi-points accordés à certaines données inconnues, comparaison de salaire sans conversion, localisation par sous-chaîne et absence de fraîcheur.

Approche recommandée :

1. Garder ce moteur comme contraintes et baseline.
2. Corriger la sémantique des valeurs inconnues afin qu'elles n'améliorent pas artificiellement le rang.
3. Construire un jeu d'au moins 300 paires offre/profil labellisées.
4. Tester un reranker hybride lexical + embeddings derrière un flag.
5. N'adopter le reranker que s'il améliore NDCG@10/acceptation sans dégrader les contraintes dures ni l'explicabilité.

### Déduplication

[`lib/jobs/normalize.ts`](../lib/jobs/normalize.ts) crée un SHA-256 déterministe de société, titre et lieu normalisés. C'est rapide, stable et utile pour éviter les doublons exacts inter-sources. Il peut néanmoins fusionner deux postes distincts au même endroit ou rater les alias d'entreprise, variantes d'intitulé et multi-localisations.

Recommandation : conserver la clé exacte comme niveau 1, ajouter un `source_external_id` unique par source, puis une similarité de niveau 2 avec score de confiance. Seuls les cas à haute confiance peuvent être fusionnés automatiquement ; les autres doivent rester groupés visuellement ou révisables.

### Sources et données

[`lib/jobs/sources/easyjobs.ts`](../lib/jobs/sources/easyjobs.ts) implémente correctement les recherches ciblées, limite chaque page à 50, borne la page à 100, valide la réponse et conserve l'attribution. Les résultats sont marqués `manual_required`, ce qui respecte le fait qu'EasyJobs renvoie vers sa fiche.

La faiblesse est l'intégration produit : l'écran lit le catalogue local et non une recherche ciblée avec cache. De plus, `description_excerpt` et l'absence de `requirements` réduisent la qualité du matching. Il faut enrichir uniquement la petite sélection consultée, si les conditions d'utilisation le permettent, sans importer l'intégralité du catalogue.

### Fiabilité des candidatures

Le modèle local est un avantage compétitif : snapshot de dossier, hashes, file durable, lease, tentatives, état `uncertain`, réconciliation et contraintes d'unicité. Les tests de worker prouvent ces invariants en local. En revanche, le seul fait de recevoir HTTP 200 n'est pas une confirmation et aucun fournisseur réel n'est actif en production.

La règle de lancement doit rester :

- `submitted` uniquement avec reçu fournisseur, preuve visible ou déclaration explicite de l'utilisateur ;
- `uncertain` en cas d'ambiguïté ;
- remboursement automatique si un crédit a été pris et qu'aucune tentative confirmable n'a abouti ;
- aucun retry aveugle après un point d'incertitude.

### UX/UI et mobile

Les captures locales déjà validées à 390, 768 et 1440 px montrent une interface cohérente, lisible et honnête. Le parcours landing → inscription → onboarding → dashboard → swipe → dossier → assistance → suivi existe. Deux problèmes restent visibles sur 390 px : la navigation basse fixe recouvre une partie du contenu long et le libellé « Vue d'ensemble » est comprimé. [`components/app-shell.tsx`](../components/app-shell.tsx) ne réserve que `pb-20`, sans prise en compte explicite de la safe area.

Ne pas lancer une application native maintenant. Corriger d'abord la navigation mobile, ajouter manifeste/installabilité et mesurer activation/rétention sur le web.

### Coûts d'exploitation

Le noyau déterministe, Supabase et les requêtes EasyJobs ciblées ont un coût prévisible. Les principaux multiplicateurs futurs sont : appels LLM par dossier, OCR, automatisation ATS fragile, synchronisation Gmail, notifications et observabilité.

Garde-fous : cache, quotas, génération à la demande, modèles différenciés selon tâche, limites de tokens, réutilisation des artifacts approuvés, métriques de coût par dossier et aucun abonnement « illimité » tant que le coût unitaire n'est pas mesuré.

## Dix lacunes principales

| Rang | Lacune | Impact |
|---:|---|---|
| 1 | Aucune soumission ATS production confirmée | Promesse centrale non démontrée |
| 2 | Recherche EasyJobs non branchée à la demande dans le produit | Catalogue local trop petit et peu dynamique |
| 3 | Paiement, checkout et webhooks non opérationnels | Impossible de monétiser proprement |
| 4 | Inbox/recruteur et notifications non opérationnels | Boucle de suivi incomplète |
| 5 | Plafond 500 + filtrage/scoring mémoire + upserts à chaque vue | Scalabilité et latence |
| 6 | Headers, rate limiting et durcissement upload incomplets | Risque production |
| 7 | Extraction CV structurée limitée | Matching et personnalisation moins précis |
| 8 | Matching lexical sans benchmark de pertinence | Recommandations fragiles aux synonymes |
| 9 | Déduplication exacte trop grossière | Faux doublons et doublons manqués |
| 10 | Mobile web perfectible, pas de push/PWA ni i18n structurée | Activation et rétention |

## Preuve locale réutilisée

Afin de ne pas répéter les audits existants, les portes déjà documentées au commit précédent ont été réutilisées : typecheck, lint, build, 76 tests réussis avec 7 ignorés, 7/7 intégrations Supabase et 34/34 pgTAP dans [`UX_UI_PREMIUM_VALIDATION_2026-10-22.md`](./UX_UI_PREMIUM_VALIDATION_2026-10-22.md). Le relevé sources est celui de [`FRANCE_SOURCE_BENCHMARK_2026-10-23.md`](./FRANCE_SOURCE_BENCHMARK_2026-10-23.md). Le présent audit n'affirme pas que ces preuves historiques couvrent un environnement production.

## Position face à Sprout

- **En avance** : vérité des statuts, explicabilité, contraintes de données, dossier immuable, modèle de retry/réconciliation, contrats français.
- **À parité partielle** : onboarding, CV, swipe, préparation et dashboard, mais sans validation authentifiée de Sprout ni comparaison qualité à qualité.
- **En retard** : volume/fraîcheur du catalogue visible, OAuth, génération assistée riche, inbox, notifications, facturation et résultat réel de soumission.
- **Non comparable** : vitesse, taux de succès, précision du matching et qualité des documents Sprout, faute de données indépendantes.

Les actions et critères de sortie sont détaillés dans [la roadmap](./SPROUT_IMPLEMENTATION_ROADMAP.md).
