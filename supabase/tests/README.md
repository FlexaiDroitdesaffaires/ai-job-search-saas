# Tests Supabase locaux

Ces tests sont conçus pour une instance Supabase locale jetable. Ils ne doivent
jamais cibler un projet distant.

Pré-requis : Docker Desktop démarré et Supabase CLI installée.

```bash
supabase start
supabase db reset
supabase test db
```

`db reset` est destructif pour la base locale. Vérifier l'URL affichée par
`supabase status` avant de l'exécuter. Le fichier `core_schema_test.sql` teste
les RLS avec deux identités, le stockage privé, les privilèges, les crédits,
les transitions de candidature et les replays idempotents.
