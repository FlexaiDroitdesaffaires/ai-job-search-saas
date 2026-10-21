# Ingestion des offres

## Sources actives

Le connecteur initial utilise le flux JSON public de Remote OK. La documentation
officielle indique que le flux est gratuit et sans authentification pour les
agrégateurs, sous réserve de créditer Remote OK et de conserver un lien vers la
publication originale :

- https://remoteok.com/faq
- https://remoteok.com/legal

La marque et le logo ne sont pas réutilisés. `provider = remoteok` et
`source_url` portent la provenance requise. La future interface devra afficher
« Source : Remote OK » avec un lien direct et suivi vers `source_url`.

Le connecteur AI Dev Jobs utilise son API JSON publique et conserve l’URL
source ainsi que l’URL de candidature officielle. Il persiste le statut et la
date d’expiration fournis, détecte Greenhouse/Ashby sans supposer que leur POST
est autorisé, et affiche l’attribution AI Dev Jobs. Le registre et les motifs
d’exclusion des autres sources sont détaillés dans
[`JOB_SOURCE_REGISTRY.md`](./JOB_SOURCE_REGISTRY.md).

## Garanties du connecteur

- exécution en ligne de commande limitée à Supabase local ;
- payload source validé et offres incomplètes ignorées ;
- descriptions converties en texte sans ajout de contenu ;
- rejet des URL non HTTPS ou hors domaine Remote OK ;
- contrôle HTTP réel de chaque URL retenue ;
- rejet des offres au-delà de la fenêtre de fraîcheur ;
- idempotence par contrainte `(provider, external_id)` ;
- `dedupe_key` stable sur société, titre et lieu et décision sérialisée par
  verrou transactionnel pour éviter une seconde candidature issue d’une autre
  source ;
- conservation de `posted_at`, `last_seen_at`, du statut HTTP et de la date de
  vérification ;
- aucune création de candidature et aucun changement de statut utilisateur.

Une absence dans un lot limité ne désactive pas une offre : `is_active` ne sera
mis à `false` qu'après l'implémentation d'une réconciliation complète de la
source. Cela évite de déclarer périmée une offre simplement absente d'une page.

## Commande locale

```bash
corepack pnpm jobs:ingest:local -- --limit=20 --max-age-days=45
corepack pnpm jobs:ingest:aidevjobs:local -- --limit=25 --max-age-days=45
```

Le script lit la clé `service_role` générée par la CLI uniquement en mémoire et
refuse une URL Supabase autre que `127.0.0.1` ou `localhost`. Aucune clé privée
n'est écrite dans le dépôt ou transmise au navigateur.
