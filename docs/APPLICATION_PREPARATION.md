# Préparation des candidatures

## Déclenchement

Après une acceptation, l’action serveur tente immédiatement une préparation
déterministe. Si le profil, l’offre ou le CV validé est incomplet, l’acceptation
reste enregistrée et la candidature reste `saved` / `draft`; l’utilisateur peut
corriger ses données puis relancer la préparation depuis le suivi.

Un retry de la même acceptation retourne la candidature existante dans son état
courant. Il ne relance pas la préparation automatique et ne peut donc ni créer
une version supplémentaire, ni invalider une approbation existante.

Aucun appel LLM, aucun adaptateur ATS et aucun envoi externe n’est effectué dans
ce lot.

## Analyse factuelle

Le moteur réutilise le score du Lot B et analyse uniquement :

- `job_listings.requirements` et le texte réel de l’offre ;
- les compétences, expériences et préférences enregistrées ;
- le profil et le CV corrigé par l’utilisateur.

Les critères contenant une formulation obligatoire sont identifiés par des
règles explicites. Une exigence absente du profil est marquée « non attestée » :
elle n’est ni considérée comme acquise, ni présentée comme une disqualification.

## Documents

Chaque préparation crée de nouvelles lignes `resume_versions` et
`cover_letters`. Le CV conserve les expériences mot pour mot, remonte les
expériences et compétences explicitement reliées à l’offre et construit un
résumé à partir des seuls faits enregistrés. La lettre utilise un modèle
déterministe et cite uniquement ces mêmes faits.

Les corrections libres sont enregistrées comme `user_confirmed`; elles ne sont
jamais attribuées au moteur. Les faits sources du CV peuvent aussi être corrigés
depuis l’onboarding. Les exports PDF sont des A4 textuels compatibles avec
l’extraction ATS et ne contiennent ni image du texte ni données ajoutées.

## Présélection

En l’absence de questions ATS fournies par Remote OK, le dossier prépare
uniquement les informations de candidature connues : nom, e-mail, téléphone et
localisation. Nom, e-mail et téléphone sont obligatoires. Toute réponse absente
ou corrigée manuellement reste traçable par `source_kind` et
`source_reference`; une donnée obligatoire non validée bloque l’approbation.

De futures questions propres à un ATS devront être importées depuis une source
autorisée. Elles ne doivent jamais être inventées à partir de la description.

## Versions, empreinte et approbation

`application_dossiers` contient l’utilisateur, l’application, l’offre, les
versions documentaires, le contenu exact, la date de préparation, la version de
schéma et une empreinte SHA-256.

Le serveur produit une représentation JSON canonique. PostgreSQL vérifie que ce
JSON correspond au contenu reçu et recalcule l’empreinte via `pgcrypto`. Une
préparation identique rejoue la même version. Une modification crée une nouvelle
version, classe la précédente `superseded` et replace l’application en
`ready_for_review`.

L’approbation passe exclusivement par `approve_application_dossier`. Elle exige
la dernière version, le hash attendu, aucune donnée obligatoire manquante et
des réponses validées. Le contenu d’un snapshot ne peut plus être modifié,
même avec le rôle serveur. L’état `approved` signifie uniquement « dossier
figé », jamais « candidature envoyée ».
