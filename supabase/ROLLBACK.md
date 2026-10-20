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
