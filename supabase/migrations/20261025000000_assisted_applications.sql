begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $guard$
declare
  t text;
begin
  foreach t in array array[
    'applications', 'application_dossiers', 'application_events',
    'application_submissions', 'job_listings'
  ] loop
    if obj_description(format('public.%I', t)::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
      raise exception 'Refusing to alter public.%: ownership marker missing', t;
    end if;
  end loop;
  if to_regclass('public.assisted_application_states') is not null
     and obj_description(to_regclass('public.assisted_application_states'), 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to adopt public.assisted_application_states: ownership marker missing';
  end if;
end
$guard$;

create table if not exists public.assisted_application_states (
  application_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  official_url text not null check (
    char_length(official_url) between 9 and 2048
    and official_url ~ '^https://[^[:space:]]+$'
  ),
  opened_at timestamptz not null,
  user_decision text check (user_decision in ('sent', 'not_sent', 'unable')),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (application_id, user_id),
  foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade,
  constraint assisted_application_decision_timestamp check (
    (user_decision is null and decided_at is null)
    or (user_decision is not null and decided_at is not null)
  )
);
comment on table public.assisted_application_states is 'app:core_schema_v1';
create index if not exists assisted_application_states_user_idx
  on public.assisted_application_states(user_id, updated_at desc);
create or replace trigger assisted_application_states_updated
  before update on public.assisted_application_states
  for each row execute function public.set_updated_at();

alter table public.assisted_application_states enable row level security;
drop policy if exists assisted_application_states_select on public.assisted_application_states;
create policy assisted_application_states_select
  on public.assisted_application_states for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.assisted_application_states from public, anon, authenticated;
grant select on table public.assisted_application_states to authenticated;
grant all on table public.assisted_application_states to service_role;

-- A terminal adapter outcome that explicitly requires human action must not
-- prevent the user from recording the later manual submission. All active or
-- confirmed intents remain unique per application.
drop index if exists public.application_submissions_one_active_per_app;
create unique index application_submissions_one_active_per_app
  on public.application_submissions(application_id)
  where state in (
    'queued', 'processing', 'retry_scheduled', 'confirmed',
    'requires_reconciliation'
  );

create or replace function public.open_assisted_application_form(
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_app public.applications%rowtype;
  v_job public.job_listings%rowtype;
  v_existing public.assisted_application_states%rowtype;
  v_official_url text;
  v_replayed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;
  if not found or v_app.job_id is null then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.prep_state not in ('approved', 'needs_manual_action', 'submitted') then
    raise exception 'Approved dossier required' using errcode = 'P0001';
  end if;
  if v_app.prep_state = 'submitted' and v_app.submission_method <> 'manual' then
    raise exception 'Provider-confirmed application cannot enter assisted flow' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.application_dossiers d
    where d.application_id = v_app.id and d.user_id = v_user_id
      and d.state = 'approved'
      and d.resume_version_id = v_app.resume_version_id
      and d.cover_letter_id = v_app.cover_letter_id
  ) then
    raise exception 'Current approved dossier required' using errcode = 'P0001';
  end if;

  select * into v_job from public.job_listings where id = v_app.job_id for share;
  if not found then
    raise exception 'Original job not found' using errcode = 'P0002';
  end if;
  v_official_url := nullif(btrim(v_app.job_url), '');
  if v_official_url is null
     or v_official_url !~ '^https://[^[:space:]]+$'
     or (v_official_url is distinct from nullif(btrim(v_job.source_url), '')
        and v_official_url is distinct from nullif(btrim(v_job.application_url), '')) then
    raise exception 'Application URL does not match original job' using errcode = '22023';
  end if;

  select * into v_existing from public.assisted_application_states
  where application_id = p_application_id;
  if found then
    if v_existing.user_id <> v_user_id
       or v_existing.official_url is distinct from v_official_url then
      raise exception 'Assisted application URL mismatch' using errcode = '22023';
    end if;
    v_replayed := true;
  else
    insert into public.assisted_application_states(
      application_id, user_id, official_url, opened_at
    ) values (
      p_application_id, v_user_id, v_official_url, now()
    );
    insert into public.application_events(
      user_id, application_id, event_type, from_status, to_status, details
    ) values (
      v_user_id, p_application_id, 'official_form_opened', v_app.status,
      v_app.status, jsonb_build_object('url', v_official_url, 'mode', 'assisted')
    );
  end if;

  return jsonb_build_object(
    'official_url', v_official_url,
    'opened_at', coalesce(v_existing.opened_at, now()),
    'replayed', v_replayed
  );
end
$function$;
comment on function public.open_assisted_application_form(uuid) is 'app:core_schema_v1';
revoke all on function public.open_assisted_application_form(uuid) from public, anon;
grant execute on function public.open_assisted_application_form(uuid) to authenticated;

create or replace function public.record_assisted_application_decision(
  p_application_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_app public.applications%rowtype;
  v_assisted public.assisted_application_states%rowtype;
  v_manual_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_decision not in ('sent', 'not_sent', 'unable') then
    raise exception 'Invalid assisted application decision' using errcode = '22023';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into v_assisted from public.assisted_application_states
  where application_id = p_application_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Official form must be opened first' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.application_dossiers d
    where d.application_id = v_app.id and d.user_id = v_user_id
      and d.state = 'approved'
      and d.resume_version_id = v_app.resume_version_id
      and d.cover_letter_id = v_app.cover_letter_id
  ) then
    raise exception 'Current approved dossier required' using errcode = 'P0001';
  end if;

  if v_app.prep_state = 'submitted' then
    if v_app.submission_method <> 'manual' or p_decision <> 'sent' then
      raise exception 'Submitted application decision is terminal' using errcode = 'P0001';
    end if;
    update public.assisted_application_states
      set user_decision = 'sent', decided_at = coalesce(decided_at, now())
      where application_id = p_application_id;
    return jsonb_build_object('decision', 'sent', 'confirmation_source', 'user', 'replayed', true);
  end if;
  if v_app.prep_state not in ('approved', 'needs_manual_action') then
    raise exception 'Application is not available for assisted confirmation' using errcode = 'P0001';
  end if;

  if v_assisted.user_decision is not distinct from p_decision then
    return jsonb_build_object(
      'decision', p_decision,
      'confirmation_source', case when p_decision = 'sent' then 'user' else null end,
      'replayed', true
    );
  end if;

  if p_decision = 'sent' then
    v_manual_result := public.record_manual_submission(
      p_application_id, now(), 'Déclaration utilisateur depuis le parcours assisté'
    );
  else
    update public.applications
      set prep_state = case when p_decision = 'unable' then 'needs_manual_action' else 'approved' end
      where id = p_application_id;
    insert into public.application_events(
      user_id, application_id, event_type, from_status, to_status, details
    ) values (
      v_user_id, p_application_id,
      case when p_decision = 'unable'
        then 'assisted_application_unable' else 'assisted_application_not_sent' end,
      v_app.status, v_app.status,
      jsonb_build_object('decision', p_decision, 'confirmation_source', 'user')
    );
  end if;

  update public.assisted_application_states
    set user_decision = p_decision, decided_at = now()
    where application_id = p_application_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'decision', p_decision,
    'confirmation_source', case when p_decision = 'sent' then 'user' else null end,
    'submission_id', v_manual_result->>'submission_id',
    'replayed', false
  ));
end
$function$;
comment on function public.record_assisted_application_decision(uuid,text) is 'app:core_schema_v1';
revoke all on function public.record_assisted_application_decision(uuid,text) from public, anon;
grant execute on function public.record_assisted_application_decision(uuid,text) to authenticated;

commit;
