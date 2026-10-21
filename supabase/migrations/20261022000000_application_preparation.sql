begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $guard$
declare
  t text;
begin
  foreach t in array array[
    'applications', 'resume_versions', 'cover_letters', 'screening_answers',
    'application_events', 'resumes', 'job_listings'
  ] loop
    if obj_description(format('public.%I', t)::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
      raise exception 'Refusing to alter public.%: ownership marker missing', t;
    end if;
  end loop;
  if to_regclass('public.application_dossiers') is not null
     and obj_description(to_regclass('public.application_dossiers'), 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to adopt public.application_dossiers: ownership marker missing';
  end if;
end
$guard$;

do $crypto$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'application preparation requires pgcrypto digest(bytea,text) in schema extensions';
  end if;
end
$crypto$;

alter table public.screening_answers
  add column if not exists source_kind text not null default 'missing'
    check (source_kind in ('profile', 'resume', 'user_confirmed', 'missing')),
  add column if not exists source_reference text
    check (source_reference is null or char_length(source_reference) <= 500),
  add column if not exists required boolean not null default false,
  add column if not exists needs_review boolean not null default true;

create table if not exists public.application_dossiers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  application_id    uuid not null,
  job_id            uuid not null references public.job_listings(id) on delete restrict,
  resume_version_id uuid not null,
  cover_letter_id   uuid not null,
  version           integer not null check (version > 0),
  schema_version    text not null check (schema_version = 'application-dossier-v1'),
  content           jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  state             text not null default 'draft'
    check (state in ('draft', 'approved', 'superseded')),
  missing_fields    text[] not null default '{}',
  prepared_at       timestamptz not null default now(),
  approved_at       timestamptz,
  unique (id, user_id),
  unique (application_id, version),
  unique (application_id, content_hash),
  foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade,
  foreign key (resume_version_id, user_id)
    references public.resume_versions(id, user_id) on delete restrict,
  foreign key (cover_letter_id, user_id)
    references public.cover_letters(id, user_id) on delete restrict,
  constraint application_dossiers_approval_timestamp check (
    (state = 'approved' and approved_at is not null)
    or (state <> 'approved' and approved_at is null)
  )
);
comment on table public.application_dossiers is 'app:core_schema_v1';
create index if not exists application_dossiers_user_idx
  on public.application_dossiers(user_id, prepared_at desc);
create index if not exists application_dossiers_application_idx
  on public.application_dossiers(application_id, version desc);
create unique index if not exists application_dossiers_one_current_idx
  on public.application_dossiers(application_id)
  where state in ('draft', 'approved');

create or replace function public.guard_application_dossier_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id
     or new.application_id is distinct from old.application_id
     or new.job_id is distinct from old.job_id
     or new.resume_version_id is distinct from old.resume_version_id
     or new.cover_letter_id is distinct from old.cover_letter_id
     or new.version is distinct from old.version
     or new.schema_version is distinct from old.schema_version
     or new.content is distinct from old.content
     or new.content_hash is distinct from old.content_hash
     or new.missing_fields is distinct from old.missing_fields
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'application dossier content is immutable' using errcode = '42501';
  end if;
  if old.state = 'superseded' and new.state is distinct from old.state then
    raise exception 'superseded application dossier is terminal' using errcode = '42501';
  end if;
  if old.state = 'approved' and new.state not in ('approved', 'superseded') then
    raise exception 'approved application dossier can only be superseded' using errcode = '42501';
  end if;
  if new.state = 'approved' and old.state <> 'draft' then
    raise exception 'only a draft application dossier can be approved' using errcode = '42501';
  end if;
  return new;
end
$function$;
comment on function public.guard_application_dossier_immutability() is 'app:core_schema_v1';
revoke all on function public.guard_application_dossier_immutability() from public, anon, authenticated;
create or replace trigger application_dossiers_immutable
  before update on public.application_dossiers
  for each row execute function public.guard_application_dossier_immutability();

-- Direct client approval would bypass dossier completeness checks. Security
-- definer workflows still operate as postgres and retain the existing state
-- machine, including explicit manual submissions.
create or replace function public.require_approved_dossier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if new.prep_state = 'approved' and old.prep_state is distinct from 'approved' then
      raise exception 'application approval must use approve_application_dossier' using errcode = '42501';
    end if;
    if new.resume_version_id is distinct from old.resume_version_id
       or new.cover_letter_id is distinct from old.cover_letter_id then
      raise exception 'application documents must use prepare_application_dossier' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;
comment on function public.require_approved_dossier() is 'app:core_schema_v1';
revoke all on function public.require_approved_dossier() from public, anon, authenticated;
create or replace trigger applications_require_approved_dossier
  before update on public.applications
  for each row execute function public.require_approved_dossier();

create or replace function public.prepare_application_dossier(
  p_application_id uuid,
  p_resume_id uuid,
  p_content jsonb,
  p_canonical_content text,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_app public.applications%rowtype;
  v_resume public.resumes%rowtype;
  v_existing public.application_dossiers%rowtype;
  v_dossier public.application_dossiers%rowtype;
  v_resume_version_id uuid;
  v_cover_letter_id uuid;
  v_version integer;
  v_missing_fields text[];
  v_answer jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or p_content->>'schemaVersion' <> 'application-dossier-v1'
     or jsonb_typeof(p_content->'resume') <> 'object'
     or jsonb_typeof(p_content->'coverLetter') <> 'object'
     or jsonb_typeof(p_content->'screeningAnswers') <> 'array'
     or jsonb_typeof(p_content->'missingFields') <> 'array' then
    raise exception 'Invalid application dossier content' using errcode = '22023';
  end if;
  if p_canonical_content is null
     or p_canonical_content::jsonb is distinct from p_content then
    raise exception 'Canonical content does not match dossier content' using errcode = '22023';
  end if;
  if p_content_hash is null
     or p_content_hash <> encode(extensions.digest(convert_to(p_canonical_content, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'Application dossier hash mismatch' using errcode = '22023';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;
  if not found or v_app.job_id is null then
    raise exception 'Accepted application not found' using errcode = 'P0002';
  end if;
  if v_app.prep_state in ('submitting', 'submitted') then
    raise exception 'Application is locked for submission' using errcode = '42501';
  end if;

  select * into v_resume from public.resumes
  where id = p_resume_id and user_id = v_user_id and parse_status = 'parsed'
  for share;
  if not found then
    raise exception 'Parsed resume not found' using errcode = 'P0002';
  end if;
  if p_content->'application'->>'applicationId' <> v_app.id::text
     or p_content->'application'->>'jobId' <> v_app.job_id::text
     or p_content->'application'->>'jobTitle' <> v_app.job_title
     or p_content->'application'->>'company' <> v_app.company
     or p_content->'resume'->>'sourceResumeId' <> v_resume.id::text then
    raise exception 'Dossier identifiers do not match persisted application data' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_content->'screeningAnswers') value
    where value->>'key' = 'full_name' and coalesce((value->>'required')::boolean, false)
  ) or not exists (
    select 1 from jsonb_array_elements(p_content->'screeningAnswers') value
    where value->>'key' = 'email' and coalesce((value->>'required')::boolean, false)
  ) or not exists (
    select 1 from jsonb_array_elements(p_content->'screeningAnswers') value
    where value->>'key' = 'phone' and coalesce((value->>'required')::boolean, false)
  ) then
    raise exception 'Required identity screening fields are missing' using errcode = '22023';
  end if;

  select * into v_existing from public.application_dossiers
  where application_id = p_application_id and content_hash = p_content_hash;
  if found then
    return jsonb_build_object(
      'dossier_id', v_existing.id,
      'version', v_existing.version,
      'content_hash', v_existing.content_hash,
      'state', v_existing.state,
      'replayed', true
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.application_dossiers where application_id = p_application_id;

  update public.application_dossiers
     set state = 'superseded', approved_at = null
   where application_id = p_application_id and state in ('draft', 'approved');

  insert into public.resume_versions(user_id, resume_id, name, content, tailored_for_job_id)
  values (
    v_user_id,
    v_resume.id,
    left(coalesce(nullif(p_content->'resume'->>'title', ''), 'CV personnalisé'), 200),
    p_content->'resume',
    v_app.job_id
  ) returning id into v_resume_version_id;

  insert into public.cover_letters(user_id, job_id, title, tone, content)
  values (
    v_user_id,
    v_app.job_id,
    left(coalesce(nullif(p_content->'coverLetter'->>'title', ''), 'Lettre de motivation'), 200),
    'professional',
    left(coalesce(p_content->'coverLetter'->>'body', ''), 20000)
  ) returning id into v_cover_letter_id;

  delete from public.screening_answers where application_id = p_application_id;
  for v_answer in select value from jsonb_array_elements(p_content->'screeningAnswers') loop
    insert into public.screening_answers(
      user_id, application_id, question, answer, approved,
      source_kind, source_reference, required, needs_review
    ) values (
      v_user_id,
      p_application_id,
      left(coalesce(v_answer->>'question', ''), 2000),
      left(coalesce(v_answer->>'answer', ''), 10000),
      coalesce((v_answer->>'confirmed')::boolean, false),
      coalesce(nullif(v_answer->>'sourceKind', ''), 'missing'),
      left(nullif(v_answer->>'sourceReference', ''), 500),
      coalesce((v_answer->>'required')::boolean, false),
      coalesce((v_answer->>'needsReview')::boolean, true)
    );
  end loop;

  select coalesce(array_agg(value), '{}') into v_missing_fields
  from jsonb_array_elements_text(p_content->'missingFields');

  insert into public.application_dossiers(
    user_id, application_id, job_id, resume_version_id, cover_letter_id,
    version, schema_version, content, content_hash, missing_fields
  ) values (
    v_user_id, p_application_id, v_app.job_id, v_resume_version_id,
    v_cover_letter_id, v_version, 'application-dossier-v1', p_content,
    p_content_hash, v_missing_fields
  ) returning * into v_dossier;

  update public.applications
     set resume_version_id = v_resume_version_id,
         cover_letter_id = v_cover_letter_id,
         status = 'prepared',
         prep_state = 'ready_for_review'
   where id = p_application_id;

  insert into public.application_events(
    user_id, application_id, event_type, from_status, to_status, details
  ) values (
    v_user_id, p_application_id, 'dossier_prepared', v_app.prep_state,
    'ready_for_review', jsonb_build_object(
      'dossier_id', v_dossier.id,
      'version', v_dossier.version,
      'content_hash', v_dossier.content_hash
    )
  );

  return jsonb_build_object(
    'dossier_id', v_dossier.id,
    'version', v_dossier.version,
    'content_hash', v_dossier.content_hash,
    'state', v_dossier.state,
    'replayed', false
  );
end
$function$;
comment on function public.prepare_application_dossier(uuid, uuid, jsonb, text, text) is 'app:core_schema_v1';
revoke all on function public.prepare_application_dossier(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.prepare_application_dossier(uuid, uuid, jsonb, text, text) to authenticated;

create or replace function public.approve_application_dossier(
  p_application_id uuid,
  p_dossier_id uuid,
  p_expected_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_app public.applications%rowtype;
  v_dossier public.application_dossiers%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  select * into v_dossier from public.application_dossiers
  where id = p_dossier_id and application_id = p_application_id
    and user_id = v_user_id
  for update;
  if not found or v_dossier.state <> 'draft' then
    raise exception 'Current draft dossier not found' using errcode = 'P0002';
  end if;
  if v_dossier.content_hash is distinct from p_expected_hash then
    raise exception 'Dossier hash changed before approval' using errcode = '22023';
  end if;
  if v_app.resume_version_id is distinct from v_dossier.resume_version_id
     or v_app.cover_letter_id is distinct from v_dossier.cover_letter_id
     or v_app.prep_state <> 'ready_for_review' then
    raise exception 'Application does not reference the current review dossier' using errcode = '42501';
  end if;
  if v_dossier.version <> (
    select max(version) from public.application_dossiers
    where application_id = p_application_id
  ) then
    raise exception 'Only the latest dossier version can be approved' using errcode = '42501';
  end if;
  if cardinality(v_dossier.missing_fields) > 0 then
    raise exception 'Required dossier information is missing' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.screening_answers
    where application_id = p_application_id
      and (needs_review or (required and (answer = '' or not approved)))
  ) then
    raise exception 'Screening answers require user validation' using errcode = '23514';
  end if;

  update public.application_dossiers
     set state = 'approved', approved_at = now()
   where id = p_dossier_id;
  update public.applications
     set prep_state = 'approved'
   where id = p_application_id;
  insert into public.application_events(
    user_id, application_id, event_type, from_status, to_status, details
  ) values (
    v_user_id, p_application_id, 'dossier_approved', v_app.prep_state,
    'approved', jsonb_build_object(
      'dossier_id', v_dossier.id,
      'version', v_dossier.version,
      'content_hash', v_dossier.content_hash
    )
  );

  return jsonb_build_object(
    'dossier_id', v_dossier.id,
    'version', v_dossier.version,
    'content_hash', v_dossier.content_hash,
    'state', 'approved'
  );
end
$function$;
comment on function public.approve_application_dossier(uuid, uuid, text) is 'app:core_schema_v1';
revoke all on function public.approve_application_dossier(uuid, uuid, text) from public, anon;
grant execute on function public.approve_application_dossier(uuid, uuid, text) to authenticated;

-- Preparation artifacts are read-only to clients. Only the RPCs above create
-- versions and transition approval state.
revoke insert, update, delete on table public.resume_versions from authenticated;
revoke insert, update, delete on table public.cover_letters from authenticated;
revoke insert, update, delete on table public.screening_answers from authenticated;
revoke all on table public.application_dossiers from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.application_dossiers from authenticated;
grant select on table public.application_dossiers to authenticated;
alter table public.application_dossiers enable row level security;
drop policy if exists application_dossiers_select on public.application_dossiers;
create policy application_dossiers_select on public.application_dossiers
  for select to authenticated using ((select auth.uid()) = user_id);

commit;
