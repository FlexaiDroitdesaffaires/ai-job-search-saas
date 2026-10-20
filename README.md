# AI Job Search SaaS

Le contrat produit et les règles de fiabilité sont dans
[`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

## Prérequis

- Node.js 22 ou supérieur ;
- pnpm 12.3.4 via Corepack ;
- Docker Desktop et Supabase CLI pour la base locale.

## Installation

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase db reset
supabase status
corepack pnpm dev
```

Reporter dans `.env.local` l'API URL et la clé publique `anon` affichées par
`supabase status`. Ne jamais placer de clé `service_role` dans une variable
`NEXT_PUBLIC_*` ni dans le navigateur.

`supabase db reset` détruit uniquement la base locale ciblée. Vérifier l'URL
locale avant de l'exécuter. L'application ne lance jamais automatiquement une
migration ou un reset.

## Vérifications

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
supabase test db
```

Les tests SQL nécessitent les conteneurs Supabase locaux. Ils couvrent les RLS,
l'isolation des CV, les privilèges, le registre de crédits et l'idempotence des
soumissions.

## Parcours disponible

- inscription, connexion, déconnexion et renouvellement SSR de session ;
- routes `/onboarding` et `/dashboard` protégées ;
- identité, expériences, compétences et préférences ;
- import privé PDF/DOCX de 10 Mo maximum ;
- extraction déterministe et correction manuelle des données de CV.

L'extraction ne produit pas de nouvelles qualifications : elle classe le texte
présent dans le document. Aucun adaptateur d'offres ou de candidature réelle
n'est encore branché.
