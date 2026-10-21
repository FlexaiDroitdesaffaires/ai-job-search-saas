begin;

do $guard$
begin
  if obj_description('public.application_dossiers'::regclass, 'pg_class')
     is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter public.application_dossiers: ownership marker missing';
  end if;
end
$guard$;

-- Account deletion already cascades through every user-owned artifact. These
-- links must follow the same lifecycle or an immutable dossier would prevent a
-- user account from being deleted.
alter table public.application_dossiers
  drop constraint application_dossiers_resume_version_id_user_id_fkey,
  drop constraint application_dossiers_cover_letter_id_user_id_fkey,
  add constraint application_dossiers_resume_version_owner_fk
    foreign key (resume_version_id, user_id)
    references public.resume_versions(id, user_id) on delete cascade,
  add constraint application_dossiers_cover_letter_owner_fk
    foreign key (cover_letter_id, user_id)
    references public.cover_letters(id, user_id) on delete cascade;

commit;
