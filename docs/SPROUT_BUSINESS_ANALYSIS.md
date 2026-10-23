# Analyse business — Sprout et opportunité France

**Photographie publique au 23 octobre 2026. Les prix et conditions peuvent changer.**

## Offre Sprout observable

| Plan | Prix affiché | Quota affiché | Contenu commun |
|---|---:|---:|---|
| Hebdomadaire | 19,99 USD | 50 candidatures/semaine | Recherche, candidature de bout en bout, CV/lettre adaptés, suivi, mises à jour, mobile/web |
| Mensuel | 39,99 USD | 200 candidatures/mois | Identique |
| Trimestriel | 79,99 USD | 600 candidatures/3 mois | Identique ; prix barré 239,99 USD et remise annoncée de 70 % |

Ces valeurs ont été rendues par REA sur la page officielle. Des résultats de recherche mis en cache affichaient encore 29,99/59,99/119,99 USD : seule la page live a été retenue, avec la réserve que le pricing est volatil.

Sprout associe le bénéfice à un volume de candidatures, 1 à 3 crédits par offre, et exige d'après son aide un abonnement actif pour accéder aux annonces et candidater. Un mécanisme d'invitation de trois amis est décrit comme moyen de déverrouillage gratuit. Les échecs liés au CAPTCHA, à la connexion ou à un formulaire incompatible sont annoncés comme remboursés automatiquement.

Les chiffres « 750k utilisateurs », « 20+ heures gagnées » et « 4,8/5 » sont des affirmations marketing. Ils n'ont pas été validés indépendamment et ne doivent pas servir de benchmark financier.

## Lecture du parcours de conversion

1. Promesse immédiate de vitesse et de volume.
2. Onboarding par CV, LinkedIn et préférences, qui augmente le coût de sortie.
3. Paywall ou boucle de parrainage avant la valeur complète.
4. Interaction simple par swipe et visibilité du coût en crédits.
5. Personnalisation automatique du dossier.
6. Timeline, inbox et notifications pour ramener l'utilisateur.
7. Plans courts et quota élevé pour convertir pendant une période de recherche intense.

**Hypothèse à valider** : l'hebdomadaire capture les chercheurs pressés et rend le mensuel plus attractif. Sans données de conversion/churn, on ne peut pas conclure que ce modèle est optimal en France.

## Risques du modèle volume

- Il incite au « spray and pray » et peut dégrader la qualité des candidatures.
- « 200 candidatures » n'est pas une unité honnête si plusieurs crédits sont consommés par offre.
- Un crédit pris au swipe avant une soumission confirmée crée du support et de la défiance.
- Les quotas élevés masquent le coût réel d'une automatisation ATS et des LLM.
- L'emploi en France comporte davantage de formes contractuelles et de cas administratifs que le triptyque full-time/part-time/internship visible chez Sprout.

## Positionnement recommandé en France

Positionner le produit comme **copilote de candidature vérifiable**, pas comme robot de volume : « des offres pertinentes, un dossier vrai, une action confirmée ». Le mode assisté est un produit acceptable si l'utilisateur sait exactement ce qui a été préparé, ce qui reste à faire et ce qui est confirmé.

### Segments à traiter explicitement

| Segment | Besoin particulier | Réponse produit |
|---|---|---|
| CDI/CDD | Salaire, localisation, préavis, télétravail | Contraintes dures et dossiers adaptés |
| Intérim | Disponibilité, agence, durée, urgence | Alertes rapides, dates et suivi agence |
| Freelance/missions | TJM, durée, statut, remote, disponibilité | Filtres et profil mission séparés du salaire annuel |
| Alternance/stage | Rythme, école, convention, dates | Champs et modèles dédiés |
| Saisonnier/ponctuel | Mobilité, logement, horaires, période | Recherche temporelle et géographique |
| Vacation/vacataire | Cadre métier et durée | Libellés français non écrasés par « freelance » |

### Hypothèses de plans à tester, pas des prix décidés

| Niveau | Proposition de valeur | Hypothèse tarifaire | Limite saine |
|---|---|---:|---|
| Découverte | Profil, CV, recherche ciblée, scoring explicable, suivi manuel | Gratuit | 3 dossiers préparés/mois |
| Essentiel | Dossiers éditables, exports, rappels et historique | 14,90–19,90 EUR/mois TTC | 20 dossiers préparés/mois |
| Pro | Génération contrainte, inbox et assistance avancée | 29,90–39,90 EUR/mois TTC | 60 dossiers/mois, fair use |

Ces fourchettes doivent être testées par entretien, landing page et cohorte pilote. Elles ne doivent pas être codées avant connaissance du coût par dossier, du taux d'activation et de la disposition à payer.

## Modèle de crédits recommandé

Ne pas reproduire mécaniquement le crédit consommé au swipe.

- Recherche, scoring, refus et sauvegarde : aucun crédit.
- Préparation générative réellement exécutée : coût visible, éventuellement 1 crédit.
- Soumission : débit seulement au démarrage d'une tentative autorisée ; remboursement automatique si `failed` sans effet externe.
- État `uncertain` : crédit bloqué, jamais redépensé, résolution ou remboursement selon SLA.
- Soumission manuelle : aucun libellé « envoyé » avant déclaration de l'utilisateur ou preuve importée.
- Ledger append-only et clé d'idempotence : déjà disponibles et à conserver.

Un utilisateur doit voir avant l'action : coût, opération déclenchée, conditions de remboursement et solde après action.

## EasyJobs : politique commerciale et données

La décision actuelle est correcte : EasyJobs doit alimenter des recherches ciblées et mises en cache, pas un miroir Supabase de centaines de milliers d'offres. Cela :

- réduit stockage, fraîcheur obsolète et coût de déduplication ;
- respecte l'attribution et la redirection vers la fiche `job_url` ;
- évite une dépendance commerciale au volume copié ;
- permet d'enrichir seulement les offres réellement consultées.

Le SLA produit doit préciser qu'une offre peut disparaître chez le fournisseur et que la source officielle reste l'autorité.

## Fidélisation sans dark patterns

- Digest hebdomadaire de nouvelles offres réellement compatibles.
- Rappel d'un dossier commencé mais non approuvé.
- Timeline et inbox consolidées avec action suivante claire.
- Relance après entretien et journal d'apprentissage : taux de réponse par source, type de contrat et version du dossier.
- Objectif de sortie : aider l'utilisateur à décrocher un poste, même si cela provoque un churn sain.
- Résiliation en ligne simple et export/suppression des données accessibles.

KPI de qualité recommandés : activation (profil + première offre pertinente), taux offre vue → dossier, dossier → action confirmée, taux de réponse, délai vers entretien, remboursement, `uncertain` non résolu, coût par dossier et rétention J7/J30. Le nombre brut de swipes n'est pas un KPI de succès.

## Cadre français à intégrer

Les données de CV et de candidature sont des données personnelles. La minimisation, l'information, la durée de conservation, les droits d'accès/effacement, les sous-traitants et transferts doivent être documentés. Les données sensibles ne doivent pas être déduites ni utilisées pour classer les candidats. Une analyse juridique/DPIA peut être nécessaire selon les traitements ; ce document n'est pas un avis juridique.

Le parcours payant doit afficher prix TTC, renouvellement, quota, événement de débit, remboursement et résiliation. La résiliation en ligne des contrats doit rester accessible et simple.

Sources : [guide CNIL du recrutement](https://www.cnil.fr/fr/le-guide-du-recrutement), [mise en conformité IA](https://www.cnil.fr/fr/intelligence-artificielle/ia-professionnels-comment-se-mettre-en-conformite), [résiliation en ligne des contrats](https://presse.economie.gouv.fr/01062023-cp-entree-en-vigueur-de-la-resiliation-en-ligne-des-contrats-en-trois-clics/), [droit de rétractation](https://www.economie.gouv.fr/particuliers/mes-droits-conso/bien-consommer/vente-distance-tout-savoir-sur-votre-droit-de-retractation).

## Décisions business nécessitant validation

1. Lancer d'abord en mode assisté transparent ou attendre un ATS production confirmé.
2. Événement exact facturé : génération, dossier approuvé ou tentative externe.
3. Prix TTC, périodicité, report des crédits et SLA de remboursement.
4. Niveau gratuit : valeur démontrable avant paywall et protection anti-abus.
5. Gmail/inbox : scopes OAuth, alias éventuel, conservation et support.
6. Fournisseur LLM, résidence des données, DPA et droit d'opposition.
7. Durées de conservation par objet et purge des fichiers CV.
8. Conditions de réutilisation/attribution de chaque source.

## Fonctionnalités à ne pas développer maintenant

- Candidature navigateur générique censée contourner CAPTCHA, login ou protections anti-bot.
- Import massif du catalogue EasyJobs.
- Application native iOS/Android avant preuve de rétention web.
- Marketplace recruteur/employeur ou ATS interne.
- Abonnement illimité qui subventionne un usage automatisé non borné.
- Score IA opaque présenté comme probabilité d'embauche.
- Scraping LinkedIn ou récupération de données sans autorisation.
- Automatisation de relances recruteur sans consentement explicite.

Voir [la matrice](./SPROUT_FEATURE_MATRIX.md) et [la roadmap](./SPROUT_IMPLEMENTATION_ROADMAP.md).
