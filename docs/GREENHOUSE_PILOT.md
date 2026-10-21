# Préparation du pilote Greenhouse

État au 21 octobre 2026 : **préparé, non autorisé à envoyer**. Aucun POST
Greenhouse n'a été exécuté.

## Contrat officiel vérifié

La documentation officielle du Job Board API décrit :

- `GET /v1/boards/{board_token}/jobs/{id}?questions=true` pour construire le
  formulaire spécifique à l'offre ;
- `POST /v1/boards/{board_token}/jobs/{id}` avec authentification Basic côté
  serveur ;
- les pièces jointes JSON `resume_content` / `resume_content_filename` et
  `cover_letter_content` / `cover_letter_content_filename`, dont le contenu est
  encodé en Base64 ;
- la validation des champs obligatoires à la charge du client : Greenhouse
  précise qu'il ne rejettera pas nécessairement une candidature incomplète.

Source : <https://developers.greenhouse.io/job-board.html#submit-an-application>

La même documentation ne décrit ni clé d'idempotence, ni identifiant de
candidature garanti dans la réponse, ni endpoint Job Board de lecture d'une
candidature soumise. Un HTTP 2xx ne permet donc ni confirmation probante, ni
réconciliation automatique.

## Configuration serveur du pilote

La construction de `GreenhouseAdapter` doit rester exclusivement côté serveur.
Les valeurs suivantes doivent être fournies par l'employeur pilote, sans
jamais être préfixées `NEXT_PUBLIC_` :

| Champ | Valeur attendue | Gate |
| --- | --- | --- |
| `boardToken` | Token exact du board employeur | Board explicitement allowlisté |
| `allowedJobIds` | Ensemble contenant uniquement l'ID de l'offre de test | Une seule offre pilote active |
| `apiKey` | Clé Job Board API employeur | Secret serveur uniquement |
| `employerAuthorizationId` | Référence interne du document d'autorisation | Document écrit archivé et encore valide |
| `fieldMappings` | Mapping des réponses confirmées vers les noms officiels `question_*` et consentements | Dérivé du GET courant avec `questions=true` |
| `submissionEnabled` | `false` par défaut | Ne peut passer à `true` qu'après tous les contrôles ci-dessous |

Exemple non exécutable, sans secret :

```ts
new GreenhouseAdapter({
  boardToken: "EMPLOYER_BOARD_TOKEN",
  allowedJobIds: new Set(["AUTHORIZED_TEST_JOB_ID"]),
  apiKey: serverSecret,
  employerAuthorizationId: "WRITTEN-AUTHORIZATION-REFERENCE",
  fieldMappings: verifiedFieldMappings,
  submissionEnabled: false,
})
```

## Checkpoint avant un premier envoi réel

Tous les points doivent être prouvés au même instant :

1. autorisation écrite de l'employeur couvrant le board, l'offre, le candidat
   de test, les pièces jointes et la date du pilote ;
2. offre de test ouverte, identifiant et board allowlistés sans wildcard ;
3. clé Job Board valide, stockée uniquement côté serveur ;
4. formulaire officiel relu immédiatement avant préparation, avec chaque champ
   obligatoire, champ caché et consentement mappé à une donnée confirmée ;
5. dossier utilisateur approuvé et immuable, empreinte inchangée, CV et lettre
   PDF Base64 décodables avec signature `%PDF` ;
6. approbation explicite de l'utilisateur pour cette version et cette offre ;
7. absence de soumission antérieure vérifiée côté produit et côté employeur ;
8. mécanisme fournisseur contractuel permettant d'empêcher un doublon et de
   confirmer ou réconcilier la soumission.

Le point 8 n'est pas satisfait par l'API publique actuelle. La clé interne D1
empêche les doubles enqueues locaux, mais elle n'est pas transmise ni reconnue
par Greenhouse et ne protège pas contre un résultat réseau incertain après
dispatch.

## Conséquence pour D1

`GreenhouseAdapter` réutilise le contrat du worker D1, mais déclare
`supportsIdempotencyKey=false` et `canVerifyConfirmation=false`. Le worker D1
refuse donc son enqueue avant tout appel externe. Cette barrière doit rester en
place tant que l'employeur ou Greenhouse ne fournit pas un contrat vérifiable
d'idempotence et de confirmation/réconciliation.

Sans ce contrat, le premier pilote doit rester un parcours manuel via le
formulaire employeur, et le produit ne doit jamais afficher `submitted` sur la
base d'un simple HTTP 2xx.
