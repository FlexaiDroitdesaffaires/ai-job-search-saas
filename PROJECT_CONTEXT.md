# AI Job Search SaaS — contexte produit

## Vision

AI Job Search est un SaaS de candidatures automatisées inspiré de usesprout.com.
Le produit doit réduire l'action requise de l'utilisateur sans lui retirer le
contrôle : il crée son profil, importe son CV, consulte des offres pertinentes,
puis accepte ou refuse chaque offre. Après une acceptation, et uniquement selon
les autorisations explicites de l'utilisateur, le système prépare, soumet et
suit la candidature.

## Parcours prioritaire

Le premier objectif produit est un parcours de candidature fonctionnel de bout
en bout :

1. créer et compléter un profil candidat ;
2. importer un CV réel et en extraire les informations sans en inventer ;
3. afficher des offres pertinentes avec un score de matching explicable ;
4. permettre à l'utilisateur d'accepter ou de refuser chaque offre ;
5. préparer les éléments de candidature pour une offre acceptée ;
6. obtenir l'approbation requise avant toute soumission ;
7. soumettre par un adaptateur réel ou demander une action manuelle explicite ;
8. conserver une preuve vérifiable de chaque soumission réussie ;
9. suivre les réponses et l'état réel de la candidature.

Les fonctionnalités secondaires ne doivent pas retarder ce parcours.

## Règles d'intégrité produit

- Une offre acceptée n'est pas une candidature soumise.
- Une candidature préparée ou approuvée n'est pas une candidature soumise.
- Une candidature ne peut être présentée comme soumise que si un adaptateur a
  retourné une preuve réelle et persistée, ou si l'utilisateur a enregistré
  explicitement une soumission manuelle avec son horodatage.
- Les simulations, données de démonstration et résultats réels doivent rester
  identifiables et séparés dans le code, les données et l'interface.
- Le système ne doit jamais inventer une expérience, une compétence, une
  formation, une réponse de présélection ou une autre information
  professionnelle. Toute suggestion générée doit être fondée sur les données
  utilisateur et rester vérifiable avant soumission.
- Une soumission automatique requiert une autorisation explicite, traçable et
  encore valide pour les éléments effectivement envoyés.
- Les opérations de soumission doivent être idempotentes afin d'éviter les
  candidatures en double.

## Périmètre fonctionnel final

Le produit final comprend :

- l'authentification et l'onboarding ;
- le profil candidat et l'import de CV ;
- l'ingestion et la déduplication des offres ;
- le matching IA et ses explications ;
- l'acceptation ou le refus des offres ;
- la personnalisation contrôlée des CV ;
- les lettres de motivation ;
- les réponses aux questions de présélection ;
- la préparation, l'approbation et la soumission des candidatures ;
- les preuves de soumission et le suivi des candidatures ;
- l'intégration Gmail pour détecter et classer les réponses ;
- les abonnements et crédits Stripe ;
- les notifications ;
- une interface premium bilingue français/anglais.

## Priorités de développement

1. Parcours réel profil -> CV -> offre -> décision -> préparation -> approbation
   -> soumission prouvée -> suivi.
2. Robustesse du moteur : transitions d'état, idempotence, journal d'événements,
   reprise sur erreur et distinction stricte entre réel et simulation.
3. Qualité du matching et de la personnalisation, sans hallucination.
4. Gmail, Stripe, notifications et enrichissements produit.
5. Raffinement général de l'interface, sans refonte prématurée.

## Contraintes opérationnelles

- Préserver les fichiers existants, les décisions d'architecture validées et le
  travail récupéré depuis V0 ; étendre l'existant avant de reconstruire.
- Ne lancer aucune migration Supabase sans autorisation explicite.
- Ne lancer aucun déploiement sans autorisation explicite.
- Ne réaliser aucun envoi réel de candidature sans autorisation explicite.
- Ne pousser aucun commit vers GitHub sans autorisation explicite.
- Distinguer dans chaque compte rendu ce qui est implémenté, compilé, simulé,
  testé localement et validé contre un service réel.

Ce fichier est la référence produit pour les prochaines phases. Toute décision
de conception doit préserver ces invariants et servir en priorité le parcours
de candidature de bout en bout.
