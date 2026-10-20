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
