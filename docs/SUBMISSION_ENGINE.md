# Moteur de soumission — Lot D1

## Limite de sécurité

Le Lot D1 ne contient aucun adaptateur ATS réel. `local-test-ats` est limité à
l'environnement `test`, ne fait aucun appel réseau et produit des références
préfixées `TEST-`. Une confirmation de test reste visible comme test local :
elle ne passe pas la candidature à `submitted`, ne crée pas de preuve réelle et
n'entre pas dans les métriques de soumissions réelles.

Le lanceur `pnpm submissions:worker:local` exige `--local`, lit la configuration
de la CLI Supabase locale et refuse tout hôte différent de `127.0.0.1` ou
`localhost`.

## Contrat d'adaptateur

`lib/submissions/adapter.ts` définit le contrat commun :

- exposer les capacités et environnements pris en charge ;
- valider le dossier approuvé sans compléter une donnée manquante ;
- produire un payload stable et son empreinte ;
- soumettre avec une clé d'idempotence durable ;
- interpréter le résultat métier du fournisseur ;
- réconcilier un résultat incertain lorsque le fournisseur le permet.

Un succès recevable contient une confirmation métier, un identifiant externe,
l'identité de l'adaptateur, l'empreinte exacte du dossier, un horodatage et
l'environnement. Un code HTTP réussi ne suffit jamais.

## File durable et reprise

La file est portée par `application_submissions`. Les RPC serveur revendiquent
une ligne avec verrou `FOR UPDATE SKIP LOCKED`, propriétaire de claim et bail.
La clé `(application, fournisseur)` empêche une deuxième soumission active ; la
clé d'idempotence est aussi unique.

- crash avant dispatch externe : le bail expiré autorise un retry sûr ;
- crash avant dispatch à la dernière tentative : échec clôturé, sans ligne
  bloquée dans la file ;
- crash après dispatch : le bail expiré bascule vers
  `requires_reconciliation` et interdit un second envoi automatique ;
- erreur temporaire avant effet externe : backoff et limite de tentatives ;
- refus confirmé : `failed` ;
- résultat peut-être réussi : `requires_reconciliation`, jamais `failed`
  automatiquement ;
- vérification impossible ou négative : `needs_manual_action`.

Chaque transition est inscrite dans `application_submission_events`. Les RPC de
worker sont réservées au rôle serveur. Les utilisateurs ne peuvent lire que
leurs propres soumissions et événements par RLS.

Une réconciliation relit le snapshot exact par son empreinte, y compris si une
nouvelle version du dossier l'a depuis rendu `superseded`. Elle ne soumet pas la
nouvelle version et ne rejoue jamais l'appel externe incertain.

## Adaptateur local

Scénarios disponibles : `confirmed`, `provider_rejection`,
`timeout_before_send`, `timeout_after_send`, `success_without_confirmation`,
`duplicate`, `crash_before_submit`, `crash_after_submit`,
`retry_then_confirm`, `reconcile_positive` et `reconcile_negative`.

Exemple, sur la pile locale uniquement :

```bash
corepack pnpm submissions:worker:local -- --once --scenario=confirmed
```

Le script traite seulement une soumission déjà mise en file. Il ne crée pas
d'autorisation utilisateur et ne transforme pas un dossier non approuvé.

## Préparation Greenhouse — Lot D2

`GreenhouseAdapter` réutilise le contrat D1 sans être enregistré dans le
worker. Il reconnaît uniquement les URL de board Greenhouse explicitement
autorisées, charge le formulaire public `?questions=true`, mappe les données
confirmées du dossier et prépare `resume_text` / `cover_letter_text`. Une
empreinte du formulaire fait partie du payload préparé.

Une question, une donnée de localisation cachée ou un consentement obligatoire
absent bloque la préparation. La clé Job Board reste côté serveur. Même avec
une clé et une allowlist, l’adaptateur expose `supportsIdempotencyKey=false` et
`canVerifyConfirmation=false` : D1 refuse donc de l’enqueue. Un HTTP 2xx serait
enregistré comme résultat incertain, jamais comme preuve. Aucun POST externe
n’est activé ou exécuté dans ce lot.
