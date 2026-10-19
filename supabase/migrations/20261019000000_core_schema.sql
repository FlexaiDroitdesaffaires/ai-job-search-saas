-- =============================================================================
-- core_schema (v1.1) — reviewed & hardened. NOT YET APPLIED.
--
-- Safety properties:
--   * Runs as ONE explicit transaction (BEGIN ... COMMIT). The Supabase
--     Management API / MCP apply_migration does not wrap migrations itself,
--     so any failure — including the final self-verification block — rolls
--     back everything and leaves the database exactly as it was.
--   * Pre-flight guard aborts if any target object already exists and was NOT
--     created by this migration (marker comment 'app:core_schema_v1').
--   * No DROP of tables/columns/functions. Only DROP POLICY IF EXISTS on
--     policies this migration owns (guarded tables), so reruns converge.
--   * Every CREATE is IF NOT EXISTS / OR REPLACE -> safe to retry.
--   * Must run as role "postgres" so SECURITY DEFINER functions have a known,
--     non-client owner.
--   * Requires Postgres 15+ (composite FK "ON DELETE SET NULL (col)").
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- -----------------------------------------------------------------------------
-- 0. PRE-FLIGHT GUARD
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_marker constant text := 'app:core_schema_v1';
  v_tables constant text[] := array[
    'profiles','career_experiences','education','skills','job_preferences',
    'resumes','resume_versions','job_listings','saved_jobs','job_matches',
    'cover_letters','applications','application_events','screening_answers',
    'email_connections','recruiter_messages','subscriptions','credit_accounts',
    'credit_transactions','notifications','ai_generation_logs',
    'billing_customers','stripe_events'];
  v_functions constant text[] := array[
    'set_updated_at','handle_new_user','handle_user_email_change',
    'guard_application_server_fields','invalidate_application_approval',
    'forbid_ledger_update','spend_credits','grant_credits'];
  r record;
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'core_schema requires Postgres 15+';
  end if;

  if current_user <> 'postgres' then
    raise exception 'core_schema must run as role postgres (current: %)', current_user;
  end if;

  for r in
    select c.relname, obj_description(c.oid, 'pg_class') as marker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any (v_tables)
  loop
    if r.marker is distinct from v_marker then
      raise exception 'Refusing to proceed: public.% already exists and is not owned by this migration', r.relname;
    end if;
  end loop;

  for r in
    select p.proname, obj_description(p.oid, 'pg_proc') as marker
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_functions)
  loop
    if r.marker is distinct from v_marker then
      raise exception 'Refusing to replace pre-existing function public.%', r.proname;
    end if;
  end loop;

  for r in
    select t.tgname, obj_description(t.tgfoid, 'pg_proc') as marker
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
      and t.tgname in ('on_auth_user_created','on_auth_user_email_changed')
  loop
    if r.marker is distinct from v_marker then
      raise exception 'Refusing to replace pre-existing auth.users trigger %', r.tgname;
    end if;
  end loop;

  if exists (select 1 from storage.buckets b where b.id = 'resumes' and b.public) then
    raise exception 'Refusing to proceed: storage bucket "resumes" exists and is PUBLIC';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'resumes\_owner\_%'
  ) and not exists (select 1 from storage.buckets b where b.id = 'resumes') then
    raise exception 'Refusing to proceed: resumes_owner_* storage policies exist without our bucket';
  end if;
end
$guard$;

-- -----------------------------------------------------------------------------
-- 1. SHARED TRIGGER FUNCTIONS
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
comment on function public.set_updated_at() is 'app:core_schema_v1';
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. PROFILE & CAREER DATA
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text check (char_length(email) <= 320),
  full_name            text check (char_length(full_name) <= 200),
  location             text check (char_length(location) <= 200),
  phone                text check (char_length(phone) <= 40),
  linkedin_url         text check (char_length(linkedin_url) <= 300),
  avatar_url           text check (char_length(avatar_url) <= 2048),
  current_title        text check (char_length(current_title) <= 200),
  experience_level     text check (experience_level in ('entry','junior','mid','senior','lead','executive')),
  industry             text check (char_length(industry) <= 120),
  summary              text check (char_length(summary) <= 5000),
  locale               text not null default 'en' check (locale in ('en','fr')),
  onboarding_step      smallint not null default 1 check (onboarding_step between 1 and 5),
  onboarding_completed boolean not null default false,
  demo_mode            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.profiles is 'app:core_schema_v1';
create or replace trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.career_experiences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  company     text not null check (char_length(company) between 1 and 200),
  location    text check (char_length(location) <= 200),
  start_date  date,
  end_date    date,
  is_current  boolean not null default false,
  description text check (char_length(description) <= 10000),
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
comment on table public.career_experiences is 'app:core_schema_v1';
create index if not exists career_experiences_user_idx on public.career_experiences(user_id);
create or replace trigger career_experiences_updated before update on public.career_experiences
  for each row execute function public.set_updated_at();

create table if not exists public.education (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  institution    text not null check (char_length(institution) between 1 and 200),
  degree         text check (char_length(degree) <= 200),
  field_of_study text check (char_length(field_of_study) <= 200),
  start_date     date,
  end_date       date,
  position       smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
comment on table public.education is 'app:core_schema_v1';
create index if not exists education_user_idx on public.education(user_id);
create or replace trigger education_updated before update on public.education
  for each row execute function public.set_updated_at();

create table if not exists public.skills (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  level      text check (level in ('beginner','intermediate','advanced','expert')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.skills is 'app:core_schema_v1';

create table if not exists public.job_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  target_titles    text[] not null default '{}' check (cardinality(target_titles) <= 20),
  countries        text[] not null default '{}' check (cardinality(countries) <= 50),
  cities           text[] not null default '{}' check (cardinality(cities) <= 50),
  work_modes       text[] not null default '{}' check (work_modes <@ array['remote','hybrid','onsite']),
  salary_min       integer check (salary_min is null or salary_min between 0 and 10000000),
  salary_currency  text not null default 'USD' check (salary_currency ~ '^[A-Z]{3}$'),
  employment_types text[] not null default '{}' check (employment_types <@ array['full_time','part_time','contract','internship','temporary','freelance']),
  seniority        text[] not null default '{}' check (seniority <@ array['entry','junior','mid','senior','lead','executive']),
  languages        text[] not null default '{}' check (cardinality(languages) <= 20),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.job_preferences is 'app:core_schema_v1';
create or replace trigger job_preferences_updated before update on public.job_preferences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RESUMES
-- -----------------------------------------------------------------------------
create table if not exists public.resumes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null default 'My resume' check (char_length(title) between 1 and 200),
  storage_path text check (char_length(storage_path) <= 500),
  file_name    text check (char_length(file_name) <= 255),
  mime_type    text check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size    integer check (file_size between 1 and 10485760),
  parse_status text not null default 'pending' check (parse_status in ('pending','parsing','parsed','failed','not_requested')),
  parsed_data  jsonb,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, user_id),
  -- a row can only point at a file inside its owner's storage folder
  constraint resumes_storage_path_owned check (
    storage_path is null
    or (split_part(storage_path, '/', 1) = user_id::text and storage_path not like '%..%')
  )
);
comment on table public.resumes is 'app:core_schema_v1';
create index if not exists resumes_user_idx on public.resumes(user_id);
create unique index if not exists resumes_one_primary_per_user on public.resumes(user_id) where is_primary;
create or replace trigger resumes_updated before update on public.resumes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. JOB CATALOG (shared; written by server/service role only)
-- -----------------------------------------------------------------------------
create table if not exists public.job_listings (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (char_length(provider) between 1 and 60),
  external_id      text not null check (char_length(external_id) between 1 and 300),
  title            text not null,
  company          text not null,
  company_logo_url text,
  location         text,
  country          text,
  work_mode        text check (work_mode in ('remote','hybrid','onsite')),
  employment_type  text check (employment_type in ('full_time','part_time','contract','internship','temporary','freelance')),
  seniority        text check (seniority in ('entry','junior','mid','senior','lead','executive')),
  salary_min       integer check (salary_min is null or salary_min >= 0),
  salary_max       integer check (salary_max is null or salary_max >= 0),
  salary_currency  text check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  description      text,
  requirements     text[] not null default '{}',
  source_url       text,
  posted_at        timestamptz,
  is_demo          boolean not null default false,
  dedupe_key       text not null,
  credit_cost      smallint not null default 1 check (credit_cost between 0 and 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (provider, external_id),
  check (salary_min is null or salary_max is null or salary_max >= salary_min)
);
comment on table public.job_listings is 'app:core_schema_v1';
create index if not exists job_listings_dedupe_idx on public.job_listings(dedupe_key);
create index if not exists job_listings_posted_idx on public.job_listings(posted_at desc);
create or replace trigger job_listings_updated before update on public.job_listings
  for each row execute function public.set_updated_at();

create table if not exists public.resume_versions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  resume_id           uuid not null,
  name                text not null check (char_length(name) between 1 and 200),
  content             jsonb not null default '{}'::jsonb,
  tailored_for_job_id uuid references public.job_listings(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id),
  -- composite FK: the parent resume MUST belong to the same user
  foreign key (resume_id, user_id) references public.resumes(id, user_id) on delete cascade
);
comment on table public.resume_versions is 'app:core_schema_v1';
create index if not exists resume_versions_user_idx on public.resume_versions(user_id);
create index if not exists resume_versions_resume_idx on public.resume_versions(resume_id);
create or replace trigger resume_versions_updated before update on public.resume_versions
  for each row execute function public.set_updated_at();

create table if not exists public.saved_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid not null references public.job_listings(id) on delete cascade,
  decision   text not null default 'saved' check (decision in ('saved','skipped')),
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);
comment on table public.saved_jobs is 'app:core_schema_v1';
create index if not exists saved_jobs_job_idx on public.saved_jobs(job_id);

create table if not exists public.job_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid not null references public.job_listings(id) on delete cascade,
  score       smallint not null check (score between 0 and 100),
  breakdown   jsonb not null default '{}'::jsonb,
  explanation jsonb,
  computed_at timestamptz not null default now(),
  unique (user_id, job_id)
);
comment on table public.job_matches is 'app:core_schema_v1';
create index if not exists job_matches_user_score_idx on public.job_matches(user_id, score desc);

-- -----------------------------------------------------------------------------
-- 5. APPLICATIONS
-- -----------------------------------------------------------------------------
create table if not exists public.cover_letters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  job_id     uuid references public.job_listings(id) on delete set null,
  title      text not null check (char_length(title) between 1 and 200),
  tone       text check (tone in ('professional','warm','confident','concise','enthusiastic')),
  content    text not null default '' check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
comment on table public.cover_letters is 'app:core_schema_v1';
create index if not exists cover_letters_user_idx on public.cover_letters(user_id);
create or replace trigger cover_letters_updated before update on public.cover_letters
  for each row execute function public.set_updated_at();

create table if not exists public.applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  job_id              uuid references public.job_listings(id) on delete set null,
  company             text not null check (char_length(company) between 1 and 200),
  job_title           text not null check (char_length(job_title) between 1 and 200),
  job_url             text check (char_length(job_url) <= 2048),
  location            text check (char_length(location) <= 200),
  industry            text check (char_length(industry) <= 120),
  status              text not null default 'saved' check (status in ('saved','prepared','applied','awaiting_response','interview','offer','rejected','withdrawn')),
  prep_state          text not null default 'draft' check (prep_state in ('draft','ready_for_review','approved','submitting','submitted','failed','needs_manual_action')),
  approved_at         timestamptz,
  resume_version_id   uuid,
  cover_letter_id     uuid,
  submitted_at        timestamptz,
  submission_method   text check (submission_method in ('manual','adapter')),
  submission_evidence jsonb,
  interview_at        timestamptz,
  notes               text check (char_length(notes) <= 10000),
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id),
  -- 'submitted' is only reachable with real adapter evidence (no simulated success)
  constraint applications_submitted_has_evidence check (
    prep_state <> 'submitted'
    or (submission_method = 'adapter' and submitted_at is not null and submission_evidence is not null)),
  constraint applications_manual_has_timestamp check (
    submission_method is distinct from 'manual' or submitted_at is not null),
  constraint applications_approval_timestamped check (
    prep_state not in ('approved','submitting','submitted') or approved_at is not null),
  -- composite FKs: referenced resume version / letter MUST belong to same user
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete set null (resume_version_id),
  foreign key (cover_letter_id, user_id)   references public.cover_letters(id, user_id)   on delete set null (cover_letter_id)
);
comment on table public.applications is 'app:core_schema_v1';
create index if not exists applications_user_status_idx on public.applications(user_id, status);
create index if not exists applications_job_idx on public.applications(job_id);
create or replace trigger applications_updated before update on public.applications
  for each row execute function public.set_updated_at();

-- Part 1 (ALL roles, incl. service_role): submission state machine
--   approved -> submitting -> submitted | failed | needs_manual_action
--   'submitted' is terminal; approval is timestamped by the database.
-- Part 2 (clients only): adapter results, 'submitting'/'submitted'/'failed'
--   and evidence are server-managed; material edits revoke approval.
create or replace function public.guard_application_server_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_is_client constant boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' and new.prep_state in ('submitting','submitted') then
    raise exception 'applications cannot be created in state %', new.prep_state using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.prep_state is distinct from old.prep_state then
    if old.prep_state = 'submitted' then
      raise exception 'submitted is a terminal state' using errcode = '42501';
    end if;
    if new.prep_state = 'submitting' and old.prep_state <> 'approved' then
      raise exception 'submission requires explicit user approval' using errcode = '42501';
    end if;
    if new.prep_state = 'submitted' and old.prep_state <> 'submitting' then
      raise exception 'submitted must follow submitting' using errcode = '42501';
    end if;
  end if;

  if new.prep_state = 'approved' and (tg_op = 'INSERT' or old.prep_state is distinct from 'approved') then
    new.approved_at := now();
  elsif new.prep_state not in ('approved','submitting','submitted') then
    new.approved_at := null;
  elsif tg_op = 'UPDATE' then
    new.approved_at := old.approved_at;
  end if;

  if not v_is_client then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.prep_state in ('approved','failed')
       or new.submission_method = 'adapter'
       or new.submission_evidence is not null then
      raise exception 'submission fields are server-managed' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.prep_state in ('submitting','submitted') and (
       new.prep_state is distinct from old.prep_state
       or new.resume_version_id is distinct from old.resume_version_id
       or new.cover_letter_id is distinct from old.cover_letter_id
       or new.job_url is distinct from old.job_url) then
    raise exception 'application is locked while submitting/submitted' using errcode = '42501';
  end if;
  if new.prep_state is distinct from old.prep_state and new.prep_state in ('submitting','submitted','failed') then
    raise exception 'prep_state % is server-managed', new.prep_state using errcode = '42501';
  end if;
  if old.prep_state = 'approved' and new.prep_state = 'approved' and (
       new.resume_version_id is distinct from old.resume_version_id
       or new.cover_letter_id is distinct from old.cover_letter_id
       or new.job_url is distinct from old.job_url) then
    new.prep_state := 'ready_for_review';
    new.approved_at := null;
  end if;
  if new.submission_evidence is distinct from old.submission_evidence then
    raise exception 'submission_evidence is server-managed' using errcode = '42501';
  end if;
  if new.submission_method is distinct from old.submission_method
     and (new.submission_method = 'adapter' or old.submission_method = 'adapter') then
    raise exception 'adapter submissions are server-managed' using errcode = '42501';
  end if;
  if old.submission_method = 'adapter' and new.submitted_at is distinct from old.submitted_at then
    raise exception 'adapter submission timestamp is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.guard_application_server_fields() is 'app:core_schema_v1';
revoke all on function public.guard_application_server_fields() from public, anon, authenticated;
create or replace trigger applications_guard_server_fields before insert or update on public.applications
  for each row execute function public.guard_application_server_fields();

create table if not exists public.application_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  event_type     text not null check (char_length(event_type) between 1 and 60),
  from_status    text,
  to_status      text,
  details        jsonb,
  created_at     timestamptz not null default now(),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
comment on table public.application_events is 'app:core_schema_v1';
create index if not exists application_events_app_idx on public.application_events(application_id, created_at desc);
create index if not exists application_events_user_idx on public.application_events(user_id, created_at desc);

create table if not exists public.screening_answers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  question       text not null check (char_length(question) between 1 and 2000),
  answer         text not null default '' check (char_length(answer) <= 10000),
  approved       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
comment on table public.screening_answers is 'app:core_schema_v1';
create index if not exists screening_answers_app_idx on public.screening_answers(application_id);
create index if not exists screening_answers_user_idx on public.screening_answers(user_id);
create or replace trigger screening_answers_updated before update on public.screening_answers
  for each row execute function public.set_updated_at();

-- Changing any screening answer after approval sends the application back to
-- review; answers of a submitting/submitted application are locked for clients.
create or replace function public.invalidate_application_approval()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_app_id uuid;
  v_state text;
begin
  foreach v_app_id in array array_remove(array[
      case when tg_op <> 'INSERT' then old.application_id end,
      case when tg_op <> 'DELETE' then new.application_id end], null)
  loop
    select a.prep_state into v_state from public.applications a where a.id = v_app_id for update;
    if not found then
      continue;
    end if;
    if v_state in ('submitting','submitted') and current_user in ('authenticated','anon') then
      raise exception 'screening answers are locked while submitting/submitted' using errcode = '42501';
    end if;
    if v_state = 'approved' then
      update public.applications set prep_state = 'ready_for_review' where id = v_app_id;
    end if;
  end loop;
  return null;
end;
$$;
comment on function public.invalidate_application_approval() is 'app:core_schema_v1';
revoke all on function public.invalidate_application_approval() from public, anon, authenticated;
create or replace trigger screening_answers_invalidate_approval
  after insert or update or delete on public.screening_answers
  for each row execute function public.invalidate_application_approval();

-- -----------------------------------------------------------------------------
-- 6. EMAIL (OAuth tokens are NEVER stored in these client-readable tables)
-- -----------------------------------------------------------------------------
create table if not exists public.email_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null check (provider in ('gmail')),
  email_address  text,
  scopes         text[] not null default '{}',
  status         text not null default 'disconnected' check (status in ('connected','disconnected','error','revoked')),
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, provider)
);
comment on table public.email_connections is 'app:core_schema_v1';
create or replace trigger email_connections_updated before update on public.email_connections
  for each row execute function public.set_updated_at();

create table if not exists public.recruiter_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  application_id      uuid,
  provider_message_id text not null,
  thread_id           text,
  from_address        text,
  subject             text,
  snippet             text,
  received_at         timestamptz,
  classification      text check (classification in ('recruiter','interview_invite','rejection','offer','other')),
  suggested_status    text check (suggested_status in ('saved','prepared','applied','awaiting_response','interview','offer','rejected','withdrawn')),
  created_at          timestamptz not null default now(),
  unique (user_id, provider_message_id),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete set null (application_id)
);
comment on table public.recruiter_messages is 'app:core_schema_v1';
create index if not exists recruiter_messages_user_idx on public.recruiter_messages(user_id, received_at desc);
create index if not exists recruiter_messages_app_idx on public.recruiter_messages(application_id);

-- -----------------------------------------------------------------------------
-- 7. BILLING & CREDITS (server-written only)
-- -----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  plan                   text check (plan in ('weekly','monthly','quarterly')),
  status                 text not null default 'inactive' check (status in ('inactive','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- Stripe event.created of the last applied event; webhooks ignore older events
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.subscriptions is 'app:core_schema_v1';

-- Server-only: maps Stripe customers to users (webhook -> user resolution).
create table if not exists public.billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at         timestamptz not null default now()
);
comment on table public.billing_customers is 'app:core_schema_v1';

-- Server-only: verified webhook event log for de-duplication of redeliveries.
create table if not exists public.stripe_events (
  id           text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type         text not null check (char_length(type) between 1 and 100),
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.stripe_events is 'app:core_schema_v1';
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);
create unique index if not exists subscriptions_one_live_per_user
  on public.subscriptions(user_id) where status in ('trialing','active','past_due');
create or replace trigger subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Materialized balance, row-locked by spend/grant; CHECK makes overdraft impossible.
create table if not exists public.credit_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.credit_accounts is 'app:core_schema_v1';

-- Append-only ledger.
create table if not exists public.credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  amount          integer not null check (amount <> 0 and amount between -100 and 100000),
  balance_after   integer not null check (balance_after >= 0),
  reason          text not null check (reason in (
                    'subscription_grant','renewal_grant','purchase_grant','refund','admin_adjustment',
                    'ai_application','resume_tailoring','cover_letter','match_explanation','assistant')),
  reference_id    text check (char_length(reference_id) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
comment on table public.credit_transactions is 'app:core_schema_v1';
create index if not exists credit_transactions_user_idx on public.credit_transactions(user_id, created_at desc);

create or replace function public.forbid_ledger_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'credit_transactions is append-only' using errcode = '42501';
end;
$$;
comment on function public.forbid_ledger_update() is 'app:core_schema_v1';
revoke all on function public.forbid_ledger_update() from public, anon, authenticated;
-- UPDATE only: DELETE must stay possible for ON DELETE CASCADE (account deletion).
create or replace trigger credit_transactions_append_only before update on public.credit_transactions
  for each row execute function public.forbid_ledger_update();

create or replace function public.spend_credits(
  p_user_id uuid, p_amount integer, p_reason text, p_reference text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_balance integer;
  v_existing public.credit_transactions%rowtype;
  v_tx_id uuid;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('ai_application','resume_tailoring','cover_letter','match_explanation','assistant') then
    raise exception 'invalid spend reason' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if char_length(p_reference) > 200 then
    raise exception 'invalid reference' using errcode = '22023';
  end if;

  insert into public.credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  -- row lock serializes all spends/grants for this user
  select a.balance into v_balance from public.credit_accounts a where a.user_id = p_user_id for update;

  select * into v_existing from public.credit_transactions t
   where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> -p_amount or v_existing.reason <> p_reason
       or v_existing.reference_id is distinct from p_reference then
      raise exception 'idempotency key reused with different parameters' using errcode = '22023';
    end if;
    return jsonb_build_object('balance', v_balance, 'transaction_id', v_existing.id, 'replayed', true);
  end if;

  if v_balance < p_amount then
    raise exception 'insufficient credits' using errcode = 'P0001';
  end if;

  update public.credit_accounts a
     set balance = a.balance - p_amount, updated_at = now()
   where a.user_id = p_user_id
  returning a.balance into v_balance;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, reference_id, idempotency_key)
  values (p_user_id, -p_amount, v_balance, p_reason, p_reference, p_idempotency_key)
  returning id into v_tx_id;

  return jsonb_build_object('balance', v_balance, 'transaction_id', v_tx_id, 'replayed', false);
end;
$$;
comment on function public.spend_credits(uuid, integer, text, text, text) is 'app:core_schema_v1';
revoke all on function public.spend_credits(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text, text, text) to service_role;

create or replace function public.grant_credits(
  p_user_id uuid, p_amount integer, p_reason text, p_reference text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_balance integer;
  v_existing public.credit_transactions%rowtype;
  v_tx_id uuid;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('subscription_grant','renewal_grant','purchase_grant','refund','admin_adjustment') then
    raise exception 'invalid grant reason' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if char_length(p_reference) > 200 then
    raise exception 'invalid reference' using errcode = '22023';
  end if;

  insert into public.credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select a.balance into v_balance from public.credit_accounts a where a.user_id = p_user_id for update;

  select * into v_existing from public.credit_transactions t
   where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> p_amount or v_existing.reason <> p_reason
       or v_existing.reference_id is distinct from p_reference then
      raise exception 'idempotency key reused with different parameters' using errcode = '22023';
    end if;
    return jsonb_build_object('balance', v_balance, 'transaction_id', v_existing.id, 'replayed', true);
  end if;

  update public.credit_accounts a
     set balance = a.balance + p_amount, updated_at = now()
   where a.user_id = p_user_id
  returning a.balance into v_balance;

  insert into public.credit_transactions (user_id, amount, balance_after, reason, reference_id, idempotency_key)
  values (p_user_id, p_amount, v_balance, p_reason, p_reference, p_idempotency_key)
  returning id into v_tx_id;

  return jsonb_build_object('balance', v_balance, 'transaction_id', v_tx_id, 'replayed', false);
end;
$$;
comment on function public.grant_credits(uuid, integer, text, text, text) is 'app:core_schema_v1';
revoke all on function public.grant_credits(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 8. NOTIFICATIONS & AI LOGS
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (char_length(type) between 1 and 60),
  title      text not null check (char_length(title) between 1 and 200),
  body       text check (char_length(body) <= 2000),
  -- same-origin relative paths only; rejects //host and /\host (browser-normalized to //)
  link       text check (link is null or (link ~ '^/[A-Za-z0-9]' and link !~ '[\\[:cntrl:]]' and char_length(link) <= 500)),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.notifications is 'app:core_schema_v1';
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.ai_generation_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  feature       text not null,
  model         text,
  input_tokens  integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  status        text not null default 'success' check (status in ('success','error','refused')),
  reference_id  text,
  created_at    timestamptz not null default now()
);
comment on table public.ai_generation_logs is 'app:core_schema_v1';
create index if not exists ai_generation_logs_user_idx on public.ai_generation_logs(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 9. PRIVILEGES (defense in depth on top of RLS)
--    Default privileges in this project grant anon/authenticated ALL on new
--    tables, incl. TRUNCATE (which bypasses RLS). Strip what is not needed.
-- -----------------------------------------------------------------------------
do $grants$
declare
  t text;
  all_tables constant text[] := array[
    'profiles','career_experiences','education','skills','job_preferences',
    'resumes','resume_versions','job_listings','saved_jobs','job_matches',
    'cover_letters','applications','application_events','screening_answers',
    'email_connections','recruiter_messages','subscriptions','credit_accounts',
    'credit_transactions','notifications','ai_generation_logs',
    'billing_customers','stripe_events'];
  read_only_tables constant text[] := array[
    'job_listings','job_matches','email_connections','recruiter_messages',
    'subscriptions','credit_accounts','credit_transactions','ai_generation_logs'];
  server_only_tables constant text[] := array['billing_customers','stripe_events'];
begin
  foreach t in array all_tables loop
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);
  end loop;
  foreach t in array read_only_tables loop
    execute format('revoke insert, update, delete on table public.%I from authenticated', t);
  end loop;
  foreach t in array server_only_tables loop
    execute format('revoke all on table public.%I from authenticated', t);
  end loop;
end
$grants$;

-- profiles: row is created by trigger; users may only edit these columns
revoke insert, update, delete on table public.profiles from authenticated;
grant update (full_name, location, phone, linkedin_url, avatar_url, current_title,
              experience_level, industry, summary, locale, onboarding_step,
              onboarding_completed, demo_mode)
  on table public.profiles to authenticated;

-- application_events: append-only history for clients
revoke update, delete on table public.application_events from authenticated;

-- notifications: created server-side; users may only mark read or dismiss
revoke insert, update on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
--     Cross-user parent references are prevented by composite FKs (above),
--     which hold even for service-role writes. Policies enforce ownership.
-- -----------------------------------------------------------------------------
do $rls$
declare
  t text;
  owner_crud constant text[] := array[
    'career_experiences','education','skills','job_preferences','resumes',
    'resume_versions','saved_jobs','cover_letters','applications','screening_answers'];
  owner_read constant text[] := array[
    'job_matches','email_connections','recruiter_messages','subscriptions',
    'credit_accounts','credit_transactions','ai_generation_logs'];
begin
  -- billing_customers / stripe_events: RLS on, no policies => service_role only
  foreach t in array owner_crud || owner_read || array['profiles','job_listings','application_events','notifications','billing_customers','stripe_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array owner_crud loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete', t);
  end loop;

  foreach t in array owner_read loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select', t);
  end loop;
end
$rls$;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists job_listings_read on public.job_listings;
create policy job_listings_read on public.job_listings for select to authenticated using (true);

drop policy if exists application_events_select on public.application_events;
drop policy if exists application_events_insert on public.application_events;
create policy application_events_select on public.application_events for select to authenticated
  using ((select auth.uid()) = user_id);
-- clients may only log user-originated event types; system events are server-only
create policy application_events_insert on public.application_events for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and event_type in ('status_changed','note_added','interview_scheduled','manual_submission_recorded','field_updated')
  );

drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_delete on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notifications_update on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notifications_delete on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 11. AUTH TRIGGERS
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), '');
  v_avatar text := new.raw_user_meta_data ->> 'avatar_url';
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    left(new.email, 320),
    left(v_name, 200),
    case when v_avatar ~ '^https://' then left(v_avatar, 2048) end
  )
  on conflict (id) do nothing;

  insert into public.job_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  -- zero balance: credits are only granted via verified Stripe webhooks
  insert into public.credit_accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
comment on function public.handle_new_user() is 'app:core_schema_v1';
revoke all on function public.handle_new_user() from public, anon, authenticated;
create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = left(new.email, 320) where id = new.id;
  return new;
end;
$$;
comment on function public.handle_user_email_change() is 'app:core_schema_v1';
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
create or replace trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- 12. STORAGE: private resumes bucket, strict per-user folder isolation
--     Object key layout: <user_id>/<uuid>.<ext>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760,
        array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists resumes_owner_select on storage.objects;
drop policy if exists resumes_owner_insert on storage.objects;
drop policy if exists resumes_owner_update on storage.objects;
drop policy if exists resumes_owner_delete on storage.objects;

create policy resumes_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resumes_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- WITH CHECK prevents moving/renaming an object into another user's folder
create policy resumes_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resumes_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- 13. SELF-VERIFICATION — any violation aborts and rolls back the whole migration
-- -----------------------------------------------------------------------------
do $verify$
declare
  r record;
  v_role text;
begin
  for r in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and obj_description(p.oid, 'pg_proc') = 'app:core_schema_v1'
  loop
    if r.proconfig is null or not ('search_path=""' = any (r.proconfig)) then
      raise exception 'verify: public.% has no pinned empty search_path', r.proname;
    end if;
    foreach v_role in array array['public','anon','authenticated'] loop
      if has_function_privilege(v_role, r.oid, 'execute') then
        raise exception 'verify: % can execute public.%', v_role, r.proname;
      end if;
    end loop;
    if r.prosecdef and r.owner <> 'postgres' then
      raise exception 'verify: security definer public.% owned by %', r.proname, r.owner;
    end if;
  end loop;

  for r in
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not r.relrowsecurity then
      raise exception 'verify: RLS disabled on public.%', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'verify: anon has privileges on public.%', r.relname;
    end if;
    if has_table_privilege('authenticated', r.oid, 'truncate,references,trigger') then
      raise exception 'verify: authenticated has truncate/references/trigger on public.%', r.relname;
    end if;
  end loop;

  for r in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'job_listings','job_matches','email_connections','recruiter_messages','subscriptions',
      'credit_accounts','credit_transactions','ai_generation_logs','billing_customers','stripe_events')
  loop
    if has_table_privilege('authenticated', r.oid, 'insert,update,delete') then
      raise exception 'verify: authenticated can write server-managed public.%', r.relname;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.billing_customers', 'select')
     or has_table_privilege('authenticated', 'public.stripe_events', 'select') then
    raise exception 'verify: authenticated can read server-only billing tables';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'insert,delete')
     or has_column_privilege('authenticated', 'public.profiles', 'email', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'id', 'update') then
    raise exception 'verify: authenticated has excess privileges on profiles';
  end if;

  if not exists (select 1 from storage.buckets where id = 'resumes' and not public) then
    raise exception 'verify: resumes bucket missing or public';
  end if;
end
$verify$;

commit;
