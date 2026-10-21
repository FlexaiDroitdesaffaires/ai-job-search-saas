# Fournisseurs candidats pour le Lot D2

État de la recherche : 21 octobre 2026. Cette analyse s'appuie uniquement sur
les documentations officielles et n'autorise ni n'active aucune intégration.

## Conclusion

Les trois ATS étudiés exposent une voie technique de dépôt, mais les accès sont
contrôlés par l'organisation qui recrute ou accordés à un partenaire. Aucun ne
constitue une API universelle qu'un SaaS B2C côté candidat peut présumer
utilisable pour toutes les entreprises. Le Lot D2 nécessite donc un accord
partenaire ou l'onboarding explicite d'employeurs avant un premier envoi réel.

## Lever

- Capacité : `POST /postings/:posting/apply` dépose une candidature sur une
  offre publiée et renvoie un `applicationId` en cas de création réussie.
- Accès/authentification : clé API d'un compte Lever en Basic Auth, ou OAuth
  pour une intégration enregistrée et autorisée par le client Lever.
- Confirmation : l'identifiant de candidature peut servir de preuve, après
  validation du corps métier et non du seul statut HTTP.
- Faisabilité B2C : faible sans partenariat ; les identifiants appartiennent à
  l'employeur. Une intégration partenaire et un environnement de test doivent
  être obtenus avant implémentation.
- Sources : [documentation développeur Lever](https://hire.lever.co/developer/documentation)
  et [support développeur Lever](https://hire.lever.co/developer/support).

## Ashby

- Capacité : `applicationForm.submit` soumet le formulaire complété d'une offre.
- Accès/authentification : clé API Ashby avec permission `candidatesWrite`,
  créée et contrôlée dans l'organisation cliente.
- Confirmation : la réponse métier doit être analysée même avec HTTP 200 ; un
  résultat incomplet reste incertain.
- Faisabilité B2C : faible sans accord avec chaque employeur ou partenariat
  Ashby ; aucune utilisation avec des identifiants candidat génériques n'est
  documentée.
- Sources : [applicationForm.submit](https://developers.ashbyhq.com/reference/applicationformsubmit)
  et [authentification Ashby](https://developers.ashbyhq.com/reference/authentication).

## Greenhouse Recruiting

- Capacité : le Job Board API permet à un site carrière personnalisé de
  transmettre une candidature à Greenhouse Recruiting.
- Accès/authentification : le POST de candidature exige une clé Job Board API
  créée par une personne disposant des permissions développeur de
  l'organisation Greenhouse.
- Autorisation : la documentation positionne l'API pour les sites carrière et
  intégrations partenaires de l'employeur. L'automatisation B2C ne doit pas être
  supposée autorisée sans accord explicite.
- Confirmation : il faudra qualifier précisément le corps de réponse et une
  éventuelle référence récupérable avant de définir la preuve D2.
- Faisabilité B2C : faible sans employeur/partenaire connecté ; pertinente pour
  un pilote avec une organisation consentante.
- Sources : [aperçu officiel des API Greenhouse](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview),
  [création d'une clé API](https://support.greenhouse.io/hc/en-us/articles/202842799-Create-an-API-key-in-Greenhouse-Recruiting)
  et [ressources développeur](https://developers.greenhouse.io/).

## Critère de choix D2

Avant de coder un adaptateur réel, obtenir par écrit : accès sandbox, modèle
d'autorisation candidat/employeur, droit d'automatisation, limites de débit,
schéma des questions/fichiers, sémantique des doublons, identifiant de
confirmation et endpoint de réconciliation. En l'absence d'un de ces éléments,
le parcours doit rester `needs_manual_action`.
