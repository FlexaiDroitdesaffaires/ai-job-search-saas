# Ingestion des offres

## Source active

Le connecteur initial utilise le flux JSON public de Remote OK. La documentation
officielle indique que le flux est gratuit et sans authentification pour les
agrégateurs, sous réserve de créditer Remote OK et de conserver un lien vers la
publication originale :

- https://remoteok.com/faq
- https://remoteok.com/legal

La marque et le logo ne sont pas réutilisés. `provider = remoteok` et
`source_url` portent la provenance requise. La future interface devra afficher
« Source : Remote OK » avec un lien direct et suivi vers `source_url`.

## Garanties du connecteur

- exécution en ligne de commande limitée à Supabase local ;
- payload source validé et offres incomplètes ignorées ;
- descriptions converties en texte sans ajout de contenu ;
- rejet des URL non HTTPS ou hors domaine Remote OK ;
- contrôle HTTP réel de chaque URL retenue ;
- rejet des offres au-delà de la fenêtre de fraîcheur ;
- idempotence par contrainte `(provider, external_id)` ;
- `dedupe_key` stable sur société, titre et lieu pour le regroupement
  multi-sources ultérieur ;
- conservation de `posted_at`, `last_seen_at`, du statut HTTP et de la date de
  vérification ;
- aucune création de candidature et aucun changement de statut utilisateur.

Une absence dans un lot limité ne désactive pas une offre : `is_active` ne sera
mis à `false` qu'après l'implémentation d'une réconciliation complète de la
source. Cela évite de déclarer périmée une offre simplement absente d'une page.

## Commande locale

```bash
corepack pnpm jobs:ingest:local -- --limit=20 --max-age-days=45
```

Le script lit la clé `service_role` générée par la CLI uniquement en mémoire et
refuse une URL Supabase autre que `127.0.0.1` ou `localhost`. Aucune clé privée
n'est écrite dans le dépôt ou transmise au navigateur.
