# Prochaine verticale — offre vers soumission vérifiée

## Résultat visé

Un utilisateur authentifié voit une offre réelle importée, comprend son score,
l'accepte ou la refuse, approuve un dossier figé, puis obtient soit une preuve
réelle de soumission par un adaptateur autorisé, soit un état explicite
`needs_manual_action`. Une acceptation ne devient jamais une soumission.

## Tranches d'implémentation

1. **Ingestion réelle.** Commencer par un seul fournisseur autorisé avec une
   fixture contractuelle et un connecteur serveur. Conserver la provenance,
   l'identifiant externe, l'URL source, les dates source/import et le contenu
   brut utile au diagnostic. Aucun scraping ou contournement non autorisé.
2. **Normalisation et déduplication.** Normaliser société, titre, lieu et URL ;
   calculer une clé stable ; utiliser `(provider, external_id)` pour les retries
   du fournisseur et `dedupe_key` pour regrouper les doublons multi-sources sans
   effacer leur provenance.
3. **Matching explicable.** Produire d'abord un score déterministe à partir des
   préférences, compétences et contraintes, avec un `breakdown` versionné. Les
   critères bloquants et chaque contribution doivent être affichables ; aucun
   fait candidat ne peut être inféré ou inventé.
4. **Swipe accepter/refuser.** Lire les offres non décidées triées par score et
   enregistrer une décision idempotente dans `saved_jobs`. Refuser ne crée pas
   de candidature. Accepter crée au plus une candidature brouillon par
   utilisateur et offre.
5. **Préparation.** Créer un instantané versionné du CV et, si demandé, une
   lettre fondée exclusivement sur le profil. Enregistrer les champs et réponses
   nécessaires, leurs sources et les éléments manquants. Passer à
   `ready_for_review`, jamais à `applied`.
6. **Approbation immuable.** Afficher le payload exact à envoyer, calculer son
   hash et recueillir l'approbation. Toute modification matérielle invalide
   l'approbation et ramène à `ready_for_review`.
7. **Adaptateur autorisé.** Définir une interface `prepare/submit/reconcile` et
   un seul adaptateur initial. Le worker appelle d'abord
   `start_application_submission` avec une clé d'idempotence durable. Un timeout
   après appel externe devient `requires_reconciliation`, jamais un retry
   aveugle.
8. **Vérification réelle.** Confirmer uniquement avec un identifiant fournisseur
   ou une preuve vérifiable persistée ; sinon passer à `needs_manual_action`.
   Exposer le journal d'événements et la preuve dans le suivi utilisateur.

## Ordre de livraison et critères d'arrêt

- **Lot A — validé localement :** connecteur Remote OK, déduplication, fraîcheur,
  vérification d'URL et tests de replay. L'attribution et le lien source sont
  obligatoires.
- **Lot B — validé localement :** matching déterministe expliqué, persistance
  des scores, file de swipe et décisions atomiques/idempotentes. Le refus ne
  crée rien ; l’acceptation crée uniquement une candidature `saved` / `draft`.
- **Lot C — validé localement :** préparation déterministe, CV et lettre PDF,
  réponses traçables, snapshots SHA-256 immuables et approbation invalidée par
  toute nouvelle version.
- **Lot D :** adaptateur en bac à sable/fixture contractuelle, puis validation
  humaine avant toute autorisation d'envoi réel.

Chaque lot doit avoir ses tests unitaires, ses tests SQL/RLS et un scénario local
de bout en bout. Stripe, Gmail et les analytics avancés restent hors périmètre.
