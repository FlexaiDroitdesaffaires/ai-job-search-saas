# Matching explicable et décisions d’offres

## Score déterministe v1

Le moteur `deterministic-v1` calcule un score de compatibilité de 0 à 100. Ce
score n’est pas une probabilité de recrutement. Il repose exclusivement sur le
profil et les préférences saisis par l’utilisateur et sur le contenu de
l’offre :

| Critère | Poids |
| --- | ---: |
| Compétences déclarées | 25 |
| Termes des expériences déclarées | 15 |
| Intitulé actuel ou ciblé | 20 |
| Localisation | 10 |
| Mode de travail | 10 |
| Salaire minimum | 10 |
| Séniorité | 5 |
| Type de contrat | 5 |

Chaque critère enregistre ses points, son maximum, son état et ses éléments de
preuve dans `job_matches.breakdown`. L’interface sépare les critères satisfaits,
les incompatibilités explicites et les données manquantes.

Règles d’absence : une donnée candidat absente vaut zéro pour le critère et est
signalée ; un attribut absent de l’offre vaut la moitié du poids, comme donnée
incertaine et non comme compatibilité confirmée. Aucune compétence ni expérience
n’est inférée.

## Décision atomique

La fonction SQL `decide_job(job_id, decision)` est le seul chemin client pour
enregistrer `saved` ou `skipped` :

- elle refuse les offres inactives ou de démonstration ;
- une décision déjà enregistrée est immuable ;
- rejouer la même décision renvoie le même résultat ;
- `skipped` n’insère aucune candidature ;
- `saved` crée au plus une candidature `status = saved`,
  `prep_state = draft` ;
- une contrainte unique partielle protège également les retries concurrents.

L’acceptation ne déclenche ni préparation, ni approbation, ni soumission. Les
gardes de soumission du schéma cœur restent applicables.

## Interface

`/dashboard/jobs` affiche uniquement les offres actives, non fictives et non
encore décidées. Les boutons Refuser/Accepter et le geste horizontal appellent
la même action serveur, avec verrou anti-double clic. Les offres Remote OK
conservent l’attribution visible et leur lien original.
