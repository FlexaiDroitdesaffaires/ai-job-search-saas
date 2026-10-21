# AI Job Search SaaS

Le contrat produit et les règles de fiabilité sont dans
[`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

## Prérequis

- Node.js 22 ou supérieur ;
- pnpm 12.3.4 via Corepack ;
- Docker Desktop. La CLI Supabase compatible est verrouillée dans les
  dépendances de développement.

## Installation

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm exec supabase status
corepack pnpm dev
```

Reporter dans `.env.local` l'API URL et la clé publique `anon` affichées par
`supabase status`. Ne jamais placer de clé `service_role` dans une variable
`NEXT_PUBLIC_*` ni dans le navigateur.

`supabase:reset` utilise explicitement `--local` et détruit uniquement la base
locale ciblée. Vérifier que les URL affichées par `supabase status` utilisent
`127.0.0.1` avant de l'exécuter. L'application ne lance jamais automatiquement
une migration ou un reset. Studio est exclu du démarrage, car il n'est pas
requis pour Auth, Postgres, REST ou Storage.

## Vérifications

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:db
corepack pnpm test:supabase
```

Les tests SQL nécessitent les conteneurs Supabase locaux. Ils couvrent les RLS,
l'isolation des CV, les privilèges, le registre de crédits et l'idempotence des
soumissions et décisions. `test:supabase` crée des comptes éphémères, des offres
de test et des fichiers PDF/DOCX non sensibles, puis les supprime à la fin du
test.

## Ingestion locale d'offres réelles

Après avoir démarré Supabase et appliqué les migrations locales :

```bash
corepack pnpm exec supabase migration up --local
corepack pnpm jobs:ingest:local -- --limit=20 --max-age-days=45
```

Le script refuse toute cible non locale et toute exécution sans `--local`. Il
importe le flux public Remote OK, vérifie les URL, écarte les offres anciennes
et effectue un upsert idempotent. Remote OK doit être crédité et chaque offre
doit conserver son lien source. Voir [`docs/JOB_INGESTION.md`](./docs/JOB_INGESTION.md).

## Parcours disponible

- inscription, connexion, déconnexion et renouvellement SSR de session ;
- routes `/onboarding` et `/dashboard` protégées ;
- découverte d’offres réelles sur `/dashboard/jobs`, matching explicable et
  attribution Remote OK ;
- refus persistant sans candidature et acceptation atomique créant uniquement
  un brouillon de candidature ;
- préparation déterministe automatique après acceptation lorsque le profil et
  le CV sont complets ;
- CV ciblé et lettre modifiables, exportables en PDF textuel ;
- présélection traçable, dossier versionné, empreinte SHA-256 et approbation
  explicite sans envoi ;
- file de soumission durable, claims atomiques, reprise après crash et
  réconciliation, testés uniquement avec un adaptateur local marqué `TEST` ;
- identité, expériences, compétences et préférences ;
- import privé PDF/DOCX de 10 Mo maximum ;
- extraction déterministe et correction manuelle des données de CV.

L'extraction et le matching ne produisent pas de nouvelles qualifications : ils
classent et comparent uniquement les données présentes. Aucun adaptateur de
candidature réelle n'est branché. L'adaptateur D1 ne contacte aucun service et
ses confirmations de test ne changent jamais une candidature en `submitted`.

Le fonctionnement détaillé du dossier et ses garanties d’immutabilité sont
documentés dans [`docs/APPLICATION_PREPARATION.md`](./docs/APPLICATION_PREPARATION.md).
Le contrat, les garanties du worker et son mode local sont détaillés dans
[`docs/SUBMISSION_ENGINE.md`](./docs/SUBMISSION_ENGINE.md). Les fournisseurs
pressentis, sans intégration active, sont comparés dans
[`docs/ATS_PROVIDER_CANDIDATES.md`](./docs/ATS_PROVIDER_CANDIDATES.md).
