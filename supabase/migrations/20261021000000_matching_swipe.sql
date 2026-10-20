begin;

do $guard$
declare
  t text;
begin
  foreach t in array array['job_listings', 'saved_jobs', 'job_matches', 'applications'] loop
    if obj_description(format('public.%I', t)::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
      raise exception 'Refusing to alter public.%: ownership marker missing', t;
    end if;
  end loop;
end
$guard$;

-- A job may create at most one application for a user. Abort rather than
-- silently deleting or merging pre-existing duplicates.
do $duplicates$
begin
  if exists (
    select 1
    from public.applications
    where job_id is not null
    group by user_id, job_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce application idempotence: duplicate user/job applications exist';
  end if;
end
$duplicates$;

create unique index if not exists applications_one_per_user_job_idx
  on public.applications(user_id, job_id)
  where job_id is not null;

-- Matches are deterministic client-owned projections. Users may persist only
-- their own computed result; the catalog itself stays server-managed.
grant insert, update on table public.job_matches to authenticated;
drop policy if exists job_matches_insert on public.job_matches;
drop policy if exists job_matches_update on public.job_matches;
create policy job_matches_insert on public.job_matches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy job_matches_update on public.job_matches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Decisions are immutable and go through one transaction so an accepted job
-- and its draft application cannot diverge, even under retries/concurrency.
revoke insert, update, delete on table public.saved_jobs from authenticated;

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

    if v_application.status <> 'saved' or v_application.prep_state <> 'draft' then
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

commit;
