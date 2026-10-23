# Roadmap d'implémentation recommandée

**Cette roadmap n'autorise aucune implémentation.** Elle ordonne les décisions et les incréments à réaliser seulement après accord. Référence : `develop` à `8b004b2`.

## Règles de conduite

- Conserver l'état `submitted` fondé sur une preuve, jamais sur une intention ou un HTTP 200.
- Conserver le matching déterministe, les snapshots/hashes, RLS et le worker durable.
- EasyJobs reste un fournisseur de recherche ciblée ; aucun miroir intégral dans Supabase.
- Un seul risque produit par incrément, avec flag et rollback.
- Pas de refonte, d'app native, de nouvel orchestrateur ni d'auto-apply navigateur générique avant preuve du besoin.

Effort indicatif : **S** 1–3 jours, **M** 1–2 semaines, **L** 3–6 semaines, **XL** plus de 6 semaines. Il s'agit d'ordre de grandeur pour une petite équipe connaissant le dépôt, pas d'un devis.

## Les dix meilleures améliorations

### 1. P0 — Définir et prouver le mode de lancement

- **Problème résolu** : la soumission ATS production n'est pas opérationnelle, alors que la valeur commerciale doit être exacte.
- **Approche** : décider entre un lancement assisté explicite et un pilote sur un ATS officiellement autorisé. Dans les deux cas, formaliser la machine d'état et les preuves acceptables.
- **Fichiers concernés** : `README.md`, `app/dashboard/applications/[id]/page.tsx`, `app/dashboard/page.tsx`, `lib/submissions/*`, `tests/submission-worker-supabase.integration.test.ts` et documentation produit.
- **Effort** : S pour cadrage + M pour durcir le lancement assisté ; L pour un adaptateur ATS autorisé et réconciliable.
- **Risques** : promesse trompeuse, double soumission, conditions d'utilisation, support sur états incertains.
- **Validation** : zéro statut `submitted` sans reçu/déclaration ; 20 parcours assistés pilotes sans ambiguïté ; pour l'ATS, sandbox puis petit pilote consenti avec reçus et réconciliation, jamais par simple HTTP 200.

### 2. P0 — Recherche EasyJobs ciblée, paginée et mise en cache

- **Problème résolu** : l'UI ne bénéficie pas du catalogue dynamique ; les 500 dernières lignes locales sont filtrées après lecture.
- **Approche** : appeler le connecteur côté serveur selon recherche/préférences, cache court par paramètres, normaliser, dédupliquer avec le catalogue local et n'enrichir que la page consultée.
- **Fichiers concernés** : `lib/jobs/sources/easyjobs.ts`, `lib/jobs/filters.ts`, `app/dashboard/jobs/page.tsx`, nouveau module serveur de cache/recherche, tests sources et intégration.
- **Effort** : M.
- **Risques** : quota fournisseur, latence, résultats instables, droits d'usage, description tronquée.
- **Validation** : ≤ 50 offres/page, pagination stable, attribution visible, cache et timeout testés, aucune ingestion en masse, aucun doublon exact, fallback local si fournisseur indisponible.

### 3. P0 — Baseline sécurité, confidentialité et observabilité

- **Problème résolu** : headers, rate limits, upload DOCX et visibilité opérationnelle incomplets.
- **Approche** : CSP/HSTS/anti-framing, limitation par utilisateur/IP, validation archive et quarantaine/AV, purge, traces serveur sans PII et alertes sur erreurs/retries.
- **Fichiers concernés** : `next.config.mjs`, `app/api/resumes/route.ts`, `lib/resume/extract.ts`, middleware/proxy, configuration Supabase/storage, nouveaux modules d'observabilité et tests sécurité.
- **Effort** : M–L.
- **Risques** : CSP trop restrictive, faux positifs AV, stockage de télémétrie personnelle, dépendance au rate limiter.
- **Validation** : suite automatisée de headers, limites 429, ZIP-bomb/corruptions refusées, purge vérifiée, aucune donnée CV dans les traces, dashboards p50/p95 et erreurs fournisseur.

### 4. P0 — Facturation et crédits auditables

- **Problème résolu** : le schéma Stripe/ledger existe, mais pas le checkout, les webhooks et le portail client.
- **Approche** : choisir l'événement facturé, implémenter checkout + webhooks idempotents + portail/résiliation, afficher coût avant action et remboursement automatique.
- **Fichiers concernés** : routes/API billing à créer, pages pricing/compte, `supabase/migrations/20261019000000_core_schema.sql` uniquement via future migration additive, tests webhooks/ledger.
- **Effort** : L.
- **Risques** : fiscalité/TTC, doubles événements, chargebacks, incohérence quota/ledger, obligations consommateur.
- **Validation** : scénarios test Stripe checkout/renewal/cancel/refund/replay ; somme du ledger égale au solde ; aucun secret côté client ; résiliation et export de facture accessibles.

### 5. P1 — Inbox, timeline et notifications utiles

- **Problème résolu** : le suivi s'arrête aux événements locaux ; les réponses recruteur et actions suivantes ne reviennent pas dans le produit.
- **Approche** : connecter Gmail avec scopes minimaux ou un canal inbound choisi, parser avec limites, rattacher avec confiance, créer notification/inbox et laisser l'utilisateur corriger.
- **Fichiers concernés** : tables existantes `email_connections`, `recruiter_messages`, `notifications`, nouvelles routes OAuth/webhooks, `app/dashboard/*`, jobs asynchrones et tests MIME.
- **Effort** : L.
- **Risques** : OAuth, données sensibles, faux rattachement, doublons, révocation et support.
- **Validation** : corpus de messages, déduplication par message ID, révocation complète, rattachement ambigu jamais automatique, notification idempotente, politique de rétention testée.

### 6. P1 — Extraction CV structurée et sûre

- **Problème résolu** : l'extraction heuristique limite matching et personnalisation ; DOCX/scan sont des surfaces de risque.
- **Approche** : normaliser vers un schéma versionné, confiance par champ, diff/correction utilisateur, OCR uniquement en fallback et limites de ressources.
- **Fichiers concernés** : `lib/resume/extract.ts`, `lib/resume/parser.ts`, `lib/resume/schema.ts`, `app/api/resumes/route.ts`, UI onboarding/CV et fixtures anonymisées.
- **Effort** : M–L.
- **Risques** : hallucination de dates, coût OCR, biais linguistique, perte de champs français.
- **Validation** : corpus PDF/DOCX/scan FR/EN, précision par champ, aucune valeur faible-confiance appliquée sans revue, temps/mémoire bornés et round-trip des corrections.

### 7. P1 — Matching hybride évalué

- **Problème résolu** : synonymes, multilingue et variantes d'intitulés échappent au moteur lexical.
- **Approche** : clarifier valeurs inconnues, dictionnaire de compétences, contraintes dures, puis pilote embeddings/pgvector comme reranker derrière flag.
- **Fichiers concernés** : `lib/matching/engine.ts`, `lib/matching/types.ts`, stockage/version des matchs, scripts d'évaluation et tests.
- **Effort** : M pour baseline, L pour pilote labellisé.
- **Risques** : coût, dérive, explication fausse, biais et surclassement d'une incompatibilité dure.
- **Validation** : ≥ 300 paires labellisées, NDCG@10/recall@20 et acceptation supérieurs à la baseline, aucun conflit sur contrat/localisation, latence et coût plafonnés.

### 8. P1 — Génération de documents contrainte et diffable

- **Problème résolu** : les documents déterministes sont fiables mais moins naturels/personnalisés que la promesse Sprout.
- **Approche** : génération fondée uniquement sur faits sourcés du profil/CV/offre, schéma structuré, diff, citations internes, validation humaine et fallback déterministe.
- **Fichiers concernés** : `lib/application-preparation/*`, pages dossier/édition, journal `ai_generation_logs`, exports PDF/DOCX et tests d'évaluation.
- **Effort** : L.
- **Risques** : hallucinations, fuite PII, coûts, prompts malveillants contenus dans une offre, régression du rendu.
- **Validation** : zéro fait inventé sur corpus adversarial, chaque ajout rattaché à une source, utilisateur peut accepter/rejeter par bloc, budget tokens et latence mesurés, modèle désactivable.

### 9. P1 — Déduplication multi-niveaux

- **Problème résolu** : la clé société+titre+lieu fusionne parfois trop et rate les variantes.
- **Approche** : identité source stricte, clé canonique actuelle, alias contrôlés, similarité avec confiance et groupe de doublons réversible.
- **Fichiers concernés** : `lib/jobs/normalize.ts`, ingestion scripts, schéma `job_listings` via future migration additive, UI groupe/choix et tests de corpus.
- **Effort** : M.
- **Risques** : perte d'offres distinctes, décisions swipe partagées à tort, migration des clés.
- **Validation** : corpus labellisé multi-source, précision/recall publiés, aucune fusion automatique sous seuil élevé, historique de décision préservé et rollback documenté.

### 10. P1/P2 — Mobile web, accessibilité et internationalisation

- **Problème résolu** : barre basse recouvrante, libellés comprimés, pas d'installabilité/push ni de structure i18n.
- **Approche** : safe-area et espace bas mesuré, audit clavier/lecteur d'écran, catalogue de messages FR/EN, manifeste PWA ; push seulement après opt-in et métrique de valeur.
- **Fichiers concernés** : `components/app-shell.tsx`, layouts/styles, composants dashboard/jobs, manifeste/service worker éventuel, messages i18n et tests visuels.
- **Effort** : S pour chevauchement, M pour accessibilité/i18n, M–L pour PWA/push.
- **Risques** : cache obsolète, fatigue notification, explosion des chaînes, régression responsive.
- **Validation** : captures 375/390/768/1024/1440 sans contenu masqué, safe-area iOS, navigation clavier complète, axe sans violation critique, traduction sans clés brutes, opt-in push révocable.

## Séquencement proposé

### Gate 0 — décisions, 1 semaine

- Choisir lancement assisté ou ATS pilote.
- Fixer l'événement facturé et le contrat de remboursement.
- Valider les usages EasyJobs, Gmail, LLM et durées de rétention.
- Définir les cinq KPI de lancement et seuils d'arrêt.

### Lot P0 — lancement honnête, 4 à 8 semaines

1. Sécurité/observabilité.
2. Recherche EasyJobs ciblée et scalable.
3. Parcours assisté prouvé **ou** adaptateur ATS autorisé unique.
4. Facturation testée, si lancement payant.

**Stop condition** : ne pas ouvrir au public si un statut peut être faux, si les crédits ne se réconcilient pas, si les CV ne peuvent pas être supprimés ou si la recherche dépend d'un miroir EasyJobs.

### Lot P1 — avantage concurrentiel, 6 à 12 semaines après données pilotes

Inbox/notifications, extraction CV, matching hybride, documents contraints et déduplication. Chaque lot doit être activé séparément et comparé à la baseline.

### Lot P2 — optimisation

PWA/push, modèles PDF avancés et confort secondaire seulement après activation, coût unitaire et rétention mesurés.

## Trois prochaines actions prioritaires

1. **Atelier de décision documenté** : mode de lancement, preuve de soumission, événement facturé, remboursement et SLA `uncertain`.
2. **Spécification P0 sécurité + recherche ciblée** : architecture sans miroir EasyJobs, budgets, cache, headers, rate limits, upload et télémétrie sans PII.
3. **Pilote fermé mesurable** : 20 utilisateurs en assisté, ou un seul ATS autorisé en sandbox puis cohorte consentie ; collecter pertinence, dossiers approuvés, actions confirmées, réponses et coûts.

## Décisions nécessitant validation explicite

- Autorisation de commencer un lot et ordre exact.
- Lancement assisté ou promesse ATS.
- Fournisseur et conditions d'un pilote ATS.
- Plans/prix/quota et moment du débit.
- Fournisseur LLM, région de traitement et DPA.
- Gmail OAuth/alias, scopes et rétention.
- Politique RGPD, délai de purge et besoin de DPIA.
- Adoption de JSON Resume, OpenTelemetry, pgvector ou Reactive Resume après revue licence/sécurité.
- Seuils de fusion de doublons et métriques du matching.
- PWA avant éventuelle application native.

## NO-GO

- Auto-apply navigateur générique, contournement CAPTCHA ou login.
- Marquer `submitted` sur une redirection, un swipe ou un HTTP 200.
- Importer l'intégralité d'EasyJobs dans Supabase.
- Remplacer le worker par Temporal/Trigger.dev/PGMQ sans incident ou seuil démontré.
- Remplacer le matching explicable par un score LLM/vectoriel opaque.
- ScrapeGraphAI tant qu'une API officielle structurée existe.
- App mobile native, marketplace recruteur ou refonte globale avant product-market fit.
- Abonnement illimité et candidatures en masse non ciblées.
- Déduire des données sensibles ou scraper LinkedIn sans autorisation.

## Résultat attendu

À l'issue du P0, le produit doit pouvoir vendre une promesse étroite mais vraie : recherche française ciblée, matching explicable, dossier contrôlé, action de candidature dont l'état est vérifiable et facturation réconciliée. Le P1 doit ensuite battre Sprout sur la qualité et la confiance, pas seulement sur le volume.
