-- A saved decision may be retried after its application has progressed beyond
-- draft. Replays return the current application without moving it backwards.
do $guard$
begin
  if obj_description('public.saved_jobs'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1'
     or obj_description('public.applications'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter job decision workflow: ownership marker missing';
  end if;
end
$guard$;

create or replace function public.decide_job(p_job_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_job public.job_listings%rowtype;
  v_saved public.saved_jobs%rowtype;
  v_application public.applications%rowtype;
  v_inserted_id uuid;
  v_replayed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_decision not in ('saved', 'skipped') then
    raise exception 'Invalid job decision' using errcode = '22023';
  end if;

  select * into v_job
  from public.job_listings
  where id = p_job_id and is_active and not is_demo
  for share;

  if not found then
    raise exception 'Active real job not found' using errcode = 'P0002';
  end if;

  insert into public.saved_jobs(user_id, job_id, decision)
  values (v_user_id, p_job_id, p_decision)
  on conflict (user_id, job_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_saved
    from public.saved_jobs
    where user_id = v_user_id and job_id = p_job_id
    for update;

    if v_saved.decision is distinct from p_decision then
      raise exception 'Job decision is immutable once recorded' using errcode = '23505';
    end if;
    v_replayed := true;
  end if;

  if p_decision = 'saved' then
    insert into public.applications(
      user_id, job_id, company, job_title, job_url, location, status, prep_state
    ) values (
      v_user_id,
      v_job.id,
      left(v_job.company, 200),
      left(v_job.title, 200),
      left(v_job.source_url, 2048),
      left(v_job.location, 200),
      'saved',
      'draft'
    )
    on conflict (user_id, job_id) where job_id is not null do nothing;

    select * into v_application
    from public.applications
    where user_id = v_user_id and job_id = p_job_id;

    if not v_replayed
       and (v_application.status <> 'saved' or v_application.prep_state <> 'draft') then
      raise exception 'Existing application has already entered preparation' using errcode = '23505';
    end if;
  end if;

  return jsonb_build_object(
    'decision', p_decision,
    'replayed', v_replayed,
    'application_id', v_application.id,
    'application_status', v_application.status,
    'preparation_state', v_application.prep_state
  );
end
$function$;

comment on function public.decide_job(uuid, text) is 'app:core_schema_v1';
revoke all on function public.decide_job(uuid, text) from public, anon;
grant execute on function public.decide_job(uuid, text) to authenticated;
