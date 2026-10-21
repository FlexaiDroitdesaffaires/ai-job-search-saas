-- The application owns the dossier lifecycle. Resume and cover-letter
-- references remain mandatory, but are checked at commit time so account
-- deletion does not start competing cascades through three parent tables.
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
  drop constraint if exists application_dossiers_resume_version_id_user_id_fkey,
  drop constraint if exists application_dossiers_cover_letter_id_user_id_fkey;

alter table public.application_dossiers
  add constraint application_dossiers_resume_version_id_user_id_fkey
    foreign key (resume_version_id, user_id)
    references public.resume_versions(id, user_id)
    deferrable initially deferred,
  add constraint application_dossiers_cover_letter_id_user_id_fkey
    foreign key (cover_letter_id, user_id)
    references public.cover_letters(id, user_id)
    deferrable initially deferred;
