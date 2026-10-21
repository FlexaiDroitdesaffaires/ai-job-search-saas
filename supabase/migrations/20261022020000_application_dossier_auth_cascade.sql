-- Avoid two competing auth deletion paths. Ownership remains enforced by the
-- composite (application_id, user_id) foreign key to public.applications.
do $guard$
begin
  if to_regclass('public.application_dossiers') is null
     or obj_description('public.application_dossiers'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter public.application_dossiers: ownership marker missing';
  end if;
end
$guard$;

alter table public.application_dossiers
  drop constraint if exists application_dossiers_user_id_fkey;
