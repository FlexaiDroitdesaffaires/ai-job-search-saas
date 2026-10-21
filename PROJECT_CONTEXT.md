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

## État technique validé au 21 octobre 2026

- Le schéma cœur et les migrations additives d'ingestion et de décision sont validés uniquement
  sur Supabase local ; aucune migration distante n'a été lancée.
- Auth, sessions SSR, onboarding, stockage privé PDF/DOCX et extraction
  déterministe sont opérationnels et testés localement.
- Les invariants de soumission, l'idempotence, les crédits atomiques et les RLS
  passent les 28 assertions pgTAP et les tests d'intégration locaux.
- Le premier connecteur réel ingère des offres Remote OK dans
  `job_listings`. Il vérifie fraîcheur et URL, conserve la provenance, calcule
  une clé de regroupement et rejoue par `(provider, external_id)` sans doublon.
- Remote OK impose une attribution visible et un lien vers l'offre source. Une
  future carte d'offre ne pourra pas masquer cette provenance.
- Le matching déterministe `deterministic-v1` pondère huit critères, persiste le
  score et ses explications dans `job_matches`, et distingue compatibilités,
  incompatibilités et données manquantes. Il ne représente pas une probabilité
  de recrutement.
- `/dashboard/jobs` présente les offres réelles non décidées, leur provenance,
  leur score et leurs explications. Refuser persiste uniquement la décision ;
  accepter crée atomiquement une candidature `saved` / `draft`, au plus une
  fois, sans la présenter comme envoyée.
- Le tableau de suivi expose l’état de préparation existant et n’affiche
  « Soumise avec preuve » qu’en présence de preuve. Aucune candidature réelle
  n’est soumise.
- Après acceptation, le Lot C prépare automatiquement, lorsque les données sont
  disponibles, un CV ciblé, une lettre et les informations de présélection par
  traitement déterministe. Toute correction libre est attribuée explicitement
  à l’utilisateur ; aucune qualification n’est ajoutée par le moteur.
- Chaque dossier est versionné dans `application_dossiers`, lié aux versions du
  CV et de la lettre, et protégé par une empreinte SHA-256 recalculée en base.
  Une approbation fige la version ; une nouvelle modification la remplace et
  ramène l’application en revue. Approuver ne soumet rien.
- La suppression locale via GoTrue d’un compte portant des dossiers préparés
  est validée : une seule cascade propriétaire passe par l’application, les
  références documentaires sont vérifiées en fin de transaction et le trigger
  de présélection conserve les verrous JWT sans exiger de droits directs pour
  le rôle Auth.

Le Lot D1 ajoute le contrat d'adaptateur, une file durable avec bail et claim
atomique, le backoff, la reprise après crash, la réconciliation et un journal
d'événements. Son unique adaptateur est une fixture strictement locale : ses
preuves sont marquées `TEST`, exclues des soumissions réelles et ne changent
jamais l'application en `submitted`.

La prochaine verticale prioritaire est le Lot D2 : obtenir un accès officiel
sandbox/partenaire auprès d'un ATS, confirmer contractuellement le droit
d'automatisation et implémenter un premier adaptateur réel. Sans cet accès, le
produit doit rester en `needs_manual_action` et ne revendiquer aucun envoi.
