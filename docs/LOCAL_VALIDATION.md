# Validation locale Supabase — 2026-10-20

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
