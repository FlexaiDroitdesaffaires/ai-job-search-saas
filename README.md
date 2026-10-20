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
soumissions. `test:supabase` crée des comptes éphémères et des fichiers PDF/DOCX
non sensibles, puis les supprime à la fin du test.

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
- identité, expériences, compétences et préférences ;
- import privé PDF/DOCX de 10 Mo maximum ;
- extraction déterministe et correction manuelle des données de CV.

L'extraction ne produit pas de nouvelles qualifications : elle classe le texte
présent dans le document. Un connecteur d'offres Remote OK est validé localement.
Aucun adaptateur de candidature réelle n'est encore branché.
