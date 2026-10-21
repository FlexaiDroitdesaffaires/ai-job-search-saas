begin;

do $guard$
declare
  t text;
begin
  foreach t in array array[
    'applications', 'application_dossiers', 'application_submissions',
    'application_events'
  ] loop
    if obj_description(format('public.%I', t)::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
      raise exception 'Refusing to alter public.%: ownership marker missing', t;
    end if;
  end loop;
  if to_regclass('public.application_submission_events') is not null
     and obj_description(to_regclass('public.application_submission_events'), 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to adopt public.application_submission_events: ownership marker missing';
  end if;
end
$guard$;

alter table public.application_submissions
  drop constraint application_submissions_state_check,
  drop constraint application_submissions_attempt_count_check;

alter table public.application_submissions
  alter column attempt_count set default 0,
  add column dossier_id uuid,
  add column dossier_hash text check (dossier_hash is null or dossier_hash ~ '^[0-9a-f]{64}$'),
  add column environment text not null default 'production'
    check (environment in ('test', 'production')),
  add column worker_id text check (worker_id is null or char_length(worker_id) between 1 and 200),
  add column claimed_at timestamptz,
  add column claim_expires_at timestamptz,
  add column next_attempt_at timestamptz not null default now(),
  add column last_attempt_at timestamptz,
  add column max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  add column reconciliation_attempt_count smallint not null default 0
    check (reconciliation_attempt_count between 0 and 100),
  add column external_attempted boolean not null default false,
  add column tracking_url text check (tracking_url is null or char_length(tracking_url) <= 2048),
  add column last_outcome jsonb,
  add column completed_at timestamptz,
  add constraint application_submissions_state_check
    check (state in (
      'queued', 'processing', 'retry_scheduled', 'confirmed', 'failed',
      'requires_reconciliation', 'needs_manual_action'
    )),
  add constraint application_submissions_attempt_count_check
    check (attempt_count between 0 and 100),
  add constraint application_submissions_dossier_fk
    foreign key (dossier_id) references public.application_dossiers(id) on delete restrict;

create index application_submissions_worker_queue_idx
  on public.application_submissions(state, next_attempt_at, started_at)
  where method = 'adapter' and state in ('queued', 'retry_scheduled', 'requires_reconciliation');
create index application_submissions_expired_claim_idx
  on public.application_submissions(claim_expires_at)
  where method = 'adapter' and state = 'processing';

drop index public.application_submissions_one_active_per_app;
create unique index application_submissions_one_active_per_app
  on public.application_submissions(application_id)
  where state in (
    'queued', 'processing', 'retry_scheduled', 'confirmed',
    'requires_reconciliation', 'needs_manual_action'
  );

create table public.application_submission_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  submission_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  worker_id text check (worker_id is null or char_length(worker_id) <= 200),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade,
  foreign key (submission_id, user_id)
    references public.application_submissions(id, user_id) on delete cascade
);
comment on table public.application_submission_events is 'app:core_schema_v1';
create index application_submission_events_submission_idx
  on public.application_submission_events(submission_id, created_at);
alter table public.application_submission_events enable row level security;
create policy application_submission_events_select_own
  on public.application_submission_events for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.application_submission_events to authenticated;
grant all on public.application_submission_events to service_role;

create or replace function public.enqueue_application_submission(
  p_application_id uuid,
  p_dossier_id uuid,
  p_idempotency_key text,
  p_provider text,
  p_payload_hash text,
  p_environment text default 'production',
  p_max_attempts smallint default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app public.applications%rowtype;
  v_dossier public.application_dossiers%rowtype;
  v_existing public.application_submissions%rowtype;
  v_submission public.application_submissions%rowtype;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_provider is null or char_length(p_provider) not between 1 and 80 then
    raise exception 'invalid provider' using errcode = '22023';
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid payload hash' using errcode = '22023';
  end if;
  if p_environment not in ('test', 'production') then
    raise exception 'invalid submission environment' using errcode = '22023';
  end if;
  if p_max_attempts not between 1 and 20 then
    raise exception 'invalid max attempts' using errcode = '22023';
  end if;

  select * into v_app from public.applications
  where id = p_application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.application_submissions
  where user_id = v_app.user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.application_id <> p_application_id
       or v_existing.dossier_id is distinct from p_dossier_id
       or v_existing.provider is distinct from p_provider
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.environment is distinct from p_environment then
      raise exception 'idempotency key reused with different parameters' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'submission_id', v_existing.id,
      'state', v_existing.state,
      'replayed', true
    );
  end if;

  if v_app.prep_state <> 'approved' then
    raise exception 'application must be approved before enqueue' using errcode = 'P0001';
  end if;

  select * into v_dossier from public.application_dossiers
  where id = p_dossier_id
    and application_id = p_application_id
    and user_id = v_app.user_id
    and state = 'approved'
  for share;
  if not found
     or v_dossier.resume_version_id is distinct from v_app.resume_version_id
     or v_dossier.cover_letter_id is distinct from v_app.cover_letter_id then
    raise exception 'current approved dossier required' using errcode = 'P0001';
  end if;

  insert into public.application_submissions (
    user_id, application_id, dossier_id, dossier_hash, idempotency_key,
    method, provider, payload_hash, environment, state, attempt_count,
    max_attempts, next_attempt_at
  ) values (
    v_app.user_id, p_application_id, p_dossier_id, v_dossier.content_hash,
    p_idempotency_key, 'adapter', p_provider, p_payload_hash, p_environment,
    'queued', 0, p_max_attempts, now()
  ) returning * into v_submission;

  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, details
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    'queued', jsonb_build_object(
      'provider', p_provider,
      'environment', p_environment,
      'dossier_hash', v_dossier.content_hash
    )
  );

  return jsonb_build_object(
    'submission_id', v_submission.id,
    'state', v_submission.state,
    'replayed', false
  );
end
$function$;
comment on function public.enqueue_application_submission(uuid,uuid,text,text,text,text,smallint) is 'app:core_schema_v1';
revoke all on function public.enqueue_application_submission(uuid,uuid,text,text,text,text,smallint) from public, anon, authenticated;
grant execute on function public.enqueue_application_submission(uuid,uuid,text,text,text,text,smallint) to service_role;

create or replace function public.claim_application_submission(
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.application_submissions%rowtype;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 200 then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  if p_lease_seconds not between 5 and 900 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;

  -- A lost lease after dispatch is uncertain. Before dispatch it is safe to
  -- schedule the same idempotent intent again.
  with expired as (
    update public.application_submissions
    set state = case when external_attempted then 'requires_reconciliation' else 'retry_scheduled' end,
        next_attempt_at = now(), worker_id = null, claimed_at = null,
        claim_expires_at = null,
        error_message = case when external_attempted
          then 'Worker lease expired after dispatch began'
          else 'Worker lease expired before dispatch' end,
        last_outcome = jsonb_build_object('kind', 'lease_expired', 'external_attempted', external_attempted)
    where method = 'adapter' and state = 'processing'
      and claim_expires_at < now()
    returning *
  )
  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, details
  )
  select user_id, application_id, id,
    case when state = 'requires_reconciliation' then 'lease_expired_uncertain' else 'lease_expired_safe_retry' end,
    last_outcome
  from expired;

  -- A queued dossier that is no longer the approved version is terminal for
  -- this intent and must never be dispatched.
  with stale as (
    update public.application_submissions s
    set state = 'failed', completed_at = now(),
        error_message = 'Approved dossier changed before claim',
        last_outcome = '{"kind":"stale_dossier"}'::jsonb
    from public.applications a, public.application_dossiers d
    where s.application_id = a.id and s.dossier_id = d.id
      and s.method = 'adapter' and s.state in ('queued', 'retry_scheduled')
      and (
        a.prep_state <> 'approved' or d.state <> 'approved'
        or a.resume_version_id is distinct from d.resume_version_id
        or a.cover_letter_id is distinct from d.cover_letter_id
      )
    returning s.*
  )
  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, details
  )
  select user_id, application_id, id, 'stale_dossier_rejected', last_outcome
  from stale;

  select s.* into v_submission
  from public.application_submissions s
  join public.applications a on a.id = s.application_id
  join public.application_dossiers d on d.id = s.dossier_id
  where s.method = 'adapter'
    and s.state in ('queued', 'retry_scheduled')
    and s.next_attempt_at <= now()
    and s.attempt_count < s.max_attempts
    and a.prep_state in ('approved', 'submitting')
    and d.state = 'approved'
  order by s.next_attempt_at, s.started_at
  for update of s skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.application_submissions
  set state = 'processing', worker_id = p_worker_id, claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_attempt_at = now(), attempt_count = attempt_count + 1,
      external_attempted = false, error_message = null
  where id = v_submission.id
  returning * into v_submission;

  if (select prep_state from public.applications where id = v_submission.application_id) = 'approved' then
    update public.applications set prep_state = 'submitting'
    where id = v_submission.application_id;
  end if;

  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, worker_id, details
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    'claimed', p_worker_id, jsonb_build_object(
      'attempt', v_submission.attempt_count,
      'claim_expires_at', v_submission.claim_expires_at
    )
  );

  return to_jsonb(v_submission);
end
$function$;
comment on function public.claim_application_submission(text,integer) is 'app:core_schema_v1';
revoke all on function public.claim_application_submission(text,integer) from public, anon, authenticated;
grant execute on function public.claim_application_submission(text,integer) to service_role;

create or replace function public.mark_application_submission_dispatched(
  p_submission_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.application_submissions%rowtype;
begin
  update public.application_submissions
  set external_attempted = true
  where id = p_submission_id and state = 'processing'
    and worker_id = p_worker_id and claim_expires_at > now()
  returning * into v_submission;
  if not found then
    raise exception 'active worker claim not found' using errcode = 'P0002';
  end if;
  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, worker_id
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    'dispatch_started', p_worker_id
  );
end
$function$;
comment on function public.mark_application_submission_dispatched(uuid,text) is 'app:core_schema_v1';
revoke all on function public.mark_application_submission_dispatched(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_application_submission_dispatched(uuid,text) to service_role;

create or replace function public.finish_application_submission_attempt(
  p_submission_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error_message text default null,
  p_provider_submission_id text default null,
  p_evidence jsonb default null,
  p_tracking_url text default null,
  p_retry_delay_seconds integer default 30,
  p_side_effect_possible boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.application_submissions%rowtype;
  v_next_state text;
  v_event text;
begin
  if p_outcome not in ('confirmed', 'retryable', 'uncertain', 'failed') then
    raise exception 'invalid submission outcome' using errcode = '22023';
  end if;
  if p_retry_delay_seconds not between 0 and 86400 then
    raise exception 'invalid retry delay' using errcode = '22023';
  end if;

  select * into v_submission from public.application_submissions
  where id = p_submission_id and state = 'processing'
    and worker_id = p_worker_id and claim_expires_at > now()
  for update;
  if not found then
    raise exception 'active worker claim not found' using errcode = 'P0002';
  end if;

  if p_outcome = 'confirmed' then
    if p_provider_submission_id is null or char_length(p_provider_submission_id) not between 1 and 300
       or p_evidence is null or jsonb_typeof(p_evidence) <> 'object'
       or coalesce((p_evidence->>'provider_confirmed')::boolean, false) is not true
       or p_evidence->>'adapter_id' is distinct from v_submission.provider
       or p_evidence->>'dossier_hash' is distinct from v_submission.dossier_hash
       or p_evidence->>'environment' is distinct from v_submission.environment
       or p_evidence->>'submitted_at' is null then
      raise exception 'validated provider evidence required' using errcode = '22023';
    end if;
    perform (p_evidence->>'submitted_at')::timestamptz;
    if v_submission.environment = 'test'
       and coalesce((p_evidence->>'test')::boolean, false) is not true then
      raise exception 'test evidence must be explicitly marked' using errcode = '22023';
    end if;
    if v_submission.environment = 'production'
       and coalesce((p_evidence->>'test')::boolean, false) is true then
      raise exception 'test evidence cannot confirm production submission' using errcode = '22023';
    end if;
    v_next_state := 'confirmed';
    v_event := case when v_submission.environment = 'test'
      then 'test_confirmation_recorded' else 'submission_confirmed' end;
  elsif p_outcome = 'uncertain' or (p_outcome = 'retryable' and p_side_effect_possible) then
    v_next_state := 'requires_reconciliation';
    v_event := 'submission_uncertain';
  elsif p_outcome = 'retryable' and v_submission.attempt_count < v_submission.max_attempts then
    v_next_state := 'retry_scheduled';
    v_event := 'retry_scheduled';
  else
    v_next_state := 'failed';
    v_event := 'submission_failed';
  end if;

  update public.application_submissions
  set state = v_next_state,
      provider_submission_id = case when v_next_state = 'confirmed' then p_provider_submission_id else provider_submission_id end,
      evidence = case when v_next_state = 'confirmed' then p_evidence else evidence end,
      tracking_url = coalesce(p_tracking_url, tracking_url),
      error_message = case when v_next_state = 'confirmed' then null else left(coalesce(p_error_message, 'Submission attempt failed'), 2000) end,
      next_attempt_at = case when v_next_state in ('retry_scheduled', 'requires_reconciliation')
        then now() + make_interval(secs => p_retry_delay_seconds) else next_attempt_at end,
      confirmed_at = case when v_next_state = 'confirmed' then now() else confirmed_at end,
      completed_at = case when v_next_state in ('confirmed', 'failed') then now() else null end,
      worker_id = null, claimed_at = null, claim_expires_at = null,
      last_outcome = jsonb_strip_nulls(jsonb_build_object(
        'kind', p_outcome,
        'side_effect_possible', p_side_effect_possible,
        'error', p_error_message
      ))
  where id = v_submission.id;

  if v_next_state = 'confirmed' then
    if v_submission.environment = 'production' then
      update public.applications
      set prep_state = 'submitted', status = 'applied', submitted_at = now(),
          submission_method = 'adapter',
          submission_evidence = p_evidence || jsonb_build_object(
            'provider', v_submission.provider,
            'provider_submission_id', p_provider_submission_id,
            'idempotency_key', v_submission.idempotency_key,
            'tracking_url', p_tracking_url
          )
      where id = v_submission.application_id;
    else
      update public.applications set prep_state = 'approved'
      where id = v_submission.application_id;
    end if;
  elsif v_next_state = 'failed' then
    update public.applications set prep_state = 'failed'
    where id = v_submission.application_id;
  end if;

  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, worker_id, details
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    v_event, p_worker_id, jsonb_strip_nulls(jsonb_build_object(
      'state', v_next_state,
      'environment', v_submission.environment,
      'error', p_error_message,
      'provider_submission_id', p_provider_submission_id
    ))
  );

  return jsonb_build_object('submission_id', v_submission.id, 'state', v_next_state);
end
$function$;
comment on function public.finish_application_submission_attempt(uuid,text,text,text,text,jsonb,text,integer,boolean) is 'app:core_schema_v1';
revoke all on function public.finish_application_submission_attempt(uuid,text,text,text,text,jsonb,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.finish_application_submission_attempt(uuid,text,text,text,text,jsonb,text,integer,boolean) to service_role;

create or replace function public.claim_application_reconciliation(
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.application_submissions%rowtype;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 200 then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  if p_lease_seconds not between 5 and 900 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;

  select * into v_submission from public.application_submissions
  where method = 'adapter' and state = 'requires_reconciliation'
    and next_attempt_at <= now()
    and (claim_expires_at is null or claim_expires_at < now())
  order by next_attempt_at, started_at
  for update skip locked
  limit 1;
  if not found then
    return null;
  end if;

  update public.application_submissions
  set worker_id = p_worker_id, claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      reconciliation_attempt_count = reconciliation_attempt_count + 1
  where id = v_submission.id
  returning * into v_submission;

  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, worker_id, details
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    'reconciliation_claimed', p_worker_id,
    jsonb_build_object('attempt', v_submission.reconciliation_attempt_count)
  );
  return to_jsonb(v_submission);
end
$function$;
comment on function public.claim_application_reconciliation(text,integer) is 'app:core_schema_v1';
revoke all on function public.claim_application_reconciliation(text,integer) from public, anon, authenticated;
grant execute on function public.claim_application_reconciliation(text,integer) to service_role;

create or replace function public.finish_application_reconciliation(
  p_submission_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error_message text default null,
  p_provider_submission_id text default null,
  p_evidence jsonb default null,
  p_tracking_url text default null,
  p_retry_delay_seconds integer default 60,
  p_max_reconciliation_attempts integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.application_submissions%rowtype;
  v_result jsonb;
begin
  if p_outcome not in ('confirmed', 'not_found', 'inconclusive') then
    raise exception 'invalid reconciliation outcome' using errcode = '22023';
  end if;
  select * into v_submission from public.application_submissions
  where id = p_submission_id and state = 'requires_reconciliation'
    and worker_id = p_worker_id and claim_expires_at > now()
  for update;
  if not found then
    raise exception 'active reconciliation claim not found' using errcode = 'P0002';
  end if;

  if p_outcome = 'confirmed' then
    -- Reuse the evidence checks and final transitions from the attempt path.
    update public.application_submissions
      set state = 'processing', claim_expires_at = now() + interval '1 minute'
    where id = v_submission.id;
    select public.finish_application_submission_attempt(
      p_submission_id, p_worker_id, 'confirmed', null,
      p_provider_submission_id, p_evidence, p_tracking_url, 0, true
    ) into v_result;
    return v_result || jsonb_build_object('reconciled', true);
  end if;

  if p_outcome = 'inconclusive'
     and v_submission.reconciliation_attempt_count < p_max_reconciliation_attempts then
    update public.application_submissions
    set worker_id = null, claimed_at = null, claim_expires_at = null,
        next_attempt_at = now() + make_interval(secs => p_retry_delay_seconds),
        error_message = left(coalesce(p_error_message, 'Reconciliation inconclusive'), 2000),
        last_outcome = jsonb_build_object('kind', 'reconciliation_inconclusive')
    where id = v_submission.id;
    insert into public.application_submission_events (
      user_id, application_id, submission_id, event_type, worker_id, details
    ) values (
      v_submission.user_id, v_submission.application_id, v_submission.id,
      'reconciliation_rescheduled', p_worker_id,
      jsonb_build_object('attempt', v_submission.reconciliation_attempt_count)
    );
    return jsonb_build_object('submission_id', v_submission.id, 'state', 'requires_reconciliation');
  end if;

  update public.application_submissions
  set state = 'needs_manual_action', worker_id = null, claimed_at = null,
      claim_expires_at = null, completed_at = now(),
      error_message = left(coalesce(p_error_message,
        case when p_outcome = 'not_found'
          then 'Provider could not confirm the submission'
          else 'Reconciliation attempts exhausted' end), 2000),
      last_outcome = jsonb_build_object('kind', 'reconciliation_' || p_outcome)
  where id = v_submission.id;
  update public.applications set prep_state = 'needs_manual_action'
  where id = v_submission.application_id;
  insert into public.application_submission_events (
    user_id, application_id, submission_id, event_type, worker_id, details
  ) values (
    v_submission.user_id, v_submission.application_id, v_submission.id,
    'manual_action_required', p_worker_id,
    jsonb_build_object('reconciliation_outcome', p_outcome)
  );
  return jsonb_build_object('submission_id', v_submission.id, 'state', 'needs_manual_action');
end
$function$;
comment on function public.finish_application_reconciliation(uuid,text,text,text,text,jsonb,text,integer,integer) is 'app:core_schema_v1';
revoke all on function public.finish_application_reconciliation(uuid,text,text,text,text,jsonb,text,integer,integer) from public, anon, authenticated;
grant execute on function public.finish_application_reconciliation(uuid,text,text,text,text,jsonb,text,integer,integer) to service_role;

commit;
