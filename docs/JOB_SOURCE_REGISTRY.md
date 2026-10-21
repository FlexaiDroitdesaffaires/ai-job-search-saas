# Registre des sources d’offres

État de la revue : 21 octobre 2026. La liste
[`awesome-remote-job`](https://github.com/lukasz-madon/awesome-remote-job) sert
uniquement de catalogue de découverte. Sa licence ne transfère aucun droit de
collecte ou de redistribution sur les sites liés ; chaque fournisseur est
qualifié à partir de sa propre documentation.

| Source | Interface | Usage SaaS / redistribution | Couverture et fraîcheur | ATS / coût | Décision |
|---|---|---|---|---|---|
| Remote OK | JSON | Attribution et lien original obligatoires | Monde, remote ; fenêtre locale 45 jours | URL intermédiaire ; gratuit | Actif, connecteur Lot A |
| AI Dev Jobs | JSON public sans clé | Usage dans une application permis ; revente du dataset brut interdite | Monde, IA/ML ; statut, publication et expiration | Liens Greenhouse/Ashby/autres ; lecture gratuite limitée | Actif |
| Himalayas | JSON public sans clé | Attribution et `applicationLink` obligatoires ; ne pas republier comme job board | Monde, remote ; rafraîchi quotidiennement | Lien candidat fourni ; gratuit | Candidat suivant |
| Remotive | API publique retardée | Source/lien obligatoires ; le flux public interdit de collecter une inscription avant affichage | Monde, remote ; retard 24 h | Routage Remotive ; offre privée payante | Bloqué sans accord adapté |
| We Work Remotely | RSS/API | Conditions API interdisant l’usage pour construire un service de recherche d’emploi | Monde, remote | Routage WWR ; RSS gratuit | Bloqué |
| Arbeitnow | JSON | Attribution API, mais licence générale personnelle/non commerciale ambiguë pour ce SaaS | Europe/Allemagne ; retrait à expiration ou après 30 jours | Plusieurs ATS ; API publique gratuite | Bloqué jusqu’à permission écrite |

Sources officielles :

- [AI Dev Jobs API](https://aidevboard.com/docs), [conditions](https://aidevboard.com/terms) et [tarification API](https://aidevboard.com/api-pricing) ;
- [Himalayas Remote Jobs API](https://himalayas.app/docs/remote-jobs-api) ;
- [Remotive public API](https://remotive.com/remote-jobs/api) ;
- [We Work Remotely API terms](https://weworkremotely.com/api-terms-and-guidelines) et [RSS](https://weworkremotely.com/remote-job-rss-feed) ;
- [Arbeitnow API](https://blog.arbeitnow.com/blog/job-board-api) et [conditions](https://www.arbeitnow.com/terms).

## Règle d’activation

Une source n’est activée que si son interface est structurée, si le produit peut
respecter l’attribution et le lien imposés, et si son usage commercial n’est pas
interdit ou ambigu. L’existence d’un lien dans `awesome-remote-job`, d’un flux
RSS ou d’un endpoint public ne suffit pas.
