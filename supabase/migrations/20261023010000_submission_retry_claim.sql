do $guard$
begin
  if obj_description('public.application_submissions'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1'
     or obj_description('public.application_dossiers'::regclass, 'pg_class')
       is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter submission claim: ownership marker missing';
  end if;
end
$guard$;

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

  with stale as (
    update public.application_submissions s
    set state = 'failed', completed_at = now(),
        error_message = 'Approved dossier changed before claim',
        last_outcome = '{"kind":"stale_dossier"}'::jsonb
    from public.applications a, public.application_dossiers d
    where s.application_id = a.id and s.dossier_id = d.id
      and s.method = 'adapter' and s.state in ('queued', 'retry_scheduled')
      and (
        (s.state = 'queued' and a.prep_state <> 'approved')
        or (s.state = 'retry_scheduled' and a.prep_state <> 'submitting')
        or d.state <> 'approved'
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
    and (
      (s.state = 'queued' and a.prep_state = 'approved')
      or (s.state = 'retry_scheduled' and a.prep_state = 'submitting')
    )
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
