# Stratégie de retour arrière

La migration `core_schema` s'exécute dans une transaction explicite : toute
erreur pendant sa première application annule l'ensemble des créations.

Après une application réussie, aucun script de suppression automatique n'est
fourni, car il détruirait profils, CV et candidatures. Toute correction doit
être livrée par une migration suivante, additive et compatible avec les
lecteurs existants. Une suppression éventuelle exige une sauvegarde vérifiée et
une autorisation explicite distincte.

Le bucket `resumes` n'est géré que s'il porte son enregistrement de propriété
`app:core_schema_v1`. Un bucket existant sans ce marqueur fait échouer la
migration avant toute modification.

La migration `20261020000000_job_ingestion.sql` ajoute uniquement quatre
colonnes et un index à `job_listings`, après vérification du marqueur de
propriété. Aucun rollback automatique ne supprime ces colonnes : elles peuvent
contenir l'historique de fraîcheur d'offres réelles. Une suppression exige une
autorisation et une sauvegarde distinctes.

La migration `20261021000000_matching_swipe.sql` ajoute un index unique partiel,
deux politiques RLS et la fonction `decide_job`, puis retire les écritures
directes du rôle `authenticated` sur `saved_jobs`. Elle ne transforme ni ne
supprime aucune ligne. Un retour arrière compatible doit d’abord arrêter les
appels à `decide_job`; restaurer les écritures directes affaiblirait l’atomicité
et n’est donc pas automatisé. La suppression de l’index exige au préalable une
revue des risques de doublons.

La migration `20261022000000_application_preparation.sql` ajoute la table
`application_dossiers`, quatre colonnes de traçabilité aux réponses et les RPC
de préparation/approbation. Elle retire aux clients les écritures directes sur
les versions de CV, lettres et réponses afin de garantir l’atomicité. Aucun
rollback destructif n’est fourni : les snapshots approuvés constituent une
preuve d’autorisation à conserver. Une transition arrière devrait d’abord
arrêter les RPC, exporter les dossiers et rétablir explicitement les privilèges
avec une migration additive distincte.

La migration corrective `20261022010000_application_dossier_lifecycle.sql`
remplace d’abord les références documentaires restrictives par des cascades.
Elle ne supprime aucune donnée lors de son application. La migration
`20261022030000` affine ensuite ce mécanisme en contrôles différés afin de
conserver l’intégrité sans créer plusieurs voies de cascade concurrentes.

Les migrations correctives `20261022020000` et `20261022030000` retirent une
cascade Auth redondante et font vérifier les références du CV et de la lettre
en fin de transaction. La cascade propriétaire reste
`auth.users -> applications -> application_dossiers`; l’appartenance du dossier
reste imposée par la clé composite vers `applications`. Ces migrations ne
suppriment aucune ligne existante.

La migration `20261022040000_screening_answer_auth_cleanup.sql` permet au
trigger de présélection de relire l’application pendant une suppression de
compte initiée par le rôle restreint de GoTrue. Le verrou des réponses pendant
une soumission continue de s’appuyer sur le rôle JWT. Un retour arrière
réintroduirait le blocage de suppression des comptes ayant des réponses et
n’est donc pas automatisé.

La migration `20261022050000_decide_job_prepared_replay.sql` conserve
l’idempotence de l’acceptation lorsque la candidature a déjà progressé : le
replay retourne l’état courant sans le ramener en brouillon. Revenir à la
fonction antérieure ferait échouer les retries après préparation.
