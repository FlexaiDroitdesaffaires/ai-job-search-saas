-- Account deletion is initiated by Supabase Auth's restricted database role.
-- The trigger must be able to inspect the owning application during cascades,
-- while JWT-authenticated callers must still respect submission locks.
do $guard$
begin
  if obj_description('public.screening_answers'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1'
     or obj_description('public.applications'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter application cleanup trigger: ownership marker missing';
  end if;
end
$guard$;

create or replace function public.invalidate_application_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app_id uuid;
  v_state text;
begin
  foreach v_app_id in array array_remove(array[
      case when tg_op <> 'INSERT' then old.application_id end,
      case when tg_op <> 'DELETE' then new.application_id end], null)
  loop
    select a.prep_state into v_state
    from public.applications a
    where a.id = v_app_id
    for update;

    if not found then
      continue;
    end if;

    if v_state in ('submitting', 'submitted')
       and (select auth.role()) in ('authenticated', 'anon') then
      raise exception 'screening answers are locked while submitting/submitted'
        using errcode = '42501';
    end if;

    if v_state = 'approved' then
      update public.applications
      set prep_state = 'ready_for_review'
      where id = v_app_id;
    end if;
  end loop;
  return null;
end
$function$;

comment on function public.invalidate_application_approval() is 'app:core_schema_v1';
revoke all on function public.invalidate_application_approval() from public, anon, authenticated;
