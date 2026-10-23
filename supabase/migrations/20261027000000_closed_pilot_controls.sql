begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $guard$
declare
  v_rate_limits regclass := to_regclass('public.pilot_rate_limits');
  v_retention regclass := to_regclass('public.pilot_retention_config');
begin
  if current_user <> 'postgres' then
    raise exception 'closed pilot controls must run as role postgres';
  end if;
  if v_rate_limits is not null
     and obj_description(v_rate_limits, 'pg_class') is distinct from 'app:closed_pilot_controls_v1' then
    raise exception 'Refusing to adopt public.pilot_rate_limits: ownership marker missing';
  end if;
  if v_retention is not null
     and obj_description(v_retention, 'pg_class') is distinct from 'app:closed_pilot_controls_v1' then
    raise exception 'Refusing to adopt public.pilot_retention_config: ownership marker missing';
  end if;
end
$guard$;

create table if not exists public.pilot_rate_limits (
  action text not null,
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  primary key (action, subject_hash)
);
comment on table public.pilot_rate_limits is 'app:closed_pilot_controls_v1';
alter table public.pilot_rate_limits enable row level security;
revoke all on table public.pilot_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.pilot_rate_limits to service_role;

create table if not exists public.pilot_retention_config (
  id boolean primary key default true check (id),
  inactive_account_days integer not null default 30 check (inactive_account_days between 1 and 730),
  max_resumes_per_user integer not null default 3 check (max_resumes_per_user between 1 and 20),
  max_resume_bytes_per_user bigint not null default 31457280 check (max_resume_bytes_per_user between 10485760 and 209715200),
  updated_at timestamptz not null default now()
);
comment on table public.pilot_retention_config is 'app:closed_pilot_controls_v1';
alter table public.pilot_retention_config enable row level security;
revoke all on table public.pilot_retention_config from public, anon, authenticated;
grant select, update on table public.pilot_retention_config to service_role;
insert into public.pilot_retention_config (id) values (true) on conflict (id) do nothing;

create or replace function public.consume_pilot_rate_limit(
  p_action text,
  p_subject_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_maximum integer;
  v_window_seconds integer;
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_attempt_count integer;
  v_allowed boolean;
  v_retry_after integer;
begin
  if p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit subject' using errcode = '22023';
  end if;

  select maximum, window_seconds into v_maximum, v_window_seconds
  from (values
    ('resume_upload', 5, 600),
    ('resume_update', 30, 60),
    ('document_export', 20, 60),
    ('official_form', 10, 300),
    ('application_action', 30, 60),
    ('job_decision', 60, 60),
    ('easyjobs_user', 12, 60),
    ('easyjobs_global', 50, 60)
  ) as limits(action, maximum, window_seconds)
  where action = p_action;
  if not found then
    raise exception 'Unknown rate-limit action' using errcode = '22023';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );
  insert into public.pilot_rate_limits (
    action, subject_hash, window_started_at, attempt_count, updated_at
  ) values (
    p_action, p_subject_hash, v_window_started_at, 1, v_now
  )
  on conflict (action, subject_hash) do update set
    window_started_at = case
      when public.pilot_rate_limits.window_started_at < excluded.window_started_at then excluded.window_started_at
      else public.pilot_rate_limits.window_started_at
    end,
    attempt_count = case
      when public.pilot_rate_limits.window_started_at < excluded.window_started_at then 1
      else public.pilot_rate_limits.attempt_count + 1
    end,
    updated_at = excluded.updated_at
  returning attempt_count into v_attempt_count;

  v_allowed := v_attempt_count <= v_maximum;
  v_retry_after := case when v_allowed then 0 else greatest(1, ceil(extract(epoch from (
    v_window_started_at + make_interval(secs => v_window_seconds) - v_now
  )))::integer) end;
  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', v_retry_after,
    'remaining', greatest(0, v_maximum - v_attempt_count)
  );
end
$function$;
comment on function public.consume_pilot_rate_limit(text,text) is 'app:closed_pilot_controls_v1';
revoke all on function public.consume_pilot_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.consume_pilot_rate_limit(text,text) to service_role;

create or replace function public.purge_expired_pilot_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  delete from public.pilot_rate_limits where updated_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$function$;
comment on function public.purge_expired_pilot_rate_limits() is 'app:closed_pilot_controls_v1';
revoke all on function public.purge_expired_pilot_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_expired_pilot_rate_limits() to service_role;

do $verify$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.pilot_rate_limits'::regclass) then
    raise exception 'verify: RLS missing on pilot_rate_limits';
  end if;
  if has_table_privilege('authenticated', 'public.pilot_rate_limits', 'select') then
    raise exception 'verify: authenticated can read rate-limit buckets';
  end if;
  if has_function_privilege('authenticated', 'public.consume_pilot_rate_limit(text,text)', 'execute') then
    raise exception 'verify: authenticated can consume arbitrary rate limits';
  end if;
end
$verify$;

commit;
