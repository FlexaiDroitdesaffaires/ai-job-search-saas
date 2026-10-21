begin;

do $guard$
declare
  t text;
begin
  foreach t in array array['job_listings', 'saved_jobs', 'applications'] loop
    if obj_description(format('public.%I', t)::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
      raise exception 'Refusing to alter public.%: ownership marker missing', t;
    end if;
  end loop;
end
$guard$;

alter table public.job_listings
  add column application_url text,
  add column application_mode text not null default 'unknown'
    check (application_mode in ('automatic_authorized', 'manual_required', 'unknown', 'closed_invalid')),
  add column application_provider text check (application_provider is null or char_length(application_provider) <= 80),
  add column application_external_id text check (application_external_id is null or char_length(application_external_id) <= 300),
  add column application_reason text check (application_reason is null or char_length(application_reason) <= 1000),
  add column source_status text not null default 'unknown'
    check (source_status in ('active', 'closed', 'unknown')),
  add column expires_at timestamptz,
  add column application_url_verified_at timestamptz,
  add column application_url_status smallint
    check (application_url_status is null or application_url_status between 100 and 599),
  add constraint job_listings_automatic_route_complete check (
    application_mode <> 'automatic_authorized'
    or (application_provider is not null and application_external_id is not null and application_url is not null)
  );

update public.job_listings
set application_mode = 'manual_required',
    application_reason = 'Aucun adaptateur autorisé enregistré pour cette offre',
    source_status = case when is_active then 'active' else 'closed' end
where provider = 'remoteok';

create index job_listings_canonical_active_idx
  on public.job_listings(dedupe_key, posted_at desc)
  where is_active and not is_demo and application_mode <> 'closed_invalid';
create index job_listings_application_provider_idx
  on public.job_listings(application_provider, application_external_id)
  where application_provider is not null;

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
    and application_mode <> 'closed_invalid'
  for share;
  if not found then
    raise exception 'Active real job not found' using errcode = 'P0002';
  end if;

  -- Serialize decisions across multiple source rows representing the same job.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_job.dedupe_key, 0)
  );

  select sj.* into v_saved
  from public.saved_jobs sj
  join public.job_listings existing on existing.id = sj.job_id
  where sj.user_id = v_user_id and existing.dedupe_key = v_job.dedupe_key
  order by sj.created_at, sj.id
  for update of sj
  limit 1;

  if found then
    if v_saved.decision is distinct from p_decision then
      raise exception 'Job decision is immutable across duplicate sources' using errcode = '23505';
    end if;
    v_replayed := true;
  else
    insert into public.saved_jobs(user_id, job_id, decision)
    values (v_user_id, p_job_id, p_decision)
    returning * into v_saved;
  end if;

  if p_decision = 'saved' then
    select * into v_application
    from public.applications
    where user_id = v_user_id and job_id = v_saved.job_id;

    if not found then
      insert into public.applications(
        user_id, job_id, company, job_title, job_url, location, status, prep_state
      ) values (
        v_user_id,
        v_saved.job_id,
        left(v_job.company, 200),
        left(v_job.title, 200),
        left(coalesce(v_job.application_url, v_job.source_url), 2048),
        left(v_job.location, 200),
        'saved',
        'draft'
      )
      returning * into v_application;
    end if;

    if not v_replayed
       and (v_application.status <> 'saved' or v_application.prep_state <> 'draft') then
      raise exception 'Existing application has already entered preparation' using errcode = '23505';
    end if;
  end if;

  return jsonb_build_object(
    'decision', p_decision,
    'replayed', v_replayed,
    'canonical_job_id', v_saved.job_id,
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
