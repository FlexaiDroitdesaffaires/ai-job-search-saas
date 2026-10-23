# Matrice fonctionnelle — Sprout vs AI Job Search SaaS

**Audit daté du 23 octobre 2026 — branche `develop`, référence locale `8b004b2`.**

## Périmètre et niveau de preuve

Cet audit n'a créé aucun compte Sprout, contourné aucune authentification, acheté aucun abonnement ni envoyé de candidature. REA 6.7.0 était déjà présent dans l'environnement : il a été réutilisé sans réinstallation.

Légende :

- **Vérifié** : directement observé sur une page publique avec REA ou dans le dépôt local.
- **Documenté** : affirmé par Sprout dans son site, son centre d'aide ou sa fiche App Store ; ce n'est pas une validation indépendante.
- **Hypothèse** : déduction plausible, à confirmer.
- **Non vérifié** : inaccessible sans compte, abonnement ou candidature réelle.

### Registre REA

| Surface | Résultat | Identifiant de preuve REA |
|---|---|---|
| `usesprout.com` | Page publique rendue en Chromium 153, capture 1440 × 1100, DOM/accessibilité/réseau collectés | `ev_471d862936b31a7d169014100808c758827445154d4fd12f4b95a09ddfd95a2d` |
| `app.usesprout.com` | Redirection publique vers `/auth/sign-in?next=%2F`; formulaire email/mot de passe et Apple/Google visibles | `ev_5cdd2fc2e8749a15f991857b9d905303d60551624a158b392aa6529a5a2d81bb` |
| `usesprout.com/pricing` | Trois plans et limites rendus ; capture complète | `ev_c25fb804b95e270c7ad37d2afd3170563a3c60ce1fee761d78c3f057508e9b8c` |

## Comparaison fonctionnelle

| Fonction | Sprout observable | Preuve | Implémentation réelle locale | Verdict et recommandation | Priorité |
|---|---|---|---|---|---|
| Inscription | Email/mot de passe, mot de passe oublié, Apple et Google ; lien de création de compte | Vérifié sur la page publique de connexion | Email/mot de passe Supabase, confirmation d'email, redirection relative contrôlée ; pas d'OAuth social visible | Sprout réduit mieux la friction. Ajouter Google en premier, Apple seulement si le gain est mesuré | P1 |
| Onboarding | LinkedIn, CV PDF et questionnaire de préférences sont décrits | Documenté, écran authentifié non vérifié | Parcours réel profil, compétences, expériences, préférences et import PDF/DOCX avec correction manuelle | Notre saisie structurée et le DOCX sont solides. Un import LinkedIn nécessiterait un accès autorisé ; ne pas scraper | P1 |
| Import/analyse du CV | Import PDF, extraction et utilisation pour personnaliser les dossiers | Documenté ; qualité d'extraction non vérifiée | PDF/DOCX ≤ 10 Mo, stockage privé, extraction déterministe, état d'échec explicite et correction utilisateur | Meilleure frontière de vérité locale ; renforcer la sécurité des fichiers et la qualité structurée | P0/P1 |
| Catalogue d'offres | Sprout affirme agréger des sites d'entreprise, job boards et partenaires, actualisés quotidiennement | Déclaration fournisseur | AI Dev Jobs, Remote OK et EasyJobs ; 49 offres locales dans le dernier relevé ; provenance et fraîcheur conservées | Sprout paraît plus large. Garder EasyJobs ciblé et ne jamais répliquer son catalogue complet | P0 |
| Recherche et filtres | Titre, lieu, expérience, type de poste, salaire minimal, remote/hybride/sur site, date de publication | Documenté | Texte, lieu, contrats français, mode de travail, salaire et expérience ; filtrage en mémoire après un plafond de 500 offres ; pas de filtre date visible | Couverture française meilleure, mais architecture non scalable et filtre de fraîcheur manquant | P0 |
| Matching | Sprout présente des recommandations personnalisées ; formule non publique | Documenté, algorithme non vérifié | Score déterministe explicable sur 8 critères, raisons positives, incompatibilités et données manquantes | Notre explicabilité est supérieure. Conserver le noyau et ajouter seulement un reranking sémantique évalué | P1 |
| Swipe | Glisser à droite applique, à gauche ignore ; 1 à 3 crédits selon l'offre | Documenté | Swipe à seuil, boutons accessibles, verrouillage pendant l'action ; accepter crée uniquement un brouillon | Notre libellé évite une fausse promesse. Ne jamais assimiler le swipe à une soumission sans preuve | Conserver |
| CV adapté | Création automatique, condensation et prévisualisation PDF ; option de validation manuelle | Documenté | Préparation déterministe et éditable, rendus PDF/DOCX, dossier versionné et haché | Sprout promet plus de génération ; notre intégrité factuelle est meilleure. Ajouter une génération contrainte et diffable, pas opaque | P1 |
| Lettre adaptée | Lettre générée, ton/phrasing modifiables, contenu exact consultable | Documenté | Lettre déterministe éditable, incluse dans le dossier approuvé | Même recommandation : assistance générative bornée, sources visibles et validation humaine | P1 |
| Questions employeur | Sprout mentionne des questions propres au poste et des demandes de complément | Documenté | Réponses de screening et nettoyage d'autorisation présents dans le modèle local | Base solide ; prouver le parcours de bout en bout sur un fournisseur autorisé | P1 |
| Approbation avant envoi | Option de revue/édition avant soumission | Documenté | Approbation explicite, snapshots immuables, hashes et invalidation si le dossier change | Notre mécanisme d'intégrité est plus rigoureux ; à conserver | Conserver |
| Soumission ATS | Agent annoncé comme déposant sur les sites employeurs | Documenté uniquement | Mode assisté opérationnel ; worker durable et adaptateur Greenhouse préparé en test, mais aucune soumission ATS production | Lacune produit principale. Lancer honnêtement en assisté ou valider un seul ATS autorisé avant toute promesse | P0 |
| Échecs et remboursements | Sprout documente CAPTCHA, connexion ou formulaire incompatible ; arrêt et remboursement automatique du crédit | Documenté | États `uncertain`, `failed`, retry/reconcile et preuve prévus ; aucune boucle de remboursement produit branchée | Architecture locale de fiabilité meilleure, expérience commerciale incomplète | P0 |
| Suivi | Timeline avec soumission, réponses, refus et entretiens | Documenté | Dashboard, statuts et événements réels ; aucune fausse confirmation ; déclarations manuelles possibles | Fondations solides, mais pas de synchronisation email/recruteur | P1 |
| Inbox et notifications | Inbox comme registre, email/push/in-app, document prêt et question manquante | Documenté | Tables notifications/email/messages présentes, sans parcours produit ni connecteur constaté | Sprout est nettement devant | P1 |
| Tarifs/crédits | Hebdo 19,99 USD/50, mensuel 39,99 USD/200, trimestriel 79,99 USD/600 | Vérifié le 23/10/2026 ; prix susceptibles de changer | Tables abonnement, Stripe et ledger de crédits robustes, mais aucune checkout/webhook/UI de facturation constatée | Schéma solide, monétisation non opérationnelle | P0 |
| Dashboard | Gestion des recommandations, candidatures et documents annoncée | Documenté ; écran authentifié non vérifié | Dashboard responsive inspecté, métriques réelles, cartes et tableau de suivi | Notre écran est crédible ; enrichir avec inbox, filtres et pagination | P1 |
| Mobile | Applications iOS/Android et expérience web annoncées | Présence App Store et liens publics vérifiée ; usage non testé | Web responsive validé à 390/768/1440 ; pas de PWA/push/native. Barre basse fixe peut masquer du contenu | Corriger le chevauchement, puis PWA ; pas d'app native avant preuve de rétention | P1/P2 |
| Rapidité/fluidité | Promesse marketing de gain de temps ; aucune mesure publique reproductible | Non vérifié | UI locale fluide sur petit catalogue ; calcul/upsert de tous les matchs à chaque chargement | Impossible de déclarer un vainqueur. Instrumenter p50/p95 et supprimer l'amplification d'écriture | P0 |
| Marché français | Typologie publique observée limitée à full-time, part-time et internship | Documenté | CDI, CDD, intérim, freelance, alternance, stage, saisonnier, vacation/vacataire et missions ponctuelles | Avantage local différenciant à préserver | Conserver |

## Ce que notre produit fait déjà mieux

1. Il ne présente jamais un brouillon ou un test comme une candidature envoyée.
2. Le matching expose les critères, les incompatibilités et les données absentes.
3. Les dossiers approuvés sont versionnés et protégés contre une mutation avant envoi.
4. Le worker prévoit idempotence, lease, retry, état incertain et réconciliation.
5. La taxonomie couvre les formes d'emploi françaises au-delà du trio généraliste.
6. L'ingestion conserve provenance, fraîcheur, URL et mode de candidature.
7. EasyJobs est utilisé par requêtes ciblées ; le catalogue complet n'est pas copié.
8. L'utilisateur peut corriger les données extraites du CV.

## Inconnues à ne pas transformer en faits

- Taux réel de soumission, succès ATS et délai moyen de Sprout.
- Précision de son matching et qualité factuelle des documents générés.
- Nombre réel d'utilisateurs, économies horaires et note agrégée annoncés sur le site.
- Couverture exacte des sources, fréquence réelle de rafraîchissement et déduplication.
- Ergonomie et performances des écrans authentifiés, notamment sur mobile.
- Gestion contractuelle des crédits lors des échecs, hors texte du centre d'aide.

## Sources publiques Sprout

- [Tarifs](https://www.usesprout.com/pricing)
- [Démarrage et onboarding](https://help.usesprout.com/en/articles/11639790-welcome-to-sprout-how-to-get-started)
- [Candidater avec Sprout](https://help.usesprout.com/en/articles/11676023-how-do-i-apply-to-jobs-on-sprout)
- [CV et lettres générés](https://help.usesprout.com/en/articles/11743856-ai-generated-resume-and-cover-letters)
- [Échecs de soumission](https://help.usesprout.com/en/articles/16258290-i-applied-but-nothing-happened-why-weren-t-my-applications-submitted)
- [Filtres](https://help.usesprout.com/en/articles/11628644-adjusting-your-job-filters)
- [Timeline](https://help.usesprout.com/en/articles/11726050-how-to-check-status-timeline-of-applications)
- [Notifications](https://help.usesprout.com/en/articles/17082082-managing-your-notifications)
- [Adresse email de candidature](https://help.usesprout.com/en/articles/11511462-why-is-the-email-on-my-job-applications-not-my-personal-email)
- [Fiche App Store](https://apps.apple.com/ua/app/sprout-ai-job-search/id6740011494)

Voir aussi [l'audit technique](./SPROUT_TECHNICAL_AUDIT.md), [l'analyse business](./SPROUT_BUSINESS_ANALYSIS.md), [les opportunités open source](./SPROUT_OPEN_SOURCE_OPPORTUNITIES.md) et [la roadmap](./SPROUT_IMPLEMENTATION_ROADMAP.md).
