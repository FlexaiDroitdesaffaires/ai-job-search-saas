# Validation locale Supabase — 2026-10-21

## Périmètre et cible

- Docker Desktop 29.8.0 ;
- Supabase CLI 2.121.0 verrouillée dans le projet ;
- API et PostgreSQL vérifiés sur `127.0.0.1` ;
- aucun `supabase/.temp/project-ref` et aucune commande `--linked` ;
- aucune migration distante, aucun déploiement et aucune candidature envoyée.

## Résultats

- démarrage local : réussi avec Studio exclu ;
- `supabase db reset --local` : réussi, migration et seed appliqués ;
- pgTAP : 28/28 assertions réussies ;
- inscription, déconnexion, reconnexion, session et identité : réussies avec
  deux comptes locaux éphémères ;
- RLS profils et CV entre les deux comptes : réussie ;
- accès anonyme refusé et accès `service_role` local vérifié ;
- bucket `resumes` privé : vérifié ;
- génération, extraction, upload et téléchargement propriétaire d'un PDF et
  d'un DOCX non sensibles : réussis ;
- téléchargement tiers et upload dans le dossier tiers : refusés ;
- build HTTP local : `/`, `/login` et `/signup` répondent `200` ; `/dashboard`
  et `/onboarding` redirigent sans session vers `/login` avec leur paramètre
  `next` ;
- TypeScript, lint et build : réussis ;
- tests standards : 23 réussis, test Supabase réel volontairement séparé ;
- nettoyage vérifié : 0 utilisateur éphémère et 0 objet CV restant.

## Validation ingestion — 2026-10-20

- migration locale `20261020000000_job_ingestion` appliquée sans reset ;
- flux public Remote OK : 99 enregistrements reçus lors du contrôle ;
- fenêtre de 45 jours : 30 enregistrements anciens écartés ;
- lot volontairement limité à 5 : 5 URL HTTPS réellement vérifiées ;
- premier passage : 5 insertions ; second passage : 0 insertion et 5 mises à
  jour ;
- contrôle PostgreSQL : 5 lignes, 5 identifiants fournisseur distincts,
  5 offres actives vérifiées et aucun doublon `(provider, external_id)`.

Ces offres sont réelles et stockées uniquement dans l'instance locale. Elles ne
constituent ni des candidatures acceptées, ni préparées, ni soumises.

## Validation matching et swipe — 2026-10-20

- migration locale `20261021000000_matching_swipe` appliquée avec
  `supabase migration up --local`, sans reset ;
- moteur de matching déterministe : stabilité, données absentes et offre
  incompatible testées ;
- décision réelle via GoTrue/PostgREST local : refus sans candidature,
  acceptation avec brouillon, replay et deux appels concurrents réussis sans
  doublon ;
- RLS : décisions, candidatures et scores d’un utilisateur invisibles à
  l’autre ; écriture d’un score pour autrui refusée ;
- persistance après recréation du client et restauration de session vérifiée ;
- toutes les candidatures créées par le swipe restent `saved` / `draft`, sans
  preuve ni faux état `submitted` ;
- tests standards : 37 réussis et 2 tests locaux opt-in ignorés dans la commande
  standard ; tests Supabase réels : 2 réussis ; pgTAP : 28/28 ;
- TypeScript, lint et build de production, incluant `/dashboard/jobs` : réussis.
- contrôle HTTP local : `/dashboard/jobs` sans session répond `307` vers
  `/login?next=%2Fdashboard%2Fjobs`.

Le geste et les boutons sont implémentés et compilés. La validation automatisée
couvre leur backend transactionnel et la protection anti-double action ; un
test navigateur gestuel dédié reste à ajouter si une suite E2E est introduite.
Le navigateur intégré n’était pas disponible dans cet environnement ; aucune
validation visuelle manuelle n’est donc revendiquée.

## Validation préparation et approbation — 2026-10-20

- migration locale `20261022000000_application_preparation` appliquée avec
  `supabase migration up --local`, sans reset ;
- acceptation suivie d’une préparation automatique testée avec un profil, un CV
  et une offre fictifs non sensibles ;
- extraction déterministe des exigences, comparaison au profil et absence de
  qualification ajoutée testées ;
- CV ciblé et lettre générés en PDF A4 textuel : extraction ATS automatisée,
  rendu PNG et inspection visuelle sans coupure ni superposition ;
- empreinte SHA-256 stable, recalcul PostgreSQL, rejet d’un hash falsifié et
  replay d’une préparation identique vérifiés ;
- replay d’une acceptation après préparation : même candidature et même état,
  sans retour en brouillon ni nouvelle version automatique ;
- approbation bloquée par téléphone manquant, puis acceptée après réponse
  confirmée ;
- snapshot approuvé immuable même via `service_role` local ; nouvelle version
  après correction : ancien snapshot `superseded` et application revenue en
  `ready_for_review` ;
- isolation RLS des dossiers entre deux utilisateurs vérifiée ;
- aucune ligne `application_submissions`, aucun `submitted_at` et aucune preuve
  de soumission créés par le parcours ;
- tests standards : 47 réussis et 3 tests locaux opt-in ignorés dans la commande
  standard ; tests Supabase réels : 3 réussis ; pgTAP : 28/28 ;
- TypeScript, lint et build de production réussis, incluant les routes de
  préparation et d’export PDF.
- contrôle HTTP sans session : page dossier `307` vers `/login` et export PDF
  `401` ; aucune donnée de candidature n’est exposée anonymement.
- suppression d’un compte de test porteur de trois versions de dossier :
  validée via GoTrue après correction additive des références documentaires et
  du trigger de présélection ; nettoyage final strict sans fixture résiduelle.

## Particularité de l'environnement

Docker Desktop refuse les bind mounts depuis ce dossier `Documents`. Studio est
donc exclu et le test pgTAP est envoyé à `psql` via l'entrée standard du
conteneur local. Cela ne réduit pas la couverture SQL ; le script vérifie le
plan `1..28`, les 28 lignes `ok` et l'absence de `not ok`.

Les résultats courants se reproduisent avec :

```bash
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm test:db
corepack pnpm test:supabase
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```
