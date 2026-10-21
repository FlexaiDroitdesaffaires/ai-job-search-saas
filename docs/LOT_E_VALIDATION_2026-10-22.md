# Lot E — validation candidature assistée et suivi

Date : 22 octobre 2026

Base : `develop` à partir de `a9f1a26`

Environnement : Next.js et Supabase exclusivement locaux

## Résultat

Le parcours assisté est opérationnel pour un dossier approuvé. L’utilisateur
peut ouvrir l’URL HTTPS stockée sur la candidature uniquement lorsqu’elle
correspond à `source_url` ou `application_url` de l’offre liée, télécharger les
deux PDF, copier les réponses préparées puis déclarer `envoyée`, `pas encore
envoyée` ou `impossible`.

Le test navigateur a ouvert l’offre RemoteOK par un GET, sans remplir ni
soumettre de formulaire externe. Seule la décision locale `not_sent` a été
enregistrée. Contrôle SQL final : candidature `prepared` / dossier `approved`,
`submitted_at` nul, `submission_evidence` nulle et 0 ligne dans
`application_submissions`.

## Garanties de preuve

- Une déclaration `sent` réutilise exclusivement `record_manual_submission`.
- La preuve contient `confirmed_by_user: true`, sans identifiant ni preuve
  fournisseur.
- Une confirmation adaptateur conserve `method = adapter` et reste affichée
  séparément comme confirmation fournisseur.
- Une confirmation locale `environment = test` reste explicitement exclue des
  confirmations réelles.
- Les RPC refusent une décision avant l’ouverture, un dossier non approuvé, une
  URL différente de l’offre et une candidature appartenant à un autre compte.
- Les replays d’ouverture et de décision ne créent ni second état, ni second
  événement, ni seconde soumission manuelle.
- Le moteur D1 et son worker ne sont pas modifiés.

## Suivi

Le tableau affiche entreprise, poste, date, statut, source, liens vers les
documents, mode, origine de confirmation et les trois derniers événements. Il
utilise un tableau sur ordinateur et des cartes à 390 px. L’unicité existante
`applications(user_id, job_id)` continue d’empêcher les doublons.

## Validation

- `pnpm typecheck` : réussi.
- `pnpm lint` : réussi.
- `pnpm test` : 10 fichiers réussis, 76 tests réussis, 7 tests optionnels
  ignorés.
- `pnpm test:supabase` : 2 fichiers, 7 tests réussis.
- `pnpm test:db` : 34/34 assertions pgTAP réussies.
- `pnpm build` : réussi.
- Navigateur : URL officielle, activation après ouverture, copie, deux
  téléchargements `%PDF-`, persistance `not_sent`, historique et vues desktop
  et mobile vérifiés.
- Données : 29 offres réelles actives conservées, 55 lignes totales incluant
  les fixtures historiques, 0 soumission après validation.

## Captures

- `01-suivi-desktop.jpg`
- `02-parcours-assiste-desktop.jpg`
- `03-decision-pas-encore-desktop.jpg`
- `04-parcours-assiste-mobile.jpg` — viewport effectif 390 × 751.
- `05-suivi-mobile.jpg` — viewport effectif 390 × 751.

Les fichiers sont dans `docs/e2e-evidence/2026-10-22/`.

## Passage en production

Avant le premier usage réel : appliquer la migration additive sur
l’environnement autorisé, configurer les variables Supabase de production,
valider les politiques RLS sur une copie représentative, puis faire un test
manuel contrôlé avec un utilisateur pilote. La première déclaration `sent`
doit être effectuée uniquement après un envoi réellement réalisé par cet
utilisateur sur le site employeur. Aucun POST ATS n’est nécessaire pour ce
parcours assisté.
