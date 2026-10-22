# Benchmark des sources France — 23 octobre 2026

Ce relevé utilise uniquement des requêtes GET anonymes. Aucun POST ATS et
aucune écriture Supabase Cloud n'ont été effectués. Les volumes sont des
observations ponctuelles et peuvent évoluer. Après le benchmark, une ingestion
plafonnée a ajouté **20 offres EasyJobs** au catalogue Supabase local sans
modifier les 29 offres actives préexistantes.

## EasyJobs

- API : `https://api.easyjobs.fr/public/v1`
- total actif annoncé pour `location=France` : **431 804** lors du relevé ;
- plafond d'énumération d'une requête : 100 pages de 50, soit 5 000 résultats ;
- fraîcheur : 14 113 sur 1 jour, 45 974 sur 3 jours, 93 117 sur 7 jours,
  431 802 sur 30 jours ;
- échantillon détaillé : 25/25 identifiants uniques, 25/25 clés métier uniques,
  10/10 liens `job_url` en HTTP 200 ;
- dry-run du connecteur sur 25 résumés : 19 exploitables (76 %) et 6 rejetés
  parce que l'employeur n'était pas renseigné, sans valeur fictive ajoutée ;
- ingestion locale ultérieure de 25 résumés : 20 offres vérifiées et insérées,
  soit 15 CDI, 4 CDD et 1 intérim ; le résultat diffère légèrement du dry-run
  car le flux a évolué entre les deux relevés ;
- description abrégée : médiane 600 caractères, 17/25 exactement au plafond ;
- texte combiné description + poste/profil : médiane 901 caractères ;
- expérience et mode de travail présents sur 25/25 ;
- salaire explicite sur 5/25 ; 20/25 fournissent seulement une estimation, qui
  ne doit pas être présentée comme un salaire employeur.

### Volumes contractuels EasyJobs

Les cinq premières lignes sont des filtres structurés et mutuellement exclusifs
du champ `contract_type`. Alternance recoupe ces contrats. Les autres familles
non structurées sont des volumes de recherche textuelle, donc non additionnables.

| Filtre observé | Volume |
| --- | ---: |
| CDI | 222 034 |
| CDD | 56 834 |
| Intérim | 135 110 |
| Franchise | 1 672 |
| Autre | 6 447 |
| Alternance (`work_study=true`) | 10 937 |
| Stage (recherche textuelle) | 390 |
| Saisonnier (recherche textuelle) | 163 |
| Vacation (recherche textuelle) | 102 |
| Vacataire (recherche textuelle) | 48 |
| Mission ponctuelle (recherche textuelle) | 10 |
| Indépendant (recherche textuelle) | 951 |
| Freelance (recherche textuelle) | 3 027 |

### Couverture sectorielle EasyJobs

EasyJobs n'expose pas de filtre sectoriel dans l'endpoint de recherche. Les
volumes suivants sont donc des recherches par mot-clé, utiles pour prouver la
couverture mais non exclusives entre elles.

| Secteur / requête | Volume |
| --- | ---: |
| Santé | 8 010 |
| Informatique / numérique | 9 121 |
| Commerce / vente | 17 460 |
| Industrie / production | 16 053 |
| BTP | 25 575 |
| Transport / logistique | 7 006 |
| Hôtellerie / restauration | 14 665 |
| Administration / finance | 19 054 |
| Agriculture | 3 166 |
| Éducation / social | 4 584 |

## Boards ATS localisés en France

Le filtre France est appliqué uniquement aux localisations structurées, jamais
au texte de la description. Le contrat reste `unknown` lorsqu'il n'est pas
explicitement démontré par un champ contractuel ou le titre.

| Fournisseur | Board | France | Frais <= 45 j | Contrats identifiables |
| --- | --- | ---: | ---: | --- |
| Greenhouse | Dataiku | 4 | 3 | 1 stage, 3 inconnus |
| Greenhouse | Datadog | 47 | 47 | 4 stages, 43 inconnus |
| Greenhouse | Doctolib | 74 | 59 | 18 stages, 56 inconnus |
| **Greenhouse total** |  | **125** | **109** | 23 stages, 102 inconnus |
| Ashby | Snowflake | 6 | 5 | 1 CDD, 5 inconnus |
| Ashby | Pennylane | 64 | 39 | 7 freelance, 57 inconnus |
| Ashby | Qonto | 30 | 29 | 2 stages, 28 inconnus |
| Ashby | Dust | 15 | 6 | 15 inconnus |
| **Ashby total** |  | **115** | **79** | 1 CDD, 7 freelance, 2 stages, 105 inconnus |

Les descriptions ATS sont généralement complètes, de plusieurs milliers de
caractères, donc meilleures qu'EasyJobs pour le matching. Aucun doublon exact de
titre n'a été observé dans les 7 recherches EasyJobs par employeur testées. La
clé existante société + titre + localisation reste la protection inter-source ;
`Paris` et `Paris, France` sont désormais canonisés de la même manière.

### État du catalogue local après ingestion

| Fournisseur actif | Avant | Ajout | Après |
| --- | ---: | ---: | ---: |
| AI Dev Jobs | 24 | 0 | 24 |
| Remote OK | 5 | 0 | 5 |
| EasyJobs | 0 | 20 | 20 |
| **Total** | **29** | **20** | **49** |

Les 49 lignes ont 49 clés de déduplication distinctes. Aucune soumission n'a
été créée. Les boards Greenhouse et Ashby ci-dessus sont uniquement mesurés :
ils ne sont ni activés ni persistés tant que les droits restent insuffisants.

## Droits et décision

| Source | Constat officiel | Décision |
| --- | --- | --- |
| EasyJobs | Usage dans une application ou un site d'emploi autorisé, avec `job_url`, attribution et respect du débit. Aspiration systématique et revente d'une copie substantielle interdites. | **Activer avec import récent et plafonné.** |
| Greenhouse | GET sans authentification et données publiquement accessibles. Aucune licence générale de republication commerciale multi-employeurs trouvée. | **Bloquer jusqu'à autorisation employeur/Greenhouse.** |
| Ashby | L'API publique est documentée pour la page carrière de sa propre organisation. Ashby propose aux partenaires un flux dédié avec opt-in des employeurs. | **Bloquer les boards directs ; demander le flux partenaire.** |

Sources officielles :

- EasyJobs : <https://api.easyjobs.fr/public/docs/> et
  <https://www.easyjobs.fr/conditions-generales.html>
- Greenhouse : <https://developers.greenhouse.io/job-board.html>
- Ashby : <https://developers.ashbyhq.com/docs/public-job-posting-api> et
  <https://developers.ashbyhq.com/docs/dedicated-partner-job-feeds>

## Recommandation

Conserver EasyJobs comme source française généraliste, avec une fenêtre de 30
jours, une limite par exécution et le lien attribué inchangé. Demander en
parallèle un accès partenaire Ashby. N'activer Greenhouse que board par board
avec une autorisation écrite. Aucun de ces connecteurs ne doit changer les
règles ATS ou autoriser automatiquement une candidature.
